import { HiddenChatFallback, buildHiddenChatUrl } from "./hidden_chat_fallback";
import { TEST_RUNNER } from "@selfage/puppeteer_test_runner";
import { assertThat, eq, isArray } from "@selfage/test_matcher";

class Fixture {
  public time = 0;
  public location = { search: "?v=abc", hostname: "www.youtube.com" };
  public urls = new Array<string>();
  public fallback = new HiddenChatFallback(
    document,
    this.location,
    () => this.time,
    (videoId, hostname) => {
      this.urls.push(`${videoId}@${hostname}`);
      // Same-origin so that the test can fill in the chat itself.
      return "about:blank";
    },
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

  public fillChat(messageCount: number): void {
    let chatDocument = this.frame().contentDocument;
    chatDocument.body.innerHTML = `<div id="chat"><div id="items">${"<div>message</div>".repeat(messageCount)}</div></div>`;
  }
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
      name: "DoesNothingWhenNotLive",
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
        fixture.fillChat(3);

        // Execute
        fixture.time = 2500;
        let container = fixture.fallback.query(false);

        // Verify
        assertThat(containerBeforeRender, eq(null), "container before render");
        assertThat(container.id, eq("items"), "container id");
        assertThat(container.childElementCount, eq(3), "message count");
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
  ],
});
