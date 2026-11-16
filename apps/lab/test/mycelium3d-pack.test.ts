// The /mycelium3d/ page's pure parts: its choices and config builder (src/mycelium3d/settings.ts), and the packers and
// census that turn a read-back of the 3D mycelium world into the volume renderer's textures, particle instances and the
// census by depth (src/mycelium3d/pack.ts).
import { describe, expect, it } from 'vitest';
import {
  censusByDepth, createWorld, defaultConfig, energyTotal, lightPlane, matterTotal, type Mycelium3dState, step, validateConfig,
} from '../../../tools/mycelium3d/world.ts';
import { familyRGB } from '../src/mycelium/colour.ts';
import { census, FIELD_DEFAULTS, familyLinear, INSTANCE_FLOATS, layerGroups, packField, packParticles, ratePer100 } from '../src/mycelium3d/pack.ts';
import { DEFAULT_CHOICE, describeChoice, SINKS, SIZES, TRAILS, worldConfig, type Choice, type Sink, type SizeId, type Trail } from '../src/mycelium3d/settings.ts';
import { cellToTexel, texelIndex } from '../src/volume3d/contract.ts';

const lin = (c: number) => Math.round(Math.pow(c, 2.2) * 255);

describe('choices and configs', () => {
  const all: Choice[] = [];
  for (const size of Object.keys(SIZES) as SizeId[]) for (const sink of Object.keys(SINKS) as Sink[]) for (const trail of Object.keys(TRAILS) as Trail[]) all.push({ size, sink, trail, seed: 7 });

  it('every size, sinking and trail rule makes a config the rules accept', () => {
    expect(all.length).toBe(27);
    for (const c of all) expect(validateConfig(worldConfig(c)), describeChoice(c)).toEqual([]);
  });

  it('the default choice is defaultConfig itself, with no optional key present, not even as undefined', () => {
    const c = worldConfig(DEFAULT_CHOICE);
    expect(c).toEqual(defaultConfig());
    expect(JSON.stringify(c)).toBe(JSON.stringify(defaultConfig()));
    for (const k of ['sinkShift', 'trailMoveDiscount', 'trailDiscountMode', 'trailOwner', 'ownerDefend', 'ownerConduit']) expect(k in c, k).toBe(false);
  });

  it('sinking sets sinkShift (off, slow 8, fast 4) and the trail rules set their own keys and nothing else', () => {
    expect('sinkShift' in worldConfig({ ...DEFAULT_CHOICE, sink: 'off' })).toBe(false);
    expect(worldConfig({ ...DEFAULT_CHOICE, sink: 'slow' }).sinkShift).toBe(8);
    expect(worldConfig({ ...DEFAULT_CHOICE, sink: 'fast' }).sinkShift).toBe(4);
    const toll = worldConfig({ ...DEFAULT_CHOICE, trail: 'toll' });
    expect([toll.moveCost, toll.trailMoveDiscount, toll.trailDiscountMode, 'trailOwner' in toll]).toEqual([12, 64, 'toll', false]);
    const owner = worldConfig({ ...DEFAULT_CHOICE, trail: 'owner' });
    expect([owner.trailOwner, owner.ownerDefend, owner.ownerConduit, 'trailMoveDiscount' in owner, 'trailConduit' in owner]).toEqual(['gid', 4, 30, false, false]);
    expect(owner.moveCost).toBe(defaultConfig().moveCost);
  });

  it('bigger worlds keep the founders and the room per cell, up to the 65,536-particle cap; the seed passes through', () => {
    const big = worldConfig({ ...DEFAULT_CHOICE, size: '64x64x32', seed: 42 });
    expect([big.width, big.height, big.depth, big.founders, big.maxParticles, big.seed]).toEqual([64, 64, 32, 8192, 65536, 42]);
    const cube = worldConfig({ ...DEFAULT_CHOICE, size: '64x64x64' });
    expect([cube.depth, cube.founders, cube.maxParticles]).toEqual([64, 16384, 65536]);
    expect(worldConfig({ ...DEFAULT_CHOICE, seed: 2 ** 32 + 5 }).seed).toBe(5);
  });
});

/** An empty 8 x 8 x 4 world with hand-placed particles and field amounts. */
function handWorld(): Mycelium3dState {
  const s = createWorld(defaultConfig({ width: 8, height: 8, depth: 4, founders: 0, maxParticles: 16 }));
  s.A.fill(0);
  const put = (i: number, x: number, y: number, z: number, M: number, gid: number) => {
    s.x[i] = x; s.y[i] = y; s.z[i] = z; s.M[i] = M; s.gid[i] = gid; s.id[i] = i;
  };
  put(0, 2 * 256 + 10, 3 * 256 + 200, 0 * 256 + 5, 16, 11); // cell (2, 3, 0): the surface
  put(1, 2 * 256 + 250, 3 * 256 + 1, 0 * 256 + 255, 48, 22); // the same cell, heavier
  put(2, 7 * 256 + 255, 7 * 256 + 255, 3 * 256 + 255, 1, 33); // cell (7, 7, 3): the floor corner
  s.n = 3;
  return s;
}
const cellOf = (W: number, H: number, x: number, y: number, z: number) => (z * H + y) * W + x;

describe('packField', () => {
  it('particles land in their cell’s texel with layer 0 on top, coloured by the heaviest particle, dense by body matter', () => {
    const s = handWorld();
    const I = lightPlane(s);
    const p = packField(s, I);
    const d = p.dims;
    expect(d).toEqual({ W: 8, H: 8, D: 4 });
    const t = texelIndex(d, ...cellToTexel(d, 2, 3, 0));
    expect(cellToTexel(d, 2, 3, 0)[1]).toBe(3); // the surface is the top row of texels
    const c = familyRGB(22).map(lin);
    expect([...p.vox.subarray(t * 4, t * 4 + 3)]).toEqual(c);
    expect(p.vox[t * 4 + 3]).toBe(Math.round(255 * Math.sqrt(Math.min(1, 64 / FIELD_DEFAULTS.bodyUnit))));
    expect(p.aux[t * 4 + 3]).toBe(255);
    const f = texelIndex(d, ...cellToTexel(d, 7, 7, 3));
    expect(cellToTexel(d, 7, 7, 3)[1]).toBe(0); // the floor is the bottom row
    expect([...p.vox.subarray(f * 4, f * 4 + 3)]).toEqual(familyRGB(33).map(lin));
    expect(p.vox[f * 4 + 3]).toBeGreaterThan(0); // even one unit of body shows
    expect(p.liveCount).toBe(2);
    expect([...p.live.subarray(0, 2)]).toEqual([t, f].sort((a, b) => a - b));
    // everything else is clear
    let dense = 0;
    for (let i = 0; i < p.vox.length; i += 4) if (p.vox[i + 3] > 0) dense++;
    expect(dense).toBe(2);
  });

  it('trail and waste are log-scaled hazes, light is the simulation’s own light plane as a share of the surface', () => {
    const s = handWorld();
    const k = cellOf(8, 8, 5, 1, 2);
    s.P[k] = FIELD_DEFAULTS.trailUnit; s.C[k] = 1;
    const k2 = cellOf(8, 8, 5, 1, 3);
    s.C[k2] = 10_000; s.P[k2] = 1;
    const I = lightPlane(s);
    const p = packField(s, I);
    const t = texelIndex(p.dims, ...cellToTexel(p.dims, 5, 1, 2)) * 4;
    const t2 = texelIndex(p.dims, ...cellToTexel(p.dims, 5, 1, 3)) * 4;
    expect(p.aux[t]).toBe(255);
    expect(p.aux[t + 2]).toBe(Math.round((255 * 1) / Math.log2(1 + FIELD_DEFAULTS.wasteUnit)));
    expect(p.aux[t2 + 2]).toBe(255);
    expect(p.aux[t2]).toBe(Math.round(255 / Math.log2(1 + FIELD_DEFAULTS.trailUnit)));
    // light: the surface is full; the cell under the particles is shaded by their 64 matter, and the column below by the trail too
    const top = s.config.light << 8;
    for (let z = 0; z < 4; z++) for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      const o = texelIndex(p.dims, ...cellToTexel(p.dims, x, y, z)) * 4;
      expect(p.aux[o + 1]).toBe(Math.round((255 * I[cellOf(8, 8, x, y, z)]) / top));
    }
    expect(p.aux[texelIndex(p.dims, ...cellToTexel(p.dims, 0, 0, 0)) * 4 + 1]).toBe(255);
    expect(p.aux[texelIndex(p.dims, ...cellToTexel(p.dims, 2, 3, 1)) * 4 + 1]).toBeLessThan(255);
  });

  it('repacks into the same buffers when the dims match, clearing what moved away', () => {
    const s = handWorld();
    const a = packField(s, lightPlane(s));
    s.n = 1;
    const b = packField(s, lightPlane(s), {}, a);
    expect(b).toBe(a);
    expect(b.liveCount).toBe(1);
    let dense = 0;
    for (let i = 0; i < b.vox.length; i += 4) if (b.vox[i + 3] > 0) dense++;
    expect(dense).toBe(1);
    const other = createWorld(defaultConfig({ width: 8, height: 8, depth: 2, founders: 0 }));
    expect(packField(other, lightPlane(other), {}, a)).not.toBe(a);
  });
});

describe('packParticles', () => {
  it('every particle sits strictly inside its own cell’s texel box, layer 0 at the top, with its family colour and light', () => {
    const s = createWorld(defaultConfig({ width: 8, height: 8, depth: 4, founders: 200, maxParticles: 256, seed: 3 }));
    for (let t = 0; t < 30; t++) step(s);
    const I = lightPlane(s);
    const inst = packParticles(s, I);
    expect(inst.count).toBe(s.n);
    expect(s.n).toBeGreaterThan(0);
    const d = { W: 8, H: 8, D: 4 };
    const top = s.config.light << 8;
    for (let i = 0; i < s.n; i++) {
      const o = i * INSTANCE_FLOATS;
      const cx = s.x[i] >>> 8, cy = s.y[i] >>> 8, cz = s.z[i] >>> 8;
      const [u, v, w] = cellToTexel(d, cx, cy, cz);
      const p = inst.data.subarray(o, o + 3);
      expect(p[0]).toBeGreaterThan(u); expect(p[0]).toBeLessThan(u + 1);
      expect(p[1]).toBeGreaterThan(v); expect(p[1]).toBeLessThan(v + 1);
      expect(p[2]).toBeGreaterThan(w); expect(p[2]).toBeLessThan(w + 1);
      const c = familyLinear(s.gid[i]);
      expect([...inst.data.subarray(o + 4, o + 7)].map((x) => Math.round(x * 255))).toEqual(c);
      expect(inst.data[o + 7]).toBeCloseTo(I[(cz * 8 + cy) * 8 + cx] / top, 6);
      expect(inst.data[o + 3]).toBeGreaterThan(0.2);
    }
  });

  it('the hand-placed particles: surface near the top of the box, floor corner near its bottom', () => {
    const s = handWorld();
    const inst = packParticles(s, lightPlane(s));
    expect(inst.data[1]).toBeCloseTo(4 - 5.5 / 256, 6);
    expect(inst.data[INSTANCE_FLOATS * 2 + 1]).toBeCloseTo(4 - 1023.5 / 256, 6);
    expect(inst.data[INSTANCE_FLOATS * 2]).toBeCloseTo(2047.5 / 256, 6);
    // reuses a big enough buffer
    expect(packParticles(s, lightPlane(s), inst)).toBe(inst);
  });
});

describe('census by depth', () => {
  it('layer groups: at most eight, equal, covering every layer once', () => {
    expect(layerGroups(16)).toEqual([[0, 1], [2, 3], [4, 5], [6, 7], [8, 9], [10, 11], [12, 13], [14, 15]]);
    expect(layerGroups(32).length).toBe(8);
    expect(layerGroups(32)[7]).toEqual([28, 31]);
    expect(layerGroups(64)[1]).toEqual([8, 15]);
    expect(layerGroups(4)).toEqual([[0, 0], [1, 1], [2, 2], [3, 3]]);
  });

  it('agrees with the reference census, totals the ledger, and reads residuals of exactly 0 on a stepped world with sinking', () => {
    const s = createWorld(defaultConfig({ width: 8, height: 8, depth: 16, founders: 300, maxParticles: 1024, seed: 5, sinkShift: 4 }));
    for (let t = 0; t < 60; t++) step(s);
    const I = lightPlane(s);
    const c = census(s, I);
    expect([c.matterResidual, c.energyResidual]).toEqual([0, 0]);
    expect(c.step).toBe(60);
    expect(c.particles).toBe(s.n);
    const ref = censusByDepth(s);
    for (const g of c.groups) {
      const rows = ref.filter((r) => r.z >= g.z0 && r.z <= g.z1);
      const sum = (k: 'particles' | 'M' | 'A' | 'C' | 'P') => rows.reduce((a, r) => a + r[k], 0);
      expect([g.particles, g.M, g.A, g.C, g.P]).toEqual([sum('particles'), sum('M'), sum('A'), sum('C'), sum('P')]);
      expect(g.light).toBeGreaterThanOrEqual(0); expect(g.light).toBeLessThanOrEqual(1);
    }
    expect(c.groups[0]!.light).toBeGreaterThan(c.groups[7]!.light);
    const total = c.groups.reduce((a, g) => a + g.A + g.C + g.P + g.M, 0);
    expect(total).toBe(matterTotal(s));
    expect(energyTotal(s)).toBe(s.energy0 + s.totals.lightIn - s.totals.heat);
  });

  it('a broken book shows up as a non-zero residual (the page stops on it)', () => {
    const s = createWorld(defaultConfig({ width: 8, height: 8, depth: 4, founders: 10 }));
    s.A[0] += 3;
    const c = census(s, lightPlane(s));
    expect(c.matterResidual).toBe(3);
    expect(c.energyResidual).toBe(3 * s.config.eA);
  });

  it('rates per 100 steps', () => {
    expect(ratePer100({ step: 100, births: 10, deaths: 5, refused: 0 }, { step: 300, births: 50, deaths: 25, refused: 4 })).toEqual({ births: 20, deaths: 10, refused: 2 });
    expect(ratePer100({ step: 3, births: 0, deaths: 0, refused: 0 }, { step: 3, births: 1, deaths: 0, refused: 0 })).toBeNull();
  });
});
