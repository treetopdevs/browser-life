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
import {
  BUNDLE_FILES,
  ISLAND_CAPABILITIES,
  OBSERVATION_FILES,
  PICKS_FILE,
  PONDS_HEADER,
  VERIFIED_FILES,
  applyBoundary,
  checkPondsFile,
  conditionById,
  pondCensus,
  pondColumns,
  pondContext,
  pondTsvRows,
  pondsHeader,
  specConfig,
  specRefusal,
  taskSpecError,
  type DistributedTask,
  type RunSpec,
} from "@bl/runner";

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
    // Rows agree with each other: pond 3's score is every donorScore of a row whose donor is 3 (`rescore` keeps that).
    const rescore = (t: string, pond: number, score: string) => {
      const [head, ...rest] = t.trimEnd().split("\n");
      const at = head.split("\t");
      const [rc, dc, sc, dsc] = ["recipient", "donor", "score", "donorScore"].map((c) => at.indexOf(c));
      return [head, ...rest.map((r) => {
        const f = r.split("\t");
        if (f[rc] === String(pond)) f[sc] = score;
        if (f[dc] === String(pond)) f[dsc] = score;
        return f.join("\t");
      })].join("\n") + "\n";
    };
    expect(check(rescore(text, 3, "7"), "breed", "drive")).not.toThrow();
    expect(check(withLast("", "9"), "breed", "drive")).toThrow(/with score "", not a nonnegative integer below 2\^53/);
    expect(check(withLast("7.5", "9"), "breed", "drive")).toThrow(/with score "7.5", not a nonnegative integer/);
    expect(check(withLast("7", "-1"), "breed", "drive")).toThrow(/with donorScore "-1", not a nonnegative integer/);
    expect(check(rescore(text, 3, "9007199254740991"), "breed", "drive")).not.toThrow();
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
    // The last row keeps its score and donorScore (they must agree with the other rows) and takes these term values.
    const withLast = (...terms: string[]) => [lines[0], ...lines.slice(1, 4), [...lines[4].split("\t").slice(0, 24), ...terms].join("\t")].join("\n") + "\n";
    expect(check(withLast("5", "6", "7"), score)).not.toThrow();
    expect(check(withLast("5", "", "7"), score)).toThrow(/with seed "", not a nonnegative integer below 2\^53/);
    expect(check(withLast("-5", "6", "7"), score)).toThrow(/with drive "-5", not a nonnegative integer/);
    expect(check(withLast("5", "6", "7.5"), score)).toThrow(/with body "7.5", not a nonnegative integer/);
    expect(check(withLast("5", "6"), score)).toThrow(/with body "", not a nonnegative integer/);
  });
});

describe("a breeder's ponds.tsv rows agree with each other", () => {
  // Pond 2 moves and scores under drive; the breed arm makes it every recipient's donor.
  const pre = sourceAt(1000, { pondArm: "breed", pondScore: "drive" }, 2);
  const { rows } = applyPondCycle(pre, 1, "breed", 8, pondMatter(pre), pondCensus, "drive");
  const text = pondsHeader("breed", "drive") + pondTsvRows(rows, pondColumns("breed", "drive"));
  const names = text.split("\n", 1)[0].split("\t");
  const check = (t: string) => () => checkPondsFile("run", t, 1000, 4, 0, 1000, "breed", "drive");
  // `text` with row `r`'s cells `cells` replaced.
  const edit = (r: number, cells: Record<string, string>) => {
    const ls = text.trimEnd().split("\n");
    const f = ls[r + 1].split("\t");
    for (const [c, v] of Object.entries(cells)) f[names.indexOf(c)] = v;
    ls[r + 1] = f.join("\t");
    return ls.join("\n") + "\n";
  };

  it("the cycle's own rows pass, and a scored pond donated", () => {
    expect(rows.some((r) => r.donor >= 0 && r.donorScore! > 0)).toBe(true);
    expect(check(text)).not.toThrow();
  });

  it("refuses a donorScore that is not the donor's own row's score, and a donor outside the ponds", () => {
    const r = rows.findIndex((x) => x.donor >= 0);
    const d = rows[r].donor;
    // The tampered history from review (Codex, 2026-10-18): donor 3, score 999, donorScore 777.
    expect(check(edit(r, { donor: "3", score: "999", donorScore: "777" }))).toThrow(/donor 3 and donorScore 777, but pond 3's own row has score/);
    expect(check(edit(r, { donorScore: String(rows[d].score! + 1) }))).toThrow(new RegExp(`donor ${d} and donorScore ${rows[d].score! + 1}, but pond ${d}'s own row has score ${rows[d].score}`));
    expect(check(edit(r, { donor: "-1" }))).toThrow(/a row without a donor has donorScore 0/);
    expect(check(edit(r, { donor: "4" }))).toThrow(/with donor "4", not -1 or a pond index in \[0, 4\)/);
    expect(check(edit(r, { donor: "-2" }))).toThrow(/with donor "-2"/);
    // Moving a donor's score alone breaks its recipients' rows.
    expect(check(edit(d, { score: String(rows[d].score! + 1) }))).toThrow(/own row has score/);
  });
});

describe("taskSpecError: a coordinator segment's manifest describes the task it was handed", () => {
  const task: DistributedTask = { experiment: "it-breed", presetId: "ponds-small", condition: "pond-breed-drive", seed: 1, steps: 1000, censusEvery: 100, deepEvery: 10 };
  // The spec Coordinator.Queue's task/4 builds, and the manifest an island writes from it.
  const handed: RunSpec = { experiment: "it-breed", presetId: "ponds-small", condition: "pond-breed-drive", seed: 1, steps: 1000, censusEvery: 100, deepEvery: 10, checkpointEvery: 0 };
  const manifest = (spec: unknown, cfg: unknown = JSON.parse(JSON.stringify(specConfig(spec as RunSpec)))) => JSON.parse(JSON.stringify({ spec, cfg }));

  it("accepts the island's own manifest", () => {
    expect(taskSpecError(manifest(handed), task)).toBeNull();
  });

  it("binds a stitched export over the steps it covers, as tools/stitch.ts checks one already on disk (Codex pass 2)", () => {
    // stitchRun's manifest is the last segment's spec with the whole run's steps; the cache check passes those steps.
    const whole = { ...task, steps: 3000 };
    expect(taskSpecError(manifest({ ...handed, steps: 3000 }), whole)).toBeNull();
    const m = manifest({ ...handed, steps: 3000 });
    m.spec.overrides = { pondScore: "body" };
    m.cfg.pondScore = "body";
    expect(taskSpecError(m, whole)).toMatch(/spec carries overrides/);
    expect(taskSpecError(manifest({ ...handed, steps: 1000 }), whole)).toMatch(/spec.steps is 1000/);
  });

  it("refuses an injected score: overrides in the spec and the config to match (review, Codex 2026-10-18)", () => {
    const m = manifest(handed);
    m.spec.overrides = { pondScore: "body" };
    m.cfg.pondScore = "body";
    expect(taskSpecError(m, task)).toMatch(/spec carries overrides/);
    // The config alone, the spec untouched.
    const c = manifest(handed);
    c.cfg.pondScore = "body";
    expect(taskSpecError(c, task)).toMatch(/config is not the one the coordinator's task builds/);
  });

  it("refuses any key the task has not, and any value it does not", () => {
    for (const extra of [{ picked: true }, { pressures: [] }, { branch: { arm: "nat" } }, { activityThreshold: 1 }, { runId: "x" }])
      expect(taskSpecError(manifest({ ...handed, ...extra }), task)).toMatch(/spec carries /);
    expect(taskSpecError(manifest({ ...handed, condition: "pond-mass-drive" }), task)).toMatch(/spec.condition is "pond-mass-drive"/);
    expect(taskSpecError(manifest({ ...handed, seed: 2 }), task)).toMatch(/spec.seed is 2/);
    expect(taskSpecError(manifest({ ...handed, checkpointEvery: 1000 }), task)).toMatch(/spec.checkpointEvery is 1000/);
    const { deepEvery: _, ...short } = handed;
    expect(taskSpecError(manifest(short), task)).toMatch(/spec lacks deepEvery/);
    expect(taskSpecError({ cfg: {} }, task)).toMatch(/no spec/);
  });

  it("carries a schedule and a metapopulation as the task does, and a garden's schedule by presence", () => {
    const interventions = [{ step: 500, kind: "lesion", x: 20, y: 20, r: 4 }];
    const scheduled = { ...task, interventions };
    expect(taskSpecError(manifest({ ...handed, interventions }), scheduled)).toBeNull();
    expect(taskSpecError(manifest(handed), scheduled)).toMatch(/spec lacks interventions/);
    expect(taskSpecError(manifest({ ...handed, interventions: [] }), scheduled)).toMatch(/spec.interventions is/);
    expect(taskSpecError(manifest({ ...handed, interventions: [] }), scheduled, { garden: true })).toBeNull();
    const ring = { ...task, presetId: "spots", condition: "treatment", seed: 7, seeds: [5, 7], metapopulation: { topology: "ring", migrantCount: 4, salt: 3 } };
    const ringSpec = { ...handed, presetId: "spots", condition: "treatment", seed: 7, metapopulation: { salt: 3, topology: "ring", migrantCount: 4, ringNamespace: 2 } };
    expect(taskSpecError(manifest(ringSpec), ring)).toBeNull();
    expect(taskSpecError(manifest({ ...ringSpec, metapopulation: { ...ringSpec.metapopulation, ringNamespace: 1 } }), ring)).toMatch(/spec.metapopulation/);
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

// The archipelago runs and verifies bred worlds (docs/archipelago-breed-2026-10-18.md): islands advertise breed-v1, a
// rule-bred spec is not refused, picked and pressured specs still are, and picks.jsonl is in no file list.
describe("the breeder on islands", () => {
  const task = (presetId: string, condition: string): RunSpec => ({ experiment: "b", presetId, condition, seed: 1, steps: 1000, censusEvery: 100, deepEvery: 10, checkpointEvery: 0 });

  it("ISLAND_CAPABILITIES lists breed-v1 beside ponds-v1, which the coordinator asks for with it", () => {
    expect(ISLAND_CAPABILITIES).toContain("breed-v1");
    expect(ISLAND_CAPABILITIES).toContain("ponds-v1");
  });

  it("specRefusal lets a bred spec through: a breeder condition on ponds-small, and the breeder preset's treatment", () => {
    expect(specRefusal(task("ponds-small", "pond-breed-drive+seed+body"))).toBeNull();
    expect(specRefusal(task("ponds-small", "pond-mass-drive"))).toBeNull();
    expect(specRefusal(task("breeder", "treatment"))).toBeNull();
    // And the spec is one the runner can configure: the breed arm with its score.
    expect(specConfig(task("breeder", "treatment"))).toMatchObject({ pondArm: "breed", pondScore: "drive+seed+body" });
  });

  it("specRefusal still refuses the same specs picked or pressured", () => {
    for (const s of [task("ponds-small", "pond-breed-drive+seed+body"), task("breeder", "treatment")]) {
      expect(specRefusal({ ...s, picked: true })).toMatch(/picked run/);
      expect(specRefusal({ ...s, pressures: [] } as RunSpec)).toMatch(/pressures/);
    }
  });

  it("picks.jsonl is not a verified file, nor in any bundle file list", () => {
    expect(VERIFIED_FILES).not.toContain(PICKS_FILE);
    expect(BUNDLE_FILES as readonly string[]).not.toContain(PICKS_FILE);
    expect(OBSERVATION_FILES as readonly string[]).not.toContain(PICKS_FILE);
  });
});
