// Damage operators: synthetic occupancy deletion on binary patches (PLAN R10). Loosely modelled on the disc geometry of
// applyLesion; it does not mirror it (no B/P to C conversion, no heat, no lineage reset). Pure integer functions of seeds.
import { rnd } from "../../predictability/movie.ts";
import { cx, cy } from "../grammar.ts";
import { DPROTOCOL } from "./protocol.ts";

const W = DPROTOCOL.patch.w, H = DPROTOCOL.patch.h;

/** A placed object: cells normalised to their min corner, translated by `at` on the torus. */
export interface Obj { cells: number[]; at: [number, number] }
export type Pt = [number, number];

export const worldCells = (o: Obj): Pt[] => o.cells.map((c) => [(cx(c) + o.at[0]) % W, (cy(c) + o.at[1]) % H] as Pt);

/** Paint objects (and loose cells) onto a frame; overlapping cells are a bug, never silently merged. */
export function paint(objs: readonly Obj[], loose: readonly Pt[] = []): Uint8Array {
  const f = new Uint8Array(W * H);
  const put = ([x, y]: Pt) => { if (f[y * W + x]) throw new Error("overlapping cells"); f[y * W + x] = 1; };
  for (const o of objs) for (const p of worldCells(o)) put(p);
  for (const p of loose) put(p);
  return f;
}
export const occupiedOf = (f: Uint8Array): number => { let n = 0; for (let i = 0; i < f.length; i++) n += f[i]; return n; };

export interface Damaged {
  /** Objects with no cell in the disc: whole, kept. */
  intact: Obj[];
  /** Surviving cells of hit objects (fragments). They are swept at the start of regrowth. */
  fragments: Pt[];
  removedMass: number;
  sweptMass: number;
  /** The patch right after damage (intact objects and fragments). */
  frame: Uint8Array;
}

const torus = (a: number, b: number, n: number): number => { const d = Math.abs(a - b); return Math.min(d, n - d); };

/** Disc removal on the occupancy grid. The centre is a cell of a PRNG-chosen object so the lesion always hits something. */
export function lesionPartial(objs: readonly Obj[], seed: number, rep: number): Damaged {
  const o = objs[rnd(seed, rep, 0xd15c) % objs.length];
  const cells = worldCells(o);
  const [px, py] = cells[rnd(seed, rep, 0xce11) % cells.length];
  const r2 = DPROTOCOL.lesionRadius * DPROTOCOL.lesionRadius;
  const inDisc = ([x, y]: Pt): boolean => torus(x, px, W) ** 2 + torus(y, py, H) ** 2 <= r2;
  const intact: Obj[] = [];
  const fragments: Pt[] = [];
  let removed = 0;
  for (const ob of objs) {
    const pts = worldCells(ob);
    const hit = pts.filter(inDisc).length;
    if (hit === 0) { intact.push(ob); continue; }
    removed += hit;
    for (const p of pts) if (!inDisc(p)) fragments.push(p);
  }
  return { intact, fragments, removedMass: removed, sweptMass: fragments.length, frame: paint(intact, fragments) };
}

/** All objects of the target class destroyed (objects of other classes survive whole). */
export function lesionTotal(objs: readonly Obj[], isTarget: (o: Obj) => boolean): Damaged {
  const intact = objs.filter((o) => !isTarget(o));
  const removed = objs.filter(isTarget).reduce((s, o) => s + o.cells.length, 0);
  return { intact, fragments: [], removedMass: removed, sweptMass: 0, frame: paint(intact) };
}

/** Occupancy-matched spatial randomisation of the whole patch: same number of cells, each at a PRNG-chosen free cell. */
export function scramble(mass: number, seed: number, rep: number): Uint8Array {
  const f = new Uint8Array(W * H);
  for (let i = 0; i < mass; i++) {
    const free: number[] = [];
    for (let c = 0; c < f.length; c++) if (!f[c]) free.push(c);
    f[free[rnd(seed, rep, 0x5c4a + i) % free.length]] = 1;
  }
  return f;
}
