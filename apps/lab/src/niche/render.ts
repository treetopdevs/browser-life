// Pure helpers for the niche-construction page: formatting, labels, table rows. No DOM lookups; the page reads evidence.json only.
export interface Rational { num: number; den: number }
export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export const fmt = (n: number | null | undefined): string => (n === null || n === undefined ? 'n/a' : n.toLocaleString('en-US'));
/** Twice-the-median integer to a readable half-step number, or n/a. */
export const half = (n2: number | null | undefined): string => (n2 === null || n2 === undefined ? 'n/a' : n2 % 2 === 0 ? fmt(n2 / 2) : `${n2 < 0 ? '-' : ''}${fmt(Math.floor(Math.abs(n2) / 2))}.5`);
export const ratText = (r: Rational): string => (r.num === r.den ? '1' : `${r.num}/${r.den}`);

export type EdgeState = 'supported' | 'unsupported' | 'unavailable';
export interface EdgeView { state: EdgeState; word: string; text: string }

/** Evidence label -> the edge drawn between builder and receiver. A technical failure or a limited measurement is "unavailable", never "unsupported". */
export function edgeOf(label: string, mechanism: string): EdgeView {
  if (label === 'supported') return { state: 'supported', word: 'supported', text: `Dependency edge supported for this pair, horizon and field (${mechanism}).` };
  if (label === 'unsupported-within-tested-domain') return { state: 'unsupported', word: 'unsupported', text: 'No causal benefit detected within the tested domain. This does not say a second link is impossible.' };
  if (label === 'not-run') return { state: 'unavailable', word: 'unavailable', text: 'Not run (runtime rule). Not a negative result.' };
  return { state: 'unavailable', word: 'unavailable', text: 'The assay could not decide (invalid blocks or an insensitive measurement). Not a negative result.' };
}

export const ARM_TEXT: Record<string, { name: string; what: string }> = {
  a: { name: 'Co-culture', what: 'The builder is still alive when the receiver arrives.' },
  b: { name: 'Builder removed', what: 'Living cells are relabelled non-living; the whole conditioned field stays in place.' },
  c: { name: 'Matched inventory, scrambled', what: 'Same totals of every channel as the builder-removed field, structure shuffled.' },
  cP: { name: 'Polymer only scrambled', what: 'Only the polymer is shuffled; everything else stays where it was.' },
  cNP: { name: 'Everything but polymer scrambled', what: 'All other channels are shuffled; the polymer stays where it was.' },
  nb: { name: 'Nonbuilder history', what: 'Same founders and budget, without the building gene, then removed.' },
  ab: { name: 'Ablation', what: 'Builder cost kept; its polymer is turned into waste at the transfer, the released energy booked as named heat.' },
  d0: { name: 'Receiver alone', what: 'The same total budget as an unconditioned lattice, same inoculum.' },
  d1E: { name: 'Receiver alone + field energy', what: 'Receiver alone with the free energy the field held near the inoculum handed over as inoculum.' },
  d1B: { name: 'Receiver alone + field matter', what: 'Receiver alone with the bound matter the field held near the inoculum handed over as inoculum.' },
};
export const ARM_ORDER = ['b', 'a', 'nb', 'ab', 'c', 'cP', 'cNP', 'd0', 'd1E', 'd1B'];

export const CONTRAST_TEXT: Record<string, string> = {
  builder: 'builder vs nonbuilder history (both removed)',
  poly: 'builder vs its polymer-ablated copy',
  space: 'builder field vs the same totals scrambled',
  inoc: 'builder field vs receiver alone given the same energy or matter as inoculum',
};

export interface ArmRow { id: string; name: string; what: string; /** twice the median, or null when no block measured the arm */ median2: number | null; /** null = the block did not measure this arm (invalid block) */ perBlock: (number | null)[]; survived: string }
export function armRows(blocks: { outcomes?: Record<string, { y: number }> }[], medianYTimes2: Record<string, number | null>, survivedByArm: Record<string, { survived: number; of: number }> = {}): ArmRow[] {
  return ARM_ORDER.filter((id) => id in medianYTimes2).map((id) => ({
    id, ...ARM_TEXT[id], median2: medianYTimes2[id], perBlock: blocks.map((b) => b.outcomes?.[id]?.y ?? null),
    survived: survivedByArm[id] ? `${survivedByArm[id].survived} of ${survivedByArm[id].of}` : 'n/a',
  }));
}

export interface LedgerRow { arm: string; matter: string; energy: string; reserve: string; residual: string }
export function ledgerRows(startTotals: Record<string, { matter: string; energy: string; reserveB: number; reserveE: number }> | undefined, transfers: Record<string, { residual: string; matterResidual: string }[]> | undefined): LedgerRow[] {
  const st = startTotals ?? {};
  return ARM_ORDER.filter((id) => id in st).map((arm) => {
    const t = st[arm];
    const bad = ((transfers ?? {})[arm] ?? []).some((r) => r.residual !== '0' || r.matterResidual !== '0');
    return { arm, matter: t.matter, energy: t.energy, reserve: `B ${t.reserveB}, E ${t.reserveE}`, residual: bad ? 'NONZERO' : '0' };
  });
}

export interface BarGeometry { x: number; w: number }
/** Bar from 0 to value on a shared linear scale (max > 0). */
export const barWidth = (v: number, max: number, width: number): number => (max <= 0 ? 0 : Math.max(0, Math.round((width * v) / max)));

/** Scan every transfer of every block in the payload: the page states the residual claim from this, never from static text. */
export function residualScan(ev: EvidenceView): { blocks: number; transfers: number; nonzero: number } {
  const blocks = [...(ev.dev?.candidates ?? []), ...(ev.fresh?.candidates ?? [])].flatMap((c) => c.blocks ?? []);
  let transfers = 0, nonzero = 0;
  for (const b of blocks) for (const recs of Object.values(b.transfers ?? {})) for (const r of recs) { transfers++; if (r.residual !== '0' || r.matterResidual !== '0') nonzero++; }
  return { blocks: blocks.length, transfers, nonzero };
}

// ---- Whole-page sections as pure (evidence) => html functions, so every payload shape (stopped, invalid, normal) can be tested. ----
export interface BlockView {
  seed: number; valid?: boolean; invalidReason?: string | null;
  startTotals?: Record<string, { matter: string; energy: string; reserveB: number; reserveE: number }>;
  transfers?: Record<string, { residual: string; matterResidual: string }[]>;
  costs?: { kind: string; B: string; P: string; E: string; builderLineageB: number }[];
  outcomes?: Record<string, { y: number }>;
}
export interface CandView {
  cluster: number; blocks: BlockView[];
  input: { delta: number; survivedBlocks: number; expectedBlocks: number };
  medianYTimes2: Record<string, number | null>;
  survivedByArm?: Record<string, { survived: number; of: number }>;
  fluxAttribution: { available: boolean; reason: string; growthAttributedBlocks: number };
}
export interface ResultView {
  id: string; label: string; mechanism: string; reasons: string[]; pCand: Rational; holmThreshold: Rational | null;
  gating: Record<string, { k: number; n: number; p: Rational; medianTimes2: number; passes: boolean }>;
}
export interface WallView { kind: string; totalP: number; k: number; d: number[]; p: Rational; medianTimes2: number; passes: boolean }
export interface EvidenceView {
  protocolHash: string; integritySha256: string; amendments?: string[];
  dev: { seeds: readonly number[]; candidates: { cluster: number; blocks?: BlockView[]; builderPMedianTimes2: number; deltaProposed: number; polymerAdequate: boolean }[]; wall: { W1: WallView; W2: WallView; builderScale: { W1: WallView; W2: WallView }; note?: string } };
  fresh: { seeds: readonly number[]; ran: boolean; candidates: CandView[]; results: ResultView[]; panel: { verdict: string; text: string }; caveats: string[] };
  fixtures: { reports: { id: string; naiveWouldSay: string; naiveK: number; seeds: readonly number[]; matchedControls: string; caughtBy?: string[]; label: string }[]; guards: { id: string; ok: boolean }[]; handWallGate?: { id: string; label: string; gatingK: Record<string, number>; seeds: readonly number[] } };
  limits: string[];
}

export function verdictHtml(ev: EvidenceView): string {
  const f = ev.fresh;
  const stopped = f.ran ? '' : '<p class="verdict-stop"><strong>Stopped before the fresh-seed run.</strong> No confirmation block was run, so there are no arms, contrasts or ledgers below to read.</p>';
  const amend = (ev.amendments ?? []).map((a) => `<li>${esc(a)}</li>`).join('');
  return `<p class="verdict-text"><strong>${esc(f.panel.verdict.replaceAll('-', ' '))}.</strong> ${esc(f.panel.text)}</p>${stopped}
    <ul>${f.caveats.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>
    <p class="muted">Protocol hash <code>${esc(ev.protocolHash.slice(0, 16))}</code>, seal <code>${esc(ev.integritySha256.slice(0, 16))}</code>. ${f.ran ? `${f.seeds.length} fresh blocks per candidate; ` : 'No fresh blocks; '}${ev.dev.seeds.length} dev blocks were used for calibration only.</p>
    ${amend ? `<ul class="muted">${amend}</ul>` : ''}`;
}

export function edgeSvg(state: string, word: string): string {
  const col = state === 'supported' ? '#9fe4c4' : state === 'unsupported' ? '#f2c978' : '#a7b9bc';
  const dash = state === 'supported' ? '' : state === 'unsupported' ? ' stroke-dasharray="8 6"' : ' stroke-dasharray="2 6"';
  const mark = state === 'supported' ? 'M178 36 l10 10 l20 -22' : state === 'unsupported' ? 'M178 24 l30 24 M208 24 l-30 24' : 'M193 22 q10 0 10 9 q0 6 -10 9 M193 52 v1';
  return `<svg viewBox="0 0 400 72" role="img" aria-label="Dependency edge builder to receiver: ${esc(word)}" class="edge-svg">
    <rect x="4" y="12" width="110" height="48" rx="10" fill="#14232a" stroke="#56717b"/><text x="59" y="42" text-anchor="middle" fill="#e7efeb" font-size="14">Builder</text>
    <rect x="286" y="12" width="110" height="48" rx="10" fill="#14232a" stroke="#56717b"/><text x="341" y="42" text-anchor="middle" fill="#e7efeb" font-size="14">Receiver</text>
    <line x1="116" y1="36" x2="282" y2="36" stroke="${col}" stroke-width="3"${dash}/><path d="M282 36 l-12 -7 v14 z" fill="${col}"/>
    <path d="${mark}" fill="none" stroke="${col}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

export function candidateOptions(ev: EvidenceView): string {
  return ev.fresh.candidates.map((c) => `<option value="${c.cluster}">Builder from founder cluster ${c.cluster}</option>`).join('');
}

const NO_CANDIDATE = '<p class="muted">No candidate was measured, so there is nothing to draw: the edge is unavailable, not unsupported.</p>';

export function edgeHtml(ev: EvidenceView, cluster: number | undefined): string {
  const c = ev.fresh.candidates.find((x) => x.cluster === cluster);
  const r = ev.fresh.results.find((x) => x.id === `cluster-${cluster}`);
  if (!c || !r) return `${edgeSvg('unavailable', 'unavailable')}<p class="edge-word edge-unavailable"><strong>Edge unavailable.</strong> ${esc(ev.fresh.panel.text)}</p>${NO_CANDIDATE}`;
  const e = edgeOf(r.label, r.mechanism);
  return `${edgeSvg(e.state, e.word)}<p class="edge-word edge-${e.state}"><strong>Edge ${esc(e.word)}.</strong> ${esc(e.text)}</p>
    <p class="muted">Label from the pre-stated rule: <code>${esc(r.label)}</code>${r.reasons.length ? ` (${esc(r.reasons.join('; '))})` : ''}. Candidate p ${esc(ratText(r.pCand))}${r.holmThreshold ? `, Holm threshold ${esc(ratText(r.holmThreshold))}` : ''}; delta ${fmt(c.input.delta)}; receiver survived in the builder-removed arm in ${c.input.survivedBlocks} of ${c.input.expectedBlocks} blocks.</p>`;
}

export function armsHtml(c: CandView | undefined): string {
  if (!c) return NO_CANDIDATE;
  const rows = armRows(c.blocks, c.medianYTimes2, c.survivedByArm);
  const max = Math.max(1, ...rows.flatMap((x) => [...x.perBlock.map((v) => v ?? 0), (x.median2 ?? 0) / 2]));
  return rows.map((a) => `<li class="arm"><div class="arm-head"><strong>${esc(a.name)}</strong> <span class="arm-id">${esc(a.id)}</span></div><p class="arm-what">${esc(a.what)}</p>
      <div class="bar" role="img" aria-label="${esc(a.name)}: median receiver-labelled biomass ${esc(half(a.median2))} of up to ${max}"><span style="width:${barWidth((a.median2 ?? 0) / 2, max, 100)}%"></span>${a.perBlock.map((v) => (v === null ? '' : `<i style="left:${barWidth(v, max, 100)}%"></i>`)).join('')}</div>
      <p class="arm-n">median ${half(a.median2)}; receiver present at the end in ${esc(a.survived)} blocks; per block ${a.perBlock.map(fmt).join(', ')}</p></li>`).join('');
}

export function contrastsHtml(r: ResultView | undefined): string {
  if (!r) return '<tr><td colspan="5">Not measured.</td></tr>';
  return ['builder', 'poly', 'space', 'inoc'].map((k) => {
    const g = r.gating[k];
    return `<tr><th scope="row">${esc(CONTRAST_TEXT[k])}</th><td>${g.k} of ${g.n}</td><td>${esc(ratText(g.p))}</td><td>${half(g.medianTimes2)}</td><td>${g.passes ? 'passes' : 'does not pass'}</td></tr>`;
  }).join('');
}

export function ledgerHtml(c: CandView | undefined): string {
  const b0 = c?.blocks[0];
  if (!b0) return '<tr><td colspan="5">Not measured.</td></tr>';
  const rows = ledgerRows(b0.startTotals, b0.transfers);
  if (!rows.length) return `<tr><td colspan="5">Block ${b0.seed} did not reach the assay (${esc(b0.invalidReason ?? 'invalid')}).</td></tr>`;
  return rows.map((x) => `<tr><th scope="row">${esc(ARM_TEXT[x.arm]?.name ?? x.arm)}</th><td>${esc(x.matter)}</td><td>${esc(x.energy)}</td><td>${esc(x.reserve)}</td><td>${esc(x.residual)}</td></tr>`).join('');
}

export function ledgerNote(ev: EvidenceView, c: CandView | undefined): string {
  const scan = residualScan(ev);
  const seed = c?.blocks[0] ? `Block seed ${c.blocks[0].seed}. ` : '';
  return `${seed}${scan.nonzero === 0 ? `Scanned ${scan.transfers} transfers in ${scan.blocks} blocks (dev and fresh): every matter and energy residual is exactly zero.` : `NONZERO RESIDUAL in ${scan.nonzero} of ${scan.transfers} transfers: this evidence is not valid.`}`;
}

export function costHtml(c: CandView | undefined): string {
  const costs = c?.blocks[0]?.costs ?? [];
  return costs.length ? costs.map((k) => `<tr><th scope="row">${esc(k.kind)}</th><td>${esc(k.B)}</td><td>${esc(k.P)}</td><td>${esc(k.E)}</td><td>${k.builderLineageB}</td></tr>`).join('') : '<tr><td colspan="5">Not measured.</td></tr>';
}

export function fluxText(c: CandView | undefined): string {
  if (!c) return 'Flux attribution unavailable: no candidate was measured.';
  return c.fluxAttribution.available ? `Flux attribution available (${c.fluxAttribution.reason}). Growth attributed in ${c.fluxAttribution.growthAttributedBlocks} of ${c.blocks.length} builder-removed blocks (synthesis at least half the gain).` : `Flux attribution unavailable: ${c.fluxAttribution.reason}.`;
}

export function fixturesHtml(ev: EvidenceView): string {
  const rows = ev.fixtures.reports.map((f) => `<tr><th scope="row">${esc(f.id)}</th><td>${esc(f.naiveWouldSay)} (${f.naiveK} of ${f.seeds.length} positive)</td><td>${esc(f.matchedControls)}${f.matchedControls === 'caught' && f.caughtBy?.length ? ` by ${esc(f.caughtBy.join(' and '))}` : ''}</td><td>${esc(f.label)}</td></tr>`);
  const w = ev.fixtures.handWallGate;
  if (w) rows.push(`<tr><th scope="row">${esc(w.id)}</th><td>structure under the receiver</td><td>blocks positive: ${Object.entries(w.gatingK).map(([k, v]) => `${esc(k)} ${v} of ${w.seeds.length}`).join(', ')}</td><td>${esc(w.label)}</td></tr>`);
  return rows.join('');
}

export function wallHtml(ev: EvidenceView): string {
  const w = ev.dev.wall;
  return [w.W1, w.W2, w.builderScale.W1, w.builderScale.W2].map((x) => `<tr><th scope="row">${esc(x.kind)}, polymer ${fmt(x.totalP)}</th><td>${x.k} of ${x.d.length}</td><td>${esc(ratText(x.p))}</td><td>${half(x.medianTimes2)}</td><td>${x.passes ? 'seen' : 'not seen'}</td></tr>`).join('');
}

export function devRowsHtml(ev: EvidenceView): string {
  return ev.dev.candidates.map((c) => `<tr><th scope="row">cluster ${c.cluster}</th><td>${half(c.builderPMedianTimes2)}</td><td>${fmt(c.deltaProposed)}</td><td>${c.polymerAdequate ? 'adequate' : 'not adequate: polymer at or below the noise floor'}</td></tr>`).join('');
}

export function guardsText(ev: EvidenceView): string {
  return ev.fixtures.guards.map((g) => `${g.id}: ${g.ok ? 'refused as designed' : 'FAILED'}`).join('; ');
}
