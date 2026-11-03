// Plays 300 turns as the player role, tries to cheat, and checks that rewinding restores time.
import { PGlite } from '@electric-sql/pglite'
import { readFileSync, readdirSync } from 'node:fs'
import assert from 'node:assert/strict'
import type { GameDatabase } from './src/db.js'
import { meta } from './src/console/psql.js'

const db = new PGlite()
for (const fileName of readdirSync('src/sql').sort()) {
  await db.exec(readFileSync(`src/sql/${fileName}`, 'utf8'))
}
await db.query('select game.new_game(0.42)')
await db.exec('begin; set role player')

const one = async <T extends Record<string, unknown>>(sql: string): Promise<T> => (await db.query(sql)).rows[0] as T

for (const cheat of [
  'update creature.thing set hp = 999',
  'select game.new_game()',
  'select creature.monsters_act()',
  'select * from creature.scent',
  'insert into map.cell values (0, 0, true)',
]) {
  await db.exec('savepoint cheat')
  await assert.rejects(db.query(cheat), /permission denied/, cheat)
  await db.exec('rollback to savepoint cheat; release savepoint cheat')
}
console.log('5 cheats refused')

const { n: hidden } = await one<{ n: number }>("select count(*)::int as n from creature.thing where kind <> 'hero'")
assert.equal(hidden, 0, 'monsters start out of sight')

const dirs = [[1, 0], [0, 1], [-1, 0], [0, -1]]
for (let turnIndex = 0; turnIndex < 300; turnIndex++) {
  const [dx, dy] = dirs[(turnIndex * 7 + (turnIndex >> 3)) % 4]
  await db.exec('savepoint turn')
  const { spent } = await one<{ spent: boolean }>(`select game.move(${dx}, ${dy}) as spent`)
  if (!spent) {
    await db.exec('release savepoint turn')
  }
}

const before = await one<Record<string, unknown>>('select * from screen.status')
assert.ok(Number(before.turn) > 0, 'some turns were spent')
assert.ok(Number(before.hp) < 30, 'monsters found the hero')

await db.exec('rollback to savepoint turn; release savepoint turn')
await db.query('select game.rewound()')
const after = await one<Record<string, unknown>>('select * from screen.status')
assert.equal(Number(after.turn), Number(before.turn) - 1, 'rewind restores the turn counter')
assert.equal(Number(after.rewinds), 1, 'the rewind counter survives the rollback')

const tiles = (await db.query('select * from screen.tiles')).rows as Array<{ style: string }>
assert.equal(tiles.filter((tile) => tile.style === 'hero').length, 1, 'exactly one hero on screen')

const rows: GameDatabase['rows'] = async (sql, params) => (await db.query(sql, params)).rows as any[]
for (const cmd of ['\\?', '\\dn', '\\dt', '\\dt creature', '\\d creature.thing', '\\d map.cell', '\\d screen.tiles', '\\d creature.scent', '\\df', '\\sf game.move']) {
  const results = (await meta({ rows }, cmd)) as Array<{ rows: Array<Record<string, unknown>> }>
  assert.ok(results.every((result) => result.rows.length), `${cmd} returns rows`)
}
const fog = ((await meta({ rows }, '\\d creature.thing')) as Array<{ title: string; rows: Array<Record<string, unknown>> }>).find((result) => result.title === 'Row-level security')!
assert.match(String((fog.rows[0] as Record<string, unknown>)['visible when']), /in_sight/, 'player can read the fog policy')
console.log('10 psql commands work as player')

console.log({ before, after, tiles: tiles.length })
const messages = (await db.query('select msg from screen.messages')).rows as Array<{ msg: string }>
console.log(messages.map((message) => message.msg))
