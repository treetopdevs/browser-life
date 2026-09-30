import { strict as assert } from "node:assert";
import {
  type ImprovementRow,
  summarizeDiscoveryImprovement,
} from "../lib/discovery-improvement-summary.ts";

function roster(
  founderIds = ["f0", "f1"],
  seedIds: (string | number)[] = [11, 12, 13, 14],
): ImprovementRow[] {
  return founderIds.flatMap((founderId, fi) =>
    seedIds.flatMap((seedId, si) => [
      {
        founderId,
        seedId,
        mode: "normal" as const,
        retained: true,
        technicalComplete: true,
        scores: [0.4 + fi * 0.1 + si * 0.01, 0.6 + fi * 0.1 + si * 0.01],
      },
      {
        founderId,
        seedId,
        mode: "off" as const,
        retained: false,
        technicalComplete: true,
        scores: [0.1, 0.2],
      },
    ])
  );
}
function summarize(
  rows: ImprovementRow[],
  founderIds = ["f0", "f1"],
  seedIds: (string | number)[] = [11, 12, 13, 14],
  bootstrapSeed = 12345,
  bootstrapResamples = 1000,
  expectedScoresPerRow = 2,
) {
  return summarizeDiscoveryImprovement({
    founderIds,
    seedIds,
    expectedScoresPerRow,
    rows,
    bootstrapSeed,
    bootstrapResamples,
  });
}
function approximately(actual: number | null, expected: number): void {
  assert.notEqual(actual, null);
  assert.ok(
    Math.abs(actual! - expected) < 1e-12,
    `${actual} differs from ${expected}`,
  );
}

Deno.test("complete roster gives the exact positive matched effect and retention difference", () => {
  const rows = roster();
  // Make every matched normal-minus-off score exactly 0.35.
  for (const row of rows) {
    row.scores = row.mode === "normal" ? [0.5, 0.5] : [0.15, 0.15];
  }
  const got = summarize(rows);
  assert.equal(got.technicalEvidenceComplete, true);
  assert.equal(got.allScoresAvailable, true);
  assert.deepEqual(got.effectBounds, { lower: 0.35, upper: 0.35 });
  approximately(got.pointEffect, 0.35);
  assert.equal(got.conditionalPoint.label, "conditional");
  approximately(got.conditionalPoint.estimate, 0.35);
  assert.deepEqual({
    availablePairs: got.conditionalPoint.availablePairs,
    totalPairs: got.conditionalPoint.totalPairs,
  }, { availablePairs: 8, totalPairs: 8 });
  assert.equal(got.retentionDifference, 1);
  assert.deepEqual(got.bootstrap.boundedEffect95, { lower: 0.35, upper: 0.35 });
  assert.deepEqual(got.bootstrap.pointEffect95, { lower: 0.35, upper: 0.35 });
  assert.deepEqual(got.bootstrap.retentionDifference95, { lower: 1, upper: 1 });
});

Deno.test("missing scores widen the full-range bound and stay out of conditional pairs", () => {
  const rows: ImprovementRow[] = [
    {
      founderId: "f",
      seedId: 1,
      mode: "normal",
      retained: true,
      technicalComplete: true,
      scores: [1, null],
    },
    {
      founderId: "f",
      seedId: 1,
      mode: "off",
      retained: false,
      technicalComplete: true,
      scores: [0, 0],
    },
  ];
  const got = summarize(rows, ["f"], [1], 77, 100);
  assert.deepEqual(got.effectBounds, { lower: 0, upper: 1 });
  assert.deepEqual(got.conditionalPoint, {
    label: "conditional",
    estimate: null,
    availablePairs: 0,
    totalPairs: 1,
  });
  assert.equal(got.pointEffect, null);
  assert.equal(got.bootstrap.pointEffect95, null);
  assert.equal(got.technicalEvidenceComplete, true);
  assert.equal(got.allScoresAvailable, false);
});

Deno.test("all scores missing retains the conservative [-2, 2] matched contrast", () => {
  const rows: ImprovementRow[] = [
    {
      founderId: "f",
      seedId: 1,
      mode: "normal",
      retained: true,
      technicalComplete: true,
      scores: [null, null],
    },
    {
      founderId: "f",
      seedId: 1,
      mode: "off",
      retained: false,
      technicalComplete: true,
      scores: [null, null],
    },
  ];
  const got = summarize(rows, ["f"], [1], 77, 100);
  assert.deepEqual(got.effectBounds, { lower: -2, upper: 2 });
  assert.equal(got.conditionalPoint.estimate, null);
});

Deno.test("bootstrap resamples matched seed blocks while keeping founders fixed", () => {
  const seeds = [1, 2, 3, 4, 5, 6, 7, 8];
  const oneFounder = seeds.flatMap((seedId, i): ImprovementRow[] => [
    {
      founderId: "a",
      seedId,
      mode: "normal",
      retained: true,
      technicalComplete: true,
      scores: [i === 0 ? -0.8 : 0.8],
    },
    {
      founderId: "a",
      seedId,
      mode: "off",
      retained: false,
      technicalComplete: true,
      scores: [0],
    },
  ]);
  const fourFounders = ["a", "b", "c", "d"].flatMap((founderId) =>
    oneFounder.map((row) => ({ ...row, founderId }))
  );
  const a = summarize(oneFounder, ["a"], seeds, 923, 2000, 1);
  const b = summarize(fourFounders, ["a", "b", "c", "d"], seeds, 923, 2000, 1);
  assert.deepEqual(a.bootstrap.boundedEffect95, b.bootstrap.boundedEffect95);
  assert.deepEqual(a.bootstrap.pointEffect95, b.bootstrap.pointEffect95);
  assert.deepEqual(a.bySeed.map((x) => x.lower), b.bySeed.map((x) => x.lower));
  assert.deepEqual(a, summarize(oneFounder, ["a"], seeds, 923, 2000, 1));
});

Deno.test("rejects absent and duplicate fixed-roster rows", () => {
  const rows = roster();
  assert.throws(() => summarize(rows.slice(1)), /expected exactly/);
  assert.throws(
    () => summarize([...rows.slice(0, -1), rows[0]]),
    /duplicate roster row/,
  );
});

Deno.test("rejects uniformly truncated score rows against the planned score count", () => {
  const rows = roster();
  for (const row of rows) row.scores = row.scores.slice(0, 1);
  assert.throws(
    () => summarize(rows, ["f0", "f1"], [11, 12, 13, 14], 12345, 100),
    /exactly 2 entries/,
  );
});

Deno.test("rejects malformed score arrays, scores, and flags", () => {
  const mutateAndReject = (
    change: (rows: ImprovementRow[]) => void,
    pattern: RegExp,
  ) => {
    const rows = roster();
    change(rows);
    assert.throws(() => summarize(rows), pattern);
  };
  mutateAndReject((r) => {
    r[0].scores = [0.1];
  }, /exactly 2 entries/);
  mutateAndReject((r) => {
    r[0].scores = [Number.NaN, 0];
  }, /finite numbers/);
  mutateAndReject((r) => {
    r[0].scores = [1.01, 0];
  }, /finite numbers/);
  mutateAndReject((r) => {
    r[0].retained = "yes" as unknown as boolean;
  }, /retained/);
  mutateAndReject((r) => {
    r[0].technicalComplete = 1 as unknown as boolean;
  }, /technicalComplete/);
});

Deno.test("technical incompleteness marks evidence incomplete but preserves measured summaries", () => {
  const rows = roster();
  rows[0].technicalComplete = false;
  const got = summarize(rows);
  assert.equal(got.technicalEvidenceComplete, false);
  assert.notEqual(got.pointEffect, null);
  assert.equal(got.effectBounds.lower, got.effectBounds.upper);
});

Deno.test("unknown retention suppresses the full-roster difference and its interval", () => {
  const rows = roster();
  rows[0].retained = null;
  const got = summarize(rows);
  assert.equal(got.retentionDifference, null);
  assert.equal(got.retentionKnownPairs, 7);
  assert.equal(got.bootstrap.retentionDifference95, null);
  assert.equal(got.technicalEvidenceComplete, false);
});

Deno.test("bootstrap and summary are deterministic for a supplied RNG seed", () => {
  const rows = roster();
  assert.deepEqual(
    summarize(rows, ["f0", "f1"], [11, 12, 13, 14], 555, 2000),
    summarize(rows, ["f0", "f1"], [11, 12, 13, 14], 555, 2000),
  );
});
