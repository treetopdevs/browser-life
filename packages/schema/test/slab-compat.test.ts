import { describe, expect, it } from "vitest";
import {
  CH, G, POOL_MAX3, artifactDigest, cellCount, generalistGenome3, slabSpotsWorld, canonicalConfig, canonicalGenome, decodeCheckpoint, defaultConfig, digestWords, encodeCheckpoint, generalistGenome, generalistWorld, stateHash, tiledWorld,
  type WorldConfig,
} from "@bl/schema";
import { RefSim } from "@bl/sim-ref";

const dig = (u: Uint8Array) => digestWords(new Uint32Array(u.buffer, u.byteOffset, u.byteLength / 4)).map((x) => x.toString(16)).join(",");

// Literals captured on the tree before the slab schema landed (rung 1b M0): 2D serialization must not drift.
describe("2D bytes are unchanged by the slab schema", () => {
  const a = () => generalistWorld(defaultConfig({ tileW: 64, tileH: 64, seed: 1 }), 3, 32, 64);
  it("a fresh generalist world", () => {
    const s = a();
    expect(dig(encodeCheckpoint(s, {}))).toBe("3e2d6b24,e65d128c");
    expect(stateHash(s)).toBe("7b5c2e67f875b29a");
  });
  it("the same world after 40 steps", () => {
    const sim = new RefSim(a());
    for (let i = 0; i < 40; i++) sim.step();
    expect(dig(encodeCheckpoint(sim.state, {}))).toBe("b0ec9895,16c2a062");
    expect(stateHash(sim.state)).toBe("dc6aba3c38da0ac7");
  });
  it("a migrating 2x2 tiled world after 10 steps", () => {
    const cfg = defaultConfig({ tileW: 32, tileH: 32, tilesX: 2, tilesY: 2, seed: 3, migrationPeriod: 4, migrantCount: 3 });
    const sim = new RefSim(tiledWorld(cfg, [generalistGenome(154, 24)], 32, 6, 64, 128));
    for (let i = 0; i < 10; i++) sim.step();
    expect(dig(encodeCheckpoint(sim.state, {}))).toBe("947f15ec,9cf120ca");
    expect(stateHash(sim.state)).toBe("a57750268cee1497");
  });
  it("the default config's canonical bytes", () => {
    const cc = new TextEncoder().encode(canonicalConfig(defaultConfig()));
    const w = new Uint32Array(Math.ceil(cc.length / 4));
    new Uint8Array(w.buffer).set(cc);
    expect(cc.length).toBe(592);
    expect(digestWords(w).map((x) => x.toString(16)).join(",")).toBe("3459f056,65cdb756");
  });
  it("round trips a 2D checkpoint", () => {
    const s = a();
    const bytes = encodeCheckpoint(s, { k: 1 });
    const back = decodeCheckpoint(bytes);
    expect(stateHash(back.state)).toBe(stateHash(s));
    expect(artifactDigest(back.state, back.observer)).toBe(artifactDigest(s, { k: 1 }));
  });
  it("canonicalGenome(g) equals canonicalGenome(g, 44)", () => {
    const s = a();
    const g = s.genome.slice();
    g[5 * (g.length / 44) + 0] = 7; // stale word in an empty cell (cell 0 has no lineage)
    expect(canonicalGenome(g)).toEqual(canonicalGenome(g, 44));
  });
});

describe("slab hashing and checkpoints", () => {
  const cfg = (): WorldConfig => defaultConfig({ tileW: 32, tileH: 32, kernelRadius: 3, tileD: 8, lightK: 1024, lightMode: "uniform", seed: 5 });
  const world = () => slabSpotsWorld(cfg(), generalistGenome3(154, 24), 3);
  const n = cellCount(cfg());
  const emptyCell = (s: ReturnType<typeof world>) => {
    for (let i = 0; i < n; i++) if ((s.genome[G.LIN_HI * n + i] | s.genome[G.LIN_LO * n + i]) === 0) return i;
    throw new Error("no empty cell");
  };
  const liveCell = (s: ReturnType<typeof world>) => {
    for (let i = 0; i < n; i++) if ((s.genome[G.LIN_HI * n + i] | s.genome[G.LIN_LO * n + i]) !== 0) return i;
    throw new Error("no live cell");
  };
  it("canonicalGenome(g, 49) zeroes words 2..48 of an empty cell", () => {
    const s = world();
    const e = emptyCell(s);
    const g = s.genome.slice();
    for (const w of [2, 20, 48]) g[w * n + e] = 9;
    const c = canonicalGenome(g, 49);
    for (let w = 2; w < 49; w++) expect(c[w * n + e]).toBe(0);
    expect(c[48 * n + liveCell(s)]).toBe(s.genome[48 * n + liveCell(s)]);
  });
  it("stateHash ignores stale words in empty cells and sees word 48 of a live cell", () => {
    const s = world();
    const h = stateHash(s);
    const stale = { ...s, genome: s.genome.slice() };
    stale.genome[48 * n + emptyCell(s)] = 7;
    expect(stateHash(stale)).toBe(h);
    const live = { ...s, genome: s.genome.slice() };
    live.genome[48 * n + liveCell(s)] ^= 0x80000000;
    expect(stateHash(live)).not.toBe(h);
  });
  it("round trips a slab checkpoint", () => {
    const s = world();
    const back = decodeCheckpoint(encodeCheckpoint(s, { a: 1 }));
    expect(back.state.cfg.tileD).toBe(8);
    expect(back.state.cfg.lightK).toBe(1024);
    expect(back.state.genome).toEqual(canonicalGenome(s.genome, 49));
    expect(artifactDigest(back.state, back.observer)).toBe(artifactDigest(s, { a: 1 }));
  });
  it("refuses a 44n genome section, E = 2^27+1, and a 2D stream with tileD spliced in", () => {
    const s = world();
    expect(() => encodeCheckpoint({ ...s, genome: new Uint32Array(44 * n) })).toThrow();
    const hot = { ...s, cells: s.cells.slice() };
    hot.cells[CH.E * n] = POOL_MAX3 + 1;
    expect(() => encodeCheckpoint(hot)).toThrow();
    const two = encodeCheckpoint(generalistWorld(defaultConfig({ tileW: 64, tileH: 64, kernelRadius: 3 }), 2, 32, 64), {});
    const w = new Uint32Array(two.buffer, two.byteOffset, two.byteLength / 4);
    const cfgLenAt = 8 + 2 * 10 + 1; // magic, schema, rule, step, light, heat, 10 flux u64s, a zero word, then the config length
    const json = new TextDecoder().decode(new Uint8Array(two.buffer, two.byteOffset + (cfgLenAt + 1) * 4, w[cfgLenAt]));
    const spliced = json.replace(/\}$/, ',"tileD":8,"lightK":1024}');
    expect(spliced.length).toBeGreaterThan(json.length);
    // Rebuild the stream with the longer config section and a recomputed checksum.
    const oldWords = Math.ceil(w[cfgLenAt] / 4);
    const bytes = new TextEncoder().encode(spliced);
    const out = new Uint32Array(w.length - oldWords + Math.ceil(bytes.length / 4));
    out.set(w.subarray(0, cfgLenAt));
    out[cfgLenAt] = bytes.length;
    new Uint8Array(out.buffer, (cfgLenAt + 1) * 4, bytes.length).set(bytes);
    out.set(w.subarray(cfgLenAt + 1 + oldWords, w.length - 2), cfgLenAt + 1 + Math.ceil(bytes.length / 4));
    const [a, b] = digestWords(out.subarray(0, out.length - 2));
    out[out.length - 2] = a;
    out[out.length - 1] = b;
    expect(() => decodeCheckpoint(new Uint8Array(out.buffer))).toThrow(/size mismatch/);
  });
  // Decoder side: mutate the bytes of a valid slab checkpoint, recompute the checksum, and the decoder alone must refuse.
  describe("decodeCheckpoint refuses a corrupted slab stream", () => {
    const CFG_LEN_AT = 29;
    const sections = (w: Uint32Array) => {
      const cfgWords = Math.ceil(w[CFG_LEN_AT] / 4);
      const cellsLenAt = CFG_LEN_AT + 1 + cfgWords;
      const cellsAt = cellsLenAt + 1;
      const genomeLenAt = cellsAt + w[cellsLenAt];
      return { cellsAt, genomeLenAt, genomeAt: genomeLenAt + 1 };
    };
    const seal = (out: Uint32Array) => {
      const [a, b] = digestWords(out.subarray(0, out.length - 2));
      out[out.length - 2] = a;
      out[out.length - 1] = b;
      return new Uint8Array(out.buffer);
    };
    const fresh = () => {
      const bytes = encodeCheckpoint(world(), { a: 1 });
      return new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4).slice();
    };
    it("accepts the unmodified stream (the harness itself is sound)", () => {
      expect(() => decodeCheckpoint(seal(fresh()))).not.toThrow();
    });
    it("a 44*n genome section", () => {
      const w = fresh();
      const { genomeLenAt, genomeAt } = sections(w);
      const oldLen = w[genomeLenAt];
      const out = new Uint32Array(w.length - (oldLen - 44 * n));
      out.set(w.subarray(0, genomeLenAt));
      out[genomeLenAt] = 44 * n;
      out.set(w.subarray(genomeAt, genomeAt + 44 * n), genomeAt);
      out.set(w.subarray(genomeAt + oldLen), genomeAt + 44 * n);
      expect(() => decodeCheckpoint(seal(out))).toThrow(/genome size mismatch/);
    });
    it("E above 2^27", () => {
      const w = fresh();
      w[sections(w).cellsAt + CH.E * n] = POOL_MAX3 + 1;
      expect(() => decodeCheckpoint(seal(w))).toThrow(/E/);
    });
    it("S above 2^27", () => {
      const w = fresh();
      w[sections(w).cellsAt + CH.S * n] = POOL_MAX3 + 1;
      expect(() => decodeCheckpoint(seal(w))).toThrow(/S/);
    });
  });
  it("RefSim refuses a slab state", () => {
    expect(() => new RefSim(world())).toThrow(/slab/);
  });
});
