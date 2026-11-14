import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { nearestParticle } from '../src/mycelium/pick.ts';
import { expectPublicPage } from './support/public-page.ts';
import { fitView, pinchView, toWorld, zoomAt } from '../src/mycelium/view.ts';
const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');

it('ships the mycelium world with the site: built, kept by the image, served, indexable and in the sitemap', () => {
  expectPublicPage('mycelium', 'mycelium: r("./mycelium/index.html")', ['mycelium-']);
});

it('page text carries the caption and the truthful engine statement', () => {
  const html = read('apps/lab/mycelium/index.html');
  expect(html).toContain('Why this is not yet evidence of evolution');
  // The page now runs on the GPU when it can; the disclosure must say so, say the CPU reference is the fallback, and not claim CPU only.
  expect(html).not.toContain('CPU only');
  expect(html).not.toContain('does not use the GPU');
  expect(html).toContain('runs the world on your GPU through WebGPU when it can, and on the CPU reference');
  expect(html).toContain('matched the CPU reference bit for bit in a local test on one Mac');
  // R2b finished at calibration, measurement-limited, confirmation never run; the page must not still say it is in progress.
  expect(html).not.toContain('is in progress');
  expect(html).toContain('R2b, on twenty practice seeds');
  expect(html).toContain('confirmation was never run');
  expect(html).toContain('docs/mycelium-r2b-2026-11-13/RESULT.md');
  expect(html).toContain('id="engine-now"');
  expect(html).toContain('measurement-limited');
  expect(html).not.toContain('noindex');
  expect(html).not.toContain('kept off the public site');
  expect(html).toContain('heredity blocked');
});

it('page offers the trail rules, explained, with current and truthful results', () => {
  const html = read('apps/lab/mycelium/index.html');
  const page = read('apps/lab/src/mycelium/page.ts');
  expect(html).toContain('id="trailrule"');
  for (const v of ['none', 'toll', 'conduit8', 'conduit128']) expect(html).toContain(`<option value="${v}"`);
  expect(html).toContain('id="rule-help"');
  // each option is wired to the optional config keys on both engines (sizeConfig feeds GPU and CPU alike)
  expect(page).toContain("trailMoveDiscount: 64, trailDiscountMode: 'toll'");
  expect(page).toContain('trailConduit: 8');
  expect(page).toContain('trailConduit: 128');
  expect(page).toContain("sizeConfig(128, seed, config.heredity, config.lightPattern, rule)");
  // results stay current: R3 supported, R4 toll-only, conduit screen exploratory only
  expect(html).toContain('R3 found that when trail is only a cost, inheritance purges it');
  expect(html).toContain('toll-only');
  expect(html).toContain('not a test');
  expect(html).toContain('docs/mycelium-r3-2026-11-13/RESULT.md');
  expect(html).toContain('docs/mycelium-r4-2026-11-14/RESULT.md');
  expect(html).toContain('docs/mycelium-conduit-2026-11-14/SCREEN.md');
  expect(html).toContain('None of this shows that anything evolves');
  // the default option is the plain world, so existing behaviour and digests are unchanged
  expect(html).toMatch(/<option value="none" selected/);
  expect(page).toContain('none: {\n    delta: {},');
});

it('the world is linked from the public journal or story', () => {
  const linked = ['apps/lab/research/index.html', 'apps/lab/story/index.html'].filter((page) => read(page).includes('href="/mycelium/"'));
  expect(linked.length).toBeGreaterThan(0);
});

it('inspect panel is not a live region; selection and death go through one small status region', () => {
  const html = read('apps/lab/mycelium/index.html');
  expect(html).toMatch(/<div class="inspect" id="inspect">/);
  expect(html).not.toMatch(/id="inspect"[^>]*aria-live/);
  expect(html).toMatch(/id="i-announce"[^>]*role="status"/);
  // The only live regions are the engine line, the status line and the announcer; the numbers are not among them.
  for (const m of html.matchAll(/<[^>]*aria-live="polite"[^>]*>/g)) expect(m[0]).not.toMatch(/id="(r-|i-list|numbers|inspect)/);
});

it('page text shows refused births and does not claim hues mean same versus different', () => {
  const html = read('apps/lab/mycelium/index.html');
  expect(html).toContain('id="r-f"');
  expect(html).toContain('Births refused per 100 steps');
  const page = read('apps/lab/src/mycelium/page.ts');
  expect(page).not.toContain('only same versus different');
  expect(page).toContain('colours can repeat');
  expect(page).toContain('totals.refused');
});

it('pinch keeps the world point under the fingers midpoint', () => {
  const W = 256, css = 600;
  const v0 = zoomAt(fitView(W), W, css, 4, 300, 300); // zoomed in, so there is room to move
  const prev = { x: 280, y: 310 }, next = { x: 312, y: 290 }; // the midpoint moves 32 px while the fingers spread 1.25x
  const anchor = toWorld(v0, W, css, prev.x, prev.y);
  const v1 = pinchView(v0, W, css, 1.25, prev, next);
  expect(v1.z).toBeCloseTo(v0.z * 1.25, 9);
  const now = toWorld(v1, W, css, next.x, next.y);
  expect(now.x).toBeCloseTo(anchor.x, 6);
  expect(now.y).toBeCloseTo(anchor.y, 6);
  // factor 1 is a plain two-finger drag
  const drag = pinchView(v0, W, css, 1, prev, next);
  expect(toWorld(drag, W, css, next.x, next.y).x).toBeCloseTo(anchor.x, 6);
});

it('inspect picks by the distance the picture shows, with no wrap at the edges', () => {
  // Particle 0 sits near the right edge of a 100-cell world, particle 1 at x = 3. A click at x = 0.5 is visibly nearer to particle 1.
  const X = [99.5 * 256, 3 * 256], Y = [10 * 256, 10 * 256];
  expect(nearestParticle(2, X, Y, 0.5, 10, 6)).toBe(1);
  // The torus-near particle across the seam is not picked when it is far on screen.
  expect(nearestParticle(1, X, Y, 0.5, 10, 6)).toBe(-1);
  expect(nearestParticle(0, [], [], 0, 0, 5)).toBe(-1);
});
