// Migration between tiles (packages/schema/src/migration.ts): deterministic
// migrant selection, matter closure (per-tile and archipelago-wide) and
// disabled-by-default parity.
import { describe, expect, it } from "vitest";
import { CELL_CHANNELS, CH, G, GENOME_CHANNELS, MIGRATION_SEED_SALT, allocState, applyMigration, cellBase, cellCount, defaultConfig, tileMatterTotals, validateConfig, type WorldConfig, type WorldState } from "@bl/schema";

/** A small 2x2-tile world with distinguishable, hand-crafted cell/genome content -- not a physically realistic history, just enough structure to check the permutation exactly. */
function makeState(overrides: Partial<WorldConfig> = {}, step = 20): WorldState {
  const cfg = defaultConfig({ tileW: 8, tileH: 8, tilesX: 2, tilesY: 2, kernelRadius: 2, migrationPeriod: 10, migrantCount: 3, ...overrides });
  const s = allocState(cfg);
  const n = cellCount(cfg);
  s.step = step;
  for (let i = 0; i < n; i++) {
    s.cells[CH.A * n + i] = i + 1;
    s.cells[CH.B * n + i] = 2 * (i + 1);
    s.cells[CH.C * n + i] = 3 * (i + 1);
    s.cells[CH.P * n + i] = 4 * (i + 1);
    s.cells[CH.MOT * n + i] = 128 | (128 << 8);
    // Every cell its own lineage: unique ids trivially satisfy "same id -> same genome".
    s.genome[G.LIN_HI * n + i] = 1;
    s.genome[G.LIN_LO * n + i] = i;
    s.genome[G.PARAM0 * n + i] = 1000 + i;
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

describe("applyMigration: disabled-by-default parity", () => {
  it("is a no-op (same state reference, no events) when migrationPeriod is 0", () => {
    const s = makeState({ migrationPeriod: 0, migrantCount: 0 });
    const r = applyMigration(s, s.step);
    expect(r.state).toBe(s);
    expect(r.events).toEqual([]);
  });

  // These two combinations (migrationPeriod > 0 with migrantCount 0, or with a
  // single tile) are themselves invalid per validateConfig -- allocState
  // would refuse them -- so they're built by mutating an already-valid
  // state's config directly, to check applyMigration's own defensive guard
  // rather than validateConfig's (already covered in config validation tests).
  it("is a no-op when migrantCount is 0, even with migrationPeriod set", () => {
    const base = makeState();
    const s = { ...base, cfg: { ...base.cfg, migrantCount: 0 } };
    const r = applyMigration(s, s.step);
    expect(r.state).toBe(s);
    expect(r.events).toEqual([]);
  });

  it("is a no-op with a single tile", () => {
    const base = makeState();
    const s = { ...base, cfg: { ...base.cfg, tilesX: 1, tilesY: 1 } };
    const r = applyMigration(s, s.step);
    expect(r.state).toBe(s);
    expect(r.events).toEqual([]);
  });

  it("is a no-op on a step that isn't a multiple of migrationPeriod", () => {
    const s = makeState();
    const r = applyMigration(s, 21);
    expect(r.state).toBe(s);
    expect(r.events).toEqual([]);
  });

  it("default config has migration disabled (the field is absent, not merely 0 -- see WorldConfig's doc on why)", () => {
    expect(defaultConfig().migrationPeriod).toBeUndefined();
    expect(defaultConfig().migrantCount).toBeUndefined();
    expect(Object.keys(defaultConfig())).not.toContain("migrationPeriod");
    expect(Object.keys(defaultConfig())).not.toContain("migrantCount");
  });
});

describe("validateConfig: migration fields", () => {
  const base = () => defaultConfig({ tileW: 8, tileH: 8, tilesX: 2, tilesY: 2, kernelRadius: 2 });

  it("accepts a well-formed migration config", () => {
    expect(validateConfig({ ...base(), migrationPeriod: 20, migrantCount: 3 })).toEqual([]);
  });

  it("is untouched by omitting both fields (the default, migration-disabled shape)", () => {
    expect(validateConfig(base())).toEqual([]);
  });

  it("rejects an out-of-range migrationPeriod", () => {
    expect(validateConfig({ ...base(), migrationPeriod: -1, migrantCount: 1 })).not.toEqual([]);
    expect(validateConfig({ ...base(), migrationPeriod: 8_000_001, migrantCount: 1 })).not.toEqual([]);
    expect(validateConfig({ ...base(), migrationPeriod: 1.5, migrantCount: 1 })).not.toEqual([]);
  });

  it("rejects an out-of-range migrantCount", () => {
    expect(validateConfig({ ...base(), migrationPeriod: 20, migrantCount: -1 })).not.toEqual([]);
    expect(validateConfig({ ...base(), migrationPeriod: 20, migrantCount: 4097 })).not.toEqual([]);
  });

  it("requires at least 2 tiles when migrationPeriod > 0", () => {
    expect(validateConfig({ ...base(), tilesX: 1, tilesY: 1, migrationPeriod: 20, migrantCount: 1 })).not.toEqual([]);
  });

  it("requires migrantCount >= 1 when migrationPeriod > 0", () => {
    expect(validateConfig({ ...base(), migrationPeriod: 20, migrantCount: 0 })).not.toEqual([]);
  });

  it("requires migrantCount <= tileW * tileH, so unique-offset selection is always achievable (review 2)", () => {
    expect(validateConfig({ ...base(), migrationPeriod: 20, migrantCount: 64 })).toEqual([]); // exactly tileW*tileH: ok
    expect(validateConfig({ ...base(), migrationPeriod: 20, migrantCount: 65 })).not.toEqual([]); // one more than the tile holds
  });

  it("migrationPeriod/migrantCount of 0 (or absent) never trips the migration-specific checks, regardless of tile count", () => {
    expect(validateConfig({ ...base(), tilesX: 1, tilesY: 1 })).toEqual([]);
  });
});

describe("applyMigration: deterministic migrant selection", () => {
  it("picks the same packets and produces the same resulting state on every call (same seed, step, config)", () => {
    const s = makeState();
    const r1 = applyMigration(s, s.step);
    const r2 = applyMigration(s, s.step);
    expect(r1.events).toEqual(r2.events);
    expect(Array.from(r1.state.cells)).toEqual(Array.from(r2.state.cells));
    expect(Array.from(r1.state.genome)).toEqual(Array.from(r2.state.genome));
  });

  it("depends only on seeded values (seed, step, slot), not on cell content", () => {
    const a = makeState();
    const b = makeState();
    b.cells[CH.B * cellCount(b.cfg) + 5] += 1000; // perturb content away from the migration slots' own values
    const ra = applyMigration(a, a.step);
    const rb = applyMigration(b, b.step);
    // Same fromTile/toTile/fromCell/toCell/slot selection regardless of the perturbation.
    const strip = (e: (typeof ra.events)[number]) => ({ ...e, matter: 0, lineageHi: 0, lineageLo: 0 });
    expect(ra.events.map(strip)).toEqual(rb.events.map(strip));
  });

  it("a different seed selects different packets (with overwhelming probability)", () => {
    const a = makeState({ seed: 1 });
    const b = makeState({ seed: 2 });
    const ea = applyMigration(a, a.step).events.map((e) => e.fromCell);
    const eb = applyMigration(b, b.step).events.map((e) => e.fromCell);
    expect(ea).not.toEqual(eb);
  });
});

describe("applyMigration: matter closure", () => {
  it("conserves matter archipelago-wide (a pure permutation of existing cell content)", () => {
    const s = makeState();
    const before = tileMatterTotals(s);
    const { state: migrated } = applyMigration(s, s.step);
    const after = tileMatterTotals(migrated);
    const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
    expect(sum(after)).toBe(sum(before));
  });

  it("closes exactly per tile: after = before - exported + imported, from the logged events alone", () => {
    const s = makeState();
    const before = tileMatterTotals(s);
    const { state: migrated, events } = applyMigration(s, s.step);
    const after = tileMatterTotals(migrated);
    const tiles = s.cfg.tilesX * s.cfg.tilesY;
    expect(events.length).toBeGreaterThan(0);
    for (let t = 0; t < tiles; t++) {
      const exported = events.filter((e) => e.fromTile === t).reduce((a, e) => a + e.matter, 0);
      const imported = events.filter((e) => e.toTile === t).reduce((a, e) => a + e.matter, 0);
      expect(after[t]).toBe(before[t] - exported + imported);
    }
  });

  it("moves the whole cell (species quanta, energy, signal, motility and genome) as one packet, not just matter", () => {
    const s = makeState();
    const { state: migrated, events } = applyMigration(s, s.step);
    for (const e of events) {
      expect(cellState(migrated, e.toCell)).toEqual(cellState(s, e.fromCell));
      expect(cellGenome(migrated, e.toCell)).toEqual(cellGenome(s, e.fromCell));
    }
  });
});

describe("applyMigration: unique offsets (regression)", () => {
  // Astra review repro: seed 25, step 20, 8x8 tiles, 3 migrants -- slots 1 and
  // 2 both drew the offset (5, 7) under the old code (a bare `cellBase`/`draw`
  // per slot, no collision handling). The second slot's "transfer" was then
  // just a copy of the first slot's already-rotated result: a real cell moved
  // once, but the log recorded two transfers for it, so a ledger computed from
  // the log (before - exported + imported) predicted more matter arriving at
  // tile 0 (4280) than the state actually held (4144).
  it("never logs two events for the same source cell in one migration event", () => {
    const s = makeState({ seed: 25, tileW: 8, tileH: 8, tilesX: 2, tilesY: 2, migrationPeriod: 20, migrantCount: 3 }, 20);
    const { events } = applyMigration(s, 20);
    expect(events.length).toBe(3 * 4); // migrantCount * tiles
    expect(new Set(events.map((e) => e.fromCell)).size).toBe(events.length);
    expect(new Set(events.map((e) => e.toCell)).size).toBe(events.length);
  });

  it("the repro's exact ledger prediction now matches the actual per-tile matter (before - exported + imported)", () => {
    const s = makeState({ seed: 25, tileW: 8, tileH: 8, tilesX: 2, tilesY: 2, migrationPeriod: 20, migrantCount: 3 }, 20);
    const before = tileMatterTotals(s);
    const { state: migrated, events } = applyMigration(s, 20);
    const after = tileMatterTotals(migrated);
    for (let t = 0; t < 4; t++) {
      const exported = events.filter((e) => e.fromTile === t).reduce((a, e) => a + e.matter, 0);
      const imported = events.filter((e) => e.toTile === t).reduce((a, e) => a + e.matter, 0);
      expect(after[t]).toBe(before[t] - exported + imported);
    }
  });

  it("reprobes deterministically to a unique offset across many (seed, step) combinations, never exceeding the tile", () => {
    for (let seed = 0; seed < 50; seed++) {
      const s = makeState({ seed, tileW: 8, tileH: 8, tilesX: 2, tilesY: 2, migrationPeriod: 20, migrantCount: 64 }, 20);
      const { events } = applyMigration(s, 20);
      const fromCellsInTile0 = events.filter((e) => e.fromTile === 0).map((e) => e.fromCell);
      expect(new Set(fromCellsInTile0).size).toBe(fromCellsInTile0.length);
      expect(fromCellsInTile0.length).toBe(64); // migrantCount == tileW*tileH: every cell in the tile is used exactly once
    }
  });
});

describe("applyMigration: RNG domain separation (review 5)", () => {
  it("MIGRATION_SEED_SALT gives migration's hash chain a base distinct from the physics kernels' own cellBase for the same (seed, step, slot-as-cell-index)", () => {
    // Before the fix, applyMigration keyed its draws on the bare
    // cellBase(seed, step, slot) -- identical to what the physics kernels
    // (RND.LOTTERY/RND.DIFF) compute for the world cell whose index equals
    // that slot number at the same step. Migrant selection must be
    // independent of the physics RNG stream, not merely a differently-purposed
    // draw within the same one.
    for (let slot = 0; slot < 8; slot++) {
      const physicsBase = cellBase(1, 20, slot);
      const migrationBase = cellBase(1 ^ MIGRATION_SEED_SALT, 20, slot);
      expect(migrationBase).not.toBe(physicsBase);
    }
  });

  it("MIGRATION_SEED_SALT is a fixed, nonzero constant (so salting is not an accidental no-op)", () => {
    expect(MIGRATION_SEED_SALT).not.toBe(0);
  });
});

describe("applyMigration: lineage traceability", () => {
  it("logs the migrant's lineage id, unchanged by the move (a migration mints no new id)", () => {
    const s = makeState();
    const { state: migrated, events } = applyMigration(s, s.step);
    const n = cellCount(s.cfg);
    for (const e of events) {
      expect(e.lineageHi).toBe(s.genome[G.LIN_HI * n + e.fromCell]);
      expect(e.lineageLo).toBe(s.genome[G.LIN_LO * n + e.fromCell]);
      expect(migrated.genome[G.LIN_HI * n + e.toCell]).toBe(e.lineageHi);
      expect(migrated.genome[G.LIN_LO * n + e.toCell]).toBe(e.lineageLo);
    }
  });

  it("cells outside the chosen packets are untouched", () => {
    const s = makeState();
    const { state: migrated, events } = applyMigration(s, s.step);
    const touched = new Set(events.flatMap((e) => [e.fromCell, e.toCell]));
    const n = cellCount(s.cfg);
    for (let i = 0; i < n; i++) {
      if (touched.has(i)) continue;
      expect(cellState(migrated, i)).toEqual(cellState(s, i));
      expect(cellGenome(migrated, i)).toEqual(cellGenome(s, i));
    }
  });
});
