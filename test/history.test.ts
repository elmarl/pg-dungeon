import assert from "node:assert/strict";
import test from "node:test";

import { createHistory } from "../src/console/history.js";

function createPanelElement(): { innerHTML: string } {
  return { innerHTML: "" };
}

test("history escapes SQL and displays the newest entries first", () => {
  const element = createPanelElement();
  const history = createHistory(element as unknown as HTMLElement);

  history.add("you", `select '<script>'`);
  history.add("game", "select 1");

  assert.equal(
    element.innerHTML,
    '<div class="game"><span>game</span>select 1</div><div class="you"><span>you</span>select \'&#60;script&#62;\'</div>',
  );
});

test("history keeps only the configured number of entries", () => {
  const element = createPanelElement();
  const history = createHistory(element as unknown as HTMLElement, 2);

  history.add("you", "first");
  history.add("you", "second");
  history.add("you", "third");

  assert.equal(
    element.innerHTML,
    '<div class="you"><span>you</span>third</div><div class="you"><span>you</span>second</div>',
  );
});
