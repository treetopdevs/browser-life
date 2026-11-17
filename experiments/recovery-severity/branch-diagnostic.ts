import {
  canonicalObserverJSON,
  cellCount,
  CH,
  type WorldState,
} from "@bl/schema";
import { census } from "@bl/metrics";
import { OBSERVER_VERSION } from "../recovery-accessibility/observer.ts";
import { validateTrack } from "./continuity.ts";
import { type branchTrace, returnTime } from "./parity.ts";
import type { SeverityTarget } from "./selector.ts";

export const STAGE0_VERSION = "recovery-severity-stage0-v4";
export type Trace = Awaited<ReturnType<typeof branchTrace>>;
export type Arm = "legacy" | "mass-targeted" | "sham";
export interface BranchFacts {
  id: string;
  arm: Arm;
  referenceMass: number;
  startStep: number;
  injury: {
    lesionApplied: boolean;
    destroyedTargetMass: number;
    originalCellsInRemnant: number;
  };
}
export interface Difference {
  offset: number;
  fast: { label: number | null; mass: number };
  slow: { label: number | null; mass: number };
}
export interface BranchDiagnostic {
  version: typeof STAGE0_VERSION;
  observerVersion: typeof OBSERVER_VERSION;
  facts: BranchFacts;
  grids: { cpu25: 25; gpu25: 25; gpu50: 50; horizon: 2000 };
  physicalParity: {
    ok: boolean;
    sameCadenceOffsets: number[];
    sharedCadenceOffsets: number[];
  };
  sameCadenceObserverParity: { ok: boolean };
  cadenceConcordance: {
    ok: boolean;
    firstDisagreement: number | null;
    disagreements: Difference[];
  };
  continuity: Record<
    "fast" | "slow",
    {
      initialLabel: number | null;
      initialMass: number;
      splitAt: number | null;
      mergedAt: number | null;
      lostAt: number | null;
      merged: boolean;
      lost: boolean;
    }
  >;
  endpoint: {
    status:
      | "TECHNICAL-FAILURE"
      | "CADENCE-DISAGREEMENT"
      | "CONTINUITY-FAILURE"
      | "RETURN"
      | "NO-RETURN";
    T: number | null;
    cleanRecovery: boolean | null;
    shamSuccess: boolean | null;
  };
  stage0: "PASS" | "TECHNICAL-STOP";
}

/** Validate completeness before any interpretation, including failed biological tracks. */
export function validateTrace(
  trace: Trace,
  facts: BranchFacts,
  cadence: 25 | 50,
): void {
  if (
    !Number.isSafeInteger(facts.referenceMass) || facts.referenceMass <= 0 ||
    !Number.isSafeInteger(facts.startStep) || facts.startStep < 0
  ) throw new Error("invalid branch reference");
  if (trace.cadence !== cadence || trace.rows.length !== 2000 / cadence + 1) {
    throw new Error("incomplete/wrong observation grid");
  }
  validateTrack(trace.track, facts.referenceMass, cadence, facts.startStep);
  const first = trace.rows[0];
  if (
    first.offset !== 0 || first.label !== trace.track.initialLabel ||
    first.mass !== trace.initialMass ||
    !Number.isSafeInteger(trace.initialMass) || trace.initialMass < 0 ||
    (first.label === null && first.mass !== 0) ||
    (first.label !== null &&
      (!Number.isInteger(first.label) || first.label < 0 || first.mass < 128))
  ) throw new Error("invalid trace initialization");
  for (let i = 0; i < trace.rows.length; i++) {
    const row = trace.rows[i];
    if (
      row.offset !== i * cadence || typeof row.identity !== "string" ||
      !row.identity
    ) throw new Error("invalid trace observation");
    if (i) {
      const h = trace.track.history[i - 1];
      if (
        row.label !== h.label || row.mass !== h.mass ||
        row.offset !== h.step - facts.startStep
      ) throw new Error("trace/history disagreement");
    }
  }
}

/** Physical and retained-component comparisons are deliberately separate. */
export function physicalDifferences(fast: Trace, slow: Trace): number[] {
  return slow.rows.filter((row) =>
    fast.rows.find((other) => other.offset === row.offset)?.identity !==
      row.identity
  ).map((row) => row.offset);
}
export function componentDifferences(fast: Trace, slow: Trace): Difference[] {
  return slow.rows.flatMap((row) => {
    const other = fast.rows.find((r) => r.offset === row.offset);
    if (!other) throw new Error("missing shared observation");
    return other.label === row.label && other.mass === row.mass ? [] : [{
      offset: row.offset,
      fast: { label: other.label, mass: other.mass },
      slow: { label: row.label, mass: row.mass },
    }];
  });
}
const continuity = (trace: Trace, start: number) => {
  const first = (key: "split" | "merged" | "lost") =>
    trace.track.history.find((r) => r[key])?.step;
  return {
    initialLabel: trace.track.initialLabel,
    initialMass: trace.initialMass,
    splitAt: first("split") === undefined ? null : first("split")! - start,
    mergedAt: first("merged") === undefined ? null : first("merged")! - start,
    lostAt: trace.track.initialLabel === null
      ? 0
      : first("lost") === undefined
      ? null
      : first("lost")! - start,
    merged: trace.track.merged,
    lost: trace.track.lost,
  };
};

/** Reporting repair only: a valid cadence disagreement still stops Stage 0. */
export function diagnoseBranch(
  facts: BranchFacts,
  cpu: Trace,
  fast: Trace,
  slow: Trace,
): BranchDiagnostic {
  validateTrace(cpu, facts, 25);
  validateTrace(fast, facts, 25);
  validateTrace(slow, facts, 50);
  const sameCadenceOffsets = physicalDifferences(cpu, fast),
    sharedCadenceOffsets = physicalDifferences(fast, slow);
  const differences = componentDifferences(fast, slow);
  const sameObserver =
    canonicalObserverJSON(cpu.track) === canonicalObserverJSON(fast.track) &&
    componentDifferences(cpu, fast).length === 0;
  // The same label in the same physical state cannot have two different masses.
  const inconsistentMass = differences.some((d) =>
    d.fast.label === d.slow.label
  );
  const technical = !!sameCadenceOffsets.length ||
    !!sharedCadenceOffsets.length || !sameObserver || inconsistentMass;
  const T = technical
    ? null
    : returnTime(fast, slow, facts.referenceMass, facts.startStep);
  const {
    lesionApplied,
    destroyedTargetMass: damage,
    originalCellsInRemnant: overlap,
  } = facts.injury;
  if (
    ![damage, overlap].every((v) => Number.isSafeInteger(v) && v >= 0) ||
    damage > facts.referenceMass || (facts.arm === "sham") === lesionApplied
  ) throw new Error("invalid injury facts");
  const clean = !technical && differences.length === 0 && lesionApplied &&
    overlap > 0 && 5 * fast.initialMass <= 4 * facts.referenceMass &&
    5 * damage >= facts.referenceMass && 2 * damage <= facts.referenceMass &&
    fast.track.recovered && slow.track.recovered;
  return {
    version: STAGE0_VERSION,
    observerVersion: OBSERVER_VERSION,
    facts,
    grids: { cpu25: 25, gpu25: 25, gpu50: 50, horizon: 2000 },
    physicalParity: {
      ok: !sameCadenceOffsets.length && !sharedCadenceOffsets.length,
      sameCadenceOffsets,
      sharedCadenceOffsets,
    },
    sameCadenceObserverParity: { ok: sameObserver },
    cadenceConcordance: {
      ok: differences.length === 0,
      firstDisagreement: differences[0]?.offset ?? null,
      disagreements: differences,
    },
    continuity: {
      fast: continuity(fast, facts.startStep),
      slow: continuity(slow, facts.startStep),
    },
    endpoint: {
      status: technical
        ? "TECHNICAL-FAILURE"
        : differences.length
        ? "CADENCE-DISAGREEMENT"
        : fast.track.lost || slow.track.lost || fast.track.merged ||
            slow.track.merged
        ? "CONTINUITY-FAILURE"
        : T !== 2025
        ? "RETURN"
        : "NO-RETURN",
      T,
      cleanRecovery: technical || facts.arm === "sham" ? null : clean,
      shamSuccess: technical || facts.arm !== "sham"
        ? null
        : !differences.length && fast.track.recovered && slow.track.recovered,
    },
    stage0: technical || differences.length ? "TECHNICAL-STOP" : "PASS",
  };
}

/** Measured from immutable grown/post checkpoints, never later recovery. */
export function injuryFacts(
  grown: WorldState,
  post: WorldState,
  target: SeverityTarget,
  label: number | null,
  lesionApplied: boolean,
): BranchFacts["injury"] {
  const n = cellCount(grown.cfg),
    c = census({
      cfg: post.cfg,
      step: post.step,
      cells: post.cells,
      genomeHead: post.genome,
    }, { threshold: 48, minMass: 128 });
  return {
    lesionApplied,
    destroyedTargetMass: target.cells.reduce(
      (sum, i) =>
        sum + grown.cells[CH.B * n + i] + grown.cells[CH.P * n + i] -
        post.cells[CH.B * n + i] - post.cells[CH.P * n + i],
      0,
    ),
    originalCellsInRemnant: label === null
      ? 0
      : target.cells.filter((i) => c.labels[i] === label).length,
  };
}
