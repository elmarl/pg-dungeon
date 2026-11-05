import assert from "node:assert/strict";
import test from "node:test";
import type { DbRow, GameDatabase } from "../src/db.js";
import { mountConsole } from "../src/console/console.js";
import type { Session } from "../src/session.js";

type KeydownHandler = (event: KeyboardEvent) => void;
type ClickHandler = (event: MouseEvent) => void;

class FakeInput {
  value = "";
  selectionStart = 0;
  selectionEnd = 0;
  private keydownHandler?: KeydownHandler;

  addEventListener(type: string, listener: EventListener): void {
    if (type === "keydown") {
      this.keydownHandler = listener as KeydownHandler;
    }
  }

  setRangeText(
    replacement: string,
    start: number,
    end: number,
    selectionMode: "select" | "start" | "end" | "preserve",
  ): void {
    this.value = `${this.value.slice(0, start)}${replacement}${this.value.slice(
      end,
    )}`;
    if (selectionMode === "end") {
      this.selectionStart = this.selectionEnd = start + replacement.length;
    }
  }

  key(key: string, altKey = false): { defaultPrevented: boolean } {
    const event = {
      key,
      altKey,
      getModifierState: (modifier: string) => modifier === "Alt" && altKey,
      defaultPrevented: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
    };
    this.keydownHandler?.(event as KeyboardEvent);
    return event;
  }
}

class FakeOutput {
  innerHTML = "";
  private clickHandler?: ClickHandler;

  addEventListener(type: string, listener: EventListener): void {
    if (type === "click") {
      this.clickHandler = listener as ClickHandler;
    }
  }

  click(cmd?: string): { defaultPrevented: boolean } {
    const event = {
      target: cmd ? { dataset: { run: cmd } } : null,
      defaultPrevented: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
    };
    this.clickHandler?.(event as unknown as MouseEvent);
    return event;
  }
}

function createDatabase(
  rows: (sql: string) => DbRow[] | Promise<DbRow[]>,
): GameDatabase {
  return {
    exec: async () => undefined,
    query: async () => [],
    rows: async <TRow extends DbRow = DbRow>(sql: string) =>
      (await rows(sql)) as TRow[],
  };
}

function createSession(): Session {
  return {
    executeCommand: async (command) => command(),
    rewind: async () => undefined,
  };
}

function mount({
  input,
  output,
  db,
  session = createSession(),
  historyEntries = [],
}: {
  input: FakeInput;
  output: FakeOutput;
  db: GameDatabase;
  session?: Session;
  historyEntries?: Array<{ who: string; sql: string }>;
}) {
  const scheduled: Array<() => Promise<void>> = [];
  const history = {
    add: (who: string, sql: string) => historyEntries.push({ who, sql }),
  };
  const console = mountConsole({
    input: input as unknown as HTMLTextAreaElement,
    output: output as unknown as HTMLElement,
    db,
    session,
    history,
    schedule: (fn) => scheduled.push(fn),
  });

  return {
    console,
    historyEntries,
    async runScheduled() {
      while (scheduled.length) {
        await scheduled.shift()?.();
      }
    },
  };
}

test("console submits SQL and escapes returned values", async () => {
  const input = new FakeInput();
  const output = new FakeOutput();
  const mounted = mount({
    input,
    output,
    db: createDatabase(() => [{ value: "<img>" }]),
  });
  input.value = "select '<img>'";

  const event = input.key("Enter");
  assert.equal(event.defaultPrevented, true);
  assert.equal(input.value, "");
  await mounted.runScheduled();
  assert.deepEqual(mounted.historyEntries, [
    { who: "you", sql: "select '<img>'" },
  ]);

  assert.match(output.innerHTML, /&#60;img&#62;/);
  assert.doesNotMatch(output.innerHTML, /<img>/);
});

test("console refuses unsafe commands without executing them", async () => {
  const input = new FakeInput();
  const output = new FakeOutput();
  let queryCount = 0;
  const mounted = mount({
    input,
    output,
    db: createDatabase(() => {
      queryCount++;
      return [];
    }),
  });
  input.value = "select 1; rollback";
  input.key("Enter");
  await mounted.runScheduled();

  assert.match(output.innerHTML, /Refused by the page/);
  assert.equal(queryCount, 0);
});

test("console displays query errors as escaped text", async () => {
  const input = new FakeInput();
  const output = new FakeOutput();
  const mounted = mount({
    input,
    output,
    db: createDatabase(() => {
      throw new Error("<script>bad</script>");
    }),
  });
  input.value = "select broken";
  input.key("Enter");
  await mounted.runScheduled();

  assert.match(output.innerHTML, /&#60;script&#62;bad&#60;\/script&#62;/);
  assert.doesNotMatch(output.innerHTML, /<script>/);
});

test("console rewind invokes the session and prints the rewind status", async () => {
  const input = new FakeInput();
  const output = new FakeOutput();
  let rewindCount = 0;
  const mounted = mount({
    input,
    output,
    db: createDatabase(() => [{ turn: 2, rewinds: 1 }]),
    session: {
      executeCommand: async (command) => command(),
      rewind: async () => {
        rewindCount++;
      },
    },
  });
  input.value = "\\rewind";
  input.key("Enter");
  await mounted.runScheduled();

  assert.equal(rewindCount, 1);
  assert.match(output.innerHTML, /Rewind/);
  assert.match(output.innerHTML, />2</);
});

test("console supports multiline input and command history navigation", () => {
  const input = new FakeInput();
  const output = new FakeOutput();
  mount({
    input,
    output,
    db: createDatabase(() => []),
  });
  input.value = "select 1";
  input.selectionStart = input.selectionEnd = input.value.length;
  input.key("Enter", true);
  assert.equal(input.value, "select 1\n");

  input.value = "select 2";
  input.key("Enter");
  input.value = "draft";
  input.selectionStart = input.selectionEnd = input.value.length;
  input.key("ArrowUp");
  assert.equal(input.value, "select 2");
  input.key("ArrowDown");
  assert.equal(input.value, "");
});

test("console reports whether its input is focused", () => {
  const input = new FakeInput();
  const output = new FakeOutput();
  const mounted = mount({
    input,
    output,
    db: createDatabase(() => []),
  });
  const previousDocument = Object.getOwnPropertyDescriptor(
    globalThis,
    "document",
  );

  try {
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: { activeElement: input },
    });
    assert.equal(mounted.console.isTyping(), true);

    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: { activeElement: output },
    });
    assert.equal(mounted.console.isTyping(), false);
  } finally {
    if (previousDocument) {
      Object.defineProperty(globalThis, "document", previousDocument);
    } else {
      Reflect.deleteProperty(globalThis, "document");
    }
  }
});

test("console output links schedule the linked command", async () => {
  const input = new FakeInput();
  const output = new FakeOutput();
  const mounted = mount({
    input,
    output,
    db: createDatabase(() => [{ name: "game.move" }]),
  });
  const event = output.click("\\?");
  assert.equal(event.defaultPrevented, true);
  await mounted.runScheduled();

  assert.match(output.innerHTML, /Commands/);
});
