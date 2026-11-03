import type { GameDatabase } from './db.js'

export interface Session {
  move(dx: number, dy: number): Promise<void>
  rewind(): Promise<void>
  attempt<T>(fn: () => Promise<T>): Promise<T>
}

export async function startSession(db: GameDatabase): Promise<Session> {
  await db.exec('begin; set role player')

  return {
    async move(dx: number, dy: number): Promise<void> {
      await db.exec('savepoint turn')
      const [{ spent }] = await db.query<{ spent: boolean }>(`select game.move(${dx}, ${dy}) as spent`)
      if (!spent) {
        await db.exec('release savepoint turn')
      }
    },

    async rewind(): Promise<void> {
      const [{ turn }] = await db.rows<{ turn: number }>('select turn from screen.status')
      if (turn === 0) {
        return
      }
      await db.exec('rollback to savepoint turn; release savepoint turn')
      await db.query('select game.rewound()')
    },

    async attempt<T>(fn: () => Promise<T>): Promise<T> {
      await db.exec('savepoint attempt')
      try {
        return await fn()
      } finally {
        await db.exec('rollback to savepoint attempt; release savepoint attempt')
      }
    },
  }
}
