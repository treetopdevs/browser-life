// Pure helpers for the second-rung section of the niche page (free-energy-matched comparators, noise vs effect, dose ladder, edge per
// candidate, far-field-energy panel). Reads the sealed second-rung evidence only and runs no simulation.
import { edgeOf, esc, fmt, half, ratText, type Rational } from './render.ts';

interface FreeRowView { id: string; freeE: string; total: string; constructionGap: string; flag: string }
interface BlockFeView { seed: number; valid?: boolean; freeBefore?: FreeRowView[]; freeAfter?: FreeRowView[]; invalidReason?: string | null }
interface DoseStat { k: number; p: Rational; medianTimes2: number }
interface DoseRowView { totalP: number; seeds: readonly number[]; stats: Record<string, DoseStat>; limiting: string; limitingMedianTimes2: number }
interface QualView { cluster: number; delta: number; ceiling: number; minDetectableDose: number | null; qualifyingDose: number | null; qualified: boolean; reason: string }
interface ResultFeView {
  id: string; label: string; simulated: boolean; mechanism: string; reasons: string[]; pCand: Rational; holmThreshold: Rational | null;
  gating: Record<string, { k: number; n: number; p: Rational; medianTimes2: number; passes: boolean }>;
  reported: { inoc: { k: number; n: number; medianTimes2: number }; naive: { k: number; n: number; medianTimes2: number } };
}
interface FixtureFeView { id: string; seeds: readonly number[]; naiveK: number; naiveWouldSay: string; inocFooledOld: boolean; inocCaughtNew: boolean; kOld: number; kNew: number; gatingK: Record<string, number>; caughtBy: string[]; fullGateLabel: string; freeBefore: FreeRowView[] }
export interface EvidenceFeView {
  protocolHash: string; integritySha256: string; amendments?: string[]; powerStatement: string; limits: string[];
  protocol: { R: number; freshSeeds: readonly number[]; wallSeeds: readonly number[] };
  dev: { R: number; candidates: { cluster: number; blocks: BlockFeView[]; deltaProposed: number; builderPMedianTimes2: number }[]; ladder: { rows: DoseRowView[]; w2: { status: string; reason: string } }; qualification: QualView[] };
  fresh: { ran: boolean; seeds: readonly number[]; candidates: { cluster: number; blocks: BlockFeView[]; medianYTimes2: Record<string, number | null>; survivalPositiveBlocks: number; input: { viableBlocks: number; expectedBlocks: number } }[]; results: ResultFeView[]; panel: { verdict: string; text: string }; caveats: string[] };
  fixtures: { reports: FixtureFeView[]; freeGap: { seed: number; d0FreeE: string; bFreeE: string; d0Total: string; bTotal: string }[]; guards: { id: string; ok: boolean }[] };
}

export const COMPARATOR_TEXT: Record<string, string> = {
  b: 'Builder removed (the field arm)',
  d0: 'Receiver alone, total energy matched',
  d1E: 'Receiver alone + field energy near the inoculum',
  d1B: 'Receiver alone + field matter near the inoculum',
  fU: 'Free-energy matched, spread uniformly',
  fS: 'Free-energy matched, same pattern cell for cell',
  fB: 'Free-energy matched + the field\'s biomass',
};
const FREE_ORDER = ['b', 'd0', 'd1E', 'd1B', 'fU', 'fS', 'fB'];
const GAP_WORD: Record<string, string> = { 'comparator-deficit': 'holds less total energy than the field', 'comparator-excess': 'holds more total energy than the field', 'total-matched': 'total energy equal', reference: 'reference' };

/** Free E and total energy per comparator for one block: the d0-versus-b gap (the 9,917 vs 22,169 style numbers) and what matching does to it. */
export function freeEnergyHtml(rows: FreeRowView[] | undefined, seed: number | undefined): string {
  if (!rows?.length) return '<tr><td colspan="4">No block carries a free-energy table.</td></tr>';
  const by = new Map(rows.map((r) => [r.id, r]));
  return FREE_ORDER.filter((id) => by.has(id)).map((id) => {
    const r = by.get(id)!;
    return `<tr><th scope="row">${esc(COMPARATOR_TEXT[id] ?? id)}</th><td>${fmt(Number(r.freeE))}</td><td>${fmt(Number(r.total))}</td><td>${r.id === 'b' ? 'reference' : `${esc(fmt(Number(r.constructionGap)))}: ${esc(GAP_WORD[r.flag] ?? r.flag)}`}</td></tr>`;
  }).join('') + (seed === undefined ? '' : `<tr><td colspan="4" class="muted">Block seed ${seed}, before the inoculum is placed. Gap = total(field arm) minus total(comparator).</td></tr>`);
}

export function noiseEffectHtml(ev: EvidenceFeView): string {
  const rows = ev.dev.qualification.map((q) => {
    const row = ev.dev.ladder.rows.find((r) => r.totalP === q.qualifyingDose) ?? ev.dev.ladder.rows.find((r) => r.totalP === q.minDetectableDose) ?? ev.dev.ladder.rows.reduce<DoseRowView | undefined>((m, r) => (!m || r.limitingMedianTimes2 > m.limitingMedianTimes2 ? r : m), undefined);
    const effect = row ? row.limitingMedianTimes2 / 2 : null;
    const max = Math.max(1, q.delta, effect ?? 0);
    const bar = (v: number | null, cls: string) => `<span class="${cls}" style="width:${Math.round((100 * Math.max(0, v ?? 0)) / max)}%"></span>`;
    return `<tr><th scope="row">cluster ${q.cluster}</th><td>${fmt(q.delta)}</td><td>${effect === null ? 'n/a' : half(row!.limitingMedianTimes2)}${row ? ` at dose ${fmt(row.totalP)} (${esc(row.limiting)}); ${q.qualified || q.minDetectableDose !== null ? 'wall detected' : 'wall not detected at any dose, best dose shown'}` : ''}</td>
      <td><div class="bar" role="img" aria-label="noise floor delta ${fmt(q.delta)} against the wall effect ${effect === null ? 'not detected' : fmt(effect)}">${bar(q.delta, 'bar-noise')}</div><div class="bar">${bar(effect, 'bar-effect')}</div></td></tr>`;
  });
  return rows.join('');
}

export function doseLadderHtml(ev: EvidenceFeView): string {
  const n = ev.protocol.wallSeeds.length;
  const rows = ev.dev.ladder.rows.map((r) => {
    const gk = Object.entries(r.stats).map(([k, s]) => `${esc(k)} ${s.k}/${n}`).join(', ');
    const passes = ev.dev.qualification.map((q) => `c${q.cluster}: ${r.totalP <= q.ceiling ? 'within ceiling' : 'above ceiling'}`).join('; ');
    return `<tr><th scope="row">W1 ring, polymer ${fmt(r.totalP)}</th><td>${gk}</td><td>${esc(r.limiting)} ${half(r.limitingMedianTimes2)}</td><td>${esc(passes)}</td></tr>`;
  });
  rows.push(`<tr><th scope="row">W2 floor under the receiver</th><td colspan="3">${esc(ev.dev.ladder.w2.status)}: ${esc(ev.dev.ladder.w2.reason)}</td></tr>`);
  return rows.join('');
}

export function qualificationHtml(ev: EvidenceFeView): string {
  return ev.dev.qualification.map((q) => `<tr><th scope="row">cluster ${q.cluster}</th><td>${fmt(q.ceiling)}</td><td>${q.minDetectableDose === null ? 'none on the ladder' : fmt(q.minDetectableDose)}</td><td>${q.qualified ? `qualified at ${fmt(q.qualifyingDose)}` : 'not qualified'}</td><td>${esc(q.reason)}</td></tr>`).join('');
}

export function edgeFeHtml(ev: EvidenceFeView): string {
  return ev.fresh.results.map((r) => {
    const e = edgeOf(r.label, r.mechanism);
    const g = ['builder', 'poly', 'space', 'inoc2'].map((k) => (r.simulated ? `${esc(k)} ${r.gating[k].k}/${r.gating[k].n}${r.gating[k].passes ? '' : ' (no)'}` : `${esc(k)} not run`)).join(', ');
    const word = r.simulated ? e.text : 'Not simulated: the positive control did not qualify this builder, so there is no negative and no positive here.';
    return `<li class="edge-fe edge-${e.state}"><strong>${esc(r.id.replace('cluster-', 'Builder cluster '))}: edge ${esc(e.word)}.</strong> ${esc(word)}<br><span class="muted">Label <code>${esc(r.label)}</code>${r.reasons.length ? ` (${esc(r.reasons.join('; '))})` : ''}. Blocks positive: ${g}.</span></li>`;
  }).join('');
}

export function farFieldHtml(ev: EvidenceFeView): string {
  const rows = ev.fixtures.reports.map((f) => `<tr><th scope="row">${esc(f.id)}</th><td>${esc(f.naiveWouldSay)} (${f.naiveK} of ${f.seeds.length})</td><td>${f.kOld} of ${f.seeds.length}: ${f.inocFooledOld ? 'fooled' : 'not fooled'}</td><td>${f.kNew} of ${f.seeds.length}: ${f.inocCaughtNew ? 'caught' : 'not caught'}</td><td>${esc(f.fullGateLabel)}${f.caughtBy.length ? ` (rejected by ${esc(f.caughtBy.join(', '))})` : ''}</td></tr>`);
  return rows.join('');
}

export function verdictFeHtml(ev: EvidenceFeView): string {
  const f = ev.fresh;
  const stopped = f.ran ? '' : '<p class="verdict-stop"><strong>Stopped before the fresh-seed run.</strong> No fresh block was simulated, so there are no per-candidate contrasts: this states how sensitive the assay is at realistic polymer doses, not that no niche is built.</p>';
  return `<p class="verdict-text"><strong>${esc(f.panel.verdict.replaceAll('-', ' '))}.</strong> ${esc(f.panel.text)}</p>${stopped}
    <ul>${f.caveats.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>
    <p class="muted">Protocol hash <code>${esc(ev.protocolHash.slice(0, 16))}</code>, seal <code>${esc(ev.integritySha256.slice(0, 16))}</code>. Each arm summed over ${ev.protocol.R} replicate sims; ${f.ran ? `${f.seeds.length} fresh blocks per qualified candidate` : 'no fresh blocks'}; ${ev.dev.candidates[0]?.blocks.length ?? 0} dev blocks per candidate were used for calibration only.</p>`;
}

const SHOWS_CLAIM = 'It shows the assay can detect a polymer structure of that dose, not that a builder\'s field can pass.';

/**
 * The limits list. The sealed text of the positive-control limit says the control "shows the assay can detect" a polymer structure; that holds
 * only when a control passes. The sealed evidence is frozen, so the page restates that sentence conditionally and, when no candidate was
 * qualified, says plainly that this run's control failed. (Correction recorded in docs/niche-construction-fe-2026-11-02/REVIEW.md.)
 */
export function limitsFeHtml(ev: EvidenceFeView): string {
  const none = ev.dev.qualification.every((q) => !q.qualified && q.minDetectableDose === null);
  return ev.limits.map((l) => {
    if (!l.includes(SHOWS_CLAIM)) return `<li>${esc(l)}</li>`;
    const fixed = l.replace(SHOWS_CLAIM, `A passing control would demonstrate that the assay can detect a polymer structure of that dose, not that a builder's field can pass.${none ? ' In this run no control passed at any dose: every qualification is false and every minimum detectable dose is null, so this run shows the assay could not detect a polymer ring of any tested dose.' : ''}`);
    return `<li>${esc(fixed)}</li>`;
  }).join('');
}

export function pendingHtml(): string {
  return '<p class="muted">The second-rung evidence has not been written yet (docs/niche-construction-fe-2026-11-02/evidence.json). Run <code>node tools/niche/niche.ts --rung fe --write</code> after the freeze.</p>';
}

/** First block that carries a free-energy table, from the fresh blocks if any ran, otherwise dev. */
export function firstFreeBlock(ev: EvidenceFeView): { rows: FreeRowView[] | undefined; seed: number | undefined } {
  const b = ev.fresh.candidates[0]?.blocks[0] ?? ev.dev.candidates[0]?.blocks[0];
  return { rows: b?.freeBefore, seed: b?.seed };
}
export { ratText };
