import assert from 'node:assert/strict'
import test from 'node:test'
import { withGameFixture } from './support/game-fixture.js'

test('items can be queried by holder instead of using an inventory view', async () => {
  await withGameFixture(async ({ db }) => {
    const [{ carriedItemCount }] = await db.rows<{ carriedItemCount: number }>(`
      select count(*)::int as "carriedItemCount"
      from item.thing
      where holder_id = (select (creature.hero()).id)
    `)
    const [{ floorItemCount }] = await db.rows<{ floorItemCount: number }>(`
      select count(*)::int as "floorItemCount"
      from item.thing
      where holder_id is null
        and creature.in_sight(x, y)
    `)
    assert.equal(carriedItemCount, 3)
    assert.ok(floorItemCount > 0)
  })
})

test('inventory and floor-item convenience views are not exposed', async () => {
  await withGameFixture(async ({ db }) => {
    const views = await db.rows<{ schema: string; name: string }>(`
      select namespace.nspname as schema, relation.relname as name
      from pg_class relation
      join pg_namespace namespace on namespace.oid = relation.relnamespace
      where (namespace.nspname, relation.relname) in (('inventory', 'pack'), ('screen', 'floor_items'))
    `)
    assert.deepEqual(views, [])
  })
})

test('defeated monsters can drop loot on the cave floor', async () => {
  let monsterId = 0
  let monsterX = 0
  let monsterY = 0
  await withGameFixture(async ({ db, session }) => {
    const [{ itemCount: itemCountBefore }] = await db.rows<{ itemCount: number }>(`
      select count(*)::int as "itemCount" from item.thing
      where holder_id is null and (x, y) = (${monsterX}, ${monsterY})
        and creature.in_sight(x, y)
    `)

    await db.rows('select setseed(-0.2)')
    await session.executeCommand(() => db.rows(`
      select game.attack(
        (select item.id from item.thing item join item.kind kind using (kind)
         where item.holder_id = (select (creature.hero()).id) and item.kind = 'firebomb' limit 1),
        (select target.id from creature.thing target
         where target.id = ${monsterId} and creature.in_sight(target.x, target.y))
      )
    `))

    const [{ itemCount: itemCountAfter }] = await db.rows<{ itemCount: number }>(`
      select count(*)::int as "itemCount" from item.thing
      where holder_id is null and (x, y) = (${monsterX}, ${monsterY})
        and creature.in_sight(x, y)
    `)
    assert.ok(itemCountAfter > itemCountBefore)
  }, {
    setup: async (db) => {
      const [{ id: movedMonsterId, x, y }] = await db.rows<{ id: number; x: number; y: number }>(`
        select monster.id, cell.x, cell.y
        from creature.thing monster
        cross join creature.thing hero
        join map.cell cell
          on cell.walkable
         and abs(cell.x - hero.x) + abs(cell.y - hero.y) = 1
        where monster.kind <> 'hero'
          and hero.kind = 'hero'
          and not exists (
            select 1 from creature.thing occupant
            where (occupant.x, occupant.y) = (cell.x, cell.y)
          )
        order by monster.id
        limit 1
      `)
      monsterId = movedMonsterId
      monsterX = x
      monsterY = y
      await db.exec(`update creature.thing set (x, y, hp) = (${x}, ${y}, 1) where id = ${monsterId}`)
      await db.exec(`
        insert into item.thing (kind, holder_id)
        select 'firebomb', id from creature.thing where kind = 'hero'
      `)
    },
  })
})

test('picking up a nearby floor item moves it into the queryable inventory', async () => {
  await withGameFixture(async ({ db, session }) => {
    const [{ id: floorItemId }] = await db.rows<{ id: number }>(`
      select item.id
      from item.thing item
      cross join creature.hero() hero
      where item.kind = 'firebomb'
        and item.holder_id is null
        and creature.in_sight(item.x, item.y)
        and abs(item.x - hero.x) + abs(item.y - hero.y) <= 1
      limit 1
    `)
    await session.executeCommand(() => db.rows(`
      select game.pick_up(${floorItemId})
    `))

    const [itemEntity] = await db.rows<{ id: number; holder_id: number | null; x: number | null; y: number | null }>(`
      select id, holder_id, x, y from item.thing where id = ${floorItemId}
    `)
    const [{ id: heroId }] = await db.rows<{ id: number }>("select id from creature.thing where kind = 'hero'")
    assert.equal(itemEntity.id, floorItemId)
    assert.equal(itemEntity.holder_id, heroId)
    assert.equal(itemEntity.x, null)
    assert.equal(itemEntity.y, null)
  }, {
    setup: async (db) => {
      await db.exec(`
        insert into item.thing (kind, x, y)
        select 'firebomb', cell.x, cell.y
        from creature.thing hero
        join map.cell cell
          on cell.walkable
         and abs(cell.x - hero.x) + abs(cell.y - hero.y) = 1
        where hero.kind = 'hero'
          and not exists (
            select 1 from creature.thing occupant
            where (occupant.x, occupant.y) = (cell.x, cell.y)
          )
        limit 1
      `)
    },
  })
})

test('drinking a potion heals the hero and consumes that potion', async () => {
  await withGameFixture(async ({ db, session }) => {
    const [{ id: potionId }] = await db.rows<{ id: number }>(`
      select id from item.thing
      where kind = 'healing_potion'
        and holder_id = (select (creature.hero()).id)
      limit 1
    `)
    await session.executeCommand(() => db.rows(`select game.drink_potion(${potionId})`))

    const [{ hp }] = await db.rows<{ hp: number }>('select hp from screen.status')
    const remainingPotions = await db.rows<{ id: number }>(`select id from item.thing where id = ${potionId}`)
    assert.equal(hp, 22)
    assert.equal(remainingPotions.length, 0)
  }, {
    setup: async (db) => {
      await db.exec("delete from creature.thing where kind <> 'hero'")
      await db.exec("update creature.thing set hp = 10 where kind = 'hero'")
    },
  })
})
