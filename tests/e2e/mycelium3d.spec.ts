/// <reference types="node" />
// The 3D mycelium page (/mycelium3d/) in real Chrome with WebGPU: GpuMycelium3d steps on the GPU, full read-backs feed the
// census and the CPU packers, and the volume view draws particles and haze.
// Run: BL_E2E_PORT=5271 npx playwright test tests/e2e/mycelium3d.spec.ts --workers=1
// Captures: BL_M3D_SHOTS=<dir> [BL_M3D_STEPS=3000] also plants a 64 x 64 x 32 jar with fast sinking, runs it, and writes
// screenshots at 1280 and 375 wide plus the read-back and draw timings into <dir>; and a jar with free bonds, its links drawn,
// in the light and dark themes (add -g "capture: bonds" for that one alone); and the brush cursor in Wound mode before and
// after a stroke (-g "capture: the cursor").
import { AxeBuilder } from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CAMERA_POSES, M3D } from "../../tools/volume-capture/lib.ts";

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
async function open(page: Page, query = "") {
  await page.goto(`/mycelium3d/${query}`);
  await page.waitForFunction(() => document.body.dataset.ready === "1" && (window as Any).__m3d?.census(), null, { timeout: 120_000 });
}
const m3d = <T = Any>(page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(([f, a]) => (window as Any).__m3d[f as string](...(a as unknown[])), [fn, args] as const) as Promise<T>;
const vol = (page: Page) => m3d(page, "volume");
async function plantWith(page: Page, opts: { size?: string; sink?: string; trail?: string; bonds?: string; seed?: number }) {
  if (opts.size) await page.locator("#size").selectOption(opts.size);
  if (opts.sink) await page.locator("#sink").selectOption(opts.sink);
  if (opts.trail) await page.locator("#trail").selectOption(opts.trail);
  if (opts.bonds) await page.locator("#bonds").selectOption(opts.bonds);
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
  // bonds on the CPU reference: counted, and drawn as lines in the side view
  await plantWith(page, { bonds: "free" });
  await m3d(page, "runTo", 40);
  const b = await m3d(page, "bonds");
  expect(b.readout.bonds).toBeGreaterThan(0);
  expect(b.packed.count).toBe(b.readout.bonds + b.packed.seamBonds);
  await expect(page.locator("#bond-census")).toBeVisible();
  expect([(await m3d(page, "census")).matterResidual, (await m3d(page, "census")).energyResidual]).toEqual([0, 0]);
  // the bigger sizes need the GPU: a request for one plants the default size
  await page.locator("#size").selectOption("64x64x32");
  await page.getByRole("button", { name: "Plant" }).click();
  await page.waitForFunction(() => (window as Any).__m3d.census()?.step === 0, null, { timeout: 60_000 });
  expect((await m3d(page, "config")).width).toBe(32);
  await expect(page.locator("#size")).toHaveValue("32x32x16");
  expect(errors).toEqual([]);
});

/** What the page shows for the link choices: the planted config, the Plant form, and the view. */
async function linked(page: Page) {
  const cfg = await m3d(page, "config");
  const v = await vol(page);
  return {
    cfg: { width: cfg.width, depth: cfg.depth, seed: cfg.seed, sinkShift: cfg.sinkShift ?? null, trailOwner: cfg.trailOwner ?? null, trailDiscountMode: cfg.trailDiscountMode ?? null, bondBreak: cfg.bondBreak ?? null, bondCost: cfg.bondCost ?? null },
    choice: (await m3d(page, "state")).choice,
    form: await page.evaluate(() => ["size", "sink", "trail", "bonds", "seed"].map((id) => (document.getElementById(id) as HTMLInputElement).value)),
    renderer: v.renderer, stretch: v.stretch, peel: v.peel, waste: v.waste, pose: v.pose,
    checked: await page.locator("#o-renderer input:checked").getAttribute("value"),
    outs: [await page.locator("#stretch-out").innerText(), await page.locator("#peel-out").innerText()],
  };
}
const DEFAULT_VIEW = { cfg: { width: 32, depth: 16, seed: 1, sinkShift: null, trailOwner: null, trailDiscountMode: null, bondBreak: null, bondCost: null }, choice: { size: "32x32x16", seed: 1, sink: "off", trail: "none", bonds: "off" }, form: ["32x32x16", "off", "none", "off", "1"], renderer: "particles", stretch: 1, peel: 0, waste: true, pose: CAMERA_POSES.oblique, checked: "particles", outs: ["1", "0"] };

test("link parameters: junk and inherited-key values open the default jar, with no errors and no debug hooks", async ({ page }) => {
  const errors = watch(page);
  for (const q of [
    "?size=toString&seed=-1&sink=__proto__&trail=constructor&bonds=toString&renderer=hasOwnProperty&stretch=9&peel=abc&camera=toString&waste=maybe",
    "?size=64x64x99&seed=1.5&sink=medium&trail=public&bonds=on&renderer=points&stretch=0&peel=16&camera=top&waste=1",
    "?size=__proto__&sink=valueOf&trail=toString&bonds=__proto__&camera=__proto__&renderer=constructor&seed=4294967296&peel=-1&stretch=1e1",
  ]) {
    await open(page, q);
    expect(await linked(page), q).toEqual(DEFAULT_VIEW);
    expect(await page.evaluate(() => typeof (window as Any).__m3d.volumeStill), q).toBe("undefined");
  }
  expect((await vol(page)).errors).toEqual([]);
  expect(errors).toEqual([]);
});

test("link parameters: valid values take effect, the page's ways of drawing are the capture tool's, and ?debug stills repeat", async ({ page }) => {
  const errors = watch(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await open(page, "?debug&size=64x64x32&seed=9&sink=fast&trail=owner&bonds=upkeep&renderer=slices&stretch=3&peel=20&camera=side&waste=off");
  await expect.poll(async () => (await vol(page)).mounted).toBe("slices");
  expect(await linked(page)).toEqual({
    cfg: { width: 64, depth: 32, seed: 9, sinkShift: 4, trailOwner: "gid", trailDiscountMode: null, bondBreak: 1024, bondCost: 1 }, choice: { size: "64x64x32", seed: 9, sink: "fast", trail: "owner", bonds: "upkeep" },
    form: ["64x64x32", "fast", "owner", "upkeep", "9"], renderer: "slices", stretch: 3, peel: 20, waste: false, pose: CAMERA_POSES.side, checked: "slices", outs: ["3", "20"],
  });
  expect(await page.locator("#show-waste").isChecked()).toBe(false);
  expect(await page.locator("#o-renderer input").evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value))).toEqual([...M3D.renderers]);
  // sinking and trail on their own, and the toll road
  await open(page, "?sink=slow&trail=toll&seed=3&bonds=free");
  expect((await linked(page)).cfg).toEqual({ width: 32, depth: 16, seed: 3, sinkShift: 8, trailOwner: null, trailDiscountMode: "toll", bondBreak: 1024, bondCost: null });
  // the debug hooks: a still at an absolute pose, the same picture every time, and the state's digest
  await open(page, "?debug&seed=4&camera=above");
  await m3d(page, "runTo", 200);
  const d = await m3d(page, "digest");
  expect([d.step, d.sha256.length, d.stateDigest.length, d.particles > 0, d.gpuError]).toEqual([200, 64, 16, true, null]);
  const a = await m3d(page, "volumeStill", {});
  expect([a.yaw, a.pitch, a.dist]).toEqual([CAMERA_POSES.above.yaw, CAMERA_POSES.above.pitch, CAMERA_POSES.above.dist]);
  const turned = await m3d(page, "volumeStill", { yaw: a.yaw + 1.3 });
  expect(turned.yaw).toBeCloseTo(a.yaw + 1.3, 12);
  expect(turned.url).not.toBe(a.url);
  const back = await m3d(page, "volumeStill", { yaw: a.yaw });
  expect(back.url).toBe(a.url);
  expect(await m3d(page, "digest")).toEqual(d);
  // waste=off reaches the picture, not only the checkbox: the same fast-sinking world, haze on and off
  const shotAt = async (q: string) => { await open(page, q); await m3d(page, "runTo", 300); expect((await vol(page)).mounted).toBe("particles"); return m3d(page, "volumeStill", {}); };
  const on = await shotAt("?debug&sink=fast&seed=5"), off = await shotAt("?debug&sink=fast&seed=5&waste=off");
  expect(off.url).not.toBe(on.url);
  expect(await shotAt("?debug&sink=fast&seed=5&waste=on")).toEqual(on);
  expect((await vol(page)).errors).toEqual([]);
  expect(errors).toEqual([]);
});

test("bonds: free bonds form, each is one link (two stubs across a seam), the census counts them; without bonds no link buffer", async ({ page }) => {
  const errors = watch(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await open(page);
  // the default world: no bonds, no link buffer, no bond census
  await m3d(page, "runTo", 50);
  await m3d(page, "volumeDraw");
  expect(await m3d(page, "bonds")).toEqual({ readout: null, packed: null, uploaded: 0, linkBuffer: false });
  await expect(page.locator("#bond-census")).toBeHidden();
  await plantWith(page, { bonds: "free" });
  await expect(page.locator("#bonds-help")).toContainText("costs nothing to keep");
  const cfg = await m3d(page, "config");
  expect([cfg.bondBreak, "bondCost" in cfg, "bondChild" in cfg]).toEqual([1024, false, false]);
  await m3d(page, "runTo", 300);
  const c = await m3d(page, "census");
  expect([c.step, c.matterResidual, c.energyResidual]).toEqual([300, 0, 0]);
  await m3d(page, "volumeDraw");
  const b = await m3d(page, "bonds");
  expect(b.readout.bonds).toBeGreaterThan(0);
  // the links the renderer uploaded: one per bond, plus one more for each bond drawn as two stubs across a wrapped wall
  expect(b.packed.bonds).toBe(b.readout.bonds);
  expect(b.uploaded).toBe(b.readout.bonds + b.packed.seamBonds);
  expect(b.linkBuffer).toBe(true);
  await expect(page.locator("#bond-census")).toBeVisible();
  await expect(page.locator("#r-bonds")).toHaveText(b.readout.bonds.toLocaleString("en-US"));
  await expect(page.locator("#r-bodies")).toHaveText(b.readout.bodies.toLocaleString("en-US"));
  await expect(page.locator("#r-bonded")).toContainText(`${b.readout.bonded.toLocaleString("en-US")} (`);
  // the bond census and the new control pass axe, and fit a phone; from the top of the page, since the sticky site header
  // covers the Plant row (and its nav links overlap #trail, a target-size finding) wherever selectOption left the scroll
  const axe = async () => (await page.evaluate(() => window.scrollTo(0, 0)), await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze()).violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => [v.id, v.nodes.map((n) => n.target)]);
  expect(await axe()).toEqual([]);
  await page.setViewportSize({ width: 375, height: 812 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(await axe()).toEqual([]);
  await page.setViewportSize({ width: 1280, height: 900 });
  // peeling every layer but the floor hides links too; the picture changes and nothing errors
  const shotA = await page.evaluate(() => (window as Any).__m3d.volumeShot());
  await page.locator("#peel").fill("15");
  expect(await page.evaluate(() => (window as Any).__m3d.volumeShot())).not.toBe(shotA);
  await page.locator("#peel").fill("0");
  // back to no bonds: the buffer goes with them
  await plantWith(page, { bonds: "off" });
  await m3d(page, "runTo", 20);
  await m3d(page, "volumeDraw");
  expect(await m3d(page, "bonds")).toEqual({ readout: null, packed: null, uploaded: 0, linkBuffer: false });
  await expect(page.locator("#bond-census")).toBeHidden();
  expect((await vol(page)).errors).toEqual([]);
  expect(await page.evaluate(() => document.body.dataset.gpuError ?? null)).toBeNull();
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

// ---- the tools: Wound and Feed, by keyboard, by pointer, on both engines ------------------------------------------------

/** Sum of every form of matter in a census (body, nutrient, waste, trail), the quantity the jar keeps. */
const totalMatter = (c: Any) => c.groups.reduce((t: number, g: Any) => t + g.M + g.A + g.C + g.P, 0);
async function chooseTool(page: Page, name: "Look" | "Wound" | "Feed") {
  await page.getByRole("radio", { name: new RegExp(`^${name}`) }).check();
  await expect(page.locator("#brush")).toBeVisible({ visible: name !== "Look" });
}
async function setCell(page: Page, c: { x: number; y: number; z: number }, radius?: number) {
  await page.locator("#cur-x").fill(String(c.x));
  await page.locator("#cur-y").fill(String(c.y));
  await page.locator("#cur-z").fill(String(c.z));
  if (radius !== undefined) await page.locator("#cur-r").fill(String(radius));
}
/** Presses the Apply button from the keyboard and waits for the stroke's report. */
async function applyByKey(page: Page): Promise<Any> {
  const n = (await m3d(page, "cursor")).strokes;
  await page.locator("#apply").focus();
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await m3d(page, "cursor")).strokes, { timeout: 120_000 }).toBe(n + 1);
  return (await m3d(page, "cursor")).report;
}
const residuals = async (page: Page) => { const c = await m3d(page, "census"); return [c.matterResidual, c.energyResidual]; };

test("Wound from the keyboard removes the particles it reports, the books stay at 0, and stepping and more strokes go on", async ({ page }) => {
  const errors = watch(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await open(page);
  await m3d(page, "runTo", 300);
  // keyboard: from Look, the arrow key moves the tool to Wound
  await page.getByRole("radio", { name: /^Look/ }).focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("radio", { name: /^Wound/ })).toBeChecked();
  await expect(page.locator("#brush")).toBeVisible();
  const cell = await m3d(page, "findCell", "particle");
  await setCell(page, cell, 2);
  const holds = (await m3d(page, "cursor")).holds;
  expect(holds.particles).toBeGreaterThan(0);
  await expect(page.locator("#cur-readout")).toContainText(`cell x ${cell.x}, y ${cell.y}, layer ${cell.z}`);
  const before = await m3d(page, "census");
  const r = await applyByKey(page);
  expect([r.kind, r.step, r.cx, r.cy, r.cz, r.radius]).toEqual(["wound", 300, cell.x, cell.y, cell.z, 2]);
  expect(r.removed).toBe(holds.particles);
  const after = await m3d(page, "census");
  expect(after.particles).toBe(before.particles - r.removed);
  expect([after.step, after.matterResidual, after.energyResidual]).toEqual([300, 0, 0]);
  expect(totalMatter(after)).toBe(totalMatter(before));
  await expect(page.locator("#r-n")).toHaveText(after.particles.toLocaleString("en-US"));
  await expect(page.locator("#r-m")).toHaveText("0");
  await expect(page.locator("#r-e")).toHaveText("0");
  await expect(page.locator("#brush-report")).toContainText(`Wound at step 300, cell x ${cell.x}, y ${cell.y}, layer ${cell.z}, radius 2: removed ${r.removed.toLocaleString("en-US")} particle`);
  await expect(page.locator("#brush-report")).toContainText("Matter residual 0, energy residual 0.");
  // the sphere is empty now, and the readout says so
  expect((await m3d(page, "cursor")).holds.particles).toBe(0);
  // stroke, step, stroke
  await m3d(page, "runTo", 400);
  expect(await residuals(page)).toEqual([0, 0]);
  const again = await m3d(page, "brush", { kind: "wound", ...(await m3d(page, "findCell", "particle")), cx: undefined, radius: 1 }).catch((e: unknown) => String(e));
  expect(String(again)).toMatch(/whole cells/); // a malformed stroke is refused calmly...
  expect((await m3d(page, "census")).step).toBe(400); // ...and the world is as it was
  const c2 = await m3d(page, "findCell", "particle");
  const r2 = await m3d(page, "brush", { kind: "wound", cx: c2.x, cy: c2.y, cz: c2.z, radius: 1 });
  expect(r2.removed).toBeGreaterThan(0);
  expect(await residuals(page)).toEqual([0, 0]);
  // while playing: the stroke waits its turn in the queue, and the run goes on with the books at 0
  await page.getByRole("button", { name: "Play" }).click();
  await expect.poll(async () => (await m3d(page, "census")).step, { timeout: 60_000 }).toBeGreaterThan(420);
  const c3 = await m3d(page, "findCell", "particle");
  // the cell came from a read-back a few steps old by the time the stroke runs, so reach wide enough to be sure of a hit
  const r3 = await m3d(page, "brush", { kind: "wound", cx: c3.x, cy: c3.y, cz: c3.z, radius: 6 });
  expect(r3.removed).toBeGreaterThan(0);
  expect((await m3d(page, "state")).running).toBe(true);
  await expect.poll(async () => (await m3d(page, "census")).step, { timeout: 60_000 }).toBeGreaterThan(r3.step + 20);
  await page.getByRole("button", { name: "Pause" }).click();
  await page.waitForFunction(() => !(window as Any).__m3d.state().running);
  await m3d(page, "runTo", (await m3d(page, "census")).step + 50);
  expect(await residuals(page)).toEqual([0, 0]);
  // a cell the peel hides is refused with words, and nothing changes
  await page.locator("#peel").fill("5");
  await setCell(page, { x: 3, y: 3, z: 1 });
  await expect(page.locator("#cur-readout")).toContainText("peeled or cut away");
  const n = (await m3d(page, "cursor")).strokes, stepNow = (await m3d(page, "census")).step;
  await page.locator("#apply").click();
  await expect(page.locator("#brush-report")).toContainText("Not applied: cell x 3, y 3, layer 1 is peeled or cut away");
  expect([(await m3d(page, "cursor")).strokes, (await m3d(page, "census")).step]).toEqual([n, stepNow]);
  expect((await vol(page)).errors).toEqual([]);
  expect(await page.evaluate(() => document.body.dataset.gpuError ?? null)).toBeNull();
  expect(errors).toEqual([]);
});

test("Feed turns waste into food on a sinking world with matter unchanged, and where there is no waste it converts nothing", async ({ page }) => {
  const errors = watch(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await open(page);
  await plantWith(page, { sink: "fast", seed: 3 });
  await m3d(page, "runTo", 800);
  await chooseTool(page, "Feed");
  await expect(page.getByRole("button", { name: "Feed here" })).toBeVisible();
  await expect(page.locator("#feed-help")).toContainText("Up to 256 waste");
  const cell = await m3d(page, "findCell", "waste");
  expect(cell).not.toBeNull();
  await setCell(page, cell, 1);
  await page.locator("#feed-amount").selectOption("4096");
  const holds = (await m3d(page, "cursor")).holds;
  expect(holds.waste).toBeGreaterThan(0);
  const before = await m3d(page, "census");
  const r = await applyByKey(page);
  expect(r.kind).toBe("feed");
  expect(r.matterMoved).toBeGreaterThan(0);
  expect(r.matterMoved).toBeLessThanOrEqual(holds.waste); // never more than was there
  expect(r.lightBooked).toBe(r.matterMoved * (await m3d(page, "config")).eA);
  const after = await m3d(page, "census");
  expect(totalMatter(after)).toBe(totalMatter(before));
  expect(after.particles).toBe(before.particles);
  expect([after.matterResidual, after.energyResidual]).toEqual([0, 0]);
  const sum = (c: Any, k: string) => c.groups.reduce((t: number, g: Any) => t + g[k], 0);
  expect(sum(before, "C") - sum(after, "C")).toBe(r.matterMoved);
  expect(sum(after, "A") - sum(before, "A")).toBe(r.matterMoved);
  await expect(page.locator("#brush-report")).toContainText(`turned ${r.matterMoved.toLocaleString("en-US")} waste into food in`);
  // no waste anywhere in a fresh jar: Feed converts nothing and says so
  await plantWith(page, { sink: "off", seed: 3 });
  await chooseTool(page, "Feed");
  const clean = await m3d(page, "findCell", "clean", 1);
  expect(clean).not.toBeNull();
  await setCell(page, clean, 1);
  expect((await m3d(page, "cursor")).holds.waste).toBe(0);
  await expect(page.locator("#cur-readout")).toContainText("none of them holds waste");
  const b2 = await m3d(page, "census");
  const r2 = await applyByKey(page);
  expect([r2.matterMoved, r2.lightBooked, r2.cellsWithoutWaste]).toEqual([0, 0, r2.cells]);
  await expect(page.locator("#brush-report")).toContainText("held waste, so nothing was turned into food");
  const a2 = await m3d(page, "census");
  expect([totalMatter(a2), a2.matterResidual, a2.energyResidual]).toEqual([totalMatter(b2), 0, 0]);
  await m3d(page, "runTo", 60);
  expect(await residuals(page)).toEqual([0, 0]);
  expect((await vol(page)).errors).toEqual([]);
  expect(errors).toEqual([]);
});

test("pointer: hovering draws the cursor sphere, a click in Wound mode wounds the visible cell it lands on, and a drag still turns the jar", async ({ page }) => {
  const errors = watch(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await open(page);
  await m3d(page, "runTo", 300);
  await m3d(page, "still");
  // Look: no sphere is drawn
  await m3d(page, "volumeDraw");
  expect((await m3d(page, "cursor")).drawn).toBe(false);
  await chooseTool(page, "Wound");
  const target = await m3d(page, "findCell", "particle");
  await page.locator("#volume-canvas").scrollIntoViewIfNeeded();
  const at2 = await m3d(page, "screenOf", target);
  await page.mouse.move(at2.x, at2.y);
  const hov = (await m3d(page, "cursor")).hover;
  expect(hov).not.toBeNull();
  await m3d(page, "volumeDraw");
  expect((await m3d(page, "cursor")).drawn).toBe(true);
  await expect(page.locator("#cur-readout")).toContainText(`Pointing at cell x ${hov.x}, y ${hov.y}, layer ${hov.z}`);
  const before = await m3d(page, "census");
  await page.mouse.down();
  await page.mouse.up();
  await expect.poll(async () => (await m3d(page, "cursor")).strokes, { timeout: 120_000 }).toBe(1);
  const cur = await m3d(page, "cursor");
  const r = cur.report;
  // the stroke landed on the cell the pointer showed, a cell the view shows, and took the particle under the pointer
  expect([r.cx, r.cy, r.cz]).toEqual([hov.x, hov.y, hov.z]);
  expect(cur.cell).toEqual(hov);
  expect(cur.shown).toBe(true);
  expect(r.removed).toBeGreaterThan(0);
  expect((await m3d(page, "census")).particles).toBe(before.particles - r.removed);
  expect(await residuals(page)).toEqual([0, 0]);
  await expect(page.locator("#cur-x")).toHaveValue(String(hov.x));
  await expect(page.locator("#cur-z")).toHaveValue(String(hov.z));
  // a drag turns the jar and wounds nothing
  const yaw0 = (await vol(page)).pose.yaw;
  await page.mouse.move(at2.x, at2.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(at2.x - i * 15, at2.y);
  await page.mouse.up();
  expect((await vol(page)).pose.yaw).not.toBeCloseTo(yaw0, 3);
  await page.waitForTimeout(300);
  expect((await m3d(page, "cursor")).strokes).toBe(1);
  // a click outside the jar is refused with words
  const box = (await page.locator("#volume-canvas").boundingBox())!;
  await page.mouse.click(box.x + 4, box.y + 4);
  await expect(page.locator("#brush-report")).toContainText("no part of the jar you can see is under the pointer");
  expect((await m3d(page, "cursor")).strokes).toBe(1);
  // back to Look: the sphere goes, a click does nothing
  await chooseTool(page, "Look");
  await m3d(page, "volumeDraw");
  expect((await m3d(page, "cursor")).drawn).toBe(false);
  expect((await vol(page)).errors).toEqual([]);
  expect(await page.evaluate(() => document.body.dataset.gpuError ?? null)).toBeNull();
  expect(errors).toEqual([]);
});

test.describe("touch", () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 375, height: 812 } });
  test("375 wide with a touch screen: a tap in Wound mode wounds where it lands, and a one-finger drag still turns the jar", async ({ page }) => {
    const errors = watch(page);
    await open(page);
    await m3d(page, "runTo", 300);
    await m3d(page, "still");
    await chooseTool(page, "Wound");
    const target = await m3d(page, "findCell", "particle");
    await page.locator("#volume-canvas").scrollIntoViewIfNeeded();
    const at = await m3d(page, "screenOf", target);
    const before = await m3d(page, "census");
    await page.touchscreen.tap(at.x, at.y);
    await expect.poll(async () => (await m3d(page, "cursor")).strokes, { timeout: 120_000 }).toBe(1);
    const cur = await m3d(page, "cursor");
    expect(cur.shown).toBe(true);
    expect([cur.report.cx, cur.report.cy, cur.report.cz]).toEqual([cur.cell.x, cur.cell.y, cur.cell.z]);
    expect(cur.report.removed).toBeGreaterThan(0);
    expect((await m3d(page, "census")).particles).toBe(before.particles - cur.report.removed);
    expect(await residuals(page)).toEqual([0, 0]);
    // a drag with one finger, as real touch input (CDP): orbits, no stroke
    const yaw0 = (await vol(page)).pose.yaw;
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: at.x, y: at.y }] });
    for (let i = 1; i <= 8; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: at.x - i * 12, y: at.y }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    expect((await vol(page)).pose.yaw).not.toBeCloseTo(yaw0, 3);
    await page.waitForTimeout(300);
    expect((await m3d(page, "cursor")).strokes).toBe(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect((await vol(page)).errors).toEqual([]);
    expect(errors).toEqual([]);
  });
});

test("bonds free: a wound that cuts bonds leaves one link per remaining bond (two stubs across a seam) after the refresh", async ({ page }) => {
  const errors = watch(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await open(page, "?bonds=free");
  await m3d(page, "runTo", 300);
  const b0 = await m3d(page, "bonds");
  expect(b0.readout.bonds).toBeGreaterThan(0);
  const cell = await m3d(page, "findCell", "bonded");
  expect(cell).not.toBeNull();
  const r = await m3d(page, "brush", { kind: "wound", cx: cell.x, cy: cell.y, cz: cell.z, radius: 0 });
  expect(r.bondsCut).toBeGreaterThan(0);
  await m3d(page, "volumeDraw");
  const b = await m3d(page, "bonds");
  expect(b.readout.bonds).toBe(b0.readout.bonds - r.bondsCut); // no step between: exactly the bonds the report cut are gone
  expect(b.packed.bonds).toBe(b.readout.bonds);
  expect(b.uploaded).toBe(b.readout.bonds + b.packed.seamBonds);
  await expect(page.locator("#r-bonds")).toHaveText(b.readout.bonds.toLocaleString("en-US"));
  expect(await residuals(page)).toEqual([0, 0]);
  await m3d(page, "runTo", 350);
  expect(await residuals(page)).toEqual([0, 0]);
  expect((await vol(page)).errors).toEqual([]);
  expect(errors).toEqual([]);
});

test("the CPU reference takes strokes too: Wound and Feed from the inputs, the books at 0, stepping on", async ({ page }) => {
  const errors = watch(page);
  await page.addInitScript(() => { Object.defineProperty(Navigator.prototype, "gpu", { get: () => undefined, configurable: true }); });
  await open(page, "?sink=fast");
  expect((await m3d(page, "state")).engine).toBe("cpu");
  await m3d(page, "runTo", 120);
  await chooseTool(page, "Wound");
  await expect(page.locator("#tool-help")).toContainText("cannot be pointed at");
  const cell = await m3d(page, "findCell", "particle");
  await setCell(page, cell, 2);
  const before = await m3d(page, "census");
  const r = await applyByKey(page);
  expect(r.removed).toBeGreaterThan(0);
  const after = await m3d(page, "census");
  expect([after.particles, after.matterResidual, after.energyResidual, totalMatter(after)]).toEqual([before.particles - r.removed, 0, 0, totalMatter(before)]);
  await chooseTool(page, "Feed");
  const w = await m3d(page, "findCell", "waste");
  await setCell(page, w, 1);
  const f = await applyByKey(page);
  expect(f.matterMoved).toBeGreaterThan(0);
  expect(await residuals(page)).toEqual([0, 0]);
  await m3d(page, "runTo", 160);
  const c = await m3d(page, "census");
  expect([c.step, c.matterResidual, c.energyResidual]).toEqual([160, 0, 0]);
  expect(errors).toEqual([]);
});

for (const theme of ["light", "dark"] as const) {
  for (const width of [1280, 375] as const) {
    test(`${width} wide, ${theme}, Wound tool open: no sideways scroll, no serious axe findings, every control by keyboard`, async ({ page }) => {
      const errors = watch(page);
      await page.addInitScript((t) => { try { localStorage.setItem("browser-life-theme", t); } catch { /* ignore */ } }, theme);
      await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
      await open(page);
      await m3d(page, "runTo", 100);
      await chooseTool(page, "Wound");
      await expect(page.locator("#cur-readout")).toContainText("Cursor at cell");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.evaluate(() => window.scrollTo(0, 0));
      const res = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
      expect(res.violations.filter((v) => v.impact === "serious" || v.impact === "critical"), JSON.stringify(res.violations.map((v) => [v.id, v.nodes.map((n) => n.target)]))).toEqual([]);
      // keyboard: from the Wound radio, Tab walks x, y, layer, radius and the button in order, and Enter strokes
      await page.getByRole("radio", { name: /^Wound/ }).focus();
      const order: string[] = [];
      for (let i = 0; i < 5; i++) { await page.keyboard.press("Tab"); order.push(await page.evaluate(() => document.activeElement?.id ?? "")); }
      expect(order).toEqual(["cur-x", "cur-y", "cur-z", "cur-r", "apply"]);
      await page.keyboard.press("Shift+Tab");
      await page.keyboard.press("ArrowRight"); // radius 3
      await expect(page.locator("#cur-r-out")).toHaveText("3");
      const r = await applyByKey(page);
      expect(r.radius).toBe(3);
      expect(await residuals(page)).toEqual([0, 0]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      expect((await vol(page)).errors).toEqual([]);
      expect(errors).toEqual([]);
    });
  }
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

test("capture: bonds, a jar with free bonds and its links, in the light and dark themes", async ({ page }) => {
  test.skip(!SHOTS, "set BL_M3D_SHOTS to a directory to capture");
  test.setTimeout(1_800_000);
  const steps = Number(process.env.BL_M3D_BOND_STEPS || 1500);
  mkdirSync(SHOTS!, { recursive: true });
  const out: Record<string, unknown> = {};
  for (const theme of ["light", "dark"] as const) {
    await page.addInitScript((t) => { try { localStorage.setItem("browser-life-theme", t); } catch { /* ignore */ } }, theme);
    await page.setViewportSize({ width: 1280, height: 900 });
    await open(page, "?bonds=free&seed=2");
    await page.addStyleTag({ content: ".site-header { position: static !important; } .skip { display: none !important; }" });
    for (let s = 0; s < steps;) { s = Math.min(steps, s + 500); await m3d(page, "runTo", s); }
    await m3d(page, "still");
    const shot = async (name: string, el = "#gpu-fig") => { await m3d(page, "volumeDraw"); await page.locator(el).screenshot({ path: join(SHOTS!, name) }); };
    await shot(`bonds-${theme}-1280.png`);
    await m3d(page, "still", { dist: 0.7 });
    await shot(`bonds-${theme}-1280-close.png`);
    await m3d(page, "still", { dist: 1.45 });
    await page.locator("#show-waste").uncheck();
    await shot(`bonds-${theme}-1280-nowaste.png`);
    await page.locator("#show-waste").check();
    await page.locator(".m3-census").screenshot({ path: join(SHOTS!, `bonds-${theme}-census.png`) });
    out[theme] = await m3d(page, "bonds");
    await page.setViewportSize({ width: 375, height: 812 });
    await page.waitForTimeout(500);
    await shot(`bonds-${theme}-375.png`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect((await vol(page)).errors).toEqual([]);
  }
  // a 64 x 64 x 32 jar: links at a small scale, and the cut face (no link pokes out of it)
  await page.setViewportSize({ width: 1280, height: 900 });
  await open(page, "?bonds=free&seed=2&size=64x64x32");
  for (let s = 0; s < steps;) { s = Math.min(steps, s + 500); await m3d(page, "runTo", s); }
  await m3d(page, "still");
  const shot = async (name: string) => { await m3d(page, "volumeDraw"); await page.locator("#gpu-fig").screenshot({ path: join(SHOTS!, name) }); };
  await shot("bonds-64-1280.png");
  await page.locator("#cut").fill("50");
  await shot("bonds-64-1280-cut50.png");
  await m3d(page, "still", { dist: 0.6 });
  await shot("bonds-64-1280-cut50-close.png");
  await page.locator("#cut").fill("100");
  out.big = await m3d(page, "bonds");
  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForTimeout(500);
  await m3d(page, "still", { dist: 1.45 });
  await shot("bonds-64-375.png");
  expect((await vol(page)).errors).toEqual([]);
  // the CPU reference's side view, with its bond lines
  await page.addInitScript(() => { Object.defineProperty(Navigator.prototype, "gpu", { get: () => undefined, configurable: true }); });
  await page.setViewportSize({ width: 1280, height: 900 });
  await open(page, "?bonds=free&seed=2");
  await m3d(page, "runTo", 200);
  await page.locator("#cpu-fig").screenshot({ path: join(SHOTS!, "bonds-cpu-side.png") });
  out.cpu = await m3d(page, "bonds");
  writeFileSync(join(SHOTS!, "bonds.json"), JSON.stringify(out, null, 2));
});

/** Mean ms per fresh draw with the current tool (Wound or Feed, the cursor drawn) and again in Look, then back. */
async function drawCost(page: Page) {
  const wound = await m3d(page, "timeDraw", 20);
  await chooseTool(page, "Look");
  const look = await m3d(page, "timeDraw", 20);
  await chooseTool(page, "Wound");
  return { wound: +wound.toFixed(2), look: +look.toFixed(2) };
}

test("capture: the cursor, its sphere in Wound mode and the hole after a stroke, at 1280 and 375 wide", async ({ page }) => {
  test.skip(!SHOTS, "set BL_M3D_SHOTS to a directory to capture");
  test.setTimeout(1_800_000);
  mkdirSync(SHOTS!, { recursive: true });
  const out: Record<string, unknown> = {};
  for (const width of [1280, 375] as const) {
    await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
    await open(page, "?seed=2");
    await page.addStyleTag({ content: ".site-header { position: static !important; } .skip { display: none !important; }" });
    await m3d(page, "runTo", 600);
    await m3d(page, "still", { dist: 1.05 });
    await chooseTool(page, "Wound");
    // a cell in the crowd just under the surface, so the sphere has beads around it and in front of it
    const cell = { x: 16, y: 16, z: 1 };
    await setCell(page, cell, 3);
    const shot = async (name: string, el = "#gpu-fig") => { await m3d(page, "volumeDraw"); await page.locator(el).screenshot({ path: join(SHOTS!, name) }); };
    await shot(`cursor-${width}.png`);
    await page.locator("#peel").fill("1");
    await shot(`cursor-${width}-peel1.png`);
    await page.locator("#peel").fill("0");
    // level with the jar, cut through the centre row (rows 0 to 16 kept): the sphere's cross-section on the cut face
    const cutShot = async (name: string) => {
      await m3d(page, "still", { yaw: 0, pitch: 0.12, dist: 0.75 });
      await page.locator("#cut").fill("54");
      await shot(name);
      await page.locator("#cut").fill("100");
      await m3d(page, "still", { yaw: 0.6, pitch: 0.62, dist: 1.05 });
    };
    await cutShot(`cursor-${width}-cut.png`);
    await page.locator("#tools").screenshot({ path: join(SHOTS!, `cursor-${width}-tools.png`) });
    const before = await m3d(page, "cursor");
    if (width === 1280) out.drawMsWoundVsLook32 = await drawCost(page);
    const r = await applyByKey(page);
    await shot(`cursor-${width}-after.png`);
    // the surface layer peeled: the sphere and the hole in layers 1 to 4 in the open
    await page.locator("#peel").fill("1");
    await shot(`cursor-${width}-after-peel1.png`);
    await page.locator("#peel").fill("0");
    await cutShot(`cursor-${width}-after-cut.png`);
    await chooseTool(page, "Look");
    await shot(`cursor-${width}-after-look.png`);
    out[width] = { cell, before: { holds: before.holds, readout: before.readout, drawn: before.drawn }, report: r, census: await m3d(page, "census") };
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect((await vol(page)).errors).toEqual([]);
  }
  // the cost of the cursor pass on the cube, the biggest jar: draw time with the Wound cursor on and in Look
  await page.setViewportSize({ width: 1280, height: 900 });
  await open(page, "?size=64x64x64&seed=2");
  await m3d(page, "runTo", 200);
  await m3d(page, "still");
  await chooseTool(page, "Wound");
  await page.locator("#cur-r").fill("8");
  out.drawMsWoundVsLook64 = await drawCost(page);
  writeFileSync(join(SHOTS!, "cursor.json"), JSON.stringify(out, null, 2));
});
