// Cell sets, equivalence groups and canonical forms for the assembly-inspired grammar (GRAMMAR.md).
// A cell is the integer code y * STRIDE + x with 0 <= x < STRIDE. Objects are stored as sorted code arrays normalised
// to their min corner. No floats, no Math.random.

export const STRIDE = 1024;
export type Conn = 4 | 8;
export type Group = "T" | "D4";

export const cx = (c: number): number => c % STRIDE;
export const cy = (c: number): number => (c - (c % STRIDE)) / STRIDE;
export const code = (x: number, y: number): number => y * STRIDE + x;

/** Neighbour offsets in a fixed order (row-major of the neighbourhood). */
export const NEIGHBOURS: Record<Conn, readonly (readonly [number, number])[]> = {
  4: [[0, -1], [-1, 0], [1, 0], [0, 1]],
  8: [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]],
};

/** Translate so the min x and min y are 0; sorted ascending (row-major). */
export function normalise(points: readonly (readonly [number, number])[]): number[] {
  let mx = Infinity, my = Infinity;
  for (const [x, y] of points) { if (x < mx) mx = x; if (y < my) my = y; }
  return points.map(([x, y]) => code(x - mx, y - my)).sort((a, b) => a - b);
}

export const toPoints = (cells: readonly number[]): [number, number][] => cells.map((c) => [cx(c), cy(c)]);

/** The 8 dihedral images of (x, y): identity, three rotations, and the reflected versions. */
const D4_MAPS: readonly ((x: number, y: number) => [number, number])[] = [
  (x, y) => [x, y], (x, y) => [-y, x], (x, y) => [-x, -y], (x, y) => [y, -x],
  (x, y) => [-x, y], (x, y) => [y, x], (x, y) => [x, -y], (x, y) => [-y, -x],
];

const cmp = (a: readonly number[], b: readonly number[]): number => {
  if (a.length !== b.length) return a.length - b.length;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
};

/** Canonical cell list: for T the min-corner normalisation; for D4 the lexicographically least over the 8 images. */
export function canonicalCells(cells: readonly number[], group: Group): number[] {
  const pts = toPoints(cells);
  if (group === "T") return normalise(pts);
  let best: number[] | null = null;
  for (const m of D4_MAPS) {
    const cand = normalise(pts.map(([x, y]) => m(x, y)));
    if (best === null || cmp(cand, best) < 0) best = cand;
  }
  return best!;
}

/** String identity of a class. Class id order (for tie-breaks) is the order of these strings compared as written. */
export function canonicalKey(cells: readonly number[], group: Group = "T"): string {
  return canonicalCells(cells, group).join(",");
}

export function keyCells(key: string): number[] { return key === "" ? [] : key.split(",").map(Number); }

/** True iff the cells form one connected set under `conn` (planar, no wraparound). */
export function isConnected(cells: readonly number[], conn: Conn): boolean {
  if (cells.length <= 1) return true;
  const set = new Set(cells);
  const seen = new Set<number>([cells[0]]);
  const stack = [cells[0]];
  while (stack.length) {
    const c = stack.pop()!;
    for (const [dx, dy] of NEIGHBOURS[conn]) {
      const x = cx(c) + dx, y = cy(c) + dy;
      if (x < 0 || y < 0) continue;
      const n = code(x, y);
      if (set.has(n) && !seen.has(n)) { seen.add(n); stack.push(n); }
    }
  }
  return seen.size === cells.length;
}

export const log2ceil = (n: number): number => (n <= 1 ? 0 : 32 - Math.clz32(n - 1));
