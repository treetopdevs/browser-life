// The stone horizon (slice 26; docs/garden-stone-horizon-2026-10-18.md, the rules written before the run): how long a
// stone stays legible in the big storm. Pure TypeScript with no Deno globals, so vitest imports it; tools/horizon.ts is
// the CLI that runs the twins on the GPU through `runExperiment` and hands each census to the functions here.
//
// Section numbers (§n) below are the rules note's.
import { CELL_CHANNELS, CH, G } from "@bl/schema";
import { validateInterventions } from "@bl/runner";

/** MurmurHash3's 32-bit finaliser. */
export function fmix32(h: number): number {
  h = h >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** The draw §2 picks the stone's centre with: `fmix32((seed * 0x9E3779B1 + N) mod 2^32)`. */
export function centreDraw(seed: number, N: number): number {
  return fmix32((Math.imul(seed, 0x9e3779b1) + N) >>> 0);
}

/**
 * The stone's centre (§2): the living cells (`B > 0`) of the checkpoint state in index order (index = y * W + x), and the
 * one at position `centreDraw(seed, N) mod living`. `cells` is the channel-major cell buffer of `n` cells. Null on a world
 * with no living cell.
 */
export function stoneCentre(cells: Uint32Array, n: number, W: number, seed: number, N: number): { x: number; y: number; index: number; living: number } | null {
  const base = CH.B * n;
  let living = 0;
  for (let i = 0; i < n; i++) if (cells[base + i] > 0) living++;
  if (living === 0) return null;
  let want = centreDraw(seed, N) % living;
  for (let i = 0; i < n; i++) {
    if (cells[base + i] === 0) continue;
    if (want-- === 0) return { x: i % W, y: Math.floor(i / W), index: i, living };
  }
  throw new Error("unreachable: the living count changed under the scan");
}

/** The wrapped offset of `a` from `c` on a ring of `L` cells, in [-floor(L/2), L - floor(L/2) - 1] (§4: `((x - cx + 768) mod 512) - 256` at L = 512). */
export function wrapOffset(a: number, c: number, L: number): number {
  const h = Math.floor(L / 2);
  return ((((a - c + h) % L) + L) % L) - h;
}

/**
 * The torus disc of radius r around (cx, cy) on a W x H world, as a 0/1 mask indexed y * W + x: every cell whose wrapped
 * offsets satisfy dx^2 + dy^2 <= r^2, the lesion's own disc test (`applyLesion`'s `dx * dx + dy * dy <= r * r` through the
 * torus neighbour). Refuses a disc that would meet itself across the torus (2r >= min(W, H)).
 */
export function torusDisc(W: number, H: number, cx: number, cy: number, r: number): Uint8Array {
  if (!Number.isInteger(r) || r < 0) throw new Error(`disc radius must be a non-negative integer, got ${r}`);
  if (2 * r >= Math.min(W, H)) throw new Error(`a disc of radius ${r} meets itself on a ${W} x ${H} torus`);
  if (!(cx >= 0 && cx < W && cy >= 0 && cy < H)) throw new Error(`centre (${cx}, ${cy}) is off the ${W} x ${H} world`);
  const m = new Uint8Array(W * H);
  const r2 = r * r;
  for (let y = 0; y < H; y++) {
    const dy = wrapOffset(y, cy, H);
    if (dy * dy > r2) continue;
    for (let x = 0; x < W; x++) {
      const dx = wrapOffset(x, cx, W);
      if (dx * dx + dy * dy <= r2) m[y * W + x] = 1;
    }
  }
  return m;
}

/** The near region of a stone of radius R (§4): the torus disc of radius 2R around its centre. Refuses 4R >= min(W, H). */
export function nearMask(W: number, H: number, cx: number, cy: number, R: number): Uint8Array {
  return torusDisc(W, H, cx, cy, 2 * R);
}

/** Living cells (`B > 0`) inside a mask, and the mask's size. */
export function livingIn(cells: Uint32Array, n: number, mask: Uint8Array): { living: number; cells: number } {
  const base = CH.B * n;
  let living = 0, size = 0;
  for (let i = 0; i < n; i++) {
    if (!mask[i]) continue;
    size++;
    if (cells[base + i] > 0) living++;
  }
  return { living, cells: size };
}

/** A census reduced to what §3 compares, per cell: alive (`B > 0`), the lineage (`LIN_HI`, `LIN_LO`) and `B + P`. */
export interface Signature {
  n: number;
  alive: Uint8Array;
  labHi: Uint32Array;
  labLo: Uint32Array;
  /** B + P (each below MATTER_MAX = 2^26, so the sum is exact in a u32). */
  bp: Uint32Array;
  living: number;
}

/** §3's per-cell reduction of a state: a dead cell (`B = 0`) is EMPTY whatever its genome words say. */
export function signatureOf(state: { cells: Uint32Array; genome: Uint32Array }): Signature {
  const n = state.cells.length / CELL_CHANNELS;
  if (!Number.isInteger(n) || state.genome.length % n !== 0) throw new Error("signatureOf: buffer sizes do not describe one world");
  const { cells, genome } = state;
  const alive = new Uint8Array(n), labHi = new Uint32Array(n), labLo = new Uint32Array(n), bp = new Uint32Array(n);
  let living = 0;
  const b = CH.B * n, p = CH.P * n, hi = G.LIN_HI * n, lo = G.LIN_LO * n;
  for (let i = 0; i < n; i++) {
    const B = cells[b + i];
    bp[i] = (B + cells[p + i]) >>> 0;
    if (B > 0) {
      alive[i] = 1;
      labHi[i] = genome[hi + i];
      labLo[i] = genome[lo + i];
      living++;
    }
  }
  return { n, alive, labHi, labLo, bp, living };
}

/**
 * One region's counts comparing two twins (§3): `cells` in the region; `union`, cells living in either; `diff`, cells whose
 * label differs (alive in one only, or alive in both with other lineages); `bpUnion`, cells with `B + P > 0` in either;
 * `bpDiff`, cells whose label or `B + P` differs (the light-cone measure's numerator, a subset of `bpUnion`).
 */
export interface RegionCounts {
  cells: number;
  union: number;
  diff: number;
  bpUnion: number;
  bpDiff: number;
}

const zeroCounts = (): RegionCounts => ({ cells: 0, union: 0, diff: 0, bpUnion: 0, bpDiff: 0 });

/** Compares twin `a` with twin `b` cell by cell, split into near (`mask` 1) and far (`mask` 0). */
export function compareRegions(a: Signature, b: Signature, mask: Uint8Array): { near: RegionCounts; far: RegionCounts } {
  if (a.n !== b.n || mask.length !== a.n) throw new Error("compareRegions: signatures and mask differ in size");
  const near = zeroCounts(), far = zeroCounts();
  for (let i = 0; i < a.n; i++) {
    const r = mask[i] ? near : far;
    r.cells++;
    const aa = a.alive[i], ba = b.alive[i];
    const labelDiff = aa !== ba || (aa === 1 && (a.labHi[i] !== b.labHi[i] || a.labLo[i] !== b.labLo[i]));
    if (aa || ba) r.union++;
    if (labelDiff) r.diff++;
    if (a.bp[i] > 0 || b.bp[i] > 0) r.bpUnion++;
    if (labelDiff || a.bp[i] !== b.bp[i]) r.bpDiff++;
  }
  return { near, far };
}

/** A ratio diff / union as §3 defines it (0 when the union is empty), rounded to `places` decimals for the record. */
export function ratio(c: { diff: number; union: number }, places = 4): number {
  if (c.union === 0) return 0;
  const f = 10 ** places;
  return Math.round((c.diff / c.union) * f) / f;
}

/**
 * §5's comparison `near <= far` of the primary measure, exactly: `diff_near * union_far <= diff_far * union_near`, an empty
 * union counting as 0. The products stay under 2^37 on a 512^2 jar, exact in a double.
 */
export function nearNotAboveFar(near: { diff: number; union: number }, far: { diff: number; union: number }): boolean {
  if (near.union === 0 || near.diff === 0) return true; // near = 0
  if (far.union === 0) return false; // far = 0 < near
  return near.diff * far.union <= far.diff * near.union;
}

/** A census of a stone pair, as the horizon rule reads it. */
export interface HorizonPoint {
  k: number;
  near: { diff: number; union: number };
  far: { diff: number; union: number };
  /** Either twin has no living cell at this census. */
  extinct: boolean;
}

export interface HorizonOptions {
  /** Censuses in a row near must not exceed far (4: the census and the next three). */
  K: number;
  /** The last census a horizon may start at (128 = one wander at census 1,024; 64 under the fallback window). */
  kMax: number;
  censusEvery: number;
}

export type PairOutcome =
  | { kind: "horizon"; k: number; steps: number; decidedAt: number }
  | { kind: "censored"; window: number; decidedAt: number }
  | { kind: "no-mark"; decidedAt: number }
  | { kind: "extinct"; k: number; decidedAt: number }
  | { kind: "pending" };

/**
 * The horizon rule (§5) on the censuses so far (k = 1, 2, ... in order): extinct at the first census where either twin is
 * dead, before a decision; no mark when both diffs are 0 at k = 1; the horizon is the first k <= kMax with near <= far at
 * k .. k + K - 1, reported as `k * censusEvery - 1` steps since the stone (which lands one step after the checkpoint);
 * censored once no k <= kMax can start such a run. Pending while undecided.
 */
export function horizonOf(series: readonly HorizonPoint[], o: HorizonOptions): PairOutcome {
  let run = 0;
  for (let j = 0; j < series.length; j++) {
    const p = series[j];
    if (p.k !== j + 1) throw new Error(`horizonOf: census ${j + 1} is labelled k = ${p.k}`);
    if (p.extinct) return { kind: "extinct", k: p.k, decidedAt: p.k };
    if (p.k === 1 && p.near.diff === 0 && p.far.diff === 0) return { kind: "no-mark", decidedAt: 1 };
    run = nearNotAboveFar(p.near, p.far) ? run + 1 : 0;
    if (run === o.K) {
      const k = p.k - o.K + 1;
      return { kind: "horizon", k, steps: k * o.censusEvery - 1, decidedAt: p.k };
    }
    const nextStart = run > 0 ? p.k - run + 1 : p.k + 1;
    if (nextStart > o.kMax) return { kind: "censored", window: o.kMax * o.censusEvery - 1, decidedAt: p.k };
  }
  return { kind: "pending" };
}

/** The last census a stone twin ever needs (§5: k = 131 at kMax 128). */
export const lastCensus = (o: { K: number; kMax: number }) => o.kMax + o.K - 1;

// ---- The GPU-time cap (§7)

export interface CapInputs {
  /** Seconds the pilot took, counted from the start of the cap. */
  pilotSeconds: number;
  /** The pilot's steps per second for a source run and for a twin (with its per-census readback and reduction). */
  srcRate: number;
  twinRate: number;
  capSeconds: number;
  /** Rates are multiplied by this before use (0.75: a full jar runs slower than an early one). */
  factor: number;
  wander: number;
  censusEvery: number;
  K: number;
  control: number;
  seeds: number;
}

/** A group's worst case (§7): U0 and three censored stone twins to the last census, plus the control. */
export function groupWorstSeconds(c: Pick<CapInputs, "twinRate" | "factor" | "censusEvery" | "K" | "control">, kMax: number): number {
  return ((4 * lastCensus({ K: c.K, kMax }) + c.control) * c.censusEvery) / (c.twinRate * c.factor);
}

/** The sources' cost to depth d (§7): one history per seed to step d * wander. */
export function sourcesSeconds(c: Pick<CapInputs, "srcRate" | "factor" | "wander" | "seeds">, d: number): number {
  return (c.seeds * d * c.wander) / (c.srcRate * c.factor);
}

/**
 * §7's scale-down rule: the largest depth d in 3, 2, 1 with pilot + sources(d) + 3 groups' worst case <= the cap (room for
 * all of day 1 at its worst), at the full window (kMax 128); if none fits, d = 1 and the window drops to 64 censuses.
 */
export function sourceDepth(c: CapInputs): { depth: number; kMax: number; fallback: boolean; groupWorst: number; sources: number; budget: number } {
  for (const d of [3, 2, 1]) {
    const gw = groupWorstSeconds(c, 128), src = sourcesSeconds(c, d);
    const budget = c.pilotSeconds + src + c.seeds * gw;
    if (budget <= c.capSeconds) return { depth: d, kMax: 128, fallback: false, groupWorst: gw, sources: src, budget };
  }
  const gw = groupWorstSeconds(c, 64), src = sourcesSeconds(c, 1);
  return { depth: 1, kMax: 64, fallback: true, groupWorst: gw, sources: src, budget: c.pilotSeconds + src + c.seeds * gw };
}

/** A group starts only if its worst case fits in what is left of the cap (§7). */
export const groupFits = (remainingSeconds: number, worstSeconds: number): boolean => worstSeconds <= remainingSeconds;

// ---- The group driver (§2, §5, §6, §7)

/** A twin of a group: U0 and U1 undisturbed, a stone twin with its lesion at N + 1. */
export interface TwinPlan {
  name: string;
  stone?: { step: number; x: number; y: number; r: number };
}

export interface SegmentResult<C> {
  /** The continuation for the next chunk (state and observer); null when the twin was stopped by its census callback. */
  next: C | null;
  /** The runner's `summary.finalHash` (artifact digest) of a completed segment, else null. */
  finalHash: string | null;
  /** `stateHash` of the census a stopped twin stopped at, else null. */
  stopStateHash: string | null;
  /** The last census reached (k counted from the group's checkpoint). */
  reached: number;
  /** Lesions this segment applied, with their effective radius (the runner's interventions log). */
  applied: { step: number; r: number }[];
  seconds: number;
}

export interface GroupIo<C> {
  /**
   * Runs `twin` for censuses firstK .. firstK + censuses - 1 from `from` (null: the group's checkpoint), calling `onCensus`
   * at each census in order; when it returns true the twin stops there (through `RunOptions.signal`) and the result's
   * `next` is null.
   */
  runSegment(twin: TwinPlan, from: C | null, firstK: number, censuses: number, onCensus: (k: number, sig: Signature) => boolean): Promise<SegmentResult<C>>;
  /** Seconds on a monotonic clock, and the cap's deadline on it. */
  now(): number;
  deadline: number;
}

export interface GroupPlan {
  centre: { x: number; y: number };
  radii: number[];
  /** Near masks per radius (nearMask of the centre). */
  masks: Map<number, Uint8Array>;
  /** Censuses per chunk (16). The control runs the first chunk. */
  chunk: number;
  horizon: HorizonOptions;
  /** Lesion step (N + 1). */
  stoneStep: number;
}

export interface SeriesPoint {
  k: number;
  near: RegionCounts;
  far: RegionCounts;
  livingStone: number;
  livingU0: number;
}

export type StoneOutcome = PairOutcome | { kind: "stopped-cap"; reached: number };

export interface StoneResult {
  R: number;
  name: string;
  effectiveR: number | null;
  outcome: StoneOutcome;
  reached: number;
  series: SeriesPoint[];
  finalHash: string | null;
  stopStateHash: string | null;
}

export interface GroupResult {
  control: { censuses: number; diff: number; bpDiff: number; hashU0: string | null; hashU1: string | null; ok: boolean };
  u0: { reached: number; finalHash: string | null };
  stones: StoneResult[];
  stoppedByCap: boolean;
  seconds: number;
}

/** The control failed (§6): a tooling or determinism fault, not drift. The group is void and the run stops. */
export class ControlFault extends Error {
  constructor(message: string, readonly control: GroupResult["control"]) {
    super(message);
    this.name = "ControlFault";
  }
}

/**
 * Runs one group (§2, §7): in chunks of `chunk` censuses, U0 first (its censuses held for the chunk), then U1 in the first
 * chunk (the control, compared whole-jar with U0 and hash-checked), then each undecided stone twin compared census by
 * census and stopped once the horizon rule decides it. U0 runs a chunk only while some stone twin is undecided. After a
 * chunk, a group past the deadline stops and its undecided twins are `stopped-cap`.
 */
export async function runGroup<C>(io: GroupIo<C>, plan: GroupPlan): Promise<GroupResult> {
  const t0 = io.now();
  const kEnd = lastCensus(plan.horizon);
  const stones = plan.radii.map((R) => ({
    plan: { name: `S${R}`, stone: { step: plan.stoneStep, x: plan.centre.x, y: plan.centre.y, r: R } } as TwinPlan,
    res: { R, name: `S${R}`, effectiveR: null, outcome: { kind: "pending" }, reached: 0, series: [], finalHash: null, stopStateHash: null } as StoneResult,
    cont: null as C | null,
  }));
  const control: GroupResult["control"] = { censuses: 0, diff: 0, bpDiff: 0, hashU0: null, hashU1: null, ok: false };
  const u0: GroupResult["u0"] = { reached: 0, finalHash: null };
  let u0cont: C | null = null;
  let stoppedByCap = false;
  const undecided = () => stones.filter((s) => s.res.outcome.kind === "pending");

  for (let first = 1; first <= kEnd && undecided().length > 0; first += plan.chunk) {
    const n = Math.min(plan.chunk, kEnd - first + 1);
    const held: { k: number; sig: Signature }[] = [];
    const r0 = await io.runSegment({ name: "U0" }, u0cont, first, n, (k, sig) => {
      held.push({ k, sig });
      return false;
    });
    if (r0.next === null || held.length !== n) throw new Error(`U0 did not complete censuses ${first}..${first + n - 1}`);
    u0cont = r0.next;
    u0.reached = r0.reached;
    u0.finalHash = r0.finalHash;
    const u0At = (k: number) => {
      const h = held[k - first];
      if (!h || h.k !== k) throw new Error(`U0's census ${k} is not held (chunk from ${first})`);
      return h.sig;
    };

    if (first === 1) {
      const r1 = await io.runSegment({ name: "U1" }, null, 1, n, (k, sig) => {
        const c = compareRegions(sig, u0At(k), plan.masks.get(plan.radii[0])!);
        control.censuses++;
        control.diff += c.near.diff + c.far.diff;
        control.bpDiff += c.near.bpDiff + c.far.bpDiff;
        return false;
      });
      control.hashU0 = r0.finalHash;
      control.hashU1 = r1.finalHash;
      control.ok = control.censuses === n && control.diff === 0 && control.bpDiff === 0 && r0.finalHash !== null && r0.finalHash === r1.finalHash;
      if (!control.ok) throw new ControlFault(`control U1 differs from U0: ${control.censuses} censuses, diff ${control.diff}, light-cone ${control.bpDiff}, hashes ${r0.finalHash} vs ${r1.finalHash}`, control);
    }

    for (const s of undecided()) {
      const mask = plan.masks.get(s.res.R)!;
      const r = await io.runSegment(s.plan, s.cont, first, n, (k, sig) => {
        const u = u0At(k);
        const c = compareRegions(sig, u, mask);
        s.res.series.push({ k, near: c.near, far: c.far, livingStone: sig.living, livingU0: u.living });
        s.res.reached = k;
        s.res.outcome = horizonOf(
          s.res.series.map((p) => ({ k: p.k, near: p.near, far: p.far, extinct: p.livingStone === 0 || p.livingU0 === 0 })),
          plan.horizon,
        );
        return s.res.outcome.kind !== "pending";
      });
      for (const a of r.applied) if (a.step === plan.stoneStep) s.res.effectiveR = a.r;
      // §2: the effective radius must be R. The stone lands in the first chunk, so a missing or clamped lesion fails the run
      // there rather than leaving a stone twin equal to U0 (excluded as no-mark) or a smaller stone recorded as R.
      if (first === 1 && s.res.effectiveR !== s.res.R) throw new Error(`${s.res.name}: the lesion at step ${plan.stoneStep} applied with radius ${s.res.effectiveR}, not ${s.res.R}`);
      s.cont = r.next;
      s.res.finalHash = r.finalHash;
      s.res.stopStateHash = r.stopStateHash;
      if (s.res.outcome.kind === "pending" && r.next === null) throw new Error(`${s.res.name} stopped without a decision at census ${r.reached}`);
    }

    if (io.now() >= io.deadline && undecided().length > 0) {
      stoppedByCap = true;
      for (const s of undecided()) s.res.outcome = { kind: "stopped-cap", reached: s.res.reached };
      break;
    }
  }
  return { control, u0, stones: stones.map((s) => s.res), stoppedByCap, seconds: io.now() - t0 };
}

// ---- The readout (§8)

export interface PairRecord {
  seed: number;
  N: number;
  R: number;
  outcome: StoneOutcome | { kind: "not-run-cap" } | { kind: "extinct-source" } | { kind: "void" };
}

export interface RadiusReading {
  R: number;
  /** Valid pairs (a horizon or censored), sorted ascending, censored above every horizon. */
  valid: { seed: number; N: number; steps: number | null }[];
  excluded: { seed: number; N: number; kind: string }[];
  /** The median element floor((n - 1) / 2); null steps when it is censored; undefined when no pair is valid. */
  median?: { steps: number | null };
  verdict: string;
}

export interface ReadoutOptions {
  kMax: number;
  censusEvery: number;
  /** One storm wound period (13,000 steps, §0). */
  wound: number;
  /** One sun wander (131,072 steps). */
  wander: number;
}

const fmt = (x: number) => x.toLocaleString("en-US");

/** §8's readings from the pairs: per radius the valid horizons, their median and verdict, and the pace reading on R = 32. */
export function readout(pairs: readonly PairRecord[], o: ReadoutOptions): { radii: RadiusReading[]; pace: string } {
  const window = o.kMax * o.censusEvery - 1;
  const fallback = o.kMax < 128;
  const radii = [...new Set(pairs.map((p) => p.R))].sort((a, b) => a - b);
  const out: RadiusReading[] = radii.map((R) => {
    const mine = pairs.filter((p) => p.R === R);
    const valid = mine
      .filter((p) => p.outcome.kind === "horizon" || p.outcome.kind === "censored")
      .map((p) => ({ seed: p.seed, N: p.N, steps: p.outcome.kind === "horizon" ? p.outcome.steps : null }))
      .sort((a, b) => (a.steps ?? Infinity) - (b.steps ?? Infinity) || a.N - b.N || a.seed - b.seed);
    const excluded = mine.filter((p) => p.outcome.kind !== "horizon" && p.outcome.kind !== "censored").map((p) => ({ seed: p.seed, N: p.N, kind: p.outcome.kind }));
    if (valid.length === 0) return { R, valid, excluded, verdict: `R = ${R}: no reading (no valid pair)` };
    const median = { steps: valid[Math.floor((valid.length - 1) / 2)].steps };
    const m = median.steps === null ? `censored (> ${fmt(window)})` : `${fmt(median.steps)} steps`;
    let verdict: string;
    if (R === 8) {
      const under = valid.filter((v) => v.steps !== null && v.steps < o.wound).length;
      if (under === valid.length) verdict = `R = 8: the prediction holds: every valid horizon (${valid.length}) is under ${fmt(o.wound)} steps (median ${m})`;
      else if (median.steps !== null && median.steps < o.wound) verdict = `R = 8: the prediction holds in the median (${m}); ${valid.length - under} of ${valid.length} valid horizons are not under ${fmt(o.wound)}`;
      else verdict = `R = 8: the prediction fails: the median is ${m}, not under ${fmt(o.wound)}`;
    } else if (median.steps === null) {
      verdict = fallback
        ? `R = ${R}: the median is censored under the fallback window (legible beyond ${fmt(window)} steps): the meteor call is deferred`
        : `R = ${R}: a meteor: the median is censored (still legible ${fmt(window)} steps after the stone)`;
    } else {
      verdict = `R = ${R}: a mark with no lasting effect: median ${m}, ${median.steps < o.wound ? "also" : "not"} under one wound period (${fmt(o.wound)})`;
    }
    return { R, valid, excluded, median, verdict };
  });
  const r32 = out.find((r) => r.R === 32);
  let pace: string;
  if (!r32 || !r32.median) pace = "Pace: no reading (no valid R = 32 pair).";
  else if (r32.median.steps !== null)
    pace = `Pace: the R = 32 median (${fmt(r32.median.steps)} steps) is under one wander, so the day stays one wander (decision 5's floor) and the brainstorm's branch applies: stones are too small to be letters that carry, and the sun is the first letter.`;
  else if (fallback) pace = `Pace: deferred: the R = 32 median is censored under the fallback window (> ${fmt(window)} steps), half a wander.`;
  else pace = `Pace: the R = 32 median is censored: a stone outlasts one wander, so the day should be the horizon, and this window cannot say how long that is; the next test is a longer window on R = 32.`;
  return { radii: out, pace };
}

/**
 * The record's layout (§9): JSON indented by one space, with every array of plain numbers kept on one line, so the per-census
 * series stay compact. Whitespace only: `JSON.parse` gives back the same value. Strings are never touched: each non-empty
 * array of finite numbers is swapped for a placeholder string (a token absent from the plain serialisation) while
 * `JSON.stringify` lays the value out, then the placeholder is replaced by the array on one line.
 */
export function compactJson(v: unknown): string {
  const plain = JSON.stringify(v);
  let tag = "numarr";
  while (plain !== undefined && plain.includes(tag)) tag += "_";
  const arrays: string[] = [];
  const isNumbers = (x: unknown): x is number[] => Array.isArray(x) && x.length > 0 && x.every((n) => typeof n === "number" && Number.isFinite(n));
  const laid = JSON.stringify(v, (_k, x) => (isNumbers(x) ? `${tag}${arrays.push(JSON.stringify(x)) - 1}` : x), 1);
  return laid.replace(new RegExp(`"${tag}(\\d+)"`, "g"), (_, i: string) => arrays[Number(i)]);
}

// ---- The census gate (the CLI sink's census logic, here so vitest covers it)

/** A census whose physics did not conserve: a fault, never a decision. */
export class ConservationFault extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConservationFault";
  }
}

/**
 * What the CLI's runner sink does with a twin segment's files (§3, §6). The runner appends each census's `series.jsonl` line
 * before it writes that census's checkpoint, so `series` sees the census's cumulative `conservationOk` first; `checkpoint`
 * then turns a `checkpoints/t<step>.blck` write into the census index k (null for any other file), checking that k follows
 * the last one and that a series line for the same step said `conservationOk: true`. A census that fails either check throws
 * before its comparison can decide (and abort) the twin, so a decided segment is conservation-checked up to its last census.
 */
export function censusGate(o: { name: string; N: number; censusEvery: number; firstK: number }) {
  let reached = o.firstK - 1;
  let seriesStep = -1;
  let conserved = true;
  return {
    get reached() {
      return reached;
    },
    series(text: string): void {
      for (const line of text.split("\n")) {
        if (!line.trim()) continue;
        const r = JSON.parse(line) as { step?: unknown; conservationOk?: unknown };
        if (typeof r.step !== "number") throw new Error(`${o.name}: a series line without a step`);
        seriesStep = r.step;
        if (r.conservationOk !== true) conserved = false;
        if (!conserved) throw new ConservationFault(`${o.name}: conservation violated by step ${r.step}`);
      }
    },
    checkpoint(file: string, step: number): number | null {
      if (!/^checkpoints\/t\d+\.blck$/.test(file)) return null;
      const k = (step - o.N) / o.censusEvery;
      if (k !== reached + 1) throw new Error(`${o.name}: census at step ${step} is k = ${k}, expected ${reached + 1}`);
      if (seriesStep !== step) throw new Error(`${o.name}: the checkpoint at step ${step} came without its census line (last ${seriesStep})`);
      if (!conserved) throw new ConservationFault(`${o.name}: conservation violated by step ${step}`);
      reached = k;
      return k;
    },
  };
}

// ---- Group files and their binding (resume)

/** What a group's result depends on, stamped into its group file; a resume reuses a file only when every field matches. */
export interface GroupBinding {
  seed: number;
  N: number;
  /** The source checkpoint's `stateHash` (its manifest entry). */
  checkpointHash: string;
  radii: number[];
  K: number;
  kMax: number;
  censusEvery: number;
  chunk: number;
  stoneStep: number;
  centre: { x: number; y: number };
}

/** The first field where a stored binding differs from the wanted one, as a sentence; null when they agree. */
export function bindingError(stored: GroupBinding | undefined, want: GroupBinding): string | null {
  if (!stored) return "the group file carries no binding (written before bindings existed)";
  for (const k of Object.keys(want) as (keyof GroupBinding)[]) {
    const a = JSON.stringify(stored[k]), b = JSON.stringify(want[k]);
    if (a !== b) return `${k} is ${a} in the group file, ${b} in this run`;
  }
  return null;
}

export interface GroupFile {
  seed: number;
  N: number;
  status: "done" | "not run (cap)" | "extinct source" | "void";
  binding?: GroupBinding;
  centre?: { x: number; y: number; living: number };
  stones?: { R: number; stoneDisc: { living: number; cells: number }; nearDisc: { living: number; cells: number } }[];
  result?: GroupResult;
  uptime?: string;
  startedAt?: string;
}

const round = (x: number, p: number) => Math.round(x * 10 ** p) / 10 ** p;

/**
 * A group as the record carries it (§9, amended): per radius the outcome, hashes and, per census, the primary measure's
 * integer counts (`nearDiff`, `nearUnion`, `farDiff`, `farUnion`) and the stone twin's living cells; per group U0's living
 * cells per census. The horizon rule compares integers, so the record keeps integers: `recomputePairs` reruns it from these.
 */
export function compactGroup(g: GroupFile, radii: number[]) {
  if (!g.result) return { seed: g.seed, N: g.N, status: g.status, ...(g.centre ? { centre: g.centre } : {}) };
  const r = g.result;
  const longest = r.stones.reduce((a, s) => (s.series.length > a.length ? s.series : a), [] as SeriesPoint[]);
  return {
    seed: g.seed,
    N: g.N,
    status: g.status,
    centre: g.centre,
    stoppedByCap: r.stoppedByCap,
    seconds: Math.round(r.seconds),
    control: r.control,
    u0: { ...r.u0, living: longest.map((p) => p.livingU0) },
    stones: radii.map((R) => {
      const st = r.stones.find((x) => x.R === R);
      const disc = g.stones?.find((x) => x.R === R);
      if (!st || !disc) throw new Error(`group seed ${g.seed} N ${g.N} has no stone of radius ${R}`);
      return {
        R,
        effectiveR: st.effectiveR,
        livingFraction: { stone: round(disc.stoneDisc.living / disc.stoneDisc.cells, 4), near: round(disc.nearDisc.living / disc.nearDisc.cells, 4) },
        outcome: st.outcome,
        reached: st.reached,
        finalHash: st.finalHash,
        stopStateHash: st.stopStateHash,
        nearDiff: st.series.map((p) => p.near.diff),
        nearUnion: st.series.map((p) => p.near.union),
        farDiff: st.series.map((p) => p.far.diff),
        farUnion: st.series.map((p) => p.far.union),
        living: st.series.map((p) => p.livingStone),
      };
    }),
  };
}

export type CompactGroup = ReturnType<typeof compactGroup>;
type CompactStone = { R: number; outcome: StoneOutcome; nearDiff: number[]; nearUnion: number[]; farDiff: number[]; farUnion: number[]; living: number[] };

/** A compact stone's series as the horizon rule reads it (U0's living cells from the group). */
export function pointsOf(st: CompactStone, u0Living: readonly number[]): HorizonPoint[] {
  return st.nearDiff.map((_, j) => ({
    k: j + 1,
    near: { diff: st.nearDiff[j], union: st.nearUnion[j] },
    far: { diff: st.farDiff[j], union: st.farUnion[j] },
    extinct: st.living[j] === 0 || u0Living[j] === 0,
  }));
}

/**
 * The pairs of a record, each outcome recomputed by the horizon rule from the record's integer counts and checked against the
 * outcome the run stored (a pair stopped by the cap is checked to be still pending). Throws on any disagreement.
 */
export function recomputePairs(groups: readonly { seed: number; N: number; status: string; u0?: { living: number[] }; stones?: CompactStone[] }[], radii: readonly number[], o: HorizonOptions): PairRecord[] {
  const pairs: PairRecord[] = [];
  for (const g of groups)
    for (const R of radii) {
      if (g.status !== "done") {
        const kind = g.status === "not run (cap)" ? "not-run-cap" : g.status === "extinct source" ? "extinct-source" : "void";
        pairs.push({ seed: g.seed, N: g.N, R, outcome: { kind } as PairRecord["outcome"] });
        continue;
      }
      const st = g.stones?.find((s) => s.R === R);
      if (!st || !g.u0) throw new Error(`group seed ${g.seed} N ${g.N}: no stone of radius ${R}`);
      const got = horizonOf(pointsOf(st, g.u0.living), o);
      const ok = st.outcome.kind === "stopped-cap" ? got.kind === "pending" : JSON.stringify(got) === JSON.stringify(st.outcome);
      if (!ok) throw new Error(`group seed ${g.seed} N ${g.N} R ${R}: the record's counts give ${JSON.stringify(got)}, its outcome says ${JSON.stringify(st.outcome)}`);
      pairs.push({ seed: g.seed, N: g.N, R, outcome: st.outcome });
    }
  return pairs;
}

/**
 * §1's founding check on a source's schedule: it passes the runner's own shape checks (an array of plain objects with
 * exactly their kind's keys), holds one entry, and that entry has every field of `founding`. The runner lets a feed also
 * carry `matter` (the quanta its log says it moved, asserted on replay), so that one optional key is allowed.
 */
export function isFounding(sched: unknown, founding: Readonly<Record<string, unknown>>): boolean {
  return validateInterventions(sched).length === 0 && (sched as unknown[]).length === 1 &&
    Object.entries(founding).every(([k, v]) => (sched as Record<string, unknown>[])[0][k] === v);
}

/**
 * A record's radius grid: the stored `radii` (records written since review pass 2), else a run group's stones, else the
 * stored readout's radii, so a record whose every group was excluded (no stones anywhere) still reads with its grid.
 */
export function recordRadii(rec: { radii?: number[]; groups: readonly { stones?: readonly { R: number }[] }[]; readout?: { radii?: readonly { R: number }[] } }): number[] {
  if (Array.isArray(rec.radii)) return rec.radii;
  const g = rec.groups.find((x) => x.stones);
  if (g) return g.stones!.map((s) => s.R);
  return (rec.readout?.radii ?? []).map((r) => r.R);
}

// ---- Side readings (not in the rules; they decide nothing)

/** diff / union >= num / den, exactly (an empty union reads 0). */
const atLeast = (c: { diff: number; union: number }, num: number, den: number) => c.union > 0 && c.diff * den >= num * c.union;

/** m(a) < m(b), exactly, by cross-multiplication (an empty union reads 0). */
const below = (a: { diff: number; union: number }, b: { diff: number; union: number }) =>
  (a.union > 0 ? a.diff : 0) * (b.union || 1) < (b.union > 0 ? b.diff : 0) * (a.union || 1);

export interface SideReadings {
  /** The far measure at census 1 over all pairs (null when no pair has a census, e.g. every group excluded). */
  farAtCensus1: { min: number; max: number } | null;
  /** The first census where far >= 0.9, over the pairs whose series reached it. */
  farReaches09: { pairs: number; of: number; min: number; max: number; median: number } | null;
  /** Censuses after census 16 where near and far are both >= 0.99, of all censuses after census 16. */
  bothSaturatedAfter16: { censuses: number; of: number };
  /**
   * Measured horizons, read at their first census k (the start of the four-census run). These are levels and one-census
   * moves; none of them says what caused the crossing.
   */
  horizons: {
    total: number;
    /** k > 10. */
    afterCensus10: number;
    /** k > 10 with near and far both >= 0.99 at k: two saturated values compared. */
    afterCensus10Saturated: number;
    /** far < 0.9 at k (a level, not a slope: far was not yet at 0.9). */
    farBelow09: number;
    /** near at k below near at census 1. */
    nearBelowCensus1: number;
    /** k = 1: no census before the crossing. */
    atCensus1: number;
    /** k > 1 (census k - 1 had near > far, else the run would have started there): near at k below near at k - 1. */
    nearFellIntoCrossing: number;
    /** k > 1: far at k above far at k - 1. */
    farRoseIntoCrossing: number;
    /** k > 1: both of the above. */
    bothMovedIntoCrossing: number;
  };
  pairs: {
    seed: number; N: number; R: number; k: number | null; nearK: number | null; farK: number | null; saturatedAtK: boolean | null;
    farBelow09: boolean | null; nearBelowCensus1: boolean | null; nearFellIntoCrossing: boolean | null; farRoseIntoCrossing: boolean | null; farReaches09At: number | null;
  }[];
}

/** The side readings, recomputed from the record's integer counts (`ratio` only rounds what is shown). */
export function sideReadings(groups: readonly { seed: number; N: number; status: string; stones?: CompactStone[] }[]): SideReadings {
  let f1min = Infinity, f1max = -Infinity, satAfter16 = 0, after16 = 0;
  const reach: number[] = [];
  let ofPairs = 0;
  const pairs: SideReadings["pairs"] = [];
  const h = { total: 0, afterCensus10: 0, afterCensus10Saturated: 0, farBelow09: 0, nearBelowCensus1: 0, atCensus1: 0, nearFellIntoCrossing: 0, farRoseIntoCrossing: 0, bothMovedIntoCrossing: 0 };
  for (const g of groups) {
    if (g.status !== "done" || !g.stones) continue;
    for (const st of g.stones) {
      ofPairs++;
      const n = st.nearDiff.length;
      const near = (j: number) => ({ diff: st.nearDiff[j], union: st.nearUnion[j] });
      const far = (j: number) => ({ diff: st.farDiff[j], union: st.farUnion[j] });
      if (n > 0) {
        const r1 = ratio(far(0));
        f1min = Math.min(f1min, r1);
        f1max = Math.max(f1max, r1);
      }
      let at09: number | null = null;
      for (let j = 0; j < n; j++) {
        if (at09 === null && atLeast(far(j), 9, 10)) at09 = j + 1;
        if (j + 1 > 16) {
          after16++;
          if (atLeast(near(j), 99, 100) && atLeast(far(j), 99, 100)) satAfter16++;
        }
      }
      if (at09 !== null) reach.push(at09);
      const row: SideReadings["pairs"][number] = {
        seed: g.seed, N: g.N, R: st.R, k: null, nearK: null, farK: null, saturatedAtK: null,
        farBelow09: null, nearBelowCensus1: null, nearFellIntoCrossing: null, farRoseIntoCrossing: null, farReaches09At: at09,
      };
      if (st.outcome.kind === "horizon") {
        const k = st.outcome.k, j = k - 1;
        const sat = atLeast(near(j), 99, 100) && atLeast(far(j), 99, 100);
        const farLow = !atLeast(far(j), 9, 10);
        const nearLow = below(near(j), near(0));
        const nearFell = k > 1 ? below(near(j), near(j - 1)) : null;
        const farRose = k > 1 ? below(far(j - 1), far(j)) : null;
        h.total++;
        if (k > 10) h.afterCensus10++;
        if (k > 10 && sat) h.afterCensus10Saturated++;
        if (farLow) h.farBelow09++;
        if (nearLow) h.nearBelowCensus1++;
        if (k === 1) h.atCensus1++;
        if (nearFell) h.nearFellIntoCrossing++;
        if (farRose) h.farRoseIntoCrossing++;
        if (nearFell && farRose) h.bothMovedIntoCrossing++;
        Object.assign(row, { k, nearK: ratio(near(j)), farK: ratio(far(j)), saturatedAtK: sat, farBelow09: farLow, nearBelowCensus1: nearLow, nearFellIntoCrossing: nearFell, farRoseIntoCrossing: farRose });
      }
      pairs.push(row);
    }
  }
  const sorted = [...reach].sort((a, b) => a - b);
  return {
    farAtCensus1: f1min <= f1max ? { min: f1min, max: f1max } : null,
    farReaches09: sorted.length ? { pairs: sorted.length, of: ofPairs, min: sorted[0], max: sorted[sorted.length - 1], median: sorted[Math.floor((sorted.length - 1) / 2)] } : null,
    bothSaturatedAfter16: { censuses: satAfter16, of: after16 },
    horizons: h,
    pairs,
  };
}
