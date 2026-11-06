import { expect, type Page, test } from "@playwright/test";

const MOVE_TO_ADJACENT_FLOOR = `
  with hero as (
    select id, x, y from creature.creatures where kind = 'hero'
  ),
  target as (
    select cell.x, cell.y
    from map.cell cell
    cross join hero
    where cell.walkable
      and abs(cell.x - hero.x) + abs(cell.y - hero.y) = 1
      and not exists (
        select 1 from creature.creatures occupied
        where (occupied.x, occupied.y) = (cell.x, cell.y)
      )
    limit 1
  )
  select game.move(target.x - hero.x, target.y - hero.y)
  from hero cross join target
`;

async function submitCommand(page: Page, command: string): Promise<void> {
  const input = page.locator("#cheat");
  await input.fill(command);
  await input.press("Enter");
}

async function startGame(page: Page): Promise<void> {
  const response = await page.goto("/");
  expect(response?.ok()).toBeTruthy();
  await expect(page.locator("#map")).toContainText("@", { timeout: 60_000 });
}

test("the game starts and renders its map and status", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await startGame(page);
  expect(pageErrors).toEqual([]);
  await expect(page.locator("#map")).toContainText("@");
  await expect(page.locator("#hud")).toContainText(/^HP \d+/);
});

test("a successful movement advances the displayed turn", async ({ page }) => {
  await startGame(page);

  await submitCommand(page, MOVE_TO_ADJACENT_FLOOR);

  await expect(page.locator("#hud")).toContainText("turn 1");
  await expect(page.locator("#cheat-out")).toContainText("true");
});

test("rewinding a movement restores the previous turn", async ({ page }) => {
  await startGame(page);
  await submitCommand(page, MOVE_TO_ADJACENT_FLOOR);
  await expect(page.locator("#hud")).toContainText("turn 1");

  await submitCommand(page, "\\rewind");

  await expect(page.locator("#hud")).toContainText("turn 0");
  await expect(page.locator("#hud")).toContainText("rewinds 1");
});

test("a failed SQL command is reported and the console remains usable", async ({
  page,
}) => {
  await startGame(page);

  await submitCommand(page, "select * from no_such_table");
  await expect(page.locator("#cheat-out .err")).toContainText("ERROR:");

  await submitCommand(page, "select turn from screen.status");
  await expect(page.locator("#cheat-out")).toContainText("1 rows");
  await expect(page.locator("#cheat-out")).toContainText("turn");
  await expect(page.locator("#cheat-out")).toContainText("0");
  await expect(page.locator("#hud")).toContainText("turn 0");
});
