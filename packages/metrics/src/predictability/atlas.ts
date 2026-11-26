// Evidence assembly. Node-only (node:crypto); not part of the browser barrel. Deterministic payload only: no clock, platform or repo SHA.
import { createHash } from "node:crypto";
import { RULE_VERSION, METRICS_VERSION } from "../../../schema/src/config.ts";
import { movieBytes, type Movie } from "./movie.ts";
import { RESOLUTIONS, HORIZONS, coarsen } from "./resolution.ts";
import { PREDICTORS, FIT_WINDOW, MAX_PERIOD, Series, fitSeries, type PredictorName } from "./predictors.ts";
import { CALIBRATION_BINS, DEFLATE_OPTIONS, FFLATE_VERSION, compressionOf, evaluatePredictor, miscalibration, recurrenceOf, skillOf, type Evaluation, type Rational } from "./losses.ts";
import { PHASE_SHIFTS, SHUFFLE_SEED, rankFlips, shuffleSuffix } from "./controls.ts";
import { decideLabel, type Label, type LabelInput } from "./labels.ts";
import { DUP_COUNT, FRAMES, SIDE } from "./fixtures.ts";
import { PREDICTABILITY_VERSION } from "./version.ts";

export const sha256 = (v: string | Uint8Array): string => createHash("sha256").update(v).digest("hex");
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export const STATEMENTS = ["CPU only", "no GPU evidence", "no score here selected anything"] as const;
export const DEFERRED_GAPS = [
  "surprise/false-alarm detector: no calibrated, past-only threshold and nominal rate are defined yet",
  "alternative bin offsets for the resolution grid",
  "copier fixture: none found in the checkout",
  "ecology clip is one small spots world and one seed, an illustration and not an ensemble result",
] as const;

type Dict<T> = Record<string, T>;
export interface LossRow { errors: number; cells: number; origins: number; skillVsPersistence: Rational | null; skillVsMarginal: Rational | null; skillVsBest: Rational | null }
export interface ControlRow { errors: number; cells: number }
export interface ResolutionResult {
  w: number; h: number; erased: boolean;
  recurrence: Dict<Rational>;
  loss: Dict<Dict<LossRow>>;
  calibration: Dict<{ bins: { n: number; correct: number; sumConf: number }[]; miscalibration: Rational }>;
}
export interface FixtureResult {
  id: string; family: string; w: number; h: number; q: number; frames: number; sha256: string; params: unknown;
  compression: ReturnType<typeof compressionOf>;
  byResolution: Dict<ResolutionResult>;
}
export interface LabelRecord { numbers: LabelInput; label: Label }
export interface Payload {
  kind: "predictability-atlas-evidence";
  versions: { predictability: number; ruleVersion: number; metricsVersion: number };
  statements: readonly string[];
  parameters: Record<string, unknown>;
  compressionSettings: { library: string; version: string; options: unknown; packing: string };
  fixtures: FixtureResult[];
  controls: {
    timeShuffle: { seed: number; rows: Dict<Dict<Dict<Dict<ControlRow>>>> };
    phaseShift: { shifts: readonly number[]; resolution: number; rows: Dict<Dict<Dict<Dict<ControlRow>>>> };
    duplicatedMotif: { copies: number; rows: Dict<Dict<Dict<{ single: number; dup: number; equalsCopiesTimesSingle: boolean }>>> };
  };
  naiveMetric: { description: string; q2PersistenceRanking: { id: string; errors: number; cells: number }[] };
  labels: Dict<LabelRecord>;
  binningSensitivity: { quantity: string; byResolution: Dict<Dict<Rational | null>>; rankFlipAcrossR: boolean; flippedPairs: [string, string][] };
  deferredGaps: readonly string[];
  integritySha256?: string;
}

const ctl = (e: Evaluation): ControlRow => ({ errors: e.errors, cells: e.cells });

function grid(s: Series, F: number, t0: number): { fit: ReturnType<typeof fitSeries>; ev: Dict<Dict<Evaluation>> } {
  const fit = fitSeries(s, F, HORIZONS);
  const ev: Dict<Dict<Evaluation>> = {};
  for (const h of HORIZONS) { ev[h] = {}; for (const p of PREDICTORS) ev[h][p] = evaluatePredictor(s, fit, p, h, t0); }
  return { fit, ev };
}

function rowsFor(ev: Dict<Evaluation>, erased: boolean): Dict<LossRow> {
  const base = Math.min(ev.persistence.errors, ev.marginal.errors);
  const out: Dict<LossRow> = {};
  for (const p of PREDICTORS) {
    const e = ev[p];
    out[p] = {
      errors: e.errors, cells: e.cells, origins: e.origins,
      skillVsPersistence: erased ? null : skillOf(e.errors, ev.persistence.errors),
      skillVsMarginal: erased ? null : skillOf(e.errors, ev.marginal.errors),
      skillVsBest: erased ? null : skillOf(e.errors, base),
    };
  }
  return out;
}

const bestOf = (ev: Dict<Evaluation>) => Math.min(...PREDICTORS.map((p) => ev[p].errors));

export function buildPayload(movies: readonly Movie[], meta: Dict<unknown>): Payload {
  const F = FIT_WINDOW;
  const fixtures: FixtureResult[] = [];
  const shuffleRows: Payload["controls"]["timeShuffle"]["rows"] = {};
  const phaseRows: Payload["controls"]["phaseShift"]["rows"] = {};
  const refEvals: Dict<{ erased: boolean; ev: Dict<Evaluation>; cells: number }> = {};
  const shufRef: Dict<Dict<Evaluation>> = {};
  const skillByR: Dict<Dict<Rational | null>> = {};
  const single: Dict<Dict<Dict<number>>> = {};
  for (const m of movies) {
    if (m.frames.length !== FRAMES) throw new Error(`${m.id}: expected ${FRAMES} frames`);
    const byResolution: Dict<ResolutionResult> = {};
    shuffleRows[m.id] = {};
    for (const r of RESOLUTIONS) {
      const c = coarsen(m, r);
      const s = new Series(c.frames, c.w, c.h, c.q);
      const { ev } = grid(s, F, F);
      const res: ResolutionResult = { w: c.w, h: c.h, erased: c.erased, recurrence: {}, loss: {}, calibration: {} };
      for (const h of HORIZONS) {
        res.loss[h] = rowsFor(ev[h], c.erased);
        res.recurrence[h] = recurrenceOf(s, h, F);
        const bins = ev[h]["local-stats"].calibration!;
        res.calibration[h] = { bins, miscalibration: miscalibration(bins) };
      }
      byResolution[r] = res;
      // time shuffle: permute the suffix [F, T), keep the fit window, score the same origins
      const sh = new Series(shuffleSuffix(c.frames, F, SHUFFLE_SEED), c.w, c.h, c.q);
      const { ev: sev } = grid(sh, F, F);
      shuffleRows[m.id][r] = {};
      for (const h of HORIZONS) { shuffleRows[m.id][r][h] = {}; for (const p of PREDICTORS) shuffleRows[m.id][r][h][p] = ctl(sev[h][p]); }
      if (r === 1) { refEvals[m.id] = { erased: c.erased, ev: ev[1], cells: ev[1].persistence.cells }; shufRef[m.id] = sev[1]; }
      if (m.q === 2) {
        const nb = Math.min(ev[1]["best-period"].errors, ev[1]["local-stats"].errors);
        (skillByR[r] ??= {})[m.id] = c.erased ? null : skillOf(nb, Math.min(ev[1].persistence.errors, ev[1].marginal.errors));
      }
      if (m.id === "life-glider" || m.id === "life-gliders-dup") {
        if (r <= 2) { single[m.id] ??= {}; single[m.id][r] = {}; for (const h of HORIZONS) for (const p of PREDICTORS) single[m.id][r][`${h}|${p}`] = ev[h][p].errors; }
      }
    }
    // phase shift: origins start at F+k at r=1
    phaseRows[m.id] = {};
    const c1 = coarsen(m, 1);
    const s1 = new Series(c1.frames, c1.w, c1.h, c1.q);
    const fit1 = fitSeries(s1, F, HORIZONS);
    for (const k of PHASE_SHIFTS) {
      phaseRows[m.id][k] = {};
      for (const h of HORIZONS) { phaseRows[m.id][k][h] = {}; for (const p of PREDICTORS) phaseRows[m.id][k][h][p] = ctl(evaluatePredictor(s1, fit1, p, h, F + k)); }
    }
    fixtures.push({
      id: m.id, family: m.family, w: m.w, h: m.h, q: m.q, frames: m.frames.length, sha256: sha256(movieBytes(m)), params: meta[m.id] ?? null,
      compression: compressionOf(m), byResolution,
    });
  }

  const dupRows: Payload["controls"]["duplicatedMotif"]["rows"] = {};
  if (single["life-glider"] && single["life-gliders-dup"]) {
    for (const r of [1, 2]) {
      dupRows[r] = {};
      for (const h of HORIZONS) {
        dupRows[r][h] = {};
        for (const p of PREDICTORS) {
          const a = single["life-glider"][r][`${h}|${p}`], b = single["life-gliders-dup"][r][`${h}|${p}`];
          dupRows[r][h][p] = { single: a, dup: b, equalsCopiesTimesSingle: b === DUP_COUNT * a };
        }
      }
    }
  }

  const q2 = movies.filter((m) => m.q === 2).map((m) => ({ id: m.id, errors: refEvals[m.id].ev.persistence.errors, cells: refEvals[m.id].ev.persistence.cells }));
  q2.sort((a, b) => b.errors * a.cells - a.errors * b.cells || (a.id < b.id ? -1 : 1));

  const labels: Dict<LabelRecord> = {};
  for (const m of movies) {
    const { erased, ev, cells } = refEvals[m.id];
    const numbers: LabelInput = { cells, erased, lBest: bestOf(ev), lMarginal: ev.marginal.errors, lBestShuffled: bestOf(shufRef[m.id]) };
    labels[m.id] = { numbers, label: decideLabel(numbers) };
  }

  const flips = rankFlips(RESOLUTIONS.map((r) => skillByR[r] ?? {}));
  return {
    kind: "predictability-atlas-evidence",
    versions: { predictability: PREDICTABILITY_VERSION, ruleVersion: RULE_VERSION, metricsVersion: METRICS_VERSION },
    statements: STATEMENTS,
    parameters: { frames: FRAMES, side: SIDE, fitWindow: F, resolutions: RESOLUTIONS, horizons: HORIZONS, maxPeriod: MAX_PERIOD, shuffleSeed: SHUFFLE_SEED, phaseShifts: PHASE_SHIFTS, calibrationBins: CALIBRATION_BINS, referenceObserver: { r: 1, h: 1 } },
    compressionSettings: { library: "fflate", version: FFLATE_VERSION, options: DEFLATE_OPTIONS, packing: "bit-packed (q=2: 8 cells/byte; q=16: 2 cells/byte), XOR-delta against the previous packed frame, first frame raw" },
    fixtures,
    controls: { timeShuffle: { seed: SHUFFLE_SEED, rows: shuffleRows }, phaseShift: { shifts: PHASE_SHIFTS, resolution: 1, rows: phaseRows }, duplicatedMotif: { copies: DUP_COUNT, rows: dupRows } },
    naiveMetric: { description: "raw one-step persistence error rate at r=1, binary (q=2) fixtures only, highest first; error rates are not comparable across alphabets", q2PersistenceRanking: q2 },
    labels,
    binningSensitivity: { quantity: "1 - min(best-period, local-stats errors) / min(persistence, marginal errors) at h=1, q=2 fixtures; null where erased or the baseline is 0", byResolution: Object.fromEntries(RESOLUTIONS.map((r) => [String(r), skillByR[r] ?? {}])), rankFlipAcrossR: flips.flip, flippedPairs: flips.pairs },
    deferredGaps: DEFERRED_GAPS,
  };
}

export function sealPayload(p: Payload): Payload {
  const { integritySha256: _drop, ...rest } = p;
  return { ...rest, integritySha256: sha256(canonical(rest)) };
}
export function verifySeal(p: Payload): boolean {
  const { integritySha256, ...rest } = p;
  return typeof integritySha256 === "string" && integritySha256 === sha256(canonical(rest));
}

/** Recompute every label from the stored raw numbers alone. */
export function relabel(p: Payload): Dict<Label> {
  return Object.fromEntries(Object.entries(p.labels).map(([id, rec]) => [id, decideLabel(rec.numbers)]));
}

export type { PredictorName };
