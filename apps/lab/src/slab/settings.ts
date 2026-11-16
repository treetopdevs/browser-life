// The slab viewer's choices and the records behind them: pure tables, no GPU. Everything here is an exploration setting taken
// from a committed record (experiments/3d-rps/GATE0-EXPLORATION*.md, experiments/3d-slab/m4-results.tsv). Gate 0 ended
// GATE-0-STOP and the 3D ecology calibration found no qualifying setting, so nothing is a registered operating point.
import { presetById, presetConfig, type InitParams, type WorldConfig } from "@bl/schema";
import { jobConfig, killSettings, type Shape } from "../../../../experiments/3d-rps/gate0-spike/rungs.ts";

export const BURN_IN = 6000;
export const SPREAD = 8;
export const CYCLIC_SEEDS = [401, 402, 403] as const;
export const ECO_SEEDS = [101, 102, 103] as const;
export const CYCLIC_SIZES: readonly (readonly [number, number, number])[] = [[256, 256, 4], [128, 128, 4]];
export const ECO_SIZES: readonly (readonly [number, number, number])[] = [[256, 256, 8], [128, 128, 8]];

export type KillChoice = "vacancy" | "removal" | "none";
export interface KillOption { id: KillChoice; kill: "removal" | "vacancy"; rate: number; title: string; text: string }

export const KILL_OPTIONS: readonly KillOption[] = [
  { id: "vacancy", kill: "vacancy", rate: 64, title: "Vacancy kill, rate 64",
    text: "A cell next to a stronger type may be emptied. Why it is the default: in the recorded runs at 256 by 256 by 4, two of three seeds kept all three types for more than 200,000 steps." },
  { id: "removal", kill: "removal", rate: 64, title: "Removal kill, rate 64",
    text: "A stronger neighbour eats part of a cell's biomass instead. Recorded: all three seeds lost a type at 256 by 256 by 4, so expect one type to vanish; watching that happen is the point." },
  { id: "none", kill: "removal", rate: 0, title: "No kill, rate 0 (the control)",
    text: "Types only drift, with no one beating anyone. Recorded at 256 by 256 by 4: all three types persisted with turnover. It shows what the picture looks like when the cycle is switched off." },
];

export interface CyclicRecord { id: string; shape: string; kill: "removal" | "vacancy"; rate: number; spread: number; seed: number; klass: string }
/** Recorded jobs the page can start from. Test 11 checks each against the committed tables. */
export const CYCLIC_RECORDS: readonly CyclicRecord[] = [
  ...CYCLIC_SEEDS.flatMap((s, k) => [
    { id: `g2-confirm-V-sp8-r64-s${s}`, shape: "256x256x4", kill: "vacancy" as const, rate: 64, spread: 8, seed: s, klass: ["DC", "DC", "LOSS"][k] },
    { id: `g2-confirm-S0-sp8-r64-s${s}`, shape: "256x256x4", kill: "removal" as const, rate: 64, spread: 8, seed: s, klass: "LOSS" },
    { id: `g2-horizon-S0-sp8-r0-s${s}`, shape: "256x256x4", kill: "removal" as const, rate: 0, spread: 8, seed: s, klass: "CHURN" },
    { id: `g0-horizon-S0-sp8-r0-s${s}`, shape: "128x128x4", kill: "removal" as const, rate: 0, spread: 8, seed: s, klass: ["LOSS", "LOSS", "CHURN"][k] },
  ]),
];

export interface CyclicChoice { size: readonly [number, number, number]; kill: KillChoice; seed: number; burnIn: boolean }
export const DEFAULT_CYCLIC: CyclicChoice = { size: [256, 256, 4], kill: "vacancy", seed: 401, burnIn: true };

export const killOption = (id: KillChoice) => KILL_OPTIONS.find((k) => k.id === id)!;

/** The recorded job for a complete cyclic tuple, or null ("not recorded"). The recorded jobs all ran the 6,000-step burn-in. */
export function cyclicRecord(c: CyclicChoice): CyclicRecord | null {
  if (!c.burnIn) return null;
  const k = killOption(c.kill);
  const shape = c.size.join("x");
  return CYCLIC_RECORDS.find((r) => r.shape === shape && r.kill === k.kill && r.rate === k.rate && r.spread === SPREAD && r.seed === c.seed) ?? null;
}

/** The world config of a cyclic choice, exactly as the harness builds it (rung S0). */
export const cyclicConfig = (c: CyclicChoice): WorldConfig => jobConfig("S0", c.size as Shape, SPREAD, c.seed);
/** Settings for the spike's `applySettings`: the burn-in phase has the kill off, the run phase the chosen one. */
export function cyclicSettings(c: CyclicChoice, phase: "burn" | "run"): Record<string, unknown> {
  const k = killOption(c.kill);
  return killSettings(k.kill, phase === "burn" ? 0 : k.rate, "S0");
}

export interface EcoOption {
  id: string; mu: number; sigma: number; lightK: number; title: string; text: string;
  /** Nutrient per cell at the start, as an override of the slab-spots init (M4b's knob); absent keeps the preset's. */
  nutrient?: number;
}
export const ECO_OPTIONS: readonly EcoOption[] = [
  { id: "mu40-s20-k1024", mu: 40, sigma: 20, lightK: 1024, title: "Full carpet, floor still shaded (default)",
    text: "Recorded on seed 101 at 256 by 256 by 8: 4 % living at step 5,000, 54 % at 10,000 and 100 % from 15,000 to 50,000, with the floor getting 79 % of the surface light, so the layers differ. Many settings tie at a full carpet; this is the one the calibration's pick rule order reaches first." },
  { id: "mu30-s8-k256", mu: 30, sigma: 8, lightK: 256, title: "Half living (the nearest miss)",
    text: "Recorded on seeds 101, 102 and 103: 44 to 51 % living at the end of the run, the only half-living setting of the calibration. It did not go extinct on any of the three seeds." },
  { id: "mu60-s12-k256", mu: 60, sigma: 12, lightK: 256, title: "Nearly full, shaded floor",
    text: "Recorded on seed 101: about 97 % living, and the floor gets about 56 % of the surface light, the strongest shading of the picks." },
  { id: "mu20-s12-k1024", mu: 20, sigma: 12, lightK: 1024, title: "Sparse corner",
    text: "Recorded on seed 101: 0.1 % living at step 50,000, a few cells. Seed 102 of this setting goes extinct at step 9,000. Expect a nearly empty picture." },
];
/**
 * Canopy settings from the M4b calibration (experiments/3d-slab/m4b-results.tsv, nutrient per cell as the knob). The results
 * file holds per-run summaries, not states, so choosing one re-runs the setting from step 0; nothing here is a recorded state.
 */
export const CANOPY_OPTIONS: readonly EcoOption[] = [
  { id: "n12-mu50-s8-k64", nutrient: 12, mu: 50, sigma: 8, lightK: 64, title: "Canopy over a dark floor (re-run of an M4b calibration setting)",
    text: "Less nutrient at the start (12 a cell, against 32 in the settings above) and strong shading (light 64). In the M4b calibration on seeds 101, 102 and 103 at 256 by 256 by 8 it ended at 43 to 45 % living after 50,000 steps: the top three layers 86 to 99 % full, layer 3 57 to 70 %, layer 4 under 8 % and the bottom two empty, with the floor getting 43 to 46 % of the surface light. That is a canopy over a dark floor, which is why it suits the volume view. It is slow: 1 to 3 % living at step 5,000, and the canopy fills in over about 20,000 to 40,000 steps (seed 103 first). This page re-runs the setting from step 0." },
];
export interface EcoChoice { size: readonly [number, number, number]; option: string; seed: number }
export const DEFAULT_ECO: EcoChoice = { size: [256, 256, 8], option: "mu40-s20-k1024", seed: 101 };
export const ecoOption = (id: string) => ECO_OPTIONS.find((o) => o.id === id) ?? CANOPY_OPTIONS.find((o) => o.id === id)!;
/** True for an M4b canopy setting (re-run of a calibration setting, recorded as summaries only). */
export const isCanopy = (id: string) => CANOPY_OPTIONS.some((o) => o.id === id);
/**
 * The run id of a complete ecology tuple in its results file (m4-results.tsv, or m4b-results.tsv for a canopy setting), or
 * null when it is not a recorded run (other seed or size).
 */
export function ecoRecordId(c: EcoChoice): string | null {
  if (c.size.join("x") !== "256x256x8" || !(ECO_SEEDS as readonly number[]).includes(c.seed)) return null;
  return isCanopy(c.option) ? `treatment-${c.option}-seed${c.seed}` : `${c.option}-seed${c.seed}`;
}
/** The init of an ecology choice: slab-spots, with the setting's starting nutrient when it has one (as m4b-rule.ts expectedInit). */
export function ecoInit(c: EcoChoice): InitParams {
  const init = presetById("slab-spots")!.init;
  const o = ecoOption(c.option);
  return o.nutrient === undefined ? init : { ...init, nutrient: o.nutrient };
}
/** The world config of an ecology choice, as experiments/3d-slab/m4-calibrate.ts builds it plus the tile size. */
export function ecoConfig(c: EcoChoice): WorldConfig {
  const o = ecoOption(c.option);
  return presetConfig(presetById("slab-spots")!, c.seed, { tileW: c.size[0], tileH: c.size[1], tileD: c.size[2], defaultMu: o.mu, defaultSigma: o.sigma, lightK: o.lightK });
}

export type Pace = "slow" | "steady" | "fast" | "fastest";
export const PACES: readonly { id: Pace; steps: number; title: string; text: string }[] = [
  { id: "slow", steps: 5, title: "Slow, 5 steps per picture", text: "Every few steps are drawn; good for watching single fronts move." },
  { id: "steady", steps: 20, title: "Steady, 20 steps per picture", text: "The default: motion is easy to follow." },
  { id: "fast", steps: 100, title: "Fast, 100 steps per picture", text: "Fronts jump between pictures; use it to get somewhere sooner." },
  { id: "fastest", steps: 400, title: "Fastest, 400 steps per picture", text: "Nearly as quick as the machine goes; the picture is a sample of the run, not a film." },
];
