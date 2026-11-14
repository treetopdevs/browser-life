// Mycelium world: brushes that keep the books exact (tools/mycelium/world.ts is the specification).
//
// A brush is an intervention between steps: it edits a MyceliumState in place and returns a report. It is not a
// rule of the world, so a run that has been brushed no longer follows from its seed alone; the caller keeps the
// log. What a brush may never do is change the books: matter stays closed and the energy identity
// (energy total = energy0 + lightIn - heat) keeps holding with residual 0.
//
//   wound   removes every particle whose cell is within `radius` cells of the centre. Its matter goes to waste C
//           in the cell it stood in. Its energy is booked as heat (totals.heat), the same book a death uses.
//   scrape  moves trail P within the radius to waste C, cell by cell. No energy is involved.
//
// There is deliberately no "feed" brush: adding nutrient would add matter and break the closure.
//
// Geometry is integer and torus-aware: the centre is a cell (wrapped into the world), and a cell is inside when
// its wrapped offset (dx, dy) from the centre, each in [-W/2, W/2], has dx^2 + dy^2 <= radius^2. Membership is decided
// per cell, never by walking offsets, so a radius larger than the world covers each cell once, not once per wrap.
// A particle is hit when the cell it is in (x >> 8, y >> 8) is inside, as for every other rule of the world.
//
// Nothing here touches the DOM or the GPU. On the GPU path the page does read() -> brush -> upload().
import { NN_BYTES } from "@bl/schema";
import { LEDGER_MAX, type MyceliumState, POS_SHIFT } from "./world.ts";

export type BrushKind = "wound" | "scrape";

/** What one stroke did. `matterMoved` is the matter that changed form (particle bodies to waste, or trail to waste). */
export interface BrushReport {
  kind: BrushKind;
  /** The world step the stroke was applied at (between step `step - 1` and step `step`). */
  step: number;
  /** The centre cell as given, wrapped into the world. */
  cx: number;
  cy: number;
  radius: number;
  /** Cells inside the radius. */
  cells: number;
  /** Particles removed (wound only). */
  removed: number;
  matterMoved: number;
  /** Particle energy booked as heat by this stroke (wound only). */
  heatBooked: number;
}

/** Largest radius a stroke may have: wider than any world (512) can need. */
export const BRUSH_RADIUS_MAX = 512;

const wrap = (v: number, n: number) => ((v % n) + n) % n;
/** Wrapped distance between two cell coordinates on a ring of n cells, in [0, n / 2]. */
const ring = (a: number, b: number, n: number) => { const d = Math.abs(a - b); return Math.min(d, n - d); };

function check(s: MyceliumState, cx: number, cy: number, radius: number): { cx: number; cy: number } {
  if (!Number.isInteger(cx) || !Number.isInteger(cy)) throw new RangeError("brush centre must be whole cells");
  if (!Number.isInteger(radius) || radius < 0 || radius > BRUSH_RADIUS_MAX) throw new RangeError(`brush radius must be a whole number of cells in [0, ${BRUSH_RADIUS_MAX}]`);
  return { cx: wrap(cx, s.config.width), cy: wrap(cy, s.config.height) };
}

/** Marks the cells inside the stroke (1) in a fresh mask; returns it with the cell count. */
function mask(s: MyceliumState, cx: number, cy: number, radius: number): { m: Uint8Array; cells: number } {
  const W = s.config.width, H = s.config.height;
  const m = new Uint8Array(W * H);
  const r2 = radius * radius;
  let cells = 0;
  // Only the rows and columns within the radius can hold a cell, so walk their distinct indices (all of them
  // when the radius reaches around the world) and test each cell once by its wrapped distance.
  const rows = radius * 2 + 1 >= H ? H : radius * 2 + 1, cols = radius * 2 + 1 >= W ? W : radius * 2 + 1;
  for (let j = 0; j < rows; j++) {
    const y = rows === H ? j : wrap(cy - radius + j, H);
    const dy = ring(y, cy, H);
    if (dy > radius) continue;
    for (let i = 0; i < cols; i++) {
      const x = cols === W ? i : wrap(cx - radius + i, W);
      const dx = ring(x, cx, W);
      if (dx * dx + dy * dy <= r2) { m[y * W + x] = 1; cells++; }
    }
  }
  return { m, cells };
}

/** Removes the particles standing in the stroke; their matter becomes waste where they stood and their energy heat. */
export function wound(s: MyceliumState, cx: number, cy: number, radius: number): BrushReport {
  const c = check(s, cx, cy, radius);
  const W = s.config.width;
  const { m, cells } = mask(s, c.cx, c.cy, radius);
  let k = 0, matter = 0, heat = 0;
  const n = s.n;
  const hit = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const ci = (s.y[i] >>> POS_SHIFT) * W + (s.x[i] >>> POS_SHIFT);
    if (m[ci]) { hit[i] = 1; matter += s.M[i]; heat += s.E[i]; }
  }
  if (s.totals.heat + heat > LEDGER_MAX) throw new RangeError("wound would pass the 2^50 heat ledger bound");
  // Compact the survivors in slot order (slot order is id order), moving every array and the genome with them.
  for (let i = 0; i < n; i++) {
    if (hit[i]) {
      s.C[(s.y[i] >>> POS_SHIFT) * W + (s.x[i] >>> POS_SHIFT)] += s.M[i];
      continue;
    }
    if (k !== i) {
      s.id[k] = s.id[i]; s.parent[k] = s.parent[i]; s.gid[k] = s.gid[i];
      s.x[k] = s.x[i]; s.y[k] = s.y[i]; s.M[k] = s.M[i]; s.E[k] = s.E[i]; s.age[k] = s.age[i];
      s.genome.copyWithin(k * NN_BYTES, i * NN_BYTES, (i + 1) * NN_BYTES);
    }
    k++;
  }
  // Clear the freed slots so nothing past n looks like a particle.
  for (let i = k; i < n; i++) {
    s.id[i] = 0; s.parent[i] = 0; s.gid[i] = 0; s.x[i] = 0; s.y[i] = 0; s.M[i] = 0; s.E[i] = 0; s.age[i] = 0;
  }
  s.genome.fill(0, k * NN_BYTES, n * NN_BYTES);
  s.n = k;
  s.totals.heat += heat;
  return { kind: "wound", step: s.step, cx: c.cx, cy: c.cy, radius, cells, removed: n - k, matterMoved: matter, heatBooked: heat };
}

/** Moves the trail P inside the stroke to waste C, cell by cell. */
export function scrape(s: MyceliumState, cx: number, cy: number, radius: number): BrushReport {
  const c = check(s, cx, cy, radius);
  const { m, cells } = mask(s, c.cx, c.cy, radius);
  let matter = 0;
  for (let k = 0; k < m.length; k++) {
    if (!m[k]) continue;
    matter += s.P[k];
    s.C[k] += s.P[k];
    s.P[k] = 0;
  }
  return { kind: "scrape", step: s.step, cx: c.cx, cy: c.cy, radius, cells, removed: 0, matterMoved: matter, heatBooked: 0 };
}

/** One entry point for the page: applies the named brush. */
export function applyBrush(s: MyceliumState, kind: BrushKind, cx: number, cy: number, radius: number): BrushReport {
  return kind === "wound" ? wound(s, cx, cy, radius) : scrape(s, cx, cy, radius);
}
