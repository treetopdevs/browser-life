/**
 * The Phase A conditions, in one place. Imported by the viewer page and by
 * experiments/oligomer/run.ts (which node runs with type stripping, so keep this
 * file to erasable TypeScript: no enums, namespaces or parameter properties).
 */

import { OP_CLEAVE, OP_IMPORT, OP_LIGATE, OP_LYSE, SPECIES, WALL_SPECIES, makeCatalyst, speciesByLabel } from './chem.ts';
import { type OligomerConfig, OligomerWorld, defaultConfig } from './model.ts';

export type ConditionId = 'LYSE' | 'NO_LYSE' | 'NEUTRAL_WALL' | 'SINGLE_WALL';

export interface ConditionDef {
  readonly id: ConditionId;
  readonly label: string;
  /** Config overrides on top of defaultConfig (never width, height or seed). */
  readonly overrides: Partial<OligomerConfig>;
  readonly seeder: (w: OligomerWorld) => void;
}

export function starterGenome(wallLabel: string, lyseTarget?: string): number[] {
  return [
    makeCatalyst(OP_CLEAVE, '0001', 2),
    makeCatalyst(OP_CLEAVE, '1110', 2),
    makeCatalyst(OP_LIGATE, wallLabel, 2),
    makeCatalyst(OP_IMPORT, '0001', 2),
    makeCatalyst(OP_IMPORT, '1110', 2),
    lyseTarget ? makeCatalyst(OP_LYSE, lyseTarget, 2) : 0,
  ];
}

export function seedUniform6(w: OligomerWorld, wallLabel = '0011'): void {
  const W = w.cfg.width;
  const H = w.cfg.height;
  const g = starterGenome(wallLabel);
  const wid = speciesByLabel(wallLabel);
  const coords = [
    [Math.floor(W * 0.25), Math.floor(H * 0.25)],
    [Math.floor(W * 0.75), Math.floor(H * 0.25)],
    [Math.floor(W * 0.5), Math.floor(H * 0.5)],
    [Math.floor(W * 0.25), Math.floor(H * 0.75)],
    [Math.floor(W * 0.75), Math.floor(H * 0.75)],
    [Math.floor(W * 0.5), Math.floor(H * 0.15)],
  ];
  coords.forEach(([x, y], idx) => {
    w.seedCompartment(x, y, wid, 20, g, idx + 1);
  });
}

export function seedMixedWalls6(w: OligomerWorld): void {
  const W = w.cfg.width;
  const H = w.cfg.height;
  const coords = [
    [Math.floor(W * 0.2), Math.floor(H * 0.25)],
    [Math.floor(W * 0.5), Math.floor(H * 0.25)],
    [Math.floor(W * 0.8), Math.floor(H * 0.25)],
    [Math.floor(W * 0.2), Math.floor(H * 0.75)],
    [Math.floor(W * 0.5), Math.floor(H * 0.75)],
    [Math.floor(W * 0.8), Math.floor(H * 0.75)],
  ];
  WALL_SPECIES.forEach((wid, idx) => {
    const label = SPECIES[wid].label;
    const [x, y] = coords[idx];
    w.seedCompartment(x, y, wid, 20, starterGenome(label), idx + 1);
  });
}

/** Rung 2 arms, in the order run.ts prints them. */
export const CONDITIONS: readonly ConditionDef[] = [
  { id: 'LYSE', label: 'Predators allowed', overrides: { enableLyse: true }, seeder: seedMixedWalls6 },
  { id: 'NO_LYSE', label: 'Predators off (control)', overrides: { enableLyse: false }, seeder: seedMixedWalls6 },
  {
    id: 'SINGLE_WALL',
    label: 'One wall pattern',
    overrides: { enableLyse: true, singleWallOnly: true },
    seeder: (w) => seedUniform6(w, '0011'),
  },
  {
    id: 'NEUTRAL_WALL',
    label: 'Blind predators',
    overrides: { enableLyse: true, neutralWallLyse: true },
    seeder: seedMixedWalls6,
  },
];

export function conditionById(id: string): ConditionDef {
  const c = CONDITIONS.find((x) => x.id === id);
  if (!c) throw new Error(`Unknown condition: ${id}`);
  return c;
}

export function buildCondition(id: ConditionId | string, size: number, seed: number): OligomerWorld {
  const c = conditionById(id);
  const w = new OligomerWorld(defaultConfig({ width: size, height: size, seed, ...c.overrides }));
  c.seeder(w);
  return w;
}

/** Audience-terms description of a world, derived from its config flags so it cannot drift from them. */
export function describeCondition(cfg: OligomerConfig): string {
  const parts: string[] = [];
  if (cfg.singleWallOnly) {
    parts.push(
      'Every compartment can only build 0011 walls, so there is nothing to switch to.' +
        (cfg.enableLyse ? ' Lysis still kills, and in the pilot the world stayed small and the leading pattern never changed in the last 20,000 steps.' : ''),
    );
  } else {
    parts.push('Six founders, one for each wall pattern.');
  }
  if (!cfg.enableLyse) {
    parts.push(
      'Predation is switched off, so no pattern is ever a target (the control). In the pilot the leading pattern never changed in the last 20,000 steps here.',
    );
  } else if (cfg.neutralWallLyse) {
    parts.push(
      'Lysis is on but blind to which pattern a wall holds, and compartments are not hurt by their own lysin, so no pattern is safer than another. ' +
        'It also changes self-harm (none here), so it tests blind attack, not pattern choice alone. In the pilot these runs held fewer compartments and none changed leader in the last 20,000 steps.',
    );
  } else if (!cfg.singleWallOnly) {
    parts.push(
      'Predation is on: a lysin only hurts neighbours whose wall holds the pattern it matches, and also hurts its own wall at half strength, so a pattern that spreads becomes the next target. ' +
        'In the pilot, 3 of 4 seeds changed leader in the last 20,000 steps and 1 stayed put. A lysin has to appear by mutation first, so the first minutes can be quiet.',
    );
  }
  return parts.join(' ');
}
