// Unit-level (no GPU) coverage of stitchRun's pure bookkeeping: the
// observationsVerified/observationsChecked aggregate over a run's segments,
// and the per-segment metrics-version refusal. tests/deno/stitch.ts already
// checks the byte-for-byte equivalence of a stitched run against a
// continuous one using real runExperiment output; these fixtures are
// hand-built instead, so every field stitchRun actually inspects is
// satisfied deliberately rather than incidentally.
import { describe, expect, it } from "vitest";
import { METRICS_VERSION, RULE_VERSION, SCHEMA_VERSION, clampLesionRadius, maxLesionRadius } from "@bl/schema";
import { INTERVENTIONS_FILE, formatInterventionLine, observationDigests, ownedInterventions, runId, specConfig, stitchRun, type InterventionLogEntry, type RunSpec, type ScheduledIntervention, type StitchSegment } from "@bl/runner";

const baseSpec: RunSpec = { experiment: "fx", presetId: "spots", condition: "treatment", seed: 1, steps: 0, censusEvery: 10, deepEvery: 1000, checkpointEvery: 0 };
const cfg = specConfig(baseSpec);

interface Opts {
  observationsVerified?: boolean | null;
  metricsVersion?: number;
  omitMetricsVersion?: boolean;
  picked?: boolean;
  /** RunSpec.interventions: the segment then carries the log of the entries it owns and the manifest's block, unless overridden below. */
  scheduled?: ScheduledIntervention[];
  /** The text of interventions.jsonl, in place of the one `scheduled` implies (`null`: no file). */
  log?: string | null;
  /** The manifest's `interventions` block, in place of the one `scheduled` implies (`null`: no block). */
  block?: unknown;
}

/** What a run logs for `e` when it applies it as scheduled: the effective radius (clamped under `cfg`), a feed with the matter it named or 0. */
const logLine = (e: ScheduledIntervention): string => formatInterventionLine({ ...e, r: clampLesionRadius(cfg, e.r), ...(e.kind === "feed" ? { matter: e.matter ?? 0 } : {}) } as InterventionLogEntry);

/** A minimal, internally consistent segment bundle stitchRun accepts on its own terms (no relation to a real run). */
function segment(index: number, startStep: number, steps: number, opts: Opts = {}): StitchSegment {
  const censusEvery = baseSpec.censusEvery;
  const end = startStep + steps;
  const rows: Record<string, unknown>[] = [];
  for (let s = startStep + censusEvery; s <= end; s += censusEvery)
    rows.push({ step: Math.min(s, end), individuals: 1, lineages: 1, mutations: 0, fissions: 0, fusions: 0, buddings: 0, maxGeneration: 0, conservationOk: true });
  const tail = rows[rows.length - 1];
  const digest = `digest-${index}`;
  const spec = { ...baseSpec, steps, ...(opts.picked ? { picked: true } : {}), ...(opts.scheduled ? { interventions: opts.scheduled } : {}) };
  const owned = opts.scheduled ? ownedInterventions(opts.scheduled, startStep, steps) : [];

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
  const block = opts.block !== undefined ? opts.block : opts.scheduled ? { file: INTERVENTIONS_FILE, applied: owned.length } : null;
  if (block !== null) manifest.interventions = block;

  const files: Record<string, string> = {
    "manifest.json": JSON.stringify(manifest),
    "series.jsonl": rows.map((r) => JSON.stringify(r) + "\n").join(""),
    "lineages.tsv": "step\tlineage\tcells\n",
    "mutations.tsv": "childHi\tchildLo\tparentHi\tparentLo\n",
    "heredity.tsv": "step\tmuA\tmuB\tsigmaA\tsigmaB\tmassA\tmassB\n",
    "life.jsonl": "",
    "activity-final.json": "{}",
  };
  const log = opts.log !== undefined ? opts.log : opts.scheduled ? owned.map(logLine).join("") : null;
  if (log !== null) files[INTERVENTIONS_FILE] = log;
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

// A scheduled run (RunSpec.interventions): every segment carries interventions.jsonl, the log of exactly the entries
// it owns (ownedInterventions), and a manifest block counting them; stitchRun joins the logs in order and sums the
// counts. tests/deno/interventions.ts checks the same against real runExperiment output; these are the rules.
describe("stitchRun joins a scheduled run's intervention logs", () => {
  const schedule: ScheduledIntervention[] = [
    { step: 0, kind: "lesion", x: 1, y: 2, r: 6 },
    { step: 3, kind: "lesion", x: 1, y: 1, r: 2 },
    { step: 10, kind: "feed", x: 4, y: 4, r: 3, amount: 16 },
    { step: 10, kind: "feed", x: 5, y: 5, r: 2, amount: -8, matter: -40 },
    { step: 17, kind: "lesion", x: 7, y: 7, r: 1000 }, // clamped to the world's largest lesion radius
    { step: 20, kind: "feed", x: 2, y: 2, r: 1, amount: 4 },
  ];
  const segs = () => [segment(0, 0, 10, { scheduled: schedule }), segment(1, 10, 10, { scheduled: schedule })];

  it("the stitched log is the segments' logs in order, and the manifest's block counts the whole run", () => {
    const out = stitchRun(segs(), 20);
    expect(out[INTERVENTIONS_FILE]).toBe(schedule.map(logLine).join(""));
    const m = JSON.parse(out["manifest.json"]);
    expect(m.interventions).toEqual({ file: INTERVENTIONS_FILE, applied: 6 });
    expect(m.spec.interventions).toEqual(schedule);
    // Each segment logged only its own: 4 (step 0 and 3 on #0, both at 10 on #0) and 2 (17 and 20 on #1).
    expect(JSON.parse(segs()[0].files["manifest.json"]).interventions.applied).toBe(4);
    expect(JSON.parse(segs()[1].files["manifest.json"]).interventions.applied).toBe(2);
  });

  it("an ordinary run's stitched bundle has no interventions.jsonl and no block", () => {
    const out = stitchRun([segment(0, 0, 10), segment(1, 10, 10)], 20);
    expect(out[INTERVENTIONS_FILE]).toBeUndefined();
    expect("interventions" in JSON.parse(out["manifest.json"])).toBe(false);
  });

  it("the logged radius is the scheduled one clamped under the run's config: nothing else, smaller or larger", () => {
    const max = maxLesionRadius(cfg);
    expect(max).toBeLessThan(1000);
    expect(logLine(schedule[4])).toContain(`"r":${max}`);
    expect(() => stitchRun(segs(), 20)).not.toThrow();
    for (const r of [max - 1, max + 1, 1000, 0]) {
      const other = segment(1, 10, 10, { scheduled: schedule, log: logLine(schedule[4]).replace(`"r":${max}`, `"r":${r}`) + logLine(schedule[5]) });
      expect(() => stitchRun([segment(0, 0, 10, { scheduled: schedule }), other], 20)).toThrow(new RegExp(`segment #1: interventions\\.jsonl line 1 \\(lesion at t=17, r ${r}\\) is not the scheduled lesion at t=17 \\(entry 4 of the schedule, effective r ${max}\\)`));
    }
    // An unclamped radius must be logged as it is.
    const smaller = segment(0, 0, 10, { scheduled: schedule, log: ownedInterventions(schedule, 0, 10).map(logLine).join("").replace('"r":6', '"r":5') });
    expect(() => stitchRun([smaller, segment(1, 10, 10, { scheduled: schedule })], 20)).toThrow(/segment #0: interventions\.jsonl line 1 \(lesion at t=0, r 5\)/);
  });

  it("the log is the runner's own bytes: a missing final newline, a blank line or another key order is refused", () => {
    const own = ownedInterventions(schedule, 0, 10).map(logLine);
    for (const [what, text] of [
      ["no final newline", own.join("").replace(/\n$/, "")],
      ["a blank line between entries", own[0] + "\n" + own.slice(1).join("")],
      ["a blank line at the end", own.join("") + "\n"],
      ["another key order", own.map((l) => JSON.stringify(Object.fromEntries(Object.entries(JSON.parse(l)).reverse())) + "\n").join("")],
      ["spaces", own.map((l) => l.replace(/,/g, ", ")).join("")],
    ] as const) {
      const other = segment(0, 0, 10, { scheduled: schedule, log: text });
      expect(() => stitchRun([other, segment(1, 10, 10, { scheduled: schedule })], 20), what).toThrow(/segment #0: interventions\.jsonl is not in the runner's own format, byte for byte/);
    }
  });

  it("a feed that names its matter must have moved exactly that", () => {
    const own = ownedInterventions(schedule, 0, 10);
    const other = own.map((e, j) => (j === 3 ? logLine({ ...e, matter: -41 } as ScheduledIntervention) : logLine(e))).join("");
    expect(() => stitchRun([segment(0, 0, 10, { scheduled: schedule, log: other }), segment(1, 10, 10, { scheduled: schedule })], 20)).toThrow(/segment #0: interventions\.jsonl line 4 \(feed at t=10, r 2\) is not the scheduled feed at t=10 \(entry 3 of the schedule, effective r 2\)/);
  });

  it("refuses a segment missing the log, and the log or a block on an unscheduled run", () => {
    expect(() => stitchRun([segment(0, 0, 10, { scheduled: schedule }), segment(1, 10, 10, { scheduled: schedule, log: null })], 20)).toThrow(/segment #1: scheduled run but missing interventions\.jsonl/);
    expect(() => stitchRun([segment(0, 0, 10, { log: "" })], 10)).toThrow(/segment #0: interventions\.jsonl present on a run without scheduled interventions/);
    expect(() => stitchRun([segment(0, 0, 10, { block: { file: INTERVENTIONS_FILE, applied: 0 } })], 10)).toThrow(/segment #0: a manifest interventions block present on a run without scheduled interventions/);
  });

  it("refuses a log that is not the segment's own entries: too few, too many, another segment's, another centre", () => {
    const own = ownedInterventions(schedule, 0, 10).map(logLine);
    const short = segment(0, 0, 10, { scheduled: schedule, log: own.slice(0, 3).join("") });
    expect(() => stitchRun([short, segment(1, 10, 10, { scheduled: schedule })], 20)).toThrow(/segment #0: interventions\.jsonl holds 3 entries, the schedule has 4 at steps in \(0, 10\] and step 0/);
    const padded = segment(1, 10, 10, { scheduled: schedule, log: [...ownedInterventions(schedule, 10, 10).map(logLine), logLine(schedule[5])].join("") });
    expect(() => stitchRun([segment(0, 0, 10, { scheduled: schedule }), padded], 20)).toThrow(/segment #1: interventions\.jsonl holds 3 entries, the schedule has 2 at steps in \(10, 20\]/);
    // Segment #1's own count, but segment #0's entries: a log of another window.
    const swapped = segment(1, 10, 10, { scheduled: schedule, log: own.slice(0, 2).join("") });
    expect(() => stitchRun([segment(0, 0, 10, { scheduled: schedule }), swapped], 20)).toThrow(/segment #1: interventions\.jsonl line 1 \(lesion at t=0, r 6\) is not the scheduled lesion at t=17 \(entry 4 of the schedule, effective r \d+\)/);
    const moved = segment(0, 0, 10, { scheduled: schedule, log: [own[0].replace('"x":1', '"x":2'), ...own.slice(1)].join("") });
    expect(() => stitchRun([moved, segment(1, 10, 10, { scheduled: schedule })], 20)).toThrow(/segment #0: interventions\.jsonl line 1/);
    const otherAmount = segment(0, 0, 10, { scheduled: schedule, log: [...own.slice(0, 2), own[2].replace('"amount":16', '"amount":17'), own[3]].join("") });
    expect(() => stitchRun([otherAmount, segment(1, 10, 10, { scheduled: schedule })], 20)).toThrow(/segment #0: interventions\.jsonl line 3 \(feed at t=10, r 3\) is not the scheduled feed at t=10 \(entry 2 of the schedule, effective r 3\)/);
  });

  it("refuses a log that does not parse, a feed logged without its matter, and a block that does not count the lines", () => {
    const own = ownedInterventions(schedule, 0, 10).map(logLine);
    expect(() => stitchRun([segment(0, 0, 10, { scheduled: schedule, log: own.join("") + "{not json\n" }), segment(1, 10, 10, { scheduled: schedule })], 20)).toThrow(/segment #0: interventions\.jsonl line 5: not JSON/);
    const bare = segment(0, 0, 10, { scheduled: schedule, log: [...own.slice(0, 2), own[2].replace(',"matter":0', ""), own[3]].join("") });
    expect(() => stitchRun([bare, segment(1, 10, 10, { scheduled: schedule })], 20)).toThrow(/segment #0: interventions\.jsonl: interventions\[2\]: a logged feed needs the matter it moved/);
    for (const block of [{ file: INTERVENTIONS_FILE, applied: 3 }, { file: "other.jsonl", applied: 4 }, null, {}])
      expect(() => stitchRun([segment(0, 0, 10, { scheduled: schedule, block }), segment(1, 10, 10, { scheduled: schedule })], 20)).toThrow(/segment #0: manifest interventions block .* does not count the 4 entries of interventions\.jsonl/);
  });

  it("observationDigests reports the log when present", async () => {
    const d = await observationDigests({ "series.jsonl": "a", [INTERVENTIONS_FILE]: logLine(schedule[0]) });
    expect(Object.keys(d).sort()).toEqual([INTERVENTIONS_FILE, "series.jsonl"]);
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
