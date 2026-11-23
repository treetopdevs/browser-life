/** Starting line-ups, pictures and readouts for the roam world, shared by the local page and the headless look. */

import { defaultRoamConfig, G_ADULT, roamHash, ROAM_GENE_MAX, ROAM_GENES, type RoamCensus, type RoamConfig, RoamWorld } from './kernel.ts';

/** Founder types. Numbers are chase, drive, turn, adult, shape (each -512..512). */
export const ROAM_TYPES = {
  chaser: { name: 'chasers', genes: [384, 64, -256, 0, 0], colour: [240, 190, 62] },
  wanderer: { name: 'wanderers', genes: [0, 384, 0, 0, 0], colour: [96, 176, 255] },
  sitter: { name: 'sitters', genes: [0, 0, -512, 0, 0], colour: [232, 110, 150] },
} as const;
export type RoamTypeId = keyof typeof ROAM_TYPES;

export const ROAM_STARTS = {
  chasers: ['chaser'],
  wanderers: ['wanderer'],
  sitters: ['sitter'],
  'chasers-sitters': ['chaser', 'sitter'],
  'chasers-wanderers': ['chaser', 'wanderer'],
  all: ['chaser', 'wanderer', 'sitter'],
} as const satisfies Record<string, readonly RoamTypeId[]>;
export type RoamStart = keyof typeof ROAM_STARTS;

const TYPE_ORDER: readonly RoamTypeId[] = ['chaser', 'wanderer', 'sitter'];
/** Family number of a founder type (1, 2, 3), which every descendant keeps. */
export const roamFamily = (t: RoamTypeId): number => TYPE_ORDER.indexOf(t) + 1;

export interface RoamOptions {
  seed: number;
  size?: number;
  start?: RoamStart;
  /** Founder cells in all, dealt in turn to the types of the start. */
  founders?: number;
  /** Chance per gene that a daughter's copy differs. */
  mut?: number;
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
  return { ...cfg, ...o.overrides };
}

/** A world with its founders: single cells on hash-chosen free tiles, the types of the start taking turns. */
export function foundRoam(o: RoamOptions): RoamWorld {
  const start = o.start ?? 'chasers';
  if (!(start in ROAM_STARTS)) throw new Error(`Unknown start: ${start}`);
  const world = new RoamWorld(roamConfig(o));
  const types = ROAM_STARTS[start];
  const founders = o.founders ?? Math.max(types.length, Math.round((48 * world.n) / (128 * 128)));
  let placed = 0;
  for (let tries = 0; placed < founders && tries < founders * 20; tries++) {
    const tile = roamHash(world.cfg.seed, 0, tries, 41) % world.n;
    const type = types[placed % types.length];
    if (world.found(tile, ROAM_TYPES[type].genes, roamFamily(type))) placed++;
  }
  return world;
}

export type RoamPaint = 'family' | 'genes';

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
        if (paint === 'genes') {
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
  rates: { steps: number; divisions: number; releases: number; bodyDeaths: number; patches: number; travel: number; movedShare: number };
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
  private rates: RoamFrame['rates'] = { steps: 0, divisions: 0, releases: 0, bodyDeaths: 0, patches: 0, travel: 0, movedShare: 0 };

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
          patches: (c.patches - this.last.patches) * per,
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
    return { side, pixels, census: this.world.census(), families: roamFamilies(this.world), rates: this.rates };
  }
}
