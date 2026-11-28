// The public Soft Roam page (/softroam/): it grows on its own, its choices say what they do, the day and night switch
// holds under the site's key, it starts paused for a visitor who asks for less motion, and it fits a phone.
// BL_SOFTROAM_SHOTS=<dir> writes screenshots there.
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const stepOf = async (page: Page): Promise<number> => Number(((await page.locator('#r-step').textContent()) ?? '').replace(/,/g, '')) || 0;
const errorsOf = (page: Page): string[] => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  return errors;
};

test('grows, says what each choice does, switches colours, and fits a phone', async ({ page }) => {
  test.setTimeout(120_000);
  const shots = process.env.BL_SOFTROAM_SHOTS;
  const errors = errorsOf(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/softroam/');
  await expect(page).toHaveTitle('Soft Roam · Cadence Garden');
  await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
  await expect(page.locator('a.back')).toHaveAttribute('href', '/story/#chapter-9');

  // It grows on its own, and Play reads Pause in green while it does.
  await expect.poll(() => stepOf(page), { timeout: 30_000 }).toBeGreaterThan(30);
  await expect(page.locator('#play')).toHaveText('Pause');
  await expect(page.locator('#play')).toHaveClass(/\bgrowing\b/);
  await expect(page.locator('#r-res')).toHaveText('balanced (0 missing)');
  await expect(page.locator('#start-says')).toContainText('21 to 25 cells');
  if (shots) await page.screenshot({ path: `${shots}/softroam-day.png`, fullPage: true });

  // Pause holds the count; One step moves it by one.
  await page.locator('#play').click();
  await expect(page.locator('#play')).toHaveText('Play');
  await expect(page.locator('#play')).not.toHaveClass(/\bgrowing\b/);
  await page.waitForTimeout(400);
  const paused = await stepOf(page);
  await page.waitForTimeout(600);
  expect(await stepOf(page)).toBe(paused);
  await page.locator('#step').click();
  await expect.poll(() => stepOf(page)).toBe(paused + 1);

  // The skip link is navigation: it does not start the world again.
  const before = await stepOf(page);
  await page.locator('a.skip').focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#main$/);
  await page.waitForTimeout(500);
  expect(await stepOf(page)).toBeGreaterThanOrEqual(before);

  // A start that sets every cell alike says so under Kinds of cell too.
  await page.locator('#start').selectOption('grown-lines');
  await expect(page.locator('#kinds')).toHaveValue('0');
  await expect(page.locator('#kinds-says')).toContainText('Every cell is alike');

  // A choice says what it does, starts a new world, and the link names it.
  await page.locator('#start').selectOption('deep');
  await expect(page.locator('#start-says')).toContainText('three levels');
  await expect(page).toHaveURL(/start=deep/);
  // Picking the three-level start opens in the 3D tilted tank view with camera controls visible.
  await expect(page.locator('#paint')).toHaveValue('tank');
  await expect(page.locator('#view-3d')).toBeVisible();
  await expect(page.locator('#view')).toBeHidden();
  await expect(page.locator('#tank-controls')).toBeVisible();
  await page.locator('#play').click();
  await expect.poll(() => page.locator('#r-levels').textContent(), { timeout: 30_000 }).toContain('on the floor');

  // Pause before comparing camera angles so any pixel diff is purely camera movement, not sim drift.
  await page.locator('#play').click();
  await expect(page.locator('#play')).toHaveText('Play');
  await page.waitForTimeout(250);
  const shotTilted = await page.locator('#view-3d').screenshot();
  await page.locator('#tank-controls button[data-preset="side"]').click();
  const shotSide = await page.locator('#view-3d').screenshot();
  expect(Buffer.compare(shotTilted, shotSide)).not.toBe(0);

  // Dragging the 3D viewport orbits the camera while paused.
  const box = (await page.locator('#view-3d').boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.72, box.y + box.height * 0.42, { steps: 5 });
  await page.mouse.up();
  const shotDragged = await page.locator('#view-3d').screenshot();
  expect(Buffer.compare(shotSide, shotDragged)).not.toBe(0);

  await page.locator('#tank-proj').click();
  await expect(page.locator('#tank-proj')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#tank-controls button[data-preset="iso"]').click();
  await expect(page.locator('#tank-controls button[data-preset="iso"]')).toHaveAttribute('aria-pressed', 'true');

  // Phone width in 3D tank mode: controls and viewport fit with no horizontal overflow.
  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  await page.setViewportSize({ width: 1280, height: 900 });

  await page.locator('#paint').selectOption('top');
  await expect(page.locator('#view')).toBeVisible();
  await expect(page.locator('#view-3d')).toBeHidden();
  await expect(page.locator('#tank-controls')).toBeHidden();
  await expect(page.locator('#paint-says')).toContainText('straight above');

  // The dials are folded away until asked for.
  await expect(page.locator('#dials')).toBeHidden();
  await page.locator('details.dials summary').click();
  await expect(page.locator('#dial-pulse')).toBeVisible();

  // Night colours, kept for the next visit under the site's own key.
  await page.getByRole('button', { name: 'Switch to night colours' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await page.evaluate(() => localStorage.getItem('browser-life-theme'))).toBe('dark');
  if (shots) await page.screenshot({ path: `${shots}/softroam-night.png`, fullPage: true });

  // Phone width: nothing wider than the screen.
  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  if (shots) await page.screenshot({ path: `${shots}/softroam-phone-night.png`, fullPage: true });
  await page.getByRole('button', { name: 'Switch to day colours' }).click();
  if (shots) {
    await page.screenshot({ path: `${shots}/softroam-phone-day.png`, fullPage: true });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `${shots}/softroam-phone-top.png` });
    await page.locator('.stage').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${shots}/softroam-phone-stage.png` });
  }
  expect(errors).toEqual([]);
});

test('waits for Play when the visitor asks for less motion', async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors = errorsOf(page);
  await page.goto('/softroam/');
  await expect(page.locator('#play')).toHaveText('Play');
  await page.waitForTimeout(1500);
  expect(await stepOf(page)).toBe(0);
  await page.locator('#play').click();
  await expect.poll(() => stepOf(page), { timeout: 30_000 }).toBeGreaterThan(5);
  expect(errors).toEqual([]);
  await context.close();
});
