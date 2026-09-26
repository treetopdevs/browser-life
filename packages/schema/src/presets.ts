import { defaultConfig, type WorldConfig } from "./config.ts";
import { generalistWorld, soupWorld, type WorldState } from "./world.ts";

export type InitKind = "generalist" | "soup";

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
];

export function presetConfig(p: Preset, seed: number, extra: Partial<WorldConfig> = {}): WorldConfig {
  return defaultConfig({ ...p.cfg, seed, ...extra });
}

export function initWorld(cfg: WorldConfig, init: InitParams): WorldState {
  return init.kind === "soup"
    ? soupWorld(cfg, init.founders, init.nutrient, init.biomass)
    : generalistWorld(cfg, init.founders, init.nutrient, init.biomass);
}
