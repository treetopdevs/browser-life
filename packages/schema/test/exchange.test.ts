// Cross-run ("archipelago") migration between separate runs of a
// metapopulation (packages/schema/src/exchange.ts): deterministic position
// selection, matter closure across two independent states, and RNG domain
// separation from both physics and tile migration.
import { describe, expect, it } from "vitest";
import {
  CELL_CHANNELS,
  CH,
  CROSS_MIGRATION_SEED_SALT,
  G,
  GENOME_CHANNELS,
  MIGRATION_SEED_SALT,
  RING_CELL_MASK,
  allocState,
  applyExchange,
  buildWorld,
  cellBase,
  cellCount,
  defaultConfig,
  exchangeMatterTotal,
  exchangePositions,
  generalistGenome,
  maxPackableRaw,
  validateState,
  type WorldConfig,
  type WorldState,
} from "@bl/schema";

/** A small, hand-filled world -- not a physically realistic history, just enough structure to check the permutation exactly. `seedOffset` gives two states built this way distinguishable content (as two different runs' checkpoints would have). */
function makeState(seedOffset: number, overrides: Partial<WorldConfig> = {}, step = 20): WorldState {
  const cfg = defaultConfig({ tileW: 8, tileH: 8, kernelRadius: 2, seed: 1 + seedOffset, ...overrides });
  const s = allocState(cfg);
  const n = cellCount(cfg);
  s.step = step;
  for (let i = 0; i < n; i++) {
    s.cells[CH.A * n + i] = (i + 1) * 10 + seedOffset;
    s.cells[CH.B * n + i] = (i + 1) * 20 + seedOffset;
    s.cells[CH.C * n + i] = (i + 1) * 30 + seedOffset;
    s.cells[CH.P * n + i] = (i + 1) * 40 + seedOffset;
    s.cells[CH.MOT * n + i] = 128 | (128 << 8);
    s.genome[G.LIN_HI * n + i] = 1;
    s.genome[G.LIN_LO * n + i] = i;
    s.genome[G.PARAM0 * n + i] = 1000 + i + seedOffset * 10_000;
  }
  return s;
}

const cellState = (s: WorldState, i: number): number[] => {
  const n = cellCount(s.cfg);
  return Array.from({ length: CELL_CHANNELS }, (_, ch) => s.cells[ch * n + i]);
};
const cellGenome = (s: WorldState, i: number): number[] => {
  const n = cellCount(s.cfg);
  return Array.from({ length: GENOME_CHANNELS }, (_, g) => s.genome[g * n + i]);
};
const totalMatter = (s: WorldState): number => {
  const n = cellCount(s.cfg);
  let sum = 0;
  for (let i = 0; i < n; i++) sum += s.cells[CH.A * n + i] + s.cells[CH.B * n + i] + s.cells[CH.C * n + i] + s.cells[CH.P * n + i];
  return sum;
};

describe("exchangePositions: deterministic, unique, salted", () => {
  it("is deterministic: same config/salt/step/count picks the same positions every time", () => {
    const cfg = defaultConfig({ tileW: 8, tileH: 8 });
    const a = exchangePositions(cfg, 42, 100, 5);
    const b = exchangePositions(cfg, 42, 100, 5);
    expect(a).toEqual(b);
  });

  it("picks unique positions within one boundary, reprobing on collision", () => {
    const cfg = defaultConfig({ tileW: 4, tileH: 4 }); // 16 cells: small enough to force collisions
    for (const salt of [1, 2, 3, 4, 5]) {
      const positions = exchangePositions(cfg, salt, 100, 16);
      expect(new Set(positions).size).toBe(16); // every cell used exactly once
    }
  });

  it("a different salt selects different positions (with overwhelming probability)", () => {
    const cfg = defaultConfig({ tileW: 8, tileH: 8 });
    const a = exchangePositions(cfg, 1, 100, 5);
    const b = exchangePositions(cfg, 2, 100, 5);
    expect(a).not.toEqual(b);
  });

  it("a different boundary step selects different positions (with overwhelming probability)", () => {
    const cfg = defaultConfig({ tileW: 8, tileH: 8 });
    const a = exchangePositions(cfg, 42, 100, 5);
    const b = exchangePositions(cfg, 42, 200, 5);
    expect(a).not.toEqual(b);
  });

  it("rejects migrantCount above the cell count instead of hanging (review P2: 64 cells / count 65 never terminated)", () => {
    const cfg = defaultConfig({ tileW: 8, tileH: 8 }); // 64 cells
    expect(() => exchangePositions(cfg, 1, 100, 65)).toThrow(/migrantCount/);
    // The boundary itself (migrantCount === cell count) is still fine.
    expect(exchangePositions(cfg, 1, 100, 64)).toHaveLength(64);
  });

  it("rejects other malformed inputs before the reprobe loop can run on them", () => {
    const cfg = defaultConfig({ tileW: 8, tileH: 8 });
    expect(() => exchangePositions(cfg, 1, 100, -1)).toThrow(/migrantCount/);
    expect(() => exchangePositions(cfg, 1, 100, 1.5)).toThrow(/migrantCount/);
    expect(() => exchangePositions(cfg, 1, -1, 4)).toThrow(/boundaryStep/);
    expect(() => exchangePositions(cfg, -1, 100, 4)).toThrow(/salt/);
  });

  it("uses a hash chain distinct from both the physics stream and tile migration's own salt", () => {
    // Before CROSS_MIGRATION_SEED_SALT existed, a naive implementation might
    // reuse MIGRATION_SEED_SALT (or no salt at all) -- confirm they diverge.
    for (let slot = 0; slot < 8; slot++) {
      const raw = cellBase(1, 20, slot);
      const tile = cellBase(1 ^ MIGRATION_SEED_SALT, 20, slot);
      const cross = cellBase(1 ^ CROSS_MIGRATION_SEED_SALT, 20, slot);
      expect(cross).not.toBe(raw);
      expect(cross).not.toBe(tile);
    }
  });
});

describe("applyExchange: matter closure and whole-cell transfer", () => {
  it("conserves matter across a whole ring: a 2-run ring (each imports from the other, at the same shared positions) is a swap, and a swap conserves the combined total", () => {
    // A single isolated applyExchange call duplicates content into the
    // destination without removing it from the source (the source only loses
    // it later, at *its own* boundary, when its own ring-predecessor's content
    // overwrites it there) -- so conservation is a property of the whole ring
    // over time, not of one call in isolation. The simplest ring that's
    // checkable in one step is a mutual (2-run) one: both runs import from
    // each other at the same positions, which is exactly a swap.
    const a = makeState(0);
    const b = makeState(1);
    const before = totalMatter(a) + totalMatter(b);
    const positions = exchangePositions(a.cfg, 7, a.step, 4);
    const { state: aAfter } = applyExchange(a, b, positions, a.step);
    const { state: bAfter } = applyExchange(b, a, positions, b.step);
    const after = totalMatter(aAfter) + totalMatter(bAfter);
    expect(after).toBe(before);
  });

  it("conserves matter across a whole ring: a 3-run ring (A<-C, B<-A, C<-B, all at the same shared positions) also conserves the combined total (coverage: the 2-run case is a swap, a degenerate ring; this checks the general cyclic-permutation case)", () => {
    // Same reasoning as the 2-run case above, generalized: at one shared
    // boundary (same `positions` for every ring member, from one shared
    // salt/step), each run's chosen cells become its ring-predecessor's
    // *pre-boundary* content -- a cyclic permutation of the three runs' own
    // content at those positions, never a duplication or a loss, so the
    // combined total across all three is unchanged regardless of ring size.
    const a = makeState(0);
    const b = makeState(1);
    const c = makeState(2);
    const before = totalMatter(a) + totalMatter(b) + totalMatter(c);
    const positions = exchangePositions(a.cfg, 11, a.step, 4);
    const { state: aAfter } = applyExchange(a, c, positions, a.step); // A's predecessor is C
    const { state: bAfter } = applyExchange(b, a, positions, b.step); // B's predecessor is A
    const { state: cAfter } = applyExchange(c, b, positions, c.step); // C's predecessor is B
    const after = totalMatter(aAfter) + totalMatter(bAfter) + totalMatter(cAfter);
    expect(after).toBe(before);
  });

  it("imports carry the source's whole cell (species, energy, signal, motility, genome); exports carry the destination's own pre-overwrite cell", () => {
    const dest = makeState(0);
    const source = makeState(1);
    const positions = exchangePositions(dest.cfg, 7, dest.step, 4);
    const { state: adjusted, imports, exports } = applyExchange(dest, source, positions, dest.step);
    expect(imports.length).toBe(4);
    expect(exports.length).toBe(4);
    positions.forEach((p, slot) => {
      expect(cellState(adjusted, p)).toEqual(cellState(source, p));
      expect(cellGenome(adjusted, p)).toEqual(cellGenome(source, p));
      expect(imports[slot].cell).toBe(p);
      expect(exports[slot].cell).toBe(p);
      // The export event reflects the *destination's own* pre-overwrite content.
      const destMatter = cellState(dest, p)[CH.A] + cellState(dest, p)[CH.B] + cellState(dest, p)[CH.C] + cellState(dest, p)[CH.P];
      expect(exports[slot].matter).toBe(destMatter);
      const srcMatter = cellState(source, p)[CH.A] + cellState(source, p)[CH.B] + cellState(source, p)[CH.C] + cellState(source, p)[CH.P];
      expect(imports[slot].matter).toBe(srcMatter);
    });
  });

  it("per-boundary net (imports - exports) is not zero in general -- a run's own matter legitimately changes at an exchange", () => {
    const dest = makeState(0);
    const source = makeState(1);
    const positions = exchangePositions(dest.cfg, 7, dest.step, 4);
    const { imports, exports } = applyExchange(dest, source, positions, dest.step);
    expect(exchangeMatterTotal(imports) - exchangeMatterTotal(exports)).not.toBe(0);
  });

  it("cells outside the chosen positions are untouched", () => {
    const dest = makeState(0);
    const source = makeState(1);
    const positions = exchangePositions(dest.cfg, 7, dest.step, 4);
    const { state: adjusted } = applyExchange(dest, source, positions, dest.step);
    const n = cellCount(dest.cfg);
    const touched = new Set(positions);
    for (let i = 0; i < n; i++) {
      if (touched.has(i)) continue;
      expect(cellState(adjusted, i)).toEqual(cellState(dest, i));
      expect(cellGenome(adjusted, i)).toEqual(cellGenome(dest, i));
    }
  });

  it("logs the migrant's lineage id unchanged by the move (an exchange mints no new lineage id)", () => {
    const dest = makeState(0);
    const source = makeState(1);
    const positions = exchangePositions(dest.cfg, 7, dest.step, 4);
    const { imports } = applyExchange(dest, source, positions, dest.step);
    const n = cellCount(source.cfg);
    positions.forEach((p, slot) => {
      expect(imports[slot].lineageHi).toBe(source.genome[G.LIN_HI * n + p]);
      expect(imports[slot].lineageLo).toBe(source.genome[G.LIN_LO * n + p]);
    });
  });
});

describe("lineage id collisions across runs (review P1)", () => {
  // Founder ids are (0, founderIndex + 1) *regardless of seed* -- two
  // different seeds' founder 0 both get id (0, 1). buildWorld places one
  // founder at the same centre position in two otherwise-independent 8x8
  // worlds (different seed, different genome), so an exchange that imports
  // *only* the centre cell leaves the surrounding disk (untouched, still
  // dest's own founder) and the freshly imported centre cell (now source's
  // founder) sharing id (0, 1) with different genome words -- the exact
  // "lineage 0:23 has differing genome words" collision the review found
  // with two soup states.
  function foundersWorld(overrides: Partial<WorldConfig>, mu: number): WorldState {
    const cfg = defaultConfig({ tileW: 8, tileH: 8, kernelRadius: 2, ...overrides });
    return buildWorld(cfg, { nutrient: 0, founders: [{ x: 4, y: 4, radius: 2, genome: generalistGenome(mu, 20), biomass: 64, energy: 128 }] });
  }
  const CENTRE = 4 * 8 + 4; // (x=4, y=4) on an 8-wide grid

  it("without a ring namespace, an exchange between two seeds' founders produces a genuine, correctly-detected collision", () => {
    const dest = foundersWorld({ seed: 1 }, 60);
    const source = foundersWorld({ seed: 2 }, 200); // different mu -> different genome words
    expect(dest.genome[G.LIN_HI * cellCount(dest.cfg) + CENTRE]).toBe(0);
    expect(dest.genome[G.LIN_LO * cellCount(dest.cfg) + CENTRE]).toBe(1);
    const { state: adjusted } = applyExchange(dest, source, [CENTRE], dest.step);
    const errs = validateState(adjusted);
    expect(errs.some((e) => /lineage 0:1 has differing genome words/.test(e))).toBe(true);
  });

  it("with distinct ring namespaces, the same exchange produces no collision at all", () => {
    const dest = foundersWorld({ seed: 1, ringNamespace: 1 }, 60);
    const source = foundersWorld({ seed: 2, ringNamespace: 2 }, 200);
    const { state: adjusted } = applyExchange(dest, source, [CENTRE], dest.step);
    expect(validateState(adjusted)).toEqual([]);
    // The imported cell now carries source's namespaced id, distinct from
    // dest's own founder's namespaced id at the surrounding (untouched) cells.
    const n = cellCount(adjusted.cfg);
    const importedLo = adjusted.genome[G.LIN_LO * n + CENTRE];
    const neighbourLo = adjusted.genome[G.LIN_LO * n + (CENTRE + 1)]; // still dest's own founder disk
    expect(importedLo).not.toBe(neighbourLo);
    expect(importedLo).not.toBe(0);
    expect(neighbourLo).not.toBe(0);
  });

  it("validateState's genome-consistency check is not weakened: two cells that genuinely share a (namespaced) id must still share genome words", () => {
    const dest = foundersWorld({ seed: 1, ringNamespace: 1 }, 60);
    // Corrupt a second cell within dest's own founder disk to carry the same
    // id as the centre but different genome words -- still must be rejected.
    const n = cellCount(dest.cfg);
    const neighbour = CENTRE + 1;
    dest.genome[G.PARAM0 * n + neighbour] = dest.genome[G.PARAM0 * n + neighbour] + 1;
    expect(validateState(dest).some((e) => /differing genome words/.test(e))).toBe(true);
  });
});

describe("founder id packing bounds (review P3)", () => {
  // A founder's raw lineage id is `founderIndex + 1`, packed into LIN_LO by
  // packLineageLo -- unlike a mutation's raw id (a cell index, bounded by
  // validateConfig's cellCount check), nothing bounds spec.founders.length
  // itself, so a founder array large enough silently wraps modulo
  // 2**RING_CELL_BITS once a ring namespace is set, colliding two founders
  // onto the same id. `founders` here is a *sparse* array (only the two
  // indices under test are ever assigned) so this stays a cheap unit test
  // instead of actually allocating millions of founders: Array.prototype.forEach
  // skips holes, so buildWorld's forEach still sees exactly the two real
  // entries, at their real (huge) indices.
  const tinyFounder = (x: number, mu: number) => ({ x, y: 4, radius: 1, genome: generalistGenome(mu, 20), biomass: 8, energy: 16 });

  it("rejects a founder index beyond the representable range once a ring namespace is set, instead of silently wrapping into a collision", () => {
    const cfg = defaultConfig({ tileW: 8, tileH: 8, kernelRadius: 2, ringNamespace: 1 });
    const founders: ReturnType<typeof tinyFounder>[] = [];
    founders[RING_CELL_MASK] = tinyFounder(4, 60); // idx + 1 = RING_CELL_MASK + 1: one past the max.
    expect(() => buildWorld(cfg, { nutrient: 0, founders })).toThrow(/founder.*exceeds the representable/i);
  });

  it("does not reject a founder index exactly at the representable boundary (idx + 1 === RING_CELL_MASK)", () => {
    // A real 8x8 (64-cell) world can't legitimately *host* a founder index
    // this large -- validateState's own, unrelated "lineage is not from this
    // state's past" check (cellPart >= cellCount) still fires, since a
    // founder id isn't a cell index and nothing about *that* check changed
    // here. What this test isolates is narrower: the new bounds check this
    // fix adds must not itself be the thing that rejects the exact boundary
    // value it's supposed to allow through to packLineageLo.
    const cfg = defaultConfig({ tileW: 8, tileH: 8, kernelRadius: 2, ringNamespace: 1 });
    const founders: ReturnType<typeof tinyFounder>[] = [];
    founders[RING_CELL_MASK - 1] = tinyFounder(4, 60); // idx + 1 = RING_CELL_MASK: exactly the max.
    expect(() => buildWorld(cfg, { nutrient: 0, founders })).not.toThrow(/exceeds the representable/);
  });

  it("without a ring namespace, the same huge founder index never trips the new bounds check (unnamespaced packLineageLo does not truncate at RING_CELL_BITS)", () => {
    const cfg = defaultConfig({ tileW: 8, tileH: 8, kernelRadius: 2 });
    const founders: ReturnType<typeof tinyFounder>[] = [];
    founders[RING_CELL_MASK] = tinyFounder(4, 60);
    expect(() => buildWorld(cfg, { nutrient: 0, founders })).not.toThrow(/exceeds the representable/);
  });

  it("maxPackableRaw itself: RING_CELL_MASK when namespaced, 2**32-1 otherwise", () => {
    expect(maxPackableRaw({ ringNamespace: 1 })).toBe(RING_CELL_MASK);
    expect(maxPackableRaw({ ringNamespace: undefined })).toBe(0xffffffff);
  });
});
