// Starting worlds for the vesicle sandbox, shared by the lab page and the headless runner.
import { VesicleWorld } from './model.ts';
import type { Params } from './model.ts';

/** Chemistry on: solute copies itself from food in company, makes lipid, decays; light turns waste to food. */
export const METABOLISM: Partial<Params> = {
  kRep: 0.01, kDecay: 0.0005, kLip: 0.02, kLight: 0.002, kLipDecay: 0.002,
};

export interface GardenOpts { founders?: number; solute?: number; radius?: number; food?: number; lipid?: number; params?: Partial<Params>;
  /** Lipid-share byte the founders start with (walls and solute alike), default 128. A list gives one value per founder in turn. */
  founderGene?: number | number[];
  /** Every founder starts as a chimera: half of its wall (and of its solute) carries the first share, half the second. */
  chimera?: [number, number] }

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
