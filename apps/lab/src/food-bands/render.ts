/**
 * Drawing and accounting for /food-bands/.
 *
 * New code written from apps/lab/src/hungry-shapes/page.ts (that file is not edited). Everything here
 * takes plain views and a 2D context, so tests can drive it with a recording context.
 */
import { bandReadout, eligibleMap, offeredCounts, offeredTiles, type PulseTargets } from './targets.ts';
import type { ModelModule, WorldApi } from './models.ts';
import type { FoodModeId } from './screens.ts';

export const FAMILY_COLORS = ['#91e1c0', '#f2be78', '#b5adf2'] as const;
export const FAMILY_HUES = [154, 37, 249] as const;
export const FAMILY_NAMES = ['Family 1', 'Family 2', 'Family 3'] as const;
export const GRID = 96;

export interface BodyView { readonly family: number; readonly genomeHash: number; readonly tiles: readonly number[] }
export interface Outline { readonly left: number; readonly width: number; readonly style: 'fed' | 'floor' | 'idle' }

export interface WorldView {
  readonly tick: number;
  readonly food: Uint8Array;
  readonly maxFood: number;
  readonly bodies: readonly BodyView[];
  /** 1 where the mode may offer food right now. */
  readonly eligible: Uint8Array | null;
  /** How many of the last pulse's slots landed on each tile. */
  readonly offered: Uint8Array | null;
  readonly outlines: readonly Outline[];
}

export function hashGenome(genome: { turnEvery: number; turn: number; branchEvery: number; maxCells: number }): number {
  let hash = 2166136261;
  for (const value of [genome.turnEvery, genome.turn + 1, genome.branchEvery, genome.maxCells]) hash = Math.imul(hash ^ value, 16777619);
  return hash >>> 0;
}

export function bodyColor(body: BodyView): string {
  const hue = FAMILY_HUES[body.family] ?? FAMILY_HUES[0];
  const light = 66 + body.genomeHash % 5 * 4;
  return `hsl(${hue} 67% ${light}%)`;
}

/** Band rectangles for the mode, from the model's own environment fields. Columns wrap east at the grid edge. */
export function outlinesFor(world: WorldApi, mode: FoodModeId): Outline[] {
  const env = world.environment;
  const favoured = env.pulses === 0 ? 0 : env.activeBand ?? 0;
  switch (mode) {
    case 'uniform': return [];
    case 'moving-band':
    case 'stationary-band': return [{ left: env.bandLeft ?? 0, width: env.bandWidth ?? 48, style: 'fed' }];
    case 'split-band': return (env.bandColumns ?? []).map(([l, r]) => ({ left: l, width: r - l + 1, style: 'fed' as const }));
    case 'alternating-band': return (env.bandColumns ?? []).map(([l, r], i) => ({ left: l, width: r - l + 1, style: i === favoured ? 'fed' as const : 'idle' as const }));
    case 'foothold-band':
    case 'schedule-769': return (env.bandColumns ?? []).map(([l, r], i) => ({ left: l, width: r - l + 1, style: i === favoured ? 'fed' as const : 'floor' as const }));
  }
}

export interface ViewParts { readonly view: WorldView; readonly pulse: PulseTargets }

export function viewFromWorld(world: WorldApi, mod: ModelModule, mode: FoodModeId, pulse?: PulseTargets): ViewParts {
  const targets = pulse ?? offeredTiles(world, mod, mode);
  const tileCount = mod.RULES.tileCount!;
  return {
    pulse: targets,
    view: {
      tick: world.tick,
      food: world.food,
      maxFood: mod.RULES.maxFood!,
      bodies: world.organisms.map(o => ({ family: o.family, genomeHash: hashGenome(o.genome), tiles: o.cells.map(c => c.tile) })),
      eligible: mode === 'uniform' ? null : eligibleMap(world, tileCount),
      offered: targets.offered.length ? offeredCounts(targets.offered, tileCount) : null,
      outlines: outlinesFor(world, mode),
    },
  };
}

/** A recorded replay frame as a view: same drawing path, so a wrong-way or wrong-colour picture fails a test. */
export interface RecordedFrame {
  readonly tick: number;
  readonly foodBase64: string;
  readonly cells: readonly (readonly [number, number])[];
  readonly organisms: readonly { readonly id: number; readonly family: number; readonly genome: { turnEvery: number; turn: number; branchEvery: number; maxCells: number } }[];
}

export function decodeBase64(text: string): Uint8Array {
  const raw = atob(text);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

export function encodeBase64(bytes: Uint8Array): string {
  let text = '';
  for (let i = 0; i < bytes.length; i += 4096) text += String.fromCharCode(...bytes.subarray(i, i + 4096));
  return btoa(text);
}

export function viewFromFrame(frame: RecordedFrame, maxFood: number): WorldView {
  const byId = new Map<number, number[]>();
  for (const [tile, id] of frame.cells) { const list = byId.get(id) ?? []; list.push(tile); byId.set(id, list); }
  return {
    tick: frame.tick,
    food: decodeBase64(frame.foodBase64),
    maxFood,
    bodies: frame.organisms.map(o => ({ family: o.family, genomeHash: hashGenome(o.genome), tiles: byId.get(o.id) ?? [] })),
    eligible: null, offered: null, outlines: [],
  };
}

/** The subset of CanvasRenderingContext2D that drawing uses. */
export interface Ctx2D {
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  fillRect(x: number, y: number, w: number, h: number): void;
  strokeRect(x: number, y: number, w: number, h: number): void;
  setLineDash(segments: number[]): void;
  beginPath(): void; moveTo(x: number, y: number): void; lineTo(x: number, y: number): void; stroke(): void;
}

export const COLORS = {
  background: '#09151a',
  eligible: 'rgba(63, 145, 117, .24)',
  offered: 'rgba(255, 207, 102, .92)',
  fed: '#7fd8b0',
  floor: '#d9b768',
  idle: '#7b8f95',
} as const;

const edge = (tile: number, size: number) => Math.round(tile * size / GRID);

export function drawWorld(ctx: Ctx2D, size: number, view: WorldView): void {
  ctx.fillStyle = COLORS.background; ctx.fillRect(0, 0, size, size);
  const food = view.food;
  for (let index = 0; index < food.length; index++) {
    const x = index % GRID, y = Math.floor(index / GRID);
    const left = edge(x, size), top = edge(y, size);
    const width = edge(x + 1, size) - left, height = edge(y + 1, size) - top;
    if (view.eligible?.[index]) { ctx.fillStyle = COLORS.eligible; ctx.fillRect(left, top, width, height); }
    const value = food[index]!;
    if (value > 0) {
      const alpha = Math.min(.34, .04 + value / view.maxFood * .30);
      ctx.fillStyle = `rgba(175, 229, 187, ${alpha})`;
      ctx.fillRect(left, top, width, height);
    }
    if (view.offered?.[index]) { ctx.fillStyle = COLORS.offered; ctx.fillRect(left, top, width, height); }
  }
  for (const body of view.bodies) {
    ctx.fillStyle = bodyColor(body);
    const tile = size / GRID;
    for (const t of body.tiles) {
      const x = t % GRID, y = Math.floor(t / GRID);
      ctx.fillRect(x * tile + .15, y * tile + .15, Math.max(1, tile - .3), Math.max(1, tile - .3));
    }
  }
  const line = Math.max(1.5, size / 300);
  ctx.lineWidth = line;
  for (const outline of view.outlines) {
    ctx.strokeStyle = COLORS[outline.style === 'fed' ? 'fed' : outline.style === 'floor' ? 'floor' : 'idle'];
    ctx.setLineDash(outline.style === 'fed' ? [] : [line * 3, line * 2]);
    const spans = outline.left + outline.width > GRID
      ? [[outline.left, GRID - outline.left], [0, outline.left + outline.width - GRID]] as const
      : [[outline.left, outline.width]] as const;
    for (const [l, w] of spans) ctx.strokeRect(edge(l, size) + line / 2, line / 2, edge(l + w, size) - edge(l, size) - line, size - line);
  }
  ctx.setLineDash([]);
}

export interface TickPoint { readonly tick: number; readonly population: number; readonly familyCounts: readonly number[] }

export function drawHistory(ctx: Ctx2D, width: number, height: number, points: readonly TickPoint[], horizon: number, maxOrganisms: number): void {
  if (!width || !height) return;
  ctx.fillStyle = '#0c1a20'; ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = '#4a636b'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, height - 1); ctx.lineTo(width, height - 1); ctx.stroke();
  for (let family = 0; family < 3; family++) {
    ctx.strokeStyle = FAMILY_COLORS[family]!; ctx.lineWidth = Math.max(1.4, width * .003); ctx.beginPath();
    points.forEach((point, index) => {
      const x = point.tick / horizon * width;
      const y = height - 4 - (point.familyCounts[family] ?? 0) / maxOrganisms * (height - 8);
      if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    if (points.length) ctx.stroke();
  }
}

export interface DeathCounts { readonly starvation: number; readonly age: number; readonly maxGeneration: number }
export function lineageMetrics(world: WorldApi): DeathCounts {
  let starvation = 0, age = 0, maxGeneration = 0;
  for (const node of world.lineage) {
    if (node.deathCause === 'starvation') starvation++;
    if (node.deathCause === 'age') age++;
    maxGeneration = Math.max(maxGeneration, node.generation);
  }
  return { starvation, age, maxGeneration };
}

export interface AccountingRow { readonly key: string; readonly label: string; readonly hint: string; readonly value: number }

/** The accounting table rows for one world. Values come straight from census(), environment and the counters. */
export function accountingRows(world: WorldApi, deaths: DeathCounts): AccountingRow[] {
  const census = world.census();
  const env = world.environment;
  const counters = world.countersView;
  const rows: AccountingRow[] = [
    { key: 'population', label: 'Living bodies', hint: 'organisms alive now', value: census.population },
    { key: 'cells', label: 'Occupied cells', hint: 'body cells alive now', value: census.cells },
    { key: 'generation', label: 'Highest generation', hint: 'deepest line of descent so far', value: deaths.maxGeneration },
    { key: 'pulses', label: 'Food pulses so far', hint: 'one pulse every 5 ticks', value: env.pulses },
    { key: 'offered', label: 'Food units offered', hint: 'all pulses together', value: env.offered },
    { key: 'accepted', label: 'Accepted by tiles', hint: 'offers that raised a tile', value: env.accepted },
    { key: 'overflow', label: 'Overflow', hint: 'offers to a tile already full', value: env.overflow },
    { key: 'births', label: 'Births', hint: 'total so far', value: counters.births ?? 0 },
    { key: 'starvation', label: 'Starvation deaths', hint: 'bodies that ran out of energy', value: deaths.starvation },
    { key: 'age', label: 'Age deaths', hint: 'bodies that reached the age limit', value: deaths.age },
    { key: 'blockedCap', label: 'Births blocked by the cap', hint: 'attempts at the body limit', value: counters.blockedCapBirths ?? 0 },
    { key: 'blockedSpace', label: 'Births blocked by space', hint: 'attempts with no free tile', value: counters.blockedSpaceBirths ?? 0 },
  ];
  if (env.bandOffered && env.bandAccepted && env.bandOverflow) {
    rows.push(
      { key: 'bandOffered0', label: 'Offered, left band', hint: 'band 0', value: env.bandOffered[0] },
      { key: 'bandOffered1', label: 'Offered, right band', hint: 'band 1', value: env.bandOffered[1] },
      { key: 'bandAccepted0', label: 'Accepted, left band', hint: 'band 0', value: env.bandAccepted[0] },
      { key: 'bandAccepted1', label: 'Accepted, right band', hint: 'band 1', value: env.bandAccepted[1] },
      { key: 'bandOverflow0', label: 'Overflow, left band', hint: 'band 0', value: env.bandOverflow[0] },
      { key: 'bandOverflow1', label: 'Overflow, right band', hint: 'band 1', value: env.bandOverflow[1] },
    );
  }
  return rows;
}

export { bandReadout };
