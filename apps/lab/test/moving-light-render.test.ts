import { expect, it } from 'vitest';
import evidence from '../../../docs/moving-light-2026-11-02/evidence.json';
import { BLIND, NAMES, medianOf, STRATEGIES, SCHEDULE_TEXT, blindedOrder, contrastsHtml, coordFixturesHtml, criteriaHtml, esc, labelOf, panelHtml, physFixturesHtml, stripPoints, stripSvg, verdictHtml, type EvidenceView } from '../src/moving-light/render.ts';

const ev = evidence as unknown as EvidenceView;

it('blinded labels hide names until reveal', () => {
  expect(new Set(Object.values(BLIND)).size).toBe(STRATEGIES.length);
  for (const s of STRATEGIES) {
    expect(labelOf(s, false)).toBe(`Strategy ${BLIND[s]}`);
    expect(labelOf(s, false)).not.toContain(NAMES[s].name);
    expect(labelOf(s, true)).toBe(NAMES[s].name);
    const hidden = panelHtml(ev.fresh.blocks, 'fixed', s, false);
    expect(hidden).not.toContain(NAMES[s].name);
    expect(hidden).not.toContain(NAMES[s].what);
    expect(hidden).not.toMatch(/sense|drift|still|silent|sleeper/i);
    expect(panelHtml(ev.fresh.blocks, 'fixed', s, true)).toContain(NAMES[s].name);
  }
  expect(blindedOrder().map((s) => BLIND[s])).toEqual(['A', 'B', 'C', 'D']);
});

it('naive and residual both rendered with the fixture rejection', () => {
  const html = coordFixturesHtml(ev);
  expect(html).toContain('common-forcing');
  expect(html).toContain('collective motion');
  expect(html).toContain('rejected');
  expect(html).toMatch(/floor/);
  const common = ev.fixtures.coordination.find((f) => f.id === 'common-forcing' && f.schedule === 'fixed')!;
  expect(common.naiveReads).toBe(true);
  expect(common.rejected).toBe(true);
  expect(physFixturesHtml(ev)).toContain('crowding-physical');
  expect(verdictHtml(ev)).toContain(ev.fresh.verdict.label);
});

it('schedule switch changes the strip data', () => {
  const first = ev.fresh.blocks[0];
  expect(first.strip).not.toBeNull();
  const a = stripSvg(ev, 'fixed', 'sense', 0), b = stripSvg(ev, 'paused', 'sense', 0);
  expect(a).not.toBe(b);
  expect(a).toContain('polyline');
  expect(stripSvg(ev, 'fixed', 'sense', 3)).not.toBe(a);
  expect(stripPoints([], [])).toBe('');
  expect(Object.keys(SCHEDULE_TEXT)).toEqual(['fixed', 'paused', 'wandering', 'reversed']);
  for (const sc of Object.keys(SCHEDULE_TEXT)) {
    expect(contrastsHtml(ev, sc)).toContain('Grouped minus dispersed');
    expect(criteriaHtml(ev, sc).length).toBeGreaterThan(0);
  }
});

it('escapes evidence strings', () => {
  expect(esc('<img src=x onerror="1">&\'')).toBe('&lt;img src=x onerror=&quot;1&quot;&gt;&amp;&#39;');
  const evil = { ...ev, fresh: { ...ev.fresh, verdict: { ...ev.fresh.verdict, label: '<script>x</script>', reasons: ['"><b>'] } } } as EvidenceView;
  const out = verdictHtml(evil);
  expect(out).not.toContain('<script>');
  expect(out).not.toContain('<b>');
});

it('contrast rows are lettered until reveal and named after it', () => {
  for (const sc of Object.keys(SCHEDULE_TEXT)) {
    const hidden = contrastsHtml(ev, sc, false);
    expect(hidden).not.toMatch(/sensor|silent|drifter|sleeper/i);
    expect(hidden).toContain(`Strategy ${BLIND.sense}`);
    expect(hidden).toContain(`Strategy ${BLIND['sense-nosig']}`);
    expect(hidden).toContain(`Strategy ${BLIND.drift}`);
    expect(contrastsHtml(ev, sc, true)).toContain(NAMES.sense.name);
  }
});

it('medians average the two middle values and the silent twin is the sleeper', () => {
  expect(medianOf([8, 1, 5, 3, 9, 2, 7, 4])).toBe(4);
  expect(medianOf([1, 2, 3, 4, 5, 6, 7, 100])).toBe(4);
  expect(medianOf([1, 5, 9, 10])).toBe(7);
  expect(medianOf([3, 1, 2])).toBe(2);
  expect(medianOf([])).toBeNull();
  expect(NAMES['sense-nosig'].what).toMatch(/never moves/);
  expect(NAMES['sense-nosig'].what).not.toMatch(/in principle/);
  expect(NAMES.still.what).toMatch(/identical/);
});

it('an unavailable fixture is not shown as a rejection and shows no floor', () => {
  const html = coordFixturesHtml(ev);
  const row = html.split('</tr>').find((r) => r.includes('static-sun'))!;
  expect(row).not.toContain('rejected');
  expect(row).not.toContain('floor');
  expect(row).toContain('unavailable');
  const common = html.split('</tr>').find((r) => r.includes('common-forcing (fixed)'))!;
  expect(common).toContain('rejected');
  expect(common).toContain('floor');
});
