import assert from 'node:assert/strict'
import test from 'node:test'
import { withGameFixture } from './support/game-fixture.js'

const forbiddenPlayerQueries = [
  'update creature.thing set hp = 999',
  'select game.new_game()',
  'select creature.monsters_act()',
  'select * from creature.scent',
  'insert into map.cell values (0, 0, true)',
]

for (const sql of forbiddenPlayerQueries) {
  test(`player cannot execute: ${sql}`, async () => {
    await withGameFixture(async ({ db, session }) => {
      await assert.rejects(session.executeCommand(() => db.rows(sql)), /permission denied/)
    })
  })
}

test('row-level security hides monsters outside the hero sight', async () => {
  await withGameFixture(async ({ db }) => {
    const [{ hidden }] = await db.rows<{ hidden: number }>("select count(*)::int as hidden from creature.thing where kind <> 'hero'")
    assert.equal(hidden, 0)
  })
})
