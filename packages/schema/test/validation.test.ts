// Regressions for review findings on validation, checkpoints and arithmetic helpers.
import { describe, expect, it } from "vitest";
import {
  artifactDigest,
  buildWorld,
  canonicalConfig,
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

// `adhesion`/`kAdhesion` are optional and absent from defaultConfig()'s own
// defaults (see WorldConfig in config.ts) so that a config which never
// touches adhesion serialises -- and hashes -- byte-for-byte as it did before
// this actuator existed. stateHash/the coordinator's checkpoint digest hash
// the *whole* config object, so this is load-bearing for continuity of every
// existing checkpoint, run bundle and replay verification.
describe("adhesion config is opt-in", () => {
  it("defaultConfig() carries neither key, so its canonical digest is unaffected by the actuator existing", () => {
    const cfg = defaultConfig();
    expect("adhesion" in cfg).toBe(false);
    expect("kAdhesion" in cfg).toBe(false);
    const json = canonicalConfig(cfg);
    expect(json).not.toMatch(/adhesion/i);
  });

  it("validates adhesion/kAdhesion only when present", () => {
    expect(validateConfig(defaultConfig())).toEqual([]);
    expect(validateConfig(defaultConfig({ adhesion: true }))).toEqual([]);
    expect(validateConfig(defaultConfig({ adhesion: true, kAdhesion: 200 }))).toEqual([]);
    expect(validateConfig({ ...defaultConfig(), adhesion: 1 as never })).not.toEqual([]);
    expect(validateConfig({ ...defaultConfig(), kAdhesion: -1 })).not.toEqual([]);
    expect(validateConfig({ ...defaultConfig(), kAdhesion: 1025 })).not.toEqual([]);
    expect(validateConfig({ ...defaultConfig(), kAdhesion: 3.5 })).not.toEqual([]);
  });

  it("round-trips an adhesion-enabled config through the checkpoint codec artifacts use", () => {
    const cfg = defaultConfig({ tileW: 32, tileH: 32, kernelRadius: 4, adhesion: true, kAdhesion: 300 });
    const s = soupWorld(cfg, 2, 32, 64);
    const { state } = decodeCheckpoint(encodeCheckpoint(s));
    expect(state.cfg.adhesion).toBe(true);
    expect(state.cfg.kAdhesion).toBe(300);
    expect(stateHash(state)).toBe(stateHash(s));
  });

  it("a checkpoint from before this actuator (no adhesion keys) decodes with adhesion left unset, not defaulted", () => {
    const cfg = defaultConfig({ tileW: 32, tileH: 32, kernelRadius: 4 });
    const s = soupWorld(cfg, 2, 32, 64);
    const { state } = decodeCheckpoint(encodeCheckpoint(s));
    expect(state.cfg.adhesion).toBeUndefined();
    expect(state.cfg.kAdhesion).toBeUndefined();
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

  // Recomputes the checksum after truncating/mutating a payload, the same
  // way a real corrupted upload's checksum still covers whatever bytes made
  // it through — so these exercise the *structural* checks past the
  // checksum, not the checksum check itself.
  const recheck = (w: Uint32Array): Uint8Array => {
    const [a, b] = digestWords(w.subarray(0, w.length - 2));
    w[w.length - 2] = a;
    w[w.length - 1] = b;
    return new Uint8Array(w.buffer);
  };

  it("round-trips physics and an opaque observer payload through one artifact", () => {
    const s = soupWorld(cfg, 2, 32, 64);
    const observer = { tag: "hello", n: 3, nested: { z: 1, a: 2 } };
    const { state, observer: back } = decodeCheckpoint(encodeCheckpoint(s, observer));
    expect(state.step).toBe(s.step);
    expect(back).toEqual(observer);
  });

  it("defaults the observer section to {} when omitted", () => {
    const { observer } = decodeCheckpoint(encodeCheckpoint(soupWorld(cfg, 2, 32, 64)));
    expect(observer).toEqual({});
  });

  // Review 1 finding #1: `artifactDigest` used to build its final word array
  // via `Uint32Array.of(len, ...words)`, which spreads `words` into call
  // arguments and throws "Maximum call stack size exceeded" once an observer
  // is large enough -- a populated tracker on the 512x512 "large" preset
  // (prevLabels alone is one Int32Array per cell) comfortably exceeds it.
  it("digests an observer far larger than the JS spread-argument limit", () => {
    const s = soupWorld(cfg, 2, 32, 64);
    // A base64 string this long stands in for a real large-world tracker's
    // `prevLabels` field without paying for a full 512x512 census here.
    const bigObserver = { prevLabels: "A".repeat(2_000_000) };
    expect(() => artifactDigest(s, bigObserver)).not.toThrow();
    const bytes = encodeCheckpoint(s, bigObserver);
    const { observer } = decodeCheckpoint(bytes);
    expect(artifactDigest(s, observer)).toBe(artifactDigest(s, bigObserver));
  });

  it("rejects a truncated payload even with a recomputed checksum", () => {
    const bytes = encodeCheckpoint(soupWorld(cfg, 2, 32, 64));
    const w = new Uint32Array(bytes.buffer.slice(0));
    const cut = new Uint32Array(w.length - 100);
    cut.set(w.subarray(0, cut.length - 2));
    expect(() => decodeCheckpoint(recheck(cut))).toThrow(/truncated|mismatch/);
  });

  it("rejects bad magic", () => {
    const bytes = encodeCheckpoint(soupWorld(cfg, 2, 32, 64));
    const w = new Uint32Array(bytes.buffer.slice(0));
    w[0] ^= 0xff;
    expect(() => decodeCheckpoint(recheck(w))).toThrow(/magic/);
  });

  it("rejects a schema version other than the current one", () => {
    const bytes = encodeCheckpoint(soupWorld(cfg, 2, 32, 64));
    const w = new Uint32Array(bytes.buffer.slice(0));
    w[1] = 2;
    expect(() => decodeCheckpoint(recheck(w))).toThrow(/schema/);
  });

  it("rejects a checksum mismatch", () => {
    const bytes = encodeCheckpoint(soupWorld(cfg, 2, 32, 64));
    const w = new Uint32Array(bytes.buffer.slice(0));
    w[10] ^= 1; // inside the cfg section; checksum is not recomputed
    expect(() => decodeCheckpoint(new Uint8Array(w.buffer))).toThrow(/mismatch/);
  });

  it("rejects an observer section that is not valid JSON", () => {
    const bytes = encodeCheckpoint(soupWorld(cfg, 2, 32, 64), { ok: true });
    const w = new Uint32Array(bytes.buffer.slice(0));
    // The observer section is the last thing before the two checksum words;
    // corrupt one of its bytes (still ASCII, so length/JSON.parse both see
    // it) without changing its declared byte length.
    const asBytes = new Uint8Array(w.buffer);
    const obsLenWordIdx = w.length - 3 - Math.ceil(JSON.stringify({ ok: true }).length / 4);
    const obsByteOffset = (obsLenWordIdx + 1) * 4;
    asBytes[obsByteOffset] ^= 0xff; // corrupt the observer JSON's opening brace
    expect(() => decodeCheckpoint(recheck(w))).toThrow(/observer section is not valid JSON/);
  });

  it("rejects a payload truncated inside the observer section", () => {
    const bytes = encodeCheckpoint(soupWorld(cfg, 2, 32, 64), { ok: true });
    const w = new Uint32Array(bytes.buffer.slice(0));
    // Same trick as the physics-truncation test, but the word removed here
    // is the observer section's own last word, not the physics payload's.
    const cut = new Uint32Array(w.length - 1);
    cut.set(w.subarray(0, cut.length - 2));
    expect(() => decodeCheckpoint(recheck(cut))).toThrow(/truncated/);
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
