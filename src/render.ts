import type { GameDatabase } from "./db.js";
import { escapeHtml } from "./html.js";

export async function render(
  db: GameDatabase,
  getElementById: (id: string) => HTMLElement | null,
): Promise<void> {
  const mapEl = getElementById("map");
  const hudEl = getElementById("hud");
  const logEl = getElementById("log");
  if (!mapEl || !hudEl || !logEl) {
    return;
  }

  const [status] = await db.rows<{
    height: number;
    width: number;
    hp: number;
    turn: number;
    rewinds: number;
  }>("select * from screen.status");
  const tiles = await db.rows<{
    x: number;
    y: number;
    style: string;
    glyph: string;
  }>("select * from screen.tiles");
  const messages = await db.rows<{ msg: string }>(
    "select msg from screen.messages",
  );

  const grid = Array.from({ length: status.height }, () =>
    Array(status.width).fill(" "),
  );
  for (const tile of tiles) {
    grid[tile.y][tile.x] =
      `<span class="${tile.style}">${escapeHtml(tile.glyph)}</span>`;
  }

  mapEl.innerHTML = grid.map((mapRow) => mapRow.join("")).join("\n");
  hudEl.textContent = `HP ${status.hp}   turn ${status.turn}   rewinds ${status.rewinds}`;
  logEl.innerHTML = messages
    .map(
      (message, index) =>
        `<div style="opacity:${1 - index * 0.15}">${escapeHtml(message.msg)}</div>`,
    )
    .join("");
}
