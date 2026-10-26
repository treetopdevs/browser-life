import { describe, expect, it } from 'vitest';
import { BOUNDARY_MODES, BOUNDARY_RULES, BoundaryWorld, componentStats, stepFields, type BoundaryAccounting, type BoundaryFields, type BoundaryMode } from '../src/boundaries/model.ts';

function fields(size: number, density = 0, nutrient = 0.8, wall = 0): BoundaryFields {
  const length = size * size;
  return { density: new Float64Array(length).fill(density), nutrient: new Float64Array(length).fill(nutrient), wall: new Float64Array(length).fill(wall) };
}
function clone(value: BoundaryFields): BoundaryFields {
  return { density: value.density.slice(), nutrient: value.nutrient.slice(), wall: value.wall.slice() };
}

const smoothRate = (b: number, n: number) => 0.20 * b * n * (1 - b) - 0.015 * b;
const thresholdRate = (b: number, n: number) => 0.70 * b * (b - 0.25) * (1 - b) * n - 0.015 * b;

describe('boundary field model', () => {
  it('starts every mode from identical seeded fields, including seed zero', () => {
    const worlds = BOUNDARY_MODES.map(mode => new BoundaryWorld(0, mode));
    for (const world of worlds.slice(1)) expect([world.density, world.nutrient, world.wall]).toEqual([worlds[0].density, worlds[0].nutrient, worlds[0].wall]);
    expect(worlds[0].density.every(value => value >= 0 && value <= 0.95)).toBe(true);
    expect(worlds[0].nutrient.every(value => value === 0.8)).toBe(true);
    expect(worlds[0].wall.every(value => value === 0)).toBe(true);
    expect(() => new BoundaryWorld(-1, 'smooth')).toThrow();
    expect(() => new BoundaryWorld(1, 'unknown' as BoundaryMode)).toThrow();
  });

  it('uses synchronous hand-calculated smooth and threshold reactions on uniform fields', () => {
    const size = 4, b = 0.4, n = 0.6;
    const input = fields(size, b, n);
    const untouched = clone(input);
    for (const mode of ['smooth', 'threshold'] as const) {
      const { fields: next } = stepFields(input, mode, size);
      const rate = mode === 'smooth' ? smoothRate(b, n) : thresholdRate(b, n);
      const x = 0, y = 0, supply = 0.01 + 0.05 * (0.5 + 0.5 * Math.sin(2 * Math.PI * x / 64) * Math.cos(2 * Math.PI * y / 64));
      expect(next.density[0]).toBeCloseTo(b + 0.25 * rate, 14);
      expect(next.nutrient[0]).toBeCloseTo(n + 0.25 * (supply * (1 - n) - 0.10 * b * n), 14);
    }
    expect(input).toEqual(untouched);
    expect(BOUNDARY_RULES.dt).toBe(0.25);
    const staleWalls = fields(size, b, n, 0.8);
    expect(stepFields(staleWalls, 'smooth', size).fields.wall.every(value => value === 0)).toBe(true);
  });

  it('applies reciprocal wall gating across a periodic seam while nutrient still diffuses', () => {
    const size = 4, input = fields(size, 0, 0);
    input.density[0] = 0.8; input.nutrient[0] = 0.8;
    input.wall[1] = 0.55; // Blocks the east edge from cell 0 to 1, regardless of edge direction.
    const { fields: next, accounting } = stepFields(input, 'walls', size);
    expect(next.density[1]).toBe(0);
    expect(next.nutrient[1]).toBeGreaterThan(0);
    expect(next.density[3]).toBeGreaterThan(0); // The reciprocal periodic seam to x=3 remains open.
    expect(Math.abs(accounting.densityDiffusionResidual)).toBeLessThan(1e-14);
    expect(Math.abs(accounting.nutrientDiffusionResidual)).toBeLessThan(1e-14);
    const seamGate = fields(size, 0, 0);
    seamGate.density[0] = 0.8; seamGate.wall[3] = 0.55;
    expect(stepFields(seamGate, 'walls', size).fields.density[3]).toBe(0); // Gate at the far endpoint also blocks the wrapped edge.
  });

  it('uses old walls for a tick and newly reinforced walls on the next tick', () => {
    const size = 4, input = fields(size, 0, 0.5);
    input.density[1] = 0.95; input.wall[1] = 0.54;
    const first = stepFields(input, 'walls', size).fields;
    expect(first.density[2]).toBeGreaterThan(0); // old wall is below the inclusive gate
    expect(first.wall[1]).toBeGreaterThan(0.54);
    const second = stepFields(first, 'walls', size).fields;
    expect(second.density[2]).toBeLessThan(first.density[2]); // raised wall now blocks the edge
  });

  it('counts periodic four-connected components and reports tiny regions and mask flips', () => {
    const size = 5, density = new Float64Array(size * size), previous = new Float64Array(size * size);
    // Four cells make one 2x2 component crossing the horizontal seam.
    for (const i of [0, 4, 5, 9]) density[i] = 0.5;
    density[12] = density[18] = 0.5;
    const stats = componentStats(density, previous, size);
    expect(stats).toEqual({ activeCellFraction: 6 / 25, components: 1, tinyComponents: 2, largestComponent: 4, maskFlipFraction: 6 / 25 });
  });

  it('accounts for density reaction and strict floor loss, and preserves step inputs', () => {
    const input = fields(1, 0.00005, 0.2), original = clone(input);
    const result = stepFields(input, 'smooth', 1);
    const expectedReaction = 0.25 * smoothRate(0.00005, 0.2);
    expect(result.fields.density[0]).toBe(0);
    expect(result.accounting.densityReaction).toBeCloseTo(expectedReaction, 16);
    expect(result.accounting.densityFloorLoss).toBeCloseTo(0.00005 + expectedReaction, 16);
    expect(result.accounting.densityAfter).toBe(0);
    expect(result.accounting.densityBefore + result.accounting.densityReaction + result.accounting.densityDiffusionResidual + result.accounting.densityClampAdjustment - result.accounting.densityFloorLoss).toBeCloseTo(0, 16);
    expect(input).toEqual(original);
    const belowFloor = fields(1, BOUNDARY_RULES.biomassFloor * 0.99, 0);
    expect(stepFields(belowFloor, 'smooth', 1).fields.density[0]).toBe(0);
  });

  it('clones getters and snapshots, replays step counts deterministically, and retains sampled intervals', () => {
    const batch = new BoundaryWorld(1201, 'both'), singles = new BoundaryWorld(1201, 'both'), replay = new BoundaryWorld(1201, 'both');
    batch.step(205); replay.step(205);
    for (let i = 0; i < 205; i++) singles.step();
    expect(batch.snapshot()).toEqual(singles.snapshot());
    expect(batch.snapshot()).toEqual(replay.snapshot());
    expect(batch.history.map(sample => sample.tick)).toEqual([0, 100, 200]);
    const density = batch.density, history = batch.history, snapshot = batch.snapshot();
    density.fill(0); history[0].densityTotal = -1; snapshot.fields.nutrient.fill(0); snapshot.accounting.residual = 999;
    expect(batch.density.some(value => value > 0)).toBe(true);
    expect(batch.history[0].densityTotal).toBeGreaterThan(0);
    expect(batch.snapshot().fields.nutrient.some(value => value > 0)).toBe(true);
    expect(batch.snapshot().accounting.residual).not.toBe(999);
    expect(batch.census().sampledChange).toMatchObject({ fromTick: 100, toTick: 200 });
    expect(() => batch.step(-1)).toThrow();
    expect(() => batch.step(1.5)).toThrow();
    expect(() => batch.step(100001)).toThrow();
  });

  it('keeps census read-only and publishes accounting with a bounded balance', () => {
    const world = new BoundaryWorld(42, 'smooth');
    const before = world.snapshot();
    world.census();
    expect(world.snapshot()).toEqual(before);
    world.step(300);
    const accounting = world.accounting;
    expect(Math.abs(accounting.residual)).toBeLessThanOrEqual(BOUNDARY_RULES.cumulativeBalanceMax);
    expect(accounting.maxAbsDensityDiffusionResidual).toBeLessThanOrEqual(BOUNDARY_RULES.diffusionResidualMax);
    expect(accounting.maxAbsNutrientDiffusionResidual).toBeLessThanOrEqual(BOUNDARY_RULES.diffusionResidualMax);
    expect(accounting.maxAbsClampAdjustment).toBeLessThanOrEqual(BOUNDARY_RULES.clampAdjustmentMax);
  });

  it.each([0, 99])('records extinction after tick %i once and freezes every field, clock, and sample afterward', (startTick) => {
    const world = new BoundaryWorld(8, 'walls');
    // Drive the unreachable-by-seed extinction branch with an internal deterministic
    // fixture; the public model intentionally exposes no mutable field setter.
    const fixture = world as unknown as {
      fieldsValue: BoundaryFields;
      tickValue: number;
      previousSampleDensity: Float64Array;
      accountingValue: BoundaryAccounting;
    };
    fixture.tickValue = startTick;
    fixture.fieldsValue = fields(64, 0, 0.8, 0);
    fixture.previousSampleDensity = new Float64Array(64 * 64);
    fixture.accountingValue = {
      initialDensity: 0, densityReaction: 0, densityDiffusionResidual: 0, nutrientDiffusionResidual: 0,
      densityClampAdjustment: 0, densityFloorLoss: 0, expectedDensity: 0, actualDensity: 0, residual: 0,
      maxAbsDensityDiffusionResidual: 0, maxAbsNutrientDiffusionResidual: 0, maxAbsClampAdjustment: 0,
    };
    world.step(10);
    expect(world.tick).toBe(startTick + 1);
    expect(world.extinctionTick).toBe(startTick + 1);
    expect(world.history.at(-1)?.tick).toBe(startTick + 1);
    expect(world.history.filter(sample => sample.tick === startTick + 1)).toHaveLength(1);
    expect(world.history.at(-1)?.sampledChange).toMatchObject({ fromTick: 0, toTick: startTick + 1, meanAbsDelta: 0, maskFlipFraction: 0 });
    const frozen = world.snapshot();
    world.step(10);
    expect(world.snapshot()).toEqual(frozen);
  });
});
