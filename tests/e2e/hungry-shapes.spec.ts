import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';

test.use({ reducedMotion: 'reduce' });

test('three matched food worlds start paused and advance on one shared clock', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1920, height: 1200 });
  await page.goto('/hungry-shapes/');
  await expect(page.locator('.world-card')).toHaveCount(3);
  await expect(page.locator('#status')).toHaveText('Paused · reduced motion');
  await expect(page.locator('#tick')).toHaveText('0');
  await page.getByLabel('Shared seed').fill('77');
  await page.getByRole('button', { name: 'Reset comparison' }).click();
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeEnabled();
  await expect(page.locator('.world-card').nth(0).locator('h2')).toHaveText('Original supply');
  await expect(page.locator('.world-card').nth(1).locator('h2')).toHaveText('Scarce · spread evenly');
  await expect(page.locator('.world-card').nth(2).locator('h2')).toHaveText('Scarce · founder patches');
  await expect(page.locator('.world-card .population')).toHaveText(['12', '12', '12']);
  await expect(page.locator('.world-card .observed-tick')).toHaveText(['0', '0', '0']);
  const canvases = await page.locator('.world-canvas').all();
  for (const canvas of canvases) {
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(300);
    expect(box!.height).toBeCloseTo(box!.width, 0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(1200);
  }
  await page.getByRole('button', { name: 'One tick', exact: true }).click();
  await expect(page.locator('#tick')).toHaveText('1');
  await expect(page.locator('.world-card .observed-tick')).toHaveText(['1', '1', '1']);
  expect(errors).toEqual([]);
});

test('observation export carries all worlds, allocation accounting and model provenance', async ({ page }) => {
  await page.goto('/hungry-shapes/');
  await page.getByLabel('Shared seed').fill('77');
  await page.getByRole('button', { name: 'Reset comparison' }).click();
  await page.getByRole('button', { name: 'One tick', exact: true }).click();
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download observations' }).click();
  const download = await pending;
  const path = await download.path();
  expect(path).not.toBeNull();
  const bytes = await readFile(path!);
  const observation = JSON.parse(bytes.toString('utf8'));
  const diskModelHash = createHash('sha256').update(await readFile(resolve('apps/lab/src/hungry-shapes/model.ts'))).digest('hex');
  expect(observation).toMatchObject({
    kind: 'hungry-shapes-comparison-observation', schemaVersion: 1, seed: 77,
    mutation: true, comparisonTick: 1, horizon: 3000,
    provenance: { modelSourceSha256: expect.stringMatching(/^[a-f0-9]{64}$/), browserRuntime: expect.any(String) },
  });
  expect(observation.provenance.modelSourceSha256).toBe(diskModelHash);
  expect(observation.worlds.map((world: { mode: string }) => world.mode)).toEqual(['original', 'uniform', 'patches']);
  expect(observation.worlds.map((world: { foodTargets: number[] }) => world.foodTargets.length)).toEqual([9216, 9216, 972]);
  for (const world of observation.worlds) {
    expect(world.observedTick).toBe(1);
    expect(world.environment).toMatchObject({ version: 1, mode: world.mode, pulses: 0, offered: 0, accepted: 0, overflow: 0, initialFoodPerTile: 20 });
    expect(world.snapshot).toMatchObject({ schemaVersion: 1, tick: 1, mutation: true, food: expect.any(Array), occupancy: expect.any(Array) });
    expect(world.summary).toEqual(expect.objectContaining({ capTicks: 0, lateBirths: 0, starvationDeaths: 0, ageDeaths: 0, lateWindow: { startTick: 2501, denominatorTicks: 500 } }));
  }
  expect(bytes.byteLength).toBeLessThan(16 * 1024 * 1024);
});

test('hidden tabs pause and remain paused, with a single-column phone layout', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }));
  await page.goto('/hungry-shapes/');
  await expect(page.locator('#status')).toHaveText('Paused while away');
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeDisabled();
  await page.evaluate(() => { Reflect.deleteProperty(document, 'hidden'); document.dispatchEvent(new Event('visibilitychange')); });
  await expect(page.locator('#status')).toContainText('Paused');
  await expect(page.locator('#tick')).toHaveText('0');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const boxes = await Promise.all((await page.locator('.world-card').all()).map(card => card.boundingBox()));
  expect(Math.round(boxes[0]!.x)).toBe(Math.round(boxes[1]!.x));
  expect(Math.round(boxes[1]!.x)).toBe(Math.round(boxes[2]!.x));
  expect(boxes[1]!.y).toBeGreaterThan(boxes[0]!.y);
  expect(boxes[2]!.y).toBeGreaterThan(boxes[1]!.y);
});

test('comparison controls and cards have no WCAG A/AA axe violations on desktop or phone', async ({ page }) => {
  await page.goto('/hungry-shapes/');
  for (const viewport of [{ width: 1920, height: 1200 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(result.violations.map(violation => `${violation.id}: ${violation.nodes.map(node => node.target.join(' ')).join(', ')}`),
      `axe violations at ${viewport.width}px`).toEqual([]);
  }
});

test('export gives a clear message when SHA-256 is unavailable', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => Object.defineProperty(window.crypto, 'subtle', { configurable: true, value: undefined }));
  await page.goto('/hungry-shapes/');
  await page.getByRole('button', { name: 'Download observations' }).click();
  await expect(page.locator('#file-status')).toHaveText('This browser cannot calculate the model SHA-256 here, so observations were not downloaded.');
  expect(errors).toEqual([]);
});
