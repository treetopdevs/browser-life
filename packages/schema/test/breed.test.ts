// The breeder (wild sandbox): the optional pondScore key and its validation, the named scores and their
// combinations, arm breed of applyPondCycle with its controls (arms scaf and rand with a score), and donors picked
// by hand. Everything v1 writes without pondScore must stay as it was; packages/schema/test/ponds.test.ts pins that
// side.
import { describe, expect, it } from "vitest";
import {
  BREED_POND_COLUMNS,
  CH,
  G,
  POND_COLUMNS,
  POND_SCORES,
  POND_TERMS,
  PRESETS,
  applyPondCycle,
  assertConserved,
  breedPondColumns,
  canonicalConfig,
  cellCount,
  cloneState,
  decodeCheckpoint,
  defaultConfig,
  encodeCheckpoint,
  initWorld,
  ledgerEnergy,
  packetWindow,
  pondBodies,
  pondDrives,
  pondExportMasses,
  pondMatter,
  pondScoreTerms,
  pondScores,
  pondSeeds,
  pondTermValues,
  pondTraits,
  presetConfig,
  randomKey,
  stateHash,
  totalsOf,
  validateConfig,
  worldW,
  worstRanks,
  type PondScore,
  type WorldConfig,
  type WorldState,
} from "@bl/schema";

const pondsSmall = PRESETS.find((p) => p.id === "ponds-small")!;
const ponds = PRESETS.find((p) => p.id === "ponds")!;
const start = (preset = pondsSmall, seed = 1): WorldState => initWorld(presetConfig(preset, seed), preset.init);

/** World cell index of tile-local (x, y) in `pond`. */
function cellOf(cfg: WorldConfig, pond: number, x: number, y: number): number {
  const tx = pond % cfg.tilesX;
  return (((pond - tx) / cfg.tilesX) * cfg.tileH + y) * worldW(cfg) + tx * cfg.tileW + x;
}

/** Gives every living cell of `pond` motility gain `gain` and the motility output (mx, my), in place. */
function drive(s: WorldState, pond: number, gain: number, mx: number, my: number): void {
  const n = cellCount(s.cfg);
  for (let y = 0; y < 64; y++)
    for (let x = 0; x < 64; x++) {
      const i = cellOf(s.cfg, pond, x, y);
      if ((s.genome[G.LIN_HI * n + i] | s.genome[G.LIN_LO * n + i]) === 0) continue;
      s.genome[G.PARAM1 * n + i] = ((s.genome[G.PARAM1 * n + i] & 0xffffff00) | gain) >>> 0;
      s.cells[CH.MOT * n + i] = (mx + 128) | ((my + 128) << 8);
    }
}

/** Moves every pond's bound mass back to nutrient, in place: an empty world with each pond's matter unchanged. */
function grind(s: WorldState, only?: number): void {
  const n = cellCount(s.cfg);
  const W = worldW(s.cfg);
  for (let i = 0; i < n; i++) {
    if (only !== undefined && Math.floor(Math.floor(i / W) / 64) * s.cfg.tilesX + Math.floor((i % W) / 64) !== only) continue;
    s.cells[CH.A * n + i] += s.cells[CH.B * n + i] + s.cells[CH.P * n + i];
    s.cells[CH.B * n + i] = 0;
    s.cells[CH.P * n + i] = 0;
  }
}

/** Sets tile-local (x, y) of `pond` to bound mass `m` (as B), taken from the same cell's and then the pond's nutrient. */
function put(s: WorldState, pond: number, x: number, y: number, m: number): void {
  const n = cellCount(s.cfg);
  const i = cellOf(s.cfg, pond, x, y);
  s.cells[CH.B * n + i] += m;
  let owed = m;
  for (let yy = 0; yy < 64 && owed > 0; yy++)
    for (let xx = 0; xx < 64 && owed > 0; xx++) {
      const j = cellOf(s.cfg, pond, xx, yy);
      const take = Math.min(owed, s.cells[CH.A * n + j]);
      s.cells[CH.A * n + j] -= take;
      owed -= take;
    }
  if (owed > 0) throw new Error("put: the pond has too little nutrient");
}

/** `pondSeeds` by its definition: the mass-weighted mean of the packet window's B+P over the eligible centres. */
function seedsByWindow(s: WorldState, k: number): number[] {
  const n = cellCount(s.cfg);
  const bound = (i: number) => s.cells[CH.B * n + i] + s.cells[CH.P * n + i];
  return Array.from({ length: s.cfg.tilesX * s.cfg.tilesY }, (_, pond) => {
    let num = 0n, den = 0n;
    for (let y = 0; y < 64; y++)
      for (let x = 0; x < 64; x++) {
        const c = cellOf(s.cfg, pond, x, y);
        if (bound(c) < 48) continue;
        num += BigInt(bound(c)) * BigInt(packetWindow(s, pond, k, c).reduce((a, i) => a + bound(i), 0));
        den += BigInt(bound(c));
      }
    return den > 0n ? Number(num / den) : 0;
  });
}

describe("pondScore config key", () => {
  const base = presetConfig(pondsSmall, 1);

  it("is absent from defaultConfig() and from the pond presets, so their configs hash as before", () => {
    expect("pondScore" in defaultConfig()).toBe(false);
    expect("pondScore" in presetConfig(pondsSmall, 1)).toBe(false);
    expect("pondScore" in presetConfig(ponds, 1)).toBe(false);
    expect(canonicalConfig(base)).not.toMatch(/pondScore/);
  });

  it("is required by arm breed and allowed with scaf and rand only", () => {
    for (const pondScore of POND_SCORES)
      for (const pondArm of ["breed", "scaf", "rand"] as const) expect(validateConfig({ ...base, pondArm, pondScore })).toEqual([]);
    expect(validateConfig({ ...base, pondArm: "breed" })).toEqual(["pondScore is required when pondArm is breed"]);
    const refused = ["pondScore may be set only when pondArm is breed, scaf or rand"];
    expect(validateConfig({ ...base, pondArm: "cont", pondScore: "drive" })).toEqual(refused);
    expect(validateConfig({ ...base, pondArm: "nat", pondDeath: 32_768, pondExport: 28, pondScore: "drive" })).toEqual(refused);
    const { pondPeriod: _p, pondK: _k, pondArm: _a, ...bare } = base;
    expect(validateConfig({ ...bare, pondScore: "drive" })).toEqual(refused);
  });

  it("rejects an unknown score", () => {
    for (const pondScore of ["", "speed", "DRIVE", 1, "drive+", "+seed", "drive+speed", "drive+drive", "drive + seed", "drive,seed"])
      expect(validateConfig({ ...base, pondArm: "breed", pondScore: pondScore as never })).toEqual(['pondScore must be one of mass, drive, reach, seed, body, or distinct ones joined by "+"']);
  });

  it("takes one term or distinct terms joined by +, in any order", () => {
    expect([...POND_TERMS]).toEqual(["mass", "drive", "reach", "seed", "body"]);
    for (const term of POND_TERMS) expect(pondScoreTerms(term)).toEqual([term]);
    expect(pondScoreTerms("drive+seed+body")).toEqual(["drive", "seed", "body"]);
    expect(pondScoreTerms("body+drive")).toEqual(["body", "drive"]);
    for (const pondScore of ["body+drive", "mass+drive+reach+seed+body"] as PondScore[]) expect(validateConfig({ ...base, pondArm: "breed", pondScore })).toEqual([]);
    for (const bad of ["", "drive+", "drive+drive", "speed", 3, undefined, null])
      expect(() => pondScoreTerms(bad)).toThrow(/pondScore must be one of mass, drive, reach, seed, body, or distinct ones joined by "\+"/);
    // Every score with a condition of its own is valid, and every term has one.
    for (const score of POND_SCORES) expect(pondScoreTerms(score).length).toBeGreaterThan(0);
    for (const term of POND_TERMS) expect(POND_SCORES).toContain(term);
  });

  it("round-trips through the checkpoint codec and enters the state hash", () => {
    const cfg: WorldConfig = { ...base, pondArm: "breed", pondScore: "drive" };
    const s = initWorld(cfg, pondsSmall.init);
    const back = decodeCheckpoint(encodeCheckpoint(s)).state;
    expect(back.cfg.pondArm).toBe("breed");
    expect(back.cfg.pondScore).toBe("drive");
    expect(stateHash(back)).toBe(stateHash(s));
    expect(stateHash(s)).not.toBe(stateHash({ ...s, cfg: { ...cfg, pondScore: "reach" } }));
    expect(stateHash(s)).not.toBe(stateHash({ ...s, cfg: { ...base, pondArm: "rand", pondScore: "drive" } }));
  });
});

describe("pond scores", () => {
  it("drive is 0 for the sessile founders and mass x |motility term| once they move", () => {
    const s = start();
    expect(pondDrives(s)).toEqual([0, 0, 0, 0]);
    const traits = pondTraits(s);
    // gain 12, output (32, 0): trunc(32 * 12 / 256) = 1 unit of 1/64 cell per step, the hand-built follower's.
    drive(s, 1, 12, 32, 0);
    expect(pondDrives(s)).toEqual([0, traits[1], 0, 0]);
    // Both axes, one negative: |trunc(-100 * 200 / 256)| + |trunc(64 * 200 / 256)| = 78 + 50.
    drive(s, 2, 200, -100, 64);
    expect(pondDrives(s)).toEqual([0, traits[1], 128 * traits[2], 0]);
  });

  it("drive truncates toward zero as flow does, and reads the gain byte only", () => {
    const s = start();
    const traits = pondTraits(s);
    // -128 * 3 / 256 = -1.5 -> -1 (floor would give -2); 127 * 3 / 256 = 1.49 -> 1.
    drive(s, 0, 3, -128, 127);
    expect(pondDrives(s)[0]).toBe(2 * traits[0]);
    // Below one unit the term is 0 on both axes: 21 * 12 / 256 = 0.98.
    drive(s, 3, 12, 21, -21);
    expect(pondDrives(s)[3]).toBe(0);
    // Ring bytes of PARAM1 (bytes 1..3, the cells sandbox's kernel shape) are not gain.
    const n = cellCount(s.cfg);
    for (let i = 0; i < n; i++) s.genome[G.PARAM1 * n + i] = (s.genome[G.PARAM1 * n + i] | 0x7f7f7f00) >>> 0;
    expect(pondDrives(s)[0]).toBe(2 * traits[0]);
  });

  it("drive counts only living cells at the census support threshold, and nothing with motility off", () => {
    const s = start();
    drive(s, 0, 12, 32, 0);
    const n = cellCount(s.cfg);
    const full = pondDrives(s)[0];
    // A living cell thinned below B+P = 48 leaves the sum; so does one whose lineage is cleared.
    const cells: number[] = [];
    for (let y = 0; y < 64 && cells.length < 2; y++)
      for (let x = 0; x < 64 && cells.length < 2; x++) {
        const i = cellOf(s.cfg, 0, x, y);
        if (s.cells[CH.B * n + i] + s.cells[CH.P * n + i] >= 48) cells.push(i);
      }
    const [thin, orphan] = cells;
    const mThin = s.cells[CH.B * n + thin] + s.cells[CH.P * n + thin], mOrphan = s.cells[CH.B * n + orphan] + s.cells[CH.P * n + orphan];
    s.cells[CH.B * n + thin] = 47;
    s.cells[CH.P * n + thin] = 0;
    s.genome[G.LIN_HI * n + orphan] = 0;
    s.genome[G.LIN_LO * n + orphan] = 0;
    expect(pondDrives(s)[0]).toBe(full - mThin - mOrphan);
    expect(pondDrives({ ...s, cfg: { ...s.cfg, motility: false } })).toEqual([0, 0, 0, 0]);
  });

  it("mass and reach are v1's trait and the hunt's export mass at distance 28", () => {
    const s = start();
    expect(pondScores(s, "mass")).toEqual(pondTraits(s));
    // The founding disc sits at the landing centre, so nothing has reached the edge yet.
    expect(pondScores(s, "reach")).toEqual([0, 0, 0, 0]);
    const n = cellCount(s.cfg);
    s.cells[CH.B * n + cellOf(s.cfg, 2, 3, 40)] = 500; // Chebyshev distance 29 from (32, 32)
    s.cells[CH.B * n + cellOf(s.cfg, 2, 5, 40)] = 500; // distance 27: outside the zone
    expect(pondScores(s, "reach")).toEqual([0, 0, 500, 0]);
    expect(pondScores(s, "reach")).toEqual(pondExportMasses(s, 28));
    drive(s, 1, 12, 32, 0);
    expect(pondScores(s, "drive")).toEqual(pondDrives(s));
    expect(() => pondScores(s, "speed" as never)).toThrow(/pondScore must be one of mass, drive, reach, seed, body/);
  });

  it("seed is the mass-weighted mean of the packet window's bound mass, wrapping inside the pond", () => {
    const s = start();
    grind(s);
    // k = 8 reaches 4 cells back and 3 forward. (0, 0) sees (60..63, 0..3) on each axis, so it holds (63, 63) and the
    // thin cell (2, 2), which is no centre itself; (63, 63) sees (59..63, 0..2) and holds both too.
    put(s, 0, 0, 0, 100);
    put(s, 0, 63, 63, 60);
    put(s, 0, 2, 2, 47);
    // Pond 1: (4, 0) sees (0..7), so it holds (0, 0); (0, 0) stops at x = 3 and does not hold (4, 0).
    put(s, 1, 0, 0, 100);
    put(s, 1, 4, 0, 60);
    // Pond 2's only cell sits beside pond 3's across the tile border: neither window leaves its own pond.
    put(s, 2, 63, 10, 80);
    put(s, 3, 0, 10, 90);
    expect(pondSeeds(s, 8)).toEqual([207, Math.floor((100 * 100 + 60 * 160) / 160), 80, 90]);
    expect(pondSeeds(s, 8)).toEqual(seedsByWindow(s, 8));
    // k = 1 is the cell itself; k = 64 is the whole pond, thin cells included.
    expect(pondSeeds(s, 1)).toEqual([Math.floor((100 * 100 + 60 * 60) / 160), Math.floor((100 * 100 + 60 * 60) / 160), 80, 90]);
    expect(pondSeeds(s, 64)).toEqual([207, 160, 80, 90]);
    expect(() => pondSeeds(s, 0)).toThrow(/packet size k must be in 1\.\.64/);
    expect(() => pondSeeds(s, 65)).toThrow(/packet size k must be in 1\.\.64/);
  });

  it("seed agrees with the packet window on a grown world, for even and odd k, and is 0 for an empty pond", () => {
    const s = start(ponds, 4);
    grind(s, 5);
    for (const k of [8, 5, 1, 13]) {
      const seeds = pondSeeds(s, k);
      expect(seeds).toEqual(seedsByWindow(s, k));
      expect(seeds[5]).toBe(0);
      expect(seeds.filter((x) => x > 0)).toHaveLength(63);
    }
    expect(pondTermValues(s, "seed", 8)).toEqual(pondSeeds(s, 8));
    expect(() => pondTermValues(s, "seed")).toThrow(/pond term seed needs the packet side k/);
    expect(() => pondScores(s, "drive+seed")).toThrow(/pond term seed needs the packet side k/);
  });

  it("body is the size of the body a unit of bound mass sits in, in 1/256 cell", () => {
    const s = start();
    grind(s);
    // Pond 0: one 3 x 2 body of 100 per cell.
    for (const [x, y] of [[10, 10], [11, 10], [12, 10], [10, 11], [11, 11], [12, 11]]) put(s, 0, x, y, 100);
    // Pond 1: the same body and a lone cell of 300: (6 * 600 + 1 * 300) / 900 cells.
    for (const [x, y] of [[10, 10], [11, 10], [12, 10], [10, 11], [11, 11], [12, 11]]) put(s, 1, x, y, 100);
    put(s, 1, 40, 40, 300);
    // Pond 2: cells touching only at a corner are two bodies; a thin cell (47) joins nothing and bridges nothing.
    put(s, 2, 20, 20, 100);
    put(s, 2, 21, 21, 100);
    put(s, 2, 30, 30, 100);
    put(s, 2, 31, 30, 47);
    put(s, 2, 32, 30, 100);
    // Pond 3: one body across the pond's own edges on both axes, and not joined to pond 2's cell beside it.
    put(s, 3, 0, 5, 100);
    put(s, 3, 63, 5, 100);
    put(s, 3, 63, 4, 100);
    put(s, 3, 7, 0, 100);
    put(s, 3, 7, 63, 100);
    put(s, 2, 63, 5, 100);
    expect(pondBodies(s)).toEqual([6 * 256, Math.floor((256 * (6 * 600 + 300)) / 900), 256, Math.floor((256 * (3 * 300 + 2 * 200)) / 500)]);
    expect(pondTermValues(s, "body")).toEqual(pondBodies(s));
    grind(s, 0);
    expect(pondBodies(s)[0]).toBe(0);
  });

  it("a combined score is each pond's worst rank over its terms", () => {
    expect(worstRanks([[5, 5, 0, 9], [1, 2, 3, 4]])).toEqual([0, 1, 0, 3]);
    expect(worstRanks([[7, 7, 7]])).toEqual([0, 0, 0]);
    expect(worstRanks([[3, 1, 2], [3, 1, 2], [30, 10, 20]])).toEqual([2, 0, 1]);
    expect(() => worstRanks([])).toThrow(/at least one term/);
    const s = start(ponds, 3);
    for (let p = 0; p < 64; p++) drive(s, p, 4 * p, 127, 0);
    const drives = pondDrives(s), seeds = pondSeeds(s, 8), bodies = pondBodies(s);
    expect(pondScores(s, "drive+seed+body", 8)).toEqual(worstRanks([drives, seeds, bodies]));
    expect(pondScores(s, "seed+drive", 8)).toEqual(worstRanks([seeds, drives]));
    // One term is its own values, not their ranks.
    expect(pondScores(s, "seed", 8)).toEqual(seeds);
    expect(pondScores(s, "body")).toEqual(bodies);
  });
});

describe("arm breed", () => {
  it("needs a score", () => {
    const pre = start();
    expect(() => applyPondCycle(pre, 1, "breed", 8, pondMatter(pre))).toThrow(/pond arm breed needs pondScore/);
  });

  it("seeds every pond from the pond with the largest score, exactly conserving matter and the ledger", () => {
    for (const winner of [0, 1, 2, 3]) {
      const pre = start();
      drive(pre, winner, 12, 32, 0);
      drive(pre, (winner + 1) % 4, 12, 21, 0); // a gain without a whole unit of movement scores 0
      const before = stateHash(pre);
      const Mr = pondMatter(pre);
      const t0 = totalsOf(pre.cfg, pre.cells);
      const res = applyPondCycle(pre, 1, "breed", 8, Mr, undefined, "drive");
      expect(stateHash(pre)).toBe(before); // pure
      expect(res.donors).toEqual([winner]);
      expect(res.ended).toBe(false);
      expect(res.rows.map((r) => r.donor)).toEqual([winner, winner, winner, winner]);
      expect(pondMatter(res.state)).toEqual(Mr);
      assertConserved(res.state, t0.matter, ledgerEnergy(pre));
      // The packet carries the genome and the motility output, so every pond now holds the winner's drive.
      expect(pondDrives(res.state).every((d) => d > 0)).toBe(true);
      const scores = pondDrives(pre);
      expect(res.rows.map((r) => r.score)).toEqual(scores);
      expect(res.rows.map((r) => r.donorScore)).toEqual([scores[winner], scores[winner], scores[winner], scores[winner]]);
    }
  });

  it("takes the top quarter of 64 ponds, in score order", () => {
    const pre = start(ponds, 3);
    // Distinct scores: pond p moves with gain p (output 127 -> trunc(127 * p / 256) units).
    for (let p = 0; p < 64; p++) drive(pre, p, 4 * p, 127, 0);
    const scores = pondDrives(pre);
    const want = scores.map((s, p) => ({ s, p })).sort((a, b) => b.s - a.s).slice(0, 16).map((e) => e.p);
    expect(new Set(scores.slice(48)).size).toBe(16);
    const res = applyPondCycle(pre, 7, "breed", 8, pondMatter(pre), undefined, "drive");
    expect(res.donors).toEqual(want);
    expect(new Set(res.rows.map((r) => r.donor))).toEqual(new Set(want));
    // Recipients are dealt round the donors, so each donor founds 64 / 16 = 4 ponds.
    for (const d of want) expect(res.rows.filter((r) => r.donor === d)).toHaveLength(4);
  });

  it("is scaf while no pond scores: the same donors and the same world", () => {
    const pre = start(ponds, 5);
    expect(pondDrives(pre).every((d) => d === 0)).toBe(true);
    const Mr = pondMatter(pre);
    const scaf = applyPondCycle(pre, 4, "scaf", 8, Mr);
    const res = applyPondCycle(pre, 4, "breed", 8, Mr, undefined, "drive");
    expect(res.donors).toEqual(scaf.donors);
    expect(stateHash(res.state)).toBe(stateHash(scaf.state));
    // And the same snapshot gives the same cycle.
    expect(stateHash(applyPondCycle(pre, 4, "breed", 8, Mr, undefined, "drive").state)).toBe(stateHash(res.state));
  });

  it("puts every pond that scores ahead of every pond that does not, then fills the quarter by mass as scaf does", () => {
    const pre = start(ponds, 6);
    const movers = [10, 20, 30];
    movers.forEach((p, j) => drive(pre, p, 12 * (j + 1), 127, 0));
    const scores = pondDrives(pre), traits = pondTraits(pre);
    expect(scores.filter((x) => x > 0)).toHaveLength(3);
    const scafOrder = traits
      .map((trait, pond) => ({ pond, trait, key: randomKey(6, 2, pond, 0) }))
      .sort((x, y) => y.trait - x.trait || x.key - y.key || x.pond - y.pond)
      .map((e) => e.pond);
    const res = applyPondCycle(pre, 2, "breed", 8, pondMatter(pre), undefined, "drive");
    expect(res.donors.slice(0, 3)).toEqual([...movers].sort((x, y) => scores[y] - scores[x]));
    expect(res.donors.slice(3)).toEqual(scafOrder.filter((p) => !movers.includes(p)).slice(0, 13));
  });

  it("ranks only occupied ponds: an empty pond never donates, whatever its score would be", () => {
    const pre = start();
    drive(pre, 1, 12, 32, 0);
    const n = cellCount(pre.cfg);
    // Empty pond 1 back to nutrient (matter kept), leaving its genome and motility output in place.
    for (let y = 0; y < 64; y++)
      for (let x = 0; x < 64; x++) {
        const i = cellOf(pre.cfg, 1, x, y);
        pre.cells[CH.A * n + i] += pre.cells[CH.B * n + i] + pre.cells[CH.P * n + i];
        pre.cells[CH.B * n + i] = 0;
        pre.cells[CH.P * n + i] = 0;
      }
    const res = applyPondCycle(pre, 1, "breed", 8, pondMatter(pre), undefined, "drive");
    expect(res.donors).toHaveLength(1);
    expect(res.donors[0]).not.toBe(1);
  });

  it('with score "mass" is scaf exactly', () => {
    for (const seed of [2, 3]) {
      const pre = start(ponds, seed);
      const Mr = pondMatter(pre);
      const scaf = applyPondCycle(pre, 1, "scaf", 8, Mr);
      const breed = applyPondCycle(pre, 1, "breed", 8, Mr, undefined, "mass");
      expect(breed.donors).toEqual(scaf.donors);
      expect(stateHash(breed.state)).toBe(stateHash(scaf.state));
    }
  });
});

describe("arm breed under a combined score", () => {
  /** A 64-pond world in which pond p moves faster the larger p is, and pond `weak` has been thinned to one small body. */
  function world(weak: number): WorldState {
    const pre = start(ponds, 3);
    for (let p = 0; p < 64; p++) drive(pre, p, 4 * p, 127, 0);
    const n = cellCount(pre.cfg);
    const centre = cellOf(pre.cfg, weak, 32, 32);
    const words = Array.from({ length: pre.genome.length / n }, (_, w) => pre.genome[w * n + centre]);
    const mot = pre.cells[CH.MOT * n + centre];
    grind(pre, weak);
    put(pre, weak, 32, 32, 60);
    for (let w = 0; w < words.length; w++) pre.genome[w * n + centre] = words[w];
    pre.cells[CH.MOT * n + centre] = mot;
    return pre;
  }

  it("does not let the fastest pond donate when its packets would be the smallest", () => {
    const pre = world(63);
    const Mr = pondMatter(pre);
    const drives = pondDrives(pre), seeds = pondSeeds(pre, 8);
    // Pond 63 still moves at the top speed per unit of mass, and under drive+seed it is at the bottom of seed.
    expect(drives[63]).toBeGreaterThan(0);
    expect(seeds[63]).toBe(60);
    expect(Math.min(...seeds)).toBe(60);
    const scores = pondScores(pre, "drive+seed", 8);
    expect(scores[63]).toBe(0);
    const res = applyPondCycle(pre, 3, "breed", 8, Mr, undefined, "drive+seed");
    expect(res.donors).toHaveLength(16);
    expect(res.donors).not.toContain(63);
    // The order is the score's, then scaf's (bound mass, then the key of purpose 0).
    const traits = pondTraits(pre);
    const want = scores
      .map((score, pond) => ({ pond, score, trait: traits[pond], key: randomKey(3, 3, pond, 0) }))
      .sort((x, y) => y.score - x.score || y.trait - x.trait || x.key - y.key || x.pond - y.pond)
      .slice(0, 16)
      .map((e) => e.pond);
    expect(res.donors).toEqual(want);
    assertConserved(res.state, totalsOf(pre.cfg, pre.cells).matter, ledgerEnergy(pre));
    expect(pondMatter(res.state)).toEqual(Mr);
  });

  it("writes the rank as the score and each term's value beside it", () => {
    const pre = world(63);
    const Mr = pondMatter(pre);
    const terms = { drive: pondDrives(pre), seed: pondSeeds(pre, 8), body: pondBodies(pre) };
    const scores = worstRanks([terms.drive, terms.seed, terms.body]);
    const res = applyPondCycle(pre, 3, "breed", 8, Mr, undefined, "drive+seed+body");
    for (const row of res.rows) {
      expect(row.score).toBe(scores[row.recipient]);
      expect(row.donorScore).toBe(scores[row.donor]);
      expect([row.drive, row.seed, row.body]).toEqual([terms.drive[row.recipient], terms.seed[row.recipient], terms.body[row.recipient]]);
      expect("mass" in row || "reach" in row).toBe(false);
    }
    // One term writes no term column, and the controls write the same columns as the breeder.
    for (const row of applyPondCycle(pre, 3, "breed", 8, Mr, undefined, "seed").rows) expect("seed" in row || "drive" in row).toBe(false);
    const control = applyPondCycle(pre, 3, "scaf", 8, Mr, undefined, "drive+seed+body");
    expect(control.donors).toEqual(applyPondCycle(pre, 3, "scaf", 8, Mr).donors);
    expect(control.rows.map((r) => [r.score, r.drive, r.seed, r.body])).toEqual(res.rows.map((r) => [r.score, r.drive, r.seed, r.body]));
  });

  it("is scaf while every pond ties on some term", () => {
    const pre = start(ponds, 5);
    expect(pondDrives(pre).every((d) => d === 0)).toBe(true);
    const Mr = pondMatter(pre);
    const scaf = applyPondCycle(pre, 4, "scaf", 8, Mr);
    const res = applyPondCycle(pre, 4, "breed", 8, Mr, undefined, "drive+seed+body");
    expect(res.rows.every((r) => r.score === 0)).toBe(true);
    expect(res.donors).toEqual(scaf.donors);
    expect(stateHash(res.state)).toBe(stateHash(scaf.state));
  });

  it("breedPondColumns adds a column per term of a combined score, in its order", () => {
    for (const term of POND_TERMS) expect(breedPondColumns(term)).toEqual([...BREED_POND_COLUMNS]);
    expect(breedPondColumns("drive+seed+body")).toEqual([...BREED_POND_COLUMNS, "drive", "seed", "body"]);
    expect(breedPondColumns("body+mass")).toEqual([...BREED_POND_COLUMNS, "body", "mass"]);
    expect(() => breedPondColumns("fast" as never)).toThrow(/pondScore must be one of/);
  });
});

describe("donors picked by hand", () => {
  it("replace the arm's donors, in the order given, and recipients take them in turn", () => {
    const pre = start(ponds, 7);
    for (let p = 0; p < 64; p++) drive(pre, p, 4 * p, 127, 0);
    const Mr = pondMatter(pre);
    const before = stateHash(pre);
    const picks = [5, 40, 2];
    for (const arm of ["breed", "scaf", "rand"] as const) {
      const res = applyPondCycle(pre, 2, arm, 8, Mr, undefined, "drive", picks);
      expect(stateHash(pre)).toBe(before);
      expect(res.donors).toEqual(picks);
      expect(res.ended).toBe(false);
      // Recipients in the order of their purpose-2 key take donors 5, 40, 2, 5, ...
      const order = Array.from({ length: 64 }, (_, pond) => ({ pond, key: randomKey(7, 2, pond, 2) })).sort((x, y) => x.key - y.key || x.pond - y.pond);
      order.forEach((r, j) => expect(res.rows[r.pond].donor).toBe(picks[j % 3]));
      expect(pondMatter(res.state)).toEqual(Mr);
      assertConserved(res.state, totalsOf(pre.cfg, pre.cells).matter, ledgerEnergy(pre));
      // The same picks give the same world under every arm: the arm only chooses donors.
      expect(stateHash(res.state)).toBe(stateHash(applyPondCycle(pre, 2, "breed", 8, Mr, undefined, "drive", picks).state));
    }
  });

  it("that are the arm's own donors in its order give the arm's cycle bit for bit", () => {
    const pre = start(ponds, 7);
    for (let p = 0; p < 64; p += 2) drive(pre, p, 4 * p + 4, 127, 0);
    const Mr = pondMatter(pre);
    for (const [arm, score] of [["breed", "drive"], ["breed", "drive+seed+body"], ["scaf", undefined], ["rand", "drive"]] as const) {
      const auto = applyPondCycle(pre, 6, arm, 8, Mr, undefined, score);
      const picked = applyPondCycle(pre, 6, arm, 8, Mr, undefined, score, auto.donors);
      expect(picked.donors).toEqual(auto.donors);
      expect(picked.rows).toEqual(auto.rows);
      expect(stateHash(picked.state)).toBe(stateHash(auto.state));
      // A different order is a different cycle.
      expect(stateHash(applyPondCycle(pre, 6, arm, 8, Mr, undefined, score, [...auto.donors].reverse()).state)).not.toBe(stateHash(auto.state));
    }
  });

  it("may be fewer or more than a quarter of the ponds", () => {
    const pre = start();
    const Mr = pondMatter(pre);
    const one = applyPondCycle(pre, 1, "breed", 8, Mr, undefined, "drive", [3]);
    expect(one.rows.map((r) => r.donor)).toEqual([3, 3, 3, 3]);
    const all = applyPondCycle(pre, 1, "breed", 8, Mr, undefined, "drive", [3, 0, 2, 1]);
    expect(all.donors).toEqual([3, 0, 2, 1]);
    expect([...all.rows.map((r) => r.donor)].sort()).toEqual([0, 1, 2, 3]);
    assertConserved(all.state, totalsOf(pre.cfg, pre.cells).matter, ledgerEnergy(pre));
  });

  it("must be distinct occupied ponds", () => {
    const pre = start();
    grind(pre, 2);
    const Mr = pondMatter(pre);
    const run = (picks: number[]) => () => applyPondCycle(pre, 1, "breed", 8, Mr, undefined, "drive", picks);
    expect(run([])).toThrow(/picks must name at least one pond/);
    expect(run([2])).toThrow(/picked pond 2 is not an occupied pond/);
    expect(run([0, 4])).toThrow(/picked pond 4 is not an occupied pond/);
    expect(run([-1])).toThrow(/picked pond -1 is not an occupied pond/);
    expect(run([1.5])).toThrow(/picked pond 1.5 is not an occupied pond/);
    expect(run([1, 0, 1])).toThrow(/picks repeat a pond: 1, 0, 1/);
    expect(run([1, 0])).not.toThrow();
  });
});

describe("the breeder's controls and v1's arms", () => {
  it("arms scaf and rand with a score choose their own donors and land their own world, and only add the two columns", () => {
    const pre = start(ponds, 9);
    for (let p = 0; p < 64; p += 3) drive(pre, p, 4 * p + 4, 127, 0);
    const Mr = pondMatter(pre);
    const scores = pondDrives(pre);
    for (const arm of ["scaf", "rand"] as const) {
      const plain = applyPondCycle(pre, 2, arm, 8, Mr);
      const scored = applyPondCycle(pre, 2, arm, 8, Mr, undefined, "drive");
      expect(scored.donors).toEqual(plain.donors);
      expect(stateHash(scored.state)).toBe(stateHash(plain.state));
      scored.rows.forEach((row, r) => {
        const { score, donorScore, ...rest } = row;
        expect(rest).toEqual(plain.rows[r]);
        expect(score).toBe(scores[row.recipient]);
        expect(donorScore).toBe(scores[row.donor]);
      });
      // Neither is the breeder: the movers do not all donate.
      expect(scored.donors).not.toEqual(applyPondCycle(pre, 2, "breed", 8, Mr, undefined, "drive").donors);
    }
  });

  it("without a score, scaf and rand rows carry no score columns", () => {
    const pre = start();
    for (const arm of ["scaf", "rand"] as const)
      for (const row of applyPondCycle(cloneState(pre), 1, arm, 8, pondMatter(pre)).rows) {
        expect("score" in row).toBe(false);
        expect("donorScore" in row).toBe(false);
      }
  });

  it("an ended history's rows score 0 for the missing donor", () => {
    const pre = start();
    const n = cellCount(pre.cfg);
    for (let i = 0; i < n; i++) {
      pre.cells[CH.A * n + i] += pre.cells[CH.B * n + i] + pre.cells[CH.P * n + i];
      pre.cells[CH.B * n + i] = 0;
      pre.cells[CH.P * n + i] = 0;
    }
    const res = applyPondCycle(pre, 1, "breed", 8, pondMatter(pre), undefined, "drive");
    expect(res.ended).toBe(true);
    expect(res.rows.map((r) => [r.donor, r.score, r.donorScore])).toEqual([[-1, 0, 0], [-1, 0, 0], [-1, 0, 0], [-1, 0, 0]]);
  });

  it("BREED_POND_COLUMNS is v1's columns plus score and donorScore", () => {
    expect(BREED_POND_COLUMNS.slice(0, POND_COLUMNS.length)).toEqual([...POND_COLUMNS]);
    expect(BREED_POND_COLUMNS.slice(POND_COLUMNS.length)).toEqual(["score", "donorScore"]);
  });
});
