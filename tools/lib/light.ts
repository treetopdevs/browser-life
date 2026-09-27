// Pure light-schedule helpers for tools/anticip.ts and its tests. Mirrors
// RefSim.light(0, 0, step) (packages/sim-ref/src/step.ts) exactly, for this
// tool's own branch-boundary bookkeeping only -- never fed back into the
// simulator, so duplicating the formula here cannot cause a CPU/GPU rules
// divergence. Handles only "uniform" light mode at (0, 0), the only mode
// tools/anticip.ts's BASE_OVERRIDE ever uses.
import { clampi, divu, lightModeId, mulu, type WorldConfig } from "@bl/schema";

export type LightCfg = Pick<WorldConfig, "lightBase" | "lightAmp" | "lightMode" | "seasonPeriod" | "seasonAmp">;

export function lightAt(cfg: LightCfg, step: number): number {
  let L = cfg.lightBase;
  if (lightModeId(cfg.lightMode) === 0) L += cfg.lightAmp;
  if (cfg.seasonPeriod > 0) {
    const ph = divu(mulu(step % cfg.seasonPeriod, 512), cfg.seasonPeriod);
    const tri = Math.abs(ph - 256);
    L += (cfg.seasonAmp * tri) >> 8;
  }
  return clampi(L, 0, 255);
}

/** Mean of `lightAt` over the half-open step range `[fromStep, fromStep + steps)` --
 * descriptive only, for reporting a branch's realized light mean and any
 * mismatch a period switch produces against the branch it is compared to. */
export function realizedLightMean(cfg: LightCfg, fromStep: number, steps: number): number {
  if (steps <= 0) return 0;
  let sum = 0;
  for (let i = 0; i < steps; i++) sum += lightAt(cfg, fromStep + i);
  return sum / steps;
}
