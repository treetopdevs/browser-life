// Bootstrap-screen readouts, sizing rules, vote rule and labels (docs/mycelium-bootstrap-2026-11-14/DESIGN.md sections 7 to 10), EXPLORATORY.
//
// Pure functions of a state or of numbers: no Deno, no file system, no clock. The existing observers (observe-r2b, observe-r4, observe-conduit)
// are imported by the runner unchanged; this module holds only what is new: the exact intake identity and windowed pair statistics, the road,
// TM above and below the free layer, the cross-column flux, the owner census, the sizing rules R1 to R6, the vote rule and the label functions.
import { conduitRate, laidCell, ownerRate, ownerTag, POS_SHIFT, shiftCell, type MyceliumState } from "./world.ts";

// ---- constants fixed in the design -----------------------------------------------------------------------------

/** Floor of the intake threshold, and the fixed margin of every safeguard (population, deaths, births). Round numbers set before any run. */
export const THR_FLOOR = 0.03;
/** A noise floor above this makes an intake threshold or a safeguard unresolved. */
export const NF_UNRESOLVED = 0.10;
/** A primary window shorter than this many steps is UNREADABLE. */
export const PW_MIN = 150;
/** Share of the headroom the sized conduit strengths target (10 to 60 percent). */
export const EFF_BAND: readonly [number, number] = [9, 53];

const sumOf = (a: ArrayLike<number>, n = a.length): number => { let t = 0; for (let k = 0; k < n; k++) t += a[k]; return t; };
const median = (a: readonly number[]): number | null => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const pctOf = (sorted: ArrayLike<number>, p: number): number | null => (sorted.length === 0 ? null : sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]);
/** The four neighbours of cell k in the rule's direction order (east, west, south, north). */
function nbrs(k: number, W: number, H: number): [number, number, number, number] {
  const cx = k % W, cy = (k / W) | 0;
  return [cy * W + ((cx + 1) % W), cy * W + ((cx + W - 1) % W), ((cy + 1) % H) * W + cx, ((cy + H - 1) % H) * W + cx];
}

// ---- observer safety -------------------------------------------------------------------------------------------

/**
 * A view of the state that is safe to hand to the existing observers. observe-r2b.ts's depositMeasure runs one real step on cloneNoDecay(s), and
 * cloneNoDecay copies every plane except the owner planes Z and Q, which the copy then shares with the live state: in an owner world the step
 * rewrites the live state's Z and Q (Q above P afterwards, validateState fails). The existing observers are used unchanged, so the runner gives them
 * this view, with Z and Q copied; the pristine state is what branches and checkpoints use.
 */
export function observerView(s: MyceliumState): MyceliumState {
  return s.Z && s.Q ? { ...s, Z: s.Z.slice(), Q: s.Q.slice() } : s;
}

// ---- exact intake and windowed pair statistics -----------------------------------------------------------------

/** What a read keeps: cumulative exact totals, the live count and the two field sums the identities need. */
export interface Snap { step: number; n: number; births: number; deaths: number; lightIn: number; sumA: number; sumP: number; free?: number; paid?: number }

export function snapOf(s: MyceliumState): Snap {
  const sn: Snap = { step: s.step, n: s.n, births: s.totals.births, deaths: s.totals.deaths, lightIn: s.totals.lightIn, sumA: sumOf(s.A), sumP: sumOf(s.P) };
  if (s.totals.freeUnits !== undefined) { sn.free = s.totals.freeUnits; sn.paid = s.totals.paidUnits; }
  return sn;
}

/**
 * Exact intake between two reads, in nutrient units: A enters only by light (C to A at eA energy per unit, so lightIn / eA units) and leaves only by
 * eating; diffusion is a pure move; deaths and excretion go to C. So I = sum A(a) + (lightIn(b) - lightIn(a)) / eA - sum A(b), an integer.
 * Throws when the light energy is not a whole number of units (a ledger problem, never rounded away).
 */
export function intakeBetween(a: Snap, b: Snap, eA: number): number {
  const dl = b.lightIn - a.lightIn;
  if (dl % eA !== 0) throw new Error(`light energy ${dl} between steps ${a.step} and ${b.step} is not a whole number of units of ${eA}`);
  return a.sumA + dl / eA - b.sumA;
}

/** Per-interval intakes of consecutive reads. */
export const intakesOf = (snaps: readonly Snap[], eA: number): number[] => snaps.slice(1).map((b, k) => intakeBetween(snaps[k], b, eA));

/** The telescoping check: the sum of the per-interval intakes equals the intake from the first to the last read. null when it holds. */
export function telescopeProblem(snaps: readonly Snap[], eA: number): string | null {
  if (snaps.length < 2) return null;
  const parts = intakesOf(snaps, eA), whole = intakeBetween(snaps[0], snaps[snaps.length - 1], eA);
  const t = sumOf(parts);
  if (parts.some((x) => !Number.isInteger(x) || x < 0)) return `a per-interval intake is not a non-negative integer (${parts.find((x) => !Number.isInteger(x) || x < 0)})`;
  return t === whole ? null : `sum of per-interval intakes ${t} differs from the telescoped intake ${whole}`;
}

/**
 * The same intake from the MATTER ledger instead of the A field (an independent route, used by tests): matter A + C + P + sum M is constant, light
 * moves lightIn / eA units from C to A, so I = lightUnits + dC + dP + dM between two states. Exactly equal to intakeBetween on a closed ledger.
 */
export function matterIntake(a: MyceliumState, b: MyceliumState): number {
  const dl = b.totals.lightIn - a.totals.lightIn, eA = a.config.eA;
  if (dl % eA !== 0) throw new Error("light energy is not a whole number of units");
  return dl / eA + (sumOf(b.C) - sumOf(a.C)) + (sumOf(b.P) - sumOf(a.P)) + (sumOf(b.M, b.n) - sumOf(a.M, a.n));
}

/**
 * The independent check of one interval: the intake from the two Snaps (A field and light) against the intake from the MATTER ledger of the two full
 * states (matterIntake: C, P, M). They are different routes to one integer, so a disagreement is a ledger or readout fault (the telescoping sum of
 * intakeBetween alone cannot fail). null when they agree.
 */
export function independentIntakeProblem(a: MyceliumState, b: MyceliumState, sa: Snap, sb: Snap): string | null {
  const viaSnaps = intakeBetween(sa, sb, a.config.eA), viaMatter = matterIntake(a, b);
  return viaSnaps === viaMatter ? null : `intake between steps ${sa.step} and ${sb.step}: ${viaSnaps} from the A field, ${viaMatter} from the matter ledger`;
}

export interface WindowSide { lo: number; hi: number; births: number; deaths: number; nSum: number; intake: number; free?: number; paid?: number }

/** One side of a pair over the window (lo, hi]: both ends must be reads. nSum is the trapezoid of n over the reads inside, on the read grid. */
export function windowSide(snaps: readonly Snap[], lo: number, hi: number, eA: number): WindowSide | null {
  const i0 = snaps.findIndex((x) => x.step === lo), i1 = snaps.findIndex((x) => x.step === hi);
  if (i0 < 0 || i1 < 0 || i1 <= i0) return null;
  let nSum = 0;
  for (let k = i0; k < i1; k++) nSum += ((snaps[k].n + snaps[k + 1].n) / 2) * (snaps[k + 1].step - snaps[k].step);
  const a = snaps[i0], b = snaps[i1];
  const w: WindowSide = { lo, hi, births: b.births - a.births, deaths: b.deaths - a.deaths, nSum, intake: intakeBetween(a, b, eA) };
  if (a.free !== undefined && b.free !== undefined) { w.free = b.free - a.free; w.paid = b.paid! - a.paid!; }
  return w;
}

/** Rates per particle-step: births b, deaths d, intake i; N is the mean population over the window. */
export function ratesOf(w: WindowSide): { b: number; d: number; i: number; N: number; free: number | null; paid: number | null } {
  const den = Math.max(w.nSum, 1e-12);
  return { b: w.births / den, d: w.deaths / den, i: w.intake / den, N: w.nSum / (w.hi - w.lo), free: w.free === undefined ? null : w.free / den, paid: w.paid === undefined ? null : w.paid / den };
}

/** Relative difference (a - b) / b; null when b is 0 and a is not (undefined, never silently zero). */
export const relOf = (a: number, b: number): number | null => (b === 0 ? (a === 0 ? 0 : null) : (a - b) / b);

export interface Rels { i: number | null; N: number | null; d: number | null; b: number | null; bd: number | null }
/** rel_x of `on` against the comparator, x in intake, population, deaths, births and births-plus-deaths (turnover). */
export function relsOf(on: WindowSide, comp: WindowSide): Rels {
  const a = ratesOf(on), c = ratesOf(comp);
  return { i: relOf(a.i, c.i), N: relOf(a.N, c.N), d: relOf(a.d, c.d), b: relOf(a.b, c.b), bd: relOf(a.b + a.d, c.b + c.d) };
}

/** Noise floor per metric: the maximum |rel| over the supplied pairs (null if any pair is undefined for that metric, which makes it unresolved). */
export type NoiseFloor = Rels;
export function noiseFloor(pairs: readonly Rels[]): NoiseFloor {
  const mx = (k: keyof Rels): number | null => {
    let m = 0;
    for (const p of pairs) { const v = p[k]; if (v === null) return null; m = Math.max(m, Math.abs(v)); }
    return pairs.length ? m : null;
  };
  return { i: mx("i"), N: mx("N"), d: mx("d"), b: mx("b"), bd: mx("bd") };
}

export interface Verdict {
  pay: boolean | null; payStrong: boolean | null; damp: boolean | null; harm: boolean | null;
  /** thr_i = max(3 percent, 2 * nf_i), and why a verdict is null (unresolved: counts as not passing, never as failing). */
  thrI: number | null; unresolved: string | null;
}

/**
 * PAY(on vs X): intake up by at least thr_i, population not lower, deaths not higher, births not lower (safeguards at a fixed 3 percent, never widened
 * by noise). DAMP: turnover down by 3 percent and intake not up by thr_i. HARM: population down by 3 percent. A window with thr_i above 10 percent, a
 * safeguard whose noise floor is above 10 percent, or an undefined relative difference is unresolved (null verdicts).
 */
export function judge(r: Rels, nf: NoiseFloor): Verdict {
  const nfi = nf.i;
  const thrI = nfi === null ? null : Math.max(THR_FLOOR, 2 * nfi);
  let why: string | null = null;
  if (thrI === null) why = "intake noise floor undefined";
  else if (thrI > NF_UNRESOLVED) why = `thr_i ${thrI.toFixed(3)} above ${NF_UNRESOLVED}`;
  else for (const k of ["N", "d", "b"] as const) { if (nf[k] === null || nf[k]! > NF_UNRESOLVED) { why = `safeguard noise ${k} unresolved`; break; } }
  if (!why && [r.i, r.N, r.d, r.b, r.bd].some((v) => v === null)) why = "a relative difference is undefined (zero comparator)";
  if (why) return { pay: null, payStrong: null, damp: null, harm: null, thrI, unresolved: why };
  const pay = r.i! >= thrI! && r.N! >= -THR_FLOOR && r.d! <= THR_FLOOR && r.b! >= -THR_FLOOR;
  return {
    pay, payStrong: pay && r.N! >= THR_FLOOR,
    damp: r.bd! <= -THR_FLOOR && !(r.i! >= thrI!), harm: r.N! <= -THR_FLOOR, thrI, unresolved: null,
  };
}

/** Branch windows of an L-step branch: three quarters-and-halves windows, the whole branch and its last half. */
export function branchWindows(L: number): Record<"q1" | "q2" | "h2" | "whole" | "last", [number, number]> {
  return { q1: [0, L / 4], q2: [L / 4, L / 2], h2: [L / 2, L], whole: [0, L], last: [L / 2, L] };
}

// ---- vote rule ------------------------------------------------------------------------------------------------

export type Vote = "Y" | "N" | "I";
export const need = (n: number): number => Math.ceil(0.75 * n);
export const atMost = (n: number): number => Math.floor(0.25 * n);
export const half = (n: number): number => Math.ceil(0.5 * n);
/**
 * Vote rule V for a question asked of n seeds: Y if at least ceil(0.75 n) pass, N if at least ceil(0.75 n) fail, else I. A seed with `null`
 * (unresolved or unreadable) counts as not passing and never as failing. Y and N cannot both hold (6 + 6 > 8).
 */
export function vote(seeds: readonly (boolean | null)[]): Vote {
  const n = seeds.length, k = need(n);
  if (seeds.filter((x) => x === true).length >= k) return "Y";
  if (seeds.filter((x) => x === false).length >= k) return "N";
  return "I";
}
/** The per-seed conjunction (joint vote): a seed passes when every predicate passes, fails when any fails, is unresolved otherwise. */
export function joint(...preds: (boolean | null)[][]): (boolean | null)[] {
  const n = preds[0].length;
  return Array.from({ length: n }, (_, k) => (preds.some((p) => p[k] === false) ? false : preds.every((p) => p[k] === true) ? true : null));
}

// ---- field readouts -------------------------------------------------------------------------------------------

export interface RoadCensus {
  laidCells: number; laidEdges: number;
  /** Share of laid cells with A >= 8, and of occupied cells with A = 0 (the desert share). */
  laidA8: number | null; desert: number | null;
  /** Median over directed laid edges (both end cells laid) of x_e = min(P_k, P_nb), and the shares of those edges with x_e >= 1, 2, 3. */
  xMed: number | null; xGe1: number | null; xGe2: number | null; xGe3: number | null;
  /** Share of particles on laid cells, the laid-area share, and their difference (ROAD). */
  onLaid: number | null; laidArea: number; road: number | null;
  /** Mean over ALL directed edges of the conduit rate at (g 255, q 1, 2, 3) on the present P: what a plateau conduit would give (the diffA match). */
  meanDd1: number; meanDd2: number; meanDd3: number;
}

/** Road readouts of a state; null when the config lays nothing (trailInit absent). Laid geometry is the rule's own laidCell. */
export function roadCensus(s: MyceliumState): RoadCensus | null {
  const c = s.config;
  if (c.trailInit === undefined) return null;
  const W = c.width, H = c.height, N = W * H, De = c.diffA;
  const laid = new Uint8Array(N);
  let laidCells = 0;
  for (let k = 0; k < N; k++) if (laidCell(c, k % W, (k / W) | 0)) { laid[k] = 1; laidCells++; }
  const cnt = new Uint32Array(N);
  for (let i = 0; i < s.n; i++) cnt[(s.y[i] >>> POS_SHIFT) * W + (s.x[i] >>> POS_SHIFT)]++;
  let a8 = 0, occ = 0, des = 0, onLaid = 0;
  const xs: number[] = [];
  let dd1 = 0, dd2 = 0, dd3 = 0;
  for (let k = 0; k < N; k++) {
    if (laid[k] && s.A[k] >= 8) a8++;
    if (cnt[k] > 0) { occ++; if (s.A[k] === 0) des++; if (laid[k]) onLaid += cnt[k]; }
    const nb = nbrs(k, W, H);
    for (let d = 0; d < 4; d++) {
      dd1 += conduitRate(De, 255, 1, s.P[k], s.P[nb[d]]); dd2 += conduitRate(De, 255, 2, s.P[k], s.P[nb[d]]); dd3 += conduitRate(De, 255, 3, s.P[k], s.P[nb[d]]);
      if (laid[k] && laid[nb[d]]) xs.push(Math.min(s.P[k], s.P[nb[d]]));
    }
  }
  const sx = Float64Array.from(xs).sort();
  const share = (m: number) => (xs.length ? xs.filter((x) => x >= m).length / xs.length : null);
  const laidArea = laidCells / N;
  const E = 4 * N;
  return {
    laidCells, laidEdges: xs.length, laidA8: laidCells ? a8 / laidCells : null, desert: occ ? des / occ : null,
    xMed: pctOf(sx, 0.5), xGe1: share(1), xGe2: share(2), xGe3: share(3),
    onLaid: s.n ? onLaid / s.n : null, laidArea, road: s.n ? onLaid / s.n - laidArea : null,
    meanDd1: dd1 / E, meanDd2: dd2 / E, meanDd3: dd3 / E,
  };
}

/** Mean over all directed edges of the public conduit rate for (g, q) on the present P (the diffA-matched twin is sized from this). */
export function meanEdgeRate(s: MyceliumState, g: number, q: number): number {
  const c = s.config, W = c.width, H = c.height, N = W * H;
  let t = 0;
  for (let k = 0; k < N; k++) { const nb = nbrs(k, W, H); for (let d = 0; d < 4; d++) t += conduitRate(c.diffA, g, q, s.P[k], s.P[nb[d]]); }
  return t / (4 * N);
}

/** The same for the owner conduit (needs Z and Q). */
export function meanOwnerEdgeRate(s: MyceliumState, g: number, q: number): number {
  if (!s.Z || !s.Q) throw new Error("the state has no owner planes");
  const c = s.config, W = c.width, H = c.height, N = W * H;
  let t = 0;
  for (let k = 0; k < N; k++) { const nb = nbrs(k, W, H); for (let d = 0; d < 4; d++) t += ownerRate(c.diffA, g, q, s.Z[k], s.Z[nb[d]], s.Q[k], s.Q[nb[d]]); }
  return t / (4 * N);
}

/**
 * MECH: the expected extra A flux across the mid-column line, sum over the H edges between column W/2 - 1 (west) and column W/2 (east) of
 * eff_e * (A[east] - A[west]) / 1024, with eff_e = conduitRate - diffA (the rule's own arithmetic). Positive: the bright (east) side holds more A,
 * so the extra flow is toward the dark side. A rotation-averaged proxy, like `imp`; from the snapshot, not a measured flow.
 */
export function xflux(s: MyceliumState, g: number, q: number): number {
  const c = s.config, W = c.width, H = c.height;
  let t = 0;
  for (let y = 0; y < H; y++) {
    const e = y * W + (W >> 1), w = y * W + (W >> 1) - 1;
    t += ((conduitRate(c.diffA, g, q, s.P[e], s.P[w]) - c.diffA) * (s.A[e] - s.A[w])) / 1024;
  }
  return t;
}

export interface TmSplit {
  /** Per particle: trail total, above the layer (sum of max(0, P - F)), inside the layer (sum of min(P, F)); null with no particle. */
  tm: number | null; tmAbove: number | null; tmFree: number | null;
  /** The same over occupied cells holding at most two particles only, per particle on those cells (clumping inflates the all-cell figure); null when none. */
  tmAbove2: number | null; tmFree2: number | null; particles2: number;
}

/** TM above and below the free-layer ceiling F, per particle. */
export function tmSplit(s: MyceliumState, F: number): TmSplit {
  const c = s.config, W = c.width, N = W * c.height;
  let above = 0, free = 0, tot = 0;
  const cnt = new Uint32Array(N);
  for (let i = 0; i < s.n; i++) cnt[(s.y[i] >>> POS_SHIFT) * W + (s.x[i] >>> POS_SHIFT)]++;
  let a2 = 0, f2 = 0, p2 = 0;
  for (let k = 0; k < N; k++) {
    const p = s.P[k];
    above += Math.max(0, p - F); free += Math.min(p, F); tot += p;
    if (cnt[k] > 0 && cnt[k] <= 2) { a2 += Math.max(0, p - F) * cnt[k]; f2 += Math.min(p, F) * cnt[k]; p2 += cnt[k]; }
  }
  // Per particle on the thin cells: each particle on a thin cell is credited its cell's trail (so a cell's trail is counted once per occupant, then divided by occupants).
  return { tm: s.n ? tot / s.n : null, tmAbove: s.n ? above / s.n : null, tmFree: s.n ? free / s.n : null, tmAbove2: p2 ? a2 / p2 : null, tmFree2: p2 ? f2 / p2 : null, particles2: p2 };
}

export interface OwnerCensus {
  ownedCells: number; ownedOccupied: number | null; ownedShareP: number | null;
  qP10: number | null; qP50: number | null; qP90: number | null; qP99: number | null;
  /** Particle class shares: OWN (standing on its own tag), FOREIGN-DEFENDED (a stranger's cell with Q >= theta), OPEN (everything else). */
  own: number | null; foreignDefended: number | null; open: number | null;
  /** Share of directed edges whose two cells carry the same nonzero owner. */
  sameEdge: number;
  /** Share of defended cells (Z != 0, Q >= theta) whose tag matches no live particle's tag (the dead fence). */
  deadFence: number | null;
}

/** Owner-world census; theta is the config's ownerDefend (absent: nothing is defended, foreignDefended is 0). */
export function ownerCensus(s: MyceliumState): OwnerCensus {
  if (!s.Z || !s.Q) throw new Error("the state has no owner planes");
  const c = s.config, W = c.width, H = c.height, N = W * H, theta = c.ownerDefend ?? Infinity, mode = c.trailOwner!;
  const tagOf = (i: number) => ownerTag(mode === "id" ? s.id[i] : s.gid[i]);
  const cnt = new Uint32Array(N);
  const cellOf = new Uint32Array(s.n);
  for (let i = 0; i < s.n; i++) { const k = (s.y[i] >>> POS_SHIFT) * W + (s.x[i] >>> POS_SHIFT); cellOf[i] = k; cnt[k]++; }
  let owned = 0, ownedOcc = 0, occ = 0, sumQ = 0, sumP = 0, same = 0, defended = 0;
  const qs: number[] = [];
  const live = new Set<number>();
  for (let i = 0; i < s.n; i++) live.add(tagOf(i));
  let dead = 0;
  for (let k = 0; k < N; k++) {
    sumP += s.P[k];
    if (cnt[k] > 0) occ++;
    if (s.Z[k] !== 0) {
      owned++; qs.push(s.Q[k]); sumQ += s.Q[k];
      if (cnt[k] > 0) ownedOcc++;
      if (s.Q[k] >= theta) { defended++; if (!live.has(s.Z[k])) dead++; }
      const nb = nbrs(k, W, H);
      for (let d = 0; d < 4; d++) if (s.Z[nb[d]] === s.Z[k]) same++;
    }
  }
  let own = 0, fd = 0;
  for (let i = 0; i < s.n; i++) {
    const z = s.Z[cellOf[i]];
    if (z === tagOf(i)) own++; else if (z !== 0 && s.Q[cellOf[i]] >= theta) fd++;
  }
  const sq = Float64Array.from(qs).sort();
  return {
    ownedCells: owned, ownedOccupied: occ ? ownedOcc / occ : null, ownedShareP: sumP ? sumQ / sumP : null,
    qP10: pctOf(sq, 0.1), qP50: pctOf(sq, 0.5), qP90: pctOf(sq, 0.9), qP99: pctOf(sq, 0.99),
    own: s.n ? own / s.n : null, foreignDefended: s.n ? fd / s.n : null, open: s.n ? (s.n - own - fd) / s.n : null,
    sameEdge: same / (4 * N), deadFence: defended ? dead / defended : null,
  };
}

/** For each theta: share of particles standing on a cell owned by a stranger with Q >= theta, and share of occupied cells that are owned with Q >= theta (S0.4). */
export function defenceCurve(s: MyceliumState, thetas: readonly number[]): { theta: number; particles: number | null; cells: number | null }[] {
  if (!s.Z || !s.Q) throw new Error("the state has no owner planes");
  const Z = s.Z, Q = s.Q;
  const c = s.config, W = c.width, N = W * c.height, mode = c.trailOwner!;
  const cnt = new Uint32Array(N), cellOf = new Uint32Array(s.n);
  for (let i = 0; i < s.n; i++) { const k = (s.y[i] >>> POS_SHIFT) * W + (s.x[i] >>> POS_SHIFT); cellOf[i] = k; cnt[k]++; }
  let occ = 0; for (let k = 0; k < N; k++) if (cnt[k] > 0) occ++;
  return thetas.map((theta) => {
    let ps = 0, cs = 0;
    for (let k = 0; k < N; k++) if (cnt[k] > 0 && Z[k] !== 0 && Q[k] >= theta) cs++;
    for (let i = 0; i < s.n; i++) {
      const k = cellOf[i], tag = ownerTag(mode === "id" ? s.id[i] : s.gid[i]);
      if (Z[k] !== 0 && Z[k] !== tag && Q[k] >= theta) ps++;
    }
    return { theta, particles: s.n ? ps / s.n : null, cells: occ ? cs / occ : null };
  });
}

const pearson = (x: ArrayLike<number>, y: ArrayLike<number>): number | null => {
  const n = x.length;
  let mx = 0, my = 0;
  for (let k = 0; k < n; k++) { mx += x[k]; my += y[k]; }
  mx /= n; my /= n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let k = 0; k < n; k++) { sxy += (x[k] - mx) * (y[k] - my); sxx += (x[k] - mx) ** 2; syy += (y[k] - my) ** 2; }
  return sxx === 0 || syy === 0 ? null : sxy / Math.sqrt(sxx * syy);
};

/** corr(P, P shifted by (+s, +s)): the ghost's validity report for the free-layer worlds; null for a constant field (void, not zero correlation). */
export function ghostCorrP(s: MyceliumState, shift: number): number | null {
  const W = s.config.width, H = s.config.height, N = W * H;
  const sh = new Float64Array(N);
  for (let k = 0; k < N; k++) sh[k] = s.P[shiftCell(k, shift, W, H)];
  return pearson(s.P, sh);
}

/** corr(eff_real, eff_displaced) over directed edges of the owner conduit (review P12); null when either map is constant (void). */
export function ownerEdgeCorr(s: MyceliumState, g: number, q: number, shift: number): number | null {
  if (!s.Z || !s.Q) throw new Error("the state has no owner planes");
  const c = s.config, W = c.width, H = c.height, N = W * H;
  const a = new Float64Array(4 * N), b = new Float64Array(4 * N);
  for (let k = 0; k < N; k++) {
    const nb = nbrs(k, W, H), ks = shiftCell(k, shift, W, H);
    for (let d = 0; d < 4; d++) {
      a[4 * k + d] = ownerRate(c.diffA, g, q, s.Z[k], s.Z[nb[d]], s.Q[k], s.Q[nb[d]]);
      const ns = shiftCell(nb[d], shift, W, H);
      b[4 * k + d] = ownerRate(c.diffA, g, q, s.Z[ks], s.Z[ns], s.Q[ks], s.Q[ns]);
    }
  }
  return pearson(a, b);
}

// ---- sizing rules R1 to R6 (DESIGN.md section 7), written before any run ----------------------------------------

/** Round half up of an integer ratio num / den. */
export const roundDiv = (num: number, den: number): number => Math.floor((2 * num + den) / (2 * den));
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/**
 * R1, the founder-settle step t0: per seed the live count n at every step 1..400 (nSeries[seed][step - 1]). At a multiple of 50 (from 150 on) the
 * change is |m(t) - m(t - 100)| / m(t - 100) of the 50-step block means m(t) = mean n over (t - 50, t]. t0 is the smallest multiple of 50 at which the
 * median over seeds is under 5 percent; if none by 400, t0 = 400 and failed is true.
 */
export function settleT0(nSeries: readonly (readonly number[])[]): { t0: number; failed: boolean; changes: { t: number; median: number }[] } {
  const blockMean = (ns: readonly number[], t: number) => sumOf(ns.slice(t - 50, t)) / 50;
  const changes: { t: number; median: number }[] = [];
  for (let t = 150; t <= 400; t += 50) {
    const ch = nSeries.map((ns) => { const m0 = blockMean(ns, t - 100); return m0 === 0 ? Infinity : Math.abs(blockMean(ns, t) - m0) / m0; });
    changes.push({ t, median: median(ch)! });
  }
  const hit = changes.find((c) => c.median < 0.05);
  return hit ? { t0: hit.t, failed: false, changes } : { t0: 400, failed: true, changes };
}

/**
 * R2, the road strength v: for each pattern p, v_p is the largest of {16, 24, 32, 48} with at least half the laid cells at A >= 8 at step 10 (median over
 * seeds, passed in as shares); v = min over p. If no value passes for some pattern, v = 16 and fallback is true (the desert share is then printed).
 */
export function chooseV(shares: Record<string, Record<number, number>>): { v: number; fallback: boolean; perPattern: Record<string, number | null> } {
  const perPattern: Record<string, number | null> = {};
  for (const [p, byV] of Object.entries(shares)) {
    const ok = [48, 32, 24, 16].find((v) => (byV[v] ?? -1) >= 0.5);
    perPattern[p] = ok ?? null;
  }
  const vals = Object.values(perPattern);
  if (!vals.length || vals.some((x) => x === null)) return { v: 16, fallback: true, perPattern };
  return { v: Math.min(...(vals as number[])), fallback: false, perPattern };
}

/** R3: plateau strengths. ext = (q * 255) >> 4 (15, 31, 47 for q 1, 2, 3), Dd = De + ext, and its share of the headroom 128 - De. */
export function plateauDd(De: number, q: number): { ext: number; dd: number; headroomShare: number } {
  const ext = (q * 255) >> 4, dd = Math.min(De + ext, 128);
  return { ext, dd, headroomShare: (dd - De) / (128 - De) };
}

/** R3: t_alive(q) = the last read at which the median laid-edge x_e is at least q; null if none. PW(q) = (t0, min(t_alive, 1000)]. */
export function aliveAndWindow(xMedByStep: readonly { step: number; xMed: number }[], q: number, t0: number): { tAlive: number | null; pw: [number, number] | null; len: number; unreadable: boolean } {
  let last: number | null = null;
  for (const r of xMedByStep) if (r.xMed >= q) last = r.step;
  if (last === null) return { tAlive: null, pw: null, len: 0, unreadable: true };
  const hi = Math.min(last, 1000), len = hi - t0;
  return { tAlive: last, pw: len > 0 ? [t0, hi] : null, len: Math.max(0, len), unreadable: len < PW_MIN };
}

/** R4: the rising-strength g_R = round(493 / v) clamped 1..255 (q is 255). */
export const gRising = (v: number): number => clamp(roundDiv(493, v), 1, 255);

/** R5: F-strength triple from the median x_e between occupied cells; x_med 0 gives mid 1 and the NO-BITE-LIKELY flag. lo = max(1, mid >> 1), hi = min(255, 2 mid). */
export function freeStrengths(xMed: number | null): { lo: number; mid: number; hi: number; noBiteLikely: boolean } {
  if (xMed === null || xMed <= 0) return { lo: 1, mid: 1, hi: 2, noBiteLikely: true };
  const mid = clamp(roundDiv(Math.round(480 * 1000), Math.round(xMed * 1000)), 1, 255);
  return { lo: Math.max(1, mid >> 1), mid, hi: Math.min(255, 2 * mid), noBiteLikely: false };
}

/** R5: the free-layer ceiling F*: 16, halved once to 8 when FREE-ONLY(16) already has p50 trail per occupied cell of at least 4F (a carpet). */
export const freeCeiling = (freeOnly16P50: number | null): number => (freeOnly16P50 !== null && freeOnly16P50 >= 64 ? 8 : 16);

/**
 * R6: theta lo/mid/hi = the smallest theta whose median defended-particle share (toll substrate, "gid") is at most 50, 25, 10 percent; duplicates
 * collapse (fewer than three distinct values: the ones that exist). median shares are given per theta; unreachable levels are dropped.
 */
export function thetaR6(medianShare: Record<number, number>): { lo?: number; mid?: number; hi?: number; distinct: number[] } {
  const ts = Object.keys(medianShare).map(Number).sort((a, b) => a - b);
  const pick = (lim: number) => ts.find((t) => medianShare[t] <= lim);
  const lo = pick(0.5), mid = pick(0.25), hi = pick(0.10);
  return { lo, mid, hi, distinct: [...new Set([lo, mid, hi].filter((x): x is number => x !== undefined))] };
}

/** The owner strengths g: lo = max(1, mid >> 2), hi = min(255, 4 mid). */
export const ownerGStrengths = (mid: number): { lo: number; mid: number; hi: number } => ({ lo: Math.max(1, mid >> 2), mid, hi: Math.min(255, 4 * mid) });

/** The conduit-matched C-pub strength: the g' in the fixed list minimising |ratio - 1| of mean public rate (q' 255) to the owner mean rate; void beyond 10 percent. */
export const CPUB_GRID: readonly number[] = [1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64, 96, 128, 192, 255];
export function matchCpub(meanOwnerHeadroom: number, meanPublicHeadroomAt: (g: number) => number): { g: number; ratio: number; void: boolean } {
  let best = CPUB_GRID[0], bestErr = Infinity, bestRatio = NaN;
  for (const g of CPUB_GRID) {
    const r = meanOwnerHeadroom === 0 ? (meanPublicHeadroomAt(g) === 0 ? 1 : Infinity) : meanPublicHeadroomAt(g) / meanOwnerHeadroom;
    const err = Math.abs(r - 1);
    if (err < bestErr) { best = g; bestErr = err; bestRatio = r; }
  }
  return { g: best, ratio: bestRatio, void: !(bestErr <= 0.10) };
}

// ---- labels (DESIGN.md section 10), pure functions of votes and counts -------------------------------------------

export interface LabelOut { label: string; note: string | null }

/** Inputs of the T label for one strength (the primary P2 carries it; P1, P3 and R are dose rows). */
export interface TInputs {
  /** PW at least 150 steps, and the readability guard (min n >= 100 on both twins) holds in at least 6 of 8 seeds. */
  readable: boolean;
  payRows: Vote; payCarpet: Vote; dampRows: Vote;
  grad: Vote; payDiffA: Vote;
  /** MECH holds (median over seeds of the PW mean flux positive and above cols'). */
  mech: boolean;
  /** V(PAY-D0): the unconditional 2,000-step read on a durable road. */
  payD0: Vote;
}
export function labelT(i: TInputs): LabelOut {
  const short = i.payD0 === "N" ? null : `short-window only: V(PAY-D0) = ${i.payD0}`;
  if (!i.readable) return { label: "UNREADABLE", note: "PW under 150 steps or the readability guard failed" };
  if (i.payRows === "N" && i.payCarpet === "N") {
    return i.dampRows === "Y" ? { label: "DAMPS-ONLY", note: short } : { label: "NO-PAY", note: short };
  }
  if (i.payRows === "N" && i.payCarpet === "Y") return { label: "CEILING-ONLY", note: null };
  if (i.payRows === "I" || (i.payRows === "N" && i.payCarpet === "I")) return { label: "INCONCLUSIVE", note: null };
  // payRows is Y
  if (i.grad === "N" || i.payDiffA === "Y") return { label: "UNIFORM-PUMP", note: null };
  if (i.grad === "I" || i.payDiffA === "I") return { label: "INCONCLUSIVE", note: "GRAD or the diffA-matched control is unresolved (never evidence for a mechanism)" };
  return i.mech ? { label: "TRANSIENT", note: null } : { label: "PAY-NO-FLUX", note: "intake rose with no transport seen: a possible divergence artefact" };
}

/** D refinement of a TRANSIENT strength (first match; the live-road window D1 before persistence). */
export interface DInputs { payD1: Vote; payD2: Vote; persist: Vote; grad: Vote; select: Vote }
export function labelD(i: DInputs): LabelOut {
  if (i.payD1 === "I" || i.persist === "I") return { label: "INCONCLUSIVE-D", note: null };
  if (i.payD1 === "N") return { label: "STARTUP-ONLY", note: "the durable road is alive in D1: T's effect was a start-up state, not the road" };
  if (i.payD1 === "Y" && i.persist === "N") return { label: "ROAD-FADES", note: "stays TRANSIENT as the final label" };
  if (i.persist === "Y" && i.payD1 === "Y" && i.payD2 === "Y" && i.grad === "Y") return i.select === "Y" ? { label: "PAYS-AND-SELECTED", note: null } : { label: "PAYS-AND-PERSISTS", note: "a public good nobody is selected to maintain" };
  return { label: "PAY-PARTIAL", note: null };
}

/** F label inputs, counted over n inherit slots (labelled at the mid strength only). */
export interface FInputs {
  n: number;
  /** K class per slot: K kept above the layer, S subsidy-only, NB no bite, L lost, U unread (an extinct or unread run: neither passes nor fails). */
  cls: ("K" | "S" | "NB" | "L" | "U")[];
  /** Per-slot booleans (index = slot order); null = unresolved. Only the slots that have K are counted for the joint votes. */
  a: (boolean | null)[]; aDamp: (boolean | null)[]; b: (boolean | null)[]; c: (boolean | null)[]; d: (boolean | null)[]; H: (boolean | null)[]; G: (boolean | null)[];
  /** (g) F-led per slot. */
  fLed: (boolean | null)[];
  e: boolean; f: boolean;
  anchor: "YES" | "NO-DAMPS" | "MIXED" | "INCOMPLETE";
  /** The forced extras (dose arms) exist; without them no label beyond the four provisional ones is issued. */
  extras: boolean;
}
export function labelF(i: FInputs): LabelOut {
  const n = i.n, k = need(n), cnt = (c: string) => i.cls.filter((x) => x === c).length;
  if (cnt("NB") >= k) return { label: "NO-BITE", note: null };
  if (cnt("S") >= k) return { label: "SUBSIDY-ONLY", note: null };
  const vK = vote(i.cls.map((c) => (c === "U" ? null : c === "K")));
  if (vK === "N") return { label: "PURGED-ABOVE-LAYER", note: null };
  if (vK === "I") return { label: "INCONCLUSIVE", note: null };
  if (!i.extras) return { label: "INCOMPLETE", note: "not run: the dose arms (T-4, Fg-lo, Fg-hi) a K=Y label requires" };
  const kept = i.cls.map((c) => c === "K");
  const onK = (p: (boolean | null)[]) => p.map((x, j) => (kept[j] ? x : false));
  const nT = (p: (boolean | null)[]) => p.filter((x) => x === true).length;
  if (nT(i.fLed) >= half(n)) return { label: "SUBSIDY-CARRIED", note: "F-led: the births gain depends more on F than on the conduit (total F dependence, not a pure windfall)" };
  if (nT(onK(i.aDamp)) >= k && nT(onK(i.a)) < k) return { label: "KEPT-DAMPS", note: null };
  const abcd = nT(joint(onK(i.a), onK(i.b), onK(i.c), onK(i.d)));
  if (abcd >= k && i.e && i.f && i.anchor === "INCOMPLETE") return { label: "INCOMPLETE", note: "every KEPT-AND-PAYS predicate holds but the anchor cohort is unfinished (one physarum and one blind run per treated slot): no label rests on a partial anchor set" };
  if (abcd >= k && i.e && i.f && i.anchor === "YES") return { label: "KEPT-AND-PAYS", note: null };
  // Joint vote on the same seeds (DESIGN 10: K and every listed predicate on one seed): (a), (b), (d) and (H and not G) are one conjunction, not separate counts.
  const hNoGSeed = i.H.map((h, j) => (h === true && i.G[j] === false ? true : h === null || i.G[j] === null ? null : false));
  const abdH = nT(joint(onK(i.a), onK(i.b), onK(i.d), onK(hNoGSeed)));
  if (abdH >= k && i.e && i.f) return { label: "KEPT-STATIC-SPONGE", note: null };
  const why = [abcd < k && "joint (a)(b)(c)(d)", !i.e && "(e) dose", !i.f && "(f) controls", i.anchor !== "YES" && `anchor ${i.anchor}`].filter(Boolean).join(", ");
  return { label: "KEPT-BY-PRESENCE-ONLY", note: `failing: ${why}` };
}

/** O label inputs, counted over n inherit slots of the toll substrate at the mid strength. */
export interface OInputs {
  n: number;
  /** (e) territory sanity per slot. */
  e: (boolean | null)[];
  /** K per slot for T-EC, and for T-E. */
  kEC: (boolean | null)[]; kE: (boolean | null)[];
  payECvsCoff: Vote; payAll: Vote;
  /** PAYALL per slot (owner addendum review): when given, every joint vote includes it on the same seed (DESIGN 10, joint votes). */
  payAllS?: (boolean | null)[];
  /** HARM or DAMP seen in the PAYALL comparisons (for KEPT-UNPAID). */
  harmOrDamp: boolean;
  b: (boolean | null)[]; c: (boolean | null)[]; d: (boolean | null)[]; H: (boolean | null)[]; G: (boolean | null)[];
  /** (f) dose, (g) C-pub control (void or unmatched makes it false). */
  f: boolean | null; g: boolean;
  payCpub: Vote;
  /** The S0.4 stop rule fired (the toll world has no existing trail to defend): O was not run. */
  stopRule: boolean;
  extras: boolean;
}
export function labelO(i: OInputs): LabelOut {
  if (i.stopRule) return { label: "INCOMPLETE", note: "not run: S0.4 stop rule (under 50 percent of occupied cells owned in the toll substrate)" };
  const n = i.n, k = need(n), nT = (p: (boolean | null)[]) => p.filter((x) => x === true).length;
  if (i.e.filter((x) => x === false).length >= k) return { label: "TERRITORY-COLLAPSE", note: null };
  const vK = vote(i.kEC);
  if (vK === "N") return { label: "PURGED", note: null };
  if (vK === "I") return { label: "INCONCLUSIVE", note: null };
  if (!i.extras) return { label: "INCOMPLETE", note: "not run: the O extras (dose arms, blocked-id, no-toll) a K=Y label requires" };
  // ENCLOSURE-ONLY needs T-EC and T-E kept on the same seeds (DESIGN 10, joint votes).
  if (vote(joint(i.kEC, i.kE)) === "Y" && i.payECvsCoff === "N") return { label: "ENCLOSURE-ONLY", note: "exclusion is the whole effect: a land claim" };
  if (i.payAll === "N" && i.harmOrDamp) return { label: "KEPT-UNPAID", note: null };
  // Same-seed conjunctions: K (T-EC), (e), and PAYALL when given per slot, are part of every joint vote; (d) with (H and not G) is one conjunction for the sponge.
  const base = i.payAllS ? [i.kEC, i.e, i.payAllS] : [i.kEC, i.e];
  const hNoGSeed = i.H.map((h, j) => (h === true && i.G[j] === false ? true : h === null || i.G[j] === null ? null : false));
  const vE = vote(i.e), vSp = vote(joint(...base, i.d, hNoGSeed));
  const vBCD = vote(joint(...base, i.b, i.c, i.d)), vBD = vote(joint(...base, i.b, i.d)), vC = vote(i.c);
  const rest = i.payAll === "Y" && vE === "Y" && i.f === true && i.g;
  if (rest && vSp === "Y") return { label: "OWNER-STATIC-SPONGE", note: null };
  if (rest && vBCD === "Y") return { label: "KEPT-AND-USED", note: i.payCpub === "Y" ? "OWNER-SPECIFIC" : null };
  if (rest && vBD === "Y" && vC === "N") return { label: "CONDUIT-PAYS-NOT-USED", note: null };
  // A negative label needs a definite failure (a vote of N, or a control that fails). A headline predicate that only reads I, or is unread, is unresolved (DESIGN 10).
  const failing = [i.payAll === "N" && "PAYALL", vBCD === "N" && "joint (b)(c)(d)", vE === "N" && "(e)", i.f === false && "(f) dose", !i.g && "(g) C-pub control"].filter(Boolean);
  const open = [i.payAll === "I" && "PAYALL", vBCD === "I" && `joint (b)(c)(d) with K, (e)${i.payAllS ? " and PAYALL" : ""} on the same seeds`, vC === "I" && "(c)", vE === "I" && "(e)", i.f === null && "(f) dose"].filter(Boolean);
  if (failing.length) return { label: "KEPT-BY-PRESENCE-ONLY", note: `failing: ${failing.join(", ")}${open.length ? `; unresolved: ${open.join(", ")}` : ""}` };
  return { label: "INCONCLUSIVE", note: `unresolved: ${open.join(", ")}` };
}

/** The bootstrap labels evaluated for the no-toll substrate: BOOTSTRAPS if N-EC has K in at least 6 of 8 with N-E also read, else FLOOR. */
export function noTollLabel(kNEC: boolean[], nEReadable: boolean): string {
  return kNEC.filter(Boolean).length >= need(kNEC.length) && nEReadable ? "BOOTSTRAPS" : "FLOOR";
}

// ---- projection and gates ----------------------------------------------------------------------------------------

/** R7 gate: the main screen refuses to start if the projected wall time exceeds this. */
export const PROJECTION_MAX_HOURS = 3.0;
/** Projected wall hours of `totalSteps` simulated steps at `secPerKStep` seconds per 1,000 steps and `jobs` parallel jobs sharing the GPU (jobs scale only if parallel > 1 is measured, so the rate is per process pool). */
export const projectHours = (totalSteps: number, secPerKStep: number): number => (totalSteps / 1000) * secPerKStep / 3600;

// ---- stored column series --------------------------------------------------------------------------------------

/** A set of named columns sampled at increasing steps (null = undefined at that census). The runner stores these; windows are functions of them. */
export interface ColSeries { step: number[]; cols: Record<string, (number | null)[]> }
export const emptyCols = (keys: readonly string[]): ColSeries => ({ step: [], cols: Object.fromEntries(keys.map((k) => [k, [] as (number | null)[]])) });
export function pushCols(ser: ColSeries, step: number, row: Record<string, number | null>): void {
  if (ser.step.length && step <= ser.step[ser.step.length - 1]) throw new Error("column-series steps must increase");
  ser.step.push(step);
  for (const k of Object.keys(ser.cols)) { if (!(k in row)) throw new Error(`column ${k} missing at step ${step}`); ser.cols[k].push(row[k]); }
}
/** Mean over the non-null entries of each column over the steps in (lo, hi]; a column with none is null. */
export function colWindow(ser: ColSeries, lo: number, hi: number): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const k of Object.keys(ser.cols)) {
    let t = 0, m = 0;
    for (let i = 0; i < ser.step.length; i++) if (ser.step[i] > lo && ser.step[i] <= hi && ser.cols[k][i] !== null) { t += ser.cols[k][i] as number; m++; }
    out[k] = m ? t / m : null;
  }
  return out;
}
/** Min of a column over (lo, hi]; null when the window has no entry. */
export function colMin(ser: ColSeries, key: string, lo: number, hi: number): number | null {
  let m: number | null = null;
  for (let i = 0; i < ser.step.length; i++) if (ser.step[i] > lo && ser.step[i] <= hi && ser.cols[key][i] !== null) m = m === null ? (ser.cols[key][i] as number) : Math.min(m, ser.cols[key][i] as number);
  return m;
}

export const ROAD_KEYS = ["laidA8", "desert", "xMed", "xGe1", "xGe2", "xGe3", "onLaid", "road", "meanDd1", "meanDd2", "meanDd3", "xflux", "n"] as const;
/** The thetas of the S0.4 defence curve (R6) stored per heavy census in owner worlds. */
export const DEF_THETAS: readonly number[] = [1, 2, 4, 8, 16, 32, 64, 128, 255];
export const BOOT_KEYS = [
  "tm", "tmAbove", "tmFree", "tmAbove2", "tmFree2", "tmAboveStar", "ghostCorr", "xMedOcc", "meanEdge",
  "ownedCells", "ownedOccupied", "ownedShareP", "qP50", "qP90", "own", "foreignDefended", "open", "sameEdge", "deadFence", "ownerGhostCorr",
  ...DEF_THETAS.map((th) => `def${th}`),
] as const;

/** Median over directed edges between two OCCUPIED cells of x_e = min(P_k, P_nb) (the R5 input); null when no edge joins occupied cells. */
export function xMedOccupied(s: MyceliumState): number | null {
  const c = s.config, W = c.width, H = c.height, N = W * H;
  const occ = new Uint8Array(N);
  for (let i = 0; i < s.n; i++) occ[(s.y[i] >>> POS_SHIFT) * W + (s.x[i] >>> POS_SHIFT)] = 1;
  const xs: number[] = [];
  for (let k = 0; k < N; k++) if (occ[k]) for (const nb of nbrs(k, W, H)) if (occ[nb]) xs.push(Math.min(s.P[k], s.P[nb]));
  return xs.length ? pctOf(Float64Array.from(xs).sort(), 0.5) : null;
}
