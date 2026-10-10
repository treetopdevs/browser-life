// The Lab session: which Checkpoints cover the Lab world on screen, and what replacing it would lose.
// The worker tells it what was logged and what is on the shelf. It does not decide whether a waiting
// pond cycle accepts a command; LabExecution does, and the worker records that fact here.

import type { CheckpointMeta, Keep, ReplayReading, SessionCommand, SessionView } from "./protocol.ts";

export type ReplaceGate = "proceed" | "save-then" | "download-then" | "held";

const stepText = (step: number) => `t=${step.toLocaleString()}`;

/**
 * What the page asks before a plant, restore, or open. Matches the sentence the page used to build
 * from its own dirty flags.
 */
function lossText(step: number, coveredStep: number, hand: number): string {
  const where = `This world is at ${stepText(step)}.`;
  if (coveredStep <= 0) return `${where} Nothing from this run is saved yet.`;
  const which = hand > 0 && step <= coveredStep ? "changes made by hand since then" : "everything after that";
  return `${where} Its last saved copy is at ${stepText(coveredStep)}; ${which} would be lost.`;
}

export interface LabSession {
  /** A snapshot. Later calls do not change the object returned here. */
  view(): SessionView;
  /** Drops one-shot fields (held, refusal, failure, keptPresent) so the next snapshot does not repeat them. */
  consume(): void;
  adopt(world: NonNullable<SessionView["world"]>): void;
  /** @returns whether the settled step changed the account. */
  noteStep(step: number): boolean;
  /** A lesion or feed is in the log at `step`. */
  noteHand(step: number): void;
  /** A Checkpoint saved on purpose holds the hand edits logged so far. */
  noteManual(file: string): void;
  /** An automatic Checkpoint of this Lab world was written. */
  noteSaved(file: string): void;
  /** The shelf. A manual file no longer listed uncovers the hand edits it held. */
  noteShelf(list: readonly CheckpointMeta[]): void;
  /** A Checkpoint that may be gone, with no listing to say: it covers nothing until the shelf lists it again. */
  noteRemoved(file: string): void;
  noteWaiting(waiting: SessionView["waiting"]): void;
  /** Clears the previous Replay twin reading. The check is in flight. */
  beginCheck(): void;
  noteReplay(reading: Omit<ReplayReading, "handAtEnd">): void;
  /** The check did not finish. */
  cancelCheck(): void;
  /**
   * Plant, restore, or import. `held` leaves the Lab world in place: `loss` was set and `keep` was omitted.
   * `save-then` writes a manual Checkpoint of the present before the replace; `download-then` hands the page
   * the present as a file instead, which covers nothing on the shelf.
   */
  replace(command: NonNullable<SessionView["held"]>, keep?: Keep): ReplaceGate;
  noteRefusal(command: SessionCommand, message: string): void;
  noteFailure(message: string): void;
  /** A jump wrote this Checkpoint of the pre-jump Lab world. Call after the restored world is adopted. */
  noteKeptPresent(file: string, step: number): void;
}

export function createLabSession(): LabSession {
  let epoch = 0;
  let world: SessionView["world"] = null;
  let adoptedStep = 0;
  let totalHand = 0;
  /** Hand-edit count a manual Checkpoint holds, while that file is still on the shelf. */
  const manual = new Map<string, number>();
  /** Counts of manual Checkpoints that may be gone (noteRemoved): restored if the next listing names the file. */
  const suspended = new Map<string, number>();
  let shelf: CheckpointMeta[] = [];
  /**
   * Files already on the shelf when this Lab world was adopted. A later life of the same run id
   * (a file opened again) must not treat those as covering the steps taken since.
   * Null until the first shelf note after adoption.
   */
  let earlier: Set<string> | null = null;
  /**
   * Checkpoints written in this Lab world's life. When the shelf could not be listed at adoption, the first
   * listing comes after a save: everything on it but these was there before.
   */
  const own = new Set<string>();
  let refusal: SessionView["refusal"] = null;
  let failure: string | null = null;
  let held: SessionView["held"] = null;
  let keptPresent: SessionView["keptPresent"] = null;
  let replay: ReplayReading | null = null;
  let checking = false;
  let waiting: SessionView["waiting"] = null;

  const coveredStep = () => {
    const run = world?.runId;
    const saved = shelf.filter((c) => c.runId === run && !earlier?.has(c.file)).map((c) => c.step);
    return Math.max(adoptedStep, ...saved);
  };

  const uncoveredHand = () => totalHand - Math.max(0, ...manual.values());

  const loss = (): SessionView["loss"] => {
    if (!world) return null;
    const covered = coveredStep();
    const hand = uncoveredHand();
    if (world.step <= covered && hand === 0) return null;
    return { text: lossText(world.step, covered, hand), hand, step: world.step, coveredStep: covered };
  };

  const view = (): SessionView => ({
    epoch,
    world: world ? { ...world } : null,
    loss: loss(),
    hand: uncoveredHand(),
    checkpoints: shelf.map((c) => ({ ...c })),
    refusal: refusal ? { ...refusal } : null,
    failure,
    held,
    keptPresent: keptPresent ? { ...keptPresent } : null,
    replay: replay ? { ...replay } : null,
    checking,
    waiting: waiting ? { ...waiting } : null,
  });

  return {
    view,
    consume() {
      refusal = null;
      failure = null;
      held = null;
      keptPresent = null;
    },
    adopt(next) {
      epoch++;
      world = { ...next };
      adoptedStep = next.step;
      totalHand = 0;
      manual.clear();
      suspended.clear();
      own.clear();
      replay = null;
      checking = false;
      waiting = null;
      held = null;
      refusal = null;
      failure = null;
      keptPresent = null;
      shelf = [];
      earlier = null;
    },
    noteStep(step) {
      if (!world || world.step === step) return false;
      const before = loss();
      world = { ...world, step };
      const after = loss();
      return before?.text !== after?.text || before?.hand !== after?.hand;
    },
    noteHand(step) {
      totalHand++;
      if (replay && step === replay.to) replay = { ...replay, handAtEnd: true };
    },
    noteManual(file) {
      manual.set(file, totalHand);
      own.add(file);
    },
    noteSaved(file) {
      own.add(file);
    },
    noteShelf(list) {
      shelf = list.map((c) => ({ ...c }));
      const files = new Set(shelf.map((c) => c.file));
      for (const [file, hand] of suspended) if (files.has(file)) manual.set(file, hand);
      suspended.clear();
      for (const file of manual.keys()) if (!files.has(file)) manual.delete(file);
      if (earlier === null) earlier = new Set([...files].filter((f) => !own.has(f)));
    },
    noteRemoved(file) {
      shelf = shelf.filter((c) => c.file !== file);
      const hand = manual.get(file);
      if (hand === undefined) return;
      suspended.set(file, hand);
      manual.delete(file);
    },
    noteWaiting(next) {
      waiting = next ? { ...next } : null;
    },
    beginCheck() {
      checking = true;
      replay = null;
    },
    noteReplay(reading) {
      checking = false;
      replay = { ...reading, handAtEnd: false };
    },
    cancelCheck() {
      checking = false;
      replay = null;
    },
    replace(command, keep) {
      if (loss() && keep !== "save" && keep !== "download" && keep !== "discard") {
        held = command;
        return "held";
      }
      held = null;
      if (!loss() || keep === "discard") return "proceed";
      return keep === "save" ? "save-then" : "download-then";
    },
    noteRefusal(command, message) {
      refusal = { command, message };
      failure = null;
    },
    noteFailure(message) {
      failure = message;
      refusal = null;
    },
    noteKeptPresent(file, step) {
      keptPresent = { file, step };
    },
  };
}
