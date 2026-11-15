import { YouTubeAssembler } from "./refresher";
import { TEST_RUNNER } from "@selfage/puppeteer_test_runner";
import { assertThat, eq } from "@selfage/test_matcher";

let ORIGINAL_URL = window.location.href;

function setUpPlayerPage(videoId: string): HTMLIFrameElement {
  history.replaceState(null, "", `?v=${videoId}`);
  document.body.innerHTML =
    `<div id="movie_player"><video></video>` +
    `<button class="ytp-settings-button"></button></div>` +
    `<div id="chat-container"></div>` +
    `<div id="panels-full-bleed-container"></div>` +
    `<iframe id="chatframe"></iframe>`;
  return document.getElementById("chatframe") as HTMLIFrameElement;
}

function rebuildChat(chatFrame: HTMLIFrameElement): void {
  chatFrame.contentDocument.body.innerHTML = `<div id="chat"><div id="items"></div></div>`;
}

function blankChat(chatFrame: HTMLIFrameElement): void {
  chatFrame.contentDocument.body.innerHTML = "";
}

function sameElements(left: Array<Element>, right: Array<Element>): boolean {
  return (
    left.length === right.length &&
    left.every((element, index) => element === right[index])
  );
}

function tearDown(): void {
  document.body.innerHTML = "";
  history.replaceState(null, "", ORIGINAL_URL);
}

TEST_RUNNER.run({
  name: "YouTubeAssemblerTest",
  cases: [
    {
      name: "RequiredElementsDoNotChangeWhenTheChatIsBlankedAndRebuilt",
      execute: () => {
        // Prepare
        let chatFrame = setUpPlayerPage("abc");
        let assembler = new YouTubeAssembler({});
        rebuildChat(chatFrame);
        let withChat = assembler.queryElements();

        // Execute
        blankChat(chatFrame);
        let blanked = assembler.queryElements();
        rebuildChat(chatFrame);
        let rebuilt = assembler.queryElements();

        // Verify
        assertThat(
          withChat.every((element) => !!element),
          eq(true),
          "all required elements exist",
        );
        assertThat(sameElements(withChat, blanked), eq(true), "blanked");
        assertThat(sameElements(withChat, rebuilt), eq(true), "rebuilt");
        tearDown();
      },
    },
    {
      name: "RequiredElementsChangeWhenNavigatingToAnotherVideo",
      execute: () => {
        // Prepare
        let chatFrame = setUpPlayerPage("abc");
        let assembler = new YouTubeAssembler({});
        rebuildChat(chatFrame);
        let before = assembler.queryElements();

        // Execute
        history.replaceState(null, "", "?v=def");
        let after = assembler.queryElements();
        let afterAgain = assembler.queryElements();

        // Verify
        assertThat(sameElements(before, after), eq(false), "after");
        assertThat(sameElements(after, afterAgain), eq(true), "after again");
        tearDown();
      },
    },
    {
      name: "AssemblesStructuredWhenThereIsNoChatFrame",
      execute: () => {
        // Prepare
        let chatFrame = setUpPlayerPage("abc");
        let assembler = new YouTubeAssembler({});
        let withChatFrame = assembler.queryElements();
        chatFrame.remove();

        // Execute
        let withoutChatFrame = assembler.queryElements();

        // Verify
        assertThat(withChatFrame.length, eq(6), "with chat frame");
        assertThat(withoutChatFrame.length, eq(3), "without chat frame");
        assertThat(
          assembler.assemble === assembler.assembleStructured,
          eq(true),
          "assembles structured",
        );
        tearDown();
      },
    },
  ],
});
