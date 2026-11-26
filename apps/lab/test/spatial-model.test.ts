import { describe, expect, it } from 'vitest';
import { RULES, SpatialWorld, type Particle } from '../src/spatial/model';

const particle = (overrides: Partial<Particle> = {}): Particle => ({
  id: 0, family: 0, x: .5, y: .5, z: .5, vx: 0, vy: 0, vz: 0,
  energy: 4, age: 0, lifespan: 1200, generation: 0, traits: [.75, .15, .15], ...overrides,
});
function isolated(world: SpatialWorld, ...particles: Particle[]): void {
  world.particles = particles;
  // All eight centers are at least sqrt(3)*.25 from the fixture at the cube center.
  for (const patch of world.food) patch.amount = 0;
  world.ledger.initial = world.particles.reduce((sum, p) => sum + p.energy, 0) + world.food.reduce((sum, f) => sum + f.amount, 0);
}
function residual(world: SpatialWorld): number {
  return world.ledger.initial + world.ledger.renewed - world.ledger.dissipated - world.ledger.deathLoss
    - world.particles.reduce((sum, p) => sum + p.energy, 0) - world.food.reduce((sum, f) => sum + f.amount, 0);
}

describe('spatial particle world', () => {
  it('uses genuine z-only torus neighbors and three-dimensional feeding distance', () => {
    const alone = new SpatialWorld(10), paired = new SpatialWorld(10);
    isolated(alone, particle({ z: .98 }));
    isolated(paired, particle({ z: .98 }), particle({ id: 1, family: 1, z: .03, traits: [.15,.75,.15] }));
    alone.step(); paired.step();
    expect(Math.abs(paired.particles[0].vz)).toBeGreaterThan(Math.abs(alone.particles[0].vz) + 1e-5);
    expect(paired.particles[0].vx).toBeCloseTo(alone.particles[0].vx, 14);
    expect(paired.particles[0].vy).toBeCloseTo(alone.particles[0].vy, 14);

    const outside = new SpatialWorld(11), inside = new SpatialWorld(11);
    isolated(outside, particle({ x: .25, y: .25, z: .1 }));
    isolated(inside, particle({ x: .25, y: .25, z: .25 }));
    for (const world of [outside, inside]) {
      world.food.splice(0, world.food.length, { x: .25, y: .25, z: .5, radius: .3, amount: 10 });
    }
    for (const world of [outside, inside]) world.ledger.initial = world.particles.reduce((sum, p) => sum + p.energy, 0) + world.food.reduce((sum, f) => sum + f.amount, 0);
    outside.step(); inside.step();
    expect(outside.ledger.consumed).toBe(0);
    expect(inside.ledger.consumed).toBeCloseTo(RULES.uptake, 14);

    const seamFed = new SpatialWorld(11);
    isolated(seamFed, particle({ x: .25, y: .25, z: .98 }));
    seamFed.food.splice(0, seamFed.food.length, { x: .25, y: .25, z: .02, radius: .1, amount: 10 });
    seamFed.ledger.initial = seamFed.particles[0].energy + seamFed.food[0].amount;
    seamFed.step();
    expect(seamFed.ledger.consumed).toBeCloseTo(RULES.uptake, 14);
  });

  it('defers newborns, splits energy, preserves the population cap and freezes extinction', () => {
    const growing = new SpatialWorld(12, 'colonies', false);
    isolated(growing, particle({ energy: 8.2 }));
    growing.step();
    expect(growing.births).toBe(1);
    expect(growing.particles).toHaveLength(2);
    const child = growing.particles.find(p => p.generation === 1)!;
    expect(child.age).toBe(0);
    expect(child.vx).toBe(-growing.particles[0].vx);
    expect(child.vy).toBe(-growing.particles[0].vy);
    expect(child.vz).toBe(-growing.particles[0].vz);
    expect(growing.mutations).toBe(0);
    expect(Math.abs(residual(growing))).toBeLessThan(1e-10);

    const capped = new SpatialWorld(13);
    isolated(capped, ...Array.from({ length: RULES.populationMax }, (_, id) => particle({ id, energy: 8.2 })));
    capped.step();
    expect(capped.particles).toHaveLength(RULES.populationMax);
    expect(capped.births).toBe(0);
    expect(capped.blockedBirths).toBe(RULES.populationMax);
    expect(Math.abs(residual(capped))).toBeLessThan(1e-9);

    const lifespanDeath = new SpatialWorld(14);
    isolated(lifespanDeath, particle({ energy: 4, age: 0, lifespan: 1 }));
    lifespanDeath.step();
    expect(lifespanDeath.deaths).toBe(1);
    expect(lifespanDeath.ledger.deathLoss).toBeGreaterThan(0);
    expect(Math.abs(residual(lifespanDeath))).toBeLessThan(1e-10);

    const extinct = new SpatialWorld(14);
    isolated(extinct, particle({ energy: .001 }));
    extinct.step();
    expect(extinct.particles).toHaveLength(0);
    expect(extinct.history.at(-1)?.tick).toBe(1);
    const stopped = extinct.snapshot();
    extinct.step(50);
    expect(extinct.tick).toBe(1);
    expect(extinct.snapshot()).toEqual(stopped);
  });

  it('replays across chunk sizes with ledger and 5x5x5 census, and mutation-off stays off', () => {
    const whole = new SpatialWorld(1201, 'pursuit', false), chunks = new SpatialWorld(1201, 'pursuit', false);
    whole.step(1000); chunks.step(137); chunks.step(863);
    expect(chunks.snapshot()).toEqual(whole.snapshot());
    expect(whole.history[0]).toMatchObject({ occupiedBins: expect.any(Number), occupiedZBands: expect.any(Number), meanAbsVz: expect.any(Number) });
    expect(whole.history.at(-1)?.tick).toBe(1000);
    expect(whole.births).toBeGreaterThan(0);
    expect(whole.mutations).toBe(0);
    expect(whole.snapshot().settings).toMatchObject({ seed: 1201, preset: 'pursuit', mutation: false, recipe: { alignment: 0 } });
    expect(Math.abs(residual(whole))).toBeLessThan(1e-7);
    expect(whole.food).toHaveLength(8);

    const mutating = new SpatialWorld(1201, 'pursuit', true), mutatingChunks = new SpatialWorld(1201, 'pursuit', true);
    mutating.step(1000); mutatingChunks.step(251); mutatingChunks.step(749);
    expect(mutating.births).toBeGreaterThan(0);
    expect(mutating.mutations).toBeGreaterThan(0);
    expect(mutatingChunks.snapshot()).toEqual(mutating.snapshot());
    expect(Math.abs(residual(mutating))).toBeLessThan(1e-7);
  });

  it('caps velocity by the full 3D Euclidean norm and keeps every coordinate bounded', () => {
    const world = new SpatialWorld(15);
    isolated(world, particle({ vx: .008, vy: .008, vz: .008 }));
    world.step();
    const p = world.particles[0];
    expect(Math.sqrt(p.vx*p.vx+p.vy*p.vy+p.vz*p.vz)).toBeCloseTo(RULES.speedMax, 14);
    expect(Math.abs(p.vx)).toBeGreaterThan(0);
    expect(Math.abs(p.vy)).toBeGreaterThan(0);
    expect(Math.abs(p.vz)).toBeGreaterThan(0);
    expect([p.x,p.y,p.z].every(n => n >= 0 && n < 1)).toBe(true);
  });
});
