import { AxeBuilder } from "@axe-core/playwright";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { test, expect } from "@playwright/test";

const seeds = [1101, 1102, 1103] as const;

test("archive presents all three historical movies and full-run summaries", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/ecosystem/archive/");
  await expect(page.getByRole("heading", { name: "Three paths through the same world." })).toBeVisible();

  for (const seed of seeds) {
    const video = page.locator(`#movie-${seed}`);
    await expect(video).toHaveJSProperty("autoplay", false);
    await expect(video).toHaveJSProperty("playbackRate", Number(await page.getByLabel("Playback speed").inputValue()));
    await expect.poll(() => video.evaluate(node => (node as HTMLVideoElement).readyState)).toBeGreaterThanOrEqual(1);
    const metadata = await video.evaluate(node => {
      const movie = node as HTMLVideoElement;
      return { width: movie.videoWidth, height: movie.videoHeight, duration: movie.duration };
    });
    expect(metadata.width).toBe(192);
    expect(metadata.height).toBe(192);
    expect(metadata.duration).toBeCloseTo(40.05, 1);
    await expect(page.locator(`#tick-${seed}`)).toBeVisible();
    await expect(page.locator(`#population-${seed}`)).toBeVisible();
    await expect(page.getByRole("img", { name: new RegExp(`Mean attack trait by family.*seed ${seed}`) })).toBeVisible();
    await expect(page.getByRole("img", { name: new RegExp(`Mean defense trait by family.*seed ${seed}`) })).toBeVisible();
    await expect(page.locator(`#attack-${seed}`)).toHaveAttribute("data-gap-count", /^[1-9]\d*$/);
    await expect(page.locator(`#defense-${seed}`)).toHaveAttribute("data-gap-count", /^[1-9]\d*$/);
    await page.locator(`#trait-data-details-${seed} summary`).click();
    await expect(page.locator(`#trait-data-${seed} tbody tr`)).toHaveCount(1005);
    await page.locator(`#trait-data-details-${seed} summary`).click();
    await expect(page.locator(`#family-summary-${seed} tbody tr`)).toHaveCount(5);
    await expect(page.locator(`#traits-${seed} .trait-family`)).toHaveCount(5);
    await expect(video).toHaveJSProperty("paused", true);
  }

  const first = page.locator("#movie-1101");
  await first.evaluate(async node => {
    const video = node as HTMLVideoElement;
    video.currentTime = 5.25;
    await new Promise<void>(resolve => video.addEventListener("seeked", () => resolve(), { once: true }));
  });
  await expect(page.locator("#tick-1101")).toHaveText("2,625 / 20,000");

  const frameCallbacks = await first.evaluate(node => {
    const video = node as HTMLVideoElement & { __frameCallbackMetrics?: { pending: number; maximum: number } };
    const original = video.requestVideoFrameCallback!.bind(video);
    const metrics = { pending: 0, maximum: 0 };
    video.__frameCallbackMetrics = metrics;
    video.requestVideoFrameCallback = callback => original((now, metadata) => {
      metrics.pending--;
      callback(now, metadata);
    });
    const request = video.requestVideoFrameCallback;
    video.requestVideoFrameCallback = callback => {
      metrics.pending++;
      metrics.maximum = Math.max(metrics.maximum, metrics.pending);
      return request.call(video, callback);
    };
    return true;
  });
  expect(frameCallbacks).toBe(true);
  await page.getByRole("button", { name: "Play all" }).click();
  for (const seed of seeds) await expect(page.locator(`#movie-${seed}`)).toHaveJSProperty("paused", false);
  await page.getByLabel("Playback speed").selectOption("1.5");
  for (const seed of seeds) await expect(page.locator(`#movie-${seed}`)).toHaveJSProperty("playbackRate", 1.5);
  for (const time of [6, 6.4, 6.8]) {
    await first.evaluate(async (node, position) => {
      const video = node as HTMLVideoElement;
      video.currentTime = position;
      await new Promise<void>(resolve => video.addEventListener("seeked", () => resolve(), { once: true }));
    }, time);
  }
  await expect.poll(() => first.evaluate(node => (node as HTMLVideoElement & { __frameCallbackMetrics: { maximum: number } }).__frameCallbackMetrics.maximum)).toBeLessThanOrEqual(1);
  await page.getByRole("button", { name: "Pause all" }).click();
  for (const seed of seeds) await expect(page.locator(`#movie-${seed}`)).toHaveJSProperty("paused", true);

  await page.getByRole("button", { name: "Play all" }).click();
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  for (const seed of seeds) await expect(page.locator(`#movie-${seed}`)).toHaveJSProperty("paused", true);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.locator("#playback-status")).toBeEmpty();
  for (const seed of seeds) await expect(page.locator(`#movie-${seed}`)).toHaveJSProperty("paused", true);

  const screenshots = join(process.cwd(), "runs/ecosystem-library/browser-archive");
  await mkdir(screenshots, { recursive: true });
  await page.screenshot({ path: join(screenshots, "ecosystem-archive-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect.poll(() => page.locator("#attack-1101").evaluate(node => (node as HTMLCanvasElement).width)).toBeGreaterThan(300);
  await expect.poll(() => page.locator("#attack-1101").evaluate(node => (node as HTMLCanvasElement).clientHeight)).toBeGreaterThanOrEqual(140);
  await expect(page.locator("#legend-1101 span")).toHaveCount(5);
  await page.screenshot({ path: join(screenshots, "ecosystem-archive-mobile.png"), fullPage: true });
  await page.locator("#trait-data-details-1101 summary").click();
  await expect(page.locator("#trait-data-1101")).toHaveAttribute("tabindex", "0");
  await expect(page.locator("#trait-data-1101")).toHaveAttribute("role", "region");
  await expect(page.locator("#trait-data-1101 tbody tr")).toHaveCount(1005);
  const accessibility = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(accessibility.violations).toEqual([]);
  await page.locator("#trait-data-details-1101 summary").click();
  expect(errors).toEqual([]);
});

test("an unavailable movie reports the failure and can recover on retry", async ({ page }) => {
  const blockedMovies = /ecosystem-archive-110[23]\.mp4/;
  await page.route(blockedMovies, route => {
    if (new URL(route.request().url()).searchParams.has("import")) return route.continue();
    return route.abort();
  });
  await page.goto("/ecosystem/archive/");
  await expect(page.locator("#media-status-1102")).toContainText("could not be loaded");
  await expect(page.locator("#media-status-1103")).toContainText("could not be loaded");
  const retry2 = page.locator("#retry-1102");
  const retry3 = page.locator("#retry-1103");
  await expect(retry2).toHaveAccessibleName("Retry and play this recording");
  await expect(retry3).toHaveAccessibleName("Retry and play this recording");
  await page.getByLabel("Playback speed").selectOption("1.5");
  await page.getByRole("button", { name: "Play all" }).click();
  await expect(page.locator("#playback-status")).toContainText("Playback could not start for 2 recordings");
  await expect(page.locator("#movie-1101")).toHaveJSProperty("paused", false);

  await Promise.all([retry2.click(), retry3.click()]);
  await expect(page.locator("#media-status-1102")).toContainText("movie file could not be loaded");
  await expect(page.locator("#media-status-1103")).toContainText("movie file could not be loaded");
  await expect(page.locator("#playback-status")).toContainText("Playback could not start for 2 recordings");
  await expect(retry2).toBeVisible();
  await expect(retry3).toBeVisible();

  await page.unroute(blockedMovies);
  await Promise.all([retry2.click(), retry3.click()]);
  await expect.poll(() => page.locator("#movie-1102").evaluate(node => (node as HTMLVideoElement).readyState)).toBeGreaterThanOrEqual(1);
  await expect.poll(() => page.locator("#movie-1103").evaluate(node => (node as HTMLVideoElement).readyState)).toBeGreaterThanOrEqual(1);
  await expect(page.locator("#media-status-1102")).toBeEmpty();
  await expect(page.locator("#media-status-1103")).toBeEmpty();
  await expect(page.locator("#playback-status")).toBeEmpty();
  for (const seed of [1101, 1102, 1103]) await expect(page.locator(`#movie-${seed}`)).toHaveJSProperty("paused", false);
  for (const seed of seeds) await expect(page.locator(`#movie-${seed}`)).toHaveJSProperty("playbackRate", 1.5);
  await expect(retry2).toBeHidden();
  await expect(retry3).toBeHidden();
  await page.getByRole("button", { name: "Pause all" }).click();
});

test("pausing a pending Play all cancels its AbortError without a false failure", async ({ page }) => {
  await page.route("**/ecosystem-archive-1101.mp4*", async route => {
    if (new URL(route.request().url()).searchParams.has("import")) return route.continue();
    await new Promise(resolve => setTimeout(resolve, 1200));
    return route.continue();
  });
  await page.goto("/ecosystem/archive/");
  await page.getByRole("button", { name: "Play all" }).click();
  await page.getByRole("button", { name: "Pause all" }).click();
  await expect(page.locator("#playback-status")).toHaveText("All recordings paused.");
  await page.waitForTimeout(1400);
  await expect(page.locator("#playback-status")).toHaveText("All recordings paused.");
  for (const seed of seeds) await expect(page.locator(`#movie-${seed}`)).toHaveJSProperty("paused", true);
});

test("pausing one native player during Play all does not count AbortError as a failure", async ({ page }) => {
  await page.route("**/ecosystem-archive-1101.mp4*", async route => {
    if (new URL(route.request().url()).searchParams.has("import")) return route.continue();
    await new Promise(resolve => setTimeout(resolve, 1200));
    return route.continue();
  });
  await page.goto("/ecosystem/archive/");
  await page.getByRole("button", { name: "Play all" }).click();
  await page.locator("#movie-1101").evaluate(node => (node as HTMLVideoElement).pause());
  await page.waitForTimeout(1400);
  await expect(page.locator("#playback-status")).toBeEmpty();
  await expect(page.locator("#movie-1101")).toHaveJSProperty("paused", true);
  for (const seed of [1102, 1103]) await expect(page.locator(`#movie-${seed}`)).toHaveJSProperty("paused", false);
  await page.getByRole("button", { name: "Pause all" }).click();
});
