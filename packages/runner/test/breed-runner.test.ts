// The breeder's runner pieces (wild sandbox; WorldConfig.pondScore), without a GPU: the pond-breed-<score>,
// pond-mass-<score> and pond-drift-<score> conditions, ponds.tsv's columns for a run with a score against the v1 arms', applyBoundary
// on the CPU reference, and the stitch rules on a breeder's file. tests/deno/breed.ts runs whole histories on a GPU.
import { describe, expect, it } from "vitest";
import {
  BREED_POND_COLUMNS,
  CH,
  G,
  POND_COLUMNS,
  POND_SCORES,
  PRESETS,
  applyPondCycle,
  breedPondColumns,
  cellCount,
  cloneState,
  initWorld,
  pondBodies,
  pondDrives,
  pondMatter,
  pondSeeds,
  presetConfig,
  stateHash,
  validateConfig,
  worldW,
  type WorldConfig,
  type WorldState,
} from "@bl/schema";
import { RefSim } from "@bl/sim-ref";
import { PONDS_HEADER, applyBoundary, checkPondsFile, conditionById, pondCensus, pondColumns, pondContext, pondTsvRows, pondsHeader, specConfig, type RunSpec } from "@bl/runner";

const pondsSmall = PRESETS.find((p) => p.id === "ponds-small")!;
const preset = (id: string) => PRESETS.find((p) => p.id === id)!;
const spec = (condition: string, presetId = "ponds"): RunSpec => ({ experiment: "breed", presetId, condition, seed: 11, steps: 0, censusEvery: 1000, deepEvery: 10, checkpointEvery: 0 });

/** ponds-small's start world at seed 1 under `extra`, moved to `step`, with pond `mover`'s living cells driven one unit east. */
function sourceAt(step: number, extra: Partial<WorldConfig>, mover: number): WorldState {
  const s = initWorld(presetConfig(pondsSmall, 1, extra), pondsSmall.init);
  const cfg = s.cfg, n = cellCount(cfg), W = worldW(cfg);
  const tx = mover % cfg.tilesX, ty = (mover - tx) / cfg.tilesX;
  for (let y = 0; y < cfg.tileH; y++)
    for (let x = 0; x < cfg.tileW; x++) {
      const i = (ty * cfg.tileH + y) * W + tx * cfg.tileW + x;
      if ((s.genome[G.LIN_HI * n + i] | s.genome[G.LIN_LO * n + i]) === 0) continue;
      s.genome[G.PARAM1 * n + i] = ((s.genome[G.PARAM1 * n + i] & 0xffffff00) | 12) >>> 0;
      s.cells[CH.MOT * n + i] = (32 + 128) | (128 << 8);
    }
  return { ...s, step };
}

// The reference physics behind the readState/upload pair applyBoundary uses; counts uploads.
class CpuSim {
  ref: RefSim;
  uploads = 0;
  constructor(state: WorldState) {
    this.ref = new RefSim(cloneState(state));
  }
  get cfg() {
    return this.ref.state.cfg;
  }
  async readState() {
    return cloneState(this.ref.state);
  }
  upload(state: WorldState) {
    this.uploads++;
    this.ref = new RefSim(cloneState(state));
  }
}

describe("pond-breed-<score>, pond-mass-<score> and pond-drift-<score>", () => {
  it("exist for every score and set the arm and the score on the ponds preset", () => {
    const base = presetConfig(preset("ponds"), 1);
    for (const score of POND_SCORES) {
      expect(conditionById(`pond-breed-${score}`).apply(base)).toEqual({ pondArm: "breed", pondScore: score });
      expect(conditionById(`pond-mass-${score}`).apply(base)).toEqual({ pondArm: "scaf", pondScore: score });
      expect(conditionById(`pond-drift-${score}`).apply(base)).toEqual({ pondArm: "rand", pondScore: score });
      for (const [condition, arm] of [[`pond-breed-${score}`, "breed"], [`pond-mass-${score}`, "scaf"], [`pond-drift-${score}`, "rand"]] as const) {
        const cfg = specConfig(spec(condition));
        expect(validateConfig(cfg)).toEqual([]);
        expect([cfg.pondPeriod, cfg.pondK, cfg.pondArm, cfg.pondScore]).toEqual([10_000, 8, arm, score]);
        // Everything else is exactly the preset's.
        const { pondArm: _a, pondScore: _s, ...rest } = cfg;
        const { pondArm: _b, ...baseRest } = presetConfig(preset("ponds"), 11);
        expect(rest).toEqual(baseRest);
      }
    }
  });

  it("throw on a preset without the pond cycle", () => {
    for (const id of ["pond-breed-drive", "pond-mass-drive", "pond-drift-drive"]) {
      expect(() => conditionById(id).apply(presetConfig(preset("spots"), 1))).toThrow(/needs a preset with the pond cycle/);
      expect(() => specConfig(spec(id, "spots"))).toThrow(/needs a preset with the pond cycle/);
    }
  });

  it("leave the v1 conditions without a score", () => {
    for (const condition of ["treatment", "pond-rand", "pond-cont", "pond-nat", "pond-shuf"]) expect("pondScore" in specConfig(spec(condition))).toBe(false);
  });
});

describe("ponds.tsv's columns with a score", () => {
  it("append score and donorScore for breed, scaf and rand, and stay v1's without a score", () => {
    for (const arm of ["breed", "scaf", "rand"] as const) {
      expect(pondColumns(arm, "drive")).toBe(BREED_POND_COLUMNS);
      expect(pondsHeader(arm, "drive")).toBe(PONDS_HEADER.slice(0, -1) + "\tscore\tdonorScore\n");
    }
    for (const arm of ["scaf", "rand"] as const) {
      expect(pondColumns(arm)).toBe(POND_COLUMNS);
      expect(pondsHeader(arm)).toBe(PONDS_HEADER);
    }
    expect(BREED_POND_COLUMNS).toHaveLength(24);
  });

  it("append one column per term under a combined score", () => {
    for (const arm of ["breed", "scaf", "rand"] as const) {
      expect(pondColumns(arm, "drive+seed+body")).toEqual(breedPondColumns("drive+seed+body"));
      expect(pondsHeader(arm, "drive+seed+body")).toBe(PONDS_HEADER.slice(0, -1) + "\tscore\tdonorScore\tdrive\tseed\tbody\n");
      expect(pondsHeader(arm, "seed+drive")).toBe(PONDS_HEADER.slice(0, -1) + "\tscore\tdonorScore\tseed\tdrive\n");
    }
    const pre = sourceAt(1000, { pondArm: "breed", pondScore: "drive+seed+body" }, 2);
    const { rows } = applyPondCycle(pre, 1, "breed", 8, pondMatter(pre), pondCensus, "drive+seed+body");
    const v1 = pondTsvRows(rows).trimEnd().split("\n");
    const drives = pondDrives(pre), seeds = pondSeeds(pre, 8), bodies = pondBodies(pre);
    pondTsvRows(rows, pondColumns("breed", "drive+seed+body")).trimEnd().split("\n").forEach((line, p) => {
      const f = line.split("\t");
      expect(f).toHaveLength(27);
      expect(f.slice(0, 22).join("\t")).toBe(v1[p]);
      expect(f.slice(22)).toEqual([String(rows[p].score), String(rows[p].donorScore), String(drives[p]), String(seeds[p]), String(bodies[p])]);
    });
    // Only pond 2 moves, so it alone is off the bottom of drive; its score is its worst rank and the others' is 0.
    expect(rows.map((r) => r.score! > 0)).toEqual([false, false, drives[2] > 0 && seeds[2] > Math.min(...seeds) && bodies[2] > Math.min(...bodies), false]);
  });

  it("format a breeder's rows as v1's row plus the two scores", () => {
    const pre = sourceAt(1000, { pondArm: "breed", pondScore: "drive" }, 2);
    const { rows } = applyPondCycle(pre, 1, "breed", 8, pondMatter(pre), pondCensus, "drive");
    const v1 = pondTsvRows(rows).trimEnd().split("\n");
    const breed = pondTsvRows(rows, pondColumns("breed", "drive")).trimEnd().split("\n");
    expect(breed).toHaveLength(4);
    breed.forEach((line, p) => {
      const f = line.split("\t");
      expect(f).toHaveLength(24);
      expect(f.slice(0, 22).join("\t")).toBe(v1[p]);
      expect(f.slice(22)).toEqual([String(rows[p].score), String(rows[p].donorScore)]);
    });
  });

  it("the stitch rules hold a scored run to the breeder's header and integer scores, and other runs to none", () => {
    const pre = sourceAt(1000, { pondArm: "breed", pondScore: "drive" }, 2);
    const { rows } = applyPondCycle(pre, 1, "breed", 8, pondMatter(pre), pondCensus, "drive");
    const text = pondsHeader("breed", "drive") + pondTsvRows(rows, pondColumns("breed", "drive"));
    const check = (t: string, arm: "breed" | "scaf" | "rand" | undefined, score?: "drive", end = 1000) => () => checkPondsFile("run", t, 1000, 4, 0, end, arm, score);
    for (const arm of ["breed", "scaf", "rand"] as const) expect(check(text, arm, "drive")).not.toThrow();
    // v1's rules still apply: one row per pond per boundary.
    expect(check(text, "breed", "drive", 2000)).toThrow(/0 rows for the boundary at t=2000/);
    // A scored run without its score columns (v1's header and rows) is refused, as is any other header.
    const v1 = PONDS_HEADER + pondTsvRows(rows);
    expect(check(v1, "breed", "drive")).toThrow(/header is not the breeder's columns .*, but the run has pondScore drive/);
    expect(check(text.replace("\tscore\tdonorScore\n", "\tdonorScore\tscore\n"), "breed", "drive")).toThrow(/header is not the breeder's columns/);
    expect(check("cycle\tstep\trecipient\n1\t1000\t0\n", "breed", "drive")).toThrow(/header is not the breeder's columns/);
    // Scores are nonnegative integers a reader can take exactly.
    const lines = text.trimEnd().split("\n");
    const withLast = (score: string, donorScore: string) => [lines[0], ...lines.slice(1, 4), [...lines[4].split("\t").slice(0, 22), score, donorScore].join("\t")].join("\n") + "\n";
    expect(check(withLast("7", "9"), "breed", "drive")).not.toThrow();
    expect(check(withLast("", "9"), "breed", "drive")).toThrow(/with score "", not a nonnegative integer below 2\^53/);
    expect(check(withLast("7.5", "9"), "breed", "drive")).toThrow(/with score "7.5", not a nonnegative integer/);
    expect(check(withLast("7", "-1"), "breed", "drive")).toThrow(/with donorScore "-1", not a nonnegative integer/);
    expect(check(withLast("9007199254740991", "9"), "breed", "drive")).not.toThrow();
    expect(check(withLast("9007199254740993", "9"), "breed", "drive")).toThrow(/with score "9007199254740993", not a nonnegative integer below 2\^53/);
    expect(check(withLast("7", "9".repeat(400)), "breed", "drive")).toThrow(/with donorScore "9+", not a nonnegative integer below 2\^53/);
    // A run known to have no score must not carry the columns; a v1 file stays accepted as it was.
    expect(check(text, "scaf")).toThrow(/header carries the breeder's columns \(score, donorScore\), but the run has no pondScore/);
    expect(check(v1, "scaf")).not.toThrow();
    expect(check(v1, undefined)).not.toThrow();
  });

  it("the stitch rules hold a combined score's run to its own header and integer term values", () => {
    const score = "drive+seed+body";
    const pre = sourceAt(1000, { pondArm: "breed", pondScore: score }, 2);
    const { rows } = applyPondCycle(pre, 1, "breed", 8, pondMatter(pre), pondCensus, score);
    const text = pondsHeader("breed", score) + pondTsvRows(rows, pondColumns("breed", score));
    const check = (t: string, s: "drive" | "drive+seed+body" | "seed+drive" | undefined, arm: "breed" | "scaf" = "breed") => () => checkPondsFile("run", t, 1000, 4, 0, 1000, arm, s);
    expect(check(text, score)).not.toThrow();
    expect(check(text, score, "scaf")).not.toThrow();
    // The header is the score's own: one term's file, another order or a missing term column is refused.
    const single = pondsHeader("breed", "drive") + pondTsvRows(rows, pondColumns("breed", "drive"));
    expect(check(single, score)).toThrow(/header is not the breeder's columns \(.*donorScore, drive, seed, body\), but the run has pondScore drive\+seed\+body/);
    expect(check(text, "drive")).toThrow(/header is not the breeder's columns/);
    expect(check(text, "seed+drive")).toThrow(/header is not the breeder's columns/);
    expect(check(text, undefined, "scaf")).toThrow(/header carries the breeder's columns \(score, donorScore\), but the run has no pondScore/);
    // Term values are read as the scores are.
    const lines = text.trimEnd().split("\n");
    const withLast = (...tail: string[]) => [lines[0], ...lines.slice(1, 4), [...lines[4].split("\t").slice(0, 22), ...tail].join("\t")].join("\n") + "\n";
    expect(check(withLast("0", "0", "5", "6", "7"), score)).not.toThrow();
    expect(check(withLast("0", "0", "5", "", "7"), score)).toThrow(/with seed "", not a nonnegative integer below 2\^53/);
    expect(check(withLast("0", "0", "-5", "6", "7"), score)).toThrow(/with drive "-5", not a nonnegative integer/);
    expect(check(withLast("0", "0", "5", "6", "7.5"), score)).toThrow(/with body "7.5", not a nonnegative integer/);
    expect(check(withLast("0", "0", "5", "6"), score)).toThrow(/with body "", not a nonnegative integer/);
  });
});

describe("applyBoundary for the breeder", () => {
  it("breed: transforms the pre-cycle state exactly as applyPondCycle does with the config's score, and seeds from the mover", async () => {
    const pre = sourceAt(1000, { pondArm: "breed", pondScore: "drive" }, 3);
    const sim = new CpuSim(pre);
    const res = await applyBoundary(sim, 1000, pondContext(pre));
    const want = applyPondCycle(pre, 1, "breed", 8, pondMatter(pre), pondCensus, "drive");
    expect(res.ponds!.rows).toEqual(want.rows);
    expect(res.ponds!.donors).toEqual([3]);
    expect(sim.uploads).toBe(1);
    expect(stateHash(res.state!)).toBe(stateHash(want.state));
    expect(stateHash(await sim.readState())).toBe(stateHash(want.state));
    expect(pondDrives(res.state!).every((d) => d > 0)).toBe(true);
    // The score is read from the config: by mass, some other cycle results.
    const other = applyPondCycle({ ...pre, cfg: { ...pre.cfg, pondScore: "mass" } }, 1, "breed", 8, pondMatter(pre), pondCensus, "mass");
    expect(other.rows.map((r) => r.score)).not.toEqual(want.rows.map((r) => r.score));
  });

  it("breed under a combined score: the config's score and packet side reach the cycle", async () => {
    const pre = sourceAt(1000, { pondArm: "breed", pondScore: "drive+seed" }, 1);
    const sim = new CpuSim(pre);
    const res = await applyBoundary(sim, 1000, pondContext(pre));
    const want = applyPondCycle(pre, 1, "breed", pre.cfg.pondK!, pondMatter(pre), pondCensus, "drive+seed");
    expect(res.ponds!.rows).toEqual(want.rows);
    expect(res.ponds!.rows.map((r) => r.seed)).toEqual(pondSeeds(pre, 8));
    expect(stateHash(await sim.readState())).toBe(stateHash(want.state));
  });

  it("drift: lands rand's world and records the score", async () => {
    const pre = sourceAt(1000, { pondArm: "rand", pondScore: "drive" }, 3);
    const sim = new CpuSim(pre);
    const res = await applyBoundary(sim, 1000, pondContext(pre));
    const plain = applyPondCycle({ ...pre, cfg: { ...pre.cfg } }, 1, "rand", 8, pondMatter(pre), pondCensus);
    expect(res.ponds!.donors).toEqual(plain.donors);
    expect(res.ponds!.rows.map((r) => r.score)).toEqual(pondDrives(pre));
    expect(res.ponds!.rows.map((r) => r.donor)).toEqual(plain.rows.map((r) => r.donor));
  });
});
