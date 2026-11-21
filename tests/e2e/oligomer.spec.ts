import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

test.use({ reducedMotion: 'reduce' });

const stepOf = async (page: Page) => Number(((await page.locator('#r-t').textContent()) ?? '').replace(/\D/g, ''));
const url = (page: Page) => page.locator('#world').evaluate((c) => (c as HTMLCanvasElement).toDataURL());
const optionValues = (page: Page, sel: string) => page.locator(`${sel} option`).evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));

test('the oligomer world runs, keeps its matter check at 0, 0, and every world, view and tile works', async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/oligomer/');
  await expect(page.getByRole('heading', { name: 'Compartments that fight over wall patterns' })).toBeVisible();
  await expect(page.locator('#r-res')).toHaveText('res 0, 0');
  await expect(page.locator('#r-live')).toHaveText('6');
  await expect(page.locator('#r-t')).toHaveText('0');

  // click a founder square before anything runs: seed 1 on 32x32 puts the 0011 founder at (6, 8)
  const box = (await page.locator('#world').boundingBox())!;
  await page.locator('#world').click({ position: { x: ((6 + 0.5) / 32) * box.width, y: ((8 + 0.5) / 32) * box.height } });
  await expect(page.locator('#inspector')).toContainText('tile (6, 8)');
  await expect(page.locator('#inspector')).toContainText('0011');
  await expect(page.locator('#inspector')).toContainText('CLV');
  await expect(page.locator('#live')).toContainText('Tile (6, 8)');
  await page.locator('#world').click({ position: { x: ((1 + 0.5) / 32) * box.width, y: ((1 + 0.5) / 32) * box.height } });
  await expect(page.locator('#inspector')).toContainText('Empty');

  // keyboard: arrows move the selection, Escape clears it, focus ring is visible
  await page.locator('#world').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#inspector')).toContainText('tile (2, 1)');
  await page.keyboard.press('Escape');
  await expect(page.locator('#inspector')).toContainText('Nothing selected');
  expect(await page.locator('#world').evaluate((e) => getComputedStyle(e).outlineStyle)).not.toBe('none');

  // play
  const shot = process.env.BL_OLIGOMER_SHOT;
  if (shot) await page.locator('#pace').selectOption('0');
  await page.getByRole('button', { name: 'Play' }).click();
  await expect.poll(() => stepOf(page), { timeout: shot ? 180_000 : 60_000 }).toBeGreaterThan(shot ? 20000 : 300);
  await page.getByRole('button', { name: 'Pause' }).click();
  await expect(page.locator('#r-res')).toHaveText('res 0, 0');
  await expect(page.locator('#r-res')).toHaveClass(/ok/);
  await expect(page.locator('#r-res-word')).toHaveText('balanced');
  if (shot) await page.screenshot({ path: shot, fullPage: true });

  // every view mode redraws and changes the legend
  const wallUrl = await url(page);
  const stepNow = await stepOf(page);
  let prevLegend = await page.locator('#legend').innerText();
  for (const v of ['lysin', 'trophic', 'chem']) {
    await page.locator('#view').selectOption(v);
    await expect(page.locator('#view-note')).not.toBeEmpty();
    expect(await page.locator('#legend').innerText()).not.toBe(prevLegend);
    prevLegend = await page.locator('#legend').innerText();
    await expect.poll(() => url(page)).not.toBe(wallUrl);
    if (v === 'lysin') expect(prevLegend).toContain('ring');
    expect(await stepOf(page)).toBe(stepNow);
  }
  // chemistry channels (the view is chem now)
  await expect(page.locator('#chem')).toBeVisible();
  const seen = new Set<string>();
  for (const ch of await optionValues(page, '#chem')) {
    await page.locator('#chem').selectOption(ch);
    await expect(page.locator('#scale')).toContainText('scale:');
    seen.add(await url(page));
  }
  expect(seen.size).toBe(3);
  await page.locator('#view').selectOption('wall');
  await expect(page.locator('#chem')).toBeHidden();
  await expect.poll(() => url(page)).toBe(wallUrl);

  // every world builds, pauses, steps once and keeps residual 0, 0; each has its own note
  let prevNote = '';
  const phaseA = await optionValues(page, '#start optgroup:not(#start-droplets)');
  expect(phaseA).toHaveLength(4);
  for (const v of phaseA) {
    await page.locator('#start').selectOption(v);
    await expect(page.locator('#r-t')).toHaveText('0');
    await expect(page.locator('#r-live')).toHaveText('6');
    await page.getByRole('button', { name: 'One step' }).click();
    await expect(page.locator('#r-t')).toHaveText('1');
    await expect(page.locator('#r-res')).toHaveText('res 0, 0');
    const note = (await page.locator('#world-note').textContent()) ?? '';
    expect(note.length).toBeGreaterThan(20);
    expect(note).not.toBe(prevNote);
    prevNote = note;
  }

  // a junk or empty seed is replaced by 1 with a spoken notice; resetting while playing pauses at step 0
  await page.locator('#view').selectOption('chem');
  const chemPaused = await url(page);
  await page.locator('#view').selectOption('wall');
  await page.locator('#view').selectOption('chem');
  expect(await url(page)).toBe(chemPaused); // a paused redraw is repeatable
  await page.locator('#view').selectOption('wall');
  await page.getByRole('button', { name: 'Play' }).click();
  await expect.poll(() => stepOf(page)).toBeGreaterThan(0);
  await page.locator('#seed').fill('');
  await page.locator('#seed').press('Enter');
  await expect(page.locator('#seed')).toHaveValue('1');
  await expect(page.locator('#live')).toContainText('seed 1 is used');
  await expect(page.locator('#r-t')).toHaveText('0');
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
  await expect(page.locator('#history')).toHaveAttribute('aria-label', /No census yet/);

  // grid sizes
  for (const size of ['16', '24', '32']) {
    await page.locator('#size').selectOption(size);
    await expect(page.locator('#r-t')).toHaveText('0');
    await expect(page.locator('#r-live')).toHaveText('6');
    await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
  }
  for (const v of phaseA) {
    await page.locator('#size').selectOption('16');
    await page.locator('#start').selectOption(v);
    await expect(page.locator('#r-live')).toHaveText('6');
  }

  // phone width: no sideways scroll, grid fits
  await page.setViewportSize({ width: 375, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect((await page.locator('#world').boundingBox())!.width).toBeLessThanOrEqual(375);
  if (shot) await page.screenshot({ path: shot.replace(/\.png$/, '') + '-390.png', fullPage: true });
  expect(errors).toEqual([]);
});

// ---- droplet worlds ----------------------------------------------------------------------------

const dStep = async (page: Page) => Number(((await page.locator('#d-t').textContent()) ?? '').replace(/\D/g, ''));
const hasWebGpu = (page: Page) => page.evaluate(async () => { try { return !!(await (navigator as any).gpu?.requestAdapter()); } catch { return false; } });
const DROPLET_WORLDS = ['D_PHAGE', 'D_NO_PHAGE', 'D_SINGLE_WALL', 'D_NEUTRAL_PHAGE'];

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  return errors;
}

test('droplet worlds run on the graphics card when there is one, keep the matter check at res 0, and every world, view and square works', async ({ page }) => {
  test.setTimeout(420_000);
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/oligomer/');
  const gpu = await hasWebGpu(page), expected = gpu ? 'gpu' : 'cpu';
  console.log(`droplet e2e: WebGPU adapter in this browser: ${gpu}`);
  if (!gpu) test.info().annotations.push({ type: 'warning', description: 'no WebGPU adapter: the graphics-card path was NOT exercised by this test' });
  if (process.env.BL_REQUIRE_GPU) expect(gpu, 'BL_REQUIRE_GPU is set but this browser has no WebGPU adapter').toBe(true);
  expect(await optionValues(page, '#start-droplets')).toEqual(DROPLET_WORLDS);

  await page.locator('#start').selectOption('D_PHAGE');
  await expect(page.locator('#intro-d')).toBeVisible();
  await expect(page.locator('#intro-a')).toBeHidden();
  await expect(page.locator('#readout-d')).toBeVisible();
  await expect(page.locator('#readout-a')).toBeHidden();
  await expect(page.locator('#engine')).toHaveAttribute('data-engine', expected);
  await expect(page.locator('#engine')).toContainText('Running on:');
  await expect(page.locator('#dsize')).toHaveValue(gpu ? '128' : '48');
  await expect(page.locator('#d-t')).toHaveText('0');
  await expect(page.locator('#d-res')).toHaveText('res 0');
  const pace = gpu ? '25' : '10';
  await page.locator('#dpace').selectOption(pace);
  console.log(`droplet e2e: default pace option values ${await optionValues(page, '#dpace')}`);

  // every world builds, pauses, steps once, keeps res 0, and has its own note
  const notes = new Set<string>();
  for (const v of DROPLET_WORLDS) {
    await page.locator('#start').selectOption(v);
    await expect(page.locator('#d-t')).toHaveText('0');
    await expect(page.locator('#engine')).toHaveAttribute('data-engine', expected);
    await page.getByRole('button', { name: 'One step' }).click();
    await expect(page.locator('#d-t')).toHaveText('1');
    await expect(page.locator('#d-res')).toHaveText('res 0');
    await expect(page.locator('#d-res-step')).toHaveText('checked at step 1');
    const note = (await page.locator('#world-note').textContent()) ?? '';
    expect(note.length).toBeGreaterThan(20);
    notes.add(note);
  }
  expect(notes.size).toBe(4);

  // play the default world, sampling the matter check while it runs
  await page.locator('#start').selectOption('D_PHAGE');
  await expect(page.locator('#d-t')).toHaveText('0');
  const shot = process.env.BL_DROPLET_SHOT;
  if (shot) await page.locator('#dpace').selectOption(gpu ? '100' : '10');
  const t0 = Date.now(), s0 = await dStep(page);
  await page.getByRole('button', { name: 'Play' }).click();
  let lastChecked = Number(((await page.locator('#d-res-step').textContent()) ?? '').replace(/\D/g, ''));
  for (let i = 0; i < 5; i++) {
    await expect.poll(() => dStep(page), { timeout: 150_000 }).toBeGreaterThan(s0 + 100 * (i + 1));
    // the check really ran again during play (not just the first badge): the step it was checked at moves on
    await expect.poll(async () => Number(((await page.locator('#d-res-step').textContent()) ?? '').replace(/\D/g, '')), { timeout: 60_000 }).toBeGreaterThan(lastChecked);
    lastChecked = Number(((await page.locator('#d-res-step').textContent()) ?? '').replace(/\D/g, ''));
    await expect(page.locator('#d-res')).toHaveText('res 0');
    await expect(page.locator('#d-res')).toHaveClass(/ok/);
  }
  if (shot) await expect.poll(() => dStep(page), { timeout: 400_000 }).toBeGreaterThan(gpu ? 4000 : 600);
  const steps = (await dStep(page)) - s0;
  console.log(`droplet e2e: ${expected} engine, about ${Math.round((steps / (Date.now() - t0)) * 1000)} steps per second at pace ${shot ? 'fast' : pace}`);
  await page.getByRole('button', { name: 'Pause' }).click();
  await expect(page.locator('#d-res-word')).toHaveText('balanced');
  await expect.poll(async () => Number((await page.locator('#d-drops').textContent()) ?? '0')).toBeGreaterThan(0);
  expect(Number(await page.locator('#d-sw').textContent())).toBeGreaterThanOrEqual(0);
  await expect(page.locator('#d-res-step')).toHaveText(`checked at step ${await dStep(page)}`);
  if (shot) {
    await page.screenshot({ path: shot, fullPage: true });
  }

  // the pattern view is not blank: several colours, and the most common colour (the background) is not nearly everything
  const spread = await page.evaluate(() => {
    const c = document.getElementById('world') as HTMLCanvasElement, d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    const counts = new Map<number, number>();
    for (let i = 0; i < d.length; i += 4) { const k = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2]; counts.set(k, (counts.get(k) ?? 0) + 1); }
    return { colours: counts.size, top: Math.max(...counts.values()) / (d.length / 4) };
  });
  expect(spread.colours).toBeGreaterThan(3);
  expect(spread.top).toBeLessThan(0.9);

  // views: each redraws, changes the legend and the note, never moves the step
  const patternUrl = await url(page), stepNow = await dStep(page);
  let prevLegend = await page.locator('#legend').innerText();
  for (const v of ['phage', 'chem']) {
    await page.locator('#dview').selectOption(v);
    await expect(page.locator('#view-note')).not.toBeEmpty();
    expect(await page.locator('#legend').innerText()).not.toBe(prevLegend);
    prevLegend = await page.locator('#legend').innerText();
    await expect.poll(() => url(page)).not.toBe(patternUrl);
    expect(await dStep(page)).toBe(stepNow);
  }
  await expect(page.locator('#dchem')).toBeVisible();
  const seen = new Set<string>();
  for (const ch of await optionValues(page, '#dchem')) {
    await page.locator('#dchem').selectOption(ch);
    await expect(page.locator('#scale')).toContainText('scale:');
    seen.add(await url(page));
  }
  expect(seen.size).toBe(2);
  if (shot) { await page.locator('#dview').selectOption('phage'); await page.screenshot({ path: shot.replace(/\.png$/, '') + '-phage.png', fullPage: true }); }
  await page.locator('#dview').selectOption('pattern');
  await expect(page.locator('#dchem')).toBeHidden();
  await expect.poll(() => url(page)).toBe(patternUrl);

  // inspector: click and keys, six wall lines and six phage lines
  const box = (await page.locator('#world').boundingBox())!;
  await page.locator('#world').click({ position: { x: box.width * 0.3, y: box.height * 0.3 } });
  for (const t of ['Loose pieces (A)', 'Food (F)', '0011', 'Phage', 'All matter on this square']) await expect(page.locator('#inspector')).toContainText(t);
  expect(((await page.locator('#inspector').innerText()).match(/0011 \(orange\)/g) ?? []).length).toBeGreaterThanOrEqual(2); // one wall line and one phage line, plus the main pattern when it is 0011
  await expect(page.locator('#live')).toContainText('Tile (');
  await page.locator('#world').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#inspector')).toContainText('square (');
  await page.keyboard.press('Escape');
  await expect(page.locator('#inspector')).toContainText('Nothing selected');

  // reset during play (the in-flight readback path), then world, size and engine changes while playing
  const playAndWait = async () => {
    await page.getByRole('button', { name: 'Play' }).click();
    await expect.poll(() => dStep(page), { timeout: 120_000 }).toBeGreaterThan(0);
  };
  await playAndWait();
  await page.locator('#seed').fill('7');
  await page.locator('#seed').press('Enter');
  await expect(page.locator('#d-t')).toHaveText('0');
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
  await expect(page.locator('#history')).toHaveAttribute('aria-label', /No census yet/);
  await playAndWait();
  await page.locator('#start').selectOption('D_NEUTRAL_PHAGE');
  await expect(page.locator('#d-t')).toHaveText('0');
  for (const size of await optionValues(page, '#dsize')) {
    await playAndWait();
    await page.locator('#dsize').selectOption(size);
    await expect(page.locator('#d-t')).toHaveText('0');
    await expect(page.locator('#dsize')).toHaveValue(size);
    await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
  }
  await playAndWait();
  await page.locator('#engine-mode').selectOption('cpu');
  await expect(page.locator('#engine')).toHaveAttribute('data-engine', 'cpu');
  await expect(page.locator('#engine')).toContainText('you chose processor only');
  expect(await optionValues(page, '#dsize')).toEqual(['32', '48', '64']);
  await expect(page.locator('#dsize')).toHaveValue('48');
  await expect(page.locator('#d-t')).toHaveText('0');
  await page.getByRole('button', { name: 'One step' }).click();
  await expect(page.locator('#d-t')).toHaveText('1');
  await expect(page.locator('#d-res')).toHaveText('res 0');

  // back to a Phase A world: its own controls and readout return
  await page.locator('#engine-mode').selectOption('auto');
  await page.locator('#start').selectOption('LYSE');
  await expect(page.locator('#readout-a')).toBeVisible();
  await expect(page.locator('#readout-d')).toBeHidden();
  await expect(page.locator('#intro-a')).toBeVisible();
  await expect(page.locator('#r-live')).toHaveText('6');
  await expect(page.locator('#r-res')).toHaveText('res 0, 0');
  await expect(page.locator('#engine')).toBeHidden();

  // phone width
  await page.locator('#start').selectOption('D_PHAGE');
  await expect(page.locator('#d-t')).toHaveText('0');
  if (shot) {
    await page.locator('#dpace').selectOption(gpu ? '100' : '10');
    await page.getByRole('button', { name: 'Play' }).click();
    await expect.poll(() => dStep(page), { timeout: 400_000 }).toBeGreaterThan(gpu ? 4000 : 600);
    await page.getByRole('button', { name: 'Pause' }).click();
  }
  await page.setViewportSize({ width: 390, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect((await page.locator('#world').boundingBox())!.width).toBeLessThanOrEqual(390);
  if (shot) await page.screenshot({ path: shot.replace(/\.png$/, '') + '-390.png', fullPage: true });
  expect(errors).toEqual([]);
});

const NO_GPU_VARIANTS: [string, () => void][] = [
  ['no navigator.gpu', () => { Object.defineProperty(navigator, 'gpu', { value: undefined, configurable: true }); }],
  ['null adapter', () => { Object.defineProperty(navigator, 'gpu', { value: { requestAdapter: async () => null }, configurable: true }); }],
  ['requestDevice rejects', () => { Object.defineProperty(navigator, 'gpu', { value: { requestAdapter: async () => ({ requestDevice: async () => { throw new Error('no device'); } }) }, configurable: true }); }],
];
for (const [name, init] of NO_GPU_VARIANTS) {
  test(`without WebGPU (${name}) the droplet worlds fall back to the processor`, async ({ page }) => {
    test.setTimeout(240_000);
    const errors = watchErrors(page);
    await page.addInitScript(init);
    await page.goto('/oligomer/');
    await page.locator('#start').selectOption('D_PHAGE');
    await expect(page.locator('#engine')).toHaveAttribute('data-engine', 'cpu');
    await expect(page.locator('#engine')).toContainText('no usable WebGPU');
    expect(await optionValues(page, '#dsize')).toEqual(['32', '48', '64']);
    await expect(page.locator('#dsize')).toHaveValue('48');
    await page.locator('#dpace').selectOption('10');
    await page.getByRole('button', { name: 'One step' }).click();
    await expect(page.locator('#d-t')).toHaveText('1');
    await page.getByRole('button', { name: 'Play' }).click();
    await expect.poll(() => dStep(page), { timeout: 120_000 }).toBeGreaterThan(20);
    await page.getByRole('button', { name: 'Pause' }).click();
    await expect(page.locator('#d-res')).toHaveText('res 0');
    await page.locator('#start').selectOption('LYSE');
    await expect(page.locator('#r-live')).toHaveText('6');
    expect(errors).toEqual([]);
  });
}

test('the Phase A page never asks for a graphics device; a droplet world does', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __adapterCalls: number };
    w.__adapterCalls = 0;
    const gpu = (navigator as any).gpu;
    if (!gpu) return;
    const orig = gpu.requestAdapter.bind(gpu);
    gpu.requestAdapter = (...a: unknown[]) => { w.__adapterCalls++; return orig(...a); };
  });
  const calls = () => page.evaluate(() => (window as unknown as { __adapterCalls: number }).__adapterCalls);
  await page.goto('/oligomer/');
  await expect(page.locator('#r-live')).toHaveText('6');
  await page.getByRole('button', { name: 'One step' }).click();
  await expect(page.locator('#r-t')).toHaveText('1');
  expect(await calls()).toBe(0);
  if (!(await hasWebGpu(page))) return;
  const before = await calls();
  await page.locator('#start').selectOption('D_PHAGE');
  await expect(page.locator('#engine')).toHaveAttribute('data-engine', 'gpu');
  expect(await calls()).toBeGreaterThan(before);
});

test('the charts keep moving after the history is full (past step 20,000)', async ({ page }) => {
  test.setTimeout(300_000);
  test.skip(!(await (async () => { await page.goto('/oligomer/'); return hasWebGpu(page); })()), 'no WebGPU adapter in this browser (the processor is too slow to reach step 20,000)');
  await page.locator('#start').selectOption('D_PHAGE');
  await expect(page.locator('#d-t')).toHaveText('0');
  await page.locator('#dsize').selectOption('64');
  await expect(page.locator('#d-t')).toHaveText('0');
  await page.locator('#dpace').selectOption('100');
  await page.getByRole('button', { name: 'Play' }).click();
  await expect.poll(() => dStep(page), { timeout: 240_000 }).toBeGreaterThan(20_500);
  const chart = () => page.evaluate(() => (document.getElementById('history') as HTMLCanvasElement).toDataURL());
  const a = await chart(), sa = await dStep(page);
  await expect.poll(() => dStep(page), { timeout: 60_000 }).toBeGreaterThan(sa + 600);
  await page.getByRole('button', { name: 'Pause' }).click();
  expect(await chart()).not.toBe(a);
  await expect(page.locator('#d-res')).toHaveText('res 0');
});

test('the browser graphics card agrees with the processor reference, bit for bit, on a 32 x 32 world', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/oligomer/');
  test.skip(!(await hasWebGpu(page)), 'no WebGPU adapter in this browser');
  const result = await page.evaluate(async () => {
    const imp = (path: string): Promise<any> => import(path);
    const worlds = await imp('/src/oligomer/droplet-worlds.ts');
    const kernel = await imp('/src/oligomer/droplets-kernel.ts');
    const gpuMod = await imp('/src/oligomer/droplets-gpu.ts');
    const device = await (await (navigator as any).gpu.requestAdapter()).requestDevice();
    const a = worlds.buildDropletWorld('PHAGE', 32, 1), b = worlds.buildDropletWorld('PHAGE', 32, 1);
    const sim = new gpuMod.DropletGpuSim(device, a.cfg);
    sim.uploadFromRef(a.ref);
    sim.step(300);
    const snap = await sim.readback();
    sim.destroy();
    for (let i = 0; i < 300; i++) b.ref.step();
    const g = kernel.observeDigest(snap.A, snap.F, snap.W, snap.P), c = kernel.observeDigest(b.ref.A, b.ref.F, b.ref.W, b.ref.P);
    return { g, c, step: snap.step, res: String(kernel.observeTotalMatter(snap.A, snap.F, snap.W, snap.P) - a.ref.initTotalMatter) };
  });
  expect(result.step).toBe(300);
  expect(result.g).toBe(result.c);
  expect(result.res).toBe('0');
});
