// The session file (`cadence-garden.session`, version 3; docs/pond-keeper-v0-2026-10-17.md, v1 and v2): the lab run
// manifest's history fields plus the settled final state, the log of firsts, the family tree and the session card's
// numbers. It is a superset of the lab run manifest, so `tools/run.ts --picks-from <file>` replays it as it
// replays one: picks, wounds, feeds and pressures as logged, checked against the one checkpoint entry the file holds.
// Version 1 (rule set firsts-v0, no pressure) and version 2 (firsts-v1) are still read; this lab writes version 3
// (firsts-v2, and the `families` block of rule set families-v1). The added fields are ones tools/run.ts ignores.
// Pure functions and plain data, no DOM and no storage: the worker builds the file, the page only saves it,
// and a Deno script can import this module to check a file it did not write.
import { PRESETS, presetConfig, type InitParams, type Intervention, type WorldConfig } from "@bl/schema";
import { labHistory, sameConfig, type ObserverSettings } from "@bl/runner";
import {
  FAMILIES_RULESET, FIRSTS_RULESET, FIRSTS_RULESET_V0, FIRSTS_RULESET_V1,
  type FamilyEvent, type FamilySnapshot, type FamilyStatus, type FamilySummary, type FamilyView, type FirstsEntry, type FirstsSnapshot, type FirstsSummary,
} from "@bl/metrics";
import type { ReplayReading, RunManifest, SessionFacts } from "./protocol.ts";

export const SESSION_FORMAT = "cadence-garden.session" as const;
/** The version this lab writes, and every version it reads. */
export const SESSION_VERSION = 3 as const;
export const SESSION_VERSIONS = [1, 2, 3] as const;
/** The rule set of the log of firsts that goes with each version. */
const FIRSTS_RULES_OF = { 1: FIRSTS_RULESET_V0, 2: FIRSTS_RULESET_V1, 3: FIRSTS_RULESET } as const;

const FAMILY_STATUSES: readonly FamilyStatus[] = ["living", "film", "extinct"];
const FAMILY_EVENT_KINDS: readonly FamilyEvent["kind"][] = ["split", "film", "back", "extinct", "found"];

/**
 * The family tree as a version 3 file holds it (docs/pond-keeper-v2-2026-10-17.md section 4). `founder` is the founding
 * lineage's key, `parent` the parent family's founding key (null for a root family), `purity` a fraction (null with no body),
 * and an event's `family` the founding key of the family it is about.
 */
export interface FamiliesBlock {
  rules: typeof FAMILIES_RULESET;
  watchedFrom: number | null;
  families: { name: string; founder: string; parent: string | null; founded: number; unknownDescent: boolean; status: FamilyStatus; cells: number; bodies: number; purity: number | null }[];
  events: { step: number; kind: FamilyEvent["kind"]; family: string; detail: string }[];
}

/** What the worker hands `buildSessionFile` of the tree: `FamilyTree.watchedFrom`, `.families()` and `.events()`. */
export interface FamiliesReading {
  watchedFrom: number | null;
  families: readonly FamilyView[];
  events: readonly FamilyEvent[];
}

/** The tree as the file holds it: only the note's fields, in the tree's order. */
export function familiesBlock(r: FamiliesReading): FamiliesBlock {
  return {
    rules: FAMILIES_RULESET,
    watchedFrom: r.watchedFrom,
    families: r.families.map((f) => ({ name: f.name, founder: f.founder, parent: f.parent, founded: f.founded, unknownDescent: f.unknownDescent, status: f.status, cells: f.cells, bodies: f.bodies, purity: f.purity })),
    events: r.events.map((e) => ({ step: e.step, kind: e.kind, family: e.family, detail: e.detail })),
  };
}

export interface SessionCard {
  summary: FirstsSummary;
  facts: SessionFacts;
}

export interface SessionFile {
  format: typeof SESSION_FORMAT;
  version: (typeof SESSION_VERSIONS)[number];
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
  firsts: { rules: (typeof FIRSTS_RULES_OF)[keyof typeof FIRSTS_RULES_OF]; watchedFrom: number | null; entries: FirstsEntry[] };
  /** Version 3 only: the family tree (rule set families-v1) at the final census. */
  families?: FamiliesBlock;
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
  families: FamiliesReading;
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
    families: familiesBlock(a.families),
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
  if (f.version !== 1 && f.version !== 2 && f.version !== 3) return `session file version ${JSON.stringify(f.version)}: this lab reads versions 1, 2 and 3`;
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
    if (!isObj(iv) || !isStep(iv.step) || (iv.kind !== "lesion" && iv.kind !== "feed" && iv.kind !== "pick" && iv.kind !== "pressure")) return `interventions[${i}] is not a pick, a lesion, a feed or a pressure`;
    if (iv.kind === "pressure" && f.version === 1) return `interventions[${i}] is a pressure, which a version 1 file cannot hold: pressures came with version 2`;
    if (iv.step < last) return `interventions[${i}] (at t=${iv.step}) comes after one at t=${last}: the log must run in step order`;
    if (iv.step > fin.step) return `interventions[${i}] is at t=${iv.step}, after the file’s final step t=${fin.step}`;
    last = iv.step;
  }
  if (fin.interventions !== f.interventions.length) return `final says ${fin.interventions} interventions, the file holds ${f.interventions.length}`;
  const ck = f.checkpoints;
  if (!Array.isArray(ck) || ck.length !== 1 || !isObj(ck[0])) return "checkpoints must hold exactly one entry, the final state";
  if (ck[0].step !== fin.step || ck[0].hash !== fin.stateHash || ck[0].interventions !== fin.interventions) return "the file’s checkpoint entry and its final state disagree";
  const fr = f.firsts;
  // The rule set goes with the version: a version 1 file was written under firsts-v0, a version 2 file under firsts-v1, a version 3 file under firsts-v2.
  const rules = FIRSTS_RULES_OF[f.version];
  if (!isObj(fr) || fr.rules !== rules) return `a version ${f.version} file’s firsts must name the rule set “${rules}”`;
  if (!(fr.watchedFrom === null || isStep(fr.watchedFrom)) || !Array.isArray(fr.entries)) return "firsts must give watchedFrom and a list of entries";
  for (const e of fr.entries) if (!isObj(e) || !isStr(e.id) || !isStr(e.name) || !isStep(e.step) || typeof e.already !== "boolean" || typeof e.detail !== "string") return "a firsts entry is malformed";
  const card = f.card;
  if (!isObj(card) || !isObj(card.summary) || !isObj(card.facts)) return "card must give a summary and facts";
  if (f.version === 3) {
    const bad = familiesError(f.families, card.facts.families, fin.step);
    if (bad) return bad;
  } else if (f.families !== undefined) return `a version ${f.version} file has no families block: the family tree came with version 3`;
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

/** Null when `block` is a well-formed families block and the card's counts agree with it, else the first thing wrong, in plain words. */
function familiesError(block: unknown, counts: unknown, finalStep: number): string | null {
  if (!isObj(block) || block.rules !== FAMILIES_RULESET) return `a version 3 file must hold a families block under the rule set “${FAMILIES_RULESET}”`;
  if (!(block.watchedFrom === null || isStep(block.watchedFrom)) || !Array.isArray(block.families) || !Array.isArray(block.events)) return "families must give watchedFrom, a list of families and a list of events";
  if (block.watchedFrom !== null && block.watchedFrom > finalStep) return `the family tree began watching at t=${block.watchedFrom}, after the final state at t=${finalStep}`;
  const founders = new Set<string>(), names = new Set<string>();
  for (const [i, fam] of block.families.entries()) {
    const x: unknown = fam;
    if (!isObj(x) || !isStr(x.name) || !isStr(x.founder) || !(x.parent === null || isStr(x.parent)) || !isStep(x.founded) || typeof x.unknownDescent !== "boolean" ||
      !FAMILY_STATUSES.includes(x.status as FamilyStatus) || !isStep(x.cells) || !isStep(x.bodies) || !(x.purity === null || (typeof x.purity === "number" && x.purity >= 0 && x.purity <= 1)))
      return `families.families[${i}] is malformed`;
    if (founders.has(x.founder)) return `families.families[${i}] repeats the founding lineage ${x.founder}`;
    if (names.has(x.name)) return `families.families[${i}] repeats the name “${x.name}”`;
    founders.add(x.founder);
    names.add(x.name);
    if (x.status === "extinct" && x.cells !== 0) return `families.families[${i}] is extinct but holds ${x.cells} cells`;
    if (block.watchedFrom === null || x.founded < block.watchedFrom) return `families.families[${i}] was founded before the tree began watching`;
    if (x.founded > finalStep) return `families.families[${i}] was founded at t=${x.founded}, after the final state at t=${finalStep}`;
  }
  for (const [i, fam] of block.families.entries()) {
    const parent = (fam as { parent: string | null; founder: string }).parent;
    if (parent !== null && (!founders.has(parent) || parent === (fam as { founder: string }).founder)) return `families.families[${i}] names a parent family that is not in the list`;
  }
  // The parent links form a tree: from every family, following parents reaches a root family within as many steps as there are families.
  const parentOf = new Map((block.families as { founder: string; parent: string | null }[]).map((x) => [x.founder, x.parent] as const));
  const foundedOf = new Map((block.families as { founder: string; founded: number }[]).map((x) => [x.founder, x.founded] as const));
  for (const [i, fam] of block.families.entries()) {
    let cur: string | null = (fam as { founder: string }).founder;
    for (let n = 0; cur !== null; n++) {
      if (n > parentOf.size) return `families.families[${i}] sits on a loop of parent families`;
      cur = parentOf.get(cur) ?? null;
    }
  }
  let last = 0;
  for (const [i, ev] of block.events.entries()) {
    const e: unknown = ev;
    if (!isObj(e) || !isStep(e.step) || !FAMILY_EVENT_KINDS.includes(e.kind as FamilyEvent["kind"]) || !isStr(e.family) || typeof e.detail !== "string") return `families.events[${i}] is malformed`;
    if (!founders.has(e.family)) return `families.events[${i}] is about a family that is not in the list`;
    if (e.step < foundedOf.get(e.family)! || e.step > finalStep) return `families.events[${i}] (at t=${e.step}) falls outside its family's history, from its founding to the final state at t=${finalStep}`;
    if (e.step < last) return `families.events[${i}] (at t=${e.step}) comes after one at t=${last}: the log must run in step order`;
    last = e.step;
  }
  if (!isObj(counts)) return "card.facts must give the family counts";
  const list = block.families as { parent: string | null; status: FamilyStatus }[];
  const tally = (f: (x: { parent: string | null; status: FamilyStatus }) => boolean) => list.filter(f).length;
  for (const k of ["named", "starting", "split", "living", "film", "extinct"] as const) if (!isStep(counts[k])) return `card.facts.families.${k} is not a whole number`;
  const c = counts as Record<string, number>;
  if (c.named !== list.length || c.split !== tally((x) => x.parent !== null) || c.living !== tally((x) => x.status === "living") || c.film !== tally((x) => x.status === "film") || c.extinct !== tally((x) => x.status === "extinct") || c.starting + c.split > c.named)
    return "the card’s family counts disagree with the families block";
  return null;
}

/**
 * What the card says of the log: picks (who chose them, from the worker's notes), wounds, feeds and drains, beside
 * the world's own step and the pond cycles it has run (`at`), which the log alone cannot give: a cycle the Breeder
 * did not stop at logs no pick; and the family tree's counts (`families`, the tree's summary; zeros without one).
 */
export function interventionFacts(interventions: readonly Intervention[], pickNotes: ReadonlyMap<number, boolean>, replay: ReplayReading | null, at: { step: number; cycles: number; cyclesBefore: number } = { step: 0, cycles: 0, cyclesBefore: 0 }, families?: FamilySummary): SessionFacts {
  const facts: SessionFacts = {
    picks: { total: 0, byHand: 0, byRule: 0, unknown: 0 }, wounds: 0, feeds: 0, drains: 0, replay, step: at.step, cycles: at.cycles, cyclesBefore: at.cyclesBefore, pressures: { changes: 0, latest: null },
    families: families ? { named: families.named, starting: families.starting, split: families.split, living: families.living, film: families.film, extinct: families.extinct } : { named: 0, starting: 0, split: 0, living: 0, film: 0, extinct: 0 },
  };
  for (const iv of interventions) {
    // A pressure changes the rule's score, not a cycle's donors: it is counted apart, never as a pick.
    if (iv.kind === "pressure") {
      facts.pressures.changes++;
      facts.pressures.latest = iv.score;
    } else if (iv.kind === "lesion") facts.wounds++;
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
  /** The family tree at the same census, with the genealogy it was read against; absent when the tree had stopped. */
  families?: FamilyRecord;
}

/**
 * The mutation edges a family tree was read against: the step they are complete from, how many there were and how many ledger
 * records had been dropped. A tree restored with a world whose genealogy differs would read other parent links (or none) than it
 * was built on, so it is brought back only when this is the same (docs/pond-keeper-v2-2026-10-17.md section 4).
 */
export interface Genealogy {
  edgesFrom: number;
  edges: number;
  dropped: number;
}

export interface FamilyRecord {
  tree: FamilySnapshot;
  genealogy: Genealogy;
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
