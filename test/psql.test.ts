import assert from 'node:assert/strict'
import test from 'node:test'
import { runPsqlCommand } from '../src/console/psql.js'
import { withGameFixture } from './support/game-fixture.js'

const psqlCommands = [
  '\\?',
  '\\dn',
  '\\dt',
  '\\dt creature',
  '\\dt item',
  '\\dt map',
  '\\d creature.creatures',
  '\\d map.cell',
  '\\d screen.tiles',
  '\\d creature.scent',
  '\\df',
  '\\sf game.move',
]

for (const command of psqlCommands) {
  test(`${command} returns results`, async () => {
    await withGameFixture(async ({ db }) => {
      const results = await runPsqlCommand(db, command)
      assert.ok(results.length > 0)
      assert.ok(results.every((result) => result.rows.length > 0))
    })
  })
}

test('\\df lists game functions with descriptive names', async () => {
  await withGameFixture(async ({ db }) => {
    const [{ rows }] = await runPsqlCommand(db, '\\df')
    assert.ok(rows.some((row) => row.name === 'game.remember_seen_cells'))
  })
})

test('\\df explains how to pick up a visible item', async () => {
  await withGameFixture(async ({ db }) => {
    const [{ rows }] = await runPsqlCommand(db, '\\df')
    const pickUpFunction = rows.find((row) => row.name === 'game.pick_up')
    assert.match(String(pickUpFunction?.description), /item\.items.*holder_id is null/i)
  })
})

test('visible targets must be queried from creature entities, not a convenience view', async () => {
  await withGameFixture(async ({ db }) => {
    const targetViews = await db.rows<{ name: string }>(`
      select relation.relname as name
      from pg_class relation
      join pg_namespace namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'screen' and relation.relname = 'targets'
    `)
    assert.deepEqual(targetViews, [])

    const visibleTargets = await db.rows<{ id: number }>(`
      select target.id
      from creature.creatures target
      join creature.species species using (kind)
      where target.kind <> 'hero'
        and creature.in_sight(target.x, target.y)
      limit 1
    `)
    assert.ok(visibleTargets.length > 0)
  }, {
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
      `)
    },
  })
})

test('\\dn lists the item-entity schema', async () => {
  await withGameFixture(async ({ db }) => {
    const [{ rows }] = await runPsqlCommand(db, '\\dn')
    assert.ok(rows.some((row) => row.schema === 'item'))
  })
})

test('\\d exposes the player row-level security policy', async () => {
  await withGameFixture(async ({ db }) => {
    const results = await runPsqlCommand(db, '\\d creature.creatures')
    const policy = results.find((result) => result.title === 'Row-level security')
    assert.ok(policy)
    assert.match(String(policy.rows[0]['visible when']), /in_sight/)
  })
})
