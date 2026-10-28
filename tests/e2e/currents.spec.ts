import { expect, test } from '@playwright/test';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

test.use({ reducedMotion: 'reduce', video: 'on' });

test('four matched current conditions start paused and share a 6000 tick clock', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto('/currents/');
  await expect(page.locator('.world-card')).toHaveCount(4);
  await expect(page.locator('#status')).toHaveText('Paused · reduced motion');
  await expect(page.locator('#tick')).toHaveText('0');
  await expect(page.locator('.world-card .ledger')).toHaveCount(4);
  for (const ledger of await page.locator('.ledger').all()) await expect(ledger).toHaveText('Balanced');
  await expect(page.locator('.world-card').nth(0).locator('.circulated')).toHaveText('0');
  await expect(page.locator('.world-card').nth(1).locator('.circulated')).toHaveText('0');
  const cards = await page.locator('.world-card').all(), boxes = await Promise.all(cards.map(card => card.boundingBox()));
  expect(boxes[0]!.y).toBeCloseTo(boxes[1]!.y, 0);
  expect(boxes[1]!.x).toBeGreaterThan(boxes[0]!.x);
  const canvas = page.locator('.world-canvas').first(), canvasBox = await canvas.boundingBox();
  expect(canvasBox!.height / canvasBox!.width).toBeCloseTo(3 / 4, 2);
  await page.getByLabel('Biomass', { exact: true }).check();
  await expect(page.locator('.view-description').first()).toHaveText('Biomass view');
  for (let tick = 1; tick <= 4; tick++) {
    await page.getByRole('button', { name: 'One tick', exact: true }).click();
    await expect(page.locator('#tick')).toHaveText(String(tick));
  }
  for (const tickText of await page.locator('.world-card .world-summary').allTextContents()) expect(tickText.length).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('nutrient difference channel, seed reset, and narrow layout remain available', async ({ page }) => {
  await page.goto('/currents/');
  await page.getByLabel('Nutrient − still sibling').check();
  await expect(page.locator('.view-description').first()).toHaveText('Nutrient − still sibling');
  await page.getByLabel('Shared seed').fill('4294967296');
  await page.getByRole('button', { name: 'Reset tanks' }).click();
  await expect(page.locator('#seed-error')).toContainText('Enter a number');
  await expect(page.locator('#tick')).toHaveText('0');
  await page.getByLabel('Shared seed').fill('1202');
  await page.getByRole('button', { name: 'Reset tanks' }).click();
  await expect(page.locator('#seed-error')).toBeEmpty();
  await expect(page.locator('#seed-display')).toHaveText('Matched seed 1,202');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const boxes = await Promise.all((await page.locator('.world-card').all()).map(card => card.boundingBox()));
  for (let index = 1; index < boxes.length; index++) expect(boxes[index]!.y).toBeGreaterThan(boxes[index - 1]!.y);
});

test('a hidden comparison stays paused until explicit user playback', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }));
  await page.goto('/currents/');
  await expect(page.locator('#status')).toHaveText('Paused while away');
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeDisabled();
});

test('live tanks keep one clock through extinction and reservoir exhaustion to tick 6000', async ({ page }) => {
  test.setTimeout(180_000);
  await page.addInitScript(() => {
    const pending: FrameRequestCallback[] = [];
    const controlled = window as unknown as Window & { __driveCurrentClock: (target: number) => string | null };
    controlled.__driveCurrentClock = target => {
      let now = 1;
      for (let frame = 0; frame < 2000; frame++) {
        const callback = pending.shift();
        if (!callback) throw new Error('No queued current comparison frame');
        callback(now); now += 100;
        const visibleTick = document.querySelector('#tick')?.textContent ?? null;
        if (Number(visibleTick?.replaceAll(',', '')) >= target) return visibleTick;
      }
      return document.querySelector('#tick')?.textContent ?? null;
    };
    window.requestAnimationFrame = ((callback: FrameRequestCallback) => { pending.push(callback); return pending.length; }) as typeof window.requestAnimationFrame;
    window.cancelAnimationFrame = (() => {}) as typeof window.cancelAnimationFrame;
  });
  await page.goto('/currents/');
  await page.addStyleTag({ content: '.world-canvas,.history-canvas { width: 64px !important; }' });
  await page.getByLabel('Pace').selectOption('2');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  type ControlledWindow = Window & { __driveCurrentClock: (target: number) => string | null };
  const reached = await page.evaluate(() => (window as unknown as ControlledWindow).__driveCurrentClock(6000));
  expect(reached).toBe('6,000');
  await expect(page.locator('#status')).toHaveText('6,000 tick limit reached');
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download observations' }).click();
  const download = await pending, path = await download.path();
  expect(path).not.toBeNull();
  const observation = JSON.parse(await (await import('node:fs/promises')).readFile(path!, 'utf8')) as { worlds: { conditionId: string; snapshot: { tick: number; extinctionTick: number | null; reservoir: number; initialReservoir: number; counters: { circulated: number }; history: { tick: number }[] } }[] };
  expect(observation.worlds.map(world => world.snapshot.tick)).toEqual([6000, 6000, 6000, 6000]);
  expect(observation.worlds[0]!.snapshot.extinctionTick).not.toBeNull();
  expect(observation.worlds[2]!.snapshot.extinctionTick).not.toBeNull();
  expect(observation.worlds[1]!.snapshot.extinctionTick).toBeNull();
  expect(observation.worlds[3]!.snapshot.extinctionTick).toBeNull();
  expect(observation.worlds.map(world => world.snapshot.reservoir)).toEqual([32768, 32768, 0, 0]);
  expect(observation.worlds[0]!.snapshot.counters.circulated).toBe(0);
  expect(observation.worlds[1]!.snapshot.counters.circulated).toBeGreaterThan(0);
  expect(observation.worlds.every(world => world.snapshot.history.at(-1)?.tick === 6000)).toBe(true);
});

test('all three recorded seeds play through the actual coarse timeline', async ({ page }) => {
  test.setTimeout(120_000);
  if (!existsSync(resolve('docs/creative-prototypes/current-pilot.json'))) test.skip(true, 'Actual fixed-pilot replay artifact has not been generated yet.');
  mkdirSync(resolve('test-results'), { recursive: true });
  await page.goto('/currents/');
  await expect(page.locator('#replay-state')).toHaveText(/Seed 1201 · four matched conditions · verified saved states\./, { timeout: 60_000 });
  await expect(page.locator('.replay-grid canvas[data-replay-condition]')).toHaveCount(4);
  await expect(page.locator('#replay-step')).toBeEnabled();
  await expect(page.locator('#replay-tick')).toHaveText('0');
  await page.locator('#replay-condition').selectOption('rain-current');
  await expect(page.locator('figure.selected')).toHaveCount(1);
  await expect(page.locator('figure.selected')).toContainText('Rain · current');

  const unavailableAsset = /currents-replay-1202\.replay(?!\?import)/;
  await page.route(unavailableAsset, route => route.fulfill({ status: 503, body: 'Intentional replay recovery check' }));
  await page.locator('#replay-seed').selectOption('1202');
  await expect(page.locator('#replay-state')).toContainText('Replay could not be loaded', { timeout: 60_000 });
  await expect(page.locator('#replay-seed')).toBeEnabled();
  await expect(page.locator('#replay-step')).toBeDisabled();
  await page.unroute(unavailableAsset);
  await page.locator('#replay-seed').selectOption('1201');
  await expect(page.locator('#replay-state')).toContainText('Seed 1201 · four matched conditions', { timeout: 60_000 });
  let signalIntercepted!: () => void;
  const interceptReady = new Promise<void>(resolve => { signalIntercepted = resolve; });
  await page.route(unavailableAsset, async route => {
    signalIntercepted();
    await new Promise(resolve => setTimeout(resolve, 750));
    try { await route.continue(); } catch { /* The UI aborts this stale seed request when seed 1203 is selected. */ }
  });
  await page.locator('#replay-seed').selectOption('1202');
  await interceptReady;
  await page.locator('#replay-seed').selectOption('1203');
  await expect(page.locator('#replay-state')).toContainText('Seed 1203 · four matched conditions', { timeout: 60_000 });
  await page.unroute(unavailableAsset);

  await page.locator('#replay-window').selectOption('coarse');
  await expect(page.locator('#replay-tick')).toHaveText('0');
  const earlyTicks = [0, 200];
  for (const seed of [1201, 1202, 1203]) {
    await page.locator('#replay-seed').selectOption(String(seed));
    await expect(page.locator('#replay-state')).toContainText(`Seed ${seed} · four matched conditions`, { timeout: 60_000 });
    await expect(page.locator('#replay-seed')).toHaveValue(String(seed));
    await page.locator('.replay-section').scrollIntoViewIfNeeded();
    for (const earlyTick of earlyTicks) {
      const sliderIndex = earlyTick === 0 ? '0' : '2';
      await page.locator('#replay-slider').evaluate((node, value) => { const slider = node as HTMLInputElement; slider.value = value; slider.dispatchEvent(new Event('input', { bubbles: true })); }, sliderIndex);
      await expect(page.locator('#replay-tick')).toHaveText(earlyTick.toLocaleString('en-US'));
      await page.locator('.replay-section').screenshot({ path: resolve(`test-results/currents-seed-${seed}-tick-${earlyTick}.png`) });
    }
    await page.locator('#replay-slider').evaluate(node => { const slider = node as HTMLInputElement; slider.value = slider.max; slider.dispatchEvent(new Event('input', { bubbles: true })); });
    await expect(page.locator('#replay-tick')).toHaveText('6,000');
    await page.locator('.replay-section').screenshot({ path: resolve(`test-results/currents-seed-${seed}-tick-6000.png`) });
    await page.locator('#replay-slider').evaluate(node => { const slider = node as HTMLInputElement; slider.value = '0'; slider.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.getByRole('button', { name: 'Play replay' }).click();
    await expect(page.locator('#replay-tick')).toHaveText('6,000', { timeout: 15_000 });
    for (const status of await page.locator('.replay-history-status').allTextContents()) expect(status).toMatch(/Biomass (reached zero|first sampled at zero|remains)/);
  }
  const video = page.video();
  await page.close();
  if (video) await video.saveAs(resolve('test-results/currents-replay-all-seeds.webm'));
});
