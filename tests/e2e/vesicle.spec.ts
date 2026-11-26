import { expect, test } from '@playwright/test';

test.use({ reducedMotion: 'reduce' });

test('the vesicle world runs, keeps its matter total, and each tool and start world works', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/vesicle/');
  await expect(page.getByRole('heading', { name: 'A cell that divides because of its shape' })).toBeVisible();
  await expect(page.locator('#r-live')).toHaveText('6');
  const matter = await page.locator('#r-matter').textContent();
  await page.getByRole('button', { name: 'Play' }).click();
  await expect.poll(async () => Number((await page.locator('#r-t').textContent())!.replace(/\D/g, '')), { timeout: 60_000 }).toBeGreaterThan(process.env.BL_VESICLE_SHOT ? 6000 : 300);
  await page.getByRole('button', { name: 'Pause' }).click();
  if (process.env.BL_VESICLE_SHOT) await page.screenshot({ path: process.env.BL_VESICLE_SHOT, fullPage: true });
  await expect(page.locator('#r-matter')).toHaveText(matter!);
  expect(Number(await page.locator('#r-solute').textContent())).toBeGreaterThan(360);

  // dropping lipid adds exactly 60 units of matter
  await page.locator('#world').click({ position: { x: 20, y: 20 } });
  await expect(page.locator('#live')).toHaveText('Dropped 60 lipid.');
  const after = Number((await page.locator('#r-matter').textContent())!.replace(/\D/g, ''));
  expect(after).toBe(Number(matter!.replace(/\D/g, '')) + 60);

  // bursting a cell leaves matter unchanged and one fewer ring
  await page.locator('#start').selectOption('theft');
  await expect(page.locator('#r-live')).toHaveText('2');
  const m2 = await page.locator('#r-matter').textContent();
  await page.getByLabel(/Burst the cell there/).check();
  const box = (await page.locator('#world').boundingBox())!;
  await page.locator('#world').click({ position: { x: (box.width * 38) / 128, y: box.height / 2 } });
  await expect(page.locator('#live')).toContainText('Burst a cell');
  await expect(page.locator('#r-live')).toHaveText('1');
  await expect(page.locator('#r-matter')).toHaveText(m2!);

  for (const kind of ['heredity', 'nogain', 'neutral', 'feed', 'garden']) {
    await page.locator('#start').selectOption(kind);
    await page.getByRole('button', { name: 'One step' }).click();
    await expect(page.locator('#r-t')).toHaveText('1');
  }
  // phone width: no sideways scroll
  await page.setViewportSize({ width: 375, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});
