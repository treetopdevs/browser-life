// Unit-level (no GPU) coverage of the fixed pick log in stitchRun and taskSpecError (docs/archipelago-breed-2026-10-18.md,
// amendment 2026-11-02). The ponds.tsv and picks.jsonl under fixtures/picked are the real output of a breeder run (seed 1,
// 15000 steps, 16 ponds): a hand pick at cycle 1 ([3, 9, 12, 0], the rule would have chosen [6, 7, 15, 2]) and the arm's own
// donors, answered implicitly, at cycles 2 and 3. tests/deno/picked_segments.ts checks the same chain on live GPU output.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { METRICS_VERSION, RULE_VERSION, SCHEMA_VERSION } from "@bl/schema";
import { PICKS_FILE, appliedPicksFromPonds, canonicalPickLog, parsePickLog, pickLogDigest, runId, specConfig, stitchRun, taskSpecError, type PickEntry, type RunSpec, type StitchSegment } from "@bl/runner";

const fx = (f: string) => readFileSync(new URL(`./fixtures/picked/${f}`, import.meta.url), "utf8");
const ponds = fx("ponds.tsv");
const picksText = fx("picks.jsonl");
const applied: PickEntry[] = parsePickLog(picksText);
const input: PickEntry[] = [applied[0]]; // the one explicit pick of the lab history; cycles 2 and 3 are implicit
const inputText = canonicalPickLog(input);
const digest = pickLogDigest(inputText);

const baseSpec: RunSpec = { experiment: "fx", presetId: "breeder", condition: "treatment", seed: 1, steps: 0, censusEvery: 100, deepEvery: 10, checkpointEvery: 0 };
const pickedSpec = { ...baseSpec, picked: true as const, pickLog: digest, pickImplicit: true as const };
const cfg = specConfig(baseSpec);

const [header, ...rows] = ponds.split("\n").filter(Boolean);
const rowsOf = (cycle: number) => rows.filter((r) => r.split("\t")[0] === String(cycle)).map((r) => r + "\n").join("");

/** A three-segment chain of 5000 steps each, from the real ponds.tsv, one pond boundary at each segment's end. */
function chain(spec: Record<string, unknown> = pickedSpec, tamper: (files: Record<string, string>, k: number) => void = () => {}): StitchSegment[] {
  return [0, 1, 2].map((k) => {
    const startStep = k * 5000, end = startStep + 5000;
    const series = Array.from({ length: 50 }, (_, i) => JSON.stringify({ step: startStep + (i + 1) * 100, individuals: 1, lineages: 1, mutations: 0, fissions: 0, fusions: 0, buddings: 0, maxGeneration: 0, conservationOk: true }) + "\n").join("");
    const manifest = {
      runId: runId(baseSpec),
      spec: { ...spec, steps: 5000 },
      cfg,
      init: "seed",
      schemaVersion: SCHEMA_VERSION,
      ruleVersion: RULE_VERSION,
      metricsVersion: METRICS_VERSION,
      host: { host: "test", adapter: "test" },
      startStep,
      startedAt: new Date(0).toISOString(),
      finishedAt: new Date(0).toISOString(),
      checkpoints: [],
      // A segment's own block counts only its window (what runExperiment wrote for it).
      ...(spec.picked ? { picks: { file: PICKS_FILE, picker: "replay", recorded: k === 0 ? 1 : 0, live: 0, boundaries: 1, digest: "segment-local" } } : {}),
      summary: { steps: end, wallSeconds: 1, stepsPerSecond: 1, finalHash: `digest-${k}`, mutations: 0, fissions: 0, fusions: 0, buddings: 0, maxGeneration: 0, finalIndividuals: 1, finalLineages: 1, extinct: false, conservationOk: true },
    };
    const files: Record<string, string> = {
      "manifest.json": JSON.stringify(manifest),
      "series.jsonl": series,
      "lineages.tsv": "step\tlineage\tcells\n",
      "mutations.tsv": "childHi\tchildLo\tparentHi\tparentLo\n",
      "heredity.tsv": "step\tmuA\tmuB\tsigmaA\tsigmaB\tmassA\tmassB\n",
      "life.jsonl": "",
      "activity-final.json": "{}",
      "ponds.tsv": header + "\n" + rowsOf(k + 1),
    };
    tamper(files, k);
    return { index: k, startStep, steps: 5000, digest: `digest-${k}`, files };
  });
}

describe("appliedPicksFromPonds reads the applied history back out of ponds.tsv", () => {
  it("equals the run's own picks.jsonl donors, in order, for a recorded and for implicit boundaries", () => {
    expect(appliedPicksFromPonds(ponds, 1)).toEqual(applied);
    expect(applied.map((e) => e.donors)).toEqual([[3, 9, 12, 0], [7, 1, 0, 14], [14, 13, 9, 11]]);
  });
});

describe("stitchRun on a picked run with a fixed pick log", () => {
  it("accepts the chain, writes the applied history as picks.jsonl and recomputes the picks block over the whole run", () => {
    const out = stitchRun(chain(), 15000, { pickLog: inputText });
    expect(parsePickLog(out[PICKS_FILE])).toEqual(applied);
    expect(out[PICKS_FILE].split("\n").filter(Boolean).map((l) => JSON.parse(l).by)).toEqual(["recorded", "rule(implicit)", "rule(implicit)"]);
    const m = JSON.parse(out["manifest.json"]);
    // The last segment has one boundary but the run has three: the block is the whole run's, not the last segment's.
    expect(m.picks).toEqual({ file: PICKS_FILE, picker: "replay", recorded: 1, live: 0, boundaries: 3, digest: expect.stringMatching(/^[0-9a-f]{16}$/) });
    expect(m.picks.digest).not.toBe("segment-local");
    expect(m.spec.pickLog).toBe(digest);
  });

  it("the picks block digest is what runExperiment's picksDigest computes over the same entries", async () => {
    const { picksDigest } = await import("@bl/runner");
    const m = JSON.parse(stitchRun(chain(), 15000, { pickLog: inputText })["manifest.json"]);
    expect(m.picks.digest).toBe(await picksDigest(applied));
  });

  it("a final segment with no pond boundary still gets the whole run's counts", () => {
    const segs = chain();
    // Segment #3 of 2500 steps ends before the next boundary at 20000: no row, no pick.
    const extra: StitchSegment = { ...segs[2], index: 3, startStep: 15000, steps: 2500, digest: "digest-3", files: { ...segs[2].files, "ponds.tsv": header + "\n" } };
    const manifest = JSON.parse(extra.files["manifest.json"]);
    manifest.startStep = 15000;
    manifest.spec.steps = 2500;
    manifest.summary.steps = 17500;
    manifest.summary.finalHash = "digest-3";
    manifest.picks = { file: PICKS_FILE, picker: "replay", recorded: 0, live: 0, boundaries: 0, digest: "segment-local" };
    extra.files["manifest.json"] = JSON.stringify(manifest);
    extra.files["series.jsonl"] = Array.from({ length: 25 }, (_, i) => JSON.stringify({ step: 15000 + (i + 1) * 100, individuals: 1, lineages: 1, mutations: 0, fissions: 0, fusions: 0, buddings: 0, maxGeneration: 0, conservationOk: true }) + "\n").join("");
    const out = stitchRun([...segs, extra], 17500, { pickLog: inputText });
    expect(JSON.parse(out["manifest.json"]).picks).toMatchObject({ recorded: 1, boundaries: 3 });
  });

  it("still refuses a picked run without a pick log in its spec, or without the log's text", () => {
    expect(() => stitchRun(chain({ ...baseSpec, picked: true }), 15000)).toThrow(/picked runs cannot be stitched without a pick log/);
    expect(() => stitchRun(chain(), 15000)).toThrow(/needs its pick log to be stitched/);
    expect(() => stitchRun(chain({ ...baseSpec, pressures: [{ step: 0, cycle: 1, score: "mass" }], picked: true, pickLog: digest }), 15000, { pickLog: inputText })).toThrow(/pressured runs cannot be stitched/);
  });

  it("refuses a pick log text that does not hash to the spec's digest, or is not canonical", () => {
    expect(() => stitchRun(chain(), 15000, { pickLog: canonicalPickLog([{ step: 5000, cycle: 1, donors: [3, 9, 12, 1] }]) })).toThrow(/pick log: the pick log hashes to/);
    const messy = inputText.replace(",", ", ");
    expect(() => stitchRun(chain({ ...pickedSpec, pickLog: pickLogDigest(messy) }), 15000, { pickLog: messy })).toThrow(/not in canonical form/);
  });

  it("refuses a history that ignored the log: a ponds.tsv whose cycle-1 donors are the rule's", () => {
    // The run's cycle 1 as the rule alone would have played it (a real rule run's rows: donors 6, 7, 15, 2).
    const rule = fx("ponds-rule-cycle1.tsv");
    const segs = chain(pickedSpec, (files, k) => {
      if (k === 0) files["ponds.tsv"] = rule;
    });
    expect(() => stitchRun(segs, 15000, { pickLog: inputText })).toThrow(/picked run: at t=5000 the run applied donors \[6, 7, 15, 2\], the pick log says \[3, 9, 12, 0\]/);
  });

  it("a strict log (no pickImplicit) must cover every boundary", () => {
    const strictSpec = { ...pickedSpec } as Record<string, unknown>;
    delete strictSpec.pickImplicit;
    expect(() => stitchRun(chain(strictSpec), 15000, { pickLog: inputText })).toThrow(/the pick log has no entry for the boundary at t=10000, and the run is strict/);
    const full = canonicalPickLog(applied);
    const out = stitchRun(chain({ ...strictSpec, pickLog: pickLogDigest(full) }), 15000, { pickLog: full });
    expect(JSON.parse(out["manifest.json"]).picks).toMatchObject({ recorded: 3, boundaries: 3 });
  });

  it("an input entry at a boundary the run does not have is refused", () => {
    const extra = canonicalPickLog([...input, { step: 20000, cycle: 4, donors: [1] }]);
    expect(() => stitchRun(chain({ ...pickedSpec, pickLog: pickLogDigest(extra) }), 15000, { pickLog: extra })).toThrow(/entry at t=20000, which the run has no boundary at/);
  });

  it("a pick log handed to a run that is not picked is refused", () => {
    expect(() => stitchRun(chain({ ...baseSpec }), 15000, { pickLog: inputText })).toThrow(/not picked/);
  });
});

describe("taskSpecError for a picked task", () => {
  const task = { experiment: "fx", presetId: "breeder", condition: "treatment", seed: 1, steps: 5000, censusEvery: 100, deepEvery: 10, picked: true as const, pickLog: digest, pickImplicit: true as const };
  const manifest = (extra: Record<string, unknown> = {}) => ({ spec: { ...baseSpec, steps: 5000, picked: true, pickLog: digest, pickImplicit: true, ...extra }, cfg });

  it("accepts exactly the task's picked, pickLog and pickImplicit", () => {
    expect(taskSpecError(manifest(), task)).toBeNull();
  });

  it("refuses a changed digest, a dropped or extra key", () => {
    expect(taskSpecError(manifest({ pickLog: "0".repeat(64) }), task)).toMatch(/spec\.pickLog is/);
    const dropped = manifest() as { spec: Record<string, unknown>; cfg: unknown };
    delete dropped.spec.pickImplicit;
    expect(taskSpecError(dropped, task)).toMatch(/spec lacks pickImplicit/);
    expect(taskSpecError(manifest({ pressures: [] }), task)).toMatch(/spec carries pressures/);
    // An ordinary task never accepts a manifest that is picked.
    const { picked: _p, pickLog: _l, pickImplicit: _i, ...plain } = task;
    expect(taskSpecError(manifest(), plain)).toMatch(/spec carries picked/);
  });
});
