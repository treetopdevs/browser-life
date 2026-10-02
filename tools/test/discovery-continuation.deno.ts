// Run: deno test --no-lock -A tools/test/discovery-continuation.deno.ts
// Reads the completed study's checkpoints for one history; no GPU, no competitions.
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import {
  assayCacheKey,
  validateManifest,
} from "../lib/discovery-improvement-runtime.ts";
import {
  buildRoster,
  type ImprovementReport,
  slotsOf,
} from "../lib/discovery-divergence-control.ts";
import {
  analyzeContinuation,
  ancestorIn,
  buildContinuationRoster,
  type ContinuationRoster,
  describeRoster,
  type HistoryAncestry,
  type Outcome,
} from "../lib/discovery-continuation.ts";
import { REPORT_SHA256 } from "../discovery_divergence_control.ts";
import { ancestry, HISTORIES } from "../discovery_continuation.ts";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const STUDY = join(ROOT, "experiments/founder-discovery/v1/improvement-study");
const MANIFEST = join(STUDY, "manifest.json");
const ROSTER = join(
  ROOT,
  "experiments/founder-discovery/v1/continuation/roster.json",
);
const manifest = validateManifest(
  JSON.parse(await Deno.readTextFile(MANIFEST)),
);
const report = JSON.parse(
  await Deno.readTextFile(
    join(STUDY, "distribution-v1/analysis-v1/report.json"),
  ),
) as ImprovementReport;
const rosterText = await Deno.readTextFile(ROSTER);
const roster = JSON.parse(rosterText) as ContinuationRoster;
const stored = (r: ContinuationRoster): HistoryAncestry[] =>
  r.histories.map((history) => ({
    history,
    ancestors: r.ancestors.filter((a) => a.unitId === history.unitId),
  }));

const changed = (a: readonly number[], b: readonly number[]) =>
  a.flatMap((v, i) => (b[i] === v ? [] : [i]));
const weightMagnitudes = (a: readonly number[], b: readonly number[]) =>
  changed(a, b).filter((i) => i < 160).map((i) => Math.abs(b[i] - a[i])).sort((
    x,
    y,
  ) => x - y);
const parameterChanges = (a: readonly number[], b: readonly number[]) =>
  changed(a, b).filter((i) => i >= 160).map((i) => [i, Math.abs(b[i] - a[i])]);

Deno.test("ancestor walk stops at the first lineage present at the midpoint", () => {
  const parentOf = new Map([["c", "b"], ["b", "a"]]);
  assert.deepEqual(ancestorIn("c", parentOf, new Map([["a", 1]])), {
    key: "a",
    generations: 2,
  });
  assert.deepEqual(ancestorIn("c", parentOf, new Map([["c", 1], ["a", 1]])), {
    key: "c",
    generations: 0,
  });
  assert.throws(
    () => ancestorIn("c", parentOf, new Map([["z", 1]])),
    /no midpoint ancestor/,
  );
});

Deno.test("ancestry re-verifies a history's chain and re-derives the roster's entries", async () => {
  const unitId = "discovery-cluster-139-6410003-normal";
  const { ancestry: a } = await ancestry(
    report,
    MANIFEST,
    join(ROOT, HISTORIES),
    [unitId],
  );
  assert.equal(a.length, 1);
  assert.deepEqual(a[0].history, roster.histories.find((h) => h.unitId === unitId));
  assert.deepEqual(
    a[0].ancestors,
    roster.ancestors.filter((x) => x.unitId === unitId),
  );
});

Deno.test("roster re-derives exactly and pairs each late draw with its own midpoint ancestor", () => {
  const rebuilt = buildContinuationRoster(
    report,
    REPORT_SHA256,
    manifest,
    stored(roster),
  );
  assert.equal(JSON.stringify(rebuilt, null, 2) + "\n", rosterText);
  const base = buildRoster(report, REPORT_SHA256, manifest);
  assert.deepEqual(rebuilt.replay, base.replay);
  assert.deepEqual(
    [rebuilt.counts.pairs, rebuilt.counts.lateGenomes, rebuilt.counts.nullGenomes],
    [64, 64, 128],
  );
  const genome = new Map(rebuilt.genomes.map((g) => [g.id, g]));
  for (const p of rebuilt.pairs) {
    const late = genome.get(p.lateGenomeId)!;
    const e = base.evolved.find((x) => x.drawId === p.lateDrawId)!;
    const a = rebuilt.ancestors.find((x) =>
      x.unitId === p.unitId && x.draw === p.draw
    )!;
    assert.equal(late.descendantHex, e.descendantHex);
    assert.equal(late.ancestorHex, a.ancestorHex);
    assert.equal(p.generations, a.generations);
    const h = slotsOf(late.ancestorHex), l = slotsOf(late.descendantHex);
    assert.equal(p.slotsChanged, changed(h, l).length);
    assert.equal(p.lateEqualsMidpoint, p.slotsChanged === 0);
    assert.equal(p.nulls.length, 2);
    for (const n of p.nulls) {
      const g = genome.get(n.genomeId)!;
      assert.equal(g.ancestorHex, late.ancestorHex);
      const x = slotsOf(g.descendantHex);
      assert.deepEqual(weightMagnitudes(h, x), weightMagnitudes(h, l));
      assert.deepEqual(parameterChanges(h, x), parameterChanges(h, l));
    }
  }
  const keys = new Set(rebuilt.assays.map((a) => a.cacheKey));
  assert.equal(keys.size, rebuilt.assays.length);
  for (const g of rebuilt.genomes) {
    assert.equal(g.cacheKeys.length, 8);
    assert.ok(g.cacheKeys.every((k) => keys.has(k)));
  }
  for (const a of rebuilt.assays) {
    assert.equal(
      a.cacheKey,
      assayCacheKey(
        a.descendantHex,
        a.ancestorHex,
        a.assaySeed,
        a.assignment,
        manifest.sourceManifestHash,
      ),
    );
  }
  assert.equal(
    rebuilt.counts.newConfigurations + rebuilt.counts.sharedConfigurations,
    192 * 8,
  );
});

Deno.test("a midpoint ancestor equal to its late genome shares one configuration; mismatched ancestry refuses", () => {
  const p = roster.pairs.find((x) => !x.lateEqualsMidpoint)!;
  const lateHex = roster.genomes.find((g) => g.id === p.lateGenomeId)!
    .descendantHex;
  const h = stored(roster).map((x) => ({
    history: x.history,
    ancestors: x.ancestors.map((a) =>
      a.unitId === p.unitId && a.draw === p.draw
        ? { ...a, ancestorHex: lateHex, generations: 0 }
        : a
    ),
  }));
  const r = buildContinuationRoster(report, REPORT_SHA256, manifest, h);
  const pair = r.pairs.find((x) => x.pairId === p.pairId)!;
  assert.deepEqual([pair.lateEqualsMidpoint, pair.slotsChanged], [true, 0]);
  const ids = [pair.lateGenomeId, ...pair.nulls.map((n) => n.genomeId)];
  assert.equal(
    new Set(ids.map((id) => r.genomes.find((g) => g.id === id)!.cacheKeys.join()))
      .size,
    1,
  );
  assert.ok(r.counts.sharedConfigurations >= 16);
  assert.throws(
    () => buildContinuationRoster(report, REPORT_SHA256, manifest, h.slice(1)),
    /do not match|does not match/,
  );
  const swapped = h.map((x, i) =>
    i ? x : { ...x, ancestors: [...x.ancestors].reverse() }
  );
  assert.throws(
    () => buildContinuationRoster(report, REPORT_SHA256, manifest, swapped),
    /does not match/,
  );
  const wrongLate = h.map((x, i) =>
    i ? x : {
      ...x,
      ancestors: x.ancestors.map((a, d) =>
        d ? a : { ...a, lateHex: x.ancestors[1].lateHex + "0" }
      ),
    }
  );
  assert.throws(
    () => buildContinuationRoster(report, REPORT_SHA256, manifest, wrongLate),
    /does not match late draw/,
  );
});

type Arm = "late" | "null";
function outcomes(
  r: ContinuationRoster,
  score: (arm: Arm, founderId: string, seed: number) => number,
  drop = 0,
): Map<string, Outcome> {
  const out = new Map<string, Outcome>();
  for (const g of r.genomes) {
    for (const k of g.cacheKeys) {
      if (!out.has(k)) {
        out.set(k, { status: "scored", score: score(g.arm, g.founderId, g.seed) });
      }
    }
  }
  for (const k of [...out.keys()].slice(0, drop)) out.set(k, null);
  return out;
}
const flat = (late: number, nul: number) => (arm: Arm) =>
  arm === "late" ? late : nul;
const complete = {
  replay: { expected: 8, matched: 8 },
  audits: { total: 3, matched: 3 },
  bootstrapResamples: 200,
};
const readAll = (score: (arm: Arm, f: string, s: number) => number) =>
  analyzeContinuation({ roster, results: outcomes(roster, score), ...complete })
    .continuation;

Deno.test("readings follow the protocol's fixed table, with progress counted per seed", () => {
  assert.equal(roster.counts.sharedConfigurations, 0);
  const all = (x: unknown) => Array(4).fill(x);
  assert.ok(readAll(flat(0.5, 0)).every((c) =>
    c.certifiedSeeds === 8 && c.lateCertifiedSeeds === 8 && c.criterionMet &&
    c.reading.startsWith("met, continued beyond divergence")
  ));
  assert.ok(readAll(flat(0.6, 0.3)).every((c) =>
    c.reading.startsWith("met, partly divergence")
  ));
  assert.ok(readAll(flat(0.05, -0.2)).every((c) =>
    c.reading.startsWith("met, not clearly progressing")
  ));
  assert.deepEqual(
    readAll(flat(0.3, 0.25)).map((c) => [c.certifiedSeeds, c.criterionMet]),
    all([0, false]),
  );
  // Exactly at the threshold is not certified.
  assert.deepEqual(readAll(flat(0.1, 0)).map((c) => c.certifiedSeeds), all(0));
  // A large founder-level mean carried by six seeds is not progress in typical seeds.
  const seeds = [...new Set(roster.pairs.map((p) => p.seed))].sort();
  const lumpy = readAll((arm, _f, seed) =>
    arm === "null" ? -0.5 : seeds.indexOf(seed) < 6 ? 0.9 : 0
  );
  assert.ok(lumpy.every((c) =>
    c.certifiedSeeds === 8 && c.lateCertifiedSeeds === 6 && c.late.lower > 0.1 &&
    c.reading.startsWith("met, not clearly progressing")
  ));
});

Deno.test("a missing result or replay makes the study technically incomplete with conservative bounds", () => {
  const a = analyzeContinuation({
    roster,
    results: outcomes(roster, flat(0.5, 0), 1),
    ...complete,
  });
  assert.equal(a.technicalComplete, false);
  assert.equal(a.missingNewResults, 1);
  assert.ok(a.continuation.every((c) => c.reading === "technically incomplete"));
  const unit = a.units.find((u) => u.contrast.point === null)!;
  assert.ok(unit.contrast.lower < unit.contrast.upper);
  const cases: [
    { expected: number; matched: number },
    { total: number; matched: number },
  ][] = [
    [{ expected: 8, matched: 7 }, complete.audits],
    [complete.replay, { total: 3, matched: 2 }],
  ];
  for (const [replay, audits] of cases) {
    assert.equal(
      analyzeContinuation({
        roster,
        results: outcomes(roster, flat(0.5, 0)),
        replay,
        audits,
      }).technicalComplete,
      false,
    );
  }
});

Deno.test("roster description is fixed before results and counts sweep carriage", () => {
  const d = describeRoster(roster);
  assert.deepEqual(d.map((x) => [x.founderId, x.pairs]), [
    ["discovery-cluster-33", 16],
    ["discovery-cluster-4", 16],
    ["discovery-cluster-16", 16],
    ["discovery-cluster-139", 16],
  ]);
  for (const x of d) {
    assert.equal(
      x.sweep === null,
      !["discovery-cluster-33", "discovery-cluster-139"].includes(x.founderId),
    );
    if (x.sweep) {
      assert.equal(
        x.sweep.lateCarries,
        x.sweep.midpointCarries + x.sweep.gainedAfterMidpoint -
          x.sweep.lostAfterMidpoint,
      );
    }
  }
});
