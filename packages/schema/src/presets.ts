import { canonicalConfig, digestWords } from "./accounting.ts";
import { defaultConfig, type WorldConfig } from "./config.ts";
import { M3_FOUNDER_SET, M3_FOUNDERS } from "./founders.ts";
import { buildWorld, generalistWorld, m3World, soupWorld, type Founder, type WorldState } from "./world.ts";
import { generalistGenome } from "./genome.ts";
import { B1_OFF, B2_OFF, IN, NN_H, NN_O, OUT, W1_OFF, W2_OFF } from "./layout.ts";
import { lowbias32 } from "./int.ts";

export type InitKind = "generalist" | "soup" | "m3" | "followers" | "motile" | "motile-drift" | "sensing" | "three-way";

export interface InitParams {
  kind: InitKind;
  founders: number;
  nutrient: number;
  biomass: number;
}

export interface Preset {
  id: string;
  name: string;
  description: string;
  cfg: Partial<WorldConfig>;
  init: InitParams;
}

/** Physics shared by all presets: the spot-forming Flow-Lenia regime found in the M3 sweeps. */
const SPOT_REGIME: Partial<WorldConfig> = { defaultMu: 60, defaultSigma: 20, kernelRadius: 9 };

export const PRESETS: Preset[] = [
  {
    id: "spots",
    name: "Spot ecology",
    description: "Six generalist founders under uniform light. Biomass condenses into spots that grow and divide.",
    cfg: { ...SPOT_REGIME, tileW: 256, tileH: 256, lightMode: "uniform", lightBase: 40, lightAmp: 160 },
    init: { kind: "generalist", founders: 6, nutrient: 32, biomass: 64 },
  },
  {
    id: "gradient",
    name: "Light gradient",
    description: "Light rises from top to bottom, so lineages face a spatial niche axis.",
    cfg: { ...SPOT_REGIME, tileW: 256, tileH: 256, lightMode: "gradient", lightBase: 20, lightAmp: 220 },
    init: { kind: "generalist", founders: 8, nutrient: 32, biomass: 64 },
  },
  {
    id: "spots-m3",
    name: "Spot ecology (M3 founders)",
    description:
      "Spot ecology under uniform light, founded from the 12 M3-confirmed genomes (packages/schema/src/founders.ts) instead of the hand-built generalist genome.",
    cfg: { ...SPOT_REGIME, tileW: 256, tileH: 256, lightMode: "uniform", lightBase: 40, lightAmp: 160 },
    init: { kind: "m3", founders: M3_FOUNDERS.length, nutrient: 32, biomass: 64 },
  },
  {
    id: "gradient-m3",
    name: "Light gradient (M3 founders)",
    description:
      "Light gradient niche axis, founded from the 12 M3-confirmed genomes (packages/schema/src/founders.ts) instead of the hand-built generalist genome.",
    cfg: { ...SPOT_REGIME, tileW: 256, tileH: 256, lightMode: "gradient", lightBase: 20, lightAmp: 220 },
    init: { kind: "m3", founders: M3_FOUNDERS.length, nutrient: 32, biomass: 64 },
  },
  {
    id: "soup",
    name: "Random soup",
    description: "Twenty-four founders with random controllers. Most die; survivors seed the world.",
    cfg: { ...SPOT_REGIME, tileW: 256, tileH: 256, lightMode: "uniform", lightBase: 40, lightAmp: 160 },
    init: { kind: "soup", founders: 24, nutrient: 32, biomass: 64 },
  },
  {
    id: "seasons",
    name: "Patches & seasons",
    description: "Checkerboard light patches with a 4,000-step seasonal cycle.",
    cfg: { ...SPOT_REGIME, tileW: 256, tileH: 256, lightMode: "patches", lightBase: 20, lightAmp: 160, seasonPeriod: 4000, seasonAmp: 60 },
    init: { kind: "generalist", founders: 8, nutrient: 32, biomass: 64 },
  },
  {
    id: "large",
    name: "Large world (512²)",
    description: "The spot ecology at 512 × 512 for longer evolutionary runs.",
    cfg: { ...SPOT_REGIME, tileW: 512, tileH: 512, lightMode: "gradient", lightBase: 30, lightAmp: 200 },
    init: { kind: "generalist", founders: 16, nutrient: 32, biomass: 64 },
  },
  {
    id: "planet",
    name: "Rotating planet",
    description:
      "Sandbox, not registered. The gradient preset's light, but the sun moves: its meridian sweeps across the world along x every 16,000 steps, fading linearly to the antipode (lightMode \"sweep\"). Resources move, so staying put means a nightly starvation.",
    cfg: { ...SPOT_REGIME, tileW: 256, tileH: 256, lightMode: "sweep", lightBase: 20, lightAmp: 220, dayPeriod: 16_000 },
    init: { kind: "generalist", founders: 8, nutrient: 32, biomass: 64 },
  },
  {
    id: "planet-m3",
    name: "Rotating planet (M3 founders)",
    description: "Sandbox, not registered. The rotating planet founded from the 12 M3-confirmed genomes.",
    cfg: { ...SPOT_REGIME, tileW: 256, tileH: 256, lightMode: "sweep", lightBase: 20, lightAmp: 220, dayPeriod: 16_000 },
    init: { kind: "m3", founders: M3_FOUNDERS.length, nutrient: 32, biomass: 64 },
  },
  {
    id: "planet-followers",
    name: "Rotating planet: followers vs sleepers",
    description:
      "Sandbox, not registered. Eight still generalists (they go dormant at night) against eight hand-built sun-followers that drift east at exactly the sun's speed (a 16,384-step day). Lineage view shows who wins.",
    cfg: { ...SPOT_REGIME, tileW: 256, tileH: 256, lightMode: "sweep", lightBase: 20, lightAmp: 220, dayPeriod: 16_384 },
    init: { kind: "followers", founders: 16, nutrient: 32, biomass: 64 },
  },
  {
    id: "planet-motile",
    name: "Rotating planet: motile founders",
    description:
      "Sandbox, not registered. Sixteen generalists with random motility gain (0–64) but no heading: moving anywhere needs a mutation. A 16,384-step day.",
    cfg: { ...SPOT_REGIME, tileW: 256, tileH: 256, lightMode: "sweep", lightBase: 20, lightAmp: 220, dayPeriod: 16_384 },
    init: { kind: "motile", founders: 16, nutrient: 32, biomass: 64 },
  },
  {
    id: "planet-drifters",
    name: "Rotating planet: random drifters",
    description:
      "Sandbox, not registered. Sixteen generalists with random motility gain (0–64) and a random constant heading each. A 16,384-step day.",
    cfg: { ...SPOT_REGIME, tileW: 256, tileH: 256, lightMode: "sweep", lightBase: 20, lightAmp: 220, dayPeriod: 16_384 },
    init: { kind: "motile-drift", founders: 16, nutrient: 32, biomass: 64 },
  },
  {
    id: "planet-still",
    name: "Rotating planet: still founders (control)",
    description: "Sandbox, not registered. The control for the motile presets: the same 16 placements, all with motility gain 0. A 16,384-step day.",
    cfg: { ...SPOT_REGIME, tileW: 256, tileH: 256, lightMode: "sweep", lightBase: 20, lightAmp: 220, dayPeriod: 16_384 },
    init: { kind: "generalist", founders: 16, nutrient: 32, biomass: 64 },
  },
  {
    id: "planet-sensing",
    name: "Rotating planet: sensing followers vs sleepers",
    description:
      "Sandbox, not registered. Eight sleepers against eight hand-built sensing followers that signal in the dark and move away from signal. The sun moves 1.5× faster than a constant drift can match (an 11,000-step day); signalGain 127 and a long-lived signal (kSDecay 13) make the gradient readable.",
    cfg: { ...SPOT_REGIME, tileW: 256, tileH: 256, lightMode: "sweep", lightBase: 20, lightAmp: 220, dayPeriod: 11_000, signalGain: 127, kSDecay: 13 },
    init: { kind: "sensing", founders: 16, nutrient: 32, biomass: 64 },
  },
  {
    id: "planet-wander",
    name: "Wandering sun: sleepers vs drifters vs sensors",
    description:
      "Sandbox, not registered. The sun sweeps east for 32,768 steps, then west for 32,768, at 16 cells per 1,024 steps. Six each of sleepers, blind east-drifters and sensing followers (signal in the dark, move away from signal; signalGain 127, kSDecay 13).",
    cfg: { ...SPOT_REGIME, tileW: 256, tileH: 256, lightMode: "sweep", lightBase: 20, lightAmp: 220, dayPeriod: 0, wanderPeriod: 65_536, wanderAmp: 512, signalGain: 127, kSDecay: 13 },
    init: { kind: "three-way", founders: 18, nutrient: 32, biomass: 64 },
  },
  {
    id: "planet-large",
    name: "Rotating planet (512²)",
    description: "Sandbox, not registered. The large world with a moving sun: same light range and sun speed as the 256² planet (a 32,000-step day).",
    cfg: { ...SPOT_REGIME, tileW: 512, tileH: 512, lightMode: "sweep", lightBase: 30, lightAmp: 200, dayPeriod: 32_000 },
    init: { kind: "generalist", founders: 16, nutrient: 32, biomass: 64 },
  },
  {
    id: "archipelago",
    name: "Archipelago (2×2 islands)",
    description:
      "Four tile-islands (see WorldConfig's tileW/tileH/tilesX/tilesY: one tile is an independent torus) under a light gradient, exchanging migrant packets every migrationPeriod steps — the M6 gate's migration mechanism. The \"no-migration\" control disables the exchange.",
    cfg: { ...SPOT_REGIME, tileW: 64, tileH: 64, tilesX: 2, tilesY: 2, lightMode: "gradient", lightBase: 20, lightAmp: 220, migrationPeriod: 200, migrantCount: 4 },
    init: { kind: "generalist", founders: 16, nutrient: 32, biomass: 64 },
  },
];

export function presetConfig(p: Preset, seed: number, extra: Partial<WorldConfig> = {}): WorldConfig {
  return defaultConfig({ ...p.cfg, seed, ...extra });
}

/**
 * Content identity of a preset's distribution: everything that determines
 * what world a run of this preset draws from -- its own config (with `seed`
 * excluded, since that varies per run and is never part of "which
 * distribution") and init params, plus (only for an M3-founder preset) the
 * exact founder set `M3_FOUNDER_SET` resolves to. Two presets with the same
 * identity are, run-for-run, physically identical; a code change to a
 * preset's `cfg`/`init`, or to which founder set `M3_FOUNDER_SET` names,
 * changes this digest.
 *
 * Used to detect when a frozen value (e.g. experiments/endpoints.ts's
 * ACTIVITY_THRESHOLDS, calibrated by tools/calibrate.ts from a pilot) was
 * computed against a preset definition that has since changed underneath
 * it -- `seed`, deliberately excluded here, and `condition` (not a preset
 * property at all -- see packages/runner/src/conditions.ts) are expected to
 * differ between the pilot and any ensemble that reuses this identity, so
 * neither affects this digest.
 */
export function presetIdentity(p: Preset): string {
  const { seed: _seed, ...cfgWithoutSeed } = presetConfig(p, 0);
  const canonical = canonicalConfig(cfgWithoutSeed as WorldConfig);
  const founderSetId = p.init.kind === "m3" ? M3_FOUNDER_SET : null;
  // Fields in a fixed order, so the digest does not depend on how the preset's
  // init object happens to be written.
  const { kind, founders, nutrient, biomass } = p.init;
  const bytes = new TextEncoder().encode(JSON.stringify({ cfg: canonical, init: { kind, founders, nutrient, biomass }, founderSetId }));
  const words = new Uint32Array(Math.ceil(bytes.length / 4));
  new Uint8Array(words.buffer).set(bytes);
  const [a, b] = digestWords(Uint32Array.of(bytes.length, ...words));
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}

/**
 * Digest combining a preset's identity with one specific, already
 * seed-stripped `WorldConfig` -- typically a condition-transformed config
 * (e.g. `specConfig` for condition "neutral"), not the preset's own raw
 * `cfg` (Astra review, 2026-09-27, item 2): `presetIdentity` alone doesn't
 * capture a *condition*'s own transform (packages/runner/src/conditions.ts
 * -- e.g. "neutral"'s `apply`), so changing what a condition does would
 * otherwise leave `presetIdentity` unchanged while silently changing the
 * distribution a calibration pilot's runs (all one condition) actually draw
 * from.
 *
 * Takes explicit inputs -- a presetIdentity string, a condition id and a
 * config -- rather than a `Preset`/presetId, so this same function produces
 * identical digests whether called with values freshly computed from
 * current code (tools/analyze.ts, experiments/endpoints.ts) or with values
 * read back out of an already-verified run manifest (tools/calibrate.ts,
 * which must derive this from the pilot's own data, not from current code
 * alone) -- the two call sites are cross-checked precisely because they can
 * only agree if the underlying data actually does.
 */
export function distributionIdentity(presetIdentityValue: string, condition: string, cfgWithoutSeed: WorldConfig): string {
  const canonical = canonicalConfig(cfgWithoutSeed);
  const bytes = new TextEncoder().encode(JSON.stringify({ presetIdentity: presetIdentityValue, condition, cfg: canonical }));
  const words = new Uint32Array(Math.ceil(bytes.length / 4));
  new Uint8Array(words.buffer).set(bytes);
  const [a, b] = digestWords(Uint32Array.of(bytes.length, ...words));
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}

export function initWorld(cfg: WorldConfig, init: InitParams): WorldState {
  switch (init.kind) {
    case "soup":
      return soupWorld(cfg, init.founders, init.nutrient, init.biomass);
    case "m3":
      return m3World(cfg, init.founders, init.nutrient, init.biomass);
    case "followers":
      return followerWorld(cfg, init.founders, init.nutrient, init.biomass);
    case "three-way":
      return threeWayWorld(cfg, init.founders, init.nutrient, init.biomass);
    case "sensing":
      return followerWorld(cfg, init.founders, init.nutrient, init.biomass, darkFleeGenome(cfg.defaultMu, cfg.defaultSigma));
    case "motile":
      return motileWorld(cfg, false, init.founders, init.nutrient, init.biomass);
    case "motile-drift":
      return motileWorld(cfg, true, init.founders, init.nutrient, init.biomass);
    default:
      return generalistWorld(cfg, init.founders, init.nutrient, init.biomass);
  }
}

/**
 * Sandbox (rotating planet): the generalist genome with a constant +x drift of
 * 1/64 cell per step (MX bias 32, motility gain 12), which is the sun's speed
 * when dayPeriod * 1/64 = tileW, e.g. 16,384 steps on a 256-wide tile.
 */
export function sunFollowerGenome(mu: number, sigma: number) {
  const g = generalistGenome(mu, sigma);
  g.motGain = 12;
  g.weights[B2_OFF + OUT.MX] = 32;
  return g;
}

/** Generalist founders placed as in generalistWorld; every odd-indexed one is a sun-follower. */
export function followerWorld(cfg: WorldConfig, count = 16, nutrient = 32, biomass = 64, mover = sunFollowerGenome(cfg.defaultMu, cfg.defaultSigma)): WorldState {
  const W = cfg.tileW * cfg.tilesX;
  const H = cfg.tileH * cfg.tilesY;
  const still = generalistGenome(cfg.defaultMu, cfg.defaultSigma);
  const follower = mover;
  const founders: Founder[] = [];
  for (let i = 0; i < count; i++) {
    const h = lowbias32(cfg.seed * 31 + i);
    founders.push({ x: h % W, y: (h >>> 12) % H, radius: 12, genome: i % 2 ? follower : still, biomass, energy: 2 * biomass });
  }
  return buildWorld(cfg, { nutrient, founders });
}

/**
 * Sandbox (rotating planet): generalist founders with standing variation in
 * motility and no built-in direction. Each founder draws a motility gain in
 * 0..64; with `drift`, it also draws MX and MY biases in -32..32 (a random
 * constant heading). Without it, any heading has to evolve.
 */
export function motileWorld(cfg: WorldConfig, drift: boolean, count = 16, nutrient = 32, biomass = 64): WorldState {
  const W = cfg.tileW * cfg.tilesX;
  const H = cfg.tileH * cfg.tilesY;
  const founders: Founder[] = [];
  for (let i = 0; i < count; i++) {
    const h = lowbias32(cfg.seed * 31 + i);
    const r = lowbias32(cfg.seed * 977 + i * 131 + 7);
    const g = generalistGenome(cfg.defaultMu, cfg.defaultSigma);
    g.motGain = r % 65;
    if (drift) {
      g.weights[B2_OFF + OUT.MX] = ((r >>> 8) % 65) - 32;
      g.weights[B2_OFF + OUT.MY] = ((r >>> 16) % 65) - 32;
    }
    founders.push({ x: h % W, y: (h >>> 12) % H, radius: 12, genome: g, biomass, energy: 2 * biomass });
  }
  return buildWorld(cfg, { nutrient, founders });
}

/**
 * Sandbox (rotating planet): a sensing sun-follower. It emits signal when its
 * light is below average (light/2 < 90) and moves down the signal gradient, so
 * its own dark side pushes it toward the light at whatever speed the sun
 * moves. Hidden units 3 and 4 carry 64 + SGX and 64 + SGY; MX and MY are
 * their negated offsets. Needs a readable gradient: signalGain and a
 * long-lived signal (the planet-sensing preset).
 */
export function darkFleeGenome(mu: number, sigma: number) {
  const g = generalistGenome(mu, sigma);
  const w = g.weights;
  w[W2_OFF + 1 * NN_O + OUT.EMIT] = -127;
  w[B2_OFF + OUT.EMIT] = 90;
  w[B1_OFF + 3] = 64;
  w[W1_OFF + IN.SGX * NN_H + 3] = 127;
  w[B1_OFF + 4] = 64;
  w[W1_OFF + IN.SGY * NN_H + 4] = 127;
  w[W2_OFF + 3 * NN_O + OUT.MX] = -127;
  w[B2_OFF + OUT.MX] = 63;
  w[W2_OFF + 4 * NN_O + OUT.MY] = -127;
  w[B2_OFF + OUT.MY] = 63;
  g.motGain = 64;
  return g;
}

/** Founders placed as in generalistWorld, cycling sleeper, blind sun-follower, sensing follower (i % 3). */
export function threeWayWorld(cfg: WorldConfig, count = 18, nutrient = 32, biomass = 64): WorldState {
  const W = cfg.tileW * cfg.tilesX;
  const H = cfg.tileH * cfg.tilesY;
  const kinds = [generalistGenome(cfg.defaultMu, cfg.defaultSigma), sunFollowerGenome(cfg.defaultMu, cfg.defaultSigma), darkFleeGenome(cfg.defaultMu, cfg.defaultSigma)];
  const founders: Founder[] = [];
  for (let i = 0; i < count; i++) {
    const h = lowbias32(cfg.seed * 31 + i);
    founders.push({ x: h % W, y: (h >>> 12) % H, radius: 12, genome: kinds[i % 3], biomass, energy: 2 * biomass });
  }
  return buildWorld(cfg, { nutrient, founders });
}
