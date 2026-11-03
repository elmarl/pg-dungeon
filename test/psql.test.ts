import assert from 'node:assert/strict'
import test from 'node:test'
import { runPsqlCommand } from '../src/console/psql.js'
import { withGameFixture } from './support/game-fixture.js'

const psqlCommands = [
  '\\?',
  '\\dn',
  '\\dt',
  '\\dt creature',
  '\\d creature.thing',
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

test('\\d exposes the player row-level security policy', async () => {
  await withGameFixture(async ({ db }) => {
    const results = await runPsqlCommand(db, '\\d creature.thing')
    const policy = results.find((result) => result.title === 'Row-level security')
    assert.ok(policy)
    assert.match(String(policy.rows[0]['visible when']), /in_sight/)
  })
})
