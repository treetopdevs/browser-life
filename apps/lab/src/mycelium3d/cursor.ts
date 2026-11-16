// The 3D cursor for /mycelium3d/'s brushes: pure maths, no DOM and no GPU, unit-tested in apps/lab/test/mycelium3d-cursor.test.ts.
//
// Where a pointer puts the cursor (the depth rule). The pointer is a ray from the eye through the canvas pixel, in the volume's
// world space (apps/lab/src/volume3d/contract.ts: the box [0, ext], texel (u, v, w) = cell (x, D - 1 - z, y), y up). The cursor
// goes to the cell of the first particle the ray meets, if any lies within a few pixels of it, else to the cell where the ray
// crosses the working layer (a horizontal plane at the centre of that layer), else nowhere. Only what is drawn counts: a
// particle or cell that peel or cut hides is never hit (a cell is shown when its centre is inside visibleMax, as the particle
// renderer decides for a bead), and a working layer the peel hides is moved down to the first layer still shown.
//
// What the cursor covers is the brush's own sphere (tools/mycelium3d/brush.ts): cell (x, y, z) is inside when
// dx² + dy² + dz² ≤ r², dx and dy the wrapped (minimum-image) offsets, dz not wrapped. sphereSummary re-implements that
// membership to say, before a stroke, what the sphere holds; the unit test checks it against applyBrush3d itself.
import { POS_SHIFT, type Mycelium3dState } from '../../../../tools/mycelium3d/world.ts';
import { visibleMax } from '../volume3d/approaches/common.ts';
import type { VolumeDims } from '../volume3d/contract.ts';

export type V3 = [number, number, number];
export interface Cell { x: number; y: number; z: number }
export interface Ray { o: V3; d: V3 }
/** What the view shows: the box, its dims, peel and cut (as FrameInfo carries them). */
export interface ViewClip { ext: [number, number, number]; dims: VolumeDims; peel: number; cut: number }

/** The pointer's ray from a column-major inverse view-projection (WebGPU depth 0..1) and a point in NDC. */
export function pointerRay(inv: ArrayLike<number>, ndcX: number, ndcY: number): Ray {
  const at = (z: number): V3 => {
    const x = inv[0]! * ndcX + inv[4]! * ndcY + inv[8]! * z + inv[12]!;
    const y = inv[1]! * ndcX + inv[5]! * ndcY + inv[9]! * z + inv[13]!;
    const zz = inv[2]! * ndcX + inv[6]! * ndcY + inv[10]! * z + inv[14]!;
    const w = inv[3]! * ndcX + inv[7]! * ndcY + inv[11]! * z + inv[15]!;
    return [x / w, y / w, zz / w];
  };
  const a = at(0), b = at(1);
  const d: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const l = Math.hypot(d[0], d[1], d[2]) || 1;
  return { o: a, d: [d[0] / l, d[1] / l, d[2] / l] };
}

/** World size of one texel on each axis (east, up, south). */
export const voxelSize = (v: ViewClip): V3 => [v.ext[0] / v.dims.W, v.ext[1] / v.dims.D, v.ext[2] / v.dims.H];

/** The world point at the centre of cell (x, y, z). */
export function cellCentre(v: ViewClip, c: Cell): V3 {
  const s = voxelSize(v);
  return [(c.x + 0.5) * s[0], (v.dims.D - c.z - 0.5) * s[1], (c.y + 0.5) * s[2]];
}

/** The first layer and the number of north rows the view still shows: layers z < firstLayer are peeled, rows y >= rows are cut. */
export function shown(v: ViewClip): { firstLayer: number; rows: number } {
  const vis = visibleMax(v);
  const s = voxelSize(v);
  // the cell centres inside vis, as the particle renderer tests a bead's centre
  const keep = Math.round(vis[1] / s[1]), rows = Math.round(vis[2] / s[2]);
  return { firstLayer: v.dims.D - keep, rows };
}

/** Whether the view shows cell c (its centre is inside the part of the box peel and cut leave). */
export function isShown(v: ViewClip, c: Cell): boolean {
  const { firstLayer, rows } = shown(v);
  return c.x >= 0 && c.x < v.dims.W && c.y >= 0 && c.y < rows && c.z >= firstLayer && c.z < v.dims.D;
}

/** The centre as the brush uses it: x and y wrapped into the world, z clamped into [0, D - 1]; non-integers floored. */
export function normaliseCell(d: VolumeDims, c: Cell): Cell {
  const wrap = (a: number, n: number) => ((Math.floor(a) % n) + n) % n;
  return { x: wrap(c.x, d.W), y: wrap(c.y, d.H), z: Math.min(Math.max(Math.floor(c.z), 0), d.D - 1) };
}

/** The cell of a fixed-point position. */
export const cellOfPos = (x: number, y: number, z: number): Cell => ({ x: x >>> POS_SHIFT, y: y >>> POS_SHIFT, z: z >>> POS_SHIFT });

/** Positions and body matter, as a state holds them (slot order). */
export type Particles = Pick<Mycelium3dState, 'n' | 'x' | 'y' | 'z' | 'M'>;

/**
 * The slot of the first particle the ray meets, or -1. A particle counts when the ray passes within its drawn radius plus
 * `tolPerUnit * t` of its centre (t the distance along the ray, so `tolPerUnit` is a pixel tolerance in world units per unit
 * of distance), its centre is in front of the eye, and the view shows it. The drawn radius is packParticles' (in pack.ts)
 * times `size` (the particle renderer's size setting), as the bead is drawn.
 */
export function pickParticle(ray: Ray, p: Particles, v: ViewClip, tolPerUnit: number, size = 1): number {
  const s = voxelSize(v);
  const vox = Math.min(s[0], s[1], s[2]);
  const vis = visibleMax(v);
  const D = v.dims.D;
  const k = 1 / (1 << POS_SHIFT);
  let best = -1, bestT = Infinity;
  for (let i = 0; i < p.n; i++) {
    const cx = (p.x[i]! + 0.5) * k * s[0], cy = (D - (p.z[i]! + 0.5) * k) * s[1], cz = (p.y[i]! + 0.5) * k * s[2];
    if (cx > vis[0] || cy > vis[1] || cz > vis[2]) continue;
    const ox = cx - ray.o[0], oy = cy - ray.o[1], oz = cz - ray.o[2];
    const t = ox * ray.d[0] + oy * ray.d[1] + oz * ray.d[2];
    if (t <= 0) continue;
    const px = ox - t * ray.d[0], py = oy - t * ray.d[1], pz = oz - t * ray.d[2];
    const rad = (0.22 + 0.3 * Math.sqrt(Math.min(1, p.M[i]! / 64))) * size * vox + tolPerUnit * t;
    const d2 = px * px + py * py + pz * pz;
    if (d2 > rad * rad) continue;
    // where the ray enters the bead (or its tolerance band): the nearest entry is the first particle seen
    const enter = t - Math.sqrt(rad * rad - d2);
    if (enter < bestT) { bestT = enter; best = i; }
  }
  return best;
}

/** The cell where the ray crosses the centre plane of layer z, if the view shows that cell; else null. */
export function layerCell(ray: Ray, v: ViewClip, z: number): Cell | null {
  const s = voxelSize(v);
  const yw = (v.dims.D - z - 0.5) * s[1];
  if (Math.abs(ray.d[1]) < 1e-9) return null;
  const t = (yw - ray.o[1]) / ray.d[1];
  if (!(t > 0)) return null;
  const px = ray.o[0] + t * ray.d[0], pz = ray.o[2] + t * ray.d[2];
  const c = { x: Math.floor(px / s[0]), y: Math.floor(pz / s[2]), z };
  return isShown(v, c) ? c : null;
}

/** The layer the pointer works in: the asked one, or the first layer the peel leaves when it hides the asked one. */
export const workingLayer = (v: ViewClip, z: number) => Math.min(v.dims.D - 1, Math.max(shown(v).firstLayer, Math.floor(z)));

/** The depth rule in one call: the first visible particle under the ray, else the working layer's cell, else null. */
export function cursorFromRay(ray: Ray, p: Particles | null, v: ViewClip, layer: number, tolPerUnit: number, size = 1): { cell: Cell; on: 'particle' | 'layer' } | null {
  if (p) {
    const i = pickParticle(ray, p, v, tolPerUnit, size);
    if (i >= 0) return { cell: cellOfPos(p.x[i]!, p.y[i]!, p.z[i]!), on: 'particle' };
  }
  const c = layerCell(ray, v, workingLayer(v, layer));
  return c ? { cell: c, on: 'layer' } : null;
}

const ring = (a: number, b: number, n: number) => { const d = Math.abs(a - b); return Math.min(d, n - d); };

/** Whether cell (x, y, z) is inside the brush sphere at centre c (normalised) with radius r: brush.ts's membership. */
export function inSphere(d: VolumeDims, c: Cell, r: number, x: number, y: number, z: number): boolean {
  const dx = ring(x, c.x, d.W), dy = ring(y, c.y, d.H), dz = z - c.z;
  return dx * dx + dy * dy + dz * dz <= r * r;
}

/** What a sphere holds now: its cells, the particles standing in them, the waste in them and the cells with no waste. */
export interface SphereSummary { cells: number; particles: number; waste: number; dryCells: number }

/** The sphere at centre c (normalised here) and radius r in state s. Reads the state, changes nothing. */
export function sphereSummary(s: Pick<Mycelium3dState, 'config' | 'n' | 'x' | 'y' | 'z' | 'C'>, centre: Cell, r: number): SphereSummary {
  const d = { W: s.config.width, H: s.config.height, D: s.config.depth };
  const c = normaliseCell(d, centre);
  const m = new Uint8Array(d.W * d.H * d.D);
  let cells = 0, waste = 0, dry = 0;
  // a radius as wide as the world covers every row or column once; layers never wrap
  const span = (cv: number, n: number) => (2 * r + 1 >= n ? Array.from({ length: n }, (_, i) => i) : Array.from({ length: 2 * r + 1 }, (_, i) => (((cv - r + i) % n) + n) % n));
  const xs = span(c.x, d.W), ys = span(c.y, d.H);
  for (let z = Math.max(0, c.z - r); z <= Math.min(d.D - 1, c.z + r); z++) {
    for (const y of ys) for (const x of xs) {
      if (!inSphere(d, c, r, x, y, z)) continue;
      const k = (z * d.H + y) * d.W + x;
      m[k] = 1; cells++; waste += s.C[k]!;
      if (s.C[k] === 0) dry++;
    }
  }
  let particles = 0;
  for (let i = 0; i < s.n; i++) if (m[((s.z[i]! >>> POS_SHIFT) * d.H + (s.y[i]! >>> POS_SHIFT)) * d.W + (s.x[i]! >>> POS_SHIFT)]) particles++;
  return { cells, particles, waste, dryCells: dry };
}
