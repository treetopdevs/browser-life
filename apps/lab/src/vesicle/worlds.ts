// Starting worlds for the vesicle sandbox, shared by the lab page and the headless runner.
import { VesicleWorld } from './model.ts';
import type { Params } from './model.ts';
import { loops, ringCount } from './observe.ts';

/** Chemistry on: solute copies itself from food in company, makes lipid, decays; light turns waste to food. */
export const METABOLISM: Partial<Params> = {
  kRep: 0.01, kDecay: 0.0005, kLip: 0.02, kLight: 0.002, kLipDecay: 0.002,
};

export interface GardenOpts { founders?: number; solute?: number; radius?: number; food?: number; lipid?: number; params?: Partial<Params>;
  /** Lipid-share byte the founders start with (walls and solute alike), default 128. A list gives one value per founder in turn. */
  founderGene?: number | number[];
  /** Every founder starts as a chimera: half of its wall (and of its solute) carries the first share, half the second. */
  chimera?: [number, number];
  /** With threads on: the marker gene (gene 1) each founder's thread starts with, default 128. A list gives one value per founder in turn. */
  founderMark?: number | number[] }

/** A dish with a few founder vesicles, each with its own founder id, food and a little free lipid. */
export function garden(seed: number, o: GardenOpts = {}): VesicleWorld {
  const w = new VesicleWorld(seed, { ...METABOLISM, ...o.params });
  const k = o.founders ?? 6, r = o.radius ?? 8, { W, H } = w.p;
  const cols = Math.ceil(Math.sqrt(k)), rows = Math.ceil(k / cols);
  for (let f = 0; f < k; f++) {
    const cx = (W * ((f % cols) + 0.5)) / cols + (w.rand() - 0.5) * 6, cy = (H * (Math.floor(f / cols) + 0.5)) / rows + (w.rand() - 0.5) * 6;
    const fg = o.founderGene, g = fg === undefined ? 128 : typeof fg === 'number' ? fg : fg[f % fg.length];
    const first = w.addLoop(cx, cy, r, undefined, g), n = o.solute ?? 60;
    if (o.chimera) {
      let beads = 1;
      for (let i = w.next[first]; i !== first; i = w.next[i]) beads++;
      // which half gets which share alternates from founder to founder
      // (and the idle marker names the founder, so with shifts off every bead says which founder's wall it descends from)
      for (let i = first, k = 0; k < beads; k++, i = w.next[i]) { w.wgene[i] = o.chimera[(k < beads >> 1 ? 0 : 1) ^ (f & 1)]; w.wmark[i] = f + 1; }
      w.addSolute(cx, cy, r - 2, n >> 1, o.chimera[0], f + 1); w.addSolute(cx, cy, r - 2, n - (n >> 1), o.chimera[1], f + 1);
    } else w.addSolute(cx, cy, r - 2, n, g, f + 1);
    if (w.p.thread) {
      // one thread per founder, carrying the founder's lipid share and its marker
      const fm = o.founderMark, mk = fm === undefined ? 128 : typeof fm === 'number' ? fm : fm[f % fm.length];
      w.addThread(cx, cy, [g, mk]);
    }
  }
  w.scatter(w.food, o.food ?? 2 * w.food.length);
  w.scatter(w.lipid, o.lipid ?? Math.floor(w.lipid.length / 4));
  return w;
}

/** Heredity on: each copy of a solute particle may shift its lipid share and its idle marker byte. */
export const HEREDITY: Partial<Params> = { mut: 0.1, mutStep: 16 };

/** Mechanics only: two vesicles and a fixed stock of lipid. The crowded one takes wall from the other. */
export function theftWorld(seed: number): VesicleWorld {
  const w = new VesicleWorld(seed, { W: 128, H: 64 });
  w.addLoop(38, 32, 10); w.addSolute(38, 32, 8, 240, 128, 1);
  w.addLoop(90, 32, 10); w.addSolute(90, 32, 8, 60, 128, 2);
  return w;
}

/** Mechanics only: one vesicle in a bath of spare lipid. The wall outgrows the contents and necks close. */
export function feedWorld(seed: number): VesicleWorld {
  const w = new VesicleWorld(seed, { W: 96, H: 96 });
  w.addLoop(48, 48, 10); w.addSolute(48, 48, 8, 120, 128, 1); w.scatter(w.lipid, 550);
  return w;
}

/** Rung 3: the bytes live in the wall. Wall beads are replaced about every hundred steps, far more often than
 *  solute copies, so the shift rate per copy is a tenth of rung 2's. */
export const WALL_GENES: Partial<Params> = { mut: 0.01, mutStep: 16, wallGenes: true };

/** Control for rung 3: rung 2's heredity (bytes on self-copying solute) with rung 3's rule that solute is only
 *  made against the inner face of a wall. */
export const WALL_GATE: Partial<Params> = { ...HEREDITY, wallGate: true };

/** Stage 1, the thread: a genome that is one physical object per cell (free-floating). Solute copies only next to a
 *  thread and takes its lipid share from it; the thread copies about once per cell generation. The shift rate is per
 *  thread copy, as rare as a cell division, so it is as high as rung 2's. */
export const THREAD: Partial<Params> = { mut: 0.1, mutStep: 16, thread: true };

/** The base dish edge, and how many founders it is seeded with. */
export const BASE_EDGE = 192, BASE_FOUNDERS = 6;

/** The dish for "wild" worlds: `area` times the base dish's area (a perfect square: 1, 4, 9, 16), seeded with
 *  proportionally many founders. */
export function wildDish(area: number): { W: number; H: number; founders: number } {
  const L = Math.round(Math.sqrt(area));
  if (L * L !== area || L < 1) throw new Error('wild area must be a square number: 1, 4, 9 or 16');
  return { W: BASE_EDGE * L, H: BASE_EDGE * L, founders: BASE_FOUNDERS * area };
}

/** Stage 3, "make dividing pay": a big dish, light in drifting patches, and weather. Composes with any heredity arm.
 *  - Dish: `area` times the base area (4 unless told otherwise), `founders` seeded in proportion; the particle and bead stores are raised to hold it.
 *  - Light: patches of radius 48 cover about a quarter of the dish (their number is set from the dish), drift at 0.004 per step
 *    (about two dish widths in 400,000 steps; a cell moves its own radius in about 2,000 steps) and wrap round; the rate inside
 *    is raised by the unlit share so that the dish's mean light equals the uniform case's.
 *  - Weather: one ring (picked by the runner's own generator) is burst per `weatherRings` ring-steps, counted on the rings there
 *    are now: 100,000 is one ring per 5,000 steps per 20 rings (a generation is 4,000 to 6,000 steps), however many cells the dish
 *    holds. (It was a fixed interval of 100,000 / founders steps until 2026-11-20, which grew weaker as the cells multiplied.)
 *    The lab page and the runner both use `Weather`.
 *  Passing `lit: false` or `weather: false` leaves that part out. */
export function wild(area = 4, o: { lit?: boolean; weather?: boolean } = {}): { params: Partial<Params>; founders: number; weatherRings: number | undefined } {
  const d = wildDish(area), R = 48, patches = Math.max(1, Math.round((0.25 * d.W * d.H) / (Math.PI * R * R)));
  return {
    params: {
      W: d.W, H: d.H, maxBeads: Math.max(1 << 15, area * (1 << 13)), maxParts: Math.max(1 << 16, area * (1 << 14)), maxThreads: Math.max(4096, area * 1024),
      ...(o.lit === false ? {} : { lightPatches: patches, patchR: R, patchSpeed: 0.004 }),
    },
    founders: d.founders,
    weatherRings: o.weather === false ? undefined : 100000,
  };
}

/** Weather, picked by this object's own generator (the kernel's stream is untouched): with `every` > 0, one ring is burst every
 *  `every` steps (as the runner's `--wound-every` always did); otherwise, with `ringSteps` > 0, each step adds the number of rings
 *  to a count and a ring is burst whenever the count reaches `ringSteps` (which is then taken off it). Call `after(world, step)`
 *  after each tick. */
export class Weather {
  private s: number; private acc = 0; private seen = new Uint8Array(0); wounds = 0; readonly every: number; readonly ringSteps: number;
  constructor(seed: number, every: number, ringSteps = 0) { this.s = (seed * 2654435761) >>> 0; this.every = every; this.ringSteps = ringSteps; }
  after(w: VesicleWorld, t: number): void {
    if (this.every) { if (t % this.every !== 0) return; }
    else if (this.ringSteps > 0) {
      if (this.seen.length < w.beadHi) this.seen = new Uint8Array(w.p.maxBeads);
      this.acc += ringCount(w, this.seen);
      while (this.acc >= this.ringSteps) { this.acc -= this.ringSteps; this.burst(w); }
      return;
    } else return;
    this.burst(w);
  }
  private burst(w: VesicleWorld): void {
    const ls = loops(w, false);
    this.s = (Math.imul(this.s, 1664525) + 1013904223) >>> 0;
    if (ls.length) { w.dissolveLoop(ls[this.s % ls.length].first); this.wounds++; }
  }
}
