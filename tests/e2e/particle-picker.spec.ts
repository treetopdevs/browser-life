import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFile } from 'node:fs/promises';
import { createExploration, keepFavorite, recipeNode, serializeExploration } from '../../apps/lab/src/particles/comparison.ts';

test.use({ reducedMotion: 'reduce' });
async function exportChoices(page: Page) {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export choices' }).click();
  const download = await pending;
  return readFile((await download.path())!, 'utf8');
}

test('picker keeps a recipe, compares together, and restores choices atomically', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/particles/picker/');
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  await expect(page.locator('.world canvas')).toHaveCount(3);
  await expect(page.locator('#tick')).toHaveText('0');
  await page.getByRole('button', { name: 'One tick', exact: true }).click();
  await expect(page.locator('.world-state')).toHaveText([/Comparison tick 1/, /Comparison tick 1/, /Comparison tick 1/]);
  await page.getByLabel('What caught your eye?').fill('<img src=x onerror=alert(1)> circling amber');
  const before = JSON.parse(await exportChoices(page));
  await page.getByRole('button', { name: 'Keep world 2', exact: true }).click();
  await expect(page.locator('#selection-count')).toHaveText('1');
  await expect(page.locator('#tick')).toHaveText('0');
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  await expect(page.locator('#history img')).toHaveCount(0);
  await expect(page.locator('#history')).toContainText('<img src=x onerror=alert(1)> circling amber');
  const saved = await exportChoices(page), data = JSON.parse(saved);
  expect(data.selections[0]).toMatchObject({ chosenId: before.slate[1], evaluationTick: 1 });
  expect(data.slate[0]).toBe(before.slate[1]);
  expect(data.nodes.find((node: { id: string }) => node.id === data.slate[0]).recipe).toEqual(before.nodes.find((node: { id: string }) => node.id === before.slate[1]).recipe);
  await page.getByLabel('Seed', { exact: true }).fill('1203');
  await page.getByRole('button', { name: 'Start new session (clears choices)', exact: true }).click();
  await expect(page.locator('#selection-count')).toHaveText('0');
  await page.getByLabel('Import choices', { exact: true }).setInputFiles({ name: 'choices.json', mimeType: 'application/json', buffer: Buffer.from(saved) });
  await expect(page.locator('#file-status')).toContainText('Imported 1 choices');
  await expect(page.locator('#active-settings')).toContainText('Seed 1201');
  await expect(page.locator('#selection-count')).toHaveText('1');
  expect(JSON.parse(await exportChoices(page))).toEqual(data);
  await page.getByRole('button', { name: 'One tick', exact: true }).click();
  const currentRecipes = await page.locator('.recipe-id').allTextContents();
  await page.getByLabel('Import choices', { exact: true }).setInputFiles({ name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{broken') });
  await expect(page.locator('#file-status')).toContainText('Import refused');
  await expect(page.locator('#tick')).toHaveText('1');
  await expect(page.locator('#selection-count')).toHaveText('1');
  expect(await page.locator('.recipe-id').allTextContents()).toEqual(currentRecipes);
  await page.getByLabel('Import choices', { exact: true }).setInputFiles({ name: 'too-large.json', mimeType: 'application/json', buffer: Buffer.alloc(131073, 32) });
  await expect(page.locator('#file-status')).toContainText('larger than 128 KiB');
  await expect(page.locator('#tick')).toHaveText('1');
  await page.evaluate(() => {
    const original = File.prototype.text;
    File.prototype.text = function () {
      File.prototype.text = original;
      const file = this;
      return new Promise<string>(resolve => {
        Object.assign(window, { finishFileRead: async () => resolve(await original.call(file)) });
      });
    };
  });
  await page.getByLabel('Import choices', { exact: true }).setInputFiles({ name: 'delayed.json', mimeType: 'application/json', buffer: Buffer.from(saved) });
  await page.getByRole('button', { name: 'One tick', exact: true }).click();
  await page.evaluate(() => (window as unknown as { finishFileRead: () => Promise<void> }).finishFileRead());
  await expect(page.locator('#file-status')).toContainText('comparison changed');
  await expect(page.locator('#tick')).toHaveText('2');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Keep world 1', exact: true })).toBeDisabled();
  await expect.poll(async () => Number((await page.locator('#tick').textContent())!.replaceAll(',', ''))).toBeGreaterThan(1);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  const stopped = (await page.locator('#tick').textContent())!;
  await expect(page.locator('.world-state')).toHaveText([new RegExp(`Comparison tick ${stopped}`), new RegExp(`Comparison tick ${stopped}`), new RegExp(`Comparison tick ${stopped}`)]);
  await page.getByRole('button', { name: 'Restart comparison', exact: true }).click();
  await expect(page.locator('#tick')).toHaveText('0');
  await expect(page.locator('#selection-count')).toHaveText('1');
  expect(errors).toEqual([]);
});

test('picker is usable on a phone and stops keeping at the history limit', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/particles/picker/');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const accessibility = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(accessibility.violations).toEqual([]);
  await page.getByRole('button', { name: 'One tick', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#tick')).toHaveText('1');
  for (let i = 0; i < 30; i++) await page.getByRole('button', { name: 'Keep world 1', exact: true }).click();
  await expect(page.locator('#selection-count')).toHaveText('30');
  for (const index of [1, 2, 3]) await expect(page.getByRole('button', { name: `Keep world ${index}`, exact: true })).toBeDisabled();
  await expect(page.locator('#keep-help')).toContainText('30 choices saved');
  await page.getByRole('button', { name: 'One tick', exact: true }).click();
  await expect(page.locator('#tick')).toHaveText('1');
  const data = JSON.parse(await exportChoices(page));
  expect(data.selections).toHaveLength(30);
});


test('recipe descriptions call a smaller positive coefficient less attraction', async ({ page }) => {
  let exploration = createExploration(1201, 'flocks');
  let match: { slot: number; row: number; column: number } | undefined;
  for (let round = 0; round < 10 && !match; round++) {
    exploration = keepFavorite(exploration, 0, 1);
    const baseline = recipeNode(exploration, exploration.slate[0]).recipe;
    for (const slot of [1, 2]) {
      const variant = recipeNode(exploration, exploration.slate[slot]).recipe;
      for (let row = 0; row < 3; row++) for (let column = 0; column < 3; column++) {
        if (variant.rows[row][column] > 0 && variant.rows[row][column] < baseline.rows[row][column]) match = { slot, row, column };
      }
    }
  }
  expect(match).toBeDefined();
  await page.goto('/particles/picker/');
  await page.getByLabel('Import choices', { exact: true }).setInputFiles({ name: 'weaker-attraction.json', mimeType: 'application/json', buffer: Buffer.from(serializeExploration(exploration)) });
  await expect(page.locator('#file-status')).toContainText('Imported');
  const names = ['Mint', 'Amber', 'Lilac'];
  await expect(page.locator('.differences').nth(match!.slot)).toContainText(`${names[match!.row]} → ${names[match!.column]} less attraction`);
});


test('the visibility handler pauses and stays paused when visibility returns', async ({ page }) => {
  await page.goto('/particles/picker/');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect.poll(async () => Number((await page.locator('#tick').textContent())!.replaceAll(',', ''))).toBeGreaterThan(0);
  // Exercise the handler deterministically; this does not claim OS background-tab coverage.
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  await expect(page.locator('#status')).toHaveText('Paused while away');
  const stopped = (await page.locator('#tick').textContent())!;
  await expect(page.locator('.world-state')).toHaveText([new RegExp(`Comparison tick ${stopped}`), new RegExp(`Comparison tick ${stopped}`), new RegExp(`Comparison tick ${stopped}`)]);
  await page.evaluate(() => {
    Reflect.deleteProperty(document, 'hidden');
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(150);
  await expect(page.locator('#tick')).toHaveText(stopped);
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
});

test('a supported v2 still-world file shows its migration notice and exports v3', async ({ page }) => {
  let legacy = createExploration(1201, 'pursuit');
  legacy = keepFavorite(legacy, 1, 42);
  const oldFile = JSON.parse(serializeExploration(legacy));
  oldFile.modelVersion = 2;
  const before = structuredClone(oldFile);
  await page.goto('/particles/picker/');
  await page.getByLabel('Import choices', { exact: true }).setInputFiles({
    name: 'old-still-world-choices.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(oldFile)),
  });
  await expect(page.locator('#file-status')).toContainText('Model v2 still-world recipes were migrated to model v3');
  await expect(page.locator('#file-status')).toContainText('no moving-environment choices were inferred');
  await expect(page.locator('#tick')).toHaveText('0');
  await expect(page.locator('#selection-count')).toHaveText('1');
  expect(JSON.parse(await exportChoices(page))).toMatchObject({ modelVersion: 3, seed: before.seed, preset: before.preset, mutation: before.mutation, nodes: before.nodes, slate: before.slate, selections: before.selections });
  expect(JSON.parse(await exportChoices(page))).not.toHaveProperty('environment');
});
