// The arms of the jar levers screen (jar-levers.ts, step A3 of docs/3d-expansion-plan-2026-11-15.md), as plain data so the
// screen and the /slab/ page's jar settings (apps/lab/src/slab/settings.ts) build the same worlds. Each arm is the jar light
// screen's baseline (slab-spots at 64^3, nutrient 24, mu 50, sigma 8, lightK 4096) plus config keys and founding options.
import { presetById, presetConfig, type InitParams, type WorldConfig } from "@bl/schema";

export const JAR_BASE = { W: 64, H: 64, D: 64, nutrient: 24, mu: 50, sigma: 8, lightK: 4096 } as const;

export const JAR_ARMS: Readonly<Record<string, { cfg: Partial<WorldConfig>; init: Partial<InitParams> }>> = {
  base: { cfg: {}, init: {} },
  surface: { cfg: {}, init: { surface: 8 } },
  sink: { cfg: { sinkShift: 6 }, init: {} },
  floor: { cfg: { sinkShift: 6, floorDecay: 1024 }, init: {} },
  upwell: { cfg: { upwellPeriod: 500, upwellShift: 2 }, init: {} },
  all: { cfg: { sinkShift: 6, floorDecay: 1024, upwellPeriod: 500, upwellShift: 2 }, init: { surface: 8 } },
  rps: { cfg: { rpsTypes: 3, rpsRate: 64, rpsMin: 16, rpsKill: "vacancy", rpsMutate: 32768 }, init: { rpsCycle: 3 } },
};

export function jarArmConfig(arm: string, seed: number, size: readonly [number, number, number] = [JAR_BASE.W, JAR_BASE.H, JAR_BASE.D]): WorldConfig {
  const a = JAR_ARMS[arm];
  if (!a) throw new Error(`unknown jar arm ${arm}`);
  return presetConfig(presetById("slab-spots")!, seed, { tileW: size[0], tileH: size[1], tileD: size[2], defaultMu: JAR_BASE.mu, defaultSigma: JAR_BASE.sigma, lightK: JAR_BASE.lightK, ...a.cfg });
}

export function jarArmInit(arm: string): InitParams {
  const a = JAR_ARMS[arm];
  if (!a) throw new Error(`unknown jar arm ${arm}`);
  return { ...presetById("slab-spots")!.init, nutrient: JAR_BASE.nutrient, ...a.init };
}
