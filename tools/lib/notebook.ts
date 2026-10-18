// The naturalist's field notebook, v0 (docs/naturalist-bell-v0-2026-10-17.md, section "The field notebook, v0: fixed before
// generating (2026-10-17)"; this file implements that section and amends none of it). Pure functions and classes, no Deno or
// filesystem access, so vitest can load it. The CLI is tools/notebook.ts; the page is tools/lib/notebook-html.ts.
//
// What it does. The bell (tools/lib/bell.ts, BellScorer, unmodified) decides every ring: it is fed every census of the bundle and of
// the bell's envelope (all neutral runs of the preset in the bell corpus) in lockstep, at W = 50 and at Z = nextUp(Z*), the smallest
// double above the calibrated threshold, so its own ">=" is the note's strict ">" and an exact tie never rings. In the same read,
// ZTrace recomputes each census's z with the bell's departure() against its own sorted copy of the envelope values (the bundle
// filtered out when it is a member) and keeps the bundle's value, the envelope median and the spread per census. crossCheck stops
// unless the trace reproduces the bell exactly: all 26 (signal, side) D values at W = 50, the ring set, and for each ring the first
// stretch's start, window minimum, value and median. Only then are notes built, from fixed templates; nothing here calls a model.
import {
  BELL_VERSION,
  BURN_IN_STEP,
  EXPECTED_CALIB_PER_PRESET,
  NOTE_PATH,
  RATE_LAG,
  RollingMin,
  SIGNALS,
  corpusRuns,
  departure,
  type CorpusRun,
  type Receipt,
  type ScoringResult,
} from "./bell.ts";

export const NOTEBOOK_VERSION = 0;
/** The calibrated thresholds exist only at this window length (the record's secondary readout). */
export const NOTEBOOK_W = 50;
/** Censuses per column in a note's picture. */
export const BIN = 25;
export const RECORD_PATH = "experiments/naturalist/bell-v0.json";

export type Side = "high" | "low";
export const SIDES = [1, -1] as const;
export const SIDE_NAMES = ["high", "low"] as const;
const NS = SIGNALS.length;

// ---------------------------------------------------------------------------------------------
// Strict comparison.

/** The smallest double greater than x (x itself for NaN and +Infinity). */
export function nextUp(x: number): number {
  if (Number.isNaN(x) || x === Infinity) return x;
  if (x === 0) return Number.MIN_VALUE;
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, x);
  const b = dv.getBigUint64(0);
  dv.setBigUint64(0, x > 0 ? b + 1n : b - 1n);
  return dv.getFloat64(0);
}

// ---------------------------------------------------------------------------------------------
// The bell record.

export interface RecordCount {
  k: number;
  of: number;
}
export interface RecordRun {
  id: string;
  experiment: string;
  preset: string;
  condition: string;
  seed: number;
  envelope: string;
  D: Record<string, number>;
  D_primary?: number;
  flagged?: boolean;
  /** The bell's receipts at the record's primary Z and W (one per signal and side that rang). */
  rings: Receipt[];
}
export interface BellRecord {
  rule: "anomaly-bell";
  version: number;
  note: string;
  complete: true;
  preliminaryOnly: false;
  missing: [];
  parameters: { primary: { Z: number; W: number }; signals: { name: string; kind: string; floor: number; source: string }[] };
  corpus: { id: string; presetIdentity: string; steps: number; censusEvery: number }[];
  summary: {
    criterion1: { status: string; k: number; n: number };
    secondary: {
      status: "called";
      W: number;
      perPreset: Record<string, { calibRuns: number; zStar: number; heldOutNeutral: RecordCount; expected: number | null }>;
      heldOutNeutralTotal: RecordCount & { expected: number };
    };
  };
  runs: RecordRun[];
}

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Parses the bell's committed record and refuses anything the notebook cannot ring from; every refusal says why. */
export function parseBellRecord(text: string): BellRecord {
  let r: unknown;
  try {
    r = JSON.parse(text);
  } catch (e) {
    throw new Error(`bell record: not JSON (${(e as Error).message})`);
  }
  if (!isObj(r)) throw new Error("bell record: not a JSON object");
  if (r.rule !== "anomaly-bell") throw new Error(`bell record: rule is ${JSON.stringify(r.rule)}, not "anomaly-bell"`);
  if (r.version !== BELL_VERSION) throw new Error(`bell record: version ${JSON.stringify(r.version)}, the notebook reads bell version ${BELL_VERSION}`);
  if (r.complete !== true) throw new Error("bell record: complete is not true (an incomplete or preliminary readout calibrates nothing)");
  if (r.preliminaryOnly !== false) throw new Error("bell record: preliminaryOnly is not false (a preliminary readout calibrates nothing)");
  if (!Array.isArray(r.missing) || r.missing.length) throw new Error(`bell record: missing is ${JSON.stringify(r.missing)}, not [] (the corpus was not whole)`);
  const p = r.parameters;
  if (!isObj(p) || !Array.isArray(p.signals)) throw new Error("bell record: no parameters.signals");
  const want = SIGNALS.map((s) => ({ name: s.name, kind: s.kind, floor: s.floor, source: s.source }));
  const got = (p.signals as unknown[]).map((s) => (isObj(s) ? { name: s.name, kind: s.kind, floor: s.floor, source: s.source } : s));
  if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error("bell record: parameters.signals differ from tools/lib/bell.ts SIGNALS");
  const s = r.summary;
  if (!isObj(s) || !isObj(s.secondary) || !isObj(s.criterion1)) throw new Error("bell record: no summary.secondary or summary.criterion1");
  const sec = s.secondary;
  if (sec.status !== "called") throw new Error(`bell record: the calibrated readout is ${JSON.stringify(sec.status)}, not "called"`);
  if (sec.W !== NOTEBOOK_W) throw new Error(`bell record: the calibrated readout is at W = ${JSON.stringify(sec.W)}, the notebook needs W = ${NOTEBOOK_W}`);
  if (!isObj(sec.perPreset) || !Object.keys(sec.perPreset).length) throw new Error("bell record: no per-preset thresholds");
  for (const [preset, v] of Object.entries(sec.perPreset)) {
    if (!isObj(v) || !isNum(v.zStar)) throw new Error(`bell record: ${preset} has no finite zStar (${JSON.stringify(isObj(v) ? v.zStar : v)})`);
    if (!(v.zStar > 0)) throw new Error(`bell record: ${preset} zStar ${v.zStar} is not positive`);
  }
  const ht = sec.heldOutNeutralTotal;
  if (!isObj(ht) || !isNum(ht.k) || !isNum(ht.of) || !isNum(ht.expected)) throw new Error("bell record: no summary.secondary.heldOutNeutralTotal");
  const c1 = s.criterion1;
  if (!isNum(c1.k) || !isNum(c1.n)) throw new Error("bell record: summary.criterion1 has no k and n");
  if (!isObj(p.primary) || !isNum(p.primary.Z) || !isNum(p.primary.W)) throw new Error("bell record: parameters.primary has no numeric Z and W");
  if (p.primary.W !== NOTEBOOK_W) throw new Error(`bell record: primary W is ${p.primary.W}; the notebook holds the record's rings to the data only at W = ${NOTEBOOK_W}`);
  if (!Array.isArray(r.corpus)) throw new Error("bell record: no corpus list");
  const ident = new Map<string, string>();
  for (const c of r.corpus as unknown[]) {
    if (!isObj(c) || typeof c.id !== "string" || typeof c.presetIdentity !== "string") throw new Error("bell record: a corpus entry has no id or presetIdentity");
    if (!isNum(c.steps) || !isNum(c.censusEvery)) throw new Error(`bell record: corpus entry ${c.id} has no numeric steps and censusEvery`);
    const preset = c.id.split("/")[1];
    const seen = ident.get(preset);
    if (seen !== undefined && seen !== c.presetIdentity) throw new Error(`bell record: preset ${preset} has two presetIdentity values in the corpus (${seen}, ${c.presetIdentity})`);
    ident.set(preset, c.presetIdentity);
  }
  if (!Array.isArray(r.runs)) throw new Error("bell record: no runs list");
  for (const x of r.runs as unknown[]) {
    if (!isObj(x) || typeof x.id !== "string" || !isObj(x.D) || !Array.isArray(x.rings)) throw new Error("bell record: a runs entry has no id, D or rings");
    if (!x.rings.every(isObj)) throw new Error(`bell record: ${x.id} has a ring that is not an object`);
  }
  const rec = r as unknown as BellRecord;
  checkRecordCounts(rec);
  return rec;
}

/** The record's neutral runs scored against the all-neutral envelope (the runs every count on the page is made of). */
const neutralEntries = (rec: BellRecord) => rec.runs.filter((x) => x.envelope === "all-neutral" && x.condition === "neutral");
const primaryRings = (rec: BellRecord, x: RecordRun) => x.rings.filter((g) => g.Z === rec.parameters.primary.Z && g.W === rec.parameters.primary.W);

/**
 * The page prints the record's counts, so they must follow from the record's own D values, recounted the way the bell's summarize()
 * counts them: Z*_p is the largest D at W = 50 of the preset's 20 replay-calib neutral runs, the held-out count is replay-m4 neutral
 * runs with D > Z*_p, the expectation of/(calib + 1), and criterion 1 the neutral runs with D >= Z at the primary W. Refuses a record
 * that contradicts itself, naming the count.
 */
function checkRecordCounts(rec: BellRecord): void {
  const fail = (what: string) => {
    throw new Error(`bell record: ${what}; its counts do not follow from its own D values`);
  };
  const W = String(NOTEBOOK_W);
  const neutral = neutralEntries(rec);
  for (const x of neutral) if (!isNum(x.D[W])) fail(`${x.id} has no finite D at W = ${W}`);
  const sec = rec.summary.secondary;
  let hk = 0, hn = 0, he = 0;
  for (const [p, v] of Object.entries(sec.perPreset)) {
    const calib = neutral.filter((x) => x.preset === p && x.experiment === "replay-calib").map((x) => x.D[W]);
    if (calib.length !== EXPECTED_CALIB_PER_PRESET || v.calibRuns !== calib.length) fail(`${p} has ${calib.length} replay-calib neutral runs and says calibRuns ${v.calibRuns}, the bell needs ${EXPECTED_CALIB_PER_PRESET}`);
    const max = Math.max(...calib);
    if (!Object.is(max, v.zStar)) fail(`${p} zStar ${v.zStar} is not the largest of its ${calib.length} calibration D values (${max})`);
    const held = neutral.filter((x) => x.preset === p && x.experiment === "replay-m4");
    const k = held.filter((x) => x.D[W] > v.zStar).length;
    if (!isObj(v.heldOutNeutral) || v.heldOutNeutral.k !== k || v.heldOutNeutral.of !== held.length) fail(`${p} held out ${JSON.stringify(v.heldOutNeutral)}, recounted ${k} of ${held.length}`);
    const expected = held.length / (calib.length + 1);
    if (!Object.is(v.expected, expected)) fail(`${p} expected ${v.expected}, recounted ${expected}`);
    hk += k;
    hn += held.length;
    he += expected;
  }
  const ht = sec.heldOutNeutralTotal;
  if (ht.k !== hk || ht.of !== hn || Math.abs(ht.expected - he) > 1e-9) fail(`heldOutNeutralTotal ${ht.k} of ${ht.of} (expected ${ht.expected}), recounted ${hk} of ${hn} (${he})`);
  const { Z, W: Wp } = rec.parameters.primary;
  for (const x of neutral) if (!isNum(x.D[String(Wp)])) fail(`${x.id} has no finite D at W = ${Wp}`);
  const k1 = neutral.filter((x) => x.D[String(Wp)] >= Z).length;
  const c1 = rec.summary.criterion1;
  if (c1.k !== k1 || c1.n !== neutral.length) fail(`criterion1 ${c1.k} of ${c1.n}, recounted ${k1} of ${neutral.length} at Z = ${Z}, W = ${Wp}`);
  // Run by run, not in aggregate: a run lists rings exactly when its D reaches Z, and each ring is a receipt the bell could have
  // written for it (a known signal and side, at the primary Z and W, from the first counted census on, its window W censuses long,
  // its smallest side·z between Z and the run's D). Which signal rang is not recomputable from the record (D is per W only);
  // tools/notebook.ts checks it against the bell for every run it reads.
  const sigs = new Set(SIGNALS.map((d) => d.name));
  for (const x of rec.runs.filter((y) => y.envelope === "all-neutral")) {
    const D = x.D[String(Wp)];
    if (!isNum(D)) fail(`${x.id} has no finite D at W = ${Wp}`);
    if (x.D_primary !== undefined && !Object.is(x.D_primary, D)) fail(`${x.id} D_primary ${x.D_primary} is not its D at W = ${Wp} (${D})`);
    if (x.flagged !== undefined && x.flagged !== D >= Z) fail(`${x.id} flagged ${x.flagged} with D ${D} at Z = ${Z}`);
    const rs = primaryRings(rec, x);
    if (rs.length !== x.rings.length) fail(`${x.id} lists rings at other than Z = ${Z}, W = ${Wp}`);
    if ((rs.length > 0) !== D >= Z) fail(`${x.id} lists ${rs.length} ring(s) at Z = ${Z}, W = ${Wp} with D ${D}`);
    const pairs = new Set<string>();
    for (const g of rs) {
      const pair = `${g.signal} ${g.side}`;
      if (!sigs.has(g.signal) || (g.side !== "high" && g.side !== "low") || pairs.has(pair)) fail(`${x.id} lists a ring ${JSON.stringify(g)} the bell cannot write`);
      pairs.add(pair);
      if (!isNum(g.startStep) || g.startStep < BURN_IN_STEP || !isNum(g.endStep) || g.endStep <= g.startStep) fail(`${x.id}: ring ${pair} spans steps ${g.startStep} to ${g.endStep}`);
      if (!isNum(g.minAbsZ) || g.minAbsZ < Z || g.minAbsZ > D) fail(`${x.id}: ring ${pair} has smallest side·z ${g.minAbsZ}, outside [${Z}, D ${D}]`);
      if (!isNum(g.value) || !isNum(g.median)) fail(`${x.id}: ring ${pair} has no finite value and median`);
    }
  }
  const withRings = neutral.filter((x) => primaryRings(rec, x).length > 0).length;
  if (withRings !== k1) fail(`${withRings} neutral runs list rings at Z = ${Z}, W = ${Wp}, but ${k1} have D >= ${Z}`);
}

/**
 * A corpus run read from disk against its record entry (envelope all-neutral): the bell's D at W = 50 must equal the record's, and
 * its receipts at the record's primary Z and W (= NOTEBOOK_W) must be the record's rings, field for field. `result` must come from a
 * BellScorer run at W = [NOTEBOOK_W] with the primary Z among its Zs. This is what ties Z* (and the false-alarm counts) to the data on disk.
 */
export function checkCorpusScore(rec: BellRecord, id: string, result: ScoringResult): void {
  const e = rec.runs.find((r) => r.id === id && r.envelope === "all-neutral");
  if (!e) throw new Error(`STOP: ${id}: the bell record has no all-neutral entry for this corpus run`);
  const want = e.D[String(NOTEBOOK_W)];
  if (!Object.is(result.D[0], want))
    throw new Error(`STOP: ${id}: on disk it scores D ${result.D[0]} at W = ${NOTEBOOK_W}, the bell record says ${want}; Z* was calibrated on the record's data, not this`);
  const { Z, W } = rec.parameters.primary; // W = NOTEBOOK_W (parseBellRecord)
  const key = (r: Receipt) => JSON.stringify([r.signal, r.side, r.Z, r.W, r.startStep, r.endStep, r.minAbsZ, r.value, r.median]);
  const got = result.receipts.filter((r) => r.Z === Z && r.W === W).map(key).sort();
  const rec2 = primaryRings(rec, e).map(key).sort();
  if (got.join("|") !== rec2.join("|")) throw new Error(`STOP: ${id}: on disk its rings at Z = ${Z}, W = ${W} are ${got.join(", ") || "none"}; the bell record lists ${rec2.join(", ") || "none"}`);
}

/** Per (signal, side), how many of the record's neutral runs rang on it at the primary Z and W; most first, then in SIGNALS order. */
export function falseAlarmSignals(rec: BellRecord): { signal: string; side: Side; runs: number }[] {
  const counts = new Map<string, number>();
  for (const x of neutralEntries(rec)) for (const key of new Set(primaryRings(rec, x).map((g) => `${g.signal} ${g.side}`))) counts.set(key, (counts.get(key) ?? 0) + 1);
  return [...counts]
    .map(([key, runs]) => {
      const [signal, side] = key.split(" ");
      return { signal, side: side as Side, runs };
    })
    .sort((a, b) => b.runs - a.runs || signalIndex(a.signal) - signalIndex(b.signal) || (a.side < b.side ? -1 : 1));
}

/** The record's treatment and no-mutation runs (all-neutral envelope): how many rang at the primary Z and W from the first counted census. */
export function armsFromBurnIn(rec: BellRecord): { k: number; of: number } {
  const arms = rec.runs.filter((x) => x.envelope === "all-neutral" && x.condition !== "neutral");
  const k = arms.filter((x) => {
    const r = primaryRings(rec, x);
    return r.length > 0 && Math.min(...r.map((g) => g.startStep)) === BURN_IN_STEP;
  }).length;
  return { k, of: arms.length };
}

/** A run's manifest identity against the record's corpus entry for it: the envelope Z* was calibrated on must be the one on disk. */
export function checkAgainstRecordCorpus(rec: BellRecord, run: { id: string; presetIdentity: unknown; steps: unknown; censusEvery: unknown }): void {
  const c = rec.corpus.find((x) => x.id === run.id);
  if (!c) throw new Error(`STOP: ${run.id} is not in the bell record's corpus`);
  for (const k of ["presetIdentity", "steps", "censusEvery"] as const)
    if (run[k] !== c[k]) throw new Error(`STOP: ${run.id}: manifest ${k} ${JSON.stringify(run[k])}, the bell record's corpus has ${JSON.stringify(c[k])}; Z* was calibrated on the record's runs`);
}

/**
 * Every series cell a signal is read from must be a finite number. The bell counts a missing or non-finite cell as 0 (finiteOrZero),
 * which the notebook would then print as a measurement, so the notebook stops instead.
 */
export function checkSignalCells(runId: string, rec: Record<string, unknown> & { step: number }): void {
  for (const d of SIGNALS) {
    if (d.source !== "series") continue;
    const v = rec[d.name];
    if (typeof v !== "number" || !Number.isFinite(v)) throw new Error(`STOP: ${runId}: series.jsonl step ${rec.step} has ${d.name} ${typeof v === "number" ? String(v) : JSON.stringify(v) ?? "missing"}, not a finite number; the bell would count it as 0 and the page would print that as measured`);
  }
}

/** Z*_p, or a refusal naming the preset. */
export function zStarFor(record: BellRecord, preset: string): number {
  const v = record.summary.secondary.perPreset[preset];
  if (!v) throw new Error(`STOP: the bell record has no calibrated threshold for ${preset} (it has ${Object.keys(record.summary.secondary.perPreset).join(", ")}); the notebook rings only at a calibrated Z*`);
  return v.zStar;
}

/** The presetIdentity the record's corpus lists for a preset, or null. */
export function recordIdentity(record: BellRecord, preset: string): string | null {
  return record.corpus.find((c) => c.id.split("/")[1] === preset)?.presetIdentity ?? null;
}

/** The record's D at W = 50 for a corpus run against the all-neutral envelope, or null when the record has no such entry. */
export function recordD(record: BellRecord, id: string): number | null {
  const e = record.runs.find((r) => r.id === id && r.envelope === "all-neutral");
  const d = e?.D?.[String(NOTEBOOK_W)];
  return isNum(d) ? d : null;
}

// ---------------------------------------------------------------------------------------------
// Manifests.

export interface SubjectManifest {
  spec: { experiment: string; presetId: string; condition: string; seed: number; steps: number; censusEvery: number };
  /** The run's effective configuration; only `neutral` is read. */
  cfg: { neutral: boolean };
  presetIdentity: string;
}
/** A bundle's manifest.json, checked enough to place it: spec fields, presetIdentity, and a summary (a finished run). */
export function parseSubjectManifest(dir: string, text: string): SubjectManifest {
  let m: unknown;
  try {
    m = JSON.parse(text);
  } catch (e) {
    throw new Error(`${dir}: manifest.json is not JSON (${(e as Error).message})`);
  }
  if (!isObj(m) || !isObj(m.spec)) throw new Error(`${dir}: manifest.json has no spec object`);
  const s = m.spec;
  for (const k of ["experiment", "presetId", "condition"] as const) if (typeof s[k] !== "string" || !s[k]) throw new Error(`${dir}: manifest spec has no ${k}`);
  for (const k of ["seed", "steps", "censusEvery"] as const) if (!isNum(s[k])) throw new Error(`${dir}: manifest spec has no numeric ${k}`);
  if (!m.summary) throw new Error(`${dir}: manifest has no summary (unfinished run)`);
  if (typeof m.presetIdentity !== "string" || !m.presetIdentity) throw new Error(`${dir}: manifest has no presetIdentity`);
  // The page calls a neutral run's notes neutral dynamics alone, so the label must be the physics: the condition name and the
  // effective config's neutral flag must agree, and no spec override may change the config behind the label.
  if (s.overrides !== undefined && s.overrides !== null) throw new Error(`${dir}: manifest spec has overrides ${JSON.stringify(s.overrides)}; the notebook reads only runs whose condition names their configuration`);
  if (!isObj(m.cfg) || typeof m.cfg.neutral !== "boolean") throw new Error(`${dir}: manifest has no cfg.neutral flag`);
  if (m.cfg.neutral !== (s.condition === "neutral")) throw new Error(`${dir}: manifest condition ${s.condition} but cfg.neutral ${m.cfg.neutral}`);
  return m as unknown as SubjectManifest;
}
export const manifestId = (m: SubjectManifest) => `${m.spec.experiment}/${m.spec.presetId}/${m.spec.condition}/seed-${m.spec.seed}`;

// ---------------------------------------------------------------------------------------------
// Plan: the envelope, who is scored, who is left out.

const norm = (p: string) => (p.length > 1 ? p.replace(/\/+$/, "") : p);

export interface SubjectInput {
  /** As given on the command line. */
  dir: string;
  /** Canonical path (realPath). */
  real: string;
  manifest: SubjectManifest;
}
export interface PlannedSubject extends SubjectInput {
  id: string;
  /** The corpus run this bundle is (same directory under the base), or null. */
  corpusRun: CorpusRun | null;
  /** Index in plan.runs. */
  run: number;
  /** One of the envelope's runs, scored leave-one-out. */
  member: boolean;
  /** A replay-calib neutral run: one of the 20 that fixed Z*, so it cannot ring by construction. */
  calibration: boolean;
  /** The record's D at W = 50 (all-neutral), for a corpus run. */
  recordD: number | null;
  /** Output file name (no extension). */
  outName: string;
}
export interface NotebookPlan {
  preset: string;
  zStar: number;
  /** The bell's Z: the smallest double above zStar. */
  zRing: number;
  /** Runs read in lockstep: the envelope first (in corpus order), then the subjects that are not in it. */
  runs: { id: string; dir: string }[];
  /** Indices into runs. */
  envelope: number[];
  envelopeIds: string[];
  subjects: PlannedSubject[];
  presetIdentity: string;
}

/**
 * One preset. `corpus`: every bell-corpus run of the preset, any condition, with its canonical directory under the base (null when
 * it or one of its three files is missing). Refuses: a preset with no calibrated threshold, a missing envelope run, a bundle of
 * another preset, a bundle listed twice, a bundle whose presetIdentity is not the record's, a corpus run whose manifest names
 * another run, a bundle elsewhere whose manifest names a corpus neutral run, and a corpus run with no record entry.
 */
export function planNotebook(input: { preset: string; record: BellRecord; subjects: readonly SubjectInput[]; corpus: readonly { run: CorpusRun; real: string | null }[] }): NotebookPlan {
  const { preset, record } = input;
  const zStar = zStarFor(record, preset);
  const expected = corpusRuns().filter((r) => r.preset === preset && r.condition === "neutral");
  if (!expected.length) throw new Error(`STOP: the bell corpus has no neutral runs of ${preset}`);
  const byId = new Map(input.corpus.map((c) => [c.run.id, c]));
  const missing = expected.filter((r) => !byId.get(r.id)?.real);
  if (missing.length) throw new Error(`STOP: ${missing.length} of the ${expected.length} ${preset} neutral runs of the bell's envelope are missing under the base (first: ${missing[0].id}); Z* was calibrated against all of them`);
  const identity = recordIdentity(record, preset);
  if (identity === null) throw new Error(`STOP: the bell record's corpus lists no ${preset} run, so there is no presetIdentity to check against`);

  const runs: { id: string; dir: string }[] = expected.map((r) => ({ id: r.id, dir: norm(byId.get(r.id)!.real!) }));
  const envelope = runs.map((_, i) => i);
  const corpusByReal = new Map<string, CorpusRun>();
  for (const c of input.corpus) if (c.real) corpusByReal.set(norm(c.real), c.run);
  const neutralIds = new Set(expected.map((r) => r.id));

  const seen = new Set<string>();
  const names = new Set<string>();
  const subjects: PlannedSubject[] = [];
  for (const s of input.subjects) {
    const real = norm(s.real);
    const m = s.manifest;
    if (m.spec.presetId !== preset) throw new Error(`${s.dir}: preset ${m.spec.presetId}, planned with ${preset}`);
    if (seen.has(real)) throw new Error(`${s.dir}: the same bundle is listed twice`);
    seen.add(real);
    if (m.presetIdentity !== identity) throw new Error(`STOP: ${s.dir}: presetIdentity ${m.presetIdentity}, but the bell record's corpus has ${identity} for ${preset}`);
    const corpusRun = corpusByReal.get(real) ?? null;
    if (corpusRun) {
      if (manifestId(m) !== corpusRun.id) throw new Error(`STOP: ${s.dir} is the corpus directory of ${corpusRun.id} but its manifest says ${manifestId(m)}`);
    } else if (neutralIds.has(manifestId(m))) {
      throw new Error(`STOP: ${s.dir} is not the corpus directory, but its manifest names the envelope run ${manifestId(m)}; it would be scored against its own copy`);
    }
    const id = corpusRun ? corpusRun.id : manifestId(m);
    const rd = corpusRun ? recordD(record, corpusRun.id) : null;
    if (corpusRun && rd === null) throw new Error(`STOP: ${corpusRun.id} is a corpus run but the bell record has no all-neutral D at W = ${NOTEBOOK_W} for it`);
    const member = !!corpusRun && neutralIds.has(corpusRun.id);
    const run = member ? expected.findIndex((r) => r.id === corpusRun!.id) : runs.push({ id: `${id} (${s.dir})`, dir: real }) - 1;
    const outName = id.replaceAll("/", "-");
    if (names.has(outName)) throw new Error(`STOP: two bundles would write ${outName}.html`);
    names.add(outName);
    subjects.push({
      ...s,
      real,
      id,
      corpusRun,
      run,
      member,
      calibration: member && corpusRun!.experiment === "replay-calib",
      recordD: rd,
      outName,
    });
  }
  return { preset, zStar, zRing: nextUp(zStar), runs, envelope, envelopeIds: expected.map((r) => r.id), subjects, presetIdentity: identity };
}

// ---------------------------------------------------------------------------------------------
// The z trace.

/**
 * One subject's per-census z, value, envelope median and spread for every signal, recomputed independently of BellScorer: at each
 * census the envelope values (the subject's own entry left out when it is a member) are sorted afresh and departure() is applied.
 * Fixed capacity (the manifests' census count); holds 4 x 13 numbers per census, no table.
 */
export class ZTrace {
  len = 0;
  readonly steps: Float64Array;
  readonly z: Float64Array;
  readonly x: Float64Array;
  readonly median: Float64Array;
  readonly spread: Float64Array;
  /** 1 where the signal is defined (rates need RATE_LAG earlier censuses). */
  readonly defined: Uint8Array;
  private ref: number[];
  constructor(readonly capacity: number, envelope: readonly number[], readonly self: number, readonly burnIn = BURN_IN_STEP) {
    this.ref = envelope.filter((r) => r !== self);
    if (!this.ref.length) throw new Error("ZTrace: no reference run left");
    this.steps = new Float64Array(capacity);
    this.z = new Float64Array(capacity * NS);
    this.x = new Float64Array(capacity * NS);
    this.median = new Float64Array(capacity * NS);
    this.spread = new Float64Array(capacity * NS);
    this.defined = new Uint8Array(capacity * NS);
  }
  /** One census: every run's signal vector (SignalExtractor output), indexed as plan.runs. */
  push(step: number, vectors: readonly (readonly (number | null)[])[]): void {
    if (this.len >= this.capacity) throw new Error(`ZTrace: more than ${this.capacity} censuses`);
    const i = this.len;
    this.steps[i] = step;
    const own = vectors[this.self];
    const vals: number[] = new Array(this.ref.length);
    for (let s = 0; s < NS; s++) {
      const k = i * NS + s;
      if (own[s] === null) {
        this.defined[k] = 0;
        continue;
      }
      for (let j = 0; j < this.ref.length; j++) {
        const v = vectors[this.ref[j]][s];
        if (typeof v !== "number" || !Number.isFinite(v)) throw new Error(`STOP: ZTrace: envelope run ${this.ref[j]} has ${SIGNALS[s].name} ${v} at step ${step}, not a finite number`);
        vals[j] = v;
      }
      vals.sort((a, b) => a - b);
      const xv = own[s] as number;
      if (!Number.isFinite(xv)) throw new Error(`STOP: ZTrace: the bundle has ${SIGNALS[s].name} ${xv} at step ${step}, not a finite number`);
      const d = departure(xv, vals, Infinity, SIGNALS[s].floor);
      if (!Number.isFinite(d.z) || !Number.isFinite(d.median) || !Number.isFinite(d.spread))
        throw new Error(`STOP: ZTrace: ${SIGNALS[s].name} at step ${step} gives z ${d.z}, median ${d.median}, spread ${d.spread}; the values are out of range for a finite score`);
      this.defined[k] = 1;
      this.x[k] = xv;
      this.z[k] = d.z;
      this.median[k] = d.median;
      this.spread[k] = d.spread;
    }
    this.len++;
  }
  /** Counted for windows: defined and at or after burn-in (the bell's rule; anything else resets a window). */
  counted(i: number, s: number): boolean {
    return this.defined[i * NS + s] === 1 && this.steps[i] >= this.burnIn;
  }
  sideZ(i: number, s: number, side: 0 | 1): number {
    return SIDES[side] * this.z[i * NS + s];
  }
}

export const signalIndex = (name: string): number => {
  const i = SIGNALS.findIndex((d) => d.name === name);
  if (i < 0) throw new Error(`unknown signal ${name}`);
  return i;
};
const sideIndex = (side: Side): 0 | 1 => (side === "high" ? 0 : 1);

/** D on (signal, side) at window W, recomputed from the trace the way BellScorer does: the largest counted window's smallest side·z, floored at 0. */
export function traceD(trace: ZTrace, s: number, side: 0 | 1, W: number = NOTEBOOK_W): number {
  const rm = new RollingMin(W);
  let len = 0, D = 0;
  for (let i = 0; i < trace.len; i++) {
    if (!trace.counted(i, s)) {
      rm.clear();
      len = 0;
      continue;
    }
    rm.push(i, trace.sideZ(i, s, side));
    len++;
    if (len < W) continue;
    const m = rm.min();
    if (m > D) D = m;
  }
  return D;
}

export interface Stretch {
  side: Side;
  startStep: number;
  endStep: number;
  /** Census indices, inclusive. */
  startIdx: number;
  endIdx: number;
  censuses: number;
  /** Smallest and largest side·z in the stretch. */
  minAbsZ: number;
  maxAbsZ: number;
  /** Still going at the last census of the run. */
  ongoing: boolean;
}
/** Every unbroken run of counted censuses with side·z >= zRing (that is, > Z*), at least W long. */
export function stretches(trace: ZTrace, s: number, side: 0 | 1, zRing: number, W: number = NOTEBOOK_W): Stretch[] {
  const out: Stretch[] = [];
  let start = -1, lo = Infinity, hi = -Infinity;
  const close = (end: number) => {
    if (start >= 0 && end - start + 1 >= W)
      out.push({ side: SIDE_NAMES[side], startStep: trace.steps[start], endStep: trace.steps[end], startIdx: start, endIdx: end, censuses: end - start + 1, minAbsZ: lo, maxAbsZ: hi, ongoing: end === trace.len - 1 });
    start = -1;
    lo = Infinity;
    hi = -Infinity;
  };
  for (let i = 0; i < trace.len; i++) {
    const v = trace.counted(i, s) ? trace.sideZ(i, s, side) : NaN;
    if (v >= zRing) {
      if (start < 0) start = i;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    } else close(i - 1);
  }
  close(trace.len - 1);
  return out;
}

/** The smallest side·z over censuses [from, from + W). */
export function windowMin(trace: ZTrace, s: number, side: 0 | 1, from: number, W: number = NOTEBOOK_W): number {
  let m = Infinity;
  for (let i = from; i < from + W; i++) m = Math.min(m, trace.sideZ(i, s, side));
  return m;
}

// ---------------------------------------------------------------------------------------------
// Cross-check.

export interface Ring {
  signal: string;
  side: Side;
  D: number;
  receipt: Receipt;
  stretches: Stretch[];
}
/**
 * Stops unless the trace reproduces the bell exactly, and returns the rings. `result` is the bell's ScoringResult for the subject
 * (W = [NOTEBOOK_W], Z = [zRing]); `recordD` the record's D when the subject is a corpus run.
 */
export function crossCheck(result: ScoringResult, trace: ZTrace, opts: { id: string; zStar: number; zRing: number; recordD: number | null }): Ring[] {
  const { id, zStar, zRing } = opts;
  const fail = (what: string) => {
    throw new Error(`STOP: ${id}: cross-check failed: ${what}`);
  };
  if (result.censuses !== trace.len) fail(`the bell read ${result.censuses} censuses, the trace ${trace.len}`);
  const bellD = (s: string, side: Side) => result.dBySignal.find((d) => d.signal === s && d.side === side && d.W === NOTEBOOK_W)?.D;
  let maxD = 0;
  const ringPairs: string[] = [];
  for (let s = 0; s < NS; s++) {
    for (const si of [0, 1] as const) {
      const name = SIGNALS[s].name, side = SIDE_NAMES[si];
      const b = bellD(name, side);
      const t = traceD(trace, s, si);
      if (b === undefined) fail(`the bell has no D for ${name} ${side} at W = ${NOTEBOOK_W}`);
      if (!Object.is(t, b)) fail(`D on ${name} ${side}: trace ${t}, bell ${b}`);
      if (t > maxD) maxD = t;
      if (t > zStar) ringPairs.push(`${name} ${side}`);
    }
  }
  const wi = 0;
  if (!Object.is(result.D[wi], maxD)) fail(`D: bell ${result.D[wi]}, largest of the 26 ${maxD}`);
  if (opts.recordD !== null && !Object.is(result.D[wi], opts.recordD)) fail(`record D mismatch: the bundle and envelope on disk give ${result.D[wi]}, the record says ${opts.recordD}`);
  const receipts = result.receipts.filter((r) => r.Z === zRing && r.W === NOTEBOOK_W);
  const receiptPairs = receipts.map((r) => `${r.signal} ${r.side}`);
  if ([...ringPairs].sort().join("|") !== [...receiptPairs].sort().join("|")) fail(`rings by D (${ringPairs.join(", ") || "none"}) differ from the bell's receipts (${receiptPairs.join(", ") || "none"})`);
  const rings: Ring[] = [];
  for (const r of receipts) {
    const s = signalIndex(r.signal), si = sideIndex(r.side);
    const st = stretches(trace, s, si, zRing);
    const pair = `${r.signal} ${r.side}`;
    if (!st.length) fail(`${pair}: the bell rang but the trace has no stretch`);
    const f = st[0];
    if (f.startStep !== r.startStep) fail(`${pair}: first stretch starts at step ${f.startStep}, the receipt at ${r.startStep}`);
    const endIdx = f.startIdx + NOTEBOOK_W - 1;
    if (trace.steps[endIdx] !== r.endStep) fail(`${pair}: window ends at step ${trace.steps[endIdx]}, the receipt at ${r.endStep}`);
    const m = windowMin(trace, s, si, f.startIdx);
    if (!Object.is(m, r.minAbsZ)) fail(`${pair}: window minimum ${m}, the receipt's ${r.minAbsZ}`);
    const k = f.startIdx * NS + s;
    if (!Object.is(trace.x[k], r.value)) fail(`${pair}: value ${trace.x[k]}, the receipt's ${r.value}`);
    if (!Object.is(trace.median[k], r.median)) fail(`${pair}: median ${trace.median[k]}, the receipt's ${r.median}`);
    rings.push({ signal: r.signal, side: r.side, D: bellD(r.signal, r.side)!, receipt: r, stretches: st });
  }
  return rings;
}

// ---------------------------------------------------------------------------------------------
// Words and numbers.

export type ValueFormat = "count" | "share" | "sig3";
export interface SignalText {
  name: string;
  label: string;
  meaning: string;
  high: string;
  low: string;
  format: ValueFormat;
  /** The code that computes it. */
  source: string;
}
/** The 13 fixed texts, in SIGNALS order. Each meaning was checked against its cited source. */
export const SIGNAL_TEXT: readonly SignalText[] = [
  { name: "livingCells", label: "Living cells", meaning: "Cells of the world that carry a lineage (a genome) at the census.", high: "More living cells", low: "Fewer living cells", format: "count", source: "packages/metrics/src/census.ts:73" },
  { name: "individuals", label: "Individuals", meaning: "Connected bodies of bound mass weighing at least 256, the census’s smallest individual.", high: "More individuals", low: "Fewer individuals", format: "count", source: "packages/metrics/src/census.ts:159; packages/runner/src/runner.ts:1226" },
  { name: "meanMass", label: "Mean body mass", meaning: "The average mass of those individuals.", high: "Heavier bodies", low: "Lighter bodies", format: "sig3", source: "packages/runner/src/runner.ts:1227" },
  { name: "lineages", label: "Lineages", meaning: "Distinct lineages among the living cells.", high: "More lineages", low: "Fewer lineages", format: "count", source: "packages/metrics/src/census.ts:72; packages/runner/src/runner.ts:1229" },
  { name: "lineageShannon", label: "Lineage diversity", meaning: "Shannon entropy, in bits, of the lineages weighted by their mass.", high: "Mass spread more evenly across lineages", low: "Mass held by fewer lineages", format: "sig3", source: "packages/runner/src/runner.ts:1220" },
  { name: "patternEntropy", label: "Pattern entropy", meaning: "Entropy, in bits, of the world’s 2×2 block pattern of cells holding bound mass.", high: "A more varied pattern of occupied blocks", low: "A more uniform pattern of occupied blocks", format: "sig3", source: "packages/metrics/src/complexity.ts:10, :25; packages/runner/src/runner.ts:1250" },
  { name: "bioticRecycling", label: "Biotic recycling", meaning: "The share of waste-to-nutrient recycling done by organisms rather than by photolysis.", high: "More of the recycling done by organisms", low: "Less of the recycling done by organisms", format: "share", source: "packages/metrics/src/ecology.ts:20" },
  { name: "maxGeneration", label: "Deepest generation", meaning: "The deepest generation among living individuals, as the tracker counts it: one more for each fission, and for each budding the observer attributes.", high: "Deeper generations alive", low: "Shallower generations alive", format: "count", source: "packages/metrics/src/tracker.ts:280, :135; packages/runner/src/observe.ts:111" },
  { name: "dominantShare", label: "Largest lineage’s share", meaning: "The largest lineage’s share of the living cells.", high: "One lineage holds more of the world", low: "The largest lineage holds less of the world", format: "share", source: "tools/lib/bell.ts:137" },
  { name: "fissions", label: "Fissions", meaning: "Bodies splitting into two or more, as the tracker counts them.", high: "More fissions", low: "Fewer fissions", format: "count", source: "packages/metrics/src/tracker.ts:139" },
  { name: "fusions", label: "Fusions", meaning: "Bodies merging into one, as the tracker counts them.", high: "More fusions", low: "Fewer fusions", format: "count", source: "packages/metrics/src/tracker.ts:154" },
  { name: "buddings", label: "Buddings", meaning: "Bodies the tracker saw appear with no predecessor that the observer credited to the nearest living body of the same lineage, not itself new at that census, whose centre was less than 24 cells away on the same tile. The credit is by nearness; where the matter came from is not measured.", high: "More buddings", low: "Fewer buddings", format: "count", source: "packages/metrics/src/tracker.ts:163, :286; packages/runner/src/observe.ts:98, :108" },
  { name: "mutations", label: "Mutations", meaning: "New genomes written by mutation.", high: "More mutations", low: "Fewer mutations", format: "count", source: "packages/runner/src/observe.ts:87" },
];
export const textOf = (name: string): SignalText => SIGNAL_TEXT[signalIndex(name)];

/** Whole number with comma grouping. */
export function group(n: number): string {
  const r = Math.round(n);
  const neg = r < 0;
  const s = String(Math.abs(r));
  let out = "";
  for (let i = 0; i < s.length; i++) {
    if (i > 0 && (s.length - i) % 3 === 0) out += ",";
    out += s[i];
  }
  return (neg ? "−" : "") + out;
}
/** A signal value in its fixed format: counts whole, shares as percentages, the rest to three significant figures. */
export function fmtValue(name: string, v: number): string {
  const f = textOf(name).format;
  if (f === "count") return group(v);
  if (f === "share") return `${Math.round(v * 100)}%`;
  if (v === 0) return "0";
  const r = Number(v.toPrecision(3));
  if (Math.abs(r) >= 100) return group(r);
  return (r < 0 ? "−" : "") + Math.abs(r).toPrecision(3);
}
export const fmtZ = (z: number): string => (z < 0 ? "−" : "") + Math.abs(z).toFixed(2);
/** "in the last n steps", n = RATE_LAG censuses at the run's cadence. */
export const rateWindow = (censusEvery: number): string => `in the last ${group(RATE_LAG * censusEvery)} steps`;
export const phrase = (name: string, side: Side, censusEvery: number): string => {
  const t = textOf(name);
  const p = side === "high" ? t.high : t.low;
  return SIGNALS[signalIndex(name)].kind === "rate" ? `${p} ${rateWindow(censusEvery)}` : p;
};

/**
 * The note's sentence for a ring: the value and median at the first stretch's first census (the receipt's, the same census), then
 * the stretch's length and its weakest |z| (over the whole stretch, not the receipt's window).
 */
export function noteSentence(name: string, side: Side, a: { value: number; median: number; censuses: number; startStep: number; endStep: number; minAbsZ: number; censusEvery: number }): string {
  return `${phrase(name, side, a.censusEvery)}: ${fmtValue(name, a.value)} at step ${group(a.startStep)}, against a neutral median there of ${fmtValue(name, a.median)}. Beyond Z* for ${group(a.censuses)} censuses in a row, from step ${group(a.startStep)} to step ${group(a.endStep)}; the weakest of them was ${fmtZ(a.minAbsZ)} spreads ${side === "high" ? "above" : "below"} the median.`;
}

// ---------------------------------------------------------------------------------------------
// The model.

export type Chip = "Measured" | "Negative" | "Unclear" | "Not yet measured";
export interface PictureBin {
  /** Census indices, inclusive. */
  from: number;
  to: number;
  lo: number;
  hi: number;
  median: number;
  bandLo: number;
  bandHi: number;
}
export interface RingNote {
  signal: string;
  label: string;
  side: Side;
  D: number;
  receipt: Receipt;
  stretches: Stretch[];
  sentence: string;
  /** Spread at the receipt window's first census. */
  spread: number;
  picture: PictureBin[];
}
export interface NotebookEntry {
  startStep: number;
  notes: RingNote[];
}
export interface QuietRow {
  signal: string;
  label: string;
  side: Side;
  D: number;
  /** Z* − D. */
  gap: number;
  rang: boolean;
}
export interface SourceFile {
  path: string;
  bytes: number;
}
export interface NotebookMeta {
  /** YYYY-MM-DD, passed in so the page is a pure function of its inputs. */
  generated: string;
  recordPath: string;
  recordSha256: string;
  /** The --base directory as named on the page. */
  base: string;
  /** The subject's three files. */
  sources: SourceFile[];
  /** The envelope's files (three per run). */
  envelopeSources: SourceFile[];
}
export interface NotebookModel {
  notebookVersion: number;
  bellVersion: number;
  notePath: string;
  meta: NotebookMeta;
  firstPage: {
    falseAlarms: { k: number; n: number; Z: number; W: number };
    heldOut: { k: number; of: number; expected: number };
    zStars: Record<string, number>;
    /** Calibration runs behind this preset's Z*. */
    calibRuns: number;
    /** Which signals the neutral runs rang on at the primary Z and W, from the record's rings. */
    falseAlarmSignals: { signal: string; label: string; side: Side; runs: number }[];
    /** The record's treatment and no-mutation runs that rang at the primary Z and W from the first counted census. */
    armsFromBurnIn: { k: number; of: number };
  };
  run: {
    id: string;
    experiment: string;
    preset: string;
    condition: string;
    seed: number;
    steps: number;
    censusEvery: number;
    censuses: number;
    presetIdentity: string;
    inCorpus: boolean;
    calibration: boolean;
    leftOut: boolean;
    /**
     * Set when a neutral run rang: "held-out" for one of the record's held-out neutral runs (so the ring is one of the record's false
     * alarms above Z*), "neutral" for a neutral run outside the corpus. Null otherwise.
     */
    falseAlarm: "held-out" | "neutral" | null;
    envelopeSize: number;
    envelopeIds: string[];
    zStar: number;
    W: number;
    burnInStep: number;
    D: number;
    recordD: number | null;
  };
  rings: number;
  entries: NotebookEntry[];
  quiet: QuietRow[];
  timeline: { signal: string; label: string; stretches: Stretch[] }[];
}

/** Columns of BIN censuses: the run's lowest and highest value, and the median and Z* band at the column's last defined census. */
export function pictureBins(trace: ZTrace, s: number, zStar: number, bin: number = BIN): PictureBin[] {
  const out: PictureBin[] = [];
  for (let from = 0; from < trace.len; from += bin) {
    const to = Math.min(trace.len, from + bin) - 1;
    let lo = Infinity, hi = -Infinity, last = -1;
    for (let i = from; i <= to; i++) {
      const k = i * NS + s;
      if (!trace.defined[k]) continue;
      const v = trace.x[k];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
      last = k;
    }
    if (last < 0) continue;
    const m = trace.median[last], sp = trace.spread[last];
    const bandLo = m - zStar * sp, bandHi = m + zStar * sp;
    if (!Number.isFinite(bandLo) || !Number.isFinite(bandHi)) throw new Error(`STOP: ${SIGNALS[s].name}: the Z* band at census ${Math.floor(last / NS)} is not finite (median ${m}, spread ${sp})`);
    out.push({ from, to, lo, hi, median: m, bandLo, bandHi });
  }
  return out;
}

export function buildNotebook(input: {
  plan: NotebookPlan;
  subject: PlannedSubject;
  result: ScoringResult;
  trace: ZTrace;
  rings: Ring[];
  record: BellRecord;
  meta: NotebookMeta;
}): NotebookModel {
  const { plan, subject, result, trace, rings, record, meta } = input;
  const spec = subject.manifest.spec;
  const notes: RingNote[] = rings.map((r) => {
    const s = signalIndex(r.signal);
    const f = r.stretches[0];
    return {
      signal: r.signal,
      label: textOf(r.signal).label,
      side: r.side,
      D: r.D,
      receipt: r.receipt,
      stretches: r.stretches,
      sentence: noteSentence(r.signal, r.side, { value: r.receipt.value, median: r.receipt.median, censuses: f.censuses, startStep: f.startStep, endStep: f.endStep, minAbsZ: f.minAbsZ, censusEvery: spec.censusEvery }),
      spread: trace.spread[f.startIdx * NS + s],
      picture: pictureBins(trace, s, plan.zStar),
    };
  });
  const starts = [...new Set(notes.map((n) => n.receipt.startStep))].sort((a, b) => a - b);
  const entries = starts.map((startStep) => ({ startStep, notes: notes.filter((n) => n.receipt.startStep === startStep).sort((a, b) => b.receipt.minAbsZ - a.receipt.minAbsZ || signalIndex(a.signal) - signalIndex(b.signal)) }));
  const rang = new Set(rings.map((r) => `${r.signal} ${r.side}`));
  const quiet: QuietRow[] = [];
  for (const d of SIGNALS)
    for (const side of SIDE_NAMES) {
      const D = result.dBySignal.find((x) => x.signal === d.name && x.side === side && x.W === NOTEBOOK_W)!.D;
      quiet.push({ signal: d.name, label: textOf(d.name).label, side, D, gap: plan.zStar - D, rang: rang.has(`${d.name} ${side}`) });
    }
  const timeline = SIGNALS.map((d) => ({ signal: d.name, label: textOf(d.name).label, stretches: rings.filter((r) => r.signal === d.name).flatMap((r) => r.stretches).sort((a, b) => a.startIdx - b.startIdx) }));
  const sec = record.summary.secondary;
  return {
    notebookVersion: NOTEBOOK_VERSION,
    bellVersion: BELL_VERSION,
    notePath: NOTE_PATH,
    meta,
    firstPage: {
      falseAlarms: { k: record.summary.criterion1.k, n: record.summary.criterion1.n, Z: record.parameters.primary.Z, W: record.parameters.primary.W },
      heldOut: { k: sec.heldOutNeutralTotal.k, of: sec.heldOutNeutralTotal.of, expected: sec.heldOutNeutralTotal.expected },
      zStars: Object.fromEntries(Object.entries(sec.perPreset).map(([p, v]) => [p, v.zStar])),
      calibRuns: sec.perPreset[plan.preset].calibRuns,
      falseAlarmSignals: falseAlarmSignals(record).map((f) => ({ ...f, label: textOf(f.signal).label })),
      armsFromBurnIn: armsFromBurnIn(record),
    },
    run: {
      id: subject.id,
      experiment: spec.experiment,
      preset: spec.presetId,
      condition: spec.condition,
      seed: spec.seed,
      steps: spec.steps,
      censusEvery: spec.censusEvery,
      censuses: trace.len,
      presetIdentity: subject.manifest.presetIdentity,
      inCorpus: !!subject.corpusRun,
      calibration: subject.calibration,
      leftOut: subject.member,
      falseAlarm: subject.manifest.cfg.neutral && rings.length > 0 && !subject.calibration ? (subject.corpusRun ? "held-out" : "neutral") : null,
      envelopeSize: plan.envelope.length - (subject.member ? 1 : 0),
      envelopeIds: plan.envelopeIds,
      zStar: plan.zStar,
      W: NOTEBOOK_W,
      burnInStep: trace.burnIn,
      D: result.D[0],
      recordD: subject.recordD,
    },
    rings: rings.length,
    entries,
    quiet,
    timeline,
  };
}
