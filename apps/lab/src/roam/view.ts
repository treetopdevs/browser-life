/** Starting line-ups, pictures and readouts for the roam world, shared by the local page and the headless look. */

import { defaultRoamConfig, G_ADULT, PLAN_MODES, PLAN_REST, planEntry, roamHash, ROAM_GENE_MAX, ROAM_GENES, type RoamCensus, type RoamConfig, RoamWorld } from './kernel.ts';

/** Acts of a plan mode: keep the daughter in front, to the right, behind, to the left; or let it go there; or rest. */
const KF = 0, KR = 1, KB = 2, KL = 3, GF = 4, GR = 5, GB = 6, GL = 7;
/** A plan from the modes that do something: mode -> [act, kept daughter's mode, own next mode]. The rest only rest. */
export function roamPlan(modes: Record<number, readonly [number, number, number]>): number[] {
  const plan = Array.from({ length: PLAN_MODES }, (_, m) => planEntry(PLAN_REST, 0, m));
  for (const [m, [act, child, next]] of Object.entries(modes)) plan[Number(m)] = planEntry(act, child, next);
  return plan;
}
const CHASE = [384, 64, -256, 0, 0] as const;
const R = 15; // a mode that rests

/** Planted plans. Each is written out by hand; with copy errors on, what grows later is not. */
export const ROAM_PLANS = {
  /** Eight cells in a row; the last one lets daughters go ahead of it. */
  line: roamPlan({ 0: [KF, 1, R], 1: [KF, 2, R], 2: [KF, 3, R], 3: [KF, 4, R], 4: [KF, 5, R], 5: [KF, 6, R], 6: [KF, 7, R], 7: [GF, 0, 7] }),
  /** Three by three; the middle of the front row lets daughters go. */
  plate: roamPlan({ 0: [KF, 1, 2], 1: [KF, 6, 2], 2: [KR, R, 3], 3: [KL, R, R], 6: [KR, R, 7], 7: [KL, R, 8], 8: [GF, 0, 8] }),
  /** Four arms of two cells; each arm's end lets daughters go. */
  cross: roamPlan({ 0: [KF, 4, 1], 1: [KR, 4, 2], 2: [KL, 4, 3], 3: [KB, 4, R], 4: [KF, 5, R], 5: [GF, 0, 5] }),
  /** Two by four; one corner lets daughters go. */
  block: roamPlan({ 0: [KF, 1, 2], 1: [KF, 3, 2], 3: [KF, 5, 2], 2: [KR, R, R], 5: [KR, R, 6], 6: [GF, 0, 6] }),
  /** Never keeps a daughter: every body is one cell. */
  speck: roamPlan({ 0: [GF, 0, 1], 1: [GR, 0, 2], 2: [GL, 0, 3], 3: [GB, 0, 0] }),
  /** Every cell keeps a daughter ahead, right and left: it branches until the size limit lets daughters go. */
  bush: roamPlan({ 0: [KF, 0, 1], 1: [KR, 0, 2], 2: [KL, 0, R] }),
} as const;

/** Founder types. Numbers are chase, drive, turn, adult, shape (each -512..512). */
export const ROAM_TYPES = {
  chaser: { name: 'chasers', genes: [384, 64, -256, 0, 0], colour: [240, 190, 62] },
  wanderer: { name: 'wanderers', genes: [0, 384, 0, 0, 0], colour: [96, 176, 255] },
  sitter: { name: 'sitters', genes: [0, 0, -512, 0, 0], colour: [232, 110, 150] },
  /** A chaser that lets every daughter go: a body is always one cell. */
  single: { name: 'single cells', genes: [384, 64, -256, -512, 0], colour: [120, 220, 200] },
  /** A chaser that keeps its daughters until the body is 16 cells. */
  big: { name: 'big bodies', genes: [384, 64, -256, 512, 0], colour: [200, 130, 240] },
  line: { name: 'lines', genes: CHASE, colour: [240, 190, 62], plan: ROAM_PLANS.line },
  plate: { name: 'plates', genes: CHASE, colour: [96, 176, 255], plan: ROAM_PLANS.plate },
  cross: { name: 'crosses', genes: CHASE, colour: [232, 110, 150], plan: ROAM_PLANS.cross },
  block: { name: 'blocks', genes: CHASE, colour: [150, 220, 110], plan: ROAM_PLANS.block },
  speck: { name: 'specks', genes: CHASE, colour: [120, 220, 200], plan: ROAM_PLANS.speck },
  bush: { name: 'bushes', genes: CHASE, colour: [200, 130, 240], plan: ROAM_PLANS.bush },
} as const satisfies Record<string, { name: string; genes: readonly number[]; colour: readonly number[]; plan?: readonly number[] }>;
export type RoamTypeId = keyof typeof ROAM_TYPES;
const planOf = (t: RoamTypeId): readonly number[] | undefined => (ROAM_TYPES[t] as { plan?: readonly number[] }).plan;

export const ROAM_STARTS = {
  chasers: ['chaser'],
  wanderers: ['wanderer'],
  sitters: ['sitter'],
  'chasers-sitters': ['chaser', 'sitter'],
  'chasers-wanderers': ['chaser', 'wanderer'],
  'chasers-singles': ['chaser', 'single'],
  singles: ['single'],
  bigs: ['big'],
  'chasers-bigs': ['chaser', 'big'],
  'grown-lines': ['line'],
  'grown-plates': ['plate'],
  'grown-crosses': ['cross'],
  'grown-blocks': ['block'],
  'grown-specks': ['speck'],
  'grown-bushes': ['bush'],
  'grown-four': ['line', 'plate', 'cross', 'block'],
  'grown-all': ['line', 'plate', 'cross', 'block', 'speck', 'bush'],
  all: ['chaser', 'wanderer', 'sitter'],
} as const satisfies Record<string, readonly RoamTypeId[]>;
export type RoamStart = keyof typeof ROAM_STARTS;

const TYPE_ORDER: readonly RoamTypeId[] = ['chaser', 'wanderer', 'sitter', 'single', 'big', 'line', 'plate', 'cross', 'block', 'speck', 'bush'];
/** Family number of a founder type (1 to 4), which every descendant keeps. */
export const roamFamily = (t: RoamTypeId): number => TYPE_ORDER.indexOf(t) + 1;

export interface RoamOptions {
  seed: number;
  size?: number;
  start?: RoamStart;
  /** Founder cells in all, dealt in turn to the types of the start. */
  founders?: number;
  /** Chance per gene that a daughter's copy differs. */
  mut?: number;
  /** With grown bodies: chance that a new body's plan differs in one place (2.5 times `mut` when absent). */
  planMut?: number;
  /** Matter per step a body at least twice another's size takes through each side where they touch (absent: none). */
  drain?: number;
  overrides?: Partial<RoamConfig>;
}

export function roamConfig(o: RoamOptions): RoamConfig {
  const cfg = defaultRoamConfig();
  cfg.seed = o.seed;
  if (o.size !== undefined) {
    // Matter and the patch rhythm follow the area, so a bigger arena is the same world with more room.
    const area = (o.size * o.size) / (cfg.size * cfg.size);
    cfg.matter = Math.round(cfg.matter * area);
    cfg.startPatches = Math.max(1, Math.round(cfg.startPatches * area));
    cfg.patchEvery = Math.max(1, Math.round(cfg.patchEvery / area));
    cfg.size = o.size;
  }
  if (o.mut !== undefined) cfg.mut = o.mut;
  if (o.drain !== undefined && o.drain > 0) cfg.drain = o.drain;
  const start = o.start ?? 'chasers';
  const merged: RoamConfig = { ...cfg, ...o.overrides };
  if (start in ROAM_STARTS && ROAM_STARTS[start].some((t) => planOf(t))) {
    merged.plan = true;
    // Unless a rate for plans is given, it follows the gene rate as finally set.
    if (o.overrides?.planMut === undefined) merged.planMut = o.planMut ?? Math.min(1, 2.5 * merged.mut);
  }
  return merged;
}

/** A world with its founders: single cells on hash-chosen free tiles, the types of the start taking turns. */
export function foundRoam(o: RoamOptions): RoamWorld {
  const start = o.start ?? 'chasers';
  if (!(start in ROAM_STARTS)) throw new Error(`Unknown start: ${start}`);
  const world = new RoamWorld(roamConfig(o));
  const types: readonly RoamTypeId[] = ROAM_STARTS[start];
  if (world.cfg.plan && !types.every((t) => planOf(t))) throw new Error(`Start ${start} mixes grown and gene-sized bodies`);
  const planIds = types.map((t) => (world.cfg.plan ? world.addPlan(planOf(t)!) : 0));
  const founders = o.founders ?? Math.max(types.length, Math.round((48 * world.n) / (128 * 128)));
  if (!Number.isSafeInteger(founders) || founders < 1) throw new Error(`Invalid founders: ${founders}`);
  let placed = 0;
  for (let tries = 0; placed < founders && tries < founders * 20; tries++) {
    const tile = roamHash(world.cfg.seed, 0, tries, 41) % world.n;
    const type = types[placed % types.length];
    if (world.found(tile, ROAM_TYPES[type].genes, roamFamily(type), undefined, planIds[placed % types.length])) placed++;
  }
  return world;
}

export type RoamPaint = 'family' | 'genes' | 'plan';

/** A colour for a plan number: neighbours in number are far apart in hue. */
export function roamPlanColour(pid: number): [number, number, number] {
  const h = ((pid * 0.61803398875) % 1) * 6;
  const light = 0.5 + 0.18 * (((pid * 7) % 5) / 4 - 0.5);
  const c = (1 - Math.abs(2 * light - 1)) * 0.8;
  const x = c * (1 - Math.abs((h % 2) - 1));
  const m = light - c / 2;
  const [r, g, b] = h < 1 ? [c, x, 0] : h < 2 ? [x, c, 0] : h < 3 ? [0, c, x] : h < 4 ? [0, x, c] : h < 5 ? [x, 0, c] : [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

/**
 * Paint the world at `scale` pixels per tile into `out` (RGBA). Ground is dark, greener with more food. A cell takes
 * its family's colour (or, in 'genes', red for chase, green for drive, blue for adult size), dimmer when its body is
 * hungry. A dark line separates cells of different bodies.
 */
export function paintRoam(world: RoamWorld, scale: number, paint: RoamPaint, out: Uint8ClampedArray | Uint8Array, bodyOf: Int32Array): void {
  const s = world.size;
  const side = s * scale;
  if (out.length !== side * side * 4) throw new Error('paintRoam: wrong buffer size');
  world.bodySizes(bodyOf);
  const full = 2 * world.cfg.birthStore;
  const colours = TYPE_ORDER.map((t) => ROAM_TYPES[t].colour);
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const i = y * s + x;
      let r: number, g: number, b: number;
      let gapE = false;
      let gapS = false;
      if (world.alive[i]) {
        const fed = 0.45 + 0.55 * Math.min(1, world.store[i] / full);
        if (paint === 'plan' && world.cfg.plan) {
          const c = roamPlanColour(world.pid[i]);
          r = c[0] * fed; g = c[1] * fed; b = c[2] * fed;
        } else if (paint === 'genes') {
          const q = (k: number) => 40 + ((world.genes[i * ROAM_GENES + k] + ROAM_GENE_MAX) * 215) / (2 * ROAM_GENE_MAX);
          r = q(0) * fed; g = q(1) * fed; b = q(G_ADULT) * fed;
        } else {
          const c = colours[(world.fam[i] - 1) % colours.length] ?? [200, 200, 200];
          r = c[0] * fed; g = c[1] * fed; b = c[2] * fed;
        }
        gapE = bodyOf[y * s + ((x + 1) % s)] !== bodyOf[i];
        gapS = bodyOf[((y + 1) % s) * s + x] !== bodyOf[i];
      } else {
        const f = Math.min(1, world.food[i] / 120);
        r = 13 + 30 * f; g = 19 + 120 * f; b = 17 + 40 * f;
      }
      for (let py = 0; py < scale; py++) {
        for (let px = 0; px < scale; px++) {
          const o = ((y * scale + py) * side + x * scale + px) * 4;
          const dark = scale >= 3 && ((gapE && px === scale - 1) || (gapS && py === scale - 1));
          out[o] = dark ? 13 : r;
          out[o + 1] = dark ? 19 : g;
          out[o + 2] = dark ? 17 : b;
          out[o + 3] = 255;
        }
      }
    }
  }
}

export interface RoamFamilyRow {
  family: number;
  name: string;
  colour: readonly number[];
  cells: number;
  /** Mean of each gene over the family's cells. */
  genes: number[];
}

export function roamFamilies(world: RoamWorld): RoamFamilyRow[] {
  const rows = TYPE_ORDER.map((t, k) => ({ family: k + 1, name: ROAM_TYPES[t].name, colour: ROAM_TYPES[t].colour, cells: 0, genes: new Array<number>(ROAM_GENES).fill(0) }));
  for (let i = 0; i < world.n; i++) {
    if (!world.alive[i]) continue;
    const row = rows[world.fam[i] - 1];
    if (!row) continue;
    row.cells++;
    for (let g = 0; g < ROAM_GENES; g++) row.genes[g] += world.genes[i * ROAM_GENES + g];
  }
  for (const row of rows) if (row.cells) row.genes = row.genes.map((g) => g / row.cells);
  return rows;
}

export interface RoamShape {
  /** The body's cells as [x, y] from its top-left corner, turned and flipped to one standard pose. */
  cells: number[][];
  w: number;
  h: number;
  /** How many bodies have this outline now, and a plan one of them carries. */
  count: number;
  pid: number;
  family: number;
}

/**
 * The outlines bodies have right now, the ones holding the most cells first (bodies with that outline times its
 * size), so one large body ranks above a few single cells. Two bodies have the same outline when one can be turned or
 * flipped onto the other. Also counts the plans alive.
 */
export function roamShapes(world: RoamWorld, top: number): { shapes: RoamShape[]; outlines: number; plans: number } {
  const s = world.size;
  const seen = new Uint8Array(world.n);
  const found = new Map<string, RoamShape>();
  const plans = new Set<number>();
  const xs: number[] = [];
  const ys: number[] = [];
  const queue: number[] = [];
  for (let i = 0; i < world.n; i++) {
    if (!world.alive[i] || seen[i]) continue;
    plans.add(world.pid[i]);
    xs.length = ys.length = queue.length = 0;
    seen[i] = 1;
    queue.push(i); xs.push(0); ys.push(0);
    for (let q = 0; q < queue.length; q++) {
      const c = queue[q];
      const x = c % s;
      const y = (c - x) / s;
      const e = y * s + ((x + 1) % s);
      const so = ((y + 1) % s) * s + x;
      const w = y * s + ((x + s - 1) % s);
      const no = ((y + s - 1) % s) * s + x;
      if (world.bondE[c] && !seen[e]) { seen[e] = 1; queue.push(e); xs.push(xs[q] + 1); ys.push(ys[q]); }
      if (world.bondS[c] && !seen[so]) { seen[so] = 1; queue.push(so); xs.push(xs[q]); ys.push(ys[q] + 1); }
      if (world.bondE[w] && !seen[w]) { seen[w] = 1; queue.push(w); xs.push(xs[q] - 1); ys.push(ys[q]); }
      if (world.bondS[no] && !seen[no]) { seen[no] = 1; queue.push(no); xs.push(xs[q]); ys.push(ys[q] - 1); }
    }
    // A body that reaches all the way round the arena has no top-left corner, and the walk along its bonds can lay
    // the same cells out in more than one way. For those, take the cells where they are on the arena and try every
    // cell as the corner.
    const span = (v: number[]) => Math.max(...v) - Math.min(...v) + 1;
    const round = span(xs) >= s || span(ys) >= s;
    const origins = round ? queue.length : 1;
    let best = '';
    let bestCells: number[][] = [];
    for (let o = 0; o < origins; o++) {
      const ox = queue[o] % s;
      const oy = (queue[o] - ox) / s;
      for (let sym = 0; sym < 8; sym++) {
        const pts = queue.map((c, j) => {
          let px = round ? (c % s) - ox : xs[j];
          let py = round ? Math.floor(c / s) - oy : ys[j];
          if (sym & 4) px = -px;
          for (let turn = 0; turn < (sym & 3); turn++) [px, py] = [-py, px];
          // Round the arena, a place is only known up to whole turns of it: fold after turning and flipping.
          return round ? [((px % s) + s) % s, ((py % s) + s) % s] : [px, py];
        });
        if (!round) {
          const minX = Math.min(...pts.map((p) => p[0]));
          const minY = Math.min(...pts.map((p) => p[1]));
          for (const p of pts) { p[0] -= minX; p[1] -= minY; }
        }
        pts.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
        const key = pts.map((p) => `${p[0]},${p[1]}`).join(' ');
        if (best === '' || key < best) { best = key; bestCells = pts; }
      }
    }
    const have = found.get(best);
    if (have) have.count++;
    else found.set(best, { cells: bestCells, w: 1 + Math.max(...bestCells.map((p) => p[0])), h: 1 + Math.max(...bestCells.map((p) => p[1])), count: 1, pid: world.pid[i], family: world.fam[i] });
  }
  const shapes = [...found.values()].sort((a, b) => b.count * b.cells.length - a.count * a.cells.length || b.cells.length - a.cells.length);
  return { shapes: shapes.slice(0, top), outlines: shapes.length, plans: plans.size };
}

/**
 * How far cells travelled between two looks: remembers where every cell (by serial number) was, and on the next call
 * gives the mean straight-line distance of the cells still alive, in tiles (shortest way round the torus).
 */
export function roamTravel(world: RoamWorld): () => { cells: number; mean: number; movedShare: number } {
  let before = new Map<number, number>();
  return () => {
    const s = world.size;
    const now = new Map<number, number>();
    let cells = 0;
    let sum = 0;
    let moved = 0;
    for (let i = 0; i < world.n; i++) {
      if (!world.alive[i]) continue;
      now.set(world.cid[i], i);
      const was = before.get(world.cid[i]);
      if (was === undefined) continue;
      let dx = Math.abs((i % s) - (was % s));
      let dy = Math.abs(Math.floor(i / s) - Math.floor(was / s));
      if (dx > s / 2) dx = s - dx;
      if (dy > s / 2) dy = s - dy;
      const d = Math.hypot(dx, dy);
      cells++;
      sum += d;
      if (d >= 2) moved++;
    }
    before = now;
    return { cells, mean: cells ? sum / cells : 0, movedShare: cells ? moved / cells : 0 };
  };
}

export interface RoamFrame {
  side: number;
  pixels: Uint8ClampedArray;
  census: RoamCensus;
  families: RoamFamilyRow[];
  /** Splits, releases and body deaths per 1,000 steps over the last stretch, and how far cells travelled in it. */
  rates: { steps: number; divisions: number; releases: number; bodyDeaths: number; newbornDeaths: number; patches: number; travel: number; movedShare: number; drained: number };
  /** The most common body outlines, how many outlines and plans are alive, and whether bodies grow by plan. */
  shapes: RoamShape[];
  outlines: number;
  plans: number;
  planned: boolean;
  /** Plans there have ever been in this run. */
  plansEver: number;
}

export type RoamToWorker = { type: 'reset'; gen: number; opts: RoamOptions; scale: number; paint: RoamPaint } | { type: 'tick'; gen: number; steps: number; paint: RoamPaint };
export type RoamFromWorker = { type: 'frame'; gen: number; frame: RoamFrame } | { type: 'error'; gen: number; message: string };

const RATE_EVERY = 200;

/** A world plus what the page shows of it. */
export class RoamSession {
  readonly world: RoamWorld;
  private readonly scale: number;
  private readonly bodyOf: Int32Array;
  private readonly travel: () => { cells: number; mean: number; movedShare: number };
  private last: RoamCensus;
  private rates: RoamFrame['rates'] = { steps: 0, divisions: 0, releases: 0, bodyDeaths: 0, newbornDeaths: 0, patches: 0, travel: 0, movedShare: 0, drained: 0 };

  constructor(opts: RoamOptions, scale: number) {
    this.world = foundRoam(opts);
    this.scale = scale;
    this.bodyOf = new Int32Array(this.world.n);
    this.travel = roamTravel(this.world);
    this.travel();
    this.last = this.world.census();
  }

  /** Step up to `steps` times, stopping early after `budgetMs`. */
  advance(steps: number, budgetMs: number): void {
    const t0 = performance.now();
    for (let i = 0; i < steps; i++) {
      this.world.stepOnce();
      if (this.world.step % RATE_EVERY === 0) {
        const c = this.world.census();
        const tr = this.travel();
        const per = 1000 / RATE_EVERY;
        this.rates = {
          steps: RATE_EVERY,
          divisions: (c.divisions - this.last.divisions) * per,
          releases: (c.releases - this.last.releases) * per,
          bodyDeaths: (c.bodyDeaths - this.last.bodyDeaths) * per,
          newbornDeaths: (c.newbornDeaths - this.last.newbornDeaths) * per,
          patches: (c.patches - this.last.patches) * per,
          drained: (c.drained - this.last.drained) * per,
          travel: tr.mean,
          movedShare: tr.movedShare,
        };
        this.last = c;
      }
      if ((i & 7) === 7 && performance.now() - t0 > budgetMs) break;
    }
  }

  frame(paint: RoamPaint): RoamFrame {
    const side = this.world.size * this.scale;
    const pixels = new Uint8ClampedArray(side * side * 4);
    paintRoam(this.world, this.scale, paint, pixels, this.bodyOf);
    const sh = roamShapes(this.world, 12);
    return { side, pixels, census: this.world.census(), families: roamFamilies(this.world), rates: this.rates, shapes: sh.shapes, outlines: sh.outlines, plans: sh.plans, planned: !!this.world.cfg.plan, plansEver: this.world.plans.length - 1 };
  }
}
