// RMF lattice reference: the May-Leonard model of Reichenbach, Mobilia and Frey on a periodic square lattice, as plan 6
// (docs/3d-cyclic-rps-plan-2026-10-23.md) and rule draft 2.1 to 2.4 and 2.9 (runs/rps/rule-draft.md, to be experiments/3d-rps/RULES.md)
// state it. This is the only quantitative comparison with the literature (Q1) and the source of the live canvas on the companion page.
//
// PURE: no imports, no DOM, no Deno or Node API, no clock (callers pass one), no enums, namespaces or parameter properties, so a
// type-stripped copy of this file runs unchanged in a browser (plan 6, M5a). Everything is integer-driven and deterministic: the same
// seed gives the same trajectory on every host. Floating point enters only in IEEE basic operations (+ - * / and floor), which every
// engine rounds identically; there is no logarithm and no Math.random.
//
// MODEL (plan 6). N = L^2 sites, four neighbours, periodic. A site is empty (0) or holds species 1..K; species s kills species
// (s mod K) + 1 (K = 3: 1 kills 2, 2 kills 3, 3 kills 1). sigma = mu = 1; the exchange rate is epsilon = M N / 2, so the reported
// mobility is M = 2 epsilon / N (the module also reports epsilon, N, epsilon / N and 2 epsilon / N, because the literature's meaning of
// "mobility" is not pinned down). One REACTION STEP: pick a site a and one of its four neighbours b uniformly, draw u uniform in
// [0, mu + sigma); u < mu: reproduction (b <- a when a is occupied and b empty), otherwise selection (b <- empty when both are
// occupied and a kills b). An attempt that does nothing still counts. One GENERATION = N reaction steps. Before every reaction step
// E exchanges happen, each picking a site and a neighbour uniformly and swapping their contents (a swap with an empty site is a hop);
// E is geometric, P(E = e) = q^e (1 - q) with q = epsilon / (mu + sigma + epsilon), drawn by repeated integer Bernoulli trials against
// the 32-bit threshold floor(q 2^32). Random start: every site independently empty or species 1..K, probability 1 / (K + 1) each
// (1/4 each at K = 3). A run stops when at most one species is left (ABSORBED) or after N generations (N^2 reaction steps).
//
// READINGS THE PLAN DID NOT SETTLE (each is pinned by a test, so changing one is a visible event):
//   * PRNG. xoshiro128** (Blackman and Vigna), seeded by four draws of splitmix32 from the run's seed. "splitmix32" has no single
//     canonical definition; this file uses the 32-bit finalizer with increment 0x9e3779b9 and multipliers 0x21f0aaad, 0x735a2d97
//     (shifts 16, 15, 15), the one in the review's scratch rmf.c. An all-zero xoshiro state (probability 2^-128) is replaced by s0 = 1.
//   * DRAW ORDER per reaction step: the exchange trials first (one draw per trial, until the first failure), then, per exchange, one
//     draw for the site and one for the direction, then for the reaction one draw for the site, one for the direction and one for u.
//     Direction is `draw >>> 30` (0 = +x, 1 = -x, 2 = +y, 3 = -y; site i = y L + x). Site is floor(draw N / 2^32), exact in doubles.
//     u is its OWN draw, compared with floor(mu / (mu + sigma) 2^32) = 2^31; the review's scratch C reused the direction draw for u,
//     which is not what the plan says and gives different trajectories (same statistics). All six draws are taken even when the
//     reaction does nothing, so the stream does not depend on the state.
//   * START. Species of a site: floor(draw (K + 1) / 2^32), N draws in site order before the dynamics (at K = 3 that is `draw >>> 30`).
//   * EVENTS. An event is a reaction step or an exchange; the Bernoulli trials that decide E are not events. Plan 6's cost figures
//     (1.55 x 10^11 for the main grid) count events this way: reaction steps times (1 + epsilon / 2).
//   * ABSORPTION TIME. absorbedAtStep is the number of reaction steps completed when the second-to-last species died (0 if the start
//     already had at most one species). The histogram bin of a step s >= 1 is floor((10 s - 1) / N^2): bin b holds absorptions in
//     (b N / 10, (b + 1) N / 10] generations (B.4's "tenths of N").
//
// The registered grid (rule draft 2.2, 2.7) and the seed rule (Appendix A) are constants below, so the readout and the sweep share them.

// ---------------------------------------------------------------------------------------------------------------------
// Constants, grid and seeds
// ---------------------------------------------------------------------------------------------------------------------

export const MU = 1;
export const SIGMA = 1;
const TWO32 = 4294967296;

/** Appendix A's size index `iL` runs over these; the main grid (2.2) uses the first four, the contingency (2.7) the last. */
export const LATTICE_SIZES: readonly number[] = [20, 30, 40, 60, 100];
export const MAIN_SIZES: readonly number[] = [20, 30, 40, 60];
/** Rule draft 2.2: the 11 values of M. Appendix A's `iM` indexes this list (also for the contingency's six values). */
export const M_GRID: readonly number[] = [1e-5, 3e-5, 1e-4, 2e-4, 3e-4, 4e-4, 5e-4, 6e-4, 8e-4, 1e-3, 2e-3];
export const MAIN_R = 600;
/** Rule draft 2.7: L = 100, R = 300, M in {2e-4, 3e-4, 4e-4, 5e-4, 6e-4, 8e-4}. */
export const CONTINGENCY_L = 100;
export const CONTINGENCY_R = 300;
export const CONTINGENCY_IM: readonly number[] = [3, 4, 5, 6, 7, 8];
/** Appendix A: realization seeds of the registered sweep, `r` below 1000. */
export const SEED_BLOCK = 2_000_000;
export const ABSORB_BINS = 10;

function integerIn(name: string, v: number, lo: number, hi: number): void {
  if (!Number.isInteger(v) || v < lo || v > hi) throw new RangeError(`${name} must be an integer in [${lo}, ${hi}], got ${v}`);
}

/** Appendix A: 2,000,000 + 100,000 iL + 1,000 iM + r, with iL the index in (20, 30, 40, 60, 100), iM the index in M_GRID, r < 1000. */
export function realizationSeed(iL: number, iM: number, r: number): number {
  integerIn("iL", iL, 0, LATTICE_SIZES.length - 1);
  integerIn("iM", iM, 0, M_GRID.length - 1);
  integerIn("r", r, 0, 999);
  return SEED_BLOCK + 100_000 * iL + 1_000 * iM + r;
}

// ---------------------------------------------------------------------------------------------------------------------
// Derived constants
// ---------------------------------------------------------------------------------------------------------------------

export interface LatticeConstants {
  L: number;
  K: number;
  N: number;
  M: number;
  /** Exchange rate, M N / 2. */
  epsilon: number;
  epsOverN: number;
  twoEpsOverN: number;
  /** q = epsilon / (mu + sigma + epsilon). */
  q: number;
  /** floor(q 2^32), capped at 2^32 - 1: an exchange trial succeeds iff its draw is below this. */
  exchangeThreshold: number;
  /** The exact success probability of a trial, exchangeThreshold / 2^32 (what the sampler really draws from). */
  pExchange: number;
  /** floor(mu / (mu + sigma) 2^32): u below this is a reproduction attempt. */
  reproduceThreshold: number;
}

export function latticeConstants(L: number, M: number, K = 3): LatticeConstants {
  integerIn("L", L, 3, 1024);
  integerIn("K", K, 3, 64);
  if (!(M >= 0) || !Number.isFinite(M)) throw new RangeError(`M must be a finite number >= 0, got ${M}`);
  const N = L * L;
  const epsilon = (M * N) / 2;
  const q = epsilon / (MU + SIGMA + epsilon);
  const exchangeThreshold = Math.min(TWO32 - 1, Math.floor(q * TWO32));
  return {
    L,
    K,
    N,
    M,
    epsilon,
    epsOverN: epsilon / N,
    twoEpsOverN: (2 * epsilon) / N,
    q,
    exchangeThreshold,
    pExchange: exchangeThreshold / TWO32,
    reproduceThreshold: Math.floor((MU / (MU + SIGMA)) * TWO32),
  };
}

/** Upper bound on the events of a cell, R N^2 (1 + epsilon / 2): what plan 6 sums (absorbed runs stop early). */
export function estimatedEvents(L: number, M: number, R: number): number {
  const N = L * L;
  return R * N * N * (1 + (M * N) / 4);
}

// ---------------------------------------------------------------------------------------------------------------------
// PRNG: xoshiro128** seeded through splitmix32
// ---------------------------------------------------------------------------------------------------------------------

/** Four splitmix32 outputs (unsigned) for a seed. */
export function splitmix32Expand(seed: number): [number, number, number, number] {
  let a = seed | 0;
  const out: number[] = [];
  for (let i = 0; i < 4; i++) {
    a = (a + 0x9e3779b9) | 0;
    let z = a;
    z = Math.imul(z ^ (z >>> 16), 0x21f0aaad);
    z = Math.imul(z ^ (z >>> 15), 0x735a2d97);
    out.push((z ^ (z >>> 15)) >>> 0);
  }
  return [out[0], out[1], out[2], out[3]];
}

/**
 * One xoshiro128** draw (unsigned 32 bits) on any object holding s0..s3: the reference form. `runSteps` expands the same six lines
 * by hand in its loop (a closure over local state halves the speed); the tests compare the two draw for draw.
 */
export function nextU32(s: { s0: number; s1: number; s2: number; s3: number }): number {
  const m = Math.imul(s.s1, 5);
  const r = Math.imul((m << 7) | (m >>> 25), 9) >>> 0;
  const t = s.s1 << 9;
  s.s2 ^= s.s0;
  s.s3 ^= s.s1;
  s.s1 ^= s.s2;
  s.s0 ^= s.s3;
  s.s2 ^= t;
  s.s3 = (s.s3 << 11) | (s.s3 >>> 21);
  return r;
}

// ---------------------------------------------------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------------------------------------------------

export interface LatticeState {
  readonly L: number;
  readonly K: number;
  readonly N: number;
  /** Site contents: 0 empty, 1..K species. Row-major, i = y L + x. */
  readonly grid: Uint8Array;
  /** counts[0] = empty sites, counts[s] = sites of species s; always sums to N. */
  readonly counts: Int32Array;
  /** 4 N neighbour indices: [4 i + d], d = 0 +x, 1 -x, 2 +y, 3 -y (periodic). Shared between states of one L; read only. */
  readonly nbr: Int32Array;
  /** prey[s] = (s mod K) + 1, the species s kills; prey[0] = 0. */
  readonly prey: Uint8Array;
  constants: LatticeConstants;
  s0: number;
  s1: number;
  s2: number;
  s3: number;
  /** Reaction steps done, and exchanges done. */
  steps: number;
  exchanges: number;
  /** Species with at least one site. */
  alive: number;
  /** alive <= 1. The run is over: runSteps does nothing more. */
  absorbed: boolean;
  /** Reaction steps completed when absorption happened (0 at the start), or -1 while not absorbed. */
  absorbedAtStep: number;
  /** When not null, exchangeHistogram[min(e, length - 1)] counts the reaction steps that were preceded by e exchanges. */
  exchangeHistogram: Uint32Array | null;
}

export interface LatticeOptions {
  L: number;
  M: number;
  seed: number;
  /** Cycle length, 3 in v1. */
  K?: number;
  /** A starting grid (length N, values 0..K) in place of the random start; the seed still seeds the stream. */
  initial?: Uint8Array | null;
  /** Number of bins of the exchange-count histogram (the last bin is "this many or more"); 0 = off. */
  exchangeHistogramBins?: number;
}

const topologyCache = new Map<number, Int32Array>();

/** The 4 N neighbour table of an L x L torus, memoized per L. */
export function neighbourTable(L: number): Int32Array {
  let t = topologyCache.get(L);
  if (t === undefined) {
    t = new Int32Array(4 * L * L);
    for (let y = 0; y < L; y++) {
      for (let x = 0; x < L; x++) {
        const i = y * L + x;
        t[4 * i] = y * L + ((x + 1) % L);
        t[4 * i + 1] = y * L + ((x + L - 1) % L);
        t[4 * i + 2] = ((y + 1) % L) * L + x;
        t[4 * i + 3] = ((y + L - 1) % L) * L + x;
      }
    }
    topologyCache.set(L, t);
  }
  return t;
}

/** The species `s` kills. */
export function preyOf(s: number, K: number): number {
  return s === 0 ? 0 : (s % K) + 1;
}

function recount(grid: Uint8Array, counts: Int32Array): number {
  counts.fill(0);
  for (let i = 0; i < grid.length; i++) counts[grid[i]]++;
  let alive = 0;
  for (let s = 1; s < counts.length; s++) if (counts[s] > 0) alive++;
  return alive;
}

export function createLattice(opt: LatticeOptions): LatticeState {
  const K = opt.K ?? 3;
  const constants = latticeConstants(opt.L, opt.M, K);
  const N = constants.N;
  integerIn("seed", opt.seed, 0, TWO32 - 1);
  const grid = new Uint8Array(N);
  const counts = new Int32Array(K + 1);
  const prey = new Uint8Array(K + 1);
  for (let s = 0; s <= K; s++) prey[s] = preyOf(s, K);
  const w = splitmix32Expand(opt.seed);
  const rng = { s0: w[0] | 0, s1: w[1] | 0, s2: w[2] | 0, s3: w[3] | 0 };
  if ((rng.s0 | rng.s1 | rng.s2 | rng.s3) === 0) rng.s0 = 1;
  if (opt.initial) {
    if (opt.initial.length !== N) throw new RangeError(`initial grid has ${opt.initial.length} sites, expected ${N}`);
    for (let i = 0; i < N; i++) {
      if (opt.initial[i] > K) throw new RangeError(`initial grid site ${i} holds ${opt.initial[i]}, above K = ${K}`);
      grid[i] = opt.initial[i];
    }
  } else {
    for (let i = 0; i < N; i++) grid[i] = Math.floor((nextU32(rng) * (K + 1)) / TWO32);
  }
  const alive = recount(grid, counts);
  const bins = opt.exchangeHistogramBins ?? 0;
  return {
    L: opt.L,
    K,
    N,
    grid,
    counts,
    nbr: neighbourTable(opt.L),
    prey,
    constants,
    s0: rng.s0,
    s1: rng.s1,
    s2: rng.s2,
    s3: rng.s3,
    steps: 0,
    exchanges: 0,
    alive,
    absorbed: alive <= 1,
    absorbedAtStep: alive <= 1 ? 0 : -1,
    exchangeHistogram: bins > 0 ? new Uint32Array(bins) : null,
  };
}

/** Change the mobility of a running lattice (the canvas slider): only the exchange threshold moves; grid and stream are untouched. */
export function setMobility(st: LatticeState, M: number): void {
  st.constants = latticeConstants(st.L, M, st.K);
}

/** Generations run so far (reaction steps / N). */
export function generationsRun(st: LatticeState): number {
  return st.steps / st.N;
}

/** Recount the species from the grid (the conservation check: equals st.counts). */
export function recountGrid(st: LatticeState): Int32Array {
  const c = new Int32Array(st.K + 1);
  recount(st.grid, c);
  return c;
}

// ---------------------------------------------------------------------------------------------------------------------
// The dynamics
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Run up to `n` reaction steps (each with the exchanges drawn before it), stopping early at absorption. Returns the steps run. The
 * state is loaded into locals and stored back at the end, so a run in pieces (n = N / 4 per animation frame) is the same trajectory
 * as one run. Each `// draw` line pair is one xoshiro128** draw (see nextU32), result in `r`.
 */
export function runSteps(st: LatticeState, n: number): number {
  n = Math.floor(n);
  if (st.absorbed || !(n > 0)) return 0;
  const g = st.grid;
  const cnt = st.counts;
  const nbr = st.nbr;
  const prey = st.prey;
  const thr = st.constants.exchangeThreshold;
  const rep = st.constants.reproduceThreshold;
  const scale = st.N / TWO32;
  const hist = st.exchangeHistogram;
  const hlast = hist === null ? 0 : hist.length - 1;
  let s0 = st.s0;
  let s1 = st.s1;
  let s2 = st.s2;
  let s3 = st.s3;
  let alive = st.alive;
  let done = 0;
  let exch = 0;
  let m = 0;
  let t = 0;
  let r = 0;
  while (done < n && alive > 1) {
    done++;
    // E: Bernoulli trials until the first failure
    let e = 0;
    for (;;) {
      m = Math.imul(s1, 5); r = Math.imul((m << 7) | (m >>> 25), 9) >>> 0; t = s1 << 9; // draw
      s2 ^= s0; s3 ^= s1; s1 ^= s2; s0 ^= s3; s2 ^= t; s3 = (s3 << 11) | (s3 >>> 21);
      if (r >= thr) break;
      e++;
    }
    if (hist !== null) hist[e < hlast ? e : hlast]++;
    // E exchanges: a site, then a direction
    for (let j = 0; j < e; j++) {
      m = Math.imul(s1, 5); r = Math.imul((m << 7) | (m >>> 25), 9) >>> 0; t = s1 << 9; // draw
      s2 ^= s0; s3 ^= s1; s1 ^= s2; s0 ^= s3; s2 ^= t; s3 = (s3 << 11) | (s3 >>> 21);
      const xa = (r * scale) | 0;
      m = Math.imul(s1, 5); r = Math.imul((m << 7) | (m >>> 25), 9) >>> 0; t = s1 << 9; // draw
      s2 ^= s0; s3 ^= s1; s1 ^= s2; s0 ^= s3; s2 ^= t; s3 = (s3 << 11) | (s3 >>> 21);
      const xb = nbr[(xa << 2) | (r >>> 30)];
      const x = g[xa];
      g[xa] = g[xb];
      g[xb] = x;
    }
    exch += e;
    // the reaction step: site a, direction, u
    m = Math.imul(s1, 5); r = Math.imul((m << 7) | (m >>> 25), 9) >>> 0; t = s1 << 9; // draw
    s2 ^= s0; s3 ^= s1; s1 ^= s2; s0 ^= s3; s2 ^= t; s3 = (s3 << 11) | (s3 >>> 21);
    const a = (r * scale) | 0;
    m = Math.imul(s1, 5); r = Math.imul((m << 7) | (m >>> 25), 9) >>> 0; t = s1 << 9; // draw
    s2 ^= s0; s3 ^= s1; s1 ^= s2; s0 ^= s3; s2 ^= t; s3 = (s3 << 11) | (s3 >>> 21);
    const b = nbr[(a << 2) | (r >>> 30)];
    m = Math.imul(s1, 5); r = Math.imul((m << 7) | (m >>> 25), 9) >>> 0; t = s1 << 9; // draw
    s2 ^= s0; s3 ^= s1; s1 ^= s2; s0 ^= s3; s2 ^= t; s3 = (s3 << 11) | (s3 >>> 21);
    const ga = g[a];
    if (ga !== 0) {
      if (r < rep) {
        if (g[b] === 0) {
          g[b] = ga;
          cnt[0]--;
          cnt[ga]++;
        }
      } else {
        const gb = g[b];
        if (gb === prey[ga]) {
          g[b] = 0;
          cnt[0]++;
          if (--cnt[gb] === 0) alive--;
        }
      }
    }
  }
  st.s0 = s0;
  st.s1 = s1;
  st.s2 = s2;
  st.s3 = s3;
  st.alive = alive;
  st.exchanges += exch;
  st.steps += done;
  if (alive <= 1) {
    st.absorbed = true;
    st.absorbedAtStep = st.steps;
  }
  return done;
}

// ---------------------------------------------------------------------------------------------------------------------
// Hashes (determinism pins; the browser copy's first frame is compared with gridHash)
// ---------------------------------------------------------------------------------------------------------------------

function hex8(x: number): string {
  return (x >>> 0).toString(16).padStart(8, "0");
}

/** 64-bit non-cryptographic hash (two 32-bit lanes) of a byte array, 16 hex digits. */
export function hashBytes(bytes: Uint8Array): string {
  let h1 = 0x811c9dc5 | 0;
  let h2 = 0x9747b28c | 0;
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    h1 = Math.imul(h1 ^ b, 0x01000193);
    h2 = Math.imul(h2 ^ b, 0x85ebca6b);
    h2 ^= h2 >>> 15;
  }
  return hex8(h1) + hex8(h2);
}

/** Hash of the site contents alone: the "frame" a canvas draws. */
export function gridHash(st: LatticeState): string {
  return hashBytes(st.grid);
}

/** Hash of everything that decides the future: sites, stream state and the two counters. */
export function stateHash(st: LatticeState): string {
  const bytes = new Uint8Array(st.N + 32);
  bytes.set(st.grid);
  const dv = new DataView(bytes.buffer);
  dv.setUint32(st.N, st.s0 >>> 0, true);
  dv.setUint32(st.N + 4, st.s1 >>> 0, true);
  dv.setUint32(st.N + 8, st.s2 >>> 0, true);
  dv.setUint32(st.N + 12, st.s3 >>> 0, true);
  dv.setUint32(st.N + 16, st.steps % TWO32, true);
  dv.setUint32(st.N + 20, Math.floor(st.steps / TWO32), true);
  dv.setUint32(st.N + 24, st.exchanges % TWO32, true);
  dv.setUint32(st.N + 28, Math.floor(st.exchanges / TWO32), true);
  return hashBytes(bytes);
}

// ---------------------------------------------------------------------------------------------------------------------
// Statistics: the add-one estimate (rule draft 2.2)
// ---------------------------------------------------------------------------------------------------------------------

/** p' = (k + 1) / (R + 2). */
export function addOneP(k: number, R: number): number {
  integerIn("R", R, 1, Number.MAX_SAFE_INTEGER);
  integerIn("k", k, 0, R);
  return (k + 1) / (R + 2);
}

/** SE = sqrt(p' (1 - p') / (R + 2)): never 0, also for k = 0 and k = R. */
export function addOneSE(k: number, R: number): number {
  const p = addOneP(k, R);
  return Math.sqrt((p * (1 - p)) / (R + 2));
}

// ---------------------------------------------------------------------------------------------------------------------
// One realization, a chunk of realizations, a cell (the sweep's units; rule draft Appendix B.4 is the cell record)
// ---------------------------------------------------------------------------------------------------------------------

export interface Realization {
  /** The run's constants: epsilon, N, epsilon / N and 2 epsilon / N are reported for every run (plan 6). */
  constants: LatticeConstants;
  absorbed: boolean;
  /** Reaction steps completed at absorption, or -1. */
  absorbedAtStep: number;
  steps: number;
  exchanges: number;
  /** Final species counts (index 0 = empty). */
  counts: number[];
}

/** Run one realization from a random start to absorption or to t = `generations` (default N) generations. */
export function runRealization(L: number, M: number, seed: number, K = 3, generations?: number): Realization {
  const st = createLattice({ L, M, seed, K });
  runSteps(st, (generations ?? st.N) * st.N);
  return {
    constants: st.constants,
    absorbed: st.absorbed,
    absorbedAtStep: st.absorbedAtStep,
    steps: st.steps,
    exchanges: st.exchanges,
    counts: Array.from(st.counts),
  };
}

/** Histogram bin (0..9) of an absorption at reaction step `step` of an N-site run: bin b = (b N / 10, (b + 1) N / 10] generations. */
export function absorptionBin(step: number, N: number): number {
  return step <= 0 ? 0 : Math.min(ABSORB_BINS - 1, Math.floor((10 * step - 1) / (N * N)));
}

/** A cell is (L, M) with its R realizations. `seedBase` null = Appendix A's rule; a number = seed base + r (rehearsals only). */
export interface CellJob {
  L: number;
  M: number;
  K: number;
  iL: number;
  iM: number;
  seedBase: number | null;
}

export interface ChunkJob extends CellJob {
  /** Realizations rStart .. rEnd - 1 of the cell. */
  rStart: number;
  rEnd: number;
}

export interface ChunkResult extends ChunkJob {
  /** Realizations with at most one species at absorption or at t = N. */
  k: number;
  absorbedBy: number[];
  reactionSteps: number;
  exchanges: number;
  /** Compute time of this chunk by the caller's clock. */
  seconds: number;
}

export function seedOfRealization(job: CellJob, r: number): number {
  return job.seedBase === null ? realizationSeed(job.iL, job.iM, r) : job.seedBase + r;
}

/** Run realizations rStart .. rEnd - 1 of a cell. `clock` returns milliseconds (performance.now); without one `seconds` is 0. */
export function runChunk(job: ChunkJob, clock: () => number = () => 0): ChunkResult {
  integerIn("rStart", job.rStart, 0, 999);
  integerIn("rEnd", job.rEnd, job.rStart, 1000);
  const N = job.L * job.L;
  const t0 = clock();
  let k = 0;
  let reactionSteps = 0;
  let exchanges = 0;
  const absorbedBy: number[] = new Array(ABSORB_BINS).fill(0);
  for (let r = job.rStart; r < job.rEnd; r++) {
    const res = runRealization(job.L, job.M, seedOfRealization(job, r), job.K);
    if (res.absorbed) {
      k++;
      absorbedBy[absorptionBin(res.absorbedAtStep, N)]++;
    }
    reactionSteps += res.steps;
    exchanges += res.exchanges;
  }
  return { ...job, k, absorbedBy, reactionSteps, exchanges, seconds: (clock() - t0) / 1000 };
}

/** Rule draft B.4, extended: one JSON per (L, iM). */
export interface CellRecord {
  format: "rmf-cell/1";
  L: number;
  iL: number;
  M: number;
  iM: number;
  K: number;
  N: number;
  epsilon: number;
  epsOverN: number;
  twoEpsOverN: number;
  q: number;
  exchangeThreshold: number;
  R: number;
  /** Realizations with at most one species left at absorption or at t = N generations. */
  k: number;
  pExt: number;
  /** The add-one estimate (k + 1) / (R + 2) and its standard error, the error the rules use. */
  pAddOne: number;
  se: number;
  absorbedBy: number[];
  /** First and last realization seed. */
  seeds: [number, number];
  seedRule: string;
  reactionSteps: number;
  exchanges: number;
  /** reactionSteps + exchanges. */
  events: number;
  /** Summed compute time of the chunks (core-seconds, not wall time). */
  seconds: number;
  stepsPerSecond: number | null;
  eventsPerSecond: number | null;
  chunks: number;
}

/** Merge chunk results that together cover realizations 0 .. R - 1 of one cell, in any order. */
export function finalizeCell(parts: ChunkResult[]): CellRecord {
  if (parts.length === 0) throw new Error("finalizeCell: no chunks");
  const sorted = [...parts].sort((a, b) => a.rStart - b.rStart);
  const head = sorted[0];
  let next = 0;
  let k = 0;
  let reactionSteps = 0;
  let exchanges = 0;
  let seconds = 0;
  const absorbedBy: number[] = new Array(ABSORB_BINS).fill(0);
  for (const p of sorted) {
    if (p.L !== head.L || p.M !== head.M || p.K !== head.K || p.iL !== head.iL || p.iM !== head.iM || p.seedBase !== head.seedBase) {
      throw new Error("finalizeCell: chunks of different cells");
    }
    if (p.rStart !== next) throw new Error(`finalizeCell: chunks do not tile the cell (expected r ${next}, got ${p.rStart})`);
    next = p.rEnd;
    k += p.k;
    reactionSteps += p.reactionSteps;
    exchanges += p.exchanges;
    seconds += p.seconds;
    for (let b = 0; b < ABSORB_BINS; b++) absorbedBy[b] += p.absorbedBy[b];
  }
  const R = next;
  if (R === 0) throw new Error("finalizeCell: empty cell");
  const c = latticeConstants(head.L, head.M, head.K);
  const events = reactionSteps + exchanges;
  return {
    format: "rmf-cell/1",
    L: head.L,
    iL: head.iL,
    M: head.M,
    iM: head.iM,
    K: head.K,
    N: c.N,
    epsilon: c.epsilon,
    epsOverN: c.epsOverN,
    twoEpsOverN: c.twoEpsOverN,
    q: c.q,
    exchangeThreshold: c.exchangeThreshold,
    R,
    k,
    pExt: k / R,
    pAddOne: addOneP(k, R),
    se: addOneSE(k, R),
    absorbedBy,
    seeds: [seedOfRealization(head, 0), seedOfRealization(head, R - 1)],
    seedRule: head.seedBase === null ? "2000000 + 100000 iL + 1000 iM + r" : `${head.seedBase} + r (rehearsal)`,
    reactionSteps,
    exchanges,
    events,
    seconds,
    stepsPerSecond: seconds > 0 ? reactionSteps / seconds : null,
    eventsPerSecond: seconds > 0 ? events / seconds : null,
    chunks: sorted.length,
  };
}

/** A whole cell in this process: realizations 0 .. R - 1 as one chunk. */
export function runCell(job: CellJob & { R: number }, clock: () => number = () => 0): CellRecord {
  return finalizeCell([runChunk({ L: job.L, M: job.M, K: job.K, iL: job.iL, iM: job.iM, seedBase: job.seedBase, rStart: 0, rEnd: job.R }, clock)]);
}
