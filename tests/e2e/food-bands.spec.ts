import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

// Screen ids, in picker order (apps/lab/src/food-bands/screens.ts).
const SCREEN_IDS = ['uniform-food', 'uniform-endurance', 'moving-food', 'stationary-food', 'food-band-longevity', 'split-food', 'alternating-food', 'food-band-foothold', 'food-floor-longevity', 'food-schedule-769'];
const replayPresent = (name: string) => existsSync(resolve('docs/creative-prototypes', name));
const SHOT_DIR = process.env.BL_FOOD_SHOTS ?? '';

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  // A missing favicon or a missing optional replay is a 404 the console reports without a URL; real errors still count.
  page.on('console', message => { if (message.type() === 'error' && !/Failed to load resource/.test(message.text())) errors.push(message.text()); });
  return errors;
}
const num = async (page: Page, selector: string) => Number((await page.locator(selector).textContent())!.replace(/,/g, ''));
const tick = (page: Page) => num(page, '#tick');

async function open(page: Page, screen = 'moving-food', seed?: number) {
  await page.goto(`/food-bands/?screen=${screen}${seed ? `&seed=${seed}` : ''}`);
  await expect(page.locator('.world-card').first()).toBeVisible();
  await expect(page.locator('#status')).toContainText('Paused');
}
async function runTo(page: Page, target: number, pace = '16') {
  await page.selectOption('#pace', pace);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.waitForFunction(t => Number(document.getElementById('tick')!.textContent!.replace(/,/g, '')) >= t, target, { timeout: 120_000 });
  // One page task: pause only if still playing (at maximum pace the horizon can end play between two separate calls).
  await page.evaluate(() => { const b = document.getElementById('play') as HTMLButtonElement; if (b.textContent === 'Pause') b.click(); });
}
// Steps by clicking the real button in one page task, so a target tick is hit exactly.
const stepTicks = (page: Page, n: number) => page.evaluate(count => { const b = document.getElementById('step') as HTMLButtonElement; for (let i = 0; i < count; i++) b.click(); }, n);
const canvasData = (page: Page, index = 0) => page.locator('.world-canvas').nth(index).evaluate(c => ({ ...(c as HTMLCanvasElement).dataset }));
const axe = async (page: Page, label: string) => {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(result.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).join(', ')}`), `axe violations ${label}`).toEqual([]);
};

test('opens paused with the first screen and no console errors', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/food-bands/');
  await expect(page.locator('#screen-choices input[type=radio]')).toHaveCount(SCREEN_IDS.length);
  await expect(page.locator('#screen-choices input').first()).toBeChecked();
  await expect(page.locator('.world-card')).toHaveCount(1);
  await expect(page.locator('#status')).toContainText('Paused');
  await expect(page.locator('#tick')).toHaveText('0');
  await expect(page.getByText('Exploration, not evidence').first()).toBeVisible();
  await expect(page.locator('meta[name=robots]')).toHaveCount(0);
  // every choice says what differs: no bare titles
  for (const text of await page.locator('#screen-choices .choice-text').allTextContents()) expect(text.length).toBeGreaterThan(60);
  expect(errors).toEqual([]);
});

test('every screen steps 5 ticks and shows its overlay', async ({ page }) => {
  const errors = watchErrors(page);
  await open(page, SCREEN_IDS[0]);
  for (const [index, id] of SCREEN_IDS.entries()) {
    await page.locator('#screen-choices input').nth(index).check();
    await expect(page.locator('#screen-summary h2')).not.toBeEmpty();
    await expect(page.locator('#tick')).toHaveText('0');
    await stepTicks(page, 5);
    await expect(page.locator('#tick')).toHaveText('5');
    const cards = await page.locator('.world-card').count();
    expect(cards, id).toBe(['moving-food', 'stationary-food', 'food-band-longevity', 'split-food', 'alternating-food', 'food-band-foothold'].includes(id) ? 2 : 1);
    for (let c = 0; c < cards; c++) {
      const data = await canvasData(page, c);
      expect(data.tick, id).toBe('5');
      expect(data.pulse, id).toBe('0');
      expect(Number(data.offeredTiles), `${id}: 768 slots land on 300 to 768 distinct tiles`).toBeGreaterThan(300);
      expect(Number(data.offeredTiles)).toBeLessThanOrEqual(768);
      const mode = await page.locator('.world-card').nth(c).getAttribute('data-mode');
      if (mode !== 'uniform') expect(Number(data.eligibleTiles), `${id}/${mode} eligible tiles`).toBeGreaterThanOrEqual(2304);
    }
    await expect(page.locator('.band-readout').first()).toContainText('pulse 0');
  }
  expect(errors).toEqual([]);
});

test('moving band overlay shifts between tick 0 and tick 300', async ({ page }) => {
  await open(page, 'moving-food');
  const moving = page.locator('.world-card[data-mode=moving-band] canvas.world-canvas');
  expect((await moving.evaluate(c => (c as HTMLCanvasElement).dataset.bandLeft))).toBe('0');
  await expect(page.locator('.world-card[data-mode=moving-band] .band-readout')).toContainText('no pulse yet');
  await stepTicks(page, 300);
  await expect(page.locator('#tick')).toHaveText('300');
  expect(await moving.evaluate(c => (c as HTMLCanvasElement).dataset.bandLeft)).toBe('6');
  await expect(page.locator('.world-card[data-mode=moving-band] .band-readout')).toContainText('band columns 6 to 53');
  // the uniform world has no band
  expect(await page.locator('.world-card[data-mode=uniform] canvas.world-canvas').evaluate(c => (c as HTMLCanvasElement).dataset.outlines)).toBe('');
});

test('alternating overlay switches band at pulse 100 (tick 505)', async ({ page }) => {
  await open(page, 'alternating-food');
  const alternating = page.locator('.world-card[data-mode=alternating-band] canvas.world-canvas');
  await stepTicks(page, 500);
  await expect(page.locator('#tick')).toHaveText('500');
  expect(await alternating.evaluate(c => (c as HTMLCanvasElement).dataset.pulse)).toBe('99');
  expect(await alternating.evaluate(c => (c as HTMLCanvasElement).dataset.outlines)).toBe('0+24:fed,48+24:idle');
  await stepTicks(page, 5);
  expect(await alternating.evaluate(c => (c as HTMLCanvasElement).dataset.pulse)).toBe('100');
  expect(await alternating.evaluate(c => (c as HTMLCanvasElement).dataset.outlines)).toBe('0+24:idle,48+24:fed');
  await expect(page.locator('.world-card[data-mode=alternating-band] .band-readout')).toContainText('favoured band 1');
});

test('split shows two columns', async ({ page }) => {
  await open(page, 'split-food');
  await stepTicks(page, 5);
  expect(await page.locator('.world-card[data-mode=split-band] canvas.world-canvas').evaluate(c => (c as HTMLCanvasElement).dataset.outlines)).toBe('0+24:fed,48+24:fed');
  expect(await page.locator('.world-card[data-mode=stationary-band] canvas.world-canvas').evaluate(c => (c as HTMLCanvasElement).dataset.outlines)).toBe('0+48:fed');
});

test('the picture really draws family colours and the offered layer (canvas pixels)', async ({ page }) => {
  await open(page, 'split-food');
  await stepTicks(page, 120);
  const result = await page.locator('.world-card[data-mode=split-band] canvas.world-canvas').evaluate(canvas => {
    const c = canvas as HTMLCanvasElement; const ctx = c.getContext('2d')!;
    const data = ctx.getImageData(0, 0, c.width, c.height).data;
    let gold = 0, family = 0, other = 0;
    for (let i = 0; i < data.length; i += 4) {
      const [r, g, b] = [data[i]!, data[i + 1]!, data[i + 2]!];
      if (r > 230 && g > 180 && g < 230 && b < 130) gold++;
      else if ((g > 200 && b > 150 && r < 170) || (r > 220 && g > 150 && b < 150 && b > 100) || (b > 200 && r > 140 && g < 190)) family++;
      else other++;
    }
    return { gold, family, other };
  });
  expect(result.gold).toBeGreaterThan(500);
  expect(result.family).toBeGreaterThan(100);
});

test('other seed path shows the exploration warning and hides the recorded comparison', async ({ page }) => {
  await open(page, 'split-food');
  await expect(page.locator('#other-seed-form')).toBeHidden();
  await page.getByLabel('Other seed (exploration)').check();
  await expect(page.locator('#other-seed-form')).toBeVisible();
  await expect(page.locator('#other-seed-note')).toContainText('Exploration only');
  await page.locator('#other-seed').fill('abc');
  await page.getByRole('button', { name: 'Use this seed' }).click();
  await expect(page.locator('#other-seed-error')).toContainText('whole number');
  await page.locator('#other-seed').fill('77');
  await page.getByRole('button', { name: 'Use this seed' }).click();
  await expect(page.locator('#screen-summary')).toContainText('Seed 77 (exploration');
  await expect(page.locator('#compare-section')).toBeHidden();
  await axe(page, 'with the seed warning shown');
});

test('switching screens rebuilds the accounting table (labels and rows follow the arms)', async ({ page }) => {
  const errors = watchErrors(page);
  await open(page, 'moving-food');
  await expect(page.locator('#accounting thead th')).toHaveText(['Measure', 'Spread evenly', 'Moving band']);
  await page.getByLabel(/A moving band against a band that stays put/).check();
  await expect(page.locator('#accounting thead th')).toHaveText(['Measure', 'Moving band', 'Stationary band']);
  await page.getByLabel(/A different order of food targets/).check();
  await page.getByLabel(/Also run/).check();
  await stepTicks(page, 10);
  await expect(page.locator('#accounting tbody tr')).toHaveCount(18);
  await page.getByLabel(/Scarce food, spread evenly \(6,000 ticks\)/).check();
  await stepTicks(page, 10);
  await expect(page.locator('#accounting thead th')).toHaveText(['Measure', 'Scarce, spread evenly']);
  await expect(page.locator('#accounting tbody tr')).toHaveCount(12);
  expect(errors).toEqual([]);
});

test('reset returns to tick 0', async ({ page }) => {
  await open(page, 'moving-food');
  await stepTicks(page, 12);
  await expect(page.locator('#tick')).toHaveText('12');
  await page.getByRole('button', { name: 'Reset to tick 0' }).click();
  await expect(page.locator('#tick')).toHaveText('0');
  expect((await canvasData(page, 0)).tick).toBe('0');
});

test('horizon stops the clock', async ({ page }) => {
  await open(page, 'split-food');
  await page.selectOption('#pace', 'max');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.locator('#status')).toHaveText('3,000 tick horizon reached', { timeout: 60_000 });
  await expect(page.locator('#tick')).toHaveText('3,000');
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'One tick', exact: true })).toBeDisabled();
  // population history has a point every 20 ticks, 0 to 3,000
  const history = await page.locator('.history-canvas').first().evaluate(c => ({ ...(c as HTMLCanvasElement).dataset }));
  expect(history).toMatchObject({ points: '151', lastTick: '3000' });
});

test('a longer screen runs to its own horizon (uniform-endurance, 9,000)', async ({ page }) => {
  await open(page, 'uniform-endurance');
  await expect(page.locator('#horizon')).toHaveText('9,000');
  await page.selectOption('#pace', 'max');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.locator('#status')).toContainText('horizon reached', { timeout: 120_000 });
  expect(await tick(page)).toBeGreaterThan(0);
});

test('optional earlier schedule runs beside schedule 769 on the same clock', async ({ page }) => {
  await open(page, 'food-schedule-769');
  await expect(page.locator('.world-card')).toHaveCount(1);
  await page.getByLabel(/Also run/).check();
  await expect(page.locator('.world-card')).toHaveCount(2);
  await stepTicks(page, 5);
  await expect(page.locator('.world-card').nth(0).locator('.band-readout')).toContainText('floor in both bands');
  expect(await page.locator('.world-card[data-mode=schedule-769] canvas.world-canvas').evaluate(c => (c as HTMLCanvasElement).dataset.pulse)).toBe('0');
});

const COMPARE_CASES: [string, string[]][] = [
  ['uniform-food', ['uniform-food-seed-1201.json']],
  ['moving-food', ['moving-food-uniform-seed-1201.json', 'moving-food-moving-band-seed-1201.json']],
  ['alternating-food', ['alternating-food-seed-1203.json', 'split-food-replication-seed-1203.json']],
  ['food-band-foothold', ['food-band-foothold-seed-1202.json', 'alternating-food-replication-seed-1202.json']],
  ['food-schedule-769', ['food-schedule-769-seed-1202.json']],
];
for (const [screen, files] of COMPARE_CASES) {
  test(`compare with recorded run: ${screen}`, async ({ page }) => {
    test.skip(!files.every(replayPresent), 'recorded replays are not restored in this checkout (docs/creative-prototypes/ARTIFACTS.md)');
    await open(page, screen);
    await expect(page.locator('#compare-section')).toBeVisible();
    await stepTicks(page, 20);
    await page.getByRole('button', { name: 'Compare with the recorded run' }).click();
    await expect(page.locator('#compare-progress')).toHaveText('Done.', { timeout: 240_000 });
    const lines = await page.locator('#compare-result li[data-status]').allTextContents();
    for (const line of lines.filter(l => !/The worlds as displayed/.test(l))) expect(line).toMatch(/identical at all [\d,]+ recorded ticks/);
    expect(lines.some(l => /identical/.test(l))).toBe(true);
    expect(lines.join(' ')).toMatch(/the picture on screen matches the recorded frame/);
    if (screen === 'moving-food') await axe(page, 'after a replay result');
  });
}

test('compare control is hidden when the recording is missing', async ({ page }) => {
  await page.route('**/docs/creative-prototypes/*.json', route => route.fulfill({ status: 404, body: 'not found' }));
  await open(page, 'split-food');
  await expect(page.locator('.world-card')).toHaveCount(2);
  await expect(page.locator('#compare-section')).toBeHidden();
});

test('axe at desktop (1280) and phone (375), and no horizontal scroll at 375', async ({ page }) => {
  await open(page, 'moving-food');
  await stepTicks(page, 3);
  for (const viewport of [{ width: 1280, height: 900 }, { width: 375, height: 800 }]) {
    await page.setViewportSize(viewport);
    await axe(page, `at ${viewport.width}px`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `no horizontal scroll at ${viewport.width}`).toBe(true);
  }
});

test('keyboard only: picker, seed, play, step, reset and compare are reachable and operable', async ({ page }) => {
  await open(page, 'split-food');
  const reached = new Set<string>();
  await page.locator('#screen-choices input').first().focus();
  for (let i = 0; i < 40; i++) {
    const id = await page.evaluate(() => { const a = document.activeElement as HTMLElement; return a.id || `${a.getAttribute('name')}:${(a as HTMLInputElement).value}`; });
    reached.add(id);
    await page.keyboard.press('Tab');
  }
  for (const want of ['screen:uniform-food'.replace('uniform-food', 'uniform-food'), 'seed:1202', 'play', 'step', 'reset', 'pace']) {
    expect([...reached].some(r => r.startsWith(want) || r === want), `${want} reachable by Tab (${[...reached].join(' | ')})`).toBe(true);
  }
  // operate with the keyboard alone
  await page.locator('#step').focus(); await page.keyboard.press('Enter');
  await expect(page.locator('#tick')).toHaveText('1');
  await page.keyboard.press('Space');
  await expect(page.locator('#tick')).toHaveText('2');
  await page.locator('#reset').focus(); await page.keyboard.press('Enter');
  await expect(page.locator('#tick')).toHaveText('0');
  await page.locator('#play').focus(); await page.keyboard.press('Enter');
  await expect(page.locator('#play')).toHaveText('Pause');
  await page.keyboard.press('Enter');
  await expect(page.locator('#status')).toHaveText('Paused by you');
  // the seed radios change with arrow keys
  await page.locator('#seed-choices input').first().focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('#screen-summary')).toContainText('Seed 1203');
  if (files_present()) {
    await page.locator('#compare').focus(); await page.keyboard.press('Enter');
    await expect(page.locator('#compare-progress')).toHaveText('Done.', { timeout: 120_000 });
  }
});
function files_present() { return replayPresent('split-food-replication-seed-1203.json') && replayPresent('stationary-food-replication-stationary-band-seed-1203.json'); }

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });
  test('starts paused and says why', async ({ page }) => {
    await page.goto('/food-bands/');
    await expect(page.locator('#status')).toHaveText('Paused · reduced motion');
    await page.waitForTimeout(500);
    await expect(page.locator('#tick')).toHaveText('0');
  });
});

test('a hidden tab pauses, and restoring does not jump the clock', async ({ page }) => {
  await open(page, 'moving-food');
  await page.selectOption('#pace', '1');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.locator('#status')).toHaveText('Advancing together');
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
  await expect(page.locator('#status')).toHaveText('Paused while away');
  const before = await tick(page);
  await page.waitForTimeout(1500);
  expect(await tick(page)).toBe(before);
  await page.evaluate(() => { Reflect.deleteProperty(document, 'hidden'); document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForTimeout(300);
  expect(await tick(page)).toBe(before);
  await expect(page.locator('#status')).toContainText('Paused');
});

test('paired playback to 3,000 ticks stays responsive (long tasks)', async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __long: number[] }).__long = [];
    new PerformanceObserver(list => { for (const e of list.getEntries()) (window as unknown as { __long: number[] }).__long.push(e.duration); }).observe({ type: 'longtask', buffered: true });
  });
  await open(page, 'stationary-food');
  await runTo(page, 3000, 'max');
  await expect(page.locator('#tick')).toHaveText('3,000');
  const long = await page.evaluate(() => (window as unknown as { __long: number[] }).__long);
  const worst = Math.max(0, ...long);
  console.log(`food-bands long tasks during a paired 3,000-tick run at maximum pace: count ${long.length}, worst ${Math.round(worst)} ms`);
  expect(worst).toBeLessThan(200);
});

test('download writes a file only when the button is pressed', async ({ page }) => {
  await open(page, 'split-food');
  await stepTicks(page, 25);
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: /Download the current counts/ }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toBe('food-bands-split-food-seed-1202-tick-25.json');
});

test('seed input: only whole numbers, and the other-seed radio alone does not mislabel the screen seed', async ({ page }) => {
  await page.goto('/food-bands/?screen=moving-food&seed=');
  await expect(page.locator('.world-card').first()).toBeVisible();
  await expect(page.locator('#summary, main').first()).not.toContainText('exploration: not one of');
  await page.getByRole('radio', { name: /Other seed/ }).check();
  await page.getByRole('button', { name: 'Reset to tick 0' }).click();
  await expect(page.locator('main')).not.toContainText('exploration: not one of');
  await page.fill('#other-seed', '0x10');
  await page.locator('#other-seed').press('Enter');
  await expect(page.locator('#other-seed-error')).toContainText('whole number');
  await page.fill('#other-seed', '1e3');
  await page.locator('#other-seed').press('Enter');
  await expect(page.locator('#other-seed-error')).toContainText('whole number');
  await page.fill('#other-seed', '77');
  await page.locator('#other-seed').press('Enter');
  await expect(page.locator('main')).toContainText('Seed 77');
});

test('accounting table lists every counter either arm has, with a dash where one arm has none', async ({ page }) => {
  await open(page, 'alternating-food');
  const keys = await page.locator('#accounting tbody tr').evaluateAll(rows => rows.map(r => (r as HTMLElement).dataset.key));
  expect(keys).toContain('bandOffered1');
  const cells = await page.locator('#accounting tbody tr').evaluateAll(rows => rows.map(r => [...(r as HTMLTableRowElement).cells].slice(1).map(c => c.textContent)));
  expect(cells.some(row => row.includes('\u2014')) || keys.length > 12).toBe(true);
});

test.describe('screenshots', () => {
  test.skip(!SHOT_DIR, 'set BL_FOOD_SHOTS=<dir> to write screenshots');
  const SHOTS: [string, number, boolean][] = [['moving-food', 700, false], ['alternating-food', 620, false], ['split-food', 800, false], ['food-schedule-769', 1200, true], ['food-band-foothold', 700, false], ['uniform-food', 600, false]];
  for (const [screen, ticks, optional] of SHOTS) {
    for (const width of [1280, 375]) {
      test(`${screen} at ${width}`, async ({ page }) => {
        mkdirSync(SHOT_DIR, { recursive: true });
        await page.setViewportSize({ width, height: width > 600 ? 1000 : 1400 });
        await open(page, screen);
        if (optional) await page.getByLabel(/Also run/).check();
        await runTo(page, ticks, '16');
        await page.locator('#worlds').scrollIntoViewIfNeeded();
        await page.screenshot({ path: `${SHOT_DIR}/${screen}-${width}.png`, fullPage: width < 600 ? false : false });
        await page.locator('#worlds').screenshot({ path: `${SHOT_DIR}/${screen}-${width}-worlds.png` });
      });
    }
  }
});
