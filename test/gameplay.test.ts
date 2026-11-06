import assert from "node:assert/strict";
import test from "node:test";

import { moveHeroOneCell } from "./support/game-actions.js";
import { withGameFixture } from "./support/game-fixture.js";

test("rewinding restores the previous turn and increments the rewind counter", async () => {
  await withGameFixture(async ({ db, session }) => {
    await moveHeroOneCell(db, session);
    const [{ turn: turnBeforeRewind }] = await db.rows<{ turn: number }>(
      "select turn from screen.status",
    );
    assert.equal(turnBeforeRewind, 1);

    await session.rewind();
    const [{ turn, rewinds }] = await db.rows<{
      turn: number;
      rewinds: number;
    }>("select turn, rewinds from screen.status");
    assert.equal(turn, 0);
    assert.equal(rewinds, 1);
  });
});

test("a monster attacks after the hero moves next to it", async () => {
  await withGameFixture(
    async ({ db, session }) => {
      const [{ hp: initialHp }] = await db.rows<{ hp: number }>(
        "select hp from screen.status",
      );
      const [{ heroX, heroY, monsterX, monsterY }] = await db.rows<{
        heroX: number;
        heroY: number;
        monsterX: number;
        monsterY: number;
      }>(`
      select hero.x as "heroX", hero.y as "heroY", monster.x as "monsterX", monster.y as "monsterY"
      from creature.creatures hero
      join creature.creatures monster
        on monster.id = (select id from creature.creatures where kind <> 'hero' order by id limit 1)
      where abs(monster.x - hero.x) + abs(monster.y - hero.y) = 2
        and (monster.x = hero.x or monster.y = hero.y)
      limit 1
    `);
      const dx = Math.sign(monsterX - heroX);
      const dy = Math.sign(monsterY - heroY);
      await session.executeCommand(() =>
        db.rows(`select game.move(${dx}, ${dy})`),
      );
      const [{ hp: currentHp, turn }] = await db.rows<{
        hp: number;
        turn: number;
      }>("select hp, turn from screen.status");

      assert.equal(turn, 1, "a successful action should spend one turn");
      assert.ok(
        currentHp < initialHp,
        "the adjacent monster should attack the hero",
      );
    },
    {
      setup: async (db) => {
        await db.exec(`
        with candidate as (
          select monster.id, cell.x, cell.y
          from creature.creatures hero
          join creature.creatures monster
            on monster.id = (select id from creature.creatures where kind <> 'hero' order by id limit 1)
          join map.cell cell
            on cell.walkable
           and abs(cell.x - hero.x) + abs(cell.y - hero.y) = 2
           and (cell.x = hero.x or cell.y = hero.y)
          where hero.kind = 'hero'
            and not exists (
              select 1 from creature.creatures occupant
              where ((occupant.x, occupant.y) = (hero.x + sign(cell.x - hero.x), hero.y + sign(cell.y - hero.y))
                  or (occupant.x, occupant.y) = (cell.x, cell.y))
                and occupant.id <> monster.id
            )
          limit 1
        )
        update creature.creatures monster
        set (x, y) = (candidate.x, candidate.y)
        from candidate
        where monster.id = candidate.id
      `);
      },
    },
  );
});

test("monsters stop acting after the hero dies", async () => {
  await withGameFixture(
    async ({ db, session }) => {
      await session.executeCommand(() => db.rows("select game.move(0, 1)"));

      const [{ hitCount }] = await db.rows<{ hitCount: number }>(`
        select count(*)::int as "hitCount"
        from clock.log
        where msg like 'The % hits you for %.'
      `);
      assert.equal(hitCount, 1, "only the first monster should attack");
    },
    {
      setup: async (db) => {
        await db.exec(`
          delete from creature.creatures where kind <> 'hero';
          update creature.creatures set hp = 1 where kind = 'hero';

          insert into map.cell (x, y, walkable)
          select hero.x + positions.dx, hero.y + 1, true
          from creature.creatures hero
          cross join (values (-1), (0), (1)) as positions(dx)
          where hero.kind = 'hero'
          on conflict (x, y) do update set walkable = excluded.walkable;

          insert into creature.creatures (kind, hp, x, y)
          select 'ogre', 12, hero.x - 1, hero.y + 1
          from creature.creatures hero
          where hero.kind = 'hero';

          insert into creature.creatures (kind, hp, x, y)
          select 'rat', 4, hero.x + 1, hero.y + 1
          from creature.creatures hero
          where hero.kind = 'hero';
        `);
      },
    },
  );
});
