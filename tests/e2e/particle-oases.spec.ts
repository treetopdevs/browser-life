import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFile } from 'node:fs/promises';

test.use({ reducedMotion: 'reduce' });

async function expectCompactHistoryCharts(page: Page) {
  const charts = await page.locator('.world-history').all();
  expect(charts).toHaveLength(3);
  for (const chart of charts) {
    const box = await chart.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width / box!.height).toBeCloseTo(3.6, 1);
  }
}

test('oases compares one recipe across still and travelling patches', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/particles/oases/');
  await expect(page.locator('.world')).toHaveCount(3);
  await expect(page.locator('.world-view')).toHaveCount(3);
  await expectCompactHistoryCharts(page);
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  await expect(page.locator('#tick')).toHaveText('0');
  await expect(page.locator('.environment')).toContainText(['patches stay in place', '0.0001 world widths per tick', '0.00025 world widths per tick']);
  await expect(page.getByLabel('Movement recipe')).toHaveValue('pursuit');
  await expect(page.getByLabel('Seed', { exact: true })).toHaveValue('1201');

  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'One tick', exact: true }).click();
  await expect(page.locator('#tick')).toHaveText('1');
  await expect(page.locator('.chart-range')).toHaveText(['Ticks 0–1', 'Ticks 0–1', 'Ticks 0–1']);
  expect((await page.locator('.food-contact').allTextContents()).every(value => value !== '—')).toBe(true);
  await page.getByRole('button', { name: 'Save comparison observation' }).click();
  const download = await pending;
  const observation = JSON.parse(await readFile((await download.path())!, 'utf8'));
  expect(observation).toMatchObject({ kind: 'particle-oases-observation', comparisonTick: 1, extinctionTicks: [null, null, null] });
  expect(observation.settings.environments).toEqual([
    { kind: 'still' },
    { kind: 'travelling', speed: 0.0001 },
    { kind: 'travelling', speed: 0.00025 },
  ]);
  expect(observation.worlds).toHaveLength(3);
  expect(observation.worlds.map((world: { settings: { environment: unknown } }) => world.settings.environment)).toEqual(observation.settings.environments);
  const still = observation.worlds[0].food;
  const slow = observation.worlds[1].food;
  const fast = observation.worlds[2].food;
  for (let i = 0; i < 9; i++) {
    const row = Math.floor(i / 3);
    const direction = row === 1 ? -1 : 1;
    expect(still[i].x).toBeCloseTo((i % 3 + 0.5) / 3, 12);
    expect(slow[i].x).toBeCloseTo(still[i].x + direction * 0.0001, 12);
    expect(fast[i].x).toBeCloseTo(still[i].x + direction * 0.00025, 12);
    expect(slow[i].amount).toBe(still[i].amount);
    expect(fast[i].amount).toBe(still[i].amount);
  }
  expect(observation.worlds[0].settings).toMatchObject({ seed: 1201, preset: 'pursuit', mutation: true });
  expect(observation.description).toContain('not a resumable checkpoint');
  expect(errors).toEqual([]);
});

test('oases controls work by keyboard and the page fits a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/particles/oases/');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expectCompactHistoryCharts(page);
  const accessibility = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(accessibility.violations).toEqual([]);
  await page.getByRole('button', { name: 'One tick', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#tick')).toHaveText('1');
  await expect(page.locator('.world-state')).toHaveText([/Tick 1/, /Tick 1/, /Tick 1/]);
  await expect(page.locator('.food-contact')).toHaveCount(3);
  await expect(page.locator('.patch-stock')).toHaveCount(3);
  await expect(page.getByText('supplied steering')).toBeVisible();
});

test('oases settings reset the three worlds together and hidden pages stay paused', async ({ page }) => {
  await page.goto('/particles/oases/');
  await page.getByRole('button', { name: 'One tick', exact: true }).click();
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
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
});
