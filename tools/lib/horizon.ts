// The stone horizon (slice 26; docs/garden-stone-horizon-2026-10-18.md, the rules written before the run): how long a
// stone stays legible in the big storm. Pure TypeScript with no Deno globals, so vitest imports it; tools/horizon.ts is
// the CLI that runs the twins on the GPU through `runExperiment` and hands each census to the functions here.
//
// Section numbers (§n) below are the rules note's.
import { CELL_CHANNELS, CH, G, MOT_ZERO } from "@bl/schema";
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
 * union counting as 0. The products stay under 2^37 on a 512^2 jar, exact in a double; counts whose products could pass
 * 2^53 (no jar holds them, but a record could) are compared as BigInts, so the comparison is exact for any safe integers.
 */
export function nearNotAboveFar(near: { diff: number; union: number }, far: { diff: number; union: number }): boolean {
  if (near.union === 0 || near.diff === 0) return true; // near = 0
  if (far.union === 0) return false; // far = 0 < near
  const a = near.diff * far.union, b = far.diff * near.union;
  if (a <= Number.MAX_SAFE_INTEGER && b <= Number.MAX_SAFE_INTEGER) return a <= b;
  return BigInt(near.diff) * BigInt(far.union) <= BigInt(far.diff) * BigInt(near.union);
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
  /** Slice 34: a lesion of any radius, 0 included (N0 and the kick); used when `stone` is absent. */
  entry?: { step: number; kind: "lesion"; x: number; y: number; r: number };
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
   * `next` is null. `hash`, when the io gives it, is the census's `stateHash`, computed only when called (slice 34; `runGroup`
   * never calls it).
   */
  runSegment(twin: TwinPlan, from: C | null, firstK: number, censuses: number, onCensus: (k: number, sig: Signature, hash?: () => string) => boolean): Promise<SegmentResult<C>>;
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

// ==== Slice 34: the null stone, the kick and the finer cadence (the note's "Amendment, slice 34", parts N1 to N8)

/** N1: `applyLesion` writes nothing to cell i: `B = P = E = 0`, `MOT` at rest and both lineage words 0. */
export function isLesionNull(cells: Uint32Array, genome: Uint32Array, n: number, i: number): boolean {
  return cells[CH.B * n + i] === 0 && cells[CH.P * n + i] === 0 && cells[CH.E * n + i] === 0 && cells[CH.MOT * n + i] === MOT_ZERO &&
    genome[G.LIN_HI * n + i] === 0 && genome[G.LIN_LO * n + i] === 0;
}

/** N1: a stale cell: `B = 0` with a lineage word that is not 0 (§3 reads it EMPTY; the physics reads its genome). */
export function isStale(cells: Uint32Array, genome: Uint32Array, n: number, i: number): boolean {
  return cells[CH.B * n + i] === 0 && (genome[G.LIN_HI * n + i] !== 0 || genome[G.LIN_LO * n + i] !== 0);
}

const cellsOfState = (state: { cells: Uint32Array; genome: Uint32Array }) => {
  const n = state.cells.length / CELL_CHANNELS;
  if (!Number.isInteger(n) || n === 0 || state.genome.length % n !== 0) throw new Error("buffer sizes do not describe one world");
  return n;
};

/** The 0/1 mask of lesion-null cells of a state, indexed y * W + x. */
export function lesionNullMask(state: { cells: Uint32Array; genome: Uint32Array }): Uint8Array {
  const n = cellsOfState(state);
  const m = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (isLesionNull(state.cells, state.genome, n, i)) m[i] = 1;
  return m;
}

/** Per row dy = -R .. R, the largest w with w^2 + dy^2 <= R^2: the lesion's disc row by row, in exact integers. */
export function discHalfWidths(R: number): number[] {
  if (!Number.isInteger(R) || R < 0) throw new Error(`disc radius must be a non-negative integer, got ${R}`);
  const out: number[] = [];
  for (let dy = -R; dy <= R; dy++) {
    let w = Math.floor(Math.sqrt(R * R - dy * dy));
    while ((w + 1) * (w + 1) + dy * dy <= R * R) w++;
    while (w * w + dy * dy > R * R) w--;
    out.push(w);
  }
  return out;
}

/** Cells in the radius-R disc. */
export const discSize = (R: number) => discHalfWidths(R).reduce((s, w) => s + 2 * w + 1, 0);

/**
 * For every centre of a W x H torus, the sum of `ind` over its radius-R disc (torusDisc's cells), exactly: row prefix sums on
 * doubled rows, one difference per disc row. Refuses a disc that meets itself (2R >= min(W, H)).
 */
export function discSums(ind: Uint8Array, W: number, H: number, R: number): Int32Array {
  if (ind.length !== W * H) throw new Error(`discSums: ${ind.length} cells is not ${W} x ${H}`);
  const half = discHalfWidths(R);
  if (2 * R >= Math.min(W, H)) throw new Error(`a disc of radius ${R} meets itself on a ${W} x ${H} torus`);
  const stride = 2 * W + 1;
  const pre = new Int32Array(H * stride);
  for (let y = 0; y < H; y++) {
    const o = y * stride, row = y * W;
    let s = 0;
    for (let x = 0; x < 2 * W; x++) {
      s += ind[row + (x < W ? x : x - W)];
      pre[o + x + 1] = s;
    }
  }
  const out = new Int32Array(W * H);
  for (let cy = 0; cy < H; cy++) {
    const base = cy * W;
    for (let k = 0; k < half.length; k++) {
      const y = (((cy + k - R) % H) + H) % H;
      const o = y * stride, w = half[k], span = 2 * w + 1;
      for (let cx = 0; cx < W; cx++) {
        let a = cx - w;
        if (a < 0) a += W;
        out[base + cx] += pre[o + a + span] - pre[o + a];
      }
    }
  }
  return out;
}

/**
 * N2: the null stone's centre at radius R: the centres whose radius-R torus disc is lesion-null, in index order, and the one
 * at position `centreDraw(seed, N + 1) mod count`. Null when no such disc exists.
 */
export function nullDiscCentre(
  state: { cells: Uint32Array; genome: Uint32Array },
  W: number,
  R: number,
  seed: number,
  N: number,
  mask: Uint8Array = lesionNullMask(state),
): { x: number; y: number; index: number; count: number } | null {
  const n = mask.length, H = n / W;
  const sums = discSums(mask, W, H, R), size = discSize(R);
  let count = 0;
  for (let i = 0; i < n; i++) if (sums[i] === size) count++;
  if (count === 0) return null;
  let want = centreDraw(seed, N + 1) % count;
  for (let i = 0; i < n; i++) {
    if (sums[i] !== size) continue;
    if (want-- === 0) return { x: i % W, y: Math.floor(i / W), index: i, count };
  }
  throw new Error("unreachable: the null disc count changed under the scan");
}

/**
 * N2's r0: the largest radius R <= maxR at which some disc is lesion-null; -1 when no cell is. Found by bisection, which
 * gives the scan's answer because the property is monotone (a null disc of radius R holds the null disc of radius R - 1
 * around the same centre).
 */
export function largestNullRadius(state: { cells: Uint32Array; genome: Uint32Array }, W: number, maxR: number, mask: Uint8Array = lesionNullMask(state)): number {
  const H = mask.length / W;
  if (!mask.some((v) => v === 1)) return -1;
  const has = (R: number) => {
    const s = discSums(mask, W, H, R), size = discSize(R);
    return s.some((v) => v === size);
  };
  let lo = 0, hi = maxR;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (has(mid)) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export interface KickCell {
  x: number;
  y: number;
  index: number;
  P: number;
  E: number;
  MOT: number;
  motOff: boolean;
  linHi: number;
  linLo: number;
  /** Stale cells tied at the minimum key. */
  ties: number;
  /** Stale cells in the state. */
  stale: number;
}

/**
 * N3: the kick's cell: the stale cells ranked by `P`, then `E`, then whether `MOT` is off rest, all ascending; among those tied
 * at the minimum, in index order, the one at position `centreDraw(seed, N + 2) mod ties`. Null when no cell is stale.
 */
export function kickCell(state: { cells: Uint32Array; genome: Uint32Array }, W: number, seed: number, N: number): KickCell | null {
  const n = cellsOfState(state);
  const { cells, genome } = state;
  let bp = Infinity, be = Infinity, bm = Infinity, stale = 0;
  let ties: number[] = [];
  for (let i = 0; i < n; i++) {
    if (!isStale(cells, genome, n, i)) continue;
    stale++;
    const P = cells[CH.P * n + i], E = cells[CH.E * n + i], m = cells[CH.MOT * n + i] !== MOT_ZERO ? 1 : 0;
    const less = P < bp || (P === bp && (E < be || (E === be && m < bm)));
    if (less) {
      bp = P, be = E, bm = m;
      ties = [i];
    } else if (P === bp && E === be && m === bm) ties.push(i);
  }
  if (ties.length === 0) return null;
  const i = ties[centreDraw(seed, N + 2) % ties.length];
  const MOT = cells[CH.MOT * n + i];
  return { x: i % W, y: Math.floor(i / W), index: i, P: cells[CH.P * n + i], E: cells[CH.E * n + i], MOT, motOff: MOT !== MOT_ZERO, linHi: genome[G.LIN_HI * n + i], linLo: genome[G.LIN_LO * n + i], ties: ties.length, stale };
}

// ---- The arms driver (N2 to N4)

/** An N0 twin differs from U0 (N2): a fault in the intervention machinery. The group is void and the run stops. */
export class NullFault extends Error {
  constructor(message: string, readonly detail: unknown) {
    super(message);
    this.name = "NullFault";
  }
}

/** U0 does not reproduce the slice-26 record (N4). The run stops. */
export class DeterminismFault extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeterminismFault";
  }
}

/** What #55's record says U0 did: its living cells per census, the census it ended on and that chunk's final hash, and chunk 1's. */
export interface U0Reference {
  living: number[];
  reached: number;
  finalHash: string | null;
  chunk1Hash: string | null;
}

export interface ArmsPlan {
  /** N0 twins: a lesion of radius R on a lesion-null disc. */
  nulls: { R: number; x: number; y: number }[];
  /** The kick's cell (a radius-0 lesion). */
  kick: { x: number; y: number };
  /** K's pairs: label (K|8 ...), the stone radius R they are read against, and the near region (radius 2R around the kick). */
  pairs: { label: string; R: number; mask: Uint8Array }[];
  /** The split U1's and the N0 twins' whole-jar comparison uses (only the sums are read). */
  controlMask: Uint8Array;
  chunk: number;
  horizon: HorizonOptions;
  /** N + 1. */
  entryStep: number;
  u0Reference?: U0Reference;
}

export interface NullTwinResult {
  name: string;
  R: number;
  x: number;
  y: number;
  effectiveR: number | null;
  censuses: number;
  /** stateHash and the whole-jar comparison equal U0's at every census. */
  identical: boolean;
  finalStateHash: string | null;
  u0FinalStateHash: string | null;
}

export interface KPairResult {
  label: string;
  R: number;
  outcome: StoneOutcome;
  series: SeriesPoint[];
}

export interface ArmsResult {
  control: GroupResult["control"];
  u0: {
    reached: number;
    finalHash: string | null;
    chunk1Hash: string | null;
    hashAt1: string | null;
    /** U0's living cells at every census it ran. */
    living: number[];
    reference: { livingChecked: number; chunk1HashChecked: boolean; finalHashChecked: boolean } | null;
  };
  nulls: NullTwinResult[];
  kick: { effectiveR: number | null; reached: number; finalHash: string | null; stopStateHash: string | null; hashAt1: string | null; sameAsU0At1: boolean | null; living: number[] };
  pairs: KPairResult[];
  stoppedByCap: boolean;
  seconds: number;
}

/**
 * Runs one group of slice 34 (N2 to N4, N7): in chunks of `chunk` censuses, U0 first (its censuses held, its living cells
 * checked against #55's record), then in the first chunk U1 (the control, as §6) and each N0 twin (its stateHash and
 * whole-jar comparison equal to U0's at every census, else NullFault), then K, compared with U0 under each of its pairs'
 * near regions and stopped once every pair is decided. U0 runs a chunk only while some pair is undecided; past the
 * deadline after a chunk, undecided pairs are `stopped-cap`.
 */
export async function runArms<C>(io: GroupIo<C>, plan: ArmsPlan): Promise<ArmsResult> {
  const t0 = io.now();
  const kEnd = lastCensus(plan.horizon);
  const ref = plan.u0Reference;
  const pairs = plan.pairs.map((p) => ({ mask: p.mask, res: { label: p.label, R: p.R, outcome: { kind: "pending" }, series: [] } as KPairResult }));
  const pending = () => pairs.filter((p) => p.res.outcome.kind === "pending");
  const control: GroupResult["control"] = { censuses: 0, diff: 0, bpDiff: 0, hashU0: null, hashU1: null, ok: false };
  const u0: ArmsResult["u0"] = { reached: 0, finalHash: null, chunk1Hash: null, hashAt1: null, living: [], reference: ref ? { livingChecked: 0, chunk1HashChecked: false, finalHashChecked: false } : null };
  const nulls: NullTwinResult[] = [];
  const kick: ArmsResult["kick"] = { effectiveR: null, reached: 0, finalHash: null, stopStateHash: null, hashAt1: null, sameAsU0At1: null, living: [] };
  const kickPlan: TwinPlan = { name: "K", entry: { step: plan.entryStep, kind: "lesion", x: plan.kick.x, y: plan.kick.y, r: 0 } };
  let u0cont: C | null = null, kcont: C | null = null;
  let stoppedByCap = false;
  const need = (hash: (() => string) | undefined, who: string) => {
    if (!hash) throw new Error(`${who}: runArms needs the io's census hash`);
    return hash();
  };

  for (let first = 1; first <= kEnd && pending().length > 0; first += plan.chunk) {
    const n = Math.min(plan.chunk, kEnd - first + 1);
    const held: { k: number; sig: Signature }[] = [];
    const hashes = new Map<number, string>();
    const r0 = await io.runSegment({ name: "U0" }, u0cont, first, n, (k, sig, hash) => {
      held.push({ k, sig });
      u0.living.push(sig.living);
      if (ref && k - 1 < ref.living.length) {
        if (sig.living !== ref.living[k - 1]) throw new DeterminismFault(`U0 has ${sig.living} living cells at census ${k}; #55's record has ${ref.living[k - 1]}`);
        u0.reference!.livingChecked++;
      }
      if (first === 1 && (k === 1 || plan.nulls.length > 0)) hashes.set(k, need(hash, "U0"));
      return false;
    });
    if (r0.next === null || held.length !== n) throw new Error(`U0 did not complete censuses ${first}..${first + n - 1}`);
    u0cont = r0.next;
    u0.reached = r0.reached;
    u0.finalHash = r0.finalHash;
    if (first === 1) {
      u0.chunk1Hash = r0.finalHash;
      u0.hashAt1 = hashes.get(1) ?? null;
      if (ref && ref.chunk1Hash !== null) {
        if (r0.finalHash !== ref.chunk1Hash) throw new DeterminismFault(`U0's chunk 1 ends at ${r0.finalHash}; #55's U0 ended it at ${ref.chunk1Hash}`);
        u0.reference!.chunk1HashChecked = true;
      }
    }
    if (ref && ref.finalHash !== null && r0.reached === ref.reached) {
      if (r0.finalHash !== ref.finalHash) throw new DeterminismFault(`U0 at census ${r0.reached} hashes ${r0.finalHash}; #55's U0 there ${ref.finalHash}`);
      u0.reference!.finalHashChecked = true;
    }
    const u0At = (k: number) => {
      const h = held[k - first];
      if (!h || h.k !== k) throw new Error(`U0's census ${k} is not held (chunk from ${first})`);
      return h.sig;
    };

    if (first === 1) {
      const r1 = await io.runSegment({ name: "U1" }, null, 1, n, (k, sig) => {
        const c = compareRegions(sig, u0At(k), plan.controlMask);
        control.censuses++;
        control.diff += c.near.diff + c.far.diff;
        control.bpDiff += c.near.bpDiff + c.far.bpDiff;
        return false;
      });
      control.hashU0 = r0.finalHash;
      control.hashU1 = r1.finalHash;
      control.ok = control.censuses === n && control.diff === 0 && control.bpDiff === 0 && r0.finalHash !== null && r0.finalHash === r1.finalHash;
      if (!control.ok) throw new ControlFault(`control U1 differs from U0: ${control.censuses} censuses, diff ${control.diff}, light-cone ${control.bpDiff}, hashes ${r0.finalHash} vs ${r1.finalHash}`, control);

      for (const z of plan.nulls) {
        const res: NullTwinResult = { name: `N0-${z.R}`, R: z.R, x: z.x, y: z.y, effectiveR: null, censuses: 0, identical: true, finalStateHash: null, u0FinalStateHash: hashes.get(n) ?? null };
        const r = await io.runSegment({ name: res.name, entry: { step: plan.entryStep, kind: "lesion", x: z.x, y: z.y, r: z.R } }, null, 1, n, (k, sig, hash) => {
          const c = compareRegions(sig, u0At(k), plan.controlMask);
          const h = need(hash, res.name);
          res.censuses++;
          res.finalStateHash = h;
          if (c.near.diff + c.far.diff + c.near.bpDiff + c.far.bpDiff !== 0 || h !== hashes.get(k)) res.identical = false;
          return false;
        });
        for (const a of r.applied) if (a.step === plan.entryStep) res.effectiveR = a.r;
        nulls.push(res);
        if (res.effectiveR !== z.R) throw new Error(`${res.name}: the lesion at step ${plan.entryStep} applied with radius ${res.effectiveR}, not ${z.R}`);
        if (!res.identical || res.censuses !== n || r.next === null || res.finalStateHash === null || res.finalStateHash !== res.u0FinalStateHash)
          throw new NullFault(`${res.name} is not U0: ${res.censuses} of ${n} censuses, identical ${res.identical}, final stateHash ${res.finalStateHash} vs U0 ${res.u0FinalStateHash}`, res);
      }
    }

    const r = await io.runSegment(kickPlan, kcont, first, n, (k, sig, hash) => {
      const u = u0At(k);
      kick.living.push(sig.living);
      kick.reached = k;
      if (k === 1) {
        kick.hashAt1 = need(hash, "K");
        kick.sameAsU0At1 = kick.hashAt1 === u0.hashAt1;
      }
      for (const p of pending()) {
        const c = compareRegions(sig, u, p.mask);
        p.res.series.push({ k, near: c.near, far: c.far, livingStone: sig.living, livingU0: u.living });
        p.res.outcome = horizonOf(
          p.res.series.map((q) => ({ k: q.k, near: q.near, far: q.far, extinct: q.livingStone === 0 || q.livingU0 === 0 })),
          plan.horizon,
        );
      }
      return pending().length === 0;
    });
    for (const a of r.applied) if (a.step === plan.entryStep) kick.effectiveR = a.r;
    if (first === 1 && kick.effectiveR !== 0) throw new Error(`K: the lesion at step ${plan.entryStep} applied with radius ${kick.effectiveR}, not 0`);
    kcont = r.next;
    kick.finalHash = r.finalHash;
    kick.stopStateHash = r.stopStateHash;
    if (pending().length > 0 && r.next === null) throw new Error(`K stopped without deciding every pair at census ${r.reached}`);

    if (io.now() >= io.deadline && pending().length > 0) {
      stoppedByCap = true;
      for (const p of pending()) p.res.outcome = { kind: "stopped-cap", reached: kick.reached };
      break;
    }
  }
  return { control, u0, nulls, kick, pairs: pairs.map((p) => p.res), stoppedByCap, seconds: io.now() - t0 };
}

// ---- The fine pilot's readings (N5)

export interface FinePoint {
  j: number;
  near: { diff: number; union: number };
  far: { diff: number; union: number };
}

export interface FineOptions {
  /** Steps per reading (64). */
  every: number;
  /** Readings in a row near must not exceed far (16: 1,024 steps). */
  Kf: number;
  /** The last reading a fine horizon may start at (113 in a 128-reading window, 49 in 64). */
  jMax: number;
}

export type FineHorizon = { kind: "horizon"; j: number; steps: number } | { kind: "censored"; window: number };

export interface FineReading {
  far50: number | null;
  far90: number | null;
  cross: number | null;
  /** Sum over the readings of max(0, near - far) * every, in steps (a double from the integer counts). */
  gapArea: number;
  fineHorizon: FineHorizon;
}

/** max(0, m(near) - m(far)), an empty union reading 0; 0 exactly whenever `nearNotAboveFar`. */
export function gapOf(near: { diff: number; union: number }, far: { diff: number; union: number }): number {
  if (nearNotAboveFar(near, far)) return 0;
  if (far.union === 0) return near.diff / near.union;
  const a = near.diff * far.union, b = far.diff * near.union;
  // The numerator exactly (BigInt past 2^53, see nearNotAboveFar), so a gap the comparison sees is never rounded to 0.
  if (a <= Number.MAX_SAFE_INTEGER && b <= Number.MAX_SAFE_INTEGER) return (a - b) / (near.union * far.union);
  return Number(BigInt(near.diff) * BigInt(far.union) - BigInt(far.diff) * BigInt(near.union)) / near.union / far.union;
}

/** N5's readings of one pair's fine series (j = 1 .. jMax + Kf - 1 at least, in order). */
export function fineReadings(points: readonly FinePoint[], o: FineOptions): FineReading {
  points.forEach((p, i) => {
    if (p.j !== i + 1) throw new Error(`fineReadings: reading ${i + 1} is labelled j = ${p.j}`);
  });
  if (points.length < o.jMax + o.Kf - 1) throw new Error(`fineReadings: ${points.length} readings, the rule needs ${o.jMax + o.Kf - 1}`);
  let far50: number | null = null, far90: number | null = null, cross: number | null = null, gap = 0, run = 0;
  let fine: FineHorizon | null = null;
  for (const p of points) {
    if (far50 === null && atLeast(p.far, 1, 2)) far50 = p.j;
    if (far90 === null && atLeast(p.far, 9, 10)) far90 = p.j;
    const ok = nearNotAboveFar(p.near, p.far);
    if (cross === null && ok) cross = p.j;
    gap += gapOf(p.near, p.far) * o.every;
    run = ok ? run + 1 : 0;
    if (fine === null && run >= o.Kf) {
      const j = p.j - o.Kf + 1;
      if (j <= o.jMax) fine = { kind: "horizon", j, steps: j * o.every - 1 };
    }
  }
  return { far50, far90, cross, gapArea: gap, fineHorizon: fine ?? { kind: "censored", window: o.jMax * o.every - 1 } };
}

export type FineVerdict = "material" | "like a kick" | "mixed" | "no reading";

/** N5's fine verdict per radius: material if G(S) > 2 G(K) in every group, like a kick if G(S) <= 2 G(K) in every group, else mixed. */
export function fineVerdict(rows: readonly { gS: number; gK: number }[]): FineVerdict {
  if (rows.length === 0) return "no reading";
  const above = rows.filter((r) => r.gS > 2 * r.gK).length;
  return above === rows.length ? "material" : above === 0 ? "like a kick" : "mixed";
}

export interface FinePairRecord {
  label: string;
  R: number;
  kind: "S" | "K";
  nearDiff: number[];
  nearUnion: number[];
  farDiff: number[];
  farUnion: number[];
  readings: FineReading;
}

export const finePointsOf = (p: Pick<FinePairRecord, "nearDiff" | "nearUnion" | "farDiff" | "farUnion">): FinePoint[] =>
  p.nearDiff.map((_, i) => ({ j: i + 1, near: { diff: p.nearDiff[i], union: p.nearUnion[i] }, far: { diff: p.farDiff[i], union: p.farUnion[i] } }));

export interface FineRadius {
  R: number;
  verdict: FineVerdict;
  rows: { seed: number; N: number; gS: number; gK: number }[];
  sHorizons: { seed: number; N: number; fineHorizon: FineHorizon }[];
}

/**
 * A pair's integer counts as the record must hold them: four arrays of `n` entries (exactly, when `n` is given), each a
 * non-negative safe integer, with `diff <= union` in both regions. An empty union is allowed (a near disc can empty out).
 * The first problem as a sentence; null when the counts are well formed.
 */
export function countsError(p: { nearDiff?: unknown; nearUnion?: unknown; farDiff?: unknown; farUnion?: unknown }, n?: number): string | null {
  const keys = ["nearDiff", "nearUnion", "farDiff", "farUnion"] as const;
  for (const k of keys) {
    const a = p[k];
    if (!Array.isArray(a)) return `${k} is not an array`;
    if (a.length !== (n ?? (p.nearDiff as unknown[]).length)) return `${k} has ${a.length} entries, not ${n ?? (p.nearDiff as unknown[]).length}`;
    const bad = a.findIndex((x) => !Number.isSafeInteger(x) || x < 0);
    if (bad >= 0) return `${k}[${bad}] is ${JSON.stringify(a[bad])}, not a non-negative integer`;
  }
  const nd = p.nearDiff as number[], nu = p.nearUnion as number[], fd = p.farDiff as number[], fu = p.farUnion as number[];
  for (let i = 0; i < nd.length; i++) {
    if (nd[i] > nu[i]) return `near diff ${nd[i]} exceeds its union ${nu[i]} at reading ${i + 1}`;
    if (fd[i] > fu[i]) return `far diff ${fd[i]} exceeds its union ${fu[i]} at reading ${i + 1}`;
  }
  return null;
}

/**
 * The fine readings recomputed from the counts (throws when a stored reading differs or a count is malformed), and the
 * verdict per radius. Every done group must carry exactly one S and one K pair at every radius, each with jMax + Kf - 1
 * readings; with `expect`, the groups must be exactly those (N5: the three day-1 groups), all done, so a verdict "in all
 * three groups" is never read off fewer.
 */
export function recomputeFine(groups: readonly { seed: number; N: number; status: string; pairs?: FinePairRecord[] }[], radii: readonly number[], o: FineOptions, expect?: readonly { seed: number; N: number }[]): FineRadius[] {
  const J = o.jMax + o.Kf - 1;
  if (expect) {
    const key = (g: { seed: number; N: number }) => `${g.seed}/${g.N}`;
    const want = expect.map(key).sort(), got = groups.map(key).sort();
    if (JSON.stringify(want) !== JSON.stringify(got)) throw new Error(`fine: the groups are ${got.join(", ") || "none"}, N5 wants ${want.join(", ")}`);
    const notDone = groups.find((g) => g.status !== "done");
    if (notDone) throw new Error(`fine seed ${notDone.seed} N ${notDone.N}: ${notDone.status} in a done fine pilot`);
  }
  for (const g of groups) {
    if (g.status !== "done") continue;
    for (const p of g.pairs ?? []) {
      const bad = countsError(p, J);
      if (bad) throw new Error(`fine seed ${g.seed} N ${g.N} ${p.label}: ${bad}`);
      const got = fineReadings(finePointsOf(p), o);
      if (JSON.stringify(got) !== JSON.stringify(p.readings)) throw new Error(`fine seed ${g.seed} N ${g.N} ${p.label}: the counts give ${JSON.stringify(got)}, the record says ${JSON.stringify(p.readings)}`);
    }
    for (const R of radii)
      for (const kind of ["S", "K"] as const) {
        const n = (g.pairs ?? []).filter((p) => p.kind === kind && p.R === R).length;
        if (n !== 1) throw new Error(`fine seed ${g.seed} N ${g.N}: ${n} ${kind} pairs at R ${R}, not 1`);
      }
  }
  return radii.map((R) => {
    const rows: FineRadius["rows"] = [], sHorizons: FineRadius["sHorizons"] = [];
    for (const g of groups) {
      if (g.status !== "done") continue;
      const s = g.pairs!.find((p) => p.kind === "S" && p.R === R)!, k = g.pairs!.find((p) => p.kind === "K" && p.R === R)!;
      rows.push({ seed: g.seed, N: g.N, gS: s.readings.gapArea, gK: k.readings.gapArea });
      sHorizons.push({ seed: g.seed, N: g.N, fineHorizon: s.readings.fineHorizon });
    }
    return { R, verdict: fineVerdict(rows), rows, sHorizons };
  });
}

/** What a fine group file must agree with (N5): the plan's window and cadence, the prep's checkpoint, stone centre and kick. */
export interface FineBinding {
  seed: number;
  N: number;
  checkpointHash: string;
  stoneCentre: { x: number; y: number };
  kick: { x: number; y: number };
  window: number;
  every: number;
  Kf: number;
  jMax: number;
}

/**
 * A fine group file checked against what the plan and prep say it must be. Always: seed, N, window, every, Kf, jMax, and every
 * twin's lesion (S-R at the stone centre with radius R, K at the kick with radius 0, U0 none). When the file carries its own
 * `binding` (files written after it was added), every field of it as well, the checkpoint hash included. The first problem as
 * a sentence; null when it agrees.
 */
export function fineFileError(
  f: {
    seed?: unknown; N?: unknown; status?: unknown; window?: unknown; every?: unknown; Kf?: unknown; jMax?: unknown; binding?: FineBinding;
    u0?: { referenceChecked?: unknown };
    twins?: { name: string; lesion?: { x: number; y: number; r: number } | null; effectiveR?: unknown; finalStateHash?: unknown; runnerStateHash?: unknown; gateOk?: unknown }[];
  },
  want: FineBinding,
  radii: readonly number[],
  gate?: { u0Censuses: number },
): string | null {
  for (const k of ["seed", "N", "window", "every", "Kf", "jMax"] as const) if (f[k] !== want[k]) return `${k} is ${JSON.stringify(f[k])}, the plan and prep say ${want[k]}`;
  if (f.binding) {
    const why = fieldsDiffer(f.binding, want);
    if (why) return `binding: ${why}`;
  }
  const names = ["U0", ...radii.map((R) => `S${R}`), "K"];
  const got = (f.twins ?? []).map((t) => t.name);
  if (JSON.stringify(got) !== JSON.stringify(names)) return `twins are ${got.join(", ")}, not ${names.join(", ")}`;
  for (const t of f.twins!) {
    const l = t.lesion ?? null;
    const w = t.name === "U0" ? null : t.name === "K" ? { x: want.kick.x, y: want.kick.y, r: 0 } : { x: want.stoneCentre.x, y: want.stoneCentre.y, r: Number(t.name.slice(1)) };
    if (JSON.stringify(l) !== JSON.stringify(w)) return `${t.name}'s lesion is ${JSON.stringify(l)}, not ${JSON.stringify(w)}`;
  }
  return gate ? fineGateError(f, gate.u0Censuses) : null;
}

/**
 * The gate evidence of a done fine group (N5), in a group file or in the record (the same check at build and at read): status
 * done, U0 checked against #55 at every census the window reaches, every twin's lesion applied at its radius, and every
 * twin's final state equal to the same twin through runExperiment. The first problem as a sentence; null when it holds.
 */
export function fineGateError(
  f: { status?: unknown; u0?: { referenceChecked?: unknown }; twins?: { name: string; lesion?: { x: number; y: number; r: number } | null; effectiveR?: unknown; finalStateHash?: unknown; runnerStateHash?: unknown; gateOk?: unknown }[] },
  u0Censuses: number,
): string | null {
  if (f.status !== "done") return `status is ${JSON.stringify(f.status)}, not "done"`;
  if (f.u0?.referenceChecked !== u0Censuses) return `U0 was checked against #55 at ${JSON.stringify(f.u0?.referenceChecked)} censuses, not ${u0Censuses}`;
  if (!Array.isArray(f.twins) || !f.twins.length) return "no twins";
  for (const t of f.twins) {
    if (typeof t.finalStateHash !== "string" || !t.finalStateHash) return `${t.name} has no final state hash`;
    if (t.gateOk !== true || t.runnerStateHash !== t.finalStateHash) return `${t.name}'s gate: fine path ${t.finalStateHash}, runExperiment ${JSON.stringify(t.runnerStateHash)}, gateOk ${JSON.stringify(t.gateOk)}`;
    if (t.name !== "U0" && (!t.lesion || t.effectiveR !== t.lesion.r)) return `${t.name}'s lesion was applied with radius ${JSON.stringify(t.effectiveR)}, not ${JSON.stringify(t.lesion?.r)}`;
  }
  return null;
}

/** A done fine pilot's top file (N5): no failures, and every anchor of `want` (seed, N, R, steps, hash) reproduced. */
export function fineTopError(top: { status?: unknown; failures?: unknown; anchors?: unknown }, want: readonly { seed: number; N: number; R: number; steps: number; want: string }[]): string | null {
  if (top.status !== "done") return null;
  if (!Array.isArray(top.failures) || top.failures.length) return `a done fine pilot lists failures ${JSON.stringify(top.failures)}`;
  const got = Array.isArray(top.anchors) ? (top.anchors as { seed: number; N: number; R: number; steps: number; want: string; hash?: string; ok?: boolean }[]) : [];
  if (got.length !== want.length) return `${got.length} anchors, not ${want.length}`;
  for (const w of want) {
    const x = got.find((y) => y.seed === w.seed && y.N === w.N && y.R === w.R && y.steps === w.steps);
    if (!x) return `anchor seed ${w.seed} N ${w.N} S${w.R} +${w.steps} is missing`;
    if (x.ok !== true || x.hash !== w.want || x.want !== w.want) return `anchor seed ${w.seed} N ${w.N} S${w.R} +${w.steps}: hash ${JSON.stringify(x.hash)}, want ${w.want}`;
  }
  return null;
}

/** A grid of (seed, N) groups that must equal another exactly (N2: slice 34's groups are #55's). The first problem, or null. */
export function gridError(got: readonly { seed: number; N: number }[], want: readonly { seed: number; N: number }[], what: string): string | null {
  const key = (g: { seed: number; N: number }) => `${g.seed}/${g.N}`;
  const a = got.map(key).sort(), b = want.map(key).sort();
  return JSON.stringify(a) === JSON.stringify(b) ? null : `${what}: the groups are ${a.join(", ") || "none"}, #55's are ${b.join(", ")}`;
}

// ---- The readings (N6)

/** N6's order for K pairs: no mark below every horizon, censored above (this reading only). Null for an excluded outcome. */
export function kValue(o: { kind: string; steps?: number }): number | null {
  if (o.kind === "no-mark") return -1;
  if (o.kind === "horizon") return o.steps!;
  if (o.kind === "censored") return Infinity;
  return null;
}

/** K at least half S on N6's order (a censored S needs a censored K; no mark is never at least half a horizon). */
const atLeastHalf = (k: number, s: number) => (s === Infinity ? k === Infinity : 2 * k >= s);

export interface NullRadiusReading {
  R: number;
  label: string;
  /** `valid`: the matched groups (K|R a horizon, censored or no mark, and S-R a horizon or censored), sorted on N6's order. */
  k: { valid: { seed: number; N: number; value: number }[]; excluded: { seed: number; N: number; kind: string }[]; noMark: number; horizons: number; censored: number; median: number | null };
  /** #55's S-R median by §8's rule over the same matched groups (Infinity: censored); null when none is matched. */
  sMedian: number | null;
  verdict: "divergence clock" | "stone effect" | "no reading";
  paired: { atLeastHalf: number; of: number };
  text: string;
}

export interface NullReadoutOptions {
  kMax: number;
  censusEvery: number;
  wander: number;
  /** The fine pilot's verdicts and fine horizons, per radius (absent when it did not run). */
  fine?: readonly FineRadius[];
  fineWindow?: number;
}

const fmtValue = (v: number | null, window: number) => (v === null ? "none" : v === -1 ? "no mark" : v === Infinity ? `censored (> ${fmt(window)})` : `${fmt(v)} steps`);
const sValue = (p: PairRecord) => (p.outcome.kind === "horizon" ? p.outcome.steps : p.outcome.kind === "censored" ? Infinity : null);
const byValue = (a: number, b: number) => (a === b ? 0 : a < b ? -1 : 1);
const medianOf = (v: readonly number[]) => (v.length ? v[Math.floor((v.length - 1) / 2)] : null);

/**
 * N6's matching: per (seed, N) at radius R, the K|R value on N6's order and #55's S-R value. A group is matched when both are
 * valid ("over the groups where both ran"); the others are excluded with the reason. Both medians are taken over the matched
 * groups only, so a group whose K never ran (a cap skip) or whose K is extinct cannot move the stone's median.
 */
export function matchedPairs(kPairs: readonly PairRecord[], sPairs: readonly PairRecord[], R: number) {
  const matched: { seed: number; N: number; value: number; s: number }[] = [];
  const excluded: { seed: number; N: number; kind: string }[] = [];
  for (const p of kPairs.filter((x) => x.R === R)) {
    const v = kValue(p.outcome as { kind: string; steps?: number });
    if (v === null) {
      excluded.push({ seed: p.seed, N: p.N, kind: p.outcome.kind });
      continue;
    }
    const s = sPairs.find((x) => x.R === R && x.seed === p.seed && x.N === p.N);
    const sv = s ? sValue(s) : null;
    if (sv === null) {
      excluded.push({ seed: p.seed, N: p.N, kind: `stone ${s ? s.outcome.kind : "missing"}` });
      continue;
    }
    matched.push({ seed: p.seed, N: p.N, value: v, s: sv });
  }
  matched.sort((a, b) => byValue(a.value, b.value) || a.N - b.N || a.seed - b.seed);
  const kMedian = medianOf(matched.map((m) => m.value));
  const sMedian = medianOf(matched.map((m) => m.s).sort(byValue));
  const half = matched.filter((m) => atLeastHalf(m.value, m.s)).length;
  return { matched, excluded, kMedian, sMedian, paired: { atLeastHalf: half, of: matched.length } };
}

/** N6's coarse readings per radius from the K pairs and #55's stone pairs, and the pace line on R = 32. */
export function nullReadout(kPairs: readonly PairRecord[], sPairs: readonly PairRecord[], o: NullReadoutOptions): { radii: NullRadiusReading[]; pace: string } {
  const window = o.kMax * o.censusEvery - 1;
  const radii = [...new Set(kPairs.map((p) => p.R))].sort((a, b) => a - b);
  const out = radii.map((R): NullRadiusReading => {
    const label = `K|${R}`;
    const m = matchedPairs(kPairs, sPairs, R);
    const valid = m.matched.map(({ seed, N, value }) => ({ seed, N, value }));
    const median = m.kMedian, sMedian = m.sMedian, paired = m.paired;
    const k = { valid, excluded: m.excluded, noMark: valid.filter((v) => v.value === -1).length, horizons: valid.filter((v) => Number.isFinite(v.value) && v.value >= 0).length, censored: valid.filter((v) => v.value === Infinity).length, median };
    if (median === null || sMedian === null) {
      const why = kPairs.some((p) => p.R === R && kValue(p.outcome as { kind: string }) !== null) ? "no group with a valid stone pair as well" : "no valid K pair";
      return { R, label, k, sMedian, verdict: "no reading", paired, text: `${label}: no reading (${why})` };
    }
    const clock = atLeastHalf(median, sMedian);
    const verdict = clock ? "divergence clock" : "stone effect";
    const text = `${label}: ${valid.length} valid (no mark ${k.noMark}, horizons ${k.horizons}, censored ${k.censored}); median ${fmtValue(median, window)} against the S-${R} median ${fmtValue(sMedian, window)}: ${verdict} at R = ${R} (the K median is ${clock ? "at least" : "under"} half the stone's); paired: ${paired.atLeastHalf} of ${paired.of} groups with K|${R} at least half S-${R}`;
    return { R, label, k, sMedian, verdict, paired, text };
  });
  const r32 = out.find((r) => r.R === 32);
  const f32 = o.fine?.find((f) => f.R === 32);
  // How firm the R = 32 verdict is: its paired count and what the neighbouring radii read (they decide nothing).
  const others = out.filter((r) => r.R !== 32).map((r) => `R = ${r.R} ${r.verdict}`).join(", ");
  const firmness = r32 && r32.verdict !== "no reading" ? ` (paired ${r32.paired.atLeastHalf} of ${r32.paired.of}${others ? `; ${others}` : ""})` : "";
  const fineGroups = f32 ? f32.sHorizons.map((r) => r.N).filter((N, i, a) => a.indexOf(N) === i).map((N) => fmt(N)).join(", ") : "";
  let pace: string;
  if (!r32 || r32.verdict === "no reading") pace = "Pace: no reading (no valid K|32 or S-32 reading).";
  else if (r32.verdict === "stone effect")
    pace = `Pace: a stone effect at R = 32${firmness}: #55's R = 32 reading stands (median ${fmtValue(r32.sMedian, window)}), with its saturation caveat; the day stays one wander, and no garden setting changes.`;
  else {
    let fine: string;
    const fw = o.fineWindow ?? 0;
    if (!f32 || f32.verdict === "no reading") fine = "the fine pilot gives no reading at R = 32, so nothing here says how legible a stone is in its first censuses";
    else if (f32.verdict === "material") {
      const hs = f32.sHorizons.map((h) => (h.fineHorizon.kind === "horizon" ? `${fmt(h.fineHorizon.steps)}` : `> ${fmt(h.fineHorizon.window)}`)).join(", ");
      fine = `the fine verdict at R = 32 is material (on the fine pilot's groups only, N = ${fineGroups}): a stone is a mark legible for about its fine horizon (S-32: ${hs} steps)`;
    } else if (f32.verdict === "like a kick") fine = `the fine verdict at R = 32 is like a kick (on the fine pilot's groups only, N = ${fineGroups}): no measure here separates a stone from any perturbation at either grain`;
    else fine = `the fine verdict at R = 32 is mixed (on the fine pilot's groups only, N = ${fineGroups}): the groups disagree on whether a stone's early mark exceeds a kick's`;
    pace = `Pace: a divergence clock at R = 32${firmness}: #55's R = 32 horizons time divergence, and the pace reading rests on the first censuses: ${fine}. The day stays one wander (the legibility seen here is at most the fine window, ${fmt(fw)} steps${fw ? "" : ", not run"}), and no garden setting changes.`;
  }
  return { radii: out, pace };
}

/**
 * A side reading (not in N6; it decides nothing): N6's coarse comparison split by day (checkpoint N), on the same matched
 * groups and the same median rule, so a reader can see which days a radius's verdict comes from.
 */
export function nullByDay(kPairs: readonly PairRecord[], sPairs: readonly PairRecord[], radii: readonly number[]) {
  const days = [...new Set(kPairs.map((p) => p.N))].sort((a, b) => a - b);
  return radii.map((R) => ({
    R,
    days: days.map((N) => {
      const m = matchedPairs(kPairs.filter((p) => p.N === N), sPairs, R);
      return { N, k: m.matched.map((x) => ({ seed: x.seed, value: x.value, s: x.s })), kMedian: m.kMedian, sMedian: m.sMedian, paired: m.paired, verdict: m.kMedian === null || m.sMedian === null ? "no reading" : atLeastHalf(m.kMedian, m.sMedian) ? "K at least half S" : "K under half S" };
    }),
  }));
}

/**
 * A side reading of one fine pair (not in N5; it decides nothing): the first reading at which either region differs at all,
 * and how many readings have an empty near union. A fine horizon that starts before the first difference is vacuous: near
 * <= far held because nothing had happened yet, which N5 (unlike §5's no mark) has no class for.
 */
export function fineQuiet(p: Pick<FinePairRecord, "nearDiff" | "nearUnion" | "farDiff" | "farUnion" | "readings">) {
  const i = p.nearDiff.findIndex((d, j) => d > 0 || p.farDiff[j] > 0);
  const firstDiff = i < 0 ? null : i + 1;
  const emptyNear = p.nearUnion.filter((u) => u === 0).length;
  const fh = p.readings.fineHorizon;
  const vacuous = fh.kind === "horizon" && (firstDiff === null || fh.j < firstDiff);
  return { firstDiff, emptyNear, vacuous };
}

/** N7's worst cases (seconds at `rate`, the pilot's twin rate times the factor): a group, and the fine pilot. */
export function nullGroupWorst(o: { n0: number; kMax: number; K: number; chunk: number; censusEvery: number; rate: number }): number {
  return ((2 * lastCensus({ K: o.K, kMax: o.kMax }) + o.chunk + o.chunk * o.n0) * o.censusEvery) / o.rate;
}

/** Five twins on two paths per day-1 group, 30% for the readings, plus the S64 anchor (and the S8 anchor when the window stops short of it). */
export function fineWorstSeconds(o: { window: number; rate: number; groups: number; anchors: readonly { N: number; steps: number }[]; day1: number }): number {
  let s = o.groups * 5 * 2 * o.window * 1.3;
  for (const x of o.anchors) if (x.N !== o.day1 || x.steps > o.window) s += x.steps * 1.3;
  return s / o.rate;
}

/**
 * N7's scale-down, fixed before the run: the full fine window (8,192) and K window (128) if elapsed + the day-1 groups' worst
 * cases + the fine pilot's worst case fit the cap; else the fine window drops to 4,096; if that still does not fit, the K
 * window drops to 64 censuses as well.
 */
export function nullScaleDown(o: { capSeconds: number; elapsed: number; day1Worst: (kMax: number) => number; fineWorst: (window: number) => number }) {
  const budget = (window: number, kMax: number) => o.elapsed + o.day1Worst(kMax) + o.fineWorst(window);
  if (budget(8192, 128) <= o.capSeconds) return { window: 8192, kMax: 128, scaleDown: "none", budget: budget(8192, 128) };
  if (budget(4096, 128) <= o.capSeconds) return { window: 4096, kMax: 128, scaleDown: "the fine window drops to 4,096 steps (N7)", budget: budget(4096, 128) };
  return { window: 4096, kMax: 64, scaleDown: "the fine window drops to 4,096 steps and the K pairs' window to 64 censuses (N7)", budget: budget(4096, 64) };
}

// ---- Group files of slice 34 and their binding

/** The first field where `stored` differs from `want`, as a sentence; null when they agree. */
export function fieldsDiffer<T extends object>(stored: T, want: T): string | null {
  for (const k of Object.keys(want) as (keyof T)[]) {
    const a = JSON.stringify(stored[k]), b = JSON.stringify(want[k]);
    if (a !== b) return `${String(k)} is ${a} in the group file, ${b} in this run`;
  }
  return null;
}

export interface NullBinding {
  seed: number;
  N: number;
  checkpointHash: string;
  stoneCentre: { x: number; y: number };
  nulls: { R: number; x: number; y: number }[];
  noNull: number[];
  r0: number;
  kick: { x: number; y: number };
  K: number;
  kMax: number;
  censusEvery: number;
  chunk: number;
  entryStep: number;
}

export function nullBindingError(stored: NullBinding | undefined, want: NullBinding): string | null {
  if (!stored) return "the group file carries no binding";
  return fieldsDiffer(stored, want);
}

export interface NullPrep {
  stoneCentre: { x: number; y: number };
  r0: number;
  stale: number;
  nulls: ({ R: number; x: number; y: number; count: number } | { R: number; none: true })[];
  kick: KickCell;
}

export interface NullGroupFile {
  seed: number;
  N: number;
  /** "not run (stopped)": the run ended (a fault elsewhere) before this group started. */
  status: "done" | "not run (cap)" | "not run (stopped)" | "void";
  binding?: NullBinding;
  prep?: NullPrep;
  result?: ArmsResult;
  fault?: string;
  uptime?: string;
  ps?: string;
  startedAt?: string;
}

/** A slice-34 group as the record carries it (N8): per K pair the outcome and the integer counts per census, the living cells of K and U0. */
export function compactNullGroup(g: NullGroupFile) {
  const head = { seed: g.seed, N: g.N, status: g.status, ...(g.prep ? { prep: g.prep } : {}), ...(g.fault ? { fault: g.fault } : {}) };
  if (!g.result) return head;
  const r = g.result;
  const { living: kLiving, ...kick } = r.kick;
  const { living: u0Living, ...u0 } = r.u0;
  return {
    ...head,
    stoppedByCap: r.stoppedByCap,
    seconds: Math.round(r.seconds),
    control: r.control,
    u0: { ...u0, living: u0Living },
    nulls: r.nulls,
    kick: { ...kick, living: kLiving },
    pairs: r.pairs.map((p) => ({
      label: p.label,
      R: p.R,
      outcome: p.outcome,
      nearDiff: p.series.map((q) => q.near.diff),
      nearUnion: p.series.map((q) => q.near.union),
      farDiff: p.series.map((q) => q.far.diff),
      farUnion: p.series.map((q) => q.far.union),
    })),
  };
}

export type CompactNullGroup = {
  seed: number;
  N: number;
  status: string;
  u0?: { living: number[] };
  kick?: { living: number[] };
  pairs?: { label: string; R: number; outcome: StoneOutcome; nearDiff: number[]; nearUnion: number[]; farDiff: number[]; farUnion: number[] }[];
};

/** The K pairs of a slice-34 record, each outcome recomputed from the integer counts and checked against the stored one. */
export function recomputeNullPairs(groups: readonly CompactNullGroup[], radii: readonly number[], o: HorizonOptions): PairRecord[] {
  const pairs: PairRecord[] = [];
  for (const g of groups)
    for (const R of radii) {
      if (g.status !== "done") {
        const kind = g.status === "not run (cap)" ? "not-run-cap" : g.status === "not run (stopped)" ? "not-run-stopped" : "void";
        pairs.push({ seed: g.seed, N: g.N, R, outcome: { kind } as unknown as PairRecord["outcome"] });
        continue;
      }
      const all = g.pairs?.filter((x) => x.R === R) ?? [];
      const p = all[0];
      if (all.length !== 1 || !g.u0 || !g.kick) throw new Error(`group seed ${g.seed} N ${g.N}: ${all.length} K pairs at R ${R}${g.u0 && g.kick ? "" : ", or no U0 or kick"}`);
      const bad = countsError(p) ?? (p.nearDiff.length === 0 ? "no census" : g.kick.living.length < p.nearDiff.length || g.u0.living.length < p.nearDiff.length ? "fewer living counts than censuses" : null);
      if (bad) throw new Error(`group seed ${g.seed} N ${g.N} ${p.label}: ${bad}`);
      const got = horizonOf(pointsOf({ ...p, living: g.kick.living.slice(0, p.nearDiff.length) }, g.u0.living), o);
      const ok = p.outcome.kind === "stopped-cap" ? got.kind === "pending" : JSON.stringify(got) === JSON.stringify(p.outcome);
      if (!ok) throw new Error(`group seed ${g.seed} N ${g.N} ${p.label}: the record's counts give ${JSON.stringify(got)}, its outcome says ${JSON.stringify(p.outcome)}`);
      pairs.push({ seed: g.seed, N: g.N, R, outcome: p.outcome });
    }
  return pairs;
}

/** #55's stone pairs recomputed from its own record's counts (§5), restricted to the given groups: what N6 reads K against. */
export function sPairsFrom55(rec55: { groups: Parameters<typeof recomputePairs>[0]; cap: { kMax: number } }, groups: readonly { seed: number; N: number }[], radii: readonly number[], o: { K: number; censusEvery: number }): PairRecord[] {
  return recomputePairs(rec55.groups, radii, { K: o.K, kMax: rec55.cap.kMax, censusEvery: o.censusEvery }).filter((p) => groups.some((g) => g.seed === p.seed && g.N === p.N));
}

export interface NullRecordView {
  kMax: number;
  groups: readonly CompactNullGroup[];
  sPairs: PairRecord[];
  fine: {
    status: string; window?: number; jMax?: number; anchors?: unknown; failures?: unknown;
    groups?: { seed: number; N: number; status: string; pairs?: FinePairRecord[]; u0?: { referenceChecked?: unknown }; twins?: Parameters<typeof fineGateError>[0]["twins"] }[];
  };
}

/**
 * Slice 34's readings from a record (N6, N8): the K pairs and the fine readings recomputed from the integer counts (throwing on
 * any disagreement or malformed count), then N6's readout, or "nothing reads" when a group is void. The side readings (by day,
 * and the fine pairs' first difference) are carried beside it and decide nothing.
 */
export function nullReadings(
  rec: NullRecordView,
  c: {
    radii: readonly number[]; K: number; censusEvery: number; every: number; Kf: number; wander: number; day1: number;
    grid?: readonly { seed: number; N: number }[];
    /** N5's gate evidence a done fine pilot must carry: the anchors to reproduce and, per group, the U0 censuses checked. */
    fineGate?: { anchors: readonly { seed: number; N: number; R: number; steps: number; want: string }[]; u0Censuses: (g: { seed: number; N: number }) => number };
  },
) {
  // With `grid` (#55's groups, from its own record), the record must hold exactly those groups, and stone pairs for exactly
  // those groups at every radius, so the day-1 grid the fine readings are checked against is not taken from the record being
  // checked.
  if (c.grid) {
    const gridBad = gridError(rec.groups, c.grid, "record") ?? c.radii.reduce<string | null>((e, R) => e ?? gridError(rec.sPairs.filter((p) => p.R === R), c.grid!, `sPairs at R ${R}`), null);
    if (gridBad) throw new Error(gridBad);
    if (rec.sPairs.length !== c.grid.length * c.radii.length) throw new Error(`sPairs: ${rec.sPairs.length} pairs, not ${c.grid.length} groups x ${c.radii.length} radii`);
  }
  // With `fineGate`, a done fine pilot reads only with its gate evidence intact (no failures, anchors reproduced, every
  // group's gates passed), the same checks nullrecord made when it built the record.
  if (c.fineGate && rec.fine.status === "done") {
    const top = fineTopError(rec.fine, c.fineGate.anchors);
    if (top) throw new Error(`fine: ${top}`);
    for (const g of rec.fine.groups ?? []) {
      const why = fineGateError(g, c.fineGate.u0Censuses(g));
      if (why) throw new Error(`fine seed ${g.seed} N ${g.N}: ${why}`);
    }
  }
  const kPairs = recomputeNullPairs(rec.groups, c.radii, { K: c.K, kMax: rec.kMax, censusEvery: c.censusEvery });
  const day1 = rec.groups.filter((g) => g.N === c.day1).map((g) => ({ seed: g.seed, N: g.N }));
  const fineRadii: FineRadius[] | undefined = rec.fine.status === "done" ? recomputeFine(rec.fine.groups ?? [], c.radii, { every: c.every, Kf: c.Kf, jMax: rec.fine.jMax! }, day1) : undefined;
  if (fineRadii && rec.fine.window !== (rec.fine.jMax! + c.Kf - 1) * c.every) throw new Error(`fine: window ${rec.fine.window} is not (jMax ${rec.fine.jMax} + ${c.Kf - 1}) * ${c.every}`);
  const voidGroups = rec.groups.filter((g) => g.status === "void");
  if (voidGroups.length) return { fault: `a fault voided ${voidGroups.map((g) => `seed ${g.seed} N ${g.N} (${(g as { fault?: string }).fault ?? "no message"})`).join(", ")}: nothing reads (N6)`, kPairs, fine: fineRadii ?? null, radii: [], pace: "Pace: nothing reads (N6).", side: null };
  const ro = nullReadout(kPairs, rec.sPairs, { kMax: rec.kMax, censusEvery: c.censusEvery, wander: c.wander, fine: fineRadii, fineWindow: rec.fine.status === "done" ? rec.fine.window : 0 });
  const side = {
    byDay: nullByDay(kPairs, rec.sPairs, c.radii),
    fineQuiet: fineRadii ? (rec.fine.groups ?? []).flatMap((g) => (g.pairs ?? []).map((p) => ({ seed: g.seed, N: g.N, label: p.label, ...fineQuiet(p) }))) : [],
  };
  return { fault: null, kPairs, fine: fineRadii ?? null, ...ro, side };
}

/**
 * N8: the note as it was before its slice-34 readout was appended: everything up to and including the newline that ends the
 * line before the blank line above the readout heading (the readout is appended as "\n" + heading + "\n" ...). The whole
 * note while the heading is absent.
 */
export function notePrefix(note: Uint8Array, heading: string): Uint8Array {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(note);
  const at = text.indexOf(`\n\n${heading}\n`);
  if (at < 0) return note;
  return new TextEncoder().encode(text.slice(0, at + 1));
}

// ---- The run's receipts and the cap inside the fine pilot (N7, N8)

/**
 * The run script's status file (N7, N8): per stage its start, `uptime`, the `ps` lines and exit code, and the note's SHA-256
 * taken before the pilot. Lines it does not know are kept under `other`.
 */
export function parseRunStatus(text: string) {
  const stages: { stage: string; at: string; uptime?: string; ps: string[]; exit?: number }[] = [];
  const other: string[] = [];
  const out: { started?: string; noteSha256BeforePilot?: string; noteSha256AtEnd?: string; done?: string } = {};
  let cur: (typeof stages)[number] | null = null;
  for (const line of text.split("\n")) {
    let m: RegExpMatchArray | null;
    if ((m = line.match(/^== (\S+) (\S+)$/))) stages.push((cur = { stage: m[1], at: m[2], ps: [] }));
    else if ((m = line.match(/^exit (\S+) (\d+)$/)) && cur && cur.stage === m[1]) cur.exit = Number(m[2]);
    else if ((m = line.match(/^started (\S+)$/))) out.started = m[1];
    else if ((m = line.match(/^note-sha256-before-pilot ([0-9a-f]{64})$/))) out.noteSha256BeforePilot = m[1];
    else if ((m = line.match(/^note-sha256-at-end ([0-9a-f]{64})$/))) out.noteSha256AtEnd = m[1];
    else if ((m = line.match(/^DONE (\S+)$/))) out.done = m[1];
    else if (cur && cur.exit === undefined && cur.uptime === undefined && /load averages?:/.test(line)) cur.uptime = line;
    else if (cur && cur.exit === undefined && /^\s*\d+\s/.test(line)) cur.ps.push(line);
    else if (line.trim() && !(cur && cur.exit !== undefined && /^( M|\?\?|A |D ) /.test(line))) other.push(line);
  }
  return { ...out, stages, ...(other.length ? { other } : {}) };
}

/**
 * N8's guard on the status file when one is given: exactly one `note-sha256-before-pilot` line, a 64-digit lowercase hex
 * hash, equal to the plan's rules digest. A missing, malformed, repeated or different declaration is an error (the sentence),
 * never a pass; null when it holds.
 */
export function runStatusError(text: string, rulesDigest: string): string | null {
  const lines = text.split("\n").filter((l) => /^note-sha256-before-pilot\b/.test(l));
  if (lines.length === 0) return "no note-sha256-before-pilot line";
  if (lines.length > 1) return `${lines.length} note-sha256-before-pilot lines, not 1`;
  const m = lines[0].match(/^note-sha256-before-pilot ([0-9a-f]{64})$/);
  if (!m) return `a malformed note-sha256-before-pilot line: ${JSON.stringify(lines[0])}`;
  if (m[1] !== rulesDigest) return `the note hashed ${m[1]} before the pilot, the plan's rules digest is ${rulesDigest}`;
  return null;
}

/** The fine pilot's cap overtaking it (N7): the pilot stops where it is and is recorded "stopped (cap)". */
export class FineCap extends Error {
  override name = "FineCap";
}

/**
 * A segment run under N7's deadline: `run` gets a per-census callback that returns true (stop now) once `now()` has passed
 * `deadline`; if it ever did, the segment's result is discarded and FineCap is thrown, so a gate the cap overtakes mid-way
 * never reads as a gate that ran (or failed).
 */
export async function cappedRun<T>(run: (stop: () => boolean) => Promise<T>, now: () => number, deadline: number, where: string): Promise<T> {
  let hit = false;
  const r = await run(() => (hit = hit || now() > deadline));
  // Also past the deadline after the last census (the final readback and hash run after the callback): discarded too.
  if (hit || now() > deadline) throw new FineCap(`the cap's deadline passed during ${where}`);
  return r;
}
