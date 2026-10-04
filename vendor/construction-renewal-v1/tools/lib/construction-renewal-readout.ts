// Pure endpoint, selection and confirmation decisions for the renewal
// experiment (RENEWAL-PLAN.md sections 5 and 6), computed from persisted
// census records only. The independent audit in
// tools/construction-renewal-verify.ts must not import this module.

export const RENEWAL_READOUT_VERSION = "construction-renewal-readout-v1";

export interface Thresholds {
  V: number;
  Qmin: number;
  Rmin: number;
  censusEvery: number;
  mainWindow: { from: number; to: number };
  controlWindow: { from: number; to: number };
  censusesPerWindow: number;
}

/** The fields of a persisted census line the readout uses. */
export interface CensusLine {
  step: number;
  cells: { B: number[] };
  cumulative: { photo: number[]; grow: number[]; reactB: number[]; boundBIn: number[]; boundBOut: number[] };
  totals: { A: string; B: string };
  flux: Record<string, string>;
  lightIn: string;
  activeBArea: string;
}

export interface CaseInfo {
  id: string;
  phase: "controls" | "pilot" | "confirmation";
  kind: "capacity" | "division" | "small-founder" | "main";
  arm: string;
  seed: number;
  reservoir: number;
  spread: number;
  horizon: number;
  sourceSites: number[];
}

export type Maintenance =
  | { status: "ok"; site: number; maintained: boolean; minB: number; Q: number; R: number; censuses: number }
  | { status: "incomplete"; site: number; reason: string };

function indexByStep(records: CensusLine[]): Map<number, CensusLine> {
  const m = new Map<number, CensusLine>();
  for (const r of records) {
    if (m.has(r.step)) throw new Error(`duplicate census at step ${r.step}`);
    m.set(r.step, r);
  }
  return m;
}

/** maintained(i, a, b): B_i >= V at every census a..b, Q_i(a,b) >= Qmin, R_i(a,b) >= Rmin. */
export function maintenance(byStep: Map<number, CensusLine>, site: number, from: number, to: number, th: Thresholds): Maintenance {
  const steps: number[] = [];
  for (let s = from; s <= to; s += th.censusEvery) steps.push(s);
  if (steps.length !== th.censusesPerWindow) return { status: "incomplete", site, reason: "window does not have the fixed census count" };
  let minB = Infinity;
  for (const s of steps) {
    const r = byStep.get(s);
    if (!r) return { status: "incomplete", site, reason: `missing census at step ${s}` };
    const B = r.cells.B[site];
    if (!Number.isInteger(B)) return { status: "incomplete", site, reason: `no B at site ${site}, step ${s}` };
    minB = Math.min(minB, B);
  }
  const a = byStep.get(from)!, b = byStep.get(to)!;
  const Q = b.cumulative.photo[site] + b.cumulative.grow[site] - a.cumulative.photo[site] - a.cumulative.grow[site];
  const R = b.cumulative.reactB[site] - a.cumulative.reactB[site];
  if (!Number.isSafeInteger(Q) || !Number.isSafeInteger(R)) return { status: "incomplete", site, reason: "non-integer Q or R" };
  return { status: "ok", site, maintained: minB >= th.V && Q >= th.Qmin && R >= th.Rmin, minB, Q, R, censuses: steps.length };
}

export interface Secondary {
  finalActiveB: number;
  activeBArea: string;
  finalSourceB: number[];
  lateMinSourceB: number[];
  supportExtentFinal: number;
  supportExtentAtV: number;
  sourceWindow: { Q: number; R: number; netBoundBImport: number }[];
  buildExpenditureB: string;
  reservoirDepletionA: string;
  harvestedLight: string;
  flux: Record<string, string>;
}

export type CaseReadout =
  | { id: string; status: "incomplete"; reason: string }
  | {
    id: string;
    status: "complete";
    kind: CaseInfo["kind"];
    extinct: boolean;
    /** Main and confirmation cases. */
    renew?: boolean;
    sourceMaintenance?: Maintenance;
    qualifyingSites?: number[];
    /** Capacity and division controls: both sites persist (B and Q); R reported per site. */
    bothSitesPersist?: boolean;
    controlSites?: Maintenance[];
    /** Small-founder probes: any one same site maintained, initial site included. */
    anySiteMaintained?: boolean;
    maintainedSites?: number[];
    secondary: Secondary;
  };

export function readCase(info: CaseInfo, records: CensusLine[], th: Thresholds, initialA: string): CaseReadout {
  let byStep: Map<number, CensusLine>;
  try {
    byStep = indexByStep(records);
  } catch (e) {
    return { id: info.id, status: "incomplete", reason: (e as Error).message };
  }
  for (let s = 0; s <= info.horizon; s += th.censusEvery) {
    if (!byStep.has(s)) return { id: info.id, status: "incomplete", reason: `missing census at step ${s}` };
  }
  if (byStep.size !== info.horizon / th.censusEvery + 1) return { id: info.id, status: "incomplete", reason: "unexpected census steps" };
  const last = byStep.get(info.horizon)!;
  const n = last.cells.B.length;
  const finalActiveB = last.cells.B.reduce((s, v) => s + v, 0);
  const late = info.kind === "capacity" || info.kind === "division" ? th.controlWindow : th.mainWindow;
  const secondary: Secondary = {
    finalActiveB,
    activeBArea: last.activeBArea,
    finalSourceB: info.sourceSites.map((s) => last.cells.B[s]),
    lateMinSourceB: info.sourceSites.map((s) => {
      let m = Infinity;
      for (let t = late.from; t <= late.to; t += th.censusEvery) m = Math.min(m, byStep.get(t)!.cells.B[s]);
      return m;
    }),
    supportExtentFinal: last.cells.B.filter((v) => v > 0).length,
    supportExtentAtV: last.cells.B.filter((v) => v >= th.V).length,
    sourceWindow: info.sourceSites.map((s) => {
      const a = byStep.get(late.from)!, b = byStep.get(late.to)!;
      return {
        Q: b.cumulative.photo[s] + b.cumulative.grow[s] - a.cumulative.photo[s] - a.cumulative.grow[s],
        R: b.cumulative.reactB[s] - a.cumulative.reactB[s],
        netBoundBImport: (b.cumulative.boundBIn[s] - b.cumulative.boundBOut[s]) - (a.cumulative.boundBIn[s] - a.cumulative.boundBOut[s]),
      };
    }),
    buildExpenditureB: last.flux.build,
    reservoirDepletionA: (BigInt(initialA) - BigInt(last.totals.A)).toString(),
    harvestedLight: last.lightIn,
    flux: last.flux,
  };
  const base = { id: info.id, status: "complete" as const, kind: info.kind, extinct: finalActiveB === 0, secondary };
  if (info.kind === "main") {
    const w = th.mainWindow, source = info.sourceSites[0];
    const src = maintenance(byStep, source, w.from, w.to, th);
    if (src.status === "incomplete") return { id: info.id, status: "incomplete", reason: src.reason };
    const qualifying: number[] = [];
    for (let j = 0; j < n; j++) {
      if (j === source) continue;
      const m = maintenance(byStep, j, w.from, w.to, th);
      if (m.status === "incomplete") return { id: info.id, status: "incomplete", reason: m.reason };
      if (m.maintained) qualifying.push(j);
    }
    return { ...base, renew: src.maintained && qualifying.length > 0, sourceMaintenance: src, qualifyingSites: qualifying };
  }
  if (info.kind === "capacity" || info.kind === "division") {
    const w = th.controlWindow;
    const sites = info.sourceSites.map((s) => maintenance(byStep, s, w.from, w.to, th));
    const bad = sites.find((m) => m.status === "incomplete");
    if (bad && bad.status === "incomplete") return { id: info.id, status: "incomplete", reason: bad.reason };
    const persist = sites.every((m) => m.status === "ok" && m.minB >= th.V && m.Q >= th.Qmin);
    return { ...base, bothSitesPersist: persist, controlSites: sites };
  }
  const w = th.mainWindow, maintainedSites: number[] = [];
  for (let j = 0; j < n; j++) {
    const m = maintenance(byStep, j, w.from, w.to, th);
    if (m.status === "incomplete") return { id: info.id, status: "incomplete", reason: m.reason };
    if (m.maintained) maintainedSites.push(j);
  }
  return { ...base, anySiteMaintained: maintainedSites.length > 0, maintainedSites };
}

export interface HabitatKey {
  reservoir: number;
  spread: number;
}

export type Selection =
  | { status: "incomplete"; reason: string }
  | { status: "selected"; habitat: HabitatKey; eligible: HabitatKey[] }
  | { status: "none-eligible"; eligible: [] };

/**
 * Candidate selection (plan section 6). All 40 pilot/control cases must be
 * complete. A spread-1 or spread-2 pilot habitat is eligible when at least one
 * of its four arms has RENEW=true; the first eligible habitat in the frozen
 * order is selected.
 */
export function selectHabitat(
  all: { info: CaseInfo; readout: CaseReadout }[],
  order: HabitatKey[],
  eligibleSpreads: number[],
  expectedCases: number,
): Selection {
  if (all.length !== expectedCases) return { status: "incomplete", reason: `${all.length} of ${expectedCases} cases read` };
  const incomplete = all.find((c) => c.readout.status !== "complete");
  if (incomplete) return { status: "incomplete", reason: `case ${incomplete.info.id} is incomplete` };
  const eligible: HabitatKey[] = [];
  for (const h of order) {
    if (!eligibleSpreads.includes(h.spread)) continue;
    const arms = all.filter((c) => c.info.phase === "pilot" && c.info.reservoir === h.reservoir && c.info.spread === h.spread);
    if (arms.length !== 4) return { status: "incomplete", reason: `habitat A${h.reservoir}/s${h.spread} has ${arms.length} arms` };
    if (arms.some((c) => c.readout.status === "complete" && c.readout.renew === true)) eligible.push(h);
  }
  if (!eligible.length) return { status: "none-eligible", eligible: [] };
  return { status: "selected", habitat: eligible[0], eligible };
}

export interface ConfirmationRow {
  arm: string;
  seed: number;
  readout: CaseReadout;
}

export type Confirmation =
  | { status: "incomplete"; reason: string }
  | {
    status: "complete";
    matrix: Record<string, Record<string, boolean>>;
    counts: Record<string, number>;
    confirmedArms: string[];
    confirmed: boolean;
    specificBlocks: number[];
    constructionSpecific: boolean;
  };

/**
 * Confirmation decisions (plan section 6). Confirmed: one same arm has RENEW
 * in at least `required` of its blocks. Construction-specific: in at least
 * `required` blocks the builder renews, the other three do not, and builder
 * and ablation both recorded positive BUILD expenditure.
 */
export function confirmationDecision(rows: ConfirmationRow[], arms: string[], seeds: number[], required: number): Confirmation {
  if (rows.length !== arms.length * seeds.length) return { status: "incomplete", reason: `${rows.length} of ${arms.length * seeds.length} cases` };
  const matrix: Record<string, Record<string, boolean>> = {};
  const build: Record<string, Record<string, bigint>> = {};
  for (const arm of arms) {
    matrix[arm] = {};
    build[arm] = {};
  }
  for (const r of rows) {
    if (!(r.arm in matrix)) return { status: "incomplete", reason: `unexpected arm ${r.arm}` };
    if (!seeds.includes(r.seed)) return { status: "incomplete", reason: `unexpected seed ${r.seed}` };
    if (r.readout.status !== "complete" || r.readout.renew === undefined) return { status: "incomplete", reason: `case ${r.readout.id} is incomplete` };
    if (String(r.seed) in matrix[r.arm]) return { status: "incomplete", reason: `duplicate ${r.arm}/${r.seed}` };
    matrix[r.arm][String(r.seed)] = r.readout.renew;
    build[r.arm][String(r.seed)] = BigInt(r.readout.secondary.buildExpenditureB);
  }
  const counts = Object.fromEntries(arms.map((a) => [a, seeds.filter((s) => matrix[a][String(s)]).length]));
  const confirmedArms = arms.filter((a) => counts[a] >= required);
  const specificBlocks = seeds.filter((s) => {
    const k = String(s);
    return matrix.builder?.[k] === true &&
      arms.filter((a) => a !== "builder").every((a) => matrix[a][k] === false) &&
      (build.builder?.[k] ?? 0n) > 0n && (build.ablation?.[k] ?? 0n) > 0n;
  });
  return {
    status: "complete",
    matrix,
    counts,
    confirmedArms,
    confirmed: confirmedArms.length > 0,
    specificBlocks,
    constructionSpecific: specificBlocks.length >= required,
  };
}
