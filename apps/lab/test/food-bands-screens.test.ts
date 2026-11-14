import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SCREENS, screenSeeds } from '../src/food-bands/screens.ts';
import { ALL_MODEL_KEYS, loadModel, makeWorld } from '../src/food-bands/models.ts';

const root = new URL('../../../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), 'utf8');

/** The 18 food tool directories, as the run's plan names them. */
const FOOD_TOOL_DIRS = [
  'uniform-food', 'uniform-endurance', 'moving-food', 'moving-food-replication', 'stationary-food', 'stationary-food-replication',
  'food-band-longevity', 'food-band-longevity-replication', 'split-food', 'split-food-replication', 'alternating-food', 'alternating-food-replication',
  'food-band-foothold', 'food-band-foothold-replication', 'food-floor-replication', 'food-floor-longevity', 'food-floor-longevity-replication', 'food-schedule-769',
];

interface Parsed { seeds: number[]; modes: string[]; maxTick: number }
/** What a tool's explore.ts says about itself: seeds, food modes and horizon, read from the source text. */
function parseExplore(dir: string): Parsed {
  const text = read(`tools/${dir}/explore.ts`);
  const seeds = new Set<number>();
  const modes = new Set<string>();
  for (const m of text.matchAll(/new HungryWorld\((\d+),true,'([a-z0-9-]+)'\)/g)) { seeds.add(Number(m[1])); modes.add(m[2]!); }
  const runType = text.match(/run:\s*\{\s*seed:\s*([0-9|]+);\s*mode:\s*([^;]+);/);
  if (runType) {
    for (const s of runType[1]!.split('|')) seeds.add(Number(s));
    for (const mode of runType[2]!.split('|')) modes.add(mode.trim().replace(/'/g, ''));
  }
  const args = text.match(/export function parseArgs\([^)]*\):\{mode:[^;]+;seed:([0-9|]+)/);
  if (args) for (const s of args[1]!.split('|')) seeds.add(Number(s));
  const runArm = text.match(/runArm\(mode:([^,)]+),seed:([0-9|]+)\)/);
  if (runArm) {
    for (const s of runArm[2]!.split('|')) seeds.add(Number(s));
    for (const mode of runArm[1]!.split('|')) modes.add(mode.replace(/'/g, '').trim());
  }
  const generic = text.match(/mode:'--write'\|'--check'\|'--replay-check';seed:([0-9|]+)\}/);
  if (generic) for (const s of generic[1]!.split('|')) seeds.add(Number(s));
  const uniformSeeds = text.match(/int\(value\.run\.seed,'seed',(\d+),(\d+)\)/);
  if (uniformSeeds) for (let s = Number(uniformSeeds[1]); s <= Number(uniformSeeds[2]); s++) seeds.add(s);
  const maxTick = Number(text.match(/MAX_TICK\s*=\s*(\d+)/)![1]);
  return { seeds: [...seeds].sort(), modes: [...modes].sort(), maxTick };
}

describe('food-bands screens', () => {
  it('lists every screen id once and covers all 18 food tool directories', () => {
    const ids = SCREENS.map(s => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    const dirs = SCREENS.flatMap(s => s.sources.map(src => src.dir));
    expect(new Set(dirs).size).toBe(dirs.length);
    expect([...dirs].sort()).toEqual([...FOOD_TOOL_DIRS].sort());
    for (const dir of FOOD_TOOL_DIRS) expect(existsSync(new URL(`tools/${dir}/explore.ts`, root))).toBe(true);
  });

  it('every food-looking tool directory with an explore.ts is accounted for', () => {
    const present = readdirSync(new URL('tools/', root)).filter(d => existsSync(new URL(`tools/${d}/explore.ts`, root)))
      .filter(d => /food|uniform-endurance/.test(d));
    expect(present.sort()).toEqual([...FOOD_TOOL_DIRS].sort());
  });

  it.each(FOOD_TOOL_DIRS)('seeds, modes and horizon for %s equal what its explore.ts says', dir => {
    const source = SCREENS.flatMap(s => s.sources.map(src => ({ screen: s, src }))).find(x => x.src.dir === dir)!;
    const parsed = parseExplore(dir);
    expect(source.src.seeds, `${dir} seeds`).toEqual(parsed.seeds);
    expect([...source.src.modes].sort(), `${dir} modes`).toEqual(parsed.modes);
    expect(source.src.maxTick, `${dir} horizon`).toBe(parsed.maxTick);
    // the screen's own model is the one the tool imports
    const imported = read(`tools/${dir}/explore.ts`).match(/\} from '\.\.\/\.\.\/apps\/lab\/src\/([a-z0-9-]+)\/model\.ts'/)![1];
    expect(source.screen.ownModel).toBe(imported);
  });

  it('screen horizons, seeds and arm modes follow their sources', () => {
    for (const screen of SCREENS) {
      expect(new Set(screen.sources.map(s => s.maxTick)), screen.id).toEqual(new Set([screen.horizon]));
      const sourceSeeds = [...new Set(screen.sources.flatMap(s => s.seeds))].sort();
      expect([...screenSeeds(screen)].sort(), screen.id).toEqual(sourceSeeds);
      const sourceModes = new Set(screen.sources.flatMap(s => s.modes));
      for (const arm of screen.arms) expect(sourceModes.has(arm.mode), `${screen.id}/${arm.id}`).toBe(true);
    }
  });

  it('every arm mode is one its model accepts', async () => {
    for (const screen of SCREENS) {
      const mod = await loadModel(screen.ownModel);
      for (const arm of screen.arms) for (const seed of screenSeeds(screen)) {
        expect(() => makeWorld(mod, seed, arm.mode), `${screen.id}/${arm.id}/${seed}`).not.toThrow();
      }
    }
  });

  it('every choice has text and every arm says what differs', () => {
    for (const screen of SCREENS) {
      expect(screen.title.trim().length).toBeGreaterThan(5);
      expect(screen.question.trim().length).toBeGreaterThan(20);
      expect(screen.choiceText.trim().length).toBeGreaterThan(20);
      expect(screen.arms.length).toBeGreaterThan(0);
      for (const arm of screen.arms) {
        expect(arm.label.trim()).not.toBe('');
        expect(arm.differs.trim().length).toBeGreaterThan(15);
        for (const seed of screenSeeds(screen)) if (!arm.optional || seed === screen.seeds.primary) expect(arm.replays[seed]?.length ?? 0, `${screen.id}/${arm.id}/${seed} replay`).toBeGreaterThan(0);
      }
    }
  });

  it('model SHA-256 equals the digest the explore tools pin', () => {
    const pins = new Map<string, Set<string>>();
    for (const dir of FOOD_TOOL_DIRS) {
      for (const m of read(`tools/${dir}/explore.ts`).matchAll(/'(apps\/lab\/src\/[a-z0-9-]+\/model\.ts)'\s*:\s*'([0-9a-f]{64})'/g)) {
        const set = pins.get(m[1]!) ?? new Set<string>(); set.add(m[2]!); pins.set(m[1]!, set);
      }
    }
    for (const key of ALL_MODEL_KEYS) {
      const path = `apps/lab/src/${key}/model.ts`;
      const digest = createHash('sha256').update(readFileSync(new URL(path, root))).digest('hex');
      const pinned = pins.get(path);
      expect(pinned, `${path} should be pinned by at least one explore tool`).toBeDefined();
      expect([...pinned!], path).toEqual([digest]);
    }
  });
});
