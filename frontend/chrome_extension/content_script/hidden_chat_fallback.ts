export function buildHiddenChatUrl(videoId: string, hostname: string): string {
  return `https://www.youtube.com/live_chat?v=${encodeURIComponent(videoId)}&embed_domain=${encodeURIComponent(hostname)}`;
}

// YouTube blanks its own chat iframe when the chat is collapsed. For a live
// stream, this loads the same chat in an invisible iframe of our own so the
// chat container can still be read.
export class HiddenChatFallback {
  // YouTube blanks the chat for about a second when entering or leaving
  // fullscreen; don't spin up an iframe for that.
  private static GRACE_PERIOD = 2000; // ms
  private static GIVE_UP_AFTER = 10000; // ms without finding a chat container.

  public static create(): HiddenChatFallback {
    return new HiddenChatFallback(
      document,
      window.location,
      () => Date.now(),
      buildHiddenChatUrl,
    );
  }

  private videoId: string | undefined;
  private unavailableSince: number | undefined;
  private failed = false;
  private frame: HTMLIFrameElement | undefined;
  private lastSeenAt = 0;

  public constructor(
    private document: Document,
    private location: Pick<Location, "search" | "hostname">,
    private now: () => number,
    private buildUrl: (videoId: string, hostname: string) => string,
  ) {}

  // Returns the container to read chat from while YouTube's own is
  // unavailable, or null when it isn't needed or isn't ready.
  public query(nativeAvailable: boolean): Element | null {
    let videoId = new URLSearchParams(this.location.search).get("v");
    if (nativeAvailable || !videoId || !this.isLive()) {
      this.reset();
      return null;
    }

    // Everything below is about one video: a new one starts from scratch.
    if (videoId !== this.videoId) {
      this.reset();
      this.videoId = videoId;
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
      this.create(videoId, now);
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

    this.lastSeenAt = now;
    return container;
  }

  public reset(): void {
    this.dispose();
    this.videoId = undefined;
    this.unavailableSince = undefined;
    this.failed = false;
  }

  private isLive(): boolean {
    return this.document.querySelector(".ytp-time-display.ytp-live") !== null;
  }

  private create(videoId: string, now: number): void {
    let frame = this.document.createElement("iframe");
    frame.setAttribute("data-danmage-hidden-chat", "");
    frame.setAttribute("aria-hidden", "true");
    frame.tabIndex = -1;
    frame.style.cssText =
      "position: fixed; left: -9999px; top: 0; width: 400px; height: 600px; border: 0; pointer-events: none;";
    frame.src = this.buildUrl(videoId, this.location.hostname);
    this.document.body.appendChild(frame);
    this.frame = frame;
    this.lastSeenAt = now;
  }

  private dispose(): void {
    this.frame?.remove();
    this.frame = undefined;
  }
}
