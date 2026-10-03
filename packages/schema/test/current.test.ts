// The transition hunt's current (docs/scaffold-transition-hunt-v1.md, "The current: arms nat and shuf"):
// the optional pondDeath/pondExport keys and their validation, the export zone, and applyCurrentCycle --
// checked against an independent oracle written here from the hunt's prose (death, weights, donors,
// landing), not from the implementation. Worlds are crafted 2 x 2 (or 4 x 4) pond grids with mutation off;
// per-pond matter is whatever the crafted world holds (Mr = pondMatter(pre)), as in tools/test/ponds.test.ts.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  CH,
  GENOME_CHANNELS,
  HUNT_POND_COLUMNS,
  M3_FOUNDERS,
  MOT_ZERO,
  POND_COLUMNS,
  PRESETS,
  applyCurrentCycle,
  applyPondCycle,
  assertConserved,
  buildWorld,
  canonicalConfig,
  cellCount,
  contRows,
  defaultConfig,
  drawExportCentre,
  drawPacketCentre,
  encodeGenome,
  exportDistance,
  founderGenome,
  ledgerEnergy,
  packetWindow,
  pondExportMasses,
  pondMatter,
  pondTraits,
  presetConfig,
  presetIdentity,
  randomKey,
  stateHash,
  totalsOf,
  validateConfig,
  weightedPick,
  worldW,
  type CycleResult,
  type PondRow,
  type WorldConfig,
  type WorldState,
} from "@bl/schema";

const genomeA = founderGenome(M3_FOUNDERS[2]);
const ponds = PRESETS.find((p) => p.id === "ponds")!;
const pondsSmall = PRESETS.find((p) => p.id === "ponds-small")!;
const K = 8;
const EXPORT = 28;
const HALF = 32768;

const worldOf = (side: number, seed = 7): WorldState =>
  buildWorld(defaultConfig({ tileW: 64, tileH: 64, tilesX: side, tilesY: side, seed, mutRate: 0 }), { nutrient: 32, founders: [] });

const cellIdx = (cfg: WorldConfig, pond: number, x: number, y: number): number => {
  const tx = pond % cfg.tilesX;
  const ty = Math.floor(pond / cfg.tilesX);
  return (ty * cfg.tileH + y) * worldW(cfg) + tx * cfg.tileW + x;
};

interface Plant {
  B?: number;
  P?: number;
  E?: number;
  C?: number;
  S?: number;
  MOT?: number;
  /** Lineage low word (high word 0); genome words come from a fixed genome, so equal ids share words. */
  lin?: number;
}

/** Sets a cell of a crafted world (matter is whatever the world then holds). */
function plant(s: WorldState, pond: number, x: number, y: number, p: Plant): number {
  const n = cellCount(s.cfg);
  const i = cellIdx(s.cfg, pond, x, y);
  const set = (ch: number, v: number | undefined) => v !== undefined && (s.cells[ch * n + i] = v);
  set(CH.B, p.B);
  set(CH.P, p.P);
  set(CH.E, p.E);
  set(CH.C, p.C);
  set(CH.S, p.S);
  set(CH.MOT, p.MOT);
  if (p.lin !== undefined) {
    const w = encodeGenome(genomeA, 0, p.lin);
    for (let g = 0; g < GENOME_CHANNELS; g++) s.genome[g * n + i] = w[g];
  }
  return i;
}

/**
 * Four ponds: 0 exports (X = 180: B 60 and B+P 120 in the zone, plus a heavier interior cell), 1 exports (X = 48, with
 * dust beside it), 2 is occupied only in its interior (X = 0), 3 is empty. Waste, signal, energy and a non-rest
 * motility are scattered so a grind, a copy or a landing that drops them shows.
 */
function garden(seed = 7): WorldState {
  const s = worldOf(2, seed);
  plant(s, 0, 2, 10, { B: 60, E: 5, lin: 11, MOT: 130 | (127 << 8) });
  plant(s, 0, 62, 40, { B: 100, P: 20, E: 9, S: 3, lin: 12 });
  plant(s, 0, 30, 30, { B: 500, P: 40, E: 20, C: 6, lin: 13 });
  plant(s, 0, 33, 31, { B: 70, E: 4, lin: 11 });
  plant(s, 1, 0, 0, { B: 48, E: 2, lin: 21 });
  plant(s, 1, 1, 1, { B: 47, lin: 22 });
  plant(s, 1, 20, 20, { B: 300, E: 7, C: 2, lin: 23 });
  plant(s, 2, 32, 32, { B: 200, E: 8, S: 1, lin: 31, MOT: 126 | (129 << 8) });
  plant(s, 2, 10, 10, { B: 20, C: 5 });
  return s;
}

const cloned = (s: WorldState): WorldState => ({ ...s, cells: s.cells.slice(), genome: s.genome.slice(), flux: s.flux.slice() });

/** Pond `p`'s cell indices in tile raster order. */
const pondCells = (cfg: WorldConfig, p: number): number[] => {
  const out: number[] = [];
  for (let y = 0; y < cfg.tileH; y++) for (let x = 0; x < cfg.tileW; x++) out.push(cellIdx(cfg, p, x, y));
  return out;
};

const sameCell = (a: WorldState, i: number, b: WorldState, j: number): boolean => {
  const n = cellCount(a.cfg);
  for (let ch = 0; ch < 7; ch++) if (a.cells[ch * n + i] !== b.cells[ch * n + j]) return false;
  for (let g = 0; g < GENOME_CHANNELS; g++) if (a.genome[g * n + i] !== b.genome[g * n + j]) return false;
  return true;
};

/** Cells of `cells` (world indices) at which `a` and `b` differ in any channel or genome word. */
const differing = (a: WorldState, b: WorldState, cells: number[]): number => cells.filter((i) => !sameCell(a, i, b, i)).length;

/** What the hunt's prose says one boundary does, computed here from the primitives only. */
function oracle(pre: WorldState, b: number, arm: "nat" | "shuf", death: number, threshold: number) {
  const R = pre.cfg.tilesX * pre.cfg.tilesY;
  const seed = pre.cfg.seed;
  const traits = pondTraits(pre);
  const n = cellCount(pre.cfg);
  const X = Array.from({ length: R }, (_, p) => {
    let sum = 0;
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        const dx = Math.abs(x - 32), dy = Math.abs(y - 32);
        const dist = Math.max(Math.min(dx, 64 - dx), Math.min(dy, 64 - dy));
        const i = cellIdx(pre.cfg, p, x, y);
        const m = pre.cells[CH.B * n + i] + pre.cells[CH.P * n + i];
        if (dist >= threshold && m >= 48) sum += m;
      }
    }
    return sum;
  });
  const died = Array.from({ length: R }, (_, p) => !(traits[p] > 0) || randomKey(seed, b, p, 12) < death * 65536);
  let w = X.slice();
  if (arm === "shuf") {
    const ex = X.map((x, p) => (x > 0 ? p : -1)).filter((p) => p >= 0);
    const order = ex.slice().sort((p, q) => randomKey(seed, b, p, 1) - randomKey(seed, b, q, 1) || p - q);
    w = new Array(R).fill(0);
    order.forEach((p, j) => (w[p] = X[ex[j]]));
  }
  const total = w.reduce((a, v) => a + v, 0);
  const donor: number[] = [];
  for (let r = 0; r < R; r++) {
    if (!died[r]) donor.push(-2);
    else if (total === 0) donor.push(-1);
    else {
      const v = weightedPick(randomKey(seed, b, r, 10), randomKey(seed, b, r, 11), total);
      let acc = 0;
      let d = -1;
      for (let p = 0; p < R && d < 0; p++) {
        acc += w[p];
        if (acc > v) d = p;
      }
      donor.push(d);
    }
  }
  return { traits, X, w, died, donor, total };
}

/** Every post-state cell of recipient `r`, checked against the packet that should have landed there. */
function checkLanding(pre: WorldState, post: WorldState, row: PondRow, r: number, k: number, Mr: number, threshold: number, b: number): void {
  const cfg = pre.cfg;
  const n = cellCount(cfg);
  const donor = row.donor;
  const centre = drawExportCentre(pre, donor, threshold, cfg.seed, b, r)!;
  const window = packetWindow(pre, donor, k, centre);
  const mass = window.map((i) => pre.cells[CH.B * n + i] + pre.cells[CH.P * n + i]);
  const reqMass = mass.reduce((a, m) => a + m, 0);
  let kept = window.length;
  let ret = reqMass;
  while (ret > Mr) ret -= mass[--kept];
  expect([row.landed, row.reqMass, row.retMass, row.truncated]).toEqual([kept, reqMass, ret, kept < window.length ? 1 : 0]);
  if (kept < window.length) expect(ret + mass[kept]).toBeGreaterThan(Mr);
  expect([row.cx, row.cy]).toEqual([(centre % worldW(cfg)) % 64, Math.floor(centre / worldW(cfg)) % 64]);
  const half = k >> 1;
  const landed = new Set<number>();
  let bad = 0;
  for (let q = 0; q < kept; q++) {
    const dst = cellIdx(cfg, r, 32 - half + (q % k), 32 - half + Math.floor(q / k));
    landed.add(dst);
    for (const ch of [CH.B, CH.P, CH.E, CH.MOT]) if (post.cells[ch * n + dst] !== pre.cells[ch * n + window[q]]) bad++;
    if (post.cells[CH.C * n + dst] + post.cells[CH.S * n + dst] !== 0) bad++;
    for (let g = 0; g < GENOME_CHANNELS; g++) if (post.genome[g * n + dst] !== pre.genome[g * n + window[q]]) bad++;
  }
  expect(landed.size).toBe(kept);
  // Everything else in the recipient is cleared: no B, P, C, E, S, rest motility, no genome.
  let aSum = 0;
  for (const i of pondCells(cfg, r)) {
    aSum += post.cells[CH.A * n + i];
    if (landed.has(i)) continue;
    if (post.cells[CH.B * n + i] + post.cells[CH.P * n + i] + post.cells[CH.C * n + i] + post.cells[CH.E * n + i] + post.cells[CH.S * n + i] !== 0) bad++;
    if (post.cells[CH.MOT * n + i] !== MOT_ZERO) bad++;
    for (let g = 0; g < GENOME_CHANNELS; g++) if (post.genome[g * n + i] !== 0) bad++;
  }
  expect(bad).toBe(0);
  expect(aSum).toBe(Mr - ret);
}

/** Everything a cycle promises, checked against the oracle. Returns the oracle's view. */
function checkCycle(pre: WorldState, res: CycleResult, b: number, arm: "nat" | "shuf", death: number, threshold = EXPORT, k = K): ReturnType<typeof oracle> {
  const cfg = pre.cfg;
  const n = cellCount(cfg);
  const R = cfg.tilesX * cfg.tilesY;
  const Mr = pondMatter(pre);
  const want = oracle(pre, b, arm, death, threshold);
  expect(res.rows).toHaveLength(R);
  expect(res.rows.map((r) => r.recipient)).toEqual(Array.from({ length: R }, (_, p) => p));
  expect(res.rows.map((r) => r.died)).toEqual(want.died.map((d) => (d ? 1 : 0)));
  expect(res.rows.map((r) => r.donor)).toEqual(want.donor);
  expect(res.rows.map((r) => r.exportMass)).toEqual(want.X);
  expect(res.rows.map((r) => r.weight)).toEqual(want.w);
  expect(res.donors).toEqual(want.donor.filter((d) => d >= 0));
  expect(pondMatter(res.state)).toEqual(Mr);
  assertConserved(res.state, totalsOf(cfg, pre.cells).matter, ledgerEnergy(pre));
  expect(res.state.step).toBe(pre.step);
  expect(res.ended).toBe(pondTraits(res.state).every((t) => t === 0));
  const heats = pondHeatOf(pre);
  for (let p = 0; p < R; p++) {
    const row = res.rows[p];
    expect(row.cycle).toBe(b);
    expect(row.step).toBe(pre.step);
    expect(row.recipientTrait).toBe(want.traits[p]);
    expect(row.donorTrait).toBe(row.donor >= 0 ? want.traits[row.donor] : 0);
    expect(row.heat).toBe(want.died[p] ? heats[p].toString() : "0");
    if (want.died[p] && row.donor >= 0) checkLanding(pre, res.state, row, p, k, Mr[p], threshold, b);
    else {
      expect(row.light).toBe("0");
      expect([row.cx, row.cy, row.landed, row.reqMass, row.retMass, row.reqE, row.retE, row.truncated]).toEqual([-1, -1, 0, 0, 0, 0, 0, 0]);
      expect([row.packetLineages, row.domHi, row.domLo, row.domShare]).toEqual([0, 0, 0, 0]);
    }
    if (!want.died[p]) expect(differing(pre, res.state, pondCells(cfg, p))).toBe(0);
    else if (row.donor === -1) {
      let a = 0;
      let live = 0;
      for (const i of pondCells(cfg, p)) {
        a += res.state.cells[CH.A * n + i];
        live += res.state.cells[CH.B * n + i] + res.state.cells[CH.P * n + i] + res.state.cells[CH.E * n + i];
      }
      expect([a, live]).toEqual([Mr[p], 0]);
    }
  }
  expect(res.heat).toBe(want.died.reduce((a, d, p) => a + (d ? heats[p] : 0n), 0n));
  expect(res.light).toBe(res.rows.reduce((a, r) => a + BigInt(r.light), 0n));
  expect(res.state.heatOut).toBe(pre.heatOut + res.heat);
  expect(res.state.lightIn).toBe(pre.lightIn + res.light);
  return want;
}

/** Heat of grinding each pond: Σ (eB-eA)B + (eP-eA)P + (eC-eA)C + E + S over its cells, from the config's ladder. */
function pondHeatOf(s: WorldState): bigint[] {
  const cfg = s.cfg;
  const n = cellCount(cfg);
  return Array.from({ length: cfg.tilesX * cfg.tilesY }, (_, p) => {
    let h = 0n;
    for (const i of pondCells(cfg, p)) {
      const c = (ch: number) => BigInt(s.cells[ch * n + i]);
      h += c(CH.B) * BigInt(cfg.eB - cfg.eA) + c(CH.P) * BigInt(cfg.eP - cfg.eA) + c(CH.C) * BigInt(cfg.eC - cfg.eA) + c(CH.E) + c(CH.S);
    }
    return h;
  });
}

describe("pondDeath and pondExport config keys", () => {
  const ok = presetConfig(pondsSmall, 1, { pondArm: "nat", pondDeath: HALF, pondExport: EXPORT });

  it("are absent from defaultConfig() and every preset, and the ponds identity is unchanged", () => {
    for (const cfg of [defaultConfig(), ...PRESETS.map((p) => presetConfig(p, 1))]) {
      expect("pondDeath" in cfg).toBe(false);
      expect("pondExport" in cfg).toBe(false);
      expect(canonicalConfig(cfg)).not.toMatch(/pondDeath|pondExport/);
    }
    expect(presetIdentity(ponds)).toBe("56526b894cfccf3f");
    expect(presetIdentity(pondsSmall)).toBe("eb17008775286308");
  });

  it("accept nat and shuf with both keys in range", () => {
    for (const pondArm of ["nat", "shuf"] as const) {
      expect(validateConfig({ ...ok, pondArm })).toEqual([]);
      for (const pondDeath of [1, 65_536]) expect(validateConfig({ ...ok, pondArm, pondDeath })).toEqual([]);
      for (const pondExport of [1, 32]) expect(validateConfig({ ...ok, pondArm, pondExport })).toEqual([]);
    }
    expect(validateConfig(presetConfig(ponds, 1, { pondArm: "shuf", pondDeath: HALF, pondExport: EXPORT }))).toEqual([]);
  });

  it("reject a missing key under nat and shuf", () => {
    for (const pondArm of ["nat", "shuf"] as const) {
      const { pondDeath: _d, ...noDeath } = { ...ok, pondArm };
      expect(validateConfig(noDeath)).toEqual(["pondDeath is required when pondArm is nat or shuf"]);
      const { pondExport: _e, ...noExport } = { ...ok, pondArm };
      expect(validateConfig(noExport)).toEqual(["pondExport is required when pondArm is nat or shuf"]);
      const { pondDeath: _d2, pondExport: _e2, ...neither } = { ...ok, pondArm };
      expect(validateConfig(neither)).toHaveLength(2);
    }
  });

  it("reject out-of-range and non-integer values", () => {
    for (const pondDeath of [0, 65_537, -1, 0.5, "1" as never]) expect(validateConfig({ ...ok, pondDeath })).toEqual(["pondDeath must be an integer in 1..65536"]);
    for (const pondExport of [0, 33, -1, 28.5, "28" as never]) expect(validateConfig({ ...ok, pondExport })).toEqual(["pondExport must be an integer in 1..32"]);
  });

  it("reject either key under scaf, rand, cont and without a pond cycle", () => {
    for (const pondArm of ["scaf", "rand", "cont"] as const) {
      expect(validateConfig({ ...ok, pondArm })).toEqual(["pondDeath may be set only when pondArm is nat or shuf", "pondExport may be set only when pondArm is nat or shuf"]);
      expect(validateConfig({ ...ok, pondArm, pondExport: undefined })).toEqual(["pondDeath may be set only when pondArm is nat or shuf"]);
      expect(validateConfig({ ...ok, pondArm, pondDeath: undefined })).toEqual(["pondExport may be set only when pondArm is nat or shuf"]);
    }
    const flat = defaultConfig({ tileW: 64, tileH: 64, tilesX: 2, tilesY: 2 });
    expect(validateConfig({ ...flat, pondDeath: HALF })).toEqual(["pondDeath may be set only when pondArm is nat or shuf"]);
    expect(validateConfig({ ...flat, pondExport: EXPORT })).toEqual(["pondExport may be set only when pondArm is nat or shuf"]);
    // nat without a pond cycle is also refused (the three pond keys go together).
    expect(validateConfig({ ...flat, pondArm: "nat", pondDeath: HALF, pondExport: EXPORT })).toEqual(["pondPeriod, pondK and pondArm must be set together"]);
  });
});

describe("export zone", () => {
  it("exportDistance is the torus Chebyshev distance from (32, 32)", () => {
    expect(exportDistance(32, 32)).toBe(0);
    expect(exportDistance(4, 32)).toBe(28);
    expect(exportDistance(5, 32)).toBe(27);
    expect(exportDistance(60, 32)).toBe(28);
    expect(exportDistance(59, 32)).toBe(27);
    expect(exportDistance(63, 32)).toBe(31);
    expect(exportDistance(0, 0)).toBe(32);
    expect(exportDistance(0, 32)).toBe(32);
    expect(exportDistance(10, 40)).toBe(22);
    expect(exportDistance(50, 50)).toBe(18);
    for (let x = 0; x < 64; x++) for (let y = 0; y < 64; y++) expect(exportDistance(x, y)).toBe(Math.max(Math.min(Math.abs(x - 32), 64 - Math.abs(x - 32)), Math.min(Math.abs(y - 32), 64 - Math.abs(y - 32))));
  });

  it("holds 1,071 cells at threshold 28: x or y in {0..4, 60..63}", () => {
    let count = 0;
    for (let y = 0; y < 64; y++)
      for (let x = 0; x < 64; x++) {
        const edge = (v: number) => v <= 4 || v >= 60;
        expect(exportDistance(x, y) >= 28).toBe(edge(x) || edge(y));
        if (exportDistance(x, y) >= EXPORT) count++;
      }
    expect(count).toBe(1071);
    expect(count / 4096).toBeCloseTo(0.261, 3);
  });

  it("pondExportMasses sums B+P over zone cells at or above 48 only, per pond", () => {
    const s = garden();
    expect(pondExportMasses(s, EXPORT)).toEqual([60 + 120, 48, 0, 0]);
    // The interior cells, dust (47) and a zone cell just inside the boundary (x = 5) never count.
    plant(s, 3, 5, 5, { B: 90 });
    plant(s, 3, 4, 50, { B: 30, P: 17 }); // 47
    expect(pondExportMasses(s, EXPORT)).toEqual([180, 48, 0, 0]);
    plant(s, 3, 4, 50, { B: 30, P: 18 }); // 48
    plant(s, 3, 63, 0, { P: 100 });
    expect(pondExportMasses(s, EXPORT)).toEqual([180, 48, 0, 148]);
    // A smaller threshold widens the zone.
    expect(pondExportMasses(s, 27)[3]).toBe(148 + 90);
    expect(() => pondExportMasses(s, -1)).toThrow();
    expect(() => pondExportMasses(s, 1.5)).toThrow();
    expect(() => pondExportMasses(buildWorld(defaultConfig({ tileW: 32, tileH: 32, tilesX: 2, tilesY: 2 }), { nutrient: 1, founders: [] }), EXPORT)).toThrow(/64x64/);
  });

  it("drawExportCentre agrees with drawPacketCentre when the zone is the whole tile", () => {
    const s = garden();
    for (let p = 0; p < 4; p++)
      for (let b = 0; b < 40; b++) expect(drawExportCentre(s, p, 0, 7, b, p + 1)).toBe(drawPacketCentre(s, p, 7, b, p + 1));
  });

  it("drawExportCentre draws only zone cells, keyed by purposes 3 and 4, proportionally to B+P", () => {
    const s = garden();
    const a = cellIdx(s.cfg, 0, 2, 10);
    const c = cellIdx(s.cfg, 0, 62, 40);
    const seen = new Map<number, number>();
    for (let b = 0; b < 4000; b++) {
      const cell = drawExportCentre(s, 0, EXPORT, 7, b, 3)!;
      seen.set(cell, (seen.get(cell) ?? 0) + 1);
      // The draw is weightedPick over the two eligible zone cells in raster order (60, then 120).
      expect(cell).toBe(weightedPick(randomKey(7, b, 3, 3), randomKey(7, b, 3, 4), 180) < 60 ? a : c);
    }
    expect([...seen.keys()].sort()).toEqual([a, c].sort());
    expect(seen.get(a)! / 4000).toBeGreaterThan(0.28);
    expect(seen.get(a)! / 4000).toBeLessThan(0.38);
    // The interior cell (B+P 540) is heavier but outside the zone: never drawn by the export draw, often by the packet draw.
    expect(drawPacketCentre(s, 0, 7, 0, 3)).not.toBeNull();
  });

  it("drawExportCentre is null for a pond with no eligible zone cell, whatever its interior holds", () => {
    const s = garden();
    expect(drawExportCentre(s, 2, EXPORT, 7, 1, 0)).toBeNull();
    expect(drawExportCentre(s, 3, EXPORT, 7, 1, 0)).toBeNull();
    expect(drawExportCentre(s, 2, 0, 7, 1, 0)).not.toBeNull();
    // Dust in the zone is not eligible.
    expect(drawExportCentre(s, 1, EXPORT, 7, 1, 0)).toBe(cellIdx(s.cfg, 1, 0, 0));
    plant(s, 1, 0, 0, { B: 0 });
    expect(drawExportCentre(s, 1, EXPORT, 7, 1, 0)).toBeNull();
  });
});

describe("applyCurrentCycle", () => {
  it("matches the oracle and closes matter and the ledger, for both arms, over many boundaries and death rates", () => {
    const pre = garden();
    const Mr = pondMatter(pre);
    let dying = 0;
    let landed = 0;
    for (const arm of ["nat", "shuf"] as const) {
      for (const death of [1, 16384, HALF, 65_536]) {
        for (let b = 1; b <= 8; b++) {
          const res = applyCurrentCycle(pre, b, arm, K, death, EXPORT, Mr);
          checkCycle(pre, res, b, arm, death);
          dying += res.rows.filter((r) => r.died === 1).length;
          landed += res.donors.length;
        }
      }
    }
    expect(dying).toBeGreaterThan(40);
    expect(landed).toBeGreaterThan(40);
  });

  it("is pure: pre is not mutated and the same inputs give the same result", () => {
    const pre = garden();
    const Mr = pondMatter(pre);
    const snap = cloned(pre);
    const a = applyCurrentCycle(pre, 3, "nat", K, HALF, EXPORT, Mr);
    const b = applyCurrentCycle(pre, 3, "nat", K, HALF, EXPORT, Mr);
    expect(pre.cells).toEqual(snap.cells);
    expect(pre.genome).toEqual(snap.genome);
    expect([pre.heatOut, pre.lightIn, pre.step]).toEqual([snap.heatOut, snap.lightIn, snap.step]);
    expect(stateHash(a.state)).toBe(stateHash(b.state));
    expect(JSON.stringify([a.rows, a.heat.toString(), a.light.toString(), a.ended, a.donors])).toBe(JSON.stringify([b.rows, b.heat.toString(), b.light.toString(), b.ended, b.donors]));
    expect(a.state.cells).not.toBe(pre.cells);
    // The cycle index and the seed are in the keys.
    expect(stateHash(applyCurrentCycle(pre, 4, "nat", K, 65_536, EXPORT, Mr).state)).not.toBe(stateHash(applyCurrentCycle(pre, 5, "nat", K, 65_536, EXPORT, Mr).state));
    const other = garden(8);
    expect(stateHash(applyCurrentCycle(other, 4, "nat", K, 65_536, EXPORT, Mr).state)).not.toBe(stateHash(applyCurrentCycle(pre, 4, "nat", K, 65_536, EXPORT, Mr).state));
  });

  it("leaves survivors bit for bit, in some boundaries with survivors and dying ponds together", () => {
    const pre = garden();
    const Mr = pondMatter(pre);
    let mixed = 0;
    for (let b = 1; b <= 30; b++) {
      const res = applyCurrentCycle(pre, b, b % 2 ? "nat" : "shuf", K, HALF, EXPORT, Mr);
      const dead = res.rows.filter((r) => r.died === 1).length;
      if (dead > 0 && dead < 4) mixed++;
      // Survivors keep every channel and genome word; the dying keep nothing of their own.
      for (const row of res.rows) {
        const cells = pondCells(pre.cfg, row.recipient);
        if (row.died === 0) expect(differing(pre, res.state, cells)).toBe(0);
        else expect(cells.some((i) => pre.cells[CH.C * cellCount(pre.cfg) + i] > 0 && res.state.cells[CH.C * cellCount(pre.cfg) + i] > 0)).toBe(false);
      }
    }
    expect(mixed).toBeGreaterThan(5);
  });

  it("kills every pond at pondDeath 65,536, and unoccupied ponds at any rate; death frequency follows pondDeath/65,536", () => {
    const pre = garden();
    const Mr = pondMatter(pre);
    for (let b = 1; b <= 20; b++) {
      expect(applyCurrentCycle(pre, b, "nat", K, 65_536, EXPORT, Mr).rows.map((r) => r.died)).toEqual([1, 1, 1, 1]);
      // At the smallest rate the occupied ponds all live (their keys are above 65,536 in every one of these draws) and the empty one dies.
      const rows = applyCurrentCycle(pre, b, "shuf", K, 1, EXPORT, Mr).rows;
      expect(rows[3].died).toBe(1);
      expect(rows[3].donor).not.toBe(-2);
    }
    // Frequency over many (b, p): four occupied ponds, rate 1/4.
    const full = worldOf(2, 99);
    for (let p = 0; p < 4; p++) plant(full, p, 2, 2, { B: 100 });
    const Mf = pondMatter(full);
    let died = 0;
    const draws = 400;
    for (let b = 1; b <= draws; b++) died += applyCurrentCycle(full, b, "nat", K, 16384, EXPORT, Mf).rows.filter((r) => r.died === 1).length;
    expect(died / (4 * draws)).toBeGreaterThan(0.25 - 0.05);
    expect(died / (4 * draws)).toBeLessThan(0.25 + 0.05);
    // The death test is exactly the spec's: key < death * 65,536.
    for (let b = 1; b <= 40; b++) {
      const rows = applyCurrentCycle(full, b, "nat", K, 16384, EXPORT, Mf).rows;
      expect(rows.map((r) => r.died)).toEqual([0, 1, 2, 3].map((p) => (randomKey(99, b, p, 12) < 16384 * 65536 ? 1 : 0)));
    }
  });

  it("nat's weights are the export masses; shuf deals the same multiset to the exporting ponds", () => {
    const pre = worldOf(2, 5);
    // Distinct export masses in all four ponds.
    plant(pre, 0, 1, 1, { B: 100, lin: 1 });
    plant(pre, 1, 2, 2, { B: 200, lin: 2 });
    plant(pre, 2, 3, 3, { B: 300, lin: 3 });
    plant(pre, 3, 62, 62, { B: 400, lin: 4 });
    const Mr = pondMatter(pre);
    const dealt = new Set<string>();
    for (let b = 1; b <= 40; b++) {
      const nat = applyCurrentCycle(pre, b, "nat", K, 65_536, EXPORT, Mr);
      expect(nat.rows.map((r) => r.weight)).toEqual([100, 200, 300, 400]);
      expect(nat.rows.map((r) => r.exportMass)).toEqual([100, 200, 300, 400]);
      const shuf = applyCurrentCycle(pre, b, "shuf", K, 65_536, EXPORT, Mr);
      expect(shuf.rows.map((r) => r.exportMass)).toEqual([100, 200, 300, 400]);
      expect(shuf.rows.map((r) => r.weight).sort((x, y) => x! - y!)).toEqual([100, 200, 300, 400]);
      dealt.add(shuf.rows.map((r) => r.weight).join());
      checkCycle(pre, nat, b, "nat", 65_536);
      checkCycle(pre, shuf, b, "shuf", 65_536);
    }
    // 24 permutations exist; 40 boundaries deal several of them, and not always the identity.
    expect(dealt.size).toBeGreaterThan(4);
    // The order is by ascending (key, pond): the pond with the smallest key gets the smallest value.
    const key = (p: number) => randomKey(5, 1, p, 1);
    const smallest = [0, 1, 2, 3].sort((p, q) => key(p) - key(q) || p - q)[0];
    expect(applyCurrentCycle(pre, 1, "shuf", K, 65_536, EXPORT, Mr).rows[smallest].weight).toBe(100);
  });

  it("shuf equals nat when one pond exports", () => {
    const pre = garden();
    // Only pond 1 exports: remove pond 0's zone mass.
    plant(pre, 0, 2, 10, { B: 0 });
    plant(pre, 0, 62, 40, { B: 0, P: 0 });
    const Mr = pondMatter(pre);
    expect(pondExportMasses(pre, EXPORT)).toEqual([0, 48, 0, 0]);
    for (let b = 1; b <= 10; b++) {
      for (const death of [HALF, 65_536]) {
        const nat = applyCurrentCycle(pre, b, "nat", K, death, EXPORT, Mr);
        const shuf = applyCurrentCycle(pre, b, "shuf", K, death, EXPORT, Mr);
        expect(stateHash(shuf.state)).toBe(stateHash(nat.state));
        expect(JSON.stringify(shuf.rows)).toBe(JSON.stringify(nat.rows));
        expect(shuf.donors).toEqual(nat.donors);
        expect(shuf.ended).toBe(nat.ended);
      }
    }
  });

  it("draws donors in proportion to their weight, allowing self-donation and dying donors", () => {
    const pre = worldOf(2, 21);
    plant(pre, 1, 2, 2, { B: 100, lin: 1 });
    plant(pre, 2, 60, 5, { B: 300, lin: 2 });
    const Mr = pondMatter(pre);
    const donated = [0, 0, 0, 0];
    let self = 0;
    let dyingDonor = 0;
    const draws = 300;
    for (let b = 1; b <= draws; b++) {
      const res = applyCurrentCycle(pre, b, "nat", K, 65_536, EXPORT, Mr);
      for (const row of res.rows) {
        donated[row.donor]++;
        if (row.donor === row.recipient) self++;
        if (res.rows[row.donor].died === 1) dyingDonor++;
      }
    }
    // Four recipients per boundary, donor probabilities 1/4 and 3/4 over ponds 1 and 2.
    expect(donated[0] + donated[3]).toBe(0);
    expect(donated[1] + donated[2]).toBe(4 * draws);
    expect(donated[1] / (4 * draws)).toBeGreaterThan(0.25 - 0.05);
    expect(donated[1] / (4 * draws)).toBeLessThan(0.25 + 0.05);
    expect(self).toBeGreaterThan(0);
    expect(dyingDonor).toBe(4 * draws); // everyone dies at 65,536, so every donor is dying
  });

  it("with no export anywhere refills the dying ponds with A only (donor -1) and survivors untouched", () => {
    const pre = worldOf(2, 3);
    plant(pre, 0, 30, 30, { B: 500, E: 6, lin: 1 }); // occupied, interior only
    plant(pre, 1, 31, 31, { B: 400, C: 3, lin: 2 });
    plant(pre, 2, 3, 3, { B: 47, lin: 3 }); // dust, in the zone
    const Mr = pondMatter(pre);
    expect(pondExportMasses(pre, EXPORT)).toEqual([0, 0, 0, 0]);
    for (const arm of ["nat", "shuf"] as const) {
      const all = applyCurrentCycle(pre, 2, arm, K, 65_536, EXPORT, Mr);
      checkCycle(pre, all, 2, arm, 65_536);
      expect(all.rows.map((r) => r.donor)).toEqual([-1, -1, -1, -1]);
      expect(all.donors).toEqual([]);
      expect(all.light).toBe(0n);
      expect(all.heat).toBeGreaterThan(0n);
      expect(all.ended).toBe(true);
      expect(all.rows.map((r) => r.weight)).toEqual([0, 0, 0, 0]);
      // Mixed: death 1 leaves the occupied ponds alone; the empty ones die with donor -1.
      const mixed = applyCurrentCycle(pre, 2, arm, K, 1, EXPORT, Mr);
      checkCycle(pre, mixed, 2, arm, 1);
      expect(mixed.rows.map((r) => r.donor)).toEqual([-2, -2, -1, -1]);
      expect(mixed.ended).toBe(false);
    }
  });

  it("ends when no pond is occupied afterwards, including a packet below the support threshold", () => {
    const pre = worldOf(2, 4);
    // One exporting pond whose zone cell is 48: an 8 x 8 window around it holds only that cell above dust.
    plant(pre, 0, 0, 0, { B: 48, lin: 1 });
    const Mr = pondMatter(pre);
    const res = applyCurrentCycle(pre, 1, "nat", K, 65_536, EXPORT, Mr);
    checkCycle(pre, res, 1, "nat", 65_536);
    // The landed cell has B+P = 48: occupied, so the history goes on.
    expect(res.ended).toBe(false);
    expect(pondTraits(res.state).every((t) => t === 48)).toBe(true);
    // Everyone dies, nobody exports: ended.
    const none = worldOf(2, 4);
    plant(none, 0, 30, 30, { B: 90 });
    expect(applyCurrentCycle(none, 1, "nat", K, 65_536, EXPORT, pondMatter(none)).ended).toBe(true);
  });

  it("truncates a packet to the recipient's matter exactly as v1's landing does", () => {
    const pre = worldOf(2, 6);
    // Pond 0 holds 9,000 in every cell of x in 0..4: any k = 8 window about a zone centre holds at least 4 such columns.
    for (let y = 0; y < 64; y++) for (let x = 0; x <= 4; x++) plant(pre, 0, x, y, { B: 9000, E: 1, lin: 5 });
    const Mr = pondMatter(pre);
    let truncated = 0;
    for (let b = 1; b <= 12; b++) {
      const res = applyCurrentCycle(pre, b, "nat", K, 65_536, EXPORT, Mr);
      checkCycle(pre, res, b, "nat", 65_536);
      truncated += res.rows.filter((r) => r.truncated === 1).length;
      for (const row of res.rows) {
        expect(row.retMass).toBeLessThanOrEqual(Mr[row.recipient]);
        // Pond 0 itself holds the heavy cells, so its own matter is large enough for any packet.
        if (row.recipient > 0) expect(row.truncated).toBe(1);
      }
    }
    expect(truncated).toBeGreaterThan(0);
  });

  it("books light for the landed packet and heat for the dying ponds only", () => {
    const pre = garden();
    const Mr = pondMatter(pre);
    const heats = pondHeatOf(pre);
    for (let b = 1; b <= 12; b++) {
      const res = applyCurrentCycle(pre, b, "nat", K, HALF, EXPORT, Mr);
      for (const row of res.rows) {
        expect(row.heat).toBe(row.died ? heats[row.recipient].toString() : "0");
        if (!row.died) expect(row.light).toBe("0");
        else if (row.donor >= 0) {
          const cfg = pre.cfg;
          const n = cellCount(cfg);
          const dB = BigInt(cfg.eB - cfg.eA), dP = BigInt(cfg.eP - cfg.eA);
          let light = 0n;
          for (const i of pondCells(cfg, row.recipient)) light += BigInt(res.state.cells[CH.B * n + i]) * dB + BigInt(res.state.cells[CH.P * n + i]) * dP + BigInt(res.state.cells[CH.E * n + i]);
          expect(row.light).toBe(light.toString());
        }
      }
      assertConserved(res.state, totalsOf(pre.cfg, pre.cells).matter, ledgerEnergy(pre));
    }
  });

  it("rows: every column in HUNT_POND_COLUMNS order, sentinels, and the census when given", () => {
    const pre = garden();
    const Mr = pondMatter(pre);
    const census = (s: WorldState) => ({ individuals: pondTraits(s).map((t, p) => 10 * (p + 1) + (t > 0 ? 1 : 0)), lineages: [5, 6, 7, 8] });
    // recipientLineages is counted from the snapshot (distinct lineage ids among cells with B+P >= 48), not taken from the census.
    const lineageCounts = [3, 2, 1, 0];
    for (let b = 1; b <= 6; b++) {
      const res = applyCurrentCycle(pre, b, "nat", K, HALF, EXPORT, Mr, census);
      for (const row of res.rows) {
        expect(Object.keys(row)).toEqual([...HUNT_POND_COLUMNS]);
        expect(row.recipientIndividuals).toBe(10 * (row.recipient + 1) + (pondTraits(pre)[row.recipient] > 0 ? 1 : 0));
        expect(row.recipientLineages).toBe(lineageCounts[row.recipient]);
        if (row.died === 0) {
          expect(row.donor).toBe(-2);
          expect(row.donorTrait).toBe(0);
        } else if (row.donor >= 0) {
          expect(row.cx).toBeGreaterThanOrEqual(0);
          expect(row.donorTrait).toBe(pondTraits(pre)[row.donor]);
        }
      }
      expect(applyCurrentCycle(pre, b, "nat", K, HALF, EXPORT, Mr).rows.every((r) => r.recipientIndividuals === -1)).toBe(true);
    }
    // v1 rows carry no hunt columns.
    expect(Object.keys(applyPondCycle(pre, 1, "scaf", K, Mr).rows[0])).toEqual([...POND_COLUMNS]);
    expect(Object.keys(contRows(pre, 1)[0])).toEqual([...POND_COLUMNS]);
    expect(HUNT_POND_COLUMNS.slice(0, POND_COLUMNS.length)).toEqual([...POND_COLUMNS]);
    expect(HUNT_POND_COLUMNS.slice(POND_COLUMNS.length)).toEqual(["died", "exportMass", "weight"]);
  });

  it("refuses an unknown arm, out-of-range keys and a pond that does not hold Mr", () => {
    const pre = garden();
    const Mr = pondMatter(pre);
    expect(() => applyCurrentCycle(pre, 1, "scaf" as never, K, HALF, EXPORT, Mr)).toThrow(/nat or shuf/);
    for (const death of [0, 65_537, 1.5]) expect(() => applyCurrentCycle(pre, 1, "nat", K, death, EXPORT, Mr)).toThrow(/pondDeath/);
    for (const threshold of [0, 33, 2.5]) expect(() => applyCurrentCycle(pre, 1, "nat", K, HALF, threshold, Mr)).toThrow(/pondExport/);
    expect(() => applyCurrentCycle(pre, 1, "nat", K, HALF, EXPORT, Mr.slice(1))).toThrow(/Mr has 3 ponds/);
    expect(() => applyCurrentCycle(pre, 1, "nat", K, HALF, EXPORT, [Mr[0] + 1, ...Mr.slice(1)])).toThrow(/pond 0 holds matter/);
    expect(() => applyCurrentCycle(buildWorld(defaultConfig({ tileW: 32, tileH: 32, tilesX: 2, tilesY: 2 }), { nutrient: 1, founders: [] }), 1, "nat", K, HALF, EXPORT, [0, 0, 0, 0])).toThrow(/64x64/);
  });

  it("runs on a larger grid: 16 ponds, a cloned ancestor pond each", () => {
    const cfg = presetConfig(pondsSmall, 4, { tilesX: 4, tilesY: 4, mutRate: 0 });
    const pre = buildWorld(cfg, { nutrient: 32, founders: [] });
    for (let p = 0; p < 16; p++) {
      for (let y = 0; y < 64; y += 9) plant(pre, p, (3 + 7 * p + y) % 64, y, { B: 60 + 7 * p, E: p, lin: p + 1 });
    }
    const Mr = pondMatter(pre);
    for (const arm of ["nat", "shuf"] as const) {
      for (let b = 1; b <= 3; b++) checkCycle(pre, applyCurrentCycle(pre, b, arm, K, HALF, EXPORT, Mr), b, arm, HALF);
    }
  });

  it("other packet sizes and thresholds land by the same rules", () => {
    const pre = garden();
    const Mr = pondMatter(pre);
    for (const [k, threshold] of [[1, EXPORT], [5, 20], [8, 32], [3, 1]] as const) {
      for (let b = 1; b <= 4; b++) checkCycle(pre, applyCurrentCycle(pre, b, "nat", k, HALF, threshold, Mr), b, "nat", HALF, threshold, k);
    }
  });
});

describe("v1 outputs are unchanged", () => {
  /** A seeded scatter of cells over a crafted world: some dense (to truncate), with genomes, energy, waste and signal. */
  function scattered(side: number, seed: number, density: number, heavy: boolean): WorldState {
    const cfg = defaultConfig({ ruleVersion: 1, tileW: 64, tileH: 64, tilesX: side, tilesY: side, seed, mutRate: 0 });
    const s = buildWorld(cfg, { nutrient: 32, founders: [] });
    const n = cellCount(cfg);
    let state = (seed * 7919) >>> 0;
    const rnd = () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < n; i++) {
      const pond0 = i % worldW(cfg) < 64 && Math.floor(i / worldW(cfg)) < 64;
      if (!(heavy ? !pond0 && rnd() < 0.9 : rnd() < density)) continue;
      s.cells[CH.B * n + i] = Math.floor(rnd() * (heavy ? 8000 : 90));
      s.cells[CH.P * n + i] = Math.floor(rnd() * 40);
      s.cells[CH.E * n + i] = Math.floor(rnd() * 50);
      s.cells[CH.S * n + i] = Math.floor(rnd() * 5);
      s.cells[CH.C * n + i] = Math.floor(rnd() * 5);
      for (let g = 0; g < GENOME_CHANNELS; g++) s.genome[g * n + i] = Math.floor(rnd() * 4294967296) >>> 0;
    }
    return s;
  }

  it("applyPondCycle, contRows and drawPacketCentre give the digest captured before the current existed", () => {
    const sha = (t: string) => createHash("sha256").update(t).digest("hex").slice(0, 16);
    const out: Record<string, string> = {};
    let truncated = 0;
    for (const [side, seed, density, heavy] of [[2, 3, 0.05, false], [3, 9, 0.2, false], [2, 5, 0.1, true], [4, 13, 0.02, false]] as const) {
      const s = scattered(side, seed, density, heavy);
      const Mr = pondMatter(s);
      const census = (st: WorldState) => ({ individuals: pondMatter(st).map((_, p) => p + 1), lineages: pondMatter(st).map((_, p) => 2 * p) });
      for (const arm of ["scaf", "rand"] as const) {
        for (const k of [8, 5]) {
          for (let b = 1; b <= 4; b++) {
            const r = applyPondCycle(s, b, arm, k, Mr, b % 2 ? census : undefined);
            truncated += r.rows.filter((x) => x.truncated).length;
            const digest = JSON.stringify([r.rows, r.heat.toString(), r.light.toString(), r.ended, r.donors]);
            out[`${side}-${arm}-${k}-${b}`] = `${stateHash(r.state)}:${digest.length}:${sha(digest)}`;
          }
        }
      }
      out[`${side}-cont`] = sha(JSON.stringify(contRows(s, 3, census)));
      for (let p = 0; p < side * side; p++) for (let b = 0; b < 3; b++) out[`${side}-draw-${p}-${b}`] = String(drawPacketCentre(s, p, seed, b, p ^ b));
    }
    expect(truncated).toBe(8);
    expect(Object.keys(out)).toHaveLength(138);
    expect(sha(JSON.stringify(out))).toBe("ffee08f002933c71");
  });
});
