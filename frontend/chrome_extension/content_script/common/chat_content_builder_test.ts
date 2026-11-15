import { TwitchChatContentBuilder } from "./chat_content_builder";
import { TEST_RUNNER } from "@selfage/puppeteer_test_runner";
import { assertThat, eq } from "@selfage/test_matcher";

let TWITCH_CHAT_HTML =
  `<div class="chat-line__message"><div class="chat-line__message-container">` +
  `<span class="chat-line__timestamp" data-a-target="chat-timestamp">8:21</span>` +
  `<span class="chat-author__display-name">viewer</span>` +
  `<span aria-hidden="true">: </span>` +
  `<span class="text-fragment">hello</span>` +
  `</div></div>`;

function hasTimestamp(html: string): boolean {
  let template = document.createElement("template");
  template.innerHTML = html;
  return template.content.querySelector(".chat-line__timestamp") !== null;
}

TEST_RUNNER.run({
  name: "TwitchChatContentBuilderTest",
  cases: [
    {
      name: "BuildRemovesTimestampWhenHidden",
      execute: () => {
        // Prepare
        let builder = new TwitchChatContentBuilder();

        // Execute
        let html = builder.build(
          { content: TWITCH_CHAT_HTML },
          { showUserName: true, showTimestamp: false },
        );

        // Verify
        assertThat(hasTimestamp(html), eq(false), "has timestamp");
        assertThat(html.includes("hello"), eq(true), "keeps message text");
        assertThat(html.includes("viewer"), eq(true), "keeps user name");
      },
    },
    {
      name: "BuildKeepsTimestampWhenShown",
      execute: () => {
        // Prepare
        let builder = new TwitchChatContentBuilder();

        // Execute
        let html = builder.build(
          { content: TWITCH_CHAT_HTML },
          { showUserName: true, showTimestamp: true },
        );

        // Verify
        assertThat(hasTimestamp(html), eq(true), "has timestamp");
      },
    },
    {
      name: "ExtractContentAlwaysRemovesTimestamp",
      execute: () => {
        // Prepare
        let builder = new TwitchChatContentBuilder();

        // Execute
        let html = builder.extractContent(TWITCH_CHAT_HTML);

        // Verify
        assertThat(hasTimestamp(html), eq(false), "has timestamp");
        assertThat(html.includes("hello"), eq(true), "keeps message text");
      },
    },
  ],
});
