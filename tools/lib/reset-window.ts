/** Fixed continuous-window samples; raw flags are not unique events or missed births. */
import { cellCount, type WorldConfig } from "@bl/schema";
import type { ResetOriginMap } from "./reset-copy-extraction.ts";
import { resetFragmentationFlags, resetTopology,
  type ResetFragmentationFlag } from "./reset-topology.ts";

export type ResetWindowFrame = {
  step: number; enclosingCensusStep: number;
  components48Four: number; components1Eight: number;
  flags: ResetFragmentationFlag[];
  trackerIntervalCooccurrence: "pending" | "fission" | "budding" |
    "both" | "neither" | "unavailable";
  interpretation: "raw-copy-associated-geometry-not-unique-reproduction-events";
};

/** One exact adjacent step. The fixed window boundaries come from the frozen design. */
export function resetWindowFrame(cfg: WorldConfig, step: number,
  candidateFirst: number, candidateLast: number, priorCells: Uint32Array,
  currentCells: Uint32Array, currentGenomeHead: Uint32Array,
  oneStepOrigins: ResetOriginMap): ResetWindowFrame {
  const n = cellCount(cfg);
  if (!Number.isSafeInteger(step) || step < candidateFirst || step > candidateLast ||
      candidateLast - candidateFirst + 1 !== 1000 ||
      oneStepOrigins.referenceStep !== step - 1 || oneStepOrigins.currentStep !== step ||
      oneStepOrigins.origins.length !== n || priorCells.length !== 7 * n ||
      currentCells.length !== 7 * n || currentGenomeHead.length < 2 * n)
    throw new Error("continuous window step is outside fixed adjacent physical frames");
  const graph48 = resetTopology(cfg, currentCells, { threshold: 48, neighbors: 4 });
  const graph1 = resetTopology(cfg, currentCells, { threshold: 1, neighbors: 8 });
  const flags = resetFragmentationFlags(cfg, step, priorCells, currentCells,
    currentGenomeHead, oneStepOrigins);
  return { step, enclosingCensusStep: 100 * Math.ceil(step / 100),
    components48Four: graph48.components.length,
    components1Eight: graph1.components.length, flags,
    trackerIntervalCooccurrence: "pending",
    interpretation: "raw-copy-associated-geometry-not-unique-reproduction-events" };
}

/** Co-occurrence uses an ordinary tracker interval, never pairwise event matching. */
export function resolveResetWindowInterval(frames: readonly ResetWindowFrame[],
  censusStep: number, life: readonly object[] | null): ResetWindowFrame[] {
  if (!Number.isSafeInteger(censusStep) || censusStep <= 0 || censusStep % 100 !== 0 ||
      frames.some(frame => frame.enclosingCensusStep !== censusStep ||
        frame.trackerIntervalCooccurrence !== "pending") ||
      life?.some(raw => !raw || typeof raw !== "object" ||
        (raw as { step?: unknown }).step !== censusStep))
    throw new Error("window co-occurrence lacks one unresolved census interval");
  const fission = life?.some(e => e && typeof e === "object" &&
    (e as { kind?: unknown }).kind === "fission") ?? false;
  const budding = life?.some(e => e && typeof e === "object" &&
    (e as { kind?: unknown }).kind === "budding") ?? false;
  const status = life === null ? "unavailable" : fission && budding ? "both" :
    fission ? "fission" : budding ? "budding" : "neither";
  return frames.map(frame => ({ ...frame, trackerIntervalCooccurrence: status }));
}
