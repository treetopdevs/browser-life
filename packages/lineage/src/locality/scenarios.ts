// Three tiny deterministic CPU assays of environmental biomass response (I05). They are NOT independent capabilities:
// all three score terminal bound biomass B, which respiration (B -> C + E) and construction (B -> P) can lower even
// when useful, and founder geometry and short-horizon depletion couple them. Records keep B, P, E (and A, C) at the start
// and end. Parameters are frozen here after calibration on baselines and the generalist only (never on mutant outcomes).
import { CH, buildWorld, cellCount, decodeGenome, defaultConfig, type WorldConfig } from "@bl/schema";
import { RefSim } from "@bl/sim-ref";
import { genomeHash } from "./neighbourhood.ts";

export type Scenario = "light-growth" | "dark-persistence" | "dim-transfer";
export const SCENARIO_IDS: readonly Scenario[] = ["light-growth", "dark-persistence", "dim-transfer"];

export const ASSAY = {
  /** validateConfig needs dimensions divisible by eight, so 16x16 is the smallest sensible tile. */
  tile: 16,
  kernelRadius: 3,
  mutRate: 0,
  lightMode: "uniform",
  horizon: 200,
  seeds: [1, 2],
  founder: { x: 8, y: 8, radius: 6, biomass: 64, energy: 128 },
  scenarios: {
    "light-growth": { nutrient: 32, lightBase: 40, lightAmp: 160 },
    "dark-persistence": { nutrient: 32, lightBase: 0, lightAmp: 0 },
    "dim-transfer": { nutrient: 16, lightBase: 20, lightAmp: 60 },
  },
  /** Viability gate on an unmutated start, frozen from the generalist: net growth in the light and a clear light-over-dark margin. */
  gate: { lightGrowthFloor: 1000, lightOverDarkMargin: 250 },
  /** A genuine edit is "viable" when every response keeps at least this many permille of the initial biomass. */
  viableFloor: 500,
} as const;

export interface AssayRun {
  scenario: Scenario;
  seed: number;
  B0: number; B1: number; P0: number; P1: number; E0: number; E1: number; A1: number; C1: number;
  /** Mutation events seen (must be 0: mutRate is 0 so the assay measures the controller change alone). */
  events: number;
  /** Terminal bound biomass over initial, in permille. */
  permille: number;
}

export function assayConfig(scenario: Scenario, seed: number): WorldConfig {
  const s = ASSAY.scenarios[scenario];
  return defaultConfig({ seed, tileW: ASSAY.tile, tileH: ASSAY.tile, kernelRadius: ASSAY.kernelRadius, mutRate: ASSAY.mutRate, lightMode: ASSAY.lightMode, lightBase: s.lightBase, lightAmp: s.lightAmp });
}

const total = (cells: Uint32Array, ch: number, n: number): number => { let t = 0; for (let i = ch * n; i < (ch + 1) * n; i++) t += cells[i]; return t; };

/** One run. The input words are only read (the founder genome is decoded from a copy). */
export function runAssay(words: Uint32Array, scenario: Scenario, seed: number, horizon: number = ASSAY.horizon): AssayRun {
  const cfg = assayConfig(scenario, seed);
  const f = ASSAY.founder;
  const state = buildWorld(cfg, { nutrient: ASSAY.scenarios[scenario].nutrient, founders: [{ ...f, genome: decodeGenome(words.slice()) }] });
  const sim = new RefSim(state), n = cellCount(cfg);
  const c0 = state.cells;
  const B0 = total(c0, CH.B, n), P0 = total(c0, CH.P, n), E0 = total(c0, CH.E, n);
  const events = sim.run(horizon).length;
  const c1 = sim.state.cells;
  const B1 = total(c1, CH.B, n);
  return { scenario, seed, B0, B1, P0, P1: total(c1, CH.P, n), E0, E1: total(c1, CH.E, n), A1: total(c1, CH.A, n), C1: total(c1, CH.C, n), events, permille: Math.floor((1000 * B1) / B0) };
}

/** Memoised by genome hash: edits with the same words are assayed once. */
export class AssayCache {
  private m = new Map<string, AssayRun>();
  runs = 0;
  get(words: Uint32Array, scenario: Scenario, seed: number): AssayRun {
    const k = `${genomeHash(words)}|${scenario}|${seed}`;
    let r = this.m.get(k);
    if (!r) { r = runAssay(words, scenario, seed); this.runs++; this.m.set(k, r); }
    return r;
  }
}

/** Per-seed responses of a genome on one scenario. */
export const responses = (c: AssayCache, words: Uint32Array, scenario: Scenario, seeds: readonly number[] = ASSAY.seeds): number[] => seeds.map((s) => c.get(words, scenario, s).permille);
export const sum = (a: readonly number[]): number => a.reduce((x, y) => x + y, 0);

/**
 * Tolerance for "changed", in summed-over-seeds permille: the larger of 5% of the genome's own baseline sum and
 * 3 x (number of seeds) x the largest cross-seed spread of either the genome's baseline or the generalist's. Baselines only.
 */
export function tau(baseline: readonly number[], generalistBaseline: readonly number[]): number {
  const spread = (a: readonly number[]) => Math.max(...a) - Math.min(...a);
  return Math.max(Math.ceil((5 * sum(baseline)) / 100), 3 * ASSAY.seeds.length * Math.max(spread(baseline), spread(generalistBaseline)));
}
