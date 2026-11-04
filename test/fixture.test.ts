import assert from "node:assert/strict";
import test from "node:test";
import { withGameFixture } from "./support/game-fixture.js";

test("each game fixture starts from an independent game database", async () => {
  await withGameFixture(async () => {}, {
    setup: async (db) => {
      await db.exec("update creature.creatures set hp = 1 where kind = 'hero'");
    },
  });

  await withGameFixture(async ({ db }) => {
    const [{ hp }] = await db.rows<{ hp: number }>(
      "select hp from screen.status",
    );
    assert.equal(hp, 30);
  });
});
