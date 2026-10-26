import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test.use({ reducedMotion: 'reduce' });

test('development comparison starts paused with matched, real world canvases', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.goto('/development/');
  await expect(page.locator('.world-card')).toHaveCount(2);
  await expect(page.locator('#status')).toContainText('Paused');
  await expect(page.locator('#tick')).toHaveText('0');
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeEnabled();
  await expect(page.locator('.world-card').nth(0).locator('.condition')).toHaveText('Mutation off');
  await expect(page.locator('.world-card').nth(1).locator('.condition')).toHaveText('Mutation on');

  const cards = await page.locator('.world-card').all();
  const boxes = await Promise.all(cards.map(card => card.boundingBox()));
  expect(boxes[0]!.y).toBeCloseTo(boxes[1]!.y, 0);
  expect(boxes[1]!.x).toBeGreaterThan(boxes[0]!.x);
  const canvas = page.locator('.world-canvas').first();
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThan(350);
  expect(box!.height).toBeCloseTo(box!.width, 0);
  expect(await canvas.evaluate(node => (node as HTMLCanvasElement).width)).toBeGreaterThanOrEqual(Math.round(box!.width));
  await page.locator('.food-toggle').first().check();
  await page.getByRole('button', { name: 'One tick', exact: true }).click();
  await expect(page.locator('#tick')).toHaveText('1');
  await expect(page.locator('.world-card .world-stats .ledger').first()).toHaveText('Balanced');
  await expect(page.locator('.world-card .world-stats .ledger').last()).toHaveText('Balanced');
  await expect(page.locator('.program-card')).toHaveCount(6);
  expect(errors).toEqual([]);
});

test('selection follows a body ID, clears on reset, and seed errors remain until a valid reset', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.goto('/development/');
  const canvas = page.locator('.world-canvas').first();
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  await canvas.click({ position: { x: box!.width * 12.5 / 96, y: box!.height * 16.5 / 96 } });
  await expect(page.locator('.world-card').first().locator('.selection-info')).toBeVisible();
  await expect(page.locator('.world-card').first().locator('.selected-genome')).toContainText('turnEvery');
  await page.getByRole('button', { name: 'One tick', exact: true }).click();
  await page.getByLabel('Shared seed').fill('4294967296');
  await page.getByRole('button', { name: 'Reset comparison' }).click();
  await expect(page.locator('#seed-error')).toContainText('Enter a whole number');
  await expect(page.locator('#tick')).toHaveText('1');
  await expect(page.locator('.world-card').first().locator('.selection-info')).toBeVisible();
  await page.getByLabel('Shared seed').fill('0');
  await page.getByRole('button', { name: 'Reset comparison' }).click();
  await expect(page.locator('#seed-error')).toBeEmpty();
  await expect(page.locator('#tick')).toHaveText('0');
  await expect(page.locator('.world-card').first().locator('.selection-info')).toBeHidden();
});

test('export contains both full matched snapshots under the 8 MiB limit', async ({ page }) => {
  await page.goto('/development/');
  await page.getByRole('button', { name: 'One tick', exact: true }).click();
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download observations' }).click();
  const download = await pending;
  const path = await download.path();
  expect(path).not.toBeNull();
  const bytes = await readFile(path!);
  const observation = JSON.parse(bytes.toString('utf8'));
  expect(observation).toMatchObject({ kind: 'development-comparison-observation', schemaVersion: 1, seed: 1201, comparisonTick: 1 });
  expect(observation.worlds).toHaveLength(2);
  expect(observation.worlds.map((world: { mutation: boolean }) => world.mutation)).toEqual([false, true]);
  expect(observation.worlds[0].snapshot).toMatchObject({ schemaVersion: 1, tick: 1, mutation: false, food: expect.any(Array), occupancy: expect.any(Array) });
  expect(observation.worlds[1].snapshot).toMatchObject({ schemaVersion: 1, tick: 1, mutation: true, food: expect.any(Array), occupancy: expect.any(Array) });
  expect(bytes.byteLength).toBeLessThan(8 * 1024 * 1024);
});

test('hidden page stays paused and phone layout uses one full width column', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }));
  await page.goto('/development/');
  await expect(page.locator('#status')).toHaveText('Paused while away');
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeDisabled();
  await page.evaluate(() => { Reflect.deleteProperty(document, 'hidden'); document.dispatchEvent(new Event('visibilitychange')); });
  await expect(page.locator('#status')).toContainText('Paused');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const boxes = await Promise.all((await page.locator('.world-card').all()).map(card => card.boundingBox()));
  expect(Math.round(boxes[0]!.x)).toBe(Math.round(boxes[1]!.x));
  expect(boxes[1]!.y).toBeGreaterThan(boxes[0]!.y);
  const canvas = page.locator('.world-canvas').first();
  const box = await canvas.boundingBox();
  expect(box!.width).toBeGreaterThan(300);
  expect(box!.height).toBeCloseTo(box!.width, 0);
});
