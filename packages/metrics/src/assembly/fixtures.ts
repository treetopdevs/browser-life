// Matched-mass synthetic calibration patches (PROTOCOL.md 3). Pure integer functions of (class, replicate, protocol).
import { rnd } from "../predictability/movie.ts";
import { canonicalKey, code, cx, cy, isConnected, normalise, toPoints } from "./grammar.ts";
import { PROTOCOL } from "./protocol.ts";
import { exactConstruction } from "./exact.ts";
import { boundConstruction } from "./bound.ts";

export const CLASS_IDS = [
  "tile-repeat", "crystal-lattice", "crystal-spaced", "random-field", "random-dup", "random-dup-hi", "random-dup-12",
  "hier-12", "hierarchy", "hierarchy-mixed", "random-scatter",
] as const;
export type ClassId = (typeof CLASS_IDS)[number] | "seam-hier-12" | "seam-dup-12";
export const SEAM_IDS = ["seam-hier-12", "seam-dup-12"] as const;

export const CLASS_NOTES: Record<ClassId, { role: string; matched: boolean }> = {
  "tile-repeat": { role: "repeated tile: one fixed 6-cell motif, 40 copies", matched: false },
  "crystal-lattice": { role: "deterministic crystal: one solid 12 x 20 block", matched: false },
  "crystal-spaced": { role: "crystal of copies: 15 identical 4 x 4 squares", matched: false },
  "random-field": { role: "random: 40 distinct random connected 6-cell shapes", matched: false },
  "random-dup": { role: "key negative: 4 distinct random 10-cell motifs, 6 copies each", matched: false },
  "random-dup-hi": { role: "extreme duplication: one random 10-cell motif, 24 copies", matched: false },
  "random-dup-12": { role: "size-matched negative: one random 12-cell motif, 20 copies", matched: true },
  "hier-12": { role: "primary positive: hand-built 12-cell nested composite, 20 copies", matched: true },
  hierarchy: { role: "secondary hierarchy: 4-level 24-cell composite, 10 copies (sizes differ from the negatives)", matched: false },
  "hierarchy-mixed": { role: "hierarchy at two scales: 10 six-cell blocks and 15 twelve-cell composites", matched: false },
  "random-scatter": { role: "occupancy floor: 240 isolated random cells", matched: false },
  "seam-hier-12": { role: "segmentation control: hier-12 in diagonally touching pairs", matched: true },
  "seam-dup-12": { role: "segmentation control: random-dup-12 in diagonally touching pairs", matched: true },
};

export type Cells = number[];
const P = (rows: readonly string[]): Cells => {
  const pts: [number, number][] = [];
  rows.forEach((r, y) => [...r].forEach((ch, x) => { if (ch === "#") pts.push([x, y]); }));
  return normalise(pts);
};

/** Hand-built programs; all coordinates are fixed here and quoted in PROTOCOL.md. */
export const TILE_MOTIF: Cells = P(["###", "#..", "##."]);
export const I3: Cells = P(["#", "#", "#"]);
export const BLOCK_2X3: Cells = P(["##", "##", "##"]);
/** Two 2 x 3 blocks, the second shifted by (2, 1): 12 cells, bounding box 4 x 4. */
export const COMPOSITE_12: Cells = normalise([...toPoints(BLOCK_2X3), ...toPoints(BLOCK_2X3).map(([x, y]) => [x + 2, y + 1] as [number, number])]);
/** Two COMPOSITE_12 side by side, the second shifted by (4, 0): 24 cells, 8 x 4. */
export const COMPOSITE_24: Cells = normalise([...toPoints(COMPOSITE_12), ...toPoints(COMPOSITE_12).map(([x, y]) => [x + 4, y] as [number, number])]);
export const SQUARE_4X4: Cells = P(["####", "####", "####", "####"]);
export const CRYSTAL_BLOCK: Cells = P(Array.from({ length: 20 }, () => "############"));

export interface Motif { cells: Cells; key: string; a: number; status: "exact" | "bound"; candidate: number }
export interface PatchMeta { id: ClassId; replicate: number; occupied: number; padding: number; objects: number; motifs: { key: string; a: number; status: string; copies: number; candidate: number }[]; note: string }
export interface Patch { frame: Uint8Array; w: number; h: number; meta: PatchMeta }

const W = PROTOCOL.patch.w, H = PROTOCOL.patch.h;

/** Random connected shape of n cells grown inside a box x box square from its centre: each step adds a uniformly drawn 4-neighbour. */
export function growShape(n: number, box: number, seed: number): Cells {
  const mid = box >> 1;
  const have = new Set<number>([mid * box + mid]);
  const pts: [number, number][] = [[mid, mid]];
  for (let step = 0; pts.length < n; step++) {
    const fr: number[] = [];
    for (const [x, y] of pts) for (const [dx, dy] of [[0, -1], [-1, 0], [1, 0], [0, 1]] as const) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= box || ny >= box) continue;
      const c = ny * box + nx;
      if (!have.has(c) && !fr.includes(c)) fr.push(c);
    }
    fr.sort((a, b) => a - b);
    const c = fr[rnd(seed, step, 0xf0) % fr.length];
    have.add(c);
    pts.push([c % box, (c - (c % box)) / box]);
  }
  return normalise(pts);
}

export interface Solved { a: number; status: "exact" | "bound" }
export type Solver = (cells: Cells) => Solved;

/** The solver used for motif selection: exact for n <= exactMaxN within the node budget, otherwise the beam bound. */
export function defaultSolver(): Solver {
  const cache = new Map<string, Solved>();
  return (cells) => {
    const key = canonicalKey(cells);
    const hit = cache.get(key);
    if (hit) return hit;
    const r = solveOnce(cells);
    cache.set(key, r);
    return r;
  };
}

let SHARED_SOLVER: Solver;
function solveOnce(cells: Cells): Solved {
  {
    if (cells.length <= PROTOCOL.exactMaxN) {
      const r = exactConstruction(cells, { conn: 4, group: "T", budget: PROTOCOL.exactNodeBudget });
      if (r.exact) return { a: r.cost, status: "exact" };
    }
    const b = boundConstruction(cells, { conn: 4, beamW: PROTOCOL.beamW, nodeCap: PROTOCOL.boundNodeCap, maxCand: PROTOCOL.maxCand });
    return { a: b.cost, status: "bound" };
  }
}

SHARED_SOLVER = defaultSolver();

/**
 * Motif selection: `candidates` deterministic random-grown shapes; keep the one with the highest a; ties by the
 * lexicographically smallest canonical key; keys in `exclude` are skipped.
 */
export function selectMotif(n: number, seedOf: (cand: number) => number, solve: Solver, exclude: ReadonlySet<string> = new Set()): Motif {
  const needExact = n <= PROTOCOL.exactMaxN;
  let best: Motif | null = null;
  for (let cand = 0; cand < PROTOCOL.motif.candidates; cand++) {
    const cells = growShape(n, PROTOCOL.motif.box, seedOf(cand));
    const key = canonicalKey(cells);
    if (exclude.has(key)) continue;
    const s = solve(cells);
    // failure policy (frozen): a 10-cell candidate must be solved exactly, because an upper bound cannot establish the floor
    if (needExact && s.status !== "exact") throw new Error(`motif candidate ${cand} (n=${n}) was not solved exactly within the node budget`);
    if (!best || s.a > best.a || (s.a === best.a && key < best.key)) best = { cells, key, a: s.a, status: s.status, candidate: cand };
  }
  if (!best) throw new Error("no motif candidate survived");
  if (n === PROTOCOL.motif.dupN && best.a < PROTOCOL.motif.floorA10) throw new Error(`selected ${n}-cell motif has a=${best.a} below the frozen floor ${PROTOCOL.motif.floorA10}`);
  return best;
}

type Placed = { cells: Cells; at: [number, number] };

/** Slot grid: `cols x rows` slots of pitch (px, py) on the torus, visited in a seeded shuffle that depends only on (seed, replicate). */
function slots(px: number, py: number, seed: number, rep: number): [number, number][] {
  const cols = Math.floor(W / px), rows = Math.floor(H / py);
  const all: [number, number][] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) all.push([c * px, r * py]);
  for (let i = all.length - 1; i > 0; i--) { const j = rnd(seed, rep, 0x5107 + i) % (i + 1); [all[i], all[j]] = [all[j], all[i]]; }
  return all;
}

function paint(objs: readonly Placed[], id: ClassId, rep: number): Patch {
  const frame = new Uint8Array(W * H);
  let occupied = 0;
  for (const o of objs) for (const c of o.cells) {
    const x = (cx(c) + o.at[0]) % W, y = (cy(c) + o.at[1]) % H;
    if (frame[y * W + x]) throw new Error(`${id} r${rep}: overlapping cells`);
    frame[y * W + x] = 1; occupied++;
  }
  return { frame, w: W, h: H, meta: { id, replicate: rep, occupied, padding: 0, objects: objs.length, motifs: [], note: "" } };
}

const place = (cells: Cells, slot: [number, number]): Placed => ({ cells, at: slot });
const bbox = (cells: Cells) => { let mx = 0, my = 0; for (const c of cells) { mx = Math.max(mx, cx(c)); my = Math.max(my, cy(c)); } return [mx + 1, my + 1] as const; };

function finish(patch: Patch, motifs: { motif: Motif | { cells: Cells; key: string; a: number; status: string; candidate: number }; copies: number }[], note = ""): Patch {
  patch.meta.motifs = motifs.map(({ motif, copies }) => ({ key: motif.key, a: motif.a, status: motif.status, copies, candidate: motif.candidate }));
  patch.meta.note = note;
  if (patch.meta.occupied + patch.meta.padding !== PROTOCOL.patch.mass) throw new Error(`${patch.meta.id} r${patch.meta.replicate}: mass ${patch.meta.occupied} != ${PROTOCOL.patch.mass}`);
  return patch;
}

const memo = new Map<string, Solved>();
/** A hand-built motif; its a is computed by the solver (never asserted), so the evidence records what the solver found. */
const fixedMotif = (cells: Cells, solve: Solver): Motif => {
  const key = canonicalKey(cells);
  let s = memo.get(key);
  if (!s) { s = solve(cells); memo.set(key, s); }
  return { cells, key, a: s.a, status: s.status, candidate: -1 };
};

export interface FixtureOptions { solve?: Solver; seeds?: typeof PROTOCOL.seeds }

/** Smallest offset (by Chebyshev radius, then dy, then dx) that puts a copy of `cells` diagonally against another without any edge contact. */
export function diagonalOffset(cells: Cells): [number, number] {
  const set = new Set(cells);
  for (let r = 1; r <= 14; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
    let diag = false, edge = false, overlap = false;
    for (const c of cells) {
      const x = cx(c) + dx, y = cy(c) + dy;
      for (const [ex, ey] of [[0, 0], [0, -1], [-1, 0], [1, 0], [0, 1]] as const) {
        if (x + ex >= 0 && y + ey >= 0 && set.has(code(x + ex, y + ey))) { if (ex === 0 && ey === 0) overlap = true; else edge = true; }
      }
      for (const [ex, ey] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) if (x + ex >= 0 && y + ey >= 0 && set.has(code(x + ex, y + ey))) diag = true;
    }
    if (diag && !edge && !overlap) return [dx, dy];
  }
  throw new Error("no diagonal contact offset found");
}

/** Build one patch. Motif selection is the only expensive step (solver calls). */
export function buildPatch(id: ClassId, rep: number, opt: FixtureOptions = {}): Patch {
  const seeds = opt.seeds ?? PROTOCOL.seeds;
  const solve = opt.solve ?? SHARED_SOLVER;
  const m = PROTOCOL.motif;
  const placeSeed = seeds.place;
  const slotsOf = (px: number = m.pitch, py: number = m.pitch) => slots(px, py, placeSeed, rep);
  const motifSeed = (tag: number, k: number) => (cand: number) => rnd(rnd(seeds.motif, tag, rep), k, cand);
  const repeat = (cells: Cells, copies: number, sl: [number, number][]) => Array.from({ length: copies }, (_, i) => place(cells, sl[i]));
  switch (id) {
    case "tile-repeat": return finish(paint(repeat(TILE_MOTIF, 40, slotsOf(4, 4)), id, rep), [{ motif: fixedMotif(TILE_MOTIF, solve), copies: 40 }]);
    case "crystal-lattice": {
      const ox = rnd(seeds.crystal, rep, 1) % (W - 12), oy = rnd(seeds.crystal, rep, 2) % (H - 20);
      return finish(paint([place(CRYSTAL_BLOCK, [ox, oy])], id, rep), [], "one object, bound only");
    }
    case "crystal-spaced": return finish(paint(repeat(SQUARE_4X4, 15, slotsOf(5, 5)), id, rep), [{ motif: fixedMotif(SQUARE_4X4, solve), copies: 15 }]);
    case "random-field": {
      const seen = new Set<string>();
      const objs: Placed[] = [];
      const sl = slotsOf();
      for (let attempt = 0; objs.length < 40; attempt++) {
        if (attempt >= 4000) throw new Error("random-field: attempt cap reached");
        const cells = growShape(m.randomFieldN, m.box, rnd(rnd(seeds.motif, 11, rep), attempt, 0xfe1d));
        const key = canonicalKey(cells);
        if (seen.has(key)) continue;
        seen.add(key);
        objs.push(place(cells, sl[objs.length]));
      }
      return finish(paint(objs, id, rep), [], "40 distinct shapes");
    }
    case "random-dup": {
      const used = new Set<string>();
      const motifs: Motif[] = [];
      for (let k = 0; k < m.dupMotifs; k++) { const mo = selectMotif(m.dupN, motifSeed(21, k), solve, used); used.add(mo.key); motifs.push(mo); }
      const sl = slotsOf();
      const objs = motifs.flatMap((mo, k) => repeat(mo.cells, m.dupCopies, sl.slice(k * m.dupCopies, (k + 1) * m.dupCopies)));
      return finish(paint(objs, id, rep), motifs.map((motif) => ({ motif, copies: m.dupCopies })));
    }
    case "random-dup-hi": {
      const mo = selectMotif(m.dupN, motifSeed(31, 0), solve);
      return finish(paint(repeat(mo.cells, m.hiCopies, slotsOf()), id, rep), [{ motif: mo, copies: m.hiCopies }]);
    }
    case "random-dup-12": {
      const mo = selectMotif(m.matchedN, motifSeed(41, 0), solve);
      return finish(paint(repeat(mo.cells, m.matchedCopies, slotsOf()), id, rep), [{ motif: mo, copies: m.matchedCopies }]);
    }
    case "hier-12": return finish(paint(repeat(COMPOSITE_12, m.matchedCopies, slotsOf()), id, rep), [{ motif: fixedMotif(COMPOSITE_12, solve), copies: m.matchedCopies }]);
    case "hierarchy": return finish(paint(repeat(COMPOSITE_24, 10, slotsOf(9, 5)), id, rep), [{ motif: fixedMotif(COMPOSITE_24, solve), copies: 10 }]);
    case "hierarchy-mixed": {
      const sl = slotsOf();
      const objs = [...repeat(BLOCK_2X3, 10, sl.slice(0, 10)), ...repeat(COMPOSITE_12, 15, sl.slice(10, 25))];
      return finish(paint(objs, id, rep), [{ motif: fixedMotif(BLOCK_2X3, solve), copies: 10 }, { motif: fixedMotif(COMPOSITE_12, solve), copies: 15 }]);
    }
    case "random-scatter": {
      const frame = new Uint8Array(W * H);
      let placed = 0;
      for (let attempt = 0; placed < PROTOCOL.patch.mass; attempt++) {
        if (attempt >= 200000) throw new Error("random-scatter: attempt cap reached");
        const x = rnd(seeds.scatter, rep, 2 * attempt) % W, y = rnd(seeds.scatter, rep, 2 * attempt + 1) % H;
        let free = true;
        for (let dy = -1; dy <= 1 && free; dy++) for (let dx = -1; dx <= 1; dx++) if (frame[((y + dy + H) % H) * W + ((x + dx + W) % W)]) { free = false; break; }
        if (free) { frame[y * W + x] = 1; placed++; }
      }
      return finish({ frame, w: W, h: H, meta: { id, replicate: rep, occupied: placed, padding: 0, objects: placed, motifs: [], note: "" } }, [], "no two cells touch under 8-connectivity");
    }
    case "seam-hier-12":
    case "seam-dup-12": {
      const mo = id === "seam-hier-12" ? fixedMotif(COMPOSITE_12, solve) : selectMotif(m.matchedN, motifSeed(41, 0), solve);
      const [dx, dy] = diagonalOffset(mo.cells);
      const [bw, bh] = bbox(mo.cells);
      const pw = bw + Math.abs(dx) + 1, ph = bh + Math.abs(dy) + 1;
      const sl = slots(Math.max(pw, 12), Math.max(ph, 12), placeSeed, rep);
      const objs: Placed[] = [];
      for (let i = 0; i < m.matchedCopies / 2; i++) {
        const [sx, sy] = sl[i];
        const ax = sx + (dx < 0 ? -dx : 0), ay = sy + (dy < 0 ? -dy : 0);
        objs.push(place(mo.cells, [ax, ay]), place(mo.cells, [ax + dx, ay + dy]));
      }
      return finish(paint(objs, id, rep), [{ motif: mo, copies: m.matchedCopies }], `pairs touch diagonally at offset (${dx}, ${dy})`);
    }
  }
}

export { isConnected };
