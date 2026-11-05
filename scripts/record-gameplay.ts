import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { expect, chromium, type Page } from "@playwright/test";
import { PNG } from "pngjs";
import encoder from "gifenc";
import { createServer } from "vite";
import {
  planNextAction,
  type Action,
  type GameState,
} from "./gameplay-plan.js";

const { GIFEncoder, applyPalette, quantize } = encoder;
const outputPath = path.resolve(
  process.env.RECORDING_OUTPUT ?? "recordings/gameplay.gif",
);
const maxTurns = Number(process.env.RECORDING_TURNS ?? 28);
const frameDelay = 450;
const server = await createServer({
  logLevel: "error",
  server: { host: "127.0.0.1", port: 4174, strictPort: true },
});

async function queryGameState(page: Page): Promise<GameState> {
  const sql = `select json_build_object(
    'hero', (select json_build_object('id', id, 'x', x, 'y', y, 'hp', hp) from creature.hero()),
    'swordKillCount', (select count(*)::int from clock.log where msg like 'You kill the % with your Cave sword.'),
    'cells', coalesce((select json_agg(json_build_object('x', x, 'y', y, 'walkable', walkable, 'visible', creature.in_sight(x, y))) from map.cell), '[]'::json),
    'creatures', coalesce((select json_agg(json_build_object('id', id, 'kind', kind, 'x', x, 'y', y, 'hp', hp)) from creature.creatures where kind <> 'hero'), '[]'::json),
    'items', coalesce((select json_agg(json_build_object('id', item.id, 'kind', item.kind, 'x', item.x, 'y', item.y, 'holder_id', item.holder_id)) from item.items item), '[]'::json)
  ) as state`;
  await submitCommand(page, sql);
  const text = await page.locator("#cheat-out td").first().innerText();
  return JSON.parse(text) as GameState;
}

async function submitCommand(page: Page, command: string): Promise<void> {
  const output = page.locator("#cheat-out");
  await output.evaluate((element) => element.replaceChildren());
  await page.locator("#cheat").evaluate((element, text) => {
    const input = element as HTMLTextAreaElement;
    input.value = text;
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
  }, command);
  await output.locator("table").waitFor({ state: "attached", timeout: 10_000 });
}

function actionCommand(action: Action): string | null {
  switch (action.type) {
    case "pick-up":
      return `select game.pick_up(${action.itemId})`;
    case "attack":
      return `select game.attack(${action.weaponId}, ${action.targetId})`;
    case "drink":
      return `select game.drink_potion(${action.itemId})`;
    case "move":
      return `select game.move(${action.dx}, ${action.dy})`;
    case "stop":
      return null;
  }
}

async function captureFrame(page: Page): Promise<Buffer> {
  await page.waitForTimeout(120);
  return page.screenshot({ type: "png" });
}

async function encodeGif(framePngs: Buffer[]): Promise<Buffer> {
  const frames = framePngs.map((frame) => PNG.sync.read(frame));
  const { width, height } = frames[0];
  const paletteSamples = new Uint8Array(
    Math.ceil((frames.length * width * height) / 20) * 4,
  );
  let sampleOffset = 0;
  for (const frame of frames) {
    for (
      let pixelOffset = 0;
      pixelOffset < frame.data.length;
      pixelOffset += 80
    ) {
      paletteSamples.set(
        frame.data.subarray(pixelOffset, pixelOffset + 4),
        sampleOffset,
      );
      sampleOffset += 4;
    }
  }
  const palette = quantize(paletteSamples.subarray(0, sampleOffset), 256);
  const gif = GIFEncoder();
  frames.forEach((frame, index) => {
    gif.writeFrame(applyPalette(frame.data, palette), width, height, {
      palette,
      delay: index === 0 ? 900 : frameDelay,
      repeat: index === 0 ? 0 : undefined,
    });
  });
  gif.finish();
  return Buffer.from(gif.bytes());
}

const framePngs: Buffer[] = [];
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1280, height: 760 },
  });
  await page.goto("http://127.0.0.1:4174/");
  await page.addStyleTag({
    content: `
      body { min-height: 100vh; display: grid; align-items: center; }
      main { display: block !important; width: max-content; max-width: 100%; }
      main > section:first-child { width: max-content; max-width: 100%; }
      main > section:nth-child(2) { display: none; }
      #map { font-size: 20px; }
    `,
  });
  await expect(page.locator("#map")).toContainText("@", { timeout: 60_000 });
  framePngs.push(await captureFrame(page));

  let bowAttacks = 0;
  let swordAttacks = 0;
  let pickupActions = 0;
  for (let turnIndex = 0; turnIndex < maxTurns; turnIndex += 1) {
    const state = await queryGameState(page);
    const action = planNextAction(state);
    const command = actionCommand(action);
    if (!command) {
      break;
    }
    await submitCommand(page, command);
    await page.waitForTimeout(200);
    if (action.type === "attack") {
      const weapon = state.items.find((item) => item.id === action.weaponId);
      if (weapon?.kind === "sword") {
        swordAttacks += 1;
      } else {
        bowAttacks += 1;
      }
    } else if (action.type === "pick-up") {
      pickupActions += 1;
    }
    const nextState = await queryGameState(page);
    if (nextState.hero.hp <= 0 || nextState.hero.id !== state.hero.id) {
      break;
    }
    if (nextState.cells.length === 0) {
      throw new Error("The game map did not load after an action.");
    }
    framePngs.push(await captureFrame(page));
  }

  if (framePngs.length < 2) {
    throw new Error("The recorder did not capture any gameplay actions.");
  }
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, await encodeGif(framePngs));
  console.log(`Saved ${framePngs.length} frames to ${outputPath}`);
  console.log(
    `Recorded ${pickupActions} item pickups, ${swordAttacks} sword attacks, and ${bowAttacks} bow attacks.`,
  );
  if (framePngs.length > 1) {
    const finalState = await queryGameState(page);
    if (finalState.swordKillCount === 0) {
      console.warn(
        "No sword kill occurred in this randomized run. Try recording again.",
      );
    } else {
      console.log("The first kill was with the sword.");
    }
  }
} finally {
  if (browser) {
    await browser.close();
  }
  await server.close();
}
