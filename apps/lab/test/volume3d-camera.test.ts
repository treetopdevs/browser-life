// The volume view's orbit camera (ported from the sandbox's volume-camera.test.ts), with its box-relative poses.
import { describe, expect, it } from "vitest";
import { DIST_MAX, DIST_MIN, OrbitCamera, PITCH_LIMIT, PRESETS, mat4Mul } from "../src/volume3d/camera.ts";
import { boxExtent } from "../src/volume3d/contract.ts";

const project = (vp: Float32Array, p: [number, number, number]) => {
  const v = [0, 1, 2, 3].map((r) => vp[12 + r]! + p[0] * vp[r]! + p[1] * vp[4 + r]! + p[2] * vp[8 + r]!);
  return [v[0]! / v[3]!, v[1]! / v[3]!, v[2]! / v[3]!];
};

describe("volume3d camera", () => {
  it("clamps pitch short of the poles and bounds zoom", () => {
    const c = new OrbitCamera();
    c.orbit(0, 100);
    expect(c.pitch).toBeCloseTo(PITCH_LIMIT);
    c.orbit(0, -200);
    expect(c.pitch).toBeCloseTo(-PITCH_LIMIT);
    for (let i = 0; i < 100; i++) c.zoom(0.5);
    expect(c.dist).toBe(DIST_MIN);
    for (let i = 0; i < 100; i++) c.zoom(2);
    expect(c.dist).toBe(DIST_MAX);
  });

  it("invViewProj undoes viewProj for every pose and aspect", () => {
    for (const p of Object.values(PRESETS)) for (const aspect of [0.7, 1, 1.6]) {
      const c = new OrbitCamera();
      c.setBox(boxExtent({ W: 256, H: 256, D: 8 }));
      c.setPose(p.pose);
      const info = c.info(aspect);
      const id = mat4Mul(info.invViewProj, info.viewProj);
      for (let i = 0; i < 16; i++) expect(id[i]).toBeCloseTo(i % 5 === 0 ? 1 : 0, 3);
    }
  });

  it("poses look at the middle of whatever box is set: the sheet's centre projects to the screen centre", () => {
    for (const dims of [{ W: 256, H: 256, D: 8 }, { W: 64, H: 64, D: 64 }]) {
      const ext = boxExtent(dims);
      const c = new OrbitCamera();
      c.setBox(ext);
      c.setPose(PRESETS.oblique!.pose);
      const [x, y, z] = project(c.info(1.6).viewProj, [ext[0] / 2, ext[1] / 2, ext[2] / 2]);
      expect(x).toBeCloseTo(0, 5);
      expect(y).toBeCloseTo(0, 5);
      expect(z).toBeGreaterThan(0);
      expect(z).toBeLessThan(1);
    }
  });

  it("a portrait view zoomed all the way out still has the whole box inside the far plane", () => {
    const dims = { W: 64, H: 64, D: 64 };
    const ext = boxExtent(dims);
    const c = new OrbitCamera();
    c.setBox(ext);
    c.setPose(PRESETS.oblique!.pose);
    c.zoom(1e9);
    expect(c.dist).toBe(DIST_MAX);
    const vp = c.info(0.5).viewProj; // the eye backs off by 2.6, to 15.6 units
    for (const corner of [[0, 0, 0], [ext[0], 0, 0], [0, ext[1], 0], [0, 0, ext[2]], [ext[0], ext[1], 0], [ext[0], 0, ext[2]], [0, ext[1], ext[2]], ext] as [number, number, number][]) {
      const z = project(vp, corner)[2];
      expect(z).toBeGreaterThan(0);
      expect(z).toBeLessThan(1);
    }
  });

  it("from straight above, east is to the right and north is up, as in the top-down Layers view", () => {
    const ext = boxExtent({ W: 256, H: 256, D: 8 });
    const c = new OrbitCamera();
    c.setBox(ext);
    c.setPose(PRESETS.above!.pose);
    const vp = c.info(1).viewProj;
    const mid = (x: number, z: number) => project(vp, [x, ext[1], z]);
    expect(mid(0.9, 0.5)[0]).toBeGreaterThan(mid(0.1, 0.5)[0]); // east (larger x) further right
    expect(mid(0.5, 0.1)[1]).toBeGreaterThan(mid(0.5, 0.9)[1]); // north (small sim y = small world z) higher on screen
  });

  it("the surface (layer 0) is above the floor on screen from the side", () => {
    const ext = boxExtent({ W: 256, H: 256, D: 8 });
    const c = new OrbitCamera();
    c.setBox(ext);
    c.setPose(PRESETS.side!.pose);
    const vp = c.info(1.6).viewProj;
    expect(project(vp, [0.5, ext[1], 0.5])[1]).toBeGreaterThan(project(vp, [0.5, 0, 0.5])[1]);
  });
});
