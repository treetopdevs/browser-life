// Unit-level (no GPU) coverage of stitchRun's pure bookkeeping: the
// observationsVerified/observationsChecked aggregate over a run's segments,
// and the per-segment metrics-version refusal. tests/deno/stitch.ts already
// checks the byte-for-byte equivalence of a stitched run against a
// continuous one using real runExperiment output; these fixtures are
// hand-built instead, so every field stitchRun actually inspects is
// satisfied deliberately rather than incidentally.
import { describe, expect, it } from "vitest";
import { METRICS_VERSION, RULE_VERSION, SCHEMA_VERSION } from "@bl/schema";
import { observationDigests, runId, specConfig, stitchRun, type RunSpec, type StitchSegment } from "@bl/runner";

const baseSpec: RunSpec = { experiment: "fx", presetId: "spots", condition: "treatment", seed: 1, steps: 0, censusEvery: 10, deepEvery: 1000, checkpointEvery: 0 };
const cfg = specConfig(baseSpec);

interface Opts {
  observationsVerified?: boolean | null;
  metricsVersion?: number;
  omitMetricsVersion?: boolean;
  picked?: boolean;
}

/** A minimal, internally consistent segment bundle stitchRun accepts on its own terms (no relation to a real run). */
function segment(index: number, startStep: number, steps: number, opts: Opts = {}): StitchSegment {
  const censusEvery = baseSpec.censusEvery;
  const end = startStep + steps;
  const rows: Record<string, unknown>[] = [];
  for (let s = startStep + censusEvery; s <= end; s += censusEvery)
    rows.push({ step: Math.min(s, end), individuals: 1, lineages: 1, mutations: 0, fissions: 0, fusions: 0, buddings: 0, maxGeneration: 0, conservationOk: true });
  const tail = rows[rows.length - 1];
  const digest = `digest-${index}`;
  const spec = { ...baseSpec, steps, ...(opts.picked ? { picked: true } : {}) };

  const manifest: Record<string, unknown> = {
    runId: runId(baseSpec),
    spec,
    cfg,
    init: "seed",
    schemaVersion: SCHEMA_VERSION,
    ruleVersion: RULE_VERSION,
    host: { host: "test", adapter: "test" },
    startStep,
    startedAt: new Date(0).toISOString(),
    finishedAt: new Date(0).toISOString(),
    checkpoints: [],
    summary: {
      steps: end,
      wallSeconds: 1,
      stepsPerSecond: 1,
      finalHash: digest,
      mutations: 0,
      fissions: 0,
      fusions: 0,
      buddings: 0,
      maxGeneration: 0,
      finalIndividuals: tail.individuals,
      finalLineages: tail.lineages,
      extinct: false,
      conservationOk: true,
    },
  };
  if (!opts.omitMetricsVersion) manifest.metricsVersion = opts.metricsVersion ?? METRICS_VERSION;

  const files: Record<string, string> = {
    "manifest.json": JSON.stringify(manifest),
    "series.jsonl": rows.map((r) => JSON.stringify(r) + "\n").join(""),
    "lineages.tsv": "step\tlineage\tcells\n",
    "mutations.tsv": "childHi\tchildLo\tparentHi\tparentLo\n",
    "heredity.tsv": "step\tmuA\tmuB\tsigmaA\tsigmaB\tmassA\tmassB\n",
    "life.jsonl": "",
    "activity-final.json": "{}",
  };
  return { index, startStep, steps, digest, files, observationsVerified: opts.observationsVerified ?? null };
}

describe("stitchRun's observationsVerified/observationsChecked aggregate (truth table)", () => {
  const cases: [string, (boolean | null)[], boolean | null, { checked: number; total: number }][] = [
    ["all matched", [true, true], true, { checked: 2, total: 2 }],
    ["any mismatch wins over a match", [true, false], false, { checked: 2, total: 2 }],
    ["a mismatch outweighs an unchecked segment too", [false, null], false, { checked: 1, total: 2 }],
    // The bug this guards against: [null, true] must NOT read as true — that
    // would overstate verification coverage for an ordinary run where only a
    // sampled fraction of segments were ever verified.
    ["matched-but-incomplete coverage is null, not true", [true, null], null, { checked: 1, total: 2 }],
    ["nothing checked at all is null", [null, null], null, { checked: 0, total: 2 }],
  ];

  for (const [name, results, expectVerified, expectChecked] of cases) {
    it(name, () => {
      const segs = results.map((observationsVerified, i) => segment(i, i * 10, 10, { observationsVerified }));
      const stitched = stitchRun(segs, 20);
      const manifest = JSON.parse(stitched["manifest.json"]);
      expect(manifest.observationsVerified).toBe(expectVerified);
      expect(manifest.observationsChecked).toEqual(expectChecked);
      // Per-segment values are carried through unchanged.
      expect(manifest.segments.map((s: { observationsVerified: boolean | null }) => s.observationsVerified)).toEqual(results);
    });
  }
});

describe("stitchRun refuses a segment computed under a different metrics version", () => {
  it("accepts a segment whose manifest explicitly matches the current METRICS_VERSION", () => {
    expect(() => stitchRun([segment(0, 0, 10, { metricsVersion: METRICS_VERSION })], 10)).not.toThrow();
  });

  it("refuses an explicit, outdated metricsVersion", () => {
    expect(() => stitchRun([segment(0, 0, 10, { metricsVersion: METRICS_VERSION - 1 })], 10)).toThrow(/metrics version/);
  });

  it("refuses a manifest with no metricsVersion field at all (predates the constant, version 1)", () => {
    expect(() => stitchRun([segment(0, 0, 10, { omitMetricsVersion: true })], 10)).toThrow(/metrics version/);
  });

  it("refuses when only a later segment's metrics version is outdated", () => {
    const segs = [segment(0, 0, 10, { metricsVersion: METRICS_VERSION }), segment(1, 10, 10, { metricsVersion: METRICS_VERSION - 1 })];
    expect(() => stitchRun(segs, 20)).toThrow(/segment #1.*metrics version/);
  });
});

describe("stitchRun refuses a picked run's segments", () => {
  it("throws for a segment whose spec is picked: its donors are in picks.jsonl, not in the segment files", () => {
    expect(() => stitchRun([segment(0, 0, 10, { picked: true })], 10)).toThrow(/picked runs cannot be stitched/);
    expect(() => stitchRun([segment(0, 0, 10), segment(1, 10, 10, { picked: true })], 20)).toThrow(/segment #1.*picked runs cannot be stitched/);
  });
});

describe("observationDigests covers the optional migration log", () => {
  it("reports migrations.tsv when present, and omits it (and manifest.json) otherwise", async () => {
    const base = { "series.jsonl": "a", "manifest.json": "{}" };
    expect(Object.keys(await observationDigests(base))).toEqual(["series.jsonl"]);
    const withMig = await observationDigests({ ...base, "migrations.tsv": "step\n" });
    expect(Object.keys(withMig).sort()).toEqual(["migrations.tsv", "series.jsonl"]);
    expect(withMig["migrations.tsv"]).toMatch(/^[0-9a-f]{64}$/);
  });
});
