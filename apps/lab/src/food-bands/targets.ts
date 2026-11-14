/**
 * Where food is offered, drawn from each model's own geometry helpers.
 *
 * Two layers, never confused:
 *  - eligible: tiles the mode may offer food to right now (world.foodTargets);
 *  - offered: the tiles the most recent pulse actually picked, one entry per slot,
 *    derived by the mode's own slot function exactly as supplyFood does.
 *
 * Pulse index P is supplied at tick (P + 1) * foodSupplyEvery, so after tick 500 the
 * last pulse is index 99, and index 100 is supplied at tick 505.
 */
import type { ModelModule, WorldApi } from './models.ts';
import type { FoodModeId } from './screens.ts';

/** supplyFood's target stride. It is private to each model; the render test checks it against a food-byte oracle. */
const TARGET_STRIDE = 2053;

export interface PulseTargets {
  /** Index of the last pulse that ran, or -1 before the first. */
  readonly pulse: number;
  /** Tick at which that pulse was supplied, or -1. */
  readonly pulseTick: number;
  /** One tile per slot (768 entries), empty before the first pulse. */
  readonly offered: readonly number[];
}

export function lastPulse(world: WorldApi, mod: ModelModule): { pulse: number; pulseTick: number } {
  const pulses = world.environment.pulses;
  if (pulses === 0) return { pulse: -1, pulseTick: -1 };
  return { pulse: pulses - 1, pulseTick: pulses * (mod.RULES.foodSupplyEvery ?? 5) };
}

function slotTile(mod: ModelModule, world: WorldApi, mode: FoodModeId, pulse: number, slot: number, tick: number, stationaryTiles: readonly number[] | null): number {
  const seed = world.seed;
  switch (mode) {
    case 'moving-band': return required(mod.movingBandPulseTargetTile, 'movingBandPulseTargetTile')(pulse, slot, seed, tick);
    case 'split-band': return required(mod.splitBandPulseTargetTile, 'splitBandPulseTargetTile')(pulse, slot, seed);
    case 'alternating-band': return required(mod.alternatingBandPulseTargetTile, 'alternatingBandPulseTargetTile')(pulse, slot, seed);
    case 'foothold-band': return required(mod.footholdBandPulseTargetTile, 'footholdBandPulseTargetTile')(pulse, slot, seed);
    case 'schedule-769': return required(mod.schedule769PulseTargetTile, 'schedule769PulseTargetTile')(pulse, slot, seed);
    case 'stationary-band': {
      const tiles = stationaryTiles!;
      return tiles[((pulse * world.environment.pulseBudget + slot) * TARGET_STRIDE + seed % tiles.length) % tiles.length]!;
    }
    case 'uniform': {
      const count = world.environment.targetCount;
      return ((pulse * world.environment.pulseBudget + slot) * TARGET_STRIDE + seed % count) % count;
    }
  }
}

function required<T>(fn: T | undefined, name: string): T {
  if (!fn) throw new Error(`This model does not export ${name}`);
  return fn;
}

export function offeredTiles(world: WorldApi, mod: ModelModule, mode: FoodModeId): PulseTargets {
  const { pulse, pulseTick } = lastPulse(world, mod);
  if (pulse < 0) return { pulse, pulseTick, offered: [] };
  const budget = world.environment.pulseBudget;
  const stationaryTiles = mode === 'stationary-band' ? required(mod.stationaryBandGeometry, 'stationaryBandGeometry')().tiles : null;
  const offered: number[] = new Array(budget);
  for (let slot = 0; slot < budget; slot++) offered[slot] = slotTile(mod, world, mode, pulse, slot, pulseTick, stationaryTiles);
  return { pulse, pulseTick, offered };
}

/** Eligible tiles as a 0/1 map over the grid. */
export function eligibleMap(world: WorldApi, tileCount: number): Uint8Array {
  const map = new Uint8Array(tileCount);
  for (const tile of world.foodTargets) map[tile] = 1;
  return map;
}

/** How many of the offered slots landed on each tile (a tile can be picked more than once). */
export function offeredCounts(offered: readonly number[], tileCount: number): Uint8Array {
  const counts = new Uint8Array(tileCount);
  for (const tile of offered) counts[tile] = Math.min(255, counts[tile]! + 1);
  return counts;
}

/** Plain-language readout for the card, from the model's own environment fields. */
export function bandReadout(world: WorldApi, mode: FoodModeId): string {
  const env = world.environment;
  const pulse = env.pulses === 0 ? 'no pulse yet' : `pulse ${env.pulses - 1}`;
  switch (mode) {
    case 'moving-band': return `${pulse}, band columns ${env.bandLeft} to ${((env.bandLeft ?? 0) + (env.bandWidth ?? 0) - 1) % 96}${(env.bandLeft ?? 0) + (env.bandWidth ?? 0) > 96 ? ' (wraps past the east edge)' : ''}`;
    case 'stationary-band': return `${pulse}, fixed band columns 0 to ${(env.bandWidth ?? 48) - 1}`;
    case 'split-band': return `${pulse}, fixed bands at columns ${env.bandColumns?.map(c => `${c[0]} to ${c[1]}`).join(' and ')}`;
    case 'alternating-band': return env.pulses === 0 ? 'no pulse yet, favoured band 0 (left) is next' : `${pulse}, favoured band ${env.activeBand} (${env.activeBand === 0 ? 'left' : 'right'})`;
    case 'foothold-band':
    case 'schedule-769': return env.pulses === 0 ? 'no pulse yet, favoured band 0 (left) is next' : `${pulse}, floor in both bands, favoured band ${env.activeBand} (${env.activeBand === 0 ? 'left' : 'right'})`;
    case 'uniform': return `${pulse}, food offered anywhere on the map`;
  }
}
