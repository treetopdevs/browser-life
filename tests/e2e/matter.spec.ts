import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test.use({ reducedMotion: 'reduce' });

test('four matched tanks start paused, render at 4:3, and advance together', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto('/matter/');
  await expect(page.locator('.world-card')).toHaveCount(4);
  await expect(page.locator('#status')).toHaveText('Paused · reduced motion');
  await expect(page.locator('#tick')).toHaveText('0');
  expect(await page.locator('.history-biomass-scale').allTextContents()).toEqual(Array(4).fill('0–200 units · shared'));
  expect(await page.locator('.history-active-scale').allTextContents()).toEqual(Array(4).fill('0–10 tiles · shared'));
  await expect(page.locator('.world-card').nth(0).locator('.stocks span').first()).toHaveText('Reservoir · not connected');
  await expect(page.locator('.world-card').nth(2).locator('.stocks span').first()).toHaveText('Reservoir · not connected');
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeEnabled();
  const cards = await page.locator('.world-card').all();
  const boxes = await Promise.all(cards.map(card => card.boundingBox()));
  expect(boxes[0]!.y).toBeCloseTo(boxes[1]!.y, 0);
  expect(boxes[1]!.x).toBeGreaterThan(boxes[0]!.x);
  const canvas = page.locator('.world-canvas').first();
  const box = await canvas.boundingBox();
  expect(box!.width).toBeGreaterThan(350);
  expect(box!.height / box!.width).toBeCloseTo(3 / 4, 2);
  await page.getByLabel('Biomass', { exact: true }).check();
  await expect(page.locator('.view-description').first()).toHaveText('Biomass view');
  await page.getByRole('button', { name: 'One tick', exact: true }).click();
  await expect(page.locator('#tick')).toHaveText('1');
  await expect(page.locator('.ledger')).toHaveCount(4);
  for (const ledger of await page.locator('.ledger').all()) await expect(ledger).toHaveText('Balanced');
  expect(errors).toEqual([]);
});

test('bounded animation frames honor 2× pace and refresh current fields on pause', async ({ page }) => {
  await page.addInitScript(() => {
    const pending: FrameRequestCallback[] = [];
    Object.defineProperty(window, '__runMatterFrame', { value: (time: number) => {
      const callback = pending.shift();
      if (!callback) throw new Error('No queued matter animation frame');
      callback(time);
    } });
    window.requestAnimationFrame = ((callback: FrameRequestCallback) => { pending.push(callback); return pending.length; }) as typeof window.requestAnimationFrame;
    window.cancelAnimationFrame = (() => {}) as typeof window.cancelAnimationFrame;
  });
  await page.goto('/matter/');
  await page.getByLabel('Pace').selectOption('2');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  type MatterWindow = Window & { __runMatterFrame: (time: number) => void };
  const runFrame = async (time: number) => page.evaluate(value => (window as unknown as MatterWindow).__runMatterFrame(value), time);
  await runFrame(1);
  await expect(page.locator('#tick')).toHaveText('0');
  await runFrame(68);
  await expect(page.locator('#tick')).toHaveText('4');
  await runFrame(135);
  await expect(page.locator('#tick')).toHaveText('8');
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.locator('#status')).toHaveText('Paused by you');
  await expect(page.locator('.world-card .biomass-total').first()).not.toHaveText('128');
});

test('real four-tank UI clock continues after extinction and holds every snapshot at tick 6000', async ({ page }) => {
  test.setTimeout(180_000);
  await page.addInitScript(() => {
    const pending: FrameRequestCallback[] = [];
    const controlled = window as unknown as Window & { __runMatterFrame: (time: number) => void };
    controlled.__runMatterFrame = (time: number) => {
      const callback = pending.shift();
      if (!callback) throw new Error('No queued matter animation frame');
      callback(time);
    };
    window.requestAnimationFrame = ((callback: FrameRequestCallback) => { pending.push(callback); return pending.length; }) as typeof window.requestAnimationFrame;
    window.cancelAnimationFrame = (() => {}) as typeof window.cancelAnimationFrame;
  });
  await page.goto('/matter/');
  // Keep this clock regression fast while it still steps the real model through the production UI loop.
  await page.addStyleTag({ content: '.world-canvas { width: 64px !important; }' });
  await page.getByLabel('Pace').selectOption('2');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  type MatterWindow = Window & { __runMatterFrame: (time: number) => void };
  const runClockTo = (target: number) => page.evaluate(targetTick => {
    const controlled = window as unknown as MatterWindow;
    let time = 1;
    for (let frame = 0; frame < 2300 && Number(document.querySelector('#tick')?.textContent?.replaceAll(',', '')) < targetTick; frame++) {
      time += 100;
      controlled.__runMatterFrame(time);
    }
    return document.querySelector('#tick')?.textContent;
  }, target);
  const reachedBoundary = await runClockTo(4092);
  expect(reachedBoundary).toBe('4,092');
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  for (let tick = 4093; tick <= 4095; tick++) {
    await page.getByRole('button', { name: 'One tick', exact: true }).click();
    await expect(page.locator('#tick')).toHaveText(tick.toLocaleString('en-US'));
  }

  const downloadObservation = async () => {
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download observations' }).click();
    const download = await pending;
    const path = await download.path();
    expect(path).not.toBeNull();
    return JSON.parse(await readFile(path!, 'utf8'));
  };
  const beforeExhaustion = await downloadObservation();
  expect(beforeExhaustion.comparisonTick).toBe(4095);
  expect(beforeExhaustion.worlds.map((world: { snapshot: { tick: number } }) => world.snapshot.tick)).toEqual([4095, 4095, 4095, 4095]);
  expect(beforeExhaustion.worlds.map((world: { snapshot: { reservoir: number } }) => world.snapshot.reservoir)).toEqual([32768, 64, 32768, 64]);

  await page.getByRole('button', { name: 'One tick', exact: true }).click();
  await expect(page.locator('#tick')).toHaveText('4,096');
  const atExhaustion = await downloadObservation();
  expect(atExhaustion.comparisonTick).toBe(4096);
  expect(atExhaustion.worlds.map((world: { snapshot: { tick: number } }) => world.snapshot.tick)).toEqual([4096, 4096, 4096, 4096]);
  expect(atExhaustion.worlds.map((world: { snapshot: { reservoir: number } }) => world.snapshot.reservoir)).toEqual([32768, 0, 32768, 0]);

  await page.getByRole('button', { name: 'Play', exact: true }).click();
  const reached = await runClockTo(6000);
  expect(reached).toBe('6,000');
  await expect(page.locator('#status')).toHaveText('6,000 tick limit reached');
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'One tick', exact: true })).toBeDisabled();
  for (const marker of await page.locator('.extinction').all()) {
    await expect(marker).toBeVisible();
    await expect(marker).toContainText('790');
    await expect(marker).toContainText('material updates continue');
  }

  const atLimit = await downloadObservation();
  expect(atLimit.comparisonTick).toBe(6000);
  expect(atLimit.worlds.map((world: { snapshot: { tick: number } }) => world.snapshot.tick)).toEqual([6000, 6000, 6000, 6000]);
  expect(atLimit.worlds.map((world: { snapshot: { extinctionTick: number | null } }) => world.snapshot.extinctionTick)).toEqual([790, 790, 790, 790]);
  expect(atLimit.worlds.map((world: { snapshot: { reservoir: number } }) => world.snapshot.reservoir)).toEqual([32768, 0, 32768, 0]);
  for (const world of atLimit.worlds) expect(world.snapshot.history.at(-1).tick).toBe(6000);

  await page.evaluate(() => (window as unknown as MatterWindow).__runMatterFrame(230_101));
  await expect(page.locator('#tick')).toHaveText('6,000');
  const afterExtraFrame = await downloadObservation();
  expect(afterExtraFrame.comparisonTick).toBe(6000);
  expect(afterExtraFrame.worlds.map((world: { snapshot: unknown }) => world.snapshot)).toEqual(atLimit.worlds.map((world: { snapshot: unknown }) => world.snapshot));
});

test('seed validation, full four-world export, and 12 MiB observation ceiling', async ({ page }) => {
  await page.goto('/matter/');
  await page.getByLabel('Shared seed').fill('4294967296');
  await page.getByRole('button', { name: 'Reset tanks' }).click();
  await expect(page.locator('#seed-error')).toContainText('Enter a number');
  await expect(page.locator('#tick')).toHaveText('0');
  await page.getByLabel('Shared seed').fill('0x10');
  await page.getByRole('button', { name: 'Reset tanks' }).click();
  await expect(page.locator('#seed-error')).toBeEmpty();
  await expect(page.locator('#tick')).toHaveText('0');
  await page.getByRole('button', { name: 'One tick', exact: true }).click();
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download observations' }).click();
  const download = await pending;
  const path = await download.path();
  expect(path).not.toBeNull();
  const bytes = await readFile(path!);
  const observation = JSON.parse(bytes.toString('utf8'));
  expect(observation).toMatchObject({ kind: 'matter-aquarium-observation', schemaVersion: 1, seed: 16, comparisonTick: 1 });
  expect(observation.worlds.map((world: { mode: string }) => world.mode)).toEqual(['closed', 'rain', 'burial', 'rain-burial']);
  for (const world of observation.worlds) expect(world.snapshot).toMatchObject({ schemaVersion: 1, runtime: 'browser', tick: 1, fields: { nutrient: expect.any(Array), biomass: expect.any(Array), detritus: expect.any(Array) } });
  expect(bytes.byteLength).toBeLessThan(12 * 1024 * 1024);
});

test('hidden page stays paused and phone layout uses one full-width 4:3 canvas column', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }));
  await page.goto('/matter/');
  await expect(page.locator('#status')).toHaveText('Paused while away');
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeDisabled();
  await page.evaluate(() => { Reflect.deleteProperty(document, 'hidden'); document.dispatchEvent(new Event('visibilitychange')); });
  await expect(page.locator('#status')).toContainText('Paused');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const boxes = await Promise.all((await page.locator('.world-card').all()).map(card => card.boundingBox()));
  for (let index = 1; index < boxes.length; index++) {
    expect(Math.round(boxes[index]!.x)).toBe(Math.round(boxes[0]!.x));
    expect(boxes[index]!.y).toBeGreaterThan(boxes[index - 1]!.y);
  }
  const canvas = page.locator('.world-canvas').first();
  const box = await canvas.boundingBox();
  expect(box!.width).toBeGreaterThan(300);
  expect(box!.height / box!.width).toBeCloseTo(3 / 4, 2);
});
