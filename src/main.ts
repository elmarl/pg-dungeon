import { mountConsole } from "./console/console.js";
import { createHistory } from "./console/history.js";
import { openDatabase } from "./db.js";
import { render } from "./render.js";
import { startSession } from "./session.js";

const getElementById = (id: string): HTMLElement | null =>
  document.getElementById(id);

const historyEl = getElementById("history");
if (!historyEl) {
  throw new Error("Missing history panel");
}

const history = createHistory(historyEl);
const db = await openDatabase(history);
const session = await startSession(db);
const redraw = (): Promise<void> => render(db, getElementById);

let busy: Promise<void> = Promise.resolve();
const queueAction = (fn: () => Promise<unknown> | unknown): Promise<void> => {
  busy = busy
    .then(async () => {
      await fn();
      await redraw();
    })
    .catch((error) => {
      console.error(error);
    });
  return busy;
};

mountConsole({
  input: getElementById("cheat") as HTMLTextAreaElement,
  output: getElementById("cheat-out") as HTMLElement,
  db,
  session,
  history,
  schedule: queueAction,
});

await redraw();
const loading = getElementById("loading");
if (loading) {
  loading.remove();
}
