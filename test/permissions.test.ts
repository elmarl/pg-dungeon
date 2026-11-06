import assert from "node:assert/strict";
import test from "node:test";

import { withGameFixture } from "./support/game-fixture.js";

const forbiddenPlayerQueries = [
  "update creature.creatures set hp = 999",
  "select game.new_game()",
  "select creature.monsters_act()",
  "select * from creature.scent",
  "insert into map.cell values (0, 0, true)",
];

for (const sql of forbiddenPlayerQueries) {
  test(`player cannot execute: ${sql}`, async () => {
    await withGameFixture(async ({ db, session }) => {
      await assert.rejects(
        session.executeCommand(() => db.rows(sql)),
        /permission denied/,
      );
    });
  });
}

test("row-level security hides monsters outside the hero sight", async () => {
  await withGameFixture(async ({ db }) => {
    const [{ hidden }] = await db.rows<{ hidden: number }>(
      "select count(*)::int as hidden from creature.creatures where kind <> 'hero'",
    );
    assert.equal(hidden, 0);
  });
});

test("row-level security hides floor items outside the hero sight", async () => {
  let hiddenItemId = 0;
  await withGameFixture(
    async ({ db }) => {
      const hiddenItems = await db.rows<{ id: number }>(`
      select id
      from item.items
      where id = ${hiddenItemId}
    `);
      const [{ visibleFloorItemCount }] = await db.rows<{
        visibleFloorItemCount: number;
      }>(`
      select count(*)::int as "visibleFloorItemCount"
      from item.items
      where holder_id is null
    `);

      assert.deepEqual(hiddenItems, []);
      assert.ok(visibleFloorItemCount > 0);
    },
    {
      setup: async (db) => {
        const [{ id }] = await db.rows<{ id: number }>(`
        insert into item.items (kind, x, y)
        select 'firebomb', cell.x, cell.y
        from map.cell cell
        cross join creature.creatures hero
        join creature.species species using (kind)
        where hero.kind = 'hero'
          and cell.walkable
          and point(cell.x, cell.y) <-> hero.pos > species.sight
          and not exists (
            select 1 from creature.creatures creature
            where (creature.x, creature.y) = (cell.x, cell.y)
          )
          and not exists (
            select 1 from item.items item
            where item.holder_id is null
              and (item.x, item.y) = (cell.x, cell.y)
          )
        limit 1
        returning id
      `);
        hiddenItemId = id;
      },
    },
  );
});

test("starting loot spawns both within and outside the hero sight", async () => {
  let visibleLootCount = 0;
  let hiddenLootCount = 0;
  await withGameFixture(
    async ({ db }) => {
      const [{ visibleCount }] = await db.rows<{ visibleCount: number }>(`
      select count(*)::int as "visibleCount"
      from item.items
      where holder_id is null
    `);

      assert.ok(visibleLootCount > 0);
      assert.ok(hiddenLootCount > 0);
      assert.equal(visibleCount, visibleLootCount);
    },
    {
      setup: async (db) => {
        const [counts] = await db.rows<{
          visibleCount: number;
          hiddenCount: number;
        }>(`
        select count(*) filter (where creature.in_sight(item.x, item.y))::int as "visibleCount",
               count(*) filter (where not creature.in_sight(item.x, item.y))::int as "hiddenCount"
        from item.items item
        where item.holder_id is null
      `);
        visibleLootCount = counts.visibleCount;
        hiddenLootCount = counts.hiddenCount;
      },
    },
  );
});
