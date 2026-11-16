/// <reference types="node" />
// The 3D mycelium page (/mycelium3d/) in real Chrome with WebGPU: GpuMycelium3d steps on the GPU, full read-backs feed the
// census and the CPU packers, and the volume view draws particles and haze.
// Run: BL_E2E_PORT=5271 npx playwright test tests/e2e/mycelium3d.spec.ts --workers=1
// Captures: BL_M3D_SHOTS=<dir> [BL_M3D_STEPS=3000] also plants a 64 x 64 x 32 jar with fast sinking, runs it, and writes
// screenshots at 1280 and 375 wide plus the read-back and draw timings into <dir>.
import { AxeBuilder } from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

test.describe.configure({ mode: "serial" });
test.skip(({ browserName }) => browserName !== "chromium", "WebGPU Chrome only");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

function watch(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}
async function open(page: Page) {
  await page.goto("/mycelium3d/");
  await page.waitForFunction(() => document.body.dataset.ready === "1" && (window as Any).__m3d?.census(), null, { timeout: 120_000 });
}
const m3d = <T = Any>(page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(([f, a]) => (window as Any).__m3d[f as string](...(a as unknown[])), [fn, args] as const) as Promise<T>;
const vol = (page: Page) => m3d(page, "volume");
async function plantWith(page: Page, opts: { size?: string; sink?: string; trail?: string; seed?: number }) {
  if (opts.size) await page.locator("#size").selectOption(opts.size);
  if (opts.sink) await page.locator("#sink").selectOption(opts.sink);
  if (opts.trail) await page.locator("#trail").selectOption(opts.trail);
  if (opts.seed !== undefined) await page.locator("#seed").fill(String(opts.seed));
  const before = await m3d(page, "config");
  await page.getByRole("button", { name: "Plant" }).click();
  await page.waitForFunction((b) => { const c = (window as Any).__m3d.config(); return c && JSON.stringify(c) !== b && (window as Any).__m3d.census()?.step === 0; }, JSON.stringify(before), { timeout: 120_000 });
}

/** Share of canvas pixels with clear colour (chroma above 40 of 255): the backdrop, water and glass are all grey-blue. */
async function colourShare(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const url: string = await (window as Any).__m3d.volumeShot();
    const img = new Image();
    img.src = url;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width; c.height = img.height;
    const g = c.getContext("2d")!;
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]) > 40) n++;
    return n / (d.length / 4);
  });
}

test("loads on the GPU, steps there, and the census residuals read 0 after real steps, with no console or GPU errors", async ({ page }) => {
  const errors = watch(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await open(page);
  const st = await m3d(page, "state");
  expect(st.engine).toBe("gpu");
  await expect(page.locator("#engine-now")).toHaveAttribute("data-engine", "gpu");
  const cfg = await m3d(page, "config");
  expect([cfg.width, cfg.height, cfg.depth, cfg.founders, "sinkShift" in cfg, "trailOwner" in cfg]).toEqual([32, 32, 16, 1024, false, false]);
  // Play: the GPU advances on its own
  await page.getByRole("button", { name: "Play" }).click();
  await expect(page.getByRole("button", { name: "Pause" })).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => (await m3d(page, "census")).step, { timeout: 60_000 }).toBeGreaterThan(50);
  await page.getByRole("button", { name: "Pause" }).click();
  await expect(page.locator("#status")).toContainText("Paused at step");
  // a fixed point, read back after the steps
  await m3d(page, "runTo", 600);
  const c = await m3d(page, "census");
  expect(c.step).toBe(600);
  expect([c.matterResidual, c.energyResidual]).toEqual([0, 0]);
  expect(c.particles).toBeGreaterThan(0);
  expect(c.groups.length).toBe(8);
  await expect(page.locator("#r-step")).toHaveText("600");
  await expect(page.locator("#r-m")).toHaveText("0");
  await expect(page.locator("#r-e")).toHaveText("0");
  await expect(page.locator("#depth-rows tr")).toHaveCount(8);
  await expect(page.locator("#depth-rows tr").first().locator("th")).toHaveText("0–1");
  // light falls from the surface to the floor
  expect(c.groups[0].light).toBeGreaterThan(c.groups[7].light);
  // one step from the button
  await page.getByRole("button", { name: "One step" }).click();
  await expect(page.locator("#r-step")).toHaveText("601");
  expect((await vol(page)).errors).toEqual([]);
  expect(errors).toEqual([]);
});

test("the volume draws coloured pixels in every way of drawing; peel and cut change the picture; resources stay flat", async ({ page }) => {
  const errors = watch(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await open(page);
  await m3d(page, "runTo", 400);
  await expect.poll(async () => (await vol(page)).painted).toBe("particles");
  expect((await vol(page)).live).toBeGreaterThan(0);
  const full = await colourShare(page);
  expect(full).toBeGreaterThan(0.01);
  await page.locator("#cut").fill("0");
  expect(await colourShare(page)).toBeLessThan(full * 0.6);
  await page.locator("#cut").fill("100");
  await page.locator("#peel").fill("8");
  await expect(page.locator("#peel-out")).toHaveText("8");
  expect((await vol(page)).peel).toBe(8);
  await page.locator("#peel").fill("0");
  const before = (await vol(page)).resources;
  for (const [re, id] of [[/^Cells, ray-marched/, "raymarch"], [/^Slices/, "slices"], [/^Particles and haze/, "particles"]] as const) {
    await page.getByRole("radio", { name: re }).check();
    await expect.poll(async () => (await vol(page)).mounted).toBe(id);
    expect(await colourShare(page), id).toBeGreaterThan(0.005);
  }
  expect((await vol(page)).resources).toBe(before);
  // the waste toggle and depth stretch change the picture only
  const shotA = await page.evaluate(() => (window as Any).__m3d.volumeShot());
  await page.locator("#show-waste").uncheck();
  expect(await page.evaluate(() => (window as Any).__m3d.volumeShot())).not.toBe(shotA);
  await page.locator("#stretch").fill("3");
  await expect(page.locator("#stretch-out")).toHaveText("3");
  expect((await vol(page)).stretch).toBe(3);
  expect((await m3d(page, "census")).step).toBe(400);
  expect((await vol(page)).errors).toEqual([]);
  expect(errors).toEqual([]);
});

test("One step clicked while a new world is planting steps the new world once, not to the old world's step + 1", async ({ page }) => {
  const errors = watch(page);
  await open(page);
  await m3d(page, "runTo", 300);
  expect((await m3d(page, "census")).step).toBe(300);
  await page.locator("#seed").fill("12");
  // both clicks in one task: the step lands while the plant is queued
  await page.evaluate(() => { (document.getElementById("plant") as HTMLButtonElement).click(); (document.getElementById("step") as HTMLButtonElement).click(); });
  await expect(page.locator("#status")).toContainText("Stepped to", { timeout: 120_000 });
  expect((await m3d(page, "config")).seed).toBe(12);
  const c = await m3d(page, "census");
  expect([c.step, (await m3d(page, "state")).queued, c.matterResidual, c.energyResidual]).toEqual([1, 1, 0, 0]);
  await expect(page.locator("#r-step")).toHaveText("1");
  expect(errors).toEqual([]);
});

test("sinking and trail options change the config on Plant, and each world steps with residuals 0", async ({ page }) => {
  const errors = watch(page);
  await open(page);
  await plantWith(page, { sink: "fast", trail: "toll", seed: 7 });
  let cfg = await m3d(page, "config");
  expect([cfg.sinkShift, cfg.trailMoveDiscount, cfg.trailDiscountMode, cfg.moveCost, cfg.seed, "trailOwner" in cfg]).toEqual([4, 64, "toll", 12, 7, false]);
  await expect(page.locator("#sink-help")).toContainText("Sixteen times faster");
  await m3d(page, "runTo", 300);
  let c = await m3d(page, "census");
  expect([c.step, c.matterResidual, c.energyResidual]).toEqual([300, 0, 0]);
  await plantWith(page, { sink: "slow", trail: "owner" });
  cfg = await m3d(page, "config");
  expect([cfg.sinkShift, cfg.trailOwner, cfg.ownerDefend, cfg.ownerConduit, "trailMoveDiscount" in cfg]).toEqual([8, "gid", 4, 30, false]);
  await expect(page.locator("#trail-help")).toContainText("remembers which family laid it");
  await m3d(page, "runTo", 300);
  c = await m3d(page, "census");
  expect([c.step, c.matterResidual, c.energyResidual]).toEqual([300, 0, 0]);
  await plantWith(page, { sink: "off", trail: "none", size: "64x64x32" });
  cfg = await m3d(page, "config");
  expect([cfg.width, cfg.depth, "sinkShift" in cfg, "trailOwner" in cfg, cfg.founders, cfg.maxParticles]).toEqual([64, 32, false, false, 8192, 65536]);
  await m3d(page, "runTo", 50);
  c = await m3d(page, "census");
  expect([c.step, c.matterResidual, c.energyResidual]).toEqual([50, 0, 0]);
  // the cube, the heaviest size: plants, steps, balances and draws
  await plantWith(page, { size: "64x64x64", sink: "fast" });
  cfg = await m3d(page, "config");
  expect([cfg.width, cfg.height, cfg.depth, cfg.founders, cfg.maxParticles, cfg.sinkShift]).toEqual([64, 64, 64, 16384, 65536, 4]);
  await m3d(page, "runTo", 30);
  c = await m3d(page, "census");
  expect([c.step, c.matterResidual, c.energyResidual]).toEqual([30, 0, 0]);
  expect(c.groups.map((g: Any) => g.z1 - g.z0 + 1)).toEqual([8, 8, 8, 8, 8, 8, 8, 8]);
  await expect.poll(async () => (await vol(page)).painted).toBe("particles");
  expect(await colourShare(page)).toBeGreaterThan(0.01);
  expect((await vol(page)).errors).toEqual([]);
  expect(errors).toEqual([]);
});

test("without WebGPU it runs the CPU reference at the default size and says so", async ({ page }) => {
  const errors = watch(page);
  await page.addInitScript(() => { Object.defineProperty(Navigator.prototype, "gpu", { get: () => undefined, configurable: true }); });
  await open(page);
  expect((await m3d(page, "state")).engine).toBe("cpu");
  await expect(page.locator("#engine-now")).toContainText("CPU reference");
  await expect(page.locator("#engine-now")).toContainText("does not offer WebGPU");
  await expect(page.locator("#cpu-fig")).toBeVisible();
  await expect(page.locator("#gpu-fig")).toBeHidden();
  await m3d(page, "runTo", 40);
  const c = await m3d(page, "census");
  expect([c.step, c.matterResidual, c.energyResidual]).toEqual([40, 0, 0]);
  // the bigger sizes need the GPU: a request for one plants the default size
  await page.locator("#size").selectOption("64x64x32");
  await page.getByRole("button", { name: "Plant" }).click();
  await page.waitForFunction(() => (window as Any).__m3d.census()?.step === 0, null, { timeout: 60_000 });
  expect((await m3d(page, "config")).width).toBe(32);
  await expect(page.locator("#size")).toHaveValue("32x32x16");
  expect(errors).toEqual([]);
});

for (const theme of ["light", "dark"] as const) {
  test(`375 wide, ${theme}: no sideways scroll and no serious axe findings`, async ({ page }) => {
    await page.addInitScript((t) => { try { localStorage.setItem("browser-life-theme", t); } catch { /* ignore */ } }, theme);
    await page.setViewportSize({ width: 375, height: 812 });
    await open(page);
    await m3d(page, "runTo", 100);
    await page.locator("#g-look summary").click();
    await page.waitForSelector("#volume-params input");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect((await page.locator("#volume-canvas").boundingBox())!.width).toBeLessThanOrEqual(375);
    const res = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
    expect(res.violations.filter((v) => v.impact === "serious" || v.impact === "critical"), JSON.stringify(res.violations.map((v) => [v.id, v.nodes.map((n) => n.target)]))).toEqual([]);
  });
  test(`1280 wide, ${theme}: no serious axe findings`, async ({ page }) => {
    await page.addInitScript((t) => { try { localStorage.setItem("browser-life-theme", t); } catch { /* ignore */ } }, theme);
    await page.setViewportSize({ width: 1280, height: 900 });
    await open(page);
    const res = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
    expect(res.violations.filter((v) => v.impact === "serious" || v.impact === "critical"), JSON.stringify(res.violations.map((v) => [v.id, v.nodes.map((n) => n.target)]))).toEqual([]);
  });
}

const SHOTS = process.env.BL_M3D_SHOTS;
test("capture: a 64 x 64 x 32 jar with fast sinking after a few thousand steps, at 1280 and 375 wide", async ({ page }) => {
  test.skip(!SHOTS, "set BL_M3D_SHOTS to a directory to capture");
  test.setTimeout(1_800_000);
  const steps = Number(process.env.BL_M3D_STEPS || 3000);
  mkdirSync(SHOTS!, { recursive: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  await open(page);
  await page.addStyleTag({ content: ".site-header { position: static !important; } .skip { display: none !important; }" });
  await plantWith(page, { size: "64x64x32", sink: "fast" });
  const t0 = Date.now();
  for (let s = 0; s < steps;) { s = Math.min(steps, s + 500); await m3d(page, "runTo", s); }
  const runMs = Date.now() - t0;
  const c = await m3d(page, "census");
  expect([c.step, c.matterResidual, c.energyResidual]).toEqual([steps, 0, 0]);
  // timings: a few seconds of Play for the read-back cadence and frame times, then draws on their own
  await page.locator("#pace").selectOption("max");
  await page.getByRole("button", { name: "Play" }).click();
  await page.waitForTimeout(6000);
  const playing = await m3d(page, "stats");
  const status = await page.locator("#status").innerText();
  await page.getByRole("button", { name: "Pause" }).click();
  await page.waitForFunction(() => !(window as Any).__m3d.state().running);
  const draw = await m3d(page, "timeDraw", 10);
  const census = await m3d(page, "census");
  const quantiles = await m3d(page, "quantiles");
  writeFileSync(join(SHOTS!, "timings.json"), JSON.stringify({ steps, runMs, playing, status, drawMs: draw, census, quantiles }, null, 2));
  await m3d(page, "still");
  const shot = async (name: string, el = "#gpu-fig") => { await m3d(page, "volumeDraw"); await page.locator(el).screenshot({ path: join(SHOTS!, name) }); };
  await shot("mycelium3d-1280.png");
  await page.locator(".m3-world").screenshot({ path: join(SHOTS!, "mycelium3d-1280-with-census.png") });
  await page.getByRole("button", { name: "Level with the jar" }).click();
  await shot("mycelium3d-1280-side.png");
  await page.locator("#cut").fill("50");
  await shot("mycelium3d-1280-cut50.png");
  await page.locator("#cut").fill("100");
  await page.getByRole("button", { name: "Above, at an angle" }).click();
  await page.screenshot({ path: join(SHOTS!, "mycelium3d-1280-page.png"), fullPage: true });
  // the light gradient: from the side with waste off, mean brightness of row bands down the middle of the picture
  await page.getByRole("button", { name: "Level with the jar" }).click();
  await page.locator("#show-waste").uncheck();
  await m3d(page, "volumeDraw");
  const profile = await page.evaluate(async () => {
    const url: string = await (window as Any).__m3d.volumeShot();
    const img = new Image(); img.src = url; await img.decode();
    const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
    const g = c.getContext("2d")!; g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    const bands = 12, out: number[] = [];
    for (let b = 0; b < bands; b++) {
      let sum = 0, n = 0;
      for (let y = Math.floor((b * c.height) / bands); y < Math.floor(((b + 1) * c.height) / bands); y++) for (let x = Math.floor(c.width * 0.3); x < c.width * 0.7; x++) {
        const i = (y * c.width + x) * 4; sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; n++;
      }
      out.push(+(sum / n).toFixed(1));
    }
    return out;
  });
  await shot("mycelium3d-1280-side-nowaste.png");
  await page.locator("#show-waste").check();
  await page.getByRole("button", { name: "Above, at an angle" }).click();
  // the trail haze, on a toll world where trail is laid: a still with the haze at 0 and at full strength
  await plantWith(page, { size: "64x64x32", sink: "off", trail: "toll" });
  for (let s = 0; s < 2000;) { s = Math.min(2000, s + 500); await m3d(page, "runTo", s); }
  const tollQuantiles = await m3d(page, "quantiles");
  await m3d(page, "still");
  await page.locator("#g-look summary").click();
  const trailSlider = page.getByLabel("Trail haze");
  await trailSlider.fill("0");
  const noTrail = await page.evaluate(() => (window as Any).__m3d.volumeShot());
  await shot("mycelium3d-1280-toll-trail0.png");
  await trailSlider.fill("1");
  const fullTrail = await page.evaluate(() => (window as Any).__m3d.volumeShot());
  await shot("mycelium3d-1280-toll-trail1.png");
  writeFileSync(join(SHOTS!, "look.json"), JSON.stringify({ sideBrightnessTopToBottom: profile, lightByGroup: census.groups.map((g: Any) => g.light), tollQuantiles, trailChangesPicture: noTrail !== fullTrail }, null, 2));
  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForTimeout(500);
  await shot("mycelium3d-375.png");
  await page.screenshot({ path: join(SHOTS!, "mycelium3d-375-page.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect((await vol(page)).errors).toEqual([]);
});
