import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test.use({ reducedMotion: 'reduce' });

test('shared controls, fixed field views and observation download work together', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/boundaries/');
  await expect(page.getByRole('heading', { name: 'Boundaries in a changing field' })).toBeVisible();
  const desktopLayout = await page.locator('.comparison').evaluate(element => ({
    columns: getComputedStyle(element).gridTemplateColumns.split(' ').length,
    canvasWidth: element.querySelector('canvas[id^="field-"]')!.getBoundingClientRect().width,
    canvasHeight: element.querySelector('canvas[id^="field-"]')!.getBoundingClientRect().height,
  }));
  expect(desktopLayout.columns).toBe(2);
  expect(desktopLayout.canvasWidth).toBeGreaterThan(300);
  expect(Math.abs(desktopLayout.canvasWidth - desktopLayout.canvasHeight)).toBeLessThan(2);
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
  await expect(page.locator('#tick-smooth')).toHaveText('0');
  await page.getByRole('button', { name: 'One tick' }).click();
  for (const mode of ['smooth', 'walls', 'threshold', 'both']) await expect(page.locator(`#tick-${mode}`)).toHaveText('1');

  await page.getByLabel('Field view').selectOption('nutrient');
  await expect(page.locator('#field-walls')).toHaveAttribute('aria-label', /nutrient proxy field/);
  await page.getByLabel('Show wall gate').uncheck();
  await page.getByLabel('Shared seed').fill('1202');
  await page.getByRole('button', { name: 'Reset comparison' }).click();
  await expect(page.locator('#tick-both')).toHaveText('0');
  await page.getByLabel('Shared seed').fill('1202.5');
  await page.getByRole('button', { name: 'Reset comparison' }).click();
  await expect(page.getByLabel('Shared seed')).toHaveValue('1202.5');
  await expect(page.locator('#tick-both')).toHaveText('0');
  await expect(page.locator('#run-status')).toContainText('Seed must be a whole number');
  await page.getByLabel('Field view').selectOption('density');
  await page.getByLabel('Show wall gate').check();
  await expect(page.locator('#run-status')).toContainText('Seed must be a whole number');

  await page.getByLabel('Shared seed').fill('1202');
  await page.getByRole('button', { name: 'Reset comparison' }).click();
  await expect(page.locator('#run-status')).toContainText('Paused');
  await page.getByRole('button', { name: 'One tick' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#tick-both')).toHaveText('1');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save observation' }).click();
  const download = await downloadPromise;
  const observation = JSON.parse(await readFile((await download.path())!, 'utf8'));
  expect(observation.kind).toBe('boundary-field-comparison-observation');
  expect(observation.seed).toBe(1202);
  expect(observation.comparisonTick).toBe(1);
  expect(Object.keys(observation.modes)).toEqual(['smooth', 'walls', 'threshold', 'both']);
  for (const mode of Object.values(observation.modes) as Array<{ tick: number; fields: { density: number[]; nutrient: number[]; wall: number[] } }>) {
    expect(mode.tick).toBe(1);
    expect(mode.fields.density).toHaveLength(4096);
    expect(mode.fields.nutrient).toHaveLength(4096);
    expect(mode.fields.wall).toHaveLength(4096);
  }
  expect(errors).toEqual([]);
});

test('comparison is usable on a phone and pauses after a hidden-tab event', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/boundaries/');
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
  const mobileLayout = await page.locator('.comparison').evaluate(element => ({
    columns: getComputedStyle(element).gridTemplateColumns.split(' ').length,
    canvasWidth: element.querySelector('canvas[id^="field-"]')!.getBoundingClientRect().width,
  }));
  expect(mobileLayout.columns).toBe(1);
  expect(mobileLayout.canvasWidth).toBeGreaterThan(300);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
  await page.evaluate(() => Object.defineProperty(document, 'hidden', { configurable: true, value: false }));
  const tickBeforeKeyboardStep = Number((await page.locator('#tick-smooth').textContent())!.replaceAll(',', ''));
  await page.locator('#field-smooth').click();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#tick-smooth')).toHaveText(String(tickBeforeKeyboardStep + 1));
});

test('a page loaded in a hidden tab stays paused when shown', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.addInitScript(() => Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }));
  await page.goto('/boundaries/');
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
  const before = await page.locator('#tick-smooth').textContent();
  await page.waitForTimeout(150);
  await expect(page.locator('#tick-smooth')).toHaveText(before!);
});
