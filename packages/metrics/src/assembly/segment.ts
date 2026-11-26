// Object boundaries: connected components of occupied cells on a torus, with winding detection (GRAMMAR.md 2).
import { code, NEIGHBOURS, normalise, type Conn } from "./grammar.ts";

export interface SegObject {
  /** Normalised sorted cell codes (lifted, so an object across a seam equals the same shape in the interior). */
  cells: number[];
  n: number;
  /** True iff the object wraps the torus: a revisit at a different lift. Such objects are excluded from class tallies. */
  spans: boolean;
  /** Row-major-first cell of the component in the patch (for drawing and tests). */
  anchor: number;
}

export interface SegParams { conn: Conn; tau: number }

/** Components of `value >= tau` on a w x h torus. Deterministic order: by row-major-first cell. */
export function segment(frame: Uint8Array, w: number, h: number, p: SegParams): SegObject[] {
  const n = w * h;
  const seen = new Uint8Array(n);
  const out: SegObject[] = [];
  const lx = new Int32Array(n), ly = new Int32Array(n);
  const nb = NEIGHBOURS[p.conn];
  for (let s = 0; s < n; s++) {
    if (seen[s] || frame[s] < p.tau) continue;
    const members: number[] = [s];
    seen[s] = 1; lx[s] = s % w; ly[s] = (s - (s % w)) / w;
    let spans = false;
    for (let i = 0; i < members.length; i++) {
      const c = members[i];
      const x = c % w, y = (c - x) / w;
      for (const [dx, dy] of nb) {
        const nx = (x + dx + w) % w, ny = (y + dy + h) % h;
        const d = ny * w + nx;
        if (frame[d] < p.tau) continue;
        const ex = lx[c] + dx, ey = ly[c] + dy;
        if (!seen[d]) { seen[d] = 1; lx[d] = ex; ly[d] = ey; members.push(d); }
        else if (lx[d] !== ex || ly[d] !== ey) spans = true;
      }
    }
    // A winding that does not revisit a cell at another lift is impossible for a finite component, but a component wider than the patch folds onto itself.
    const pts = members.map((c) => [lx[c], ly[c]] as [number, number]);
    out.push({ cells: normalise(pts), n: members.length, spans, anchor: s });
  }
  return out;
}

export { code };
