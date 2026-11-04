import type { GameDatabase } from "./db.js";

export interface Session {
  executeCommand<T>(command: () => Promise<T>): Promise<T>;
  rewind(): Promise<void>;
}

export async function startSession(db: GameDatabase): Promise<Session> {
  await db.exec("begin; set role player");

  return {
    async executeCommand<T>(command: () => Promise<T>): Promise<T> {
      await db.exec("savepoint turn");
      try {
        const [{ turn: turnBefore }] = await db.rows<{ turn: number }>(
          "select turn from screen.status",
        );
        const result = await command();
        const [{ turn: turnAfter }] = await db.rows<{ turn: number }>(
          "select turn from screen.status",
        );
        if (turnAfter === turnBefore) {
          await db.exec("release savepoint turn");
        }
        return result;
      } catch (error) {
        return recoverFailedAction(db, "turn", error);
      }
    },

    async rewind(): Promise<void> {
      await db.exec("savepoint rewind_check");
      let turn: number;
      try {
        const [status] = await db.rows<{ turn: number }>(
          "select turn from screen.status",
        );
        turn = status.turn;
        await db.exec("release savepoint rewind_check");
      } catch (error) {
        return recoverFailedAction(db, "rewind_check", error);
      }

      if (turn === 0) {
        return;
      }
      await db.exec("rollback to savepoint turn; release savepoint turn");
      await db.exec("savepoint rewind_action");
      try {
        await db.query("select game.rewound()");
        await db.exec("release savepoint rewind_action");
      } catch (error) {
        return recoverFailedAction(db, "rewind_action", error);
      }
    },
  };
}

async function rollbackAndRelease(
  db: GameDatabase,
  savepoint: string,
): Promise<void> {
  await db.exec(
    `rollback to savepoint ${savepoint}; release savepoint ${savepoint}`,
  );
}

async function recoverFailedAction(
  db: GameDatabase,
  savepoint: string,
  actionError: unknown,
): Promise<never> {
  try {
    await rollbackAndRelease(db, savepoint);
  } catch (recoveryError) {
    throw new AggregateError(
      [actionError, recoveryError],
      `Action failed and savepoint ${savepoint} could not be restored`,
    );
  }
  throw actionError;
}
