/**
 * The /roam/ page's dials: every number a viewer can set, with its range, its default (the page's usual world), what
 * it means in plain words, and how it reaches the world's config. Kept apart from the page so the mapping can be
 * tested: with every dial at its default the options are exactly the page's usual world.
 */

import { defaultRoamConfig, type RoamConfig } from './kernel.ts';
import type { RoamOptions } from './view.ts';

export interface RoamSwitches {
  seed: number;
  size: number;
  start: RoamOptions['start'];
  compost: boolean;
  kinds: boolean;
  toughness: boolean;
}

export type DialValues = Record<string, number>;

export interface Dial {
  id: string;
  group: string;
  label: string;
  min: number;
  max: number;
  step: number;
  def: number;
  /** Whole numbers only. */
  whole?: boolean;
  /** Smallest value above 0 the world accepts (values between 0 and this become this). */
  least?: number;
  /** What the value means, in plain words. */
  say: (v: number, all: DialValues) => string;
  /** Why the dial does nothing right now, or null when it is in use. */
  idle?: (all: DialValues, sw: RoamSwitches) => string | null;
}

const n = (x: number, digits = 0) => x.toLocaleString('en-US', { maximumFractionDigits: digits });
const share = (x: number) => (x === 0 ? 'none' : x === 1 ? 'all' : `${n(x * 100, 1)}%`);
const grown = (sw: RoamSwitches) => (sw.start ?? '').startsWith('grown');
const noPlans = (_a: DialValues, sw: RoamSwitches) => (grown(sw) ? null : 'needs a grown start');
const noFlow = (a: DialValues, sw: RoamSwitches) => noPlans(a, sw) ?? (a.flow > 0 ? null : 'needs seeping on (above 0)');
const noKinds = (a: DialValues, sw: RoamSwitches) => noFlow(a, sw) ?? (sw.kinds ? null : 'needs kinds of cell on');
const noDrain = (a: DialValues) => (a.drain > 0 ? null : 'needs touch feeding on (above 0)');

export const ROAM_DIALS: readonly Dial[] = [
  // Armour and hunting
  { id: 'crack', whole: true, group: 'Armour and hunting', label: 'Hits to crack a shell', min: 0, max: 20000, step: 50, def: 2000,
    say: (v) => (v === 0 ? 'shells never crack' : `a shell turns plain (and can be eaten) after ${n(v)} hits from mouths of bodies twice its size; one hit per pressed side per step, never healed`),
    idle: (a, sw) => noKinds(a, sw) ?? noDrain(a) },
  { id: 'shellBite', group: 'Armour and hunting', label: 'Lone shell eats', min: 0, max: 1, step: 0.05, def: 0.5,
    say: (v, a) => `a shell on its own (an armoured seed) eats ${share(v)} of the usual bite of ${a.bite}: ${v < 1 ? 'safe but slow to grow' : 'no cost to armour'}`,
    idle: noKinds },
  { id: 'shellLeak', group: 'Armour and hunting', label: 'Shell upkeep', min: 0, max: 1, step: 0.05, def: 0.25,
    say: (v) => `a shell pays ${share(v)} of the upkeep other cells pay on open sides`,
    idle: noKinds },
  { id: 'drain', whole: true, group: 'Armour and hunting', label: 'Touch feeding', min: 0, max: 16, step: 1, def: 2,
    say: (v) => (v === 0 ? 'bodies only block each other' : `a body at least twice another's size takes ${v} matter a step through each side where they touch (with kinds, only through its mouths)`) },
  { id: 'seal', whole: true, group: 'Armour and hunting', label: 'Newborn safe for', min: 0, max: 1000, step: 10, def: 100,
    say: (v) => (v === 0 ? 'newborn bodies can be fed on at once' : `a new body cannot be fed on for its first ${n(v)} steps`),
    idle: noDrain },
  // Bodies
  { id: 'flow', group: 'Bodies', label: 'Seeping along bonds', min: 0, max: 12.5, step: 0.1, def: 1.5625, least: 0.01,
    idle: noPlans,
    say: (v) => (v === 0 ? 'one shared store per body, size limit 32 (the older rules; kinds, wear and compost need seeping)' : `each cell keeps its own store and ${n(v, 2)}% of a difference seeps across each bond a step`) },
  { id: 'life', whole: true, group: 'Bodies', label: 'Cells wear out after', min: 0, max: 20000, step: 100, def: 2000, least: 2,
    say: (v) => (v === 0 ? 'cells live until they starve' : `about ${n(v)} steps on average`),
    idle: noFlow },
  { id: 'birthStore', whole: true, group: 'Bodies', label: 'Matter to divide', min: 10, max: 400, step: 5, def: 100,
    say: (v) => `a cell holding ${n(v * 2)} divides, each half starting with about ${n(v)}` },
  { id: 'minStore', whole: true, group: 'Bodies', label: 'Starves below', min: 1, max: 200, step: 1, def: 16,
    say: (v, a) => (v > a.birthStore ? `held at ${n(a.birthStore)}, the matter to divide: a cell with less than that dies` : `a cell with less than ${n(v)} matter dies`) },
  { id: 'bite', whole: true, group: 'Bodies', label: 'Bite', min: 1, max: 16, step: 1, def: 2,
    say: (v) => `a grazing cell takes up to ${v} food a step from its own tile` },
  // Upkeep and moving
  { id: 'leakSide', group: 'Upkeep and moving', label: 'Upkeep per open side', min: 0, max: 100, step: 0.5, def: 15.625,
    say: (v) => `${n(v, 2)} matter per 1,000 steps for each side of a cell not touching its own body` },
  { id: 'leakCell', group: 'Upkeep and moving', label: 'Upkeep per cell', min: 0, max: 50, step: 0.25, def: 3.90625,
    say: (v) => `${n(v, 2)} matter per 1,000 steps for every cell, wherever it sits` },
  { id: 'moveCost', group: 'Upkeep and moving', label: 'Cost of moving', min: 0, max: 200, step: 1, def: 31.25,
    say: (v) => `${n(v, 2)} matter per 1,000 steps per cell at top speed (less when slower)` },
  { id: 'moveMax', group: 'Upkeep and moving', label: 'Top speed', min: 0, max: 0.5, step: 0.01, def: 0.25,
    say: (v) => (v === 0 ? 'nothing moves' : `${n(v, 2)} tiles a step (one tile every ${n(1 / v, 1)} steps)`) },
  { id: 'turnMax', group: 'Upkeep and moving', label: 'Turning', min: 0, max: 100, step: 0.5, def: 15.625,
    say: (v) => `at most ${n(v, 2)} chances in 1,000 a step that a body picks a new heading` },
  // Food
  { id: 'patchFood', whole: true, group: 'Food', label: 'Food per patch', min: 200, max: 20000, step: 100, def: 4000,
    say: (v) => `each patch drops ${n(v)} food (when the world's store holds that much)` },
  { id: 'patchEvery', whole: true, group: 'Food', label: 'Steps between patches', min: 1, max: 500, step: 1, def: 20,
    say: (v) => `at least ${n(v)} steps between patches in a 128 x 128 arena (scaled for other sizes)` },
  { id: 'patchRadius', whole: true, group: 'Food', label: 'Patch radius', min: 0, max: 16, step: 1, def: 4,
    say: (v) => `patches are ${n(2 * v + 1)} tiles across` },
  // Copy errors
  { id: 'mut', group: 'Copy errors', label: 'Gene copy errors', min: 0, max: 0.2, step: 0.005, def: 0.02,
    say: (v) => (v === 0 ? 'children are exact copies' : `about 1 gene in ${n(1 / v)} changes at each division`) },
  { id: 'planMut', group: 'Copy errors', label: 'Plan copy errors', min: 0, max: 0.5, step: 0.005, def: 0.05,
    say: (v) => (v === 0 ? 'plans never change' : `a new body's plan differs in one place ${n(v * 100, 1)}% of the time`),
    idle: noPlans },
];

/** A value the world accepts for a dial: within its range, whole where it must be, and not in the gap above 0. */
export function fixDial(d: Dial, v: number): number {
  if (!Number.isFinite(v)) return d.def;
  let x = Math.min(d.max, Math.max(d.min, v));
  if (d.whole) x = Math.round(x);
  if (d.least !== undefined && x > 0 && x < d.least) x = d.least;
  return x;
}

export const dialDefaults = (): DialValues => Object.fromEntries(ROAM_DIALS.map((d) => [d.id, d.def]));

/** Options for a world from the switches and dials. Dials left at their defaults leave the world's config as it was. */
export function dialOptions(sw: RoamSwitches, a: DialValues): RoamOptions {
  const base = defaultRoamConfig();
  const over: Partial<RoamConfig> = {};
  const differs = (id: string) => a[id] !== ROAM_DIALS.find((d) => d.id === id)!.def;
  if (differs('bite')) over.bite = a.bite;
  if (differs('birthStore')) over.birthStore = a.birthStore;
  if (differs('minStore') || a.minStore > a.birthStore) over.minStore = Math.min(a.minStore, a.birthStore);
  if (differs('leakSide')) over.leakSide = a.leakSide / 1000;
  if (differs('leakCell')) over.leakCell = a.leakCell / 1000;
  if (differs('moveCost')) over.moveCost = a.moveCost / 1000;
  if (differs('moveMax')) over.moveMax = a.moveMax;
  if (differs('turnMax')) over.turnMax = a.turnMax / 1000;
  if (differs('patchFood')) over.patchFood = a.patchFood;
  if (differs('patchRadius')) over.patchRadius = a.patchRadius;
  if (differs('patchEvery')) over.patchEvery = Math.max(1, Math.round(a.patchEvery / ((sw.size * sw.size) / (base.size * base.size))));
  if (a.drain > 0 && differs('seal')) over.seal = a.seal;
  return {
    seed: sw.seed,
    size: sw.size,
    start: sw.start,
    mut: a.mut,
    planMut: a.planMut,
    drain: a.drain,
    flow: a.flow > 0 ? a.flow / 100 : undefined,
    life: a.life > 0 ? a.life : undefined,
    compost: sw.compost,
    kinds: sw.kinds,
    crack: a.crack > 0 ? a.crack : undefined,
    toughness: sw.toughness,
    shellBite: a.shellBite,
    shellLeak: a.shellLeak,
    overrides: Object.keys(over).length > 0 ? over : undefined,
  };
}
