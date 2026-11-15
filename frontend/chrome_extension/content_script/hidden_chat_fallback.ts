export function buildHiddenChatUrl(videoId: string, hostname: string): string {
  return `https://www.youtube.com/live_chat?v=${encodeURIComponent(videoId)}&embed_domain=${encodeURIComponent(hostname)}`;
}

// A replay chat (an ended stream or a premiere) is served from a continuation
// URL that cannot be built from scratch, so it has to be captured while
// YouTube's own chat is still up.
export function isReplayChatUrl(url: string | undefined): boolean {
  return !!url && url.indexOf("/live_chat_replay") !== -1;
}

export interface HiddenChat {
  container: Element;
  // A replay chat replaces its whole list whenever the video seeks, so
  // everything in the container right after a rebuild is history.
  skipRebuilds: boolean;
  // True while a replay chat is still appending the messages it skipped over.
  isCatchingUp: () => boolean;
}

export interface TimerHost {
  setInterval: (callback: () => void, interval: number) => number;
  clearInterval: (id: number) => void;
}

// YouTube blanks its own chat iframe when the chat is collapsed. This loads the
// same chat in an invisible iframe of our own so the chat container can still
// be read: a live chat by video id, a replay chat by the captured continuation
// URL, which then has to be driven with the video's progress.
export class HiddenChatFallback {
  // YouTube blanks the chat for about a second when entering or leaving
  // fullscreen; don't spin up an iframe for that.
  private static GRACE_PERIOD = 2000; // ms
  private static GIVE_UP_AFTER = 10000; // ms without finding a chat container.
  // A replay chat only advances when told where the video is, the same way
  // YouTube drives its own chat iframe.
  private static PROGRESS_INTERVAL = 300; // ms
  // A jump this large is a seek rather than playback.
  private static JUMP_THRESHOLD = 2; // seconds
  // After a seek the chat appends every message between the old and the new
  // position. Wait for it to go quiet before reading again.
  private static SETTLE_AFTER = 1500; // ms
  private static YOUTUBE_ORIGIN = "https://www.youtube.com";

  public static create(getVideoTime: () => number): HiddenChatFallback {
    return new HiddenChatFallback(
      document,
      window,
      window.location,
      () => Date.now(),
      buildHiddenChatUrl,
      getVideoTime,
    );
  }

  private videoId: string | undefined;
  private replayUrl: string | undefined;
  private unavailableSince: number | undefined;
  private failed = false;
  private frame: HTMLIFrameElement | undefined;
  private lastSeenAt = 0;
  private progressTimer: number | undefined;
  private lastProgress: number | undefined;
  private observer: MutationObserver | undefined;
  private observedContainer: Element | undefined;
  // Set while the chat is catching up with a seek; everything it appends in
  // the meantime is history.
  private catchingUp = false;
  private lastMessageAt = 0;

  public constructor(
    private document: Document,
    private window: TimerHost,
    private location: Pick<Location, "search" | "hostname">,
    private now: () => number,
    private buildUrl: (videoId: string, hostname: string) => string,
    private getVideoTime: () => number,
  ) {}

  // Returns the container to read chat from while YouTube's own is
  // unavailable, or null when it isn't needed or isn't ready.
  public query(
    nativeAvailable: boolean,
    nativeChatUrl?: string,
  ): HiddenChat | null {
    let videoId = new URLSearchParams(this.location.search).get("v");
    if (!videoId) {
      this.reset();
      return null;
    }

    // Everything below is about one video: a new one starts from scratch.
    if (videoId !== this.videoId) {
      this.reset();
      this.videoId = videoId;
    }

    // Has to be captured while the native chat is still up.
    if (nativeChatUrl && isReplayChatUrl(nativeChatUrl)) {
      this.replayUrl = nativeChatUrl;
    }

    if (nativeAvailable) {
      this.stop();
      return null;
    }

    let replay = !this.isLive();
    if (replay && !this.replayUrl) {
      this.stop();
      return null;
    }

    let now = this.now();
    this.unavailableSince ??= now;
    if (
      now - this.unavailableSince < HiddenChatFallback.GRACE_PERIOD ||
      this.failed
    ) {
      return null;
    }

    if (!this.frame) {
      this.create(videoId, now, replay ? this.replayUrl : undefined);
    }

    let container =
      this.frame.contentDocument?.querySelector("#chat #items") ?? null;
    if (!container) {
      if (now - this.lastSeenAt > HiddenChatFallback.GIVE_UP_AFTER) {
        this.failed = true;
        this.dispose();
      }
      return null;
    }

    this.observe(container);
    this.lastSeenAt = now;
    return { container, skipRebuilds: replay, isCatchingUp: this.isCatchingUp };
  }

  public reset(): void {
    this.stop();
    this.videoId = undefined;
    this.replayUrl = undefined;
  }

  private isLive(): boolean {
    return this.document.querySelector(".ytp-time-display.ytp-live") !== null;
  }

  private create(
    videoId: string,
    now: number,
    replayUrl: string | undefined,
  ): void {
    let frame = this.document.createElement("iframe");
    frame.setAttribute("data-danmage-hidden-chat", "");
    frame.setAttribute("aria-hidden", "true");
    frame.tabIndex = -1;
    frame.style.cssText =
      "position: fixed; left: -9999px; top: 0; width: 400px; height: 600px; border: 0; pointer-events: none;";
    frame.src = replayUrl ?? this.buildUrl(videoId, this.location.hostname);
    this.document.body.appendChild(frame);
    this.frame = frame;
    this.lastSeenAt = now;
    if (replayUrl) {
      // The frame loads the replay from wherever the continuation points and
      // is then told where the video is, so it appends everything in between
      // first.
      this.catchingUp = true;
      this.lastMessageAt = now;
      this.startProgress();
    }
  }

  private startProgress(): void {
    this.lastProgress = undefined;
    this.progressTimer = this.window.setInterval(() => {
      let progress = this.getVideoTime();
      // A paused video doesn't move the chat along, and YouTube's own iframe
      // isn't told anything either.
      if (progress === this.lastProgress) {
        return;
      }
      let jumped =
        this.lastProgress !== undefined &&
        Math.abs(progress - this.lastProgress) >
          HiddenChatFallback.JUMP_THRESHOLD;
      this.lastProgress = progress;
      this.frame?.contentWindow?.postMessage(
        { "yt-player-video-progress": progress },
        HiddenChatFallback.YOUTUBE_ORIGIN,
      );
      if (jumped) {
        this.catchingUp = true;
        this.lastMessageAt = this.now();
      }
    }, HiddenChatFallback.PROGRESS_INTERVAL);
  }

  private observe(container: Element): void {
    if (this.observedContainer === container) {
      return;
    }
    this.observer?.disconnect();
    this.observedContainer = container;
    // A container that only just appeared may still be filling, so the
    // catching-up window starts here rather than when the frame was created.
    this.lastMessageAt = this.now();
    this.observer = new MutationObserver(() => {
      this.lastMessageAt = this.now();
    });
    this.observer.observe(container, { childList: true });
  }

  // Asked on every read, because the chat appends the whole skipped range
  // within a frame or two of the seek.
  private isCatchingUp = (): boolean => {
    if (!this.catchingUp) {
      return false;
    }
    if (this.now() - this.lastMessageAt < HiddenChatFallback.SETTLE_AFTER) {
      return true;
    }
    this.catchingUp = false;
    return false;
  };

  private stop(): void {
    this.dispose();
    this.unavailableSince = undefined;
    this.failed = false;
  }

  private dispose(): void {
    if (this.progressTimer !== undefined) {
      this.window.clearInterval(this.progressTimer);
      this.progressTimer = undefined;
    }
    this.lastProgress = undefined;
    this.observer?.disconnect();
    this.observer = undefined;
    this.observedContainer = undefined;
    this.catchingUp = false;
    this.frame?.remove();
    this.frame = undefined;
  }
}
