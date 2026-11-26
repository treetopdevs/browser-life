import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { rasterFrame } from '../../apps/lab/src/vision-screen/core.ts';

const artifact = JSON.parse(readFileSync(resolve(process.cwd(), 'docs/creative-prototypes/vision-calibration.json'), 'utf8'));

test('vision screen presents the saved failed calibration without inventing clips', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/vision-screen/');
  await expect(page.getByRole('heading', { name: 'Vision screen' })).toBeVisible();
  const expectedHeadlines: Record<string, string> = {
    'stopped-calibration': 'Judge failed calibration — no worlds selected',
    'calibration-passed': 'Calibration passed — no worlds selected',
  };
  await expect(page.getByRole('heading', { name: expectedHeadlines[artifact.status] })).toBeVisible();
  const passCount = artifact.comparisons.filter((row: any) => row.pass).length;
  const failedRows = artifact.comparisons.filter((row: any) => !row.pass);
  await expect(page.locator('#verdict-counts')).toHaveText(`${passCount} of ${artifact.comparisons.length} checks passed; ${failedRows.length} failed.`);
  await expect(page.getByText('No clips were generated in this calibration run.')).toBeVisible();
  await expect(page.getByRole('button', { name: /play|animate|start clip/i })).toHaveCount(0);
  const failureCounts = new Map<string, number>();
  for (const row of failedRows) {
    const negative = artifact.fixtures.find((fixture: any) => fixture.id === row.negativeId);
    failureCounts.set(negative.group, (failureCounts.get(negative.group) ?? 0) + 1);
  }
  const breakdown = await page.locator('.failure-count').evaluateAll(nodes => nodes.map(node => ({
    count: node.querySelector('strong')?.textContent,
    label: node.querySelector('span')?.textContent,
  })));
  expect(breakdown).toEqual([
    { count: String(failureCounts.get('1') ?? 0), label: 'One-cluster fixtures' },
    { count: String(failureCounts.get('uniform') ?? 0), label: 'Uniform-spread fixtures' },
    { count: String(failureCounts.get('blank') ?? 0), label: 'Blank controls' },
    { count: String(failureCounts.get('one') ?? 0), label: 'One-dot controls' },
  ]);
  await expect(page.locator('.fixture-card')).toHaveCount(6);
  await expect(page.getByLabel('Dot count')).toHaveValue('120');
  await expect(page.getByLabel('Layout offset')).toHaveValue('0');

  for (const count of ['60', '120', '240']) {
    for (const layout of ['0', '1', '2']) {
      await page.getByLabel('Dot count').selectOption(count);
      await page.getByLabel('Layout offset').selectOption(layout);
      await expect(page.locator('.fixture-card')).toHaveCount(6);
    }
  }
  for (const group of ['1', '3', '6', '12', 'uniform', 'seam6']) {
    await page.getByLabel('Dot count').selectOption('120');
    await page.getByLabel('Layout offset').selectOption('0');
    await page.getByLabel('Fixture type').selectOption(group);
    await expect(page.locator('.fixture-card')).toHaveCount(1);
    if (group === '3') await expect(page.locator('.fixture-result')).toHaveText('No required checks (diagnostic)');
  }
  await page.getByLabel('Fixture type').selectOption('all');
  await page.getByLabel('Dot count').selectOption('diagnostics');
  await expect(page.locator('.fixture-card')).toHaveCount(2);
  for (const group of ['blank', 'one']) {
    await page.getByLabel('Fixture type').selectOption(group);
    await expect(page.locator('.fixture-card')).toHaveCount(1);
  }

  await page.getByLabel('Dot count').selectOption('120');
  await page.getByLabel('Fixture type').selectOption('all');
  const fixture = artifact.fixtures.find((row: any) => row.id === 'cal-120-layout0-6');
  expect(fixture).toBeTruthy();
  const expectedRgb = [...rasterFrame(fixture.frame)];
  const tileCanvas = page.locator('[data-fixture="cal-120-layout0-6"] canvas');
  const actualPixels = await tileCanvas.evaluate(node => {
    const canvas = node as HTMLCanvasElement;
    return [...canvas.getContext('2d')!.getImageData(0, 0, 128, 128).data];
  });
  const expectedRgba = expectedRgb.flatMap((_, i) => i % 3 === 0 ? [expectedRgb[i], expectedRgb[i + 1], expectedRgb[i + 2], 255] : []);
  expect(actualPixels).toEqual(expectedRgba);

  const selectedTile = page.getByRole('button', { name: 'Inspect 120 dots · layout 0 · 6 clusters' });
  await selectedTile.focus();
  await page.keyboard.press('Enter');
  await expect(selectedTile).toBeFocused();
  await expect(page.locator('#selected-panel')).toBeVisible();
  await expect(page.locator('#selected-title')).toHaveText(fixture.label);
  await expect(page.getByRole('columnheader', { name: 'Target fixture margin − control margin' })).toBeVisible();
  await expect(page.locator('.comparison-explainer')).toHaveText('The table shows target fixture margin − control margin. Positive means the target fixture scored above the control; negative means it scored below.');
  await expect(page.locator('#selected-scores')).toContainText('This fixture target margin (target minus stronger alternative)');
  const relevant = artifact.comparisons.filter((row: any) => row.targetId === fixture.id || row.negativeId === fixture.id);
  await expect(page.locator('#comparison-rows tr')).toHaveCount(relevant.length);
  for (const row of relevant) {
    const counterpart = artifact.fixtures.find((item: any) => item.id === (row.targetId === fixture.id ? row.negativeId : row.targetId));
    await expect(page.locator('#comparison-rows')).toContainText(counterpart.label);
  }
  await page.getByRole('button', { name: 'Close details' }).click();
  await expect(page.locator('#selected-panel')).toBeHidden();
  await expect(selectedTile).toBeFocused();

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Export full JSON' }).click();
  const download = await downloadPromise;
  const exported = JSON.parse(readFileSync((await download.path())!, 'utf8'));
  expect(exported).toMatchObject({ status: 'stopped-calibration', fixtures: expect.any(Array) });
  expect(exported.fixtures).toHaveLength(artifact.fixtures.length);
  expect(exported.comparisons.filter((row: any) => !row.pass)).toHaveLength(failedRows.length);
  expect(errors).toEqual([]);
});

test('vision calibration gallery fits a phone in one column', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/vision-screen/');
  await expect(page.locator('.fixture-card')).toHaveCount(6);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(await page.locator('#gallery').evaluate(node => getComputedStyle(node).gridTemplateColumns.split(' ').length)).toBe(1);
  await page.getByLabel('Dot count').selectOption('diagnostics');
  await page.getByLabel('Fixture type').selectOption('one');
  await page.getByRole('button', { name: 'Inspect One dot' }).click();
  await expect(page.locator('#selected-image')).toBeVisible();
  await expect(page.locator('#selected-image')).toHaveAttribute('aria-label', 'One dot, saved static calibration image');
});
