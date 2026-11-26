// Lazy sim-ref clips by the I14 recipe, one frame at a time. Imports @bl/* (the CLI registers a resolver; vitest and vite alias it).
// Not part of the barrel. The sim is only read.
import { CH, PRESETS, initWorld, presetConfig, validateConfig, type WorldConfig } from "@bl/schema";
import { RefSim } from "@bl/sim-ref";
import { PROTOCOL } from "./protocol.ts";

const C = PROTOCOL.clips;

export function clipConfig(preset: string): { cfg: WorldConfig; init: ReturnType<typeof initOf> } {
  const p = PRESETS.find((x) => x.id === preset);
  if (!p) throw new Error(`preset ${preset} is missing`);
  const cfg = presetConfig(p, C.seed, { tileW: C.side, tileH: C.side });
  const errs = validateConfig(cfg);
  if (errs.length) throw new Error(`invalid ${preset} config: ${errs.join("; ")}`);
  return { cfg, init: initOf(preset) };
}
const initOf = (preset: string) => PRESETS.find((p) => p.id === preset)!.init;

/** Yields quantised channel-B frames (`min(cap, B >> shift)`), independent copies; `onSim` sees the sim after each frame is taken. */
export function* clipFrames(preset: string, onSim?: (sim: RefSim, k: number) => void): Generator<Uint8Array> {
  const { cfg, init } = clipConfig(preset);
  const sim = new RefSim(initWorld(cfg, init));
  const n = sim.n;
  for (let k = 0; k < C.frames; k++) {
    if (k > 0) sim.run(C.stride);
    const f = new Uint8Array(n);
    for (let c = 0; c < n; c++) f[c] = Math.min(C.cap, sim.state.cells[CH.B * n + c] >>> C.shift);
    onSim?.(sim, k);
    yield f;
  }
}

export const clipSide = (): number => C.side;
