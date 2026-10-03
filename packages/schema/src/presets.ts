import { canonicalConfig, digestWords } from "./accounting.ts";
import { cellCount, defaultConfig, type WorldConfig } from "./config.ts";
import { M3_FOUNDER_SET, M3_FOUNDERS, founderGenome } from "./founders.ts";
import { CH } from "./layout.ts";
import { generalistWorld, m3World, soupWorld, tiledWorld, validateState, type WorldState } from "./world.ts";

export type InitKind = "generalist" | "soup" | "m3" | "ponds";

export interface InitParams {
  kind: InitKind;
  founders: number;
  nutrient: number;
  biomass: number;
  /** Dissolved waste (channel C) per cell; optional, absent from existing presets. */
  waste?: number;
  /**
   * Kind "ponds" only (and required there): "clone" plants M3_FOUNDERS[`founder`]
   * in every pond, "founders" the 12 M3 founders round-robin (pond t gets
   * founder t mod 12), as tools/scaffold.ts's --init clone|founders do.
   */
  start?: "clone" | "founders";
  /** Kind "ponds" with start "clone" only: an index into M3_FOUNDERS. */
  founder?: number;
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

/**
 * The M3 evaluator's world physics (`DEFAULT_EVAL.world`, packages/search/src/evaluate.ts),
 * which is the scaffold protocol's frozen regime, copied as literals because
 * schema does not depend on search. packages/schema/test/ponds.test.ts checks
 * the pond presets against tools/lib/ponds.ts's pondConfig.
 */
const POND_REGIME: Partial<WorldConfig> = { defaultMu: 60, defaultSigma: 20, kernelRadius: 9, lightMode: "uniform", lightBase: 40, lightAmp: 160 };

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
    id: "gradient-m3-waste",
    name: "Light gradient (M3 founders, waste medium)",
    description:
      "gradient-m3 with dissolved nutrient split into A=8 / C=24 waste — empty-niche set S4's conditioned substrate. Same founders and light; total dissolved matter matches gradient-m3.",
    cfg: { ...SPOT_REGIME, tileW: 256, tileH: 256, lightMode: "gradient", lightBase: 20, lightAmp: 220 },
    init: { kind: "m3", founders: M3_FOUNDERS.length, nutrient: 8, biomass: 64, waste: 24 },
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
    id: "archipelago",
    name: "Archipelago (2×2 islands)",
    description:
      "Four tile-islands (see WorldConfig's tileW/tileH/tilesX/tilesY: one tile is an independent torus) under a light gradient, exchanging migrant packets every migrationPeriod steps — the M6 gate's migration mechanism. The \"no-migration\" control disables the exchange.",
    cfg: { ...SPOT_REGIME, tileW: 64, tileH: 64, tilesX: 2, tilesY: 2, lightMode: "gradient", lightBase: 20, lightAmp: 220, migrationPeriod: 200, migrantCount: 4 },
    init: { kind: "generalist", founders: 16, nutrient: 32, biomass: 64 },
  },
  {
    id: "ponds",
    name: "Ponds (8×8, pond cycle)",
    description:
      "The scaffold protocol's main regime (docs/scaffold-protocol-v1.md): 64 ponds of 64 × 64, each planted with one disc of M3 founder 2. Every 10,000 steps each pond is ground back to nutrient and reseeded by an 8 × 8 packet from one of the 16 ponds with the largest trait. The pond-rand and pond-cont conditions pick donors at random or only measure.",
    cfg: { ...POND_REGIME, tileW: 64, tileH: 64, tilesX: 8, tilesY: 8, pondPeriod: 10_000, pondK: 8, pondArm: "scaf" },
    init: { kind: "ponds", founders: 64, nutrient: 32, biomass: 64, start: "clone", founder: 2 },
  },
  {
    id: "ponds-small",
    name: "Ponds (2×2, pond cycle)",
    description: "The ponds preset's physics and cycle at 2 × 2 ponds with a 1,000-step period, for tests and the lab.",
    cfg: { ...POND_REGIME, tileW: 64, tileH: 64, tilesX: 2, tilesY: 2, pondPeriod: 1000, pondK: 8, pondArm: "scaf" },
    init: { kind: "ponds", founders: 4, nutrient: 32, biomass: 64, start: "clone", founder: 2 },
  },
  // Ownership sandbox (docs/sandbox-ownership.md): gradient-m3's cfg and init
  // plus one difference each. Exploratory, not registered.
  {
    id: "own-lossy",
    name: "Ownership: lossy takeover (lineage kin)",
    description: "gradient-m3 where bound matter that loses the transport lottery to a different lineage becomes waste C and its potential energy feeds the winner's E.",
    cfg: { ...SPOT_REGIME, tileW: 256, tileH: 256, lightMode: "gradient", lightBase: 20, lightAmp: 220, takeover: "lossy", takeoverKin: "lineage" },
    init: { kind: "m3", founders: M3_FOUNDERS.length, nutrient: 32, biomass: 64 },
  },
  {
    id: "own-match",
    name: "Ownership: lossy takeover (growth kin)",
    description: "own-lossy, but kin means Lenia mu within 8 and sigma within 2 of the winner, so most single mutants stay kin.",
    cfg: { ...SPOT_REGIME, tileW: 256, tileH: 256, lightMode: "gradient", lightBase: 20, lightAmp: 220, takeover: "lossy", takeoverKin: "growth", takeoverTol: 8 },
    init: { kind: "m3", founders: M3_FOUNDERS.length, nutrient: 32, biomass: 64 },
  },
  {
    id: "own-seasons",
    name: "Ownership: seasons control",
    description: "gradient-m3 with no rule change but seasonal light forcing (4,000-step period).",
    cfg: { ...SPOT_REGIME, tileW: 256, tileH: 256, lightMode: "gradient", lightBase: 20, lightAmp: 160, seasonPeriod: 4000, seasonAmp: 75 },
    init: { kind: "m3", founders: M3_FOUNDERS.length, nutrient: 32, biomass: 64 },
  },
  // Whole-genome kin: at most `takeoverTol` of the 42 heritable genome words
  // differ from the winner's. Tolerance 1 keeps a single mutant kin to its
  // parent; founders differ from each other in 41 or 42 words.
  ...[1, 3, 8].map((tol): Preset => ({
    id: `own-genome-${tol}`,
    name: `Ownership: lossy takeover (genome kin, ${tol} word${tol > 1 ? "s" : ""})`,
    description: `own-lossy, but kin means at most ${tol} of the 42 heritable genome words differ from the lottery winner's.`,
    cfg: { ...SPOT_REGIME, tileW: 256, tileH: 256, lightMode: "gradient", lightBase: 20, lightAmp: 220, takeover: "lossy", takeoverKin: "genome", takeoverTol: tol },
    init: { kind: "m3", founders: M3_FOUNDERS.length, nutrient: 32, biomass: 64 },
  })),
  // Recurring injury, no takeover change: gradient-m3 where wound discs destroy
  // bound structure as the assay's lesion does. `every` is the mean number of
  // steps between hits on any one cell; a radius-3 wound (29 cells) takes about
  // 30% of a 20-cell body, a radius-8 wound (197 cells) removes whole bodies.
  ...([["light", 3, 13_000], ["heavy", 3, 3_250], ["coarse", 8, 13_000]] as const).map(([tag, radius, every]): Preset => {
    const period = 13;
    let disc = 0;
    for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) if (dx * dx + dy * dy <= radius * radius) disc++;
    return {
      id: `own-injury-${tag}`,
      name: `Ownership: recurring injury (${tag})`,
      description: `gradient-m3 with radius-${radius} wounds every ${period} steps; each cell is hit about once per ${every.toLocaleString("en-US")} steps.`,
      cfg: { ...SPOT_REGIME, tileW: 256, tileH: 256, lightMode: "gradient", lightBase: 20, lightAmp: 220, injuryPeriod: period, injuryRadius: radius, injuryProb: Math.round((2 ** 32 * period) / (disc * every)) },
      init: { kind: "m3", founders: M3_FOUNDERS.length, nutrient: 32, biomass: 64 },
    };
  }),
];

export function presetConfig(p: Preset, seed: number, extra: Partial<WorldConfig> = {}): WorldConfig {
  return defaultConfig({ ...p.cfg, seed, ...extra });
}

/**
 * Content identity of a preset's distribution: everything that determines
 * what world a run of this preset draws from -- its own config (with `seed`
 * excluded, since that varies per run and is never part of "which
 * distribution") and init params, plus (only for an M3-founder or pond
 * preset) the exact founder set `M3_FOUNDER_SET` resolves to. Two presets
 * with the same identity are, run-for-run, physically identical; a code
 * change to a preset's `cfg`/`init`, or to which founder set
 * `M3_FOUNDER_SET` names, changes this digest.
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
  const founderSetId = p.init.kind === "m3" || p.init.kind === "ponds" ? M3_FOUNDER_SET : null;
  // Fields in a fixed order, so the digest does not depend on how the preset's
  // init object happens to be written. `waste` is included only when present,
  // and `start`/`founder` only for kind "ponds", so existing presets keep their
  // pinned identities.
  const { kind, founders, nutrient, biomass, waste, start, founder } = p.init;
  const base = waste !== undefined ? { kind, founders, nutrient, biomass, waste } : { kind, founders, nutrient, biomass };
  const init = kind === "ponds" ? { ...base, start, founder: founder ?? null } : base;
  const bytes = new TextEncoder().encode(JSON.stringify({ cfg: canonical, init, founderSetId }));
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

/**
 * Kind "ponds": one disc per pond at its centre (radius 10, `biomass`, energy
 * twice that), `start` choosing the genomes -- founder for founder what
 * tools/lib/ponds.ts's cloneWorld/foundersWorld plant (with the protocol's
 * nutrient 32 and biomass 64). Lineage ids follow pond index. `founders` must
 * equal the pond count, so the recorded init says how many discs there are.
 */
function pondsWorld(cfg: WorldConfig, init: InitParams): WorldState {
  const ponds = cfg.tilesX * cfg.tilesY;
  if (init.founders !== ponds) throw new Error(`ponds init: founders must equal the pond count ${ponds} (one disc per pond), got ${init.founders}`);
  if (init.start === "clone") {
    if (init.founder === undefined || !Number.isInteger(init.founder) || init.founder < 0 || init.founder >= M3_FOUNDERS.length)
      throw new Error(`ponds init: start "clone" needs founder, an index into the ${M3_FOUNDERS.length} M3 founders, got ${init.founder}`);
    return tiledWorld(cfg, [founderGenome(M3_FOUNDERS[init.founder])], init.nutrient, 10, init.biomass, 2 * init.biomass);
  }
  if (init.start === "founders") {
    if (init.founder !== undefined) throw new Error(`ponds init: start "founders" plants every M3 founder and takes no founder index, got ${init.founder}`);
    return tiledWorld(cfg, M3_FOUNDERS.map(founderGenome), init.nutrient, 10, init.biomass, 2 * init.biomass);
  }
  throw new Error(`ponds init: start must be "clone" or "founders", got ${JSON.stringify(init.start)}`);
}

export function initWorld(cfg: WorldConfig, init: InitParams): WorldState {
  if (init.kind !== "ponds" && (init.start !== undefined || init.founder !== undefined)) throw new Error(`init kind ${init.kind}: start and founder belong to kind "ponds"`);
  const s =
    init.kind === "ponds"
      ? pondsWorld(cfg, init)
      : init.kind === "soup"
        ? soupWorld(cfg, init.founders, init.nutrient, init.biomass)
        : init.kind === "m3"
          ? m3World(cfg, init.founders, init.nutrient, init.biomass)
          : generalistWorld(cfg, init.founders, init.nutrient, init.biomass);
  // Waste is applied here rather than through m3World/soupWorld/generalistWorld
  // so those helpers' signatures stay free for other callers (e.g. Genome[] only).
  if (init.waste) {
    const n = cellCount(cfg);
    s.cells.fill(init.waste, CH.C * n, (CH.C + 1) * n);
    const errs = validateState(s);
    if (errs.length) throw new Error(`invalid initial world: ${errs.join("; ")}`);
  }
  return s;
}
