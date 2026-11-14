import evidence from '../../../../../docs/historical-opponents-archive-2026-11-02/evidence.json';
import { esc, f2, histogram, laterVsEarlier, pct, rank, shade, type PairView } from './render.ts';
import './style.css';

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
interface Analysis { n: number; scheduled: number; informative: number; naive: { wins: number; pairs: number; fraction: number }; rank: { observed: number | null; rDir: number | null; rRev: number | null; perms: number; minRank: number; terms: number }; residRank: { rDir: number | null } | null; edgeCount: number; cycleFlag: string; ordered: boolean }
interface Tour { ids: string[]; pairs: PairView[]; analysis: Analysis; permuted: number[] }
interface Fix { id: string; synthetic: boolean; naive: { fraction: number; wins: number; pairs: number }; rDir: number | null; minRank: number; cycleFlag: string; label: string; expected: string; pass: boolean; note: string }
interface Src { short: string; name: string; tournament: Tour; twin: { labelInvariance: boolean; positionAdvantage: (number | null)[]; signFlipP: number | null; meanAbs: number | null; effectTarget: number; positionOk: boolean }; weakCopy: { complete: number; meanPayoffB: number | null; soloAboveFloor: boolean | null; detected: boolean }; label: string; underlying: string | null }
const S = evidence.summary as unknown as {
  sources: Src[]; gw: { complete: number; meanPayoffB: number | null; soloAboveFloor: boolean | null; detected: boolean };
  starved: { pair: string[]; bothBelowFloorEveryRun: boolean; status: string } | null; fixtures: Fix[]; chain: { fixture: Fix };
  global: { runsValid: boolean; starvedOk: boolean; gwDetected: boolean; assayOk: boolean }; labelCounts: Record<string, number>;
};
const archive = evidence as unknown as { verdict: Record<string, string> };

const LABEL_TEXT: Record<string, string> = {
  'control-invalid': 'an instrument control did not work, so nothing can be read',
  'insensitive-or-biased': 'the arena did not stay quiet for identical organisms or did not catch the weakened copy',
  'assay-failed': 'a planted case (chain, strength-not-time or vigour-only) was not classified as it must be',
  'partial-tournament': 'some pairs were unreadable, so the label below it is partial',
  'directional-rank': 'later survivors win more than shuffled timelines give, and growing alone does not explain it',
  'directional-vigour-only': 'later survivors win more than shuffled timelines give, but the growing-alone residual did not meet the rank cutoff',
  'ordered-not-temporal': 'there is a strength order, but it does not follow the search timeline',
  'nothing-beyond-null': 'none detected at this resolution',
};

const source = el<HTMLSelectElement>('source');
source.innerHTML = S.sources.map((s) => `<option value="${esc(s.short)}">${esc(s.name)}</option>`).join('');

function renderStatic() {
  const counts = Object.entries(S.labelCounts).filter(([, n]) => n > 0).map(([l, n]) => `${n} ${l}`).join(', ');
  el('verdict').className = 'verdict warn';
  el('verdict').textContent = `Recorded labels, one per search, never pooled: ${S.sources.map((s) => `${s.short} ${s.label}${s.underlying ? ` (underlying ${s.underlying})` : ''}`).join('; ')}. Counts: ${counts}. Related searches that agree are similar, not replicated. Any outcome is a valid result and is shown as it came out.`;
  const rows: [string, string, string, boolean | null][] = [
    ['Same organism, two names: exact', 'Swapping the labels changes nothing physical: counts swap exactly.', S.sources.map((s) => `${s.short}: ${s.twin.labelInvariance ? 'exact' : 'differs'}`).join('; '), S.sources.every((s) => s.twin.labelInvariance)],
    ['Same organism, two names: position', 'No systematic gain from position (sign-flip p above 0.05) and a mean place effect below the first rung\'s target.', S.sources.map((s) => `${s.short}: mean size ${s.twin.meanAbs === null ? '–' : f2(s.twin.meanAbs)}, p ${s.twin.signFlipP === null ? '–' : s.twin.signFlipP.toFixed(3)}`).join('; '), S.sources.every((s) => s.twin.positionOk)],
    ['Weakened copy must lose (calibrated pair)', 'The generalist with half its photosynthesis weight loses in every block and holds at most 0.40.', `mean share of the weakened copy ${S.gw.meanPayoffB === null ? '–' : f2(S.gw.meanPayoffB)} over ${S.gw.complete} blocks; alive alone: ${S.gw.soloAboveFloor ? 'yes' : 'no'}`, S.gw.detected],
    ['Weakened copy of each search\'s latest (descriptive)', 'Shown, not gated: the edit can leave some genomes less impaired.', S.sources.map((s) => `${s.short}: mean share ${s.weakCopy.meanPayoffB === null ? '–' : f2(s.weakCopy.meanPayoffB)}, alive alone ${s.weakCopy.soloAboveFloor ? 'yes' : 'no'}, caught ${s.weakCopy.detected ? 'yes' : 'no'}`).join('; '), null],
    ['Starved arena is not a tie', 'A dark decaying tile must end with both sides at the floor and be called unreadable.', S.starved ? `${S.starved.pair.join(' vs ')}: ${S.starved.bothBelowFloorEveryRun ? 'both at the floor in every run' : 'not every run reached the floor'}; status ${S.starved.status}` : 'not run', S.global.starvedOk],
    ['Planted chain', 'Graded weakening of one organism, in order, must be called directional (rank or vigour-only).', `${S.chain.fixture.label}; rank ${rank(S.chain.fixture.rDir)}`, S.chain.fixture.pass],
  ];
  el('controls').querySelector('tbody')!.innerHTML = rows.map(([a, b, c, ok]) => `<tr><th scope="row">${esc(a)}</th><td>${esc(b)}</td><td>${esc(c)}</td><td>${ok === null ? 'n/a (descriptive)' : ok ? 'yes' : '<strong>no</strong>'}</td></tr>`).join('');
  const nrows = [
    ...S.fixtures.map((f) => ({ id: f.id, kind: f.synthetic ? 'synthetic' : f.id === 'planted-chain' ? 'planted, in-world' : 'first rung matrix', naive: f.naive.fraction, label: f.label, rank: f.rDir, cycle: f.cycleFlag })),
    ...S.sources.map((s) => ({ id: `search ${s.short}`, kind: 'measured', naive: s.tournament.analysis.naive.fraction, label: s.label, rank: s.tournament.analysis.rank.rDir, cycle: s.tournament.analysis.cycleFlag })),
  ];
  el('naive').querySelector('tbody')!.innerHTML = nrows.map((r) => `<tr><th scope="row">${esc(r.id)}</th><td>${esc(r.kind)}</td><td>${pct(r.naive)}</td><td>${esc(r.label)}</td><td>${rank(r.rank)}</td><td>${esc(r.cycle)}</td></tr>`).join('');
}

function render() {
  const s = S.sources.find((x) => x.short === source.value) as Src;
  const t = s.tournament, a = t.analysis;
  const masked = s.label === 'control-invalid' || s.label === 'insensitive-or-biased';
  const failed = [!s.twin.labelInvariance ? 'identical-organism swap not exact' : '', !s.twin.positionOk ? `identical-organism place effect too large (mean size ${s.twin.meanAbs === null ? '–' : f2(s.twin.meanAbs)} against a target of ${s.twin.effectTarget.toFixed(3)}, sign-flip p ${s.twin.signFlipP === null ? '–' : s.twin.signFlipP.toFixed(2)})` : '', !S.gw.detected ? 'weakened copy not caught' : '', !S.global.starvedOk ? 'starved arena not unreadable' : ''].filter(Boolean);
  el('srchelp').textContent = `Label for this search: ${s.label}${s.underlying ? ` (underlying: ${s.underlying})` : ''}: ${LABEL_TEXT[s.label] ?? ''}. ${masked ? `The numbers below are masked by a failed control (${failed.join('; ') || 'see the control strip'}): descriptive only, no label about time. ` : ''}Cycle flag: ${a.cycleFlag}. Informative pairs: ${a.informative} of ${a.scheduled}.`;
  const cells = laterVsEarlier(t.ids, t.pairs);
  el('mcap').textContent = `Share of biomass the row (later) snapshot holds against the column (earlier) snapshot at step 300, with a 95% interval across seed blocks and the blocks kept. 0.50 is an even split. Uninformative pairs are shown as such and never read as a tie. Time runs down the rows and across the columns.`;
  el('matrix').querySelector('thead')!.innerHTML = `<tr><th scope="col">Later against earlier</th>${t.ids.map((id) => `<th scope="col">${esc(id)}</th>`).join('')}</tr>`;
  el('matrix').querySelector('tbody')!.innerHTML = cells.map((row, i) => `<tr><th scope="row">${esc(t.ids[i])}</th>${row.map((c) => `<td class="cell ${c.state}" style="background:${shade(c.value)}">${c.state === 'uninformative' ? '<strong>uninformative</strong><br>' : ''}${esc(c.text)}</td>`).join('')}</tr>`).join('');
  const obs = a.rank.observed;
  el('nulltext').textContent = `Directional statistic D = the mean, over informative pairs, of the later snapshot's share minus 0.5. Observed D = ${obs === null ? 'n/a' : obs.toFixed(3)}. Against all ${a.rank.perms} relabelled timelines the observed one ranks ${rank(a.rank.rDir)} (smallest possible ${rank(a.rank.minRank)}); the reverse tail is ${rank(a.rank.rRev)}. This is a rank, not a p-value. With the growing-alone residual the rank is ${rank(a.residRank?.rDir ?? null)}.`;
  const h = histogram(t.permuted, obs);
  const max = Math.max(...h.counts, 1), bw = 440 / h.counts.length;
  el('hist').innerHTML = `<rect x="0" y="0" width="480" height="160" fill="none"/>` + h.counts.map((c, i) => `<rect class="${i === h.observedBin ? 'obs' : 'bar'}" x="${20 + i * bw}" y="${130 - (110 * c) / max}" width="${bw - 1}" height="${(110 * c) / max}"><title>${c} timelines${i === h.observedBin ? ' (contains the observed value)' : ''}</title></rect>`).join('') +
    `<text x="20" y="148">${h.lo.toFixed(3)}</text><text x="460" y="148" text-anchor="end">${h.hi.toFixed(3)}</text><text x="240" y="12" text-anchor="middle">gold bar: observed D = ${obs === null ? 'n/a' : obs.toFixed(3)}</text>`;
  el('histcap').textContent = `Histogram of D over all ${a.rank.perms} relabelled timelines (${t.permuted.length} with an informative statistic). The gold bar contains the observed D.`;
}

source.addEventListener('change', render);
void archive;
renderStatic();
render();
