// I08 protocol: every number the moving-light assay depends on, frozen (docs/moving-light-2026-11-02/PLAN.md sections 4 and 6) before
// the first fresh-seed run. Dev (calibration) seeds may set the free parameters; fresh seeds never tune anything. Integers and
// strings only, so the protocol canonicalises and hashes (canonicalJSON refuses floats).
import { canonicalJSON, defaultConfig, sha256HexJS, type WorldConfig } from "@bl/schema";

export const SCHEDULE_IDS = ["fixed", "paused", "wandering", "reversed"] as const;
export type ScheduleId = (typeof SCHEDULE_IDS)[number];
export const STRATEGY_IDS = ["sense", "sense-nosig", "sense-nomot", "drift", "still"] as const;
export type StrategyId = (typeof STRATEGY_IDS)[number];
export const PLACEMENTS = ["grouped", "dispersed"] as const;
export type Placement = (typeof PLACEMENTS)[number];

export const PROTOCOL = {
  id: "movinglight-v1",
  question: "grouped vs dispersed inocula under a moving sun: does local signal interaction beat the matched independent response, mutation off",
  /** One tile, W x H (cells). */
  W: 24,
  H: 16,
  kernelRadius: 5,
  /** Sweep light: the sun's meridian stands at x = 0 at step 0 in every schedule. */
  light: { base: 20, amp: 220 },
  signalGain: 127,
  kSDecay: 13,
  defaultMu: 60,
  defaultSigma: 20,
  nutrient: 64,
  /** Bodies: n discs of radius `radius`, mean biomass per cell and energy per biomass of the founder rule. */
  n: 4,
  body: { radius: 2, biomass: 96, energyPerBiomass: 2 },
  /** Screening: a day of P steps gives a mean sun speed of about 1.5 x the blind drifter's 1/64 cell per step (W * 64 / P = 1.5). */
  fixed: { P: 1024 },
  /** Wandering and reversed: the sun is a triangle of amplitude A cells and period WP (east for WP/2, then west). */
  wander: { WP: 1024, A: 12 },
  /** Horizon T, warm-up T0 (unscored), census cadence c. For the wander schedules T = WP and the turn is WP/2. */
  T: 1024,
  T0: 128,
  census: 32,
  /** Inocula: grouped bodies form a compact 2 x 2 block 6 cells apart, dispersed bodies sit at the maximal spacing (12 x 8); both centred `offset` cells west of the t=0 meridian. */
  placement: { offset: 4, groupedSpacing: 6, groupedY: 8, dispersedY: [3, 11] as readonly number[] },
  /** Cohesion radius (cells) for the fraction-within-radius readout; a tracking-lag body must be this near the meridian cell to count as coincident. */
  cohesionRadius: 4,
  /** A lineage centroid that jumps more than this many cells in one census interval is a label hand-over (takeover), not motion: that pair-interval is excluded from coordination. */
  jumpMaxCells: 6,
  /** Fixed-point scales: positions are in 1/Q cell; ratios in parts per million. */
  Q: 256,
  PPM: 1_000_000,
  /** Cross-talk threshold: the foreign fraction of the signal mass a dispersed body's neighbourhood holds at the horizon, in ppm (calibration measures; it can only flag). */
  crossTalkMaxPpm: 250_000,
  /** Sensitivity bound: if the fixed-schedule capture floor delta_cap exceeds this, engine-seed noise swamps any effect the capture readout could show and the label is unsupported-measurement, not 'no benefit'. */
  maxFloorCapPpm: 500_000,
  /** Survival margin for criterion (v): grouped sense survival may be this many ppm below dispersed sense. */
  survivalMarginPpm: 100_000,
  /** Reduction ladder, applied before any fresh run and recorded in calibration.json. */
  ladder: ["smaller-grid", "shorter-horizon", "transfer-paused-and-reversed-only", "drop-still-and-nomot-from-transfer"] as readonly string[],
  /** Pre-stated screening rule constants. */
  rule: { blocks: 8, minPositive: 7, residualMin: 6, bootstrapDraws: 2000, bootstrapSeed: 8_700_777, bootstrapLevelPpm: 100_000 },
  /** Per schedule: floors delta_cap (capture contrasts, ppm) and delta_res (residual coordination, milli-Q^2), from the replicate-noise seeds only; filled in by --calibrate, then frozen. */
  delta: { fixed: { cap: 1429742, res: 45205021 }, paused: { cap: 398139, res: 41217415 }, wandering: { cap: 2592988, res: 59377658 }, reversed: { cap: 2222461, res: 178722175 } } as Record<string, { cap: number; res: number }>,
  seedRange: { first: 8_700_001, last: 8_700_999 },
  devSeeds: [8_700_001, 8_700_002, 8_700_003, 8_700_004] as readonly number[],
  noiseSeeds: [8_700_201, 8_700_202, 8_700_203, 8_700_204] as readonly number[],
  fixtureSeeds: [8_700_401, 8_700_402, 8_700_403, 8_700_404, 8_700_405, 8_700_406, 8_700_407, 8_700_408] as readonly number[],
  freshSeeds: [8_700_501, 8_700_502, 8_700_503, 8_700_504, 8_700_505, 8_700_506, 8_700_507, 8_700_508] as readonly number[],
  /** Schedules run on the fresh blocks (one joint confirmation) and the strategies per schedule. */
  schedules: ["fixed", "paused", "wandering", "reversed"] as readonly string[],
  strategies: ["sense", "sense-nosig", "sense-nomot", "drift", "still"] as readonly string[],
};

export type Protocol = typeof PROTOCOL;

/** The frozen world config of one block and schedule. Only existing keys; none enters defaultConfig(). */
export function worldConfig(seed: number, schedule: ScheduleId, p: Protocol = PROTOCOL): WorldConfig {
  const sun: Partial<WorldConfig> =
    schedule === "fixed" ? { dayPeriod: p.fixed.P } : schedule === "paused" ? { dayPeriod: 0 } : { dayPeriod: 0, wanderPeriod: p.wander.WP, wanderAmp: p.wander.A };
  return defaultConfig({
    tileW: p.W,
    tileH: p.H,
    kernelRadius: p.kernelRadius,
    seed,
    mutRate: 0,
    defaultMu: p.defaultMu,
    defaultSigma: p.defaultSigma,
    lightMode: "sweep",
    lightBase: p.light.base,
    lightAmp: p.light.amp,
    signalGain: p.signalGain,
    kSDecay: p.kSDecay,
    ...sun,
  });
}

export function protocolHash(registryDigest: string, p: Protocol = PROTOCOL): string {
  return sha256HexJS(new TextEncoder().encode(canonicalJSON({ protocol: p, registryDigest })));
}
