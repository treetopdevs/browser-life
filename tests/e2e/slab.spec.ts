/// <reference types="node" />
// The slab viewer (/slab/) in real Chrome with WebGPU: real kernels, real readbacks, real canvases.
// Run: BL_E2E_PORT=5266 npx playwright test tests/e2e/slab.spec.ts --workers=1
// Debug hooks (`?debug=1` only) expose the last raw snapshot, a run-to-step and an independent reference run; they are
// read-only views for these tests and exist nowhere else.
import { AxeBuilder } from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CYCLIC_COLOURS, EMPTY_RGB, lineagePixel } from "../../apps/lab/src/slab/render.ts";

test.describe.configure({ mode: "serial" });
test.skip(({ browserName }) => browserName !== "chromium", "WebGPU Chrome only");

// Routine runs write captures to the test output folder; the recorded evidence under docs/ is replaced only with BL_RECORD_EVIDENCE=1.
const EVIDENCE_SHOTS = fileURLToPath(new URL("../../docs/visualization-gaps-2026-11-14/slab-viewer/shots/", import.meta.url));
const RECORD = process.env.BL_RECORD_EVIDENCE === "1";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

async function open(page: Page, query = "") {
  await page.goto(`/slab/?debug=1${query}`);
  await page.waitForFunction(() => (window as Any).__slab && (window as Any).__slab.step() >= 0, null, { timeout: 120_000 });
}
const radio = (page: Page, name: RegExp) => page.getByRole("radio", { name });
const stepOf = (page: Page) => page.evaluate(() => (window as Any).__slab.step() as number);
async function runTo(page: Page, n: number) { await page.evaluate((k) => (window as Any).__slab.runTo(k), n); }
async function rebuilt(page: Page) { await page.waitForFunction(() => (window as Any).__slab.step() >= 0 && (window as Any).__slab.counts().live === 1 && (window as Any).__slab.counts().pending === 0, null, { timeout: 120_000 }); }

/** Distinct colours and a hash of a canvas. */
async function canvasInfo(page: Page, id: string) {
  return page.evaluate((cid) => {
    const c = document.getElementById(cid) as HTMLCanvasElement;
    const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
    const seen = new Set<number>();
    let h = 0x811c9dc5;
    for (let i = 0; i < d.length; i += 4) {
      seen.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
      h = Math.imul(h ^ d[i] ^ (d[i + 1] << 8) ^ (d[i + 2] << 16), 0x01000193) >>> 0;
    }
    return { distinct: seen.size, hash: h, w: c.width, h2: c.height };
  }, id);
}

/** Cells of the last raw frame at the given (x, y, z) coordinates, and the page's pixel there. */
async function sample(page: Page, coords: [number, number, number][]) {
  return page.evaluate((cs) => {
    const f = (window as Any).__slab.frame();
    const { W, H } = f.dims;
    return cs.map(([x, y, z]: number[]) => {
      const i = (z * H + y) * W + x;
      const c = document.getElementById(`tile-${z}`) as HTMLCanvasElement;
      const px = Array.from(c.getContext("2d")!.getImageData(x, y, 1, 1).data.slice(0, 3));
      const cell = f.kind === "cyclic" ? { label: f.labels[i] } : { hi: f.hi[i], lo: f.lo[i], B: f.B[i], P: f.P[i], A: f.A[i] };
      return { px, cell };
    });
  }, coords);
}
const statusText = (page: Page) => page.locator("#status").innerText();

test("cyclic: canvases are not blank and change between steps; the step counter moves", async ({ page }) => {
  await open(page);
  expect(await stepOf(page)).toBe(0);
  for (const id of ["combined", "tile-0", "tile-1", "tile-2", "tile-3"]) expect((await canvasInfo(page, id)).distinct, id).toBeGreaterThan(1);
  const before = await canvasInfo(page, "combined");
  await page.getByRole("button", { name: "Step +100" }).click();
  await expect.poll(() => stepOf(page)).toBe(100);
  await expect(page.locator("#status")).toContainText("step 100");
  expect((await canvasInfo(page, "combined")).hash).not.toBe(before.hash);
  await expect(page.locator("#status")).toContainText("kill off");
});

test("cyclic census adds up and matches the raw snapshot", async ({ page }) => {
  await open(page);
  await runTo(page, 300);
  const shares = await page.locator("[data-census]").allInnerTexts();
  expect(shares).toHaveLength(4);
  const pct = shares.map((t) => Number(/([\d.]+) %/.exec(t)![1]));
  expect(pct.reduce((a, b) => a + b, 0)).toBeGreaterThan(99.7);
  expect(pct.reduce((a, b) => a + b, 0)).toBeLessThan(100.3);
  const raw = await page.evaluate(() => {
    const f = (window as Any).__slab.frame();
    const c = [0, 0, 0, 0];
    for (const l of f.labels) c[l < 3 ? l : 3]++;
    return c.map((v) => (100 * v) / f.labels.length);
  });
  raw.forEach((v: number, i: number) => expect(pct[i]).toBeCloseTo(v, 1));
});

test("pictures match the page's own frame, layer by layer; the frame matches an independent direct readback (cyclic and ecology)", async ({ page }) => {
  await open(page);
  await runTo(page, 600); // layers have diverged by now; the founding is columns, identical in every layer
  const dims = await page.evaluate(() => (window as Any).__slab.frame().dims);
  // The same (x, y) at every depth: a duplicated or reversed layer shows up as a pixel that no longer equals its own layer's cell.
  const cs: [number, number, number][] = [];
  for (let k = 0; k < 80; k++) for (let z = 0; z < dims.D; z++) cs.push([(k * 37) % dims.W, (k * 53 + 3) % dims.H, z]);
  const got = await sample(page, cs);
  for (const g of got) {
    const want = g.cell.label < 3 ? CYCLIC_COLOURS[g.cell.label] : EMPTY_RGB;
    expect(g.px).toEqual([...want]);
  }
  // every pair of layers must differ somewhere in the raw frame and, at the same coordinates, in the pixels
  for (let a = 0; a < dims.D; a++) for (let b = a + 1; b < dims.D; b++) {
    let rawDiff = 0, pxDiff = 0;
    for (let k = 0; k < 80; k++) {
      const ga = got[k * dims.D + a], gb = got[k * dims.D + b];
      if (ga.cell.label !== gb.cell.label) rawDiff++;
      if (ga.px.join() !== gb.px.join()) pxDiff++;
    }
    expect(rawDiff, `layers ${a} and ${b} differ in the raw frame`).toBeGreaterThan(0);
    expect(pxDiff, `layers ${a} and ${b} differ in the pixels`).toBeGreaterThan(0);
  }
  // independent oracle: the spike's own harness path (no adapter, no slicing), same seed and step, compared cell by cell
  const live = await page.evaluate(() => Array.from((window as Any).__slab.frame().labels as Uint8Array));
  const ref = await page.evaluate(() => (window as Any).__slab.reference(600));
  expect(ref.step).toBe(600);
  expect(ref.labels).toEqual(live);
  // per-layer counts from the raw snapshot against the captions
  const perLayer = await page.evaluate(() => {
    const f = (window as Any).__slab.frame();
    const plane = f.dims.W * f.dims.H;
    return Array.from({ length: f.dims.D }, (_, z) => { let e = 0; for (let i = z * plane; i < (z + 1) * plane; i++) if (f.labels[i] >= 3) e++; return (100 * e) / plane; });
  });
  const caps = await page.locator(".slab-tile figcaption").allInnerTexts();
  perLayer.forEach((v: number, z: number) => expect(Number(/empty ([\d.]+) %/.exec(caps[z])![1])).toBeCloseTo(v, 1));
  // ecology
  await radio(page, /Slab ecology/).click();
  await rebuilt(page);
  await runTo(page, 400);
  const edims = await page.evaluate(() => (window as Any).__slab.frame().dims);
  expect(edims.D).toBe(8);
  const ecs: [number, number, number][] = [];
  for (let k = 0; k < 40; k++) for (let z = 0; z < edims.D; z++) ecs.push([(k * 37) % edims.W, (k * 53 + 3) % edims.H, z]);
  const egot = await sample(page, ecs);
  for (const g of egot) expect(g.px).toEqual([...lineagePixel(g.cell.hi, g.cell.lo, g.cell.B, g.cell.P, g.cell.A)]);
  const livingLayers = await page.evaluate(() => {
    const f = (window as Any).__slab.frame();
    const plane = f.dims.W * f.dims.H;
    return Array.from({ length: f.dims.D }, (_, z) => { let e = 0; for (let i = z * plane; i < (z + 1) * plane; i++) if (f.hi[i] | f.lo[i]) e++; return (100 * e) / plane; });
  });
  const ecaps = await page.locator(".slab-tile figcaption").allInnerTexts();
  livingLayers.forEach((v: number, z: number) => expect(Number(/living ([\d.]+) %/.exec(ecaps[z])![1])).toBeCloseTo(v, 1));
  // independent oracle for the ecology: a fresh stock simulator read with the raw readers, every channel, every cell
  const cmp = await page.evaluate(() => (window as Any).__slab.ecoCompare(400));
  expect(cmp.step).toBe(400);
  expect(cmp.shownStep).toBe(400);
  expect(cmp.firstDiff).toEqual({ B: -1, P: -1, A: -1, hi: -1, lo: -1 });
});

test("play advances the counter and pause stops it", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Play" }).click();
  await expect.poll(() => stepOf(page), { timeout: 30_000 }).toBeGreaterThan(100);
  await page.getByRole("button", { name: "Pause" }).click();
  await page.waitForTimeout(800);
  const a = await stepOf(page);
  await page.waitForTimeout(600);
  expect(await stepOf(page)).toBe(a);
  expect(a % 20).toBe(0);
});

test("ecology: eight tiles, non-blank, census per layer", async ({ page }) => {
  await open(page);
  await radio(page, /Slab ecology/).click();
  await rebuilt(page);
  expect(await page.locator(".slab-tile").count()).toBe(8);
  await runTo(page, 300);
  expect((await canvasInfo(page, "combined")).distinct).toBeGreaterThan(2);
  for (let z = 0; z < 8; z++) expect((await canvasInfo(page, `tile-${z}`)).distinct, `tile ${z}`).toBeGreaterThan(1);
  expect(await page.locator("[data-census^=layer]").count()).toBe(8);
  await expect(page.locator("[data-census=total]")).toContainText("living");
});

test("ecology reproduces the recorded living fractions at steps 5,000 and 10,000", async ({ page }) => {
  test.setTimeout(420_000);
  await open(page);
  await radio(page, /Slab ecology/).click();
  await rebuilt(page);
  const check = async (n: number, want: number) => {
    await runTo(page, n);
    const { living, census } = await page.evaluate(async () => {
      const s = (window as Any).__slab;
      const f = s.frame();
      let c = 0;
      for (let i = 0; i < f.hi.length; i++) if (f.hi[i] | f.lo[i]) c++;
      return { living: (await s.living()) as number, census: c };
    });
    expect(await stepOf(page)).toBe(n);
    expect(+(living / 524288).toFixed(4)).toBe(want);
    expect(census).toBe(living);
  };
  await check(5000, 0.0419);
  await check(10000, 0.5426);
});

test("hand-over: the kill turns on exactly at step 6,000 and the labels equal a direct spike run", async ({ page }) => {
  test.setTimeout(300_000);
  await open(page);
  await radio(page, /^128 by 128 by 4 /).click();
  await rebuilt(page);
  await runTo(page, 5950);
  await expect(page.locator("#status")).toContainText("kill off");
  await page.getByRole("button", { name: "Step +100" }).click();
  await expect.poll(() => stepOf(page)).toBe(6050);
  await expect(page.locator("#status")).toContainText("kill on");
  await runTo(page, 6200);
  const live = await page.evaluate(() => Array.from((window as Any).__slab.frame().labels as Uint8Array));
  const ref = await page.evaluate(() => (window as Any).__slab.reference(6200));
  expect(ref.step).toBe(6200);
  expect(ref.labels).toEqual(live);
  // a 400-step pace that straddles 6,000: start from step 1
  await page.locator("#seed").fill("402"); // restarts from step 0
  await page.locator("#seed").dispatchEvent("change");
  await rebuilt(page);
  await page.getByRole("button", { name: "Step +1", exact: true }).click();
  await expect.poll(() => stepOf(page)).toBe(1);
  await radio(page, /Fastest/).click();
  await page.getByRole("button", { name: "Play" }).click();
  await expect.poll(() => stepOf(page), { timeout: 120_000 }).toBeGreaterThan(6001);
  await page.getByRole("button", { name: "Pause" }).click();
  await page.waitForTimeout(1500);
  const n = await stepOf(page);
  expect((n - 1) % 400).toBe(0);
  const live2 = await page.evaluate(() => Array.from((window as Any).__slab.frame().labels as Uint8Array));
  const ref2 = await page.evaluate((k) => (window as Any).__slab.reference(k), n);
  expect(ref2.step).toBe(n);
  expect(ref2.labels).toEqual(live2);
});

test("rapid changes leave exactly one simulator, the final settings, and no console error", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await open(page);
  await page.evaluate(() => {
    const click = (re: RegExp) => { const l = [...document.querySelectorAll<HTMLLabelElement>("label.slab-opt")].find((x) => re.test(x.textContent ?? "")); l?.querySelector("input")?.click(); };
    click(/Slab ecology/); click(/128 by 128 by 8/); click(/Cyclic competition/); click(/128 by 128 by 4/); click(/Slab ecology/);
    click(/Sparse corner/); click(/Cyclic competition/); click(/Removal kill/);
    const seed = document.getElementById("seed") as HTMLInputElement;
    seed.value = "402"; seed.dispatchEvent(new Event("change"));
    seed.value = "403"; seed.dispatchEvent(new Event("change"));
  });
  await rebuilt(page);
  await page.waitForTimeout(1500);
  const c = await page.evaluate(() => ({ counts: (window as Any).__slab.counts(), state: (window as Any).__slab.state(), step: (window as Any).__slab.step() }));
  expect(c.counts.live).toBe(1);
  expect(c.step).toBe(0);
  expect(c.state.world).toBe("cyclic");
  expect(c.state.cyc.kill).toBe("removal");
  expect(c.state.cyc.seed).toBe(403);
  expect(c.state.cyc.size).toEqual([128, 128, 4]);
  expect(errors).toEqual([]);
});

test("controls explain themselves, and changing the seed restarts at step 0", async ({ page }) => {
  await open(page);
  for (const world of [/Cyclic competition/, /Slab ecology/]) {
    await radio(page, world).click();
    await rebuilt(page);
    const radios = page.locator("fieldset:not([hidden]) input[type=radio]");
    const n = await radios.count();
    expect(n).toBeGreaterThanOrEqual(8);
    for (let i = 0; i < n; i++) {
      const text = await radios.nth(i).evaluate((el) => {
        const id = el.getAttribute("aria-describedby");
        return id ? document.getElementById(id)?.textContent?.trim() ?? "" : "";
      });
      expect(text.length, `radio ${i}`).toBeGreaterThan(20);
    }
  }
  for (const id of ["play", "step1", "step100", "seed", "layer"]) {
    const d = await page.locator(`#${id}`).getAttribute("aria-describedby");
    expect(d, id).toBeTruthy();
    expect((await page.locator(`#${d}`).innerText()).length).toBeGreaterThan(20);
  }
  await runTo(page, 300);
  expect(await stepOf(page)).toBe(300);
  await page.locator("#seed").fill("102");
  await page.locator("#seed").dispatchEvent("change");
  await rebuilt(page);
  await expect.poll(() => stepOf(page)).toBe(0);
  await expect(page.locator("#provenance")).toContainText("Exploration, not a result");
});

test("isolate a layer: the large view equals that layer's tile", async ({ page }) => {
  await open(page);
  await runTo(page, 400);
  await radio(page, /One layer/).click();
  await page.locator("#layer").fill("2");
  await expect(page.locator("#layer-out")).toHaveText("2");
  const big = await canvasInfo(page, "combined");
  const tile = await canvasInfo(page, "tile-2");
  expect(big.hash).toBe(tile.hash);
  await radio(page, /Combined/).click();
  expect((await canvasInfo(page, "combined")).hash).not.toBe(tile.hash);
});

for (const theme of ["light", "dark"] as const) {
  for (const [width, height] of [[1280, 900], [375, 812]]) {
    test(`axe: no serious findings at ${width} wide, ${theme}`, async ({ page }) => {
      await page.addInitScript((t) => { try { localStorage.setItem("browser-life-theme", t); } catch { /* ignore */ } }, theme);
      await page.setViewportSize({ width, height });
      await open(page);
      await runTo(page, 200);
      const res = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
      expect(res.violations.filter((v) => v.impact === "serious" || v.impact === "critical"), JSON.stringify(res.violations.map((v) => [v.id, v.nodes.map((n) => n.target)]))).toEqual([]);
      if (width === 375) expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });
  }
}

test("keyboard only at 375: every control is reached in order, Space operates play, focus is visible", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await open(page);
  const seen: string[] = [];
  for (let i = 0; i < 80; i++) {
    await page.keyboard.press("Tab");
    const info = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement;
      const cs = getComputedStyle(el);
      return { id: el.id, name: el.getAttribute("name") ?? "", tag: el.tagName, outline: cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0, parentOutline: !!el.closest("label.slab-opt") && getComputedStyle(el.closest("label.slab-opt")!).outlineStyle !== "none" };
    });
    if (info.tag === "INPUT" && (info as Any).name) seen.push(`radio:${info.name}`); else if (info.id) seen.push(info.id);
    if (["play", "seed", "layer"].includes(info.id) || info.tag === "BUTTON") expect(info.outline || info.id === "", info.id).toBe(true);
    if (info.tag === "INPUT" && info.name) expect(info.parentOutline || info.outline).toBe(true);
    if (info.id === "step100") { break; }
  }
  const order = ["radio:world", "radio:size", "radio:burn", "seed", "radio:pace", "radio:view", "layer", "play", "step1", "step100"];
  let at = -1;
  for (const o of order) { const k = seen.indexOf(o, at + 1); expect(k, `${o} in ${seen.join(",")}`).toBeGreaterThan(at); at = k; }
  await page.locator("#play").focus();
  await page.keyboard.press("Space");
  await expect(page.locator("#play")).toHaveText("Pause");
  await page.keyboard.press("Enter");
  await expect(page.locator("#play")).toHaveText("Play");
});

test("arrow keys move through a radio group and keep keyboard focus after the controls rebuild", async ({ page }) => {
  await open(page);
  await radio(page, /Cyclic competition/).focus();
  await page.keyboard.press("ArrowDown");
  await rebuilt(page);
  let at = await page.evaluate(() => { const e = document.activeElement as HTMLInputElement; return { tag: e.tagName, name: e.name, value: e.value, checked: e.checked }; });
  expect(at).toEqual({ tag: "INPUT", name: "world", value: "eco", checked: true });
  expect((await page.evaluate(() => (window as Any).__slab.state())).world).toBe("eco");
  await page.keyboard.press("ArrowUp");
  await rebuilt(page);
  at = await page.evaluate(() => { const e = document.activeElement as HTMLInputElement; return { tag: e.tagName, name: e.name, value: e.value, checked: e.checked }; });
  expect(at).toEqual({ tag: "INPUT", name: "world", value: "cyclic", checked: true });
  // a group that rebuilds the controls on change but not the world group: kill rule, then arrow again
  await radio(page, /Removal kill/).focus();
  await page.keyboard.press("ArrowDown");
  await rebuilt(page);
  at = await page.evaluate(() => { const e = document.activeElement as HTMLInputElement; return { tag: e.tagName, name: e.name, value: e.value, checked: e.checked }; });
  expect(at).toEqual({ tag: "INPUT", name: "kill", value: "none", checked: true });
});

test("a layer chosen on the ecology (7) is clamped, with the readout, when the cyclic world is chosen", async ({ page }) => {
  await open(page);
  await radio(page, /Slab ecology/).click();
  await rebuilt(page);
  await radio(page, /One layer/).click();
  await page.locator("#layer").fill("7");
  await expect(page.locator("#layer-out")).toHaveText("7");
  await radio(page, /Cyclic competition/).click();
  await rebuilt(page);
  await expect(page.locator("#layer-out")).toHaveText("3");
  expect(await page.locator("#layer").inputValue()).toBe("3");
});

test("a world switched mid-read is never painted under the new controls", async ({ page }) => {
  await open(page);
  await rebuilt(page); // the first picture is on screen
  // Hold the next read open after its readback has finished, so the world is switched while a read is certainly pending.
  await page.evaluate(() => { (window as Any).__slab.holdReads(); document.getElementById("step100")!.click(); });
  await page.waitForFunction(() => (window as Any).__slab.held() === 1, null, { timeout: 60_000 });
  await radio(page, /Slab ecology/).click();
  // controls that redraw the cached picture must not use the superseded one either
  await radio(page, /One layer/).click();
  await page.locator("#layer").fill("2");
  await page.evaluate(() => (window as Any).__slab.releaseReads());
  await rebuilt(page);
  await page.waitForTimeout(300);
  const draws: string[] = await page.evaluate(() => (window as Any).__slab.draws());
  // every picture is painted under the world chosen at the time: a cyclic frame must never be drawn once the ecology is chosen
  expect(draws.filter((d) => d.startsWith("eco:cyclic")), draws.join(" ")).toEqual([]);
  expect(draws).toContain("eco:eco@0");
});

test("a run-to in flight when the world is switched never paints the old simulator", async ({ page }) => {
  await open(page);
  await rebuilt(page);
  await page.evaluate(() => {
    (window as Any).__slab.runTo(6200); // crosses the 6,000-step hand-over; not awaited
    const click = (re: RegExp) => { const l = [...document.querySelectorAll<HTMLLabelElement>("label.slab-opt")].find((x) => re.test(x.textContent ?? "")); l?.querySelector("input")?.click(); };
    setTimeout(() => click(/Slab ecology/), 150);
  });
  await rebuilt(page);
  await page.waitForTimeout(500);
  const draws: string[] = await page.evaluate(() => (window as Any).__slab.draws());
  expect(draws.filter((d) => d.startsWith("eco:cyclic")), draws.join(" ")).toEqual([]);
  expect(draws).toContain("eco:eco@0");
});

test("a run-to still waiting in the queue when the world is switched does nothing", async ({ page }) => {
  await open(page);
  await rebuilt(page);
  // Hold a read open so the run-to is queued behind it, then switch the world before the queue reaches it.
  await page.evaluate(() => { (window as Any).__slab.holdReads(); document.getElementById("step100")!.click(); });
  await page.waitForFunction(() => (window as Any).__slab.held() === 1, null, { timeout: 60_000 });
  await page.evaluate(() => { void (window as Any).__slab.runTo(6200); });
  await radio(page, /Slab ecology/).click();
  await page.evaluate(() => (window as Any).__slab.releaseReads());
  await rebuilt(page);
  await page.waitForTimeout(500);
  const draws: string[] = await page.evaluate(() => (window as Any).__slab.draws());
  expect(draws.filter((d) => d.startsWith("eco:cyclic")), draws.join(" ")).toEqual([]);
  expect(draws).toContain("eco:eco@0");
});

test("kill on from step 0: the live labels equal a direct run with the kill on throughout", async ({ page }) => {
  await open(page);
  await radio(page, /^128 by 128 by 4 /).click();
  await rebuilt(page);
  await radio(page, /Kill on from step 0/).click();
  await rebuilt(page);
  await runTo(page, 300);
  await expect(page.locator("#status")).toContainText("kill on");
  const live = await page.evaluate(() => Array.from((window as Any).__slab.frame().labels as Uint8Array));
  const ref = await page.evaluate(() => (window as Any).__slab.reference(300));
  expect(ref.step).toBe(300);
  expect(ref.labels).toEqual(live);
});

test("an empty or fractional seed is rejected and the box returns to the running seed", async ({ page }) => {
  await open(page);
  const seed = page.locator("#seed");
  await seed.fill("");
  await seed.dispatchEvent("change");
  await expect(seed).toHaveValue("401");
  await seed.fill("1.5");
  await seed.dispatchEvent("change");
  await expect(seed).toHaveValue("401");
  expect((await page.evaluate(() => (window as Any).__slab.state())).cyc.seed).toBe(401);
});

test("no WebGPU: a plain message and no error", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => { Object.defineProperty(Navigator.prototype, "gpu", { get: () => undefined, configurable: true }); });
  await page.goto("/slab/");
  await expect(page.locator("#slab-message")).toContainText("needs WebGPU");
  await expect(page.locator("#slab-body")).toBeHidden();
  expect(errors).toEqual([]);
});

test("frame pacing (recorded, not asserted)", async ({ page }) => {
  test.setTimeout(420_000);
  const out: string[] = [];
  const measure = async (label: string) => {
    for (const pace of [/Steady/, /Fastest/]) {
      await radio(page, pace).click();
      await page.getByRole("button", { name: "Play" }).click();
      await page.waitForTimeout(1500);
      const s0 = await stepOf(page);
      const t0 = Date.now();
      await page.waitForTimeout(5000);
      const s1 = await stepOf(page);
      const dt = (Date.now() - t0) / 1000;
      const status = await statusText(page);
      await page.getByRole("button", { name: "Pause" }).click();
      await page.waitForTimeout(800);
      out.push(`${label} ${pace.source}: ${((s1 - s0) / dt).toFixed(0)} steps/s over ${dt.toFixed(1)} s; ${status}`);
    }
  };
  await open(page, "&x=1");
  await radio(page, /^128 by 128 by 4 /).click(); await rebuilt(page);
  await measure("cyclic 128x128x4");
  await radio(page, /^256 by 256 by 4 /).click(); await rebuilt(page);
  await measure("cyclic 256x256x4");
  await radio(page, /Slab ecology/).click(); await rebuilt(page);
  await measure("ecology 256x256x8");
  console.log(`PACING\n${out.join("\n")}`);
});

test("screenshots at 1280 and 375 for both worlds", async ({ page }, testInfo) => {
  test.setTimeout(900_000);
  const SHOTS = RECORD ? EVIDENCE_SHOTS : testInfo.outputPath("shots") + "/";
  mkdirSync(SHOTS, { recursive: true });
  const shot = async (name: string) => {
    for (const [w, h] of [[1280, 900], [375, 812]]) {
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${SHOTS}${name}-${w}.png`, fullPage: true });
    }
  };
  await open(page);
  await runTo(page, 600);
  await shot("cyclic-burnin-step600");
  await runTo(page, 6800);
  console.log(`cyclic status: ${await statusText(page)}`);
  await shot("cyclic-kill-on");
  await runTo(page, 12000);
  console.log(`cyclic status: ${await statusText(page)}`);
  await shot("cyclic-kill-on-later");
  await radio(page, /Slab ecology/).click();
  await rebuilt(page);
  await runTo(page, 2500);
  console.log(`eco status: ${await statusText(page)}`);
  await shot("eco-step2500");
  await runTo(page, 15000);
  console.log(`eco status: ${await statusText(page)}`);
  await shot("eco-step15000");
});
