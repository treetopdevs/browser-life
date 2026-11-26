import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFile } from 'node:fs/promises';

test.use({ reducedMotion: 'reduce' });

test('bond comparison controls and observations preserve the three explicit modes', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/particles/bonds/');
  await expect(page.locator('.world')).toHaveCount(3);
  await expect(page.getByRole('heading', { name: 'No bonds' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Chains' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Mesh' })).toBeVisible();
  await expect(page.locator('#tick')).toHaveText('0');
  await expect(page.getByLabel('Movement recipe')).toHaveValue('pursuit');
  await expect(page.getByLabel('Seed', { exact: true })).toHaveValue('1201');
  await expect(page.locator('.extension-summary')).toContainText(['Edges 0', 'Edges 0', 'Edges 0']);
  await expect(page.getByText('not conserved spring energy')).toBeVisible();
  await expect(page.getByText('not inherited')).toBeVisible();

  await page.getByRole('button', { name: 'One tick', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#tick')).toHaveText('1');
  await expect(page.locator('.extension-summary')).toContainText(['mean degree', 'mean degree', 'mean degree']);
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save comparison observation' }).click();
  const download = await pending;
  const observation = JSON.parse(await readFile((await download.path())!, 'utf8'));
  expect(observation.kind).toBe('particle-bonds-comparison-observation');
  expect(observation.comparisonTick).toBe(1);
  expect(observation.settings).toMatchObject({ seed: 1201, preset: 'pursuit', mutation: true, worlds: [{ mode: 'none' }, { mode: 'chains' }, { mode: 'mesh' }] });
  expect(observation.worlds.map((world: { extension: { mode: string } }) => world.extension.mode)).toEqual(['none', 'chains', 'mesh']);
  expect(observation.worlds.map((world: { extension: { graph: { tick: number } } }) => world.extension.graph.tick)).toEqual([1, 1, 1]);
  expect(observation.description).toContain('not a resumable checkpoint');
  expect(errors).toEqual([]);
});

test('bond overlay draws a shortest seam crossing and omits a false center chord', async ({ page }) => {
  await page.goto('/particles/bonds/');
  const samples = await page.evaluate(async () => {
    const overlayUrl = '/src/particles/bonds-render.ts';
    const { drawBondOverlay } = await import(overlayUrl);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 100;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#08151c'; ctx.fillRect(0, 0, 100, 100);
    drawBondOverlay(ctx, {
      mode: 'chains', bonds: [{ a: 1, b: 2, bornTick: 1 }],
      particles: [{ id: 1, x: .98, y: .5 }, { id: 2, x: .02, y: .5 }],
    } as never, 100);
    const pixel = (x: number) => Array.from(ctx.getImageData(x, 50, 1, 1).data).slice(0, 3);
    return { left: pixel(1), right: pixel(98), center: pixel(50) };
  });
  expect(samples.left[0]).toBeGreaterThan(40);
  expect(samples.right[0]).toBeGreaterThan(40);
  expect(samples.center[0]).toBeLessThan(40);
});

test('actual worlds form bonds by tick 50 and export the displayed graph counts', async ({ page }) => {
  await page.goto('/particles/bonds/');
  for (let tick = 0; tick < 50; tick++) await page.getByRole('button', { name: 'One tick', exact: true }).click();
  await expect(page.locator('#tick')).toHaveText('50');
  const edgeCounts = (await page.locator('.extension-summary').allTextContents()).map(text => Number(text.match(/Edges (\d+)/)?.[1]));
  expect(edgeCounts).toHaveLength(3);
  expect(edgeCounts[0]).toBe(0);
  expect(edgeCounts[1]).toBeGreaterThan(0);
  expect(edgeCounts[2]).toBeGreaterThan(0);

  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save comparison observation' }).click();
  const download = await pending;
  const observation = JSON.parse(await readFile((await download.path())!, 'utf8'));
  expect(observation.comparisonTick).toBe(50);
  expect(observation.worlds.map((world: { extension: { graph: { edgeCount: number } } }) => world.extension.graph.edgeCount)).toEqual(edgeCounts);
});

test('bond comparison fits a phone, passes accessibility checks and pauses while hidden', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/particles/bonds/');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const accessibility = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(accessibility.violations).toEqual([]);
  await page.getByRole('button', { name: 'One tick', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#tick')).toHaveText('1');
  await page.getByLabel('Seed', { exact: true }).fill('1203');
  await page.getByLabel('Movement recipe').selectOption('colonies');
  await page.getByLabel('Allow small inherited changes to movement traits').uncheck();
  await page.getByRole('button', { name: 'Start new comparison' }).click();
  await expect(page.locator('#tick')).toHaveText('0');
  await expect(page.locator('#active-settings')).toContainText('Colonies · seed 1203 · inherited mutation off');
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
  await page.waitForTimeout(150);
  await expect(page.locator('#tick')).toHaveText(stopped!);
});
