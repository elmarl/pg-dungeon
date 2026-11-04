import assert from 'node:assert/strict'
import test from 'node:test'
import { withGameFixture } from './support/game-fixture.js'

test('a successful SQL movement command changes the game state', async () => {
  await withGameFixture(async ({ db, session }) => {
    const [{ x: heroX, y: heroY }] = await db.rows<{ x: number; y: number }>("select x, y from creature.thing where kind = 'hero'")
    const [{ x: nextX, y: nextY }] = await db.rows<{ x: number; y: number }>(`
      select cell.x, cell.y
      from map.cell cell
      where cell.walkable
        and abs(cell.x - ${heroX}) + abs(cell.y - ${heroY}) = 1
        and not exists (
          select 1 from creature.thing
          where (creature.thing.x, creature.thing.y) = (cell.x, cell.y)
        )
      limit 1
    `)
    const stepX = nextX - heroX
    const stepY = nextY - heroY

    await session.executeCommand(() => db.rows(`select game.move(${stepX}, ${stepY})`))

    const [{ turn }] = await db.rows<{ turn: number }>('select turn from screen.status')
    assert.equal(turn, 1)
  })
})

test('a successful read-only SQL command does not create an undo turn', async () => {
  await withGameFixture(async ({ db, session }) => {
    await session.executeCommand(() => db.rows('select * from screen.status'))
    const [{ turn }] = await db.rows<{ turn: number }>('select turn from screen.status')
    assert.equal(turn, 0)
  })
})
