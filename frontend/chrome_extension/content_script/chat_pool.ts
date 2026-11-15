import { ChatEntry } from "../../../interface/chat_entry";
import { BlockPatternTester } from "./common/block_pattern_tester";

export interface ChatPool {
  fill: (chatEntries: Array<ChatEntry>) => void;
  clear: () => void;
  start: (timestamp: number) => void;
  read: (timestamp: number) => Array<ChatEntry>;
}

export class StructuredChatPool implements ChatPool {
  private static ANONYMOUS = "Anonymous";

  private lastTimestamp: number = 0; // ms
  private chatEntries = new Array<ChatEntry>();
  private lastIndex = 0;

  public constructor(private blockTester: BlockPatternTester) {}

  public fill(newChatEntries: Array<ChatEntry>): void {
    for (let newChatEntry of newChatEntries) {
      if (!newChatEntry.userNickname) {
        newChatEntry.userNickname = StructuredChatPool.ANONYMOUS;
      }
    }

    let rightChatEntries = newChatEntries.sort((l, r) => {
      return l.timestamp - r.timestamp;
    });
    let leftChatEntries = this.chatEntries;
    this.chatEntries = [];
    let leftPointer = 0;
    let rightPointer = 0;
    while (
      leftPointer < leftChatEntries.length &&
      rightPointer < rightChatEntries.length
    ) {
      let left = leftChatEntries[leftPointer];
      let right = rightChatEntries[rightPointer];
      if (left.timestamp <= right.timestamp) {
        this.chatEntries.push(left);
        leftPointer++;
      } else {
        this.chatEntries.push(right);
        rightPointer++;
      }
    }
    for (; leftPointer < leftChatEntries.length; leftPointer++) {
      this.chatEntries.push(leftChatEntries[leftPointer]);
    }
    for (; rightPointer < rightChatEntries.length; rightPointer++) {
      this.chatEntries.push(rightChatEntries[rightPointer]);
    }

    this.binarySearchReadPointer();
  }

  private binarySearchReadPointer(): void {
    let left = 0;
    let right = this.chatEntries.length;
    while (left < right) {
      let mid = Math.floor((left + right) / 2);
      let chatEntry = this.chatEntries[mid];
      if (chatEntry.timestamp < this.lastTimestamp) {
        left = mid + 1;
      } else {
        right = mid;
      }
    }
    this.lastIndex = left;
  }

  public clear(): void {
    this.chatEntries = [];
  }

  public start(destinationTimestamp: number /* ms */): void {
    this.lastTimestamp = destinationTimestamp;
    this.binarySearchReadPointer();
  }

  public read(currentTimestamp: number /* ms */): Array<ChatEntry> {
    let returnChatEntries = new Array<ChatEntry>();
    for (
      ;
      this.lastIndex < this.chatEntries.length &&
      this.chatEntries[this.lastIndex].timestamp < currentTimestamp;
      this.lastIndex++
    ) {
      let chatEntry = this.chatEntries[this.lastIndex];
      if (this.blockTester.test(chatEntry)) {
        continue;
      }
      returnChatEntries.push(chatEntry);
    }
    this.lastTimestamp = currentTimestamp;
    return returnChatEntries;
  }
}

// Reads from whichever chat container is current, so the container can come
// and go (YouTube blanks and rebuilds its chat iframe) without tearing down
// everything that depends on this pool.
export class SwitchingChatPool implements ChatPool {
  private container: Element | null = null;
  private pool: OnPageChatPool | undefined;

  public constructor(
    private getChatContainer: () => Element | null,
    private blockTester: BlockPatternTester,
    private backlogWindow: number,
    private now: () => number = () => Date.now(),
  ) {}

  public fill(): void {
    // Do nothing.
  }

  public clear(): void {
    // Do nothing.
  }

  public start(): void {
    this.syncContainer();
    this.pool?.start();
  }

  public read(): Array<ChatEntry> {
    this.syncContainer();
    return this.pool ? this.pool.read() : [];
  }

  private syncContainer(): void {
    let container = this.getChatContainer();
    if (container === this.container) {
      return;
    }
    this.container = container;
    this.pool?.dispose();
    this.pool = container
      ? new OnPageChatPool(
          container,
          this.blockTester,
          this.backlogWindow,
          this.now,
        )
      : undefined;
    this.pool?.start();
  }
}

export class OnPageChatPool implements ChatPool {
  private static TW_HIDE_CLASS = "tw-hide";

  private logElementPointer: Element;
  private createdAt: number;
  private observer: MutationObserver | undefined;

  // Chat that shows up within `backlogWindow` ms of creation is treated as
  // backlog and skipped. A freshly rendered container may be empty at first
  // and filled with the existing backlog a moment later, which must not be
  // played as new chat. Reads can stall (e.g. animation frames pause in a
  // background tab), so the skipping is driven by the container itself.
  public constructor(
    private chatContainer: Element,
    private blockTester: BlockPatternTester,
    private backlogWindow = 0, // ms
    private now: () => number = () => Date.now(),
  ) {
    this.createdAt = this.now();
    if (this.backlogWindow > 0) {
      this.observer = new MutationObserver(() => {
        if (this.isInBacklogWindow()) {
          this.skipToEnd();
        } else {
          this.dispose();
        }
      });
      this.observer.observe(this.chatContainer, { childList: true });
    }
  }

  public dispose(): void {
    this.observer?.disconnect();
    this.observer = undefined;
  }

  private isInBacklogWindow(): boolean {
    return this.now() - this.createdAt < this.backlogWindow;
  }

  private skipToEnd(): void {
    let lastElement = this.chatContainer.lastElementChild;
    if (lastElement) {
      this.logElementPointer = lastElement;
    }
  }

  public fill(): void {
    // Do nothing.
  }

  public clear(): void {
    // Do nothing.
  }

  public start(): void {
    this.logElementPointer = this.chatContainer.lastElementChild;
  }

  public read(): Array<ChatEntry> {
    if (this.isInBacklogWindow()) {
      this.skipToEnd();
      return [];
    }

    let nextLogElementPointer: Element;
    if (this.chatContainer.contains(this.logElementPointer)) {
      nextLogElementPointer = this.logElementPointer.nextElementSibling;
    } else {
      nextLogElementPointer = this.chatContainer.firstElementChild;
    }

    let returnChatEntries = new Array<ChatEntry>();
    for (
      ;
      nextLogElementPointer;
      this.logElementPointer = nextLogElementPointer,
        nextLogElementPointer = nextLogElementPointer.nextElementSibling
    ) {
      let htmlContent = nextLogElementPointer.innerHTML;
      // Silly twitch hidden emoticons. Stop and try from here next time.
      if (htmlContent.indexOf(OnPageChatPool.TW_HIDE_CLASS) !== -1) {
        break;
      }

      let chatEntry: ChatEntry = {
        content: htmlContent,
      };
      if (this.blockTester.test(chatEntry)) {
        continue;
      }

      returnChatEntries.push(chatEntry);
    }
    return returnChatEntries;
  }
}
