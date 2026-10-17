// The session file (`cadence-garden.session`, version 1; docs/pond-keeper-v0-2026-10-17.md): the lab run
// manifest's history fields plus the settled final state, the log of firsts and the session card's
// numbers. It is a superset of the lab run manifest, so `tools/run.ts --picks-from <file>` replays it as it
// replays one: picks, wounds and feeds as logged, checked against the one checkpoint entry the file holds.
// Pure functions and plain data, no DOM and no storage: the worker builds the file, the page only saves it,
// and a Deno script can import this module to check a file it did not write.
import { PRESETS, presetConfig, type InitParams, type Intervention, type WorldConfig } from "@bl/schema";
import { labHistory, sameConfig, type ObserverSettings } from "@bl/runner";
import { FIRSTS_RULESET, type FirstsEntry, type FirstsSnapshot, type FirstsSummary } from "@bl/metrics";
import type { ReplayReading, RunManifest, SessionFacts } from "./protocol.ts";

export const SESSION_FORMAT = "cadence-garden.session" as const;
export const SESSION_VERSION = 1 as const;

export interface SessionCard {
  summary: FirstsSummary;
  facts: SessionFacts;
}

export interface SessionFile {
  format: typeof SESSION_FORMAT;
  version: typeof SESSION_VERSION;
  // The lab run manifest's history fields: tools/run.ts reads these.
  runId: string;
  presetId: string;
  seed: number;
  ruleVersion: number;
  cfg: WorldConfig;
  init: InitParams;
  startHash: string;
  settings: ObserverSettings;
  interventions: Intervention[];
  edgesFrom: 0;
  /** One entry, the final state, which run.ts compares when `--steps` equals `final.step`. */
  checkpoints: [{ step: number; file: "session-final"; hash: string; interventions: number }];
  /** The step the world was settled at, the physics hash there (`stateHash`), and how many logged interventions it holds. */
  final: { step: number; stateHash: string; interventions: number };
  firsts: { rules: typeof FIRSTS_RULESET; watchedFrom: number | null; entries: FirstsEntry[] };
  card: SessionCard;
  /** The exact tools/run.ts command; `--picks-from` names the file's own name. */
  replay: string;
  createdAt: string;
  /** The GPU adapter's description. No user agent: the file is meant to be shared. */
  adapter: string;
}

/**
 * Why this world's history cannot be rebuilt from step 0 (so no session file), in plain words, or null when it
 * can: planted here from a preset as it is, with the record of its start and every edge from step 0.
 */
export function exportRefusal(m: Pick<RunManifest, "presetId" | "seed" | "cfg" | "startHash" | "edgesFrom">): string | null {
  const preset = PRESETS.find((p) => p.id === m.presetId);
  if (m.presetId === "imported") return "This world was opened from a file, so its history before that file isn’t here and a replay can’t rebuild it from step 0. Its checkpoint download still works.";
  if (!preset) return `“${m.presetId}” isn’t one of the lab’s worlds, so a replay can’t rebuild it from step 0.`;
  if ((m.edgesFrom ?? 0) > 0) return `This world was opened from a file at t=${m.edgesFrom}: its history before that isn’t here, so a replay can’t rebuild it from step 0. Its checkpoint download still works.`;
  if (!m.startHash) return "This world has no record of the start it was planted from, so a replay can’t check it began the same way.";
  if (m.cfg.pondArm === "nat" || m.cfg.pondArm === "shuf") return `This world uses pond arm “${m.cfg.pondArm}”, one the lab doesn’t run; a session file only describes lab worlds.`;
  if (!sameConfig(m.cfg, presetConfig(preset, m.seed))) return "This world was planted with settings changed from its preset, which tools/run.ts can’t be told about, so a replay would build another world.";
  return null;
}

/** FNV-1a, 32 bits, of a string's UTF-16 code units, as 8 hex digits: a name for a history, not a security measure. */
function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(16).padStart(8, "0");
}

/**
 * The replay's experiment name: the final state (12 hex digits of its hash) and the logged history (a hash of the
 * interventions), so two sessions of one world and seed land in different run directories even when they end in the
 * same state (run.ts never reuses a complete replay directory). Within `[a-z0-9_-]{1,64}`, as run.ts requires.
 */
export function replayExperiment(f: { interventions: readonly Intervention[]; final: { stateHash: string } }): string {
  return `pond-keeper-${f.final.stateHash.slice(0, 12).toLowerCase().replace(/[^a-z0-9]/g, "0")}-${fnv1a(JSON.stringify(f.interventions))}`;
}

/** The tools/run.ts command that replays `fileName`'s history, as the file states it. */
export function replayCommand(f: Pick<SessionFile, "presetId" | "seed" | "settings" | "interventions"> & { final: { step: number; stateHash: string } }, fileName: string): string {
  return [
    `deno run -A tools/run.ts --experiment ${replayExperiment(f)}`, `--preset ${f.presetId}`, "--conditions treatment", `--seeds ${f.seed}`,
    `--steps ${f.final.step}`, `--census ${f.settings.censusEvery}`, `--deep ${f.settings.deepEvery}`, `--picks-from ${fileName}`,
  ].join(" ");
}

export const sessionFileName = (runId: string, step: number) => `${runId}-t${step}.session.json`;

/**
 * The file for a world settled at `step` (a census), with every logged intervention up to it. `manifest.startHash`
 * is required: callers run `exportRefusal` first.
 */
export function buildSessionFile(a: {
  manifest: RunManifest;
  stateHash: string;
  step: number;
  firsts: { watchedFrom: number | null; entries: readonly FirstsEntry[] };
  card: SessionCard;
  adapter: string;
  createdAt: string;
}): SessionFile {
  const m = a.manifest;
  if (!m.startHash) throw new Error("a session file needs the hash of the world the run started from");
  const interventions = structuredClone(m.interventions.filter((iv) => iv.step <= a.step));
  const file: Omit<SessionFile, "replay"> = {
    format: SESSION_FORMAT,
    version: SESSION_VERSION,
    runId: m.runId,
    presetId: m.presetId,
    seed: m.seed,
    ruleVersion: m.ruleVersion,
    cfg: structuredClone(m.cfg),
    init: structuredClone(m.init),
    startHash: m.startHash,
    settings: structuredClone(m.settings),
    interventions,
    edgesFrom: 0,
    checkpoints: [{ step: a.step, file: "session-final", hash: a.stateHash, interventions: interventions.length }],
    final: { step: a.step, stateHash: a.stateHash, interventions: interventions.length },
    firsts: { rules: FIRSTS_RULESET, watchedFrom: a.firsts.watchedFrom, entries: structuredClone([...a.firsts.entries]) },
    card: structuredClone(a.card),
    createdAt: a.createdAt,
    adapter: a.adapter,
  };
  return { ...file, replay: replayCommand(file, sessionFileName(m.runId, a.step)) };
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isStep = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const isStr = (v: unknown): v is string => typeof v === "string" && v.length > 0;

/**
 * Null when `file` (an object or its JSON text) is a well-formed session file, else the first thing wrong with it,
 * in plain words. Checks the file's own consistency (its one checkpoint equals its final state, its counts and
 * order add up, its replay command is the one it should carry); only a replay says whether the hash is the lab's.
 */
export function sessionFileError(file: unknown): string | null {
  let f = file;
  if (typeof f === "string") {
    try {
      f = JSON.parse(f);
    } catch {
      return "not a session file: the text isn’t JSON";
    }
  }
  if (!isObj(f)) return "not a session file: expected a JSON object";
  if (f.format !== SESSION_FORMAT) return `not a session file: its format is ${JSON.stringify(f.format)}, not “${SESSION_FORMAT}”`;
  if (f.version !== SESSION_VERSION) return `session file version ${JSON.stringify(f.version)}: this lab reads version ${SESSION_VERSION}`;
  for (const k of ["runId", "presetId", "startHash", "replay", "createdAt", "adapter"] as const) if (!isStr(f[k])) return `${k} is missing or not text`;
  if (!isStep(f.seed)) return "seed is not a whole number";
  if (!isStep(f.ruleVersion)) return "ruleVersion is not a whole number";
  if (!isObj(f.cfg)) return "cfg is missing";
  if (!isObj(f.init)) return "init is missing";
  const s = f.settings;
  if (!isObj(s) || !isStep(s.censusEvery) || s.censusEvery === 0 || !isStep(s.deepEvery) || s.deepEvery === 0) return "settings must give a positive censusEvery and deepEvery";
  if (f.edgesFrom !== 0) return `edgesFrom is ${JSON.stringify(f.edgesFrom)}: a session file covers a history from step 0`;
  const fin = f.final;
  if (!isObj(fin) || !isStep(fin.step) || !isStr(fin.stateHash) || !isStep(fin.interventions)) return "final must give a step, a stateHash and a count of interventions";
  if (fin.step === 0) return "final.step is 0: a world that has not reached a census has no history to replay";
  if (!Array.isArray(f.interventions)) return "interventions is not a list";
  let last = 0;
  for (let i = 0; i < f.interventions.length; i++) {
    const iv: unknown = f.interventions[i];
    if (!isObj(iv) || !isStep(iv.step) || (iv.kind !== "lesion" && iv.kind !== "feed" && iv.kind !== "pick")) return `interventions[${i}] is not a pick, a lesion or a feed`;
    if (iv.step < last) return `interventions[${i}] (at t=${iv.step}) comes after one at t=${last}: the log must run in step order`;
    if (iv.step > fin.step) return `interventions[${i}] is at t=${iv.step}, after the file’s final step t=${fin.step}`;
    last = iv.step;
  }
  if (fin.interventions !== f.interventions.length) return `final says ${fin.interventions} interventions, the file holds ${f.interventions.length}`;
  const ck = f.checkpoints;
  if (!Array.isArray(ck) || ck.length !== 1 || !isObj(ck[0])) return "checkpoints must hold exactly one entry, the final state";
  if (ck[0].step !== fin.step || ck[0].hash !== fin.stateHash || ck[0].interventions !== fin.interventions) return "the file’s checkpoint entry and its final state disagree";
  const fr = f.firsts;
  if (!isObj(fr) || fr.rules !== FIRSTS_RULESET) return `firsts must name the rule set “${FIRSTS_RULESET}”`;
  if (!(fr.watchedFrom === null || isStep(fr.watchedFrom)) || !Array.isArray(fr.entries)) return "firsts must give watchedFrom and a list of entries";
  for (const e of fr.entries) if (!isObj(e) || !isStr(e.id) || !isStr(e.name) || !isStep(e.step) || typeof e.already !== "boolean" || typeof e.detail !== "string") return "a firsts entry is malformed";
  const card = f.card;
  if (!isObj(card) || !isObj(card.summary) || !isObj(card.facts)) return "card must give a summary and facts";
  try {
    labHistory(f);
  } catch (e) {
    return `the interventions don’t form a replayable history: ${(e as Error).message}`;
  }
  // Last: the command names the history (its experiment hashes the log), so any edit above would also change it.
  const expected = replayCommand(f as unknown as Pick<SessionFile, "presetId" | "seed" | "settings" | "interventions"> & { final: { step: number; stateHash: string } }, sessionFileName(f.runId as string, fin.step));
  if (f.replay !== expected) return "the replay command isn’t the one this file’s history gives";
  return null;
}

/**
 * What the card says of the log: picks (who chose them, from the worker's notes), wounds, feeds and drains, beside
 * the world's own step and the pond cycles it has run (`at`), which the log alone cannot give: a cycle the Breeder
 * did not stop at logs no pick.
 */
export function interventionFacts(interventions: readonly Intervention[], pickNotes: ReadonlyMap<number, boolean>, replay: ReplayReading | null, at: { step: number; cycles: number; cyclesBefore: number } = { step: 0, cycles: 0, cyclesBefore: 0 }): SessionFacts {
  const facts: SessionFacts = { picks: { total: 0, byHand: 0, byRule: 0, unknown: 0 }, wounds: 0, feeds: 0, drains: 0, replay, step: at.step, cycles: at.cycles, cyclesBefore: at.cyclesBefore };
  for (const iv of interventions) {
    if (iv.kind === "lesion") facts.wounds++;
    else if (iv.kind === "feed") {
      if (iv.amount > 0) facts.feeds++;
      else if (iv.amount < 0) facts.drains++;
    } else {
      facts.picks.total++;
      const hand = pickNotes.get(iv.step);
      if (hand === undefined) facts.picks.unknown++;
      else if (hand) facts.picks.byHand++;
      else facts.picks.byRule++;
    }
  }
  return facts;
}

/**
 * What the world on screen held when a checkpoint file was saved: the log of firsts and the notes on who chose
 * each pick. The checkpoint itself carries neither (that would change its observer digest), so the worker keeps
 * them beside it for as long as this page lives; a file saved on an earlier visit has none.
 */
export interface RewindRecord {
  firsts: FirstsSnapshot;
  picks: [number, boolean][];
  /** stateHash of the checkpoint the snapshot was taken with: a restore uses the snapshot only for that very state. */
  hash: string;
}

/**
 * Rewind records by checkpoint file name, one for every checkpoint this page saved and still keeps: the worker
 * forgets a record when its file is deleted or pruned, so a kept checkpoint never loses its log.
 */
export class RewindStore {
  private readonly records = new Map<string, RewindRecord>();

  set(file: string, r: RewindRecord): void {
    this.records.set(file, r);
  }

  get(file: string): RewindRecord | undefined {
    return this.records.get(file);
  }

  forget(files: readonly string[]): void {
    for (const f of files) this.records.delete(f);
  }

  get size(): number {
    return this.records.size;
  }
}
