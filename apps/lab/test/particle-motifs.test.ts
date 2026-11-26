import { describe, expect, it } from 'vitest';
import { compileMotif, GRAMMAR_VERSION, motifCatalog, MotifWorld, type MotifSentence } from '../src/particles/motifs.ts';
import { buildOccupancyHistogram, occupiedSpatialBins, totalVariationDistance, type OccupancyHistogram } from '../src/particles/motif-observers.ts';
import { ParticleWorld, PRESETS, RULES } from '../src/particles/model.ts';

const sentence = (interaction: MotifSentence['interaction'] = 'chase', coordination: MotifSentence['coordination'] = 'independent', habitat: MotifSentence['habitat'] = 'still'): MotifSentence => ({ interaction, coordination, habitat });

describe('motif grammar and world wrapper', () => {
  it('compiles the strict twelve-sentence catalogue in canonical order', () => {
    const catalog = motifCatalog();
    expect(catalog).toHaveLength(12);
    expect(catalog.map(motif => motif.id)).toEqual([
      'chase-independent-still', 'chase-independent-travelling', 'chase-independent-seasonal',
      'chase-aligned-still', 'chase-aligned-travelling', 'chase-aligned-seasonal',
      'gather-independent-still', 'gather-independent-travelling', 'gather-independent-seasonal',
      'gather-aligned-still', 'gather-aligned-travelling', 'gather-aligned-seasonal',
    ]);
    expect(new Set(catalog.map(motif => motif.id)).size).toBe(12);
    expect(Object.isFrozen(catalog)).toBe(true);
    for (const motif of catalog) {
      expect(motif.version).toBe(GRAMMAR_VERSION);
      expect(motif.recipe.alignment).toBe(motif.sentence.coordination === 'aligned' ? .12 : 0);
      expect(motif.recipe.foodRenewal).toBe(RULES.foodRenewal);
      expect(motif.environment).toEqual(motif.sentence.habitat === 'still' ? { kind: 'still' } : motif.sentence.habitat === 'travelling' ? { kind: 'travelling', speed: .00025 } : { kind: 'seasonal', period: 600 });
      expect(motif.explanation).toContain('chase does not mean predation');
    }
    expect(catalog[0].recipe.rows).toEqual(PRESETS.find(preset => preset.id === 'pursuit')!.rows);
    expect(catalog[9].recipe.rows).toEqual(PRESETS.find(preset => preset.id === 'flocks')!.rows);
  });

  it('rejects non-exact grammar objects and unsupported versions', () => {
    expect(() => compileMotif({ ...sentence(), surprise: true })).toThrow(/exactly/);
    expect(() => compileMotif({ interaction: 'chase', habitat: 'still' })).toThrow(/exactly/);
    expect(() => compileMotif({ ...sentence(), interaction: 'colonies' })).toThrow(/interaction/);
    expect(() => compileMotif(sentence(), 2)).toThrow(/Unsupported/);
    expect(() => compileMotif(Object.assign(Object.create({ inherited: true }), sentence()))).toThrow(/plain object/);
    expect(() => compileMotif(Object.assign(Object.create(null), sentence()))).toThrow(/plain object/);
    const symbolKey = { ...sentence(), [Symbol('extra')]: true };
    expect(() => compileMotif(symbolKey)).toThrow(/exactly/);
    const getter = { interaction: 'chase', coordination: 'independent', get habitat() { return 'still'; } };
    expect(() => compileMotif(getter)).toThrow(/data property/);
    const hidden = Object.defineProperty(sentence(), 'habitat', { enumerable: false, value: 'still' });
    expect(() => compileMotif(hidden)).toThrow(/data property/);
  });

  it('keeps frozen copied grammar and recipe values independent from caller objects', () => {
    const input = sentence();
    const compiled = compileMotif(input);
    input.interaction = 'gather';
    expect(compiled.sentence.interaction).toBe('chase');
    expect(Object.isFrozen(compiled)).toBe(true);
    expect(Object.isFrozen(compiled.sentence)).toBe(true);
    expect(Object.isFrozen(compiled.recipe)).toBe(true);
    expect(Object.isFrozen(compiled.recipe.rows)).toBe(true);
    expect(Object.isFrozen(compiled.recipe.rows[0])).toBe(true);
    expect(Object.isFrozen(compiled.environment)).toBe(true);
    const world = new MotifWorld(0, compiled);
    expect(world.base.recipe).toEqual(compiled.recipe);
    expect(() => new MotifWorld(-1, compiled)).toThrow(/Seed/);
  });

  it('preserves the existing pursuit and flocks controls through 3000 ticks', () => {
    const controls = [
      [sentence('chase'), 'pursuit'],
      [sentence('gather', 'aligned'), 'flocks'],
    ] as const;
    for (const [motifSentence, preset] of controls) {
      const composed = new MotifWorld(1201, motifSentence);
      const direct = new ParticleWorld(1201, preset, true);
      for (let tick = 0; tick < 3000; tick += 100) {
        composed.step(100);
        direct.step(100);
        expect(composed.base.snapshot()).toEqual(direct.snapshot());
      }
    }
  });

  it('samples at zero and every 100 ticks for batched and individual stepping', () => {
    const batched = new MotifWorld(1202, sentence());
    const singles = new MotifWorld(1202, sentence());
    batched.step(205);
    for (let i = 0; i < 205; i++) singles.step();
    expect(batched.tick).toBe(205);
    expect(batched.sampledObservations.map(sample => sample.tick)).toEqual([0, 100, 200]);
    expect(batched.sampledObservations).toEqual(singles.sampledObservations);
    expect(batched.sampledObservations[0].textureChange).toBeNull();
    expect(batched.sampledObservations[1].textureChange).toBeGreaterThanOrEqual(0);
    expect(batched.sampledObservations[1].textureChange).toBeLessThanOrEqual(1);
    expect(() => batched.step(-1)).toThrow();
    expect(() => batched.step(1.5)).toThrow();
  });

  it('returns copied observations and sample history without granting mutation ownership', () => {
    const world = new MotifWorld(1203, sentence());
    const samples = world.sampledObservations;
    expect(Object.isFrozen(samples)).toBe(true);
    expect(Object.isFrozen(samples[0].histogram.counts)).toBe(true);
    const snapshot = world.observation();
    (snapshot.base.particles[0] as { x: number }).x = .5;
    expect(world.base.particles[0].x).not.toBe(.5);
    expect(world.sampledObservations[0].histogram.counts).toEqual(samples[0].histogram.counts);
  });

  it('does not let census, histogram, or observation reads perturb the seeded trajectory', () => {
    const observed = new MotifWorld(1201, sentence('gather', 'aligned', 'travelling'));
    const plain = new MotifWorld(1201, sentence('gather', 'aligned', 'travelling'));
    for (let i = 0; i < 200; i++) {
      observed.step();
      plain.step();
      observed.base.census();
      buildOccupancyHistogram(observed.base.particles);
      observed.observation();
      expect(observed.base.snapshot()).toEqual(plain.base.snapshot());
    }
  });

  it('records exact extinction once and holds the dead world at that tick', () => {
    const world = new MotifWorld(2, sentence());
    for (const particle of world.base.particles) { particle.energy = .001; particle.age = particle.lifespan - 1; }
    for (const patch of world.base.food) patch.amount = 0;
    world.step(20);
    expect(world.extinctionTick).toBe(1);
    expect(world.tick).toBe(1);
    expect(world.sampledObservations.map(sample => sample.tick)).toEqual([0, 1]);
    expect(world.sampledObservations[1].census.population).toBe(0);
    expect(world.sampledObservations[1].textureChange).toBe(1);
    world.step(100);
    expect(world.tick).toBe(1);
    expect(world.sampledObservations.map(sample => sample.tick)).toEqual([0, 1]);
  });
});

describe('motif occupancy observers', () => {
  const particle = (id: number, family: 0 | 1 | 2, x: number, y: number) => ({ id, family, x, y, vx: 0, vy: 0, energy: 1, age: 0, lifespan: 10, generation: 0, traits: [0, 0, 0] });

  it('builds family counts in the specified row-major bin order and counts occupied spatial bins', () => {
    const histogram = buildOccupancyHistogram([
      particle(0, 0, 0, 0),
      particle(1, 1, 0, 0),
      particle(2, 2, 1, 1),
      particle(3, 2, .5, .5),
    ]);
    expect(histogram.population).toBe(4);
    expect(histogram.counts).toHaveLength(432);
    expect(histogram.counts.slice(0, 3)).toEqual([1, 1, 0]);
    expect(histogram.counts.slice((11 * 12 + 11) * 3, (11 * 12 + 11) * 3 + 3)).toEqual([0, 0, 1]);
    expect(histogram.counts.slice((6 * 12 + 6) * 3, (6 * 12 + 6) * 3 + 3)).toEqual([0, 0, 1]);
    expect(occupiedSpatialBins(histogram)).toBe(3);
  });

  it('computes hand-known distances and the defined empty-population convention', () => {
    const empty = buildOccupancyHistogram([]);
    const one = buildOccupancyHistogram([particle(0, 2, 0, 0)]);
    const same = buildOccupancyHistogram([particle(1, 2, 0, 0)]);
    expect(occupiedSpatialBins(empty)).toBe(0);
    expect(totalVariationDistance(empty, empty)).toBe(0);
    expect(totalVariationDistance(empty, one)).toBe(1);
    expect(totalVariationDistance(one, empty)).toBe(1);
    expect(totalVariationDistance(one, same)).toBe(0);
    const halfAndHalf: OccupancyHistogram = { population: 2, counts: [...one.counts] };
    (halfAndHalf.counts as number[])[0] = 1;
    (halfAndHalf.counts as number[])[2] = 1;
    expect(totalVariationDistance(one, halfAndHalf)).toBe(0.5);
    expect(() => totalVariationDistance({ population: 1, counts: [1] }, empty)).toThrow(/432/);
    expect(() => totalVariationDistance({ population: 2, counts: new Array(432).fill(0) }, empty)).toThrow(/sum/);
  });

  it('rejects non-finite, out-of-range, and invalid family observations', () => {
    expect(() => buildOccupancyHistogram([particle(0, 0, Number.NaN, .5)])).toThrow(/finite/);
    expect(() => buildOccupancyHistogram([particle(0, 0, 1.01, .5)])).toThrow(/coordinate/);
    expect(() => buildOccupancyHistogram([particle(0, 3 as 0, .5, .5)])).toThrow(/family/);
  });
});

// The wrapper must not silently discard changed derived recipe fields.
it('rejects malformed or inconsistent compiled inputs', () => {
  const compiled = compileMotif({ interaction: 'chase', coordination: 'independent', habitat: 'still' });
  expect(() => new MotifWorld(1, null as never)).toThrow('plain');
  expect(() => new MotifWorld(1, 3 as never)).toThrow('plain');
  expect(() => new MotifWorld(1, { ...compiled, environment: { kind: 'seasonal', period: 600 } })).toThrow('environment');
  expect(() => new MotifWorld(1, { ...compiled, recipe: { ...compiled.recipe, alignment: .12 } })).toThrow('recipe');
  expect(() => new MotifWorld(1, { ...compiled, id: 'misleading' })).toThrow('id');
  expect(new MotifWorld(1, compiled).motif.id).toBe(compiled.id);
});
