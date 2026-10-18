// Unit-level (no GPU) coverage of stitchRun's pure bookkeeping: the
// observationsVerified/observationsChecked aggregate over a run's segments,
// and the per-segment metrics-version refusal. tests/deno/stitch.ts already
// checks the byte-for-byte equivalence of a stitched run against a
// continuous one using real runExperiment output; these fixtures are
// hand-built instead, so every field stitchRun actually inspects is
// satisfied deliberately rather than incidentally.
import { describe, expect, it } from "vitest";
import { METRICS_VERSION, RULE_VERSION, SCHEMA_VERSION, clampLesionRadius, maxLesionRadius } from "@bl/schema";
import { INTERVENTIONS_FILE, formatInterventionLine, observationDigests, ownedInterventions, runId, sameIntervention, specConfig, stitchRun, stitchablePrefix, type InterventionLogEntry, type RunSpec, type ScheduledIntervention, type StitchSegment } from "@bl/runner";

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
  /** Keys merged over the segment's spec (`steps` and `interventions` aside), to make one segment's spec differ. */
  specExtra?: Partial<RunSpec>;
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
  const spec = { ...baseSpec, ...opts.specExtra, steps, ...(opts.picked ? { picked: true } : {}), ...(opts.scheduled ? { interventions: opts.scheduled } : {}) };
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

// A garden (apps/coordinator README, "The garden"): the coordinator rewrites the experiment's `interventions` as letters
// arrive and are dropped, and every task carries the list as it stood at assignment, so each segment's manifest holds a
// different list. In garden mode (`{ garden: { interventions } }`) stitchRun checks each segment against its own list,
// requires the past to agree, checks the union against the coordinator's list, and stitches the union of owned entries
// (docs/garden-stitch-rule-2026-10-17.md). Days are 10 steps; F is the founding entry; a letter on day d lands at the
// day's end, (d + 1) * 10. Q and P are feeds (Q names its matter, P does not), so feed fields are under test too.
describe("stitchRun joins a garden's segments (each carries the schedule as of its assignment)", () => {
  const F: ScheduledIntervention = { step: 0, kind: "lesion", x: 1, y: 2, r: 3 };
  const A: ScheduledIntervention = { step: 10, kind: "lesion", x: 3, y: 3, r: 2 };
  const Q: ScheduledIntervention = { step: 10, kind: "feed", x: 2, y: 6, r: 1, amount: -2, matter: -10 };
  const B: ScheduledIntervention = { step: 20, kind: "lesion", x: 4, y: 4, r: 2 };
  const P: ScheduledIntervention = { step: 20, kind: "feed", x: 5, y: 1, r: 2, amount: 3 };
  const X: ScheduledIntervention = { step: 30, kind: "lesion", x: 5, y: 5, r: 2 }; // posted for day 2, dropped before day 2 was assigned
  const C: ScheduledIntervention = { step: 30, kind: "lesion", x: 6, y: 6, r: 2 };
  const D: ScheduledIntervention = { step: 40, kind: "lesion", x: 7, y: 7, r: 2 }; // a live letter for day 3, beyond the prefix
  const L0 = [F, A, Q], L1 = [F, A, Q, B, P, X], L2 = [F, A, Q, B, P, C];
  const FINAL = [F, A, Q, B, P, C, D]; // the coordinator's list now
  const day = (d: number, list: ScheduledIntervention[], o: Opts = {}) => segment(d, d * 10, 10, { scheduled: list, ...o });
  const garden = (l2: ScheduledIntervention[] = L2, o2: Opts = {}) => [day(0, L0), day(1, L1), day(2, l2, o2)];
  const asGarden = (segs: StitchSegment[], total: number, list: ScheduledIntervention[] = FINAL) => stitchRun(segs, total, { garden: { interventions: list } });
  const manifestOf = (out: Record<string, string>) => JSON.parse(out["manifest.json"]);
  const as = (e: object) => e as ScheduledIntervention;
  const { matter: _m, ...Qbare } = Q as { matter?: number };

  it("letters added between days are joined in order and the union is the stitched schedule", () => {
    const segs = garden();
    const out = asGarden(segs, 30);
    expect(out[INTERVENTIONS_FILE]).toBe(L2.map(logLine).join(""));
    const m = manifestOf(out);
    expect(m.spec.interventions).toEqual(L2);
    expect(m.interventions).toEqual({ file: INTERVENTIONS_FILE, applied: 6 });
    expect(segs.map((s) => JSON.parse(s.files["manifest.json"]).interventions.applied)).toEqual([3, 2, 1]);
    // An ordinary stitch (one list everywhere) refuses these: the lists really differ.
    expect(() => stitchRun(segs, 30)).toThrow(/segment #1: spec differs from segment #0's/);
  });

  it("a letter dropped before its day was assigned is not history", () => {
    const m = manifestOf(asGarden(garden(), 30));
    expect(m.spec.interventions.some((e: ScheduledIntervention) => sameIntervention(e, C))).toBe(true);
    expect(m.spec.interventions.some((e: ScheduledIntervention) => sameIntervention(e, X))).toBe(false);
    // A two-day prefix, with X still in day 1's list: X is after the stitched end, so the union is [F, A, Q, B, P].
    const two = asGarden([day(0, L0), day(1, L1)], 20);
    expect(manifestOf(two).spec.interventions).toEqual([F, A, Q, B, P]);
    expect(two[INTERVENTIONS_FILE]).toBe([F, A, Q, B, P].map(logLine).join(""));
  });

  it("a later segment may not rewrite an earlier day, in any field", () => {
    const d1 = /\(10, 20\]/, d0 = /\(0, 10\]/, s0 = /step 0/;
    const cases: [string, ScheduledIntervention[], RegExp][] = [
      ["day 1's letter moved in x", [F, A, Q, as({ ...B, x: 9 }), P, C], d1],
      ["day 1's letter moved in y", [F, A, Q, as({ ...B, y: 9 }), P, C], d1],
      ["day 1's letter as a feed at the same place", [F, A, Q, as({ ...B, kind: "feed", amount: 1 }), P, C], d1],
      ["day 1's feed with another amount", [F, A, Q, B, as({ ...P, amount: 4 }), C], d1],
      ["day 1's feed naming matter it did not", [F, A, Q, B, as({ ...P, matter: 0 }), C], d1],
      ["day 1's feed as a lesion at the same place", [F, A, Q, B, as({ step: 20, kind: "lesion", x: 5, y: 1, r: 2 }), C], d1],
      ["day 0's feed without its matter", [F, A, as(Qbare), B, P, C], d0],
      ["day 0's feed with other matter", [F, A, as({ ...Q, matter: -11 }), B, P, C], d0],
      ["an extra entry in day 1's window, before its letters", [F, A, Q, as({ ...B, step: 15 }), B, P, C], d1],
      ["an extra entry in day 1's window, after its letters", [F, A, Q, B, P, as({ ...B, x: 8 }), C], d1],
      ["day 1's letter missing", [F, A, Q, P, C], d1],
      ["the founding entry missing", [A, Q, B, P, C], s0],
      ["the founding entry with another r", [as({ ...F, r: 4 }), A, Q, B, P, C], s0],
      ["a founding entry day 0 never had", [F, as({ ...F, x: 9 }), A, Q, B, P, C], s0],
    ];
    for (const [what, l2, where] of cases) {
      expect(() => asGarden(garden(l2), 30), what).toThrow(/segment #2: its schedule rewrites history: entries at steps <= 20 are not the ones segments #0\.\.#1 applied/);
      expect(() => asGarden(garden(l2), 30), what).toThrow(where);
    }
    // Two entries at one step are applied in list order, so swapping them is another history.
    const A20 = as({ ...A, step: 20 });
    const swapped = [day(0, [F]), day(1, [F, A20, B]), day(2, [F, B, A20, C])];
    expect(() => asGarden(swapped, 30, [F, A20, B, C])).toThrow(/segment #2: its schedule rewrites history.*first difference at entry 1.*segment #1's window \(10, 20\]/);
    expect(() => asGarden([day(0, [F]), day(1, [F, A20, B]), day(2, [F, A20, B, C])], 30, [F, A20, B, C])).not.toThrow();
    // Day 1 rewriting day 0 is refused the same way.
    expect(() => asGarden([day(0, L0), day(1, [F, as({ ...A, y: 9 }), Q, B, P])], 20)).toThrow(/segment #1: its schedule rewrites history.*segment #0's window \(0, 10\]/);
  });

  it("a segment logs only its own entries, from its own list", () => {
    // Day 1 also logging X, an entry after its end (speculative in its list).
    const padded = day(1, L1, { log: [B, P, X].map(logLine).join("") });
    expect(() => asGarden([day(0, L0), padded, day(2, L2)], 30)).toThrow(/segment #1: interventions\.jsonl holds 3 entries, the schedule has 2/);
    // Day 1 logging day 2's letter C at its own step, in place of its letter B.
    const other = day(1, L1, { log: [as({ ...C, step: 20 }), P].map(logLine).join("") });
    expect(() => asGarden([day(0, L0), other, day(2, L2)], 30)).toThrow(/segment #1: interventions\.jsonl line 1 .* is not the scheduled lesion at t=20/);
    // Day 2 logging X, its own list's entry being C.
    expect(() => asGarden(garden(L2, { log: logLine(X) }), 30)).toThrow(/segment #2: interventions\.jsonl line 1 .* is not the scheduled lesion at t=30/);
  });

  it("each segment's list is validated", () => {
    expect(() => asGarden(garden([...L2, as({ ...C, step: 25 })]), 30)).toThrow(/segment #2: .*steps must not decrease/);
    expect(() => asGarden(garden([F, A, Q, B, P, as({ ...C, colour: 1 })]), 30)).toThrow(/segment #2: .*has no key "colour"/);
    expect(() => asGarden(garden([]), 30)).toThrow(/segment #2: .*non-empty array/);
  });

  it("the coordinator's list must match the union over the stitched range", () => {
    expect(() => asGarden(garden(), 30, L2)).not.toThrow();
    // A live letter after the prefix (and the list written with another key order, as JSON from elsewhere would be).
    const reordered = L2.map((e) => Object.fromEntries(Object.entries(e).reverse()) as ScheduledIntervention);
    expect(() => asGarden(garden(), 30, [...reordered, D])).not.toThrow();
    expect(() => asGarden(garden(), 30, [F, A, Q, as({ ...B, x: 9 }), P, C])).toThrow(/the stitched schedule is not the coordinator's over \[0, 30\]: at entry 3/);
    expect(() => asGarden(garden(), 30, [F, A, Q, B, as({ ...P, amount: 4 }), C])).toThrow(/the stitched schedule is not the coordinator's.*at entry 4/);
    expect(() => asGarden(garden(), 30, [F, A, as(Qbare), B, P, C])).toThrow(/the stitched schedule is not the coordinator's.*at entry 2/);
    expect(() => asGarden(garden(), 30, [F, A, Q, P, C])).toThrow(/the stitched schedule is not the coordinator's/);
    expect(() => asGarden(garden(), 30, [F, A, Q, B, P, X])).toThrow(/the stitched schedule is not the coordinator's/);
    expect(() => asGarden(garden(), 30, [...L2, as({ ...C, x: 1 })])).toThrow(/the stitched schedule is not the coordinator's.*at entry 6/);
    expect(() => asGarden(garden(), 30, [as({ ...F, colour: 1 }), ...L2.slice(1)])).toThrow(/the coordinator's schedule: .*has no key "colour"/);
    // Day 0 forging an entry in its own window, in its list and its log alike, and every later day repeating it: no
    // segment contradicts another, so only the coordinator's list catches it.
    const E = as({ ...A, step: 5 });
    const forged = [day(0, [F, E, A, Q]), day(1, [F, E, A, Q, B, P]), day(2, [F, E, A, Q, B, P, C])];
    expect(() => asGarden(forged, 30)).toThrow(/the stitched schedule is not the coordinator's over \[0, 30\]: at entry 1 the segments applied .*"step":5/);
    expect(() => asGarden(forged, 30, [F, E, ...L2.slice(1)])).not.toThrow();
  });

  it("garden mode needs a schedule on every segment", () => {
    expect(() => asGarden([segment(0, 0, 10)], 10, [F])).toThrow(/segment #0's spec has no interventions, but a garden always has a schedule/);
    expect(() => asGarden([day(0, L0), segment(1, 10, 10)], 20)).toThrow(/segment #1: spec differs from segment #0's \(a garden's segment whose spec has no interventions\)/);
  });

  it("other spec differences are still refused", () => {
    expect(() => asGarden([day(0, L0), day(1, L1, { specExtra: { deepEvery: 999 } })], 20)).toThrow(/segment #1: spec differs from segment #0's$/);
  });
});

// Ordinary scheduled runs keep the rule from before the garden mode: one list on every segment, the stitched spec carries
// it whole (entries after the last step too, as a continuous run's manifest does), and owning nothing is no error.
describe("stitchRun on an ordinary scheduled run is as before the garden mode", () => {
  const F: ScheduledIntervention = { step: 0, kind: "lesion", x: 1, y: 2, r: 3 };
  const A: ScheduledIntervention = { step: 10, kind: "lesion", x: 3, y: 3, r: 2 };
  const B: ScheduledIntervention = { step: 20, kind: "lesion", x: 4, y: 4, r: 2 };
  const late: ScheduledIntervention = { ...B, step: 25 };
  const two = (l0: ScheduledIntervention[], l1 = l0) => [segment(0, 0, 10, { scheduled: l0 }), segment(1, 10, 10, { scheduled: l1 })];
  const manifestOf = (out: Record<string, string>) => JSON.parse(out["manifest.json"]);

  it("one list everywhere: the stitched spec is the last segment's, widened", () => {
    const schedule = [F, A, B];
    const out = stitchRun(two(schedule), 20);
    expect(JSON.stringify(manifestOf(out).spec)).toBe(JSON.stringify({ ...JSON.parse(two(schedule)[1].files["manifest.json"]).spec, steps: 20 }));
    expect(manifestOf(out).interventions).toEqual({ file: INTERVENTIONS_FILE, applied: 3 });
  });

  it("lists that differ between segments are refused", () => {
    expect(() => stitchRun(two([F], [F, B]), 20)).toThrow(/segment #1: spec differs from segment #0's/);
    expect(() => stitchRun([segment(0, 0, 10, { scheduled: [F] }), segment(1, 10, 10)], 20)).toThrow(/segment #1: spec differs from segment #0's/);
  });

  it("an entry after the last step stays in the spec, unapplied; a run owning nothing stitches with an empty log", () => {
    const m = manifestOf(stitchRun(two([F, A, B, late]), 20));
    expect(m.spec.interventions).toEqual([F, A, B, late]);
    expect(m.interventions).toEqual({ file: INTERVENTIONS_FILE, applied: 3 });
    const none = stitchRun(two([late]), 20);
    expect(none[INTERVENTIONS_FILE]).toBe("");
    expect(manifestOf(none).spec.interventions).toEqual([late]);
    expect(manifestOf(none).interventions).toEqual({ file: INTERVENTIONS_FILE, applied: 0 });
  });
});

describe("stitchablePrefix: a garden's exportable days", () => {
  const segs = (...statuses: string[]) => statuses.map((status, index) => ({ index, status }));
  it("counts the days from 0 that are verified, or done too with allowUnverified", () => {
    expect(stitchablePrefix(segs("verified", "verified", "done", "verified"), false)).toBe(2);
    expect(stitchablePrefix(segs("verified", "verified", "done", "verified"), true)).toBe(4);
    expect(stitchablePrefix(segs("verified", "verified", "done", "pending"), true)).toBe(3);
    expect(stitchablePrefix(segs("done", "verified"), false)).toBe(0);
    expect(stitchablePrefix(segs("done", "verified"), true)).toBe(2);
    expect(stitchablePrefix(segs("verified", "diverged", "blocked"), false)).toBe(1);
    for (const status of ["pending", "running", "failed", "diverged", "blocked"]) expect(stitchablePrefix(segs("verified", status, "verified"), true), status).toBe(1);
    expect(stitchablePrefix([], false)).toBe(0);
  });
  it("reads the indices, not the order; a missing index ends the prefix; a repeated one is an error", () => {
    expect(stitchablePrefix([{ index: 2, status: "verified" }, { index: 0, status: "verified" }, { index: 1, status: "verified" }], false)).toBe(3);
    expect(stitchablePrefix([{ index: 1, status: "verified" }, { index: 2, status: "verified" }], false)).toBe(0);
    expect(stitchablePrefix([{ index: 0, status: "verified" }, { index: 2, status: "verified" }], false)).toBe(1);
    expect(() => stitchablePrefix([{ index: 0, status: "verified" }, { index: 0, status: "done" }], true)).toThrow(/segment #0 is listed twice/);
  });
});
