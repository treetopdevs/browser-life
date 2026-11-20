import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

test.use({ reducedMotion: 'reduce' });

const stepOf = async (page: Page) => Number(((await page.locator('#r-t').textContent()) ?? '').replace(/\D/g, ''));
const url = (page: Page) => page.locator('#world').evaluate((c) => (c as HTMLCanvasElement).toDataURL());
const optionValues = (page: Page, sel: string) => page.locator(`${sel} option`).evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));

test('the oligomer world runs, keeps its matter check at 0, 0, and every world, view and tile works', async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/oligomer/');
  await expect(page.getByRole('heading', { name: 'Compartments that fight over wall patterns' })).toBeVisible();
  await expect(page.locator('#r-res')).toHaveText('res 0, 0');
  await expect(page.locator('#r-live')).toHaveText('6');
  await expect(page.locator('#r-t')).toHaveText('0');

  // click a founder square before anything runs: seed 1 on 32x32 puts the 0011 founder at (6, 8)
  const box = (await page.locator('#world').boundingBox())!;
  await page.locator('#world').click({ position: { x: ((6 + 0.5) / 32) * box.width, y: ((8 + 0.5) / 32) * box.height } });
  await expect(page.locator('#inspector')).toContainText('tile (6, 8)');
  await expect(page.locator('#inspector')).toContainText('0011');
  await expect(page.locator('#inspector')).toContainText('CLV');
  await expect(page.locator('#live')).toContainText('Tile (6, 8)');
  await page.locator('#world').click({ position: { x: ((1 + 0.5) / 32) * box.width, y: ((1 + 0.5) / 32) * box.height } });
  await expect(page.locator('#inspector')).toContainText('Empty');

  // keyboard: arrows move the selection, Escape clears it, focus ring is visible
  await page.locator('#world').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#inspector')).toContainText('tile (2, 1)');
  await page.keyboard.press('Escape');
  await expect(page.locator('#inspector')).toContainText('Nothing selected');
  expect(await page.locator('#world').evaluate((e) => getComputedStyle(e).outlineStyle)).not.toBe('none');

  // play
  const shot = process.env.BL_OLIGOMER_SHOT;
  if (shot) await page.locator('#pace').selectOption('0');
  await page.getByRole('button', { name: 'Play' }).click();
  await expect.poll(() => stepOf(page), { timeout: shot ? 180_000 : 60_000 }).toBeGreaterThan(shot ? 20000 : 300);
  await page.getByRole('button', { name: 'Pause' }).click();
  await expect(page.locator('#r-res')).toHaveText('res 0, 0');
  await expect(page.locator('#r-res')).toHaveClass(/ok/);
  await expect(page.locator('#r-res-word')).toHaveText('balanced');
  if (shot) await page.screenshot({ path: shot, fullPage: true });

  // every view mode redraws and changes the legend
  const wallUrl = await url(page);
  const stepNow = await stepOf(page);
  let prevLegend = await page.locator('#legend').innerText();
  for (const v of ['lysin', 'trophic', 'chem']) {
    await page.locator('#view').selectOption(v);
    await expect(page.locator('#view-note')).not.toBeEmpty();
    expect(await page.locator('#legend').innerText()).not.toBe(prevLegend);
    prevLegend = await page.locator('#legend').innerText();
    await expect.poll(() => url(page)).not.toBe(wallUrl);
    if (v === 'lysin') expect(prevLegend).toContain('ring');
    expect(await stepOf(page)).toBe(stepNow);
  }
  // chemistry channels (the view is chem now)
  await expect(page.locator('#chem')).toBeVisible();
  const seen = new Set<string>();
  for (const ch of await optionValues(page, '#chem')) {
    await page.locator('#chem').selectOption(ch);
    await expect(page.locator('#scale')).toContainText('scale:');
    seen.add(await url(page));
  }
  expect(seen.size).toBe(3);
  await page.locator('#view').selectOption('wall');
  await expect(page.locator('#chem')).toBeHidden();
  await expect.poll(() => url(page)).toBe(wallUrl);

  // every world builds, pauses, steps once and keeps residual 0, 0; each has its own note
  let prevNote = '';
  for (const v of await optionValues(page, '#start')) {
    await page.locator('#start').selectOption(v);
    await expect(page.locator('#r-t')).toHaveText('0');
    await expect(page.locator('#r-live')).toHaveText('6');
    await page.getByRole('button', { name: 'One step' }).click();
    await expect(page.locator('#r-t')).toHaveText('1');
    await expect(page.locator('#r-res')).toHaveText('res 0, 0');
    const note = (await page.locator('#world-note').textContent()) ?? '';
    expect(note.length).toBeGreaterThan(20);
    expect(note).not.toBe(prevNote);
    prevNote = note;
  }

  // a junk or empty seed is replaced by 1 with a spoken notice; resetting while playing pauses at step 0
  await page.locator('#view').selectOption('chem');
  const chemPaused = await url(page);
  await page.locator('#view').selectOption('wall');
  await page.locator('#view').selectOption('chem');
  expect(await url(page)).toBe(chemPaused); // a paused redraw is repeatable
  await page.locator('#view').selectOption('wall');
  await page.getByRole('button', { name: 'Play' }).click();
  await expect.poll(() => stepOf(page)).toBeGreaterThan(0);
  await page.locator('#seed').fill('');
  await page.locator('#seed').press('Enter');
  await expect(page.locator('#seed')).toHaveValue('1');
  await expect(page.locator('#live')).toContainText('seed 1 is used');
  await expect(page.locator('#r-t')).toHaveText('0');
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
  await expect(page.locator('#history')).toHaveAttribute('aria-label', /No census yet/);

  // grid sizes
  for (const size of ['16', '24', '32']) {
    await page.locator('#size').selectOption(size);
    await expect(page.locator('#r-t')).toHaveText('0');
    await expect(page.locator('#r-live')).toHaveText('6');
    await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
  }
  for (const v of await optionValues(page, '#start')) {
    await page.locator('#size').selectOption('16');
    await page.locator('#start').selectOption(v);
    await expect(page.locator('#r-live')).toHaveText('6');
  }

  // phone width: no sideways scroll, grid fits
  await page.setViewportSize({ width: 375, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect((await page.locator('#world').boundingBox())!.width).toBeLessThanOrEqual(375);
  if (shot) await page.screenshot({ path: shot.replace(/\.png$/, '') + '-390.png', fullPage: true });
  expect(errors).toEqual([]);
});
