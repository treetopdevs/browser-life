// The transition hunt's runner pieces (docs/scaffold-transition-hunt-v1.md, "The current", "Branch contract" and
// "Code to build"; docs/scaffold-integration-v1.md, Amendment 4), without a GPU: `--override`'s parser, ponds.tsv's
// columns for nat and shuf against the v1 arms', applyBoundary and a branch's first transform on the CPU
// reference, validateSpec's and `branchError`'s refusals, runExperiment's guards before the GPU is touched (the
// fakeDevice pattern of precycle.test.ts), and run identity with and without the new spec fields.
// tests/deno/ponds.ts (sections nat-shuf and branch) runs whole nat, shuf and branch histories on a GPU.
import { describe, expect, it } from "vitest";
import {
  CH,
  GENOME_CHANNELS,
  HUNT_POND_COLUMNS,
  METRICS_VERSION,
  POND_COLUMNS,
  PRESETS,
  RULE_VERSION,
  SCHEMA_VERSION,
  applyCurrentCycle,
  cellCount,
  cloneState,
  initWorld,
  pondMatter,
  presetConfig,
  stateHash,
  type WorldConfig,
  type WorldState,
} from "@bl/schema";
import { RefSim } from "@bl/sim-ref";
import {
  PONDS_HEADER,
  applyBoundary,
  branchError,
  branchTransform,
  observerSettings,
  parseOverrides,
  pondCensus,
  pondColumns,
  pondContext,
  pondTsvRows,
  pondsHeader,
  restoreObservers,
  runExperiment,
  runId,
  sameCompletedRun,
  serializeObservers,
  specConfig,
  validateSpec,
  type ObserverState,
  type RunOptions,
  type RunSpec,
  type Sink,
} from "@bl/runner";

const pondsSmall = PRESETS.find((p) => p.id === "ponds-small")!;
const host = { host: "test", adapter: "test" };
const noopSink: Sink = { async writeText() {}, async appendText() {}, async writeBytes() {} };
const fakeDevice = {} as GPUDevice;
const PAST_GUARDS = /^device\.\w+ is not a function$/;

// ponds-small: pondPeriod 1,000, so boundary b is at step 1000 b.
const natSpec: RunSpec = { experiment: "hunt", presetId: "ponds-small", condition: "pond-nat", seed: 7, steps: 2000, censusEvery: 100, deepEvery: 10, checkpointEvery: 0 };

/** ponds-small's start world at seed 1 with `count` + 1 cells of B+P = 48 at the left edge of pond `p`'s export zone, for each pond p, moved to `step`. */
function sourceAt(step: number, extra: Partial<WorldConfig> = {}): WorldState {
  const s = initWorld(presetConfig(pondsSmall, 1, extra), pondsSmall.init);
  const cfg = s.cfg, n = cellCount(cfg), W = cfg.tilesX * cfg.tileW;
  for (let p = 0; p < cfg.tilesX * cfg.tilesY; p++) {
    const tx = p % cfg.tilesX, ty = (p - tx) / cfg.tilesX;
    const at = (x: number, y: number) => (ty * cfg.tileH + y) * W + tx * cfg.tileW + x;
    for (let j = 0; j <= p; j++) {
      const i = at(0, 3 * j), next = at(1, 3 * j);
      // 48 of B from this cell's 32 of A and 16 of its neighbour's: the pond's matter is unchanged.
      s.cells[CH.A * n + i] -= 32;
      s.cells[CH.A * n + next] -= 16;
      s.cells[CH.B * n + i] += 48;
      for (let w = 0; w < GENOME_CHANNELS; w++) s.genome[w * n + i] = s.genome[w * n + at(32, 32)];
    }
  }
  return { ...s, step };
}

// The reference physics behind the readState/upload pair applyBoundary uses; counts both.
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

/** The message runExperiment rejects with, or "" if it resolves. */
async function rejection(spec: RunSpec, opts: RunOptions = {}): Promise<string> {
  try {
    await runExperiment(fakeDevice, spec, noopSink, host, () => {}, opts);
    return "";
  } catch (e) {
    return (e as Error).message;
  }
}

/** A branch spec off `source` (ponds-small seed 1 at boundary 2), with the fields a test wants to break. */
const branchSpec = (source: WorldState, extra: Partial<RunSpec> = {}, boundary = 2): RunSpec => ({
  ...natSpec,
  branch: { source: "runs/x/hist/ponds/treatment/seed-1", sourceHash: stateHash(source), boundary },
  ...extra,
});

describe("parseOverrides: --override's comma list", () => {
  it("reads the two allowed keys as integers", () => {
    expect(parseOverrides("mutRate=0")).toEqual({ mutRate: 0 });
    expect(parseOverrides("pondDeath=65536")).toEqual({ pondDeath: 65_536 });
    expect(parseOverrides("mutRate=0,pondDeath=65536")).toEqual({ mutRate: 0, pondDeath: 65_536 });
    expect(parseOverrides(" pondDeath=1 , mutRate=429497 ")).toEqual({ pondDeath: 1, mutRate: 429_497 });
  });

  it("refuses keys outside the allowlist, including every other config key and prototype names", () => {
    for (const text of ["seed=3", "pondK=8", "pondExport=28", "pondArm=1", "pondPeriod=1000", "adhesion=1", "__proto__=1", "constructor=1", "mutrate=0"])
      expect(() => parseOverrides(text), text).toThrow(/the keys allowed are mutRate, pondDeath/);
    expect(() => parseOverrides("mutRate=0,seed=3")).toThrow(/"seed=3"/);
  });

  it("refuses values that are not plain decimal integers", () => {
    for (const text of ["mutRate=1.5", "mutRate=1e3", "mutRate=0x10", "mutRate=abc", "mutRate=", "mutRate=-0", "mutRate=007", "mutRate=+1", "mutRate= 1 2", "pondDeath=9007199254740993", "mutRate=Infinity", "mutRate=NaN"])
      expect(() => parseOverrides(text), text).toThrow(/is not an integer/);
  });

  it("refuses a missing =, an empty list, empty items and a repeated key", () => {
    for (const text of ["mutRate", "", "  ", "mutRate=0,", ",mutRate=0", "mutRate=0,,pondDeath=1"]) expect(() => parseOverrides(text), JSON.stringify(text)).toThrow(/--override/);
    expect(() => parseOverrides("mutRate=0,mutRate=1")).toThrow(/mutRate is given twice/);
  });

  it("leaves range and arm to the config: a pondDeath outside 1..65,536 or on a v1 arm fails validation, before the GPU", async () => {
    // Out of range, on the hunt's arm.
    expect(await rejection({ ...natSpec, overrides: parseOverrides("pondDeath=0") })).toMatch(/pondDeath must be an integer in 1\.\.65536/);
    expect(await rejection({ ...natSpec, overrides: parseOverrides("pondDeath=65537") })).toMatch(/pondDeath must be an integer in 1\.\.65536/);
    // On a v1 arm: the key is only for nat and shuf.
    for (const condition of ["treatment", "pond-rand", "pond-cont"])
      expect(await rejection({ ...natSpec, condition, overrides: parseOverrides("pondDeath=65536") }), condition).toMatch(/pondDeath may be set only when pondArm is nat or shuf/);
    // And the allowed ones pass through to the GPU.
    expect(await rejection({ ...natSpec, overrides: parseOverrides("mutRate=0,pondDeath=65536") })).toMatch(PAST_GUARDS);
  });
});

describe("a spec without overrides or branch is unchanged", () => {
  const done = (spec: RunSpec): Record<string, unknown> => ({
    spec: JSON.parse(JSON.stringify(spec)),
    cfg: specConfig(spec),
    ruleVersion: RULE_VERSION,
    schemaVersion: SCHEMA_VERSION,
    metricsVersion: METRICS_VERSION,
  });

  it("serializes with neither key, validates and keeps its run id; the overrides key exists only when set", () => {
    const plain: RunSpec = { ...natSpec, condition: "treatment" };
    expect(Object.keys(plain)).not.toContain("overrides");
    expect(Object.keys(plain)).not.toContain("branch");
    expect(JSON.stringify(plain)).not.toMatch(/overrides|branch/);
    expect(validateSpec(plain)).toEqual([]);
    expect(validateSpec(natSpec)).toEqual([]);
    expect(runId(natSpec)).toBe("hunt/ponds-small/pond-nat/seed-7");
    expect(sameCompletedRun(done(plain), plain)).toBe(true);
  });

  it("a completed bundle is reused only for the same overrides and the same branch", () => {
    const src = sourceAt(2000);
    const branch = branchSpec(src);
    expect(sameCompletedRun(done(branch), branch)).toBe(true);
    // The overrides are part of the spec and the config.
    const fallback = { ...natSpec, overrides: { pondDeath: 65_536 } };
    expect(sameCompletedRun(done(natSpec), fallback)).toBe(false);
    expect(sameCompletedRun(done(fallback), natSpec)).toBe(false);
    expect(sameCompletedRun(done(fallback), fallback)).toBe(true);
    // A branch bundle is not reused for a run without the branch, or with another source, hash or boundary.
    expect(sameCompletedRun(done(branch), natSpec)).toBe(false);
    expect(sameCompletedRun(done(natSpec), branch)).toBe(false);
    for (const other of [
      { ...branch.branch!, source: "runs/x/hist/ponds/treatment/seed-2" },
      { ...branch.branch!, sourceHash: "0123456789abcdef" },
      { ...branch.branch!, boundary: 3 },
    ])
      expect(sameCompletedRun(done(branch), { ...branch, branch: other }), JSON.stringify(other)).toBe(false);
    // The branch's seed and condition are its identity, like any run's.
    expect(runId(branch)).toBe(runId(natSpec));
    expect(sameCompletedRun(done(branch), { ...branch, seed: 8 })).toBe(false);
  });
});

describe("ponds.tsv's columns", () => {
  it("are the v1 header for every arm but nat and shuf, which append died, exportMass and weight", () => {
    for (const arm of ["scaf", "rand", "cont", undefined] as const) {
      expect(pondsHeader(arm)).toBe(PONDS_HEADER);
      expect(pondColumns(arm)).toBe(POND_COLUMNS);
    }
    for (const arm of ["nat", "shuf"] as const) {
      expect(pondColumns(arm)).toBe(HUNT_POND_COLUMNS);
      expect(pondsHeader(arm)).toBe(PONDS_HEADER.slice(0, -1) + "\tdied\texportMass\tweight\n");
      expect(pondsHeader(arm).startsWith(PONDS_HEADER.slice(0, -1) + "\t")).toBe(true);
    }
    expect(POND_COLUMNS).toHaveLength(22);
    expect(HUNT_POND_COLUMNS).toHaveLength(25);
  });

  it("format rows by the columns given, the v1 ones by default, so a v1 run's text is unchanged", () => {
    const pre = sourceAt(2000);
    const { rows } = applyCurrentCycle(pre, 2, "nat", 8, 32_768, 28, pondMatter(pre), pondCensus);
    const v1 = pondTsvRows(rows);
    expect(v1).toBe(pondTsvRows(rows, POND_COLUMNS));
    expect(v1).toBe(rows.map((r) => POND_COLUMNS.map((c) => String(r[c])).join("\t")).join("\n") + "\n");
    const hunt = pondTsvRows(rows, pondColumns("nat")).trimEnd().split("\n");
    expect(hunt).toHaveLength(4);
    const v1Lines = v1.trimEnd().split("\n");
    hunt.forEach((line, p) => {
      const f = line.split("\t");
      expect(f).toHaveLength(25);
      expect(f.slice(0, 22).join("\t")).toBe(v1Lines[p]);
      expect(f.slice(22)).toEqual([String(rows[p].died), String(rows[p].exportMass), String(rows[p].weight)]);
    });
  });
});

describe("applyBoundary and branchTransform for nat and shuf", () => {
  for (const arm of ["nat", "shuf"] as const) {
    it(`${arm}: applyBoundary transforms the pre-cycle state exactly as applyCurrentCycle does, with the config's keys, one row per pond`, async () => {
      const pre = sourceAt(2000, { pondArm: arm, pondDeath: 40_000, pondExport: 28 });
      const sim = new CpuSim(pre);
      const res = await applyBoundary(sim, 2000, pondContext(pre));
      const want = applyCurrentCycle(pre, 2, arm, 8, 40_000, 28, pondMatter(pre), pondCensus);
      expect(res.ponds!.b).toBe(2);
      expect(res.ponds!.rows).toEqual(want.rows);
      expect(res.ponds!.rows.map((r) => r.recipient)).toEqual([0, 1, 2, 3]);
      expect(res.ponds!.donors).toEqual(want.donors);
      expect(res.ponds!.ended).toBe(want.ended);
      expect(sim.uploads).toBe(1);
      expect(stateHash(res.state!)).toBe(stateHash(want.state));
      expect(stateHash(await sim.readState())).toBe(stateHash(want.state));
      // The pond keys are read from the config: another death changes the history.
      const other = applyCurrentCycle(pre, 2, arm, 8, 65_536, 28, pondMatter(pre), pondCensus);
      expect(other.rows.every((r) => r.died === 1)).toBe(true);
      expect(res.ponds!.rows.some((r) => r.exportMass! > 0)).toBe(true);
    });
  }

  it("an unknown arm still throws, after the pre-cycle readback and before any upload", async () => {
    const pre = sourceAt(2000);
    let uploads = 0;
    const sim = { cfg: { ...pre.cfg, pondArm: "bogus" as never }, readState: async () => pre, upload: () => void uploads++ };
    await expect(applyBoundary(sim, 2000, pondContext(pre))).rejects.toThrow(/pondArm must be scaf, rand, cont, nat or shuf, got "bogus"/);
    expect(uploads).toBe(0);
  });

  it("branchTransform is the boundary's cycle on the source, rows and state as applyCurrentCycle's, and refuses the v1 arms", () => {
    const source = sourceAt(2000);
    const cfg = specConfig({ ...natSpec, seed: 9 });
    const init: WorldState = { ...source, cfg };
    const out = branchTransform(init, 2, pondContext(source)!);
    const want = applyCurrentCycle(init, 2, "nat", 8, 32_768, 28, pondMatter(source), pondCensus);
    expect(out.ponds.b).toBe(2);
    expect(out.ponds.rows).toEqual(want.rows);
    expect(out.ponds.donors).toEqual(want.donors);
    expect(stateHash(out.state)).toBe(stateHash(want.state));
    // The branch's seed keys the transform: another seed gives another history (the death draws at least).
    const rows = (seed: number) => branchTransform({ ...source, cfg: specConfig({ ...natSpec, seed }) }, 2, pondContext(source)!).ponds.rows.map((r) => r.died).join();
    expect(new Set([7, 8, 9, 10, 11, 12, 13, 14].map(rows)).size).toBeGreaterThan(1);
    // The source is not touched.
    expect(stateHash(source)).toBe(stateHash(sourceAt(2000)));
    expect(() => branchTransform(source, 2, pondContext(source)!)).toThrow(/needs pondArm nat or shuf, got "scaf"/);
  });
});

describe("validateSpec: a branch's shape", () => {
  const src = sourceAt(2000);
  const good = branchSpec(src);

  it("accepts a well-formed branch on pond-nat and pond-shuf, and its absence", () => {
    expect(validateSpec(good)).toEqual([]);
    expect(validateSpec({ ...good, condition: "pond-shuf" })).toEqual([]);
    expect(validateSpec(natSpec)).toEqual([]);
  });

  it("refuses other conditions, bad shapes, the founder options and lineageObs", () => {
    const err = (spec: RunSpec) => validateSpec(spec).join("; ");
    for (const condition of ["treatment", "pond-rand", "pond-cont", "neutral"]) expect(err({ ...good, condition }), condition).toMatch(/needs the condition pond-nat or pond-shuf/);
    for (const branch of [null, "x", [], 3] as unknown as RunSpec["branch"][]) expect(err({ ...good, branch }), JSON.stringify(branch)).toMatch(/^branch must be an object/);
    const b = good.branch!;
    expect(err({ ...good, branch: { ...b, source: "" } })).toMatch(/branch\.source must be a non-empty string/);
    expect(err({ ...good, branch: { ...b, source: 3 as unknown as string } })).toMatch(/branch\.source must be a non-empty string/);
    for (const sourceHash of ["", "0123", "0123456789ABCDEF", "0123456789abcdeg", "0123456789abcdef0", 5 as unknown as string])
      expect(err({ ...good, branch: { ...b, sourceHash } }), String(sourceHash)).toMatch(/branch\.sourceHash must be a 16-digit hex state hash/);
    for (const boundary of [0, -1, 1.5, NaN, 2 ** 53, "2" as unknown as number]) expect(err({ ...good, branch: { ...b, boundary } }), String(boundary)).toMatch(/branch\.boundary must be a positive integer/);
    expect(err({ ...good, branch: { source: b.source, sourceHash: b.sourceHash } as RunSpec["branch"] })).toMatch(/exactly the keys source, sourceHash and boundary/);
    expect(err({ ...good, branch: { ...b, postHash: "0123456789abcdef" } as unknown as RunSpec["branch"] })).toMatch(/exactly the keys/);
    expect(err({ ...good, soloFounder: 0 })).toMatch(/excludes soloFounder, soloGenome and founderSet/);
    expect(err({ ...good, founderSet: ["00"] })).toMatch(/excludes soloFounder, soloGenome and founderSet/);
    expect(err({ ...good, lineageObs: true })).toMatch(/lineageObs needs a run observed from step 0/);
  });
});

describe("Stage 1's branches: nat-s and shuf-s from a registration history", () => {
  it("a scaf history of preset ponds (the registration's) at boundary 100 is a legal source for both arms, with and without the e = 1 fallback", () => {
    const ponds = PRESETS.find((p) => p.id === "ponds")!;
    const reg: RunSpec = { experiment: "hist", presetId: "ponds", condition: "treatment", seed: 4_850_001, steps: 1_000_000, censusEvery: 1000, deepEvery: 10, checkpointEvery: 0, preCycleCheckpoints: [34, 100] };
    // The state's contents do not matter to the config checks, only its config, step and hash.
    const source: WorldState = { ...initWorld(specConfig(reg), ponds.init), step: 1_000_000 };
    for (const condition of ["pond-nat", "pond-shuf"])
      for (const overrides of [undefined, { pondDeath: 65_536 }]) {
        const spec: RunSpec = {
          experiment: "hist", presetId: "ponds", condition, seed: 4_901_201, steps: 1_000_000, censusEvery: 1000, deepEvery: 10, checkpointEvery: 0, preCycleCheckpoints: [134, 200],
          ...(overrides ? { overrides } : {}),
          branch: { source: "runs/scaffold/reg1/hist/ponds/treatment/seed-4850001", sourceHash: stateHash(source), boundary: 100 },
        };
        expect(validateSpec(spec)).toEqual([]);
        expect(branchError(spec, specConfig(spec), { branchFrom: source }), `${condition} ${JSON.stringify(overrides)}`).toBeNull();
      }
  });
});

describe("branchError and runExperiment's branch guards fire before the GPU is touched", () => {
  const src = sourceAt(2000);
  const spec = branchSpec(src);
  const cfg = specConfig(spec);
  const observerAt = (step: number): ObserverState => ({
    ...serializeObservers(restoreObservers(undefined, observerSettings(spec)), step, observerSettings(spec)),
    ponds: { lastCycle: Math.floor(step / 1000) },
  });
  /** `src` stepped to `step` under the branch's own config, as a continuation's start. */
  const startAt = (step: number): WorldState => ({ ...cloneState(src), cfg, step });

  it("accepts the legal branch, and lets it through to the GPU after its CPU transform", async () => {
    expect(branchError(spec, cfg, { branchFrom: src })).toBeNull();
    expect(branchError(natSpec, specConfig(natSpec), {})).toBeNull();
    expect(await rejection(spec, { branchFrom: src })).toMatch(PAST_GUARDS);
    // Both arms, the e = 1 fallback, mutation off, and pre-cycle checkpoints after the boundary.
    expect(await rejection({ ...spec, condition: "pond-shuf" }, { branchFrom: src })).toMatch(PAST_GUARDS);
    expect(await rejection({ ...spec, overrides: { pondDeath: 65_536 } }, { branchFrom: src })).toMatch(PAST_GUARDS);
    expect(await rejection({ ...spec, steps: 3000, preCycleCheckpoints: [3, 5] }, { branchFrom: src })).toMatch(PAST_GUARDS);
  });

  it("refuses a source without spec.branch, and a branch without a source or a start", async () => {
    expect(await rejection(natSpec, { branchFrom: src })).toBe("a branch source (branchFrom) needs spec.branch");
    expect(await rejection(spec)).toBe("a branch run needs its source state (branchFrom), or a start state to continue from");
  });

  it("refuses a start or an observer beside the source", async () => {
    const msg = "a branch starts from its source alone: branchFrom excludes a start state and an observer";
    expect(await rejection(spec, { branchFrom: src, start: startAt(2000) })).toBe(msg);
    expect(await rejection(spec, { branchFrom: src, observer: observerAt(2000) })).toBe(msg);
    expect(await rejection(spec, { branchFrom: src, start: startAt(2000), observer: observerAt(2000) })).toBe(msg);
  });

  it("refuses an arm other than nat or shuf (an override on the condition's own config)", async () => {
    expect(await rejection({ ...spec, overrides: { pondArm: "scaf" as const } }, { branchFrom: src })).toBe('a branch run needs the pond arm nat or shuf, got "scaf"');
    expect(await rejection({ ...spec, overrides: { pondArm: "cont" as const } }, { branchFrom: src })).toBe('a branch run needs the pond arm nat or shuf, got "cont"');
  });

  it("refuses a source that is not at boundary * pondPeriod", async () => {
    expect(await rejection(spec, { branchFrom: sourceAt(3000) })).toBe("branch source is at t=3000, but boundary 2 is at t=2000");
    expect(await rejection(spec, { branchFrom: sourceAt(0) })).toBe("branch source is at t=0, but boundary 2 is at t=2000");
    expect(await rejection(branchSpec(sourceAt(2000), {}, 3), { branchFrom: sourceAt(2000) })).toBe("branch source is at t=2000, but boundary 3 is at t=3000");
  });

  it("refuses a source whose state hash is not the spec's", async () => {
    const other: WorldState = { ...src, lightIn: 1n };
    expect(stateHash(other)).not.toBe(stateHash(src));
    expect(await rejection(spec, { branchFrom: other })).toBe(`branch source's state hash ${stateHash(other)} is not the spec's ${stateHash(src)}`);
    expect(await rejection({ ...spec, branch: { ...spec.branch!, sourceHash: "0123456789abcdef" } }, { branchFrom: src })).toMatch(/^branch source's state hash \w{16} is not the spec's 0123456789abcdef$/);
  });

  it("refuses a config that differs from the source's in anything but pondArm, pondDeath, pondExport and seed", async () => {
    for (const [key, extra] of [
      ["mutRate", { mutRate: 1 }],
      ["pondK", { pondK: 7 }],
      ["pondPeriod", { pondPeriod: 2000 }],
      ["lightBase", { lightBase: 5 }],
    ] as [string, Partial<WorldConfig>][]) {
      const source = sourceAt(2000, extra);
      expect(await rejection(branchSpec(source), { branchFrom: source }), key).toBe(`branch config differs from its source's at ${key} (only pondArm, pondDeath, pondExport and seed may differ)`);
    }
    // The spec's overrides change the branch's own config, not the source's.
    expect(await rejection({ ...spec, overrides: { mutRate: 0 } }, { branchFrom: src })).toBe("branch config differs from its source's at mutRate (only pondArm, pondDeath, pondExport and seed may differ)");
    // A source of another arm and seed is the legal case: the source here is a scaf history of seed 1, the branch nat at seed 7.
    expect([src.cfg.pondArm, src.cfg.seed, cfg.pondArm, cfg.seed]).toEqual(["scaf", 1, "nat", 7]);
  });

  it("refuses an invalid branch config (a pondDeath out of range)", async () => {
    expect(await rejection({ ...spec, overrides: { pondDeath: 0 } }, { branchFrom: src })).toMatch(/^invalid config: pondDeath must be an integer in 1\.\.65536/);
  });

  it("refuses a pre-cycle checkpoint at or before the branch's boundary: that cycle is the branch's own", async () => {
    expect(await rejection({ ...spec, steps: 3000, preCycleCheckpoints: [2, 3] }, { branchFrom: src })).toMatch(/^preCycleCheckpoints: boundary 2 \(t=2000\) is at or before this run's start step 2000/);
    expect(await rejection({ ...spec, steps: 3000, preCycleCheckpoints: [1, 3] }, { branchFrom: src })).toMatch(/^preCycleCheckpoints: boundary 1 \(t=1000\) is at or before/);
    expect(await rejection({ ...spec, steps: 1000, preCycleCheckpoints: [4] }, { branchFrom: src })).toMatch(/^preCycleCheckpoints: boundary 4 \(t=4000\) is beyond this run's last step 3000/);
  });

  it("refuses the censusEvery that misses the source's step, as any pond run", async () => {
    expect(await rejection({ ...spec, censusEvery: 300 }, { branchFrom: src })).toMatch(/pondPeriod must be a multiple of censusEvery/);
  });

  it("treats a later segment as an ordinary continuation, which must not precede the branch's boundary", async () => {
    expect(branchError(spec, cfg, { start: startAt(3000), observer: observerAt(3000) })).toBeNull();
    // Past every guard, the fake device fails at its first use.
    expect(await rejection({ ...spec, steps: 1000 }, { start: startAt(3000), observer: observerAt(3000) })).toMatch(PAST_GUARDS);
    expect(await rejection({ ...spec, steps: 1000 }, { start: startAt(1000), observer: observerAt(1000) })).toBe("a branch continuation starts at t=1000, before its boundary 2 (t=2000)");
    // The ordinary continuation checks still apply: a start of another config, or a pre-cycle observer.
    expect(await rejection({ ...spec, steps: 1000 }, { start: { ...startAt(3000), cfg: src.cfg }, observer: observerAt(3000) })).toBe("start state config differs from the run spec");
    expect(await rejection({ ...spec, steps: 1000 }, { start: startAt(3000), observer: { ...observerAt(3000), ponds: { lastCycle: 2 } } })).toMatch(/pre-cycle state/);
  });
});
