import { describe, expect, it } from "vitest";
import { validateResetDesign, type ResetDesign } from "../lib/reset-probe-a-auth.ts";
import { assertResetInitialOutputRoom, buildResetProbeAPlan, validateResetProbeAPlan } from
  "../lib/reset-probe-a-plan.ts";
import { assertResetAttemptReservation, resetGpuWorkerPid } from
  "../lib/reset-probe-a-guard.ts";
import type { ResetHistoryResult } from "../lib/reset-probe-a-runtime.ts";

const hash = "a".repeat(64);
const base = "/Users/nicholas/develop/browser-life-foundations/runs/foundational-reset";
function design(): ResetDesign {
  const rows = Array.from({ length: 200 }, (_, rowIndex) => {
    const h = Math.floor(rowIndex / 20) + 1;
    return { rowIndex, h, step: 1000 + rowIndex * 100, kind: "budding" as const,
      parent: 10 + rowIndex, child: 1000 + rowIndex,
      parentLineage: "0:1", childLineage: "0:1", parentPurity: 1, childPurity: 1 };
  });
  return { format: 1, id: "probe-a-design-v2",
    status: "prospective-design-not-launch-approval",
    protocol: { path: `${base}/protocol.md`, bytes: 1, sha256: hash },
    sample: { path: `${base}/pairs.json`, bytes: 1, sha256: hash, rows },
    rules: { censusEvery: 100, parentReferenceOffset: -100,
      followupReferenceOffset: 0,
      followupOffsets: Array.from({ length: 11 }, (_, i) => i * 100),
      graphs: [{ threshold: 48, neighbors: 4 }, { threshold: 1, neighbors: 8 }],
      windowPersistence: { futureOffsets: Array.from({ length: 100 }, (_, i) => i + 1),
        graph: { threshold: 1, neighbors: 8 }, completeRequiresAll100: true,
        candidateCountCutoff: null } },
    histories: Array.from({ length: 10 }, (_, i) => ({ history: i + 1, seed: i + 1,
      preset: "gradient-m3", condition: "treatment", startStep: 0,
      endStep: 1000000, rowIndices: rows.filter(r => r.h === i + 1).map(r => r.rowIndex),
      checkpointSteps: Array.from({ length: 10 }, (_, j) => (j + 1) * 100000),
      continuousWindow: { referenceStep: 100000 + 70000 * i,
        candidateStepsFirst: 100001 + 70000 * i,
        candidateStepsLast: 101000 + 70000 * i,
        followupLast: 101100 + 70000 * i, observationEvery: 1 },
      sourceDirectory: `/Users/nicholas/develop/browser-life/runs/replay-m4/gradient-m3/treatment/seed-${i + 1}` })) };
}
const plan = () => buildResetProbeAPlan(design(), `${base}/probe-a-design-v2.json`,
  hash, `${base}/frozen/manifest.json`, hash, `${base}/probe-a-run-test`, 3600, 780);
const prior = (p = plan(), status: ResetHistoryResult["status"] = "incomplete-time-cap") =>
  ({ history: 1, attempt: 1, planSha256: hash, designSha256: p.design.sha256,
    status, elapsedSeconds: 100 } as ResetHistoryResult);

describe("Prospective Probe A design and attempt gates", () => {
  it("requires all original rows, exact history placement and unrelaxed graph/window rules", () => {
    const d = design();
    expect(() => validateResetDesign(d)).not.toThrow();
    d.histories[0].rowIndices[0] = d.histories[1].rowIndices[0];
    expect(() => validateResetDesign(d)).toThrow(/history allocation/);
    d.histories[0].rowIndices[0] = 0;
    d.rules.windowPersistence.candidateCountCutoff = 10;
    expect(() => validateResetDesign(d)).toThrow(/fixed prospective/);
  });

  it("preserves all 200 not-run rows and blocks output path escapes or budget relaxation", () => {
    const p = plan();
    expect(p.allRows).toHaveLength(200);
    expect(() => validateResetProbeAPlan(p, design())).not.toThrow();
    p.allRows[0].initialStatus = "available" as never;
    expect(() => validateResetProbeAPlan(p, design())).toThrow(/preclassifies/);
    expect(() => buildResetProbeAPlan(design(), "x", hash, "y", hash,
      `${base}/../pinned-source-v1`, 3600, 780)).toThrow(/paths/);
    expect(() => buildResetProbeAPlan(design(), "x", hash, "y", hash,
      `${base}/probe-a-run-test`, 3601, 780)).toThrow(/cap/);
    expect(() => buildResetProbeAPlan(design(), "x", hash, "y", hash,
      `${base}/probe-a-run-test`, 3600, 779)).toThrow(/cap/);
  });

  it("blocks a cap-edge attempt before reservation when initial snapshot and receipt cannot fit", () => {
    expect(() => assertResetInitialOutputRoom(900, 20, 30, 1000, 50)).not.toThrow();
    expect(() => assertResetInitialOutputRoom(901, 20, 30, 1000, 50))
      .toThrow(/initial snapshot and terminal receipt/);
  });

  it("ignores typecheck processes, catches known GPU workers and refuses repeat/overbudget attempts", () => {
    expect(resetGpuWorkerPid("100 deno check tools/reset-probe-a.ts\n", 999)).toBeNull();
    expect(resetGpuWorkerPid("100 deno test -A tools/test/reset-gpu-copy-audit.deno.ts\n", 999))
      .toBe(100);
    expect(resetGpuWorkerPid("100 deno test -A tools/test/reset-gpu-copy-audit.deno.ts\n", 100))
      .toBeNull();
    const p = plan();
    expect(() => assertResetAttemptReservation(p, hash, [], 1, 1, 3600)).not.toThrow();
    expect(() => assertResetAttemptReservation(p, hash, [prior(p)], 1, 1, 3600))
      .toThrow(/next technical retry/);
    expect(() => assertResetAttemptReservation(p, hash, [prior(p)], 1, 2, 3600))
      .not.toThrow();
    expect(() => assertResetAttemptReservation(p, hash, [prior(p, "complete")], 1, 2, 3600))
      .toThrow(/complete/);
    expect(() => assertResetAttemptReservation(p, hash, [prior(p)], 1, 2, 21601))
      .toThrow(/per-history cap/);
  });
});
