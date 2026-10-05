// The persisted observers of a history (life-event tracker, evolutionary
// activity, counters, temporal pattern sample) and the one function that
// advances them at a census. The headless runner and the interactive lab both
// observe through `observeCensus`, at the same simulation-step boundaries, so
// a checkpoint's observer section means the same thing whichever wrote it.

import type { WorldConfig } from "@bl/schema";
import { ActivityTracker, Tracker, b64, blockSymbols, census, tileDistance2, unb64, type Census, type LifeEvent } from "@bl/metrics";
import type { ObserverSettings, ObserverState } from "./runner.ts";

/** Live form of `ObserverState`. */
export interface Observers {
  tracker: Tracker;
  activity: ActivityTracker;
  mutations: number;
  buddings: number;
  censusIdx: number;
  extinct: boolean;
  prevSym: Uint8Array | null;
  /** Pond runs only: see `ObserverState.ponds`. */
  ponds?: { lastCycle: number };
  /** Fed histories only: see `ObserverState.fed`. */
  fed?: { matter: number; feeds: number };
}

/**
 * `cfg`, when given, is the history's config: a pond run (`cfg.pondPeriod`
 * set) without a saved `ponds` field starts it at cycle 0, which is right for
 * the only such start `pondContinuationError` (runner.ts) accepts, step 0.
 */
export function restoreObservers(o: ObserverState | undefined, settings: ObserverSettings, cfg?: WorldConfig): Observers {
  return {
    tracker: o ? Tracker.fromJSON(o.tracker) : new Tracker(),
    activity: o ? ActivityTracker.fromJSON(o.activity) : new ActivityTracker(settings.activityThreshold ?? Infinity),
    mutations: o?.mutations ?? 0,
    buddings: o?.buddings ?? 0,
    censusIdx: o?.censusIdx ?? 0,
    extinct: o?.extinct ?? false,
    prevSym: o?.prevSym ? unb64(o.prevSym) : null,
    ...(o?.ponds ? { ponds: { lastCycle: o.ponds.lastCycle } } : cfg?.pondPeriod !== undefined ? { ponds: { lastCycle: 0 } } : {}),
    ...(o?.fed ? { fed: { matter: o.fed.matter, feeds: o.fed.feeds } } : {}),
  };
}

export function serializeObservers(obs: Observers, step: number, settings: ObserverSettings): ObserverState {
  return {
    step,
    settings,
    tracker: obs.tracker.toJSON(),
    activity: obs.activity.toJSON(),
    mutations: obs.mutations,
    buddings: obs.buddings,
    censusIdx: obs.censusIdx,
    extinct: obs.extinct,
    prevSym: obs.prevSym ? b64(obs.prevSym) : null,
    // Only in pond runs, so every other observer (and its digest) is unchanged.
    ...(obs.ponds ? { ponds: { lastCycle: obs.ponds.lastCycle } } : {}),
    // Only in fed histories, for the same reason.
    ...(obs.fed ? { fed: { matter: obs.fed.matter, feeds: obs.fed.feeds } } : {}),
  };
}

export interface CensusObservation {
  census: Census;
  /** Tracker events of this census (fissions carry parent/children ids). */
  events: LifeEvent[];
  /** Life events as reported: births near a living same-lineage individual become buddings. */
  life: object[];
  activity: ReturnType<ActivityTracker["update"]>;
  /** Occupancy symbols of this census and of the previous one (temporal MI). */
  sym: Uint8Array;
  prevSym: Uint8Array | null;
  becameExtinct: boolean;
}

/**
 * One census: counts `newMutations` (every event drained since the previous
 * census), updates the tracker with budding attribution, evolutionary
 * activity, the temporal pattern sample and the counters.
 */
export function observeCensus(
  obs: Observers,
  cfg: WorldConfig,
  snap: { step: number; cells: Uint32Array; genomeHead: Uint32Array },
  newMutations: number,
): CensusObservation {
  obs.mutations += newMutations;
  const c = census({ cfg, step: snap.step, cells: snap.cells, genomeHead: snap.genomeHead });
  const events = obs.tracker.update(c);
  const life: object[] = [];
  for (const e of events) {
    if (e.kind !== "birth") {
      life.push(e);
      continue;
    }
    // Condensation from leaked biomass: attribute to the nearest living
    // individual of the same lineage (budding) when one is close.
    const b = obs.tracker.alive.get(e.id);
    let parent: number | null = null;
    let best = 24 * 24;
    if (b && b.lineage)
      for (const o of obs.tracker.alive.values()) {
        if (o.id === b.id || o.lineage !== b.lineage || o.born === c.step) continue;
        const d = tileDistance2(o, b, cfg.tileW, cfg.tileH);
        if (d < best) [best, parent] = [d, o.id];
      }
    if (parent !== null) {
      obs.buddings++;
      if (b) {
        b.parent = parent;
        b.generation = (obs.tracker.alive.get(parent)?.generation ?? 0) + 1;
      }
      life.push({ step: e.step, kind: "budding", parent, child: e.id });
    } else life.push(e);
  }
  const act = obs.activity.update(c.step, c.lineages.map((l) => [l.key, l.cells] as [string, number]));
  const sym = blockSymbols(cfg, snap.cells);
  const prevSym = obs.prevSym;
  obs.prevSym = sym;
  obs.censusIdx++;
  // Keep observing through extinction: the observation window is not truncated.
  const becameExtinct = c.livingCells === 0 && !obs.extinct;
  if (becameExtinct) obs.extinct = true;
  return { census: c, events, life, activity: act, sym, prevSym, becameExtinct };
}
