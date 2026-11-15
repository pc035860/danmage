import {
  HiddenChatFallback,
  TimerHost,
  buildHiddenChatUrl,
  isReplayChatUrl,
} from "./hidden_chat_fallback";
import { TEST_RUNNER } from "@selfage/puppeteer_test_runner";
import { assertThat, eq, isArray } from "@selfage/test_matcher";

const REPLAY_URL = "/live_chat_replay?continuation=xyz";

class FakeTimers implements TimerHost {
  private callbacks = new Map<number, () => void>();
  private nextId = 1;

  public setInterval(callback: () => void): number {
    let id = this.nextId++;
    this.callbacks.set(id, callback);
    return id;
  }

  public clearInterval(id: number): void {
    this.callbacks.delete(id);
  }

  public get count(): number {
    return this.callbacks.size;
  }

  public tick(): void {
    for (let callback of Array.from(this.callbacks.values())) {
      callback();
    }
  }
}

class Fixture {
  public time = 0;
  public videoTime = 0;
  public location = { search: "?v=abc", hostname: "www.youtube.com" };
  public urls = new Array<string>();
  public timers = new FakeTimers();
  public fallback = new HiddenChatFallback(
    document,
    this.timers,
    this.location,
    () => this.time,
    (videoId, hostname) => {
      this.urls.push(`${videoId}@${hostname}`);
      // Same-origin so that the test can fill in the chat itself.
      return "about:blank";
    },
    () => this.videoTime,
  );

  public constructor() {
    document.body.innerHTML = "";
  }

  public markLive(): void {
    let timeDisplay = document.createElement("div");
    timeDisplay.className = "ytp-time-display ytp-live";
    document.body.appendChild(timeDisplay);
  }

  public frame(): HTMLIFrameElement | null {
    return document.querySelector("iframe[data-danmage-hidden-chat]");
  }

  public appendMessages(messageCount: number): void {
    let chatDocument = this.frame().contentDocument;
    let items = chatDocument.querySelector("#chat #items");
    if (!items) {
      chatDocument.body.innerHTML = `<div id="chat"><div id="items"></div></div>`;
      items = chatDocument.querySelector("#chat #items");
    }
    for (let i = 0; i < messageCount; i++) {
      items.appendChild(chatDocument.createElement("div"));
    }
  }

  // Records what the fallback posts into the frame, which a real cross-origin
  // chat iframe would receive.
  public recordMessages(): Array<{ data: any; origin: string }> {
    let messages = new Array<{ data: any; origin: string }>();
    Object.defineProperty(this.frame(), "contentWindow", {
      value: {
        postMessage: (data: any, origin: string) => {
          messages.push({ data, origin });
        },
      },
    });
    return messages;
  }
}

// Lets MutationObserver callbacks run.
function nextTask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

TEST_RUNNER.run({
  name: "HiddenChatFallbackTest",
  cases: [
    {
      name: "BuildHiddenChatUrl",
      execute: () => {
        // Execute
        let url = buildHiddenChatUrl("abc", "www.youtube.com");

        // Verify
        assertThat(
          url,
          eq(
            "https://www.youtube.com/live_chat?v=abc&embed_domain=www.youtube.com",
          ),
          "url",
        );
      },
    },
    {
      name: "IsReplayChatUrl",
      execute: () => {
        // Execute
        let replay = isReplayChatUrl(
          "https://www.youtube.com/live_chat_replay?continuation=abc",
        );
        let live = isReplayChatUrl(
          "https://www.youtube.com/live_chat?v=abc&embed_domain=x",
        );
        let blank = isReplayChatUrl("about:blank");
        let missing = isReplayChatUrl(undefined);

        // Verify
        assertThat(replay, eq(true), "replay");
        assertThat(live, eq(false), "live");
        assertThat(blank, eq(false), "blank");
        assertThat(missing, eq(false), "missing");
      },
    },
    {
      name: "DoesNothingWhenNativeChatIsAvailable",
      execute: () => {
        // Prepare
        let fixture = new Fixture();
        fixture.markLive();

        // Execute
        let container = fixture.fallback.query(true);
        fixture.time = 10000;
        let laterContainer = fixture.fallback.query(true);

        // Verify
        assertThat(container, eq(null), "container");
        assertThat(laterContainer, eq(null), "later container");
        assertThat(fixture.frame(), eq(null), "frame");
      },
    },
    {
      name: "DoesNothingWhenNotLiveAndNoReplayUrlWasCaptured",
      execute: () => {
        // Prepare
        let fixture = new Fixture();

        // Execute
        fixture.fallback.query(false);
        fixture.time = 10000;
        let container = fixture.fallback.query(false);

        // Verify
        assertThat(container, eq(null), "container");
        assertThat(fixture.frame(), eq(null), "frame");
      },
    },
    {
      name: "WaitsForGracePeriodBeforeCreatingFrame",
      execute: () => {
        // Prepare
        let fixture = new Fixture();
        fixture.markLive();

        // Execute
        fixture.fallback.query(false);
        fixture.time = 1999;
        fixture.fallback.query(false);
        let frameBeforeGrace = fixture.frame();
        fixture.time = 2000;
        fixture.fallback.query(false);

        // Verify
        assertThat(frameBeforeGrace, eq(null), "frame before grace period");
        assertThat(fixture.frame() !== null, eq(true), "frame after");
        assertThat(fixture.urls, isArray([eq("abc@www.youtube.com")]), "urls");
      },
    },
    {
      name: "DoesNotCreateFrameWhenNativeChatReturnsWithinGracePeriod",
      execute: () => {
        // Prepare
        let fixture = new Fixture();
        fixture.markLive();

        // Execute
        fixture.fallback.query(false);
        fixture.time = 1000;
        fixture.fallback.query(true);
        fixture.time = 2500;
        fixture.fallback.query(false);

        // Verify
        assertThat(fixture.frame(), eq(null), "frame");
      },
    },
    {
      name: "ReturnsContainerOnceChatIsRendered",
      execute: () => {
        // Prepare
        let fixture = new Fixture();
        fixture.markLive();
        fixture.fallback.query(false);
        fixture.time = 2000;
        let containerBeforeRender = fixture.fallback.query(false);
        fixture.appendMessages(3);

        // Execute
        fixture.time = 2500;
        let hiddenChat = fixture.fallback.query(false);

        // Verify
        assertThat(containerBeforeRender, eq(null), "container before render");
        assertThat(hiddenChat.container.id, eq("items"), "container id");
        assertThat(hiddenChat.container.childElementCount, eq(3), "message count");
        assertThat(hiddenChat.skipRebuilds, eq(false), "skip rebuilds");
      },
    },
    {
      name: "RemovesFrameWhenNativeChatReturns",
      execute: () => {
        // Prepare
        let fixture = new Fixture();
        fixture.markLive();
        fixture.fallback.query(false);
        fixture.time = 2000;
        fixture.fallback.query(false);
        assertThat(fixture.frame() !== null, eq(true), "frame before");

        // Execute
        fixture.time = 3000;
        fixture.fallback.query(true);

        // Verify
        assertThat(fixture.frame(), eq(null), "frame");
      },
    },
    {
      name: "GivesUpWhenChatNeverLoadsAndRetriesAfterNativeChatReturns",
      execute: () => {
        // Prepare
        let fixture = new Fixture();
        fixture.markLive();
        fixture.fallback.query(false);
        fixture.time = 2000;
        fixture.fallback.query(false);

        // Execute
        fixture.time = 12001;
        fixture.fallback.query(false);
        let frameAfterGivingUp = fixture.frame();
        fixture.time = 20000;
        fixture.fallback.query(false);
        let frameWhileFailed = fixture.frame();
        fixture.fallback.query(true);
        fixture.time = 30000;
        fixture.fallback.query(false);
        fixture.time = 32000;
        fixture.fallback.query(false);

        // Verify
        assertThat(frameAfterGivingUp, eq(null), "frame after giving up");
        assertThat(frameWhileFailed, eq(null), "frame while failed");
        assertThat(fixture.frame() !== null, eq(true), "frame after retry");
        assertThat(fixture.urls.length, eq(2), "created frames");
      },
    },
    {
      name: "RecreatesFrameWhenVideoChanges",
      execute: () => {
        // Prepare
        let fixture = new Fixture();
        fixture.markLive();
        fixture.fallback.query(false);
        fixture.time = 2000;
        fixture.fallback.query(false);

        // Execute
        fixture.location.search = "?v=def";
        fixture.time = 2500;
        fixture.fallback.query(false);
        let frameRightAfterChange = fixture.frame();
        fixture.time = 4500;
        fixture.fallback.query(false);

        // Verify
        assertThat(
          frameRightAfterChange,
          eq(null),
          "frame right after the change",
        );
        assertThat(
          fixture.urls,
          isArray([eq("abc@www.youtube.com"), eq("def@www.youtube.com")]),
          "urls",
        );
        assertThat(
          document.querySelectorAll("iframe[data-danmage-hidden-chat]").length,
          eq(1),
          "frame count",
        );
      },
    },
    {
      name: "ForgetsAFailedVideoWhenAnotherVideoComesInBetween",
      execute: () => {
        // Prepare
        let fixture = new Fixture();
        fixture.markLive();
        fixture.fallback.query(false);
        fixture.time = 2000;
        fixture.fallback.query(false);
        fixture.time = 12001;
        fixture.fallback.query(false);
        fixture.location.search = "?v=def";
        fixture.time = 13000;
        fixture.fallback.query(false);
        fixture.time = 15000;
        fixture.fallback.query(false);
        let frameOfOtherVideo = fixture.frame();

        // Execute
        fixture.location.search = "?v=abc";
        fixture.time = 16000;
        fixture.fallback.query(false);
        let frameRightAfterReturning = fixture.frame();
        fixture.time = 18000;
        fixture.fallback.query(false);

        // Verify
        assertThat(
          frameOfOtherVideo !== null,
          eq(true),
          "frame of the other video",
        );
        assertThat(
          frameRightAfterReturning,
          eq(null),
          "frame right after returning",
        );
        assertThat(fixture.frame() !== null, eq(true), "frame after retry");
        assertThat(
          fixture.urls,
          isArray([
            eq("abc@www.youtube.com"),
            eq("def@www.youtube.com"),
            eq("abc@www.youtube.com"),
          ]),
          "urls",
        );
      },
    },
    {
      name: "LoadsTheCapturedReplayUrlWhenNotLive",
      execute: () => {
        // Prepare
        let fixture = new Fixture();
        fixture.fallback.query(true, REPLAY_URL);

        // Execute
        fixture.fallback.query(false);
        fixture.time = 2000;
        let hiddenChat = fixture.fallback.query(false);
        fixture.appendMessages(2);
        fixture.time = 2500;
        hiddenChat = fixture.fallback.query(false);

        // Verify
        assertThat(
          fixture.frame().src,
          eq(new URL(REPLAY_URL, location.href).href),
          "frame src",
        );
        assertThat(fixture.urls, isArray([]), "live urls");
        assertThat(hiddenChat.skipRebuilds, eq(true), "skip rebuilds");
        assertThat(hiddenChat.container.childElementCount, eq(2), "messages");
      },
    },
    {
      name: "PrefersTheLiveUrlOverACapturedReplayUrl",
      execute: () => {
        // Prepare
        let fixture = new Fixture();
        fixture.markLive();
        fixture.fallback.query(true, REPLAY_URL);

        // Execute
        fixture.fallback.query(false);
        fixture.time = 2000;
        fixture.fallback.query(false);

        // Verify
        assertThat(fixture.frame().src, eq("about:blank"), "frame src");
        assertThat(fixture.urls, isArray([eq("abc@www.youtube.com")]), "urls");
      },
    },
    {
      name: "ForgetsTheReplayUrlWhenVideoChanges",
      execute: () => {
        // Prepare
        let fixture = new Fixture();
        fixture.fallback.query(true, REPLAY_URL);

        // Execute
        fixture.location.search = "?v=def";
        fixture.fallback.query(false);
        fixture.time = 2000;
        let hiddenChat = fixture.fallback.query(false);

        // Verify
        assertThat(hiddenChat, eq(null), "hidden chat");
        assertThat(fixture.frame(), eq(null), "frame");
      },
    },
    {
      name: "SendsVideoProgressToTheReplayFrame",
      execute: () => {
        // Prepare
        let fixture = new Fixture();
        fixture.fallback.query(true, REPLAY_URL);
        fixture.fallback.query(false);
        fixture.time = 2000;
        fixture.fallback.query(false);
        let messages = fixture.recordMessages();

        // Execute
        fixture.videoTime = 12.5;
        fixture.timers.tick();
        fixture.videoTime = 12.8;
        fixture.timers.tick();

        // Verify
        assertThat(messages.length, eq(2), "message count");
        assertThat(
          messages[0].data["yt-player-video-progress"],
          eq(12.5),
          "first progress",
        );
        assertThat(
          messages[1].data["yt-player-video-progress"],
          eq(12.8),
          "second progress",
        );
        assertThat(
          messages[0].origin,
          eq("https://www.youtube.com"),
          "origin",
        );
      },
    },
    {
      name: "DoesNotRepeatTheSameProgress",
      execute: () => {
        // Prepare
        let fixture = new Fixture();
        fixture.fallback.query(true, REPLAY_URL);
        fixture.fallback.query(false);
        fixture.time = 2000;
        fixture.fallback.query(false);
        let messages = fixture.recordMessages();

        // Execute
        fixture.videoTime = 12.5;
        fixture.timers.tick();
        fixture.timers.tick();
        fixture.timers.tick();

        // Verify
        assertThat(messages.length, eq(1), "message count");
      },
    },
    {
      name: "StopsSendingProgressWhenNativeChatReturns",
      execute: () => {
        // Prepare
        let fixture = new Fixture();
        fixture.fallback.query(true, REPLAY_URL);
        fixture.fallback.query(false);
        fixture.time = 2000;
        fixture.fallback.query(false);
        let messages = fixture.recordMessages();

        // Execute
        fixture.fallback.query(true);
        fixture.videoTime = 12.5;
        fixture.timers.tick();

        // Verify
        assertThat(fixture.timers.count, eq(0), "timers");
        assertThat(messages.length, eq(0), "message count");
      },
    },
    {
      name: "DoesNotSendProgressForALiveChat",
      execute: () => {
        // Prepare
        let fixture = new Fixture();
        fixture.markLive();
        fixture.fallback.query(false);
        fixture.time = 2000;
        fixture.fallback.query(false);

        // Execute
        fixture.videoTime = 12.5;
        fixture.timers.tick();

        // Verify
        assertThat(fixture.timers.count, eq(0), "timers");
      },
    },
    {
      name: "ReportsCatchingUpAfterASeekUntilTheChatSettles",
      execute: async () => {
        // Prepare
        let fixture = new Fixture();
        fixture.fallback.query(true, REPLAY_URL);
        fixture.fallback.query(false);
        fixture.time = 2000;
        fixture.fallback.query(false);
        fixture.appendMessages(1);
        let hiddenChat = fixture.fallback.query(false);
        fixture.time = 4000;
        assertThat(hiddenChat.isCatchingUp(), eq(false), "before seek");

        // Execute
        fixture.videoTime = 10;
        fixture.timers.tick();
        fixture.videoTime = 200;
        fixture.timers.tick();
        fixture.appendMessages(30);
        await nextTask();
        fixture.time = 4500;
        let duringCatchUp = hiddenChat.isCatchingUp();
        fixture.time = 6500;
        let afterSettling = hiddenChat.isCatchingUp();

        // Verify
        assertThat(duringCatchUp, eq(true), "during catch up");
        assertThat(afterSettling, eq(false), "after settling");
      },
    },
    {
      name: "DoesNotReportCatchingUpDuringPlayback",
      execute: () => {
        // Prepare
        let fixture = new Fixture();
        fixture.fallback.query(true, REPLAY_URL);
        fixture.fallback.query(false);
        fixture.time = 2000;
        fixture.fallback.query(false);
        fixture.appendMessages(1);
        let hiddenChat = fixture.fallback.query(false);
        fixture.time = 4000;
        assertThat(hiddenChat.isCatchingUp(), eq(false), "before playback");

        // Execute
        fixture.videoTime = 10;
        fixture.timers.tick();
        fixture.videoTime = 10.3;
        fixture.timers.tick();
        fixture.appendMessages(1);
        fixture.time = 4500;
        let catchingUp = hiddenChat.isCatchingUp();

        // Verify
        assertThat(catchingUp, eq(false), "catching up");
      },
    },
    {
      name: "ReportsCatchingUpWhileTheReplayFrameFillsForTheFirstTime",
      execute: async () => {
        // Prepare
        let fixture = new Fixture();
        fixture.fallback.query(true, REPLAY_URL);
        fixture.fallback.query(false);
        fixture.time = 2000;
        fixture.fallback.query(false);
        fixture.appendMessages(1);
        let hiddenChat = fixture.fallback.query(false);

        // Execute
        let rightAfterCreation = hiddenChat.isCatchingUp();
        fixture.time = 3000;
        fixture.appendMessages(30);
        await nextTask();
        let duringFirstFill = hiddenChat.isCatchingUp();
        fixture.time = 5000;
        let afterSettling = hiddenChat.isCatchingUp();

        // Verify
        assertThat(rightAfterCreation, eq(true), "right after creation");
        assertThat(duringFirstFill, eq(true), "during first fill");
        assertThat(afterSettling, eq(false), "after settling");
      },
    },
    {
      name: "KeepsCatchingUpWhenTheContainerAppearsLate",
      execute: async () => {
        // Prepare
        let fixture = new Fixture();
        fixture.fallback.query(true, REPLAY_URL);
        fixture.fallback.query(false);
        fixture.time = 2000;
        fixture.fallback.query(false);
        fixture.time = 5000;
        let beforeContainer = fixture.fallback.query(false);
        assertThat(beforeContainer, eq(null), "container before it appears");

        // Execute
        fixture.appendMessages(1);
        let hiddenChat = fixture.fallback.query(false);
        let rightAfterAppearing = hiddenChat.isCatchingUp();
        fixture.time = 6000;
        fixture.appendMessages(30);
        await nextTask();
        let duringFill = hiddenChat.isCatchingUp();
        fixture.time = 8000;
        let afterSettling = hiddenChat.isCatchingUp();

        // Verify
        assertThat(rightAfterAppearing, eq(true), "right after appearing");
        assertThat(duringFill, eq(true), "during fill");
        assertThat(afterSettling, eq(false), "after settling");
      },
    },
  ],
});
