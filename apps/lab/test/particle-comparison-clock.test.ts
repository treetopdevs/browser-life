import { expect, it } from 'vitest';
import { ParticleWorld } from '../src/particles/model.ts';
import { advanceComparison } from '../src/particles/comparison-clock.ts';

it('keeps living worlds in lockstep after another world dies, without resurrecting it', () => {
  const worlds = [new ParticleWorld(1201), new ParticleWorld(1201), new ParticleWorld(1201)];
  for (const particle of worlds[0].particles) particle.age = particle.lifespan;
  const extinctionTicks: (number | null)[] = [null, null, null];
  let tick = advanceComparison(worlds, 0, extinctionTicks);
  expect(worlds.map(world => world.tick)).toEqual([1, 1, 1]);
  expect(extinctionTicks).toEqual([1, null, null]);
  const deadState = worlds[0].snapshot();
  for (let i = 0; i < 20; i++) tick = advanceComparison(worlds, tick, extinctionTicks);
  expect(tick).toBe(21);
  expect(worlds.map(world => world.tick)).toEqual([1, 21, 21]);
  expect(worlds[0].snapshot()).toEqual(deadState);
  expect(worlds[1].snapshot()).toEqual(worlds[2].snapshot());
  expect(extinctionTicks).toEqual([1, null, null]);
  for (const world of worlds) for (const particle of world.particles) particle.age = particle.lifespan;
  tick = advanceComparison(worlds, tick, extinctionTicks);
  expect(extinctionTicks).toEqual([1, 22, 22]);
  expect(advanceComparison(worlds, tick, extinctionTicks)).toBe(22);
});
