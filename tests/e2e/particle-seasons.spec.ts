import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFile } from 'node:fs/promises';

test.use({ reducedMotion: 'reduce' });

test('season comparison shows phase boundaries and exports environment clocks', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/particles/seasons/');
  await expect(page.locator('.world')).toHaveCount(3);
  await expect(page.locator('.world-history')).toHaveCount(3);
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  await expect(page.locator('#tick')).toHaveText('0');
  await expect(page.locator('.environment')).toContainText(['steady renewal', '600 ticks per phase', '1,800 ticks per phase']);
  await expect(page.getByLabel('Movement recipe')).toHaveValue('flocks');
  await expect(page.getByLabel('Seed', { exact: true })).toHaveValue('1201');
  await expect(page.locator('.regime')).toHaveText(['Still renewal', 'First phase ready · applies from tick 1', 'First phase ready · applies from tick 1']);

  const initialDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save comparison observation' }).click();
  const initialObservation = JSON.parse(await readFile((await (await initialDownload).path())!, 'utf8'));
  expect(initialObservation.comparisonClocks).toMatchObject([
    { worldTick: 0, comparisonTick: 0, extinctionTick: null, lastAppliedStep: null, phaseReferenceStep: 1, seasonalPhase: null, nextChangeTick: null },
    { worldTick: 0, comparisonTick: 0, extinctionTick: null, lastAppliedStep: null, phaseReferenceStep: 1, seasonalPhase: { phase: 0, nextChangeTick: 601 }, nextChangeTick: 601 },
    { worldTick: 0, comparisonTick: 0, extinctionTick: null, lastAppliedStep: null, phaseReferenceStep: 1, seasonalPhase: { phase: 0, nextChangeTick: 1801 }, nextChangeTick: 1801 },
  ]);
  const frozen = await page.evaluate(async () => {
    const modulePath: string = '/src/particles/environment-page.ts';
    const pageModule = await import(modulePath) as { environmentClock: (environment: { kind: 'seasonal'; period: 600 }, worldTick: number, comparisonTick: number, extinctionTick: number | null, phaseAt: (environment: { kind: 'seasonal'; period: 600 }, step: number) => { phase: number; nextChangeTick: number } | null) => { lastAppliedStep: number | null; phaseReferenceStep: number; seasonalPhase: { phase: number; nextChangeTick: number | null } | null; nextChangeTick: number | null } };
    const modelPath: string = '/src/particles/model.ts';
    const model = await import(modelPath) as { seasonalPhase: (environment: { kind: 'seasonal'; period: 600 }, step: number) => { phase: number; nextChangeTick: number } | null };
    return pageModule.environmentClock({ kind: 'seasonal', period: 600 }, 601, 700, 601, model.seasonalPhase);
  });
  expect(frozen).toMatchObject({ lastAppliedStep: 601, phaseReferenceStep: 601, seasonalPhase: { phase: 1, nextChangeTick: null }, nextChangeTick: null });
  await page.getByRole('button', { name: 'One tick', exact: true }).click();
  await expect(page.locator('#tick')).toHaveText('1');
  await page.evaluate(() => {
    const stepButton = document.querySelector<HTMLButtonElement>('#step')!;
    for (let i = 0; i < 599; i++) stepButton.click();
  });
  await expect(page.locator('#tick')).toHaveText('600');
  await expect(page.locator('.regime')).toHaveText(['Still renewal', 'Phase 1 · next change at tick 601', 'Phase 1 · next change at tick 1,801']);
  await page.getByLabel('Pace').selectOption('4');
  await page.evaluate(() => {
    const state = window as Window & { __firstRenderedPhaseTwoTick?: number };
    const shortSeasonLabel = document.querySelectorAll('.regime')[1];
    const observer = new MutationObserver(() => {
      if (state.__firstRenderedPhaseTwoTick !== undefined || !shortSeasonLabel.textContent?.startsWith('Phase 2')) return;
      state.__firstRenderedPhaseTwoTick = Number((document.querySelector('#tick')?.textContent ?? '0').replaceAll(',', ''));
    });
    observer.observe(shortSeasonLabel, { childList: true, characterData: true, subtree: true });
  });
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.waitForFunction(() => (window as Window & { __firstRenderedPhaseTwoTick?: number }).__firstRenderedPhaseTwoTick !== undefined);
  const firstRenderedPhaseTwoTick = await page.evaluate(() => (window as Window & { __firstRenderedPhaseTwoTick?: number }).__firstRenderedPhaseTwoTick ?? -1);
  expect(firstRenderedPhaseTwoTick).toBeGreaterThanOrEqual(601);
  expect(firstRenderedPhaseTwoTick).toBeLessThanOrEqual(604);
  await expect(page.locator('.regime').nth(1)).toHaveText('Phase 2 · next change at tick 1,201');
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.locator('.stocks').nth(1)).toContainText('0.25×');
  await page.getByLabel('Seed', { exact: true }).fill('1203');
  await page.getByLabel('Movement recipe').selectOption('colonies');
  await page.getByLabel('Allow small inherited changes to movement traits').uncheck();
  await page.getByRole('button', { name: 'Start new comparison' }).click();
  await expect(page.locator('#tick')).toHaveText('0');
  await expect(page.locator('#active-settings')).toContainText('Colonies · seed 1203 · inherited mutation off');
  await page.getByRole('button', { name: 'One tick', exact: true }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save comparison observation' }).click();
  const download = await downloadPromise;
  const observation = JSON.parse(await readFile((await download.path())!, 'utf8'));
  expect(observation).toMatchObject({ kind: 'particle-seasons-observation', comparisonTick: 1, extinctionTicks: [null, null, null] });
  expect(observation.settings).toMatchObject({ seed: 1203, preset: 'colonies', mutation: false });
  expect(observation.settings.environments).toEqual([
    { kind: 'still' },
    { kind: 'seasonal', period: 600 },
    { kind: 'seasonal', period: 1800 },
  ]);
  expect(observation.comparisonClocks).toMatchObject([
    { worldTick: 1, comparisonTick: 1, extinctionTick: null, lastAppliedStep: 1, seasonalPhase: null, nextChangeTick: null },
    { worldTick: 1, comparisonTick: 1, extinctionTick: null, lastAppliedStep: 1, seasonalPhase: { phase: 0, nextChangeTick: 601 }, nextChangeTick: 601 },
    { worldTick: 1, comparisonTick: 1, extinctionTick: null, lastAppliedStep: 1, seasonalPhase: { phase: 0, nextChangeTick: 1801 }, nextChangeTick: 1801 },
  ]);
  expect(observation.worlds.map((world: { settings: { environment: unknown } }) => world.settings.environment)).toEqual(observation.settings.environments);
  expect(observation.description).toContain('not a resumable checkpoint');
  expect(errors).toEqual([]);
});

test('season controls are keyboard accessible and fit a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/particles/seasons/');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  for (const chart of await page.locator('.world-history').all()) {
    const box = await chart.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width / box!.height).toBeCloseTo(3.6, 1);
  }
  const accessibility = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(accessibility.violations).toEqual([]);
  await page.getByRole('button', { name: 'One tick', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#tick')).toHaveText('1');
  await expect(page.locator('.patch-stock')).toHaveCount(3);
  await expect(page.getByText('nearest patch', { exact: false })).toBeVisible();
});
