// Scheduled interventions in the headless runner: the lab's lesions and feeds (a lab manifest's logged
// `Intervention`s of kind "lesion" and "feed"), applied by `runExperiment` at their steps so that a wounded or
// fed history runs, and replays, headless bit for bit. `RunSpec.interventions` carries the schedule; the run
// writes what it applied to `interventions.jsonl`, one JSON line each, in order.
//
// The rules a schedule keeps (runner.ts applies them; the lab's own traversal, apps/lab/src/execution.ts, is the
// model):
//   - Ownership by segment, like `RunSpec.preCycleCheckpoints`: an intervention at step s belongs to the segment
//     that stepped TO s. A call owns the entries at steps in (startStep, startStep + steps], plus those at step 0
//     when it starts at step 0. The others belong to other segments of the same spec and are not errors here.
//   - Order within a step: physics to s, then (at a census step) the census and observation, the boundary
//     transforms (migration, the pond cycle and its picks, declared cells), THEN the interventions at s in list
//     order, then any checkpoint at s. A checkpoint at s carries the post-intervention state, so a continuation
//     from it never reapplies. A manual intervention in the lab always came after the census of its step.
//   - Step 0 is applied on the CPU to the starting world, before the simulation exists.
//   - A feed changes the world's total matter, so the host moves its conservation baselines by what it moved
//     (feed.ts in @bl/schema); a lesion only converts matter in place and books its heat through the ledger.
//
// Nothing here touches a simulation except through `InterventionSim`, so the pieces test without a GPU.
import { FEED_MAX, cellCount, feedError, worldW, type FeedResult, type WorldConfig } from "@bl/schema";
import { picksFromManifest, type PickEntry } from "./picks.ts";

/** The log of a run with `RunSpec.interventions`, beside manifest.json. Not a bundle or verified file (like picks.jsonl, it is no observation). */
export const INTERVENTIONS_FILE = "interventions.jsonl";

/**
 * One lesion or feed at an absolute step. The shapes are the lab's `Intervention` kinds "lesion" and "feed", except
 * that a feed's `matter` is optional: when present it is the net quanta the log says the feed moved, and the applied
 * result must move exactly that (`InterventionError` otherwise); a hand-written schedule leaves it out.
 */
export type ScheduledIntervention =
  | { step: number; kind: "lesion"; x: number; y: number; r: number }
  | { step: number; kind: "feed"; x: number; y: number; r: number; amount: number; matter?: number };

/**
 * What a run logged for one applied intervention: `r` is the effective (clamped) radius, a feed's `matter` is what it
 * moved (the lab logs the same). A log line is a valid `ScheduledIntervention`, so a run's log replays as a schedule.
 */
export type InterventionLogEntry =
  | { step: number; kind: "lesion"; x: number; y: number; r: number }
  | { step: number; kind: "feed"; x: number; y: number; r: number; amount: number; matter: number };

/**
 * A scheduled intervention that cannot be applied as scheduled; the run stops there. `step` is the entry's step, so a host can
 * tell a failure before the run began (step 0: applied on the CPU before any file is written) from one inside the loop.
 */
export class InterventionError extends Error {
  readonly step?: number;
  constructor(message: string, options?: ErrorOptions & { step?: number }) {
    super(message, options);
    this.name = "InterventionError";
    if (options?.step !== undefined) this.step = options.step;
  }
}

const isPlain = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const nonNegInt = (v: unknown): boolean => Number.isSafeInteger(v) && (v as number) >= 0;

const LESION_KEYS = ["step", "kind", "x", "y", "r"];
const FEED_KEYS = [...LESION_KEYS, "amount"];

/**
 * Shape checks on a schedule, needing no config: a non-empty array; every entry a plain object with exactly the keys
 * of its kind (`matter` optional on feeds); `step` a non-negative safe integer; steps non-decreasing (several at one
 * step are applied in list order); `x`, `y` and `r` non-negative integers; a feed's `amount` a non-zero integer
 * within ±`FEED_MAX`; `matter`, when present, a safe integer. The world-dependent checks are `interventionsError`'s.
 * An indexed loop, not every/some, which skip the holes of a sparse array.
 */
export function validateInterventions(list: unknown): string[] {
  if (!Array.isArray(list) || list.length === 0) return ["interventions must be a non-empty array of lesions and feeds"];
  const errs: string[] = [];
  let last = 0;
  for (let i = 0; i < list.length; i++) {
    const e: unknown = list[i];
    const where = `interventions[${i}]`;
    if (!isPlain(e)) {
      errs.push(`${where} must be an object`);
      continue;
    }
    const kind = e.kind;
    if (kind !== "lesion" && kind !== "feed") {
      errs.push(`${where}: kind must be "lesion" or "feed", got ${JSON.stringify(kind)}`);
      continue;
    }
    const required = kind === "feed" ? FEED_KEYS : LESION_KEYS;
    const allowed = kind === "feed" ? [...FEED_KEYS, "matter"] : LESION_KEYS;
    const extra = Object.keys(e).find((k) => !allowed.includes(k));
    if (extra !== undefined) {
      errs.push(`${where}: a ${kind} has no key ${JSON.stringify(extra)} (its keys are ${allowed.join(", ")})`);
      continue;
    }
    // Own keys only: a field inherited from a prototype would validate here and serialise as nothing.
    const missing = required.find((k) => !Object.hasOwn(e, k));
    if (missing !== undefined) {
      errs.push(`${where}: a ${kind} needs the key ${JSON.stringify(missing)}`);
      continue;
    }
    if (!nonNegInt(e.step)) errs.push(`${where}: step must be a non-negative integer`);
    else {
      if ((e.step as number) < last) errs.push(`${where}: step ${e.step} follows step ${last} (steps must not decrease)`);
      last = Math.max(last, e.step as number);
    }
    for (const k of ["x", "y", "r"] as const) if (!nonNegInt(e[k])) errs.push(`${where}: ${k} must be a non-negative integer`);
    if (kind === "feed") {
      const a = e.amount;
      if (!Number.isInteger(a) || a === 0 || Math.abs(a as number) > FEED_MAX) errs.push(`${where}: amount must be a non-zero integer within ±${FEED_MAX} per cell`);
      if (Object.hasOwn(e, "matter") && !Number.isSafeInteger(e.matter)) errs.push(`${where}: matter must be an integer`);
    }
  }
  return errs;
}

/**
 * Why `spec.interventions` cannot be applied to a world of config `cfg`, or null when they can (or the field is
 * absent): a centre outside the world, and a feed that `feedError` refuses (a pond config, where each pond's matter is
 * fixed by its cycle; a lesion in a pond world is fine, it conserves matter). Needs no GPU, so runExperiment checks it
 * before touching one and tools/run.ts can check its specs before it requests a device. Shapes are `validateInterventions`'s.
 * Step ranges are not checked: an entry outside a call's window belongs to another segment of the same spec.
 * `startStep` is not read either; it keeps the call parallel to `preCycleError`'s.
 */
export function interventionsError(spec: { interventions?: readonly ScheduledIntervention[] }, cfg: WorldConfig, _startStep: number): string | null {
  const list = spec.interventions;
  if (!Array.isArray(list)) return null;
  const W = worldW(cfg), H = cellCount(cfg) / W;
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    // A malformed entry (a hole, a non-object) is `validateInterventions`'s to report, not this function's to trip over.
    if (typeof e !== "object" || e === null) continue;
    const where = `interventions[${i}] (${e.kind} at t=${e.step})`;
    if (e.x >= W) return `${where}: x ${e.x} is outside the world (${W} wide)`;
    if (e.y >= H) return `${where}: y ${e.y} is outside the world (${H} high)`;
    if (e.kind === "feed") {
      const bad = feedError(cfg, e.amount, e.r);
      if (bad) return `${where}: ${bad}`;
    }
  }
  return null;
}

/**
 * The entries a call from `startStep` for `steps` steps owns, in list order: those at steps in (startStep, startStep +
 * steps], plus those at step 0 when the call starts at step 0 (a fresh run). The rest belong to other segments.
 */
export function ownedInterventions(list: readonly ScheduledIntervention[] | undefined, startStep: number, steps: number): ScheduledIntervention[] {
  if (!list) return [];
  return list.filter((e) => (e.step > startStep && e.step <= startStep + steps) || (startStep === 0 && e.step === 0));
}

/** The part of a simulation a scheduled intervention acts on: `GpuSim`, or a CPU stand-in. */
export interface InterventionSim {
  /** Destroys bound structure in a disc; returns the effective (clamped) radius. */
  lesion(x: number, y: number, r: number): number;
  /** Feeds or drains nutrient in a disc (feed.ts); throws on `feedError` and on a feed past MATTER_MAX. */
  feed(x: number, y: number, r: number, amount: number): Promise<FeedResult>;
}

/** What applying one intervention did: its log entry, and what the host books (a lesion moves no matter). */
export interface AppliedIntervention {
  entry: InterventionLogEntry;
  /** Net quanta of nutrient the world gained (negative when drained); 0 for a lesion. */
  matter: number;
  /** `matter * eA`: what the energy baseline moves by; 0n for a lesion. */
  energy: bigint;
}

/**
 * Applies `e` to `sim` as the lab's traversal does and returns what to log and book. A feed whose schedule names the
 * `matter` the log says it moved must move exactly that, else `InterventionError` ("this is not the observed history",
 * as the lab's reapply says); a feed `sim` refuses becomes an `InterventionError` naming the step. The caller has
 * awaited the simulation idle (`onSubmittedWorkDone`) and moves its baselines by the result.
 */
export async function applyScheduled(sim: InterventionSim, e: ScheduledIntervention): Promise<AppliedIntervention> {
  if (e.kind === "lesion") {
    const r = sim.lesion(e.x, e.y, e.r);
    return { entry: { step: e.step, kind: "lesion", x: e.x, y: e.y, r }, matter: 0, energy: 0n };
  }
  let res: FeedResult;
  try {
    res = await sim.feed(e.x, e.y, e.r, e.amount);
  } catch (err) {
    throw new InterventionError(`the feed at t=${e.step} failed: ${err instanceof Error ? err.message : String(err)}`, { cause: err, step: e.step });
  }
  // The entry's own `matter` only, as `validateInterventions` reads it: an inherited one was neither checked nor serialised.
  if (Object.hasOwn(e, "matter") && e.matter !== undefined && res.matter !== e.matter) throw new InterventionError(`scheduled feed at t=${e.step} moved ${res.matter} quanta, the log says ${e.matter}: this is not the observed history`, { step: e.step });
  return { entry: { step: e.step, kind: "feed", x: e.x, y: e.y, r: res.radius, amount: e.amount, matter: res.matter }, matter: res.matter, energy: res.energy };
}

/** A line of `interventions.jsonl` (with its newline), keys in a fixed order: the lab's intervention of that kind. */
export function formatInterventionLine(e: InterventionLogEntry): string {
  return (
    JSON.stringify(
      e.kind === "lesion"
        ? { step: e.step, kind: "lesion", x: e.x, y: e.y, r: e.r }
        : { step: e.step, kind: "feed", x: e.x, y: e.y, r: e.r, amount: e.amount, matter: e.matter },
    ) + "\n"
  );
}

/** The entries of an `interventions.jsonl`. Throws on a line that is not JSON, a malformed entry, a feed without its `matter` or a decreasing step. */
export function parseInterventionLog(text: string): InterventionLogEntry[] {
  const out: unknown[] = [];
  text.split("\n").forEach((line, i) => {
    if (line.trim() === "") return;
    try {
      out.push(JSON.parse(line));
    } catch {
      throw new Error(`${INTERVENTIONS_FILE} line ${i + 1}: not JSON`);
    }
  });
  if (out.length === 0) return [];
  const errs = validateInterventions(out);
  if (errs.length) throw new Error(`${INTERVENTIONS_FILE}: ${errs[0]}`);
  const bare = out.findIndex((e) => (e as { kind: string }).kind === "feed" && !Object.hasOwn(e as object, "matter"));
  if (bare >= 0) throw new Error(`${INTERVENTIONS_FILE}: interventions[${bare}]: a logged feed needs the matter it moved`);
  return out as InterventionLogEntry[];
}

/**
 * A lab run manifest (`<runId>.run.json`, apps/lab/src/protocol.ts `RunManifest`) split into the two things a headless
 * run replays: its `picks` (the pond boundaries' donors, as `picksFromManifest` reads them, which still refuses a
 * manifest holding a lesion or a feed) and its `scheduled` lesions and feeds, in log order, each feed carrying the
 * `matter` the lab logged as the value the replay must reproduce. Refuses a manifest that is not one, one observed
 * only from step `edgesFrom` > 0 (as `picksFromManifest` does), an intervention of any other kind, a feed without
 * the `matter` it moved (the lab logs it on every feed, and its own replay stops on a feed that does not reproduce it,
 * so a log without it would run without that check), a lesion or feed that `validateInterventions` rejects, and a
 * log that is not in one step order across all kinds or that has a lesion or feed ahead of a pick of its own step
 * (the lab logs a boundary's pick first, and the headless boundary comes before the interventions of its step, so
 * that history would be silently reordered). A pick's error names its place in the manifest's own list.
 */
export function labHistory(manifest: unknown): { picks: PickEntry[]; scheduled: ScheduledIntervention[] } {
  const m = manifest as { interventions?: unknown; edgesFrom?: unknown } | null;
  if (!m || typeof m !== "object" || !Array.isArray(m.interventions)) throw new Error("not a lab run manifest: no interventions array");
  const pickIvs: unknown[] = [], pickAt: number[] = [], scheduled: ScheduledIntervention[] = [];
  m.interventions.forEach((iv: unknown, i: number) => {
    const o = iv as Record<string, unknown> | null;
    const kind = o?.kind;
    if (kind === "pick") {
      pickIvs.push(iv);
      pickAt.push(i);
    } else if (kind === "lesion") scheduled.push({ step: o!.step, kind, x: o!.x, y: o!.y, r: o!.r } as ScheduledIntervention);
    else if (kind === "feed") {
      // The schema's Intervention requires it and the lab's reapply throws without it: never an unchecked feed.
      if (o!.matter === undefined) throw new Error(`interventions[${i}]: a logged feed needs the matter it moved`);
      scheduled.push({ step: o!.step, kind, x: o!.x, y: o!.y, r: o!.r, amount: o!.amount, matter: o!.matter } as ScheduledIntervention);
    } else throw new Error(`interventions[${i}] is a ${JSON.stringify(kind)}: not a pick, a lesion or a feed`);
  });
  let picks: PickEntry[];
  try {
    picks = picksFromManifest({ ...m, interventions: pickIvs });
  } catch (e) {
    // The copy holds only the picks, so its indices are the picks'; say where they stand in the manifest's own list.
    throw new Error((e as Error).message.replace(/interventions\[(\d+)\]/g, (_, j) => `interventions[${pickAt[Number(j)] ?? j}]`));
  }
  if (scheduled.length) {
    const errs = validateInterventions(scheduled);
    if (errs.length) throw new Error(`the lab manifest's lesions and feeds (counted apart from its picks): ${errs[0]}`);
  }
  // Across the kinds, which the checks above (the picks' own, then the lesions' and feeds') do not see: the lab's queueReplay
  // wants one non-decreasing step order, and a pick is applied by the boundary, ahead of every intervention at its step.
  let last = 0, hand = -1;
  for (let i = 0; i < m.interventions.length; i++) {
    const { step, kind } = m.interventions[i] as { step: number; kind: string };
    if (step < last) throw new Error(`interventions[${i}] (${kind} at t=${step}) follows an entry at t=${last}: a lab log is in one step order across its picks, lesions and feeds`);
    last = step;
    if (kind === "pick" && hand === step) throw new Error(`interventions[${i}] (pick at t=${step}) follows a lesion or feed at the same step: the lab logs a boundary's pick first, and a headless run applies the boundary before the interventions of its step`);
    if (kind !== "pick") hand = step;
  }
  return { picks, scheduled };
}
