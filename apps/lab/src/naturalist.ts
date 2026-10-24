// The Field notes panel's model (docs/naturalist-field-notes-v0-2026-10-18.md): which worlds the naturalist has a baseline for,
// the censuses it has read of the world on screen, and the notes those censuses give against the published baseline. No DOM, no
// fetch: the panel (naturalist-panel.ts) feeds it and draws `view()`. Every word it writes is fixed here or in the notebook's texts
// (tools/lib/notebook.ts); nothing calls a model.
import { PRESETS, presetConfig, presetIdentity, type InitParams, type WorldConfig } from "@bl/schema";
import { SIGNALS, SignalExtractor, corpusRuns, type Receipt } from "../../../tools/lib/bell.ts";
import { fmtValue, fmtZ, group, phrase, textOf } from "../../../tools/lib/notebook.ts";
import { LiveBell, NATURALIST_BASELINES, baselineAt, censusProblem, headerProblem, pick, seriesCellProblem, type EnvelopeHeader, type LiveRing, type Side } from "./naturalist-score.ts";
import { NATURALIST_CADENCE, NATURALIST_HORIZON, NATURALIST_PRESETS, firstIntervention, type SeriesFields } from "./naturalist-series.ts";
// Types only: naturalist-suggest.ts (which brings the proposer and @bl/runner with it) is loaded by the panel when a note is filed.
import type { SuggestWorld, Suggestion } from "./naturalist-suggest.ts";

/** The cadence, window, burn-in and horizon the rules note fixes for both presets (a header must say the same). */
export const CADENCE = NATURALIST_CADENCE;
export const HORIZON = NATURALIST_HORIZON;
export const W = 50;
export const BURN_IN = 10_000;
/** The first step a note can be filed at: the end of the first window that counts. */
export const FIRST_NOTE_STEP = BURN_IN + (W - 1) * CADENCE;

/** What the panel needs of a run manifest (a subset of protocol.ts RunManifest). */
export interface WorldManifest {
  runId: string;
  presetId: string;
  seed: number;
  cfg: WorldConfig;
  init: InitParams;
  ruleVersion: number;
  settings: { censusEvery: number };
  /** The history's logged interventions (only their steps are read). */
  interventions: readonly { step: number }[];
}
/** One census as the worker posts it (protocol.ts NaturalistMsg). */
export interface NaturalistCensus {
  world: number;
  runId: string;
  step: number;
  rec: SeriesFields;
  rows: [string, number][];
  /** The earliest step of any logged intervention (a wound, feed or drain), or null. */
  touched: number | null;
  /** Mutation events the ledger dropped at this census. */
  dropped: number;
}

// ---------------------------------------------------------------------------------------------
// Which worlds match.

export type Match = { kind: "match"; preset: string; neutral: boolean } | { kind: "none"; reason: string };

const presetName = (id: string) => PRESETS.find((p) => p.id === id)?.name ?? id;
const canon = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.map(canon);
  if (v !== null && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().filter((k) => (v as Record<string, unknown>)[k] !== undefined).map((k) => [k, canon((v as Record<string, unknown>)[k])]));
  return v;
};
const same = (a: unknown, b: unknown) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
/** The seeds of the envelope's runs of a preset (the bell corpus's neutral runs). */
const memberSeeds = (preset: string) => new Set(corpusRuns().filter((r) => r.preset === preset && r.condition === "neutral").map((r) => r.seed));

/**
 * Whether a loaded world is one the naturalist has a baseline for, before the baseline's header is read: the rules note's "When a
 * world matches". The header's identity and rule version are checked by `headerMismatch` once it arrives.
 */
export function matchWorld(m: WorldManifest): Match {
  const names = [...NATURALIST_PRESETS].map(presetName).join(" and ");
  if (m.presetId === "imported") return { kind: "none", reason: "This world was opened from a file, and its history before that is not known." };
  const spec = NATURALIST_BASELINES[m.presetId];
  const preset = PRESETS.find((p) => p.id === m.presetId);
  if (!spec || !preset || !NATURALIST_PRESETS.has(m.presetId)) return { kind: "none", reason: `So far it has baselines only for ${names}.` };
  const strip = (c: WorldConfig) => {
    const { seed: _s, neutral: _n, ...rest } = c;
    return rest;
  };
  const want = strip(presetConfig(preset, m.seed));
  const got = strip(m.cfg);
  if (!same(got, want)) {
    const keys = [...new Set([...Object.keys(got), ...Object.keys(want)])].sort();
    const k = keys.find((key) => !same((got as Record<string, unknown>)[key], (want as Record<string, unknown>)[key]));
    return { kind: "none", reason: `This world’s settings differ from ${presetName(m.presetId)} as planted${k ? ` (${k})` : ""}, and the baseline is of that world only.` };
  }
  if (!same(m.init, preset.init)) return { kind: "none", reason: `This world was not planted the way ${presetName(m.presetId)} is, and the baseline is of that world only.` };
  if (m.settings.censusEvery !== CADENCE) return { kind: "none", reason: `This world is counted every ${group(m.settings.censusEvery)} steps; the baseline is counted every ${CADENCE}.` };
  if (m.cfg.seed !== m.seed) return { kind: "none", reason: `This world’s physics runs on seed ${m.cfg.seed}, not the seed ${m.seed} it is listed under.` };
  const neutral = m.cfg.neutral === true;
  if (neutral && memberSeeds(m.presetId).has(m.seed)) return { kind: "none", reason: `This neutral world is seed ${m.seed}, one of the runs the baseline is made of, so it cannot be held against it.` };
  return { kind: "match", preset: m.presetId, neutral };
}

/** Why the baseline cannot score this world even though the preset matches, or null. */
export function headerMismatch(m: WorldManifest, h: EnvelopeHeader): string | null {
  const spec = NATURALIST_BASELINES[m.presetId];
  const p = headerProblem(h, m.presetId, spec);
  if (p) return `The baseline did not check out (${p}).`;
  if (h.cadence !== CADENCE || h.W !== W || h.horizon !== HORIZON || h.burnIn !== BURN_IN) return "The baseline is not counted the way this panel reads it.";
  const preset = PRESETS.find((x) => x.id === m.presetId)!;
  if (h.presetIdentity !== presetIdentity(preset)) return `${presetName(m.presetId)} has changed since its baseline was built, so the baseline describes another world.`;
  if (h.ruleVersion !== m.ruleVersion) return `This world runs rules v${m.ruleVersion}; the baseline was built under rules v${h.ruleVersion}.`;
  return null;
}

/**
 * The planting a run id descends from: a lab run id is `<preset>-s<seed>-<time>`, and every fork (a jump, or a restore of an
 * earlier checkpoint: sim.worker.ts forkRunId) appends `-b<time>`. Histories with one root share their start; with the same logged
 * interventions they are the same history (the lab's physics is deterministic).
 */
export function rootOf(runId: string): string {
  let r = runId;
  for (let m: RegExpExecArray | null; (m = /^(.*)-b[0-9a-z]+$/.exec(r)) && /-s-?\d+-[0-9a-z]+(?:-b[0-9a-z]+)*$/.test(m[1]); ) r = m[1];
  return r;
}

// ---------------------------------------------------------------------------------------------
// The model.

export type Asset = { kind: "loading" } | { kind: "ready"; header: EnvelopeHeader; data: Float64Array } | { kind: "failed"; reason: string };
export type Chip = "Measured" | "Unclear" | "Not yet measured";
export type PanelState = "none" | "no-baseline" | "loading" | "unavailable" | "late" | "listening" | "quiet" | "rings" | "touched" | "stopped" | "ended";

/** A note's identity: the world's generation and run id, its (signal, side), and its receipt's last census. */
export const noteKey = (gen: number, runId: string, r: { signal: string; side: Side; receipt: { endStep: number } }): string => `${gen}:${runId}:${r.signal}:${r.side}:${r.receipt.endStep}`;

/** One hand edit, as the lab's Wound or Feed/Drain sends it. */
export type HandEntry = { kind: "lesion"; x: number; y: number; r: number } | { kind: "feed"; x: number; y: number; r: number; amount: number };
export type Suggester = (ring: LiveRing, world: SuggestWorld, header: EnvelopeHeader) => Suggestion;

/** Whether "Try it here" is offered for a suggestion, and the lines said beside it. */
export interface Offer {
  state: "offered" | "stale" | "sent" | "unknown" | "tried" | "tried-other" | "failed" | "touched" | "loading" | "refused-spec" | "control";
  /** The button's words when offered, else null. */
  button: string | null;
  lines: string[];
}
export type SuggestionView =
  | { kind: "pending"; text: string }
  | { kind: "failed"; text: string }
  | { kind: "ready"; s: Suggestion; offer: Offer; sameAs: string | null; bench: Standing; before: string };

export interface NoteView {
  /** noteKey: one note of one world. */
  key: string;
  signal: string;
  label: string;
  side: Side;
  chips: Chip[];
  sentence: string;
  stretch: string;
  /** The receipt in numbers: census steps, signal, value against the envelope. */
  receipt: Receipt & { spread: number };
  receiptLine: string;
  /** Set when the world was changed by hand after this note was filed: the step of the change. */
  filedBefore: number | null;
  /** The proposer's suggestion for it (null on a world the suggestions do not cover). */
  suggestion: SuggestionView | null;
}
export interface Standing {
  text: string;
  /** How sure it is, in DESIGN.md's words; null for a plain fact about this world's settings. */
  chip: Chip | null;
}
export interface RuleView {
  name: string;
  threshold: string;
  records: { path: string; sha256: string }[];
  baseline: { file: string; sha256: string; runs: number };
}
export interface NaturalistView {
  state: PanelState;
  badge: string;
  status: string;
  /** A second line under the status (why there is no baseline, what stopped the reading). */
  detail: string | null;
  notes: NoteView[];
  filing: string | null;
  standing: Standing[];
  cannot: string[];
  rule: RuleView | null;
  /** The last census step read, or null. */
  readTo: number | null;
  /** How far it has read, in words (kept out of `status`, which is a live region and changes only with the state). */
  readLine: string | null;
  /** With no note once a note could have come: the notebook's no-ring hedge (its D, Measured; "nothing is going on", Not yet measured). */
  hedge: Standing[];
}

interface Stop {
  /** The census at which reading stopped (it was not read). */
  at: number;
  kind: "touched" | "problem" | "gap" | "dropped";
  /** For "touched": the step of the change. */
  step: number;
  reason: string;
}
interface Store {
  runId: string;
  preset: string;
  /** Watched from its first census; otherwise the panel reads nothing of it. */
  fromStart: boolean;
  watchFrom: number;
  recs: SeriesFields[];
  vectors: (number | null)[][];
  extractor: SignalExtractor;
  stop: Stop | null;
  /** A census past the horizon arrived. */
  ended: boolean;
  /** A change by hand at this step, said before the census that will stop the reading arrives (`onTouched`), or null. */
  touchedAt: number | null;
}

/** A Try sent for the world on screen: its note, and whether the lab has logged it (the step) or refused it (why). */
interface Tried {
  id: number;
  gen: number;
  runId: string;
  key: string;
  state: "sent" | "landed" | "refused" | "unknown";
  step: number | null;
  reason: string | null;
}
export type TryResult = { ok: true; entries: HandEntry[] } | { ok: false; reason: string };

export interface ModelDeps {
  /**
   * Applies a suggestion's entries as ordinary hand edits (main.ts's Wound and Feed/Drain messages) to world `world`, the generation
   * the suggestion was made for: the worker refuses them for any other world. Called only by `tryHere`.
   */
  apply?: (entries: HandEntry[], world: number, id: number) => void;
  /** A world is being planted, restored or opened. */
  loading?: () => boolean;
}

export class NaturalistModel {
  private gen: number | null = null;
  private manifest: WorldManifest | null = null;
  private match: Match | null = null;
  private store: Store | null = null;
  private assets = new Map<string, Asset>();
  private bell: LiveBell | null = null;
  private header: EnvelopeHeader | null = null;
  private data: Float64Array | null = null;
  /** The world on screen failed and sends no more censuses (cleared by the next load). */
  private failed = false;
  /** What stopped it: the world's own failure, or an error the lab's worker did not handle (which may leave the world running). */
  private failedBy: "world" | "worker" = "world";

  private suggester: { kind: "none" } | { kind: "ready"; fn: Suggester } | { kind: "failed"; reason: string } = { kind: "none" };
  /** Per note: its suggestion, or why the proposer's rules threw for it. */
  private suggestions = new Map<string, Suggestion | { threw: string }>();
  private tried: Tried | null = null;
  private nextTryId = 0;
  /** The earliest change by hand the page has heard of on the world on screen (its log, `onTouched`, a census), even after reading stopped. */
  private handAt: number | null = null;

  /** `request(preset)`: fetch that preset's baseline (called once per preset, on the first matching world). */
  constructor(private readonly request: (preset: string) => void, private readonly deps: ModelDeps = {}) {}

  /** The proposer's rules, once the panel has loaded them (naturalist-suggest.ts `suggestFor`), or why they did not load. */
  setSuggester(s: Suggester | { failed: string }): void {
    this.suggester = typeof s === "function" ? { kind: "ready", fn: s } : { kind: "failed", reason: s.failed };
    this.suggestions.clear();
  }
  /** Whether a note is filed and the proposer's rules have not been asked for yet. */
  wantsSuggester(): boolean {
    return this.suggester.kind === "none" && this.rings().length > 0 && this.match?.kind === "match" && this.header !== null;
  }

  onLoaded(manifest: WorldManifest, step: number, world: number): void {
    this.gen = world;
    this.tried = null;
    this.handAt = firstIntervention(manifest.interventions);
    this.suggestions.clear();
    this.manifest = manifest;
    this.failed = false;
    this.failedBy = "world";
    this.bell = null;
    this.header = null;
    this.data = null;
    const match = matchWorld(manifest);
    this.match = match;
    if (match.kind === "none") {
      this.store = null;
      return;
    }
    const prev = this.store;
    if (!prev || !this.continues(prev, manifest, match.preset, step)) {
      this.store = { runId: manifest.runId, preset: match.preset, fromStart: step === 0, watchFrom: step, recs: [], vectors: [], extractor: new SignalExtractor(), stop: null, ended: false, touchedAt: null };
    }
    const asset = this.assets.get(match.preset);
    // A baseline that failed to load is asked for again by the next world that matches (a passing network failure is not for the page's life).
    if (!asset || asset.kind === "failed") {
      this.assets.set(match.preset, { kind: "loading" });
      this.request(match.preset);
    } else this.adoptAsset();
  }

  /**
   * Whether the world loaded at `step` continues the history the store has read (a restore or a jump inside the page), and if so
   * rewinds the store to what the two share. Same planting (`rootOf`), and only censuses the loaded history's own log allows: those up
   * to its first intervention, which come before any change by hand in either history. Past what the store has read, it continues
   * only where reading had stopped for good in that shared stretch (a census that did not hold together, lost records, the horizon,
   * or the same first change by hand). Anything else is another history, read afresh.
   */
  private continues(s: Store, m: WorldManifest, preset: string, step: number): boolean {
    if (s.preset !== preset || !s.fromStart || rootOf(m.runId) !== rootOf(s.runId)) return false;
    const first = firstIntervention(m.interventions);
    const limit = Math.min(step, first ?? Infinity);
    const last = s.recs.length ? s.recs[s.recs.length - 1].step : 0;
    // A census the store has not read lies at or before `limit` only from last + CADENCE on; short of it the two share every census.
    if (limit >= last + CADENCE) {
      const stopped =
        (s.ended && limit > HORIZON) ||
        (s.stop !== null && s.stop.kind !== "touched" && limit >= s.stop.at) ||
        (s.stop !== null && s.stop.kind === "touched" && first !== null && first === s.stop.step);
      if (!stopped) return false;
    } else {
      const keep = s.recs.filter((r) => r.step <= limit).length;
      s.recs.length = keep;
      s.vectors.length = keep;
      s.extractor = new SignalExtractor();
      for (const r of s.recs) s.extractor.push(r as unknown as Record<string, unknown>, []);
      if (s.stop && s.stop.at > limit) s.stop = null;
      if (s.ended && limit <= HORIZON) s.ended = false;
      // The loaded history was changed by hand before the step it is at: nothing past the change is read.
      if (first !== null && first < step && !s.stop) {
        const at = s.recs.length ? s.recs[s.recs.length - 1].step + CADENCE : CADENCE;
        s.stop = { at, kind: "touched", step: first, reason: `the world was changed by hand at step ${group(first)}` };
      }
    }
    s.touchedAt = null;
    // Changed by hand at the very step it was saved at (after that step's census): marked at once, as a live change is.
    if (first !== null && first === step && !s.stop) s.touchedAt = first;
    s.runId = m.runId;
    return true;
  }

  /** A change by hand logged while the world is paused (the worker says so at once): notes filed so far are marked before the next census stops the reading. */
  onTouched(world: number, runId: string, step: number, id?: number): void {
    // Every touch stops baseline reading, but only this request's receipt can settle a Try.
    const t = this.tried;
    if (t && t.id === id && t.gen === this.gen && t.gen === world && t.runId === runId && (t.state === "sent" || t.state === "unknown")) {
      t.state = "landed";
      t.step = step;
      t.reason = null;
    }
    if (world === this.gen && this.store?.runId === runId && (this.handAt === null || step < this.handAt)) this.handAt = step;
    const s = this.store;
    if (world !== this.gen || !s || s.runId !== runId || s.stop) return;
    if (s.touchedAt === null || step < s.touchedAt) s.touchedAt = step;
  }

  /**
   * The world on screen failed (the page's fatal error), or the lab's worker reported an error it did not handle (`"worker"`: the
   * world may run on, but its censuses are no longer vouched for): reading stops where it is; notes filed so far stay. A later
   * load reads again. A world's own failure is the one named when both arrive.
   */
  onFailed(by: "world" | "worker" = "world"): void {
    if (!this.manifest) return;
    if (!this.failed || by === "world") this.failedBy = by;
    this.failed = true;
  }

  setAsset(preset: string, asset: Asset): void {
    this.assets.set(preset, asset);
    if (this.match?.kind === "match" && this.match.preset === preset) this.adoptAsset();
  }

  private adoptAsset(): void {
    const m = this.match;
    if (m?.kind !== "match") return;
    const a = this.assets.get(m.preset);
    if (a?.kind !== "ready") return;
    const why = headerMismatch(this.manifest!, a.header);
    if (why) {
      this.match = { kind: "none", reason: why };
      this.store = null;
      return;
    }
    this.header = a.header;
    this.data = a.data;
    this.rescore();
  }

  private rescore(): void {
    const h = this.header, s = this.store;
    if (!h || !this.data || !s) {
      this.bell = null;
      return;
    }
    this.bell = new LiveBell(h.signals.map((x) => x.name), h.threshold, h.W, h.burnIn);
    for (let i = 0; i < s.vectors.length; i++) this.pushBell(i);
  }

  private pushBell(i: number): void {
    const h = this.header!, s = this.store!;
    const names = h.signals.map((x) => x.name);
    const b = baselineAt(this.data!, names.length, i);
    this.bell!.push(s.recs[i].step, pick(names, s.vectors[i]), b.median, b.spread);
  }

  onCensus(msg: NaturalistCensus): void {
    if (msg.world === this.gen && msg.touched !== null && this.store?.runId === msg.runId && (this.handAt === null || msg.touched < this.handAt)) this.handAt = msg.touched;
    if (msg.world !== this.gen || this.failed) return;
    const s = this.store;
    if (!s || msg.runId !== s.runId || !s.fromStart || s.stop || s.ended) return;
    if (msg.step % CADENCE !== 0) {
      s.stop = { at: msg.step, kind: "gap", step: msg.step, reason: `the census at step ${group(msg.step)} is not on the baseline’s grid of one every ${CADENCE} steps` };
      return;
    }
    const want = (s.recs.length + 1) * CADENCE;
    if (msg.step < want) return;
    if (msg.step > want) {
      s.stop = { at: msg.step, kind: "gap", step: want, reason: `the census at step ${group(want)} never reached the panel` };
      return;
    }
    if (msg.touched !== null && msg.touched < msg.step) {
      s.stop = { at: msg.step, kind: "touched", step: msg.touched, reason: `the world was changed by hand at step ${group(msg.touched)}` };
      return;
    }
    if (msg.dropped > 0) {
      s.stop = { at: msg.step, kind: "dropped", step: msg.step, reason: `the lab lost ${group(msg.dropped)} mutation records at step ${group(msg.step)}, so its counts are not the ones the baseline was counted with` };
      return;
    }
    if (msg.step > HORIZON) {
      s.ended = true;
      return;
    }
    const rec = msg.rec as unknown as Record<string, unknown> & { step: number };
    const problem = censusProblem(rec, msg.rows);
    if (problem) {
      s.stop = { at: msg.step, kind: "problem", step: msg.step, reason: `the census does not hold together (${problem})` };
      return;
    }
    const cell = seriesCellProblem(rec);
    if (cell) {
      s.stop = { at: msg.step, kind: "problem", step: msg.step, reason: `${textOf(cell.field).label.toLowerCase()} was ${typeof cell.value === "number" ? String(cell.value) : (JSON.stringify(cell.value) ?? "missing")} at step ${group(msg.step)}, not a measured number` };
      return;
    }
    s.recs.push({ ...msg.rec });
    s.vectors.push(s.extractor.push(rec, msg.rows));
    if (this.bell) this.pushBell(s.vectors.length - 1);
  }

  /** Only a matching request's definite refusal permits a retry. */
  onApplyRefused(reason: string, id?: number): void {
    const t = this.tried;
    if (!t || t.id !== id || t.gen !== this.gen || t.runId !== this.store?.runId || (t.state !== "sent" && t.state !== "unknown")) return;
    t.state = "refused";
    t.reason = reason;
  }

  /** Unattributed worker errors leave the outcome unknown; a matching receipt may still arrive. */
  onApplyUncertain(reason: string): void {
    const t = this.tried;
    if (!t || t.gen !== this.gen || t.state !== "sent") return;
    t.state = "unknown";
    t.reason = reason;
  }

  /** The world a suggestion is made for: the one on screen. */
  private suggestWorld(): SuggestWorld | null {
    const m = this.manifest, s = this.store;
    if (!m || !s || this.gen === null || this.match?.kind !== "match") return null;
    return { gen: this.gen, runId: s.runId, presetId: m.presetId, seed: m.seed, cfg: m.cfg, neutral: this.match.neutral };
  }

  /**
   * The suggestion for a filed ring, computed once per note (validating a feed builds the start world), or why the proposer's
   * rules threw for it (an unknown signal or preset): that note then says so, and the rest of the panel still draws.
   */
  private suggestionOf(r: LiveRing): Suggestion | { threw: string } | null {
    const w = this.suggestWorld();
    if (this.suggester.kind !== "ready" || !w || !this.header) return null;
    const key = noteKey(w.gen, w.runId, r);
    let sug = this.suggestions.get(key);
    if (!sug) {
      try {
        sug = this.suggester.fn(r, w, this.header);
      } catch (e) {
        sug = { threw: e instanceof Error ? e.message : String(e) };
      }
      this.suggestions.set(key, sug);
    }
    return sug;
  }

  /** Whether Try it here is offered for `sug` now, and why not. Checked when drawn and again on the click. */
  private offerFor(sug: Suggestion): Offer {
    const s = this.store;
    const none = (state: Offer["state"], ...lines: string[]): Offer => ({ state, button: null, lines });
    if (!s || sug.gen !== this.gen || sug.runId !== s.runId) return none("stale", "This suggestion was made for a world that is no longer on screen, so nothing is applied from it.");
    const lines: string[] = [];
    const t = this.tried?.gen === this.gen && this.tried.runId === s.runId ? this.tried : null;
    if (t && t.key === sug.key && t.state === "sent") return none("sent", "Sent to the lab: waiting for it to log the change.");
    if (t && t.key === sug.key && t.state === "unknown") return none("unknown", `The lab reported an error before it logged the change (${t.reason}). Whether it was applied is not known, so nothing more is offered on this world.`);
    if (t && t.key === sug.key && t.state === "landed") {
      const at = t.step ?? sug.S;
      return none(
        "tried",
        `Tried here at step ${group(at)}${at !== sug.S ? `, not step ${group(sug.S)}` : ""}: one ${sug.action === "lesion" ? "wound" : sug.action} logged as a change by hand. The naturalist stopped reading, so it will not say whether the prediction held in this world; that is decided only offline, between the source and fork runs.`,
      );
    }
    if (t && t.key !== sug.key && t.state !== "refused") return none("tried-other", "Another suggestion was tried on this world, so this one is not offered here.");
    if (t && t.key === sug.key && t.state === "refused") lines.push(`The lab did not apply it: ${t.reason}.`);
    if (this.failed) return none("failed", ...lines, "The world stopped, so nothing can be applied to it.");
    const touched = s.stop?.kind === "touched" ? s.stop.step : (s.touchedAt ?? this.handAt);
    if (touched !== null) return none("touched", ...lines, `The world was changed by hand at step ${group(touched)}, so this is not offered here any more: the naturalist reads no world after a change by hand.`);
    if (this.deps.loading?.()) return none("loading", ...lines, "A world is being planted, restored or opened, so nothing is applied now.");
    if (sug.refused) return none("refused-spec", ...lines, `The proposer's validators refuse this run (${sug.refused}), so there is nothing to try.`);
    if (sug.action === "control" || !sug.tryLabel || !sug.entries.length) return none("control", ...lines, "A replay control has nothing to apply here: it is an offline check that a second run of this world replays the first, with the commands below.");
    if (sug.entries.length !== 1 || !["lesion", "feed"].includes(sug.entries[0].kind)) return none("refused-spec", ...lines, "Try it here supports exactly one wound, feed or drain. Run this suggestion offline instead.");
    return { state: "offered", button: sug.tryLabel, lines };
  }

  /**
   * A person clicked Try it here on note `key`. Everything is checked again; if it is still offered, the world is marked tried at
   * once (a second click applies nothing) and `apply` is called exactly once with the suggestion's entries, never anything else.
   */
  tryHere(key: string): TryResult {
    // A refusal changes nothing: the panel redraws, and the offer says why.
    const refuse = (reason: string): TryResult => ({ ok: false, reason });
    const ring = this.gen !== null && this.store ? this.rings().find((r) => noteKey(this.gen!, this.store!.runId, r) === key) : undefined;
    if (!ring) return { ok: false, reason: "This suggestion was made for a world that is no longer on screen, so nothing is applied from it." };
    const sug = this.suggestionOf(ring);
    if (!sug) return refuse("The proposer's rules have not loaded, so there is nothing to try.");
    if ("threw" in sug) return refuse(`The proposer's rules failed for this note (${sug.threw}), so there is nothing to try.`);
    const offer = this.offerFor(sug);
    if (offer.state !== "offered") return refuse(offer.lines[offer.lines.length - 1]);
    this.tried = { id: ++this.nextTryId, gen: sug.gen, runId: sug.runId, key, state: "sent", step: null, reason: null };
    const entries: HandEntry[] = sug.entries.flatMap((e): HandEntry[] => (e.kind === "lesion" ? [{ kind: "lesion", x: e.x, y: e.y, r: e.r }] : e.kind === "feed" ? [{ kind: "feed", x: e.x, y: e.y, r: e.r, amount: e.amount }] : []));
    this.deps.apply?.(entries, sug.gen, this.tried.id);
    return { ok: true, entries };
  }

  /** The suggestion view for each note, with "same run as" between notes whose fork specs are one. */
  private suggestionViews(rings: LiveRing[]): (SuggestionView | null)[] {
    if (this.suggester.kind === "failed") {
      const text = `The proposer's rules did not load (${this.suggester.reason}), so no suggestion is shown and nothing can be tried.`;
      return rings.map(() => ({ kind: "failed", text }));
    }
    if (this.suggester.kind === "none") return rings.map(() => ({ kind: "pending", text: "Working out the proposer's suggestion…" }));
    const sugs = rings.map((r) => this.suggestionOf(r));
    return sugs.map((s): SuggestionView | null => {
      if (!s) return null;
      if ("threw" in s) return { kind: "failed", text: `The proposer's rules failed for this note (${s.threw}), so no suggestion is shown for it and nothing can be tried.` };
      const same = sugs.filter((o): o is Suggestion => o !== null && !("threw" in o) && o !== s && o.specHash === s.specHash).map((o) => `${o.label.toLowerCase()} (${o.side})`);
      return {
        kind: "ready",
        s,
        offer: this.offerFor(s),
        sameAs: same.length ? `The same run as the suggestion for ${same.join(" and ")}: one fork answers both, each with its own prediction.` : null,
        bench: { text: "Whether these rules make good experiments, or beat a random intervention: that is the bench's question (docs/naturalist-bench-v0-2026-10-18.md), and the bench has not run. This suggestion carries no score.", chip: "Not yet measured" },
        before:
          "Try it here is a change by hand like any wound or feed, made only when you click: it lands at the step the world is on then, not at the suggested step, on a world with no untouched twin, and it is logged and counted like a brush stroke (saved only when the world is saved). It is not the proposal's fork. The naturalist stops reading at the next census, so it will not say here whether the prediction held.",
      };
    });
  }

  /** The rings so far, filed: by the receipt's first step, then by its smallest |z|, largest first, then the signal table. */
  rings(): LiveRing[] {
    if (!this.bell) return [];
    const order = (n: string) => SIGNALS.findIndex((d) => d.name === n);
    return this.bell.rings().sort((a, b) => a.receipt.startStep - b.receipt.startStep || b.receipt.minAbsZ - a.receipt.minAbsZ || order(a.signal) - order(b.signal) || (a.side === "high" ? -1 : 1));
  }

  view(): NaturalistView {
    const base = { notes: [], filing: null, standing: [], cannot: [], rule: null, readTo: null, readLine: null, detail: null, hedge: [] };
    if (!this.manifest || !this.match) return { ...base, state: "none", badge: "waiting", status: "Waiting for a world." };
    if (this.match.kind === "none") return { ...base, state: "no-baseline", badge: "no baseline", status: "The naturalist has no baseline for this world yet.", detail: this.match.reason, cannot: CANNOT_GENERAL };
    const preset = this.match.preset;
    const asset = this.assets.get(preset);
    if (!asset || asset.kind === "loading") return { ...base, state: "loading", badge: "loading", status: "Fetching the neutral baseline for this world…" };
    if (asset.kind === "failed") return { ...base, state: "unavailable", badge: "no baseline", status: "The baseline did not load, so the naturalist will not ring for this world.", detail: asset.reason, cannot: CANNOT_GENERAL };
    const h = this.header!, s = this.store!;
    const standing = standingFor(h, this.match.neutral);
    const cannot = cannotFor(h);
    const rule = ruleFor(h);
    if (!s.fromStart)
      return { ...base, state: "late", badge: "not reading", status: `Watching since t=${group(s.watchFrom)}.`, detail: "The naturalist reads a world only with every census from its first, so it says nothing about this one. Plant it again to watch it from the start.", standing, cannot, rule };
    const readTo = s.recs.length ? s.recs[s.recs.length - 1].step : null;
    const touched = s.stop?.kind === "touched" ? s.stop.step : s.touchedAt;
    const reading = !s.stop && s.touchedAt === null && !s.ended && !this.failed;
    const rings = this.rings();
    const sv = this.suggestionViews(rings);
    const notes = rings.map((r, i) => noteView(r, h, touched, reading, noteKey(this.gen!, s.runId, r), sv[i]));
    const filing = notes.length ? `Filed by the step where its first ${group(h.W)} censuses in a row beyond the threshold begin, counted from step ${group(h.burnIn)}. That step is not an onset, and notes filed together are not said to cause one another.` : null;
    const readLine = readTo === null ? "Nothing read yet." : `Read to t=${group(readTo)}, every census from the first.`;
    let state: PanelState, badge: string, status: string, detail: string | null = null;
    if (s.stop) {
      state = s.stop.kind === "touched" ? "touched" : "stopped";
      badge = "stopped";
      status = `Stopped reading at step ${group(s.stop.at)}: ${s.stop.reason}.`;
      detail = s.stop.kind === "touched" ? "The baseline is of worlds nobody wounded or fed. Notes filed before the change stay." : "It reads only measured values, so it reads nothing more of this world.";
    } else if (s.touchedAt !== null) {
      state = "touched";
      badge = "stopped";
      status = `Stopped reading: the world was changed by hand at step ${group(s.touchedAt)}.`;
      detail = "The baseline is of worlds nobody wounded or fed. Notes filed before the change stay.";
    } else if (this.failed && !s.ended) {
      state = "stopped";
      badge = "stopped";
      if (this.failedBy === "worker") {
        const why = "the lab’s worker reported an error it did not handle";
        status = readTo === null ? `Stopped reading before the first census: ${why}.` : `Stopped reading after step ${group(readTo)}: ${why}.`;
        detail = "The world may still be running, but the naturalist no longer reads its censuses. Notes filed before it stopped stay. Plant it again, or restore a copy from no later than the last census read, to read on.";
      } else {
        status = readTo === null ? "Stopped reading: the world stopped before its first census." : `Stopped reading after step ${group(readTo)}: the world stopped and sends no more censuses.`;
        detail = "Notes filed before it stopped stay. Plant it again, or restore a copy from no later than the last census read, to read on.";
      }
    } else if (s.ended) {
      state = "ended";
      badge = "ended";
      status = `The baseline ends at step ${group(h.horizon)}, so the naturalist has stopped reading.`;
    } else if (!notes.length && (readTo ?? 0) < FIRST_NOTE_STEP) {
      state = "listening";
      badge = "listening";
      status = `Listening. Nothing counts before step ${group(h.burnIn)}, so the first note can come at step ${group(FIRST_NOTE_STEP)}.`;
    } else if (!notes.length) {
      state = "quiet";
      badge = "quiet";
      status = `Quiet so far: no signal has stayed beyond the threshold for ${group(h.W)} censuses in a row.`;
    } else {
      state = "rings";
      badge = notes.length === 1 ? "1 note" : `${notes.length} notes`;
      status = `${notes.length === 1 ? "One note" : `${notes.length} notes`} so far.`;
    }
    const hedge = !notes.length && (readTo ?? 0) >= FIRST_NOTE_STEP && this.bell ? hedgeFor(this.bell, h) : [];
    return { state, badge, status, detail, notes, filing, standing, cannot, rule, readTo, readLine, hedge };
  }
}

// ---------------------------------------------------------------------------------------------
// Words.

const NUMBER_WORDS: Record<number, string> = { 2: "two", 3: "three", 4: "four", 5: "five", 6: "six" };
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

/** The threshold in words, for the note's sentence. */
export function thresholdWords(h: EnvelopeHeader, side: Side): string {
  const dir = side === "high" ? "above" : "below";
  return h.threshold.strict ? `Beyond Z* (more than ${h.threshold.Z} spreads ${dir} it)` : `At least ${NUMBER_WORDS[h.threshold.Z] ?? group(h.threshold.Z)} spreads ${dir} it`;
}

export function noteSentence(r: LiveRing, h: EnvelopeHeader): string {
  const rc = r.receipt, dir = r.side === "high" ? "above" : "below";
  return `${phrase(r.signal, r.side, h.cadence)}: ${fmtValue(r.signal, rc.value)} at step ${group(rc.startStep)}, against a neutral median there of ${fmtValue(r.signal, rc.median)}. ${thresholdWords(h, r.side)} for ${group(h.W)} censuses in a row, from step ${group(rc.startStep)} to step ${group(rc.endStep)}; the weakest of them was ${fmtZ(rc.minAbsZ)} spreads ${dir} the median.`;
}

function noteView(r: LiveRing, h: EnvelopeHeader, touched: number | null, reading: boolean, key: string, suggestion: SuggestionView | null): NoteView {
  const rc = r.receipt;
  const stretch = r.stretch.ongoing
    ? reading
      ? `Still beyond the threshold at step ${group(r.stretch.endStep)}: ${group(r.stretch.censuses)} censuses in a row so far.`
      : `Still beyond the threshold at its last census read, step ${group(r.stretch.endStep)}: ${group(r.stretch.censuses)} censuses in a row.`
    : `Beyond the threshold for ${group(r.stretch.censuses)} censuses in a row, to step ${group(r.stretch.endStep)}.`;
  return {
    key,
    signal: r.signal,
    label: textOf(r.signal).label,
    side: r.side,
    chips: ["Measured", "Unclear"],
    sentence: noteSentence(r, h),
    stretch,
    receipt: { ...rc, spread: r.spread },
    receiptLine: `${r.signal} ${r.side} · steps ${group(rc.startStep)} to ${group(rc.endStep)} · value ${fmtValue(r.signal, rc.value)} against median ${fmtValue(r.signal, rc.median)}, spread ${fmtValue(r.signal, r.spread)} · weakest ${fmtZ(rc.minAbsZ)} spreads`,
    filedBefore: touched,
    suggestion,
  };
}

function standingFor(h: EnvelopeHeader, neutral: boolean): Standing[] {
  const n = h.numbers, out: Standing[] = [];
  if (neutral) out.push({ text: "This world is neutral, like the baseline’s runs: mutations change nothing an organism does. Any note on it is a false alarm by definition.", chip: null });
  if (n.nullCheck.what === "fresh")
    out.push({ text: `On ${group(n.nullCheck.of)} fresh neutral runs it had never seen, this rule rang on ${group(n.nullCheck.k)}${n.nullCheck.upper95 !== null ? ` (upper 95% bound ${pct(n.nullCheck.upper95)})` : ""}.`, chip: "Measured" });
  else
    out.push({ text: `Of ${group(n.nullCheck.of)} held-out neutral runs, ${group(n.nullCheck.k)} scored above Z*${n.nullCheck.upper95 !== null ? ` (upper 95% bound ${pct(n.nullCheck.upper95)}, from only ${group(n.nullCheck.of)} runs)` : ""}. Z* is the largest score of ${group(n.calibRuns ?? 0)} calibration runs.`, chip: "Measured" });
  if (!neutral) {
    if (n.arms) {
      const rest = n.arms.of - n.arms.fromBurnIn;
      out.push({
        text: `Full-rules runs of this world stand apart from the neutral runs: all ${group(n.arms.of)} the bell scored rang, ${group(n.arms.fromBurnIn)} of them first on ${textOf(n.arms.signal).label.toLowerCase()} ${n.arms.side} in the first window it counts, from step ${group(BURN_IN)} to step ${group(n.arms.endStep)}${rest > 0 ? `, and ${rest === 1 ? "the other" : `the other ${group(rest)}`} later, by step ${group(n.arms.lastEndStep)}` : ""}. So a world planted here will most likely ring by about step ${group(n.arms.endStep)}, and that note says its kind of world differs from the neutral runs, which was known.`,
        chip: "Measured",
      });
    }
    else out.push({ text: "How a full-rules world of this kind compares with the neutral runs: the bell has never scored one.", chip: "Not yet measured" });
  }
  out.push({ text: "Whether the naturalist hears something arise inside a world.", chip: "Not yet measured" });
  return out;
}

const CANNOT_GENERAL = [
  "It is code, not a model: where it has a baseline, it compares a world with neutral runs of its starting world, by rules written down before the code, and no model reads the world.",
  "Without a baseline it says nothing about this world: not whether it is unlike neutral runs, and not whether anything has changed in it.",
  "Nothing about cause, mechanism or importance, for any world.",
];

function cannotFor(h: EnvelopeHeader): string[] {
  const n = h.numbers;
  const twin = n.twins
    ? ` A twin bell was tried on ${presetName(n.twins.preset)} and did not meet its bar there (it heard ${n.twins.l96.k} of ${n.twins.l96.of} large wounds and ${n.twins.f.k} of ${n.twins.f.of} feeds).`
    : " No twin bell has been run on this world.";
  return [
    `It compares this world with neutral runs of its starting world, not with a twin of itself: a note says “unlike the neutral runs”, not “something changed here”.${twin}`,
    n.arms
      ? `A full-rules world stands apart from the neutral runs (${n.arms.fromBurnIn} of ${n.arms.of} in the record from the first window counted, all ${n.arms.of} by step ${group(n.arms.lastEndStep)}): a note on it says its kind differs, not that something arose in it.`
      : "How a full-rules world compares with the neutral runs here is not yet measured, so a note may say only that its kind differs.",
    n.nullCheck.what === "fresh"
      ? `A threshold calibrated on neutral runs can still be crossed by neutral dynamics alone: ${n.nullCheck.k} of ${n.nullCheck.of} fresh runs rang, upper bound ${pct(n.nullCheck.upper95 ?? 1)}.`
      : `A threshold calibrated on neutral runs can still be crossed by neutral dynamics alone, and this one is a single order statistic: Z* = ${h.threshold.Z} is the largest of ${n.calibRuns ?? 0} calibration scores, set by one run, and the next largest was ${n.calibSecond !== null ? fmtZ(n.calibSecond) : "not recorded"}. So it rings only on a world that departs far more than any other calibration run did, and its held-out check (${n.nullCheck.k} of ${n.nullCheck.of}, upper bound ${pct(n.nullCheck.upper95 ?? 1)}) is weak. Z* was set with each run scored against the other ${h.envelope.runs.length - 1}; this world is held against all ${h.envelope.runs.length}.`,
    "Nothing about cause, mechanism or importance.",
    "Whether a suggestion beside a note is a good experiment, or whether the proposer's rules beat a random intervention: that is the bench's question (docs/naturalist-bench-v0-2026-10-18.md), and the bench has not run.",
    "Whether a suggestion's prediction holds: Try it here lands later than the suggested step, on a world with no untouched twin, and the naturalist stops reading after any change by hand. A prediction is decided only offline, between a source run and its fork, and no command decides it yet.",
    "Where a departure is concentrated: no census records it, so every suggestion aims at the jar disc, close to the whole jar.",
    ...(h.rule === "bell-v1-A" ? [`For ${presetName(h.preset)}, whether the offline proposer would file a note at all: its notebook rings at bell v0's calibrated Z*, over all thirteen signals, not at this panel's rule.`] : []),
    `It sees only its ${NUMBER_WORDS[h.signals.length] ?? group(h.signals.length)} signals, nothing before step ${group(h.burnIn)}, nothing after step ${group(h.horizon)}, nothing after you wound or feed the world, and nothing of a world it did not watch from its first census.`,
  ];
}

/** The notebook's words for a reading with no note (docs/naturalist-bell-v0-2026-10-17.md, "Labels and words"). */
function hedgeFor(bell: LiveBell, h: EnvelopeHeader): Standing[] {
  let top = bell.dBySignal()[0];
  for (const d of bell.dBySignal()) if (d.D > top.D) top = d;
  const need = h.threshold.strict ? `more than ${h.threshold.Z}` : `at least ${NUMBER_WORDS[h.threshold.Z] ?? group(h.threshold.Z)}`;
  return [
    { text: `The furthest any signal has stayed from the neutral median for ${group(h.W)} censuses in a row so far is ${fmtZ(top.D)} spreads (${textOf(top.signal).label.toLowerCase()}, ${top.side}); a note needs ${need}.`, chip: "Measured" },
    { text: "That nothing is going on in this world: no note means only that no signal stayed beyond the threshold, and how well the naturalist hears a change inside a world has not been measured.", chip: "Not yet measured" },
  ];
}

function ruleFor(h: EnvelopeHeader): RuleView {
  const name = h.rule === "bell-v1-A"
    ? `The anomaly bell v1, part A (docs/naturalist-bell-v1-plan-2026-10-17.md): ${h.signals.length} signals, z against the neutral median in spreads (a spread is the largest of the neutral runs’ IQR / 1.349 at that census, 5% of their median, and the signal’s floor), windows of ${h.W} censuses from step ${group(h.burnIn)}, to step ${group(h.horizon)}.`
    : `The anomaly bell v0, calibrated (docs/naturalist-bell-v0-2026-10-17.md): ${h.signals.length} signals, z against the neutral median in spreads (a spread is the largest of the neutral runs’ IQR / 1.349 at that census, 5% of their median, and the signal’s floor), windows of ${h.W} censuses from step ${group(h.burnIn)}, read here to step ${group(h.horizon)}.`;
  const threshold = h.threshold.strict ? `A ring needs every census of a window strictly beyond Z* = ${h.threshold.Z} spreads.` : `A ring needs every census of a window at least ${h.threshold.Z} spreads from the median.`;
  return { name, threshold, records: h.records, baseline: { file: h.bin.file, sha256: h.bin.sha256, runs: h.envelope.runs.length } };
}

/** Every string a view can show, for the wording tests. */
export function viewStrings(v: NaturalistView): string[] {
  return [v.badge, v.status, v.detail ?? "", v.filing ?? "", v.readLine ?? "", ...v.notes.flatMap((n) => [n.label, n.sentence, n.stretch, n.receiptLine, ...n.chips, ...suggestionStrings(n.suggestion)]), ...v.standing.flatMap((s) => [s.text, s.chip ?? ""]), ...v.hedge.flatMap((s) => [s.text, s.chip ?? ""]), ...v.cannot, ...(v.rule ? [v.rule.name, v.rule.threshold] : [])];
}

/** Every string a note's suggestion can show (commands included). */
export function suggestionStrings(sv: SuggestionView | null): string[] {
  if (!sv) return [];
  if (sv.kind !== "ready") return [sv.text];
  const s = sv.s;
  return [s.facts, s.reason, s.prediction.statement, s.tryLabel ?? "", s.source.line, s.fork.line, s.proposerSource.line, ...s.proposerCommands, s.proposerCaveat, ...s.caveats, sv.offer.button ?? "", ...sv.offer.lines, sv.sameAs ?? "", sv.bench.text, sv.bench.chip ?? "", sv.before];
}
