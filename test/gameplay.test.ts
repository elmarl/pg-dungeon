import assert from 'node:assert/strict'
import test from 'node:test'
import { withGameFixture } from './support/game-fixture.js'

test('rewinding restores the previous turn and increments the rewind counter', async () => {
  await withGameFixture(async ({ db, session }) => {
    await session.move(0, 0)
    const [{ turn: turnBeforeRewind }] = await db.rows<{ turn: number }>('select turn from screen.status')
    assert.equal(turnBeforeRewind, 1)

    await session.rewind()
    const [{ turn, rewinds }] = await db.rows<{ turn: number; rewinds: number }>('select turn, rewinds from screen.status')
    assert.equal(turn, 0)
    assert.equal(rewinds, 1)
  })
})

test('monsters eventually damage the hero during repeated turns', async () => {
  await withGameFixture(async ({ db, session }) => {
    const directions = [[1, 0], [0, 1], [-1, 0], [0, -1]] as const
    for (let turnIndex = 0; turnIndex < 300; turnIndex++) {
      const [dx, dy] = directions[(turnIndex * 7 + (turnIndex >> 3)) % directions.length]
      await session.move(dx, dy)
    }

    const [{ hp, turn }] = await db.rows<{ hp: number; turn: number }>('select hp, turn from screen.status')
    assert.ok(turn > 0, 'successful moves should advance the turn')
    assert.ok(hp < 30, 'monsters should find and damage the hero')
  })
})
