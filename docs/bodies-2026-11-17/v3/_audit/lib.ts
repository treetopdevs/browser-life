import { BodiesWorld } from '../../../../apps/lab/src/bodies/model.ts';
import type { Rules, WorldOptions } from '../../../../apps/lab/src/bodies/model.ts';
export const at = (x: number, y: number) => y * 96 + x;
export function blank(rules: Partial<Rules> = {}, extra: Partial<WorldOptions> = {}): BodiesWorld {
  const w = new BodiesWorld({ seed: 1, founders: 1, positions: [], upkeep: false, rules: { SUPPLY: 0, ORPH16: 0, ORPHP: 0, ...rules }, ...extra });
  w.food.fill(0); w.initialMatter = w.matterTotal(); return w;
}
export function put(w: BodiesWorld, x: number, y: number, o: { store?: number; d?: number; kin?: number; tol?: number; g1?: number; g0?: number } = {}): number {
  const i = at(x, y);
  w.cell[i] = 1; w.store[i] = o.store ?? 0; w.d[i] = o.d ?? 255; w.kin[i] = o.kin ?? 0; w.kinTol[i] = o.tol ?? w.R.TAG_TOL;
  w.g0[i] = o.g0 ?? 16; w.g1[i] = o.g1 ?? 60; w.g2[i] = 0; w.g3[i] = 0;
  w.initialMatter = w.matterTotal(); return i;
}
