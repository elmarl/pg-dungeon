import assert from "node:assert/strict";
import test from "node:test";

import { withGameFixture } from "./support/game-fixture.js";

test("a successful SQL movement command changes the game state", async () => {
  await withGameFixture(async ({ db, session }) => {
    const [{ x: heroX, y: heroY }] = await db.rows<{ x: number; y: number }>(
      "select x, y from creature.creatures where kind = 'hero'",
    );
    const [{ x: nextX, y: nextY }] = await db.rows<{ x: number; y: number }>(`
      select cell.x, cell.y
      from map.cell cell
      where cell.walkable
        and abs(cell.x - ${heroX}) + abs(cell.y - ${heroY}) = 1
        and not exists (
          select 1 from creature.creatures
          where (creature.creatures.x, creature.creatures.y) = (cell.x, cell.y)
        )
      limit 1
    `);
    const stepX = nextX - heroX;
    const stepY = nextY - heroY;

    await session.executeCommand(() =>
      db.rows(`select game.move(${stepX}, ${stepY})`),
    );

    const [{ turn }] = await db.rows<{ turn: number }>(
      "select turn from screen.status",
    );
    assert.equal(turn, 1);
  });
});

test("SQL movement rejects waiting and jumps", async () => {
  await withGameFixture(
    async ({ db, session }) => {
      const [{ x: initialX, y: initialY }] = await db.rows<{
        x: number;
        y: number;
      }>("select x, y from creature.creatures where kind = 'hero'");

      const [{ waited }] = await session.executeCommand(() =>
        db.rows<{ waited: boolean }>("select game.move(0, 0) as waited"),
      );
      assert.equal(waited, false, "waiting in place should be rejected");

      const [{ moved }] = await session.executeCommand(() =>
        db.rows<{ moved: boolean }>("select game.move(2, 0) as moved"),
      );
      const [{ x, y, turn }] = await db.rows<{
        x: number;
        y: number;
        turn: number;
      }>(`
        select hero.x, hero.y, status.turn
        from creature.creatures hero
        cross join screen.status status
        where hero.kind = 'hero'
      `);

      assert.equal(moved, false, "a two-cell move should be rejected");
      assert.deepEqual({ x, y }, { x: initialX, y: initialY });
      assert.equal(turn, 0, "a rejected move should not spend a turn");
    },
    {
      setup: async (db) => {
        await db.exec(`
          delete from creature.creatures where kind <> 'hero';
          insert into map.cell (x, y, walkable)
          select hero.x + 2, hero.y, true
          from creature.creatures hero
          where hero.kind = 'hero'
          on conflict (x, y) do update set walkable = excluded.walkable;
        `);
      },
    },
  );
});

test("a successful read-only SQL command does not create an undo turn", async () => {
  await withGameFixture(async ({ db, session }) => {
    await session.executeCommand(() => db.rows("select * from screen.status"));
    const [{ turn }] = await db.rows<{ turn: number }>(
      "select turn from screen.status",
    );
    assert.equal(turn, 0);
  });
});
