// The pond cycle in the shared schema (docs/scaffold-integration-v1.md, "Config", "The transform",
// "Presets and conditions"): the optional pondPeriod/pondK/pondArm keys and their validation, the
// "ponds" init kind and the ponds/ponds-small presets, and the transform moved from tools/lib/ponds.ts.
// The standalone tool's builders (cloneWorld, foundersWorld, pondConfig) stay in tools/lib/ponds.ts,
// so they are the reference the preset side is checked against here.
import { describe, expect, it } from "vitest";
import * as schema from "@bl/schema";
import {
  M3_FOUNDERS,
  MAX_STEP,
  MOT_ZERO,
  PRESETS,
  applyPondCycle,
  assertConserved,
  canonicalConfig,
  contRows,
  decodeCheckpoint,
  defaultConfig,
  encodeCheckpoint,
  founderGenome,
  initWorld,
  ledgerEnergy,
  pondMatter,
  presetConfig,
  presetIdentity,
  stateHash,
  totalsOf,
  validateConfig,
  type InitParams,
  type Preset,
  type WorldConfig,
  type WorldState,
} from "@bl/schema";
import { MOT_ZERO as REF_MOT_ZERO } from "@bl/sim-ref";
import * as standalone from "../../../tools/lib/ponds.ts";

const ponds = PRESETS.find((p) => p.id === "ponds")!;
const pondsSmall = PRESETS.find((p) => p.id === "ponds-small")!;
const POND_KEYS = ["pondPeriod", "pondK", "pondArm"] as const;

/** `cfg` without its pond keys: the physics the standalone tool's pondConfig builds. */
function withoutPondKeys(cfg: WorldConfig): WorldConfig {
  const { pondPeriod: _p, pondK: _k, pondArm: _a, ...rest } = cfg;
  return rest;
}

/** `s`'s hash under `cfg`: equal hashes mean equal step, ledger, cells and genome. */
const hashAs = (s: WorldState, cfg: WorldConfig): string => stateHash({ ...s, cfg });

describe("pond config keys", () => {
  const ok = presetConfig(pondsSmall, 1);

  it("are absent from defaultConfig(), so configs without them hash as before", () => {
    const cfg = defaultConfig();
    for (const k of POND_KEYS) expect(k in cfg).toBe(false);
    expect(canonicalConfig(cfg)).not.toMatch(/pond/i);
    expect(validateConfig(defaultConfig({ tileW: 64, tileH: 64, tilesX: 2, tilesY: 2 }))).toEqual([]);
  });

  it("accept both pond presets and every arm", () => {
    expect(validateConfig(ok)).toEqual([]);
    expect(validateConfig(presetConfig(ponds, 1))).toEqual([]);
    for (const pondArm of ["scaf", "rand", "cont"] as const) expect(validateConfig({ ...ok, pondArm })).toEqual([]);
  });

  it("must be set together", () => {
    for (const k of POND_KEYS) {
      const partial = { ...ok };
      delete partial[k];
      expect(validateConfig(partial)).toEqual(["pondPeriod, pondK and pondArm must be set together"]);
    }
    expect(validateConfig({ ...defaultConfig({ tileW: 64, tileH: 64, tilesX: 2, tilesY: 2 }), pondK: 8 })).not.toEqual([]);
  });

  it("bound pondPeriod (integer >= 1), pondK (1..64) and pondArm", () => {
    for (const pondPeriod of [0, -1, 1.5, MAX_STEP + 1, "1000" as never]) expect(validateConfig({ ...ok, pondPeriod })).toEqual([`pondPeriod must be an integer in 1..${MAX_STEP}`]);
    for (const pondPeriod of [1, 200, MAX_STEP]) expect(validateConfig({ ...ok, pondPeriod })).toEqual([]);
    for (const pondK of [0, 65, 2.5]) expect(validateConfig({ ...ok, pondK })).toEqual(["pondK must be an integer in 1..64"]);
    for (const pondK of [1, 64]) expect(validateConfig({ ...ok, pondK })).toEqual([]);
    for (const pondArm of ["", "SCAF", "random", 1]) expect(validateConfig({ ...ok, pondArm: pondArm as never })).toEqual(["pondArm must be scaf, rand, cont, nat or shuf"]);
  });

  it("need 64x64 tiles and at least 4 ponds", () => {
    expect(validateConfig({ ...ok, tileW: 32, tileH: 32, tilesX: 4, tilesY: 4 })).toEqual(["a pond config (pondPeriod set) must have 64x64 tiles"]);
    expect(validateConfig({ ...ok, tileW: 128 })).toEqual(["a pond config (pondPeriod set) must have 64x64 tiles"]);
    expect(validateConfig({ ...ok, tilesX: 1, tilesY: 3 })).toEqual(["a pond config (pondPeriod set) must have at least 4 ponds (tilesX * tilesY >= 4)"]);
    expect(validateConfig({ ...ok, tilesX: 4, tilesY: 1 })).toEqual([]);
  });

  it("exclude tile migration and metapopulation membership", () => {
    expect(validateConfig({ ...ok, migrationPeriod: 200, migrantCount: 4 })).toEqual(["a pond config (pondPeriod set) cannot migrate between tiles (migrationPeriod > 0)"]);
    // The no-migration control's zeros are not migration.
    expect(validateConfig({ ...ok, migrationPeriod: 0, migrantCount: 0 })).toEqual([]);
    expect(validateConfig({ ...ok, ringNamespace: 1 })).toEqual(["a pond config (pondPeriod set) cannot be a metapopulation member (ringNamespace set)"]);
    // The same settings stay valid without the pond keys.
    expect(validateConfig(withoutPondKeys({ ...ok, migrationPeriod: 200, migrantCount: 4 }))).toEqual([]);
    expect(validateConfig(withoutPondKeys({ ...ok, ringNamespace: 1 }))).toEqual([]);
  });

  it("round-trip through the checkpoint codec and enter the state hash", () => {
    const s = initWorld(ok, pondsSmall.init);
    const { state } = decodeCheckpoint(encodeCheckpoint(s));
    expect(state.cfg.pondPeriod).toBe(1000);
    expect(state.cfg.pondK).toBe(8);
    expect(state.cfg.pondArm).toBe("scaf");
    expect(stateHash(state)).toBe(stateHash(s));
    expect(hashAs(s, withoutPondKeys(ok))).not.toBe(stateHash(s));
  });
});

describe("existing presets", () => {
  // Captured before the pond cycle existed (scaffold integration I1 baseline).
  const PINNED: Record<string, string> = {
    spots: "f5848d667693097a",
    gradient: "25cc5443731106ec",
    "spots-m3": "a9f93070127a0c05",
    "gradient-m3": "e1c93a9384b5d921",
    "gradient-m3-waste": "3bef8f12f11e6ad5",
    soup: "5f48fa3daf14b1ad",
    seasons: "ef346e1f044c7845",
    large: "296ddd502de0df82",
    archipelago: "8304ef7cd65c8b08",
  };

  it("keep their identities, order and shape", () => {
    expect(PRESETS.slice(0, Object.keys(PINNED).length).map((p) => p.id)).toEqual(Object.keys(PINNED));
    for (const [id, identity] of Object.entries(PINNED)) {
      const p = PRESETS.find((q) => q.id === id)!;
      expect(presetIdentity(p)).toBe(identity);
      for (const k of POND_KEYS) expect(k in presetConfig(p, 1)).toBe(false);
      expect("start" in p.init || "founder" in p.init).toBe(false);
    }
  });
});

describe('init kind "ponds"', () => {
  it("builds tools/lib/ponds.ts's cloneWorld cell for cell (ponds-small and ponds, founder 2)", () => {
    for (const [preset, side] of [[pondsSmall, 2], [ponds, 8]] as const) {
      for (const seed of [1, 4_811_001]) {
        const cfg = presetConfig(preset, seed);
        const s = initWorld(cfg, preset.init);
        const ref = standalone.cloneWorld(standalone.pondConfig(side, seed), founderGenome(M3_FOUNDERS[2]));
        expect(hashAs(s, ref.cfg)).toBe(stateHash(ref));
        expect(stateHash(s)).toBe(stateHash(standalone.cloneWorld(cfg, founderGenome(M3_FOUNDERS[2]))));
      }
    }
  });

  it("builds cloneWorld's world for any founder index", () => {
    const cfg = presetConfig(pondsSmall, 3);
    for (const founder of [0, 7, M3_FOUNDERS.length - 1]) {
      const s = initWorld(cfg, { ...pondsSmall.init, founder });
      expect(stateHash(s)).toBe(stateHash(standalone.cloneWorld(cfg, founderGenome(M3_FOUNDERS[founder]))));
    }
  });

  it('with start "founders" builds foundersWorld cell for cell (12 founders round-robin)', () => {
    for (const side of [2, 8]) {
      const seed = 4_811_201;
      const ref = standalone.foundersWorld(standalone.pondConfig(side, seed)).state;
      const init: InitParams = { kind: "ponds", founders: side * side, nutrient: 32, biomass: 64, start: "founders" };
      const s = initWorld(presetConfig(side === 2 ? pondsSmall : ponds, seed), init);
      expect(hashAs(s, ref.cfg)).toBe(stateHash(ref));
    }
  });

  it("rejects an inconsistent init", () => {
    const cfg = presetConfig(pondsSmall, 1);
    const bad = (init: Partial<InitParams>) => () => initWorld(cfg, { ...pondsSmall.init, ...init });
    expect(bad({ founders: 5 })).toThrow(/founders must equal the pond count 4/);
    expect(bad({ start: undefined })).toThrow(/start must be "clone" or "founders"/);
    for (const founder of [undefined, -1, 1.5, M3_FOUNDERS.length]) expect(bad({ founder })).toThrow(/start "clone" needs founder/);
    expect(bad({ start: "founders" })).toThrow(/takes no founder index/);
    expect(() => initWorld(cfg, { kind: "generalist", founders: 4, nutrient: 32, biomass: 64, start: "clone", founder: 2 })).toThrow(/belong to kind "ponds"/);
    expect(() => initWorld(cfg, { kind: "m3", founders: 4, nutrient: 32, biomass: 64, founder: 2 })).toThrow(/belong to kind "ponds"/);
  });
});

describe("pond presets", () => {
  it("ponds has pondConfig(8, seed)'s physics, period 10,000, k 8, arm scaf", () => {
    for (const seed of [1, 4_811_001, 4_811_101]) {
      const cfg = presetConfig(ponds, seed);
      expect(canonicalConfig(withoutPondKeys(cfg))).toBe(canonicalConfig(standalone.pondConfig(8, seed)));
      expect([cfg.pondPeriod, cfg.pondK, cfg.pondArm]).toEqual([10_000, 8, "scaf"]);
    }
    expect(ponds.init).toEqual({ kind: "ponds", founders: 64, nutrient: 32, biomass: 64, start: "clone", founder: 2 });
  });

  it("ponds-small is the same physics at 2x2 ponds, period 1,000 (Amendment 1), k 8, arm scaf", () => {
    const cfg = presetConfig(pondsSmall, 1);
    expect(canonicalConfig(withoutPondKeys(cfg))).toBe(canonicalConfig(standalone.pondConfig(2, 1)));
    expect([cfg.pondPeriod, cfg.pondK, cfg.pondArm]).toEqual([1000, 8, "scaf"]);
    expect(pondsSmall.init).toEqual({ ...ponds.init, founders: 4 });
  });

  it("have pinned identities that cover start, founder index and founder set", () => {
    expect(presetIdentity(ponds)).toBe("56526b894cfccf3f");
    expect(presetIdentity(pondsSmall)).toBe("eb17008775286308");
    const { kind, founders, nutrient, biomass, start, founder } = ponds.init;
    expect(presetIdentity({ ...ponds, init: { founder, start, biomass, nutrient, founders, kind } })).toBe("56526b894cfccf3f");
    const variants: Preset[] = [
      { ...ponds, init: { ...ponds.init, founder: 3 } },
      { ...ponds, init: { kind, founders, nutrient, biomass, start: "founders" } },
      { ...ponds, cfg: { ...ponds.cfg, pondArm: "rand" } },
      { ...ponds, cfg: { ...ponds.cfg, pondPeriod: 3000 } },
      { ...ponds, cfg: { ...ponds.cfg, pondK: 5 } },
    ];
    const ids = new Set([presetIdentity(ponds), ...variants.map(presetIdentity)]);
    expect(ids.size).toBe(variants.length + 1);
  });
});

describe("pond transform in @bl/schema", () => {
  it("is what tools/lib/ponds.ts re-exports", () => {
    const moved = [
      "POND_SALT",
      "POND_COLUMNS",
      "applyPondCycle",
      "contRows",
      "pondMatter",
      "pondTraits",
      "randomKey",
      "weightedPick",
      "dominantGenome",
      "packetWindow",
      "drawPacketCentre",
      "ledgerEnergy",
      "assertConserved",
    ] as const;
    for (const name of moved) {
      expect(schema[name]).toBeDefined();
      expect(standalone[name]).toBe(schema[name]);
    }
    expect(MOT_ZERO).toBe(REF_MOT_ZERO);
  });

  it("cycles the ponds-small start world exactly (matter per pond, total matter, ledger)", () => {
    const pre = initWorld(presetConfig(pondsSmall, 1), pondsSmall.init);
    const Mr = pondMatter(pre);
    const t0 = totalsOf(pre.cfg, pre.cells);
    const res = applyPondCycle(pre, 1, "scaf", 8, Mr);
    expect(res.ended).toBe(false);
    expect(res.donors).toHaveLength(1);
    expect(res.rows).toHaveLength(4);
    expect(pondMatter(res.state)).toEqual(Mr);
    assertConserved(res.state, t0.matter, ledgerEnergy(pre));
    expect(contRows(pre, 1).map((r) => r.recipientTrait)).toEqual(res.rows.map((r) => r.recipientTrait));
  });
});
