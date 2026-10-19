// The experiment proposer, v0 (docs/naturalist-proposer-v0-2026-10-18.md, section "Fixed before code"; that section is frozen
// and this file implements it). The AI naturalist's shape 3 in its code baseline: fixed rules turn one ring of a field notebook
// (tools/notebook.ts, its .notes.json) into a run spec in the replayable vocabulary (a fork from a recoverable step of the source,
// then a feed, a drain, a lesion or nothing), with a reason that cites only the ring's receipts and a prediction the fork's and
// the source's bundles decide. Nothing here calls a model, touches a file or runs anything: tools/lib/propose-fs.ts does the I/O
// and tools/propose.ts is the CLI, whose `approve` (a person's yes) is the only way a proposal becomes runnable.
//
// A proposal file is { id, status, approval?, body }. The body holds everything the proposal says; its identity is the SHA-256
// of the body's canonical JSON (keys sorted at every depth, numbers as JSON writes them), `id` is that hash's first 16 hex
// digits, and `approval.bodySha256` binds a yes to that exact body. `status` and `approval` are outside the hash.
import { FEED_MAX, MATTER_MAX, PRESETS, METRICS_VERSION, RULE_VERSION, SCHEMA_VERSION, cellCount, initWorld, maxLesionRadius, sha256HexJS, totalsOf, worldW, type WorldConfig } from "@bl/schema";
import { interventionsError, specConfig, validateInterventions, validateSpec, type RunSpec, type ScheduledIntervention } from "@bl/runner";
import { mulberry32 } from "@bl/metrics";
import { BELL_VERSION, SIGNALS } from "./bell.ts";
import { NOTEBOOK_VERSION, fmtValue, fmtZ, group } from "./notebook.ts";

export const PROPOSAL_VERSION = 0;
export const FORK_EXPERIMENT = "naturalist-fork";

/** The note's constants: W censuses per window, the bell's burn-in, the horizon after S, and the threshold in spreads. */
export interface ProposerConstants {
  W: number;
  burnInStep: number;
  horizon: number;
  threshold: number;
}
/** The values the CLI always passes (the note, "Constants"). Tests may pass smaller ones. */
export const RULES_V0: Readonly<ProposerConstants> = Object.freeze({ W: 50, burnInStep: 10_000, horizon: 20_000, threshold: 1 });

export type Side = "high" | "low";
export type Action = "feed" | "drain" | "lesion" | "control";
export type Direction = "up" | "down";

// ---------------------------------------------------------------------------------------------
// Canonical JSON and identity.

/** Canonical JSON: keys sorted (UTF-16 order) at every depth, no whitespace, numbers as JSON.stringify writes them. Throws on a non-finite number, undefined, or a non-plain object. */
export function canonical(v: unknown, path = "$"): string {
  if (v === null || typeof v === "boolean" || typeof v === "string") return JSON.stringify(v);
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new Error(`canonical: ${path} is not a finite number`);
    return JSON.stringify(v);
  }
  if (Array.isArray(v)) return `[${v.map((x, i) => canonical(x, `${path}[${i}]`)).join(",")}]`;
  if (typeof v === "object" && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null)) {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => {
        if (o[k] === undefined) throw new Error(`canonical: ${path}.${k} is undefined`);
        return `${JSON.stringify(k)}:${canonical(o[k], `${path}.${k}`)}`;
      })
      .join(",")}}`;
  }
  throw new Error(`canonical: ${path} has unsupported type ${typeof v}`);
}
const sha = (text: string): string => sha256HexJS(new TextEncoder().encode(text));
export const bodySha256 = (body: ProposalBody): string => sha(canonical(body));
export const proposalId = (body: ProposalBody): string => bodySha256(body).slice(0, 16);
/** The SHA-256 of a run spec's canonical JSON: two rings that propose the same run are one proposal (the note, "Which rings"). */
export const specHash = (spec: RunSpec): string => sha(canonical(spec));

// ---------------------------------------------------------------------------------------------
// The notes file (tools/notebook.ts's .notes.json): only the fields the proposer uses, each checked.

export interface Receipt {
  signal: string;
  side: Side;
  Z: number;
  W: number;
  startStep: number;
  endStep: number;
  minAbsZ: number;
  value: number;
  median: number;
}
export interface StretchRef {
  side: Side;
  startStep: number;
  endStep: number;
  censuses: number;
  minAbsZ: number;
  maxAbsZ: number;
  ongoing: boolean;
}
export interface NoteRing {
  signal: string;
  label: string;
  side: Side;
  D: number;
  spread: number;
  receipt: Receipt;
  stretch: StretchRef;
}
export interface NotesFile {
  notebookVersion: number;
  bellVersion: number;
  recordSha256: string;
  sources: { path: string; bytes: number }[];
  run: { id: string; experiment: string; preset: string; condition: string; seed: number; steps: number; censusEvery: number; presetIdentity: string; falseAlarm: "held-out" | "neutral" | null; zStar: number; W: number; burnInStep: number };
  /** Every ring, in the notebook's filing order (entries, then the notes of each). */
  rings: NoteRing[];
}

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isInt = (v: unknown): v is number => Number.isSafeInteger(v);
const isSide = (v: unknown): v is Side => v === "high" || v === "low";
function need(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`notes: ${msg}`);
}

/** Parses a .notes.json and checks every field the proposer reads (the note, "What a proposal is"). Throws naming the field. */
export function parseNotes(text: string, k: ProposerConstants = RULES_V0): NotesFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new Error(`notes: not JSON (${(e as Error).message})`);
  }
  need(isObj(raw), "not a JSON object");
  need(raw.notebookVersion === NOTEBOOK_VERSION, `notebookVersion is ${JSON.stringify(raw.notebookVersion)}, this proposer reads ${NOTEBOOK_VERSION}`);
  need(raw.bellVersion === BELL_VERSION, `bellVersion is ${JSON.stringify(raw.bellVersion)}, this proposer reads ${BELL_VERSION}`);
  const meta = raw.meta;
  need(isObj(meta), "meta is missing");
  need(typeof meta.recordSha256 === "string" && /^[0-9a-f]{64}$/.test(meta.recordSha256), "meta.recordSha256 is not a SHA-256");
  need(Array.isArray(meta.sources) && meta.sources.every((s) => isObj(s) && typeof s.path === "string" && isInt(s.bytes) && s.bytes >= 0), "meta.sources is not a list of {path, bytes}");
  const sources = (meta.sources as { path: string; bytes: number }[]).map((s) => ({ path: s.path, bytes: s.bytes }));
  for (const f of BUNDLE_FILES) need(sources.filter((s) => basename(s.path) === f).length === 1, `meta.sources does not list ${f} exactly once`);
  const r = raw.run;
  need(isObj(r), "run is missing");
  for (const key of ["id", "experiment", "preset", "condition", "presetIdentity"] as const) need(typeof r[key] === "string" && r[key] !== "", `run.${key} is not a string`);
  for (const key of ["seed", "steps", "censusEvery"] as const) need(isInt(r[key]) && (r[key] as number) >= 0, `run.${key} is not a non-negative integer`);
  need((r.censusEvery as number) > 0 && (r.steps as number) > 0, "run.steps and run.censusEvery must be positive");
  need(r.falseAlarm === null || r.falseAlarm === "held-out" || r.falseAlarm === "neutral", "run.falseAlarm is not null, held-out or neutral");
  need(isNum(r.zStar) && r.zStar > 0, "run.zStar is not a positive number");
  need(r.W === k.W, `run.W is ${JSON.stringify(r.W)}, the proposer's W is ${k.W}`);
  need(r.burnInStep === k.burnInStep, `run.burnInStep is ${JSON.stringify(r.burnInStep)}, the proposer's burn-in is ${k.burnInStep}`);
  const cadence = r.censusEvery as number, zStar = r.zStar as number;
  need(Array.isArray(raw.entries), "entries is not a list");
  const rings: NoteRing[] = [];
  (raw.entries as unknown[]).forEach((e, i) => {
    need(isObj(e) && Array.isArray(e.notes), `entries[${i}] has no notes list`);
    (e.notes as unknown[]).forEach((n, j) => {
      const at = `entries[${i}].notes[${j}]`;
      need(isObj(n), `${at} is not an object`);
      need(typeof n.signal === "string" && SIGNALS.some((s) => s.name === n.signal), `${at}.signal ${JSON.stringify(n.signal)} is not one of the bell's signals`);
      need(typeof n.label === "string" && n.label !== "", `${at}.label is not a string`);
      need(isSide(n.side), `${at}.side is not high or low`);
      need(isNum(n.D), `${at}.D is not a number`);
      need(isNum(n.spread) && n.spread > 0, `${at}.spread is not a positive number`);
      const rc = n.receipt;
      need(isObj(rc), `${at}.receipt is missing`);
      need(rc.signal === n.signal, `${at}.receipt.signal ${JSON.stringify(rc.signal)} is not the note's ${JSON.stringify(n.signal)}`);
      need(rc.side === n.side, `${at}.receipt.side ${JSON.stringify(rc.side)} is not the note's ${JSON.stringify(n.side)}`);
      need(rc.W === k.W, `${at}.receipt.W is ${JSON.stringify(rc.W)}, not ${k.W}`);
      for (const key of ["Z", "minAbsZ", "value", "median"] as const) need(isNum(rc[key]), `${at}.receipt.${key} is not a number`);
      for (const key of ["startStep", "endStep"] as const) need(isInt(rc[key]) && (rc[key] as number) > 0 && (rc[key] as number) % cadence === 0, `${at}.receipt.${key} is not a census step (a positive multiple of ${cadence})`);
      need((rc.endStep as number) - (rc.startStep as number) === (k.W - 1) * cadence, `${at}.receipt window runs from step ${rc.startStep} to ${rc.endStep}, not ${k.W} censuses ((W - 1) · ${cadence} = ${(k.W - 1) * cadence} steps)`);
      need((rc.startStep as number) >= k.burnInStep, `${at}.receipt.startStep ${rc.startStep} is before the burn-in step ${k.burnInStep}`);
      need((rc.endStep as number) <= (r.steps as number), `${at}.receipt.endStep ${rc.endStep} is past the run's last step ${r.steps}`);
      need((rc.minAbsZ as number) > zStar, `${at}.receipt.minAbsZ ${rc.minAbsZ} is not beyond Z* ${zStar}`);
      need(Array.isArray(n.stretches) && n.stretches.length > 0, `${at}.stretches is empty`);
      const st = (n.stretches as unknown[])[0];
      need(isObj(st) && isSide(st.side) && isInt(st.startStep) && isInt(st.endStep) && isInt(st.censuses) && isNum(st.minAbsZ) && isNum(st.maxAbsZ) && typeof st.ongoing === "boolean", `${at}.stretches[0] is malformed`);
      need(st.side === n.side && st.startStep === rc.startStep, `${at}.stretches[0] does not start at the receipt's window`);
      rings.push({
        signal: n.signal as string,
        label: n.label as string,
        side: n.side as Side,
        D: n.D as number,
        spread: n.spread as number,
        receipt: { signal: rc.signal as string, side: rc.side as Side, Z: rc.Z as number, W: rc.W as number, startStep: rc.startStep as number, endStep: rc.endStep as number, minAbsZ: rc.minAbsZ as number, value: rc.value as number, median: rc.median as number },
        stretch: { side: st.side as Side, startStep: st.startStep as number, endStep: st.endStep as number, censuses: st.censuses as number, minAbsZ: st.minAbsZ as number, maxAbsZ: st.maxAbsZ as number, ongoing: st.ongoing as boolean },
      });
    });
  });
  need(raw.rings === rings.length, `rings says ${JSON.stringify(raw.rings)} but the entries hold ${rings.length} notes`);
  return {
    notebookVersion: raw.notebookVersion as number,
    bellVersion: raw.bellVersion as number,
    recordSha256: meta.recordSha256 as string,
    sources,
    run: {
      id: r.id as string,
      experiment: r.experiment as string,
      preset: r.preset as string,
      condition: r.condition as string,
      seed: r.seed as number,
      steps: r.steps as number,
      censusEvery: cadence,
      presetIdentity: r.presetIdentity as string,
      falseAlarm: r.falseAlarm as NotesFile["run"]["falseAlarm"],
      zStar,
      W: r.W as number,
      burnInStep: r.burnInStep as number,
    },
    rings,
  };
}

export const BUNDLE_FILES = ["manifest.json", "series.jsonl", "lineages.tsv"] as const;
const basename = (p: string) => p.replace(/[/\\]+$/, "").split(/[/\\]/).pop() ?? p;

// ---------------------------------------------------------------------------------------------
// The source bundle.

/** The parts of a run bundle's manifest.json the proposer reads. */
export interface SourceManifest {
  runId?: unknown;
  spec: RunSpec & Record<string, unknown>;
  cfg: WorldConfig;
  presetIdentity: string;
  initHash?: string;
  startStep?: unknown;
  ruleVersion?: unknown;
  schemaVersion?: unknown;
  metricsVersion?: unknown;
  checkpoints?: { step: number; file: string; hash: string }[];
  summary?: unknown;
  branch?: unknown;
  picks?: unknown;
  interventions?: unknown;
  preCycleCheckpoints?: unknown;
  [k: string]: unknown;
}

/** The manifest, shape-checked, or a thrown message. */
export function parseSourceManifest(text: string): SourceManifest {
  let m: unknown;
  try {
    m = JSON.parse(text);
  } catch (e) {
    throw new Error(`manifest.json is not JSON (${(e as Error).message})`);
  }
  if (!isObj(m) || !isObj(m.spec) || !isObj(m.cfg)) throw new Error("manifest.json has no spec or cfg");
  const s = m.spec;
  if (typeof s.experiment !== "string" || typeof s.presetId !== "string" || typeof s.condition !== "string" || !isInt(s.seed) || !isInt(s.steps) || !isInt(s.censusEvery) || !isInt(s.deepEvery))
    throw new Error("manifest.json spec lacks experiment, presetId, condition, seed, steps, censusEvery or deepEvery");
  if (typeof m.presetIdentity !== "string") throw new Error("manifest.json has no presetIdentity");
  if (m.checkpoints !== undefined && !(Array.isArray(m.checkpoints) && m.checkpoints.every((c) => isObj(c) && isInt(c.step) && typeof c.file === "string" && typeof c.hash === "string")))
    throw new Error("manifest.json checkpoints is not a list of {step, file, hash}");
  return m as SourceManifest;
}

/** The source's run id as tools/notebook.ts names it. */
export const sourceRunId = (m: SourceManifest) => `${m.spec.experiment}/${m.spec.presetId}/${m.spec.condition}/seed-${m.spec.seed}`;

/** The spec keys a fork copies or derives; any other key in the source's spec is refused (the argv could not carry it). */
const COPYABLE = new Set(["experiment", "presetId", "condition", "seed", "steps", "censusEvery", "deepEvery", "checkpointEvery", "activityThreshold", "lineageObs", "overrides"]);

/**
 * Why v0 cannot fork this source, or null (the note, "The vocabulary, in v0"): a pond world, a branch, a picked or pressured run,
 * a metapopulation member, founder options, a run that already carries interventions, any other spec key tools/run.ts cannot
 * pass, an override other than mutRate, an unfinished run, a continuation segment, and a rule, schema or metrics version other
 * than this checkout's (the replay would not be the source's history).
 */
export function sourceRefusal(m: SourceManifest): string | null {
  const s = m.spec as Record<string, unknown>;
  if (m.cfg.pondPeriod !== undefined) return "the source is a pond world (v0 does not fork pond worlds: no feed, and picks are not in its vocabulary)";
  if (s.branch !== undefined || m.branch !== undefined) return "the source is a branch run";
  if (s.picked !== undefined || m.picks !== undefined) return "the source is a picked run";
  if (s.pressures !== undefined) return "the source is a pressured run";
  if (s.metapopulation !== undefined) return "the source belongs to a metapopulation";
  if (s.soloFounder !== undefined || s.soloGenome !== undefined || s.founderSet !== undefined) return "the source was founded with founder options (soloFounder, soloGenome or founderSet)";
  if (s.interventions !== undefined || m.interventions !== undefined) return "the source already carries interventions";
  const extra = Object.keys(s).find((k) => !COPYABLE.has(k));
  if (extra !== undefined) return `the source's spec has ${JSON.stringify(extra)}, which a v0 fork cannot carry`;
  if (s.overrides !== undefined) {
    const o = s.overrides as Record<string, unknown>;
    if (!isObj(o) || Object.keys(o).length === 0 || Object.keys(o).some((k) => k !== "mutRate") || !isInt(o.mutRate)) return "the source's overrides are not a mutRate override alone";
  }
  if (s.activityThreshold !== undefined && !(isNum(s.activityThreshold) && (s.activityThreshold as number) > 0)) return "the source's activityThreshold is not a positive number";
  if (m.summary === null || m.summary === undefined) return "the source run is not finished (its manifest has no summary)";
  if (m.startStep !== undefined && m.startStep !== 0) return `the source starts at step ${JSON.stringify(m.startStep)}, not 0 (a continuation segment, not a whole history)`;
  if (typeof m.initHash !== "string") return "the source's manifest has no initHash, so step 0 cannot be checked";
  if (m.ruleVersion !== RULE_VERSION) return `the source ran under rule version ${JSON.stringify(m.ruleVersion)}, this checkout's is ${RULE_VERSION}`;
  if (m.schemaVersion !== SCHEMA_VERSION) return `the source's schema version is ${JSON.stringify(m.schemaVersion)}, this checkout's is ${SCHEMA_VERSION}`;
  if (((m.metricsVersion as number | undefined) ?? 1) !== METRICS_VERSION) return `the source's metrics version is ${JSON.stringify(m.metricsVersion ?? 1)}, this checkout's is ${METRICS_VERSION} (its series would not replay byte for byte)`;
  return null;
}

/** The notes file describes this bundle (the note, "The prediction": run id, presetIdentity, steps, cadence, and the three files' byte sizes). Throws naming what differs. */
export function bindNotesToManifest(notes: NotesFile, m: SourceManifest, sizes: Readonly<Record<(typeof BUNDLE_FILES)[number], number>>): void {
  const diffs: string[] = [];
  if (notes.run.id !== sourceRunId(m)) diffs.push(`run id (notes ${notes.run.id}, bundle ${sourceRunId(m)})`);
  if (notes.run.presetIdentity !== m.presetIdentity) diffs.push(`presetIdentity (notes ${notes.run.presetIdentity}, bundle ${m.presetIdentity})`);
  if (notes.run.steps !== m.spec.steps) diffs.push(`steps (notes ${notes.run.steps}, bundle ${m.spec.steps})`);
  if (notes.run.censusEvery !== m.spec.censusEvery) diffs.push(`censusEvery (notes ${notes.run.censusEvery}, bundle ${m.spec.censusEvery})`);
  for (const f of BUNDLE_FILES) {
    const listed = notes.sources.find((s) => basename(s.path) === f)!.bytes;
    if (listed !== sizes[f]) diffs.push(`${f} size (notes ${listed}, bundle ${sizes[f]})`);
  }
  if (diffs.length) throw new Error(`the notes file does not describe this bundle: ${diffs.join("; ")}`);
}

// ---------------------------------------------------------------------------------------------
// Fork point, jar disc, rules.

/**
 * The fork step C for intervention step S: the largest verified checkpoint step strictly before S, else 0 (the note, "Where a fork
 * starts"). `verified` is called on candidates from the largest down and says whether that checkpoint's file exists, decodes and
 * hashes to its manifest entry; step 0 is checked separately (initHash).
 */
export function forkPoint(S: number, checkpoints: readonly { step: number }[], verified: (step: number) => boolean = () => true): number {
  const steps = [...new Set(checkpoints.map((c) => c.step))].filter((t) => t > 0 && t < S).sort((x, y) => y - x);
  for (const t of steps) if (verified(t)) return t;
  return 0;
}

/** The jar disc (the note, "Where an intervention lands"): one centre per tile, row-major, radius maxLesionRadius. */
export function jarDisc(cfg: WorldConfig): { x: number; y: number; r: number }[] {
  const out: { x: number; y: number; r: number }[] = [];
  const r = maxLesionRadius(cfg);
  for (let ty = 0; ty < cfg.tilesY; ty++) for (let tx = 0; tx < cfg.tilesX; tx++) out.push({ x: tx * cfg.tileW + Math.floor(cfg.tileW / 2), y: ty * cfg.tileH + Math.floor(cfg.tileH / 2), r });
  return out;
}

/** Cells in a disc of radius r (dx² + dy² ≤ r², as packages/schema/src/feed.ts and a lesion count them; r ≤ maxLesionRadius, so no cell twice). */
export function discCells(r: number): number {
  let n = 0;
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r) n++;
  return n;
}

/** The jar disc's share of the world's cells, in whole percent (77 on a 256 × 256 tile). */
export function jarShare(cfg: WorldConfig): number {
  return Math.round((100 * cfg.tilesX * cfg.tilesY * discCells(maxLesionRadius(cfg))) / cellCount(cfg));
}

/** A, the feed and drain amount: the preset's init.nutrient, or null when it is not in 1..FEED_MAX (no feed or drain then). */
export function feedAmount(presetId: string): number | null {
  const a = PRESETS.find((p) => p.id === presetId)?.init.nutrient;
  return isInt(a) && a >= 1 && a <= FEED_MAX ? a : null;
}

/**
 * Why v0 cannot make a proposal at this census cadence, or null (amendment 2026-10-18, "Cadence"): the horizon must be a whole
 * number of censuses, so the fork ends on a census and the prediction's window is on the source's grid, and the prediction's W
 * censuses must all lie after S.
 */
export function cadenceError(cadence: number, k: ProposerConstants): string | null {
  if (k.horizon % cadence !== 0) return `the horizon ${k.horizon} is not a whole number of censuses at cadence ${cadence}, so the fork would not end on a census`;
  if ((k.W - 1) * cadence >= k.horizon) return `${k.W} censuses at cadence ${cadence} do not fit in the horizon ${k.horizon} after the intervention`;
  return null;
}

/** The rules' interventions for a row: none for a control, else the jar disc at S (a lesion, or a feed of +A or -A). */
export function rulesInterventions(row: RuleRow, cfg: WorldConfig, S: number, A: number | null): ScheduledIntervention[] {
  if (row.action === "control") return [];
  if (row.action !== "lesion" && A === null) throw new Error(`a ${row.action} needs a feed amount, and the preset has none`);
  return jarDisc(cfg).map((d) => (row.action === "lesion" ? { step: S, kind: "lesion" as const, ...d } : { step: S, kind: "feed" as const, ...d, amount: row.action === "feed" ? A! : -A! }));
}

const matterCache = new Map<string, bigint>();
/** The source's total matter: closed in matter and without interventions (sourceRefusal), so its start world's total at every step. */
function sourceMatter(spec: RunSpec, cfg: WorldConfig): bigint {
  const key = canonical({ presetId: spec.presetId, condition: spec.condition, seed: spec.seed, overrides: spec.overrides ?? null });
  let m = matterCache.get(key);
  if (m === undefined) {
    const preset = PRESETS.find((p) => p.id === spec.presetId);
    if (!preset) throw new Error(`unknown preset ${spec.presetId}`);
    m = totalsOf(cfg, initWorld(cfg, preset.init).cells).matter;
    matterCache.set(key, m);
  }
  return m;
}

export interface RuleRow {
  action: Action;
  /** Absent for a control. */
  direction?: Direction;
}
const drain = { action: "drain", direction: "down" } as const;
const feed = { action: "feed", direction: "up" } as const;
const lesion = { action: "lesion", direction: "down" } as const;
const control = { action: "control" } as const;
/** The note's table, one row per (signal, side), in SIGNALS order. */
export const RULES: Readonly<Record<string, Readonly<Record<Side, RuleRow>>>> = Object.freeze({
  livingCells: { high: drain, low: feed },
  individuals: { high: drain, low: feed },
  meanMass: { high: drain, low: feed },
  lineages: { high: lesion, low: control },
  lineageShannon: { high: lesion, low: control },
  patternEntropy: { high: control, low: control },
  bioticRecycling: { high: control, low: control },
  maxGeneration: { high: lesion, low: control },
  dominantShare: { high: lesion, low: control },
  fissions: { high: drain, low: feed },
  fusions: { high: drain, low: feed },
  buddings: { high: drain, low: feed },
  mutations: { high: drain, low: feed },
});
export function ruleFor(signal: string, side: Side): RuleRow {
  const row = RULES[signal]?.[side];
  if (!row) throw new Error(`no rule for ${signal} ${side}`);
  return row;
}

export const HYPOTHESIS: Record<Action, string> = {
  feed: "the departure is held by the nutrient supply",
  drain: "the departure is held by the nutrient supply",
  lesion: "the departure is held by the standing bodies and does not re-form from the survivors and the dissolved pool",
  control: "the receipt replays from the fork",
};

// ---------------------------------------------------------------------------------------------
// The proposal.

export interface Prediction {
  kind: "directional" | "replay" | "none";
  statement: string;
  signal?: string;
  direction?: Direction;
  /** Directional: the last W censuses of the horizon, inclusive. Replay: every census of the fork. */
  fromStep?: number;
  toStep?: number;
  censuses?: number;
  spread?: number;
  threshold?: number;
}

export interface ProposalBody {
  proposalVersion: number;
  generator: "rules-v0" | "random-v0";
  constants: ProposerConstants & { feedAmount: number | null };
  source: { dir: string; runId: string; presetIdentity: string; steps: number; censusEvery: number; manifestSha256: string; initHash: string };
  notes: { path: string; sha256: string; notebookVersion: number; bellVersion: number; recordSha256: string; falseAlarm: NotesFile["run"]["falseAlarm"]; zStar: number };
  ring: { index: number; signal: string; label: string; side: Side; D: number; spread: number; receipt: Receipt; stretch: StretchRef };
  rule: { action: Action | "random"; hypothesis: string };
  /** C, how it is checked, and against what. */
  fork: { step: number; check: "initHash" | "checkpoint"; hash: string; file?: string };
  /** S: the ring's receipt's last census (a random fork keeps its matched proposal's). */
  interventionStep: number;
  /** The last step up to which the fork must replay the source (`run`'s check over (C, replayThrough]): S for a rules proposal, a random fork's first entry. */
  replayThrough: number;
  spec: RunSpec;
  /** The tools/run.ts command, from the repository root, without --out (`run` appends --out <dir>/<id>). */
  argv: string[];
  reason: string;
  prediction: Prediction;
  /** rules-v0 only, present when not empty: later rings whose run spec is this one's, each with its own prediction (amendment 2026-10-18, "Duplicate rings"). */
  alsoAnswers?: AlsoAnswers[];
  /** random-v0 only: the proposal it is matched to, the seed, and the matched run spec's SHA-256 (the draw's seed is taken from it). */
  baseline?: { matches: string; seed: number; specSha256: string };
}

export interface AlsoAnswers {
  index: number;
  signal: string;
  label: string;
  side: Side;
  spread: number;
  prediction: Prediction;
}

export interface Approval {
  by: string;
  at: string;
  bodySha256: string;
}
export interface Proposal {
  id: string;
  status: "proposed" | "approved";
  approval?: Approval;
  body: ProposalBody;
}

/** The file's bytes: id, status, approval (when present) and body, in that order, two-space JSON, a final newline. */
export function serializeProposal(p: Proposal): string {
  return JSON.stringify({ id: p.id, status: p.status, ...(p.approval ? { approval: { by: p.approval.by, at: p.approval.at, bodySha256: p.approval.bodySha256 } } : {}), body: p.body }, null, 2) + "\n";
}

/** Parses a proposal file: its shape, and that its id is its body's. The body's content is `validateProposal`'s. */
export function parseProposal(text: string): Proposal {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new Error(`proposal: not JSON (${(e as Error).message})`);
  }
  if (!isObj(raw)) throw new Error("proposal: not a JSON object");
  const extra = Object.keys(raw).find((k) => !["id", "status", "approval", "body"].includes(k));
  if (extra !== undefined) throw new Error(`proposal: unknown key ${JSON.stringify(extra)}`);
  if (raw.status !== "proposed" && raw.status !== "approved") throw new Error(`proposal: status ${JSON.stringify(raw.status)} is not proposed or approved`);
  if (!isObj(raw.body)) throw new Error("proposal: no body");
  const body = raw.body as unknown as ProposalBody;
  if (body.proposalVersion !== PROPOSAL_VERSION) throw new Error(`proposal: proposalVersion ${JSON.stringify(body.proposalVersion)}, this tool reads ${PROPOSAL_VERSION}`);
  let id: string;
  try {
    id = proposalId(body);
  } catch (e) {
    throw new Error(`proposal: body is not canonical JSON (${(e as Error).message})`);
  }
  if (raw.id !== id) throw new Error(`proposal: id ${JSON.stringify(raw.id)} is not its body's (${id}); the body was edited`);
  let approval: Approval | undefined;
  if (raw.approval !== undefined) {
    const a = raw.approval;
    if (!isObj(a) || typeof a.by !== "string" || typeof a.at !== "string" || typeof a.bodySha256 !== "string" || Object.keys(a).length !== 3) throw new Error("proposal: approval is not {by, at, bodySha256}");
    approval = { by: a.by, at: a.at, bodySha256: a.bodySha256 };
  }
  if (raw.status === "proposed" && approval) throw new Error("proposal: a proposed file carries an approval");
  return { id, status: raw.status, ...(approval ? { approval } : {}), body };
}

/**
 * The fork's run spec (the note, "Where a fork starts"): the source's preset, condition, seed, cadence, deep cadence, activity
 * threshold and mutRate override; experiment naturalist-fork; checkpointEvery 0; no lineageObs; S - C + H steps; the
 * interventions, or no interventions key at all (the runner refuses an empty list). Key order is tools/run.ts's.
 */
export function buildForkSpec(m: SourceManifest, C: number, S: number, horizon: number, interventions: readonly ScheduledIntervention[]): RunSpec {
  const s = m.spec;
  return {
    experiment: FORK_EXPERIMENT,
    presetId: s.presetId,
    condition: s.condition,
    seed: s.seed,
    steps: S - C + horizon,
    censusEvery: s.censusEvery,
    deepEvery: s.deepEvery,
    checkpointEvery: 0,
    ...(s.activityThreshold !== undefined ? { activityThreshold: s.activityThreshold } : {}),
    ...(s.overrides !== undefined ? { overrides: { mutRate: (s.overrides as { mutRate: number }).mutRate } } : {}),
    ...(interventions.length ? { interventions: interventions.map((e) => ({ ...e })) } : {}),
  };
}

/**
 * Every check a proposal's spec passes before it is written (the note, "Validation before any file is written"), in order:
 * validateInterventions, specConfig, interventionsError, validateSpec, every intervention step in (C, C + steps], and the fork
 * spec's own invariants (experiment, no checkpoints, no lineageObs, the source's settings). Returns the first failure, or null.
 */
export function validateProposalSpec(spec: RunSpec, C: number, m?: SourceManifest): string | null {
  if (spec.interventions !== undefined) {
    const errs = validateInterventions(spec.interventions);
    if (errs.length) return `validateInterventions: ${errs[0]}`;
  }
  let cfg: WorldConfig;
  try {
    cfg = specConfig(spec);
  } catch (e) {
    return `specConfig: ${(e as Error).message}`;
  }
  const bad = interventionsError(spec, cfg, C);
  if (bad) return `interventionsError: ${bad}`;
  const errs = validateSpec(spec);
  if (errs.length) return `validateSpec: ${errs[0]}`;
  const out = (spec.interventions ?? []).findIndex((e) => !(e.step > C && e.step <= C + spec.steps));
  if (out >= 0) return `interventions[${out}] at step ${spec.interventions![out].step} is not in the fork's window (${C}, ${C + spec.steps}]`;
  if (!Number.isSafeInteger(C) || C < 0 || C % spec.censusEvery !== 0) return `the fork step ${C} is not a census step`;
  if (spec.steps % spec.censusEvery !== 0) return `the fork's ${spec.steps} steps are not a whole number of censuses at cadence ${spec.censusEvery}`;
  const R = maxLesionRadius(cfg);
  const wide = (spec.interventions ?? []).findIndex((e) => e.kind === "sun" || !(Number.isSafeInteger(e.r) && e.r >= 1 && e.r <= R));
  if (wide >= 0) {
    const w = spec.interventions![wide];
    if (w.kind === "sun") return `interventions[${wide}] is a sun: a proposal forks with a lesion or a feed`;
    return `interventions[${wide}] has radius ${w.r}, not in 1..${R} (the runner would clamp it, so the run would not be the stated one)`;
  }
  // Drains only lower the total, so the source's matter plus every positive feed bounds the world's matter at every step.
  let added = 0n;
  for (const e of spec.interventions ?? []) if (e.kind === "feed" && e.amount > 0) added += BigInt(e.amount) * BigInt(discCells(e.r));
  if (added > 0n) {
    const held = sourceMatter(spec, cfg);
    if (held + added > BigInt(MATTER_MAX)) return `the feeds add up to ${added} quanta to a world holding ${held}, past MATTER_MAX (${MATTER_MAX}); the runner would refuse them`;
  }
  if (spec.experiment !== FORK_EXPERIMENT) return `experiment is ${spec.experiment}, not ${FORK_EXPERIMENT}`;
  if (spec.checkpointEvery !== 0) return "a fork writes no checkpoints (checkpointEvery 0)";
  if (spec.lineageObs !== undefined) return "a fork carries no lineageObs (the runner refuses it on a continuation)";
  const extra = Object.keys(spec).find((k) => !["experiment", "presetId", "condition", "seed", "steps", "censusEvery", "deepEvery", "checkpointEvery", "activityThreshold", "overrides", "interventions"].includes(k));
  if (extra !== undefined) return `a fork spec has no key ${JSON.stringify(extra)}`;
  if (m) {
    const s = m.spec;
    const same = s.presetId === spec.presetId && s.condition === spec.condition && s.seed === spec.seed && s.censusEvery === spec.censusEvery && s.deepEvery === spec.deepEvery && s.activityThreshold === spec.activityThreshold && canonical(s.overrides ?? null) === canonical(spec.overrides ?? null);
    if (!same) return "the fork's preset, condition, seed, cadences, threshold or overrides differ from the source's";
    if (C + spec.steps > s.steps) return `the fork ends at step ${C + spec.steps}, past the source's last step ${s.steps}`;
  }
  return null;
}

/**
 * The tools/run.ts argv that builds `spec` (from the repository root, without --out): one function, so the stored command and the
 * spec cannot drift. Interventions go as --lesion and --feed flags; tools/run.ts merges lesions then feeds and stable-sorts by
 * step, so the spec must list, within a step, its lesions before its feeds (`canonicalOrder`), or this throws.
 */
export function runArgv(spec: RunSpec, fork: { step: number; dir: string }): string[] {
  const list = spec.interventions ?? [];
  if (canonical(canonicalOrder(list)) !== canonical(list)) throw new Error("runArgv: the interventions are not in tools/run.ts's order (by step; lesions before feeds within a step)");
  const argv = ["deno", "run", "-A", "tools/run.ts", "--experiment", spec.experiment, "--preset", spec.presetId, "--conditions", spec.condition, "--seeds", String(spec.seed), "--steps", String(spec.steps), "--census", String(spec.censusEvery), "--deep", String(spec.deepEvery), "--checkpoint", String(spec.checkpointEvery)];
  if (spec.activityThreshold !== undefined) argv.push("--threshold", String(spec.activityThreshold));
  if (spec.overrides !== undefined) argv.push("--override", Object.entries(spec.overrides).map(([k, v]) => `${k}=${v}`).join(","));
  if (fork.step > 0) argv.push("--start-from", fork.dir, "--start-step", String(fork.step));
  for (const e of list) if (e.kind === "lesion") argv.push("--lesion", `${e.step}:${e.x},${e.y},${e.r}`);
  for (const e of list) if (e.kind === "feed") argv.push("--feed", `${e.step}:${e.x},${e.y},${e.r},${e.amount}`);
  return argv;
}

/** Entries sorted by step, lesions before feeds within a step, otherwise in the given order (tools/run.ts's merge order). */
export function canonicalOrder(list: readonly ScheduledIntervention[]): ScheduledIntervention[] {
  const lesions = list.filter((e) => e.kind === "lesion"), feeds = list.filter((e) => e.kind === "feed");
  return [...lesions, ...feeds].map((e, i) => ({ e, i })).sort((p, q) => p.e.step - q.e.step || p.i - q.i).map(({ e }) => e);
}

/**
 * What the intervention does, with its size (amendment 2026-10-18, "The reason gives the dose"): the disc's radius, the tile count,
 * the share of the world's cells it covers, and for a feed or drain the quanta per cell. These numbers are spec fields (or the share
 * they give), the only numbers in the reason besides the receipt's, the stretch's and the fork's.
 */
export function interventionWords(action: Exclude<Action, "control">, cfg: WorldConfig, A: number | null): string {
  const tiles = cfg.tilesX * cfg.tilesY;
  const disc = `a disc of radius ${maxLesionRadius(cfg)} cells centred on ${tiles === 1 ? "the world's one tile" : `each of its ${tiles} tiles`} (together about ${jarShare(cfg)}% of the world's cells)`;
  if (action === "lesion") return `lesions ${disc}, close to a wipe of the whole jar`;
  return action === "feed" ? `adds ${A} quanta of nutrient to every cell of ${disc}` : `removes up to ${A} quanta of nutrient from every cell of ${disc}`;
}

/** The reason in plain words: every number in it is a receipt, stretch or fork field, or the intervention's size (`interventionWords`). */
export function reasonText(ring: NoteRing, falseAlarm: NotesFile["run"]["falseAlarm"], action: Action, C: number, S: number, cfg: WorldConfig, A: number | null): string {
  const rc = ring.receipt, st = ring.stretch;
  const opener =
    falseAlarm === "held-out"
      ? "This ring is one of the bell's false alarms by definition: the run is a held-out neutral run. "
      : falseAlarm === "neutral"
        ? "This ring is the bell ringing on neutral dynamics alone: the run is neutral and outside the corpus. "
        : "";
  const where = ring.side === "high" ? "above" : "below";
  const rang = `The bell rang on ${ring.label} (${ring.side}): ${fmtValue(ring.signal, rc.value)} at step ${group(rc.startStep)}, against a neutral median there of ${fmtValue(ring.signal, rc.median)}; every census from step ${group(rc.startStep)} to step ${group(rc.endStep)} lay beyond Z* ${fmtZ(rc.Z)}, the weakest ${fmtZ(rc.minAbsZ)} spreads ${where} the median. The first stretch ran from step ${group(st.startStep)} to step ${group(st.endStep)} (${group(st.censuses)} censuses${st.ongoing ? ", still going at the run's end" : ""}).`;
  const why =
    action === "control"
      ? ` No intervention in the vocabulary probes this departure without a place to aim at, and no bundle records where it is concentrated, so this proposal is the fork alone: it replays the source from step ${group(C)} and tests only that the receipt replays.`
      : ` The hypothesis is that ${HYPOTHESIS[action]}. So the fork replays the source from step ${group(C)} to step ${group(S)}, the receipt's last census, and then ${interventionWords(action, cfg, A)}.`;
  return opener + rang + why;
}

const fmtSpread = (x: number) => Number(x.toPrecision(3)).toString();

/** The prediction for a rule row (the note, "The prediction, and how it is decided"). */
export function predictionFor(ring: Pick<NoteRing, "signal" | "label" | "spread">, row: RuleRow, spec: RunSpec, C: number, k: ProposerConstants): Prediction {
  const end = C + spec.steps;
  if (row.action === "control") {
    return {
      kind: "replay",
      statement: `If the source's history replays from step ${group(C)}, the fork's 13 signals equal the source's at every census from step ${group(C + spec.censusEvery)} to step ${group(end)}.`,
      fromStep: C + spec.censusEvery,
      toStep: end,
      censuses: spec.steps / spec.censusEvery,
    };
  }
  const from = end - (k.W - 1) * spec.censusEvery;
  const dir = row.direction!;
  return {
    kind: "directional",
    statement: `If ${HYPOTHESIS[row.action]}, then over steps ${group(from)} to ${group(end)} the fork's ${ring.label} stays at least ${k.threshold === 1 ? "one spread" : `${k.threshold} spreads`} (${fmtSpread(ring.spread)}) ${dir === "up" ? "above" : "below"} the source's, at the median.`,
    signal: ring.signal,
    direction: dir,
    fromStep: from,
    toStep: end,
    censuses: k.W,
    spread: ring.spread,
    threshold: k.threshold,
  };
}

export interface ForkCheck {
  step: number;
  check: "initHash" | "checkpoint";
  hash: string;
  file?: string;
}
export interface ProposeInput {
  notes: NotesFile;
  notesRef: { path: string; sha256: string };
  manifest: SourceManifest;
  source: { dir: string; manifestSha256: string };
  /** Verified fork points: called with S, returns the fork (C, and how it was checked). */
  forkFor: (S: number) => ForkCheck;
  constants?: ProposerConstants;
}
export interface ProposeResult {
  proposals: Proposal[];
  skipped: { ring: number; signal: string; side: Side; reason: string }[];
  duplicates: { ring: number; signal: string; side: Side; of: string }[];
}

/**
 * One proposal per ring, in filing order; skipped rings listed with their reasons, and a ring whose run spec an earlier ring's
 * proposal already has listed as a duplicate and recorded on that proposal (`alsoAnswers`, with its own prediction). Every body
 * re-validates as `approve` and `run` will check it. Throws on a ring whose proposal fails validation (nothing is written then).
 */
export function proposeFromNotes(input: ProposeInput): ProposeResult {
  const k = input.constants ?? RULES_V0;
  const { notes, manifest: m } = input;
  const refusal = sourceRefusal(m);
  if (refusal) throw new Error(`refused: ${refusal}`);
  const cfg = specConfig(m.spec);
  const A = feedAmount(m.spec.presetId);
  const cadenceBad = cadenceError(m.spec.censusEvery, k);
  const skipped: ProposeResult["skipped"] = [];
  const drafts: { body: ProposalBody; also: AlsoAnswers[] }[] = [];
  const dupes: { tag: { ring: number; signal: string; side: Side }; draft: number }[] = [];
  const seen = new Map<string, number>();
  notes.rings.forEach((ring, index) => {
    const row = ruleFor(ring.signal, ring.side);
    const S = ring.receipt.endStep;
    const tag = { ring: index, signal: ring.signal, side: ring.side };
    if (cadenceBad) {
      skipped.push({ ...tag, reason: cadenceBad });
      return;
    }
    if (S + k.horizon > m.spec.steps) {
      skipped.push({ ...tag, reason: `S + H = ${S + k.horizon} is past the source's last step ${m.spec.steps}, so the source would not cover the comparison` });
      return;
    }
    if ((row.action === "feed" || row.action === "drain") && A === null) {
      skipped.push({ ...tag, reason: `the preset's init.nutrient is not a feed amount in 1..${FEED_MAX}, so it gets no ${row.action}` });
      return;
    }
    const fork = input.forkFor(S);
    const C = fork.step;
    const spec = buildForkSpec(m, C, S, k.horizon, rulesInterventions(row, cfg, S, A));
    const bad = validateProposalSpec(spec, C, m);
    if (bad) throw new Error(`ring ${index} (${ring.signal} ${ring.side}): ${bad}`);
    const h = specHash(spec);
    const at = seen.get(h);
    if (at !== undefined) {
      drafts[at].also.push({ index, signal: ring.signal, label: ring.label, side: ring.side, spread: ring.spread, prediction: predictionFor(ring, row, spec, C, k) });
      dupes.push({ tag, draft: at });
      return;
    }
    seen.set(h, drafts.length);
    drafts.push({
      also: [],
      body: {
        proposalVersion: PROPOSAL_VERSION,
        generator: "rules-v0",
        constants: { W: k.W, burnInStep: k.burnInStep, horizon: k.horizon, threshold: k.threshold, feedAmount: A },
        source: { dir: input.source.dir, runId: sourceRunId(m), presetIdentity: m.presetIdentity, steps: m.spec.steps, censusEvery: m.spec.censusEvery, manifestSha256: input.source.manifestSha256, initHash: m.initHash! },
        notes: { path: input.notesRef.path, sha256: input.notesRef.sha256, notebookVersion: notes.notebookVersion, bellVersion: notes.bellVersion, recordSha256: notes.recordSha256, falseAlarm: notes.run.falseAlarm, zStar: notes.run.zStar },
        ring: { index, signal: ring.signal, label: ring.label, side: ring.side, D: ring.D, spread: ring.spread, receipt: { ...ring.receipt }, stretch: { ...ring.stretch } },
        rule: { action: row.action, hypothesis: HYPOTHESIS[row.action] },
        fork: { ...fork },
        interventionStep: S,
        replayThrough: S,
        spec,
        argv: runArgv(spec, { step: C, dir: input.source.dir }),
        reason: reasonText(ring, notes.run.falseAlarm, row.action, C, S, cfg, A),
        prediction: predictionFor(ring, row, spec, C, k),
      },
    });
  });
  const proposals: Proposal[] = drafts.map(({ body, also }) => {
    const full: ProposalBody = also.length ? { ...body, alsoAnswers: also } : body;
    return { id: proposalId(full), status: "proposed", body: full };
  });
  for (const p of proposals) {
    const bad = validateProposal(p.body, k);
    if (bad) throw new Error(`ring ${p.body.ring.index} (${p.body.ring.signal} ${p.body.ring.side}): the proposal does not re-validate: ${bad}`);
  }
  return { proposals, skipped, duplicates: dupes.map((d) => ({ ...d.tag, of: proposals[d.draft].id })) };
}

// ---------------------------------------------------------------------------------------------
// Re-validating a body (the yes gate's "the body re-validates"; amendment 2026-10-18, "A body is re-derived, not trusted").

const HEX64 = /^[0-9a-f]{64}$/;
const BODY_KEYS = ["proposalVersion", "generator", "constants", "source", "notes", "ring", "rule", "fork", "interventionStep", "replayThrough", "spec", "argv", "reason", "prediction", "alsoAnswers", "baseline"];
type Rec = Record<string, unknown>;

/** The ring copied into a body, checked as parseNotes checks a note (against the body's source, constants and Z*). */
function bodyRingError(ring: unknown, src: ProposalBody["source"], k: ProposerConstants, zStar: number): string | null {
  if (!isObj(ring)) return "the body has no ring";
  const r = ring as Rec;
  if (!isInt(r.index) || r.index < 0) return "ring.index is not a non-negative integer";
  if (typeof r.signal !== "string" || !SIGNALS.some((s) => s.name === r.signal)) return `ring.signal ${JSON.stringify(r.signal)} is not one of the bell's signals`;
  if (typeof r.label !== "string" || r.label === "" || !isSide(r.side) || !isNum(r.D) || !isNum(r.spread) || r.spread <= 0) return "ring's label, side, D or spread is malformed";
  if (!isObj(r.receipt) || !isObj(r.stretch)) return "ring has no receipt or stretch";
  const rc = r.receipt as Rec, st = r.stretch as Rec, cadence = src.censusEvery;
  if (rc.signal !== r.signal || rc.side !== r.side || rc.W !== k.W) return "ring.receipt's signal, side or W is not the ring's";
  if (!["Z", "minAbsZ", "value", "median"].every((key) => isNum(rc[key]))) return "ring.receipt's Z, minAbsZ, value or median is not a number";
  if (!["startStep", "endStep"].every((key) => isInt(rc[key]) && (rc[key] as number) > 0 && (rc[key] as number) % cadence === 0)) return `ring.receipt's window is not on the census grid (cadence ${cadence})`;
  const s0 = rc.startStep as number, s1 = rc.endStep as number;
  if (s1 - s0 !== (k.W - 1) * cadence || s0 < k.burnInStep || s1 > src.steps) return `ring.receipt's window ${s0} to ${s1} is not ${k.W} censuses after the burn-in within the source`;
  if (!((rc.minAbsZ as number) > zStar)) return `ring.receipt.minAbsZ is not beyond Z* ${zStar}`;
  if (!(isSide(st.side) && isInt(st.startStep) && isInt(st.endStep) && isInt(st.censuses) && isNum(st.minAbsZ) && isNum(st.maxAbsZ) && typeof st.ongoing === "boolean")) return "ring.stretch is malformed";
  if (st.side !== r.side || st.startStep !== s0) return "ring.stretch does not start at the receipt's window";
  return null;
}

/** The matched rules spec of a random fork: its spec with the rule's interventions in place of the drawn ones. */
function withInterventions(spec: RunSpec, list: ScheduledIntervention[]): RunSpec {
  const out: RunSpec = { ...spec };
  delete out.interventions;
  return list.length ? { ...out, interventions: list } : out;
}

function bodyError(body: ProposalBody, k: ProposerConstants): string | null {
  if (!isObj(body)) return "the body is not an object";
  const b = body as unknown as Rec;
  const extra = Object.keys(b).find((key) => !BODY_KEYS.includes(key));
  if (extra !== undefined) return `the body has an unknown key ${JSON.stringify(extra)}`;
  if (body.proposalVersion !== PROPOSAL_VERSION) return `proposalVersion ${body.proposalVersion} is not ${PROPOSAL_VERSION}`;
  if (body.generator !== "rules-v0" && body.generator !== "random-v0") return `generator ${JSON.stringify(body.generator)} is not rules-v0 or random-v0`;
  for (const key of ["constants", "source", "notes", "rule", "fork", "spec", "prediction"]) if (!isObj(b[key])) return `the body has no ${key}`;
  if (!Array.isArray(body.argv) || !body.argv.every((x) => typeof x === "string")) return "the body's argv is not a list of strings";
  if (typeof body.reason !== "string") return "the body has no reason";

  const kc = body.constants as unknown as Rec;
  if (Object.keys(kc).length !== 5 || kc.W !== k.W || kc.burnInStep !== k.burnInStep || kc.horizon !== k.horizon || kc.threshold !== k.threshold) return `the constants are not this proposer's (${canonical(k)})`;
  if (typeof body.spec.presetId !== "string") return "the spec names no preset";
  const A = feedAmount(body.spec.presetId);
  if (kc.feedAmount !== A) return `constants.feedAmount ${JSON.stringify(kc.feedAmount)} is not the preset's ${A}`;

  const src = body.source;
  if (typeof src.dir !== "string" || src.dir === "" || typeof src.runId !== "string" || typeof src.presetIdentity !== "string" || !isInt(src.steps) || !isInt(src.censusEvery) || src.censusEvery <= 0 || typeof src.manifestSha256 !== "string" || !HEX64.test(src.manifestSha256) || typeof src.initHash !== "string")
    return "the body's source is malformed";
  const parts = src.runId.split("/");
  if (parts.length !== 4 || !/^seed-(0|[1-9]\d*)$/.test(parts[3])) return `source.runId ${JSON.stringify(src.runId)} is not <experiment>/<preset>/<condition>/seed-<n>`;
  const nt = body.notes;
  if (typeof nt.path !== "string" || typeof nt.sha256 !== "string" || !HEX64.test(nt.sha256) || typeof nt.recordSha256 !== "string" || !HEX64.test(nt.recordSha256) || !(nt.falseAlarm === null || nt.falseAlarm === "held-out" || nt.falseAlarm === "neutral") || !isNum(nt.zStar) || nt.zStar <= 0)
    return "the body's notes reference is malformed";
  if (nt.notebookVersion !== NOTEBOOK_VERSION || nt.bellVersion !== BELL_VERSION) return `the notes are notebook ${nt.notebookVersion} / bell ${nt.bellVersion}, this proposer reads ${NOTEBOOK_VERSION} / ${BELL_VERSION}`;
  const ringBad = bodyRingError(body.ring, src, k, nt.zStar);
  if (ringBad) return ringBad;
  const ring = body.ring;

  const C = body.fork.step;
  if (!isInt(C) || C < 0) return "the fork step is not a non-negative integer";
  if (body.fork.check !== (C === 0 ? "initHash" : "checkpoint")) return `the fork at step ${C} is checked by ${body.fork.check}`;
  if (typeof body.fork.hash !== "string") return "the fork names no hash";
  if (C === 0 && (body.fork.hash !== src.initHash || body.fork.file !== undefined)) return "a fork from step 0 is checked against the source's initHash, and names no file";
  if (C > 0 && typeof body.fork.file !== "string") return "a fork from a checkpoint names no checkpoint file";
  const S = body.interventionStep;
  if (S !== ring.receipt.endStep) return `the intervention step ${S} is not the receipt's last census ${ring.receipt.endStep}`;
  if (!(C < S)) return `the fork step ${C} is not before the intervention step ${S}, so nothing of the receipt would be replayed`;
  const cadBad = cadenceError(src.censusEvery, k);
  if (cadBad) return cadBad;

  const specBad = validateProposalSpec(body.spec, C);
  if (specBad) return specBad;
  const spec = body.spec;
  if (spec.presetId !== parts[1] || spec.condition !== parts[2] || spec.seed !== Number(parts[3].slice(5)) || spec.censusEvery !== src.censusEvery || C + spec.steps > src.steps) return "the spec does not fit the source it names";
  if (spec.steps !== S - C + k.horizon) return `the fork runs ${spec.steps} steps, not S − C + H = ${S - C + k.horizon}`;
  const cfg = specConfig(spec);
  const row = ruleFor(ring.signal, ring.side);
  const list = spec.interventions ?? [];

  if (body.generator === "rules-v0") {
    if (body.baseline !== undefined) return "a rules proposal carries a baseline field";
    if (Object.keys(body.rule).length !== 2 || body.rule.action !== row.action || body.rule.hypothesis !== HYPOTHESIS[row.action]) return `the rule is not the table's for ${ring.signal} ${ring.side} (${row.action})`;
    if ((row.action === "feed" || row.action === "drain") && A === null) return `a ${row.action} needs a feed amount, and the preset has none`;
    if (canonical(list) !== canonical(rulesInterventions(row, cfg, S, A))) return "the interventions are not the rule's (the jar disc at S)";
    if (body.replayThrough !== S) return `replayThrough ${body.replayThrough} is not S (${S})`;
    if (body.reason !== reasonText(ring, nt.falseAlarm, row.action, C, S, cfg, A)) return "the reason is not the one the rules write for this ring";
    if (canonical(body.prediction) !== canonical(predictionFor(ring, row, spec, C, k))) return "the prediction is not the one the rules give for this ring";
    if (body.alsoAnswers !== undefined) {
      if (!Array.isArray(body.alsoAnswers) || body.alsoAnswers.length === 0) return "alsoAnswers is present but not a non-empty list";
      let last = ring.index;
      for (const [i, x] of body.alsoAnswers.entries()) {
        const y = x as unknown as Rec;
        if (!isObj(y) || Object.keys(y).length !== 6 || !isInt(y.index) || y.index <= last || typeof y.signal !== "string" || !SIGNALS.some((s) => s.name === y.signal) || !isSide(y.side) || typeof y.label !== "string" || y.label === "" || !isNum(y.spread) || y.spread <= 0)
          return `alsoAnswers[${i}] is malformed or out of filing order`;
        last = y.index as number;
        const r2 = ruleFor(x.signal, x.side);
        if ((r2.action === "feed" || r2.action === "drain") && A === null) return `alsoAnswers[${i}] needs a feed amount`;
        if (canonical(rulesInterventions(r2, cfg, S, A)) !== canonical(list)) return `alsoAnswers[${i}] (${x.signal} ${x.side}) does not give this run spec`;
        if (canonical(x.prediction) !== canonical(predictionFor(x, r2, spec, C, k))) return `alsoAnswers[${i}]'s prediction is not the one the rules give`;
      }
    }
  } else {
    if (body.alsoAnswers !== undefined) return "a random fork carries alsoAnswers";
    const bl = body.baseline as unknown as Rec | undefined;
    if (!isObj(bl) || Object.keys(bl).length !== 3 || typeof bl.matches !== "string" || !/^[0-9a-f]{16}$/.test(bl.matches) || !isInt(bl.seed) || bl.seed < 0 || bl.seed > 0xffffffff || typeof bl.specSha256 !== "string" || !HEX64.test(bl.specSha256))
      return "a random fork names no matched proposal, seed and matched spec hash";
    if (row.action === "control") return "a random fork matches a replay control, which has nothing to randomise";
    if ((row.action === "feed" || row.action === "drain") && A === null) return `the matched ${row.action} needs a feed amount`;
    const rules = rulesInterventions(row, cfg, S, A);
    if (specHash(withInterventions(spec, rules)) !== bl.specSha256) return "baseline.specSha256 is not the rules spec of this ring";
    const drawn = drawRandom(bl.seed as number, bl.specSha256, rules.length, cfg, C, S, A, spec.censusEvery);
    if (canonical(list) !== canonical(drawn)) return "the entries are not the draw for this seed and matched spec";
    if (body.replayThrough !== drawn[0].step) return `replayThrough ${body.replayThrough} is not the first entry's step ${drawn[0].step}`;
    if (canonical(body.rule) !== canonical(RANDOM_RULE)) return "a random fork's rule is not random";
    if (body.reason !== randomReason(bl.matches, bl.seed as number, drawn.length, drawn[0].step)) return "the reason is not the random fork's";
    if (canonical(body.prediction) !== canonical(NO_PREDICTION)) return "a random fork states a prediction";
  }

  let argv: string[];
  try {
    argv = runArgv(spec, { step: C, dir: src.dir });
  } catch (e) {
    return (e as Error).message;
  }
  if (canonical(argv) !== canonical(body.argv)) return "the stored argv is not the one the spec gives";
  return null;
}

/**
 * Re-derives a body from its own ring, fork and source and refuses any difference (amendment 2026-10-18): the constants are the
 * proposer's, S is the receipt's last census and C is before it, the spec passes validateProposalSpec and fits the source, a rules
 * body's interventions, reason, prediction and alsoAnswers are exactly what the rules write, a random fork's entries are exactly
 * its seed's draw, and the argv is runArgv's. A malformed body is a refusal, never a throw. Null when it holds.
 */
export function validateProposal(body: ProposalBody, k: ProposerConstants = RULES_V0): string | null {
  try {
    return bodyError(body, k);
  } catch (e) {
    return `the body is malformed (${(e as Error).message})`;
  }
}

// ---------------------------------------------------------------------------------------------
// The yes gate.

const NOT_A_PERSON = ["claude", "codex", "gpt", "chatgpt", "gemini", "sonnet", "opus", "haiku", "grok", "llama", "copilot", "mistral", "deepseek", "qwen", "agent", "bot", "robot", "assistant", "model", "llm", "ai"];
const MODEL_STEM = /^(claude|codex|gpt|gemini|sonnet|opus|haiku|grok|llama|qwen|mistral)\d/;
/**
 * A person's name (the note, "The yes gate"; amendment 2026-10-18, "Names"): 2 to 80 characters after NFKC normalisation and
 * trimming, with a letter, and no model, agent or bot word as a whole word in any case, after dots and apostrophes are dropped
 * ("A.I." is "ai") and full-width letters folded ("Ｃｌａｕｄｅ" is "Claude"), nor a model name followed by digits ("gpt4").
 */
export function isPersonName(name: string): boolean {
  const t = name.normalize("NFKC").trim();
  if (t.length < 2 || t.length > 80 || !/\p{L}/u.test(t)) return false;
  const words = t.toLowerCase().replace(/[.·'’]/g, "").split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  return !words.some((w) => NOT_A_PERSON.includes(w) || MODEL_STEM.test(w));
}

/** `approve`: the approved proposal, or a thrown refusal (a status other than proposed, a name that is not a person's, a body that does not re-validate). */
export function approve(p: Proposal, by: string, at: string): Proposal {
  if (p.status !== "proposed") throw new Error(`refused: the proposal's status is ${p.status}, not proposed`);
  if (!isPersonName(by)) throw new Error(`refused: ${JSON.stringify(by)} is not a person's name (2 to 80 characters with a letter, no model, agent or bot word); only a person approves a proposal`);
  const bad = validateProposal(p.body);
  if (bad) throw new Error(`refused: the proposal does not re-validate: ${bad}`);
  return { id: p.id, status: "approved", approval: { by: by.normalize("NFKC").trim(), at, bodySha256: bodySha256(p.body) }, body: p.body };
}

/** Why `run` must refuse this proposal, or null: not approved, an approval that does not bind this body or names no person, a body that does not re-validate. Never throws. */
export function runRefusal(p: Proposal): string | null {
  try {
    if (p.status !== "approved") return `not approved: the status is ${p.status}; a person approves it first with tools/propose.ts approve <file> --by <name>`;
    if (!p.approval) return "not approved: the file has no approval";
    if (typeof p.approval.by !== "string" || !isPersonName(p.approval.by)) return "the approval names no person";
    const now = bodySha256(p.body);
    if (p.approval.bodySha256 !== now) return `the body changed after it was approved (approved ${p.approval.bodySha256}, now ${now})`;
    if (p.id !== now.slice(0, 16)) return "the id is not the body's";
    return validateProposal(p.body);
  } catch (e) {
    return `the proposal is malformed (${(e as Error).message})`;
  }
}

// ---------------------------------------------------------------------------------------------
// The random baseline (the note, "The random baseline, for the bench"; amendment 2026-10-18, "What the random fork matches").

const RANDOM_RULE = Object.freeze({ action: "random" as const, hypothesis: "none: a random fork with the matched proposal's entry count, not its dose" });
const NO_PREDICTION: Prediction = Object.freeze({ kind: "none" as const, statement: "A random fork states no hypothesis; the bench scores it beside the proposal it matches." });

function randomReason(matches: string, seed: number, n: number, through: number): string {
  return `A random fork for the bench, matched to proposal ${matches}: the same source, fork step and length, and the same number of entries (${n === 1 ? "one" : n}), each drawn at random (kind, centre, radius and step) with seed ${seed}. Only the entry count is matched, not the dose: the kind, the radius, the cells covered and the timing differ from the proposal's. It states no hypothesis. It must replay the source up to step ${group(through)}, its first entry.`;
}

/** The first 32 bits of SHA-256("<seed>:<matched spec's SHA-256>"), the random fork's mulberry32 seed: content only, so moving the bundle or the notes changes no draw. */
export const baselineSeed = (seed: number, specSha256: string): number => parseInt(sha(`${seed}:${specSha256}`).slice(0, 8), 16) >>> 0;

/** n entries drawn by mulberry32: kind (lesion, feed, drain; lesion only without A), centre, radius in 1..R, step on the census grid in (C, S]; in tools/run.ts's merge order. */
export function drawRandom(seed: number, specSha256: string, n: number, cfg: WorldConfig, C: number, S: number, A: number | null, cadence: number): ScheduledIntervention[] {
  const W = worldW(cfg), cells = cellCount(cfg), R = maxLesionRadius(cfg);
  const censusSteps = (S - C) / cadence; // census steps in (C, S]: C + cadence .. S
  const rnd = mulberry32(baselineSeed(seed, specSha256));
  const int = (m: number) => Math.min(m - 1, Math.floor(rnd() * m));
  const kinds = A === null ? (["lesion"] as const) : (["lesion", "feed", "drain"] as const);
  const drawn: ScheduledIntervention[] = [];
  for (let i = 0; i < n; i++) {
    const kind = kinds[int(kinds.length)];
    const cell = int(cells);
    const x = cell % W, y = Math.floor(cell / W);
    const r = 1 + int(R);
    const step = C + cadence * (1 + int(censusSteps));
    drawn.push(kind === "lesion" ? { step, kind: "lesion", x, y, r } : { step, kind: "feed", x, y, r, amount: kind === "feed" ? A! : -A! });
  }
  return canonicalOrder(drawn);
}

/** One random fork with the proposal's entry count, fork step and length, or null for a replay control (nothing to randomise). */
export function randomBaseline(p: Proposal, seed: number): Proposal | null {
  const b = p.body;
  if (b.generator !== "rules-v0") throw new Error(`a random fork matches a rules proposal, not a ${b.generator} one`);
  const n = b.spec.interventions?.length ?? 0;
  if (n === 0) return null;
  const cfg = specConfig(b.spec);
  const C = b.fork.step, S = b.interventionStep;
  const specSha256 = specHash(b.spec);
  const interventions = drawRandom(seed, specSha256, n, cfg, C, S, b.constants.feedAmount, b.spec.censusEvery);
  const spec: RunSpec = { ...b.spec, interventions };
  const bad = validateProposalSpec(spec, C);
  if (bad) throw new Error(`random fork for ${p.id}: ${bad}`);
  const through = interventions[0].step;
  const rest: ProposalBody = { ...b };
  delete rest.alsoAnswers;
  const body: ProposalBody = {
    ...rest,
    generator: "random-v0",
    rule: { ...RANDOM_RULE },
    replayThrough: through,
    spec,
    argv: runArgv(spec, { step: C, dir: b.source.dir }),
    reason: randomReason(p.id, seed, n, through),
    prediction: { ...NO_PREDICTION },
    baseline: { matches: p.id, seed, specSha256 },
  };
  return { id: proposalId(body), status: "proposed", body };
}

// ---------------------------------------------------------------------------------------------
// Deciding a prediction (no CLI in v0; the bench will call this).

/** Per-census signal vectors (SIGNALS order), keyed by step, as SignalExtractor gives them. */
export type SignalTrack = ReadonlyMap<number, readonly (number | null)[]>;

/**
 * Whether the prediction holds, from the source's and the fork's signal tracks (the note, "The prediction, and how it is decided").
 * Directional: d_t = (fork_t - source_t) / spread over the window's censuses; holds iff median(d_t * direction) >= threshold.
 * Replay: every census in the window, all 13 signals equal, a null only equal to a null (feed the fork's extractor the source's
 * censuses up to C first, so its rates are the whole history's). A census missing from either track, or a vector that is not 13
 * numbers or nulls, throws: the prediction cannot be decided. Kind none throws.
 */
export function predictionHolds(pred: Prediction, cadence: number, source: SignalTrack, fork: SignalTrack): boolean {
  if (pred.kind === "none") throw new Error("a random fork's prediction (kind none) is not decided");
  if (pred.kind !== "replay" && pred.kind !== "directional") throw new Error(`unknown prediction kind ${JSON.stringify(pred.kind)}`);
  const from = pred.fromStep!, to = pred.toStep!;
  if (!isInt(cadence) || cadence <= 0) throw new Error(`the cadence ${cadence} is not a positive integer`);
  if (!isInt(from) || !isInt(to) || from <= 0 || from > to || from % cadence !== 0 || to % cadence !== 0) throw new Error(`the prediction's window ${from} to ${to} is not on the census grid (cadence ${cadence})`);
  const at = (track: SignalTrack, step: number, what: string) => {
    const v = track.get(step);
    if (!v) throw new Error(`the ${what} has no census at step ${step}`);
    if (v.length !== SIGNALS.length || !v.every((x) => x === null || isNum(x))) throw new Error(`the ${what}'s census at step ${step} is not ${SIGNALS.length} numbers or nulls`);
    return v;
  };
  if (pred.kind === "replay") {
    let n = 0;
    for (let t = from; t <= to; t += cadence, n++) {
      const a = at(source, t, "source"), b = at(fork, t, "fork");
      for (let i = 0; i < SIGNALS.length; i++) if (a[i] !== b[i]) return false;
    }
    if (n !== pred.censuses) throw new Error(`the window holds ${n} censuses, the prediction names ${pred.censuses}`);
    return true;
  }
  const s = SIGNALS.findIndex((d) => d.name === pred.signal);
  if (s < 0) throw new Error(`unknown signal ${pred.signal}`);
  const sign = pred.direction === "up" ? 1 : -1;
  const d: number[] = [];
  for (let t = from; t <= to; t += cadence) {
    const a = at(source, t, "source")[s], b = at(fork, t, "fork")[s];
    if (a === null || b === null) throw new Error(`signal ${pred.signal} is undefined at step ${t}`);
    d.push(((b - a) / pred.spread!) * sign);
  }
  if (d.length !== pred.censuses) throw new Error(`the window holds ${d.length} censuses, the prediction names ${pred.censuses}`);
  d.sort((x, y) => x - y);
  const mid = d.length >> 1;
  const median = d.length % 2 ? d[mid] : (d[mid - 1] + d[mid]) / 2;
  return median >= pred.threshold!;
}
