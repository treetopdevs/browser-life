// Regressions for review findings on validation, checkpoints and arithmetic helpers.
import { describe, expect, it } from "vitest";
import {
  buildWorld,
  clampLesionRadius,
  decodeCheckpoint,
  defaultConfig,
  digestWords,
  divu,
  encodeCheckpoint,
  generalistGenome,
  soupWorld,
  validateConfig,
  MATTER_MAX,
  CH,
  stateHash,
  validateState,
} from "@bl/schema";

describe("config validation", () => {
  it("rejects values the kernels cannot represent", () => {
    expect(validateConfig(defaultConfig({ defaultMu: 2 ** 32 }))).not.toEqual([]);
    expect(validateConfig(defaultConfig({ tilesX: 0 }))).not.toEqual([]);
    expect(validateConfig(defaultConfig({ eP: 64 }))).not.toEqual([]);
    expect(validateConfig(defaultConfig({ lightMode: "sideways" as never }))).not.toEqual([]);
    expect(validateConfig({ ...defaultConfig(), neutral: 1 as never })).not.toEqual([]);
    expect(validateConfig({ ...defaultConfig(), ruleVersion: 999 })).not.toEqual([]);
    expect(validateConfig(defaultConfig())).toEqual([]);
  });

  it("rejects worlds whose total matter exceeds MATTER_MAX", () => {
    const cfg = defaultConfig({ tileW: 64, tileH: 64 });
    expect(() => buildWorld(cfg, { nutrient: Math.ceil(MATTER_MAX / 4096) + 1, founders: [] })).toThrow(/matter/);
  });
});

describe("integer helpers", () => {
  it("divu normalises operands before the zero test (WGSL u32 semantics)", () => {
    expect(divu(100, 2 ** 32)).toBe(100); // denominator wraps to 0 -> x/0 = x
    expect(divu(7, 2)).toBe(3);
  });
});

describe("checkpoints", () => {
  const cfg = defaultConfig({ tileW: 32, tileH: 32, kernelRadius: 4 });
  it("rejects a truncated payload even with a recomputed checksum", () => {
    const bytes = encodeCheckpoint(soupWorld(cfg, 2, 32, 64));
    const w = new Uint32Array(bytes.buffer.slice(0));
    const cut = new Uint32Array(w.length - 100);
    cut.set(w.subarray(0, cut.length - 2));
    const [a, b] = digestWords(cut.subarray(0, cut.length - 2));
    cut[cut.length - 2] = a;
    cut[cut.length - 1] = b;
    expect(() => decodeCheckpoint(new Uint8Array(cut.buffer))).toThrow(/truncated|mismatch/);
  });
});

describe("founders", () => {
  it("stay inside their own tile", () => {
    const c = defaultConfig({ tileW: 16, tileH: 16, tilesX: 2, kernelRadius: 3 });
    const s = buildWorld(c, { nutrient: 0, founders: [{ x: 15, y: 8, radius: 6, genome: generalistGenome(60, 20), biomass: 64, energy: 0 }] });
    const n = 32 * 16;
    let right = 0;
    for (let y = 0; y < 16; y++) for (let x = 16; x < 32; x++) right += s.cells[CH.B * n + y * 32 + x];
    expect(right).toBe(0);
  });

  it("must fit in a tile", () => {
    const c = defaultConfig({ tileW: 16, tileH: 16, kernelRadius: 3 });
    expect(() => buildWorld(c, { nutrient: 0, founders: [{ x: 8, y: 8, radius: 10, genome: generalistGenome(60, 20), biomass: 64, energy: 0 }] })).toThrow(/fit/);
  });
});

describe("lesion contract", () => {
  it("clamps identically for CPU and GPU callers", () => {
    const c = defaultConfig({ tileW: 24, tileH: 24, kernelRadius: 3 });
    expect(clampLesionRadius(c, 12)).toBe(11);
    expect(clampLesionRadius(c, 5.7)).toBe(5);
  });
});

describe("state validation (review 2)", () => {
  const cfg = defaultConfig({ tileW: 16, tileH: 16, kernelRadius: 3 });
  it("rejects lineage ids from the future", () => {
    const s = buildWorld(cfg, { nutrient: 1, founders: [] });
    const n = 256;
    s.genome[0 * n + 0] = 1; // LIN_HI = 1 at step 0
    s.genome[1 * n + 0] = 0;
    s.cells[1 * n + 0] = 5;
    expect(validateState(s).join()).toMatch(/past/);
  });
  it("rejects ledgers without headroom and refuses to encode them", () => {
    const s = buildWorld(cfg, { nutrient: 1, founders: [] });
    s.heatOut = 1n << 63n;
    expect(validateState(s).join()).toMatch(/ledger/);
    expect(() => encodeCheckpoint(s)).toThrow(/invalid state/);
  });
  it("digest covers the ledger and config", () => {
    const a = buildWorld(cfg, { nutrient: 1, founders: [] });
    const b = { ...a, heatOut: 5n };
    const c = { ...a, cfg: { ...a.cfg, kELeak: a.cfg.kELeak + 1 } };
    expect(stateHash(a)).not.toBe(stateHash(b));
    expect(stateHash(a)).not.toBe(stateHash(c));
  });
});
