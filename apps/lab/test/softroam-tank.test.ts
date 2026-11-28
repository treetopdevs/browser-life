import { describe, expect, it } from 'vitest';
import { defaultSoftRoamConfig, planEntry, ROAM_GENES, SOFT_U, SoftRoamWorld, type SoftRoamConfig } from '../src/softroam/kernel.ts';
import {
  ISO_PITCH,
  projectPoint,
  TANK_CELL_STRIDE,
  TANK_DIST_MAX,
  TANK_DIST_MIN,
  TANK_LINK_STRIDE,
  TANK_PITCH_MAX,
  TANK_PITCH_MIN,
  TankCamera,
  tankElevation,
  tankHeightFor,
} from '../src/softroam/tank-math.ts';
import { foundSoftRoam, packSoftRoamTank, paintSoftRoam, SoftPaintMemory, SoftRoamSession } from '../src/softroam/view.ts';

const U = SOFT_U;
const SITTER = Array.from({ length: ROAM_GENES }, () => 0);

describe('soft roam 3D tank camera & math', () => {
  it('clamps orbit pitch and zoom distance to safe bounds', () => {
    const cam = new TankCamera('tilted');
    cam.orbit(1.5, 10);
    expect(cam.pitch).toBe(TANK_PITCH_MAX);
    cam.orbit(-0.5, -10);
    expect(cam.pitch).toBe(TANK_PITCH_MIN);
    cam.zoom(0.01);
    expect(cam.dist).toBe(TANK_DIST_MIN);
    cam.zoom(100);
    expect(cam.dist).toBe(TANK_DIST_MAX);
  });

  it('separates floor and elevated points on screen in tilted, iso and side views', () => {
    const tankH = tankHeightFor(3);
    for (const preset of ['tilted', 'iso', 'side'] as const) {
      const cam = new TankCamera(preset);
      const { viewProj } = cam.matrices(1, tankH);
      const floor = projectPoint(viewProj, 0.5, 0, 0.5);
      const top = projectPoint(viewProj, 0.5, tankH, 0.5);
      expect(top[1], `${preset} top should project above floor`).toBeGreaterThan(floor[1] + 0.15);
    }
  });

  it('fits all eight tank corners inside the viewport for every default preset', () => {
    const tankH = tankHeightFor(3);
    for (const preset of ['tilted', 'iso', 'side', 'top'] as const) {
      const cam = new TankCamera(preset);
      const { viewProj } = cam.matrices(1, tankH);
      for (const x of [0, 1]) for (const y of [0, tankH]) for (const z of [0, 1]) {
        const [nx, ny] = projectPoint(viewProj, x, y, z);
        expect(Math.abs(nx), `${preset} corner (${x},${y},${z}) x`).toBeLessThanOrEqual(0.98);
        expect(Math.abs(ny), `${preset} corner (${x},${y},${z}) y`).toBeLessThanOrEqual(0.98);
      }
    }
  });

  it('uses true orthographic projection for iso and perspective foreshortening for tilted', () => {
    const tankH = tankHeightFor(3);
    const iso = new TankCamera('iso');
    expect(iso.projection).toBe('ortho');
    expect(iso.pitch).toBeCloseTo(ISO_PITCH, 5);
    const isoM = iso.matrices(1, tankH);
    expect(isoM.isOrtho).toBe(true);
    // In orthographic projection, equal world widths at near and far z have identical screen span.
    const nearSpan = Math.hypot(
      projectPoint(isoM.viewProj, 0.8, 0, 0.8)[0] - projectPoint(isoM.viewProj, 0.2, 0, 0.8)[0],
      projectPoint(isoM.viewProj, 0.8, 0, 0.8)[1] - projectPoint(isoM.viewProj, 0.2, 0, 0.8)[1],
    );
    const farSpan = Math.hypot(
      projectPoint(isoM.viewProj, 0.8, 0, 0.2)[0] - projectPoint(isoM.viewProj, 0.2, 0, 0.2)[0],
      projectPoint(isoM.viewProj, 0.8, 0, 0.2)[1] - projectPoint(isoM.viewProj, 0.2, 0, 0.2)[1],
    );
    expect(nearSpan).toBeCloseTo(farSpan, 4);

    // In perspective projection, the nearer floor edge spans more NDC width than the far edge.
    const persp = new TankCamera('tilted');
    persp.yaw = 0; // looking straight from +z toward -z
    const pM = persp.matrices(1, tankH);
    expect(pM.isOrtho).toBe(false);
    const pNear = Math.abs(projectPoint(pM.viewProj, 0.9, 0, 0.9)[0] - projectPoint(pM.viewProj, 0.1, 0, 0.9)[0]);
    const pFar = Math.abs(projectPoint(pM.viewProj, 0.9, 0, 0.1)[0] - projectPoint(pM.viewProj, 0.1, 0, 0.1)[0]);
    expect(pNear).toBeGreaterThan(pFar * 1.15);
  });

  it('orders elevation monotonically across levels inside the tank height', () => {
    const h = tankHeightFor(3);
    const r = 0.005;
    const y0 = tankElevation(0, 3, h, r);
    const y1 = tankElevation(0.5, 3, h, r);
    const y2 = tankElevation(1, 3, h, r);
    expect(y0).toBeGreaterThan(0);
    expect(y1).toBeGreaterThan(y0);
    expect(y2).toBeGreaterThan(y1);
    expect(y2).toBeLessThan(h);
  });
});

describe('soft roam 3D tank snapshot packing', () => {
  const still = (over: Partial<SoftRoamConfig> = {}): SoftRoamConfig => ({
    ...defaultSoftRoamConfig(),
    size: 16,
    matter: 700_000,
    maxCells: 64,
    startPatches: 0,
    patchEvery: 1_000_000,
    leakSide: 0,
    leakCell: 0,
    depth: 3,
    depthGap: 1000,
    depthDive: 0,
    ...over,
  });

  it('packs cells at distinct 3D elevations matching their depth levels', () => {
    const w = new SoftRoamWorld(still());
    const rest = w.addPlan(Array.from({ length: 16 }, () => planEntry(0, 15, 15)));
    const c0 = w.found(4 * U, 8 * U, SITTER, 1, 400, rest);
    const c1 = w.found(8 * U, 8 * U, SITTER, 2, 400, rest);
    const c2 = w.found(12 * U, 8 * U, SITTER, 3, 400, rest);
    w.setLevel(c0, 0);
    w.setLevel(c1, 1);
    w.setLevel(c2, 2);

    const snap = packSoftRoamTank(w, 1, new SoftPaintMemory());
    expect(snap.size).toBe(16);
    expect(snap.levels).toBe(3);
    expect(snap.cellCount).toBe(3);
    expect(snap.floorTex.length).toBe(16 * 16 * 4);

    // Extract elevations by x coordinate (c0 at 0.25, c1 at 0.5, c2 at 0.75).
    const ys = new Map<number, number>();
    for (let i = 0; i < snap.cellCount; i++) {
      const o = i * TANK_CELL_STRIDE;
      const x = snap.cells[o]!;
      const y = snap.cells[o + 1]!;
      const z = snap.cells[o + 2]!;
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(1);
      expect(z).toBeGreaterThanOrEqual(0);
      expect(z).toBeLessThanOrEqual(1);
      ys.set(Math.round(x * 16), y);
    }
    expect(ys.get(8)!).toBeGreaterThan(ys.get(4)! + 0.05);
    expect(ys.get(12)!).toBeGreaterThan(ys.get(8)! + 0.05);
  });

  it('omits mother-daughter strands that cross the torus seam', () => {
    const w = new SoftRoamWorld(still());
    const rest = w.addPlan(Array.from({ length: 16 }, () => planEntry(0, 15, 15)));
    const m = w.found(2 * U, 8 * U, SITTER, 1, 400, rest);
    const d = w.found(4 * U, 8 * U, SITTER, 1, 400, rest);
    // Join d to m manually: first close together (should produce 1 link), then across the seam (should produce 0).
    w.mother[d] = m;
    w.x[m] = 1 * U;
    w.x[d] = 2 * U;
    const near = packSoftRoamTank(w, 1, new SoftPaintMemory());
    expect(near.linkCount).toBe(1);
    expect(near.links.length).toBe(TANK_LINK_STRIDE);

    w.x[m] = Math.round(0.5 * U);
    w.x[d] = Math.round(15.5 * U);
    const wrapped = packSoftRoamTank(w, 1, new SoftPaintMemory());
    expect(wrapped.linkCount).toBe(0);
  });

  it('runs through SoftRoamSession.frame("tank") with exact matter balance', () => {
    const s = new SoftRoamSession({ seed: 1, size: 32, start: 'deep' }, 4);
    s.advance(10, 500);
    const frame = s.frame('tank', 1);
    expect(frame.tank).toBeDefined();
    expect(frame.pixels.length).toBe(0);
    expect(frame.census.residual).toBe(0);
    expect(frame.tank!.levels).toBe(3);
    expect(frame.tank!.cellCount).toBe(frame.census.cells);
  });

  it('leaves the world state identical between tank and garden looks', () => {
    const a = foundSoftRoam({ seed: 2, size: 32, start: 'deep' });
    const b = foundSoftRoam({ seed: 2, size: 32, start: 'deep' });
    const memA = new SoftPaintMemory();
    for (let t = 0; t < 5; t++) {
      a.stepOnce();
      b.stepOnce();
      packSoftRoamTank(a, 1, memA);
    }
    expect(a.digest()).toBe(b.digest());
  });

  it('rejects passing "tank" directly to the 2D pixel painter', () => {
    const w = new SoftRoamWorld(still());
    const out = new Uint8Array(16 * 4 * 16 * 4 * 4);
    expect(() => paintSoftRoam(w, 'tank', 4, 1, out)).toThrow(/packSoftRoamTank/);
  });
});
