import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// The page must not start by itself for a visitor who asks for reduced motion; the long test below presses Play.

const num = async (page: Page, id: string) => Number(((await page.locator(id).textContent()) ?? '').replace(/[^\d.]/g, ''));
const stepOf = (page: Page) => num(page, '#r-step');
const picture = (page: Page) => page.locator('#world').evaluate((c) => (c as HTMLCanvasElement).toDataURL());

/** The picture with its readouts and charts beside it: the stage, from its top. */
async function shoot(page: Page, path: string): Promise<void> {
  await page.locator('.stage').evaluate((s) => window.scrollTo(0, s.getBoundingClientRect().top + window.scrollY - 16));
  await page.screenshot({ path });
  await page.evaluate(() => window.scrollTo(0, 0));
}

async function runTo(page: Page, step: number): Promise<void> {
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect.poll(() => stepOf(page), { timeout: 240_000, intervals: [250] }).toBeGreaterThanOrEqual(step);
  console.log(`steps per second while running: ${await page.locator('#r-rate').textContent()}`);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.locator('#live')).toHaveText('Paused.');
  await expect(page.locator('#r-rate')).toHaveText('paused');
  // The sentence under the picture, the readouts and the picture are one and the same frame once paused.
  await expect.poll(async () => (await page.locator('#summary').textContent())!.startsWith(`Step ${await page.locator('#r-step').textContent()}. ${await page.locator('#r-comps').textContent()} compartments`)).toBe(true);
}

test.describe('without a motion preference', () => {
  test.use({ reducedMotion: 'no-preference' });

  test('the droplet genes sandbox starts running by itself', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()); });
    await page.goto('/dropgenes/');
    await expect(page.locator('#live')).toHaveText('New world: 2 genes, gate on, parasite on, larger compartments, seed 5.');
    await expect.poll(() => stepOf(page), { timeout: 60_000 }).toBeGreaterThan(100);
    await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'One step' })).toHaveAttribute('aria-disabled', 'true');
    await expect(page.locator('#r-rate')).toHaveText(/^[\d,]+$/);
    await expect(page.locator('#r-res')).toHaveText('res 0');
    // pressing One step while it runs does nothing; Pause holds the world still
    const before = await stepOf(page);
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await expect(page.locator('#live')).toHaveText('Paused.');
    // a request already with the worker may still land after Pause; let it, then the step must hold
    await page.waitForTimeout(1000);
    const paused = await stepOf(page);
    expect(paused).toBeGreaterThanOrEqual(before);
    await page.waitForTimeout(500);
    expect(await stepOf(page)).toBe(paused);
    expect(errors).toEqual([]);
  });
});

test.describe('with reduced motion', () => {
test.use({ reducedMotion: 'reduce' });

test('the droplet genes sandbox runs gated and ungated, keeps its matter check at 0, and its controls work', async ({ page }, testInfo) => {
  test.setTimeout(600_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()); });
  const outside: string[] = [];
  const origin = new URL(testInfo.project.use.baseURL!).origin;
  page.on('request', (r) => { if (new URL(r.url()).origin !== origin) outside.push(r.url()); });
  await page.setViewportSize({ width: 1280, height: 1180 });
  await page.goto('/dropgenes/');
  await expect(page.getByRole('heading', { name: 'Compartments that have to keep their genes' })).toBeVisible();
  await expect(page.locator('meta[name=robots]')).toHaveAttribute('content', 'noindex');

  // reduced motion: founded, drawn and paused at step 0
  await expect(page.locator('#live')).toContainText('Paused, because this device asks for reduced motion');
  await expect(page.locator('#r-step')).toHaveText('0');
  await expect(page.locator('#r-comps')).toHaveText('16');
  await expect(page.locator('#r-complete')).toHaveText('100%');
  await expect(page.locator('#r-complete-n')).toHaveText('16 of 16');
  await expect(page.locator('#world-name')).toHaveText('This world: 2 genes, gate on, parasite on, larger compartments, seed 5.');
  await expect(page.locator('#r-res')).toHaveText('res 0');
  await expect(page.locator('#recorded')).toContainText('held on 4 of 4 seeds');
  await expect(page.locator('#recorded')).toContainText('Seed 5 is one of those four');
  await page.waitForTimeout(600);
  expect(await stepOf(page)).toBe(0);
  const founded = await picture(page);

  // one step moves the world by exactly one step
  await page.getByRole('button', { name: 'One step' }).click();
  await expect(page.locator('#r-step')).toHaveText('1');
  await expect(page.locator('#live')).toHaveText('Paused at step 1.');
  expect(await picture(page)).not.toBe(founded);
  // presses that arrive faster than the worker answers are each still one step
  await page.getByRole('button', { name: 'One step' }).evaluate((b) => { for (let i = 0; i < 4; i++) (b as HTMLButtonElement).click(); });
  await expect(page.locator('#r-step')).toHaveText('5');
  await expect(page.locator('#live')).toHaveText('Paused at step 5.');

  // the gated world, fastest pace: the figures at step 1,000 are the experiment runner's own for this seed
  await page.getByRole('radio', { name: /^64 steps/ }).check();
  const shots = process.env.BL_DROPGENES_SHOTS;
  await runTo(page, shots ? 3000 : 1000);
  await expect(page.locator('#r-res')).toHaveText('res 0');
  await expect(page.locator('#r-res')).toHaveClass(/ok/);
  expect(await num(page, '#r-comps')).toBeGreaterThan(20);
  expect(await num(page, '#r-fis')).toBeGreaterThan(40);
  await expect(page.locator('#r-par')).toContainText('%');
  await expect(page.locator('#summary')).toContainText('carrying every gene');
  await expect(page.locator('#chart-note')).toContainText('one reading every');
  await expect(page.getByRole('button', { name: 'One step' })).toHaveAttribute('aria-disabled', 'false');
  if (shots) await shoot(page, `${shots}/viewer-gated.png`);

  // gate off: a new world from step 0, and the note changes to what the recorded runs found
  await page.getByRole('radio', { name: /^Gate off/ }).check();
  await expect(page.locator('#r-step')).toHaveText('0');
  await expect(page.locator('#live')).toContainText('New world: 2 genes, gate off, parasite on, larger compartments, seed 5.');
  await expect(page.locator('#recorded')).toContainText('held on 0 of 4 seeds');
  await runTo(page, shots ? 2000 : 500);
  await expect(page.locator('#r-res')).toHaveText('res 0');
  await expect(page.locator('#world-name')).toContainText('gate off');
  if (shots) await shoot(page, `${shots}/viewer-ungated.png`);

  // a setting the recorded runs did not cover says so
  await page.getByRole('radio', { name: /^Default compartments/ }).check();
  await page.getByRole('radio', { name: /^4 genes/ }).check();
  await expect(page.locator('#recorded')).toContainText('not in the recorded runs');
  await expect(page.locator('#legend')).toContainText('Compartment carrying all 4 genes');

  // parasite off: its readout and its legend entries go
  await page.getByRole('radio', { name: /^Parasite off/ }).check();
  await expect(page.locator('#r-par')).toHaveText('parasite off');
  await expect(page.locator('#legend')).not.toContainText('arasite');

  // a bad seed falls back and says so; a good one restarts
  await page.locator('#seed').fill('seven');
  await page.getByRole('button', { name: 'Use this seed' }).click();
  await expect(page.locator('#seed')).toHaveValue('5');
  await expect(page.locator('#live')).toContainText('was not a whole number');
  await page.locator('#seed').fill('8');
  await page.locator('#seed').press('Enter');
  await expect(page.locator('#live')).toContainText('seed 8.');
  await expect(page.locator('#r-step')).toHaveText('0');

  // eight genes end within a few hundred steps: the page stops, says why, and Start again rebuilds
  await page.getByRole('radio', { name: /^Larger compartments/ }).check();
  await page.getByRole('radio', { name: /^8 genes/ }).check();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.locator('#live')).toContainText('The world ended at step', { timeout: 120_000 });
  await expect(page.locator('#r-comps')).toHaveText('0');
  await expect(page.locator('#r-complete')).toHaveText('no compartments');
  await expect(page.locator('#r-res')).toHaveText('res 0');
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toHaveAttribute('aria-disabled', 'true');
  const ended = await stepOf(page);
  expect(ended).toBeLessThanOrEqual(400);
  await page.waitForTimeout(400);
  expect(await stepOf(page)).toBe(ended);
  await page.getByRole('button', { name: 'Start again' }).click();
  await expect(page.locator('#r-step')).toHaveText('0');
  await expect(page.locator('#r-comps')).toHaveText('16');
  await expect(page.locator('#r-rate')).toHaveText('paused');
  await expect(page.locator('#fade-note')).toBeHidden();

  // night colours, kept for the next visit under the site's own key
  await page.getByRole('button', { name: 'Switch to night colours' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await page.evaluate(() => localStorage.getItem('browser-life-theme'))).toBe('dark');
  if (shots) await page.screenshot({ path: `${shots}/viewer-dark.png`, fullPage: true });

  // phone width: nothing wider than the screen
  await page.setViewportSize({ width: 375, height: 800 });
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  if (shots) await page.screenshot({ path: `${shots}/viewer-phone.png`, fullPage: true });

  expect(outside).toEqual([]);
  expect(errors).toEqual([]);
});
});
