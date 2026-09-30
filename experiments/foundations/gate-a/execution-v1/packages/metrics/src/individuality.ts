// Information-theoretic individuality (Krakauer, Bertschinger, Olbrich, Flack
// & Ay 2020, "The information theory of individuality", Theory in Biosciences
// 139:209-223; formulas below are from the freely-available 2014 preprint,
// arXiv:1412.2447, which gives the exact unambiguous algebra). For system
// state S and environment state E, both discrete, at consecutive recorded
// steps:
//
//   A*   = I(S_{n+1}; S_n)             organismal / "genomic determination"
//   A    = I(S_{n+1}; S_n | E_n)       colonial / autonomy given environment
//   nC   = I(S_{n+1}; E_n | S_n)       driven / non-closure
//   NTIC = A* - A                      "non-trivial informational closure"
//
// A and nC are exact algebraic derivations of the other three quantities
// below, not independent estimators (chain rule: I(S,E;S') = I(E;S') +
// I(S;S'|E) = I(S;S') + I(E;S'|S)):
//
//   A  = jointMI - environmentMI
//   nC = jointMI - autonomyStar
//
// so A and nC computed this way are internally consistent with autonomyStar/
// jointMI/environmentMI by construction, as long as all three use the same
// bias-correction treatment (they do: Miller-Madow throughout).
//
// Every quantity here is a pure function of pre-binned discrete symbol
// arrays over one or more independent replicate "worlds" (see
// `WorldTrajectory`); nothing in this file touches the simulator, the
// tracker or I/O.

import { mulberry32 } from "./calibration.ts";
import { quantile } from "./activity.ts";
import { mean } from "./stats.ts";

// ---------------------------------------------------------------------------
// 1. Discrete entropy / mutual information primitives
// ---------------------------------------------------------------------------

/** log2 Shannon entropy (bits) of a discrete sample with a known alphabet size. */
export function discreteEntropy(x: ArrayLike<number>, alphabet: number): number {
  const n = x.length;
  const counts = new Float64Array(alphabet);
  for (let i = 0; i < n; i++) counts[x[i]]++;
  let h = 0;
  for (const c of counts) if (c > 0) h -= (c / n) * Math.log2(c / n);
  return h;
}

/** Miller-Madow bias-corrected entropy: plugin + (nonempty bins - 1) / (2 N ln 2) bits. */
export function millerMadowEntropy(x: ArrayLike<number>, alphabet: number): { plugin: number; corrected: number; nonemptyBins: number } {
  const n = x.length;
  const counts = new Float64Array(alphabet);
  for (let i = 0; i < n; i++) counts[x[i]]++;
  let plugin = 0;
  let nonemptyBins = 0;
  for (const c of counts) {
    if (c <= 0) continue;
    plugin -= (c / n) * Math.log2(c / n);
    nonemptyBins++;
  }
  const corrected = plugin + (nonemptyBins - 1) / (2 * n * Math.LN2);
  return { plugin, corrected, nonemptyBins };
}

export interface MIResult {
  /** bits, naive plug-in H(x)+H(y)-H(x,y) */
  plugin: number;
  /** bits, Miller-Madow-corrected term-by-term */
  corrected: number;
  n: number;
}

/** I(x;y) over two aligned discrete samples of known alphabet sizes. */
export function mutualInformationDiscrete(x: ArrayLike<number>, y: ArrayLike<number>, xAlphabet: number, yAlphabet: number): MIResult {
  const n = x.length;
  const hx = millerMadowEntropy(x, xAlphabet);
  const hy = millerMadowEntropy(y, yAlphabet);
  const joint = new Array<number>(n);
  for (let i = 0; i < n; i++) joint[i] = x[i] * yAlphabet + y[i];
  const hxy = millerMadowEntropy(joint, xAlphabet * yAlphabet);
  return { plugin: hx.plugin + hy.plugin - hxy.plugin, corrected: hx.corrected + hy.corrected - hxy.corrected, n };
}

/**
 * I(x,y; z) treating (x,y) as one joint variable of alphabet xAlphabet*yAlphabet
 * (symbol = x*yAlphabet + y). Used for I(S_n,E_n; S_{n+1}).
 */
export function jointMutualInformationDiscrete(
  x: ArrayLike<number>,
  y: ArrayLike<number>,
  z: ArrayLike<number>,
  xAlphabet: number,
  yAlphabet: number,
  zAlphabet: number,
): MIResult {
  const n = z.length;
  const w = new Array<number>(n);
  for (let i = 0; i < n; i++) w[i] = x[i] * yAlphabet + y[i];
  return mutualInformationDiscrete(w, z, xAlphabet * yAlphabet, zAlphabet);
}

// ---------------------------------------------------------------------------
// 2. Williams-Beer I_min PID (bivariate, one target) -- all-plugin
// ---------------------------------------------------------------------------

export interface PID {
  redundancy: number;
  uniqueS: number;
  uniqueE: number;
  synergy: number;
}

/**
 * Williams & Beer (2010) I_min PID of I(target; s, e), computed entirely from
 * PLUGIN (uncorrected) quantities: plugin I(s;target), I(e;target),
 * I(s,e;target), and a plugin specific-information I_min. Deliberately does
 * NOT use the Miller-Madow-corrected MIResult.corrected values anywhere --
 * mixing corrected whole-quantity MIs with an uncorrected I_min breaks the
 * nonnegative Williams-Beer bounds (a degenerate, equally-observed null-case
 * joint can produce negative unique/synergy terms under a mixed scheme).
 * There is no established bias correction for I_min in the PID literature;
 * this PID is reported as a plugin-only quantity, expected to carry the same
 * small-sample upward bias as any plugin MI estimate -- read it together
 * with `n` and a null/CI, never in isolation.
 *
 * redundancy + uniqueS + uniqueE + synergy === jointMI.plugin holds *by
 * construction* for any value of redundancy (the other three are residuals
 * against it): this identity checks the four terms' bookkeeping, not
 * whether I_min itself is a sensible redundancy measure.
 */
export function williamsBeerPID(
  s: ArrayLike<number>,
  e: ArrayLike<number>,
  target: ArrayLike<number>,
  sAlphabet: number,
  eAlphabet: number,
  targetAlphabet: number,
): PID {
  const n = target.length;
  const cS = new Float64Array(sAlphabet);
  const cE = new Float64Array(eAlphabet);
  const cT = new Float64Array(targetAlphabet);
  const cST = new Float64Array(sAlphabet * targetAlphabet);
  const cET = new Float64Array(eAlphabet * targetAlphabet);
  for (let i = 0; i < n; i++) {
    const si = s[i], ei = e[i], ti = target[i];
    cS[si]++;
    cE[ei]++;
    cT[ti]++;
    cST[si * targetAlphabet + ti]++;
    cET[ei * targetAlphabet + ti]++;
  }
  let redundancy = 0;
  for (let t = 0; t < targetAlphabet; t++) {
    const nt = cT[t];
    if (nt === 0) continue;
    const pt = nt / n;
    let iSpecS = 0;
    for (let x = 0; x < sAlphabet; x++) {
      const joint = cST[x * targetAlphabet + t];
      if (joint === 0) continue;
      const pxGivenT = joint / nt;
      const px = cS[x] / n;
      iSpecS += pxGivenT * Math.log2(pxGivenT / px);
    }
    let iSpecE = 0;
    for (let x = 0; x < eAlphabet; x++) {
      const joint = cET[x * targetAlphabet + t];
      if (joint === 0) continue;
      const pxGivenT = joint / nt;
      const px = cE[x] / n;
      iSpecE += pxGivenT * Math.log2(pxGivenT / px);
    }
    redundancy += pt * Math.min(iSpecS, iSpecE);
  }
  const miS = mutualInformationDiscrete(s, target, sAlphabet, targetAlphabet).plugin;
  const miE = mutualInformationDiscrete(e, target, eAlphabet, targetAlphabet).plugin;
  const miSE = jointMutualInformationDiscrete(s, e, target, sAlphabet, eAlphabet, targetAlphabet).plugin;
  const uniqueS = miS - redundancy;
  const uniqueE = miE - redundancy;
  const synergy = miSE - miS - miE + redundancy;
  return { redundancy, uniqueS, uniqueE, synergy };
}

// ---------------------------------------------------------------------------
// 3. World trajectories, the cross-world null, and the bootstrap-over-worlds
// CI. A "world" is one independent replicate run: same config and founder
// layout, a different seed. Every draw is seeded via mulberry32
// (deterministic, never Math.random).
// ---------------------------------------------------------------------------

/** One world's (S_t, S_{t+1}, E_t) arrays over a fixed window, all the same length T. */
export interface WorldTrajectory {
  s: Uint8Array;
  sNext: Uint8Array;
  e: Uint8Array;
}

/**
 * Builds one WorldTrajectory from a fixed-mask feature history that already
 * covers the full window with no gaps. The caller (tools/individuality.ts)
 * is responsible for excluding a whole world+anchor pair up front, before
 * calling this, if the aggregate didn't survive the window intact -- this
 * function has no notion of a partial/spliced trajectory. Throws if
 * sAlphabet/eAlphabet exceed 256 (Uint8Array storage guard: a symbol >=256
 * would otherwise silently wrap mod 256) or if the symbol arrays' lengths
 * are inconsistent (sSymbols must be exactly one longer than eSymbols).
 */
export function buildWorldTrajectory(
  sSymbols: ArrayLike<number>, // length T+1 (S_0..S_T); sNext is sSymbols[1..]
  eSymbols: ArrayLike<number>, // length T (E_0..E_{T-1})
  sAlphabet: number,
  eAlphabet: number,
): WorldTrajectory {
  if (sAlphabet > 256 || eAlphabet > 256) {
    throw new Error(`buildWorldTrajectory: sAlphabet=${sAlphabet}/eAlphabet=${eAlphabet} exceed Uint8Array capacity (256) -- symbols would silently wrap`);
  }
  const T = eSymbols.length;
  if (sSymbols.length !== T + 1) {
    throw new Error(`buildWorldTrajectory: sSymbols.length (${sSymbols.length}) must equal eSymbols.length+1 (${T + 1})`);
  }
  const s = new Uint8Array(T), sNext = new Uint8Array(T), e = new Uint8Array(T);
  for (let i = 0; i < T; i++) {
    s[i] = sSymbols[i];
    sNext[i] = sSymbols[i + 1];
    e[i] = eSymbols[i];
  }
  return { s, sNext, e };
}

/**
 * Below this many worlds, `bootstrapOverWorlds`'s percentile interval is not
 * calibrated and must not be presented as a confidence interval -- see the
 * coverage check in individuality.test.ts and docs/individuality-info-theory.md
 * §3. Measured empirical coverage of a nominal-90% percentile interval, over
 * a synthetic population with the SAME fixed (independently, externally
 * fitted) bins used throughout, a fixed target (the population mean of the
 * corrected statistic under those bins), and 300 trials per R: R=12 ~84%,
 * R=4 ~74% -- both below nominal, but R=4's gap is roughly twice R=12's, and
 * every R in between (checked during development, not committed as a test)
 * closes that gap monotonically as R grows. 8 is chosen as the cutoff: it is
 * closer to R=12's coverage than to R=4's in that monotonic trend, and it is
 * also where the number of distinct with-replacement resamples a percentile
 * bootstrap can draw from (C(2R-1,R): 35 at R=4, 6435 at R=8) stops being
 * vanishingly small. Below the cutoff, `status` is `"uncalibrated"` and
 * callers must report `[lower, upper]` as a descriptive resampling range,
 * never quote it as a confidence interval.
 */
export const MIN_CALIBRATED_WORLDS = 8;

export interface BootstrapCI {
  /** Mean, across worlds, of `statistic` applied to each world on its own (no resampling, no cross-world pooling of raw symbols). */
  point: number;
  lower: number;
  upper: number;
  draws: number;
  /** Two-sided interval mass excluded, e.g. 0.10 for a 90% CI (matches calibration.ts's bootstrapQuantileInterval convention). */
  alpha: number;
  /**
   * `"ci"` when `worlds.length >= MIN_CALIBRATED_WORLDS` (coverage checked
   * reasonable at R=12 in individuality.test.ts); `"uncalibrated"` below
   * that (coverage measurably poor at R=4). An `"uncalibrated"` `[lower,
   * upper]` is still the same percentile computation -- report it as a
   * descriptive resampling range, not as a confidence interval.
   */
  status: "ci" | "uncalibrated";
}

/**
 * `statistic` is evaluated ONCE PER WORLD, never on symbols pooled across
 * worlds: pooling raw (s,sNext,e) arrays before computing an MI-derived
 * statistic conflates between-world heterogeneity (different seeds drift to
 * different marginal symbol distributions) with genuine within-world
 * temporal coupling, inflating the statistic even when every world's true
 * per-world value is ~0. `point` is the mean of the R per-world values.
 * The CI resamples worlds WITH REPLACEMENT `draws` times (mulberry32(seed),
 * same "resample the replicate, not the observation" logic as
 * calibration.ts's bootstrapQuantileInterval) and averages the resampled
 * per-world values -- so `point` and every resampled estimate are the same
 * aggregation (mean of R per-world values), matching what `crossWorldNull`'s
 * `observed` aggregates too. Percentile CI: [alpha/2, 1-alpha/2] over the
 * draws. Requires worlds.length >= 2 (a CI over one world is undefined).
 * The bins baked into each world's symbols must already be fixed and
 * independent of `worlds` itself (fit from separate calibration data) --
 * this function only resamples worlds, it never touches or refits any
 * binning; see `docs/individuality-info-theory.md` §3.
 */
export function bootstrapOverWorlds(
  worlds: readonly WorldTrajectory[],
  statistic: (world: WorldTrajectory) => number,
  opts: { draws?: number; alpha?: number; seed?: number } = {},
): BootstrapCI {
  if (worlds.length < 2) throw new Error(`bootstrapOverWorlds: requires >=2 worlds, got ${worlds.length}`);
  const draws = opts.draws ?? 2000;
  const alpha = opts.alpha ?? 0.1;
  const rng = mulberry32(opts.seed ?? 0);
  const perWorld = worlds.map(statistic);
  const point = mean(perWorld);
  const n = perWorld.length;
  const estimates: number[] = [];
  for (let d = 0; d < draws; d++) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += perWorld[Math.min(n - 1, Math.floor(rng() * n))];
    estimates.push(sum / n);
  }
  const sorted = [...estimates].sort((a, b) => a - b);
  return {
    point,
    lower: quantile(sorted, alpha / 2),
    upper: quantile(sorted, 1 - alpha / 2),
    draws,
    alpha,
    status: n >= MIN_CALIBRATED_WORLDS ? "ci" : "uncalibrated",
  };
}

export interface CrossWorldNullResult {
  /** mean of the R in-world (diagonal, a===b) statistic values -- what the p-value tests. */
  observed: number;
  /** T_aa per world, world order preserved -- for per-world diagnostics. */
  perWorld: number[];
  /**
   * The actual null distribution `observed` is ranked against. Under H0 the
   * S-series and E-series of i.i.d. replicate worlds are independent, so the
   * joint law is invariant under ANY permutation of which world's E
   * accompanies which world's S/S' -- the full symmetric group S_R, not just
   * the fixed-point-free subset. The identity permutation (pairing every
   * world with its own E, i.e. `observed` itself) is exchangeable with every
   * other permutation under H0 and is therefore included as one of the
   * R!/nullDraws+1 reference values, which is what guarantees `p >= 1/R!`
   * (exact) or `p >= 1/(nullDraws+1)` (Monte Carlo) rather than an
   * unprincipled floor. Each draw assigns every world a (possibly its own)
   * world's E via a permutation pi and averages the R resulting per-world
   * statistics; this matches `observed`'s own aggregation (a mean of R
   * values) exactly -- comparing a mean of R diagonal draws against
   * individual, unaveraged off-diagonal draws would rank two statistics with
   * very different sampling variance against each other and never calibrate
   * correctly.
   */
  nullMeans: number[];
  /**
   * One-sided empirical p, always upper-tail -- every statistic this is used
   * for (nC, PID uniqueE, PID synergy) is a mutual-information-derived
   * quantity bounded below by 0 whose hypothesis is always "elevated", never
   * "depleted": an S-E swap across worlds can only ever destroy genuine
   * coupling, pushing the null toward its floor, never inflate it past the
   * true in-world value. Two different formulas depending on `exact`:
   *
   * - `exact: true`: `nullMeans` IS the full R!-element reference population
   *   (every permutation, identity included), so `p = #{T(pi) >= T(id)} /
   *   R!` directly -- no add-one correction, since the identity's presence
   *   is guaranteed, not merely likely. This gives `p` a floor of exactly
   *   `1/R!`, e.g. 1/2 or 1 at R=2 (only 2! = 2 permutations exist).
   * - `exact: false` (Monte Carlo): `nullMeans` is a random SAMPLE of the
   *   full S_R and may not happen to include the identity draw, so the
   *   classic add-one correction is used instead: `p = (1 + #{draws with T
   *   >= observed}) / (nullDraws + 1)`, which guarantees `p >= 1/(nullDraws
   *   + 1)` and never reports p=0.
   */
  p: number;
  worlds: number;
  /** true when `nullMeans` is the exact, fully-enumerated permutation space (R<=EXACT_PERMUTATION_MAX_N, R! permutations including the identity); false when it is a Monte Carlo sample of `nullDraws` uniformly random permutations (identity included as one possible draw, not forced). At small R this matters for reading `p`: with `exact: true` and few worlds, `nullMeans.length` (=R!) can be tiny (2! = 2, 3! = 6, 4! = 24), so the smallest achievable p is 1/R! -- a precise-looking p far below that floor was never achievable and signals a miscalibrated null, not real significance. */
  exact: boolean;
}

/**
 * Enumerates every permutation of 0..n-1 (the full symmetric group S_n, n!
 * elements, including the identity) via recursive swap-based generation.
 * Exact and fast up to n=EXACT_PERMUTATION_MAX_N (8! = 40,320); n! grows too
 * fast to enumerate beyond that (9! = 362,880, 10! = 3,628,800), so larger n
 * is handled by Monte Carlo sampling in `crossWorldNull` instead of full
 * enumeration.
 */
function enumeratePermutations(n: number): number[][] {
  const result: number[][] = [];
  const perm = Array.from({ length: n }, (_, i) => i);
  const rec = (k: number) => {
    if (k === n) {
      result.push(perm.slice());
      return;
    }
    for (let i = k; i < n; i++) {
      [perm[k], perm[i]] = [perm[i], perm[k]];
      rec(k + 1);
      [perm[k], perm[i]] = [perm[i], perm[k]];
    }
  };
  rec(0);
  return result;
}

/**
 * A uniformly random permutation of 0..n-1 via Fisher-Yates, drawn from the
 * FULL symmetric group S_n (including the identity, which has probability
 * 1/n! like every other permutation -- this is deliberate, not rejection
 * sampled, since under H0 the identity is exchangeable with every other
 * permutation, not excluded from the reference set).
 */
function randomPermutation(n: number, rng: () => number): number[] {
  const perm = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = perm[i];
    perm[i] = perm[j];
    perm[j] = tmp;
  }
  return perm;
}

/** Above this R, exact enumeration of every permutation is no longer cheap (see `enumeratePermutations`'s doc comment), so `crossWorldNull` falls back to Monte Carlo sampling of `nullDraws` uniformly random permutations instead. */
const EXACT_PERMUTATION_MAX_N = 8;

/**
 * `statistic(s, e, sNext)` is computed once per world on that world's own
 * (in-world) arrays for the diagonal (pairStat[a][a], reused as `perWorld`),
 * and once per ordered (a,b) pair with a!=b using world a's s/sNext against
 * world b's e for the off-diagonal pool that feeds every non-identity
 * permutation. Under H0, the S-series and E-series of i.i.d. replicate worlds
 * are independent, so the joint law is invariant under any relabelling of
 * which world's E accompanies which world's S/S': the reference statistic is
 * T(pi) = mean over a of pairStat[a][pi(a)], evaluated over the FULL
 * symmetric group S_R (every permutation of the R worlds, including the
 * identity -- not just the fixed-point-free derangements). The identity
 * permutation gives T(id) = observed exactly, so it is always one of the
 * reference values this ranks against, which is what guarantees `p >= 1/R!`
 * (exact) or `p >= 1/(nullDraws+1)` (Monte Carlo) as a matter of
 * construction, not a floor bolted on after the fact. `nullMeans` resamples
 * that R*(R-1) surrogate pool (plus the R diagonal values, via the identity
 * and any other permutation with fixed points) into R-averaged draws so the
 * null is ranked on the same aggregation level as `observed`. When
 * R<=EXACT_PERMUTATION_MAX_N every permutation is enumerated exactly
 * (`exact: true`, `nullMeans.length` = R!); this is important, not cosmetic,
 * at the small R this file routinely sees (an anchor can be eligible in as
 * few as 2 of the worlds) -- with only a handful of distinct permutations,
 * Monte Carlo re-sampling the same few values thousands of times would count
 * each one thousands of times over in the p-value's denominator, producing
 * an artificially sharp-looking p that a handful of truly exchangeable
 * arrangements cannot support (R=2 has exactly 2! = 2 possible permutations,
 * so the honest, maximally-informative p is 1/2 or 1, never anything close
 * to 1/2000). Above that cutoff, `nullMeans` is `nullDraws` (default 2000)
 * independent draws of `randomPermutation`, uniformly over the full S_R
 * (the identity can be drawn like any other permutation, with probability
 * 1/R!, and is not treated specially). Requires worlds.length >= 2 and every
 * world the same length T (index-paired substitution across worlds is only
 * meaningful at matched relative-window positions).
 */
export function crossWorldNull(
  worlds: readonly WorldTrajectory[],
  statistic: (s: Uint8Array, e: Uint8Array, sNext: Uint8Array) => number,
  opts: { nullDraws?: number; seed?: number } = {},
): CrossWorldNullResult {
  const R = worlds.length;
  if (R < 2) throw new Error(`crossWorldNull: requires >=2 worlds, got ${R}`);
  const T = worlds[0].s.length;
  for (const w of worlds) if (w.s.length !== T) throw new Error(`crossWorldNull: every world must have the same length T (got ${w.s.length} and ${T})`);
  // pairStat[a][b] (all a,b, including a===b) computed once and reused by
  // every permutation draw below. The diagonal IS the observed statistic
  // (T(id) = mean_a pairStat[a][a] = observed), so it is folded into the
  // same table the off-diagonal surrogate pool uses, rather than computed
  // separately -- this is what lets the identity permutation participate in
  // `nullMeans` on exactly the same footing as every other permutation.
  const pairStat: number[][] = Array.from({ length: R }, () => new Array<number>(R).fill(NaN));
  for (let a = 0; a < R; a++) {
    for (let b = 0; b < R; b++) {
      pairStat[a][b] = a === b ? statistic(worlds[a].s, worlds[a].e, worlds[a].sNext) : statistic(worlds[a].s, worlds[b].e, worlds[a].sNext);
    }
  }
  const perWorld = Array.from({ length: R }, (_, a) => pairStat[a][a]);
  const observed = mean(perWorld);
  const meanOfPerm = (perm: number[]) => {
    let sum = 0;
    for (let aIdx = 0; aIdx < R; aIdx++) sum += pairStat[aIdx][perm[aIdx]];
    return sum / R;
  };
  let nullMeans: number[];
  let exact: boolean;
  if (R <= EXACT_PERMUTATION_MAX_N) {
    nullMeans = enumeratePermutations(R).map(meanOfPerm);
    exact = true;
  } else {
    const draws = opts.nullDraws ?? 2000;
    const rng = mulberry32(opts.seed ?? 0);
    nullMeans = [];
    for (let d = 0; d < draws; d++) nullMeans.push(meanOfPerm(randomPermutation(R, rng)));
    exact = false;
  }
  const atLeastAsExtreme = nullMeans.filter((v) => v >= observed).length;
  // Exact: the R! enumerated permutations already form the full reference
  // population (identity included), so p = #{T(pi) >= T(id)} / R! directly
  // -- no add-one correction, since the identity is guaranteed present, not
  // merely likely. At R=2 this gives exactly 1/2 or 1, never 2/3 or 1.
  // Monte Carlo: `nullMeans` is a SAMPLE of the full S_R, which may not
  // happen to include the identity draw, so the classic add-one correction
  // (p = (1+count)/(draws+1)) is used instead to guarantee p >= 1/(draws+1)
  // and avoid ever reporting p=0.
  const p = exact ? atLeastAsExtreme / nullMeans.length : (1 + atLeastAsExtreme) / (nullMeans.length + 1);
  return { observed, perWorld, nullMeans, exact, p, worlds: R };
}

// ---------------------------------------------------------------------------
// 4. The individuality report over R worlds of one aggregate anchor
// ---------------------------------------------------------------------------

export interface IndividualityResult {
  worlds: number; // R worlds actually used (eligible, after exclusion)
  excludedWorlds: number; // worlds where this anchor was ineligible: never existed at window start, or existed but was excluded (died/fissioned/fused mid-window, or a non-finite feature)
  windowLength: number; // T
  /**
   * Per-world samples per cell of the |S|*|S'| and |S|*|E|*|S'| tables: T
   * divided by the table size, NOT R*T -- every MI table here is fit once
   * PER WORLD from that world's own T observations (bootstrapOverWorlds
   * computes `statistic` once per world, never on symbols pooled across
   * worlds; see its doc comment), so adding more worlds improves the
   * precision of the *mean across worlds* but does not add observations to
   * any individual entropy estimate. Reporting R*T here would understate
   * how sparse each fitted table actually is and under-trigger the
   * small-sample warning built on this diagnostic.
   */
  occupancy: { sTable: number; jointTable: number };
  autonomyStar: BootstrapCI; // A* = I(S;S')
  jointMI: BootstrapCI; // I(S,E;S')
  environmentMI: BootstrapCI; // I(E;S')
  autonomyGivenE: BootstrapCI; // A, derived per-replicate: jointMI(pooled) - environmentMI(pooled)
  ntic: BootstrapCI; // A* - A, derived per-replicate
  nonClosure: { ci: BootstrapCI; nullTest: CrossWorldNullResult }; // nC = jointMI - autonomyStar
  pid: {
    redundancy: BootstrapCI;
    uniqueS: BootstrapCI;
    uniqueE: { ci: BootstrapCI; nullTest: CrossWorldNullResult };
    synergy: { ci: BootstrapCI; nullTest: CrossWorldNullResult };
  };
}

/** The 10 quantities `individualityReport` bootstraps a CI for, computed once per world. */
interface WorldStats {
  autonomyStar: number;
  jointMI: number;
  environmentMI: number;
  autonomyGivenE: number;
  ntic: number;
  nonClosure: number;
  redundancy: number;
  uniqueS: number;
  uniqueE: number;
  synergy: number;
}

/** Per-quantity seed offset so each of the 10 bootstraps below draws an independent resample sequence. */
const WORLD_STAT_SEED_OFFSET: Record<keyof WorldStats, number> = {
  autonomyStar: 0,
  jointMI: 1,
  environmentMI: 2,
  autonomyGivenE: 3,
  ntic: 4,
  nonClosure: 5,
  redundancy: 6,
  uniqueS: 7,
  uniqueE: 8,
  synergy: 9,
};

function computeWorldStats(w: WorldTrajectory, sAlphabet: number, eAlphabet: number): WorldStats {
  const autonomyStar = mutualInformationDiscrete(w.s, w.sNext, sAlphabet, sAlphabet).corrected;
  const jointMI = jointMutualInformationDiscrete(w.s, w.e, w.sNext, sAlphabet, eAlphabet, sAlphabet).corrected;
  const environmentMI = mutualInformationDiscrete(w.e, w.sNext, eAlphabet, sAlphabet).corrected;
  const autonomyGivenE = jointMI - environmentMI;
  const nonClosure = jointMI - autonomyStar;
  const ntic = autonomyStar - autonomyGivenE;
  const pid = williamsBeerPID(w.s, w.e, w.sNext, sAlphabet, eAlphabet, sAlphabet);
  return { autonomyStar, jointMI, environmentMI, autonomyGivenE, ntic, nonClosure, redundancy: pid.redundancy, uniqueS: pid.uniqueS, uniqueE: pid.uniqueE, synergy: pid.synergy };
}

/**
 * The one function tools/individuality.ts calls per candidate aggregate
 * anchor. Pure (no I/O) -- every branch directly vitest-testable without a
 * simulator. `worlds` must already be the ELIGIBLE worlds for this anchor
 * (the caller excludes a world up front if the anchor didn't survive its
 * window intact) AND must already be symbolized with bins that are FIXED and
 * INDEPENDENT of `worlds` itself -- fit from separate calibration worlds, not
 * from the analysis worlds being bootstrapped or permuted here (see
 * `docs/individuality-info-theory.md` §3). Refitting bins from data that
 * includes duplicated analysis worlds (as an earlier version of this file
 * did inside the bootstrap) makes the refit bins fit each resampled world
 * more tightly than an independent fit would, biasing every derived
 * plug-in-MI quantity upward; there is no way to correct for that bias from
 * inside the bootstrap itself, so the fix is to never let the bootstrap (or
 * the permutation null) touch the bins at all. `opts.excludedWorlds` just
 * carries the caller's own exclusion count through to the result for
 * reporting, since this function never sees the excluded worlds themselves.
 *
 * Quantities whose null hypothesis is "no S-E coupling" (nonClosure, PID
 * uniqueE, PID synergy -- nC = uniqueE + synergy) get the cross-world null
 * (`crossWorldNull`, unaffected by bin choice either way: permuting which
 * world's E accompanies which world's S/S' never changes the pooled
 * multiset of raw feature values, so it was always valid with frozen bins).
 * Everything else gets `bootstrapOverWorlds`, a plain percentile CI over the
 * R per-world statistic values with the bins held fixed throughout --
 * `BootstrapCI.status` on each result reports whether R clears
 * `MIN_CALIBRATED_WORLDS` (coverage-checked) or not (`"uncalibrated"`,
 * report as a descriptive resampling range).
 */
export function individualityReport(
  worlds: readonly WorldTrajectory[],
  sAlphabet: number,
  eAlphabet: number,
  opts: {
    bootstrapDraws?: number;
    seed?: number;
    alpha?: number;
    excludedWorlds?: number;
  } = {},
): IndividualityResult {
  const R = worlds.length;
  if (R < 2) throw new Error(`individualityReport: requires >=2 worlds, got ${R}`);
  const T = worlds[0].s.length;
  for (const w of worlds) {
    if (w.s.length !== T || w.sNext.length !== T || w.e.length !== T) {
      throw new Error(`individualityReport: every world must share window length T=${T}`);
    }
  }
  const draws = opts.bootstrapDraws ?? 2000;
  const seed = opts.seed ?? 0;
  const alpha = opts.alpha ?? 0.1;

  const ciByKey: Record<keyof WorldStats, BootstrapCI> = (() => {
    const keys = Object.keys(WORLD_STAT_SEED_OFFSET) as (keyof WorldStats)[];
    const out = {} as Record<keyof WorldStats, BootstrapCI>;
    for (const k of keys) {
      out[k] = bootstrapOverWorlds(worlds, (w) => computeWorldStats(w, sAlphabet, eAlphabet)[k], { draws, alpha, seed: seed + WORLD_STAT_SEED_OFFSET[k] });
    }
    return out;
  })();

  // crossWorldNull always uses `worlds` as given (bins already fixed and
  // frozen before this function is even called) -- permuting which world's E
  // accompanies which world's S/S' never changes the pooled multiset of raw
  // feature values, so it is unaffected by the bin-fitting fix either way.
  const nullNonClosure = (s: Uint8Array, e: Uint8Array, sNext: Uint8Array) =>
    jointMutualInformationDiscrete(s, e, sNext, sAlphabet, eAlphabet, sAlphabet).corrected - mutualInformationDiscrete(s, sNext, sAlphabet, sAlphabet).corrected;
  const nullUniqueE = (s: Uint8Array, e: Uint8Array, sNext: Uint8Array) => williamsBeerPID(s, e, sNext, sAlphabet, eAlphabet, sAlphabet).uniqueE;
  const nullSynergy = (s: Uint8Array, e: Uint8Array, sNext: Uint8Array) => williamsBeerPID(s, e, sNext, sAlphabet, eAlphabet, sAlphabet).synergy;

  return {
    worlds: R,
    excludedWorlds: opts.excludedWorlds ?? 0,
    windowLength: T,
    occupancy: { sTable: T / (sAlphabet * sAlphabet), jointTable: T / (sAlphabet * eAlphabet * sAlphabet) },
    autonomyStar: ciByKey.autonomyStar,
    jointMI: ciByKey.jointMI,
    environmentMI: ciByKey.environmentMI,
    autonomyGivenE: ciByKey.autonomyGivenE,
    ntic: ciByKey.ntic,
    nonClosure: { ci: ciByKey.nonClosure, nullTest: crossWorldNull(worlds, nullNonClosure, { seed: seed + 100 }) },
    pid: {
      redundancy: ciByKey.redundancy,
      uniqueS: ciByKey.uniqueS,
      uniqueE: { ci: ciByKey.uniqueE, nullTest: crossWorldNull(worlds, nullUniqueE, { seed: seed + 101 }) },
      synergy: { ci: ciByKey.synergy, nullTest: crossWorldNull(worlds, nullSynergy, { seed: seed + 102 }) },
    },
  };
}

// ---------------------------------------------------------------------------
// 5. Raw feature extraction and coarse-graining (S_t and E_t)
// ---------------------------------------------------------------------------

import { CH, ROLE_WORDS, cellCount, worldW, type WorldConfig } from "@bl/schema";

export interface AggregateFeatures {
  /** log2(total B+P mass over the mask); NaN if the mask is empty or fully decayed (aggregate died -- caller excludes, never bins NaN). */
  logMass: number;
  /**
   * Mean P/(B+P) over occupied masked cells. NaN if every masked cell has
   * zero B+P. Deliberately an unweighted per-cell mean, NOT the mass-weighted
   * P_total/(B+P)_total ratio complexity.ts's morphology() computes for its
   * own membraneFraction -- a low-mass polymer-rich cell gets equal weight to
   * a high-mass biomass-rich cell here, unlike in morphology(). This is a
   * deliberately different quantity (a per-cell mean better reflects "what
   * fraction of this aggregate's tissue is membrane" independent of local
   * mass concentration); do not assume the two numbers agree.
   */
  membraneFraction: number;
  /**
   * Mean photo/(photo+grow+decomp) share over masked cells with nonzero
   * total reaction amount -- how phototroph-dominated the aggregate's own
   * catalysis was this step (reuses classify()'s inputs, not its 4-way
   * output). NaN if every masked cell is fully dormant (photo+grow+decomp === 0).
   */
  photoShare: number;
}

export function aggregateFeatures(cfg: WorldConfig, cells: Uint32Array, roles: Uint32Array, mask: Uint8Array): AggregateFeatures {
  const n = cellCount(cfg);
  let totalMass = 0;
  let mfSum = 0, mfCount = 0;
  let psSum = 0, psCount = 0;
  for (let i = 0; i < n; i++) {
    if (!mask[i]) continue;
    const b = cells[CH.B * n + i], p = cells[CH.P * n + i];
    const bp = b + p;
    totalMass += bp;
    if (bp > 0) {
      mfSum += p / bp;
      mfCount++;
    }
    const w0 = roles[i * ROLE_WORDS];
    const w1 = roles[i * ROLE_WORDS + 1];
    const photo = w0 & 0xffff, grow = w0 >>> 16, decomp = w1 & 0xffff;
    const total = photo + grow + decomp;
    if (total > 0) {
      psSum += photo / total;
      psCount++;
    }
  }
  return {
    logMass: totalMass > 0 ? Math.log2(totalMass) : NaN,
    membraneFraction: mfCount > 0 ? mfSum / mfCount : NaN,
    photoShare: psCount > 0 ? psSum / psCount : NaN,
  };
}

export interface EnvironmentFeatures {
  /** Mean sim.light(x,y,step) over the ring (0..255 raw scale). NaN if the ring is empty (mask covers the whole world). */
  meanLight: number;
  /** Mean dissolved nutrient A over the ring. Same NaN-on-empty-ring rule. */
  meanNutrientA: number;
  /** Diagnostic only, not binned: number of cells in the ring. */
  ringCells: number;
}

/**
 * `ringWidth` cells outside `mask` (default 6, one past the world's own
 * `kernelRadius: 5`, to include the immediate causal boundary layer without
 * going needlessly wide), found by a torus-aware BFS dilation minus `mask`
 * itself. Cells belonging to another aggregate are NOT excluded -- the
 * physical neighbourhood is the environment regardless of what else is
 * tracked there. `light` must be an explicit `(x, y) => sim.light(x, y, step)`
 * closure over the current recorded step, never a bound method -- RefSim.light
 * requires all three arguments, and a 2-arg callback silently passing
 * `undefined` for `step` would corrupt the seasonal/gradient component.
 */
export function environmentFeatures(cfg: WorldConfig, cells: Uint32Array, mask: Uint8Array, light: (x: number, y: number) => number, ringWidth = 6): EnvironmentFeatures {
  const n = cellCount(cfg);
  const W = worldW(cfg);
  const { tileW, tileH } = cfg;
  const visited = new Uint8Array(n);
  const ring = new Uint8Array(n);
  let frontier: number[] = [];
  for (let i = 0; i < n; i++) {
    if (mask[i]) {
      visited[i] = 1;
      frontier.push(i);
    }
  }
  for (let step = 0; step < ringWidth && frontier.length; step++) {
    const next: number[] = [];
    for (const i of frontier) {
      const x = i % W, y = (i - x) / W;
      const tx = Math.floor(x / tileW), ty = Math.floor(y / tileH);
      const lx = x - tx * tileW, ly = y - ty * tileH;
      for (let d = 0; d < 4; d++) {
        const dx = d === 0 ? 1 : d === 1 ? -1 : 0;
        const dy = d === 2 ? 1 : d === 3 ? -1 : 0;
        const nx = tx * tileW + ((lx + dx + tileW) % tileW);
        const ny = ty * tileH + ((ly + dy + tileH) % tileH);
        const j = ny * W + nx;
        if (visited[j]) continue;
        visited[j] = 1;
        if (!mask[j]) ring[j] = 1;
        next.push(j);
      }
    }
    frontier = next;
  }
  let sumLight = 0, sumA = 0, count = 0;
  for (let i = 0; i < n; i++) {
    if (!ring[i]) continue;
    const x = i % W, y = (i - x) / W;
    sumLight += light(x, y);
    sumA += cells[CH.A * n + i];
    count++;
  }
  return { meanLight: count > 0 ? sumLight / count : NaN, meanNutrientA: count > 0 ? sumA / count : NaN, ringCells: count };
}

export interface QuantileBinner {
  /** length <= bins - 1, deduplicated. */
  edges: number[];
  /** Effective number of distinct bins after deduplicating coincident edges (<= the requested `bins`). A near-constant feature legitimately collapses to fewer effective bins; report this next to every aggregate's alphabet size. */
  effectiveBins: number;
}

/**
 * Fits quantile bin edges from a finite sample (NaN/non-finite values are
 * dropped before fitting -- the caller must exclude a whole (t,t+1) tuple
 * when any one of its features is non-finite, so time alignment across
 * features never drifts). Ties at an edge fall in the lower bin (`<=`), a
 * deterministic, no-empty-bin-guarantee choice; duplicate computed edges
 * (constant or heavily-tied input) collapse to fewer effective bins rather
 * than producing empty bins. A trailing edge equal to the fitted sample's own
 * maximum is also dropped: with `<=` semantics that edge can never separate
 * any fitted value from the ones above it (there are none), so keeping it
 * would overstate `effectiveBins` by one without adding a real partition --
 * e.g. `[7,7,7]` at 3 requested bins fits a single raw edge of `7`, which
 * would otherwise report `effectiveBins=2` while every sample (including a
 * hypothetical future `7`) still maps to bin 0.
 *
 * The caller (tools/individuality.ts) fits one binner per aggregate anchor
 * from the CONCATENATION of that anchor's raw feature history across every
 * eligible world, never per-world: per-world bins would give the same
 * symbol different underlying value ranges in different worlds, which
 * invalidates both the cross-world null (pairing s_a with e_b is meaningless
 * if their alphabets encode different cutpoints) and the pooled bootstrap CI.
 */
export function fitQuantileBins(xs: number[], bins: number): QuantileBinner {
  const finite = xs.filter((v) => Number.isFinite(v)).slice().sort((a, b) => a - b);
  if (finite.length === 0) return { edges: [], effectiveBins: 1 };
  const raw: number[] = [];
  for (let k = 1; k < bins; k++) {
    const pos = (k / bins) * (finite.length - 1);
    const lo = Math.floor(pos), hi = Math.ceil(pos);
    raw.push(lo === hi ? finite[lo] : finite[lo] + (finite[hi] - finite[lo]) * (pos - lo));
  }
  const edges: number[] = [];
  for (const v of raw) if (edges.length === 0 || v > edges[edges.length - 1]) edges.push(v);
  const max = finite[finite.length - 1];
  if (edges.length && edges[edges.length - 1] === max) edges.pop();
  return { edges, effectiveBins: edges.length + 1 };
}

/** 0..effectiveBins-1, or -1 for non-finite input (caller must exclude -1, never treat it as a symbol). */
export function applyQuantileBins(x: number, binner: QuantileBinner): number {
  if (!Number.isFinite(x)) return -1;
  let bin = 0;
  for (const e of binner.edges) {
    if (x <= e) break;
    bin++;
  }
  return bin;
}
