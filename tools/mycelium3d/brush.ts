// Mycelium in a volume: brushes that keep the books exact (tools/mycelium3d/world.ts is the specification).
//
// A brush is an intervention between steps: it edits a Mycelium3dState in place and returns a report. It is not a
// rule of the world, so a run that has been brushed no longer follows from its seed alone; the caller keeps the
// log. What a brush may never do is change the books: matter stays closed (ΣA + ΣC + ΣP + ΣM unchanged) and the
// energy identity (ΣE + eA·ΣA = energy0 + lightIn − heat) keeps holding with residual 0. These are the 2D brushes
// (tools/mycelium/brush.ts) carried into the volume, with a feed in place of the scrape.
//
//   wound  removes every particle whose cell is inside the sphere, booked as the step books a death (RULES.md, phase 5):
//          its body matter M goes to waste C in the cell it stood in, its energy E to the heat ledger. Owned trail
//          (Z, Q) is untouched, as a death leaves it. totals.deaths does not count brush removals (as in 2D): the
//          counter stays a record of deaths by the rule, and the report carries `removed`.
//          With bonds on, every bond to a removed particle is gone: a surviving partner loses that slot, and a lone
//          remaining bond moves to slot 0 (two bonds keep increasing id order, so removing one keeps it canonical).
//          Survivors keep their slot order (slot order is id order), as the step's compaction leaves them; the freed
//          slots are reset to what createWorld and decode leave (0, and BOND_NONE for bond slots).
//   feed   a local burst of light: in every cell inside, `min(C, amount)` waste becomes nutrient A and lightIn grows
//          by eA per unit, exactly the conversion phase 8.1 makes. It moves matter between C and A and adds none, and
//          the energy it creates is booked as light input, so both residuals stay 0. A cell with no waste is
//          unchanged (the report counts such cells in `cellsWithoutWaste`).
//
// There is still no brush that adds nutrient from nothing: that would add matter and break the closure.
//
// Geometry is integer. The centre is a cell: x and y wrap into the world (as 2D wraps both axes); z is closed, so the
// centre's z is clamped into [0, depth − 1] (a cursor above the surface or below the floor strokes the nearest layer).
// A cell is inside when its offset (dx, dy, dz) from the centre has dx² + dy² + dz² ≤ radius², with dx and dy the
// wrapped (minimum-image) offsets, each in [0, W/2] and [0, H/2], and dz = |z − cz| without wrap: the sphere is cut
// at the surface and at the floor, it never reaches around in z. Membership is decided per cell, never by walking
// offsets, so a radius larger than the world covers each cell once. A particle is hit when its cell
// ((x >> 8, y >> 8, z >> 8)) is inside, as for every other rule of the world. The radius is a whole number in
// [0, 512], as in 2D (wider than any world can need: W, H ≤ 512, D ≤ 64); radius 0 is the centre cell alone.
//
// Bounds (RULES.md, "Bounds"), checked before anything is written, so a refused stroke throws a RangeError and leaves
// the state byte for byte as it was:
//   - wound: totals.heat + ΣE ≤ 2^50 (the lifetime ledger bound); each cell's C plus the bodies landing in it ≤ 2^32 − 1.
//     Matter is only moved, so the total stays ≤ 2^31 and the per-cell check cannot fail on a valid state; it is
//     there so an invalid input is refused rather than wrapped.
//   - feed: `amount` is a whole number in [1, 4096], the range of `light` (light ≤ 2^12), so one stroke converts in a
//     cell at most what the strongest valid light converts in a step; totals.lightIn + eA·Σconv ≤ 2^50; each cell's
//     A + conv ≤ 2^32 − 1 (again implied by total matter ≤ 2^31 on a valid state). eA·Σconv ≤ 255 · 2^12 · 2^24 < 2^53,
//     so the sum is exact in a JS number.
//
// Nothing here touches the DOM or the GPU. On the GPU path the page does read() -> brush -> GpuMycelium3d.create from the brushed state.
import { BOND_NONE, LEDGER_MAX, type Mycelium3dState, NN_BYTES3, POS_SHIFT, slotOfId } from "./world.ts";

export type BrushKind3d = "wound" | "feed";

/** One stroke as the page sends it. `amount` is read by feed only. */
export interface BrushStroke3d {
  kind: BrushKind3d;
  cx: number;
  cy: number;
  cz: number;
  radius: number;
  amount?: number;
}

/** What one stroke did. */
export interface BrushReport3d {
  kind: BrushKind3d;
  /** The world step the stroke was applied at (between step `step - 1` and step `step`). */
  step: number;
  /** The centre cell as used: x and y wrapped into the world, z clamped into [0, depth - 1]. */
  cx: number;
  cy: number;
  cz: number;
  radius: number;
  /** Cells inside the sphere. */
  cells: number;
  /** Particles removed (wound only). */
  removed: number;
  /** Matter that changed form: particle bodies to waste (wound), waste to nutrient (feed). */
  matterMoved: number;
  /** Particle energy booked as heat (wound only). */
  heatBooked: number;
  /** Energy booked as light input, eA per unit converted (feed only). */
  lightBooked: number;
  /** Bonds that ended because one or both partners were removed, each counted once (wound with bondBreak only). */
  bondsCut: number;
  /** Cells inside that held no waste, so the feed converted nothing there (feed only). */
  cellsWithoutWaste: number;
}

/** Largest radius a stroke may have: wider than any world (512 x 512 x 64) can need. */
export const BRUSH_RADIUS_MAX = 512;
/** Largest feed amount per cell: the bound on `light` (RULES.md, "Bounds", light ≤ 2^12). */
export const FEED_AMOUNT_MAX = 1 << 12;
const U32_MAX = 0xffffffff;

const wrap = (v: number, n: number) => ((v % n) + n) % n;
/** Wrapped distance between two cell coordinates on a ring of n cells, in [0, n / 2]. */
const ring = (a: number, b: number, n: number) => { const d = Math.abs(a - b); return Math.min(d, n - d); };

function check(s: Mycelium3dState, cx: number, cy: number, cz: number, radius: number): { cx: number; cy: number; cz: number } {
  if (!Number.isInteger(cx) || !Number.isInteger(cy) || !Number.isInteger(cz)) throw new RangeError("brush centre must be whole cells");
  if (!Number.isInteger(radius) || radius < 0 || radius > BRUSH_RADIUS_MAX) throw new RangeError(`brush radius must be a whole number of cells in [0, ${BRUSH_RADIUS_MAX}]`);
  const c = s.config;
  return { cx: wrap(cx, c.width), cy: wrap(cy, c.height), cz: Math.min(Math.max(cz, 0), c.depth - 1) };
}

/** Marks the cells inside the sphere (1) in a fresh mask over the 3D field; returns it with the cell count. */
function mask(s: Mycelium3dState, cx: number, cy: number, cz: number, radius: number): { m: Uint8Array; cells: number } {
  const W = s.config.width, H = s.config.height, D = s.config.depth;
  const m = new Uint8Array(W * H * D);
  const r2 = radius * radius;
  let cells = 0;
  // Only the rows and columns within the radius can hold a cell, so walk their distinct indices (all of them when the
  // radius reaches around the world) and test each cell once by its wrapped distance. Layers do not wrap: clip them.
  const rows = radius * 2 + 1 >= H ? H : radius * 2 + 1, cols = radius * 2 + 1 >= W ? W : radius * 2 + 1;
  const z0 = Math.max(cz - radius, 0), z1 = Math.min(cz + radius, D - 1);
  for (let z = z0; z <= z1; z++) {
    const dz = z - cz;
    for (let j = 0; j < rows; j++) {
      const y = rows === H ? j : wrap(cy - radius + j, H);
      const dy = ring(y, cy, H);
      if (dy * dy + dz * dz > r2) continue;
      for (let i = 0; i < cols; i++) {
        const x = cols === W ? i : wrap(cx - radius + i, W);
        const dx = ring(x, cx, W);
        if (dx * dx + dy * dy + dz * dz <= r2) { m[(z * H + y) * W + x] = 1; cells++; }
      }
    }
  }
  return { m, cells };
}

const cellOf = (s: Mycelium3dState, i: number) =>
  ((s.z[i] >>> POS_SHIFT) * s.config.height + (s.y[i] >>> POS_SHIFT)) * s.config.width + (s.x[i] >>> POS_SHIFT);

/** Removes the particles standing in the sphere; their matter becomes waste where they stood, their energy heat, and their bonds end. */
export function wound(s: Mycelium3dState, cx: number, cy: number, cz: number, radius: number): BrushReport3d {
  const c = check(s, cx, cy, cz, radius);
  const { m, cells } = mask(s, c.cx, c.cy, c.cz, radius);
  const n = s.n;
  const hit = new Uint8Array(n);
  const landing = new Map<number, number>();
  let removed = 0, matter = 0, heat = 0;
  for (let i = 0; i < n; i++) {
    const ci = cellOf(s, i);
    if (!m[ci]) continue;
    hit[i] = 1; removed++; matter += s.M[i]; heat += s.E[i];
    landing.set(ci, (landing.get(ci) ?? 0) + s.M[i]);
  }
  const report: BrushReport3d = {
    kind: "wound", step: s.step, cx: c.cx, cy: c.cy, cz: c.cz, radius, cells, removed, matterMoved: matter, heatBooked: heat, lightBooked: 0, bondsCut: 0, cellsWithoutWaste: 0,
  };
  if (removed === 0) return report;
  // Every check before the first write.
  if (s.totals.heat + heat > LEDGER_MAX) throw new RangeError("wound would pass the 2^50 heat ledger bound");
  for (const [ci, add] of landing) if (s.C[ci] + add > U32_MAX) throw new RangeError(`wound would overflow the waste in cell ${ci}`);

  // Each survivor's bonds after the stroke, computed from the pre-stroke ids and the hit mask (slotOfId needs the ids
  // in place, so this runs before compaction moves anything). A lone remaining bond goes to slot 0; two stay in order.
  const B0 = s.bond0, B1 = s.bond1;
  let nb0: Uint32Array | null = null, nb1: Uint32Array | null = null;
  if (B0 && B1) {
    nb0 = new Uint32Array(n).fill(BOND_NONE); nb1 = new Uint32Array(n).fill(BOND_NONE);
    let cut = 0;
    for (let i = 0; i < n; i++) {
      for (const pid of [B0[i], B1[i]]) {
        if (pid === BOND_NONE) continue;
        const j = slotOfId(s.id, n, pid);
        if (hit[i] || hit[j]) {
          // Once per bond: at the removed end when only one end goes, at the smaller slot when both go.
          if ((hit[i] && !hit[j]) || (hit[i] && hit[j] && i < j)) cut++;
          continue;
        }
        if (nb0[i] === BOND_NONE) nb0[i] = pid; else nb1[i] = pid;
      }
    }
    report.bondsCut = cut;
  }

  // Compact the survivors in slot order (slot order is id order), moving every array, the genome and the bond slots.
  let k = 0;
  for (let i = 0; i < n; i++) {
    if (hit[i]) { s.C[cellOf(s, i)] += s.M[i]; continue; }
    if (k !== i) {
      s.id[k] = s.id[i]; s.parent[k] = s.parent[i]; s.gid[k] = s.gid[i];
      s.x[k] = s.x[i]; s.y[k] = s.y[i]; s.z[k] = s.z[i]; s.M[k] = s.M[i]; s.E[k] = s.E[i]; s.age[k] = s.age[i];
      s.genome.copyWithin(k * NN_BYTES3, i * NN_BYTES3, (i + 1) * NN_BYTES3);
    }
    if (nb0) { B0![k] = nb0[i]; B1![k] = nb1![i]; }
    k++;
  }
  // Reset the freed slots to what createWorld and decode leave, so nothing past n looks like a particle.
  for (let i = k; i < n; i++) {
    s.id[i] = 0; s.parent[i] = 0; s.gid[i] = 0; s.x[i] = 0; s.y[i] = 0; s.z[i] = 0; s.M[i] = 0; s.E[i] = 0; s.age[i] = 0;
    if (B0) { B0[i] = BOND_NONE; B1![i] = BOND_NONE; }
  }
  s.genome.fill(0, k * NN_BYTES3, n * NN_BYTES3);
  s.n = k;
  s.totals.heat += heat;
  return report;
}

/** A local burst of light: in each cell inside, min(C, amount) waste becomes nutrient, booked as light input (eA per unit). */
export function feed(s: Mycelium3dState, cx: number, cy: number, cz: number, radius: number, amount: number): BrushReport3d {
  const c = check(s, cx, cy, cz, radius);
  if (!Number.isInteger(amount) || amount < 1 || amount > FEED_AMOUNT_MAX) throw new RangeError(`feed amount must be a whole number in [1, ${FEED_AMOUNT_MAX}]`);
  const { m, cells } = mask(s, c.cx, c.cy, c.cz, radius);
  let moved = 0, dry = 0;
  for (let k = 0; k < m.length; k++) {
    if (!m[k]) continue;
    const conv = Math.min(s.C[k], amount);
    if (conv === 0) { dry++; continue; }
    if (s.A[k] + conv > U32_MAX) throw new RangeError(`feed would overflow the nutrient in cell ${k}`);
    moved += conv;
  }
  const light = moved * s.config.eA;
  if (s.totals.lightIn + light > LEDGER_MAX) throw new RangeError("feed would pass the 2^50 light ledger bound");
  for (let k = 0; k < m.length; k++) {
    if (!m[k]) continue;
    const conv = Math.min(s.C[k], amount);
    s.C[k] -= conv; s.A[k] += conv;
  }
  s.totals.lightIn += light;
  return {
    kind: "feed", step: s.step, cx: c.cx, cy: c.cy, cz: c.cz, radius, cells, removed: 0, matterMoved: moved, heatBooked: 0, lightBooked: light, bondsCut: 0, cellsWithoutWaste: dry,
  };
}

/** One entry point for the page: applies the stroke's brush. */
export function applyBrush3d(s: Mycelium3dState, stroke: BrushStroke3d): BrushReport3d {
  const { kind, cx, cy, cz, radius } = stroke;
  if (kind === "wound") return wound(s, cx, cy, cz, radius);
  if (kind === "feed") return feed(s, cx, cy, cz, radius, stroke.amount as number);
  throw new RangeError(`unknown brush ${String(kind)}`);
}
