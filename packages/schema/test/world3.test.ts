import { describe, expect, it } from "vitest";
import {
  CELL_CHANNELS, CH, G, GENOME_CHANNELS3, MATTER_MAX, MOT_ZERO3, POOL_MAX, POOL_MAX3, allocState, allocState3, buildWorld, buildWorld3, cellCount, encodeGenome3, defaultConfig, generalistGenome3,
  simKind, slabSpotsWorld, stateHash, validateState, validateState3, type WorldConfig, type WorldState,
} from "@bl/schema";

const slabCfg = (o: Partial<WorldConfig> = {}) => defaultConfig({ kernelRadius: 3, tileD: 8, lightK: 1024, lightMode: "uniform", ...o });
const small = (o: Partial<WorldConfig> = {}) => slabCfg({ tileW: 32, tileH: 32, ...o });
const gen = () => generalistGenome3(154, 24);
const founderAt = (cfg: WorldConfig, x: number, y: number, z: number, radius = 3): WorldState =>
  buildWorld3(cfg, { nutrient: 32, founders: [{ x, y, z, radius, genome: gen(), biomass: 64, energy: 128 }] });
const living = (s: WorldState) => {
  const n = cellCount(s.cfg);
  const out: number[] = [];
  for (let i = 0; i < n; i++) if ((s.genome[G.LIN_HI * n + i] | s.genome[G.LIN_LO * n + i]) !== 0) out.push(i);
  return out;
};

describe("slab state", () => {
  it("sizes the buffers and keeps 2D builders away from a slab config", () => {
    const s = allocState3(slabCfg());
    expect(cellCount(s.cfg)).toBe(524288);
    expect(s.cells.length).toBe(7 * 524288);
    expect(s.genome.length).toBe(49 * 524288);
    expect(CELL_CHANNELS).toBe(7);
    expect(() => allocState(slabCfg())).toThrow(/2D only/);
    expect(() => buildWorld(slabCfg(), { nutrient: 1, founders: [] })).toThrow();
    expect(() => allocState3(defaultConfig())).toThrow();
    expect([simKind(slabCfg()), simKind(defaultConfig())]).toEqual(["slab", "2d"]);
  });
  it("founds a ball of 123 cells", () => {
    const cfg = small();
    const s = founderAt(cfg, 16, 16, 4);
    const n = cellCount(cfg);
    expect(living(s).length).toBe(123);
    for (let i = 0; i < n; i++) expect(s.cells[CH.MOT * n + i]).toBe(MOT_ZERO3);
    let a = 0;
    for (let i = 0; i < n; i++) a += s.cells[CH.A * n + i];
    expect(a).toBe(32 * n);
    expect(validateState3(s)).toEqual([]);
    expect(stateHash(founderAt(cfg, 16, 16, 4))).toBe(stateHash(s));
  });
  it("closes z and wraps x and y", () => {
    const cfg = small();
    const ball = (dzOk: (dz: number) => boolean) => {
      let c = 0;
      for (let dz = -3; dz <= 3; dz++) for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) if (dx * dx + dy * dy + dz * dz <= 9 && dzOk(dz)) c++;
      return c;
    };
    const n = cellCount(cfg);
    const layers = (s: WorldState) => {
      const per = new Array(8).fill(0);
      for (const i of living(s)) per[Math.floor(i / (32 * 32))]++;
      return per;
    };
    const top = founderAt(cfg, 16, 16, 0);
    expect(living(top).length).toBe(ball((dz) => dz >= 0));
    expect(layers(top).slice(4)).toEqual([0, 0, 0, 0]);
    const bottom = founderAt(cfg, 16, 16, 7);
    expect(living(bottom).length).toBe(ball((dz) => dz <= 0));
    expect(layers(bottom).slice(0, 4)).toEqual([0, 0, 0, 0]);
    const corner = founderAt(cfg, 0, 0, 4);
    expect(living(corner).length).toBe(123);
    expect(validateState3(corner)).toEqual([]);
    expect(n).toBe(8192);
  });
  it("copies genome words exactly and gives founders distinct LIN_LO", () => {
    const cfg = small();
    const s = buildWorld3(cfg, {
      nutrient: 32,
      founders: [
        { x: 8, y: 8, z: 3, radius: 2, genome: gen(), biomass: 64, energy: 128 },
        { x: 24, y: 24, z: 3, radius: 2, genome: gen(), biomass: 64, energy: 128 },
      ],
    });
    const n = cellCount(cfg);
    const cells = living(s);
    const los = new Set(cells.map((i) => s.genome[G.LIN_LO * n + i]));
    expect(los.size).toBe(2);
    for (const i of cells) {
      const want = encodeGenome3(gen(), 0, s.genome[G.LIN_LO * n + i]);
      for (let g = 0; g < GENOME_CHANNELS3; g++) expect(s.genome[g * n + i]).toBe(want[g]);
    }
  });
  it("slabSpotsWorld places 8 lineages deterministically at full size", () => {
    const cfg = slabCfg({ seed: 101 });
    const a = slabSpotsWorld(cfg, gen());
    const b = slabSpotsWorld(cfg, gen());
    const n = cellCount(cfg);
    expect(new Set(living(a).map((i) => a.genome[G.LIN_LO * n + i])).size).toBe(8);
    expect(stateHash(a)).toBe(stateHash(b));
    expect(stateHash(slabSpotsWorld(slabCfg({ seed: 102 }), gen()))).not.toBe(stateHash(a));
    expect(validateState3(a)).toEqual([]);
  });
});

describe("validateState3", () => {
  const base = () => founderAt(small(), 16, 16, 4);
  it("caps E and S at 2^27 but still allows 2^28 in 2D", () => {
    for (const ch of [CH.E, CH.S]) {
      const s = base();
      s.cells[ch * cellCount(s.cfg)] = POOL_MAX3;
      expect(validateState3(s)).toEqual([]);
      s.cells[ch * cellCount(s.cfg)] = POOL_MAX3 + 1;
      expect(validateState3(s).join()).toContain(String(POOL_MAX3));
    }
    const d = allocState(defaultConfig({ tileW: 64, tileH: 64 }));
    d.cells[CH.E * 4096] = POOL_MAX;
    expect(validateState(d)).toEqual([]);
  });
  it("catches size, lineage, reserved-byte and matter violations", () => {
    const n = cellCount(small());
    const short = base();
    short.genome = new Uint32Array(44 * n);
    expect(validateState3(short)).toContain("genome buffer size mismatch");
    const word48 = base();
    const [c0] = living(word48);
    const [c1] = living(word48).filter((i) => i !== c0);
    word48.genome[48 * n + c1] ^= 1;
    expect(validateState3(word48).join()).toContain("differing genome words");
    const lin = base();
    lin.genome[G.LIN_LO * n + c0] = n;
    expect(validateState3(lin).join()).toContain("not from this state's past");
    const p1 = base();
    p1.genome[G.PARAM1 * n + c0] |= 0x100;
    expect(validateState3(p1).join()).toContain("reserved");
    const pad = base();
    pad.genome[48 * n + c0] |= 0x100;
    expect(validateState3(pad).join()).toContain("reserved");
    const matter = base();
    matter.cells[CH.A * n] = MATTER_MAX + 1;
    expect(validateState3(matter).join()).toContain("exceeds");
  });
  it("refuses a 2D state", () => {
    expect(validateState3(allocState(defaultConfig({ tileW: 64, tileH: 64 })))).not.toEqual([]);
  });
});

describe("slab founding review fixes", () => {
  it("founds a radius-3 ball at tileD 4, clipped at the z walls", () => {
    const cfg = small({ tileD: 4 });
    const s = founderAt(cfg, 16, 16, 1);
    let want = 0;
    for (let dz = -3; dz <= 3; dz++) for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) if (dx * dx + dy * dy + dz * dz <= 9 && 1 + dz >= 0 && 1 + dz < 4) want++;
    expect(living(s).length).toBe(want);
    expect(validateState3(s)).toEqual([]);
    expect(() => founderAt(cfg, 16, 16, 4)).toThrow(/z 4/);
  });
  it("slabSpotsWorld draws z as draw(h, 7) % D (pinned centres, seed 5, 32x32x8)", () => {
    const cfg = small({ seed: 5 });
    const s = slabSpotsWorld(cfg, gen(), 3);
    const n = cellCount(cfg);
    const live = new Set(living(s));
    // (x, y, z) = (h % W, (h >>> 12) % H, draw(h, 7) % D) for lowbias32(seed * 313 + i), i = 0..2.
    for (const [x, y, z] of [[18, 16, 5], [21, 21, 5], [24, 16, 4]]) expect(live.has((z * 32 + y) * 32 + x), `${x},${y},${z}`).toBe(true);
    expect(n).toBe(8192);
  });
});
