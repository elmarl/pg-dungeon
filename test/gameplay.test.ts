import assert from 'node:assert/strict'
import test from 'node:test'
import { withGameFixture } from './support/game-fixture.js'

test('rewinding restores the previous turn and increments the rewind counter', async () => {
  await withGameFixture(async ({ db, session }) => {
    await session.executeCommand(() => db.rows('select game.move(0, 0)'))
    const [{ turn: turnBeforeRewind }] = await db.rows<{ turn: number }>('select turn from screen.status')
    assert.equal(turnBeforeRewind, 1)

    await session.rewind()
    const [{ turn, rewinds }] = await db.rows<{ turn: number; rewinds: number }>('select turn, rewinds from screen.status')
    assert.equal(turn, 0)
    assert.equal(rewinds, 1)
  })
})

test('a monster attacks after the hero moves next to it', async () => {
  await withGameFixture(async ({ db, session }) => {
    const [{ hp: initialHp }] = await db.rows<{ hp: number }>('select hp from screen.status')
    const [{ heroX, heroY, monsterX, monsterY }] = await db.rows<{
      heroX: number
      heroY: number
      monsterX: number
      monsterY: number
    }>(`
      select hero.x as "heroX", hero.y as "heroY", monster.x as "monsterX", monster.y as "monsterY"
      from creature.thing hero
      join creature.thing monster
        on monster.id = (select id from creature.thing where kind <> 'hero' order by id limit 1)
      where abs(monster.x - hero.x) + abs(monster.y - hero.y) = 2
        and (monster.x = hero.x or monster.y = hero.y)
      limit 1
    `)
    const dx = Math.sign(monsterX - heroX)
    const dy = Math.sign(monsterY - heroY)
    await session.executeCommand(() => db.rows(`select game.move(${dx}, ${dy})`))
    const [{ hp: currentHp, turn }] = await db.rows<{ hp: number; turn: number }>('select hp, turn from screen.status')

    assert.equal(turn, 1, 'a successful action should spend one turn')
    assert.ok(currentHp < initialHp, 'the adjacent monster should attack the hero')
  }, {
    setup: async (db) => {
      await db.exec(`
        with candidate as (
          select monster.id, cell.x, cell.y
          from creature.thing hero
          join creature.thing monster
            on monster.id = (select id from creature.thing where kind <> 'hero' order by id limit 1)
          join map.cell cell
            on cell.walkable
           and abs(cell.x - hero.x) + abs(cell.y - hero.y) = 2
           and (cell.x = hero.x or cell.y = hero.y)
          where hero.kind = 'hero'
            and not exists (
              select 1 from creature.thing occupant
              where ((occupant.x, occupant.y) = (hero.x + sign(cell.x - hero.x), hero.y + sign(cell.y - hero.y))
                  or (occupant.x, occupant.y) = (cell.x, cell.y))
                and occupant.id <> monster.id
            )
          limit 1
        )
        update creature.thing monster
        set (x, y) = (candidate.x, candidate.y)
        from candidate
        where monster.id = candidate.id
      `)
    },
  })
})
