import { describe, expect, it } from 'vitest';
import {
  GENOME_PRESETS,
  HungryWorld,
  RULES,
  SPLIT_BAND_TARGET_COUNT,
  splitBandGeometry,
  splitBandPulseTargetTile,
  isSplitBandTile,
} from '../../apps/lab/src/split-food/model.ts';

describe('split-food band geometry and inventory', () => {
  it('builds the exact sorted, unique 4,608-tile geometry', () => {
    const geometry = splitBandGeometry();
    expect(geometry.columns).toEqual([[0, 23], [48, 71]]);
    expect(geometry.width).toBe(24);
    expect(geometry.tiles).toHaveLength(SPLIT_BAND_TARGET_COUNT);
    expect(new Set(geometry.tiles).size).toBe(4_608);
    expect(geometry.tiles).toEqual([...geometry.tiles].sort((a, b) => a - b));
    for (let tile = 0; tile < RULES.tileCount; tile++) {
      const column = tile % RULES.width;
      const expected = column <= 23 || (column >= 48 && column <= 71);
      expect(isSplitBandTile(tile)).toBe(expected);
      expect(geometry.tiles.includes(tile)).toBe(expected);
    }
    expect(geometry.tiles.every((tile) => {
      const column = tile % RULES.width;
      return column <= 23 || (column >= 48 && column <= 71);
    })).toBe(true);
  });

  it('schedules 768 distinct offers with 384 in each band across seeds and pulses', () => {
    for (const seed of [1201, 1202, 1203, 1204]) {
      for (const pulse of [0, 1, 2, 7, 31, 127]) {
        const tiles = Array.from({ length: 768 }, (_, slot) => splitBandPulseTargetTile(pulse, slot, seed));
        expect(new Set(tiles).size, `distinct seed=${seed} pulse=${pulse}`).toBe(768);
        expect(tiles.every(isSplitBandTile), `all targets are in-band seed=${seed} pulse=${pulse}`).toBe(true);
        const byBand = tiles.reduce(([first, second], tile) => {
          const column = tile % RULES.width;
          if (column <= 23) first++;
          else if (column >= 48 && column <= 71) second++;
          else throw new Error(`target ${tile} falls in an unsupplied gap`);
          return [first, second];
        }, [0, 0]);
        expect(byBand, `offers per band seed=${seed} pulse=${pulse}`).toEqual([384, 384]);
        expect(tiles).toEqual(Array.from({ length: 768 }, (_, slot) => splitBandPulseTargetTile(pulse, slot, seed)));
      }
    }
  });

  it('keeps the initialized founder state unchanged from the stationary model', () => {
    const contiguous = new HungryWorld(1202, true, 'stationary-band');
    const split = new HungryWorld(1202, true, 'split-band');
    expect(split.snapshot()).toEqual(contiguous.snapshot());
    expect(split.organisms).toEqual(contiguous.organisms);
    expect(split.lineage).toEqual(contiguous.lineage);
    expect(split.food).toEqual(contiguous.food);
    expect(split.environment).toMatchObject({
      mode: 'split-band', targetCount: 4_608, bandColumns: [[0, 23], [48, 71]], bandWidth: 24,
      pulseBudget: 768, pulses: 0, offered: 0, accepted: 0, overflow: 0,
    });
    expect(contiguous.environment).toMatchObject({ mode: 'stationary-band', bandLeft: 0, bandWidth: 48 });
  });

  it('does not mutate world state while calculating a deterministic pulse schedule', () => {
    const world = new HungryWorld(1203, true, 'split-band');
    const before = world.snapshot();
    const firstSchedule = Array.from({ length: 768 }, (_, slot) => splitBandPulseTargetTile(9, slot, 1203));
    for (let pulse = 0; pulse < 12; pulse++) {
      for (let slot = 0; slot < 768; slot++) splitBandPulseTargetTile(pulse, slot, 1202);
    }
    expect(world.snapshot()).toEqual(before);
    expect(Array.from({ length: 768 }, (_, slot) => splitBandPulseTargetTile(9, slot, 1203))).toEqual(firstSchedule);
  });

  it('accounts for synthetic accepted and overflow offers while preserving the energy ledger', () => {
    const seed = 1202;
    const pulseTiles = Array.from({ length: 768 }, (_, slot) => splitBandPulseTargetTile(0, slot, seed));
    const food = new Uint8Array(RULES.tileCount);
    pulseTiles.forEach((tile, slot) => { food[tile] = slot < 256 ? RULES.maxFood : RULES.maxFood - 1; });
    const world = HungryWorld.createFixture({
      seed,
      mutation: false,
      food,
      founders: [{ tile: 24, heading: 0, genome: GENOME_PRESETS[0], age: 0, store: 100 }],
    }, 'split-band');

    world.step(RULES.foodSupplyEvery);

    expect(world.environment).toMatchObject({
      mode: 'split-band', pulses: 1, offered: 768, accepted: 512, overflow: 256,
    });
    expect(world.ledger.supplied).toBe(512);
    expect(world.ledger.residual).toBe(0);
    expect(world.census().ledgerResidual).toBe(0);
  });
});
