import { ChatEntry } from "../../../interface/chat_entry";
import { SwitchingChatPool } from "./chat_pool";
import { MockBlockPatternTester } from "./common/mocks";
import { TEST_RUNNER } from "@selfage/puppeteer_test_runner";
import { assertThat, eq, isArray } from "@selfage/test_matcher";

class Fixture {
  public time = 0;
  public current: Element | null = null;
  public pool = new SwitchingChatPool(
    () => this.current,
    new (class extends MockBlockPatternTester {
      public test() {
        return false;
      }
    })(),
    2000,
    () => this.time,
  );

  public createContainer(...messages: Array<string>): Element {
    let container = document.createElement("div");
    messages.forEach((message) => this.addMessage(container, message));
    return container;
  }

  public addMessage(container: Element, text: string): void {
    let message = document.createElement("div");
    message.innerHTML = text;
    container.appendChild(message);
  }
}

function contents(chatEntries: Array<ChatEntry>): Array<string> {
  return chatEntries.map((chatEntry) => chatEntry.content);
}

TEST_RUNNER.run({
  name: "SwitchingChatPoolTest",
  cases: [
    {
      name: "ReadsOnlyNewMessagesOfTheCurrentContainer",
      execute: () => {
        // Prepare
        let fixture = new Fixture();
        let container = fixture.createContainer("old");
        fixture.current = container;
        fixture.pool.start();
        fixture.time = 2500;
        fixture.addMessage(container, "new 1");

        // Execute
        let readed = fixture.pool.read();
        fixture.addMessage(container, "new 2");
        let readedAgain = fixture.pool.read();

        // Verify
        assertThat(contents(readed), isArray([eq("new 1")]), "read contents");
        assertThat(
          contents(readedAgain),
          isArray([eq("new 2")]),
          "read again contents",
        );
      },
    },
    {
      name: "SwitchesToANewContainerWithoutReplayingItsBacklog",
      execute: () => {
        // Prepare
        let fixture = new Fixture();
        let oldContainer = fixture.createContainer("old");
        fixture.current = oldContainer;
        fixture.pool.start();
        fixture.time = 3000;
        let newContainer = fixture.createContainer("backlog 1", "backlog 2");
        fixture.current = newContainer;

        // Execute
        let readedAtSwitch = fixture.pool.read();
        fixture.time = 5500;
        fixture.addMessage(oldContainer, "from old container");
        fixture.addMessage(newContainer, "live");
        let readedAfterWindow = fixture.pool.read();

        // Verify
        assertThat(contents(readedAtSwitch), isArray([]), "read at switch");
        assertThat(
          contents(readedAfterWindow),
          isArray([eq("live")]),
          "read after window",
        );
      },
    },
    {
      name: "ReadsNothingWhileThereIsNoContainerAndRecoversAfterwards",
      execute: () => {
        // Prepare
        let fixture = new Fixture();
        fixture.current = fixture.createContainer("old");
        fixture.pool.start();
        fixture.current = null;

        // Execute
        fixture.time = 1000;
        let readedWithoutContainer = fixture.pool.read();
        fixture.time = 3000;
        let container = fixture.createContainer("backlog");
        fixture.current = container;
        let readedAtRecovery = fixture.pool.read();
        fixture.time = 5500;
        fixture.addMessage(container, "live");
        let readedAfterWindow = fixture.pool.read();

        // Verify
        assertThat(
          contents(readedWithoutContainer),
          isArray([]),
          "read without container",
        );
        assertThat(contents(readedAtRecovery), isArray([]), "read at recovery");
        assertThat(
          contents(readedAfterWindow),
          isArray([eq("live")]),
          "read after window",
        );
      },
    },
    {
      name: "StartBeforeAnyContainerExistsThenPicksUpTheFirstOne",
      execute: () => {
        // Prepare
        let fixture = new Fixture();
        fixture.pool.start();
        fixture.time = 3000;
        let container = fixture.createContainer("backlog");
        fixture.current = container;
        fixture.pool.read();
        fixture.time = 5500;
        fixture.addMessage(container, "live");

        // Execute
        let readed = fixture.pool.read();

        // Verify
        assertThat(contents(readed), isArray([eq("live")]), "read contents");
      },
    },
  ],
});
