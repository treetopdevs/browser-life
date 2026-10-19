// The naturalist's scorer for one live world (docs/naturalist-field-notes-v0-2026-10-18.md): the anomaly bell's arithmetic
// (tools/lib/bell.ts, imported and not edited) against a published neutral baseline instead of an envelope read in lockstep. Pure:
// no DOM, no fetch, no Deno, so vitest, the lab and the asset builder (tools/naturalist-envelope.ts) all run this one file.
//
// Why this is the bell's score bit for bit. For a world that is not one of the envelope's runs, BellScorer's z at a census is
// (x - median) / spread, with median and spread from departure() over the envelope's values there, all of them, none left out. The
// baseline holds exactly those two numbers per census and signal (`envelopeAt`, the same departure() on the same sorted values), so
// z = (x - median) / spread here is the same double. Windows are the bell's RollingMin with BellScorer's reset rules (before the
// burn-in, or a signal undefined at the census), and a receipt has the bell's shape and is taken at the same census.
import { BURN_IN_STEP, RollingMin, SIGNALS, departure, type Receipt } from "../../../tools/lib/bell.ts";
import { nextUp } from "../../../tools/lib/notebook.ts";

// ---------------------------------------------------------------------------------------------
// The census check of bell v1.

/**
 * `censusProblem` of tools/lib/bell1.ts (line 177), copied verbatim: that file cannot be imported here (the lab's typecheck holds
 * every imported file to noUnusedLocals, and it imports one name it does not use; it is not edited). tools/naturalist-envelope.ts
 * imports both and holds them equal on every census it reads, and apps/lab/test/naturalist.test.ts on fixed cases.
 */
export function censusProblem(rec: Record<string, unknown> & { step: number }, rows: readonly (readonly [string, number])[]): string | null {
  const lc = rec.livingCells, ln = rec.lineages;
  if (typeof lc !== "number" || !Number.isFinite(lc)) return `step ${rec.step}: livingCells is ${JSON.stringify(lc) ?? "missing"}, not a finite number`;
  if (typeof ln !== "number" || !Number.isFinite(ln)) return `step ${rec.step}: lineages is ${JSON.stringify(ln) ?? "missing"}, not a finite number`;
  let cells = 0;
  for (const [, c] of rows) cells += c;
  if (cells !== lc) return `step ${rec.step}: lineage rows sum to ${cells} cells but livingCells is ${lc}${rows.length ? "" : " (lineages.tsv truncated or short?)"}`;
  if (rows.length !== ln) return `step ${rec.step}: ${rows.length} lineage rows but lineages is ${ln}${rows.length ? "" : " (lineages.tsv truncated or short?)"}`;
  // Implied by the two checks above (no rows iff lineages is 0, and then livingCells is 0); kept so the note's wording is checked as written.
  if ((rows.length === 0) !== (lc === 0 && ln === 0)) return `step ${rec.step}: ${rows.length} lineage rows with livingCells ${lc} and lineages ${ln} (no rows only when both are 0)`;
  return null;
}

/** The first series field a signal is read from that is not a finite number, or null (the notebook's checkSignalCells, as a value). */
export function seriesCellProblem(rec: Record<string, unknown>): { field: string; value: unknown } | null {
  for (const d of SIGNALS) {
    if (d.source !== "series") continue;
    const v = rec[d.name];
    if (typeof v !== "number" || !Number.isFinite(v)) return { field: d.name, value: v };
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// The published baseline.

export type EnvelopeRule = "bell-v1-A" | "bell-v0-calibrated";
export interface BaselineRule {
  rule: EnvelopeRule;
  /** The asset's base name under /naturalist/. */
  file: string;
  /** The rule's signals, in the bell's order: a header must list exactly these. */
  signals: readonly string[];
  /** The rule's threshold: a header must carry exactly this (a header cannot loosen or tighten the rule). */
  threshold: { readonly Z: number; readonly strict: boolean };
  /** The number of neutral runs the envelope holds. */
  runs: number;
}
const ALL_SIGNALS = SIGNALS.map((d) => d.name);
/**
 * Which rule each preset is scored by (the rules note, "Which rule, per world"), fixed here and not read from the asset: v1 part A
 * for gradient-m3 (eleven signals, Z = 4 with the bell's >=), v0's calibrated Z* for spots-m3 (all thirteen, strictly above
 * 11.4665, experiments/naturalist/bell-v0.json summary.secondary.perPreset["spots-m3"].zStar; the asset builder stops unless the
 * record still says so).
 */
export const NATURALIST_BASELINES: Readonly<Record<string, BaselineRule>> = {
  "gradient-m3": { rule: "bell-v1-A", file: "envelope-gradient-m3-v1", signals: ALL_SIGNALS.filter((n) => n !== "maxGeneration" && n !== "dominantShare"), threshold: { Z: 4, strict: false }, runs: 40 },
  "spots-m3": { rule: "bell-v0-calibrated", file: "envelope-spots-m3-v0", signals: ALL_SIGNALS, threshold: { Z: 11.4665, strict: true }, runs: 30 },
};
export interface EnvelopeSignal {
  name: string;
  kind: "level" | "rate";
  floor: number;
  source: "series" | "lineages";
}
/** Counts the panel prints, each taken from a committed record by the asset builder. */
export interface EnvelopeNumbers {
  /** The rule's check on neutral runs it was not fixed on: v1's 70 fresh runs, or v0's 10 held-out runs above Z*. */
  nullCheck: { what: "fresh" | "held-out"; k: number; of: number; upper95: number | null };
  /** Full-rules (treatment) runs of the preset scored against this envelope; null when none was ever scored (not yet measured). */
  arms: { k: number; of: number; fromBurnIn: number; signal: string; side: "high" | "low"; endStep: number; lastEndStep: number } | null;
  /** v1 part B, the twin bell: wounds (L96) and feeds (F) heard, of 10 each, on the preset it was run on; null where it never ran. */
  twins: { preset: string; l96: { k: number; of: number }; f: { k: number; of: number } } | null;
  /** v0: the calibration runs behind Z*. */
  calibRuns: number | null;
  /** v0: the second largest calibration D at W = 50 (Z* is the largest). */
  calibSecond: number | null;
}
export interface EnvelopeHeader {
  kind: "naturalist-envelope";
  version: 0;
  preset: string;
  rule: EnvelopeRule;
  /** The preset's presetIdentity when the baseline was built (the records' corpus). */
  presetIdentity: string;
  ruleVersion: number;
  cadence: number;
  burnIn: number;
  horizon: number;
  /** horizon / cadence: censuses at steps cadence, 2 cadence, ..., horizon. */
  censuses: number;
  rateLag: number;
  W: number;
  /** The bell's threshold. strict: a ring needs side·z above Z (the bell's >= at nextUp(Z)), so an exact tie never rings. */
  threshold: { Z: number; strict: boolean };
  signals: EnvelopeSignal[];
  envelope: { id: string; runs: string[] };
  bin: { file: string; bytes: number; sha256: string; layout: string };
  records: { path: string; sha256: string }[];
  numbers: EnvelopeNumbers;
}

export const ENVELOPE_LAYOUT = "float64 little-endian, [census][signal][median, spread], census i at step (i + 1) * cadence; undefined (a rate before rateLag censuses) is NaN 0x7ff8000000000000";
/** The one NaN the baseline writes, so the bytes do not depend on which NaN a computation produced. */
const NAN_BITS = 0x7ff8000000000000n;

/** The baseline's doubles to bytes, explicitly little-endian, every NaN written as NAN_BITS. */
export function encodeEnvelope(data: Float64Array): Uint8Array {
  const out = new Uint8Array(data.length * 8);
  const dv = new DataView(out.buffer);
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    if (Number.isNaN(v)) dv.setBigUint64(i * 8, NAN_BITS, true);
    else dv.setFloat64(i * 8, v, true);
  }
  return out;
}
export function decodeEnvelope(bytes: Uint8Array): Float64Array {
  if (bytes.byteLength % 8 !== 0) throw new Error(`the baseline is ${bytes.byteLength} bytes, not a whole number of doubles`);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Float64Array(bytes.byteLength / 8);
  for (let i = 0; i < out.length; i++) out[i] = dv.getFloat64(i * 8, true);
  return out;
}

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/**
 * Why `h` is not a baseline the panel can score `preset` by with `rule`, or null. Checks its shape and that its signals, window,
 * burn-in, rate lag and floors are the bell's own (tools/lib/bell.ts), so a header cannot quietly change the rule. Identity and rule
 * version are checked against the world by the panel's match (`naturalist.ts`).
 */
export function headerProblem(h: unknown, preset: string, spec: BaselineRule): string | null {
  const rule = spec.rule;
  if (!isObj(h)) return "the baseline's header is not a JSON object";
  if (h.kind !== "naturalist-envelope" || h.version !== 0) return `the baseline's header is ${JSON.stringify(h.kind)} version ${JSON.stringify(h.version)}, not naturalist-envelope version 0`;
  if (h.preset !== preset) return `the baseline is for ${JSON.stringify(h.preset)}, not ${preset}`;
  if (h.rule !== rule) return `the baseline follows rule ${JSON.stringify(h.rule)}, not ${rule}`;
  if (typeof h.presetIdentity !== "string" || !isNum(h.ruleVersion)) return "the baseline's header has no presetIdentity or ruleVersion";
  for (const k of ["cadence", "burnIn", "horizon", "censuses", "rateLag", "W"] as const) if (!isNum(h[k]) || !Number.isInteger(h[k]) || (h[k] as number) <= 0) return `the baseline's ${k} is ${JSON.stringify(h[k])}`;
  const cadence = h.cadence as number, horizon = h.horizon as number;
  if (horizon % cadence !== 0 || h.censuses !== horizon / cadence) return `the baseline holds ${h.censuses} censuses, not ${horizon} / ${cadence}`;
  if (h.burnIn !== BURN_IN_STEP) return `the baseline's burn-in is ${h.burnIn}, the bell's is ${BURN_IN_STEP}`;
  if (h.rateLag !== 10) return `the baseline's rate lag is ${h.rateLag}, the bell's is 10`;
  const t = h.threshold;
  if (!isObj(t) || !isNum(t.Z) || !(t.Z > 0) || typeof t.strict !== "boolean") return "the baseline's threshold is not a positive Z with a strict flag";
  if (!Object.is(t.Z, spec.threshold.Z) || t.strict !== spec.threshold.strict) return `the baseline's threshold is ${t.strict ? "above" : "at least"} ${t.Z}, not ${rule}'s ${spec.threshold.strict ? "above" : "at least"} ${spec.threshold.Z}`;
  if (!Array.isArray(h.signals) || !h.signals.length) return "the baseline lists no signals";
  if ((h.signals as unknown[]).map((s) => (isObj(s) ? s.name : null)).join() !== spec.signals.join()) return `the baseline's signals are not ${rule}'s ${spec.signals.length}`;
  const seen = new Set<string>();
  let last = -1;
  for (const s of h.signals as unknown[]) {
    if (!isObj(s) || typeof s.name !== "string") return "a baseline signal has no name";
    const i = SIGNALS.findIndex((d) => d.name === s.name);
    if (i < 0) return `the baseline names a signal the bell does not have (${s.name})`;
    if (i <= last || seen.has(s.name)) return "the baseline's signals are not in the bell's order";
    last = i;
    seen.add(s.name);
    const d = SIGNALS[i];
    if (s.kind !== d.kind || s.floor !== d.floor || s.source !== d.source) return `the baseline's ${s.name} is not the bell's (kind, floor or source differ)`;
  }
  const b = h.bin;
  if (!isObj(b) || typeof b.file !== "string" || typeof b.sha256 !== "string" || !isNum(b.bytes)) return "the baseline's header has no bin file, size and SHA-256";
  if (b.bytes !== (h.censuses as number) * (h.signals as unknown[]).length * 2 * 8) return `the baseline's bin is ${b.bytes} bytes, not censuses × signals × 2 doubles`;
  if (b.layout !== ENVELOPE_LAYOUT) return "the baseline's layout is not the one this panel reads";
  if (!isObj(h.envelope) || !Array.isArray(h.envelope.runs) || !h.envelope.runs.length) return "the baseline names no envelope runs";
  if (h.envelope.runs.length !== spec.runs || new Set(h.envelope.runs).size !== spec.runs) return `the baseline is of ${h.envelope.runs.length} runs, not ${rule}'s ${spec.runs} distinct neutral runs`;
  if (!Array.isArray(h.records) || !isObj(h.numbers)) return "the baseline's header has no records or numbers";
  return null;
}

/**
 * The baseline at one census from its members' signal values (`values[member][signal]`, SignalExtractor output, in member order):
 * per signal, the median and spread departure() gives over all of them, or NaN for both when the signal is undefined there (a
 * rate before rateLag censuses, which is undefined for every run or none). `floors[s]` is the signal's floor.
 */
export function envelopeAt(values: readonly (readonly (number | null)[])[], floors: readonly number[]): { median: number[]; spread: number[] } {
  const median: number[] = [], spread: number[] = [];
  for (let s = 0; s < floors.length; s++) {
    const vals: number[] = [];
    let undef = 0;
    for (const v of values) {
      const x = v[s];
      if (x === null) undef++;
      else vals.push(x);
    }
    if (undef && undef !== values.length) throw new Error(`signal ${s} is undefined for ${undef} of ${values.length} members at one census`);
    if (undef || !vals.length) {
      median.push(NaN);
      spread.push(NaN);
      continue;
    }
    // Ascending, ties in member order: the order BellScorer sorts its reference values in.
    vals.sort((a, b) => a - b);
    const d = departure(0, vals, Infinity, floors[s]);
    median.push(d.median);
    spread.push(d.spread);
  }
  return { median, spread };
}

// ---------------------------------------------------------------------------------------------
// The live scorer.

const SIDES = [1, -1] as const;
const SIDE_NAMES = ["high", "low"] as const;
export type Side = (typeof SIDE_NAMES)[number];
/** History kept per signal for a receipt's first census (the bell keeps 256; W must be below it). */
const HIST = 256;

export interface Stretch {
  /** Censuses in a row, from the receipt's start, with side·z at or beyond the threshold (at least W). */
  censuses: number;
  /** Its last census so far. */
  endStep: number;
  /** Still beyond at the latest census read. */
  ongoing: boolean;
}
export interface LiveRing {
  signal: string;
  side: Side;
  /** D on this (signal, side) at the latest census read. */
  D: number;
  receipt: Receipt;
  /** The spread at the receipt's first census. */
  spread: number;
  stretch: Stretch;
}

class Track {
  len = 0;
  mins = [new RollingMin(1), new RollingMin(1)];
  D = [0, 0];
  first: (Receipt | undefined)[] = [undefined, undefined];
  firstSpread = [NaN, NaN];
  stretch: (Stretch | undefined)[] = [undefined, undefined];
  histStep = new Float64Array(HIST);
  histX = new Float64Array(HIST);
  histM = new Float64Array(HIST);
  histS = new Float64Array(HIST);
  constructor(W: number) {
    this.mins = [new RollingMin(W), new RollingMin(W)];
  }
  reset() {
    this.len = 0;
    for (const m of this.mins) m.clear();
    for (const st of this.stretch) if (st) st.ongoing = false;
  }
}

/**
 * One world's bell. `names` are the signals scored (a header's, in the bell's order); push one census at a time, in order, with
 * the world's values for those signals (null where undefined) and the baseline's median and spread for them at that census.
 * The caller stops pushing at the baseline's horizon. D, receipts and rings at any point are those of the censuses pushed so far.
 */
export class LiveBell {
  readonly threshold: number;
  private tracks: Track[];
  private n = 0;
  private lastStep = -Infinity;
  constructor(readonly names: readonly string[], threshold: { Z: number; strict: boolean }, readonly W: number, readonly burnIn: number = BURN_IN_STEP) {
    if (!(Number.isInteger(W) && W >= 1 && W < HIST)) throw new Error(`window length ${W} outside 1..${HIST - 1}`);
    for (const n of names) if (!SIGNALS.some((d) => d.name === n)) throw new Error(`unknown signal ${n}`);
    this.threshold = threshold.strict ? nextUp(threshold.Z) : threshold.Z;
    this.tracks = names.map(() => new Track(W));
  }
  get censuses(): number {
    return this.n;
  }
  push(step: number, x: readonly (number | null)[], median: ArrayLike<number>, spread: ArrayLike<number>): void {
    if (x.length !== this.names.length || median.length !== this.names.length || spread.length !== this.names.length) throw new Error(`LiveBell: ${x.length} values for ${this.names.length} signals`);
    if (!Number.isFinite(step) || !(step > this.lastStep)) throw new Error(`LiveBell: step ${step} does not follow step ${this.lastStep}`);
    const idx = this.n;
    const counted = step >= this.burnIn;
    for (let s = 0; s < this.names.length; s++) {
      const st = this.tracks[s];
      const xv = x[s], m = median[s], sp = spread[s];
      if (!counted || xv === null || Number.isNaN(m) || Number.isNaN(sp)) {
        st.reset();
        continue;
      }
      const z = (xv - m) / sp;
      st.len++;
      const h = idx % HIST;
      st.histStep[h] = step;
      st.histX[h] = xv;
      st.histM[h] = m;
      st.histS[h] = sp;
      for (let si = 0; si < 2; si++) {
        const v = SIDES[si] * z;
        const rm = st.mins[si];
        rm.push(idx, v);
        const stretch = st.stretch[si];
        if (stretch?.ongoing) {
          if (v >= this.threshold) {
            stretch.censuses++;
            stretch.endStep = step;
          } else stretch.ongoing = false;
        }
        if (st.len < this.W) continue;
        const mn = rm.min();
        if (mn > st.D[si]) st.D[si] = mn;
        if (st.first[si] || !(mn >= this.threshold)) continue;
        const sh = (idx - this.W + 1) % HIST;
        st.first[si] = { signal: this.names[s], side: SIDE_NAMES[si], Z: this.threshold, W: this.W, startStep: st.histStep[sh], endStep: step, minAbsZ: mn, value: st.histX[sh], median: st.histM[sh] };
        st.firstSpread[si] = st.histS[sh];
        st.stretch[si] = { censuses: this.W, endStep: step, ongoing: true };
      }
    }
    this.lastStep = step;
    this.n++;
  }
  /** D per (signal, side), in the bell's order: each signal high then low. */
  dBySignal(): { signal: string; side: Side; W: number; D: number }[] {
    const out: { signal: string; side: Side; W: number; D: number }[] = [];
    this.tracks.forEach((st, s) => {
      for (let si = 0; si < 2; si++) out.push({ signal: this.names[s], side: SIDE_NAMES[si], W: this.W, D: st.D[si] });
    });
    return out;
  }
  /** The largest D over every signal and side. */
  D(): number {
    let d = 0;
    for (const st of this.tracks) for (const v of st.D) if (v > d) d = v;
    return d;
  }
  /** Each (signal, side) that rang with its first window, in BellScorer's order: end step, signal (the bell's table), high before low. */
  receipts(): Receipt[] {
    return this.rings().map((r) => r.receipt);
  }
  rings(): LiveRing[] {
    const out: LiveRing[] = [];
    this.tracks.forEach((st, s) => {
      for (let si = 0; si < 2; si++) {
        const r = st.first[si];
        if (r) out.push({ signal: this.names[s], side: SIDE_NAMES[si], D: st.D[si], receipt: { ...r }, spread: st.firstSpread[si], stretch: { ...st.stretch[si]! } });
      }
    });
    const order = (n: string) => SIGNALS.findIndex((d) => d.name === n);
    return out.sort((a, b) => a.receipt.endStep - b.receipt.endStep || order(a.signal) - order(b.signal) || (a.side === b.side ? 0 : a.side === "high" ? -1 : 1));
  }
}

/** The signal values a header scores, picked by name from a SignalExtractor vector (SIGNALS order). */
export function pick(names: readonly string[], vector: readonly (number | null)[]): (number | null)[] {
  return names.map((n) => vector[SIGNALS.findIndex((d) => d.name === n)]);
}

/** The baseline's median and spread arrays at census index i (0-based; step (i + 1) * cadence). */
export function baselineAt(data: Float64Array, signals: number, i: number): { median: Float64Array; spread: Float64Array } {
  const median = new Float64Array(signals), spread = new Float64Array(signals);
  const o = i * signals * 2;
  for (let s = 0; s < signals; s++) {
    median[s] = data[o + s * 2];
    spread[s] = data[o + s * 2 + 1];
  }
  return { median, spread };
}
