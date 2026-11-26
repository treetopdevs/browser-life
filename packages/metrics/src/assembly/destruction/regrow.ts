// Regrowth rules: the process under test. Input is (process, store, rng seed, the surviving whole objects); the pre-damage
// patch and the reference key are never passed here (PLAN R9). Only template-* read the surviving patch, by definition.
import { rnd } from "../../predictability/movie.ts";
import { canonicalKey, cx, cy, normalise, toPoints } from "../grammar.ts";
import { growShape, I3, SQUARE_4X4 } from "../fixtures.ts";
import { DPROTOCOL, type ProcessId } from "./protocol.ts";
import { occupiedOf, paint, worldCells, type Obj } from "./damage.ts";

const W = DPROTOCOL.patch.w, H = DPROTOCOL.patch.h, M = DPROTOCOL.patch.mass;

/** What a process holds outside the patch. `null` = store deleted (ablation arm). */
export type Store =
  | { kind: "program"; unit: number[]; steps: [number, number][] }
  | { kind: "image"; cells: number[] }
  | null;

/** Build the object a program describes: start from the unit; each step joins a copy of the whole with a shifted copy. */
export function runProgram(unit: readonly number[], steps: readonly (readonly [number, number])[]): number[] {
  let cur = toPoints(unit);
  for (const [dx, dy] of steps) cur = [...cur, ...cur.map(([x, y]) => [x + dx, y + dy] as [number, number])];
  return normalise(cur);
}

export const HIER_PROGRAM: Store = { kind: "program", unit: I3, steps: [[1, 0], [2, 1]] };
/** A different program (steps differ in the last shift): builds a solid 4 x 3 block, a different 12-cell class. */
export const WRONG_PROGRAM: Store = { kind: "program", unit: I3, steps: [[1, 0], [2, 0]] };

export function storeFor(id: ProcessId, ablated: boolean, hierCells: readonly number[]): Store {
  if (ablated) return null;
  if (id === "builder-hier12") return HIER_PROGRAM;
  if (id === "stored-image-renderer") return { kind: "image", cells: hierCells.slice() };
  if (id === "wrong-store-builder") return WRONG_PROGRAM;
  return null;
}

export interface RegrowResult {
  /** Final objects (survivors plus regrown). */
  objs: Obj[];
  /** Frame after each round (length = rounds). */
  roundFrames: Uint8Array[];
  /** Mass added by regrowth operations (counted per operation, independent of the frame). */
  regrownMass: number;
  objectsAdded: number;
}

const bboxOf = (cells: readonly number[]) => { let mx = 0, my = 0; for (const c of cells) { mx = Math.max(mx, cx(c)); my = Math.max(my, cy(c)); } return [mx + 1, my + 1] as const; };

/** True iff the object at `at` overlaps no occupied cell and touches none under 8-connectivity on the torus. */
function fits(frame: Uint8Array, cells: readonly number[], at: readonly [number, number]): boolean {
  for (const c of cells) {
    const x = cx(c) + at[0], y = cy(c) + at[1];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (frame[(((y + dy) % H + H) % H) * W + (((x + dx) % W + W) % W)]) return false;
  }
  return true;
}

function sites(pitch: number): [number, number][] {
  const out: [number, number][] = [];
  const cols = Math.floor(W / pitch), rows = Math.floor(H / pitch);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) out.push([c * pitch, r * pitch]);
  return out;
}

const keyOf = (cells: readonly number[]): string => canonicalKey(cells);

export function regrow(id: ProcessId, store: Store, seed: number, survivors: readonly Obj[]): RegrowResult {
  const objs: Obj[] = survivors.slice();
  const frame = paint(objs);
  const roundFrames: Uint8Array[] = [];
  let regrown = 0, added = 0, nth = 0;
  const squareKey = keyOf(SQUARE_4X4);
  // fresh-random: one plain K=1 draw (no scoring), separate from the initial motif
  const freshCells = id === "fresh-random-dup12" ? growShape(12, DPROTOCOL.motifBox, rnd(seed, 0xf2e5, 0)) : null;
  let nucleus: Obj | null = null;

  const put = (cells: number[], at: [number, number]): Obj => {
    const o = { cells, at };
    for (const [x, y] of worldCells(o)) frame[y * W + x] = 1;
    objs.push(o);
    return o;
  };
  const pickSite = (cells: readonly number[], pitch: number, near?: (s: [number, number]) => boolean): [number, number] | null => {
    let list = sites(pitch).filter((s) => fits(frame, cells, s));
    if (near) { const adj = list.filter(near); if (adj.length) list = adj; }
    if (list.length === 0) return null;
    return list[rnd(seed, nth, 0xa11) % list.length];
  };
  const objectFor = (): number[] | null => {
    switch (id) {
      case "builder-hier12": case "wrong-store-builder":
        return store && store.kind === "program" ? runProgram(store.unit, store.steps) : null;
      case "stored-image-renderer":
        return store && store.kind === "image" ? store.cells.slice() : null;
      case "template-hier12": case "template-dup12": {
        if (survivors.length === 0) return null;
        return survivors[rnd(seed, nth, 0x7e) % survivors.length].cells.slice();
      }
      case "fresh-random-dup12": return freshCells;
      case "inert-scatter": return [0];
      default: return null;
    }
  };
  const pitchFor = id === "inert-scatter" ? DPROTOCOL.pitch.monomer : DPROTOCOL.pitch.object;

  let stop = false;
  for (let r = 0; r < DPROTOCOL.rounds; r++) {
    if (id === "accretion-crystal") {
      if (!stop) {
        if (nucleus && nucleus.cells.length < SQUARE_4X4.length) {
          // edge accretion: the nucleus gains a row and a column (side 2 -> 3 -> 4)
          const side = Math.round(Math.sqrt(nucleus.cells.length)) + 1;
          const grown = normalise(Array.from({ length: side * side }, (_, i) => [i % side, Math.floor(i / side)] as [number, number]));
          for (const [x, y] of worldCells(nucleus)) frame[y * W + x] = 0;
          objs.splice(objs.indexOf(nucleus), 1);
          if (!fits(frame, grown, nucleus.at)) { stop = true; } else {
            const before = nucleus.cells.length;
            nucleus = put(grown, nucleus.at);
            regrown += grown.length - before;
          }
          if (stop) { const old = put(nucleus.cells, nucleus.at); nucleus = old; }
          nth++;
        } else {
          const squares = objs.filter((o) => keyOf(o.cells) === squareKey);
          for (let k = 0; k < DPROTOCOL.objectsPerRound; k++) {
            if (occupiedOf(frame) + SQUARE_4X4.length > M) { stop = true; break; }
            let cells: number[], site: [number, number] | null;
            if (squares.length === 0 && !nucleus) {
              const s = DPROTOCOL.crystalSeedSide;
              cells = normalise(Array.from({ length: s * s }, (_, i) => [i % s, Math.floor(i / s)] as [number, number]));
              site = pickSite(cells, DPROTOCOL.pitch.crystal);
              if (!site) { stop = true; break; }
              nucleus = put(cells, site); regrown += cells.length; added++; nth++;
              break;
            }
            cells = SQUARE_4X4;
            // edge accretion at the lattice: a free site next (on the pitch lattice) to an existing square
            const P = DPROTOCOL.pitch.crystal;
            const have = new Set(objs.filter((o) => keyOf(o.cells) === squareKey).map((o) => `${o.at[0]},${o.at[1]}`));
            const cols = Math.floor(W / P), rows = Math.floor(H / P);
            const wrap = (i: number, n: number): number => ((i % n) + n) % n;
            const near = (s: [number, number]): boolean => ([[1, 0], [-1, 0], [0, 1], [0, -1]] as const).some(([dx, dy]) =>
              have.has(`${wrap(s[0] / P + dx, cols) * P},${wrap(s[1] / P + dy, rows) * P}`));
            site = pickSite(cells, P, near);
            if (!site) { stop = true; break; }
            squares.push(put(cells, site)); regrown += cells.length; added++; nth++;
          }
        }
      }
    } else {
      for (let k = 0; k < DPROTOCOL.objectsPerRound && !stop; k++) {
        const cells = objectFor();
        if (!cells) { stop = true; break; }
        if (occupiedOf(frame) + cells.length > M) { stop = true; break; }
        const [bw, bh] = bboxOf(cells);
        if (bw >= pitchFor + 1 || bh >= pitchFor + 1) throw new Error("object does not fit the site pitch");
        const site = pickSite(cells, pitchFor);
        if (!site) { stop = true; break; }
        put(cells, site); regrown += cells.length; added++; nth++;
      }
    }
    roundFrames.push(frame.slice());
  }
  return { objs, roundFrames, regrownMass: regrown, objectsAdded: added };
}
