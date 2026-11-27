// Donors picked by something other than the lab (wild sandbox): the pieces behind tools/run.ts's
// `--picker`, `--picks-from` and `--verify-against`. A picked run's pond cycles take their donors from a
// `Picker` (or from a recorded list), and every boundary's donors go into `picks.jsonl`, one JSON line each,
// so that the run can be replayed exactly. The first four keys of a pick line are the lab's `Intervention` of
// kind "pick" (`{step, kind, cycle, donors}`), so one loader reads both.
//
// The one failure rule: any error at a boundary (a picker that throws or answers badly, a recorded entry that
// is not a valid pick, a missing entry with no picker) writes a `failed` line, throws `PickError` and applies
// nothing, so the world is exactly pre-cycle there. No retry, no fallback to the rule. Pickers get a detached
// snapshot of the pre-cycle state; the runner keeps its own.
import { cloneState, pondDonors, pondPickError, pondScoreTerms, pondTraits, randomKey, type PondScore, type WorldConfig, type WorldState } from "@bl/schema";
import type { DonorHook } from "./migrate.ts";

/** The pick log of a picked run, beside manifest.json. Not a bundle or verified file (like migrations.tsv, it is no observation). */
export const PICKS_FILE = "picks.jsonl";

/** One boundary's donors: `Intervention` kind "pick" without its kind. `step` = `cycle` * pondPeriod. */
export interface PickEntry {
  step: number;
  cycle: number;
  donors: number[];
}

/** What a picker sees of one boundary. */
export interface PickRequest {
  step: number;
  cycle: number;
  /** A detached snapshot of the state the cycle will transform; the runner's own copy is untouched. */
  pre: WorldState;
  /** cfg.pondK */
  k: number;
  /** Ponds with bound mass at the support threshold (`pondTraits` > 0), ascending. */
  occupied: number[];
  /** The arm's own donors, in order: the rule picker's answer. Adapters never serialize it. */
  suggested: number[];
  /** suggested.length: the most donors a live answer may name. */
  max: number;
}

export interface Picker {
  name: string;
  pick(req: PickRequest): Promise<number[]>;
  /** After the boundary is committed and its rows logged: the donors applied and `by`. Album and notebook bookkeeping. */
  applied?(req: PickRequest, donors: readonly number[], by: string): Promise<void> | void;
}

/** A failure at a pick boundary; the run stops there with the world unchanged (or, after `applied`, committed and logged). */
export class PickError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PickError";
  }
}

/** A thrown value's text: a picker may reject with null, undefined or a string, and the failure line must still be written. */
export function thrownMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function liveError(traits: readonly number[], max: number, donors: readonly number[]): string | null {
  const bad = pondPickError(traits, donors);
  if (bad) return bad;
  if (donors.length > max) return `picks name ${donors.length} ponds, at most ${max} may donate`;
  return null;
}

/** Why a live answer `donors` to `req` is not acceptable, or null: valid occupied distinct ponds, and one to `req.max` of them. */
export function livePickError(req: PickRequest, donors: readonly number[]): string | null {
  return liveError(pondTraits(req.pre), req.max, donors);
}

/** A pick line of `picks.jsonl` (with its newline): the lab's pick intervention plus who chose and the arm's own donors. */
export function formatPickLine(e: PickEntry & { by: string; suggested: number[] }): string {
  return JSON.stringify({ step: e.step, kind: "pick", cycle: e.cycle, donors: e.donors, by: e.by, suggested: e.suggested }) + "\n";
}

/** A failure line; `phase: "after"` marks an error after the boundary was committed (`Picker.applied`). */
export function formatFailedLine(step: number, cycle: number, by: string, error: string, phase?: "after"): string {
  return JSON.stringify({ step, kind: "failed", cycle, by, ...(phase ? { phase } : {}), error }) + "\n";
}

const isIndex = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;

function entryOf(v: unknown, where: string): PickEntry {
  const o = v as Partial<PickEntry> | null;
  if (!o || typeof o !== "object") throw new Error(`${where}: not an object`);
  if (!Number.isSafeInteger(o.step) || (o.step as number) <= 0) throw new Error(`${where}: step must be a positive integer`);
  if (!Number.isSafeInteger(o.cycle) || (o.cycle as number) <= 0) throw new Error(`${where}: cycle must be a positive integer`);
  if (!Array.isArray(o.donors) || !o.donors.every(isIndex)) throw new Error(`${where}: donors must be an array of pond indices`);
  return { step: o.step as number, cycle: o.cycle as number, donors: [...o.donors] };
}

function ascending(entries: readonly PickEntry[], where: string): void {
  for (let i = 1; i < entries.length; i++)
    if (entries[i].step <= entries[i - 1].step) throw new Error(`${where}: step ${entries[i].step} follows step ${entries[i - 1].step} (picks must be in order, one per boundary)`);
}

/** The pick lines of a `picks.jsonl`; other kinds (`failed`) are skipped. Throws on a malformed pick line, a repeated or descending step. */
export function parsePickLog(text: string): PickEntry[] {
  const out: PickEntry[] = [];
  text.split("\n").forEach((line, i) => {
    if (line.trim() === "") return;
    const where = `${PICKS_FILE} line ${i + 1}`;
    let v: unknown;
    try {
      v = JSON.parse(line);
    } catch {
      throw new Error(`${where}: not JSON`);
    }
    if ((v as { kind?: unknown } | null)?.kind !== "pick") return;
    out.push(entryOf(v, where));
  });
  ascending(out, PICKS_FILE);
  return out;
}

/**
 * The pick lines of a log that may end in a torn record (a crash mid-append): the complete prefix as `entries` and its
 * `text` (ending at the last newline), and the torn tail as `torn`. Only an unterminated final line that is not JSON counts
 * as torn; every other malformation throws exactly as `parsePickLog` does, so a damaged middle is never skipped.
 */
export function parsePickLogPrefix(text: string): { entries: PickEntry[]; text: string; torn: string | null } {
  const cut = text.lastIndexOf("\n") + 1;
  const tail = text.slice(cut);
  let torn = false;
  if (tail.trim() !== "")
    try {
      JSON.parse(tail);
    } catch {
      torn = true;
    }
  const complete = torn ? text.slice(0, cut) : text;
  return { entries: parsePickLog(complete), text: complete, torn: torn ? tail : null };
}

/**
 * Whether recorded logs describe one history: where two of them have an entry at the same step, the cycle and the ordered
 * donors must be equal. Null when they agree, else a message naming the sources. A log that is merely longer agrees.
 */
export function pickLogsConflict(logs: readonly { source: string; entries: readonly PickEntry[] }[]): string | null {
  for (let i = 0; i < logs.length; i++)
    for (let j = i + 1; j < logs.length; j++) {
      const there = new Map(logs[j].entries.map((e) => [e.step, e]));
      for (const e of logs[i].entries) {
        const o = there.get(e.step);
        if (o && (o.cycle !== e.cycle || o.donors.join() !== e.donors.join()))
          return `${logs[i].source} and ${logs[j].source} disagree at t=${e.step}: cycle ${e.cycle} donors [${e.donors.join(", ")}] against cycle ${o.cycle} donors [${o.donors.join(", ")}]`;
      }
    }
  return null;
}

/**
 * One record out of logs that agree (`pickLogsConflict` is null): every boundary any of them holds, ascending, and its
 * `text` as pick lines. A boundary in several logs comes from the first that has it. Its line is that log's own (so `by`
 * and `suggested` survive) when the log comes with its `text`, else the four keys of the lab's intervention (a lab
 * manifest has no lines). `failed` lines are not carried.
 */
export function mergePickLogs(logs: readonly { entries: readonly PickEntry[]; text?: string }[]): { entries: PickEntry[]; text: string } {
  const merged = new Map<number, { entry: PickEntry; line: string }>();
  for (const log of logs) {
    const own = new Map<number, string>();
    for (const line of (log.text ?? "").split("\n")) {
      if (line.trim() === "") continue;
      const v = JSON.parse(line) as { kind?: unknown; step?: unknown } | null;
      if (v?.kind === "pick" && typeof v.step === "number") own.set(v.step, line + "\n");
    }
    for (const e of log.entries)
      if (!merged.has(e.step)) merged.set(e.step, { entry: e, line: own.get(e.step) ?? JSON.stringify({ step: e.step, kind: "pick", cycle: e.cycle, donors: e.donors }) + "\n" });
  }
  const order = [...merged.values()].sort((x, y) => x.entry.step - y.entry.step);
  return { entries: order.map((o) => o.entry), text: order.map((o) => o.line).join("") };
}

/**
 * The picks of a lab run manifest (`<runId>.run.json`, `RunManifest.interventions`). Refuses a manifest whose
 * interventions include a lesion or a feed (replaying only the picks would not be that history) or whose
 * `edgesFrom` is above 0 (the lab run was not observed from step 0). A lab history can be sparse (breeder mode
 * switched on late, or an extinct world logs no pick), so callers replay it with `implicitRule`.
 */
export function picksFromManifest(manifest: unknown): PickEntry[] {
  const m = manifest as { interventions?: unknown; edgesFrom?: unknown } | null;
  if (!m || typeof m !== "object" || !Array.isArray(m.interventions)) throw new Error("not a lab run manifest: no interventions array");
  if (typeof m.edgesFrom === "number" && m.edgesFrom > 0) throw new Error(`the lab run was observed only from step ${m.edgesFrom}, not from step 0, so its history cannot be replayed from the start`);
  const out: PickEntry[] = [];
  m.interventions.forEach((iv, i) => {
    const kind = (iv as { kind?: unknown } | null)?.kind;
    if (kind !== "pick") throw new Error(`interventions[${i}] is a ${JSON.stringify(kind)}: replaying only the picks would not be that history`);
    out.push(entryOf(iv, `interventions[${i}]`));
  });
  ascending(out, "interventions");
  return out;
}

const pondBoundariesIn = (cfg: Pick<WorldConfig, "pondPeriod">, startStep: number, steps: number): number =>
  cfg.pondPeriod === undefined ? 0 : Math.floor((startStep + steps) / cfg.pondPeriod) - Math.floor(startStep / cfg.pondPeriod);

/**
 * Why recorded `entries` cannot drive a run of `cfg` from `startStep` for `steps`, or null: an entry off a pond
 * boundary, outside the run, out of order or twice, with the wrong cycle or invalid donors, and a log shorter than
 * the run's boundaries when nothing else answers the rest (`hasPicker`: a picker, or the implicit rule of a lab
 * manifest). No fallback to the rule.
 */
export function picksPreflightError(entries: readonly PickEntry[], cfg: Pick<WorldConfig, "pondPeriod">, startStep: number, steps: number, hasPicker: boolean): string | null {
  const period = cfg.pondPeriod;
  if (period === undefined) return "picks need a pond config (pondPeriod)";
  let last = startStep;
  for (const e of entries) {
    if (e.step % period !== 0) return `a pick at t=${e.step} is not on a pond boundary (every ${period} steps)`;
    if (e.step <= startStep || e.step > startStep + steps) return `a pick at t=${e.step} is outside the run (t=${startStep} to ${startStep + steps})`;
    if (e.step <= last) return `a pick at t=${e.step} is out of order or repeated`;
    if (e.cycle !== e.step / period) return `a pick at t=${e.step} says cycle ${e.cycle}, not ${e.step / period}`;
    if (!e.donors.every(isIndex) || new Set(e.donors).size !== e.donors.length) return `the pick at t=${e.step} does not name distinct ponds: ${e.donors.join(", ")}`;
    last = e.step;
  }
  const want = pondBoundariesIn(cfg, startStep, steps);
  if (!hasPicker && entries.length < want) return `the record covers ${entries.length} of the run's ${want} pond boundaries and no picker answers the rest`;
  return null;
}

/** A tab-separated table's rows as objects keyed by header. */
function tsvTable(text: string): Record<string, string>[] {
  const [head, ...rows] = text.split("\n").filter((l) => l !== "");
  if (head === undefined) return [];
  const cols = head.split("\t");
  return rows.map((r) => Object.fromEntries(r.split("\t").map((v, i) => [cols[i], v])));
}

/**
 * Whether `picksText` (a `picks.jsonl`) and `pondsText` (the same run's ponds.tsv) agree: the boundaries are the
 * same, each boundary's donor values in the rows are exactly the log's donors (-1 only where the log says none),
 * and, given the run's `seed`, each recipient's donor is the one `donors[i % Dp]` assigns in the log's order
 * (order changes the assignment: [0, 1] and [1, 0] must not both pass). Null when consistent.
 */
export function picksConsistencyError(picksText: string, pondsText: string, seed?: number): string | null {
  let picks: PickEntry[];
  try {
    picks = parsePickLog(picksText);
  } catch (e) {
    return (e as Error).message;
  }
  const byCycle = new Map<number, Record<string, string>[]>();
  for (const row of tsvTable(pondsText)) {
    const b = Number(row.cycle);
    byCycle.set(b, [...(byCycle.get(b) ?? []), row]);
  }
  const logged = new Set(picks.map((p) => p.cycle));
  for (const b of byCycle.keys()) if (!logged.has(b)) return `ponds.tsv has boundary ${b}, which picks.jsonl does not`;
  for (const p of picks) {
    const rows = byCycle.get(p.cycle);
    if (!rows) return `picks.jsonl has boundary ${p.cycle}, which ponds.tsv does not`;
    if (rows.some((r) => Number(r.step) !== p.step)) return `boundary ${p.cycle}: ponds.tsv rows are not at t=${p.step}`;
    const donors = rows.map((r) => Number(r.donor));
    if (p.donors.length === 0) {
      if (donors.some((d) => d !== -1)) return `boundary ${p.cycle}: the log names no donor but ponds.tsv has one`;
      continue;
    }
    if (donors.some((d) => d === -1)) return `boundary ${p.cycle}: ponds.tsv has donor -1 rows but the log names donors`;
    const used = [...new Set(donors)].sort((x, y) => x - y);
    const named = [...p.donors].sort((x, y) => x - y);
    if (used.join() !== named.join()) return `boundary ${p.cycle}: ponds.tsv's donors (${used.join(", ")}) are not the log's (${named.join(", ")})`;
    if (seed !== undefined) {
      const recipients = rows.map((r) => Number(r.recipient));
      const order = recipients.map((pond) => ({ pond, key: randomKey(seed, p.cycle, pond, 2) })).sort((x, y) => x.key - y.key || x.pond - y.pond);
      const donorOf = new Map(rows.map((r) => [Number(r.recipient), Number(r.donor)]));
      for (const [i, r] of order.entries())
        if (donorOf.get(r.pond) !== p.donors[i % p.donors.length]) return `boundary ${p.cycle}: recipient ${r.pond} took donor ${donorOf.get(r.pond)}, the log's order assigns ${p.donors[i % p.donors.length]}`;
    }
  }
  return null;
}

/** First 16 hex digits of SHA-256 over `JSON.stringify([[step, donors], ...])`: what the manifest's `picks.digest` carries. */
export async function picksDigest(entries: readonly PickEntry[]): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(entries.map((e) => [e.step, e.donors])));
  const sum = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(sum.subarray(0, 8), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** A deep copy of `s` a picker may scribble on: cells, genome, flux and a cloned config. */
export function detachState(s: WorldState): WorldState {
  return { ...cloneState(s), cfg: { ...s.cfg } };
}

/** One pressure (the lab's pond keeper): `Intervention` kind "pressure" without its kind. */
export interface PressureEntry {
  step: number;
  cycle: number;
  score: PondScore;
}

/** The score of the LAST entry in list order whose `cycle` is <= `cycle`, or undefined when none governs it. */
export function activePondScore(pressures: readonly PressureEntry[], cycle: number): PondScore | undefined {
  for (let i = pressures.length - 1; i >= 0; i--) if (pressures[i].cycle <= cycle) return pressures[i].score;
  return undefined;
}

/** The `cycle` a pressure set at world step `step` carries: a waiting cycle's own (`step / period`), else the next boundary (`floor(step / period) + 1`). */
export function pressureCycleOf(step: number, period: number, waiting: boolean): number {
  return waiting ? step / period : Math.floor(step / period) + 1;
}

/**
 * Why `entries` cannot be the pressures of a history of config `cfg`, or null: the config must be a pond config of arm "breed";
 * every entry has a safe-integer `step` >= 0, a safe-integer `cycle` >= 1 and a `score` that `pondScoreTerms` accepts; steps do not
 * decrease; cycles do not decrease; and `cycle` is `ceil(step / pondPeriod)` or, when `step` is a multiple of pondPeriod,
 * `step / pondPeriod + 1`. Anything else is "not the observed history".
 */
export function pressureEntriesError(entries: readonly PressureEntry[], cfg: Pick<WorldConfig, "pondPeriod" | "pondArm">): string | null {
  const period = cfg.pondPeriod;
  if (period === undefined) return "a pressure needs a pond config (pondPeriod)";
  if (cfg.pondArm !== "breed") return `a pressure needs pond arm breed, got ${JSON.stringify(cfg.pondArm)}: only the breeder ranks donors by a score`;
  let lastStep = 0, lastCycle = 0;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i] as Partial<PressureEntry> | null;
    const where = `pressure ${i}`;
    if (!e || typeof e !== "object") return `${where} is not an object`;
    if (!Number.isSafeInteger(e.step) || (e.step as number) < 0) return `${where}: step must be a non-negative integer`;
    if (!Number.isSafeInteger(e.cycle) || (e.cycle as number) < 1) return `${where}: cycle must be a positive integer`;
    try {
      pondScoreTerms(e.score);
    } catch (err) {
      return `${where}: ${(err as Error).message}`;
    }
    const step = e.step as number, cycle = e.cycle as number;
    if (step < lastStep) return `${where} (t=${step}) follows a pressure at t=${lastStep}: pressures are in step order`;
    if (cycle < lastCycle) return `${where} (cycle ${cycle}) follows a pressure for cycle ${lastCycle}: pressures are in cycle order`;
    const allowed = [Math.floor(step / period) + 1];
    if (step > 0 && step % period === 0) allowed.unshift(step / period);
    if (!allowed.includes(cycle)) return `${where} at t=${step} says cycle ${cycle}, but a pressure set then governs cycle ${allowed.join(" or ")}: not the observed history`;
    lastStep = step;
    lastCycle = cycle;
  }
  return null;
}

/**
 * The step-order rule for a mixed lab log. At one step s the only order the lab produces is
 *   [pressure with cycle = s/p]*, pick(s)?, [pressure with cycle = s/p + 1 | lesion | feed]*,
 * where pick(s) is required when a pressure for cycle s/p is there.
 * Returns the first violation (naming the entries) or null. Used by `labHistory`, and so by the session file validator.
 * The lab logs a boundary's pick first, and a headless run applies the boundary before the interventions of its step; a
 * pressure for the boundary's own cycle is part of that boundary, so it comes before the pick. The lab logs such a pressure
 * only while that cycle waits for its donors, and a waiting cycle always ends in a logged pick (breeder mode off answers it
 * with the rule's donors); a waiting world cannot be saved or exported, so no log the lab writes stops between the two.
 */
export function pressureLogError(log: readonly { step: number; kind: string; cycle?: number }[], period: number): string | null {
  let at = -1;
  // 0: before the boundary, 1: the pick is in, 2: after it (a lesion, a feed or a pressure for a later cycle); `after` says which
  let phase = 0, after = "";
  /** The entry of a pressure for the boundary's own cycle at `at` that no pick has followed yet, or -1. */
  let unpicked = -1;
  const orphan = () => `interventions[${unpicked}] (pressure at t=${at}) is for cycle ${at / period}, but no pick for that cycle follows it: the lab logs one only while that cycle waits, and the pick always follows`;
  for (let i = 0; i < log.length; i++) {
    const { step, kind, cycle } = log[i];
    if (step !== at) {
      if (unpicked >= 0) return orphan();
      at = step;
      phase = 0;
      after = "";
    }
    const here = `interventions[${i}] (${kind} at t=${step})`;
    if (kind === "pick") {
      if (phase === 2)
        return after === "pressure"
          ? `${here} follows a pressure for the next cycle at the same step: a boundary's pick comes before anything set after it`
          : `${here} follows a lesion or feed at the same step: the lab logs a boundary's pick first, and a headless run applies the boundary before the interventions of its step`;
      phase = 1;
      unpicked = -1;
    } else if (kind === "pressure" && cycle !== undefined && cycle * period === step) {
      if (phase === 1) return `${here} for cycle ${cycle} comes after the pick for cycle ${cycle}: a pressure for cycle ${cycle} must come before the pick for cycle ${cycle}`;
      if (phase === 2) return `${here} for cycle ${cycle} follows a lesion, feed or later pressure at the same step: it must come before the boundary's pick`;
      if (unpicked < 0) unpicked = i;
    } else {
      if (unpicked >= 0) return orphan();
      phase = 2;
      if (kind === "pressure") after = "pressure";
      else if (after === "") after = "hand";
    }
  }
  return unpicked >= 0 ? orphan() : null;
}

/** The rule's donors at boundary `b` under the pressures: `pondDonors(pre, b, cfg.pondArm, cfg.pondK, activePondScore(pressures, b) ?? cfg.pondScore)`. */
export function ruleDonors(pre: WorldState, b: number, cfg: WorldConfig, pressures: readonly PressureEntry[]): number[] {
  return pondDonors(pre, b, cfg.pondArm as "scaf" | "rand" | "breed", cfg.pondK!, activePondScore(pressures, b) ?? cfg.pondScore);
}

/**
 * A `DonorHook` for a boundary with no recorded or hand pick: the rule's donors under the pressures read at call time, `undefined`
 * (leaving the arm's own cycle, byte for byte) when no pressure governs b, when its score is the config's own, or when no pond is occupied.
 * `getPressures` is a function so a host's list may grow between boundaries.
 */
export function pressureHook(cfg: WorldConfig, getPressures: () => readonly PressureEntry[]): DonorHook {
  return async (pre, b) => {
    const active = activePondScore(getPressures(), b);
    if (cfg.pondArm !== "breed" || active === undefined || active === cfg.pondScore) return undefined;
    if (!pondTraits(pre).some((t) => t > 0)) return undefined;
    return ruleDonors(pre, b, cfg, getPressures());
  };
}

/** What `makeDonorHook` tells the runner about the boundary it just answered. */
export interface PickNote {
  /** Who chose: the picker's name, "recorded", "rule(implicit)", or "none" when no pond is occupied. */
  by: string;
  /** The arm's own donors (`pondDonors`), kept in the log for agreement statistics; no picker's answer depends on them. */
  suggested: number[];
  /** The request for `Picker.applied`, present when a picker is attached and a pond is occupied. */
  request?: PickRequest;
}

export interface DonorHookArgs {
  cfg: WorldConfig;
  /** Recorded donors by absolute step; the record wins where it has an entry. */
  recorded: ReadonlyMap<number, PickEntry>;
  picker?: Picker;
  /** A lab manifest's history is sparse: with no record and no picker, a boundary takes the rule's donors. */
  implicitRule?: boolean;
  sink: { appendText(path: string, text: string): Promise<void> };
  /** Filled in at every call, for the runner's pick line. */
  note: PickNote;
  /**
   * The lab's pressures (a pressured run, `RunSpec.pressures`): the arm's own donors, which a picker is shown as `suggested`
   * and the implicit rule answers, are those of the score the latest pressure with cycle <= b names. Absent: `cfg.pondScore`.
   */
  pressures?: readonly PressureEntry[];
}

/**
 * The `DonorHook` of a picked run: at boundary `b` it takes the recorded entry if there is one (validated with
 * `pondPickError` alone), else asks the picker (validated with `livePickError`), and answers `undefined` only when no
 * pond is occupied (the arm's own empty cycle; a recorded non-empty list there is a failure). Any problem appends a
 * `failed` line and throws `PickError` before anything is applied. The hook writes its answer into `note`; the
 * runner appends the pick line itself, from the donors the boundary reports.
 */
export function makeDonorHook(args: DonorHookArgs): DonorHook {
  const { cfg, recorded, picker, implicitRule, sink, note, pressures } = args;
  return async (pre, b) => {
    const step = pre.step;
    const fail = async (by: string, reason: string): Promise<never> => {
      await sink.appendText(PICKS_FILE, formatFailedLine(step, b, by, reason));
      throw new PickError(`pond cycle ${b} at t=${step}: ${reason}`);
    };
    const arm = cfg.pondArm;
    if (arm !== "scaf" && arm !== "rand" && arm !== "breed") return fail("none", `pond arm ${JSON.stringify(arm)} chooses no donors`);
    const traits = pondTraits(pre);
    const occupied = traits.flatMap((t, p) => (t > 0 ? [p] : []));
    const entry = recorded.get(step);
    if (entry && entry.cycle !== b) return fail("recorded", `the recorded pick says cycle ${entry.cycle}`);
    note.request = undefined;
    if (!occupied.length) {
      note.by = "none";
      note.suggested = [];
      if (entry && entry.donors.length) return fail("recorded", `the recorded pick names ${entry.donors.join(", ")}, but no pond is occupied`);
      return undefined;
    }
    const suggested = ruleDonors(pre, b, cfg, pressures ?? []);
    note.suggested = suggested;
    const request: PickRequest | undefined = picker ? { step, cycle: b, pre: detachState(pre), k: cfg.pondK!, occupied, suggested: [...suggested], max: suggested.length } : undefined;
    note.request = request;
    if (entry) {
      note.by = "recorded";
      const bad = pondPickError(traits, entry.donors);
      if (bad) return fail("recorded", bad);
      return [...entry.donors];
    }
    if (!request) {
      if (!implicitRule) return fail("none", "no recorded pick for this boundary and no picker");
      note.by = "rule(implicit)";
      return [...suggested];
    }
    note.by = picker!.name;
    let donors: number[];
    try {
      donors = [...(await picker!.pick(request))];
    } catch (e) {
      return fail(picker!.name, thrownMessage(e));
    }
    // Against the runner's own state and count, never the request's: a picker may have changed its snapshot.
    const bad = liveError(traits, suggested.length, donors);
    if (bad) return fail(picker!.name, bad);
    return donors;
  };
}

// ---- Fixed, content-addressed pick logs (docs/archipelago-breed-2026-10-18.md, amendment 2026-11-02) ----

const K256 = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** Synchronous SHA-256 (lowercase hex). `stitchRun` is synchronous and a pick log is small; checked against `crypto.subtle` in tests. */
export function sha256Hex(data: Uint8Array): string {
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const len = data.length;
  const padded = new Uint8Array(((len + 9 + 63) >> 6) << 6);
  padded.set(data);
  padded[len] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor((len * 8) / 0x100000000));
  view.setUint32(padded.length - 4, (len * 8) >>> 0);
  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K256[i] + w[i]) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += hh;
  }
  return Array.from(h, (x) => x.toString(16).padStart(8, "0")).join("");
}

const utf8 = (text: string) => new TextEncoder().encode(text);

/** Most bytes of an input pick log (the coordinator enforces the same cap). */
export const PICK_LOG_MAX_BYTES = 1_048_576;

/**
 * The input pick log as canonical text: one `{"step","kind":"pick","cycle","donors"}` line per entry, ascending, no `by`
 * or `suggested`, each line ending in a newline. The bytes are what is hashed and stored: the same entries always give the
 * same text, whatever file (a picks.jsonl, a lab manifest, a merge of both) they came from.
 */
export function canonicalPickLog(entries: readonly PickEntry[]): string {
  return entries.map((e) => JSON.stringify({ step: e.step, kind: "pick", cycle: e.cycle, donors: e.donors }) + "\n").join("");
}

/** The address of an input pick log: lowercase hex SHA-256 of its canonical text's UTF-8 bytes. */
export function pickLogDigest(text: string): string {
  return sha256Hex(utf8(text));
}

/**
 * The entries of an input pick log, or a thrown `Error`: the text must be exactly the canonical text of the entries it
 * holds (so a digest names one history), within `PICK_LOG_MAX_BYTES`, every line a pick, steps ascending.
 */
export function parseCanonicalPickLog(text: string): PickEntry[] {
  if (utf8(text).length > PICK_LOG_MAX_BYTES) throw new Error(`the pick log is over ${PICK_LOG_MAX_BYTES} bytes`);
  const entries = parsePickLog(text);
  if (text.split("\n").filter((l) => l.trim() !== "").length !== entries.length) throw new Error("the pick log holds a line that is not a pick");
  if (canonicalPickLog(entries) !== text) throw new Error("the pick log is not in canonical form (one {step,kind,cycle,donors} line per pick, in that key order, each ending in a newline)");
  return entries;
}

/** Fetched or stored pick-log bytes against the digest naming them: the entries, or a thrown `Error` saying which check failed. */
export function verifiedPickLog(text: string, digest: string): PickEntry[] {
  const got = pickLogDigest(text);
  if (got !== digest) throw new Error(`the pick log hashes to ${got}, not the spec's ${digest}`);
  return parseCanonicalPickLog(text);
}

/**
 * The picks a run applied, read back out of its ponds.tsv (`pondsText`, the whole run's or a stitched one) and `seed`: per
 * boundary the ordered donors the cycle used (the recipients, in the cycle's own key order, take donors[i % D]; D is the
 * first index at which the first donor repeats, else every pond), or [] where every row says donor -1. Every pond is a
 * recipient and D <= the pond count, so the whole ordered list is recoverable. Ascending by cycle. A table that is not a
 * consistent set of rows is a thrown `Error`; `picksConsistencyError` re-checks the result against the same table.
 */
export function appliedPicksFromPonds(pondsText: string, seed: number): PickEntry[] {
  const byCycle = new Map<number, Record<string, string>[]>();
  for (const row of tsvTable(pondsText)) {
    const b = Number(row.cycle);
    byCycle.set(b, [...(byCycle.get(b) ?? []), row]);
  }
  const out: PickEntry[] = [];
  for (const b of [...byCycle.keys()].sort((x, y) => x - y)) {
    const rows = byCycle.get(b)!;
    const steps = new Set(rows.map((r) => Number(r.step)));
    if (steps.size !== 1) throw new Error(`ponds.tsv boundary ${b}: rows at more than one step`);
    const step = [...steps][0];
    const donorOf = new Map(rows.map((r) => [Number(r.recipient), Number(r.donor)]));
    if ([...donorOf.values()].every((d) => d === -1)) {
      out.push({ step, cycle: b, donors: [] });
      continue;
    }
    if ([...donorOf.values()].some((d) => d === -1)) throw new Error(`ponds.tsv boundary ${b}: some rows have donor -1 and others a donor`);
    const order = [...donorOf.keys()].map((pond) => ({ pond, key: randomKey(seed, b, pond, 2) })).sort((x, y) => x.key - y.key || x.pond - y.pond);
    const seq = order.map((o) => donorOf.get(o.pond)!);
    let d = 1;
    while (d < seq.length && seq[d] !== seq[0]) d++;
    out.push({ step, cycle: b, donors: seq.slice(0, d) });
  }
  return out;
}

/** Who chose a boundary of a stitched picked run, as the runner words it: "recorded" for an input entry with a donor, "none" with no donor, else "rule(implicit)". */
const chosenBy = (e: PickEntry, recorded: ReadonlySet<number>): string => (e.donors.length === 0 ? "none" : recorded.has(e.step) ? "recorded" : "rule(implicit)");

/** The `picks.jsonl` text of a stitched picked run: every boundary and its `by`; no `suggested`, which only the run that chose could know. */
export function appliedPicksText(applied: readonly PickEntry[], input: readonly PickEntry[]): string {
  const recorded = new Set(input.map((e) => e.step));
  return applied.map((e) => JSON.stringify({ step: e.step, kind: "pick", cycle: e.cycle, donors: e.donors, by: chosenBy(e, recorded) }) + "\n").join("");
}

/**
 * Why the history a picked run applied (`applied`, from `appliedPicksFromPonds`) does not follow its input pick log, or null:
 * every input entry must be in it identically, and every other boundary is an implicit one, allowed only when `implicit`.
 */
export function appliedHistoryError(applied: readonly PickEntry[], input: readonly PickEntry[], implicit: boolean): string | null {
  const at = new Map(applied.map((e) => [e.step, e]));
  for (const e of input) {
    const a = at.get(e.step);
    if (!a) return `the pick log has an entry at t=${e.step}, which the run has no boundary at`;
    if (a.cycle !== e.cycle || a.donors.join() !== e.donors.join()) return `at t=${e.step} the run applied donors [${a.donors.join(", ")}], the pick log says [${e.donors.join(", ")}]`;
  }
  if (!implicit && applied.length !== input.length) {
    const have = new Set(input.map((e) => e.step));
    const miss = applied.find((e) => !have.has(e.step))!;
    return `the pick log has no entry for the boundary at t=${miss.step}, and the run is strict (no pickImplicit)`;
  }
  return null;
}

/** The manifest `picks` block of a stitched picked run, over the whole run (what `runExperiment` writes for one continuous run); live is 0, a pick log has no picker. */
export function stitchedPicksBlock(applied: readonly PickEntry[], input: readonly PickEntry[]): { file: string; picker: string; recorded: number; live: number; boundaries: number; digest: string } {
  const recorded = new Set(input.map((e) => e.step));
  return {
    file: PICKS_FILE,
    picker: "replay",
    recorded: applied.filter((e) => chosenBy(e, recorded) === "recorded").length,
    live: 0,
    boundaries: applied.length,
    digest: sha256Hex(utf8(JSON.stringify(applied.map((e) => [e.step, e.donors])))).slice(0, 16),
  };
}
