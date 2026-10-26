import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFile } from 'node:fs/promises';

test.use({ reducedMotion: 'reduce' });

test('motif gallery starts paused and lays out twelve real particle canvases', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/particles/motifs/');
  await expect(page.locator('.motif-card')).toHaveCount(12);
  await expect(page.locator('.motif-view')).toHaveCount(12);
  await expect(page.locator('#status')).toContainText('Paused');
  await expect(page.locator('#tick')).toHaveText('0');
  await expect(page.locator('.motif-card').nth(0).locator('.motif-id')).toHaveText('chase-independent-still');
  await expect(page.locator('.motif-card').nth(11).locator('.motif-id')).toHaveText('gather-aligned-seasonal');

  const cards = await page.locator('.motif-card').all();
  const boxes = await Promise.all(cards.slice(0, 6).map(card => card.boundingBox()));
  const firstRowY = new Set(boxes.slice(0, 3).map(box => Math.round(box!.y)));
  const firstColumns = new Set(boxes.slice(0, 3).map(box => Math.round(box!.x)));
  expect(firstRowY.size).toBe(1);
  expect(firstColumns.size).toBe(3);
  expect(boxes[3]!.y).toBeGreaterThan(boxes[0]!.y);

  const canvas = page.locator('.motif-view').first();
  const canvasBox = await canvas.boundingBox();
  expect(canvasBox).not.toBeNull();
  expect(canvasBox!.width).toBeGreaterThan(250);
  expect(canvasBox!.height).toBeCloseTo(canvasBox!.width, 0);
  expect(await canvas.evaluate(node => (node as HTMLCanvasElement).width)).toBeGreaterThanOrEqual(Math.round(canvasBox!.width));
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeEnabled();
  const accessibility = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(accessibility.violations).toEqual([]);
  expect(errors).toEqual([]);
});

test('motif controls share steps, retain three favorites, and export bounded full snapshots', async ({ page }) => {
  await page.goto('/particles/motifs/');
  await page.getByRole('button', { name: 'One tick', exact: true }).click();
  await expect(page.locator('#tick')).toHaveText('1');

  const favoriteButtons = page.locator('.favorite-toggle');
  for (const index of [0, 1, 2]) await favoriteButtons.nth(index).click();
  await expect(page.locator('#favorite-count')).toHaveText('3 of 3 favorites');
  await favoriteButtons.nth(3).click();
  await expect(page.locator('#file-status')).toContainText('Three favorites are already selected');
  await expect(favoriteButtons.nth(0)).toHaveAttribute('aria-pressed', 'true');
  await expect(favoriteButtons.nth(3)).toHaveAttribute('aria-pressed', 'false');

  await page.getByLabel('Seed').fill('bad');
  await page.getByRole('button', { name: 'Reset with seed' }).click();
  await expect(page.locator('#seed-error')).toContainText('Enter a whole number');
  await expect(page.locator('#tick')).toHaveText('1');
  await page.getByRole('button', { name: 'Reset all' }).click();
  await expect(page.locator('#seed-error')).toContainText('Enter a whole number');
  await expect(page.locator('#tick')).toHaveText('1');
  await page.getByLabel('Seed').fill('0');
  await page.getByRole('button', { name: 'Reset with seed' }).click();
  await expect(page.locator('#seed-error')).toBeEmpty();
  await expect(page.locator('#tick')).toHaveText('0');
  await expect(page.locator('#favorite-count')).toHaveText('3 of 3 favorites');
  await expect(favoriteButtons.nth(0)).toHaveAttribute('aria-pressed', 'true');

  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download observations' }).click();
  const download = await pending;
  const observation = JSON.parse(await readFile((await download.path())!, 'utf8'));
  expect(observation).toMatchObject({ kind: 'particle-motif-gallery-observation', grammarVersion: 1, seed: 0, comparisonTick: 0 });
  expect(observation.compositions).toHaveLength(12);
  expect(observation.compositions.map((item: { id: string }) => item.id)).toContain('gather-aligned-seasonal');
  expect(observation.selectedIDs).toEqual(['chase-independent-still', 'chase-independent-travelling', 'chase-independent-seasonal']);
  expect(observation.selectedFullSnapshots).toHaveLength(3);
  expect(observation.selectedFullSnapshots[0]).toMatchObject({ kind: 'motif-world-observation', tick: 0, base: { particles: expect.any(Array) } });
  expect((await download.path()) && (await readFile((await download.path())!)).byteLength).toBeLessThan(8 * 1024 * 1024);
});

test('motif page stays paused while hidden and fits one real column on a phone', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }));
  await page.goto('/particles/motifs/');
  await expect(page.locator('#status')).toHaveText('Paused while away');
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeDisabled();
  await page.evaluate(() => {
    Reflect.deleteProperty(document, 'hidden');
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.locator('#status')).toContainText('Paused');
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect.poll(async () => Number((await page.locator('#tick').textContent())!.replaceAll(',', ''))).toBeGreaterThan(0);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.locator('#status')).toHaveText('Paused while away');
  const stopped = await page.locator('#tick').textContent();
  await page.evaluate(() => {
    Reflect.deleteProperty(document, 'hidden');
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(120);
  await expect(page.locator('#tick')).toHaveText(stopped!);

  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const cards = await page.locator('.motif-card').all();
  const boxes = await Promise.all(cards.map(card => card.boundingBox()));
  expect(new Set(boxes.map(box => Math.round(box!.x))).size).toBe(1);
  const canvasBox = await page.locator('.motif-view').first().boundingBox();
  expect(canvasBox).not.toBeNull();
  expect(canvasBox!.width).toBeGreaterThan(300);
  expect(canvasBox!.height).toBeCloseTo(canvasBox!.width, 0);
});

test('2× frames retain the latest scheduled sample when they cross an odd sample boundary', async ({ page }) => {
  await page.goto('/particles/motifs/');
  await page.getByLabel('Pace').selectOption('2');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect.poll(async () => Number((await page.locator('#tick').textContent())!.replaceAll(',', ''))).toBeGreaterThan(100);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.getByRole('button', { name: 'One tick', exact: true }).click();
  const sharedTick = Number((await page.locator('#tick').textContent())!.replaceAll(',', ''));
  const sampledTick = Number(await page.locator('.sample-tick').first().textContent());
  expect(sharedTick).toBeGreaterThan(100);
  expect(sampledTick).toBe(Math.floor(sharedTick / 100) * 100);
  await expect(page.locator('.speed').first()).not.toHaveText('0.00000');
});

test('pause and export flush scalar history across a 99→101 two tick frame', async ({ page }) => {
  await page.addInitScript(() => {
    const pending: FrameRequestCallback[] = [];
    Object.defineProperty(window, '__motifRunFrame', {
      configurable: false,
      value: (time: number) => {
        const callback = pending.shift();
        if (!callback) throw new Error('No queued motif animation frame');
        callback(time);
      },
    });
    window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      pending.push(callback);
      return pending.length;
    }) as typeof window.requestAnimationFrame;
    window.cancelAnimationFrame = (() => {}) as typeof window.cancelAnimationFrame;
  });
  await page.goto('/particles/motifs/');
  await page.locator('.favorite-toggle').first().click();
  await page.getByLabel('Pace').selectOption('1');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  type ControlledWindow = Window & { __motifRunFrame: (time: number) => void };
  const frame = async (time: number) => page.evaluate(value => (window as unknown as ControlledWindow).__motifRunFrame(value), time);
  await frame(1);
  await page.evaluate(() => {
    const win = window as unknown as ControlledWindow;
    const tick = 1000 / 30;
    for (let i = 1; i <= 99; i++) win.__motifRunFrame(1 + i * (tick + .001));
  });
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.locator('#tick')).toHaveText('99');
  await expect(page.locator('.sample-tick').first()).toHaveText('0');

  await page.getByLabel('Pace').selectOption('2');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await frame(5000);
  await frame(5034);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.locator('#tick')).toHaveText('101');
  await expect(page.locator('.sample-tick').first()).toHaveText('100');

  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download observations' }).click();
  const download = await pending;
  const observation = JSON.parse(await readFile((await download.path())!, 'utf8'));
  const scalarLatest = observation.compositions[0].recentHistory.at(-1).tick;
  const fullLatest = observation.selectedFullSnapshots[0].sampledObservations.at(-1).tick;
  expect(observation.comparisonTick).toBe(101);
  expect(scalarLatest).toBe(100);
  expect(fullLatest).toBe(scalarLatest);
});
