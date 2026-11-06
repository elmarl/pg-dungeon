import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";

import type { DbRow, GameDatabase } from "../../src/db.js";
import { type Session, startSession } from "../../src/session.js";

export interface GameFixture {
  database: PGlite;
  db: GameDatabase;
  session: Session;
}

export interface GameFixtureOptions {
  rewriteQuery?: (sql: string) => string;
  setup?: (db: GameDatabase) => Promise<void>;
}

let gameTemplate: Promise<Blob> | undefined;

export async function createGameTemplate(): Promise<Blob> {
  const database = new PGlite();
  const sqlDirectory = fileURLToPath(
    new URL("../../src/sql/", import.meta.url),
  );
  const sqlFiles = (await readdir(sqlDirectory)).sort();

  try {
    for (const sqlFile of sqlFiles) {
      const sql = await readFile(`${sqlDirectory}/${sqlFile}`, "utf8");
      await database.exec(sql);
    }
    await database.query("select game.new_game(0.42)");
    return await database.dumpDataDir();
  } finally {
    await database.close();
  }
}

export async function createGameFixture(
  options: GameFixtureOptions = {},
): Promise<GameFixture> {
  gameTemplate ??= loadGameTemplate();
  const database = await PGlite.create({ loadDataDir: await gameTemplate });

  const db: GameDatabase = {
    exec: async (sql: string) => database.exec(sql),
    query: async <TRow extends DbRow = DbRow>(sql: string) => {
      const rewrittenSql = options.rewriteQuery?.(sql) ?? sql;
      return (await database.query(rewrittenSql)).rows as TRow[];
    },
    rows: async <TRow extends DbRow = DbRow>(sql: string, params?: unknown[]) =>
      (await database.query(sql, params)).rows as TRow[],
  };

  await options.setup?.(db);
  const session = await startSession(db);
  return { database, db, session };
}

async function loadGameTemplate(): Promise<Blob> {
  const templatePath = process.env.PG_DUNGEON_TEMPLATE_PATH;
  if (templatePath) {
    const contents = await readFile(templatePath);
    return new Blob([
      contents.buffer.slice(
        contents.byteOffset,
        contents.byteOffset + contents.byteLength,
      ) as ArrayBuffer,
    ]);
  }
  return createGameTemplate();
}

export async function withGameFixture<T>(
  run: (fixture: GameFixture) => Promise<T>,
  options: GameFixtureOptions = {},
): Promise<T> {
  const fixture = await createGameFixture(options);
  try {
    return await run(fixture);
  } finally {
    await fixture.database.close();
  }
}
