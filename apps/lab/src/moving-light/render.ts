// Pure helpers for the moving-light page: labels, blinded names, table rows, SVG paths. No DOM lookups; the page reads evidence.json only.
export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export const fmt = (n: number | null | undefined): string => (n === null || n === undefined ? 'n/a' : n.toLocaleString('en-US'));
export const pct = (ppm: number | null | undefined): string => (ppm === null || ppm === undefined ? 'n/a' : `${(ppm / 10000).toFixed(1)}%`);
/** x1000 fixed point to cells with one decimal. */
export const cells = (v1000: number | null | undefined): string => (v1000 === null || v1000 === undefined ? 'n/a' : (v1000 / 1000).toFixed(1));

export const STRATEGIES = ['drift', 'sense', 'still', 'sense-nosig'] as const;
export type Strategy = (typeof STRATEGIES)[number];
/** A fixed frozen permutation: the page shows A-D until the visitor reveals the names. Not persisted. */
export const BLIND: Record<Strategy, string> = { drift: 'B', sense: 'D', still: 'A', 'sense-nosig': 'C' };
export const NAMES: Record<Strategy, { name: string; what: string }> = {
  sense: { name: 'Signalling sensor', what: 'Signals when it is in the dark and moves away from signal, so its own dark side pushes it toward the light.' },
  'sense-nosig': { name: 'Silent twin', what: 'The same body wiring with the signal turned off. With nothing to read, its movement cancels out and it never moves: it behaves exactly like the sleeper, so the two panels show identical numbers (they are the same non-moving arm).' },
  drift: { name: 'Blind drifter', what: 'Drifts east at a fixed speed whatever the light does.' },
  still: { name: 'Sleeper', what: 'Does not move at all. Its numbers are identical to the silent twin\'s: the two are the same non-moving arm.' },
};
export const labelOf = (s: Strategy, revealed: boolean): string => (revealed ? NAMES[s].name : `Strategy ${BLIND[s]}`);
export const blindedOrder = (): Strategy[] => [...STRATEGIES].sort((a, b) => BLIND[a].localeCompare(BLIND[b]));

export const SCHEDULE_TEXT: Record<string, { name: string; what: string }> = {
  fixed: { name: 'Steady sun', what: 'The sun sweeps east at a constant speed, about one and a half times the pace of a steady east-bound walker.' },
  paused: { name: 'Paused sun', what: 'The sun stands still. This is the control: a benefit that survives here is not about following the sun.' },
  wandering: { name: 'Wandering sun', what: 'The sun sweeps east and then back west over the run. Scored over the whole run after warm-up.' },
  reversed: { name: 'Sun that reverses', what: 'The same wandering sun, but only the time after it turns around is scored, so a head start from before the turn does not count.' },
};

export interface RunView { readouts: { capturePpm: number; absErr1000: number | null; survivalPpm: number; extinct: boolean }; coordination: { covMilliQ2: number | null; signAgreementPpm: number | null; pairs: number } }
export interface BlockView { seed: number; runs: Record<string, Record<string, RunView>>; strip: Record<string, { t: number[]; d1000: number[]; B: number[] }> | null }
export interface SummaryView { positives: number; of: number; p: string; median2: number | null; lower2: number | null }
export interface DecisionView { criteria: { id: string; pass: boolean; detail: string }[]; S: SummaryView; B: SummaryView; Bdrift: SummaryView; core: boolean }
export interface CoordFixtureView { id: string; schedule: string; naiveReads: boolean; naiveGroupedPpm: (number | null)[]; residual: (number | null)[]; floor: number; label: string; rejected: boolean }
export interface PhysFixtureView { id: string; naiveGroupVsDispersedPositive: number; S: number[]; B: number[]; verdict: string; rejected: boolean; note: string }
export interface EvidenceView {
  fresh: { seeds: number[]; blocks: BlockView[]; decisions: Record<string, DecisionView>; verdict: { label: string; reasons: string[]; schedules: Record<string, { core: boolean; allCriteria: boolean }> } };
  fixtures: { coordination: CoordFixtureView[]; physical: PhysFixtureView[]; planted: { id: string; verdict: { label: string } }[] };
  calibration: { sensitivity: { senseTracks: boolean }; floors: Record<string, { cap: number; res: number }>; crossTalk: { dispersed: { signalDiffPpm: number }; flagged: boolean }; schedules: { schedule: string; firstMoveStep: number | null; turnStep: number | null; speedRatioPermille: number }[] };
  limits: string[];
  gaps: string[];
}

export const VERDICT_TEXT: Record<string, string> = {
  supported: 'A group-level interaction benefit is supported in this panel, world size, horizon and schedule set.',
  'unsupported-within-tested-domain': 'No interaction benefit detected here. This says nothing about other worlds, sizes or sensors.',
  'inconclusive-confounded': 'Inconclusive: a control or a comparator disagrees, so the benefit cannot be pinned on the interaction.',
  inconclusive: 'Inconclusive: the estimates lean positive but the pre-stated bar was not met.',
  'invalid-or-incomplete': 'The run was invalid or incomplete. Not a negative result.',
  'unsupported-measurement': 'The assay was too noisy to answer the question (or the sensor did not track the sun at the dev stage): the engine-seed noise floor of the capture contrast (1,429,742 ppm of input energy on the fixed schedule) is above the frozen 500,000 ppm sensitivity bound. Not a negative result.',
};

export function verdictHtml(ev: EvidenceView): string {
  const v = ev.fresh.verdict;
  const rows = Object.entries(v.schedules).map(([id, s]) => `<li><strong>${esc(SCHEDULE_TEXT[id]?.name ?? id)}</strong>: persistence checks ${s.core ? 'passed' : 'not passed'}${id === 'fixed' ? `; all screening checks ${s.allCriteria ? 'passed' : 'not passed'}` : ''}</li>`).join('');
  return `<p class="verdict-text" data-label="${esc(v.label)}"><strong>${esc(v.label)}</strong>. ${esc(VERDICT_TEXT[v.label] ?? '')}</p><p>${v.reasons.map(esc).join(' ')}</p><ul>${rows}</ul>`;
}

/** Median of a list as an integer (the mean of the two middle values, rounded down, for even counts), or null. */
export const medianOf = (xs: readonly number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.floor((s[m - 1] + s[m]) / 2);
};

export interface PanelStat { capturePpm: number | null; absErr1000: number | null; survivalPpm: number | null; extinct: number; blocks: number }
export function panelStat(blocks: BlockView[], schedule: string, strategy: string, placement: 'grouped' | 'dispersed'): PanelStat {
  const runs = blocks.map((b) => b.runs[schedule]?.[`${strategy}/${placement}`]).filter((r): r is RunView => !!r);
  const errs = runs.map((r) => r.readouts.absErr1000).filter((x): x is number => x !== null);
  return { capturePpm: medianOf(runs.map((r) => r.readouts.capturePpm)), absErr1000: medianOf(errs), survivalPpm: medianOf(runs.map((r) => r.readouts.survivalPpm)), extinct: runs.filter((r) => r.readouts.extinct).length, blocks: runs.length };
}

export function panelHtml(blocks: BlockView[], schedule: string, strategy: Strategy, revealed: boolean): string {
  const g = panelStat(blocks, schedule, strategy, 'grouped'), d = panelStat(blocks, schedule, strategy, 'dispersed');
  const row = (name: string, s: PanelStat) => `<tr><th scope="row">${name}</th><td>${pct(s.capturePpm)}</td><td>${cells(s.absErr1000)}</td><td>${pct(s.survivalPpm)}</td><td>${s.extinct} of ${s.blocks}</td></tr>`;
  const what = revealed ? `<p class="arm-what">${esc(NAMES[strategy].what)}</p>` : `<p class="arm-what">Name and wiring hidden until you reveal them.</p>`;
  return `<li class="arm" data-panel="${BLIND[strategy]}"><div class="arm-head"><strong>${esc(labelOf(strategy, revealed))}</strong></div>${what}<svg class="strip" id="strip-${BLIND[strategy]}" viewBox="0 0 320 120" role="img" aria-label="${esc(labelOf(strategy, revealed))}: distance of the bodies from the sun over time, grouped and dispersed"></svg><div class="scroll" tabindex="0" role="region" aria-label="Strategy numbers, scrolls sideways"><table><caption>Median over ${g.blocks} fresh blocks</caption><thead><tr><th scope="col">Placement</th><th scope="col">Light captured per input energy</th><th scope="col">Distance from sun (cells)</th><th scope="col">Biomass kept</th><th scope="col">Died out</th></tr></thead><tbody>${row('Grouped', g)}${row('Dispersed', d)}</tbody></table></div></li>`;
}

/** SVG polyline points for a strip series: x over the run, y = signed distance to the sun in cells (clamped to +-12). */
export function stripPoints(t: number[], d1000: number[], w = 320, h = 120): string {
  if (!t.length) return '';
  const t1 = t[t.length - 1] || 1;
  return t.map((tt, i) => `${((tt / t1) * w).toFixed(1)},${(h / 2 - (Math.max(-12000, Math.min(12000, d1000[i])) / 12000) * (h / 2 - 4)).toFixed(1)}`).join(' ');
}
export function stripSvg(ev: EvidenceView, schedule: string, strategy: Strategy, cursor: number): string {
  const strip = ev.fresh.blocks[0]?.strip;
  if (!strip) return '';
  const lines = (['grouped', 'dispersed'] as const).map((pl, k) => {
    const s = strip[`${schedule}/${strategy}/${pl}`];
    return s ? `<polyline fill="none" stroke="${k === 0 ? '#9fe4c4' : '#f2c978'}" stroke-width="1.6" points="${stripPoints(s.t, s.d1000)}"/>` : '';
  }).join('');
  const s0 = strip[`${schedule}/${strategy}/grouped`];
  const x = s0 ? ((s0.t[Math.min(cursor, s0.t.length - 1)] / (s0.t[s0.t.length - 1] || 1)) * 320).toFixed(1) : '0';
  return `<line x1="0" x2="320" y1="60" y2="60" stroke="#f2dfb7" stroke-dasharray="3 3" stroke-width="1"/>${lines}<line x1="${x}" x2="${x}" y1="0" y2="120" stroke="#8fa3a0" stroke-width="1"/>`;
}

export function coordFixturesHtml(ev: EvidenceView): string {
  return ev.fixtures.coordination.map((f) => {
    const avail = f.residual.filter((x): x is number => x !== null);
    const med = medianOf(avail);
    const naive = medianOf(f.naiveGroupedPpm.filter((x): x is number => x !== null));
    const unavailable = f.label === 'unavailable';
    return `<tr><th scope="row">${esc(f.id)} (${esc(f.schedule)})</th><td>${f.naiveReads ? 'collective motion' : 'no pattern'}${naive === null ? '' : ` (${pct(naive)} of pairs move the same way)`}</td><td>${unavailable || med === null ? 'unavailable' : `${fmt(med)} (floor ${fmt(f.floor)})`}</td><td>${esc(f.label)}</td><td>${unavailable ? 'unavailable' : f.rejected ? 'rejected' : 'detected'}</td></tr>`;
  }).join('');
}
export function physFixturesHtml(ev: EvidenceView): string {
  return ev.fixtures.physical.map((f) => `<tr><th scope="row">${esc(f.id)}</th><td>${f.naiveGroupVsDispersedPositive} of ${f.S.length} blocks grouped beats dispersed</td><td>${esc(f.verdict)}; difference-in-differences positive in ${f.B.filter((b) => b > 0).length} of ${f.B.length}</td><td>${f.rejected ? 'rejected' : 'passes'}</td><td>${esc(f.note)}</td></tr>`).join('');
}
export function contrastsHtml(ev: EvidenceView, schedule: string, revealed = false): string {
  const d = ev.fresh.decisions[schedule];
  if (!d) return '';
  const row = (name: string, s: SummaryView) => `<tr><th scope="row">${name}</th><td>${s.positives} of ${s.of}</td><td>${esc(s.p)}</td><td>${s.median2 === null ? 'n/a' : fmt(s.median2 / 2)}</td><td>${s.lower2 === null ? 'n/a' : fmt(s.lower2 / 2)}</td></tr>`;
  return `${row(`Grouped minus dispersed, ${esc(labelOf('sense', revealed))} (S)`, d.S)}${row(`...minus the same for ${esc(labelOf('sense-nosig', revealed))} (B)`, d.B)}${row(`...minus the same for ${esc(labelOf('drift', revealed))}`, d.Bdrift)}`;
}
export function criteriaHtml(ev: EvidenceView, schedule: string): string {
  const d = ev.fresh.decisions[schedule];
  return d ? d.criteria.map((c) => `<li>${c.pass ? 'Pass' : 'Not met'} (${esc(c.id)}): ${esc(c.detail)}</li>`).join('') : '';
}
export const listHtml = (xs: string[]): string => xs.map((l) => `<li>${esc(l)}</li>`).join('');
