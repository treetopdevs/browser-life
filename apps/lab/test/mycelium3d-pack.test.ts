// The /mycelium3d/ page's pure parts: its choices and config builder (src/mycelium3d/settings.ts), and the packers and
// census that turn a read-back of the 3D mycelium world into the volume renderer's textures, particle instances, bond links
// and the census by depth (src/mycelium3d/pack.ts).
import { describe, expect, it } from 'vitest';
import {
  BOND_NONE, censusByDepth, createWorld, defaultConfig, energyTotal, lightPlane, matterTotal, type Mycelium3dState, step, validateConfig, validateState,
} from '../../../tools/mycelium3d/world.ts';
import { bondReadout } from '../../../tools/mycelium3d/observe-screen.ts';
import { familyRGB } from '../src/mycelium/colour.ts';
import { census, FIELD_DEFAULTS, familyLinear, INSTANCE_FLOATS, layerGroups, LINK_FLOATS, packField, packLinks, packParticles, ratePer100 } from '../src/mycelium3d/pack.ts';
import {
  BONDS, choiceFromQuery, choiceQuery, DEFAULT_CHOICE, describeChoice, isBonds, SINKS, SIZES, TRAILS, worldConfig, type Bonds, type Choice, type Sink, type SizeId, type Trail,
} from '../src/mycelium3d/settings.ts';
import { cellToTexel, texelIndex } from '../src/volume3d/contract.ts';

const lin = (c: number) => Math.round(Math.pow(c, 2.2) * 255);

describe('choices and configs', () => {
  const all: Choice[] = [];
  for (const size of Object.keys(SIZES) as SizeId[]) for (const sink of Object.keys(SINKS) as Sink[]) for (const trail of Object.keys(TRAILS) as Trail[]) {
    for (const bonds of Object.keys(BONDS) as Bonds[]) all.push({ size, sink, trail, bonds, seed: 7 });
  }

  it('every size, sinking, trail rule and bonds choice makes a config the rules accept', () => {
    expect(all.length).toBe(81);
    for (const c of all) expect(validateConfig(worldConfig(c)), describeChoice(c)).toEqual([]);
  });

  it('the default choice is defaultConfig itself, with no optional key present, not even as undefined', () => {
    const c = worldConfig(DEFAULT_CHOICE);
    expect(c).toEqual(defaultConfig());
    expect(JSON.stringify(c)).toBe(JSON.stringify(defaultConfig()));
    for (const k of ['sinkShift', 'trailMoveDiscount', 'trailDiscountMode', 'trailOwner', 'ownerDefend', 'ownerConduit', 'bondBreak', 'bondCost', 'bondChild']) expect(k in c, k).toBe(false);
    expect(DEFAULT_CHOICE.bonds).toBe('off');
  });

  it('bonds: off sets no key, upkeep sets break 1024 and cost 1, free sets break 1024 and no cost key; the words say which', () => {
    const keys = (b: Bonds) => { const c = worldConfig({ ...DEFAULT_CHOICE, bonds: b }); return ['bondBreak', 'bondCost', 'bondChild'].map((k) => (k in c ? c[k as 'bondBreak'] : 'absent')); };
    expect(keys('off')).toEqual(['absent', 'absent', 'absent']);
    expect(keys('upkeep')).toEqual([1024, 1, 'absent']);
    expect(keys('free')).toEqual([1024, 'absent', 'absent']);
    expect(worldConfig({ ...DEFAULT_CHOICE, bonds: 'free', trail: 'owner', sink: 'fast' })).toEqual(defaultConfig({ trailOwner: 'gid', ownerDefend: 4, ownerConduit: 30, sinkShift: 4, bondBreak: 1024 }));
    // without bonds the words are exactly as before the option existed (status lines and capture captions)
    expect(describeChoice(DEFAULT_CHOICE)).toBe('32 × 32 × 16, seed 1, sinking off, trail rule none');
    expect(describeChoice({ ...DEFAULT_CHOICE, bonds: 'upkeep' })).toBe('32 × 32 × 16, seed 1, sinking off, trail rule none, bonds with upkeep');
    expect(describeChoice({ ...DEFAULT_CHOICE, bonds: 'free' })).toMatch(/, bonds free$/);
    // a link value is a choice only as an own key
    expect(['off', 'upkeep', 'free', 'toString', '__proto__', 'constructor', ''].map(isBonds)).toEqual([true, true, true, false, false, false, false]);
    for (const b of Object.values(BONDS)) expect(b.text.length).toBeGreaterThan(40);
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

  it('links: every choice survives a round trip, the default is the bare page, old links read as before, junk is ignored', () => {
    for (const c of all) for (const seed of [0, 1, 7, 0xffffffff]) {
      const q = choiceQuery({ ...c, seed });
      expect({ ...DEFAULT_CHOICE, ...choiceFromQuery(new URLSearchParams(q.toString())) }, q.toString()).toEqual({ ...c, seed });
    }
    expect(choiceQuery(DEFAULT_CHOICE).toString()).toBe('');
    expect(choiceQuery({ ...DEFAULT_CHOICE, bonds: 'free', seed: 9 }).toString()).toBe('seed=9&bonds=free');
    // a link from before bonds existed: no bonds key, so bonds stay off
    expect(choiceFromQuery(new URLSearchParams('?size=64x64x32&sink=fast&trail=owner&seed=9'))).toEqual({ size: '64x64x32', sink: 'fast', trail: 'owner', seed: 9 });
    for (const junk of ['?size=toString&seed=-1&sink=__proto__&trail=constructor&bonds=toString', '?seed=1.5&bonds=on&trail=public', '?seed=4294967296&bonds=__proto__&size=valueOf', '?seed=&bonds=']) {
      expect(choiceFromQuery(new URLSearchParams(junk)), junk).toEqual({});
    }
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

/** An empty 8 x 8 x 4 world with bonds and hand-placed particles: ids are slots. `bonds` lists pairs of slots. */
function bondWorld(pos: [number, number, number][], bonds: [number, number][]): Mycelium3dState {
  const s = createWorld(defaultConfig({ width: 8, height: 8, depth: 4, founders: 0, maxParticles: 32, bondBreak: 1024 }));
  pos.forEach(([x, y, z], i) => { s.x[i] = x; s.y[i] = y; s.z[i] = z; s.M[i] = 16; s.E[i] = 0; s.id[i] = i; s.gid[i] = 1; });
  s.n = pos.length;
  s.nextId = s.n; s.nextGid = 2; s.matter0 += 16 * s.n;
  const slots: number[][] = pos.map(() => []);
  for (const [a, b] of bonds) { slots[a]!.push(b); slots[b]!.push(a); }
  slots.forEach((p, i) => { p.sort((a, b) => a - b); s.bond0![i] = p[0] ?? BOND_NONE; s.bond1![i] = p[1] ?? BOND_NONE; });
  return s;
}
const C = (cell: number, off = 128) => cell * 256 + off;

describe('packLinks', () => {
  it('without bond slots there are no links', () => {
    const s = handWorld();
    expect(packLinks(s)).toBeNull();
  });

  it('draws each bond once, from the smaller slot, between the true centres; a ring of four gives four links', () => {
    // a ring of four in one plane, and a separate pair
    const s = bondWorld([[C(2), C(2), C(1)], [C(3), C(2), C(1)], [C(3), C(3), C(1)], [C(2), C(3), C(1)], [C(5), C(5), C(0)], [C(5), C(5), C(2)]],
      [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5]]);
    expect(validateState(s)).toEqual([]);
    const l = packLinks(s)!;
    expect([l.count, l.bonds, l.seamBonds]).toEqual([5, 5, 0]);
    const at = (k: number) => [...l.data.subarray(k * LINK_FLOATS, (k + 1) * LINK_FLOATS)];
    const u = (x: number) => (x + 0.5) / 256, v = (z: number) => 4 - (z + 0.5) / 256;
    // slot 0's bonds (to 1 and 3), then 1-2, 2-3, 4-5: the drawn end is the partner, and q is the partner too
    expect(at(0)).toEqual([u(C(2)), v(C(1)), u(C(2)), u(C(3)), v(C(1)), u(C(2)), u(C(3)), v(C(1)), u(C(2))]);
    const pairs = Array.from({ length: l.count }, (_, k) => at(k)).map((d) => [d[0], d[3], d[2], d[5], d[1], d[4]]);
    const unique = new Set(pairs.map((p) => JSON.stringify(p)));
    expect(unique.size).toBe(5);
    // the vertical pair goes from layer 0 (top of the box) down to layer 2
    expect(at(4).slice(1, 2)[0]).toBeCloseTo(v(C(0)), 6);
    expect(at(4)[4]).toBeCloseTo(v(C(2)), 6);
    // the readout agrees: 5 bonds, 6 bonded, two bodies, the largest of four, one ring
    const r = bondReadout(s);
    expect([r.bonds, r.bonded, r.bodies, r.largest, r.rings]).toEqual([5, 6, 2, 4, 1]);
    // reuses a big enough buffer
    expect(packLinks(s, l)).toBe(l);
  });

  it('a bond across the x seam is two stubs to the walls, never a line across the jar; across both seams as well', () => {
    // 0 at the east wall, 1 just past the west wall; 2 and 3 across the north-south and east-west seams at once
    const s = bondWorld([[8 * 256 - 40, C(4), C(1)], [30, C(4), C(1)], [8 * 256 - 20, 8 * 256 - 100, C(2)], [60, 100, C(2)]], [[0, 1], [2, 3]]);
    expect(validateState(s)).toEqual([]);
    const l = packLinks(s)!;
    expect([l.count, l.bonds, l.seamBonds]).toEqual([4, 2, 2]);
    for (let k = 0; k < l.count; k++) {
      const d = l.data.subarray(k * LINK_FLOATS, (k + 1) * LINK_FLOATS);
      // each piece is short (under one cell here) and stays in the box
      expect(Math.hypot(d[3]! - d[0]!, d[5]! - d[2]!)).toBeLessThan(1);
      for (const x of [d[0]!, d[3]!, d[2]!, d[5]!]) { expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThanOrEqual(8); }
    }
    const at = (k: number) => [...l.data.subarray(k * LINK_FLOATS, (k + 1) * LINK_FLOATS)];
    // the first stub leaves 0 east and ends on the east wall; the second leaves 1 west and ends on the west wall
    expect([at(0)[0], at(0)[3]]).toEqual([(8 * 256 - 39.5) / 256, 8]);
    expect([at(1)[0], at(1)[3]]).toEqual([30.5 / 256, 0]);
    // each stub knows its partner, so a cut hides both halves of the bond
    expect(at(0).slice(6)).toEqual(at(1).slice(0, 3));
    expect(at(1).slice(6)).toEqual(at(0).slice(0, 3));
    // the corner bond: 2's stub leaves through the nearer wall crossing, the east wall (20 units) before the south one (100)
    expect(at(2)[3]).toBe(8);
    expect(at(2)[5]).toBeLessThan(8);
    expect(at(3)[3]).toBeGreaterThan(0);
    expect(at(3)[5]).toBeGreaterThanOrEqual(0);
  });

  it('on a stepped world with free bonds: as many links as bonds plus seam bonds, and the readout counts the same bonds', () => {
    const s = createWorld(defaultConfig({ width: 8, height: 8, depth: 4, founders: 200, maxParticles: 512, seed: 2, bondBreak: 1024 }));
    for (let t = 0; t < 40; t++) step(s);
    const l = packLinks(s)!;
    const r = bondReadout(s);
    expect(l.bonds).toBeGreaterThan(0);
    expect(l.bonds).toBe(r.bonds);
    expect(l.count).toBe(l.bonds + l.seamBonds);
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
