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
      try {
        const [{ spent }] = await db.query<{ spent: boolean }>(`select game.move(${dx}, ${dy}) as spent`)
        if (!spent) {
          await db.exec('release savepoint turn')
        }
      } catch (error) {
        return recoverFailedAction(db, 'turn', error)
      }
    },

    async rewind(): Promise<void> {
      await db.exec('savepoint rewind_check')
      let turn: number
      try {
        const [status] = await db.rows<{ turn: number }>('select turn from screen.status')
        turn = status.turn
        await db.exec('release savepoint rewind_check')
      } catch (error) {
        return recoverFailedAction(db, 'rewind_check', error)
      }

      if (turn === 0) {
        return
      }
      await db.exec('rollback to savepoint turn; release savepoint turn')
      await db.exec('savepoint rewind_action')
      try {
        await db.query('select game.rewound()')
      } catch (error) {
        return recoverFailedAction(db, 'rewind_action', error)
      }
    },

    async attempt<T>(fn: () => Promise<T>): Promise<T> {
      await db.exec('savepoint attempt')
      let result: T
      try {
        result = await fn()
      } catch (error) {
        return recoverFailedAction(db, 'attempt', error)
      }
      await rollbackAndRelease(db, 'attempt')
      return result
    },
  }
}

async function rollbackAndRelease(db: GameDatabase, savepoint: string): Promise<void> {
  await db.exec(`rollback to savepoint ${savepoint}; release savepoint ${savepoint}`)
}

async function recoverFailedAction(db: GameDatabase, savepoint: string, actionError: unknown): Promise<never> {
  try {
    await rollbackAndRelease(db, savepoint)
  } catch (recoveryError) {
    throw new AggregateError([actionError, recoveryError], `Action failed and savepoint ${savepoint} could not be restored`)
  }
  throw actionError
}
