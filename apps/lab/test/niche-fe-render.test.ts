import { existsSync, readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { doseLadderHtml, edgeFeHtml, farFieldHtml, firstFreeBlock, freeEnergyHtml, limitsFeHtml, noiseEffectHtml, pendingHtml, qualificationHtml, verdictFeHtml, type EvidenceFeView } from '../src/niche/fe.ts';

const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');
const rat = (num: number, den: number) => ({ num, den });
const stat = (k: number, m2: number) => ({ k, p: rat(9, 256), medianTimes2: m2 });
const FREE = [
  { id: 'b', freeE: '9917', total: '26969', constructionGap: '0', flag: 'reference' },
  { id: 'd0', freeE: '22169', total: '26969', constructionGap: '0', flag: 'total-matched' },
  { id: 'fU', freeE: '9917', total: '15000', constructionGap: '11969', flag: 'comparator-deficit' },
  { id: 'fB', freeE: '9917', total: '27000', constructionGap: '-31', flag: 'comparator-excess' },
];
const gating = (k: number) => Object.fromEntries(['builder', 'poly', 'space', 'inoc2'].map((c) => [c, { k, n: 16, p: rat(1, 65536), medianTimes2: 400, passes: k > 12 }]));
const base = (): EvidenceFeView => ({
  protocolHash: 'a'.repeat(64), integritySha256: 'b'.repeat(64), powerStatement: 'power', limits: ['Exploratory, CPU only'],
  protocol: { R: 4, freshSeeds: [1, 2], wallSeeds: [1, 2, 3, 4, 5, 6, 7, 8] },
  dev: {
    R: 4,
    candidates: [{ cluster: 0, blocks: [{ seed: 8601001, freeBefore: FREE }], deltaProposed: 400, builderPMedianTimes2: 170 }],
    ladder: { rows: [{ totalP: 60, seeds: [], stats: { builder: stat(3, 100), poly: stat(3, 100), space: stat(3, 100), inoc2: stat(3, 100) }, limiting: 'builder', limitingMedianTimes2: 100 }], w2: { status: 'unavailable', reason: 'ordinary placement refuses a polymer floor' } },
    qualification: [{ cluster: 0, delta: 400, ceiling: 170, minDetectableDose: null, qualifyingDose: null, qualified: false, reason: 'W1 is not detected at any ladder dose' }],
  },
  fresh: { ran: false, seeds: [1, 2], candidates: [], results: [{ id: 'cluster-0', label: 'unsupported-measurement', simulated: false, mechanism: 'n/a', reasons: ['W1 is not detected'], pCand: rat(1, 1), holmThreshold: null, gating: gating(0), reported: { inoc: { k: 0, n: 16, medianTimes2: 0 }, naive: { k: 0, n: 16, medianTimes2: 0 } } }], panel: { verdict: 'unsupported-measurement', text: 'No verdict' }, caveats: ['No candidate qualified'] },
  fixtures: { reports: [{ id: 'far-field-energy', seeds: [1, 2, 3, 4, 5, 6, 7, 8], naiveK: 8, naiveWouldSay: 'benefit', inocFooledOld: true, inocCaughtNew: true, kOld: 8, kNew: 0, gatingK: { builder: 8, poly: 0, space: 1, inoc2: 0 }, caughtBy: ['poly', 'inoc2'], fullGateLabel: 'unsupported-within-tested-domain', freeBefore: FREE }], freeGap: [], guards: [{ id: 'credit-overdraw', ok: true }] },
});

it('free-energy table rows carry free E, total and the signed construction gap, before matching and after', () => {
  const html = freeEnergyHtml(FREE, 8601001);
  expect(html).toContain('9,917');
  expect(html).toContain('22,169');
  const row = (label: string) => html.split('</tr>').find((r) => r.includes(label)) ?? '';
  expect(row('spread uniformly')).toContain('11,969: holds less total energy than the field');
  expect(row('biomass')).toContain('-31: holds more total energy than the field');
  expect(row('total energy matched')).toContain('0: total energy equal');
  expect(row('Builder removed')).toContain('reference');
  expect(row('Builder removed')).toContain('9,917');
  expect(row('total energy matched')).toContain('22,169');
  expect(html).toContain('Block seed 8601001');
  expect(freeEnergyHtml(undefined, undefined)).toContain('No block');
});

it('stopped payload (positive control failed) says no fresh run and never a negative', () => {
  const ev = base();
  const v = verdictFeHtml(ev);
  expect(v).toContain('Stopped before the fresh-seed run');
  expect(v).toContain('no fresh blocks');
  expect(v).not.toMatch(/no causal benefit detected/i);
  const e = edgeFeHtml(ev);
  expect(e).toContain('edge unavailable');
  expect(e).toContain('Not simulated');
  expect(e).not.toContain('edge unsupported');
});

it('edge supported, unsupported and unavailable render distinctly', () => {
  const ev = base();
  const r = ev.fresh.results[0];
  ev.fresh.results = [
    { ...r, id: 'cluster-0', label: 'supported', simulated: true, mechanism: 'combined conditioned field', gating: gating(16) },
    { ...r, id: 'cluster-4', label: 'unsupported-within-tested-domain', simulated: true, gating: gating(5) },
    { ...r, id: 'cluster-9', label: 'unsupported-measurement', simulated: false },
  ];
  const html = edgeFeHtml(ev);
  expect(html).toContain('edge supported');
  expect(html).toContain('edge unsupported');
  expect(html).toContain('edge unavailable');
});

it('noise-versus-effect bar, dose ladder (W2 unavailable), qualification and far-field rows', () => {
  const ev = base();
  expect(noiseEffectHtml(ev)).toContain('noise floor delta 400');
  const ladder = doseLadderHtml(ev);
  expect(ladder).toContain('W1 ring, polymer 60');
  expect(ladder).toContain('W2 floor under the receiver');
  expect(ladder).toContain('unavailable');
  expect(qualificationHtml(ev)).toContain('not qualified');
  const far = farFieldHtml(ev);
  expect(far).toContain('far-field-energy');
  expect(far).toContain('fooled');
  expect(far).toContain('caught');
  expect(far).toContain('rejected by poly, inoc2');
  expect(firstFreeBlock(ev).seed).toBe(8601001);
  expect(pendingHtml()).toContain('has not been written yet');
});

const strong = (): EvidenceFeView => {
  const ev = base();
  const stats = (a: number, b: number, c: number, d: number) => ({ builder: stat(a, 0), poly: stat(b, 0), space: stat(c, 0), inoc2: stat(d, 0) });
  ev.dev.ladder.rows = [
    { totalP: 60, seeds: [], stats: stats(3, 4, 5, 6), limiting: 'builder', limitingMedianTimes2: 100 },
    { totalP: 120, seeds: [], stats: stats(8, 7, 8, 7), limiting: 'poly', limitingMedianTimes2: 120 },
    { totalP: 240, seeds: [], stats: stats(1, 2, 3, 4), limiting: 'space', limitingMedianTimes2: 7 },
  ];
  ev.dev.qualification = [
    { cluster: 0, delta: 40, ceiling: 130, minDetectableDose: 120, qualifyingDose: 120, qualified: true, reason: 'ok' },
    { cluster: 4, delta: 200, ceiling: 100, minDetectableDose: null, qualifyingDose: null, qualified: false, reason: 'none' },
  ];
  return ev;
};
const widths = (html: string, cls: string) => [...html.matchAll(new RegExp(`${cls}" style="width:(\\d+)%`, 'g'))].map((m) => Number(m[1]));
const rowOf = (html: string, label: string) => html.split('</tr>').find((r) => r.includes(label)) ?? '';

it('noise table: effect value, dose, detected wording and bar widths come from the payload', () => {
  const html = noiseEffectHtml(strong());
  const c0 = rowOf(html, 'cluster 0');
  expect(c0).toContain('<td>40</td>');
  expect(c0).toContain('60 at dose 120 (poly); wall detected');
  expect(c0).not.toContain('not detected');
  const c4 = rowOf(html, 'cluster 4');
  expect(c4).toContain('<td>200</td>');
  expect(c4).toContain('60 at dose 120 (poly); wall not detected at any dose, best dose shown');
  // widths: one scale per row, max(delta, effect). c0: noise 40/60, effect 60/60. c4: noise 200/200, effect 60/200.
  expect(widths(html, 'bar-noise')).toEqual([67, 100]);
  expect(widths(html, 'bar-effect')).toEqual([100, 30]);
  expect(c0).toContain('against the wall effect 60"');
  expect(c4).toContain('against the wall effect 60"');
});

it('dose ladder: k/8 strings use the wall seed count, and within/above-ceiling follows each candidate ceiling', () => {
  const html = doseLadderHtml(strong());
  expect(rowOf(html, 'polymer 60')).toContain('builder 3/8, poly 4/8, space 5/8, inoc2 6/8');
  expect(rowOf(html, 'polymer 120')).toContain('builder 8/8, poly 7/8, space 8/8, inoc2 7/8');
  expect(rowOf(html, 'polymer 60')).toContain('c0: within ceiling; c4: within ceiling');
  expect(rowOf(html, 'polymer 120')).toContain('c0: within ceiling; c4: above ceiling');
  expect(rowOf(html, 'polymer 240')).toContain('c0: above ceiling; c4: above ceiling');
  expect(rowOf(html, 'polymer 240')).toContain('space 3.5');
  const ev = strong();
  ev.protocol.wallSeeds = [1, 2, 3, 4];
  expect(doseLadderHtml(ev)).toContain('builder 3/4');
});

it('limits: the sealed "shows the assay can detect" sentence is restated conditionally, with the failure stated when nothing qualified', () => {
  const sealed = "The positive control is a hand-built polymer ring under ordinary placement (W1). It shows the assay can detect a polymer structure of that dose, not that a builder's field can pass. W2 is unavailable.";
  const failed = base();
  failed.limits = [sealed, 'Other limit'];
  const a = limitsFeHtml(failed);
  expect(a).not.toContain('It shows the assay can detect');
  expect(a).toContain('A passing control would demonstrate that the assay can detect');
  expect(a).toContain('In this run no control passed at any dose');
  expect(a).toContain('<li>Other limit</li>');
  // A dose that passes but sits above the ceiling is detected, just not qualifying: the page must not say nothing was detected.
  const above = base();
  above.limits = [sealed];
  above.dev.qualification = [{ cluster: 0, delta: 40, ceiling: 200, minDetectableDose: 240, qualifyingDose: null, qualified: false, reason: 'dose 240 exceeds the ceiling' }];
  expect(limitsFeHtml(above)).toContain('A passing control would demonstrate');
  expect(limitsFeHtml(above)).not.toContain('In this run no control passed');
  const passed = strong();
  passed.limits = [sealed];
  const b = limitsFeHtml(passed);
  expect(b).toContain('A passing control would demonstrate');
  expect(b).not.toContain('In this run no control passed');
});

it('page captions state the G-NOISE clause, the fallback row and one phrase for the pre-placement state', () => {
  const html = read('apps/lab/niche/index.html');
  expect(html).toContain('G-NOISE: the weakest contrast\'s median is at least twice delta');
  expect(html).toContain('twice the median polymer its dev builders actually leave');
  expect(html).toContain('best dose shown');
  expect(html).toContain('before the inoculum is placed');
  expect(html).not.toContain('before the receiver arrives</h3>');
  expect(html).not.toContain('because the polymer ablation contrast is zero');
});

it('escapes text from the payload', () => {
  const ev = base();
  ev.fresh.panel.text = '<img src=x onerror=alert(1)>';
  expect(verdictFeHtml(ev)).not.toContain('<img');
});

it('the page carries the second-rung section, caption, noindex and no new route', () => {
  const html = read('apps/lab/niche/index.html');
  expect(html).toContain('Second rung: free-energy-matched');
  expect(html).toContain('Exploratory, CPU only, no GPU evidence');
  expect(html).toContain('noindex');
  expect(html).toMatch(/<table><caption>/);
  const packaging = read('apps/lab/vite.config.ts');
  expect(packaging.match(/niche:/g)).toHaveLength(1);
});

it('renders the sealed second-rung evidence when it has been written', () => {
  const path = new URL('../../../docs/niche-construction-fe-2026-11-02/evidence.json', import.meta.url);
  if (!existsSync(path)) return;
  const ev = JSON.parse(readFileSync(path, 'utf8')) as EvidenceFeView;
  expect(edgeFeHtml(ev).length).toBeGreaterThan(50);
  expect(doseLadderHtml(ev)).toContain('W2');
  const { rows, seed } = firstFreeBlock(ev);
  expect(freeEnergyHtml(rows, seed)).toContain('Free-energy matched');
  expect(verdictFeHtml(ev)).toContain('Protocol hash');
});
