import { describe, expect, it } from 'vitest';
import { BondedWorld, BOND_RULES } from '../src/particles/bonded-model.ts';
import { ParticleWorld, RULES, type Particle } from '../src/particles/model.ts';

function arrange(world: BondedWorld, points: [number, number, number?][]): Particle[] {
  const selected = world.particles.slice(0, points.length);
  world.base.particles = selected;
  for (let i = 0; i < selected.length; i++) {
    const p = selected[i];
    p.family = points[i][2] === undefined ? 0 : points[i][2]! as Particle['family'];
    p.x = points[i][0]; p.y = points[i][1]; p.vx = p.vy = 0; p.energy = 2; p.age = 0;
  }
  for (const patch of world.food) { patch.x = .01; patch.y = .01; patch.amount = 0; }
  world.base.ledger.initial = selected.reduce((sum, p) => sum + p.energy, 0);
  return selected;
}

function degrees(world: BondedWorld): Map<number, number> {
  const result = new Map<number, number>();
  for (const p of world.particles) result.set(p.id, 0);
  for (const edge of world.bonds) { result.set(edge.a, (result.get(edge.a) ?? 0) + 1); result.set(edge.b, (result.get(edge.b) ?? 0) + 1); }
  return result;
}

describe('bonded particle extension', () => {
  it('keeps none mode byte-for-byte equivalent to the base world with zero extension writes', () => {
    const bonded = new BondedWorld(1201, 'pursuit', true, 'none');
    const direct = new ParticleWorld(1201, 'pursuit', true);
    for (let i = 0; i < 20; i++) {
      bonded.step(i % 2 ? 1 : 3); direct.step(i % 2 ? 1 : 3);
      expect(bonded.snapshot().base).toEqual(direct.snapshot());
      expect(bonded.bonds).toEqual([]);
      expect(bonded.graphSummary()).toMatchObject({ formations: 0, stretchBreaks: 0, deathRemovals: 0, netImpulseMagnitude: 0 });
    }
    expect(bonded.snapshot().extension.mode).toBe('none');
  });

  it('makes step(n) equal n individual steps and seeded replay deterministic', () => {
    const batch = new BondedWorld(1202, 'pursuit', false, 'mesh');
    const singles = new BondedWorld(1202, 'pursuit', false, 'mesh');
    const replay = new BondedWorld(1202, 'pursuit', false, 'mesh');
    batch.step(80); replay.step(80);
    for (let i = 0; i < 80; i++) singles.step();
    expect(batch.snapshot()).toEqual(singles.snapshot());
    expect(batch.snapshot()).toEqual(replay.snapshot());
    expect(() => batch.step(-1)).toThrow();
    expect(() => batch.step(1.5)).toThrow();
  });

  it('forms nearest-first same-family links with canonical IDs and per-particle degree caps', () => {
    for (const [mode, cap] of [['chains', 2], ['mesh', 4]] as const) {
      const world = new BondedWorld(3, 'pursuit', false, mode);
      const ps = arrange(world, [[.4, .5], [.42, .5], [.44, .5], [.46, .5], [.48, .5], [.5, .5]]);
      ps[5].family = 1;
      world.step();
      const edges = world.bonds;
      expect(edges.every(edge => edge.a < edge.b && edge.bornTick === 1)).toBe(true);
      expect(new Set(edges.map(edge => `${edge.a}:${edge.b}`)).size).toBe(edges.length);
      expect(edges.every(edge => ps.find(p => p.id === edge.a)!.family === ps.find(p => p.id === edge.b)!.family)).toBe(true);
      expect([...degrees(world).values()].every(value => value <= cap)).toBe(true);
      expect(world.graphSummary().edgeCount).toBe(edges.length);
      expect(world.graphSummary().formations).toBe(edges.length);
      expect(edges).toEqual([...edges].sort((a, b) => a.a - b.a || a.b - b.b));
    }
  });

  it('takes the known nearest-first edge list from an asymmetric dyadic fixture', () => {
    const world = new BondedWorld(4, 'pursuit', false, 'chains');
    const ps = arrange(world, [[.25, .5], [.25 + 1 / 64, .5], [.25 + 3 / 64, .5], [.25 + 7 / 64, .5]]);
    world.step();
    expect(world.bonds.map(edge => [edge.a, edge.b])).toEqual([
      [ps[0].id, ps[1].id], [ps[0].id, ps[2].id], [ps[1].id, ps[2].id],
    ]);
  });

  it('breaks exact equal-distance ties by stable IDs for chains and mesh', () => {
    const chains = new BondedWorld(5, 'pursuit', false, 'chains');
    const chainParticles = arrange(chains, Array.from({ length: 5 }, (_, i) => [.25 + i / 64, .5] as [number, number]));
    chains.step();
    expect(chains.bonds.map(edge => [edge.a, edge.b])).toEqual([
      [chainParticles[0].id, chainParticles[1].id],
      [chainParticles[1].id, chainParticles[2].id],
      [chainParticles[2].id, chainParticles[3].id],
      [chainParticles[3].id, chainParticles[4].id],
    ]);

    const mesh = new BondedWorld(5, 'pursuit', false, 'mesh');
    const meshParticles = arrange(mesh, Array.from({ length: 5 }, (_, i) => [.25 + i / 64, .5] as [number, number]));
    mesh.step();
    expect(mesh.bonds.map(edge => [edge.a, edge.b])).toEqual([
      [meshParticles[0].id, meshParticles[1].id], [meshParticles[0].id, meshParticles[2].id],
      [meshParticles[0].id, meshParticles[3].id], [meshParticles[1].id, meshParticles[2].id],
      [meshParticles[1].id, meshParticles[3].id], [meshParticles[1].id, meshParticles[4].id],
      [meshParticles[2].id, meshParticles[3].id], [meshParticles[2].id, meshParticles[4].id],
      [meshParticles[3].id, meshParticles[4].id],
    ]);
    expect(mesh.bonds.some(edge => edge.a === meshParticles[0].id && edge.b === meshParticles[4].id)).toBe(false);
  });

  it('allows eligible pairs whose endpoints already have a bond and greedily respects degree', () => {
    const world = new BondedWorld(9, 'flocks', false, 'chains');
    arrange(world, [[.3, .5], [.35, .5], [.4, .5], [.45, .5]]);
    world.step();
    const connected = new Set(world.bonds.flatMap(edge => [edge.a, edge.b]));
    expect(connected.size).toBe(4);
    expect(world.bonds).toHaveLength(3);
    expect([...degrees(world).values()].every(value => value <= BOND_RULES.chainsDegreeMax)).toBe(true);
  });

  it('forms across torus seams and applies equal-and-opposite canonical spring impulses', () => {
    const world = new BondedWorld(13, 'pursuit', false, 'chains');
    const ps = arrange(world, [[.99, .5], [.03, .5, 1]]);
    const observed: number[][] = [];
    world.base.step = (() => { observed.push(ps.map(p => p.vx)); world.base.tick++; }) as ParticleWorld['step'];
    world.step();
    expect(world.bonds).toHaveLength(0); // Cross-family pairs are ineligible.
    ps[1].family = ps[0].family;
    ps[0].x = .99; ps[1].x = .03;
    world.step();
    expect(world.bonds).toHaveLength(1);
    // At d=.04, the spring compresses by .005. Base.step is intercepted so the exact
    // pre-step velocity deltas expose the seam direction and equal/opposite impulse.
    const impulse = BOND_RULES.stiffness * (.04 - BOND_RULES.restLength);
    expect(observed[1][0]).toBeCloseTo(impulse, 12);
    expect(observed[1][1]).toBeCloseTo(-impulse, 12);
    expect(world.graphSummary().netImpulseMagnitude).toBeCloseTo(Math.abs(impulse) * 2, 12);
  });

  it('breaks only beyond the strict stretch boundary and records completed lifetime and stage', () => {
    const world = new BondedWorld(14, 'flocks', false, 'chains');
    const ps = arrange(world, [[.4, .5], [.44, .5]]);
    world.step();
    expect(world.bonds).toHaveLength(1);
    const born = world.bonds[0].bornTick;
    ps[1].x = .53; // distance .13, beyond .12
    world.step();
    expect(world.bonds).toHaveLength(0);
    expect(world.graphSummary().stretchBreaks).toBe(1);
    expect(world.removalEvents).toEqual([expect.objectContaining({ a: ps[0].id, b: ps[1].id, bornTick: born, removedAtTick: 2, cause: 'stretchBreak', stage: 'beforeStep', completedTicks: 1 })]);
    const event = world.removalEvents[0];
    expect(Object.isFrozen(event)).toBe(true);
  });

  it('removes dead endpoints after base.step and summarizes lifetime by cause', () => {
    const world = new BondedWorld(15, 'flocks', false, 'chains');
    const ps = arrange(world, [[.4, .5], [.44, .5]]);
    ps[0].energy = .001;
    world.base.ledger.initial = ps.reduce((sum, p) => sum + p.energy, 0);
    world.step();
    expect(world.particles.some(p => p.id === ps[0].id)).toBe(false);
    expect(world.bonds).toHaveLength(0);
    expect(world.graphSummary().deathRemovals).toBe(1);
    expect(world.removalEvents[0]).toMatchObject({ cause: 'deathRemoval', stage: 'afterDeath', removedAtTick: 1, completedTicks: 1 });
    expect(world.graphSummary().lifetimes.deathRemoval).toMatchObject({ count: 1, meanCompletedTicks: 1, medianCompletedTicks: 1 });
  });

  it('handles empty graphs, isolates, connected components and bounded base-ledger residuals', () => {
    const world = new BondedWorld(16, 'pursuit', false, 'mesh');
    arrange(world, [[.2, .2], [.8, .8], [.5, .5]]);
    const initial = world.graphSummary();
    expect(initial.isolatedParticles).toBe(3);
    world.base.particles = world.particles.slice(0, 3);
    world.base.ledger.initial = world.base.particles.reduce((sum, p) => sum + p.energy, 0);
    world.step();
    const summary = world.graphSummary();
    expect(summary.nodes).toBe(3);
    expect(summary.isolatedFraction).toBe(1);
    expect(summary.meanDegree).toBe(0);
    expect(summary.linkedComponents).toBe(0);
    expect(summary.largestComponent).toBe(0);
    expect(Math.abs(summary.ledgerResidual)).toBeLessThan(1e-9);
    world.base.particles = [];
    const empty = world.graphSummary();
    expect(empty.isolatedFraction).toBeNull();
    expect(empty.meanDegree).toBeNull();
    expect(empty.liveEdgeAgeMedian).toBeNull();
    const tick = world.tick; world.step(10); expect(world.tick).toBe(tick);
  });

  it('keeps live edge endpoints, family, degree caps and accounting valid in chains and mesh', () => {
    for (const [mode, cap] of [['chains', BOND_RULES.chainsDegreeMax], ['mesh', BOND_RULES.meshDegreeMax]] as const) {
      const a = new BondedWorld(1203, 'pursuit', true, mode);
      const b = new BondedWorld(1203, 'pursuit', true, mode);
      for (let tick = 0; tick < 200; tick++) {
        a.step(); b.step();
        const summary = a.graphSummary(), particles = new Map(a.particles.map(p => [p.id, p]));
        const degreesNow = degrees(a), seen = new Set<string>();
        expect(a.bonds.length).toBeLessThanOrEqual(RULES.populationMax * cap / 2);
        expect(summary.ledgerResidual).toBeLessThan(1e-6);
        expect(summary.ledgerResidual).toBeGreaterThan(-1e-6);
        expect(Number.isFinite(summary.netImpulseMagnitude)).toBe(true);
        for (const edge of a.bonds) {
          expect(edge.a).not.toBe(edge.b);
          expect(edge.a).toBeLessThan(edge.b);
          expect(Number.isSafeInteger(edge.bornTick) && edge.bornTick <= a.tick).toBe(true);
          expect(particles.has(edge.a) && particles.has(edge.b)).toBe(true);
          expect(particles.get(edge.a)!.family).toBe(particles.get(edge.b)!.family);
          const key = `${edge.a}:${edge.b}`;
          expect(seen.has(key)).toBe(false); seen.add(key);
        }
        expect([...degreesNow.values()].every(value => value <= cap)).toBe(true);
        expect(a.particles.every(p => Number.isFinite(p.x + p.y + p.vx + p.vy + p.energy) && p.x >= 0 && p.x < 1 && p.y >= 0 && p.y < 1 && Math.hypot(p.vx, p.vy) <= RULES.speedMax + 1e-12)).toBe(true);
        expect(a.snapshot()).toEqual(b.snapshot());
      }
    }
  });
});
