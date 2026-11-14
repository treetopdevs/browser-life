import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as newest from '../src/food-schedule-769/model.ts';
import { loadModel, makeWorld, NEWEST_MODEL, type WorldApi } from '../src/food-bands/models.ts';
import { accountingRows, bodyColor, FAMILY_COLORS, drawHistory, drawWorld, FAMILY_HUES, GRID, lineageMetrics, outlinesFor, viewFromFrame, viewFromWorld, type Ctx2D, type RecordedFrame } from '../src/food-bands/render.ts';
import { lastPulse, offeredTiles } from '../src/food-bands/targets.ts';
import type { FoodModeId } from '../src/food-bands/screens.ts';

const MODES: FoodModeId[] = ['uniform', 'moving-band', 'stationary-band', 'split-band', 'alternating-band', 'foothold-band', 'schedule-769'];

interface Op { style: string; x: number; y: number; w: number; h: number }
interface Stroke { style: string; points: [number, number][] }
function recordingContext(): { ctx: Ctx2D; ops: Op[]; strokes: Stroke[] } {
  const ops: Op[] = [];
  const strokes: Stroke[] = [];
  let path: [number, number][] = [];
  const ctx = {
    fillStyle: '', strokeStyle: '', lineWidth: 1,
    fillRect(x: number, y: number, w: number, h: number) { ops.push({ style: String(ctx.fillStyle), x, y, w, h }); },
    strokeRect() {}, setLineDash() {},
    beginPath() { path = []; }, moveTo(x: number, y: number) { path.push([x, y]); }, lineTo(x: number, y: number) { path.push([x, y]); },
    stroke() { strokes.push({ style: String(ctx.strokeStyle), points: path }); },
  } as Ctx2D;
  return { ctx, ops, strokes };
}
/** The style of the last rectangle that covers a pixel, i.e. what a painter's-algorithm canvas shows there. */
const styleAt = (ops: Op[], px: number, py: number) => [...ops].reverse().find(o => px >= o.x && px < o.x + o.w && py >= o.y && py < o.y + o.h)?.style;

/** Independent oracle: wrap the model's own supplyFood and keep the food bytes before and after the pulse. */
function instrument(world: WorldApi) {
  const record = { before: null as Uint8Array | null, after: null as Uint8Array | null, pulse: -1, tick: -1 };
  const target = world as unknown as { supplyFood(): void; _food: Uint8Array; pulseCount: number; _tick: number };
  const original = target.supplyFood;
  target.supplyFood = function (this: typeof target) {
    record.before = this._food.slice(); record.pulse = this.pulseCount; record.tick = this._tick;
    original.call(this);
    record.after = this._food.slice();
  };
  return record;
}

describe('offered-slot layer against the food-byte oracle', () => {
  it.each(MODES)('%s: the tiles drawn as offered reproduce the food bytes the model changed', async mode => {
    const mod = await loadModel(NEWEST_MODEL);
    const world = makeWorld(mod, 1202, mode);
    const oracle = instrument(world);
    let checked = 0;
    for (let tick = 1; tick <= 1015; tick++) {
      world.step(1);
      if (tick % 5 !== 0) continue;
      const { pulse, pulseTick } = lastPulse(world, mod);
      expect([oracle.pulse, oracle.tick]).toEqual([pulse, pulseTick]);
      const { offered } = offeredTiles(world, mod, mode);
      expect(offered.length).toBe(768);
      const simulated = oracle.before!.slice();
      for (const tile of offered) if (simulated[tile]! < mod.RULES.maxFood!) simulated[tile]!++;
      expect(Array.from(simulated), `${mode} pulse ${pulse} at tick ${tick}`).toEqual(Array.from(oracle.after!));
      checked++;
    }
    expect(checked).toBe(203);
  });

  it('negative control: tiles shifted by one do not reproduce the food bytes', async () => {
    const mod = await loadModel(NEWEST_MODEL);
    const world = makeWorld(mod, 1202, 'split-band');
    const oracle = instrument(world);
    world.step(5);
    const simulated = oracle.before!.slice();
    for (const tile of offeredTiles(world, mod, 'split-band').offered) { const t = (tile + 1) % (GRID * GRID); if (simulated[t]! < 40) simulated[t]!++; }
    expect(Array.from(simulated)).not.toEqual(Array.from(oracle.after!));
  });

  it('is empty, and says so, before the first pulse', async () => {
    const mod = await loadModel(NEWEST_MODEL);
    const world = makeWorld(mod, 1202, 'split-band');
    expect(offeredTiles(world, mod, 'split-band')).toEqual({ pulse: -1, pulseTick: -1, offered: [] });
    const { view } = viewFromWorld(world, mod, 'split-band');
    expect(view.offered).toBeNull();
    world.step(4);
    expect(offeredTiles(world, mod, 'split-band').offered).toEqual([]);
    world.step(1);
    expect(offeredTiles(world, mod, 'split-band').pulse).toBe(0);
  });
});

describe('geometry of each mode', () => {
  const columnsOf = (tiles: readonly number[]) => new Set(tiles.map(t => t % GRID));
  it('eligible layer equals world.foodTargets', async () => {
    const mod = await loadModel(NEWEST_MODEL);
    for (const mode of MODES) {
      const world = makeWorld(mod, 1202, mode); world.step(50);
      const { view } = viewFromWorld(world, mod, mode);
      if (mode === 'uniform') { expect(view.eligible).toBeNull(); continue; }
      expect(view.eligible!.reduce((n, v) => n + v, 0)).toBe(new Set(world.foodTargets).size);
      for (const t of world.foodTargets) expect(view.eligible![t]).toBe(1);
    }
  });

  it('split shows two columns of 24, 4,608 tiles, and exactly 768 offered slots per pulse', async () => {
    const mod = await loadModel(NEWEST_MODEL);
    const world = makeWorld(mod, 1202, 'split-band'); world.step(50);
    expect(world.foodTargets.length).toBe(4608);
    expect([...columnsOf(world.foodTargets)].sort((a, b) => a - b)).toEqual([...Array(24).keys(), ...[...Array(24).keys()].map(i => i + 48)].sort((a, b) => a - b));
    expect(outlinesFor(world, 'split-band')).toEqual([{ left: 0, width: 24, style: 'fed' }, { left: 48, width: 24, style: 'fed' }]);
    expect(offeredTiles(world, mod, 'split-band').offered.length).toBe(768);
  });

  it('moving band left edge equals movingBandGeometry(tick).left and the band moves', async () => {
    const mod = await loadModel(NEWEST_MODEL);
    const world = makeWorld(mod, 1202, 'moving-band');
    for (const tick of [0, 49, 50, 300]) {
      if (tick > world.tick) world.step(tick - world.tick);
      expect(outlinesFor(world, 'moving-band')[0]!.left).toBe(newest.movingBandGeometry(tick).left);
    }
    expect(outlinesFor(world, 'moving-band')[0]!.left).toBe(6);
    const columns = columnsOf(offeredTiles(world, mod, 'moving-band').offered);
    for (const c of columns) expect((c - 6 + GRID) % GRID).toBeLessThan(48);
  });

  it('alternating flips at the model pulse 99 to 100 transition (tick 500 vs 505), not at tick 500', async () => {
    const mod = await loadModel(NEWEST_MODEL);
    const world = makeWorld(mod, 1202, 'alternating-band');
    world.step(500);
    expect(lastPulse(world, mod)).toEqual({ pulse: 99, pulseTick: 500 });
    expect(newest.alternatingBandAtPulse(99)).toBe(0);
    expect(outlinesFor(world, 'alternating-band').map(o => o.style)).toEqual(['fed', 'idle']);
    expect([...columnsOf(offeredTiles(world, mod, 'alternating-band').offered)].every(c => c < 24)).toBe(true);
    world.step(5);
    expect(lastPulse(world, mod)).toEqual({ pulse: 100, pulseTick: 505 });
    expect(newest.alternatingBandAtPulse(100)).toBe(1);
    expect(outlinesFor(world, 'alternating-band').map(o => o.style)).toEqual(['idle', 'fed']);
    expect([...columnsOf(offeredTiles(world, mod, 'alternating-band').offered)].every(c => c >= 48 && c < 72)).toBe(true);
  });

  it('foothold and schedule 769 keep a 96 + 96 floor and send 576 to the favoured band', async () => {
    const mod = await loadModel(NEWEST_MODEL);
    for (const mode of ['foothold-band', 'schedule-769'] as const) {
      const world = makeWorld(mod, 1202, mode); world.step(500);
      const offered = offeredTiles(world, mod, mode).offered;
      expect(offered.filter(t => t % GRID < 24).length).toBe(96 + 576);
      expect(offered.filter(t => t % GRID >= 48).length).toBe(96);
      expect(outlinesFor(world, mode).map(o => o.style)).toEqual(['fed', 'floor']);
      world.step(5);
      const next = offeredTiles(world, mod, mode).offered;
      expect(next.filter(t => t % GRID >= 48).length).toBe(96 + 576);
    }
  });
});

describe('accounting and history', () => {
  it('accounting values equal the model environment, counters and census', async () => {
    const mod = await loadModel(NEWEST_MODEL);
    const world = makeWorld(mod, 1202, 'foothold-band'); world.step(700);
    const rows = Object.fromEntries(accountingRows(world, lineageMetrics(world)).map(r => [r.key, r.value]));
    const env = world.environment; const census = world.census();
    expect(rows).toMatchObject({ population: census.population, cells: census.cells, pulses: env.pulses, offered: env.offered, accepted: env.accepted, overflow: env.overflow,
      births: world.countersView.births, bandOffered0: env.bandOffered![0], bandOffered1: env.bandOffered![1], bandAccepted0: env.bandAccepted![0], bandOverflow1: env.bandOverflow![1] });
    expect(rows.offered).toBe(env.pulses * 768);
  });

  it('history points drawn every 20 ticks match census() at those ticks', async () => {
    const mod = await loadModel(NEWEST_MODEL);
    const world = makeWorld(mod, 1202, 'uniform');
    const points: { tick: number; population: number; familyCounts: readonly number[] }[] = [];
    for (let t = 0; t <= 200; t++) { if (t > 0) world.step(1); if (t % 20 === 0) { const c = world.census(); points.push({ tick: t, population: c.population, familyCounts: c.familyCounts }); } }
    expect(points.map(p => p.tick)).toEqual([0, 20, 40, 60, 80, 100, 120, 140, 160, 180, 200]);
    const reference = makeWorld(mod, 1202, 'uniform'); reference.step(120);
    expect(points[6]!.population).toBe(reference.census().population);
    const { ctx, ops, strokes } = recordingContext();
    drawHistory(ctx, 500, 100, points, 200, 48);
    expect(ops.length).toBe(1);
    // one axis stroke, then one line per family in the family colours, one vertex per history point
    const lines = strokes.filter(st => st.points.length === points.length);
    expect(lines.map(l => l.style)).toEqual([...FAMILY_COLORS]);
    lines.forEach((line, family) => points.forEach((p, i) => {
      expect(line.points[i]![0]).toBeCloseTo(p.tick / 200 * 500, 6);
      expect(line.points[i]![1]).toBeCloseTo(100 - 4 - p.familyCounts[family]! / 48 * (100 - 8), 6);
    }));
  });
});

describe('render oracle: tile colours at known coordinates', () => {
  const SIZE = 576;
  const genome = { turnEvery: 4, turn: 0, branchEvery: 4, maxCells: 24 };
  it('synthetic frame: three families land at the right tile, in the right family colour', () => {
    const at = (x: number, y: number) => y * GRID + x;
    const frame: RecordedFrame = { tick: 20, foodBase64: btoa(String.fromCharCode(...new Uint8Array(GRID * GRID))),
      cells: [[at(10, 5), 1], [at(70, 20), 2], [at(3, 90), 3]], organisms: [{ id: 1, family: 0, genome }, { id: 2, family: 1, genome }, { id: 3, family: 2, genome }] };
    const { ctx, ops } = recordingContext();
    drawWorld(ctx, SIZE, viewFromFrame(frame, 40));
    const tile = SIZE / GRID;
    for (const [x, y, family] of [[10, 5, 0], [70, 20, 1], [3, 90, 2]] as const) {
      expect(styleAt(ops, (x + .5) * tile, (y + .5) * tile), `family ${family} at ${x},${y}`).toMatch(new RegExp(`^hsl\\(${FAMILY_HUES[family]} `));
    }
    // the mirrored tiles are empty: wrong-way orientation would colour these instead
    for (const [x, y] of [[5, 10], [20, 70], [90, 3]] as const) expect(styleAt(ops, (x + .5) * tile, (y + .5) * tile)).not.toMatch(/^hsl/);
    expect(bodyColor({ family: 0, genomeHash: 0, tiles: [] })).toMatch(/^hsl\(154 /);
  });

  const recorded = new URL('../../../docs/creative-prototypes/split-food-seed-1202.json', import.meta.url);
  it.skipIf(!existsSync(recorded))('recorded frame 1000: every body cell is drawn in its family colour at its tile', () => {
    const data = JSON.parse(readFileSync(recorded, 'utf8')) as { frames: (RecordedFrame & { tick: number })[] };
    const frame = data.frames.find(f => f.tick === 1000)!;
    const view = viewFromFrame(frame, 40);
    const { ctx, ops } = recordingContext();
    drawWorld(ctx, SIZE, view);
    const family = new Map(frame.organisms.map(o => [o.id, o.family]));
    const tile = SIZE / GRID;
    expect(frame.cells.length).toBeGreaterThan(100);
    for (const [t, id] of frame.cells) {
      const x = t % GRID, y = Math.floor(t / GRID);
      expect(styleAt(ops, (x + .5) * tile, (y + .5) * tile)).toMatch(new RegExp(`^hsl\\(${FAMILY_HUES[family.get(id)!]} `));
    }
  });
});
