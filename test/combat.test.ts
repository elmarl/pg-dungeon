import assert from "node:assert/strict";
import test from "node:test";
import { withGameFixture } from "./support/game-fixture.js";

test("a player attack message identifies the weapon used", async () => {
  await withGameFixture(
    async ({ db, session }) => {
      const [{ id: ratId }] = await db.rows<{ id: number }>(`
        select id from creature.creatures where kind = 'rat' order by id limit 1
      `);

      await session.executeCommand(() =>
        db.rows(`
          select game.attack(
            (select id from item.items
             where holder_id = (select id from creature.creatures where kind = 'hero')
               and kind = 'sword' limit 1),
            ${ratId}
          )
        `),
      );

      const messages = await db.rows<{ msg: string }>(`
        select msg from clock.log where msg like 'You %'
      `);
      assert.ok(messages.some((message) => message.msg.includes("Cave sword")));
    },
    {
      setup: async (db) => {
        await db.exec(`
          update creature.creatures target
          set (x, y) = (
            select cell.x, cell.y
            from creature.creatures hero
            join map.cell cell
              on cell.walkable
             and abs(cell.x - hero.x) + abs(cell.y - hero.y) = 1
            where hero.kind = 'hero'
              and not exists (
                select 1 from creature.creatures occupant
                where (occupant.x, occupant.y) = (cell.x, cell.y)
              )
            limit 1
          )
          where target.id = (
            select id from creature.creatures where kind = 'rat' order by id limit 1
          )
        `);
      },
    },
  );
});

test("a sword attack damages one adjacent target selected by subquery", async () => {
  await withGameFixture(
    async ({ db, session }) => {
      const [{ id: ratId }] = await db.rows<{ id: number }>(`
      select target.id from creature.creatures target
      join creature.species species using (kind)
      where target.kind = 'rat' and creature.in_sight(target.x, target.y)
      limit 1
    `);
      const [{ hp: initialHp }] = await db.rows<{ hp: number }>(
        `select hp from creature.creatures where id = ${ratId}`,
      );

      await session.executeCommand(() =>
        db.rows(`
      select game.attack(
        (select item.id from item.items item
         where item.holder_id = (select id from creature.creatures where kind = 'hero')
           and item.kind = 'sword' limit 1),
        (select target.id from creature.creatures target
         where target.id = ${ratId} and creature.in_sight(target.x, target.y))
      )
    `),
      );

      const remainingRat = await db.rows<{ hp: number }>(
        `select hp from creature.creatures where id = ${ratId}`,
      );
      assert.ok(remainingRat.length === 0 || remainingRat[0].hp < initialHp);
    },
    {
      setup: async (db) => {
        await db.exec(`
        update creature.creatures target
        set (x, y) = (
          select cell.x, cell.y
          from creature.creatures hero
          join map.cell cell
            on cell.walkable
           and abs(cell.x - hero.x) + abs(cell.y - hero.y) = 1
          where hero.kind = 'hero'
            and not exists (
              select 1 from creature.creatures occupant
              where (occupant.x, occupant.y) = (cell.x, cell.y)
            )
          limit 1
        )
        where target.id = (select id from creature.creatures where kind = 'rat' order by id limit 1)
      `);
      },
    },
  );
});

test("a bow cannot attack a target outside its range", async () => {
  await withGameFixture(
    async ({ db, session }) => {
      await assert.rejects(
        session.executeCommand(() =>
          db.rows(`
      select game.attack(
        (select item.id from item.items item
         where item.holder_id = (select id from creature.creatures where kind = 'hero')
           and item.kind = 'shortbow' limit 1),
        (select target.id from creature.creatures target
         where target.kind = 'rat' and creature.in_sight(target.x, target.y) limit 1)
      )
    `),
        ),
        /out of range/,
      );
      const [{ turn }] = await db.rows<{ turn: number }>(
        "select turn from screen.status",
      );
      assert.equal(turn, 0);
    },
    {
      setup: async (db) => {
        await db.exec(`
        update map.cell set walkable = true
      `);
        await db.exec(`
        update creature.creatures target
        set (x, y) = (hero.x + 5, hero.y)
        from creature.creatures hero
        where hero.kind = 'hero'
          and target.id = (select id from creature.creatures where kind = 'rat' order by id limit 1)
      `);
      },
    },
  );
});

test("a firebomb damages multiple enemies around its selected target", async () => {
  await withGameFixture(
    async ({ db, session }) => {
      const [{ id: targetId }] = await db.rows<{ id: number }>(`
      select target.id from creature.creatures target
      join creature.species species using (kind)
      where target.kind = 'rat' and creature.in_sight(target.x, target.y)
      order by target.id limit 1
    `);

      await session.executeCommand(() =>
        db.rows(`
      select game.attack(
        (select item.id from item.items item
         where item.holder_id = (select id from creature.creatures where kind = 'hero')
           and item.kind = 'firebomb' limit 1),
        (select target.id from creature.creatures target
         where target.id = ${targetId} and creature.in_sight(target.x, target.y))
      )
    `),
      );

      const [{ damagedCount }] = await db.rows<{ damagedCount: number }>(`
      select count(*)::int as "damagedCount"
      from creature.creatures
      where kind = 'rat' and hp < 4
    `);
      assert.ok(damagedCount >= 2);
    },
    {
      setup: async (db) => {
        await db.exec(`
        insert into map.cell (x, y, walkable)
        select x, y, true
        from generate_series(1, 48) as x
        cross join generate_series(1, 22) as y
        on conflict (x, y) do update set walkable = excluded.walkable
      `);
        await db.exec(`
        with moved_monsters as (
          select id, row_number() over (order by id) as row_number
          from creature.creatures
          where kind <> 'hero'
        )
        update creature.creatures monster
        set (x, y) = (40, moved_monsters.row_number)
        from moved_monsters
        where monster.id = moved_monsters.id
      `);
        await db.exec(`
        with chosen_rats as (
          select id, row_number() over (order by id) as row_number
          from creature.creatures
          where kind = 'rat'
          order by id
          limit 2
        )
        update creature.creatures rat
        set (x, y) = (hero.x + 3, hero.y + chosen_rats.row_number - 1)
        from creature.creatures hero, chosen_rats
        where hero.kind = 'hero' and rat.id = chosen_rats.id
      `);
        await db.exec(`
        insert into item.items (kind, holder_id)
        select 'firebomb', id from creature.creatures where kind = 'hero'
      `);
      },
    },
  );
});
