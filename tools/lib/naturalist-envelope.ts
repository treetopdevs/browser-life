// The naturalist's published baselines (docs/naturalist-field-notes-v0-2026-10-18.md, "Parity"): pure helpers for
// tools/naturalist-envelope.ts. What each preset's baseline is (rule, signals, threshold, envelope runs), the counts its header
// carries, each read from a committed record and checked against it, and the header's canonical text. No Deno or filesystem
// access, so vitest can load it.
import { BURN_IN_STEP, PRIMARY, RATE_LAG, SIGNALS, binomialUpperBound, corpusRuns, type Receipt } from "./bell.ts";
import { ENVELOPE_LAYOUT, NATURALIST_BASELINES, type EnvelopeHeader, type EnvelopeNumbers, type EnvelopeRule } from "../../apps/lab/src/naturalist-score.ts";

export const CADENCE = 100;
export const HORIZON = 300_000;
/** The records every header cites, by role. */
export const RECORDS = { v0: "experiments/naturalist/bell-v0.json", v1Null: "experiments/naturalist/bell-v1-null.json", v1Twins: "experiments/naturalist/bell-v1-twins.json" } as const;

export interface BaselineSpec {
  preset: string;
  rule: EnvelopeRule;
  /** The asset's base name under apps/lab/public/naturalist. */
  file: string;
  signals: string[];
  /** The bell's threshold: v1's Z = 4 (>=), or v0's calibrated Z* (strictly above). */
  threshold: { Z: number; strict: boolean };
  /** Envelope run ids (the bell corpus's neutral runs of the preset, in corpus order). */
  envelope: string[];
  envelopeId: string;
  /** Which records it cites. */
  records: string[];
}

const neutralIds = (preset: string) => corpusRuns().filter((r) => r.preset === preset && r.condition === "neutral").map((r) => r.id);
const v1Signals = () => SIGNALS.map((d) => d.name).filter((n) => n !== "maxGeneration" && n !== "dominantShare");

/**
 * The two baselines, each the lab's fixed rule (naturalist-score.ts NATURALIST_BASELINES), held to the bell's definitions and the
 * records: v1's eleven signals at PRIMARY.Z, and bell-v0.json's spots-m3 Z* (`zStarSpots`, summary.secondary.perPreset["spots-m3"]
 * .zStar), strictly above. Any difference: STOP.
 */
export function baselineSpecs(zStarSpots: number): BaselineSpec[] {
  const g = NATURALIST_BASELINES["gradient-m3"], s = NATURALIST_BASELINES["spots-m3"];
  need(g.signals.join() === v1Signals().join() && Object.is(g.threshold.Z, PRIMARY.Z) && !g.threshold.strict, "the lab's gradient-m3 rule is not v1 part A (eleven signals, Z = 4, >=)");
  need(s.signals.join() === SIGNALS.map((d) => d.name).join() && Object.is(s.threshold.Z, zStarSpots) && s.threshold.strict, `the lab's spots-m3 rule is not bell-v0.json's (all signals, strictly above Z* = ${zStarSpots})`);
  const specs: BaselineSpec[] = [
    { preset: "gradient-m3", rule: g.rule, file: g.file, signals: [...g.signals], threshold: { ...g.threshold }, envelope: neutralIds("gradient-m3"), envelopeId: "bell-v1 E (the 40 gradient-m3 neutral runs of the bell corpus)", records: [RECORDS.v1Null, RECORDS.v1Twins, RECORDS.v0] },
    { preset: "spots-m3", rule: s.rule, file: s.file, signals: [...s.signals], threshold: { ...s.threshold }, envelope: neutralIds("spots-m3"), envelopeId: "bell-v0 all-neutral spots-m3 (the 30 spots-m3 neutral runs of the bell corpus)", records: [RECORDS.v0] },
  ];
  for (const x of specs) need(x.envelope.length === NATURALIST_BASELINES[x.preset].runs, `${x.preset}: ${x.envelope.length} neutral runs in the bell corpus, the lab's rule says ${NATURALIST_BASELINES[x.preset].runs}`);
  return specs;
}

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const need = (cond: unknown, what: string) => {
  if (!cond) throw new Error(`STOP: ${what}`);
};

export interface V1NullEntry {
  id: string;
  set: string;
  D11: number;
  ring11: boolean;
  firstRing11: Receipt | null;
}
/** bell-v1-null.json, checked enough to verify against: complete, called, A1 met, the expected entry sets. */
export function parseV1Null(text: string): { record: Record<string, unknown>; runs: V1NullEntry[]; presetIdentity: string; A1: { k: number; n: number; upper95: number } } {
  const r = JSON.parse(text) as Record<string, unknown>;
  need(r.rule === "anomaly-bell-v1-null" && r.complete === true && r.called === true, "bell-v1-null.json is not a complete, called v1 null record");
  const s = r.summary as Record<string, unknown>;
  const A1 = s.A1 as { status: string; k: number; n: number; upper95: number };
  need(A1.status === "met", `bell-v1-null.json A1 is ${A1.status}, not met`);
  const p = r.parameters as Record<string, unknown>;
  need(isObj(p.primary) && p.primary.Z === PRIMARY.Z && p.primary.W === PRIMARY.W && p.burnInStep === BURN_IN_STEP && p.horizonSteps === HORIZON, "bell-v1-null.json parameters are not Z 4, W 50, burn-in 10,000, horizon 300,000");
  const c = r.corpus as { presetIdentity: string };
  const runs = r.runs as V1NullEntry[];
  return { record: r, runs, presetIdentity: c.presetIdentity, A1 };
}

/** The numbers the gradient-m3 header prints, from the v1 records. */
export function gradientNumbers(v1: ReturnType<typeof parseV1Null>, twinsText: string): EnvelopeNumbers {
  const treat = v1.runs.filter((e) => e.set === "treatment");
  need(treat.length === 10 && treat.every((e) => e.ring11 && e.firstRing11), "bell-v1-null.json: the 10 treatment runs do not all ring under the v1 rule");
  const fromBurnIn = treat.filter((e) => e.firstRing11!.startStep === BURN_IN_STEP);
  const f0 = fromBurnIn[0]?.firstRing11;
  need(f0 && fromBurnIn.every((e) => e.firstRing11!.signal === f0.signal && e.firstRing11!.side === f0.side && e.firstRing11!.endStep === f0.endStep), "bell-v1-null.json: the treatment rings from the burn-in are not all on one signal and side");
  const lastEndStep = Math.max(...treat.map((e) => e.firstRing11!.endStep));
  return { nullCheck: { what: "fresh", k: v1.A1.k, of: v1.A1.n, upper95: v1.A1.upper95 }, arms: { k: treat.length, of: treat.length, fromBurnIn: fromBurnIn.length, signal: f0!.signal, side: f0!.side, endStep: f0!.endStep, lastEndStep }, twins: twinCounts(twinsText, "gradient-m3"), calibRuns: null, calibSecond: null };
}

/**
 * v1 part B: wounds (L96) and feeds (F) heard, of 10 each. The twin bell ran only on `preset`'s treatment bases, which every
 * scored base of the record must be.
 */
export function twinCounts(text: string, preset: string): NonNullable<EnvelopeNumbers["twins"]> {
  const t = JSON.parse(text) as { bases?: { id: string }[]; summary?: { arms?: Record<string, { hits?: { k: number; of: number } | null }> } };
  const l96 = t.summary?.arms?.l96?.hits, f = t.summary?.arms?.f?.hits;
  need(l96 && f, "bell-v1-twins.json has no L96 and F hit counts");
  const bases = t.bases ?? [];
  need(bases.length > 0 && bases.every((b) => typeof b.id === "string" && b.id.split("/")[1] === preset), `bell-v1-twins.json's bases are not all ${preset} runs`);
  return { preset, l96: { k: l96!.k, of: l96!.of }, f: { k: f!.k, of: f!.of } };
}

export interface V0Spots {
  zStar: number;
  calibRuns: number;
  /** The second largest D at W = 50 among the calibration runs. */
  calibSecond: number;
  heldOut: { k: number; of: number };
  presetIdentity: string;
  /** Per corpus run id (all-neutral envelope): D at W = 50 and the rings at Z = 4, W = 50. */
  runs: Map<string, { D50: number; rings: Receipt[] }>;
}
export function parseV0Spots(text: string): V0Spots {
  const r = JSON.parse(text) as Record<string, unknown>;
  need(r.rule === "anomaly-bell" && r.version === 0 && r.complete === true, "bell-v0.json is not a complete v0 bell record");
  const sec = (r.summary as { secondary: { status: string; W: number; perPreset: Record<string, { calibRuns: number; zStar: number; heldOutNeutral: { k: number; of: number } }> } }).secondary;
  need(sec.status === "called" && sec.W === PRIMARY.W, "bell-v0.json's calibrated readout is not called at W = 50");
  const p = sec.perPreset["spots-m3"];
  need(p && typeof p.zStar === "number", "bell-v0.json has no spots-m3 Z*");
  const corpus = r.corpus as { id: string; presetIdentity: string }[];
  const ident = new Set(corpus.filter((c) => c.id.split("/")[1] === "spots-m3").map((c) => c.presetIdentity));
  need(ident.size === 1, "bell-v0.json's spots-m3 corpus has more than one presetIdentity");
  const runs = new Map<string, { D50: number; rings: Receipt[] }>();
  for (const x of r.runs as { id: string; preset: string; envelope: string; D: Record<string, number>; rings: Receipt[] }[]) {
    if (x.preset !== "spots-m3" || x.envelope !== "all-neutral") continue;
    runs.set(x.id, { D50: x.D[String(PRIMARY.W)], rings: x.rings.filter((g) => g.Z === PRIMARY.Z && g.W === PRIMARY.W) });
  }
  const calib = [...runs].filter(([id]) => id.split("/")[0] === "replay-calib").map(([, x]) => x.D50).sort((a, b) => b - a);
  need(calib.length === p.calibRuns && Object.is(calib[0], p.zStar), `bell-v0.json: the largest of ${calib.length} replay-calib spots-m3 D values is ${calib[0]}, not Z* ${p.zStar} of ${p.calibRuns}`);
  return { zStar: p.zStar, calibRuns: p.calibRuns, calibSecond: calib[1], heldOut: { k: p.heldOutNeutral.k, of: p.heldOutNeutral.of }, presetIdentity: [...ident][0], runs };
}
/** The numbers the spots-m3 header prints: bell-v0.json only (no twin bell and no v1 rule ever ran on spots-m3). */
export function spotsNumbers(v0: V0Spots): EnvelopeNumbers {
  return { nullCheck: { what: "held-out", k: v0.heldOut.k, of: v0.heldOut.of, upper95: binomialUpperBound(v0.heldOut.k, v0.heldOut.of) }, arms: null, twins: null, calibRuns: v0.calibRuns, calibSecond: v0.calibSecond };
}

/** The header, keys in a fixed order: no timestamps, no absolute paths. */
export function buildHeader(spec: BaselineSpec, input: { presetIdentity: string; ruleVersion: number; binSha256: string; binBytes: number; records: { path: string; sha256: string }[]; numbers: EnvelopeNumbers }): EnvelopeHeader {
  const sig = new Map(SIGNALS.map((d) => [d.name, d]));
  return {
    kind: "naturalist-envelope",
    version: 0,
    preset: spec.preset,
    rule: spec.rule,
    presetIdentity: input.presetIdentity,
    ruleVersion: input.ruleVersion,
    cadence: CADENCE,
    burnIn: BURN_IN_STEP,
    horizon: HORIZON,
    censuses: HORIZON / CADENCE,
    rateLag: RATE_LAG,
    W: PRIMARY.W,
    threshold: { Z: spec.threshold.Z, strict: spec.threshold.strict },
    signals: spec.signals.map((n) => {
      const d = sig.get(n)!;
      return { name: d.name, kind: d.kind, floor: d.floor, source: d.source };
    }),
    envelope: { id: spec.envelopeId, runs: [...spec.envelope] },
    bin: { file: `${spec.file}.bin`, bytes: input.binBytes, sha256: input.binSha256, layout: ENVELOPE_LAYOUT },
    records: input.records.map((r) => ({ path: r.path, sha256: r.sha256 })),
    numbers: input.numbers,
  };
}
export const headerText = (h: EnvelopeHeader): string => JSON.stringify(h, null, 2) + "\n";

/** A receipt's fields in a fixed order, for comparing with a record's. */
export const receiptKey = (r: Receipt): string => JSON.stringify([r.signal, r.side, r.Z, r.W, r.startStep, r.endStep, r.minAbsZ, r.value, r.median]);
