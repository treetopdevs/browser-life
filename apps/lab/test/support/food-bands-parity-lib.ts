import { createHash } from 'node:crypto';
import { SCREENS, screenSeeds, type ScreenSpec } from '../../src/food-bands/screens.ts';
import { loadModel, makeWorld, NEWEST_MODEL, resolveFromMeasurement, type ModelModule, type ParityRecord, type WorldApi } from '../../src/food-bands/models.ts';

const sha = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export interface StateDigest {
  readonly tick: number;
  readonly census: string;
  readonly food: string;
  readonly cells: string;
  readonly counters: string;
}

/** What "the same behaviour" means: census, food bytes, bodies (tile, id, family, energy, age, genome) and environment counters. */
export function stateDigest(world: WorldApi): StateDigest {
  const env = world.environment;
  const bodies = world.organisms.map(o => [o.id, o.parentID, o.family, o.generation, o.age, o.store, o.genome, o.cells.map(c => c.tile).sort((a, b) => a - b)]);
  return {
    tick: world.tick,
    census: sha(world.census()),
    food: createHash('sha256').update(world.food).digest('hex'),
    cells: sha(bodies),
    counters: sha([env.pulses, env.offered, env.accepted, env.overflow, env.pulseBudget, env.targetCount, world.extinctionTick]),
  };
}

export function sameDynamics(a: StateDigest, b: StateDigest): boolean {
  return a.tick === b.tick && a.census === b.census && a.food === b.food && a.cells === b.cells && a.counters === b.counters;
}

/** Full snapshot with the host runtime label fixed, so Node and browser compare. */
export function normalisedSnapshotHash(world: WorldApi): string {
  const snapshot = { ...world.snapshot(), runtime: 'normalised' };
  return sha({ snapshot, environment: world.environment });
}

export interface ParityCase { screen: string; mode: string; seed: number; tick: number; dynamics: boolean; observation: boolean }

export function parityTicks(screen: ScreenSpec, mode: 'short' | 'full'): number[] {
  return mode === 'short' ? [0, 500, 1000] : [0, 500, screen.horizon];
}

/** Compare the newest model with the screen's own model for every mode and seed, at the given ticks. */
export async function measureScreen(screen: ScreenSpec, ticks: readonly number[], limit?: { seeds?: number }): Promise<{ cases: ParityCase[]; record: ParityRecord }> {
  const own = await loadModel(screen.ownModel);
  const newest = await loadModel(NEWEST_MODEL);
  const rulesDiffs = differingRules(own, newest);
  const cases: ParityCase[] = [];
  const seeds = screenSeeds(screen).slice(0, limit?.seeds ?? 99);
  for (const arm of screen.arms) {
    for (const seed of seeds) {
      const a = makeWorld(own, seed, arm.mode);
      const b = makeWorld(newest, seed, arm.mode);
      for (const tick of ticks) {
        if (tick > a.tick) { a.step(tick - a.tick); b.step(tick - b.tick); }
        const dynamics = sameDynamics(stateDigest(a), stateDigest(b));
        const observation = dynamics && rulesDiffs.length === 0 && normalisedSnapshotHash(a) === normalisedSnapshotHash(b);
        cases.push({ screen: screen.id, mode: arm.mode, seed, tick, dynamics, observation });
      }
    }
  }
  const dynamics = cases.every(c => c.dynamics);
  const observation = cases.every(c => c.observation);
  return { cases, record: { ownKey: screen.ownModel, dynamics, observation, differingRules: rulesDiffs, resolvedKey: resolveFromMeasurement(screen.id, screen.ownModel, dynamics, rulesDiffs.length === 0) } };
}

export function differingRules(own: ModelModule, newest: ModelModule): string[] {
  const keys = [...new Set([...Object.keys(own.RULES), ...Object.keys(newest.RULES)])].sort();
  return keys.filter(k => own.RULES[k] !== newest.RULES[k]).map(k => `${k}: ${own.RULES[k]}/${newest.RULES[k]}`);
}

export const ALL_SCREENS = SCREENS;
