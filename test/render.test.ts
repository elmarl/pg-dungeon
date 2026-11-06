import assert from "node:assert/strict";
import test from "node:test";

import type { DbRow, GameDatabase } from "../src/db.js";
import { render } from "../src/render.js";

function createElement(): { innerHTML: string; textContent: string | null } {
  return { innerHTML: "", textContent: "" };
}

function createDatabase(rowsFor: (sql: string) => DbRow[]): GameDatabase {
  return {
    exec: async () => undefined,
    query: async () => [],
    rows: async <TRow extends DbRow = DbRow>(sql: string) =>
      rowsFor(sql) as TRow[],
  };
}

test("render prints the map, status, and escaped messages", async () => {
  const elements = new Map(
    ["map", "hud", "log"].map((id) => [id, createElement()]),
  );
  const db = createDatabase((sql) => {
    if (sql.includes("screen.status")) {
      return [{ height: 2, width: 3, hp: 18, turn: 4, rewinds: 1 }];
    }
    if (sql.includes("screen.tiles")) {
      return [
        { x: 1, y: 0, style: "hero", glyph: "@" },
        { x: 2, y: 1, style: "item", glyph: "<" },
      ];
    }
    return [{ msg: `<script>alert("x")</script>` }, { msg: "Safe" }];
  });

  await render(
    db,
    (id) => (elements.get(id) as HTMLElement | undefined) ?? null,
  );

  assert.equal(
    elements.get("map")?.innerHTML,
    ' <span class="hero">@</span> \n  <span class="item">&#60;</span>',
  );
  assert.equal(elements.get("hud")?.textContent, "HP 18   turn 4   rewinds 1");
  assert.equal(
    elements.get("log")?.innerHTML,
    '<div style="opacity:1">&#60;script&#62;alert(&#34;x&#34;)&#60;/script&#62;</div><div style="opacity:0.85">Safe</div>',
  );
});

test("render returns without querying the database if an element is missing", async () => {
  let queried = false;
  const db = createDatabase(() => {
    queried = true;
    return [];
  });
  const elements = new Map([
    ["map", createElement()],
    ["hud", createElement()],
  ]);

  await render(
    db,
    (id) => (elements.get(id) as HTMLElement | undefined) ?? null,
  );

  assert.equal(queried, false);
});
