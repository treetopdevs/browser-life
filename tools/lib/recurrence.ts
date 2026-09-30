// Recurrence readout (docs/plan.md, "Recurrence readout (fixed 2026-09-30, before computing)").
// Pure functions: windows, clades, events, bootstrap. No file or Deno APIs, so vitest can load it.
import { classify } from "@bl/metrics";

export const ROLES = ["phototroph", "chemotroph", "decomposer", "mixed"] as const;
export type Role = (typeof ROLES)[number];

/** The existing qualification (tools/foundations.ts `qualifying`): share >= 5% for consecutive deep censuses spanning >= 1e5 steps. */
export const SHARE_MIN = 0.05;
export const SPAN_MIN = 100_000;
/** A role that lost qualification for at least this long and returns is a return. */
export const GAP_MIN = 100_000;
/** Events are counted from windows that start at or after this step. */
export const AFTER = 200_000;
/** Steps of exposure after `AFTER` in a 10^6-step run, for per-10^5-step rates. */
export const EXPOSURE_1E5 = 8;

/** One deep census: role cells by root lineage (founder lineage the cells descend from) and living total. */
export interface Census {
  step: number;
  total: number;
  /** role -> root lineage key -> cells */
  byRole: Record<Role, Map<string, number>>;
  /** Cells in rows classed "mixed" whose photo, grow and decomp fluxes are all 0 (catalysing nothing in the snapshot). */
  inactiveMixed: number;
}

export interface Window {
  /** Indices into the census array, inclusive. */
  i: number;
  j: number;
  start: number;
  end: number;
  /** Clade label with the most role cells summed over the window (ties: smaller label). */
  holder: string;
}

export type EventKind = "return" | "replacement";
export interface PostFillEvent {
  role: Role;
  kind: EventKind;
  start: number;
  end: number;
  holder: string;
  gap: number;
  /** Mixed-role events only: inactive mixed cells / mixed cells over the window's censuses. */
  inactiveShare?: number | null;
}

export interface RunReadout {
  fills: { role: Role; start: number; end: number; holder: string; atStart: boolean; late: boolean }[];
  windows: Record<Role, { start: number; end: number; holder: string }[]>;
  /** Post-fill events at step >= AFTER. */
  events: PostFillEvent[];
  /** Windows k >= 2 that start before AFTER, of any kind including flickers (reported apart). */
  earlyReentries: number;
  returns: number;
  replacements: number;
  postFill: number;
  fillCount: number;
  lateFills: number;
  atStartFills: number;
  clades: number;
  /** Over all censuses: inactive mixed cells / mixed-role cells (null when there are no mixed cells). */
  mixedInactiveShare: number | null;
}

const roleCells = (c: Census, r: Role) => {
  let s = 0;
  for (const v of c.byRole[r].values()) s += v;
  return s;
};
export const share = (c: Census, r: Role) => (c.total ? roleCells(c, r) / c.total : 0);

/** Maximal runs of consecutive censuses with the role's share >= 5% spanning >= 1e5 steps. Index pairs, inclusive. */
export function windowsOf(dc: Census[], role: Role): [number, number][] {
  const out: [number, number][] = [];
  let start = -1;
  for (let i = 0; i <= dc.length; i++) {
    const ok = i < dc.length && share(dc[i], role) >= SHARE_MIN;
    if (ok && start < 0) start = i;
    if (!ok && start >= 0) {
      if (dc[i - 1].step - dc[start].step >= SPAN_MIN) out.push([start, i - 1]);
      start = -1;
    }
  }
  return out;
}

/** The clade with the most `role` cells summed over censuses i..j; `cladeOf` maps a root lineage key to a clade label. */
export function holderOf(dc: Census[], role: Role, i: number, j: number, cladeOf: (root: string) => string): string {
  const acc = new Map<string, number>();
  for (let k = i; k <= j; k++) for (const [root, cells] of dc[k].byRole[role]) acc.set(cladeOf(root), (acc.get(cladeOf(root)) ?? 0) + cells);
  let best = "", bestCells = -1;
  for (const [label, cells] of acc) if (cells > bestCells || (cells === bestCells && label < best)) [best, bestCells] = [label, cells];
  return best;
}

export function emptyCensus(step: number): Census {
  return { step, total: 0, byRole: { phototroph: new Map(), chemotroph: new Map(), decomposer: new Map(), mixed: new Map() }, inactiveMixed: 0 };
}

/** Deep-census cadence check: count, first and last step, and how many consecutive gaps differ from `every`. */
export function spacing(dc: Census[], every = 1000): { censuses: number; firstStep: number | null; lastStep: number | null; gaps: number } {
  let gaps = 0;
  for (let i = 1; i < dc.length; i++) if (dc[i].step - dc[i - 1].step !== every) gaps++;
  return { censuses: dc.length, firstStep: dc[0]?.step ?? null, lastStep: dc.at(-1)?.step ?? null, gaps };
}

/** Inactive mixed cells over mixed-role cells across censuses i..j (null when there are no mixed cells). */
function inactiveShareOver(dc: Census[], i: number, j: number): number | null {
  let inactive = 0, mixed = 0;
  for (let k = i; k <= j; k++) {
    inactive += dc[k].inactiveMixed;
    mixed += roleCells(dc[k], "mixed");
  }
  return mixed > 0 ? inactive / mixed : null;
}

/**
 * Deep censuses from profiles.tsv rows (grouped by step, as written), streamed.
 * `rootOf` maps a lineage key to the founder lineage it descends from.
 */
export async function censusesFrom(
  rows: AsyncIterable<{ step: string; lineage: string; cells: string; role: string; photo?: string; grow?: string; decomp?: string }>,
  rootOf: (lineage: string) => string,
  /** Replaces the stored `role` column when given; null counts the row's cells in `total` but in no role. */
  roleOf?: (r: { role: string; photo?: string; grow?: string; decomp?: string }) => Role | null,
): Promise<Census[]> {
  const out: Census[] = [];
  let cur: Census | null = null;
  for await (const r of rows) {
    const step = +r.step;
    if (cur && step < cur.step) throw new Error(`profiles.tsv rows out of order at step ${step} (after ${cur.step})`);
    if (!cur || cur.step !== step) {
      cur = emptyCensus(step);
      out.push(cur);
    }
    const cells = +r.cells;
    cur.total += cells;
    const role = roleOf ? roleOf(r) : r.role;
    if (role === "mixed" && r.photo === "0" && r.grow === "0" && r.decomp === "0") cur.inactiveMixed += cells;
    const m = role === null ? undefined : cur.byRole[role as Role];
    if (!m) continue;
    const root = rootOf(r.lineage);
    m.set(root, (m.get(root) ?? 0) + cells);
  }
  return out;
}

export type RoleVariant = "d0.5" | "d0.6" | "d0.7" | "d0.6-noinactive";
export const ROLE_VARIANTS: readonly RoleVariant[] = ["d0.5", "d0.6", "d0.7", "d0.6-noinactive"];
/** Role from a profiles.tsv row's fluxes under a variant; null = an inactive row excluded from roles. */
export function variantRole(v: RoleVariant): (r: { photo?: string; grow?: string; decomp?: string }) => Role | null {
  const d = v === "d0.5" ? 0.5 : v === "d0.7" ? 0.7 : 0.6;
  return (r) => {
    const p = +(r.photo ?? 0), g = +(r.grow ?? 0), dc = +(r.decomp ?? 0);
    if (v === "d0.6-noinactive" && p + g + dc === 0) return null;
    return classify(p, g, dc, d) as Role;
  };
}

/** Deep censuses from series.jsonl objects that carry `roles` (shares of living cells). One pseudo-root "all"; total 1. */
export function censusFromSeriesLine(o: { step: number; roles?: Record<string, number> }): Census | null {
  if (!o.roles) return null;
  const c = emptyCensus(o.step);
  c.total = 1;
  for (const r of ROLES) c.byRole[r].set("all", o.roles[r] ?? 0);
  return c;
}

/**
 * Fills and post-fill events of one run. `cladeOf` maps a root lineage key to a clade label
 * (clones from different discs share a label when their founder genomes are identical).
 */
export function readRun(dc: Census[], cladeOf: (root: string) => string): RunReadout {
  const fills: RunReadout["fills"] = [];
  const windows = { phototroph: [], chemotroph: [], decomposer: [], mixed: [] } as RunReadout["windows"];
  const events: PostFillEvent[] = [];
  let early = 0;
  const allClades = new Set<string>();
  for (const c of dc) for (const r of ROLES) for (const root of c.byRole[r].keys()) allClades.add(cladeOf(root));
  for (const role of ROLES) {
    const ws: Window[] = windowsOf(dc, role).map(([i, j]) => ({ i, j, start: dc[i].step, end: dc[j].step, holder: holderOf(dc, role, i, j, cladeOf) }));
    windows[role] = ws.map(({ start, end, holder }) => ({ start, end, holder }));
    const first = dc[0]?.step ?? 0;
    if (ws.length) fills.push({ role, start: ws[0].start, end: ws[0].end, holder: ws[0].holder, atStart: ws[0].start === first, late: ws[0].start >= AFTER });
    const held = new Set<string>(ws.length ? [ws[0].holder] : []);
    for (let k = 1; k < ws.length; k++) {
      const w = ws[k], gap = w.start - ws[k - 1].end;
      const kind: EventKind | null = gap >= GAP_MIN ? "return" : !held.has(w.holder) ? "replacement" : null;
      held.add(w.holder);
      if (w.start < AFTER) {
        early++;
        continue;
      }
      if (kind) {
        const ev: PostFillEvent = { role, kind, start: w.start, end: w.end, holder: w.holder, gap };
        if (role === "mixed") ev.inactiveShare = inactiveShareOver(dc, w.i, w.j);
        events.push(ev);
      }
    }
  }
  const returns = events.filter((e) => e.kind === "return").length;
  const replacements = events.length - returns;
  return {
    fills,
    windows,
    events,
    earlyReentries: early,
    returns,
    replacements,
    postFill: events.length,
    fillCount: fills.length,
    lateFills: fills.filter((f) => f.late).length,
    atStartFills: fills.filter((f) => f.atStart).length,
    clades: allClades.size,
    mixedInactiveShare: dc.length ? inactiveShareOver(dc, 0, dc.length - 1) : null,
  };
}

/** Returns per block of `block` steps (by window start), and the number starting at or after `late`. */
export function returnProfile(events: PostFillEvent[], block: number, nBlocks: number, late: number): { perBlock: number[]; late: number } {
  const perBlock = Array.from({ length: nBlocks }, () => 0);
  for (const e of events) if (e.kind === "return") perBlock[Math.min(nBlocks - 1, Math.floor(e.start / block))]++;
  return { perBlock, late: events.filter((e) => e.kind === "return" && e.start >= late).length };
}

// ---------------------------------------------------------------------------------------------
// Bootstrap (descriptive).

/** Deterministic PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}
export const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN);
function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}
const resampleMean = (xs: number[], r: () => number) => {
  let s = 0;
  for (let i = 0; i < xs.length; i++) s += xs[Math.floor(r() * xs.length)];
  return s / xs.length;
};
export interface Interval {
  n: number;
  mean: number;
  lo: number;
  hi: number;
}
/** Percentile bootstrap of the mean over runs, 90% by default (5th to 95th percentile). */
export function bootstrapMean(xs: number[], seed: number, reps = 5000, level = 0.9): Interval {
  if (!xs.length) return { n: 0, mean: NaN, lo: NaN, hi: NaN };
  const r = rng(seed), boots: number[] = [];
  for (let b = 0; b < reps; b++) boots.push(resampleMean(xs, r));
  boots.sort((p, q) => p - q);
  return { n: xs.length, mean: mean(xs), lo: quantile(boots, (1 - level) / 2), hi: quantile(boots, 1 - (1 - level) / 2) };
}
/** Difference of means, a minus b, runs resampled within each arm independently. */
export function bootstrapDiff(a: number[], b: number[], seed: number, reps = 5000, level = 0.9): Interval {
  if (!a.length || !b.length) return { n: a.length + b.length, mean: NaN, lo: NaN, hi: NaN };
  const r = rng(seed), boots: number[] = [];
  for (let k = 0; k < reps; k++) boots.push(resampleMean(a, r) - resampleMean(b, r));
  boots.sort((p, q) => p - q);
  return { n: a.length + b.length, mean: mean(a) - mean(b), lo: quantile(boots, (1 - level) / 2), hi: quantile(boots, 1 - (1 - level) / 2) };
}

/** (mutation - no-mutation) in `x` minus (mutation - no-mutation) in `y`, runs resampled within each of the four arms independently. */
export function bootstrapDiffInDiff(x: { mut: number[]; nm: number[] }, y: { mut: number[]; nm: number[] }, seed: number, reps = 5000, level = 0.9): Interval {
  const n = x.mut.length + x.nm.length + y.mut.length + y.nm.length;
  if (!x.mut.length || !x.nm.length || !y.mut.length || !y.nm.length) return { n, mean: NaN, lo: NaN, hi: NaN };
  const r = rng(seed), boots: number[] = [];
  for (let k = 0; k < reps; k++) boots.push(resampleMean(x.mut, r) - resampleMean(x.nm, r) - (resampleMean(y.mut, r) - resampleMean(y.nm, r)));
  boots.sort((p, q) => p - q);
  return { n, mean: mean(x.mut) - mean(x.nm) - (mean(y.mut) - mean(y.nm)), lo: quantile(boots, (1 - level) / 2), hi: quantile(boots, 1 - (1 - level) / 2) };
}

/**
 * Comparison (iii) as fixed: per founder, (B mutation - B no-mutation) - (solo mutation - solo no-mutation)
 * in one field (returns), averaged over founders; runs resampled within each of the four arms of each founder.
 */
export function bootstrapPairedDiffInDiff(
  groups: { x: { mut: number[]; nm: number[] }; y: { mut: number[]; nm: number[] } }[],
  seed: number,
  reps = 5000,
  level = 0.9,
): Interval {
  const ok = groups.filter((g) => g.x.mut.length && g.x.nm.length && g.y.mut.length && g.y.nm.length);
  if (!ok.length) return { n: 0, mean: NaN, lo: NaN, hi: NaN };
  const r = rng(seed), boots: number[] = [];
  const one = (g: (typeof ok)[number], f: (xs: number[]) => number) => f(g.x.mut) - f(g.x.nm) - (f(g.y.mut) - f(g.y.nm));
  for (let k = 0; k < reps; k++) boots.push(mean(ok.map((g) => one(g, (xs) => resampleMean(xs, r)))));
  boots.sort((p, q) => p - q);
  return { n: ok.length, mean: mean(ok.map((g) => one(g, mean))), lo: quantile(boots, (1 - level) / 2), hi: quantile(boots, 1 - (1 - level) / 2) };
}

/** The pre-stated reading on mutation minus no-mutation events per run. */
export function reading(diff: Interval): "one-shot" | "recurring" | "unclear" {
  if (!(diff.n > 0) || Number.isNaN(diff.mean)) return "unclear";
  if (diff.mean <= 0) return "one-shot";
  return diff.lo > 0 ? "recurring" : "unclear";
}

// ---------------------------------------------------------------------------------------------
// Grouping from the plans' seed layouts.

export interface RunId {
  experiment: string;
  seed: number;
  soloFounder?: number;
}
/** Group id and whether the run is in the mutation arm, from the seed layout of each plan; null if the seed is outside the layout. */
export function groupOf(r: RunId): { family: LegacyFamily; group: string; mutation: boolean } | null {
  const lay = (seed0: number) => ({ idx: Math.floor((r.seed - seed0) / 10), j: (r.seed - seed0) % 10 });
  if (r.experiment === "founders-x-b") {
    const { idx, j } = lay(4_720_001);
    return idx >= 0 && idx < 12 && j >= 0 && j < 8 ? { family: "B", group: `founder-${idx}`, mutation: j < 5 } : null;
  }
  if (r.experiment === "founders-x-c") {
    const { idx, j } = lay(4_740_001);
    const name = ["S1", "S2", "S4", "S5"][idx];
    return name && j >= 0 && j < 8 ? { family: "C", group: name, mutation: j < 5 } : null;
  }
  if (r.experiment === "solo") {
    const { idx, j } = lay(4_200_001);
    const k = r.soloFounder ?? idx;
    return k >= 0 && k < 12 && j >= 0 && j < 8 ? { family: "solo", group: `founder-${k}`, mutation: j < 5 } : null;
  }
  if (r.experiment === "founders-diag") {
    const { idx, j } = lay(4_210_001);
    return idx >= 0 && idx < 24 && j >= 0 && j < 8 ? { family: "diag", group: `subject-${idx}`, mutation: j < 5 } : null;
  }
  return null;
}

/** Bump when the per-run record gains fields or changes meaning; `summary` refuses other versions. */
export const RECURRENCE_RECORD_VERSION = 2;

/** The families of the founder-program readout (plan 003); the M4 readout adds "m4r" and "ext" (plan 004). */
export type LegacyFamily = "B" | "C" | "solo" | "diag";

export interface RunRecord {
  version: number;
  id: string;
  family: LegacyFamily | "m4r" | "ext";
  group: string;
  mutation: boolean;
  seed: number;
  extinct: boolean;
  steps: number;
  spacing: { censuses: number; firstStep: number | null; lastStep: number | null; gaps: number };
  readout: Omit<RunReadout, "windows">;
  windows: RunReadout["windows"];
  /** M4 readout only (runs-m4). */
  condition?: string;
  /** M4 readout only: a RoleVariant for replays, "shares" for the extension. */
  variant?: string;
  /** Extension only: returns per 10^6-step block and returns from window starts at or after 5e6. */
  profile?: { perBlock: number[]; late: number };
}

export interface Stratum {
  name: string;
  /** Predicate over run records. */
  has: (r: RunRecord) => boolean;
}

export interface StratumRow {
  stratum: string;
  mutation: { runs: number; fills: Interval; atStartFills: Interval; lateFills: Interval; postFill: Interval; returns: Interval; replacements: Interval; earlyReentries: Interval; runsWithEvent: number; extinct: number };
  noMutation: { runs: number; fills: Interval; atStartFills: Interval; lateFills: Interval; postFill: Interval; returns: Interval; replacements: Interval; earlyReentries: Interval; runsWithEvent: number; extinct: number };
  diffPostFill: Interval;
  diffReturns: Interval;
  diffLateFills: Interval;
  /** Per 10^5 steps (events per run / 8). */
  perE5: { mutation: number; noMutation: number };
  reading: "one-shot" | "recurring" | "unclear";
  /** The same reading with extinct runs dropped. */
  readingWithoutExtinct: "one-shot" | "recurring" | "unclear";
}

type Field = "fillCount" | "atStartFills" | "lateFills" | "postFill" | "returns" | "replacements" | "earlyReentries";
const col = (rs: RunRecord[], f: Field) => rs.map((r) => r.readout[f]);

export function summariseStratum(stratum: string, runs: RunRecord[], seed = 20260930): StratumRow {
  const arm = (rs: RunRecord[], s: number) => ({
    runs: rs.length,
    fills: bootstrapMean(col(rs, "fillCount"), s + 1),
    atStartFills: bootstrapMean(col(rs, "atStartFills"), s + 2),
    lateFills: bootstrapMean(col(rs, "lateFills"), s + 3),
    postFill: bootstrapMean(col(rs, "postFill"), s + 4),
    returns: bootstrapMean(col(rs, "returns"), s + 5),
    replacements: bootstrapMean(col(rs, "replacements"), s + 6),
    earlyReentries: bootstrapMean(col(rs, "earlyReentries"), s + 7),
    runsWithEvent: rs.filter((r) => r.readout.postFill > 0).length,
    extinct: rs.filter((r) => r.extinct).length,
  });
  const mut = runs.filter((r) => r.mutation), nm = runs.filter((r) => !r.mutation);
  const d = (f: Field, rs1 = mut, rs0 = nm, s = 100) => bootstrapDiff(col(rs1, f), col(rs0, f), seed + s);
  const diff = d("postFill", mut, nm, 10);
  const mutLive = mut.filter((r) => !r.extinct), nmLive = nm.filter((r) => !r.extinct);
  return {
    stratum,
    mutation: arm(mut, seed),
    noMutation: arm(nm, seed + 50),
    diffPostFill: diff,
    diffReturns: d("returns", mut, nm, 20),
    diffLateFills: d("lateFills", mut, nm, 30),
    perE5: { mutation: mean(col(mut, "postFill")) / EXPOSURE_1E5, noMutation: mean(col(nm, "postFill")) / EXPOSURE_1E5 },
    reading: reading(diff),
    readingWithoutExtinct: reading(d("postFill", mutLive, nmLive, 40)),
  };
}

/** The fixed rule's overall statement: the primary reading if every non-empty counting stratum agrees with it, otherwise "mixed". */
export function overallReading(
  primary: StratumRow,
  counting: StratumRow[],
): { reading: "one-shot" | "recurring" | "unclear" | "mixed"; disagree: string[]; empty: string[] } {
  const empty = counting.filter((s) => s.mutation.runs === 0 || s.noMutation.runs === 0).map((s) => s.stratum);
  const disagree = counting.filter((s) => !empty.includes(s.stratum) && s.reading !== primary.reading).map((s) => s.stratum);
  return { reading: disagree.length ? "mixed" : primary.reading, disagree, empty };
}


/** Expected groups per family; every group holds 5 mutation and 3 no-mutation runs (416 records in all). */
export const EXPECTED_GROUPS: Record<LegacyFamily, string[]> = {
  B: Array.from({ length: 12 }, (_, k) => `founder-${k}`),
  C: ["S1", "S2", "S4", "S5"],
  solo: Array.from({ length: 12 }, (_, k) => `founder-${k}`),
  diag: Array.from({ length: 24 }, (_, k) => `subject-${k}`),
};
export const EXPECTED_MUTATION_RUNS = 5;
export const EXPECTED_NO_MUTATION_RUNS = 3;
/** Deep censuses are every 1,000 steps from step 100; a run that survives ends at 999,100. */
export const FIRST_DEEP_STEP = 100;
export const LAST_DEEP_STEP = 999_100;

/** What stops `summary` from issuing a reading: missing, surplus or stale records, or a deep-census series with holes. Empty when complete. */
export function completenessProblems(recs: RunRecord[]): string[] {
  const problems: string[] = [];
  const count = new Map<string, { mut: number; nm: number }>();
  for (const r of recs) {
    const known = EXPECTED_GROUPS[r.family as LegacyFamily]?.includes(r.group);
    if (!known) problems.push(`${r.id}: unexpected group ${r.family}:${r.group}`);
    else {
      const c = count.get(`${r.family}:${r.group}`) ?? { mut: 0, nm: 0 };
      if (r.mutation) c.mut++;
      else c.nm++;
      count.set(`${r.family}:${r.group}`, c);
    }
    if (r.version !== RECURRENCE_RECORD_VERSION) problems.push(`${r.id}: record version ${r.version} (want ${RECURRENCE_RECORD_VERSION})`);
    const sp = r.spacing;
    if (!sp) {
      problems.push(`${r.id}: no spacing`);
      continue;
    }
    if (sp.gaps !== 0) problems.push(`${r.id}: ${sp.gaps} deep-census gaps`);
    if (sp.firstStep !== FIRST_DEEP_STEP) problems.push(`${r.id}: first deep census at step ${sp.firstStep} (want ${FIRST_DEEP_STEP})`);
    if (sp.lastStep !== LAST_DEEP_STEP && !r.extinct) problems.push(`${r.id}: last deep census at step ${sp.lastStep} and not extinct (want ${LAST_DEEP_STEP})`);
  }
  for (const [family, groups] of Object.entries(EXPECTED_GROUPS)) {
    for (const g of groups) {
      const c = count.get(`${family}:${g}`) ?? { mut: 0, nm: 0 };
      if (c.mut !== EXPECTED_MUTATION_RUNS || c.nm !== EXPECTED_NO_MUTATION_RUNS) {
        problems.push(`${family}:${g}: ${c.mut} mutation and ${c.nm} no-mutation runs (want ${EXPECTED_MUTATION_RUNS} and ${EXPECTED_NO_MUTATION_RUNS})`);
      }
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------------------------
// The registered worlds (plan 004): M4 replays and the 10^7 extension.

/** Runs per condition of `runs/replay-m4/gradient-m3` (seeds 1..n); the extension has EXT_RUNS per condition (seeds 101..105). */
export const M4_RUNS: Record<string, number> = { treatment: 10, "no-mutation": 5, neutral: 20 };
export const EXT_SEED0 = 101;
export const EXT_RUNS = 5;
export const M4_STEPS = 1_000_000;
export const EXT_STEPS = 10_000_000;
export const M4_LAST_DEEP_STEP = 999_100;
export const EXT_LAST_DEEP_STEP = 9_999_100;
/** Post-fill exposure of a 10^7-step run, in units of 10^5 steps ((1e7 - AFTER) / 1e5); `perE5` assumes 10^6-step runs and is not used for the extension. */
export const EXT_EXPOSURE_1E5 = 98;

/** What stops `summary-m4` from issuing a reading: missing, surplus or stale records, wrong horizons, or deep-census series with holes. Empty when complete. */
export function m4CompletenessProblems(recs: RunRecord[]): string[] {
  const problems: string[] = [];
  const seen = new Map<string, number[]>();
  for (const r of recs) {
    if (r.family !== "m4r" && r.family !== "ext") {
      problems.push(`${r.id}: unexpected family ${r.family}`);
      continue;
    }
    const ext = r.family === "ext";
    const cond = r.condition ?? "";
    if (!(cond in M4_RUNS)) {
      problems.push(`${r.id}: unexpected condition '${cond}'`);
      continue;
    }
    const variant = r.variant ?? "";
    if (ext ? variant !== "shares" : !(ROLE_VARIANTS as readonly string[]).includes(variant)) {
      problems.push(`${r.id}: unexpected variant '${variant}'`);
      continue;
    }
    if (r.group !== cond || r.mutation !== (cond === "treatment")) problems.push(`${r.id}: group/mutation do not match condition ${cond}`);
    if (r.version !== RECURRENCE_RECORD_VERSION) problems.push(`${r.id}: record version ${r.version} (want ${RECURRENCE_RECORD_VERSION})`);
    if (r.steps !== (ext ? EXT_STEPS : M4_STEPS)) problems.push(`${r.id}: ${r.steps} steps (want ${ext ? EXT_STEPS : M4_STEPS})`);
    const sp = r.spacing;
    if (!sp) problems.push(`${r.id}: no spacing`);
    else {
      if (sp.gaps !== 0) problems.push(`${r.id}: ${sp.gaps} deep-census gaps`);
      if (sp.firstStep !== FIRST_DEEP_STEP) problems.push(`${r.id}: first deep census at step ${sp.firstStep} (want ${FIRST_DEEP_STEP})`);
      const last = ext ? EXT_LAST_DEEP_STEP : M4_LAST_DEEP_STEP;
      if (sp.lastStep !== last && !r.extinct) problems.push(`${r.id}: last deep census at step ${sp.lastStep} and not extinct (want ${last})`);
    }
    if (ext && !(r.profile && r.profile.perBlock.length === 10)) problems.push(`${r.id}: no 10-block return profile`);
    const key = `${r.family}:${cond}:${variant}`;
    seen.set(key, [...(seen.get(key) ?? []), r.seed]);
  }
  const want = (key: string, seeds: number[]) => {
    const got = (seen.get(key) ?? []).slice().sort((p, q) => p - q);
    if (got.length !== seeds.length || got.some((s, i) => s !== seeds[i])) problems.push(`${key}: seeds [${got.join(",")}] (want ${seeds[0]}..${seeds.at(-1)})`);
  };
  for (const [cond, n] of Object.entries(M4_RUNS)) {
    for (const v of ROLE_VARIANTS) want(`m4r:${cond}:${v}`, Array.from({ length: n }, (_, i) => i + 1));
    want(`ext:${cond}:shares`, Array.from({ length: EXT_RUNS }, (_, i) => EXT_SEED0 + i));
  }
  return problems;
}

/** The extension's statement, worded as fixed in docs/plan.md ("Recurrence on the registered worlds"). */
export function extStatement(extReading: "one-shot" | "recurring" | "unclear", nullReading: "one-shot" | "recurring" | "unclear"): string {
  if (extReading === "one-shot") return "no excess role returns over no-mutation at 10⁷ in the registered world";
  if (extReading === "recurring") return nullReading === "recurring" ? "recurring but not specific (neutral also recurs)" : "excess role returns at 10⁷ (specific)";
  return "unclear";
}

/**
 * Post-fill events by role over a set of run records (optionally only one kind): the total per role and the count per run
 * (in seed order). Descriptive context; it never feeds a reading.
 */
export function eventsByRole(rs: RunRecord[], kind?: EventKind): { total: Record<Role, number>; perRun: ({ seed: number } & Record<Role, number>)[] } {
  const zero = (): Record<Role, number> => ({ phototroph: 0, chemotroph: 0, decomposer: 0, mixed: 0 });
  const total = zero();
  const perRun = [...rs]
    .sort((p, q) => p.seed - q.seed)
    .map((r) => {
      const c = zero();
      for (const e of r.readout.events) if (!kind || e.kind === kind) c[e.role]++;
      for (const role of ROLES) total[role] += c[role];
      return { seed: r.seed, ...c };
    });
  return { total, perRun };
}

/**
 * The record with every post-fill event of `role` removed; returns, replacements and postFill are recomputed from the remaining
 * events (fills, windows and the rest are untouched). For post hoc context only; the input is not modified.
 */
export function withoutRoleEvents(r: RunRecord, role: Role): RunRecord {
  const events = r.readout.events.filter((e) => e.role !== role);
  const returns = events.filter((e) => e.kind === "return").length;
  return { ...r, readout: { ...r.readout, events, returns, replacements: events.length - returns, postFill: events.length } };
}
