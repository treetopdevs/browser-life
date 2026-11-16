// The /mycelium3d/ page's 3D cursor (src/mycelium3d/cursor.ts): the pointer's ray, the depth rule (first visible particle,
// else the working layer), peel and cut (what is hidden is never hit), the brush centre's wrap and clamp, and the sphere
// summary checked against the brush itself (tools/mycelium3d/brush.ts) on copies of a grown world.
import { describe, expect, it } from 'vitest';
import { applyBrush3d } from '../../../tools/mycelium3d/brush.ts';
import { createWorld, decode, defaultConfig, encode, POS_SHIFT, step, type Mycelium3dState } from '../../../tools/mycelium3d/world.ts';
import {
  cellCentre, cursorFromRay, isShown, layerCell, normaliseCell, pickParticle, pointerRay, shown, sphereSummary, workingLayer, type Cell, type V3, type ViewClip,
} from '../src/mycelium3d/cursor.ts';
import { OrbitCamera, PRESETS } from '../src/volume3d/camera.ts';
import { boxExtent, type VolumeDims } from '../src/volume3d/contract.ts';

const dims: VolumeDims = { W: 32, H: 32, D: 16 };
const view = (over: Partial<ViewClip> = {}, stretch = 1): ViewClip => ({ ext: boxExtent(dims, stretch), dims, peel: 0, cut: 1, ...over });
function camera(v: ViewClip, pose = 'oblique', aspect = 4 / 3) {
  const cam = new OrbitCamera();
  cam.setBox(v.ext);
  cam.setPose(PRESETS[pose]!.pose);
  return cam.info(aspect);
}
/** NDC of a world point under a column-major view-projection. */
function project(m: Float32Array, p: V3): [number, number] {
  const x = m[0]! * p[0] + m[4]! * p[1] + m[8]! * p[2] + m[12]!;
  const y = m[1]! * p[0] + m[5]! * p[1] + m[9]! * p[2] + m[13]!;
  const w = m[3]! * p[0] + m[7]! * p[1] + m[11]! * p[2] + m[15]!;
  return [x / w, y / w];
}
const rayTo = (v: ViewClip, c: Cell, pose = 'oblique', aspect = 4 / 3) => {
  const cam = camera(v, pose, aspect);
  const [nx, ny] = project(cam.viewProj, cellCentre(v, c));
  return pointerRay(cam.invViewProj, nx, ny);
};
/** A hand-made particle list, each particle at the middle of its cell. */
function parts(cells: Cell[], M = 32) {
  const mid = (a: number) => (a << POS_SHIFT) + 128;
  return { n: cells.length, x: Uint32Array.from(cells, (c) => mid(c.x)), y: Uint32Array.from(cells, (c) => mid(c.y)), z: Uint32Array.from(cells, (c) => mid(c.z)), M: Uint32Array.from(cells, () => M) };
}

describe('the pointer ray and the working layer', () => {
  it('a ray through a cell centre crosses that layer in that cell, from every pose, at a phone aspect and with the depth stretched', () => {
    for (const pose of Object.keys(PRESETS)) for (const aspect of [4 / 3, 1]) for (const stretch of [1, 3]) {
      const v = view({}, stretch);
      for (const c of [{ x: 3, y: 5, z: 0 }, { x: 20, y: 30, z: 7 }, { x: 31, y: 0, z: 15 }]) {
        expect(layerCell(rayTo(v, c, pose, aspect), v, c.z), `${pose} ${aspect} ${stretch} ${JSON.stringify(c)}`).toEqual(c);
      }
    }
  });
  it('the ray is a unit vector from near the eye into the box', () => {
    const v = view();
    const r = rayTo(v, { x: 16, y: 16, z: 8 });
    expect(Math.hypot(...r.d)).toBeCloseTo(1, 9);
    const cam = camera(v);
    expect(Math.hypot(r.o[0] - cam.eye[0], r.o[1] - cam.eye[1], r.o[2] - cam.eye[2])).toBeLessThan(0.1);
  });
  it('a ray that leaves the box before the layer, or a level ray, hits no cell', () => {
    const v = view();
    expect(layerCell({ o: [2, 0.5, 2], d: [0, -1, 0] }, v, 3)).toBeNull();
    expect(layerCell({ o: [0.5, 0.2, -1], d: [0, 0, 1] }, v, 3)).toBeNull();
    // pointing away from the layer: behind the eye does not count
    expect(layerCell({ o: [0.5, 0.9, 0.5], d: [0, 1, 0] }, v, 3)).toBeNull();
  });
});

describe('peel and cut', () => {
  it('shows the layers below the peel and the north rows the cut keeps, as visibleMax draws them', () => {
    expect(shown(view())).toEqual({ firstLayer: 0, rows: 32 });
    expect(shown(view({ peel: 5 }))).toEqual({ firstLayer: 5, rows: 32 });
    expect(shown(view({ peel: 99, cut: 0 }))).toEqual({ firstLayer: 15, rows: 1 });
    expect(shown(view({ cut: 0.5 }, 3))).toEqual({ firstLayer: 0, rows: 16 });
    expect(isShown(view({ peel: 5 }), { x: 0, y: 0, z: 4 })).toBe(false);
    expect(isShown(view({ peel: 5 }), { x: 0, y: 0, z: 5 })).toBe(true);
    expect(isShown(view({ cut: 0.5 }), { x: 0, y: 16, z: 5 })).toBe(false);
    expect(isShown(view({ cut: 0.5 }), { x: 0, y: 15, z: 5 })).toBe(true);
  });
  it('a peeled working layer moves down to the first layer shown; a cut cell is never the cursor', () => {
    const v = view({ peel: 6 });
    expect(workingLayer(v, 2)).toBe(6);
    expect(workingLayer(v, 9)).toBe(9);
    expect(workingLayer(view(), 40)).toBe(15);
    const c = { x: 10, y: 28, z: 4 };
    expect(layerCell(rayTo(view(), c), view({ cut: 0.5 }), 4)).toBeNull();
    expect(layerCell(rayTo(view(), c), view(), 4)).toEqual(c);
  });
});

describe('the depth rule: first visible particle, else the working layer', () => {
  it('snaps to the particle under the pointer, and to the nearer of two on one ray', () => {
    const v = view({}, 1);
    const target = { x: 12, y: 9, z: 6 };
    const c = cellCentre(v, target);
    // straight down the column from above the jar: a particle in the same column higher up is met first
    const ray = { o: [c[0], 2, c[2]] as V3, d: [0, -1, 0] as V3 };
    const p = parts([target, { x: 12, y: 9, z: 2 }, { x: 25, y: 25, z: 1 }]);
    const i = pickParticle(ray, p, v, 0);
    expect(i).toBe(1);
    expect(cursorFromRay(ray, p, v, 10, 0)).toEqual({ cell: { x: 12, y: 9, z: 2 }, on: 'particle' });
    // peel the upper one away: the lower one is now the first seen
    expect(pickParticle(ray, p, view({ peel: 3 }), 0)).toBe(0);
    // peel both: the working layer decides (moved below the peel)
    expect(cursorFromRay(ray, p, view({ peel: 7 }), 0, 0)).toEqual({ cell: { x: 12, y: 9, z: 7 }, on: 'layer' });
  });
  it('a near miss counts only within the pixel tolerance; without particles the working layer is used', () => {
    const v = view();
    const cam = camera(v);
    const c = cellCentre(v, { x: 16, y: 16, z: 4 });
    const s = v.ext[0] / dims.W;
    // a pointer two cells to the east of the particle
    const [nx, ny] = project(cam.viewProj, [c[0] + 2 * s, c[1], c[2]]);
    const ray = pointerRay(cam.invViewProj, nx, ny);
    const p = parts([{ x: 16, y: 16, z: 4 }]);
    expect(pickParticle(ray, p, v, 0)).toBe(-1);
    expect(pickParticle(ray, p, v, 1)).toBe(0); // a huge tolerance reaches it
    expect(cursorFromRay(ray, null, v, 4, 0)).toEqual({ cell: { x: 18, y: 16, z: 4 }, on: 'layer' });
  });
});

describe('the brush centre and the sphere it covers', () => {
  it('wraps x and y and clamps z, as the brush does', () => {
    expect(normaliseCell(dims, { x: -1, y: 33, z: -4 })).toEqual({ x: 31, y: 1, z: 0 });
    expect(normaliseCell(dims, { x: 64, y: -33, z: 99 })).toEqual({ x: 0, y: 31, z: 15 });
    expect(normaliseCell(dims, { x: 2.7, y: 3.2, z: 4.9 })).toEqual({ x: 2, y: 3, z: 4 });
  });

  const grown = (() => {
    const s = createWorld(defaultConfig({ width: 16, height: 16, depth: 8, founders: 256, maxParticles: 2048, sinkShift: 4 }));
    for (let t = 0; t < 300; t++) step(s);
    return encode(s);
  })();
  const copy = (): Mycelium3dState => decode(grown);

  it('holds what the brush then acts on: cells, particles removed by a wound, dry cells and waste for a feed (seam, floor and surface too)', () => {
    let wounded = 0, fed = 0;
    for (const [cx, cy, cz, r] of [[8, 8, 3, 3], [0, 15, 0, 2], [15, 0, 7, 4], [3, 3, 5, 0], [8, 8, 4, 9], [-2, 18, 12, 1]] as const) {
      const s = copy();
      const sum = sphereSummary(s, { x: cx, y: cy, z: cz }, r);
      const w = applyBrush3d(copy(), { kind: 'wound', cx, cy, cz, radius: r });
      expect([sum.cells, sum.particles], `${cx},${cy},${cz} r${r}`).toEqual([w.cells, w.removed]);
      const f = applyBrush3d(copy(), { kind: 'feed', cx, cy, cz, radius: r, amount: 4096 });
      expect([sum.cells, sum.dryCells, sum.waste], `${cx},${cy},${cz} r${r}`).toEqual([f.cells, f.cellsWithoutWaste, f.matterMoved]);
      wounded += w.removed; fed += f.matterMoved;
    }
    // not vacuous: the strokes did remove particles and convert waste
    expect(wounded).toBeGreaterThan(0);
    expect(fed).toBeGreaterThan(0);
    // radius 0 on a cell that holds a particle, and on one that holds waste: one cell, and not an empty answer
    const s0 = copy();
    const pc = { x: s0.x[0] >>> 8, y: s0.y[0] >>> 8, z: s0.z[0] >>> 8 };
    const one = sphereSummary(s0, pc, 0);
    expect(one.cells).toBe(1);
    expect(one.particles).toBeGreaterThan(0);
    expect(one.particles).toBe(applyBrush3d(copy(), { kind: 'wound', cx: pc.x, cy: pc.y, cz: pc.z, radius: 0 }).removed);
    const k = s0.C.findIndex((c) => c > 0);
    expect(k).toBeGreaterThanOrEqual(0);
    const wc = { x: k % 16, y: Math.floor(k / 16) % 16, z: Math.floor(k / 256) };
    const wet = sphereSummary(s0, wc, 0);
    expect([wet.cells, wet.dryCells, wet.waste]).toEqual([1, 0, s0.C[k]]);
  });
  it('changes nothing in the state', () => {
    const s = copy();
    sphereSummary(s, { x: 4, y: 4, z: 4 }, 5);
    expect(Buffer.from(encode(s)).equals(Buffer.from(grown))).toBe(true);
  });
});
