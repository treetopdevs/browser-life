import { expect, test } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const evidence = JSON.parse(readFileSync(fileURLToPath(new URL('../../docs/historical-opponents-archive-2026-11-02/evidence.json', import.meta.url)), 'utf8'));
const out = fileURLToPath(new URL('../../docs/historical-opponents-archive-2026-11-02', import.meta.url));
test('the archive tournament page renders from the committed evidence at 1280 and 375 px', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  mkdirSync(out, { recursive: true });
  for (const [w, h] of [[1280, 1000], [375, 800]] as const) {
    await page.setViewportSize({ width: w, height: h });
    await page.goto('/opponents/archive/');
    await expect(page.locator('#verdict')).toContainText('Recorded labels');
    await expect(page.locator('#matrix tbody tr')).toHaveCount(5);
    await expect(page.locator('#controls tbody tr')).not.toHaveCount(0);
    await expect(page.locator('#controls tbody tr').nth(3)).toContainText('n/a (descriptive)');
    await expect(page.locator('#naive tbody tr')).not.toHaveCount(0);
    await expect(page.locator('#hist rect.obs')).toHaveCount(1);
    // every source must replace the matrix, the null statistic and the label, not just show the same text again
    for (const src of evidence.summary.sources) {
      await page.locator('#source').selectOption(src.short);
      await expect(page.locator('#srchelp')).toContainText(`Label for this search: ${src.label}`);
      const ids: string[] = src.tournament.ids;
      await expect(page.locator('#matrix thead th')).toHaveText(['Later against earlier', ...ids]);
      await expect(page.locator('#matrix tbody th')).toHaveText(ids);
      const a = src.tournament.analysis;
      await expect(page.locator('#nulltext')).toContainText(`Observed D = ${a.rank.observed === null ? 'n/a' : a.rank.observed.toFixed(3)}`);
      await expect(page.locator('#nulltext')).toContainText(`ranks ${a.rank.rDir === null ? 'n/a' : a.rank.rDir.toFixed(3)}`);
      const p = src.tournament.pairs.find((q: { a: string; b: string; summary: { mean: number | null } }) => q.b === ids[1] && q.a === ids[0]);
      if (p && p.summary.mean !== null) await expect(page.locator('#matrix tbody tr').nth(1).locator('td').nth(0)).toContainText((1 - p.summary.mean).toFixed(2));
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await page.screenshot({ path: `${out}/archive-${w}.png`, fullPage: true });
  }
  expect(errors).toEqual([]);
});
