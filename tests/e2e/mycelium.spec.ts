// The private Mycelium page (/mycelium/): runs the world on the GPU when WebGPU starts (the CPU reference otherwise),
// plays, zooms, inspects, wounds and scrapes, and the two ledger residuals read 0 afterwards. Fails on any page
// error, console error or GPU error the page surfaces.
import { expect, test, type Page } from '@playwright/test';

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`); });
  return errors;
}

const num = async (page: Page, id: string) => Number((await page.locator(`#${id}`).innerText()).replaceAll(',', ''));
const ready = (page: Page) => page.waitForSelector('body[data-ready="1"]', { timeout: 60_000 });

async function useTool(page: Page, tool: 'inspect' | 'wound' | 'scrape') {
  await page.locator(`input[name="tool"][value="${tool}"]`).check();
}

/** Click the middle of the world canvas area. */
async function clickStage(page: Page) {
  await page.locator('#stage').scrollIntoViewIfNeeded();
  const box = (await page.locator('#stage').boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

async function playUntil(page: Page, steps: number) {
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect.poll(() => num(page, 'r-step'), { timeout: 90_000 }).toBeGreaterThan(steps);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  // The pause takes a final read-back, so the numbers are those of the stopped world.
  await expect(page.locator('#status')).toContainText('Paused at step');
}

async function expectBooksClosed(page: Page) {
  await expect.poll(async () => `${await page.locator('#r-m').innerText()}|${await page.locator('#r-e').innerText()}`).toBe('0|0');
}

test('GPU engine: plays, zooms, inspects, wounds and scrapes, and the books stay closed', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/mycelium/');
  await ready(page);
  // This test is about the GPU path: no quiet fallback to the CPU. Chrome with the WebGPU flags must give an adapter.
  const engine = page.locator('#engine-now');
  await expect(engine).toHaveAttribute('data-engine', 'gpu');
  await expect(engine).toContainText('your GPU (WebGPU)');
  // A bigger world: 256 x 256 with room for 32,768 particles.
  await page.locator('#size').selectOption('256');
  await expect(page.locator('#size-help')).toContainText('65,536 cells');
  await page.getByRole('button', { name: 'Plant', exact: true }).click();
  await expect(engine).toContainText('256 × 256');
  await expect(engine).toHaveAttribute('data-engine', 'gpu');
  await expect.poll(() => num(page, 'r-n')).toBeGreaterThan(100);
  await expectBooksClosed(page);

  // Play for a while: the step counter moves and the ledger check keeps reading 0.
  await playUntil(page, 60);
  await expectBooksClosed(page);

  // Colour modes and layers change what is drawn and the legend follows.
  const stage = page.locator('#stage');
  const before = await stage.screenshot();
  await page.locator('#colour').selectOption('energy');
  await expect(page.locator('#legend')).toContainText('energy stored');
  await page.locator('#layer-waste').check();
  await page.locator('#layer-nutrient').uncheck();
  await expect.poll(async () => Buffer.compare(before, await stage.screenshot())).not.toBe(0);
  await page.locator('#colour').selectOption('family');
  await expect(page.locator('#legend')).toContainText('family');
  await page.locator('#layer-nutrient').check();

  // Inspect: click the middle; a particle near it fills the panel.
  await useTool(page, 'inspect');
  await clickStage(page);
  await expect(page.locator('#i-id')).not.toHaveText('–');
  await expect(page.locator('#i-count')).toContainText('particle');
  await expect(page.locator('#i-note')).toContainText('As of step');
  // The panel's numbers are not a live region (they change every frame on the CPU path); selection goes to one small status region.
  await expect(page.locator('#inspect')).not.toHaveAttribute('aria-live', /.+/);
  await expect(page.locator('#i-announce')).toContainText('Selected particle');
  await expect(page.locator('#r-f')).toHaveText(/^[\d,–]+$/);

  // Zoom and pan: wheel, keys, buttons, Fit.
  await stage.scrollIntoViewIfNeeded();
  const box = (await stage.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const level = page.locator('#zoom-level');
  await expect(level).toContainText('Zoom 1.0×');
  const wide = await stage.screenshot();
  await page.mouse.wheel(0, -600);
  await expect(level).not.toContainText('Zoom 1.0×');
  const zoomedOnce = (await level.innerText()).match(/Zoom ([\d.]+)×/)![1];
  await page.locator('#zoom-in').click();
  await expect.poll(async () => (await level.innerText()).match(/Zoom ([\d.]+)×/)![1]).not.toBe(zoomedOnce);
  await stage.focus();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('+');
  const zoomed = await stage.screenshot();
  expect(Buffer.compare(wide, zoomed)).not.toBe(0);
  await page.getByRole('button', { name: 'Fit', exact: true }).click();
  await expect(level).toContainText('Zoom 1.0×');

  // Wound: remove everything inside the biggest brush at the middle of the world.
  const nBefore = await num(page, 'r-n');
  await useTool(page, 'wound');
  await page.locator('#radius').fill('40');
  await clickStage(page);
  const log = page.locator('#log li');
  await expect(log).toHaveCount(1);
  await expect(log.first()).toHaveAttribute('data-kind', 'wound');
  expect(Number(await log.first().getAttribute('data-matter'))).toBeGreaterThan(0);
  await expect.poll(() => num(page, 'r-n')).toBeLessThan(nBefore);
  await expectBooksClosed(page);
  await expect(page.locator('#log-note')).toContainText('no longer follows from its seed');
  await expect(page.locator('#status')).toContainText('Residuals now: matter 0, energy 0');

  // Scrape the trail: matter moves from trail to waste, nothing is lost.
  await useTool(page, 'scrape');
  await clickStage(page);
  await expect(log).toHaveCount(2);
  await expect(log.first()).toHaveAttribute('data-kind', 'scrape');
  expect(Number(await log.first().getAttribute('data-matter'))).toBeGreaterThan(0);
  await expectBooksClosed(page);

  // A stroke while the world is running: the numbers shown right after it are the post-stroke read (the step is the
  // stroke's own step), not an audit that was already in flight.
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect.poll(() => num(page, 'r-step'), { timeout: 60_000 }).toBeGreaterThan(await num(page, 'r-step') + 20);
  await useTool(page, 'wound');
  await page.locator('#radius').fill('12');
  for (let k = 0; k < 3; k++) {
    const logged = await log.count();
    await clickStage(page);
    await expect(log).toHaveCount(logged + 1);
    const status = await page.locator('#status').innerText();
    const strokeStep = Number(status.match(/step ([\d,]+):/)![1].replaceAll(',', ''));
    expect(await num(page, 'r-step')).toBeGreaterThanOrEqual(strokeStep); // a later audit may already have replaced it
    expect(status).toContain('Residuals now: matter 0, energy 0');
  }
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.locator('#status')).toContainText('Paused at step');
  await expectBooksClosed(page);

  // The world carries on after the strokes, with the books still closed.
  const stepAfter = await num(page, 'r-step');
  await playUntil(page, stepAfter + 40);
  await expectBooksClosed(page);

  expect(await page.evaluate(() => document.body.dataset.gpuError ?? '')).toBe('');
  expect(errors).toEqual([]);
});

test('trail rules: each option is explained and plants a world whose books stay closed, on the GPU and on the CPU', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/mycelium/');
  await ready(page);
  const engine = page.locator('#engine-now');
  const help = page.locator('#rule-help');
  await expect(page.locator('#trailrule')).toHaveValue('none');
  await expect(help).toContainText('R3 test');
  const expected: Record<string, RegExp> = { toll: /R4 test/, conduit8: /conduit screen/, conduit128: /strongest setting/ };
  for (const engineName of ['gpu', 'cpu'] as const) {
    await page.locator('#engine').selectOption(engineName);
    await expect(engine).toHaveAttribute('data-engine', 'gpu'); // the line describes the running world until Plant
    for (const rule of ['toll', 'conduit8', 'conduit128'] as const) {
      await page.locator('#trailrule').selectOption(rule);
      await expect(help).toContainText(expected[rule]!);
      if (engineName === 'gpu') await page.locator('#size').selectOption('128');
      await page.getByRole('button', { name: 'Plant', exact: true }).click();
      await expect(engine).toHaveAttribute('data-engine', engineName);
      await expect(page.locator('#status')).toContainText('trail rule:');
      await expect.poll(() => num(page, 'r-n')).toBeGreaterThan(100);
      await playUntil(page, 40);
      await expectBooksClosed(page);
    }
    await page.locator('#trailrule').selectOption('none');
  }
  expect(await page.evaluate(() => document.body.dataset.gpuError ?? '')).toBe('');
  expect(errors).toEqual([]);
});

test('CPU reference engine: the fallback path stays at 128 x 128 and works the same way', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/mycelium/');
  await ready(page);
  await page.locator('#engine').selectOption('cpu');
  await expect(page.locator('#size')).toBeDisabled();
  await page.getByRole('button', { name: 'Plant', exact: true }).click();
  const engine = page.locator('#engine-now');
  await expect(engine).toHaveAttribute('data-engine', 'cpu');
  await expect(engine).toContainText('the CPU reference (R0), 128 × 128');
  await expect(page.locator('#audit-note')).toContainText('after every step');

  await playUntil(page, 25);
  await expectBooksClosed(page);

  await page.locator('#stage').focus();
  await page.keyboard.press('+');
  await page.keyboard.press('+');
  await expect(page.locator('#zoom-level')).not.toContainText('Zoom 1.0×');
  await page.getByRole('button', { name: 'Fit', exact: true }).click();

  const nBefore = await num(page, 'r-n');
  await useTool(page, 'wound');
  await page.locator('#radius').fill('40');
  await clickStage(page);
  await expect(page.locator('#log li')).toHaveCount(1);
  expect(Number(await page.locator('#log li').first().getAttribute('data-matter'))).toBeGreaterThan(0);
  expect(await num(page, 'r-n')).toBeLessThan(nBefore);
  await expectBooksClosed(page);

  await useTool(page, 'scrape');
  await clickStage(page);
  await expect(page.locator('#log li')).toHaveCount(2);
  await expectBooksClosed(page);
  expect(errors).toEqual([]);
});

test('a CPU to GPU switch that fails leaves a drawn CPU world, not a blank canvas', async ({ page }) => {
  const errors = watchErrors(page);
  await page.addInitScript(() => {
    const orig = HTMLCanvasElement.prototype.getContext;
    (HTMLCanvasElement.prototype as any).getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      if (type === 'webgpu' && (window as any).__noGpuCanvas) return null;
      return (orig as any).call(this, type, ...rest);
    };
  });
  await page.goto('/mycelium/');
  await ready(page);
  await page.locator('#engine').selectOption('cpu');
  await page.getByRole('button', { name: 'Plant', exact: true }).click();
  await expect(page.locator('#engine-now')).toHaveAttribute('data-engine', 'cpu');
  // Now ask for the GPU while its canvas cannot be made: the page replaces the canvas, fails, and falls back.
  await page.evaluate(() => { (window as any).__noGpuCanvas = true; });
  await page.locator('#engine').selectOption('gpu');
  await page.getByRole('button', { name: 'Plant', exact: true }).click();
  await expect(page.locator('#engine-now')).toContainText('The GPU engine could not start');
  await expect(page.locator('#engine-now')).toHaveAttribute('data-engine', 'cpu');
  await expect(page.locator('#world')).toHaveCount(1);
  // The canvas on the page is the one the CPU painter draws on: it holds a picture, not one flat colour.
  const colours = await page.evaluate(() => {
    const c = document.getElementById('world') as HTMLCanvasElement;
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    const seen = new Set<number>();
    for (let i = 0; i < d.length; i += 4 * 97) seen.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
    return seen.size;
  });
  expect(colours).toBeGreaterThan(4);
  await playUntil(page, 15);
  await expectBooksClosed(page);
  expect(errors.filter((e) => !/webgpu|gpu/i.test(e))).toEqual([]);
});

test('phone width: no sideways scroll, the world is not buried under the disclosure, touch targets are large', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const page = await context.newPage();
  const errors = watchErrors(page);
  await page.goto('/mycelium/');
  await ready(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  // The disclosure keeps its headline visible and puts the rest behind a summary.
  await expect(page.locator('.disclosure')).toContainText('Nothing here shows that anything evolves');
  await expect(page.locator('.disclosure summary')).toBeVisible();
  const top = (await page.locator('#stage').boundingBox())!.y + (await page.evaluate(() => window.scrollY));
  expect(top).toBeLessThan(640); // was about 950 with the long disclosure and intro open
  for (const sel of ['.tool', '.layers label']) {
    for (const h of await page.locator(sel).evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height))) expect(h).toBeGreaterThanOrEqual(43);
  }
  // A tap on the world inspects the nearest particle.
  await page.locator('#stage').scrollIntoViewIfNeeded();
  const box = (await page.locator('#stage').boundingBox())!;
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator('#i-id')).not.toHaveText('–');
  expect(errors).toEqual([]);
  await context.close();
});
