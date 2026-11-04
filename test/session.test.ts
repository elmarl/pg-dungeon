import assert from "node:assert/strict";
import test from "node:test";
import { withGameFixture } from "./support/game-fixture.js";

test("a failed console query leaves the game transaction usable", async () => {
  await withGameFixture(async ({ db, session }) => {
    await assert.rejects(
      session.executeCommand(() => db.rows("select 1 / 0")),
      /division by zero/,
    );
    const [{ value }] = await db.rows<{ value: number }>("select 1 as value");
    assert.equal(value, 1);
  });
});

test("a successful console action persists and creates an undo turn", async () => {
  await withGameFixture(async ({ db, session }) => {
    await session.executeCommand(() => db.rows("select game.move(0, 0)"));
    const [{ turn }] = await db.rows<{ turn: number }>(
      "select turn from screen.status",
    );
    assert.equal(turn, 1);
  });
});

test("a failed move rolls back to its turn savepoint", async () => {
  await withGameFixture(async ({ db, session }) => {
    await assert.rejects(
      session.executeCommand(() => db.rows("select game.move(v, 0)")),
      /column "v" does not exist/,
    );
    const [{ turn }] = await db.rows<{ turn: number }>(
      "select turn from screen.status",
    );
    assert.equal(turn, 0);
  });
});

test("a failed rewind leaves the game transaction usable", async () => {
  await withGameFixture(
    async ({ db, session }) => {
      await session.executeCommand(() => db.rows("select game.move(0, 0)"));
      await assert.rejects(session.rewind(), /division by zero/);
      const [{ turn }] = await db.rows<{ turn: number }>(
        "select turn from screen.status",
      );
      assert.equal(turn, 0);
    },
    {
      rewriteQuery: (sql) =>
        sql.includes("game.rewound()") ? "select 1 / 0" : sql,
    },
  );
});
