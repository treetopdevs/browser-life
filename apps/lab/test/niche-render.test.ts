import { expect, it } from 'vitest';
import evidence from '../../../docs/niche-construction-2026-11-01/evidence.json';
import { ARM_ORDER, ARM_TEXT, armRows, armsHtml, barWidth, candidateOptions, contrastsHtml, costHtml, devRowsHtml, edgeHtml, edgeOf, esc, fixturesHtml, fluxText, half, ledgerHtml, ledgerNote, ledgerRows, ratText, residualScan, verdictHtml, wallHtml, type EvidenceView } from '../src/niche/render.ts';

it('formats rationals and escapes text', () => {
  expect(ratText({ num: 9, den: 256 })).toBe('9/256');
  expect(ratText({ num: 256, den: 256 })).toBe('1');
  expect(esc('<a href="x">&')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;');
  expect(barWidth(50, 100, 100)).toBe(50);
  expect(barWidth(5, 0, 100)).toBe(0);
});

it('marks the dependency edge supported, unsupported or unavailable, never a failure as a negative', () => {
  expect(edgeOf('supported', 'combined conditioned field').state).toBe('supported');
  expect(edgeOf('unsupported-within-tested-domain', 'n/a').state).toBe('unsupported');
  for (const l of ['invalid-or-incomplete', 'unsupported-measurement', 'not-run']) expect(edgeOf(l, 'n/a').state).toBe('unavailable');
});

it('every arm has a plain-language name and description', () => {
  for (const id of ARM_ORDER) expect(ARM_TEXT[id].name.length).toBeGreaterThan(3);
});

const real = evidence as unknown as EvidenceView;
/** Every section the page draws, for the first candidate (or none). */
const drawAll = (ev: EvidenceView): string[] => {
  const cluster = ev.fresh.candidates[0]?.cluster;
  const c = ev.fresh.candidates.find((x) => x.cluster === cluster);
  const r = ev.fresh.results.find((x) => x.id === `cluster-${cluster}`);
  return [verdictHtml(ev), candidateOptions(ev), edgeHtml(ev, cluster), armsHtml(c), contrastsHtml(r), ledgerHtml(c), ledgerNote(ev, c), costHtml(c), fluxText(c), fixturesHtml(ev), wallHtml(ev), devRowsHtml(ev)];
};

it('renders the saved evidence: arms per candidate, an edge per candidate, zero residuals scanned from the payload', () => {
  for (const c of real.fresh.candidates) {
    const rows = armRows(c.blocks, c.medianYTimes2, c.survivedByArm);
    expect(rows.length).toBe(ARM_ORDER.length);
    expect(rows[0].perBlock.length).toBe(evidence.fresh.seeds.length);
    const r = real.fresh.results.find((x) => x.id === `cluster-${c.cluster}`)!;
    expect(['supported', 'unsupported', 'unavailable']).toContain(edgeOf(r.label, r.mechanism).state);
    for (const row of ledgerRows(c.blocks[0].startTotals, c.blocks[0].transfers)) expect(row.residual).toBe('0');
  }
  const scan = residualScan(real);
  expect(scan.nonzero).toBe(0);
  expect(scan.transfers).toBeGreaterThan(100);
  expect(drawAll(real).join('')).not.toMatch(/undefined|NaN|\[object/);
});

it('a nonzero residual anywhere in the payload is stated, not hidden', () => {
  const bad = structuredClone(real);
  const recs = Object.values(bad.dev.candidates[0].blocks![0].transfers!)[0];
  recs[0].residual = '3';
  expect(residualScan(bad).nonzero).toBe(1);
  expect(ledgerNote(bad, undefined)).toMatch(/NONZERO RESIDUAL in 1 of/);
});

it('medians are twice-the-median integers read back by halving', () => {
  expect(half(7)).toBe('3.5');
  expect(half(8)).toBe('4');
  expect(half(null)).toBe('n/a');
  expect(half(-69)).toBe('-34.5');
  expect(half(-49)).toBe('-24.5');
  expect(half(-4)).toBe('-2');
  expect(half(-1)).toBe('-0.5');
});

it('a stopped run (failed positive control: no fresh candidates) renders without throwing and says nothing was measured', () => {
  const stopped = structuredClone(real);
  stopped.fresh.ran = false;
  stopped.fresh.candidates = [];
  stopped.fresh.panel = { verdict: 'unsupported-measurement', text: 'No verdict: the positive control showed no spatial dependence.' };
  const html = drawAll(stopped).join('\n');
  expect(html).toMatch(/Stopped before the fresh-seed run/);
  expect(html).toMatch(/Edge unavailable/);
  expect(html).not.toMatch(/undefined|NaN|\[object/);
  expect(edgeHtml(stopped, undefined)).toMatch(/not unsupported/);
});

it('an all-invalid candidate (no outcomes, null contrasts, null medians) renders without throwing', () => {
  const inv = structuredClone(real);
  const c = inv.fresh.candidates[0];
  for (const b of c.blocks) { b.valid = false; b.invalidReason = 'only 3 common placeable cells (< 12)'; b.outcomes = {}; b.startTotals = {}; b.costs = []; }
  c.medianYTimes2 = Object.fromEntries(Object.keys(c.medianYTimes2).map((k) => [k, null]));
  c.fluxAttribution = { available: false, reason: 'no valid block produced a measurement', growthAttributedBlocks: 0 };
  inv.fresh.results[0].label = 'invalid-or-incomplete';
  const html = drawAll(inv).join('\n');
  expect(html).toMatch(/n\/a/);
  expect(html).toMatch(/did not reach the assay/);
  expect(html).not.toMatch(/undefined|NaN|\[object/);
  expect(edgeOf('invalid-or-incomplete', 'n/a').state).toBe('unavailable');
});
