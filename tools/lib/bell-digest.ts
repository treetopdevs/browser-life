// The anomaly bell v1, part C's tooling (docs/naturalist-bell-v1-plan-2026-10-17.md, "Fixed before running", section C, "Part b,
// redesigned on the twins"; that section is frozen and this file implements it, it does not amend it). Pure functions over census
// streams and strings; no Deno or filesystem access, so vitest can load it. The CLI is tools/bell-digest.ts. No model call is made
// here: this builds the frozen items and scores whatever answers come back.
//
// The manifest. 100 items, in the note's enumeration order: T1 first (seeds 1 to 10, each with arms nudge, l64, l96, f: 40 items),
// then T2 (the same 40 twins in the same order, then nudge2 for seeds 1 to 10, then the 10 bases: 60 items). One mulberry32 stream
// (`rng` of tools/lib/measures6.ts) seeded at 6,100,001 is consumed in item order: first U = 5,000 + 200 * floor(rng() * 51), then,
// in T1 only, the orientation coin. THE COIN: `rng() < 0.5` means X is the twin (Y the base); otherwise X is the base. T2 draws no
// coin. Item ids are ordinal (t1-01 ... t1-40, t2-01 ... t2-60), so a file name never carries a seed or an arm.
//
// The digest. 151 lines for the 30,000-step window starting at step S - U, one per 200 steps, steps relative to the window start
// (t = U is the census at S, before the intervention; t = U + 200 the first line after it). Thirteen fields per line, the signals of
// tools/lib/bell.ts in its order; the four counters are shown as C(t) - C(t - 1,000) from the run's own history (SignalExtractor's
// rate over RATE_LAG = 10 censuses of 100 steps, which is 1,000 steps, history from before the window included). Number format,
// value by value: an integer prints as an integer, any other value to 3 decimals ("-0.000" prints "0.000"). Never shown: run ids,
// seeds, conditions, interventions, absolute steps. In T2 every value is followed by (q25/median/q75) of the nine other treatment
// bases at that step, the item's own seed left out (quantiles as v0: linear interpolation at (n-1)q).
//
// What a void twin does. Its items keep their draws (so no other item's U shifts), carry `void` in the manifest and have no digest;
// a task is not called if any of its scored items is void.
//
// The code baselines (scored beside the model, never pooled). T2: native 100-step censuses on absolute steps, the eleven signals of
// v1's envelope bell (the thirteen of v0 without maxGeneration and dominantShare), z against the nine other bases at each census,
// W = 10 censuses, only windows whose ten censuses all lie inside the item's window (inclusive; the last start is the window's
// end - 900), D_T2 = the largest windowed minimum of side * z (floored at 0) over signals and sides, Z_T2 = the largest D_T2 among
// the base items, a ring is D_T2 > Z_T2 (strict), its t is the first census of the earliest window whose minimum exceeds Z_T2
// (relative, floored to a multiple of 200), its kind is "removal" if livingCells z is negative at that census, else "addition".
// T1: detection only, D_pair > Z*_pair, read from the twin record (readPairRecord).
import { binomialLowerBound } from "@bl/metrics";
import { ARMS, S as S_PLAN, STEPS as STEPS_PLAN, type Arm } from "./bell-v1-jobs.ts";
import { BELL1_VERSION, EARLY_FROM, EARLY_TO, NOTE1_PATH, W_PAIR } from "./bell1.ts";
import { SIGNALS, SignalExtractor, departure, finiteOrZero } from "./bell.ts";
import { quantileSorted, rng } from "./measures6.ts";

export const DIGEST_VERSION = 1;
export const NOTE_PATH = "docs/naturalist-bell-v1-plan-2026-10-17.md";

// ---------------------------------------------------------------------------------------------
// Fixed parameters (the note).

export const MANIFEST_SEED = 6_100_001;
/** Seeds the shuffle that gives items their public ids (apart from MANIFEST_SEED's stream, which it never touches). */
export const ID_SEED = 6_100_002;
export const S = S_PLAN;
export const STEPS = STEPS_PLAN;
export const CENSUS_EVERY = 100;
export const LINE_EVERY = 200;
export const WINDOW_STEPS = 30_000;
export const U_MIN = 5_000;
export const U_COUNT = 51;
export const U_STEP = 200;
export const W_T2 = 10;
/** A hit in T2 (and the code baseline's) needs |t - U| at most this. */
export const HIT_TOLERANCE = 1_000;
export const DEFAULT_SEEDS: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
export const T1_ARMS: readonly Arm[] = ["nudge", "l64", "l96", "f"];
/** Bars (the note's table). */
export const BARS = {
  T1: { positives: 20, hitsAtLeast: 16, negatives: 10, falseAlarmsAtMost: 2 },
  T2: { positives: 20, hitsAtLeast: 16, negatives: 30, falseAlarmsAtMost: 3 },
} as const;

export type Task = "T1" | "T2";
export type ItemArm = Arm | "base";
/** Digest column names, aligned with SIGNALS. */
export const DIGEST_FIELDS = [
  "living_cells", "individuals", "mean_mass", "lineages", "lineage_shannon", "pattern_entropy", "biotic_recycling",
  "max_generation", "dominant_share", "fissions_1000", "fusions_1000", "buddings_1000", "mutations_1000",
] as const;
if (DIGEST_FIELDS.length !== SIGNALS.length) throw new Error("DIGEST_FIELDS and SIGNALS disagree");
/** The eleven signals of v1's envelope bell: v0's thirteen without maxGeneration and dominantShare. */
export const V1_SIGNALS: readonly { index: number; name: string; floor: number }[] = SIGNALS.flatMap((d, index) =>
  d.name === "maxGeneration" || d.name === "dominantShare" ? [] : [{ index, name: d.name, floor: d.floor }]);
const LIVING_INDEX = SIGNALS.findIndex((d) => d.name === "livingCells");

// ---------------------------------------------------------------------------------------------
// Items.

export interface PlannedItem {
  id: string;
  task: Task;
  seed: number;
  arm: ItemArm;
  /** Steps before S at which the window starts. */
  U: number;
  /** T1 only. */
  orientation?: "X=twin" | "X=base";
}

/** The note's 100 items with their draws. `seeds` and `manifestSeed` are for tests and the pilot; the defaults are the note's. */
export function planItems(opts: { manifestSeed?: number; idSeed?: number; seeds?: readonly number[] } = {}): PlannedItem[] {
  const r = rng(opts.manifestSeed ?? MANIFEST_SEED);
  const seeds = opts.seeds ?? DEFAULT_SEEDS;
  const specs: { task: Task; seed: number; arm: ItemArm }[] = [];
  for (const seed of seeds) for (const arm of T1_ARMS) specs.push({ task: "T1", seed, arm });
  for (const seed of seeds) for (const arm of T1_ARMS) specs.push({ task: "T2", seed, arm });
  for (const seed of seeds) specs.push({ task: "T2", seed, arm: "nudge2" });
  for (const seed of seeds) specs.push({ task: "T2", seed, arm: "base" });
  // The draws, in item order. The public id is assigned afterwards, so the draws are the note's and no draw depends on an id.
  const drawn = specs.map((s) => {
    const U = U_MIN + U_STEP * Math.floor(r() * U_COUNT);
    const item: Omit<PlannedItem, "id"> = { ...s, U };
    if (s.task === "T1") item.orientation = r() < 0.5 ? "X=twin" : "X=base";
    return item;
  });
  // Public ids: per task, the numbers 1..n dealt out by a Fisher-Yates shuffle of their own stream (T1 first, then T2).
  const ids = rng(opts.idSeed ?? ID_SEED);
  const numbers: Record<Task, number[]> = { T1: [], T2: [] };
  for (const task of ["T1", "T2"] as const) {
    const n = drawn.filter((d) => d.task === task).length;
    const deck = Array.from({ length: n }, (_, i) => i + 1);
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(ids() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    numbers[task] = deck;
  }
  const taken: Record<Task, number> = { T1: 0, T2: 0 };
  return drawn.map((d) => ({ id: `${d.task.toLowerCase()}-${String(numbers[d.task][taken[d.task]++]).padStart(2, "0")}`, ...d }));
}

/** The label (X or Y) the twin carries in a T1 item. */
export const twinLabel = (item: Pick<PlannedItem, "orientation">): "X" | "Y" | null => (item.orientation === "X=twin" ? "X" : item.orientation === "X=base" ? "Y" : null);

// ---------------------------------------------------------------------------------------------
// Runs and layouts.

export type RunRef = { kind: "base"; seed: number } | { kind: "twin"; arm: Arm; seed: number };
export const refKey = (r: RunRef): string => (r.kind === "base" ? `base:${r.seed}` : `twin:${r.arm}:${r.seed}`);
/** The run an item's digest is read from. */
export const itemRun = (it: Pick<PlannedItem, "arm" | "seed">): RunRef => (it.arm === "base" ? { kind: "base", seed: it.seed } : { kind: "twin", arm: it.arm, seed: it.seed });

export interface DigestLayout {
  mode: "production" | "pilot";
  S: number;
  windowSteps: number;
  /** Steps in every run. */
  steps: number;
  seeds: readonly number[];
  /** The runs whose values make the stated normal (and the code baseline's reference) for an item: the item's own seed is never among them. */
  refsOf(item: Pick<PlannedItem, "seed" | "arm">): RunRef[];
}
/** The note's layout: S = 200,000, 30,000-step windows, 300,000-step runs, the references are the other nine bases. */
export function productionLayout(): DigestLayout {
  return {
    mode: "production",
    S,
    windowSteps: WINDOW_STEPS,
    steps: STEPS,
    seeds: DEFAULT_SEEDS,
    refsOf: (it) => DEFAULT_SEEDS.filter((s) => s !== it.seed).map((seed) => ({ kind: "base", seed })),
  };
}
/**
 * TEST ONLY: the design-pilot bundles (gradient-m3 neutral seed 2001, 50,000 steps; lesion r32, l64, l96 and feed twins of one
 * base). S = 30,000 and a 20,000-step window, because a 30,000-step window overflows 50,000 steps for U below 10,000. It checks
 * plumbing: the references are the other pilot runs (not nine bases), and nudge and nudge2 both stand on the r32 lesion.
 */
export function pilotLayout(): DigestLayout {
  const all: RunRef[] = [{ kind: "base", seed: 2001 }, ...(["nudge", "l64", "l96", "f"] as const).map((arm) => ({ kind: "twin" as const, arm, seed: 2001 }))];
  return {
    mode: "pilot",
    S: 30_000,
    windowSteps: 20_000,
    steps: 50_000,
    seeds: [2001],
    refsOf: (it) => all.filter((r) => refKey(r) !== refKey(itemRun(it))),
  };
}

export const windowStart = (layout: Pick<DigestLayout, "S">, item: Pick<PlannedItem, "U">): number => layout.S - item.U;
export const linesIn = (windowSteps: number): number => windowSteps / LINE_EVERY + 1;

// ---------------------------------------------------------------------------------------------
// Run tables: the 13 signals at every census of a window range, built from a stream with the strict census checks.

export type RunTable = Map<number, (number | null)[]>;

/** Why a census fails the strict checks of the note (finite livingCells and lineages; the lineage rows match them exactly), or null. */
export function censusProblem(rec: Record<string, unknown>, rows: readonly (readonly [string, number])[]): string | null {
  const lc = rec.livingCells, ln = rec.lineages;
  if (typeof lc !== "number" || !Number.isFinite(lc)) return `livingCells is ${JSON.stringify(lc ?? null)}, not a finite number`;
  if (typeof ln !== "number" || !Number.isFinite(ln)) return `lineages is ${JSON.stringify(ln ?? null)}, not a finite number`;
  let cells = 0;
  for (const [, c] of rows) cells += c;
  if (cells !== lc) return `lineage rows sum to ${cells} cells, livingCells is ${lc}`;
  if (rows.length !== ln) return `${rows.length} lineage rows, lineages is ${ln}`;
  return null;
}

/**
 * Reads a run (every census up to `steps`, so the strict checks cover the whole horizon) and keeps the signal vectors at the
 * censuses from `lo` to `hi` inclusive. `merged` is mergeCensuses output. Throws naming the run on a gap, a repeated census, a
 * failed strict check, or a run shorter than `steps`. A twin is exactly `steps` long (a longer stream throws); a BASE may be
 * longer (the replay-m4 treatment bases are 1,000,000-step bundles cut at the horizon): with `truncate` the read stops after the
 * census at `steps`, nothing later is checked, and the stream is closed (mergeCensuses closes its lineage iterator on exit). To
 * keep mergeCensuses from reading past the horizon (it asks for the next lineage census before it yields one), a base's streams
 * are cut at the horizon before they are merged: seriesThrough and lineageBlocksThrough.
 */
export async function loadTable(
  runId: string,
  merged: AsyncIterable<{ rec: Record<string, unknown> & { step: number }; rows: [string, number][] }>,
  o: { lo: number; hi: number; steps: number; cadence?: number; truncate?: boolean },
): Promise<RunTable> {
  const cadence = o.cadence ?? CENSUS_EVERY;
  const ex = new SignalExtractor();
  const table: RunTable = new Map();
  let n = 0;
  for await (const { rec, rows } of merged) {
    n++;
    if (rec.step !== n * cadence) throw new Error(`${runId}: census ${n} is at step ${rec.step}, expected ${n * cadence}`);
    const bad = censusProblem(rec, rows);
    if (bad) throw new Error(`${runId}: step ${rec.step}: ${bad}`);
    const v = ex.push(rec, rows);
    if (rec.step >= o.lo && rec.step <= o.hi) table.set(rec.step, v);
    if (o.truncate && n * cadence >= o.steps) break;
  }
  if (n * cadence !== o.steps) throw new Error(`${runId}: ${n} censuses (${n * cadence} steps), expected ${o.steps / cadence} (${o.steps} steps)`);
  return table;
}

/**
 * Records of a series stream up to the horizon: it stops after the first record at a step of at least `horizon`, so no later line
 * is read or parsed (a base longer than the horizon is cut there; what lies beyond is never looked at).
 */
export async function* seriesThrough<R extends { step: number }>(series: AsyncIterable<R>, horizon: number): AsyncGenerator<R> {
  for await (const rec of series) {
    yield rec;
    if (rec.step >= horizon) return;
  }
}
/**
 * lineages.tsv lines to lineage censuses up to the horizon, parsed as lineageCensuses (tools/lib/bundle.ts) parses them: the
 * header and blank lines skipped, `step<TAB>key<TAB>cells`, steps ascending, one census per step with rows. It ends without
 * reading on: once rows at `horizon` are collected, the first line at another step ends the stream unparsed (lineageCensuses
 * would check it, and mergeCensuses asks for the next census before it yields the horizon's); a line past the horizon before
 * any rows at it (no living cells at the horizon) ends it too. Within the horizon a step out of order throws, naming `label`.
 */
export async function* lineageBlocksThrough(label: string, lines: AsyncIterable<string>, horizon: number): AsyncGenerator<[number, [string, number][]]> {
  let header = true;
  let step = -Infinity;
  let rows: [string, number][] = [];
  for await (const l of lines) {
    if (header || !l) {
      header = false;
      continue;
    }
    const [s, k, c] = l.split("\t");
    const n = Number(s);
    if (step === horizon && n !== horizon) break; // the horizon's census is complete; this line is not read further
    if (n > horizon) break; // no rows at the horizon; the census before it is yielded below
    if (n !== step) {
      if (!(n > step)) throw new Error(`${label}/lineages.tsv: step ${s} follows ${step}; rows must be in ascending census order`);
      if (rows.length) yield [step, rows];
      step = n;
      rows = [];
    }
    rows.push([k, Number(c)]);
  }
  if (rows.length) yield [step, rows];
}

// ---------------------------------------------------------------------------------------------
// Digests.

/** An integer prints as an integer; any other finite value to 3 decimals, never "-0.000". */
export function formatNumber(v: number): string {
  if (!Number.isFinite(v)) throw new Error(`cannot format ${v}`);
  if (Number.isInteger(v)) return String(v === 0 ? 0 : v);
  const s = v.toFixed(3);
  return s === "-0.000" ? "0.000" : s;
}

/** Rows of the digest: line i holds the 13 values at step A0 + i * LINE_EVERY. Throws on a missing census or an undefined rate. */
export function digestRows(table: RunTable, A0: number, lines: number): number[][] {
  const rows: number[][] = [];
  for (let i = 0; i < lines; i++) {
    const step = A0 + i * LINE_EVERY, v = table.get(step);
    if (!v) throw new Error(`no census at step ${step} for the digest`);
    rows.push(v.map((x, k) => {
      if (x === null) throw new Error(`signal ${SIGNALS[k].name} is undefined at step ${step} (its history is too short)`);
      return x;
    }));
  }
  return rows;
}

export interface Band {
  q25: number;
  median: number;
  q75: number;
}
/** The stated normal: per line and field, the quartiles and median of the reference rows (refs[r][line][field]). */
export function bandRows(refs: readonly (readonly (readonly number[])[])[]): Band[][] {
  if (!refs.length) throw new Error("bandRows: no reference runs");
  const lines = refs[0].length;
  return Array.from({ length: lines }, (_, i) =>
    Array.from({ length: SIGNALS.length }, (_, k) => {
      const xs = refs.map((r) => {
        if (r.length !== lines) throw new Error("bandRows: reference runs of different lengths");
        return r[i][k];
      }).sort((a, b) => a - b);
      return { q25: quantileSorted(xs, 0.25), median: quantileSorted(xs, 0.5), q75: quantileSorted(xs, 0.75) };
    }));
}

const HEADER = (band: boolean) => `t ${DIGEST_FIELDS.join(" ")}${band ? "   (each value is followed by the 25th/50th/75th percentile of the nine other worlds at that step)" : ""}`;
function digestLines(rows: readonly (readonly number[])[], band?: readonly (readonly Band[])[]): string[] {
  return rows.map((row, i) => {
    const cells = row.map((v, k) => (band ? `${formatNumber(v)}(${formatNumber(band[i][k].q25)}/${formatNumber(band[i][k].median)}/${formatNumber(band[i][k].q75)})` : formatNumber(v)));
    return `${i * LINE_EVERY} ${cells.join(" ")}`;
  });
}
/** A T1 item file: two digests, X and Y. */
export function renderT1(x: readonly (readonly number[])[], y: readonly (readonly number[])[]): string {
  return ["DIGEST X", HEADER(false), ...digestLines(x), "", "DIGEST Y", HEADER(false), ...digestLines(y), ""].join("\n");
}
/** A T2 item file: one digest with the stated normal beside every value. */
export function renderT2(rows: readonly (readonly number[])[], band: readonly (readonly Band[])[]): string {
  return ["DIGEST", HEADER(true), ...digestLines(rows, band), ""].join("\n");
}

/** Relative step of the first line where two digests differ (null: they never do). */
export function firstDifference(a: readonly (readonly number[])[], b: readonly (readonly number[])[]): number | null {
  for (let i = 0; i < a.length; i++) if (a[i].some((v, k) => v !== b[i][k])) return i * LINE_EVERY;
  return null;
}
/** Whether two tables agree at every census up to and including `step` (the twin is its base until the intervention). */
export function tablesAgreeThrough(a: RunTable, b: RunTable, step: number): string | null {
  for (const [s, va] of a) {
    if (s > step) continue;
    const vb = b.get(s);
    if (!vb) return `base has no census at step ${s}`;
    for (let k = 0; k < va.length; k++) if (va[k] !== vb[k]) return `differs from its base at step ${s} (${SIGNALS[k].name})`;
  }
  return null;
}

export interface BuiltItem {
  item: PlannedItem;
  /** Why the item is left out (void twin, window beyond the run, ...), or null. */
  void: string | null;
  text: string | null;
  /** Twin items: relative step of the first digest line that differs from the base's (null: none in the window). */
  firstDiffT: number | null;
}
export type TableResult = { table: RunTable } | { void: string };

/**
 * Builds every item's text. `getTable` returns a run's table, or `{void: reason}` for a twin that is void; a base or reference run
 * that is void or missing throws (the bases are on disk and not optional). `voids` names items to leave out (the twin record's).
 */
export function assemble(items: readonly PlannedItem[], layout: DigestLayout, getTable: (ref: RunRef) => TableResult, voids: ReadonlyMap<string, string> = new Map()): BuiltItem[] {
  const lines = linesIn(layout.windowSteps);
  const cache = new Map<string, TableResult>();
  const get = (ref: RunRef) => {
    const k = refKey(ref);
    if (!cache.has(k)) cache.set(k, getTable(ref));
    return cache.get(k)!;
  };
  const need = (ref: RunRef): RunTable => {
    const r = get(ref);
    if ("void" in r) throw new Error(`${refKey(ref)} is needed and unusable: ${r.void}`);
    return r.table;
  };
  const rowsOf = (ref: RunRef, A0: number) => digestRows(need(ref), A0, lines);
  return items.map((item) => {
    const A0 = windowStart(layout, item);
    const left = (reason: string): BuiltItem => ({ item, void: reason, text: null, firstDiffT: null });
    const own = voids.get(item.id);
    if (own) return left(own);
    if (A0 < CENSUS_EVERY * 11 || A0 + layout.windowSteps > layout.steps) return left(`window ${A0}..${A0 + layout.windowSteps} is not inside the run (${layout.steps} steps)`);
    const run = itemRun(item);
    const r = get(run);
    if ("void" in r) return left(r.void);
    const baseRef: RunRef = { kind: "base", seed: item.seed };
    let firstDiffT: number | null = null;
    if (run.kind === "twin") {
      const bad = tablesAgreeThrough(r.table, need(baseRef), layout.S);
      if (bad) return left(bad);
      firstDiffT = firstDifference(digestRows(r.table, A0, lines), rowsOf(baseRef, A0));
    }
    if (item.task === "T1") {
      const twin = digestRows(r.table, A0, lines), base = rowsOf(baseRef, A0);
      return { item, void: null, text: item.orientation === "X=twin" ? renderT1(twin, base) : renderT1(base, twin), firstDiffT };
    }
    const refs = layout.refsOf(item);
    if (layout.mode === "production" && refs.some((x) => x.kind === "base" && x.seed === item.seed)) throw new Error(`references of ${item.id} include its own seed`);
    return { item, void: null, text: renderT2(digestRows(r.table, A0, lines), bandRows(refs.map((x) => rowsOf(x, A0)))), firstDiffT };
  });
}

// ---------------------------------------------------------------------------------------------
// Manifest and hashes.

export interface ManifestItem {
  id: string;
  task: Task;
  seed: number;
  arm: ItemArm;
  U: number;
  orientation?: "X=twin" | "X=base";
  file: string | null;
  digestSha256: string | null;
  firstDiffT: number | null;
  void: string | null;
}
export interface Manifest {
  rule: "anomaly-bell-v1-digest";
  version: number;
  note: string;
  mode: "production" | "pilot";
  manifestSeed: number;
  orientationRule: string;
  /** How the public ids were dealt (the items are listed in enumeration order, their ids are not). */
  idRule: string;
  S: number;
  windowSteps: number;
  lines: number;
  lineEvery: number;
  uGrid: { min: number; step: number; count: number };
  fields: readonly string[];
  /** The twin bell's record the void list came from (its file name, not its path, and SHA-256), null in a pilot. */
  twinRecord: { path: string; sha256: string } | null;
  items: ManifestItem[];
}

export async function sha256Hex(text: string): Promise<string> {
  const buf = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function makeManifest(built: readonly BuiltItem[], layout: DigestLayout, manifestSeed = MANIFEST_SEED, twinRecord: { path: string; sha256: string } | null = null): Promise<Manifest> {
  const items: ManifestItem[] = [];
  for (const b of built) {
    const it = b.item;
    items.push({
      id: it.id, task: it.task, seed: it.seed, arm: it.arm, U: it.U,
      ...(it.orientation ? { orientation: it.orientation } : {}),
      file: b.text === null ? null : `items/${it.id}.txt`,
      digestSha256: b.text === null ? null : await sha256Hex(b.text),
      firstDiffT: b.firstDiffT,
      void: b.void,
    });
  }
  return {
    rule: "anomaly-bell-v1-digest",
    version: DIGEST_VERSION,
    note: NOTE_PATH,
    mode: layout.mode,
    manifestSeed,
    orientationRule: "one mulberry32 stream, per item U = 5000 + 200 * floor(rng() * 51) first, then in T1 the coin: rng() < 0.5 means X is the twin, otherwise X is the base",
    idRule: `per task, ids 1..n dealt by a Fisher-Yates shuffle (j = floor(rng() * (i + 1)), i from n - 1 down to 1) of a mulberry32 stream seeded at ${ID_SEED}, T1 then T2; items are listed in enumeration order`,
    S: layout.S,
    windowSteps: layout.windowSteps,
    lines: linesIn(layout.windowSteps),
    lineEvery: LINE_EVERY,
    uGrid: { min: U_MIN, step: U_STEP, count: U_COUNT },
    fields: DIGEST_FIELDS,
    twinRecord,
    items,
  };
}
export const renderManifest = (m: Manifest): string => JSON.stringify(m, null, 1) + "\n";

/** The task prompt followed by the item text: what a call sends and what its hash covers. */
export const composePrompt = (prompt: string, itemText: string): string => `${prompt}\n${itemText}`;

// ---------------------------------------------------------------------------------------------
// The frozen prompts and schemas.

export function buildSchema(task: Task, windowSteps = WINDOW_STEPS): Record<string, unknown> {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: `anomaly bell v1, ${task} answer`,
    type: "object",
    additionalProperties: false,
    required: ["intervention", "world", "t", "kind", "notes"],
    properties: {
      intervention: { enum: ["yes", "no"] },
      world: task === "T1" ? { enum: ["X", "Y", null] } : { type: "null" },
      t: { anyOf: [{ type: "integer", minimum: 0, maximum: windowSteps, multipleOf: LINE_EVERY }, { type: "null" }] },
      kind: { enum: ["removal", "addition", null] },
      notes: {
        type: "array",
        minItems: 3,
        maxItems: 3,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["t", "measure", "values", "note"],
          properties: { t: { type: "integer" }, measure: { type: "string" }, values: { type: "string" }, note: { type: "string" } },
        },
      },
    },
  };
}

const FIELD_HELP = `  living_cells       grid cells that hold living matter
  individuals        separate living clusters (individuals)
  mean_mass          mean matter per individual
  lineages           distinct heritable lineages alive
  lineage_shannon    Shannon diversity (bits) of the lineages' shares of living mass
  pattern_entropy    entropy of the mix of cell patterns across the grid (higher: more varied)
  biotic_recycling   share of waste-to-nutrient recycling done by organisms rather than by light alone (0 to 1)
  max_generation     the deepest generation count among living collectives
  dominant_share     the largest lineage's share of all living cells (0 to 1)
  fissions_1000      fissions (an individual splitting in two) in the last 1000 steps
  fusions_1000       fusions (two individuals merging) in the last 1000 steps
  buddings_1000      buddings (an individual shedding a small offspring) in the last 1000 steps
  mutations_1000     mutations in the last 1000 steps`;

const ANSWER_SHAPE = (task: Task, windowSteps: number) => `{"intervention": "yes" | "no",
 "world": ${task === "T1" ? '"X" | "Y" | null' : "null"},
 "t": integer | null,
 "kind": "removal" | "addition" | null,
 "notes": [{"t": integer, "measure": string, "values": string, "note": string}, {...}, {...}]}

Rules for the reply:
- Reply with this one JSON object and nothing else: no text before or after it, no extra keys.
- intervention is "yes" or "no", lowercase.
- world: ${task === "T1" ? 'X or Y (the copy the intervention was done to) when you say yes; null when you say no' : "always null in this task"}.
- t is the line of the digest at which the intervention happened: a multiple of 200 from 0 to ${windowSteps}; null when you say no.
- kind is "removal" if something was taken out of the world, "addition" if something was put into it; null when you say no.
- notes: exactly three entries naming what you looked at hardest. In each, t is a line of the digest, measure is one of the field names above, values quotes the numbers you read there (as text), and note says what you made of them.`;

/** The frozen prompt text of a task (production window by default). */
export function buildPrompt(task: Task, windowSteps = WINDOW_STEPS): string {
  const lines = linesIn(windowSteps);
  const intro = task === "T1"
    ? `Below are two digests, X and Y, of two copies of one simulated world over the same window of ${windowSteps} steps. The simulated world is a closed grid world, closed in matter and open to an outside supply of energy, that holds self-copying living clusters which grow, split, merge, bud and mutate. The two copies were identical when the window began. Each digest has ${lines} lines, one every ${LINE_EVERY} steps; t is the number of steps since the window began (the first line is t=0).`
    : `Below is a digest of one simulated world over a window of ${windowSteps} steps. The simulated world is a closed grid world, closed in matter and open to an outside supply of energy, that holds self-copying living clusters which grow, split, merge, bud and mutate. The digest has ${lines} lines, one every ${LINE_EVERY} steps; t is the number of steps since the window began (the first line is t=0).`;
  const bandLine = task === "T2"
    ? `\nAfter every value, in parentheses, are the 25th, 50th and 75th percentiles of nine other worlds of the same kind at the same step: what is usual there.\n`
    : "";
  const question = task === "T1"
    ? `Worlds change on their own, and two copies can drift apart from a tiny chance difference even if nobody acts on them. A different possibility is that someone from outside did something to one of the two copies, once, during the window.

Question: did an outside intervention happen to one of the two copies during this window? If so, which copy (X or Y), at which line t, and of what kind: a removal (something taken out of the world) or an addition (something put into it)?`
    : `Worlds change on their own, so ordinary movement is not an intervention. A different possibility is that someone from outside did something to this world, once, during the window.

Question: did this world suffer a sudden outside intervention during this window? If so, at which line t, and of what kind: a removal (something taken out of the world) or an addition (something put into it)?`;
  return `${intro}

Each line gives these measures, in this order, after t:
${FIELD_HELP}
${bandLine}
${question}

Answer with exactly this JSON shape:
${ANSWER_SHAPE(task, windowSteps)}
`;
}

// ---------------------------------------------------------------------------------------------
// Answers: the contract.

export interface Note {
  t: number;
  measure: string;
  values: string;
  note: string;
}
export interface Answer {
  intervention: "yes" | "no";
  world: "X" | "Y" | null;
  t: number | null;
  kind: "removal" | "addition" | null;
  notes: Note[];
}
export type Outcome = { status: "ok"; answer: Answer } | { status: "missing" | "invalid"; reason: string };

const ANSWER_KEYS = ["intervention", "world", "t", "kind", "notes"];
const NOTE_KEYS = ["t", "measure", "values", "note"];
const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const sameKeys = (o: Record<string, unknown>, keys: string[]) => Object.keys(o).length === keys.length && keys.every((k) => Object.prototype.hasOwnProperty.call(o, k));

/**
 * One reply text against the answer contract of the note. Strict: exactly the five keys; intervention "yes" or "no" (lowercase,
 * no synonyms); world X, Y or null in T1 and null in T2; t an integer multiple of 200 within the window, or null; kind "removal",
 * "addition" or null; exactly three well-formed notes. The JSON may sit inside one ``` fence (the only thing stripped); any other
 * text around it, or malformed JSON, is invalid. A schema-valid answer can still be a miss (yes with no world, say); that is
 * scoring's call, not the parser's.
 */
export function parseAnswer(text: string | null | undefined, task: Task, windowSteps = WINDOW_STEPS): Outcome {
  if (text === null || text === undefined || !text.trim()) return { status: "missing", reason: "no answer" };
  let body = text.trim();
  const fence = /^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```$/.exec(body);
  if (fence) body = fence[1].trim();
  let v: unknown;
  try {
    v = JSON.parse(body);
  } catch (e) {
    return { status: "invalid", reason: `not JSON (${(e as Error).message})` };
  }
  const bad = (reason: string): Outcome => ({ status: "invalid", reason });
  if (!isObj(v)) return bad("not a JSON object");
  if (!sameKeys(v, ANSWER_KEYS)) return bad(`keys ${JSON.stringify(Object.keys(v))}, expected ${JSON.stringify(ANSWER_KEYS)}`);
  if (v.intervention !== "yes" && v.intervention !== "no") return bad(`intervention ${JSON.stringify(v.intervention)} is not "yes" or "no"`);
  if (task === "T1" ? !(v.world === "X" || v.world === "Y" || v.world === null) : v.world !== null) return bad(`world ${JSON.stringify(v.world)} is not allowed in ${task}`);
  if (v.t !== null && !(typeof v.t === "number" && Number.isInteger(v.t) && v.t >= 0 && v.t <= windowSteps && v.t % LINE_EVERY === 0)) return bad(`t ${JSON.stringify(v.t)} is not null or a multiple of ${LINE_EVERY} in 0..${windowSteps}`);
  if (!(v.kind === "removal" || v.kind === "addition" || v.kind === null)) return bad(`kind ${JSON.stringify(v.kind)} is not "removal", "addition" or null`);
  if (!Array.isArray(v.notes) || v.notes.length !== 3) return bad("notes is not an array of exactly three");
  for (const [i, n] of v.notes.entries()) {
    if (!isObj(n) || !sameKeys(n, NOTE_KEYS)) return bad(`note ${i} does not have exactly the keys ${NOTE_KEYS.join(", ")}`);
    if (!(typeof n.t === "number" && Number.isInteger(n.t)) || typeof n.measure !== "string" || typeof n.values !== "string" || typeof n.note !== "string") return bad(`note ${i} has a field of the wrong type`);
  }
  return { status: "ok", answer: v as unknown as Answer };
}

// ---------------------------------------------------------------------------------------------
// Receipts (reported, not scored).

const NUM = /-?\d+(?:\.\d+)?/g;
const numbersIn = (s: string): number[] => (s.match(NUM) ?? []).map(Number);
const CELL = /^(-?\d+(?:\.\d+)?)(?:\((-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)\))?$/;
/** A note's measure as a digest column name: trimmed, lowercase, spaces and hyphens as underscores ("Living cells" is living_cells). */
export const normaliseMeasure = (m: string): string => m.trim().toLowerCase().replace(/[\s-]+/g, "_");
export interface ReceiptCheck {
  /** t is a line of the digest. */
  tOk: boolean;
  /** measure names one of the digest's columns (its own header's names). */
  measureOk: boolean;
  /**
   * Whether the quoted numbers are read from the named column at t: true when, in one digest, every number in `values` is that
   * column's value there or (T2) one of the three numbers of its band. X and Y are checked apart and never pooled. Null: unchecked.
   */
  valuesOk: boolean | null;
  /** Why the values were not checked (null: they were). */
  unchecked: "no number" | "unknown measure" | "no line at t" | null;
  /** Per digest (T1: "X" and "Y"; T2: the one digest, ""): every quoted number is in that digest's cell. Empty when unchecked. */
  byDigest: Record<string, boolean>;
}
/** The digests of an item text: per "DIGEST [label]" section, its column names and its cells by line t. */
function parseDigests(itemText: string): { label: string; columns: string[]; lines: Map<number, string[]> }[] {
  const out: { label: string; columns: string[]; lines: Map<number, string[]> }[] = [];
  let cur: (typeof out)[number] | null = null;
  for (const l of itemText.split("\n")) {
    if (l.startsWith("DIGEST")) {
      cur = { label: l.slice("DIGEST".length).trim(), columns: [], lines: new Map() };
      out.push(cur);
    } else if (cur && l.startsWith("t ")) {
      const toks = l.split(/\s+/);
      const end = toks.findIndex((x) => x.startsWith("("));
      cur.columns = toks.slice(1, end < 0 ? undefined : end).filter((x) => x);
    } else if (cur && /^\d/.test(l)) {
      const [t, ...cells] = l.split(" ");
      cur.lines.set(Number(t), cells);
    }
  }
  return out;
}
export function checkReceipt(note: Note, itemText: string): ReceiptCheck {
  const digests = parseDigests(itemText);
  const measure = normaliseMeasure(note.measure);
  const tOk = digests.some((d) => d.lines.has(note.t));
  const measureOk = digests.length > 0 && digests.every((d) => d.columns.includes(measure));
  const quoted = numbersIn(note.values);
  const unchecked = quoted.length === 0 ? "no number" : !measureOk ? "unknown measure" : !tOk ? "no line at t" : null;
  const byDigest: Record<string, boolean> = {};
  if (unchecked === null) {
    for (const d of digests) {
      const m = CELL.exec(d.lines.get(note.t)?.[d.columns.indexOf(measure)] ?? "");
      const allowed = m ? m.slice(1).filter((x) => x !== undefined).map(Number) : [];
      byDigest[d.label] = quoted.every((x) => allowed.includes(x));
    }
  }
  return { tOk, measureOk, valuesOk: unchecked === null ? Object.values(byDigest).some((v) => v) : null, unchecked, byDigest };
}

// ---------------------------------------------------------------------------------------------
// Scoring.

export type ItemClass = "nudge" | "nudge2" | "l64" | "l96" | "f" | "base";
const POSITIVE: readonly ItemArm[] = ["l96", "f"];
/** Which items are false-alarm negatives, per task. */
const NEGATIVE: Record<Task, readonly ItemArm[]> = { T1: ["nudge"], T2: ["nudge", "nudge2", "base"] };
const EXPECTED_KIND: Record<ItemArm, "removal" | "addition"> = { nudge: "removal", nudge2: "removal", l64: "removal", l96: "removal", f: "addition", base: "removal" };

export interface ItemResult {
  id: string;
  seed: number;
  arm: ItemArm;
  U: number;
  role: "positive" | "negative" | "other";
  status: Outcome["status"] | "void";
  reason?: string;
  /** What counts as "yes": an invalid or missing answer counts as yes on a negative (a false alarm) and as no on a positive. */
  yes: boolean;
  /** An answer of yes that names the right twin (T1) or a t within the tolerance (T2). */
  hit: boolean;
  falseAlarm: boolean;
  kind: "removal" | "addition" | null;
  kindRight: boolean | null;
}
export interface Count {
  k: number;
  n: number;
}
export interface TaskScore {
  task: Task;
  called: boolean;
  reason?: string;
  hits: Count & { lower95: number | null };
  falseAlarms: Count & { byClass: Record<string, Count> };
  /** Hits among the L64 items (reported beside, not in the bar). */
  l64: Count;
  /** On the hits: kind right / wrong / not given. */
  kinds: { right: number; wrong: number; none: number };
  bars: { hits: boolean; falseAlarms: boolean; met: boolean } | null;
  invalidOrMissing: number;
  items: ItemResult[];
}

const roleOf = (task: Task, arm: ItemArm): ItemResult["role"] => (POSITIVE.includes(arm) ? "positive" : NEGATIVE[task].includes(arm) ? "negative" : "other");

/** One item's result from its outcome (see the field docs of ItemResult). */
export function judge(task: Task, item: Pick<ManifestItem, "id" | "seed" | "arm" | "U" | "orientation">, o: Outcome | "void", tol = HIT_TOLERANCE): ItemResult {
  const role = roleOf(task, item.arm);
  const base = { id: item.id, seed: item.seed, arm: item.arm, U: item.U, role };
  if (o === "void") return { ...base, status: "void", yes: false, hit: false, falseAlarm: false, kind: null, kindRight: null };
  if (o.status !== "ok") return { ...base, status: o.status, reason: o.reason, yes: role === "negative", hit: false, falseAlarm: role === "negative", kind: null, kindRight: null };
  const a = o.answer, yes = a.intervention === "yes";
  const hit = yes && (task === "T1" ? a.world !== null && a.world === twinLabel(item) : a.t !== null && Math.abs(a.t - item.U) <= tol);
  return { ...base, status: "ok", yes, hit: role === "other" || role === "positive" ? hit : false, falseAlarm: role === "negative" && yes, kind: yes ? a.kind : null, kindRight: yes && a.kind !== null ? a.kind === EXPECTED_KIND[item.arm] : null };
}

/**
 * Scores one task. `outcomes` holds an Outcome per item id (an id that is absent counts as missing). The task is called only when
 * no scored item is void and the scored items are exactly the note's count (20 positives; 10 or 30 negatives).
 */
export function scoreTask(task: Task, items: readonly ManifestItem[], outcomes: ReadonlyMap<string, Outcome>, tol = HIT_TOLERANCE): TaskScore {
  const mine = items.filter((i) => i.task === task);
  const results = mine.map((i) => judge(task, i, i.void ? "void" : outcomes.get(i.id) ?? { status: "missing", reason: "no answer file" }, tol));
  const pos = results.filter((r) => r.role === "positive"), neg = results.filter((r) => r.role === "negative");
  const bar = BARS[task];
  const voidScored = results.filter((r) => r.status === "void" && r.role !== "other");
  let reason: string | undefined;
  if (voidScored.length) reason = `${voidScored.length} scored item(s) are void: ${voidScored.map((r) => r.id).join(", ")}`;
  else if (pos.length !== bar.positives || neg.length !== bar.negatives) reason = `${pos.length} positives and ${neg.length} negatives present, the bar needs ${bar.positives} and ${bar.negatives}`;
  const called = reason === undefined;
  const hitsK = pos.filter((r) => r.hit).length, faK = neg.filter((r) => r.falseAlarm).length;
  const byClass: Record<string, Count> = {};
  for (const r of neg) {
    byClass[r.arm] ??= { k: 0, n: 0 };
    byClass[r.arm].n++;
    if (r.falseAlarm) byClass[r.arm].k++;
  }
  const kinds = { right: 0, wrong: 0, none: 0 };
  for (const r of pos.filter((h) => h.hit)) r.kindRight === null ? kinds.none++ : r.kindRight ? kinds.right++ : kinds.wrong++;
  const l64 = results.filter((r) => r.arm === "l64" && r.status !== "void");
  const hitsOk = hitsK >= bar.hitsAtLeast, faOk = faK <= bar.falseAlarmsAtMost;
  return {
    task,
    called,
    ...(reason ? { reason } : {}),
    hits: { k: hitsK, n: pos.length, lower95: pos.length >= 1 ? binomialLowerBound(hitsK, pos.length) : null },
    falseAlarms: { k: faK, n: neg.length, byClass },
    l64: { k: l64.filter((r) => r.hit).length, n: l64.length },
    kinds,
    bars: called ? { hits: hitsOk, falseAlarms: faOk, met: hitsOk && faOk } : null,
    invalidOrMissing: results.filter((r) => r.status === "invalid" || r.status === "missing").length,
    items: results,
  };
}

/** The frozen file that holds the model id and its settings (the note freezes both, hashed, before the yes). */
export const CALL_SETTINGS_FILE = "call-settings.json";
/** Why a score may not call anything for want of frozen call settings (production only; a pilot is exempt), or null. */
export function callSettingsProblem(mode: "production" | "pilot", frozenFiles: readonly string[]): string | null {
  if (mode === "pilot" || frozenFiles.includes(CALL_SETTINGS_FILE)) return null;
  return `the model id and its settings were not frozen with the manifest (no ${CALL_SETTINGS_FILE} in hashes.json); the note freezes them before the yes, so nothing is called`;
}
/** A task score with its call withheld (the counts stay, as reported figures; no bar is read). */
export const withhold = (s: TaskScore, reason: string): TaskScore => ({ ...s, called: false, reason: s.reason ? `${reason}; ${s.reason}` : reason, bars: null });

// ---------------------------------------------------------------------------------------------
// The T2 code baseline.

export interface T2Windows {
  /** Absolute step of each counted window's first census. */
  starts: number[];
  /** Per window: the largest over signals and sides of the window's smallest side * z, floored at 0. */
  m: number[];
  /** livingCells z at every census of the item window, from its first. */
  livingZ: number[];
  A0: number;
}
/**
 * The v1 envelope z of the eleven signals against `refs` (one table each; the item itself is never among them), at every
 * 100-step census of [A0, A0 + windowSteps], and the minimum over each W_T2-census window lying wholly inside.
 */
export function t2Windows(item: RunTable, refs: readonly RunTable[], A0: number, windowSteps: number): T2Windows {
  if (!refs.length) throw new Error("t2Windows: no reference runs");
  const n = windowSteps / CENSUS_EVERY + 1;
  const val = (t: RunTable, step: number, k: number) => {
    const v = t.get(step);
    if (!v) throw new Error(`no census at step ${step}`);
    return finiteOrZero(v[k]);
  };
  const z: number[][] = []; // [census][v1 signal]
  const livingZ: number[] = [];
  for (let c = 0; c < n; c++) {
    const step = A0 + c * CENSUS_EVERY;
    const row = V1_SIGNALS.map((s) => {
      const sorted = Float64Array.from(refs.map((r) => val(r, step, s.index))).sort();
      return departure(val(item, step, s.index), sorted, Infinity, s.floor).z;
    });
    z.push(row);
    const sorted = Float64Array.from(refs.map((r) => val(r, step, LIVING_INDEX))).sort();
    livingZ.push(departure(val(item, step, LIVING_INDEX), sorted, Infinity, SIGNALS[LIVING_INDEX].floor).z);
  }
  const starts: number[] = [], m: number[] = [];
  for (let w = 0; w + W_T2 <= n; w++) {
    let best = 0;
    for (let s = 0; s < V1_SIGNALS.length; s++) {
      let lo = Infinity, hi = -Infinity;
      for (let c = w; c < w + W_T2; c++) {
        lo = Math.min(lo, z[c][s]);
        hi = Math.max(hi, z[c][s]);
      }
      best = Math.max(best, lo, -hi); // high side: min of z; low side: min of -z = -max of z
    }
    starts.push(A0 + w * CENSUS_EVERY);
    m.push(best);
  }
  return { starts, m, livingZ, A0 };
}

export interface CodeDecision {
  D: number;
  rings: boolean;
  /** Relative t (a multiple of 200) of the earliest window above the threshold; null when none. */
  t: number | null;
  kind: "removal" | "addition" | null;
}
/** One item against Z_T2 (strict). */
export function t2Decide(w: T2Windows, Z: number): CodeDecision {
  const D = w.m.length ? Math.max(...w.m) : 0;
  const first = w.m.findIndex((x) => x > Z);
  if (first < 0) return { D, rings: false, t: null, kind: null };
  const start = w.starts[first];
  const censusIndex = (start - w.A0) / CENSUS_EVERY;
  return { D, rings: true, t: Math.floor((start - w.A0) / LINE_EVERY) * LINE_EVERY, kind: w.livingZ[censusIndex] < 0 ? "removal" : "addition" };
}
/** The code's answers on the T2 items: Z_T2 from the base items, then every item against it. Null Z when a base item is missing. */
export function codeBaselineT2(items: readonly { id: string; arm: ItemArm; w: T2Windows | null }[]): { Z: number | null; decisions: Map<string, CodeDecision>; reason?: string } {
  const bases = items.filter((i) => i.arm === "base");
  if (!bases.length || bases.some((b) => b.w === null)) return { Z: null, decisions: new Map(), reason: "a base item is missing, so Z_T2 is not set" };
  const Z = Math.max(...bases.map((b) => Math.max(...b.w!.m, 0)));
  const decisions = new Map<string, CodeDecision>();
  for (const i of items) if (i.w) decisions.set(i.id, t2Decide(i.w, Z));
  return { Z, decisions };
}
/** A code decision as an Outcome, so scoreTask scores it exactly as it scores the model. */
export const decisionOutcome = (d: CodeDecision): Outcome => ({
  status: "ok",
  answer: { intervention: d.rings ? "yes" : "no", world: null, t: d.t, kind: d.kind, notes: [] },
});

// ---------------------------------------------------------------------------------------------
// The T1 code comparator: detection only, from the twin bell's record.

export interface PairRecord {
  /** Null when the record does not call Z*_pair (then `called` is false and no detection is made). */
  zStar: number | null;
  /** Whether the record itself calls Z*_pair (10 valid nudge twins, a complete corpus); null when it does not say. */
  called: boolean | null;
  /** D_pair by `${arm}-${seed}`, only for twins the record counts as valid. */
  D: Map<string, number>;
  /** Twins the record marks void, as `${arm}-${seed}`. */
  voids: string[];
}
const ARM_NAMES = new Set(["nudge", "nudge2", "l64", "l96", "f"]);
/**
 * Reads the twin bell's record (experiments/naturalist/bell-v1-twins.json, written by tools/bell1.ts twins): Z*_pair is
 * `summary.zStarPair.value` (with `.called`), the twins are the array `twins` of objects with `arm`, `seed`, `valid`, and `D`
 * (null for a twin that failed). With fewer than 10 valid nudges the record has `value: null, called: false`: accepted, Z* is null
 * and the comparator is withheld; `provisional` (the subset maximum) is never read. Also read, for a hand-made fixture: a number at `zStarPair`, `zStar`, `Z_star_pair`, and an array
 * under `runs` or `pairs` with `D_pair` or `dPair`. A twin with `valid: false` or no D is not in `D`; void ones are in `voids`.
 */
export function readPairRecord(json: unknown): PairRecord {
  const top = isObj(json) ? json : {};
  const sum = isObj(top.summary) ? top.summary : {};
  let zStar: number | null = null, called: boolean | null = null;
  const zp = isObj(sum.zStarPair) ? sum.zStarPair : isObj(top.zStarPair) ? top.zStarPair : null;
  if (zp && typeof zp.value === "number" && Number.isFinite(zp.value)) {
    zStar = zp.value;
    if (typeof zp.called === "boolean") called = zp.called;
  } else if (zp && zp.value === null && zp.called === false) {
    return { zStar: null, called: false, ...readTwinRows(json) };
  }
  for (const sc of [top, sum]) for (const k of ["zStarPair", "zStar", "Z_star_pair"]) if (zStar === null && typeof sc[k] === "number" && Number.isFinite(sc[k])) zStar = sc[k] as number;
  if (zStar === null) throw new Error("pair record: no Z*_pair (summary.zStarPair.value)");
  return { zStar, called, ...readTwinRows(json) };
}
/** The twins of a record: D by `${arm}-${seed}` for the valid ones, and the void ones. Needs no Z*_pair (a record with no valid nudge has none). */
function readTwinRows(json: unknown): { D: Map<string, number>; voids: string[] } {
  const top = isObj(json) ? json : {};
  const sum = isObj(top.summary) ? top.summary : {};
  let rows: unknown = null;
  for (const sc of [top, sum]) for (const k of ["twins", "runs", "pairs"]) if (rows === null && Array.isArray(sc[k])) rows = sc[k];
  if (!Array.isArray(rows)) throw new Error("pair record: no twins array");
  const D = new Map<string, number>();
  const voids: string[] = [];
  for (const r of rows) {
    if (!isObj(r)) continue;
    const arm = typeof r.arm === "string" ? r.arm.toLowerCase() : "";
    if (!ARM_NAMES.has(arm) || typeof r.seed !== "number") continue;
    const d = [r.D, r.D_pair, r.dPair].find((x) => typeof x === "number" && Number.isFinite(x)) as number | undefined;
    if (r.valid === false) voids.push(`${arm}-${r.seed}`);
    else if (d !== undefined) D.set(`${arm}-${r.seed}`, d);
  }
  return { D, voids };
}
/** The twin record's identity a production build needs (what tools/bell1.ts twins writes for the note's plan). */
export const TWIN_RECORD_RULE = "anomaly-bell-v1-twins";
/**
 * Why a production build may not go ahead on this twin record, or null. The record (bell-v1-twins.json) is the authority on the
 * full-history validity checks (equality from the first census, a difference after S, the launch exit code), so a production build
 * refuses to run without a finished one: the record's identity (rule, version, note; not a --plan smoke record), complete:true, the
 * note's parameters (S, steps, censuses, W_pair, the early-window range), and exactly one explicit validity decision (`valid`
 * true or false; a valid twin with a finite D) for each of the 50 twins (5 arms x seeds 1 to 10). A pilot build is exempt.
 */
export function twinRecordProblem(mode: "production" | "pilot", json: unknown | null): string | null {
  if (mode === "pilot") return null;
  if (json === null) return "the twin bell's record (experiments/naturalist/bell-v1-twins.json, or --voids <file>) is required: it holds the full-history validity of every twin";
  if (Array.isArray(json)) return "a plain array of \"arm-seed\" strings is for a pilot only; a production build needs the twin record itself (it has no twins array here)";
  if (!isObj(json)) return "the twin record is not a JSON object";
  if (json.rule !== TWIN_RECORD_RULE) return `the twin record's rule is ${JSON.stringify(json.rule ?? null)}, expected ${JSON.stringify(TWIN_RECORD_RULE)}`;
  if (json.version !== BELL1_VERSION) return `the twin record's version is ${JSON.stringify(json.version ?? null)}, expected ${BELL1_VERSION}`;
  if (json.note !== NOTE1_PATH) return `the twin record's note is ${JSON.stringify(json.note ?? null)}, expected ${JSON.stringify(NOTE1_PATH)}`;
  if (json.testPlan !== undefined) return "the twin record was made on a --plan (a smoke test), not on the note's plan";
  if (json.complete === false) return "the twin record is incomplete (complete:false); a void twin could be missing from it";
  if (json.complete !== true) return "the twin record does not say complete:true";
  const p = json.parameters;
  if (!isObj(p)) return "the twin record has no parameters";
  const want: [string, unknown, unknown][] = [
    ["S", p.S, S],
    ["steps", p.steps, STEPS],
    ["censuses", p.censuses, STEPS / CENSUS_EVERY],
    ["W_pair", p.W_pair, W_PAIR],
    ["earlyWindowFirstCensus", JSON.stringify(p.earlyWindowFirstCensus ?? null), JSON.stringify([S + EARLY_FROM, S + EARLY_TO])],
  ];
  for (const [k, got, exp] of want) if (got !== exp) return `the twin record's parameters.${k} is ${typeof got === "string" ? got : JSON.stringify(got ?? null)}, expected ${typeof exp === "string" ? exp : JSON.stringify(exp)}`;
  const zp = isObj(json.summary) && isObj(json.summary.zStarPair) ? json.summary.zStarPair : null;
  if (!zp || typeof zp.called !== "boolean") return "the twin record has no summary.zStarPair with an explicit called";
  if (zp.called ? !(typeof zp.value === "number" && Number.isFinite(zp.value)) : zp.value !== null) return `the twin record's summary.zStarPair.value is ${JSON.stringify(zp.value ?? null)} with called:${zp.called}; a called Z*_pair is a finite number, an uncalled one is null`;
  if (!Array.isArray(json.twins)) return "the twin record has no twins array";
  const seen = new Set<string>();
  for (const [i, r] of json.twins.entries()) {
    if (!isObj(r)) return `twin row ${i} is not an object`;
    if (typeof r.arm !== "string" || !(ARMS as readonly string[]).includes(r.arm)) return `twin row ${i} has arm ${JSON.stringify(r.arm ?? null)}, not one of ${ARMS.join(", ")}`;
    if (typeof r.seed !== "number" || !DEFAULT_SEEDS.includes(r.seed)) return `twin row ${i} (${r.arm}) has seed ${JSON.stringify(r.seed ?? null)}, not 1 to 10`;
    const key = `${r.arm}-${r.seed}`;
    if (seen.has(key)) return `twin ${key} is listed twice`;
    seen.add(key);
    if (typeof r.valid !== "boolean") return `twin ${key} has no explicit validity decision (valid is ${JSON.stringify(r.valid ?? null)})`;
    if (r.valid && !(typeof r.D === "number" && Number.isFinite(r.D))) return `twin ${key} is valid but has no finite D`;
  }
  for (const arm of ARMS) for (const seed of DEFAULT_SEEDS) if (!seen.has(`${arm}-${seed}`)) return `twin ${arm}-${seed} is not in the twin record (${seen.size} of ${ARMS.length * DEFAULT_SEEDS.length} listed)`;
  return null;
}

/**
 * The void list build reads: a twin record (its void twins; no Z*_pair needed, so a record with no valid nudge still lists its
 * voids), or, in a pilot only (twinRecordProblem refuses it in production), a JSON array of "arm-seed" strings.
 */
export function readVoids(json: unknown): string[] {
  if (Array.isArray(json)) {
    if (json.some((v) => typeof v !== "string")) throw new Error("void list: an array of strings like \"l96-3\" was expected");
    return json as string[];
  }
  return readTwinRows(json).voids;
}

/** A void reason without machine-specific absolute paths (so the frozen manifest does not depend on where the build ran). */
export const normaliseReason = (msg: string): string => msg.replace(/(^|[\s('"])\/[^\s'")]+/g, "$1<path>");

export interface ComparatorScore {
  /**
   * False when the record does not call Z*_pair (fewer than 10 valid nudges; Z* is then a partial maximum), or when a scored item
   * (L96, F, or a nudge) is void or has no D: then no task-level comparison is made and no item is called detected or not.
   */
  called: boolean;
  reason?: string;
  /** Counts over the items that are not void. */
  positives: Count;
  l64: Count;
  /** Calibration by construction: Z*_pair is set on these very nudges (labelled so). */
  nudgeCalibration: Count;
  /** Items that are not void but have no D in the record. */
  missing: string[];
  /** Items void in the manifest or in the twin record. */
  void: string[];
  byItem: { id: string; arm: ItemArm; seed: number; D: number | null; detected: boolean | null; void: string | null }[];
}
/**
 * The twin bell's detections on the T1 items (D_pair > Z*_pair, strict). It makes no world or kind call. An item void in the
 * manifest (or a twin the record marks void) carries its reason, has no D or detection, and is left out of every count. The
 * comparison is withheld (detections null, counts 0) when the record does not call Z*_pair, or when a scored item (L96, F or a
 * nudge) is void or missing, as the note withholds the task: "a task is not called if any of its scored items is missing".
 */
export function t1Comparator(items: readonly ManifestItem[], rec: PairRecord): ComparatorScore {
  const rows = items.filter((i) => i.task === "T1").map((i) => {
    const key = `${i.arm}-${i.seed}`;
    const v = i.void ?? (rec.voids.includes(key) ? `void in the twin bell's record (${key})` : null);
    return { id: i.id, arm: i.arm, seed: i.seed, D: v ? null : rec.D.get(key) ?? null, void: v };
  });
  const scored = rows.filter((r) => r.arm === "l96" || r.arm === "f" || r.arm === "nudge");
  const voidScored = scored.filter((r) => r.void), missingScored = scored.filter((r) => !r.void && r.D === null);
  let reason: string | undefined;
  if (rec.called === false || rec.zStar === null) reason = "the twin record does not call Z*_pair";
  else if (voidScored.length) reason = `${voidScored.length} scored item(s) are void: ${voidScored.map((r) => r.id).join(", ")}`;
  else if (missingScored.length) reason = `${missingScored.length} scored item(s) have no D in the twin record: ${missingScored.map((r) => r.id).join(", ")}`;
  const called = reason === undefined;
  const byItem = rows.map((r) => ({ id: r.id, arm: r.arm, seed: r.seed, D: r.D, detected: r.D === null || !called ? null : r.D > rec.zStar!, void: r.void }));
  const count = (arm: ItemArm[]): Count => {
    const xs = byItem.filter((b) => arm.includes(b.arm) && !b.void);
    return { k: xs.filter((b) => b.detected === true).length, n: xs.length };
  };
  return {
    called,
    ...(reason ? { reason } : {}),
    positives: count(["l96", "f"]),
    l64: count(["l64"]),
    nudgeCalibration: count(["nudge"]),
    missing: byItem.filter((b) => !b.void && b.D === null).map((b) => b.id),
    void: byItem.filter((b) => b.void).map((b) => b.id),
    byItem,
  };
}

/** The comparator with its task-level comparison withheld (detections null, counts 0, D kept), for a score that calls nothing. */
export const withholdComparator = (c: ComparatorScore, reason: string): ComparatorScore => ({
  ...c,
  called: false,
  reason: c.reason ? `${reason}; ${c.reason}` : reason,
  positives: { ...c.positives, k: 0 },
  l64: { ...c.l64, k: 0 },
  nudgeCalibration: { ...c.nudgeCalibration, k: 0 },
  byItem: c.byItem.map((b) => ({ ...b, detected: null })),
});

// ---------------------------------------------------------------------------------------------
// The orientation draw, reported beside the T1 result.

export interface OrientationReport {
  /** Items (all T1) whose twin is X, and those among the scored positives (L96 and F). */
  allTwinIsX: Count;
  positivesTwinIsX: Count;
  /** An answerer that says "yes, X" on every T1 item: hits among the positives, false alarms among the nudges. */
  alwaysYesX: { hits: Count; falseAlarms: Count };
}
/** The frozen coin is not stratified, so the split can lean; this is the constant-X baseline on the same items (reported, not scored). */
export function orientationReport(items: readonly Pick<ManifestItem, "task" | "arm" | "orientation">[]): OrientationReport {
  const t1 = items.filter((i) => i.task === "T1");
  const pos = t1.filter((i) => POSITIVE.includes(i.arm)), neg = t1.filter((i) => NEGATIVE.T1.includes(i.arm));
  const isX = (i: Pick<ManifestItem, "orientation">) => twinLabel(i) === "X";
  return {
    allTwinIsX: { k: t1.filter(isX).length, n: t1.length },
    positivesTwinIsX: { k: pos.filter(isX).length, n: pos.length },
    alwaysYesX: { hits: { k: pos.filter(isX).length, n: pos.length }, falseAlarms: { k: neg.length, n: neg.length } },
  };
}
