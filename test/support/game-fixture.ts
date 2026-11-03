import { PGlite } from '@electric-sql/pglite'
import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { DbRow, GameDatabase } from '../../src/db.js'
import { startSession, type Session } from '../../src/session.js'

export interface GameFixture {
  database: PGlite
  db: GameDatabase
  session: Session
}

export interface GameFixtureOptions {
  rewriteQuery?: (sql: string) => string
}

export async function createGameFixture(options: GameFixtureOptions = {}): Promise<GameFixture> {
  const database = new PGlite()
  const sqlDirectory = fileURLToPath(new URL('../../src/sql/', import.meta.url))
  const sqlFiles = (await readdir(sqlDirectory)).sort()

  for (const sqlFile of sqlFiles) {
    const sql = await readFile(`${sqlDirectory}/${sqlFile}`, 'utf8')
    await database.exec(sql)
  }
  await database.query('select game.new_game(0.42)')

  const db: GameDatabase = {
    exec: async (sql: string) => database.exec(sql),
    query: async <TRow extends DbRow = DbRow>(sql: string) => {
      const rewrittenSql = options.rewriteQuery?.(sql) ?? sql
      return (await database.query(rewrittenSql)).rows as TRow[]
    },
    rows: async <TRow extends DbRow = DbRow>(sql: string, params?: unknown[]) => (await database.query(sql, params)).rows as TRow[],
  }

  const session = await startSession(db)
  return { database, db, session }
}

export async function withGameFixture<T>(run: (fixture: GameFixture) => Promise<T>, options: GameFixtureOptions = {}): Promise<T> {
  const fixture = await createGameFixture(options)
  try {
    return await run(fixture)
  } finally {
    await fixture.database.close()
  }
}
