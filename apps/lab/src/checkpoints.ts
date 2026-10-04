// Checkpoint policies of the lab worker that need no storage, so they can be tested directly.
import type { Intervention } from "@bl/schema";
import type { RunManifest } from "./protocol.ts";

type Checkpoint = RunManifest["checkpoints"][number];

/** Whether `run` wrote this checkpoint (its file is named after the run). A fork's manifest also lists its parent's. */
export const ownCheckpoint = (runId: string, c: Checkpoint): boolean => c.file.startsWith(`${runId}-t`);

/** The automatic checkpoints to remove after a save: this run's own, beyond the newest `keep`. */
export function prunableAuto(m: Pick<RunManifest, "runId" | "checkpoints">, keep: number): Checkpoint[] {
  const own = m.checkpoints.filter((c) => c.auto && ownCheckpoint(m.runId, c));
  return own.slice(0, Math.max(0, own.length - keep));
}

/** The checkpoint a jump to `step` restores: the latest at or before it among those whose files still exist. */
export function jumpTarget(checkpoints: readonly Checkpoint[], onDisk: ReadonlySet<string>, step: number): Checkpoint | undefined {
  let best: Checkpoint | undefined;
  for (const c of checkpoints) if (onDisk.has(c.file) && c.step <= step && (!best || c.step >= best.step)) best = c;
  return best;
}

/**
 * What a jump to `step` replays after restoring a checkpoint that had seen the first `seen` entries of `history`
 * (the run's log, followed by whatever a jump still replaying had queued): the entries before `step`, and a pick
 * at `step` itself, since a pond cycle is part of arriving at its boundary. `dropped` counts the later entries,
 * which stay with the saved present: the world at `step` starts a new branch.
 *
 * `until` is the horizon for `LabExecution.queueReplay`: pond boundaries before it take a logged pick or the
 * rule's donors and do not wait. It never runs past `known`, the last step this history covers (the step the
 * world had reached or, while an earlier jump is still replaying, that jump's destination). A jump back drops
 * the log beyond its destination, so a second jump further forward enters steps this history has no record of,
 * and a boundary there is a new choice, not a remembered one.
 */
export function replayPlan(history: readonly Intervention[], seen: number, step: number, known: number): { missed: Intervention[]; dropped: number; until: number } {
  const later = history.slice(seen);
  const missed = later.filter((iv) => iv.step < step || (iv.kind === "pick" && iv.step === step));
  return { missed, dropped: later.length - missed.length, until: Math.min(step, known) + 1 };
}
