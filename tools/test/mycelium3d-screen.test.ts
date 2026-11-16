// The 3D mycelium screen's pure readouts (tools/mycelium3d/observe-screen.ts): the 36-run grid validates, upward transport on a tiny
// synthetic pair of states (sign, id matching, what it misses), the largest 6-connected trail component (wrap in x and y, closed z),
// owner edges, the readout by depth against the world's totals, the projections, and the fingerprint.
import { describe, expect, it } from "vitest";
import { createWorld, defaultConfig, matterTotal, type Mycelium3dState, POS_SHIFT, step, validateConfig } from "../mycelium3d/world.ts";
import {
  addTransport, componentSpans, contactSheet, drawText, emptyTransport, fieldFlux, fingerprint, GROUPS, groupOf, largestComponent, logT, ownerEdges, projections, readout,
  screenConfig, SEEDS, SETTINGS, sharedMax, textWidth,
} from "../mycelium3d/observe-screen.ts";

const L = 1 << POS_SHIFT;
const bodies = (rows: [id: number, zCells: number, M: number][]) => ({
  n: rows.length, id: Uint32Array.from(rows.map((r) => r[0])), z: Uint32Array.from(rows.map((r) => Math.round(r[1] * L))), M: Uint32Array.from(rows.map((r) => r[2])),
});

describe("the grid", () => {
  it("has 18 settings x 2 seeds, all valid configs, each distinct", () => {
    expect(SETTINGS.length).toBe(18);
    const cfgs = SETTINGS.flatMap((st) => SEEDS.map((sd) => screenConfig(st, sd)));
    expect(cfgs.length).toBe(36);
    for (const c of cfgs) expect(validateConfig(c)).toEqual([]);
    expect(new Set(cfgs.map((c) => JSON.stringify(c))).size).toBe(36);
  });
  it("sets the arms as stated: toll raises moveCost, owner has no toll, off has no sinkShift key", () => {
    const pick = (id: string) => screenConfig(SETTINGS.find((s) => s.id === id)!, 1);
    const off = pick("sinkoff.none.k16");
    expect("sinkShift" in off).toBe(false);
    expect([off.width, off.height, off.depth, off.founders, off.maxParticles, off.lightK, off.moveCost]).toEqual([64, 64, 32, 8192, 65536, 16, 2]);
    const toll = pick("sink4.toll.k64");
    expect([toll.sinkShift, toll.moveCost, toll.trailMoveDiscount, toll.trailDiscountMode, toll.trailOwner]).toEqual([4, 12, 64, "toll", undefined]);
    const own = pick("sink6.owner.k64");
    expect([own.trailOwner, own.ownerDefend, own.ownerConduit, own.ownerConduitCap, own.trailMoveDiscount, own.moveCost]).toEqual(["gid", 4, 30, undefined, undefined, 2]);
  });
  it("fingerprints change with any setting", () => {
    const c = screenConfig(SETTINGS[0], 1);
    const f = fingerprint(c, 50000, 2000, 20);
    expect(fingerprint(c, 50000, 2000, 20)).toBe(f);
    expect(fingerprint(c, 30000, 2000, 20)).not.toBe(f);
    expect(fingerprint(c, 50000, 2000, 50)).not.toBe(f);
    expect(fingerprint({ ...c, seed: 2 }, 50000, 2000, 20)).not.toBe(f);
  });
});

describe("upward transport", () => {
  it("counts rising (z falling) as up, weights by the earlier M, matches by id and skips the born and the dead", () => {
    // id 0 rises 3 layers with M 10; id 2 sinks 1.5 layers with M 4; id 1 dies; id 5 is born; id 3 stays.
    const before = bodies([[0, 10, 10], [1, 5, 7], [2, 2, 4], [3, 8, 1]]);
    const after = bodies([[0, 7, 99], [2, 3.5, 4], [3, 8, 1], [5, 0, 50]]);
    const t = addTransport(emptyTransport(), before, after);
    expect(t.up).toBe(30);
    expect(t.down).toBe(6);
    expect(t.net).toBe(24);
    expect(t.matched).toBe(15);
    expect(t.total).toBe(22);
  });
  it("accumulates over intervals and nets to zero on a round trip", () => {
    const a = bodies([[4, 1, 8]]), b = bodies([[4, 5, 8]]);
    const t = addTransport(addTransport(emptyTransport(), a, b), b, a);
    expect([t.up, t.down, t.net, t.matched, t.total]).toEqual([32, 32, 0, 16, 16]);
  });
});

describe("field flux", () => {
  it("sends (C + P) / 2^k down from every layer above the floor, and diffuses up the gradient at De / 1536 per face", () => {
    const l = { A: [3072, 0, 0], C: [0, 0, 1536], P: [64, 32, 1000] };
    const f = fieldFlux(l, { depth: 3, diffA: 40, diffC: 20, sinkShift: 4 });
    expect(f.sinkDown).toBe((0 + 64 + 0 + 32) / 16);
    expect(f.diffUpA).toBe((-3072 * 40) / 1536);
    expect(f.diffUpC).toBe(20);
    expect(fieldFlux(l, { depth: 3, diffA: 40, diffC: 20 }).sinkDown).toBe(0);
    // Diffusion reads the profile after sinking: C 1600, 0, 0 at sinkShift 4 sends 100 into layer 1 first.
    const g = fieldFlux({ A: [0, 0, 0], C: [1600, 0, 0], P: [0, 0, 0] }, { depth: 3, diffA: 0, diffC: 1536, sinkShift: 4 });
    expect(g.sinkDown).toBe(100);
    expect(g.diffUpC).toBe((100 - 1500) + (0 - 100));
  });
});

describe("largest trail component", () => {
  const W = 8, H = 8, D = 8;
  const at = (x: number, y: number, z: number) => (z * H + y) * W + x;
  it("is empty without trail and respects the threshold", () => {
    const P = new Uint32Array(W * H * D);
    expect(largestComponent(P, W, H, D)).toEqual({ size: 0, zMin: -1, zMax: -1, byGroup: new Array(GROUPS).fill(0) });
    P[at(1, 1, 1)] = 1;
    expect(largestComponent(P, W, H, D, 2).size).toBe(0);
    expect(largestComponent(P, W, H, D).size).toBe(1);
  });
  it("joins a vertical column, wraps in x and y, but not in z", () => {
    const P = new Uint32Array(W * H * D);
    for (let z = 2; z <= 6; z++) P[at(3, 3, z)] = 5; // a column of 5 cells, z 2..6
    P[at(0, 0, 0)] = 1; P[at(W - 1, 0, 0)] = 1; P[at(0, H - 1, 0)] = 1; // three cells joined across the x and y wraps
    P[at(5, 5, 0)] = 1; P[at(5, 5, D - 1)] = 1; // z does not wrap: two singletons
    const c = largestComponent(P, W, H, D);
    expect(c).toEqual({ size: 5, zMin: 2, zMax: 6, byGroup: [0, 0, 1, 1, 1, 1, 1, 0] });
    for (let z = 2; z <= 6; z++) P[at(3, 3, z)] = 0;
    expect(largestComponent(P, W, H, D).size).toBe(3);
  });
  it("leaves out the floor when zLimit is D - 1", () => {
    const P = new Uint32Array(W * H * D);
    for (let x = 0; x < W; x++) P[at(x, 0, D - 1)] = 1; // a floor carpet row of 8
    P[at(2, 2, 3)] = 1; P[at(2, 2, 4)] = 1;
    expect(largestComponent(P, W, H, D).size).toBe(8);
    expect(largestComponent(P, W, H, D, 1, D - 1)).toMatchObject({ size: 2, zMin: 3, zMax: 4 });
  });
});

describe("spans over every component", () => {
  it("counts a small top-to-floor column that is not the largest component", () => {
    const W = 8, H = 8, D = 16;
    const at = (x: number, y: number, z: number) => (z * H + y) * W + x;
    const P = new Uint32Array(W * H * D);
    for (let z = 0; z < D; z++) P[at(1, 1, z)] = 1; // a 16-cell column, surface to floor
    for (let x = 0; x < W; x++) for (let y = 4; y < 7; y++) P[at(x, y, 8)] = 1; // a 24-cell sheet at z 8, the largest
    for (let z = 2; z <= 13; z++) P[at(5, 1, z)] = 1; // groups G2..G7 only (2 layers per group): spans 12, reaches neither end group
    const s = componentSpans(P, W, H, D);
    expect(largestComponent(P, W, H, D).size).toBe(24);
    expect(s).toEqual({ components: 3, maxSpan: 16, topToFloorGroups: 1, topToFloorLayers: 1 });
    P[at(1, 1, 0)] = 0; // now from z 1 (still group G1) to the floor
    expect(componentSpans(P, W, H, D)).toEqual({ components: 3, maxSpan: 15, topToFloorGroups: 1, topToFloorLayers: 0 });
    expect(componentSpans(new Uint32Array(W * H * D), W, H, D)).toEqual({ components: 0, maxSpan: 0, topToFloorGroups: 0, topToFloorLayers: 0 });
  });
});

describe("owner edges", () => {
  it("counts directed face edges from owned cells and the median min(Q, Q) on same-owner ones", () => {
    const W = 8, H = 8, D = 2, N = W * H * D;
    const Z = new Uint32Array(N), Q = new Uint32Array(N);
    Z[0] = 3; Q[0] = 10; Z[1] = 3; Q[1] = 4; Z[2] = 9; Q[2] = 1;
    // Cell 0 has 5 faces (z = 0, no up), 1 same-owner (cell 1); cell 1: 5 faces, 1 same (cell 0); cell 2: 5 faces, 0 same.
    const e = ownerEdges(Z, Q, W, H, D);
    expect(e.owned).toBe(15);
    expect(e.sameShare).toBeCloseTo(2 / 15, 12);
    expect(e.medianMinQ).toBe(4);
  });
});

describe("readout and projections on a small real world", () => {
  const c = defaultConfig({ width: 16, height: 16, depth: 8, founders: 256, maxParticles: 2048, sinkShift: 4, trailOwner: "gid", ownerDefend: 4 });
  const s: Mycelium3dState = createWorld(c);
  for (let t = 0; t < 60; t++) step(s);
  it("groups add up to the world's totals", () => {
    const r = readout(s);
    const sum = (k: "particles" | "M" | "A" | "C" | "P") => r.groups.reduce((t, g) => t + g[k], 0);
    expect(sum("particles")).toBe(s.n);
    expect(sum("A") + sum("C") + sum("P") + sum("M")).toBe(matterTotal(s));
    expect(sum("P")).toBe(r.trailMass);
    expect(r.groups.length).toBe(GROUPS);
    expect(r.layers.C.length).toBe(8);
    expect(r.layers.particles.reduce((a, b) => a + b, 0)).toBe(s.n);
    expect(r.layers.C.reduce((a, b) => a + b, 0)).toBe(sum("C"));
    expect(r.owner).not.toBeNull();
    expect(r.occTrailFrac).toBeGreaterThanOrEqual(0);
    expect(r.occTrailFrac).toBeLessThanOrEqual(1);
    expect(r.comp.size).toBeGreaterThanOrEqual(r.compAboveFloor.size);
    expect(r.spans.maxSpan).toBeGreaterThanOrEqual(r.comp.size ? r.comp.zMax - r.comp.zMin + 1 : 0);
    expect(groupOf(0, 8)).toBe(0); expect(groupOf(7, 8)).toBe(7); expect(groupOf(31, 32)).toBe(7); expect(groupOf(4, 32)).toBe(1);
  });
  it("projections conserve the particle count and the trail", () => {
    const p = projections(s);
    const tot = (v: number[]) => v.reduce((a, b) => a + b, 0);
    let P = 0;
    for (let k = 0; k < s.P.length; k++) P += s.P[k];
    expect([tot(p.sideParticles), tot(p.topParticles)]).toEqual([s.n, s.n]);
    expect([tot(p.sideTrail), tot(p.topTrail)]).toEqual([P, P]);
    expect([p.sideParticles.length, p.topParticles.length]).toEqual([16 * 8, 16 * 16]);
  });
  it("projects a single particle and a single trail cell to the right pixels", () => {
    const one = createWorld(defaultConfig({ width: 16, height: 16, depth: 8, founders: 1, maxParticles: 16 }));
    one.x[0] = 5 * L + 3; one.y[0] = 9 * L; one.z[0] = 6 * L + 200;
    one.P[(2 * 16 + 4) * 16 + 7] = 11; // x 7, y 4, z 2
    const p = projections(one);
    expect(p.sideParticles[6 * 16 + 5]).toBe(1);
    expect(p.topParticles[9 * 16 + 5]).toBe(1);
    expect(p.sideTrail[2 * 16 + 7]).toBe(11);
    expect(p.topTrail[4 * 16 + 7]).toBe(11);
  });
  it("draws a contact sheet as a PNG on a shared scale", async () => {
    const p = projections(s);
    const mx = sharedMax([p, p]);
    expect(logT(0, mx.trail)).toBe(0);
    expect(logT(mx.trail, mx.trail)).toBe(1);
    const png = await contactSheet([{ p, label: "A" }, { p, label: "B" }], mx, 2, ["HEADER"]);
    expect(Array.from(png.subarray(1, 4))).toEqual([0x50, 0x4e, 0x47]);
  });
  it("draws text inside the image only", () => {
    const img = new Uint8Array(20 * 10 * 3);
    drawText(img, 20, 0, 0, "1", 1, [255, 255, 255]);
    // "1" is 010 / 110 / 010 / 010 / 111.
    expect(img[(0 * 20 + 1) * 3]).toBe(255);
    expect(img[(0 * 20 + 0) * 3]).toBe(0);
    expect(img[(4 * 20 + 0) * 3]).toBe(255);
    expect(textWidth("AB", 2)).toBe(14);
    expect(() => drawText(img, 20, 15, 8, "WWW", 2, [1, 1, 1])).not.toThrow();
  });
});
