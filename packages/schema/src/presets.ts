import { canonicalConfig, digestWords } from "./accounting.ts";
import { cellCount, defaultConfig, type WorldConfig } from "./config.ts";
import { M3_FOUNDER_SET, M3_FOUNDERS, founderGenome } from "./founders.ts";
import { generalistGenome } from "./genome.ts";
import { lowbias32 } from "./int.ts";
import { B1_OFF, B2_OFF, CH, IN, NN_H, NN_O, OUT, W1_OFF, W2_OFF } from "./layout.ts";
import { buildWorld, generalistWorld, m3World, soupWorld, tiledWorld, validateState, type Founder, type WorldState } from "./world.ts";

export type InitKind = "generalist" | "soup" | "m3" | "ponds" | "followers" | "motile" | "motile-drift" | "sensing" | "three-way";

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
const SPOT_REGIME: Partial<WorldConfig> = { ruleVersion: 1, defaultMu: 60, defaultSigma: 20, kernelRadius: 9 };

/**
 * The M3 evaluator's world physics (`DEFAULT_EVAL.world`, packages/search/src/evaluate.ts),
 * which is the scaffold protocol's frozen regime, copied as literals because
 * schema does not depend on search. packages/schema/test/ponds.test.ts checks
 * the pond presets against tools/lib/ponds.ts's pondConfig.
 */
const POND_REGIME: Partial<WorldConfig> = { ruleVersion: 1, defaultMu: 60, defaultSigma: 20, kernelRadius: 9, lightMode: "uniform", lightBase: 40, lightAmp: 160 };

/** Wounds land every WOUND_PERIOD steps in the injury presets. */
const WOUND_PERIOD = 13;

/** Recurring-injury keys: radius-`radius` wound discs, each cell hit about once per `every` steps. */
function wounds(radius: number, every: number): Pick<WorldConfig, "injuryPeriod" | "injuryRadius" | "injuryProb"> {
  let disc = 0;
  for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) if (dx * dx + dy * dy <= radius * radius) disc++;
  return { injuryPeriod: WOUND_PERIOD, injuryRadius: radius, injuryProb: Math.round((2 ** 32 * WOUND_PERIOD) / (disc * every)) };
}

/**
 * Wild sandbox: every lever stacked. The planet-wander sun (lightAmp lowered
 * so the season fits under 255), the seasons preset's cycle, the sensing
 * presets' signal, own-injury-light's wounds and own-shape-far's rings.
 */
const STORM: Partial<WorldConfig> = {
  ...SPOT_REGIME, tileW: 256, tileH: 256,
  lightMode: "sweep", lightBase: 20, lightAmp: 170, dayPeriod: 0, wanderPeriod: 65_536, wanderAmp: 512,
  seasonPeriod: 4000, seasonAmp: 60,
  signalGain: 127, kSDecay: 13,
  shapeReach: 13,
  ...wounds(3, 13_000),
};
const M3_INIT: InitParams = { kind: "m3", founders: M3_FOUNDERS.length, nutrient: 32, biomass: 64 };

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
  // Planet sandbox (rotating and wandering sun, signalGain): exploratory, not
  // registered. Kept after the pinned presets so their order is unchanged.
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
  ...([["light", 3, 13_000], ["heavy", 3, 3_250], ["coarse", 8, 13_000]] as const).map(([tag, radius, every]): Preset => ({
    id: `own-injury-${tag}`,
    name: `Ownership: recurring injury (${tag})`,
    description: `gradient-m3 with radius-${radius} wounds every ${WOUND_PERIOD} steps; each cell is hit about once per ${every.toLocaleString("en-US")} steps.`,
    cfg: { ...SPOT_REGIME, tileW: 256, tileH: 256, lightMode: "gradient", lightBase: 20, lightAmp: 220, ...wounds(radius, every) },
    init: { kind: "m3", founders: M3_FOUNDERS.length, nutrient: 32, biomass: 64 },
  })),
  // Cells sandbox (docs/sandbox-cells.md): heritable kernel shape. Founders
  // carry neutral ring weights, so their kernel density is gradient-m3's. The
  // histories still part from gradient-m3's at the first mutation, because
  // the ring slots change which slot a mutation draw selects.
  ...([["own-shape", 9, "the two rings of the radius-9 kernel"], ["own-shape-far", 13, "those two rings plus a far ring out to radius 13"]] as const).map(([id, reach, what]): Preset => ({
    id,
    name: `Cells: heritable kernel shape (reach ${reach})`,
    description: `gradient-m3 where each genome weights ${what}; mutation gains one slot per ring.`,
    cfg: { ...SPOT_REGIME, tileW: 256, tileH: 256, lightMode: "gradient", lightBase: 20, lightAmp: 220, shapeReach: reach },
    init: { kind: "m3", founders: M3_FOUNDERS.length, nutrient: 32, biomass: 64 },
  })),
  // Declared cells: no in-step mutation; every daughter body gets its own id
  // and one mutation at birth (cellMutProb 2^32 = always). The wall arm adds
  // lossy takeover between ids, so a cell's matter is never assimilated. The
  // injury arms add own-injury-light's wounds (radius 3, each cell hit about
  // once per 13,000 steps) to each; a wound that cuts a body in two makes a
  // daughter at the next pass.
  ...([
    ["own-cell", {}, "RULE_VERSION 1 takeover between cells"],
    ["own-cell-wall", { takeover: "lossy", takeoverKin: "lineage" }, "lossy takeover between cells"],
    ["own-cell-injury", wounds(3, 13_000), "RULE_VERSION 1 takeover between cells, recurring radius-3 wounds"],
    ["own-cell-wall-injury", { takeover: "lossy", takeoverKin: "lineage", ...wounds(3, 13_000) }, "lossy takeover between cells, recurring radius-3 wounds"],
  ] as const).map(([id, extra, what]): Preset => ({
    id,
    name: `Cells: declared cells (${what})`,
    description: `gradient-m3 with mutation at cell birth only: every 1,000 steps each body that shares its id with a heavier one becomes a daughter with a new id and one mutation; ${what}.`,
    cfg: { ...SPOT_REGIME, tileW: 256, tileH: 256, lightMode: "gradient", lightBase: 20, lightAmp: 220, mutRate: 0, cellPeriod: 1000, cellMutProb: 2 ** 32, ...extra },
    init: { kind: "m3", founders: M3_FOUNDERS.length, nutrient: 32, biomass: 64 },
  })),
  // Wild sandbox: the levers of the planet, ownership and cells sandboxes
  // stacked in one world, each at the dose its own sandbox used (STORM), then
  // one lever moved per arm. Exploratory, not registered.
  ...([
    ["wild-storm", "", {}, M3_INIT, "every lever at its sandbox dose"],
    ["wild-storm-w01", ", wounds ×0.1", wounds(3, 130_000), M3_INIT, "each cell wounded about once per 130,000 steps"],
    ["wild-storm-w10", ", wounds ×10", wounds(3, 1_300), M3_INIT, "each cell wounded about once per 1,300 steps"],
    ["wild-storm-meteor", ", meteors", wounds(8, 13_000), M3_INIT, "radius-8 wounds that remove whole bodies, at the same per-cell rate"],
    ["wild-storm-m10", ", mutation ×10", { mutRate: 4_294_970 }, M3_INIT, "ten times the mutation rate"],
    ["wild-storm-3way", ", hand-built movers", {}, { kind: "three-way", founders: 18, nutrient: 32, biomass: 64 }, "founded by six each of sleepers, blind drifters and sensing followers instead of the M3 founders"],
    ["wild-storm-large", " (512²)", { tileW: 512, tileH: 512, wanderPeriod: 131_072, wanderAmp: 1024 }, { ...M3_INIT, founders: 2 * M3_FOUNDERS.length }, "a 512² world with the sun at the same speed"],
  ] as const).map(([id, tag, extra, init, what]): Preset => ({
    id,
    name: `Wild: storm world${tag}`,
    description: `Sandbox, not registered. A sun that sweeps east then west at 1/64 cell per step, a 4,000-step season, a readable signal (signalGain 127, kSDecay 13), recurring wounds and heritable kernel rings out to radius 13; ${what}.`,
    cfg: { ...STORM, ...extra },
    init,
  })),
  // Wild sandbox: the breeder as a world of its own, sized for the lab (docs/sandbox-wild.md). Exploratory, not registered.
  {
    id: "breeder",
    name: "Wild: breeder (4×4 ponds)",
    description:
      "Sandbox, not registered. Sixteen ponds of 64 × 64, each planted with one disc of M3 founder 2, at ten times the usual mutation rate. Every 5,000 steps each pond is cleared and reseeded from the four ponds that rank best on movement, seed-packet mass and body size together. Turn on the Breeder panel to choose the donors yourself.",
    cfg: { ...POND_REGIME, tileW: 64, tileH: 64, tilesX: 4, tilesY: 4, pondPeriod: 5_000, pondK: 8, pondArm: "breed", pondScore: "drive+seed+body", mutRate: 4_294_970 },
    init: { kind: "ponds", founders: 16, nutrient: 32, biomass: 64, start: "clone", founder: 2 },
  },
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

/** The founding state for `init.kind`, before `initWorld` adds waste. */
function foundingWorld(cfg: WorldConfig, init: InitParams): WorldState {
  switch (init.kind) {
    case "ponds":
      return pondsWorld(cfg, init);
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

export function initWorld(cfg: WorldConfig, init: InitParams): WorldState {
  if (init.kind !== "ponds" && (init.start !== undefined || init.founder !== undefined)) throw new Error(`init kind ${init.kind}: start and founder belong to kind "ponds"`);
  const s = foundingWorld(cfg, init);
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
