import { ChatEntry } from "../../../interface/chat_entry";
import { OnPageChatPool } from "./chat_pool";
import { MockBlockPatternTester } from "./common/mocks";
import { TEST_RUNNER } from "@selfage/puppeteer_test_runner";
import { assertThat, eq, isArray } from "@selfage/test_matcher";

class Fixture {
  public time = 0;
  public container = document.createElement("div");

  public constructor(private backlogWindow?: number) {}

  public createPool(): OnPageChatPool {
    let blockPatternTester = new (class extends MockBlockPatternTester {
      public test() {
        return false;
      }
    })();
    return new OnPageChatPool(
      this.container,
      blockPatternTester,
      this.backlogWindow,
      () => this.time,
    );
  }

  public addMessage(text: string): void {
    let message = document.createElement("div");
    message.innerHTML = text;
    this.container.appendChild(message);
  }
}

// Lets MutationObserver callbacks run.
function nextTask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function contents(chatEntries: Array<ChatEntry>): Array<string> {
  return chatEntries.map((chatEntry) => chatEntry.content);
}

TEST_RUNNER.run({
  name: "OnPageChatPoolTest",
  cases: [
    {
      name: "ReadsOnlyMessagesAddedAfterStart",
      execute: () => {
        // Prepare
        let fixture = new Fixture();
        fixture.addMessage("old");
        let chatPool = fixture.createPool();
        chatPool.start();
        fixture.addMessage("new");

        // Execute
        let readed = chatPool.read();

        // Verify
        assertThat(contents(readed), isArray([eq("new")]), "read contents");
      },
    },
    {
      name: "SkipsBacklogThatFillsAnEmptyContainerWithinWindow",
      execute: () => {
        // Prepare
        let fixture = new Fixture(2000);
        let chatPool = fixture.createPool();
        chatPool.start();

        // Execute
        fixture.time = 300;
        let readedBeforeBacklog = chatPool.read();
        fixture.addMessage("backlog 1");
        fixture.addMessage("backlog 2");
        fixture.time = 800;
        let readedWithBacklog = chatPool.read();

        // Verify
        assertThat(
          contents(readedBeforeBacklog),
          isArray([]),
          "read before backlog",
        );
        assertThat(contents(readedWithBacklog), isArray([]), "read backlog");
      },
    },
    {
      name: "SkipsBacklogThatKeepsArrivingWithinWindow",
      execute: () => {
        // Prepare
        let fixture = new Fixture(2000);
        fixture.addMessage("backlog 1");
        let chatPool = fixture.createPool();
        chatPool.start();

        // Execute
        fixture.time = 500;
        fixture.addMessage("backlog 2");
        let readedFirst = chatPool.read();
        fixture.time = 1500;
        fixture.addMessage("backlog 3");
        let readedSecond = chatPool.read();

        // Verify
        assertThat(contents(readedFirst), isArray([]), "first read");
        assertThat(contents(readedSecond), isArray([]), "second read");
      },
    },
    {
      name: "SkipsBacklogEvenWhenNothingIsReadDuringWindow",
      execute: async () => {
        // Prepare
        let fixture = new Fixture(2000);
        let chatPool = fixture.createPool();
        chatPool.start();

        // Execute
        fixture.time = 500;
        fixture.addMessage("backlog 1");
        fixture.addMessage("backlog 2");
        await nextTask();
        fixture.time = 2500;
        let readedBacklog = chatPool.read();
        fixture.addMessage("live");
        await nextTask();
        let readedLive = chatPool.read();

        // Verify
        assertThat(contents(readedBacklog), isArray([]), "read backlog");
        assertThat(
          contents(readedLive),
          isArray([eq("live")]),
          "read live contents",
        );
      },
    },
    {
      name: "ReadsMessagesArrivingAfterWindow",
      execute: () => {
        // Prepare
        let fixture = new Fixture(2000);
        let chatPool = fixture.createPool();
        chatPool.start();
        fixture.addMessage("backlog");
        fixture.time = 1000;
        chatPool.read();

        // Execute
        fixture.time = 2500;
        fixture.addMessage("live 1");
        fixture.addMessage("live 2");
        let readed = chatPool.read();
        fixture.addMessage("live 3");
        let readedAgain = chatPool.read();

        // Verify
        assertThat(
          contents(readed),
          isArray([eq("live 1"), eq("live 2")]),
          "read contents",
        );
        assertThat(
          contents(readedAgain),
          isArray([eq("live 3")]),
          "read again contents",
        );
      },
    },
    {
      name: "ReadsFromTheFirstMessageWhenContainerWasEmptyThroughoutWindow",
      execute: () => {
        // Prepare
        let fixture = new Fixture(2000);
        let chatPool = fixture.createPool();
        chatPool.start();
        fixture.time = 1000;
        chatPool.read();

        // Execute
        fixture.time = 2500;
        fixture.addMessage("first");
        let readed = chatPool.read();

        // Verify
        assertThat(contents(readed), isArray([eq("first")]), "read contents");
      },
    },
    {
      name: "WithoutWindowReadsEverythingAfterAnEmptyStart",
      execute: () => {
        // Prepare
        let fixture = new Fixture();
        let chatPool = fixture.createPool();
        chatPool.start();
        fixture.addMessage("first");

        // Execute
        let readed = chatPool.read();

        // Verify
        assertThat(contents(readed), isArray([eq("first")]), "read contents");
      },
    },
  ],
});
