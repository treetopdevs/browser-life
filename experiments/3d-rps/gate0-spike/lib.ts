// Shared helpers for the Gate-0 spike: copied from runs/rps/probe/lib.ts, where the prototype took them (D16: the copy imports nothing from runs/).
import { CH, MOT_ZERO3, GENOME_CHANNELS3, allocState3, cellCount, draw, encodeGenome3, generalistGenome3, lowbias32, presetById, presetConfig, validateState3, type Genome3, type WorldConfig, type WorldState } from "@bl/schema";

type DenoRuntime = { Command: new (cmd: string) => { outputSync(): { stdout: Uint8Array } } };
// `Deno` is reached through globalThis so that this file also type-checks where only Node's types are loaded (experiments/3d-rps/tsconfig.json)
export const uptime = (): string => new TextDecoder().decode(new (globalThis as unknown as { Deno: DenoRuntime }).Deno.Command("uptime").outputSync().stdout).trim();
export const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
export const f = (x: number, d = 2) => x.toFixed(d);

/** slab-spots config at a shape with the three physics overrides (uniform light 240, lightBase 40 + lightAmp 200 as the preset). */
export function slabCfg(W: number, H: number, D: number, mu: number, sigma: number, lightK: number, seed: number, extra: Partial<WorldConfig> = {}): WorldConfig {
  const preset = presetById("slab-spots")!;
  return presetConfig(preset, seed, { tileW: W, tileH: H, tileD: D, defaultMu: mu, defaultSigma: sigma, lightK, ...extra });
}

/** Every cell living with the same genome, B random in [0, 2*B0], E = 2*B, nutrient A everywhere (a dense start for cost bounds). */
export function denseWorld(cfg: WorldConfig, genome: Genome3, B0: number, nutrient: number, lineages = 7): WorldState {
  const s = allocState3(cfg);
  const n = cellCount(cfg);
  const base = lowbias32(cfg.seed ^ 0xdee5e);
  s.cells.fill(nutrient, CH.A * n, (CH.A + 1) * n);
  s.cells.fill(MOT_ZERO3, CH.MOT * n, (CH.MOT + 1) * n);
  for (let i = 0; i < n; i++) {
    const b = draw(base, i) % (2 * B0 + 1);
    s.cells[CH.B * n + i] = b;
    s.cells[CH.E * n + i] = 2 * b;
    const words = encodeGenome3(genome, 0, 1 + (i % lineages));
    for (let g = 0; g < GENOME_CHANNELS3; g++) s.genome[g * n + i] = words[g];
  }
  const errs = validateState3(s);
  if (errs.length) throw new Error(`dense world invalid: ${errs.join("; ")}`);
  return s;
}

export { generalistGenome3 };
