// Fixed-roster, matched-seed summary for a planned founder improvement assay.
// Missing biological scores widen bounds; they are never treated as zero.
import { Random } from "./founder-policy.ts";

export type ImprovementMode = "normal" | "off";
export interface ImprovementRow {
  founderId: string;
  seedId: string | number;
  mode: ImprovementMode;
  retained: boolean | null;
  technicalComplete: boolean;
  scores: readonly (number | null)[];
}
export interface ImprovementInput {
  founderIds: readonly string[];
  seedIds: readonly (string | number)[];
  expectedScoresPerRow: number;
  rows: readonly ImprovementRow[];
  bootstrapSeed: number;
  bootstrapResamples?: number;
}
export interface ImprovementInterval {
  lower: number;
  upper: number;
}
export interface ImprovementSummary {
  format: "discovery-improvement-summary/v1";
  founderCount: number;
  seedCount: number;
  scoreCount: number;
  technicalEvidenceComplete: boolean;
  allScoresAvailable: boolean;
  effectBounds: ImprovementInterval;
  bySeed: { seedId: string | number; lower: number; upper: number }[];
  conditionalPoint: {
    label: "conditional";
    estimate: number | null;
    availablePairs: number;
    totalPairs: number;
  };
  pointEffect: number | null;
  retentionDifference: number | null;
  retentionKnownPairs: number;
  totalPairs: number;
  bootstrap: {
    seed: number;
    resamples: number;
    boundedEffect95: ImprovementInterval;
    pointEffect95: ImprovementInterval | null;
    retentionDifference95: ImprovementInterval | null;
  };
}

interface RowRange {
  lower: number;
  upper: number;
  point: number | null;
}
interface PairSummary {
  lower: number;
  upper: number;
  point: number | null;
  retention: number | null;
}

function key(
  founderId: string,
  seedId: string | number,
  mode: ImprovementMode,
): string {
  return JSON.stringify([founderId, seedId, mode]);
}

function checkId(
  value: unknown,
  name: string,
): asserts value is string | number {
  if (typeof value === "string") {
    if (!value.length) throw Error(`${name} must be nonempty`);
  } else if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw Error(`${name} must be a safe integer or nonempty string`);
    }
  } else throw Error(`${name} must be a safe integer or nonempty string`);
}

function mean(values: readonly number[]): number {
  if (!values.length) throw Error("cannot average an empty fixed roster");
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function rowRange(row: ImprovementRow): RowRange {
  let lower = 0, upper = 0, pointTotal = 0, complete = true;
  for (const score of row.scores) {
    if (score === null) {
      lower -= 1;
      upper += 1;
      complete = false;
    } else {
      lower += score;
      upper += score;
      pointTotal += score;
    }
  }
  const count = row.scores.length;
  return {
    lower: lower / count,
    upper: upper / count,
    point: complete ? pointTotal / count : null,
  };
}

function percentile(sorted: readonly number[], p: number): number {
  const at = (sorted.length - 1) * p;
  const lo = Math.floor(at), hi = Math.ceil(at);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (at - lo);
}

/**
 * Summarize normal-minus-off effects over the complete founder × seed roster.
 * Founder identities stay fixed in the bootstrap; only whole seed blocks resample.
 * Bounds are conservative because unavailable values can share cached assays.
 */
export function summarizeDiscoveryImprovement(
  input: ImprovementInput,
): ImprovementSummary {
  const { founderIds, seedIds, rows, bootstrapSeed } = input;
  const resamples = input.bootstrapResamples ?? 10_000;
  if (
    !Array.isArray(founderIds) || founderIds.length === 0 ||
    founderIds.some((id) => typeof id !== "string" || !id.length) ||
    new Set(founderIds).size !== founderIds.length
  ) throw Error("founder roster must contain unique nonempty IDs");
  if (
    !Array.isArray(seedIds) || seedIds.length === 0 ||
    new Set(seedIds.map((id) => JSON.stringify(id))).size !== seedIds.length
  ) throw Error("seed roster must contain unique IDs");
  for (const seedId of seedIds) checkId(seedId, "seed ID");
  if (!Array.isArray(rows)) throw Error("rows must be an array");
  if (
    !Number.isSafeInteger(bootstrapSeed) || bootstrapSeed < 0 ||
    bootstrapSeed > 0xffffffff
  ) throw Error("bootstrap seed must be u32");
  if (!Number.isSafeInteger(resamples) || resamples < 1) {
    throw Error("bootstrap resamples must be a positive safe integer");
  }

  const expected = founderIds.length * seedIds.length * 2;
  if (rows.length !== expected) {
    throw Error(
      `expected exactly ${expected} roster rows, received ${rows.length}`,
    );
  }
  const indexed = new Map<string, ImprovementRow>();
  const scoreCount = input.expectedScoresPerRow;
  if (!Number.isSafeInteger(scoreCount) || scoreCount < 1) {
    throw Error("expectedScoresPerRow must be a positive safe integer");
  }
  for (const row of rows) {
    if (!row || typeof row !== "object") throw Error("invalid roster row");
    if (!founderIds.includes(row.founderId)) {
      throw Error(`unexpected founder ${String(row.founderId)}`);
    }
    checkId(row.seedId, "row seed ID");
    if (!seedIds.some((seed) => Object.is(seed, row.seedId))) {
      throw Error(`unexpected seed ${String(row.seedId)}`);
    }
    if (row.mode !== "normal" && row.mode !== "off") {
      throw Error("mode must be normal or off");
    }
    if (row.retained !== null && typeof row.retained !== "boolean") {
      throw Error("retained must be boolean or null");
    }
    if (typeof row.technicalComplete !== "boolean") {
      throw Error("technicalComplete must be boolean");
    }
    if (!Array.isArray(row.scores) || row.scores.length === 0) {
      throw Error("scores must be a nonempty fixed-length array");
    }
    if (row.scores.length !== scoreCount) {
      throw Error(`each score array must have exactly ${scoreCount} entries`);
    }
    for (const score of row.scores) {
      if (
        score !== null &&
        (typeof score !== "number" || !Number.isFinite(score) || score < -1 ||
          score > 1)
      ) throw Error("scores must be null or finite numbers in [-1, 1]");
    }
    const rowKey = key(row.founderId, row.seedId, row.mode);
    if (indexed.has(rowKey)) throw Error(`duplicate roster row ${rowKey}`);
    indexed.set(rowKey, row);
  }
  // The expected row count plus validated IDs does not by itself rule out a missing row
  // paired with a duplicate; assert every Cartesian roster position explicitly.
  for (const founderId of founderIds) {
    for (const seedId of seedIds) {
      for (const mode of ["normal", "off"] as const) {
        if (!indexed.has(key(founderId, seedId, mode))) {
          throw Error(
            `missing roster row ${founderId}/${String(seedId)}/${mode}`,
          );
        }
      }
    }
  }

  const pairsBySeed: PairSummary[][] = seedIds.map((seedId) =>
    founderIds.map((founderId) => {
      const normal = rowRange(indexed.get(key(founderId, seedId, "normal"))!);
      const off = rowRange(indexed.get(key(founderId, seedId, "off"))!);
      const normalRetained =
        indexed.get(key(founderId, seedId, "normal"))!.retained;
      const offRetained = indexed.get(key(founderId, seedId, "off"))!.retained;
      return {
        lower: normal.lower - off.upper,
        upper: normal.upper - off.lower,
        point: normal.point === null || off.point === null
          ? null
          : normal.point - off.point,
        retention: normalRetained === null || offRetained === null
          ? null
          : Number(normalRetained) - Number(offRetained),
      };
    })
  );
  const bySeed = seedIds.map((seedId, i) => ({
    seedId,
    lower: mean(pairsBySeed[i].map((pair) => pair.lower)),
    upper: mean(pairsBySeed[i].map((pair) => pair.upper)),
  }));
  const effectBounds = {
    lower: mean(bySeed.map((seed) => seed.lower)),
    upper: mean(bySeed.map((seed) => seed.upper)),
  };
  const points = pairsBySeed.flat().map((pair) => pair.point).filter((
    point,
  ): point is number => point !== null);
  const totalPairs = founderIds.length * seedIds.length;
  const allPairsAvailable = points.length === totalPairs;
  const retentionValues = pairsBySeed.flat().map((pair) => pair.retention)
    .filter((value): value is number => value !== null);
  const retentionKnownPairs = retentionValues.length;
  const retentionDifference = retentionKnownPairs === totalPairs
    ? mean(retentionValues)
    : null;
  const technicalComplete = rows.every((row) => row.technicalComplete);
  const allRetainedKnown = rows.every((row) => row.retained !== null);
  const allScoresKnown = rows.every((row) =>
    row.scores.every((score: number | null) => score !== null)
  );

  const rng = new Random(bootstrapSeed);
  const bootLower: number[] = [],
    bootUpper: number[] = [],
    bootPoint: number[] = [],
    bootRetention: number[] = [];
  const retentionBySeed = pairsBySeed.map((pairs) =>
    pairs.every((pair) => pair.retention !== null)
      ? mean(pairs.map((pair) => pair.retention!))
      : null
  );
  const allRetentionAvailable = retentionBySeed.every((value) =>
    value !== null
  );
  for (let b = 0; b < resamples; b++) {
    const sampled = Array.from(
      { length: seedIds.length },
      () => rng.int(seedIds.length),
    );
    bootLower.push(mean(sampled.map((i) => bySeed[i].lower)));
    bootUpper.push(mean(sampled.map((i) => bySeed[i].upper)));
    if (allPairsAvailable) {
      bootPoint.push(
        mean(
          sampled.map((i) => mean(pairsBySeed[i].map((pair) => pair.point!))),
        ),
      );
    }
    if (allRetentionAvailable) {
      bootRetention.push(mean(sampled.map((i) => retentionBySeed[i]!)));
    }
  }
  bootLower.sort((a, b) => a - b);
  bootUpper.sort((a, b) => a - b);
  bootPoint.sort((a, b) => a - b);
  bootRetention.sort((a, b) => a - b);

  return {
    format: "discovery-improvement-summary/v1",
    founderCount: founderIds.length,
    seedCount: seedIds.length,
    scoreCount: scoreCount!,
    technicalEvidenceComplete: technicalComplete && allRetainedKnown,
    allScoresAvailable: allScoresKnown,
    effectBounds,
    bySeed,
    conditionalPoint: {
      label: "conditional",
      estimate: points.length ? mean(points) : null,
      availablePairs: points.length,
      totalPairs,
    },
    pointEffect: allPairsAvailable ? mean(points) : null,
    retentionDifference,
    retentionKnownPairs,
    totalPairs,
    bootstrap: {
      seed: bootstrapSeed,
      resamples,
      boundedEffect95: {
        lower: percentile(bootLower, 0.025),
        upper: percentile(bootUpper, 0.975),
      },
      pointEffect95: allPairsAvailable
        ? {
          lower: percentile(bootPoint, 0.025),
          upper: percentile(bootPoint, 0.975),
        }
        : null,
      retentionDifference95: allRetentionAvailable
        ? {
          lower: percentile(bootRetention, 0.025),
          upper: percentile(bootRetention, 0.975),
        }
        : null,
    },
  };
}
