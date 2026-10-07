import { expect, test } from "@playwright/test";

test("a visitor can enter the lab from the public root and return", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Grow something surprising/ })).toBeVisible();
  await page.getByRole("link", { name: /Open the lab/ }).click();
  await expect(page).toHaveURL(/\/lab\/$/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.getByRole("link", { name: "Cadence Garden home" }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/island.html");
  await expect(page.locator("#url")).toHaveValue(new URL(page.url()).origin);
});

test("the Open a file button is focusable and shows focus", async ({ page }) => {
  await page.goto("/lab/");
  const button = page.getByRole("button", { name: "Open a file" });
  await button.focus();
  await expect(button).toBeFocused();
  await expect(button).toHaveCSS("outline-style", "solid");
});

test("lab status and history remain reachable on small screens", async ({ page }) => {
  await page.setViewportSize({ width: 1365, height: 500 });
  await page.goto("/lab/");
  const stage = page.locator(".stage");
  await expect(stage).toHaveCSS("overflow-y", "auto");
  await stage.evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await expect(page.getByRole("heading", { name: "How it's going" })).toBeInViewport();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("#simulation-status")).toBeVisible();
  await expect(page.locator("#simulation-status")).not.toBeEmpty();
});

test("public information pages have readable content at narrow widths", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ["/", "/worlds/", "/how-it-works/", "/research/", "/about/", "/privacy/", "/participate/", "/status/"]) {
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

test("public status explains why a joined island may wait", async ({ page }) => {
  await page.route("**/api/public/status", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ counts: {}, activeIslands: 1, deviceTypes: 0, updatedAt: "2026-09-28T22:00:00Z" }),
  }));
  await page.goto("/status/");
  await expect(page.locator("#status-message")).toContainText("No experiments are queued yet");
  await expect(page.locator("#count-islands")).toHaveText("1");
});

test("public status skips polling while a request is pending", async ({ page }) => {
  await page.clock.install();
  let requests = 0;
  let releaseFirst = () => {};
  let firstStarted = () => {};
  const started = new Promise<void>((resolve) => { firstStarted = resolve; });
  await page.route("**/api/public/status", async (route) => {
    requests++;
    if (requests === 1) {
      firstStarted();
      await new Promise<void>((resolve) => { releaseFirst = resolve; });
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ counts: {}, activeIslands: 1, deviceTypes: 0, updatedAt: "2026-09-28T12:00:00Z" }),
    });
  });
  await page.goto("/status/");
  await started;
  await page.clock.fastForward(30_000);
  expect(requests).toBe(1);
  releaseFirst();
  await expect(page.locator("#count-islands")).toHaveText("1");
  await page.clock.fastForward(30_000);
  await expect.poll(() => requests).toBe(2);
});

test("operations details clear after authentication and network failures", async ({ page }) => {
  await page.route("**/operations-test", (route) => route.fulfill({ contentType: "text/html", path: "apps/coordinator/priv/static/index.html" }));
  let mode: "ok" | "unauthorized" | "network" = "unauthorized";
  await page.route("**/api/status", (route) => {
    if (mode === "network") return route.abort();
    if (mode === "unauthorized") return route.fulfill({ status: 401 });
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        counts: { pending: 1 }, runs: [{ run: "demo", segments: 1, done: 0, verified: 0, diverged: 0 }],
        islands: [], divergences: [], observationMismatches: [], devices: [],
      }),
    });
  });
  await page.goto("/operations-test");
  mode = "ok";
  await page.locator("#admin-token").fill("valid");
  await page.locator("#connect").click();
  await expect(page.locator("#runs")).toContainText("demo");

  mode = "unauthorized";
  await page.locator("#admin-token").fill("invalid");
  await page.locator("#connect").click();
  await expect(page.locator("#connection")).toContainText("administrator token");
  await expect(page.locator("#runs tr")).toHaveCount(0);
  await expect(page.locator("#counts .card")).toHaveCount(0);

  mode = "ok";
  await page.locator("#admin-token").fill("valid");
  await page.locator("#connect").click();
  await expect(page.locator("#runs")).toContainText("demo");
  mode = "network";
  await page.locator("#connect").click();
  await expect(page.locator("#connection")).toContainText("unavailable");
  await expect(page.locator("#runs tr")).toHaveCount(0);
  await expect(page.locator("#counts .card")).toHaveCount(0);
});
