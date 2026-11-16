/// <reference types="node" />
// The slab viewer's Volume view (apps/lab/src/volume3d/) in real Chrome with WebGPU: real kernels, real readbacks, the
// frame packed on the CPU and drawn by the ported renderers.
// Run: BL_E2E_PORT=5251 npx playwright test tests/e2e/slab-volume.spec.ts --workers=1
// Captures: BL_VOLUME_SHOTS=<dir> [BL_VOLUME_STEPS=24000] [BL_VOLUME_SEED=103] also runs the canopy setting and writes
// screenshots of the Volume view at 1280 and 375 wide into <dir>.
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
  await page.goto("/slab/?debug=1");
  await page.waitForFunction(() => (window as Any).__slab && (window as Any).__slab.step() >= 0, null, { timeout: 120_000 });
}
const radio = (page: Page, name: RegExp) => page.getByRole("radio", { name });
const stepOf = (page: Page) => page.evaluate(() => (window as Any).__slab.step() as number);
async function runTo(page: Page, n: number) { await page.evaluate((k) => (window as Any).__slab.runTo(k), n); }
async function rebuilt(page: Page) { await page.waitForFunction(() => (window as Any).__slab.step() >= 0 && (window as Any).__slab.counts().live === 1 && (window as Any).__slab.counts().pending === 0, null, { timeout: 120_000 }); }
const vol = (page: Page) => page.evaluate(() => (window as Any).__slab.volume());
/** Switches to Volume and waits until the frame on screen has been packed into it. */
async function toVolume(page: Page) {
  await radio(page, /^Volume/).click();
  await page.waitForFunction(() => { const s = (window as Any).__slab; const v = s.volume(); const f = s.frame(); return v && f && v.shown === `${s.state().world}:${f.kind}@${f.step}`; }, null, { timeout: 60_000 });
}

/** Share of canvas pixels with clear colour (chroma above 40 of 255): the backdrop, box edge and glass rim are all grey-blue. */
async function colourShare(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const url: string = await (window as Any).__slab.volumeShot();
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

test("Volume draws the cyclic slab with colour that the cut-away removes, and no console or GPU errors", async ({ page }) => {
  const errors = watch(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await open(page);
  await rebuilt(page);
  await toVolume(page);
  await expect(page.locator("#volume")).toBeVisible();
  await expect(page.locator("#slab-views")).toBeHidden();
  const full = await colourShare(page);
  expect(full).toBeGreaterThan(0.05);
  await page.locator("#cut").fill("0");
  const cut = await colourShare(page);
  expect(cut).toBeLessThan(full * 0.5);
  await page.locator("#cut").fill("100");
  await page.locator("#peel").fill("3");
  await expect(page.locator("#peel-out")).toHaveText("3");
  expect((await vol(page)).peel).toBe(3);
  // a new step reaches the volume
  await page.getByRole("button", { name: "Step +100" }).click();
  await expect.poll(async () => (await vol(page)).shown).toBe("cyclic:cyclic@100");
  expect((await vol(page)).errors).toEqual([]);
  expect(errors).toEqual([]);
});

test("every renderer draws a coloured frame, and switching renderers leaves the GPU resource count flat", async ({ page }) => {
  const errors = watch(page);
  await open(page);
  await rebuilt(page);
  await toVolume(page);
  const pick = async (re: RegExp, id: string) => {
    await radio(page, re).click();
    await expect.poll(async () => (await vol(page)).renderer).toBe(id);
  };
  await pick(/^Slices/, "slices");
  expect(await colourShare(page), "slices").toBeGreaterThan(0.02);
  const before = (await vol(page)).resources;
  for (const [re, id] of [[/^Points/, "points"], [/^Ray march/, "raymarch"], [/^Slices/, "slices"]] as const) {
    await pick(re, id);
    expect(await colourShare(page), id).toBeGreaterThan(0.02);
  }
  for (let i = 0; i < 6; i++) { await pick(i % 2 ? /^Slices/ : /^Points/, i % 2 ? "slices" : "points"); await colourShare(page); }
  expect((await vol(page)).resources).toBe(before);
  expect((await vol(page)).errors).toEqual([]);
  expect(errors).toEqual([]);
});

test("a world change blanks the volume until the new world's first frame, then shows the ecology", async ({ page }) => {
  const errors = watch(page);
  await open(page);
  await rebuilt(page);
  await toVolume(page);
  expect((await vol(page)).live).toBeGreaterThan(0);
  // in the same task as the click: the old world's picture is gone before any frame of the new one exists
  const atSwitch = await page.evaluate(() => {
    const l = [...document.querySelectorAll<HTMLLabelElement>("label.slab-opt")].find((x) => /Slab ecology/.test(x.textContent ?? ""));
    l!.querySelector("input")!.click();
    return (window as Any).__slab.volume();
  });
  expect([atSwitch.shown, atSwitch.live]).toEqual(["", 0]);
  await rebuilt(page);
  await expect.poll(async () => (await vol(page)).shown).toBe("eco:eco@0");
  await runTo(page, 2000);
  await expect.poll(async () => (await vol(page)).shown).toBe("eco:eco@2000");
  expect((await vol(page)).live).toBeGreaterThan(0);
  // back to Layers: the tiles are painted again from the same frame
  await radio(page, /^Layers/).click();
  await expect(page.locator("#slab-views")).toBeVisible();
  expect(errors).toEqual([]);
});

/** FNV-1a of the volume canvas's PNG, drawn fresh. */
async function shotHash(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const url: string = await (window as Any).__slab.volumeShot();
    let h = 0x811c9dc5;
    for (let i = 0; i < url.length; i++) h = Math.imul(h ^ url.charCodeAt(i), 0x01000193) >>> 0;
    return h;
  });
}

test("drag turns the view, the wheel zooms it, and the turntable keeps drawing until pressed again", async ({ page }) => {
  const errors = watch(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await open(page);
  await rebuilt(page);
  await toVolume(page);
  const canvas = page.locator("#volume-canvas");
  await canvas.scrollIntoViewIfNeeded();
  const box = (await canvas.boundingBox())!;
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  const h0 = await shotHash(page);
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 120, cy + 30, { steps: 6 });
  await page.mouse.up();
  const h1 = await shotHash(page);
  expect(h1).not.toBe(h0);
  await page.mouse.move(cx, cy);
  await page.mouse.wheel(0, -400);
  await expect.poll(() => shotHash(page)).not.toBe(h1);
  // keyboard: with the picture focused, an arrow key turns it
  const h2 = await shotHash(page);
  await canvas.focus();
  await page.keyboard.press("ArrowLeft");
  await expect.poll(() => shotHash(page)).not.toBe(h2);
  const tt = page.getByRole("button", { name: "Turntable" });
  await expect(tt).toHaveAttribute("aria-pressed", "false");
  const d0 = (await vol(page)).draws;
  await page.waitForTimeout(500);
  expect((await vol(page)).draws).toBe(d0); // on demand: no input, no frames
  await tt.click();
  await expect(tt).toHaveAttribute("aria-pressed", "true");
  const d1 = (await vol(page)).draws;
  await expect.poll(async () => (await vol(page)).draws, { timeout: 10_000 }).toBeGreaterThan(d1 + 10);
  await tt.click();
  await expect(tt).toHaveAttribute("aria-pressed", "false");
  await page.waitForTimeout(300);
  const d2 = (await vol(page)).draws;
  await page.waitForTimeout(700);
  expect((await vol(page)).draws).toBe(d2);
  expect((await vol(page)).errors).toEqual([]);
  expect(errors).toEqual([]);
});

test("rapid renderer switches end on the last choice, mounted and painted by the page's own frame loop", async ({ page }) => {
  const errors = watch(page);
  await open(page);
  await rebuilt(page);
  await toVolume(page);
  await expect.poll(async () => (await vol(page)).painted).toBe("raymarch");
  for (const order of [["points", "slices", "raymarch", "points", "slices"], ["slices", "points"], ["raymarch", "points", "raymarch"]]) {
    // all clicks in one task, so each lands while the previous renderer is still mounting
    await page.evaluate((ids) => { for (const id of ids) (document.querySelector(`input[name=renderer][value=${id}]`) as HTMLInputElement).click(); }, order);
    const want = order[order.length - 1];
    await expect.poll(async () => { const v = await vol(page); return [v.renderer, v.mounted, v.painted]; }, { timeout: 15_000 }).toEqual([want, want, want]);
    expect(await page.locator(`input[name=renderer][value=${want}]`).isChecked()).toBe(true);
  }
  expect((await vol(page)).errors).toEqual([]);
  expect(errors).toEqual([]);
});

test("depth stretch thickens the drawing only: the world, the frame and its packing are unchanged", async ({ page }) => {
  const errors = watch(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await open(page);
  await rebuilt(page);
  await toVolume(page);
  await expect(page.locator("#stretch")).toHaveValue("1");
  await expect(page.locator("#volume-cap")).toContainText("true shape");
  await page.getByRole("button", { name: "Level with the sheet" }).click();
  const flat = await colourShare(page);
  const before = await vol(page);
  await page.locator("#stretch").fill("8");
  await expect(page.locator("#stretch-out")).toHaveText("8");
  await expect(page.locator("#volume-cap")).toContainText("stretched 8 times as a viewing aid");
  const after = await vol(page);
  expect(after.stretch).toBe(8);
  expect([after.shown, after.live]).toEqual([before.shown, before.live]);
  expect(await stepOf(page)).toBe(0);
  // edge on, an 8-times-thicker sheet covers clearly more of the picture
  expect(await colourShare(page)).toBeGreaterThan(flat * 2);
  await page.locator("#stretch").fill("1");
  await expect(page.locator("#volume-cap")).toContainText("true shape");
  expect((await vol(page)).errors).toEqual([]);
  expect(errors).toEqual([]);
});

test("canopy setting: config and start as M4b, and the living fraction at step 5,000 matches its results file", async ({ page }) => {
  test.setTimeout(420_000);
  await open(page);
  await radio(page, /Slab ecology/).click();
  await rebuilt(page);
  await radio(page, /^Canopy over a dark floor/).click();
  await rebuilt(page);
  await expect(page.locator("#provenance")).toContainText("treatment-n12-mu50-s8-k64-seed101");
  await expect(page.locator("#provenance")).toContainText("not a recorded state");
  await runTo(page, 5000);
  expect(await stepOf(page)).toBe(5000);
  const living = await page.evaluate(() => (window as Any).__slab.living() as Promise<number>);
  expect(+(living / 524288).toFixed(4)).toBe(0.0062); // m4b-results.tsv, treatment-n12-mu50-s8-k64-seed101, livingFracEvery5k[0]
});

for (const theme of ["light", "dark"] as const) {
  test(`Volume at 375 wide, ${theme}: no sideways scroll and no serious axe findings`, async ({ page }) => {
    await page.addInitScript((t) => { try { localStorage.setItem("browser-life-theme", t); } catch { /* ignore */ } }, theme);
    await page.setViewportSize({ width: 375, height: 812 });
    await open(page);
    await rebuilt(page);
    await toVolume(page);
    await page.locator("#g-look summary").click();
    await page.waitForSelector("#volume-params input, #volume-params select");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const box = await page.locator("#volume-canvas").boundingBox();
    expect(box!.width).toBeLessThanOrEqual(375);
    const res = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
    expect(res.violations.filter((v) => v.impact === "serious" || v.impact === "critical"), JSON.stringify(res.violations.map((v) => [v.id, v.nodes.map((n) => n.target)]))).toEqual([]);
  });
}

const SHOTS = process.env.BL_VOLUME_SHOTS;
test("capture: the canopy setting in the Volume view at 1280 and 375 wide", async ({ page }) => {
  test.skip(!SHOTS, "set BL_VOLUME_SHOTS to a directory to capture");
  test.setTimeout(1_800_000);
  const steps = Number(process.env.BL_VOLUME_STEPS || 24000);
  const seed = Number(process.env.BL_VOLUME_SEED || 103);
  mkdirSync(SHOTS!, { recursive: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  await open(page);
  // for the pictures only: the sticky site header would sit over the element, and focus would show the skip link
  await page.addStyleTag({ content: ".site-header { position: static !important; } .skip { display: none !important; }" });
  await rebuilt(page);
  // the first Volume picture a visitor gets: the cyclic world, past the burn-in
  await runTo(page, 8000);
  await toVolume(page);
  await page.evaluate(() => (window as Any).__slab.volumeDraw());
  await page.locator("#volume").screenshot({ path: join(SHOTS!, "volume-1280-cyclic.png") });
  await radio(page, /^Layers/).click();
  await radio(page, /Slab ecology/).click();
  await rebuilt(page);
  await radio(page, /^Canopy over a dark floor/).click();
  await rebuilt(page);
  await page.locator("#seed").fill(String(seed));
  await page.locator("#seed").press("Tab"); // the browser's own change event, once (a dispatched one would fire again on blur)
  await rebuilt(page);
  for (let s = 0; s < steps;) { s = Math.min(steps, s + 2000); await runTo(page, s); }
  expect(await stepOf(page)).toBe(steps);
  expect((await page.evaluate(() => (window as Any).__slab.frame().step)) as number).toBe(steps);
  await toVolume(page);
  // the values the packer sees, for tuning its scales
  const probe = await page.evaluate(() => {
    const f = (window as Any).__slab.frame();
    const q = (a: number[]) => { a.sort((x, y) => x - y); return [0.1, 0.5, 0.9, 0.99].map((p) => a[Math.floor(p * (a.length - 1))]); };
    const m: number[] = [], A: number[] = [];
    for (let i = 0; i < f.hi.length; i++) { A.push(f.A[i]); if (f.hi[i] | f.lo[i]) m.push(f.B[i] + f.P[i]); }
    return { step: f.step, living: m.length, bodyQuantiles: q(m), nutrientQuantiles: q(A) };
  });
  writeFileSync(join(SHOTS!, "probe.json"), JSON.stringify(probe, null, 2));
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  // one more batch in Volume, so the status line's draw time includes packing the frame
  await page.getByRole("button", { name: "Step +100" }).click();
  await expect.poll(async () => (await vol(page)).shown).toBe(`eco:eco@${steps + 100}`);
  writeFileSync(join(SHOTS!, "status-volume.txt"), await page.locator("#status").innerText());
  const shot = async (name: string) => {
    await page.evaluate(() => (window as Any).__slab.volumeDraw());
    await page.locator("#volume").screenshot({ path: join(SHOTS!, name) });
  };
  await shot("volume-1280.png");
  for (const [re, id] of [[/^Slices/, "slices"], [/^Points/, "points"]] as const) {
    await radio(page, re).click();
    await expect.poll(async () => (await vol(page)).renderer).toBe(id);
    await shot(`volume-1280-${id}.png`);
  }
  await radio(page, /^Ray march/).click();
  await page.getByRole("button", { name: "Straight down" }).click();
  await shot("volume-1280-straight-down.png");
  await radio(page, /^Layers/).click();
  await page.locator("#combined").screenshot({ path: join(SHOTS!, "layers-1280-combined.png") });
  await radio(page, /^Volume/).click();
  await page.getByRole("button", { name: "Above, at an angle" }).click();
  await page.locator("#peel").fill("2");
  await shot("volume-1280-peel2.png");
  await page.locator("#peel").fill("0");
  await page.locator("#cut").fill("50");
  await shot("volume-1280-cut50.png");
  await page.locator("#cut").fill("100");
  await page.getByRole("button", { name: "Level with the sheet" }).click();
  await shot("volume-1280-side.png");
  await page.getByRole("button", { name: "From below" }).click();
  await shot("volume-1280-below.png");
  await page.getByRole("button", { name: "Above, at an angle" }).click();
  await page.locator("#stretch").fill("8");
  await shot("volume-1280-stretch8.png");
  await page.getByRole("button", { name: "Level with the sheet" }).click();
  await shot("volume-1280-stretch8-side.png");
  await page.locator("#stretch").fill("1");
  await page.getByRole("button", { name: "Above, at an angle" }).click();
  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForTimeout(500);
  await shot("volume-375.png");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect((await vol(page)).errors).toEqual([]);
});
