import { describe, expect, it } from 'vitest';
import {
  ACTIVITY_FLOOR, PROMPTS, SCREEN_RULES, calibrationFixtures, followupRecipes,
  initialRecipes, mutateRecipe, rankCandidates, rasterFrame, validateScreenFrame,
} from '../src/vision-screen/core.ts';
import type { CandidateScore, ScreenFrame } from '../src/vision-screen/core.ts';
import { recipeForPreset } from '../src/particles/model.ts';

describe('vision screen shared core', () => {
  it('pins the three target prompts and the pixel palette', () => {
    expect(PROMPTS.map(p => [p.id, p.text])).toEqual([
      ['target', 'many small separated clusters of colored dots on a dark background'],
      ['one', 'one large cluster of colored dots on a dark background'],
      ['uniform', 'colored dots spread uniformly across a dark background'],
    ]);
    expect(SCREEN_RULES).toMatchObject({ width: 128, height: 128, background: [10, 18, 24], palette: [[103, 218, 184], [243, 185, 99], [172, 146, 235]], dotRadius: 1 });
  });

  it('builds all 54 fixed fixture conditions plus the blank and one-dot diagnostics', () => {
    const fixtures = calibrationFixtures();
    expect(fixtures).toHaveLength(56);
    expect(new Set(fixtures.map(f => f.id)).size).toBe(56);
    const calibration = fixtures.slice(0, 54);
    expect(calibration.map(f => [f.count, f.layout, f.group])).toEqual(
      [60, 120, 240].flatMap(count => [0, 1, 2].flatMap(layout => ['1', '3', '6', '12', 'uniform', 'seam6'].map(group => [count, layout, group]))),
    );
    for (const fixture of calibration) {
      expect(fixture.frame.population).toBe(fixture.count);
      expect(fixture.frame.dots.map(dot => dot[0])).toEqual(Array.from({ length: fixture.count }, (_, i) => i));
      expect(fixture.frame.dots.every(([id, family]) => family === id % 3)).toBe(true);
      expect(fixture.frame.meanSpeed).toBe(0);
    }
    const six = fixtures.find(f => f.count === 60 && f.layout === 0 && f.group === '6')!;
    expect(six.frame.dots.slice(0, 3).map(([, , x, y]) => [x, y])).toEqual([[19, 31], [20, 31], [21, 31]]);
    expect(fixtures.at(-2)).toMatchObject({ count: 0, group: 'blank', frame: { population: 0, dots: [] } });
    expect(fixtures.at(-1)).toMatchObject({ count: 1, group: 'one', frame: { population: 1, dots: [[0, 0, 64, 64]] } });
    const seam = fixtures.find(f => f.count === 60 && f.layout === 0 && f.group === 'seam6')!;
    expect(seam.frame.dots.slice(0, 3).map(([, , x, y]) => [x, y])).toEqual([[83, 31], [84, 31], [85, 31]]);
    const uniform = fixtures.find(f => f.count === 60 && f.layout === 0 && f.group === 'uniform')!;
    expect(uniform.frame.dots.slice(0, 4).map(([, , x, y]) => [x, y])).toEqual([[8, 8], [24, 8], [40, 8], [56, 8]]);
  });

  it('uses the shared wrapped five-pixel raster and lets later IDs overwrite overlaps', () => {
    const frame: ScreenFrame = { scheduledTick: 10, actualTick: 8, dots: [[4, 0, 0, 0], [9, 1, 0, 0]], population: 2, meanSpeed: .01 };
    const image = rasterFrame(frame);
    expect(image).toHaveLength(128 * 128 * 3);
    const pixel = (x: number, y: number) => Array.from(image.slice((y * 128 + x) * 3, (y * 128 + x) * 3 + 3));
    expect(pixel(0, 0)).toEqual([243, 185, 99]);
    for (const [x, y] of [[0, 127], [1, 0], [0, 1], [127, 0]]) expect(pixel(x, y)).toEqual([243, 185, 99]);
    expect(pixel(1, 1)).toEqual([10, 18, 24]);
  });

  it('rejects malformed frames at the scoring boundary', () => {
    const valid: ScreenFrame = { scheduledTick: 1, actualTick: 1, dots: [[0, 0, 4, 5]], population: 1, meanSpeed: 0 };
    expect(validateScreenFrame(valid)).toEqual(valid);
    for (const patch of [
      { scheduledTick: NaN }, { actualTick: -1 }, { population: 2 }, { meanSpeed: Infinity },
      { dots: [[0, 3, 4, 5]] }, { dots: [[0, 0, 128, 5]] }, { dots: [[0, 0, 4, 1.5]] },
      { dots: [[-1, 0, 4, 5]] }, { dots: [[0, 0, 4, 5], [0, 1, 6, 7]] }, { dots: [[0, 0, NaN, 5]] },
    ]) expect(() => validateScreenFrame({ ...valid, ...patch })).toThrow();
  });

  it('mutates all eleven recipe fields in the documented order and clamps/rounds bounds', () => {
    const parent = recipeForPreset('flocks');
    const draws = Array.from({ length: 11 }, (_, i) => i % 2 === 0 ? .999999999 : 0);
    let consumed = 0;
    const child = mutateRecipe(parent, () => draws[consumed++]);
    expect(consumed).toBe(11);
    expect(child.rows).toEqual([[.95, -.05, .35], [-.05, .95, -.05], [.35, -.05, .95]]);
    expect(child.alignment).toBe(.09);
    expect(child.foodRenewal).toBe(.75);
    let clampConsumed = 0;
    const clamped = mutateRecipe({ rows: [[1, -1, 1], [-1, 1, -1], [1, -1, 1]], alignment: .2, foodRenewal: .3 }, () => { clampConsumed++; return .999999999; });
    expect(clampConsumed).toBe(11);
    expect(clamped).toEqual({ rows: [[1, -.8, 1], [-.8, 1, -.8], [1, -.8, 1]], alignment: .2, foodRenewal: .4 });
  });

  it('creates the fixed initial pool with stable lineage and reproducible recipe contents', () => {
    const a = initialRecipes(), b = initialRecipes();
    expect(a).toHaveLength(12);
    expect(a.map(x => [x.id, x.parentId, x.preset])).toEqual([
      ['preset-flocks', null, 'flocks'], ['initial-flocks-0', 'preset-flocks', 'flocks'], ['initial-flocks-1', 'preset-flocks', 'flocks'], ['initial-flocks-2', 'preset-flocks', 'flocks'],
      ['preset-pursuit', null, 'pursuit'], ['initial-pursuit-0', 'preset-pursuit', 'pursuit'], ['initial-pursuit-1', 'preset-pursuit', 'pursuit'], ['initial-pursuit-2', 'preset-pursuit', 'pursuit'],
      ['preset-colonies', null, 'colonies'], ['initial-colonies-0', 'preset-colonies', 'colonies'], ['initial-colonies-1', 'preset-colonies', 'colonies'], ['initial-colonies-2', 'preset-colonies', 'colonies'],
    ]);
    expect(a.map(x => x.recipe)).toEqual(b.map(x => x.recipe));
    expect(a[0].recipe).toEqual(recipeForPreset('flocks'));
    expect(a[1].recipe).toEqual({ rows: [[.748755, .247912, -.006409], [.281925, .629119, -.003908], [.055338, .329365, .709915]], alignment: .098125, foodRenewal: .706507 });
  });

  it('filters by the declared activity floor and ranks ties by lexical lineage ID', () => {
    expect(ACTIVITY_FLOOR).toEqual({ minimumPopulation: 60, meanSpeed: .0001 });
    const ranked = rankCandidates([
      { id: 'z', meanMargin: .4, minimumPopulation: 60, meanSpeed: .0001 },
      { id: 'b', meanMargin: .7, minimumPopulation: 59, meanSpeed: .01 },
      { id: 'c', meanMargin: .5, minimumPopulation: 61, meanSpeed: .00009 },
      { id: 'y', meanMargin: .3, minimumPopulation: 60, meanSpeed: .0001 },
      { id: 'a', meanMargin: .4, minimumPopulation: 60, meanSpeed: .0001 },
    ]);
    expect(ranked.map(row => row.id)).toEqual(['a', 'z', 'y']);
    expect(() => rankCandidates([{ id: 'x', meanMargin: NaN, minimumPopulation: 80, meanSpeed: 1 }])).toThrow();
  });

  it('makes the single follow-up batch from selected candidates and fixed preset controls', () => {
    const initial = initialRecipes();
    const scores: CandidateScore[] = initial.map((recipe, i) => ({ id: recipe.id, meanMargin: i / 10, minimumPopulation: 100, meanSpeed: .001 }));
    scores.find(s => s.id === 'initial-colonies-2')!.meanMargin = .99;
    const batch = followupRecipes(initial, scores), repeat = followupRecipes(initial, scores);
    expect(batch).toHaveLength(8);
    expect(batch.map(row => [row.id, row.parentId])).toEqual(repeat.map(row => [row.id, row.parentId]));
    expect(batch.map(row => row.recipe)).toEqual(repeat.map(row => row.recipe));
    expect(batch.slice(0, 4).map(row => [row.id, row.parentId])).toEqual([
      ['selected-0-0', 'initial-colonies-1'], ['selected-0-1', 'initial-colonies-1'], ['selected-1-0', 'initial-colonies-2'], ['selected-1-1', 'initial-colonies-2'],
    ]);
    const controlParents = batch.slice(4).map(row => row.parentId);
    expect(controlParents).toHaveLength(4);
    expect(new Set(controlParents).size).toBe(2);
    expect(controlParents.every(id => scores.some(s => s.id === id))).toBe(true);
    expect(() => followupRecipes(initial, [...scores, { id: 'missing-recipe', meanMargin: 2, minimumPopulation: 80, meanSpeed: .01 }])).toThrow();
    expect(followupRecipes(initial, scores.map(score => ({ ...score, minimumPopulation: 10 })))).toEqual([]);
    const oneEligible = followupRecipes(initial, scores.map((score, i) => ({ ...score, minimumPopulation: i === 0 ? 60 : 0, meanSpeed: .0001 })));
    expect(oneEligible).toHaveLength(4);
    expect(oneEligible.map(row => row.parentId)).toEqual(['preset-flocks', 'preset-flocks', 'preset-flocks', 'preset-flocks']);
  });
});
