// Test-6 measures, rebuilt (plans/005-rebuild-test6-measures.md). Pure functions over async iterables of
// censuses (lineages.tsv) and profile rows (profiles.tsv); no Deno or filesystem access, so vitest can run them.
// The shadow in "full" mode is the original of tools/foundations.ts `shadowExcess` (same PRNG, same sampler,
// same draw order), generalised to any census stream, any number of shadows and a rank; "observed" mode keeps
// the real world's turnover. The profile measures are keyed on phenotype bins and profiles, never on lineage IDs.

/** Deterministic PRNG (mulberry32); verbatim from tools/foundations.ts. */
export function rng(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** Binomial draw: inversion for small means, a clamped normal approximation otherwise; verbatim from tools/foundations.ts. */
export function binom(n: number, p: number, r: () => number): number {
  if (n <= 0 || p <= 0) return 0;
  if (p >= 1) return n;
  if (p > 0.5) return n - binom(n, 1 - p, r);
  const mean = n * p;
  if (mean < 30) {
    const q = 1 - p, s = p / q;
    let k = 0, pk = Math.pow(q, n), cdf = pk;
    const u = r();
    while (u > cdf && k < n) {
      pk *= (s * (n - k)) / (k + 1);
      cdf += pk;
      k++;
    }
    return k;
  }
  const u1 = r() || 1e-12, u2 = r();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return Math.max(0, Math.min(n, Math.round(mean + z * Math.sqrt(mean * (1 - p)))));
}

/** Linear-interpolated quantile of an ascending array; verbatim from tools/foundations.ts. */
export function quantileSorted(xs: number[], q: number): number {
  if (!xs.length) return NaN;
  const pos = (xs.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return xs[lo] + (xs[hi] - xs[lo]) * (pos - lo);
}

// ---------------------------------------------------------------------------------------------
// Shadow excess.

export type Census = [number, [string, number][]];
export interface ShadowResult {
  real: number;
  shadowMedian: number;
  shadowMax: number;
  excess: number;
  flagged: boolean;
  /** Number of shadows the real run strictly exceeds (0..k); flagged is rank === k. */
  rank: number;
  k: number;
  /**
   * Number of shadows exactly equal to the real value (0..k). Strict ranks are not uniform when the real run ties
   * shadows (a run whose shadows all match it has rank 0 whatever the null); `ties` feeds the tie-aware
   * diagnostic `tieBrokenRanks`. Strict `rank`, `flagged` and `rankUniformity` are unchanged.
   */
  ties: number;
}

/**
 * Fraction of the previous census's cells replaced by the current one: (sum over keys of |c_t - c_{t-1}|) /
 * (2 * total_{t-1}), clamped to [0, 1]; 1 when there is no previous census. Rows with no cells count as absent.
 */
export function realTurnover(prev: Map<string, number> | null, now: [string, number][]): number {
  if (!prev) return 1;
  let total = 0;
  for (const c of prev.values()) total += c;
  if (total <= 0) return 1;
  // Keys of the current census contribute |c - p|; keys that vanished contribute their whole previous count.
  let diff = total;
  for (const [key, c] of now) {
    if (c <= 0) continue;
    const p = prev.get(key) ?? 0;
    diff += Math.abs(c - p) - p;
  }
  return Math.min(1, Math.max(0, diff / (2 * total)));
}

/**
 * Shadow excess as in tools/foundations.ts `shadowExcess`, over any census stream, with `k` shadows and a turnover mode.
 * Each shadow keeps the run's living cells at each census and its lineage births (each entering at its first-census
 * count) and redraws the remaining cells multinomially from its own previous abundances:
 *  - "full": every surviving cell is redrawn each census (the original);
 *  - "observed": each shadow component first keeps Binomial(x_i, 1 - tau) of its cells (capped from the end so the
 *    kept total never exceeds the cells to fill), and only the rest is redrawn; tau = the real world's turnover
 *    between consecutive censuses (see realTurnover).
 * `rank` = number of shadows the real run strictly exceeds (0..k). One PRNG stream, seeded by `seed`, serves all shadows.
 *
 * This is the plain-arrays REFERENCE implementation (the structure of the original loop). `shadowExcessStream` below computes
 * exactly the same numbers, in the same order of PRNG draws, faster; the tests hold the two equal in both modes.
 */
export async function shadowExcessReference(censuses: AsyncIterable<Census>, threshold: number, k: number, seed: number, turnover: "full" | "observed"): Promise<ShadowResult> {
  const r = rng(seed);
  let prev: Map<string, number> | null = null;
  const real = new Map<string, { act: number; crossed: boolean }>();
  let realNew = 0;
  const sh = Array.from({ length: k }, () => ({ counts: [] as number[], act: [] as number[], crossed: [] as boolean[], cumNew: 0 }));
  for await (const [, rows] of censuses) {
    const tau = turnover === "observed" ? realTurnover(prev, rows) : 1;
    const now = new Map<string, number>();
    let total = 0, bornCells = 0;
    const births: number[] = [];
    for (const [key, c] of rows) {
      if (c <= 0) continue;
      now.set(key, c);
      total += c;
      let v = real.get(key);
      if (!v) real.set(key, (v = { act: 0, crossed: false }));
      v.act += c;
      if (!v.crossed && v.act > threshold) {
        v.crossed = true;
        realNew++;
      }
      if (!prev || !prev.has(key)) {
        births.push(c);
        bornCells += c;
      }
    }
    for (const key of [...real.keys()]) if (!now.has(key)) real.delete(key);
    prev = now;
    const rest = Math.max(0, total - bornCells);
    for (const x of sh) {
      const mass = x.counts.reduce((s, c) => s + c, 0);
      const counts: number[] = [], act: number[] = [], crossed: boolean[] = [];
      if (turnover === "full" || mass <= 0) {
        let n = mass > 0 ? rest : 0, left = mass;
        for (let i = 0; i < x.counts.length && n > 0; i++) {
          const c = binom(n, x.counts[i] / left, r);
          left -= x.counts[i];
          n -= c;
          if (c > 0) {
            counts.push(c);
            act.push(x.act[i] + c);
            crossed.push(x.crossed[i]);
          }
        }
      } else {
        const m = x.counts.length;
        const keep = new Array<number>(m);
        let kept = 0;
        for (let i = 0; i < m; i++) kept += keep[i] = binom(x.counts[i], 1 - tau, r);
        for (let i = m - 1; i >= 0 && kept > rest; i--) {
          const d = Math.min(keep[i], kept - rest);
          keep[i] -= d;
          kept -= d;
        }
        let n = rest - kept, left = mass;
        for (let i = 0; i < m; i++) {
          const d = n > 0 ? binom(n, x.counts[i] / left, r) : 0;
          left -= x.counts[i];
          n -= d;
          const c = keep[i] + d;
          if (c > 0) {
            counts.push(c);
            act.push(x.act[i] + c);
            crossed.push(x.crossed[i]);
          }
        }
      }
      for (const b of births) {
        counts.push(b);
        act.push(b);
        crossed.push(false);
      }
      for (let i = 0; i < act.length; i++)
        if (!crossed[i] && act[i] > threshold) {
          crossed[i] = true;
          x.cumNew++;
        }
      [x.counts, x.act, x.crossed] = [counts, act, crossed];
    }
  }
  const shadows = sh.map((x) => x.cumNew).sort((p, q) => p - q);
  const median = quantileSorted(shadows, 0.5);
  const rank = shadows.filter((s) => s < realNew).length;
  const ties = shadows.filter((s) => s === realNew).length;
  return { real: realNew, shadowMedian: median, shadowMax: shadows[shadows.length - 1], excess: realNew - median, flagged: realNew > shadows[shadows.length - 1], rank, k, ties };
}

/**
 * Binomial(n, p) with the arithmetic of `binom` for one fixed p (so the same draws, bit for bit), memoising
 * Math.pow(q, n) per n: within a census every shadow component draws with the same p.
 */
function fixedBinom(p: number): (n: number, r: () => number) => number {
  if (p <= 0) return () => 0;
  if (p >= 1) return (n) => (n <= 0 ? 0 : n);
  if (p > 0.5) {
    const inner = fixedBinom(1 - p);
    return (n, r) => (n <= 0 ? 0 : n - inner(n, r));
  }
  const q = 1 - p, s = p / q;
  const pow: number[] = [];
  return (n, r) => {
    if (n <= 0) return 0;
    const mean = n * p;
    if (mean < 30) {
      let k = 0, pk = pow[n] ?? (pow[n] = Math.pow(q, n)), cdf = pk;
      const u = r();
      while (u > cdf && k < n) {
        pk *= (s * (n - k)) / (k + 1);
        cdf += pk;
        k++;
      }
      return k;
    }
    const u1 = r() || 1e-12, u2 = r();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return Math.max(0, Math.min(n, Math.round(mean + z * Math.sqrt(mean * (1 - p)))));
  };
}

/** One shadow's components in typed arrays, double-buffered (a census is written into the spare set, then the sets swap). */
interface ShadowState {
  c: Float64Array; a: Float64Array; x: Uint8Array; // counts, activity, crossed
  c2: Float64Array; a2: Float64Array; x2: Uint8Array;
  len: number;
  mass: number;
  cumNew: number;
}

/**
 * `shadowExcessReference`, computed the same way but without per-census array allocation and with a memoised power in the
 * keep step: identical results, including the order of PRNG draws (the tests hold it equal to the reference in both modes).
 */
export async function shadowExcessStream(censuses: AsyncIterable<Census>, threshold: number, k: number, seed: number, turnover: "full" | "observed"): Promise<ShadowResult> {
  const r = rng(seed);
  let prev: Map<string, number> | null = null;
  const real = new Map<string, { act: number; crossed: boolean }>();
  let realNew = 0;
  const sh: ShadowState[] = Array.from({ length: k }, () => ({ c: new Float64Array(16), a: new Float64Array(16), x: new Uint8Array(16), c2: new Float64Array(16), a2: new Float64Array(16), x2: new Uint8Array(16), len: 0, mass: 0, cumNew: 0 }));
  let keep = new Float64Array(16);
  for await (const [, rows] of censuses) {
    const tau = turnover === "observed" ? realTurnover(prev, rows) : 1;
    const now = new Map<string, number>();
    let total = 0, bornCells = 0;
    const births: number[] = [];
    for (const [key, c] of rows) {
      if (c <= 0) continue;
      now.set(key, c);
      total += c;
      let v = real.get(key);
      if (!v) real.set(key, (v = { act: 0, crossed: false }));
      v.act += c;
      if (!v.crossed && v.act > threshold) {
        v.crossed = true;
        realNew++;
      }
      if (!prev || !prev.has(key)) {
        births.push(c);
        bornCells += c;
      }
    }
    for (const key of [...real.keys()]) if (!now.has(key)) real.delete(key);
    prev = now;
    const rest = Math.max(0, total - bornCells);
    const keeper = turnover === "observed" ? fixedBinom(1 - tau) : null;
    for (const x of sh) {
      const m = x.len, mass = x.mass;
      // Room for the output: at most the old components plus the births.
      if (x.c2.length < m + births.length) {
        const cap = Math.max(m + births.length, 2 * x.c2.length);
        x.c2 = new Float64Array(cap);
        x.a2 = new Float64Array(cap);
        x.x2 = new Uint8Array(cap);
      }
      const { c, a, x: cr, c2, a2, x2 } = x;
      let out = 0, newMass = 0;
      if (keeper === null || mass <= 0) {
        let n = mass > 0 ? rest : 0, left = mass;
        for (let i = 0; i < m && n > 0; i++) {
          const d = binom(n, c[i] / left, r);
          left -= c[i];
          n -= d;
          if (d > 0) {
            c2[out] = d;
            const act = a[i] + d;
            a2[out] = act;
            if (!cr[i] && act > threshold) {
              x2[out] = 1;
              x.cumNew++;
            } else x2[out] = cr[i];
            newMass += d;
            out++;
          }
        }
      } else {
        if (keep.length < m) keep = new Float64Array(2 * m);
        let kept = 0;
        for (let i = 0; i < m; i++) kept += keep[i] = keeper(c[i], r);
        for (let i = m - 1; i >= 0 && kept > rest; i--) {
          const d = Math.min(keep[i], kept - rest);
          keep[i] -= d;
          kept -= d;
        }
        let n = rest - kept, left = mass;
        for (let i = 0; i < m; i++) {
          const d = n > 0 ? binom(n, c[i] / left, r) : 0;
          left -= c[i];
          n -= d;
          const cnt = keep[i] + d;
          if (cnt > 0) {
            c2[out] = cnt;
            const act = a[i] + cnt;
            a2[out] = act;
            if (!cr[i] && act > threshold) {
              x2[out] = 1;
              x.cumNew++;
            } else x2[out] = cr[i];
            newMass += cnt;
            out++;
          }
        }
      }
      for (const b of births) {
        c2[out] = b;
        a2[out] = b;
        if (b > threshold) {
          x2[out] = 1;
          x.cumNew++;
        } else x2[out] = 0;
        newMass += b;
        out++;
      }
      x.c = c2; x.a = a2; x.x = x2; x.c2 = c; x.a2 = a; x.x2 = cr;
      x.len = out;
      x.mass = newMass;
    }
  }
  const shadows = sh.map((x) => x.cumNew).sort((p, q) => p - q);
  const median = quantileSorted(shadows, 0.5);
  const rank = shadows.filter((s) => s < realNew).length;
  const ties = shadows.filter((s) => s === realNew).length;
  return { real: realNew, shadowMedian: median, shadowMax: shadows[shadows.length - 1], excess: realNew - median, flagged: realNew > shadows[shadows.length - 1], rank, k, ties };
}

// ---------------------------------------------------------------------------------------------
// Cache inputs.

/**
 * What a cached shadow/profile value was computed from, cheap to read (the manifest plus the sizes of the two tables, no
 * table reads): enough to notice that a cache entry is being reused with another set of files. A field is null when the
 * source lacks it (a missing table, an old manifest).
 */
export interface RunInput {
  runId: string | null;
  initHash: string | null;
  finalHash: string | null;
  steps: number | null;
  metricsVersion: number | null;
  lineagesBytes: number | null;
  profilesBytes: number | null;
}
export const RUN_INPUT_FIELDS: readonly (keyof RunInput)[] = ["runId", "initHash", "finalHash", "steps", "metricsVersion", "lineagesBytes", "profilesBytes"];

/** Every field in which `cached` differs from `now`, as "<field>: cached X, now Y" (empty when the inputs agree). */
export function runInputDifferences(cached: RunInput, now: RunInput): string[] {
  return RUN_INPUT_FIELDS.filter((f) => cached[f] !== now[f]).map((f) => `${f}: cached ${String(cached[f])}, now ${String(now[f])}`);
}

// ---------------------------------------------------------------------------------------------
// Rank uniformity.

/** ln Gamma(x) (Lanczos, g = 7), accurate to about 1e-13 for x > 0. */
function lnGamma(x: number): number {
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lnGamma(1 - x);
  x -= 1;
  let a = c[0];
  const t = x + 7.5;
  for (let i = 1; i < 9; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

/** Regularised upper incomplete gamma Q(a, x): series for x < a + 1, continued fraction (modified Lentz) otherwise. */
function gammaQ(a: number, x: number): number {
  if (x <= 0) return 1;
  const lg = lnGamma(a);
  if (x < a + 1) {
    let ap = a, sum = 1 / a, del = sum;
    for (let n = 0; n < 1000; n++) {
      ap += 1;
      del *= x / ap;
      sum += del;
      if (Math.abs(del) < Math.abs(sum) * 1e-16) break;
    }
    return 1 - sum * Math.exp(-x + a * Math.log(x) - lg);
  }
  const tiny = 1e-300;
  let b = x + 1 - a, c = 1 / tiny, d = 1 / b, h = d;
  for (let i = 1; i < 1000; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < tiny) d = tiny;
    c = b + an / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-16) break;
  }
  return Math.exp(-x + a * Math.log(x) - lg) * h;
}

/** Survival function P(X >= x) of a chi-square variable with `df` degrees of freedom. */
export function chiSquareSf(x: number, df: number): number {
  return gammaQ(df / 2, x / 2);
}

export interface RankUniformity {
  n: number;
  k: number;
  /** Observed counts per bin. */
  bins: number[];
  /** Expected counts per bin: n * (ranks in the bin) / (k + 1). */
  expected: number[];
  chi2: number;
  df: number;
  /** Exact chi-square survival function (regularised incomplete gamma). */
  p: number;
  /** Mean of rank / k. */
  meanRankOverK: number;
}

/**
 * Randomised tie-breaking of strict ranks: each item's rank becomes `rank + floor(u * (ties + 1))`, with `u` drawn from
 * `rng(seed)` in input order (one draw per item, even when ties = 0, so the sequence is fixed by the list order).
 * Under exchangeability of the real run and its shadows, the tie-broken rank is uniform on 0..k for an ideal uniform
 * `u` (exact in the idealised formula; the 32-bit PRNG grid adds a negligible bias), which the strict rank is not when
 * ties occur (plain ranks of tied values pile up at the low end).
 */
export function tieBrokenRanks(items: { rank: number; ties: number }[], seed: number): number[] {
  const r = rng(seed);
  return items.map((x) => x.rank + Math.floor(r() * (x.ties + 1)));
}

/**
 * Chi-square test that `ranks` (each in 0..k) are uniform: the k + 1 possible ranks are cut into `nbins` bins of
 * (nearly) equal size, bin = floor(rank * nbins / (k + 1)); bin sizes enter the expected counts exactly.
 */
export function rankUniformity(ranks: number[], k: number, nbins = 10): RankUniformity {
  const bins = new Array<number>(nbins).fill(0), size = new Array<number>(nbins).fill(0);
  for (let rk = 0; rk <= k; rk++) size[Math.floor((rk * nbins) / (k + 1))]++;
  for (const rk of ranks) bins[Math.floor((rk * nbins) / (k + 1))]++;
  const n = ranks.length;
  const expected = size.map((s) => (n * s) / (k + 1));
  const chi2 = bins.reduce((s, o, i) => s + (o - expected[i]) ** 2 / expected[i], 0);
  const df = nbins - 1;
  return { n, k, bins, expected, chi2, df, p: chiSquareSf(chi2, df), meanRankOverK: n ? ranks.reduce((s, x) => s + x, 0) / n / k : NaN };
}

// ---------------------------------------------------------------------------------------------
// Profile measures without lineage IDs.

export interface ProfileRow { step: number; lineage: string; cells: number; photo: number; grow: number; decomp: number; resp: number; role: string; mu: number; sigma: number }
export interface ProfileResult {
  /** As before: bins first occupied after 1e5 by a lineage holding >= 1% (kept for continuity). */
  novelty: number;
  /** New bins whose summed share over all lineages in the bin stays >= 1% across consecutive deep censuses spanning >= 1e5. */
  persistentNoveltyV2: number;
  /** Mean over censuses after horizon / 2 of clusters whose summed share is >= 5%, zero-flux rows excluded; null when there are none. */
  roleClustersV2: number | null;
  /** As before, for the specialisation-pair condition: roles with summed share >= 5%, mean over censuses after horizon / 2. */
  rolesPresent: number | null;
  /** Mean over censuses of the share of living cells in rows with photo = grow = decomp = 0. */
  zeroFluxShare: number;
}

/** Profile quantisation of role clusters: profiles are rounded to 1/QUANT, distances are compared in those units. */
const QUANT = 50;
/** Single-linkage cut: L1 distance 0.2 = CLUSTER_LINK / QUANT. */
const CLUSTER_LINK = 10;
const NOVEL_AFTER = 100_000;
const PERSIST_SPAN = 100_000;

/**
 * Phenotype-bin novelty (plain and persistent) and role clusters from the rows of profiles.tsv, grouped by
 * ascending step (one block per deep census; streamed, only the current census is held).
 * Bin = floor(mu / 8) : floor(sigma / 4) : role; the share of a bin is the summed cells of all rows in it over the census total.
 */
export async function profileMeasuresV2(rows: AsyncIterable<ProfileRow>, horizon: number): Promise<ProfileResult> {
  const lineageFirst = new Map<string, number>(); // bin -> first step a single lineage held >= 1% in it (v1)
  const binFirst = new Map<string, number>(); // bin -> first step its summed share reached >= 1%
  const streak = new Map<string, number>(); // bin -> first step of its current run of censuses at >= 1%
  const persistent = new Set<string>();
  const clusters: number[] = [], rolesPresent: number[] = [], zero: number[] = [];
  let lastStep: number | null = null;
  let at: ProfileRow[] = [];
  const binOf = (x: ProfileRow) => `${Math.floor(x.mu / 8)}:${Math.floor(x.sigma / 4)}:${x.role}`;
  const flush = (step: number) => {
    const total = at.reduce((s, x) => s + x.cells, 0) || 1;
    const share = new Map<string, number>();
    for (const x of at) {
      const bin = binOf(x);
      share.set(bin, (share.get(bin) ?? 0) + x.cells);
      if (x.cells / total >= 0.01 && !lineageFirst.has(bin)) lineageFirst.set(bin, step);
    }
    const held = new Set<string>();
    for (const [bin, cells] of share) {
      if (cells / total < 0.01) continue;
      held.add(bin);
      if (!binFirst.has(bin)) binFirst.set(bin, step);
      if (!streak.has(bin)) streak.set(bin, step);
      if (step - streak.get(bin)! >= PERSIST_SPAN) persistent.add(bin);
    }
    for (const bin of [...streak.keys()]) if (!held.has(bin)) streak.delete(bin);
    zero.push(at.filter((x) => x.photo === 0 && x.grow === 0 && x.decomp === 0).reduce((s, x) => s + x.cells, 0) / total);
    if (step > horizon / 2) {
      const roleShare = new Map<string, number>();
      for (const x of at) roleShare.set(x.role, (roleShare.get(x.role) ?? 0) + x.cells / total);
      rolesPresent.push([...roleShare.values()].filter((v) => v >= 0.05).length);
      // Aggregate living rows with some flux by their rounded profile, then single-link the distinct profiles.
      const points = new Map<string, { q: number[]; cells: number }>();
      for (const x of at) {
        if (x.photo + x.grow + x.decomp === 0) continue;
        const f = [x.photo, x.grow, x.decomp, x.resp], sum = f.reduce((s, v) => s + v, 0) || 1;
        const q = f.map((v) => Math.round((v / sum) * QUANT));
        const key = q.join(",");
        const p = points.get(key);
        if (p) p.cells += x.cells;
        else points.set(key, { q, cells: x.cells });
      }
      const pts = [...points.values()];
      const parent = pts.map((_, i) => i);
      const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
      for (let i = 0; i < pts.length; i++)
        for (let j = i + 1; j < pts.length; j++) {
          let d = 0;
          for (let t = 0; t < 4; t++) d += Math.abs(pts[i].q[t] - pts[j].q[t]);
          if (d < CLUSTER_LINK) parent[find(i)] = find(j);
        }
      const sum = new Map<number, number>();
      pts.forEach((p, i) => sum.set(find(i), (sum.get(find(i)) ?? 0) + p.cells));
      clusters.push([...sum.values()].filter((c) => c / total >= 0.05).length);
    }
    at = [];
  };
  for await (const r of rows) {
    if (lastStep !== null && r.step !== lastStep) flush(lastStep);
    lastStep = r.step;
    at.push(r);
  }
  if (lastStep !== null) flush(lastStep);
  const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
  return {
    novelty: [...lineageFirst].filter(([, s]) => s > NOVEL_AFTER).length,
    persistentNoveltyV2: [...binFirst].filter(([bin, s]) => s > NOVEL_AFTER && persistent.has(bin)).length,
    roleClustersV2: avg(clusters),
    rolesPresent: avg(rolesPresent),
    zeroFluxShare: avg(zero) ?? 0,
  };
}
