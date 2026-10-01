// Checkpoint policies of the lab worker that need no storage, so they can be tested directly.
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
