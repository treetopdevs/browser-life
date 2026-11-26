// The one existing-ecology clip: a plain read of the CPU reference on a small `spots` world.
// Imports @bl/* (the CLI registers a resolver; vitest and vite alias it). Not part of the metrics barrel.
import { CH, PRESETS, initWorld, presetConfig, validateConfig, type WorldConfig } from "@bl/schema";
import { RefSim } from "@bl/sim-ref";
import type { Movie } from "./movie.ts";

/** Fixed protocol, recorded verbatim in the evidence. */
export const ECOLOGY = {
  preset: "spots",
  seed: 1,
  override: { tileW: 32, tileH: 32 },
  frames: 96,
  stride: 4,
  channel: "B",
  /**
   * Quantiser shift, fixed before any predictor ran by one rule: the smallest shift for which the initial frame's biomass
   * maximum (480 on this 32x32 world: six founders overlap and the field is dense) fits 0..15 without clipping, 480 >> 5 = 15.
   * Never tuned afterwards. The world is dense and nearly uniform, so the clip has low contrast; it is an illustration.
   */
  shift: 5,
  cap: 15,
} as const;

export function ecologyConfig(): WorldConfig {
  const preset = PRESETS.find((p) => p.id === ECOLOGY.preset);
  if (!preset) throw new Error("preset spots is missing");
  const cfg = presetConfig(preset, ECOLOGY.seed, { ...ECOLOGY.override });
  const errs = validateConfig(cfg);
  if (errs.length) throw new Error(`invalid ecology config: ${errs.join("; ")}`);
  return cfg;
}

export function ecologyInit() { return PRESETS.find((p) => p.id === ECOLOGY.preset)!.init; }

const quantise = (cells: Uint32Array, n: number): Uint8Array => {
  const f = new Uint8Array(n);
  for (let c = 0; c < n; c++) f[c] = Math.min(ECOLOGY.cap, cells[CH.B * n + c] >>> ECOLOGY.shift);
  return f;
};

/** Frames are copied into independent arrays; the sim is only read. */
export function ecologyClip(observe?: (sim: RefSim, k: number) => void): Movie {
  const cfg = ecologyConfig();
  const sim = new RefSim(initWorld(cfg, ecologyInit()));
  const n = sim.n;
  const frames: Uint8Array[] = [];
  for (let k = 0; k < ECOLOGY.frames; k++) {
    if (k > 0) sim.run(ECOLOGY.stride);
    frames.push(quantise(sim.state.cells, n));
    observe?.(sim, k);
  }
  return { id: "ecology-clip", family: "existing ecology", w: sim.W, h: sim.H, q: 16, frames };
}
