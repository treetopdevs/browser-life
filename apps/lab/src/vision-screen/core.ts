import { PRESETS, recipeForPreset, validateRecipe } from '../particles/model.ts';
import type { ParticleRecipe, PresetId } from '../particles/model.ts';

/** Exact text used by the visual judge, in target/one/uniform order. */
export const PROMPTS = Object.freeze([
  Object.freeze({ id: 'target', text: 'many small separated clusters of colored dots on a dark background' }),
  Object.freeze({ id: 'one', text: 'one large cluster of colored dots on a dark background' }),
  Object.freeze({ id: 'uniform', text: 'colored dots spread uniformly across a dark background' }),
] as const);

export const SCREEN_RULES = Object.freeze({
  width: 128,
  height: 128,
  background: Object.freeze([10, 18, 24] as const),
  palette: Object.freeze([
    Object.freeze([103, 218, 184] as const),
    Object.freeze([243, 185, 99] as const),
    Object.freeze([172, 146, 235] as const),
  ] as const),
  dotRadius: 1,
});

export type ScreenFrame = {
  scheduledTick: number;
  actualTick: number;
  dots: Array<[number, number, number, number]>;
  population: number;
  meanSpeed: number;
};
export type CalibrationGroup = '1' | '3' | '6' | '12' | 'uniform' | 'seam6' | 'blank' | 'one';
export type CalibrationFixture = { id: string; label: string; count: number; layout: number; group: CalibrationGroup; frame: ScreenFrame };

function validTick(value: unknown): value is number { return Number.isSafeInteger(value) && (value as number) >= 0; }
/** Validate untrusted frame data before it reaches the shared scorer/browser rasterizer. */
export function validateScreenFrame(input: unknown): ScreenFrame {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Frame must be an object');
  const value = input as Record<string, unknown>;
  if (!validTick(value.scheduledTick) || !validTick(value.actualTick)) throw new Error('Frame ticks must be non-negative safe integers');
  if (!Array.isArray(value.dots)) throw new Error('Frame dots must be an array');
  if (!Number.isSafeInteger(value.population) || value.population !== value.dots.length) throw new Error('Frame population must match its dots');
  if (typeof value.meanSpeed !== 'number' || !Number.isFinite(value.meanSpeed) || value.meanSpeed < 0) throw new Error('Frame mean speed must be finite and non-negative');
  const seen = new Set<number>();
  const dots: Array<[number, number, number, number]> = value.dots.map((entry: unknown) => {
    if (!Array.isArray(entry) || entry.length !== 4) throw new Error('Each dot must be [id, family, x, y]');
    const [id, family, x, y] = entry;
    if (!Number.isSafeInteger(id) || (id as number) < 0 || seen.has(id as number)) throw new Error('Dot IDs must be unique non-negative safe integers');
    if (family !== 0 && family !== 1 && family !== 2) throw new Error('Dot family must be 0, 1, or 2');
    if (!Number.isInteger(x) || (x as number) < 0 || (x as number) >= 128 || !Number.isInteger(y) || (y as number) < 0 || (y as number) >= 128) throw new Error('Dot coordinates must be integer pixels from 0 through 127');
    seen.add(id as number);
    return [id as number, family, x as number, y as number];
  });
  return { scheduledTick: value.scheduledTick, actualTick: value.actualTick, dots, population: value.population as number, meanSpeed: value.meanSpeed };
}

/** Rasterize the canonical integer-pixel frame as tightly packed RGB (RGB128x128). */
export function rasterFrame(frame: ScreenFrame): Uint8Array {
  const checked = validateScreenFrame(frame);
  const { width, height, background, palette } = SCREEN_RULES;
  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0; i < width * height; i++) rgb.set(background, i * 3);
  // IDs are normally already ascending; sorting makes overwrite order explicit for any caller.
  checked.dots.sort((a, b) => a[0] - b[0]);
  for (const [, family, x, y] of checked.dots) {
    const color = palette[family];
    for (const [dx, dy] of [[0, 0], [0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
      const px = (x + dx + width) % width, py = (y + dy + height) % height;
      rgb.set(color, (py * width + px) * 3);
    }
  }
  return rgb;
}

const offsets = [[0, 0], [3, 5], [-4, 2]] as const;
const centers: Record<'1' | '3' | '6' | '12', readonly (readonly [number, number])[]> = {
  '1': [[64, 64]],
  '3': [[24, 64], [64, 24], [104, 96]],
  '6': [[20, 32], [64, 32], [108, 32], [20, 96], [64, 96], [108, 96]],
  '12': [[16, 20], [48, 20], [80, 20], [112, 20], [16, 64], [48, 64], [80, 64], [112, 64], [16, 108], [48, 108], [80, 108], [112, 108]],
};
function mod128(value: number): number { return ((value % 128) + 128) % 128; }
function fixtureFrame(count: number, layout: number, group: CalibrationGroup): ScreenFrame {
  if (group === 'blank') return { scheduledTick: 0, actualTick: 0, dots: [], population: 0, meanSpeed: 0 };
  const actualCount = group === 'one' ? 1 : count;
  const dots: Array<[number, number, number, number]> = [];
  if (group === 'uniform') {
    const width = Math.ceil(Math.sqrt(actualCount)), height = Math.ceil(actualCount / width);
    for (let id = 0; id < actualCount; id++) {
      const col = id % width, row = Math.floor(id / width);
      dots.push([id, id % 3, mod128(Math.floor((col + .5) * 128 / width) + offsets[layout][0]), mod128(Math.floor((row + .5) * 128 / height) + offsets[layout][1])]);
    }
  } else {
    const groupKey = group === 'seam6' ? '6' : group === 'one' ? '1' : group;
    const groupCount = group === 'one' ? 1 : Number(groupKey);
    const centersForGroups = centers[groupKey as keyof typeof centers];
    const baseCount = Math.floor(actualCount / groupCount), remainder = actualCount % groupCount;
    let id = 0;
    for (let g = 0; g < groupCount; g++) {
      const n = baseCount + (g < remainder ? 1 : 0), cols = Math.ceil(Math.sqrt(n)), rows = Math.ceil(n / cols);
      const [cx, cy] = centersForGroups[g];
      for (let j = 0; j < n; j++, id++) {
        const x = cx + (group === 'seam6' ? 64 : 0) + j % cols - Math.floor((cols - 1) / 2) + offsets[layout][0];
        const y = cy + Math.floor(j / cols) - Math.floor((rows - 1) / 2) + offsets[layout][1];
        dots.push([id, id % 3, mod128(x), mod128(y)]);
      }
    }
  }
  return { scheduledTick: 0, actualTick: 0, dots, population: dots.length, meanSpeed: 0 };
}

/** Return the fixed 54 calibration images, followed by blank and one-dot diagnostics. */
export function calibrationFixtures(): CalibrationFixture[] {
  const result: CalibrationFixture[] = [];
  const groups: CalibrationGroup[] = ['1', '3', '6', '12', 'uniform', 'seam6'];
  for (const count of [60, 120, 240]) for (let layout = 0; layout < 3; layout++) for (const group of groups) {
    result.push({ id: `cal-${count}-layout${layout}-${group}`, label: `${count} dots · layout ${layout} · ${group === 'uniform' ? 'uniform' : group === 'seam6' ? 'six seam-crossing clusters' : `${group} cluster${group === '1' ? '' : 's'}`}`, count, layout, group, frame: fixtureFrame(count, layout, group) });
  }
  result.push({ id: 'diagnostic-blank', label: 'Blank background', count: 0, layout: 0, group: 'blank', frame: fixtureFrame(0, 0, 'blank') });
  result.push({ id: 'diagnostic-one', label: 'One dot', count: 1, layout: 0, group: 'one', frame: fixtureFrame(1, 0, 'one') });
  return result;
}

export type RecipeLineage = { id: string; parentId: string | null; preset: PresetId; recipe: ParticleRecipe };
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ state >>> 15, state | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function roundedRecipe(recipe: ParticleRecipe): ParticleRecipe {
  return validateRecipe({ rows: recipe.rows.map(row => row.map(value => Math.round(value * 1_000_000) / 1_000_000)), alignment: Math.round(recipe.alignment * 1_000_000) / 1_000_000, foodRenewal: Math.round(recipe.foodRenewal * 1_000_000) / 1_000_000 });
}
/** Consume exactly 11 Mulberry32 draws: row-major matrix, alignment, then renewal. */
export function mutateRecipe(parent: ParticleRecipe, random: () => number): ParticleRecipe {
  const checked = validateRecipe(parent);
  if (typeof random !== 'function') throw new Error('Mutation requires a random source');
  const draw = () => { const n = random(); if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n >= 1) throw new Error('Random source must return values in [0, 1)'); return n; };
  const rows = checked.rows.map(row => [...row]);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) rows[r][c] = Math.max(-1, Math.min(1, rows[r][c] + (draw() * 2 - 1) * .2));
  const alignment = Math.max(0, Math.min(.2, checked.alignment + (draw() * 2 - 1) * .03));
  const foodRenewal = Math.max(.3, Math.min(1, checked.foodRenewal + (draw() * 2 - 1) * .1));
  return roundedRecipe({ rows, alignment, foodRenewal });
}
/** The fixed 12-recipe starting pool: preset parents in shipped order, each with children 0..2. */
export function initialRecipes(seed = 91001): RecipeLineage[] {
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error('Recipe seed must be an unsigned 32-bit integer');
  const random = mulberry32(seed), result: RecipeLineage[] = [];
  for (const preset of PRESETS) {
    const parent: RecipeLineage = { id: `preset-${preset.id}`, parentId: null, preset: preset.id, recipe: recipeForPreset(preset.id) };
    result.push(parent);
    for (let child = 0; child < 3; child++) result.push({ id: `initial-${preset.id}-${child}`, parentId: parent.id, preset: preset.id, recipe: mutateRecipe(parent.recipe, random) });
  }
  return result;
}

export type CandidateScore = { id: string; recipeId?: string; meanMargin: number; minimumPopulation: number; meanSpeed: number; frameMargins?: number[] };
export const ACTIVITY_FLOOR = Object.freeze({ minimumPopulation: 60, meanSpeed: 0.0001 });
/** Rank eligible candidates by mean margin, then lexical lineage ID; malformed score rows are rejected. */
export function rankCandidates(scores: readonly CandidateScore[]): CandidateScore[] {
  const seen = new Set<string>();
  const checked = scores.map(score => {
    if (!score || typeof score.id !== 'string' || !score.id || seen.has(score.id)) throw new Error('Candidate IDs must be non-empty and unique');
    if (typeof score.meanMargin !== 'number' || !Number.isFinite(score.meanMargin) || !Number.isSafeInteger(score.minimumPopulation) || score.minimumPopulation < 0 || typeof score.meanSpeed !== 'number' || !Number.isFinite(score.meanSpeed) || score.meanSpeed < 0) throw new Error(`Invalid score for ${score.id}`);
    if (score.frameMargins && (!Array.isArray(score.frameMargins) || score.frameMargins.some(v => typeof v !== 'number' || !Number.isFinite(v)))) throw new Error(`Invalid frame margins for ${score.id}`);
    seen.add(score.id); return { ...score, eligible: score.minimumPopulation >= ACTIVITY_FLOOR.minimumPopulation && score.meanSpeed >= ACTIVITY_FLOOR.meanSpeed };
  });
  return checked.filter(s => s.eligible).sort((a, b) => b.meanMargin - a.meanMargin || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Select ranked parents and uniform eligible controls; selected and control child streams are independent. */
export function followupRecipes(initial: readonly RecipeLineage[], initialScores: readonly CandidateScore[]): RecipeLineage[] {
  const byId = new Map(initial.map(lineage => [lineage.id, lineage]));
  if (byId.size !== initial.length) throw new Error('Initial recipe IDs must be unique');
  const eligible = rankCandidates(initialScores);
  const lineageFor = (score: CandidateScore) => byId.get(score.recipeId ?? score.id);
  const selectedParents = eligible.slice(0, 2).map(lineageFor);
  if (eligible.some(score => !lineageFor(score)) || selectedParents.some(parent => !parent)) throw new Error('Scores refer to missing recipes');
  if (!selectedParents.length) return [];
  const children: RecipeLineage[] = [];
  const selectedRandom = mulberry32(91002);
  for (let p = 0; p < selectedParents.length; p++) for (let child = 0; child < 2; child++) {
    const parent = selectedParents[p]!; children.push({ id: `selected-${p}-${child}`, parentId: parent.id, preset: parent.preset, recipe: mutateRecipe(parent.recipe, selectedRandom) });
  }
  const controlRandom = mulberry32(91003), controlParents = eligible.map(lineageFor).filter((x): x is RecipeLineage => Boolean(x));
  // Partial Fisher-Yates gives a uniform sample without replacement, consuming one draw per selected parent.
  for (let i = 0; i < Math.min(2, controlParents.length); i++) { const j = i + Math.floor(controlRandom() * (controlParents.length - i)); [controlParents[i], controlParents[j]] = [controlParents[j], controlParents[i]]; }
  controlParents.length = Math.min(2, controlParents.length);
  const childRandom = mulberry32(91004);
  for (let p = 0; p < controlParents.length; p++) for (let child = 0; child < 2; child++) {
    const parent = controlParents[p]; children.push({ id: `control-${p}-${child}`, parentId: parent.id, preset: parent.preset, recipe: mutateRecipe(parent.recipe, childRandom) });
  }
  return children;
}
