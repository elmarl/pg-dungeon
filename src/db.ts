import { PGlite } from '@electric-sql/pglite'

export interface History {
  add(who: string, sql: string): void
}

export type DbRow = Record<string, unknown>

export interface GameDatabase {
  exec(sql: string, who?: string): Promise<unknown>
  query<T extends DbRow = DbRow>(sql: string, who?: string): Promise<T[]>
  rows<T extends DbRow = DbRow>(sql: string, params?: unknown[]): Promise<T[]>
}

const schemaFiles: Record<string, string> = import.meta.glob('./sql/*.sql', {
  query: '?raw',
  import: 'default',
  eager: true,
})

export async function openDatabase(history: History): Promise<GameDatabase> {
  const pg = new PGlite()
  for (const name of Object.keys(schemaFiles).sort()) {
    await pg.exec(schemaFiles[name])
  }
  await pg.query('select game.new_game()')

  return {
    exec: async (sql: string, who = 'game') => {
      history.add(who, sql)
      return pg.exec(sql)
    },
    query: async <T extends DbRow = DbRow>(sql: string, who = 'game') => {
      history.add(who, sql)
      return (await pg.query(sql)).rows as T[]
    },
    rows: async <T extends DbRow = DbRow>(sql: string, params?: unknown[]) => (await pg.query(sql, params)).rows as T[],
  }
}
