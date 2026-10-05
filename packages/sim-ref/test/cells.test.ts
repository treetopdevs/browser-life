import { describe, expect, it } from "vitest";
import {
  CH,
  G,
  GENOME_CHANNELS,
  M3_FOUNDERS,
  buildWorld,
  cloneState,
  decodeGenome,
  defaultConfig,
  encodeGenome,
  founderGenome,
  genomeDistance,
  ledgerResidual,
  totalsOf,
  validateConfig,
  validateState,
  type WorldConfig,
  type WorldState,
} from "@bl/schema";
import { CELL_MIN_MASS, CELL_THRESHOLD, RefSim, applyCellPass, cellBodies } from "@bl/sim-ref";

// Declared cells (WorldConfig.cellPeriod; docs/sandbox-cells.md).

const cells = (extra: Partial<WorldConfig> = {}) => defaultConfig({ tileW: 24, tileH: 24, kernelRadius: 3, seed: 73, mutRate: 0, cellPeriod: 100, cellMutProb: 2 ** 32, ...extra });

/** An empty world at `step`, then rectangles of bound matter: [x, y, w, h, founder, B per site]. */
function painted(cfg: WorldConfig, step: number, rects: [number, number, number, number, number, number][]): WorldState {
  const s = buildWorld(cfg, { nutrient: 16, founders: [] });
  s.step = step;
  const W = cfg.tileW * cfg.tilesX, n = W * cfg.tileH * cfg.tilesY;
  for (const [x0, y0, w, h, f, B] of rects) {
    const words = encodeGenome(founderGenome(M3_FOUNDERS[f]), 0, f + 1);
    for (let y = y0; y < y0 + h; y++)
      for (let x = x0; x < x0 + w; x++) {
        const i = y * W + x;
        s.cells[CH.B * n + i] = B;
        for (let g = 0; g < GENOME_CHANNELS; g++) s.genome[g * n + i] = words[g];
      }
  }
  return s;
}
const idAt = (s: WorldState, x: number, y: number) => {
  const W = s.cfg.tileW * s.cfg.tilesX, n = W * s.cfg.tileH * s.cfg.tilesY, i = y * W + x;
  return `${s.genome[G.LIN_HI * n + i]}:${s.genome[G.LIN_LO * n + i]}`;
};
const wordsAt = (s: WorldState, x: number, y: number) => {
  const W = s.cfg.tileW * s.cfg.tilesX, n = W * s.cfg.tileH * s.cfg.tilesY, i = y * W + x;
  return Uint32Array.from({ length: GENOME_CHANNELS }, (_, g) => s.genome[g * n + i]);
};

describe("declared cells config", () => {
  it("is absent from defaultConfig and validated when set", () => {
    const d = defaultConfig();
    expect("cellPeriod" in d || "cellMutProb" in d).toBe(false);
    expect(validateConfig(cells())).toEqual([]);
    expect(validateConfig(cells({ cellMutProb: 0 }))).toEqual([]);
    expect(validateConfig(defaultConfig({ mutRate: 0, cellPeriod: 100 })).join()).toMatch(/set together/);
    expect(validateConfig(cells({ mutRate: 5 })).join()).toMatch(/mutRate 0/);
    expect(validateConfig(cells({ cellPeriod: 0 })).join()).toMatch(/cellPeriod/);
    expect(validateConfig(cells({ cellMutProb: 2 ** 32 + 1 })).join()).toMatch(/cellMutProb/);
    expect(validateConfig(cells({ neutral: true })).join()).toMatch(/not defined/);
  });
  it("does nothing without the keys", () => {
    const s = painted(defaultConfig({ tileW: 24, tileH: 24, kernelRadius: 3, seed: 73 }), 100, [[2, 2, 3, 3, 0, 60], [12, 12, 3, 3, 0, 60]]);
    const before = cloneState(s);
    expect(applyCellPass(s)).toEqual([]);
    expect(Array.from(s.genome)).toEqual(Array.from(before.genome));
  });
});

describe("applyCellPass", () => {
  // Founder 0: a 3x3 body (mass 540), a heavier 4x3 body (720) and a 2x2 fragment (240 < CELL_MIN_MASS).
  // Founder 1: one body. Founder 2: two bodies of equal mass. A thin founder-0 film below the threshold.
  const rects: [number, number, number, number, number, number][] = [
    [2, 2, 3, 3, 0, 60],
    [10, 2, 4, 3, 0, 60],
    [18, 2, 2, 2, 0, 60],
    [2, 10, 3, 3, 1, 60],
    [10, 10, 3, 3, 2, 60],
    [16, 10, 3, 3, 2, 60],
    [2, 18, 6, 2, 0, CELL_THRESHOLD - 1],
  ];

  it("gives every body but the heaviest of an id a fresh id, and one mutation when cellMutProb is 2^32", () => {
    const cfg = cells();
    const s = painted(cfg, 300, rects);
    const before = cloneState(s);
    const births = applyCellPass(s);
    // Founder 0's lighter body and founder 2's second body (equal mass: the lower anchor keeps the id).
    expect(births.map((b) => [b.parentHi, b.parentLo, b.cells, b.mass])).toEqual([[0, 1, 9, 540], [0, 3, 9, 540]]);
    const W = 24;
    expect(births[0].anchor).toBe(2 * W + 2);
    expect(births[1].anchor).toBe(10 * W + 16);
    for (const b of births) expect([b.step, b.childHi, b.childLo]).toEqual([300, 300, b.anchor]);
    // Kept ids.
    expect(idAt(s, 10, 2)).toBe("0:1");
    expect(idAt(s, 18, 2)).toBe("0:1"); // fragment below CELL_MIN_MASS
    expect(idAt(s, 2, 18)).toBe("0:1"); // film below CELL_THRESHOLD
    expect(idAt(s, 2, 10)).toBe("0:2");
    expect(idAt(s, 10, 10)).toBe("0:3");
    // Daughters: one id and one genome over the whole body, one slot from the parent's.
    for (const [x0, y0, parent] of [[2, 2, [10, 2]], [16, 10, [10, 10]]] as const) {
      const w0 = wordsAt(s, x0, y0);
      for (let y = y0; y < y0 + 3; y++) for (let x = x0; x < x0 + 3; x++) expect(Array.from(wordsAt(s, x, y))).toEqual(Array.from(w0));
      expect(idAt(s, x0, y0)).toBe(`300:${y0 * W + x0}`);
      const d = genomeDistance(decodeGenome(w0), decodeGenome(wordsAt(s, parent[0], parent[1])));
      expect(d).toBeLessThanOrEqual(1);
    }
    expect(births.every((b) => b.mutated)).toBe(true);
    // Matter and every other genome word are untouched.
    expect(Array.from(s.cells)).toEqual(Array.from(before.cells));
    expect(s.heatOut).toBe(before.heatOut);
    expect(CELL_MIN_MASS).toBe(256);
  });

  it("copies the genome unchanged when cellMutProb is 0, is deterministic, and is idempotent", () => {
    const cfg = cells({ cellMutProb: 0 });
    const a = painted(cfg, 300, rects), b = painted(cfg, 300, rects);
    const births = applyCellPass(a);
    expect(applyCellPass(b)).toEqual(births);
    expect(Array.from(a.genome)).toEqual(Array.from(b.genome));
    expect(births.every((x) => !x.mutated)).toBe(true);
    expect(Array.from(wordsAt(a, 2, 2)).slice(G.PARAM0)).toEqual(Array.from(wordsAt(a, 10, 2)).slice(G.PARAM0));
    // Every id now names one body, so a second pass finds nothing to do.
    const again = cloneState(a);
    expect(applyCellPass(again)).toEqual([]);
    expect(Array.from(again.genome)).toEqual(Array.from(a.genome));
    // Different steps and seeds mint different ids and draw different mutations.
    const m1 = painted(cells(), 300, rects), m2 = painted(cells(), 400, rects), m3 = painted(cells({ seed: 74 }), 300, rects);
    applyCellPass(m1); applyCellPass(m2); applyCellPass(m3);
    expect(idAt(m2, 2, 2)).toBe(`400:${2 * 24 + 2}`);
    const p = (s: WorldState) => Array.from(wordsAt(s, 2, 2)).slice(G.PARAM0).join();
    expect(new Set([p(m1), p(m2), p(m3)]).size).toBeGreaterThan(1);
  });

  it("mints ids validateState accepts, and never runs at step 0", () => {
    const s = painted(cells(), 300, rects);
    applyCellPass(s);
    expect(validateState(s)).toEqual([]);
    const z = painted(cells(), 0, rects);
    expect(applyCellPass(z)).toEqual([]);
  });

  it("lists the bodies it acts on, and refuses a state that already holds a daughter's id", () => {
    const s = painted(cells(), 300, rects);
    const bodies = cellBodies(s);
    // Anchor order; the fragment (mass 240) and the film (below the threshold) are not bodies.
    expect(bodies.map((b) => [b.hi, b.lo, b.anchor, b.cells, b.mass])).toEqual([
      [0, 1, 2 * 24 + 2, 9, 540],
      [0, 1, 2 * 24 + 10, 12, 720],
      [0, 2, 10 * 24 + 2, 9, 540],
      [0, 3, 10 * 24 + 10, 9, 540],
      [0, 3, 10 * 24 + 16, 9, 540],
    ]);
    expect(bodies[0].sites[0]).toBe(bodies[0].anchor);
    expect(bodies[1].sites.length).toBe(12);
    // An id of this very step at the first daughter's anchor, elsewhere in the world with another genome
    // (valid for validateState): the pass must not mint it a second time.
    const W = 24, n = W * W, anchor = 2 * W + 2, other = 20 * W + 20;
    const clash = painted(cells(), 300, rects);
    const words = encodeGenome(founderGenome(M3_FOUNDERS[4]), 300, anchor);
    clash.cells[CH.B * n + other] = 60;
    for (let g = 0; g < GENOME_CHANNELS; g++) clash.genome[g * n + other] = words[g];
    expect(validateState(clash)).toEqual([]);
    expect(() => applyCellPass(clash)).toThrow(/already in use/);
  });

  it("connects through the tile wrap and never across tiles", () => {
    const cfg = cells({ tilesX: 2 });
    // One body wrapping the left tile's x edge (columns 22, 23, 0, 1), and a second body of the same founder.
    const s = painted(cfg, 100, [[22, 4, 2, 3, 0, 60], [0, 4, 2, 3, 0, 60], [10, 12, 3, 3, 0, 60]]);
    const births = applyCellPass(s);
    expect(births.length).toBe(1);
    expect(births[0].cells).toBe(9); // the wrapped body (12 sites, mass 720) keeps the id
    expect(idAt(s, 23, 5)).toBe("0:1");
    expect(idAt(s, 0, 5)).toBe("0:1");
    // Columns 23 and 24 are adjacent in the world but in different tiles: two bodies, not one.
    const t = painted(cfg, 100, [[21, 4, 3, 3, 0, 60], [24, 4, 3, 3, 0, 60]]);
    expect(applyCellPass(t).length).toBe(1);
    expect(idAt(t, 23, 5)).not.toBe(idAt(t, 24, 5));
  });

  it("keeps matter and the energy ledger exact and one body per id over 1,200 steps of the reference physics", () => {
    const cfg = cells({ tileW: 32, tileH: 32, kernelRadius: 4 });
    const start = buildWorld(cfg, {
      nutrient: 32,
      founders: [0, 1, 2, 5].map((f, k) => ({ x: 8 + 16 * (k & 1), y: 8 + 16 * (k >> 1), radius: 6, genome: founderGenome(M3_FOUNDERS[f]), biomass: 64, energy: 128 })),
    });
    const sim = new RefSim(cloneState(start));
    const t0 = totalsOf(cfg, sim.state.cells);
    let born = 0;
    const seen = new Set<string>();
    for (let k = 0; k < 12; k++) {
      sim.run(100);
      const births = applyCellPass(sim.state);
      born += births.length;
      for (const b of births) {
        const key = `${b.childHi}:${b.childLo}`;
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
      expect(applyCellPass(cloneState(sim.state))).toEqual([]);
      expect(totalsOf(cfg, sim.state.cells).matter).toBe(t0.matter);
      expect(ledgerResidual(t0, sim.state)).toBe(0n);
    }
    expect(born).toBeGreaterThan(0);
  }, 120_000);
});
