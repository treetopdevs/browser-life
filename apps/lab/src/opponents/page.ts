import evidence from '../../../../docs/historical-opponents-2026-11-01/evidence.json';
import { esc, f2, indexRuns, matrix, shadeFor, timeRows, type Metric, type Position, type Ratio, type RunRec, type ViewConfig } from './render.ts';
import './style.css';

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const cfg = evidence.config as unknown as ViewConfig;
const idx = indexRuns(evidence.runs as unknown as RunRec[]);
const checkpoints = evidence.constants.checkpoints as number[];
const S = evidence.summary as unknown as {
  twin: { labelInvariance: boolean; positionAdvantage: number[]; signFlipP: number | null; meanAbs: number | null; effectTarget: number; naiveDecisiveRate: number | null; rare: Record<string, number[]> | null } | null;
  weakened: { complete: number; allBelowHalf: boolean; meanPayoffW: number | null; soloAboveFloor: boolean } | null;
  depletion: { bothBelowFloorEveryRun: boolean; status: string; naiveShare: number | null } | null;
  floor: Record<string, Record<string, { contested: number; decisive: number; bothFloor: number; total: number }[]>>;
  matrix: { ids: string[]; cycles: string[][]; breadth: Record<string, number>; meanPayoff: Record<string, number | null> };
};
const gates = evidence.gates as unknown as { gates: Record<string, boolean>; detail: Record<string, unknown> };
const fixtures = evidence.fixtures as unknown as { pass: boolean; rpsSynthetic: { cycles: string[][] }; vigourOnly: { pass: boolean }; bothFloorClassifier: { pass: boolean }; asymmetricExclusion: { pass: boolean } };

const ratio = el<HTMLSelectElement>('ratio'), pos = el<HTMLSelectElement>('pos'), time = el<HTMLSelectElement>('time'), metric = el<HTMLSelectElement>('metric');
const rowsel = el<HTMLSelectElement>('rowsel'), colsel = el<HTMLSelectElement>('colsel');
const last = checkpoints.length - 1;

time.innerHTML = checkpoints.map((s, k) => `<option value="${k}"${k === last ? ' selected' : ''}>step ${s}${k === last ? ' (final, the primary-analysis time; exploratory like everything here)' : ' (exploratory)'}</option>`).join('');
for (const sel of [rowsel, colsel]) sel.innerHTML = cfg.ids.map((id) => `<option value="${esc(id)}">${esc(id)}</option>`).join('');
colsel.value = cfg.ids[1];

const VERDICT_TEXT: Record<string, string> = {
  'assay-sensitive': 'It caught the weakened copy and stayed quiet for identical organisms, at this effect size and resolution.',
  'label-or-position-biased': 'It did not stay quiet for identical organisms (a label or a position effect), so its results cannot be trusted as they stand.',
  insensitive: 'It did not reliably catch the weakened copy.',
  'extinction-limited': 'Too many contests ended with both sides gone to read.',
  'control-invalid': 'A control did not work, so no verdict about the assay can be drawn.',
};

function render() {
  const r = ratio.value as Ratio, p = pos.value as Position, k = Number(time.value), m = metric.value as Metric;
  const rare = r === 'rare';
  const tr0 = S.twin?.rare?.rA ?? [];
  const twinRare = tr0.length ? tr0.reduce((a, b) => a + b, 0) / tr0.length : null;
  el('mhelp').textContent = rare
    ? `Rare start: each cell is the change in the row organism's share of biomass from the share it started with, when it starts as one disc against three of the column organism. Positive means it gained ground. Exploratory. Read it against the control: the same organism under two names, one disc against three, changed its share by ${twinRare === null ? 'n/a' : (twinRare > 0 ? '+' : '') + f2(twinRare)} on average, so a lone disc is disadvantaged by arrangement alone and a negative cell here is not by itself a failure to invade.`
    : 'Each cell is the share of biomass the row organism holds against the column organism, with a 95% interval across seed blocks, n = blocks kept. 0.50 is an even split. Blocks where either position ended with both sides gone are dropped whole and counted.';
  const mx = matrix(idx, cfg, r, p, k, rare ? 'payoff' : m);
  const caption = `${rare ? 'Change in share' : metric.selectedOptions[0].textContent} at step ${checkpoints[k]}. Rows are the organism whose share is shown.`;
  el('mcap').textContent = caption;
  el('matrix').querySelector('thead')!.innerHTML = `<tr><th scope="col">Row against column</th>${cfg.ids.map((id) => `<th scope="col">${esc(id)}</th>`).join('')}</tr>`;
  el('matrix').querySelector('tbody')!.innerHTML = mx.map((row, i) => `<tr><th scope="row">${esc(cfg.ids[i])}</th>${row.map((c) => `<td class="cell ${c.view.state}" style="background:${shadeFor(c, r, rare ? 'payoff' : m)}">${c.view.state === 'uninformative' ? '<strong>uninformative</strong><br>' : ''}${esc(c.shown)}</td>`).join('')}</tr>`).join('');
  const tr = timeRows(idx, cfg, rowsel.value, colsel.value, r, p, checkpoints);
  el('timetable').querySelector('tbody')!.innerHTML = rowsel.value === colsel.value ? '<tr><td colspan="2">Pick two different organisms.</td></tr>' : tr.map((t) => `<tr><th scope="row">${t.step}${t.step === checkpoints[last] ? ' (final)' : ''}</th><td>${esc(t.text)}</td></tr>`).join('');
}

function renderStatic() {
  const v = evidence.verdict as string;
  const ok = v === 'assay-sensitive';
  el('verdict').className = `verdict ${ok ? 'good' : 'warn'}`;
  el('verdict').textContent = `Verdict recorded in the evidence: ${v}. ${VERDICT_TEXT[v] ?? ''} A non-sensitive verdict is a valid result and is shown as it came out.`;
  const t = S.twin, w = S.weakened, d = S.depletion, g = gates.gates;
  const rows: [string, string, string, boolean][] = [
    ['Same organism, two names: exact', 'Swapping the names changes nothing physical: counts swap exactly.', t ? (t.labelInvariance ? 'counts swap exactly in every seed and time' : 'counts differ') : 'not run', g.G1a],
    ['Same organism, two names: position', `No systematic gain from where it is planted (sign-flip p above 0.05) and the mean size of the place effect below ${t?.effectTarget ?? '?'}.`, t ? `place effect per seed: ${t.positionAdvantage.map((x) => (x > 0 ? '+' : '') + f2(x)).join(', ')}; mean size ${t?.meanAbs === null ? '–' : f2(t!.meanAbs!)}; p = ${t?.signFlipP === null ? '–' : t!.signFlipP!.toFixed(3)}. A naive reading calls ${t?.naiveDecisiveRate === null ? '–' : Math.round(100 * t!.naiveDecisiveRate!)}% of single runs decisive.` : 'not run', g.G1b],
    ['Weakened copy must lose', 'Photosynthesis weight cut by half: it loses to its parent in every block and holds at most 0.40, and it is alive when growing alone.', w ? `${w.complete} complete blocks; mean share ${w.meanPayoffW === null ? '–' : f2(w.meanPayoffW)}; alive alone: ${w.soloAboveFloor ? 'yes' : 'no'}` : 'not run', g.G2],
    ['Not too many empty contests', 'At most 20% of contests with both sides gone, in every matchup and start; no matchup unreadable, and no even start with fewer than four fifths of its blocks complete and no rare start with fewer than five sixths.', JSON.stringify(gates.detail.floorFails) === '[]' && JSON.stringify(gates.detail.uninformativePairs) === '[]' ? 'within limits' : `over limit: ${JSON.stringify(gates.detail.floorFails)} unreadable: ${JSON.stringify(gates.detail.uninformativePairs)}`, g.G3],
    ['Both sides gone is not a tie', 'A darkened, decaying tile must end with both sides at the floor and be called unreadable.', d ? `${d.bothBelowFloorEveryRun ? 'both sides at the floor in every run' : 'not every run reached the floor'}; status ${d.status}; a naive reading says a ${d.naiveShare === null ? '–' : f2(d.naiveShare)} tie` : 'no in-world arena: classifier fixture only', g.G4],
    ['Constructed fixtures', 'Growth-only advantage has zero residual; a built A>B>C>A cycle is found and a transitive set is not; dropped blocks are handled whole.', `cycle found in the synthetic fixture: ${JSON.stringify(fixtures.rpsSynthetic.cycles)}`, g.G5],
  ];
  el('controls').querySelector('tbody')!.innerHTML = rows.map(([a, b, c, ok2]) => `<tr><th scope="row">${esc(a)}</th><td>${esc(b)}</td><td>${esc(c)}</td><td>${ok2 ? 'yes' : '<strong>no</strong>'}</td></tr>`).join('');
  const ext: string[] = [];
  for (const [pr, arms] of Object.entries(S.floor)) for (const [arm, cps] of Object.entries(arms)) {
    const c = cps[last];
    ext.push(`<tr><th scope="row">${esc(pr)}</th><td>${arm === 'bal' ? '1:1' : arm === 'rA' ? 'first rare' : 'second rare'}</td><td>${c.contested}</td><td>${c.decisive}</td><td>${c.bothFloor}</td></tr>`);
  }
  el('ext').querySelector('tbody')!.innerHTML = ext.join('');
  el('cycles').textContent = S.matrix.cycles.length ? `Cycles among confirmed edges: ${S.matrix.cycles.map((c) => c.join(' > ') + ' > ' + c[0]).join('; ')}.` : 'Cycles among confirmed edges: none detected at this resolution. The detector finds a cycle on a built, synthetic A>B>C>A fixture; "none detected" here does not mean none exist.';
  el('breadth').querySelector('tbody')!.innerHTML = S.matrix.ids.map((id) => `<tr><th scope="row">${esc(id)}</th><td>${S.matrix.meanPayoff[id] === null ? '–' : f2(S.matrix.meanPayoff[id]!)}</td><td>${S.matrix.breadth[id]}</td></tr>`).join('');
}

for (const s of [ratio, pos, time, metric, rowsel, colsel]) s.addEventListener('change', render);
renderStatic();
render();
