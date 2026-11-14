/**
 * Which hash-pinned model.ts a screen runs on.
 *
 * Every screen was run on its own explore tool's model copy. The newest copy
 * (food-schedule-769) claims to preserve the older modes; PARITY records, per screen,
 * whether that claim was measured to hold (apps/lab/test/food-bands-parity.test.ts
 * measures it again and fails if this table is stale). No model.ts is edited.
 *
 * Resolution rule: the newest model is used for a screen only when its dynamics match the
 * screen's own model for every mode and seed AND the two RULES objects are equal (so the
 * history length shown is the one the screen ran). Otherwise the screen's own model is
 * loaded by dynamic import. uniform-food always runs on hungry-shapes/model.ts.
 */
import type { FoodModeId, ModelKey } from './screens.ts';

export interface OrganismView {
  readonly id: number;
  readonly parentID: number | null;
  readonly family: number;
  readonly generation: number;
  readonly age: number;
  readonly store: number;
  readonly genome: { readonly turnEvery: number; readonly turn: number; readonly branchEvery: number; readonly maxCells: number };
  readonly cells: readonly { readonly tile: number }[];
}

export interface CensusView {
  readonly tick: number;
  readonly population: number;
  readonly cells: number;
  readonly familyCounts: readonly number[];
  readonly births: number;
  readonly deaths: number;
  readonly blockedCapBirths: number;
  readonly blockedSpaceBirths: number;
  readonly [field: string]: unknown;
}

export interface EnvironmentView {
  readonly mode: string;
  readonly pulseBudget: number;
  readonly targetCount: number;
  readonly pulses: number;
  readonly offered: number;
  readonly accepted: number;
  readonly overflow: number;
  readonly bandLeft?: number;
  readonly bandWidth?: number;
  readonly bandColumns?: readonly (readonly [number, number])[];
  readonly activeBand?: 0 | 1;
  readonly bandOffered?: readonly [number, number];
  readonly bandAccepted?: readonly [number, number];
  readonly bandOverflow?: readonly [number, number];
  readonly floorPerBand?: number;
  readonly alternatingBudget?: number;
  readonly pulseAdvance?: number;
  readonly [field: string]: unknown;
}

export interface LineageView { readonly deathCause: 'starvation' | 'age' | null; readonly generation: number }

/** The surface of HungryWorld that every model copy shares. */
export interface WorldApi {
  readonly seed: number;
  readonly tick: number;
  readonly extinctionTick: number | null;
  readonly organisms: readonly OrganismView[];
  readonly food: Uint8Array;
  readonly foodTargets: readonly number[];
  readonly environment: EnvironmentView;
  readonly countersView: Readonly<Record<string, number>>;
  readonly lineage: readonly LineageView[];
  readonly ledger: Readonly<Record<string, number>>;
  census(): CensusView;
  step(count?: number): void;
  snapshot(): { readonly runtime: string; readonly [field: string]: unknown };
}

export interface ModelModule {
  readonly RULES: Readonly<Record<string, number>>;
  readonly HungryWorld: new (seed: number, mutation: boolean, mode: never) => WorldApi;
  readonly movingBandPulseTargetTile?: (pulse: number, slot: number, seed: number, tick: number) => number;
  readonly splitBandPulseTargetTile?: (pulse: number, slot: number, seed: number) => number;
  readonly alternatingBandPulseTargetTile?: (pulse: number, slot: number, seed: number) => number;
  readonly footholdBandPulseTargetTile?: (pulse: number, slot: number, seed: number) => number;
  readonly schedule769PulseTargetTile?: (pulse: number, slot: number, seed: number) => number;
  readonly stationaryBandGeometry?: () => { readonly tiles: readonly number[] };
}

export function makeWorld(mod: ModelModule, seed: number, mode: FoodModeId): WorldApi {
  return new (mod.HungryWorld as unknown as new (seed: number, mutation: boolean, mode: FoodModeId) => WorldApi)(seed, true, mode);
}

/** Literal dynamic imports, so Vite emits one named chunk per model and tests can walk them. */
const LOADERS: Readonly<Record<ModelKey, () => Promise<unknown>>> = {
  'hungry-shapes': () => import('../hungry-shapes/model.ts'),
  'uniform-endurance': () => import('../uniform-endurance/model.ts'),
  'moving-food': () => import('../moving-food/model.ts'),
  'stationary-food': () => import('../stationary-food/model.ts'),
  'split-food': () => import('../split-food/model.ts'),
  'alternating-food': () => import('../alternating-food/model.ts'),
  'food-band-foothold': () => import('../food-band-foothold/model.ts'),
  'food-schedule-769': () => import('../food-schedule-769/model.ts'),
};

export const NEWEST_MODEL: ModelKey = 'food-schedule-769';
export const ALL_MODEL_KEYS: readonly ModelKey[] = Object.keys(LOADERS) as ModelKey[];

const cache = new Map<ModelKey, Promise<ModelModule>>();
export function loadModel(key: ModelKey): Promise<ModelModule> {
  let hit = cache.get(key);
  if (!hit) { hit = LOADERS[key]().then(mod => mod as unknown as ModelModule); cache.set(key, hit); }
  return hit;
}

export interface ParityRecord {
  /** The model the screen's own explore tool imports. */
  readonly ownKey: ModelKey;
  /** Newest model reproduces the own model's census, food, organisms and environment counters at every checked tick. */
  readonly dynamics: boolean;
  /** Also identical RULES and full snapshot (ignoring only the runtime label). */
  readonly observation: boolean;
  /** RULES fields that differ between own and newest model, as "field: own/newest". */
  readonly differingRules: readonly string[];
  /** The model the page loads. Never conflated with ownKey. */
  readonly resolvedKey: ModelKey;
}

/**
 * Measured by apps/lab/test/food-bands-parity.test.ts (ticks 0, 500, 1000) and
 * food-bands-parity-full.test.ts (ticks 0, 500 and the screen's final tick). Do not edit by hand:
 * the tests recompute it and fail on any difference.
 */
export const PARITY: Readonly<Record<string, ParityRecord>> = {
  'uniform-food': { ownKey: 'hungry-shapes', dynamics: true, observation: false, differingRules: ['maxHistory: 301/451'], resolvedKey: 'hungry-shapes' },
  'uniform-endurance': { ownKey: 'uniform-endurance', dynamics: true, observation: true, differingRules: [], resolvedKey: 'food-schedule-769' },
  'moving-food': { ownKey: 'moving-food', dynamics: true, observation: true, differingRules: [], resolvedKey: 'food-schedule-769' },
  'stationary-food': { ownKey: 'stationary-food', dynamics: true, observation: true, differingRules: [], resolvedKey: 'food-schedule-769' },
  'food-band-longevity': { ownKey: 'stationary-food', dynamics: true, observation: true, differingRules: [], resolvedKey: 'food-schedule-769' },
  'split-food': { ownKey: 'split-food', dynamics: true, observation: true, differingRules: [], resolvedKey: 'food-schedule-769' },
  'alternating-food': { ownKey: 'alternating-food', dynamics: true, observation: true, differingRules: [], resolvedKey: 'food-schedule-769' },
  'food-band-foothold': { ownKey: 'food-band-foothold', dynamics: true, observation: true, differingRules: [], resolvedKey: 'food-schedule-769' },
  'food-floor-longevity': { ownKey: 'food-band-foothold', dynamics: true, observation: true, differingRules: [], resolvedKey: 'food-schedule-769' },
  'food-schedule-769': { ownKey: 'food-schedule-769', dynamics: true, observation: true, differingRules: [], resolvedKey: 'food-schedule-769' },
};

export function resolveModelKey(screenId: string, parity: Readonly<Record<string, ParityRecord>> = PARITY): ModelKey {
  if (screenId === 'uniform-food') return 'hungry-shapes';
  const record = parity[screenId];
  if (!record) throw new Error(`No parity record for screen ${screenId}`);
  return record.resolvedKey;
}

/** The rule the table follows, stated once so tests and page agree. */
export function resolveFromMeasurement(screenId: string, ownKey: ModelKey, dynamics: boolean, rulesEqual: boolean): ModelKey {
  if (screenId === 'uniform-food') return 'hungry-shapes';
  return dynamics && rulesEqual ? NEWEST_MODEL : ownKey;
}
