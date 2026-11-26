import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('spatial camera, slice and settings controls preserve paused physics', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/spatial/');
  await expect(page.getByRole('heading', { name: 'Life in three dimensions' })).toBeVisible();
  await expect(page.locator('#tick')).toHaveText('0');
  await expect(page.locator('#status')).toHaveText('Paused · ready');
  await expect(page.getByLabel('Movement recipe')).toHaveValue('pursuit');
  await expect(page.getByLabel('Seed', { exact: true })).toHaveValue('1201');
  await expect(page.locator('#population')).toHaveText('120');

  await page.getByRole('button', { name: 'One tick', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#tick')).toHaveText('1');
  const saveSnapshot = async () => {
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Save bounded observation' }).click();
    const download = await pending;
    return JSON.parse(await readFile((await download.path())!, 'utf8'));
  };
  const before = await saveSnapshot();
  await page.getByLabel(/Camera yaw/).fill('120');
  await page.getByLabel(/Camera pitch/).fill('35');
  await page.getByLabel('Show food centers').check();
  await page.getByLabel('Show a depth slice').check();
  await page.getByLabel(/Slice center z/).fill('0.02');
  await expect(page.locator('#tick')).toHaveText('1');
  await expect(page.locator('#displayed')).toHaveText(/\d+/);
  const after = await saveSnapshot();
  expect(after.snapshot).toEqual(before.snapshot);
  expect(after.view).toMatchObject({ showFood: true, sliceCenter: 0.02, sliceThickness: 0.2 });
  expect(after.settings).toMatchObject({ seed: 1201, preset: 'pursuit', mutation: true });
  expect(after.description).toContain('Camera and displayed slice do not affect physics');
  expect(after.stoppedTick).toBe(1);
  expect(after.extinct).toBe(false);
  expect(after.horizonReached).toBe(false);
  expect(Number((await page.locator('#displayed').textContent())!)).toBeLessThan(Number((await page.locator('#population').textContent())!));

  await page.getByRole('button', { name: 'Reset camera' }).click();
  await expect(page.locator('#yaw-value')).toHaveText('37°');
  await expect(page.locator('#pitch-value')).toHaveText('−20°');
  await page.getByLabel('Seed', { exact: true }).fill('1203');
  await page.getByLabel('Movement recipe').selectOption('colonies');
  await page.getByLabel('Allow small inherited changes to movement traits').uncheck();
  await page.getByRole('button', { name: 'Start new world' }).click();
  await expect(page.locator('#tick')).toHaveText('0');
  await expect(page.locator('#active-settings')).toContainText('Colonies · seed 1203 · inherited mutation off');
  await expect(page.getByLabel('Show a depth slice')).toBeChecked();
  expect(errors).toEqual([]);
});

test('spatial world fits a phone and pauses while hidden, staying paused on return', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/spatial/');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect.poll(async () => Number((await page.locator('#tick').textContent())!.replaceAll(',', ''))).toBeGreaterThan(0);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.locator('#status')).toHaveText('Paused while away');
  const stopped = await page.locator('#tick').textContent();
  await page.waitForTimeout(150);
  await expect(page.locator('#tick')).toHaveText(stopped!);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(150);
  await expect(page.locator('#tick')).toHaveText(stopped!);
  await expect(page.locator('#status')).toHaveText('Paused while away');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.locator('#status')).toHaveText('Running');
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.locator('#status')).toHaveText('Paused by you');
});

test('interactive playback stops at tick 6,000 without overshooting the horizon', async ({ page }) => {
  await page.goto('/spatial/');
  await page.getByLabel('Pace').selectOption('4');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.locator('#status')).toHaveText('Pilot horizon reached · reset to continue', { timeout: 180_000 });
  await expect(page.locator('#tick')).toHaveText('6,000');
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeDisabled();
});
