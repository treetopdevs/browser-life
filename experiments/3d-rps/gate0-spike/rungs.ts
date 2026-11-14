// The rungs of Gate 0 (rule draft 3.0, G0.1): the substrate constants of S0, S1 and S2, the job configs the spike runs, and the
// settings that live outside WorldConfig (the kill's form, rate and rpsMin, which the spike bakes into the shader text).
import type { WorldConfig } from "@bl/schema";
import type { Kill, SubstrateRung } from "../readout-jobs.ts";
import { slabCfg } from "./lib.ts";
import type { RpsMixParams } from "./world.ts";

export type Shape = readonly [number, number, number];
/** Plan 7.1 and rule draft 1.1 (D4): the shape of every Gate-0 job. */
export const SHAPE: Shape = [128, 128, 4];
/** The horizon rung of 3.0 (D4): G0.4 alone, after a HORIZON-only stop; a diagnostic, and never on S2 (its founding at this shape is over the matter bound). */
export const HORIZON_RUNG_SHAPE: Shape = [256, 256, 4];
export const K0 = 3;

export interface RungDef {
  /** Matter scale `s`. */
  scale: number;
  /** Founding nutrient and biomass (InitParams of the rps-mix founding). */
  nutrient: number;
  biomass: number;
  /** `rpsMin`: the least post-transport B at which a face neighbour counts as a predator. */
  rpsMin: number;
  /** WorldConfig keys the rung replaces. */
  overrides: Partial<WorldConfig>;
}

/**
 * G0.1: S0 is the substrate of plan 7.1; S1 is `s` 4 (nutrient 80, biomass 64, `kCatHalf` 512, `massUnit` 1,024, `thetaMass` 2,048,
 * `rpsMin` 16); S2 is `s` 8 (nutrient 160, biomass 128, `kCatHalf` 1,024, `massUnit` 2,048, `thetaMass` 2,048 (its cap), `rpsMin` 32).
 * Rung V has the substrate of the rung it runs on and changes only the kill.
 */
export const RUNGS: Record<SubstrateRung, RungDef> = {
  S0: { scale: 1, nutrient: 20, biomass: 16, rpsMin: 4, overrides: {} },
  S1: { scale: 4, nutrient: 80, biomass: 64, rpsMin: 16, overrides: { kCatHalf: 512, massUnit: 1024, thetaMass: 2048 } },
  S2: { scale: 8, nutrient: 160, biomass: 128, rpsMin: 32, overrides: { kCatHalf: 1024, massUnit: 2048, thetaMass: 2048 } },
};

/** Plan 7.1: `defaultMu` 50, `defaultSigma` 12, `lightK` 16384, uniform light 40 + 200 (the slab-spots preset's), `mutRate` 0, every other key default. */
export function jobConfig(rung: SubstrateRung, shape: Shape, spread: number, seed: number): WorldConfig {
  return slabCfg(shape[0], shape[1], shape[2], 50, 12, 16384, seed, { spread, mutRate: 0, ...RUNGS[rung].overrides });
}

/** The rps-mix founding of a rung (plan 4.4): K0 3, 75 % occupied, columns. */
export function mixParams(rung: SubstrateRung): RpsMixParams {
  const r = RUNGS[rung];
  return { K0, occupied: 75, nutrient: r.nutrient, biomass: r.biomass, columns: true };
}

/** The settings outside WorldConfig, in the names the Part B keys will have (`rpsKill` is the provisional name of the kill-form key). */
export function killSettings(kill: Kill, rate: number, rung: SubstrateRung): Record<string, unknown> {
  return { rpsKill: kill, rpsRate: rate, rpsMin: RUNGS[rung].rpsMin, rpsTypes: K0, rpsFlip: 0, rpsEdge: 0 };
}

/** The rate constants rule draft 3.1 sets to 0 in the meter's inert stripe world (with `dtQ` 0). */
export const METER_ZERO: Partial<WorldConfig> = {
  kPhoto: 0, kResp: 0, kDecomp: 0, kGrow: 0, kBuild: 0, kEmit: 0, kCost: 0, kMaint: 0, kPDecay: 0, kBDecay: 0, kELeak: 0, kSDecay: 0, kAbio: 0, dtQ: 0,
};

/** Rule draft 3.1: `T_meter` steps. */
export const METER_STEPS = 5000;

/** The meter world's config: the rung's, with every rate constant and `dtQ` at 0 and no mutation. */
export function meterConfig(rung: SubstrateRung, shape: Shape, spread: number, seed: number): WorldConfig {
  return slabCfg(shape[0], shape[1], shape[2], 50, 12, 16384, seed, { spread, mutRate: 0, ...RUNGS[rung].overrides, ...METER_ZERO });
}
