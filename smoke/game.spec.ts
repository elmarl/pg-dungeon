import { expect, test } from "@playwright/test";

test("the game starts and renders its map and status", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  const response = await page.goto("/");
  expect(response?.ok()).toBeTruthy();
  await expect(page.locator("#loading")).toBeHidden({ timeout: 60_000 });
  await expect(page.locator("#map")).toContainText("@");
  await expect(page.locator("#hud")).toContainText(/^HP \d+/);
  expect(pageErrors).toEqual([]);
});
