// Null-model factory for tools/nullcal.ts (docs/plan.md "Gate calibration").
//
// Each generator here builds one run's in-memory content (a manifest object,
// series records, lineage rows) for a process that is bounded / non-open-ended
// by construction, in exactly the shape tools/analyze.ts's `Run` type expects
// -- so the real, unmodified analysis path (ActivityTracker,
// growthVsSaturation, scheduledTrend, evaluateEndpoint, evaluateHeldOut) runs
// against synthetic data, not a reimplementation of it.
//
// Determinism: every generator is a pure function of `(id: Identity, spec:
// RunSpec)`; every random draw comes from `Rng`, seeded via tools/lib/idhash.ts's
// `streamRng` -- never a bare loop index and never `Math.random`. Fairness (a
// cross-cutting requirement checked by experiments/test/nullgen.test.ts): for
// the four exchangeable nulls (longPeriodLoop, neutralDrift, saturatingProcess,
// randomWalkNoise), a condition selects only which `rngFor(id, ...)` draws
// that condition lands on -- never a different formula, range or branch in the
// generator code. `boundedTreatmentVsFlat` and `plantedSignal` are
// deliberately NOT fair (see their own doc) -- they branch on whether
// `id.condition === "treatment"`.
import { METRICS_VERSION, SCHEMA_VERSION, type WorldConfig } from "@bl/schema";
import { ROLES, type Role } from "@bl/metrics";
import { specConfig, type RunSpec } from "@bl/runner";
import { streamRng } from "./idhash.ts";

/** Registered preset every nullcal ensemble uses (HELD_OUT_PRESET_CONTROLS-declared). */
export const NULLCAL_PRESET = "gradient-m3";

/**
 * `["treatment", ...HELD_OUT_PRESET_CONTROLS["gradient-m3"]]` -- covers every
 * PRIMARY_ENDPOINTS comparison (treatment/neutral/no-mutation/replenished)
 * *and* every held-out declared control, in one ensemble, with one preset.
 */
export const NULLCAL_CONDITIONS = [
  "treatment",
  "neutral",
  "no-mutation",
  "uniform-light",
  "replenished",
  "no-signal-motility",
] as const;
export type NullcalCondition = (typeof NULLCAL_CONDITIONS)[number];

export function makeSpec(experiment: string, condition: string, seed: number, steps: number, censusEvery: number, deepEvery: number): RunSpec {
  // No `overrides`, no `metapopulation`, no `activityThreshold` -- all
  // conditions in one nullcal ensemble share the same spec fields
  // analyzeEnsemble's "shared" check compares.
  return { experiment, presetId: NULLCAL_PRESET, condition, seed, steps, censusEvery, deepEvery, checkpointEvery: 0 };
}

/** A trial's full identity: which sweep, which null generator, which window, which independent replicate, which condition, and which seed within that condition. Every PRNG stream this module draws is a pure function of one `(Identity, metric)` pair (tools/lib/idhash.ts). */
export interface Identity {
  masterSeed: number;
  nullId: string;
  windowSteps: number;
  replicateIndex: number;
  condition: string;
  seedIndex: number;
}

/** Deterministic PRNG for one `(Identity, metric)` stream: same inputs always yield the same sequence. No `Math.random` anywhere in this module. */
export class Rng {
  private readonly next: () => number;
  constructor(id: Identity, metric: string) {
    this.next = streamRng(id, metric);
  }
  /** Uniform in [0, 1). */
  u(): number {
    return this.next();
  }
  /** Standard normal via Box-Muller, consuming two draws. */
  normal(): number {
    const u1 = Math.max(this.u(), 1e-12), u2 = this.u();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }
  /** Poisson(lambda) via Knuth's algorithm (fine for the small lambdas used here). */
  poisson(lambda: number): number {
    if (lambda <= 0) return 0;
    const L = Math.exp(-lambda);
    let k = 0, p = 1;
    do {
      k++;
      p *= this.u();
    } while (p > L);
    return k - 1;
  }
}

function rngFor(id: Identity, metric: string): Rng {
  return new Rng(id, metric);
}

const clip = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);

/**
 * Boundary-reflected random walk over `n` consecutive census indices --
 * `x_{t+1} = x_t + sigma*normal()`, reflected at `floor`/`ceil` (same rule as
 * `randomWalkNoise`'s own lineage-introduction intensity walk below). `x0`
 * must already be inside `(floor, ceil)`, not at either boundary -- starting
 * exactly at a boundary gives a biased (non-zero-mean) first displacement
 * purely from the reflection, not the "serially correlated but no true drift"
 * property this helper gives `scheduledTrend`-consumed observables.
 */
function reflectedWalk(n: number, x0: number, sigma: number, floor: number, ceil: number, rng: Rng): number[] {
  let x = x0;
  const out: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    x = x + sigma * rng.normal();
    if (x < floor) x = floor + (floor - x);
    if (x > ceil) x = ceil - (x - ceil);
    x = clip(x, floor, ceil);
    out[i] = x;
  }
  return out;
}

/**
 * One series record. Required fields on every record, in the exact
 * units/ranges each field's real producer uses (docs/plan.md's plan.md §3.3):
 * bioticRecycling in [0,1]; temporalMI/patternEntropy are bits over a
 * 16-symbol alphabet, so in [0, log2(16)] = [0,4], not [0,1];
 * morphology.compartmentalised is a non-negative INTEGER count of
 * individuals, never exceeding that census's `individuals`; rolesPresent is a
 * subset of the fixed 4-element ROLES vocabulary.
 */
export interface NullSeriesRecord {
  step: number;
  individuals: number;
  lineages: number;
  lineageShannon: number;
  bioticRecycling: number;
  pools: { A: number; B: number; C: number; P: number; E: number; S: number };
  temporalMI?: number;
  patternEntropy: number;
  rolesPresent?: string[];
  lineageCompression?: number;
  morphology?: { differentiation: number; compartmentalised: number };
}

export interface LineageRow {
  step: number;
  key: string;
  cells: number;
}

export interface NullBundle {
  series: NullSeriesRecord[];
  lineages: LineageRow[];
  /** Free-form, generator-specific parameters actually drawn, folded into the manifest's `nullcal.generatorParams` for provenance. */
  generatorParams: Record<string, unknown>;
}

export interface NullManifest {
  spec: RunSpec;
  cfg: WorldConfig; // specConfig(spec) -- real
  ruleVersion: number;
  schemaVersion: number;
  metricsVersion: number;
  startStep: 0;
  /** nullcal's own bookkeeping; never read by analyzeEnsemble. */
  nullcal: { nullId: string; windowSteps: number; replicateIndex: number; generatorParams: Record<string, unknown> };
  summary: {
    steps: number;
    conservationOk: true;
    extinct: false;
    finalHash: string;
    wallSeconds: number;
    stepsPerSecond: number;
    mutations: number;
    fissions: number;
    fusions: number;
    buddings: number;
    maxGeneration: number;
    finalIndividuals: number;
    finalLineages: number;
  };
}

/** Builds a real manifest (real `cfg = specConfig(spec)`, real version numbers) for one synthetic bundle. */
export function buildManifest(spec: RunSpec, nullId: string, windowSteps: number, replicateIndex: number, generatorParams: Record<string, unknown>): NullManifest {
  const cfg = specConfig(spec);
  return {
    spec,
    cfg,
    ruleVersion: cfg.ruleVersion,
    schemaVersion: SCHEMA_VERSION,
    metricsVersion: METRICS_VERSION,
    startStep: 0,
    nullcal: { nullId, windowSteps, replicateIndex, generatorParams },
    summary: {
      steps: spec.steps,
      conservationOk: true,
      extinct: false,
      finalHash: "nullcal-synthetic",
      wallSeconds: 1,
      stepsPerSecond: spec.steps,
      mutations: 0,
      fissions: 0,
      fusions: 0,
      buddings: 0,
      maxGeneration: 0,
      finalIndividuals: 0,
      finalLineages: 0,
    },
  };
}

/** Census step numbers for `spec`: `nCensus = ceil(steps/censusEvery)` entries. */
function censusStepList(steps: number, censusEvery: number): number[] {
  const n = Math.ceil(steps / censusEvery);
  return Array.from({ length: n }, (_, i) => Math.min((i + 1) * censusEvery, steps));
}

/** Per-census scalar formulas a generator supplies; `buildSeries` turns them into well-typed, range-clipped records. */
interface ScalarShape {
  individuals: (i: number, step: number) => number;
  lineages: (i: number, step: number) => number;
  lineageShannon: (i: number, step: number) => number;
  bioticRecycling: (i: number, step: number) => number;
  temporalMI: (i: number, step: number) => number;
  patternEntropy: (i: number, step: number) => number;
  lineageCompression: (i: number, step: number) => number;
  differentiation: (i: number, step: number) => number;
  /** Fraction (0..1) of that census's `individuals` that are compartmentalised -- rounded to an integer count, never exceeding `individuals`. */
  compartmentalisedFrac: (i: number, step: number) => number;
  /** Synthetic per-role share (0..1 each); a role is "present" iff its share >= 0.05, mirroring roleSummary's own default minShare. */
  roleShares: (i: number, step: number) => Partial<Record<Role, number>>;
}

function buildSeries(steps: number, censusEvery: number, deepEvery: number, shape: ScalarShape): NullSeriesRecord[] {
  const stepsArr = censusStepList(steps, censusEvery);
  return stepsArr.map((step, i) => {
    const deep = i % deepEvery === 0;
    const individuals = Math.max(0, Math.round(shape.individuals(i, step)));
    const rec: NullSeriesRecord = {
      step,
      individuals,
      lineages: Math.max(0, Math.round(shape.lineages(i, step))),
      lineageShannon: Math.max(0, shape.lineageShannon(i, step)),
      bioticRecycling: clip(shape.bioticRecycling(i, step), 0, 1),
      pools: { A: 0, B: 0, C: 0, P: 0, E: 0, S: 0 }, // chart() reads pools.B+pools.P unconditionally -- always present, even zeroed
      patternEntropy: clip(shape.patternEntropy(i, step), 0, 4),
      temporalMI: clip(shape.temporalMI(i, step), 0, 4),
    };
    if (deep) {
      const shares = shape.roleShares(i, step);
      rec.rolesPresent = ROLES.filter((r) => (shares[r] ?? 0) >= 0.05);
      rec.lineageCompression = Math.max(0, shape.lineageCompression(i, step));
      const compartmentalised = Math.min(individuals, Math.max(0, Math.round(shape.compartmentalisedFrac(i, step) * individuals)));
      rec.morphology = { differentiation: clip(shape.differentiation(i, step), 0, 0.5), compartmentalised };
    }
    return rec;
  });
}

/** Lineage abundance table for a fixed alphabet whose per-label abundance never touches zero -- ActivityTracker deletes a label's `crossed` flag the census it's absent, so a disappear/reappear episode would let it cross a second time. */
function fixedAlphabetLineages(steps: number, censusEvery: number, K: number, prefix: string, abundanceAt: (k: number, step: number) => number): LineageRow[] {
  const rows: LineageRow[] = [];
  for (const step of censusStepList(steps, censusEvery)) {
    for (let k = 0; k < K; k++) {
      const cells = Math.max(1, Math.round(abundanceAt(k, step)));
      rows.push({ step, key: `${prefix}${k}`, cells });
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// (a) longPeriodLoop -- finite genotype alphabet, slow periodic abundance.
// ---------------------------------------------------------------------------
/**
 * A fixed alphabet of K lineage keys (no lineage ever introduced outside the
 * initial set) whose abundances follow a slow sinusoid with period T >> the
 * window's step count, so within one window the curve looks like a slow
 * ramp/decline rather than a full cycle -- "long period >> window" false
 * openness. Every scalar field is also a slow sinusoid with small additive
 * noise. K/base/amp/phase are matched in scale to docs/plan.md's own M3 "Gate
 * results" (~24 clusters), not an arbitrary toy size.
 */
export function longPeriodLoop(id: Identity, spec: RunSpec): NullBundle {
  const rng = rngFor(id, "longPeriodLoop");
  const K = 18 + Math.floor(rngFor(id, "K").u() * 13); // ~[18, 30], centered near the M3 report's ~24 clusters
  const T = spec.steps * (8 + rngFor(id, "T").u() * 12); // period 8-20x the window: "≫ window"
  // One Rng per per-lineage array, advanced across the K draws -- calling
  // rngFor(id, "base") inside the callback would re-construct the same stream
  // and re-read its first draw every iteration, giving every lineage an
  // identical base/amp/phase instead of K distinct ones.
  const baseRng = rngFor(id, "base");
  const bases = Array.from({ length: K }, () => 6 + baseRng.u() * 20);
  const ampRng = rngFor(id, "amp");
  const amps = Array.from({ length: K }, () => 2 + ampRng.u() * 5);
  const phaseRng = rngFor(id, "phase");
  const phases = Array.from({ length: K }, () => phaseRng.u() * 2 * Math.PI);
  const noiseScale = 0.3;

  const lineages = fixedAlphabetLineages(spec.steps, spec.censusEvery, K, "loop-", (k, step) => {
    const v = bases[k] + amps[k] * Math.sin((2 * Math.PI * step) / T + phases[k]);
    return Math.max(1, v + rng.normal() * noiseScale);
  });

  const scalarPhase = rngFor(id, "scalarPhase").u() * 2 * Math.PI;
  const series = buildSeries(spec.steps, spec.censusEvery, spec.deepEvery, {
    individuals: (_, step) => 40 + 10 * Math.sin((2 * Math.PI * step) / T + scalarPhase) + rng.normal() * 2,
    lineages: () => K,
    lineageShannon: (_, step) => 2 + 0.4 * Math.sin((2 * Math.PI * step) / T + scalarPhase) + rng.normal() * 0.1,
    bioticRecycling: (_, step) => 0.5 + 0.15 * Math.sin((2 * Math.PI * step) / T + scalarPhase) + rng.normal() * noiseScale * 0.1,
    temporalMI: (_, step) => 1.5 + 0.6 * Math.sin((2 * Math.PI * step) / T + scalarPhase) + rng.normal() * noiseScale,
    patternEntropy: (_, step) => 2.2 + 0.5 * Math.sin((2 * Math.PI * step) / T + scalarPhase) + rng.normal() * noiseScale,
    lineageCompression: (_, step) => 0.6 + 0.15 * Math.sin((2 * Math.PI * step) / T + scalarPhase) + rng.normal() * noiseScale * 0.1,
    differentiation: (_, step) => 0.15 + 0.08 * Math.sin((2 * Math.PI * step) / T + scalarPhase) + rng.normal() * noiseScale * 0.02,
    compartmentalisedFrac: (_, step) => clip(0.2 + 0.1 * Math.sin((2 * Math.PI * step) / T + scalarPhase), 0, 1),
    roleShares: (_, step) => {
      const s = 0.5 + 0.3 * Math.sin((2 * Math.PI * step) / T + scalarPhase);
      return { phototroph: clip(s, 0, 1), chemotroph: clip(1 - s, 0, 1), decomposer: 0.1, mixed: 0.05 };
    },
  });
  return { series, lineages, generatorParams: { K, T } };
}

// ---------------------------------------------------------------------------
// (b) neutralDrift -- Moran-model genetic drift, no selection.
// ---------------------------------------------------------------------------
/**
 * A fixed population of N cells across L0 initial lineage labels; at every
 * census, a fixed number of birth-death events pick a parent proportional to
 * current abundance and a victim uniformly, copying the parent's label with
 * NO mutation and NO fitness difference -- every condition is generated by
 * literally the same neutral process (only the PRNG stream differs by
 * condition+replicate+seed, never any parameter), so the true answer for
 * every treatment-vs-control comparison is "no difference" by construction.
 * The non-Moran scalars are an Ornstein-Uhlenbeck process initialized AT its
 * own stationary distribution, so there is no transient trend to contaminate
 * the "stationary, no drift" claim.
 */
export function neutralDrift(id: Identity, spec: RunSpec): NullBundle {
  const rng = rngFor(id, "neutralDrift");
  const N = 200;
  const L0 = 16 + Math.floor(rngFor(id, "L0").u() * 9); // ~[16, 24]
  const eventsPerCensus = 30;
  let labels = Array.from({ length: N }, (_, i) => i % L0);
  const nCensus = censusStepList(spec.steps, spec.censusEvery).length;
  const perCensusLabels: number[][] = [];
  for (let c = 0; c < nCensus; c++) {
    for (let e = 0; e < eventsPerCensus; e++) {
      const parent = labels[Math.floor(rng.u() * N)];
      const victim = Math.floor(rng.u() * N);
      labels[victim] = parent;
    }
    perCensusLabels.push(labels.slice());
  }

  const lineages: LineageRow[] = [];
  const stepsArr = censusStepList(spec.steps, spec.censusEvery);
  stepsArr.forEach((step, i) => {
    const counts = new Map<number, number>();
    for (const l of perCensusLabels[i]) counts.set(l, (counts.get(l) ?? 0) + 1);
    for (const [label, cells] of counts) lineages.push({ step, key: `drift-${label}`, cells });
  });

  // OU process: x_{t+1} = x_t + kappa*(mu - x_t) + sigma*normal(); x_0 drawn
  // from N(mu, sigma^2/(2*kappa - kappa^2)), the process's own stationary law.
  function ouSeries(mu: number, kappa: number, sigma: number, ouRng: Rng): number[] {
    const varStat = (sigma * sigma) / (2 * kappa - kappa * kappa);
    let x = mu + Math.sqrt(Math.max(varStat, 0)) * ouRng.normal();
    return stepsArr.map(() => {
      x = x + kappa * (mu - x) + sigma * ouRng.normal();
      return x;
    });
  }
  const bioticOU = ouSeries(0.5, 0.1, 0.03, rngFor(id, "bioticOU"));
  const miOU = ouSeries(1.5, 0.1, 0.1, rngFor(id, "miOU"));
  const peOU = ouSeries(2.2, 0.1, 0.1, rngFor(id, "peOU"));
  const compOU = ouSeries(0.6, 0.1, 0.03, rngFor(id, "compOU"));
  const diffOU = ouSeries(0.15, 0.1, 0.015, rngFor(id, "diffOU"));
  const fracOU = ouSeries(0.2, 0.1, 0.03, rngFor(id, "fracOU"));
  const roleOU = ouSeries(0.5, 0.1, 0.05, rngFor(id, "roleOU"));

  const shannonAt = (i: number) => {
    const counts = new Map<number, number>();
    for (const l of perCensusLabels[i]) counts.set(l, (counts.get(l) ?? 0) + 1);
    let h = 0;
    for (const c of counts.values()) {
      const p = c / N;
      h -= p * Math.log2(p);
    }
    return h;
  };
  const distinctAt = (i: number) => new Set(perCensusLabels[i]).size;

  const series = buildSeries(spec.steps, spec.censusEvery, spec.deepEvery, {
    individuals: () => N / 4, // a fixed "on-tile" scale, no trend
    lineages: (i) => distinctAt(i),
    lineageShannon: (i) => shannonAt(i),
    bioticRecycling: (i) => clip(bioticOU[i], 0, 1),
    temporalMI: (i) => clip(miOU[i], 0, 4),
    patternEntropy: (i) => clip(peOU[i], 0, 4),
    lineageCompression: (i) => Math.max(0, compOU[i]),
    differentiation: (i) => clip(diffOU[i], 0, 0.5),
    compartmentalisedFrac: (i) => clip(fracOU[i], 0, 1),
    roleShares: (i) => ({ phototroph: clip(roleOU[i], 0, 1), chemotroph: clip(1 - roleOU[i], 0, 1), decomposer: 0.1, mixed: 0.05 }),
  });
  return { series, lineages, generatorParams: { N, L0, eventsPerCensus } };
}

// ---------------------------------------------------------------------------
// (c) saturatingProcess -- C(t) = C_inf(1 - e^(-t/tau)) with tau >> window.
// ---------------------------------------------------------------------------
/**
 * Every scalar series follows a saturating rise with time constant
 * tau = R_tau * steps, R_tau drawn from [3, 8] -- restricted to the actual
 * window, the curve is locally close to linear (the window only ever sees
 * the early, quasi-linear regime, never the knee), exactly the shape
 * `growthVsSaturation` is designed to distinguish. Lineage abundances for a
 * fixed alphabet (same "stays positive throughout" discipline as (a)) also
 * saturate toward a positive floor, never toward 0.
 */
export function saturatingProcess(id: Identity, spec: RunSpec): NullBundle {
  const rng = rngFor(id, "saturatingProcess");
  const K = 18 + Math.floor(rngFor(id, "K").u() * 13);
  const Rtau = 3 + rngFor(id, "Rtau").u() * 5; // [3, 8]
  const tau = Rtau * spec.steps;
  const sat = (cInf: number, step: number) => cInf * (1 - Math.exp(-step / tau));
  // Same one-Rng-per-array discipline as longPeriodLoop's bases/amps/phases above.
  const floorRng = rngFor(id, "floor");
  const floors = Array.from({ length: K }, () => 2 + floorRng.u() * 3);
  const ceilRng = rngFor(id, "ceil");
  const ceils = Array.from({ length: K }, (_, k) => floors[k] + 5 + ceilRng.u() * 15);

  const lineages = fixedAlphabetLineages(spec.steps, spec.censusEvery, K, "sat-", (k, step) => {
    const v = floors[k] + (ceils[k] - floors[k]) * (1 - Math.exp(-step / tau));
    return Math.max(1, v + rng.normal() * 0.3);
  });

  const series = buildSeries(spec.steps, spec.censusEvery, spec.deepEvery, {
    individuals: (_, step) => 20 + sat(40, step) + rng.normal() * 2,
    lineages: () => K,
    lineageShannon: (_, step) => 1 + sat(1.5, step) + rng.normal() * 0.1,
    bioticRecycling: (_, step) => 0.2 + sat(0.5, step) + rng.normal() * 0.03,
    temporalMI: (_, step) => 0.5 + sat(2, step) + rng.normal() * 0.15,
    patternEntropy: (_, step) => 1 + sat(2, step) + rng.normal() * 0.15,
    lineageCompression: (_, step) => 0.3 + sat(0.5, step) + rng.normal() * 0.03,
    differentiation: (_, step) => 0.05 + sat(0.2, step) + rng.normal() * 0.02,
    compartmentalisedFrac: (_, step) => clip(0.1 + sat(0.3, step), 0, 1),
    roleShares: (_, step) => {
      const s = clip(0.2 + sat(0.5, step), 0, 1);
      return { phototroph: s, chemotroph: clip(1 - s, 0, 1), decomposer: 0.1, mixed: 0.05 };
    },
  });
  return { series, lineages, generatorParams: { K, tau } };
}

// ---------------------------------------------------------------------------
// (d) randomWalkNoise -- mean-reverting crossing intensity (not a literal
// random walk on the cumulative count -- ActivityTracker's cumulativeNew is
// a monotone counter by construction and can never decrease).
// ---------------------------------------------------------------------------
/**
 * A per-census "new lineage introduction intensity" follows a boundary-
 * reflected random walk, initialized inside the bounds (a walk starting at
 * its floor would have a positive expected next displacement purely from the
 * reflection, a boundary artifact rather than the "no true drift" property
 * this generator exists to isolate). Each census's actual number of newly
 * introduced, distinct lineage labels is a Poisson draw with that census's
 * intensity as its mean (a doubly-stochastic / Cox counting process); once
 * introduced, a label persists at a roughly constant baseline abundance for
 * a fixed lifespan, then expires -- without a lifespan, every census's
 * Poisson-many new labels would accumulate forever, making the lineage table
 * grow quadratically with the window's census count at the registered
 * 1e6-step windows. A label's *crossing*, once ActivityTracker records it, is
 * unaffected by its later expiry (cumulativeNew never decrements).
 */
const RANDOM_WALK_LIFESPAN = 15;

export function randomWalkNoise(id: Identity, spec: RunSpec): NullBundle {
  const rng = rngFor(id, "randomWalkNoise");
  // floor/ceil/lifespan chosen to keep the expected number of CONCURRENTLY
  // active labels (~mean intensity x lifespan) comparable to (a)/(c)'s fixed
  // alphabet size K (~24), not larger.
  const floor = 0, ceil = 1.2, sigma = 0.3;
  let intensity = floor + rngFor(id, "x0").u() * (ceil - floor); // inside the bounds, not at a boundary
  const stepsArr = censusStepList(spec.steps, spec.censusEvery);
  const introducedPerCensus: number[] = [];
  for (let i = 0; i < stepsArr.length; i++) {
    intensity = intensity + sigma * rng.normal();
    if (intensity < floor) intensity = floor + (floor - intensity);
    if (intensity > ceil) intensity = ceil - (intensity - ceil);
    intensity = clip(intensity, floor, ceil);
    introducedPerCensus.push(rng.poisson(intensity));
  }

  // Turnover-aware diversity: `lineages`/`lineageShannon` reflect the
  // CURRENTLY active set at each census, not the cumulative count ever
  // introduced -- labels expire after RANDOM_WALK_LIFESPAN censuses. Both
  // arrays are built from the exact same per-census `cells` draws pushed into
  // `lineages` below, so this doesn't consume any extra `rng` draws or
  // diverge from what the lineage table itself records.
  const lineages: LineageRow[] = [];
  let nextLabel = 0;
  const activeBase = new Map<number, { base: number; expiresAt: number }>();
  const activeCountAt: number[] = [];
  const shannonAt: number[] = [];
  stepsArr.forEach((step, i) => {
    for (const [label, meta] of activeBase) if (meta.expiresAt <= i) activeBase.delete(label);
    for (let n = 0; n < introducedPerCensus[i]; n++) activeBase.set(nextLabel++, { base: 8 + rng.u() * 12, expiresAt: i + RANDOM_WALK_LIFESPAN });
    const cellsThisCensus: number[] = [];
    for (const [label, meta] of activeBase) {
      const cells = Math.max(1, Math.round(meta.base + rng.normal() * 1.5));
      lineages.push({ step, key: `walk-${label}`, cells });
      cellsThisCensus.push(cells);
    }
    activeCountAt.push(activeBase.size);
    const total = cellsThisCensus.reduce((a, b) => a + b, 0);
    let h = 0;
    for (const c of cellsThisCensus) {
      const p = c / total;
      if (p > 0) h -= p * Math.log2(p);
    }
    shannonAt.push(cellsThisCensus.length ? h : 0);
  });

  // Reflected-walk trajectories for every `scheduledTrend`-consumed
  // observable, indexed the same way `buildSeries` itself indexes `i` -- so a
  // deep-only observable (differentiation/compartmentalised/lineageCompression/
  // role share) simply reads a subsampled point of the SAME underlying walk,
  // preserving the serial correlation across deep censuses too.
  const n = stepsArr.length;
  const temporalMIWalk = reflectedWalk(n, 1.5, 0.25, 0.3, 3.7, rngFor(id, "temporalMIWalk"));
  const patternEntropyWalk = reflectedWalk(n, 2.0, 0.25, 0.3, 3.7, rngFor(id, "patternEntropyWalk"));
  const lineageCompressionWalk = reflectedWalk(n, 0.55, 0.05, 0.15, 1.0, rngFor(id, "lineageCompressionWalk"));
  const differentiationWalk = reflectedWalk(n, 0.15, 0.02, 0.02, 0.48, rngFor(id, "differentiationWalk"));
  const compartmentalisedFracWalk = reflectedWalk(n, 0.2, 0.03, 0.02, 0.98, rngFor(id, "compartmentalisedFracWalk"));
  const roleWalk = reflectedWalk(n, 0.4, 0.05, 0.05, 0.95, rngFor(id, "roleWalk"));

  const series = buildSeries(spec.steps, spec.censusEvery, spec.deepEvery, {
    individuals: () => 35 + rng.normal() * 3,
    lineages: (i) => Math.max(0, activeCountAt[i]),
    lineageShannon: (i) => shannonAt[i],
    bioticRecycling: () => clip(0.4 + rng.normal() * 0.05, 0, 1),
    temporalMI: (i) => temporalMIWalk[i],
    patternEntropy: (i) => patternEntropyWalk[i],
    lineageCompression: (i) => lineageCompressionWalk[i],
    differentiation: (i) => differentiationWalk[i],
    compartmentalisedFrac: (i) => compartmentalisedFracWalk[i],
    roleShares: (i) => {
      const s = roleWalk[i];
      return { phototroph: clip(s, 0, 1), chemotroph: clip(1 - s, 0, 1), decomposer: 0.1, mixed: 0.1 };
    },
  });
  return { series, lineages, generatorParams: { floor, ceil, sigma, lifespan: RANDOM_WALK_LIFESPAN } };
}

// ---------------------------------------------------------------------------
// (e) boundedTreatmentVsFlat -- a PARTIAL null, kept separate from (a)-(d).
// ---------------------------------------------------------------------------
/**
 * `treatment` follows (c)'s saturating rise; every control condition stays
 * flat (small stationary noise around a fixed level, no rise at all) -- the
 * OPPOSITE of (a)-(d)'s "all six conditions from the same distribution"
 * discipline, and deliberately so. This targets the specificity confound
 * (a)-(d) cannot: whether the endpoints distinguish a bounded-but-real
 * treatment/control difference from genuinely open-ended growth. A pass here
 * is NOT automatically a false positive (the difference is real by
 * construction) -- tools/nullcal.ts reports this scenario in its own
 * section, never folded into the four nulls' false-positive tallies.
 */
export function boundedTreatmentVsFlat(id: Identity, spec: RunSpec): NullBundle {
  const isTreatment = id.condition === "treatment";
  const rng = rngFor(id, "boundedTreatmentVsFlat");
  const K = 18 + Math.floor(rngFor(id, "K").u() * 13);
  const Rtau = 3 + rngFor(id, "Rtau").u() * 5;
  const tau = Rtau * spec.steps;
  const sat = (cInf: number, step: number) => (isTreatment ? cInf * (1 - Math.exp(-step / tau)) : 0);
  // Same one-Rng-per-array discipline as longPeriodLoop's bases/amps/phases above.
  const floorRng = rngFor(id, "floor");
  const floors = Array.from({ length: K }, () => 2 + floorRng.u() * 3);
  const ceilRng = rngFor(id, "ceil");
  const ceils = Array.from({ length: K }, (_, k) => floors[k] + (isTreatment ? 5 + ceilRng.u() * 15 : 0));

  const lineages = fixedAlphabetLineages(spec.steps, spec.censusEvery, K, "bt-", (k, step) => {
    const v = isTreatment ? floors[k] + (ceils[k] - floors[k]) * (1 - Math.exp(-step / tau)) : floors[k];
    return Math.max(1, v + rng.normal() * 0.3);
  });

  const series = buildSeries(spec.steps, spec.censusEvery, spec.deepEvery, {
    individuals: (_, step) => 20 + sat(40, step) + rng.normal() * 2,
    lineages: () => K,
    lineageShannon: (_, step) => 1 + sat(1.5, step) + rng.normal() * 0.1,
    bioticRecycling: (_, step) => 0.2 + sat(0.5, step) + rng.normal() * 0.03,
    temporalMI: (_, step) => 0.5 + sat(2, step) + rng.normal() * 0.15,
    patternEntropy: (_, step) => 1 + sat(2, step) + rng.normal() * 0.15,
    lineageCompression: (_, step) => 0.3 + sat(0.5, step) + rng.normal() * 0.03,
    differentiation: (_, step) => 0.05 + sat(0.2, step) + rng.normal() * 0.02,
    compartmentalisedFrac: (_, step) => clip(0.1 + sat(0.3, step), 0, 1),
    roleShares: (_, step) => {
      const s = clip(0.2 + sat(0.5, step), 0, 1);
      return { phototroph: s, chemotroph: clip(1 - s, 0, 1), decomposer: 0.1, mixed: 0.05 };
    },
  });
  return { series, lineages, generatorParams: { K, tau, isTreatment } };
}

// ---------------------------------------------------------------------------
// Test-only generators (experiments/test/nullgen.test.ts, tests/deno/nullcal.ts).
// ---------------------------------------------------------------------------
/**
 * Every scalar field pinned to a fixed constant, one fixed lineage alphabet
 * with perfectly constant abundance, identical across every condition and
 * seed -- a role set pinned to exactly one role, so the coexistence
 * endpoint's ">= 2 roles" precondition is never met by construction. Gives
 * 0/R for every endpoint and every held-out observable by construction: the
 * constant *value* varies by seed (via `id.seedIndex`) so this is checked at
 * several seeds, never a single lucky instance, but never varies *within*
 * one run.
 */
export function constantSanity(id: Identity, spec: RunSpec): NullBundle {
  const rng = rngFor(id, "constantSanity");
  const level = 10 + rng.u() * 5; // varies by identity (esp. seedIndex), not by census
  const K = 6;
  const lineages = fixedAlphabetLineages(spec.steps, spec.censusEvery, K, "const-", () => level);
  const series = buildSeries(spec.steps, spec.censusEvery, spec.deepEvery, {
    individuals: () => 30,
    lineages: () => K,
    lineageShannon: () => 1.5,
    bioticRecycling: () => 0.4,
    temporalMI: () => 1.0,
    patternEntropy: () => 1.5,
    lineageCompression: () => 0.5,
    differentiation: () => 0.1,
    compartmentalisedFrac: () => 0.1,
    roleShares: () => ({ phototroph: 1, chemotroph: 0, decomposer: 0, mixed: 0 }), // exactly one role present, always < minRoles=2
  });
  return { series, lineages, generatorParams: { level, K } };
}

/**
 * `treatment`'s lineage alphabet gains one brand-new, high-abundance lineage
 * every few censuses throughout the window (steady, non-saturating,
 * non-periodic new activity) while every control keeps a small, static
 * alphabet; `treatment`'s trend scalars climb steadily while every control's
 * stay flat. Effect sizes are non-overlapping across seeds by construction,
 * so `mannWhitney`'s exact p-value is provably far below alpha -- a
 * deterministic, not merely probable, positive control. Role count rises
 * 1 -> 4 across treatment's window, crossing the 5% `roleSummary` threshold
 * at three fixed fractions, while every control stays pinned at exactly one
 * role throughout, so `held-out-role-count` has a real, non-flat signal to
 * detect independently of the ">= 2 of 4" summary.
 */
export function plantedSignal(id: Identity, spec: RunSpec): NullBundle {
  const isTreatment = id.condition === "treatment";
  const rng = rngFor(id, "plantedSignal");
  const stepsArr = censusStepList(spec.steps, spec.censusEvery);
  const newEvery = Math.max(1, Math.floor(stepsArr.length / 20)); // ~20 new lineages spread across the window

  const lineages: LineageRow[] = [];
  const baseK = 6;
  for (const step of stepsArr) for (let k = 0; k < baseK; k++) lineages.push({ step, key: `plant-base-${k}`, cells: Math.max(1, 8 + rng.normal() * 0.5) });
  if (isTreatment) {
    stepsArr.forEach((step, i) => {
      const introduced = Math.floor(i / newEvery) + 1;
      for (let n = 0; n < introduced; n++) lineages.push({ step, key: `plant-new-${n}`, cells: Math.max(1, 40 + rng.normal() * 2) });
    });
  }

  // Separation: an offset so that with `id.seedIndex` fixed within a run
  // (constant across censuses, unique per seed) treatment's per-run value
  // always exceeds every control's, non-overlapping across the registered
  // seed range.
  const seedOffset = id.seedIndex;
  const series = buildSeries(spec.steps, spec.censusEvery, spec.deepEvery, {
    individuals: (_, step) => (isTreatment ? 30 + (step / spec.steps) * 40 : 30) + rng.normal() * 1,
    lineages: (i) => (isTreatment ? baseK + Math.floor(i / newEvery) + 1 : baseK),
    lineageShannon: () => 1.5,
    bioticRecycling: () => 0.4,
    temporalMI: (_, step) => (isTreatment ? 0.5 + (step / spec.steps) * 3 + seedOffset * 0.001 : 0.5) + rng.normal() * 0.02,
    patternEntropy: () => 1.5,
    lineageCompression: () => 0.5,
    differentiation: (_, step) => (isTreatment ? 0.05 + (step / spec.steps) * 0.3 + seedOffset * 0.0001 : 0.05) + rng.normal() * 0.002,
    compartmentalisedFrac: (_, step) => clip(isTreatment ? 0.05 + (step / spec.steps) * 0.6 : 0.05, 0, 1),
    roleShares: (_, step) => {
      const frac = step / spec.steps;
      if (!isTreatment) return { phototroph: 1, chemotroph: 0, decomposer: 0, mixed: 0 };
      const chemotroph = frac >= 0.25 ? 0.2 : 0;
      const decomposer = frac >= 0.5 ? 0.1 : 0;
      const mixed = frac >= 0.75 ? 0.1 : 0;
      return { phototroph: 1 - chemotroph - decomposer - mixed, chemotroph, decomposer, mixed };
    },
  });
  return { series, lineages, generatorParams: { isTreatment, newEvery } };
}

export const NULL_GENERATOR_IDS = ["longPeriodLoop", "neutralDrift", "saturatingProcess", "randomWalkNoise"] as const;
export type NullGeneratorId = (typeof NULL_GENERATOR_IDS)[number];

/** Dispatches one of the four required, exchangeable (condition-fair) generators by id. */
export function runNullGenerator(nullId: NullGeneratorId, id: Identity, spec: RunSpec): NullBundle {
  switch (nullId) {
    case "longPeriodLoop":
      return longPeriodLoop(id, spec);
    case "neutralDrift":
      return neutralDrift(id, spec);
    case "saturatingProcess":
      return saturatingProcess(id, spec);
    case "randomWalkNoise":
      return randomWalkNoise(id, spec);
  }
}
