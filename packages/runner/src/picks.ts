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
import { cloneState, pondDonors, pondPickError, pondTraits, randomKey, type WorldConfig, type WorldState } from "@bl/schema";
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
}

/**
 * The `DonorHook` of a picked run: at boundary `b` it takes the recorded entry if there is one (validated with
 * `pondPickError` alone), else asks the picker (validated with `livePickError`), and answers `undefined` only when no
 * pond is occupied (the arm's own empty cycle; a recorded non-empty list there is a failure). Any problem appends a
 * `failed` line and throws `PickError` before anything is applied. The hook writes its answer into `note`; the
 * runner appends the pick line itself, from the donors the boundary reports.
 */
export function makeDonorHook(args: DonorHookArgs): DonorHook {
  const { cfg, recorded, picker, implicitRule, sink, note } = args;
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
    const suggested = pondDonors(pre, b, arm, cfg.pondK!, cfg.pondScore);
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
