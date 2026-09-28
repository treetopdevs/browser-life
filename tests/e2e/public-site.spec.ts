import { expect, test } from "@playwright/test";

test("a visitor can enter the lab from the public root and return", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /What can grow from simple rules/ })).toBeVisible();
  await page.getByRole("link", { name: /Open the lab/ }).click();
  await expect(page).toHaveURL(/\/lab\/$/);
  await expect(page.getByRole("heading", { name: "World" })).toBeVisible();
  await page.getByRole("link", { name: "Browser Life home" }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/island.html");
  await expect(page.locator("#url")).toHaveValue(new URL(page.url()).origin);
});

test("public information pages have readable content at narrow widths", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ["/how-it-works/", "/research/", "/about/", "/privacy/", "/participate/"]) {
    const response = await page.goto(path);
    expect(response?.status()).toBe(200);
    await expect(page.locator("main h1")).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow, `${path} overflows horizontally`).toBe(false);
  }
});

test("public status shows aggregates and handles an unavailable coordinator", async ({ page }) => {
  await page.route("**/api/public/status", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ counts: { pending: 3, assigned: 2, done: 4, verified: 5 }, activeIslands: 2, deviceTypes: 1, updatedAt: "2026-09-27T12:00:00Z" }),
  }));
  await page.goto("/status/");
  await expect(page.locator("#count-verified")).toHaveText("5");
  await expect(page.locator("#count-islands")).toHaveText("2");
  await page.unroute("**/api/public/status");
  await page.route("**/api/public/status", (route) => route.abort());
  await page.reload();
  await expect(page.locator("#status-message")).toContainText("unavailable");
});
