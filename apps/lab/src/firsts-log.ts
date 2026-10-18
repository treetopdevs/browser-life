// The log of firsts and the family tree of one world (docs/pond-keeper-v0, v1 and v2 notes), fed census by census. Pure
// functions and plain data, no worker and no storage: the worker holds one `FirstsLog` per world and calls these, and the tests
// drive them directly.
//
// The tree lives beside the detector and follows its policy: fresh on a plant or an import, restored with the log from a
// checkpoint's record, stopped by an error (and then the whole log stops, and a session file is refused). Two things are the
// tree's own: it is restored only against the genealogy it was read against (v2 section 4), and a dropped ledger record stops
// the tree alone while the log of firsts carries on without its family input (v2 section 3).
import { stateHash, type Intervention, type WorldConfig, type WorldState } from "@bl/schema";
import {
  FamilyTree, FirstsDetector, firstsContext,
  type Census, type FirstsExtras, type FirstsInput, type FirstsWound,
} from "@bl/metrics";
import type { CensusFamilies } from "./execution.ts";
import type { FamilyRecord, Genealogy, RewindRecord } from "./session-file.ts";

/**
 * The log of firsts, the family tree and what the session card needs beside the intervention log. Made before the world's
 * execution and held by its observation callback, so a census of a replaced world feeds only its own log.
 */
export interface FirstsLog {
  detector: FirstsDetector;
  tree: FamilyTree;
  /** Why the log stopped (a detector or tree error), or null. Entries stay as they were, the tree is no longer fed, and a session file is refused. */
  stopped: string | null;
  /** Why the tree alone stopped (a ledger record was dropped while it watched), or null. The detector goes on without a family input; a session file is refused. */
  treeStopped: string | null;
  /**
   * Pond step -> the pick there was the player's own. The intervention log does not say who chose, so this note is
   * kept beside it: a person's donors equal to the rule's order count as the rule's (`resolvePick`).
   */
  notes: Map<number, boolean>;
  /** The world's step when the log was last posted: a paused world whose step moved since posts again. */
  postedStep: number;
}

/** Why a session file cannot be made from this log, in plain words, or null when it can. */
export function logRefusal(log: Pick<FirstsLog, "stopped" | "treeStopped">): string | null {
  if (log.stopped) return `The log of firsts stopped (${log.stopped}), so the session file would leave it out. The world itself is fine.`;
  if (log.treeStopped) return `The family tree stopped (${log.treeStopped}), so the session file would leave it out. The world itself is fine.`;
  return null;
}

export const sameGenealogy = (a: Genealogy, b: Genealogy): boolean => a.edgesFrom === b.edgesFrom && a.edges === b.edges && a.dropped === b.dropped;

/**
 * The log for a world being adopted: restored from `record` when it describes exactly this state (its detector has seen the
 * census at the state's step, from the same physics), else fresh. The tree comes back only with the detector and only when
 * `genealogy` (the adopted world's edges: where they begin, how many were read back, how many ledger records were dropped) is the
 * one it was read against; otherwise it starts afresh and the family tree says "watching since". A record or a snapshot that
 * does not hold up falls back to fresh and says nothing.
 */
export function openFirstsLog(state: WorldState, censusEvery: number, genealogy: Genealogy, record?: RewindRecord, carryNotes?: Iterable<[number, boolean]>): FirstsLog {
  let detector: FirstsDetector | null = null;
  let tree: FamilyTree | null = null;
  if (record) {
    try {
      const restored = FirstsDetector.restore(record.firsts);
      // The snapshot is of exactly this state: the census at its step, taken from the same physics.
      if (restored.lastStep === state.step && record.hash === stateHash(state)) detector = restored;
    } catch { /* not a snapshot this build reads: start afresh */ }
    if (detector && record.families) {
      try {
        const restored = FamilyTree.restore(record.families.tree);
        if (restored.lastStep === state.step && sameGenealogy(record.families.genealogy, genealogy)) tree = restored;
      } catch { /* not a snapshot this build reads: a fresh tree */ }
    }
  }
  // The notes on who chose each pick are the checkpoint's whether or not its snapshot of the log holds up.
  // A jump's target is an ancestor of the present, so every note the present holds is still true of its picks. The
  // record holds notes only up to its own step, which the present shares, so it never overrides a later one.
  const notes = new Map<number, boolean>(carryNotes ?? []);
  for (const [step, hand] of record?.picks ?? []) if (step <= state.step) notes.set(step, hand);
  return { detector: detector ?? new FirstsDetector(firstsContext(state.cfg, censusEvery)), tree: tree ?? new FamilyTree(), stopped: null, treeStopped: null, notes, postedStep: -1 };
}

/**
 * What a checkpoint saved at this census keeps of the log, or null when the log or the tree stopped (the detector has carried on
 * without its family input, so a restore of it alone would clear the refusal and leave out `new-family` entries a drop-free replay
 * logs; null starts the detector and the tree afresh together). The tree is kept only with the genealogy it was read against.
 */
export function rewindRecord(log: FirstsLog, genealogy: Genealogy, hash: string, step: number): RewindRecord | null {
  if (log.stopped || log.treeStopped) return null;
  // Only the notes of picks this checkpoint holds: a note on a later pick (kept from before a jump back) belongs to a
  // history the checkpoint does not contain, and restoring it later could overwrite the note of a different choice.
  const record: RewindRecord = { firsts: log.detector.snapshot(), picks: [...log.notes].filter(([at]) => at <= step), hash };
  if (log.tree.lastStep === log.detector.lastStep) {
    const families: FamilyRecord = { tree: log.tree.snapshot(), genealogy: { ...genealogy } };
    record.families = families;
  }
  return record;
}

/**
 * The lesions in the intervention log at steps `from <= step < to`, as the detector reads wounds: a lesion logged at `w` happens
 * after the census at `w`, so it is first seen by the census after it. The pond of a wound is the one its centre lies in
 * (`x`, `y` are world coordinates; a centre outside the world wraps as the lesion itself does).
 */
export function woundsBetween(interventions: readonly Intervention[], cfg: Pick<WorldConfig, "tileW" | "tileH" | "tilesX" | "tilesY">, from: number, to: number): FirstsWound[] {
  const W = cfg.tilesX * cfg.tileW, H = cfg.tilesY * cfg.tileH;
  const out: FirstsWound[] = [];
  for (const iv of interventions) {
    if (iv.kind !== "lesion" || iv.step < from || iv.step >= to) continue;
    const x = ((Math.floor(iv.x) % W) + W) % W, y = ((Math.floor(iv.y) % H) + H) % H;
    out.push({ step: iv.step, tile: Math.floor(y / cfg.tileH) * cfg.tilesX + Math.floor(x / cfg.tileW), r: iv.r });
  }
  return out;
}

export interface CensusFeed {
  /** The census, and the ledger records lost in the drain before it. */
  census: Pick<Census, "step">;
  dropped: number;
  firsts?: (extras?: FirstsExtras) => FirstsInput;
  families?: CensusFamilies;
  /** The world's config and intervention log as they stand: the wounds since the previous census are read from them. */
  cfg: WorldConfig;
  interventions: readonly Intervention[];
}

/**
 * Feeds one observed census to the log: the tree first (so the detector sees the splits this census made), then the detector with the
 * wounds since its previous census and the tree's view. Never throws: a failure here must not become a census display error (which
 * pauses the page), so the log stops, says so once through `notify`, and keeps what it had. True when something new is worth showing
 * at once: an entry fired or the tree logged an event.
 *
 * A ledger record dropped in the drain before a census the tree watches stops the tree alone (which records survive an overflow is not
 * the same from one run of the same physics to the next, so a tree read from them would not replay); drops before its first census are
 * unknown ancestry from before it watched, which is allowed.
 */
export function feedCensus(log: FirstsLog, feed: CensusFeed, notify: (message: string) => void): boolean {
  if (!feed.firsts || log.stopped) return false;
  try {
    let fired = false;
    let family: FirstsExtras["family"];
    if (feed.families && !log.treeStopped) {
      if (feed.dropped > 0 && log.tree.watchedFrom !== null) {
        log.treeStopped = `${feed.dropped} mutation event${feed.dropped === 1 ? "" : "s"} dropped (event buffer full) by the census at t=${feed.census.step}, and which records survive an overflow is not the same from one run to the next`;
        notify(`The family tree stopped (${log.treeStopped}). The log of firsts carries on without it; a session file can’t be made from this history.`);
      } else {
        const events = log.tree.observe(feed.families.input(), feed.families.parentOf);
        fired = events.length > 0;
        family = { splits: log.tree.splitsAt(feed.census.step), candidateRun: log.tree.candidateRun() };
      }
    }
    // No wounds at the first census it watches: there is no previous census for them to follow.
    const last = log.detector.lastStep;
    const wounds = last === null ? [] : woundsBetween(feed.interventions, feed.cfg, last, feed.census.step);
    const entries = log.detector.observe(feed.firsts({ wounds, ...(family ? { family } : {}) }));
    return entries.length > 0 || fired;
  } catch (e) {
    log.stopped = e instanceof Error ? e.message : String(e);
    notify(`The log of firsts stopped (${log.stopped}). The world itself is fine; a session file can’t be made from this history.`);
    return false;
  }
}
