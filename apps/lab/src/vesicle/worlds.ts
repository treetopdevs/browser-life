// Starting worlds for the vesicle sandbox, shared by the lab page and the headless runner.
import { VesicleWorld } from './model.ts';
import type { Params } from './model.ts';

/** Chemistry on: solute copies itself from food in company, makes lipid, decays; light turns waste to food. */
export const METABOLISM: Partial<Params> = {
  kRep: 0.01, kDecay: 0.0005, kLip: 0.02, kLight: 0.002, kLipDecay: 0.002,
};

export interface GardenOpts { founders?: number; solute?: number; radius?: number; food?: number; lipid?: number; params?: Partial<Params> }

/** A dish with a few founder vesicles, each with its own founder id, food and a little free lipid. */
export function garden(seed: number, o: GardenOpts = {}): VesicleWorld {
  const w = new VesicleWorld(seed, { ...METABOLISM, ...o.params });
  const k = o.founders ?? 6, r = o.radius ?? 8, { W, H } = w.p;
  const cols = Math.ceil(Math.sqrt(k)), rows = Math.ceil(k / cols);
  for (let f = 0; f < k; f++) {
    const cx = (W * ((f % cols) + 0.5)) / cols + (w.rand() - 0.5) * 6, cy = (H * (Math.floor(f / cols) + 0.5)) / rows + (w.rand() - 0.5) * 6;
    w.addLoop(cx, cy, r);
    w.addSolute(cx, cy, r - 2, o.solute ?? 60, 128, f + 1);
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
