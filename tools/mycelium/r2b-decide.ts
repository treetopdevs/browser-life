// Mycelium rung R2b: calibration (sections 6.3-6.9) and the confirmation decision (section 8) as pure functions of the stored run
// series. No Deno, no file system, no clock. tools/mycelium/r2b-analyze.ts reads the files and prints; vitest tests this module.
import { distinct, effectSize, type EffectSize, fisherExact, holm, mannWhitney, type MannWhitney, median, otsu, type OtsuResult, PERMUTATIONS, spearman } from "./r2b-stats.ts";
import {
  type AnyArm, ARMS, EXCLUDED_VS_PHYSARUM, EXPOSED_VS_PHYSARUM, GUARDED_ARMS, NON_EXPOSED, passAttainable, passPair, R2B, READOUT_IDS, type ReadoutId, CONTROLS, type Control,
} from "./r2b-protocol.ts";
import { halfWindowDrift, type R2bSeries, runValues, type RunValues } from "./observe-r2b.ts";

/** Series by arm and seed. */
export type RunSet = Partial<Record<AnyArm, Record<number, R2bSeries>>>;

const LO = R2B.LO, HI = R2B.STEPS;
const log10p = (v: number) => Math.log10(v + R2B.TAU_EPS);

// ---- regime classifier (6.4) ------------------------------------------------------------------------------

export interface Classifier {
  /** log10(median TM + 0.01) per inherit dev seed, in seed order. */
  x: number[];
  /** The Otsu cut in the log domain (NaN if every seed has the same value) and tau in TM units: max(0, 10^cut - 0.01). */
  cut: number;
  tau: number | null;
  nLow: number;
  nHigh: number;
  share: number;
  /** The log10 distance between the highest low-class value and the lowest high-class value (null without a cut), and the larger within-class SD (population form). */
  gap: number | null;
  withinSd: number | null;
  /**
   * Both classes at least OTSU_MIN_CLASS seeds, the between-class share at least OTSU_SHARE, and the gap at least max(OTSU_MIN_GAP,
   * OTSU_GAP_SD x the larger within-class SD): two regimes, not a continuum cut in two. Otherwise REG is dropped and the trail-on
   * fallback of 6.3 is not used.
   */
  adequate: boolean;
  /** Per seed: trail-on (above the cut). All false when there is no cut. Meaningful for the 6.3 fallback only when `adequate`; use trailOn(). */
  on: boolean[];
}

const sdOf = (a: readonly number[]): number => { if (a.length === 0) return 0; const m = a.reduce((t, v) => t + v, 0) / a.length; return Math.sqrt(a.reduce((t, v) => t + (v - m) * (v - m), 0) / a.length); };

export function regimeClassifier(medianTM: readonly number[]): Classifier {
  const x = medianTM.map(log10p);
  const o: OtsuResult = otsu(x);
  const hasCut = Number.isFinite(o.cut);
  const low = hasCut ? x.filter((v) => v <= o.cut) : [], high = hasCut ? x.filter((v) => v > o.cut) : [];
  const gap = hasCut && low.length && high.length ? Math.min(...high) - Math.max(...low) : null;
  const withinSd = hasCut ? Math.max(sdOf(low), sdOf(high)) : null;
  return {
    x, cut: o.cut, tau: hasCut ? Math.max(0, 10 ** o.cut - R2B.TAU_EPS) : null, nLow: o.nLow, nHigh: o.nHigh, share: o.share, gap, withinSd,
    adequate: hasCut && o.nLow >= R2B.OTSU_MIN_CLASS && o.nHigh >= R2B.OTSU_MIN_CLASS && o.share >= R2B.OTSU_SHARE && gap !== null && withinSd !== null
      && gap >= Math.max(R2B.OTSU_MIN_GAP, R2B.OTSU_GAP_SD * withinSd),
    on: x.map((v) => hasCut && v > o.cut),
  };
}

/** The trail-on seeds the 6.3 fallback may use: those above the cut of an adequate classifier; none when the classifier is not adequate. */
export const trailOn = (c: Classifier): boolean[] => (c.adequate ? c.on : c.on.map(() => false));

// ---- matched deposit (6.3, 6.5) ---------------------------------------------------------------------------------

export interface DepositTarget {
  /** The target T in matter units per particle-step, or null when the null cannot be matched. */
  T: number | null;
  source: "median" | "trail-on" | "none";
  limited: boolean;
  reason: string | null;
  /** The raw median over all dev inherit seeds, whatever the fallback decided. */
  medianAll: number;
}

/** T = median over the dev inherit seeds of d_s; under 1/16 it falls back to the median over trail-on seeds; still under 1/16, or fewer than 4 trail-on seeds, the null is unmatchable. */
export function depositTarget(d: readonly number[], on: readonly boolean[]): DepositTarget {
  const medianAll = median(d);
  if (medianAll >= R2B.D_FLOOR) return { T: medianAll, source: "median", limited: false, reason: null, medianAll };
  const onD = d.filter((_, i) => on[i]);
  if (onD.length < R2B.MIN_TRAIL_ON) return { T: null, source: "none", limited: true, reason: `median d ${medianAll} is under 1/16 and only ${onD.length} seeds are trail-on (need ${R2B.MIN_TRAIL_ON})`, medianAll };
  const m = median(onD);
  if (m < R2B.D_FLOOR) return { T: null, source: "none", limited: true, reason: `median d ${medianAll} and the trail-on median ${m} are both under 1/16`, medianAll };
  return { T: m, source: "trail-on", limited: false, reason: null, medianAll };
}

export const clampV = (v: number) => Math.min(R2B.V_MAX, Math.max(0, v));
/** The starting deposit of the matching runs: clamp(round(256 T), 0, 768). */
export const startingDeposit = (T: number): number => clampV(Math.round(256 * T));

export interface MatchStep {
  action: "accept" | "next" | "stop" | "limited";
  /** The deposit of the next round (action "next"). */
  nextV: number | null;
  converged: boolean;
  /** d_phys / T of this round. */
  ratio: number | null;
  reason: string | null;
}

/**
 * What to do after matching round `round` (1-based) ran with deposit `v` and measured d_phys (the median over the 8 seeds of the mean
 * d over (10k, 30k]): accept when |d_phys - T| <= 10% of T; d_phys = 0 cannot be matched (limited); after round 3, or when the update
 * would repeat v, stop with converged false and keep v (the round's own v); otherwise update v <- clamp(round(v T / d_phys)).
 */
export function matchStep(round: number, v: number, T: number, dPhys: number): MatchStep {
  if (!(dPhys > 0)) return { action: "limited", nextV: null, converged: false, ratio: dPhys === 0 ? 0 : null, reason: `d_phys is ${dPhys} at v = ${v}: the null deposits nothing, so it cannot be matched` };
  const ratio = dPhys / T;
  if (Math.abs(dPhys - T) <= R2B.MATCH_TOL * T) return { action: "accept", nextV: null, converged: true, ratio, reason: null };
  const nextV = clampV(Math.round((v * T) / dPhys));
  if (round >= R2B.MATCH_ROUNDS) return { action: "stop", nextV: null, converged: false, ratio, reason: `round ${round} is outside the 10% tolerance (d_phys / T = ${ratio})` };
  if (nextV === v) return { action: "stop", nextV: null, converged: false, ratio, reason: `the update would repeat v = ${v} (d_phys / T = ${ratio}, v is at its bound or at the rounding limit)` };
  return { action: "next", nextV, converged: false, ratio, reason: null };
}

/**
 * Replays a stored matching record against the protocol (6.5): the first round runs at v0 = clamp(round(256 T)); each later round runs at the
 * update of the one before; the record's final state (v, converged, ratio, limited) is what matchStep says about the last round; no more than
 * 3 rounds. `T` is the target recomputed from the dev inherit runs (null when the null is unmatchable). Empty = consistent. The per-round
 * d_phys values are checked against the stored runs by the caller (r2b-analyze.ts), so together nothing in matching.json is taken on trust.
 */
export function matchingProblems(m: MatchingRecord, T: number | null): string[] {
  const bad: string[] = [];
  if (T === null) {
    if (!m.limited || m.v !== null) bad.push("the dev inherit runs give no target T, but matching.json claims a matched deposit");
    return bad;
  }
  if (m.limited && m.rounds.length === 0) { bad.push("matching.json is limited but the dev inherit runs give a target"); return bad; }
  if (Math.abs(m.T - T) > 1e-9 * Math.max(1, T)) bad.push(`matching.json used T = ${m.T}, the dev inherit runs give ${T}`);
  if (m.v0 !== startingDeposit(T)) bad.push(`v0 is ${m.v0}, expected ${startingDeposit(T)}`);
  if (m.rounds.length === 0 || m.rounds.length > R2B.MATCH_ROUNDS) bad.push(`${m.rounds.length} matching rounds recorded (1 to ${R2B.MATCH_ROUNDS} allowed)`);
  m.rounds.forEach((r, k) => {
    if (r.round !== k + 1) bad.push(`round ${k + 1} is numbered ${r.round}`);
    const want = k === 0 ? m.v0 : matchStep(k, m.rounds[k - 1].v, T, m.rounds[k - 1].dPhys ?? 0).nextV;
    if (r.v !== want) bad.push(`round ${r.round} ran at v ${r.v}, the protocol asks for ${want}`);
  });
  const last = m.rounds.at(-1);
  if (last) {
    const st = matchStep(last.round, last.v, T, last.dPhys ?? 0);
    if (st.action === "next") bad.push(`round ${last.round} asks for another round but the record ends there`);
    else {
      if (m.limited !== (st.action === "limited")) bad.push(`limited is ${m.limited}, expected ${st.action === "limited"}`);
      if (m.converged !== st.converged) bad.push(`converged is ${m.converged}, expected ${st.converged}`);
      if (m.v !== (st.action === "limited" ? null : last.v)) bad.push(`the final v is ${m.v}, expected ${st.action === "limited" ? null : last.v}`);
      // The stored ratio is recomputed, never trusted: the match gate reads it.
      const want = st.ratio;
      if (want === null ? m.ratio !== null : !(typeof m.ratio === "number" && Math.abs(m.ratio - want) <= 1e-9 * Math.max(1, Math.abs(want)))) bad.push(`the stored d_phys / T is ${m.ratio}, the last round gives ${want}`);
    }
  }
  return bad;
}

// ---- calibration (6) -------------------------------------------------------------------------------------

export interface MatchingRecord {
  T: number;
  source: string;
  v0: number;
  rounds: { round: number; v: number; dPhys: number | null; perSeed: (number | null)[]; digests: string[] }[];
  /** The accepted (or last) deposit; null when limited. */
  v: number | null;
  converged: boolean;
  ratio: number | null;
  limited: boolean;
  reason: string | null;
}

export interface ReadoutTest {
  readout: ReadoutId;
  /** Why the readout took no part: fewer than 6 distinct inherit values, REG with no adequate classifier, or missing values. */
  dropped: string | null;
  p: number | null;
  adjusted: number | null;
  delta: number | null;
  separated: boolean;
  method: string | null;
}

export interface ControlResult {
  control: Control;
  usable: boolean;
  /** Controls that touch the cap (refused > 0 in W) are valid and flagged. */
  capTouched: boolean;
  guardTripped: string[];
  tests: ReadoutTest[];
}

export interface DevContrast {
  readout: ReadoutId;
  vs: "blocked" | "physarum";
  p: number;
  delta: number;
  deltaCI: [number, number];
  hl: number;
  hlCI: [number, number];
  method: string;
}

export interface Calibration {
  plan: string;
  devSeeds: number[];
  /** Per arm and seed: the run values (REG with tau), so a reader sees every number the tests used. */
  values: Record<string, Record<number, RunValues>>;
  regime: { classifier: Classifier; regDropped: boolean; fisherByArm: Record<string, { on: number; off: number }> };
  target: DepositTarget;
  physarum: {
    v: number | null; converged: boolean; ratio: number | null; limited: boolean;
    /** The matched null's deposit in the window: median over the dev physarum seeds of d (null until the dev physarum runs exist), and its ratio to T. */
    devD: number | null; devRatio: number | null;
    /** T over the median d of all dev inherit seeds: above 1 when the 6.3 fallback matched the null to the trail-on seeds, so it deposits more than a typical inherit seed. */
    targetToAll: number | null;
  };
  controls: ControlResult[];
  kept: ReadoutId[];
  dropped: Record<string, string>;
  devContrasts: DevContrast[];
  /** Per readout: Spearman correlation between the first-half and second-half window values across the inherit seeds. */
  halfAgreement: Record<string, number | null>;
  /** Per readout, the first-half (50k, 75k] and second-half (75k, 100k] value of every inherit seed (what halfAgreement summarises). */
  halfValues: HalfValues;
  /** Median over the inherit seeds of the fraction of invalid Moran censuses (descriptive), and how many inherit dev seeds have an MI at all (at least MI_MIN_VALID_FRACTION valid censuses). */
  miInvalidMedian: number | null;
  miMeasurable: number;
  drift: Record<string, Record<number, { TM: number | null; n: number | null; sumP: number | null }>>;
  guardTrips: string[];
  verdict: "READY" | "MEASUREMENT-LIMITED";
  reasons: string[];
}

/** Per readout, the first-half and second-half window value of each seed of an arm. */
export type HalfValues = Record<string, { seed: number; first: number | null; second: number | null }[]>;

function halfValuesOf(runs: Record<number, R2bSeries>, seeds: readonly number[], tau: number | null): HalfValues {
  const mid = (LO + HI) / 2;
  const out: HalfValues = Object.fromEntries(READOUT_IDS.map((id) => [id, [] as HalfValues[string]]));
  for (const s of seeds) {
    const a = runValues(runs[s], LO, mid, tau), b = runValues(runs[s], mid, HI, tau);
    for (const id of READOUT_IDS) out[id].push({ seed: s, first: a[id], second: b[id] });
  }
  return out;
}

const agreementOf = (h: HalfValues[string]): number | null => (h.some((x) => x.first === null || x.second === null) ? null : nan(spearman(h.map((x) => x.first as number), h.map((x) => x.second as number))));

const seedsOf = (set: RunSet, arm: AnyArm): number[] => Object.keys(set[arm] ?? {}).map(Number).sort((a, b) => a - b);

function need(set: RunSet, arm: AnyArm, seeds: readonly number[]): Record<number, R2bSeries> {
  const have = set[arm] ?? {};
  const miss = seeds.filter((s) => have[s] === undefined);
  if (miss.length) throw new Error(`calibration needs ${arm} seeds ${miss.join(", ")}`);
  return have;
}

export interface CalibrateInput {
  plan: string;
  devSeeds: readonly number[];
  runs: RunSet;
  matching: MatchingRecord | null;
  /** Permutation count for tied tests (the protocol's 10^6; tests may lower it) and bootstrap resamples. */
  perms?: number;
  boots?: number;
}

/**
 * Calibration on dev seeds (section 6). Throws when a needed run is missing (an incomplete batch is not calibrated). Verdict
 * MEASUREMENT-LIMITED on any guard trip of inherit, blocked or physarum, no usable control, an unmatchable null, or fewer than 2 kept readouts.
 */
export function calibrate(inp: CalibrateInput): Calibration {
  const { devSeeds, runs } = inp;
  const perms = inp.perms ?? PERMUTATIONS;
  for (const arm of [...ARMS, ...CONTROLS]) if (arm !== "physarum" || inp.matching?.v != null) need(runs, arm, devSeeds);
  const reasons: string[] = [];

  // Window values, first without tau (the classifier's input), then again with it.
  const inheritBare = devSeeds.map((s) => runValues(runs.inherit![s], LO, HI, null));
  const classifier = regimeClassifier(inheritBare.map((v) => v.medianTM ?? 0));
  const tau = classifier.adequate ? classifier.tau : null;
  const values: Record<string, Record<number, RunValues>> = {};
  for (const arm of [...ARMS, ...CONTROLS]) {
    if (!runs[arm]) continue;
    values[arm] = {};
    for (const s of seedsOf(runs, arm)) values[arm][s] = runValues(runs[arm]![s], LO, HI, tau);
  }
  const inh = devSeeds.map((s) => values.inherit[s]);

  // Guard (7).
  const guardTrips: string[] = [];
  for (const arm of GUARDED_ARMS) for (const s of seedsOf(runs, arm)) if (values[arm][s].guardTripped) guardTrips.push(`${arm} ${s}`);
  if (guardTrips.length) reasons.push(`population guard tripped: ${guardTrips.join(", ")}`);

  // Matched deposit (6.3, 6.5, 6.6). The trail-on fallback is used only when the classifier is adequate.
  const target = depositTarget(inh.map((v) => v.d ?? 0), trailOn(classifier));
  if (target.limited) reasons.push(`the physarum null cannot be matched: ${target.reason}`);
  if (inp.matching) {
    if (inp.matching.limited) reasons.push(`the physarum null cannot be matched: ${inp.matching.reason}`);
    else if (target.T !== null && Math.abs(inp.matching.T - target.T) > 1e-9 * Math.max(1, target.T)) reasons.push(`matching used T = ${inp.matching.T} but the dev inherit runs give T = ${target.T}`);
    else {
      // The ratio of the last matching round, recomputed from its d_phys (the stored `ratio` is not trusted).
      const last = inp.matching.rounds.at(-1);
      const ratio = last?.dPhys != null && inp.matching.T > 0 ? last.dPhys / inp.matching.T : inp.matching.ratio;
      if (ratio === null || !(Math.abs(ratio - 1) <= R2B.MATCH_GATE)) reasons.push(`the matching rounds ended at d_phys / T = ${ratio}, outside ${R2B.MATCH_GATE * 100}%: the null is not matched`);
    }
  } else if (!target.limited) reasons.push("no matching record: the physarum null has not been matched");
  // The null at its dev length: its deposit in W must still be near T (the matching rounds are 30,000 steps and read (10k, 30k]).
  const physD = runs.physarum ? seedsOf(runs, "physarum").map((s) => values.physarum[s].d).filter((v): v is number => v !== null) : [];
  const devD = physD.length ? median(physD) : null;
  const devRatio = devD !== null && target.T !== null && target.T > 0 ? devD / target.T : null;
  if (devRatio !== null && Math.abs(devRatio - 1) > R2B.MATCH_GATE) reasons.push(`the dev physarum runs deposit ${devD} per particle-step in W, ${devRatio} times the target T = ${target.T}: outside ${R2B.MATCH_GATE * 100}%, the null is not matched at the protocol length`);
  const physarum = {
    v: inp.matching?.v ?? null, converged: inp.matching?.converged ?? false, ratio: inp.matching?.ratio ?? null, limited: target.limited || (inp.matching?.limited ?? false),
    devD, devRatio, targetToAll: target.T !== null && target.medianAll > 0 ? target.T / target.medianAll : null,
  };

  // Pre-drops (6.4, 6.7): REG without an adequate classifier; missing values; fewer than 6 distinct inherit values (not REG: it is a proportion that is 0 or 1 in
  // a stable regime, its keep rule is the classifier's adequacy). MI is undefined (null) for a seed with too few valid censuses, so for MI the rules apply to the
  // measurable seeds, and fewer than MI_MIN_SEEDS of them drop it.
  const dropped: Record<string, string> = {};
  const nn = (a: readonly (number | null)[]): number[] => a.filter((v): v is number => v !== null);
  const col = (arm: AnyArm, id: ReadoutId): (number | null)[] => seedsOf(runs, arm).map((s) => values[arm][s][id]);
  const invFrac = nn(inh.map((v) => v.moranInvalidFraction));
  const miInvalidMedian = invFrac.length ? median(invFrac) : null;
  const miMeasurable = nn(inh.map((v) => v.MI)).length;
  for (const id of READOUT_IDS) {
    const iv = inh.map((v) => v[id]);
    if (id === "REG" && !classifier.adequate) dropped[id] = `the regime classifier is not adequate (classes ${classifier.nLow}/${classifier.nHigh}, share ${classifier.share.toFixed(3)}, gap ${classifier.gap === null ? "-" : classifier.gap.toFixed(3)} against within-class SD ${classifier.withinSd === null ? "-" : classifier.withinSd.toFixed(3)})`;
    else if (id === "MI") {
      if (miMeasurable < R2B.MI_MIN_SEEDS) dropped[id] = `Moran's I is measurable (every one of the window's heavy censuses valid) in only ${miMeasurable} of ${iv.length} inherit dev seeds (need ${R2B.MI_MIN_SEEDS})`;
      else if (distinct(nn(iv)) < R2B.MIN_DISTINCT) dropped[id] = `only ${distinct(nn(iv))} distinct values among the measurable inherit dev seeds (need ${R2B.MIN_DISTINCT})`;
    }
    else if (iv.some((v) => v === null)) dropped[id] = "missing values among the inherit dev seeds";
    else if (id !== "REG" && distinct(iv as number[]) < R2B.MIN_DISTINCT) dropped[id] = `only ${distinct(iv as number[])} distinct values among the inherit dev seeds (need ${R2B.MIN_DISTINCT})`;
  }
  /** The values a test uses: MI over its measurable seeds only (null when fewer than MI_MIN_SEEDS), every other readout over all seeds (null when any is missing). */
  const testValues = (id: ReadoutId, v: readonly (number | null)[]): number[] | null => {
    if (id === "MI") { const m = nn(v); return m.length >= R2B.MI_MIN_SEEDS ? m : null; }
    return v.every((x) => x !== null) ? (v as number[]) : null;
  };

  // Positive controls (6.7): control against inherit; ONE Holm over every (usable control, readout) test, so a readout kept by the union of three
  // controls is not kept by three separate chances.
  const controls: ControlResult[] = [];
  const pool: { c: number; id: ReadoutId; t: MannWhitney }[] = [];
  for (const control of CONTROLS) {
    const seeds = seedsOf(runs, control);
    const tripped = seeds.filter((s) => values[control][s].guardTripped).map((s) => `${control} ${s}`);
    const usable = tripped.length === 0;
    const capTouched = seeds.some((s) => values[control][s].capTouched);
    controls.push({ control, usable, capTouched, guardTripped: tripped, tests: [] });
    if (!usable) continue;
    for (const id of READOUT_IDS) {
      const cv = testValues(id, col(control, id)), iv = testValues(id, inh.map((v) => v[id]));
      if (dropped[id] === undefined && cv !== null && iv !== null) pool.push({ c: controls.length - 1, id, t: mannWhitney(cv, iv, perms) });
    }
  }
  const h = holm(pool.map((q) => q.t.p), R2B.ALPHA);
  for (const [ci, c] of controls.entries()) {
    if (!c.usable) continue;
    for (const id of READOUT_IDS) {
      const k = pool.findIndex((q) => q.c === ci && q.id === id);
      if (k < 0) { c.tests.push({ readout: id, dropped: dropped[id] ?? "missing values in the control", p: null, adjusted: null, delta: null, separated: false, method: null }); continue; }
      const t = pool[k].t;
      c.tests.push({ readout: id, dropped: null, p: t.p, adjusted: h.adjusted[k], delta: t.delta, separated: h.reject[k] && Math.abs(t.delta) >= R2B.DELTA_MIN, method: t.method });
    }
  }
  if (!controls.some((c) => c.usable)) reasons.push("all positive controls are unusable (population guard)");
  const kept = READOUT_IDS.filter((id) => controls.some((c) => c.usable && c.tests.find((t) => t.readout === id)?.separated));
  if (kept.length < 2) reasons.push(`fewer than 2 readouts kept (${kept.length})`);
  else if (!passAttainable(kept)) reasons.push(`a PASS is unattainable with the kept set (${kept.join(", ")}): it needs TM or REG, and MI, so confirmation would only be able to return NOT-SEPARATED or PHYSARUM-EXPLAINS`);

  // Fisher on the binary regime proportion (REG >= 0.5), description only.
  const fisherByArm: Record<string, { on: number; off: number }> = {};
  if (tau !== null) for (const arm of [...ARMS, ...CONTROLS]) if (values[arm]) {
    const on = seedsOf(runs, arm).filter((s) => (values[arm][s].REG ?? 0) >= 0.5).length;
    fisherByArm[arm] = { on, off: seedsOf(runs, arm).length - on };
  }

  // Dev contrasts, informational (6.9): inherit against blocked and against physarum, effect sizes only.
  const devContrasts: DevContrast[] = [];
  for (const vs of ["blocked", "physarum"] as const) {
    if (!runs[vs] || (vs === "physarum" && inp.matching?.v == null)) continue;
    for (const id of READOUT_IDS) {
      if (vs === "physarum" && EXCLUDED_VS_PHYSARUM.includes(id)) continue;
      const a = testValues(id, inh.map((v) => v[id])), b = testValues(id, devSeeds.map((s) => values[vs][s]?.[id] ?? null));
      if (a === null || b === null) continue;
      const t = mannWhitney(a, b, perms);
      const e: EffectSize = effectSize(a, b, inp.boots);
      devContrasts.push({ readout: id, vs, p: t.p, delta: e.delta, deltaCI: e.deltaCI, hl: e.hl, hlCI: e.hlCI, method: t.method });
    }
  }

  // Horizon diagnostic (6.8): first-half against second-half agreement of each readout across the inherit seeds, and the drift table.
  const halfValues = halfValuesOf(runs.inherit!, devSeeds, tau);
  const halfAgreement: Record<string, number | null> = Object.fromEntries(READOUT_IDS.map((id) => [id, agreementOf(halfValues[id])]));
  const drift: Calibration["drift"] = {};
  for (const arm of [...ARMS, ...CONTROLS]) if (runs[arm]) { drift[arm] = {}; for (const s of seedsOf(runs, arm)) drift[arm][s] = halfWindowDrift(runs[arm]![s], LO, HI); }

  return {
    plan: inp.plan, devSeeds: [...devSeeds], values, regime: { classifier, regDropped: !classifier.adequate, fisherByArm }, target, physarum,
    controls, kept: [...kept], dropped, devContrasts, halfAgreement, halfValues, miInvalidMedian, miMeasurable, drift, guardTrips, verdict: reasons.length ? "MEASUREMENT-LIMITED" : "READY", reasons,
  };
}

const nan = (v: number): number | null => (Number.isFinite(v) ? v : null);

/** The binary regime proportion's exact Fisher test between two arms' counts (description only). */
export function regimeFisher(a: { on: number; off: number }, b: { on: number; off: number }): number {
  return fisherExact(a.on, a.off, b.on, b.off);
}

// ---- confirmation (8) -----------------------------------------------------------------------------------

export type Label = "INVALID" | "MEASUREMENT-LIMITED" | "NOT-SEPARATED" | "PASS" | "PHYSARUM-EXPLAINS";

export interface ContrastTest {
  readout: ReadoutId;
  p: number;
  /** Holm-adjusted within this contrast alone (descriptive: the label uses the intersection family below). */
  adjusted: number;
  reject: boolean;
  delta: number;
  deltaCI: [number, number];
  hl: number;
  hlCI: [number, number];
  method: string;
  separates: boolean;
  exposed: boolean;
}

/** One readout's intersection test (section 8): p = max(p vs blocked, p vs physarum); Holm runs over these across the readouts eligible for both contrasts. */
export interface IntersectionTest {
  readout: ReadoutId;
  pBlocked: number;
  pPhysarum: number;
  p: number;
  adjusted: number;
  reject: boolean;
  /** Rejected by Holm and |delta| at least 0.33 against both arms. */
  separates: boolean;
}

export interface Decision {
  label: Label;
  reasons: string[];
  /** The sub-cases of PHYSARUM-EXPLAINS that apply (they overlap: (d) can coincide with (a), (b) or (c)). */
  subcases: ("a" | "b" | "c" | "d")[];
  kept: ReadoutId[];
  tests: Record<"blocked" | "physarum", ContrastTest[]>;
  intersection: IntersectionTest[];
  /** Separating from blocked: Holm within the blocked contrast, plus every member of Both (a readout rejected in the stricter intersection family is rejected against blocked). */
  sepBlocked: ReadoutId[];
  /** Separating from physarum, the same way (descriptive). */
  sepPhysarum: ReadoutId[];
  /** Readouts separating from both arms: rejected by Holm over the intersection p-values. */
  both: ReadoutId[];
  /** The PASS pair found in Both (a MASS readout and MI), empty when none. */
  pair: ReadoutId[];
  /** Median fraction of invalid Moran censuses per arm (descriptive), and how many seeds of each arm have an MI (at least MI_MIN_VALID_FRACTION valid censuses). */
  miInvalid: Record<string, number | null>;
  miSeeds: Record<string, number>;
  ordering: Partial<Record<ReadoutId, "beyond" | "between">>;
  /** Per contrast: inherit / other for the median of n, sum P and TM over seeds, and whether it is beyond 25%. */
  ratios: Record<"blocked" | "physarum", { measure: string; ratio: number | null; flagged: boolean }[]>;
  /** Spearman correlations between kept readouts: over the pooled confirmation values and within each arm; pooled or within-arm |rho| above 0.8 is flagged. */
  correlations: { a: ReadoutId; b: ReadoutId; rho: number | null; within: Record<string, number | null>; flagged: boolean }[];
  values: Record<string, Record<number, RunValues>>;
  /** Half-window drift per arm and seed, and per readout the Spearman correlation between the first-half and second-half values across the inherit seeds (reported), with the half values. */
  drift: Record<string, Record<number, { TM: number | null; n: number | null; sumP: number | null }>>;
  halfAgreement: Record<string, number | null>;
  halfValues: HalfValues;
  /** Binary regime proportion (REG >= 0.5) per arm, and the exact Fisher p of inherit against each other arm (description only); empty without tau. */
  regime: Record<string, { on: number; off: number }>;
  regimeFisher: Record<string, number>;
  /** The matched null at confirmation: T (from calibration), the median d of the confirmation physarum runs in W and its ratio to T, and the median d of the inherit runs. */
  nullDeposit: { T: number | null; physarumD: number | null; ratio: number | null; inheritD: number | null; fallback: boolean };
}

export interface DecideInput {
  seeds: readonly number[];
  runs: RunSet;
  /** CALIBRATION.json's kept set and tau (null when REG was dropped), and its verdict. */
  kept: readonly ReadoutId[];
  tau: number | null;
  calibrationVerdict: string;
  calibrationReasons: readonly string[];
  /** CALIBRATION.json's target T and whether it came from the trail-on fallback (6.3); null T skips the matching check at confirmation. */
  T?: number | null;
  fallback?: boolean;
  /** Problems the loader found that make the result INVALID: ledger residual, hash or provenance mismatch, seed-log breach, CPU digest mismatch. */
  invalid: readonly string[];
  perms?: number;
  boots?: number;
}

export function decide(inp: DecideInput): Decision {
  const perms = inp.perms ?? PERMUTATIONS;
  const d: Decision = {
    label: "MEASUREMENT-LIMITED", reasons: [], subcases: [], kept: [...inp.kept], tests: { blocked: [], physarum: [] }, intersection: [], sepBlocked: [], sepPhysarum: [], both: [],
    pair: [], miInvalid: {}, miSeeds: {}, ordering: {}, ratios: { blocked: [], physarum: [] }, correlations: [], values: {}, drift: {}, halfAgreement: {}, halfValues: {},
    regime: {}, regimeFisher: {}, nullDeposit: { T: inp.T ?? null, physarumD: null, ratio: null, inheritD: null, fallback: inp.fallback === true },
  };
  // 1. INVALID.
  if (inp.invalid.length) { d.label = "INVALID"; d.reasons = [...inp.invalid]; return d; }
  // 2. MEASUREMENT-LIMITED: an incomplete batch, a guard trip, an unusable calibration, a null that is not matched.
  const missing: string[] = [];
  for (const arm of ARMS) for (const s of inp.seeds) if (inp.runs[arm]?.[s] === undefined) missing.push(`${arm} ${s}`);
  if (missing.length) d.reasons.push(`fewer runs finished than planned (missing ${missing.join(", ")})`);
  if (inp.calibrationVerdict !== "READY") d.reasons.push(`the calibration verdict is ${inp.calibrationVerdict} (${inp.calibrationReasons.join("; ")})`);
  if (inp.kept.length < 2) d.reasons.push(`fewer than 2 readouts kept (${inp.kept.length})`);
  else if (!passAttainable(inp.kept)) d.reasons.push(`a PASS is unattainable with the kept set (${inp.kept.join(", ")}): it needs TM or REG, and MI`);
  if (missing.length) return d;
  for (const arm of ARMS) {
    d.values[arm] = {};
    for (const s of inp.seeds) d.values[arm][s] = runValues(inp.runs[arm]![s], LO, HI, inp.tau);
  }
  for (const arm of ARMS) {
    d.drift[arm] = {};
    for (const s of inp.seeds) d.drift[arm][s] = halfWindowDrift(inp.runs[arm]![s], LO, HI);
  }
  d.halfValues = halfValuesOf(inp.runs.inherit!, inp.seeds, inp.tau);
  for (const id of READOUT_IDS) d.halfAgreement[id] = agreementOf(d.halfValues[id]);
  if (inp.tau !== null) {
    for (const arm of ARMS) { const on = inp.seeds.filter((s) => (d.values[arm][s].REG ?? 0) >= 0.5).length; d.regime[arm] = { on, off: inp.seeds.length - on }; }
    for (const arm of ARMS) if (arm !== "inherit") d.regimeFisher[arm] = regimeFisher(d.regime.inherit, d.regime[arm]);
  }
  const tripped = GUARDED_ARMS.flatMap((arm) => inp.seeds.filter((s) => d.values[arm][s].guardTripped).map((s) => `${arm} ${s}`));
  if (tripped.length) d.reasons.push(`population guard tripped: ${tripped.join(", ")}`);
  // The matched null must still be matched at confirmation (6.5, 6.6): its deposit in W within MATCH_GATE of T.
  const medD = (arm: AnyArm): number | null => { const xs = inp.seeds.map((s) => d.values[arm][s].d).filter((v): v is number => v !== null); return xs.length ? median(xs) : null; };
  d.nullDeposit.physarumD = medD("physarum"); d.nullDeposit.inheritD = medD("inherit");
  if (inp.T != null && inp.T > 0 && d.nullDeposit.physarumD !== null) {
    d.nullDeposit.ratio = d.nullDeposit.physarumD / inp.T;
    if (Math.abs(d.nullDeposit.ratio - 1) > R2B.MATCH_GATE) d.reasons.push(`the physarum null deposits ${d.nullDeposit.physarumD} per particle-step in W at confirmation, ${d.nullDeposit.ratio} times the target T = ${inp.T}: outside ${R2B.MATCH_GATE * 100}%, the null is not matched`);
  }
  if (d.reasons.length) return d;

  // MI is undefined for a seed with under MI_MIN_VALID_FRACTION valid censuses and is then tested over the measurable seeds of each arm, which need
  // MI_MIN_SEEDS of them: an arm that cannot supply them makes a PASS impossible, and the confirmation is MEASUREMENT-LIMITED (as when a calibration keeps no MI).
  for (const arm of ARMS) {
    const f = inp.seeds.map((s) => d.values[arm][s].moranInvalidFraction).filter((v): v is number => v !== null);
    d.miInvalid[arm] = f.length ? median(f) : null;
    d.miSeeds[arm] = inp.seeds.filter((s) => d.values[arm][s].MI !== null).length;
  }
  const thin = ARMS.filter((arm) => d.miSeeds[arm] < R2B.MI_MIN_SEEDS);
  if (inp.kept.includes("MI") && thin.length) {
    d.reasons.push(`MI is measurable (every one of the window's heavy censuses valid) in only ${thin.map((a) => `${d.miSeeds[a]} ${a} seeds`).join(", ")} (need ${R2B.MI_MIN_SEEDS} per arm): the structure readout of a PASS cannot be tested`);
    return d;
  }
  const col = (arm: AnyArm, id: ReadoutId): number[] => {
    const vs = inp.seeds.map((s) => d.values[arm][s][id]);
    if (id === "MI") return vs.filter((v): v is number => v !== null);
    return vs.map((v, k) => { if (v === null) throw new Error(`${arm} ${inp.seeds[k]} has no ${id}`); return v; });
  };
  // Tests (one function, section 8). Per contrast: Mann-Whitney per kept readout eligible for it, with Holm within the contrast (descriptive).
  const mwBy: Record<"blocked" | "physarum", Map<ReadoutId, MannWhitney>> = { blocked: new Map(), physarum: new Map() };
  const sepWithin: Record<"blocked" | "physarum", Set<ReadoutId>> = { blocked: new Set(), physarum: new Set() };
  for (const vs of ["blocked", "physarum"] as const) {
    const eligible = inp.kept.filter((id) => !(vs === "physarum" && EXCLUDED_VS_PHYSARUM.includes(id)));
    const mw = eligible.map((id) => mannWhitney(col("inherit", id), col(vs, id), perms));
    const h = holm(mw.map((t) => t.p), R2B.ALPHA);
    eligible.forEach((id, k) => {
      const e = effectSize(col("inherit", id), col(vs, id), inp.boots);
      const t = mw[k];
      mwBy[vs].set(id, t);
      const sep = h.reject[k] && Math.abs(t.delta) >= R2B.DELTA_MIN;
      if (sep) sepWithin[vs].add(id);
      d.tests[vs].push({ readout: id, p: t.p, adjusted: h.adjusted[k], reject: h.reject[k], delta: t.delta, deltaCI: e.deltaCI, hl: e.hl, hlCI: e.hlCI, method: t.method, separates: sep, exposed: vs === "physarum" && EXPOSED_VS_PHYSARUM.includes(id) });
    });
  }
  // The decision: per readout the intersection p (the larger of the two contrasts' p: the readout separates from BOTH arms only if the
  // weaker of the two separations is real), then one Holm over the readouts eligible for both contrasts. Two separate Holm families do not
  // control "separates from both" (a false rejection in either family puts a non-exposed readout into Both).
  const both = inp.kept.filter((id) => mwBy.physarum.has(id));
  const ip = both.map((id) => Math.max(mwBy.blocked.get(id)!.p, mwBy.physarum.get(id)!.p));
  const ih = holm(ip, R2B.ALPHA);
  both.forEach((id, k) => {
    const sep = ih.reject[k] && Math.abs(mwBy.blocked.get(id)!.delta) >= R2B.DELTA_MIN && Math.abs(mwBy.physarum.get(id)!.delta) >= R2B.DELTA_MIN;
    d.intersection.push({ readout: id, pBlocked: mwBy.blocked.get(id)!.p, pPhysarum: mwBy.physarum.get(id)!.p, p: ip[k], adjusted: ih.adjusted[k], reject: ih.reject[k], separates: sep });
    if (sep) d.both.push(id);
  });
  d.sepBlocked = inp.kept.filter((id) => sepWithin.blocked.has(id) || d.both.includes(id));
  d.sepPhysarum = inp.kept.filter((id) => sepWithin.physarum.has(id) || d.both.includes(id));
  for (const id of d.both) {
    const hb = d.tests.blocked.find((t) => t.readout === id)!.hl, hp = d.tests.physarum.find((t) => t.readout === id)!.hl;
    d.ordering[id] = Math.sign(hb) === Math.sign(hp) ? "beyond" : "between";
  }
  // Ratios and correlations (reported, they condition nothing).
  const med = (arm: AnyArm, f: (v: RunValues) => number | null): number | null => {
    const xs = inp.seeds.map((s) => f(d.values[arm][s])).filter((v): v is number => v !== null);
    return xs.length ? median(xs) : null;
  };
  for (const vs of ["blocked", "physarum"] as const) {
    for (const [measure, f] of [["n", (v: RunValues) => v.meanN], ["sum P", (v: RunValues) => v.meanSumP], ["TM", (v: RunValues) => v.TM]] as const) {
      const a = med("inherit", f), b = med(vs, f);
      const ratio = a === null || b === null || b === 0 ? null : a / b;
      d.ratios[vs].push({ measure, ratio, flagged: ratio === null || Math.abs(ratio - 1) > R2B.RATIO_FLAG });
    }
  }
  const rho = (a: (number | null)[], b: (number | null)[]): number | null => (a.some((v) => v === null) || b.some((v) => v === null) ? null : nan(spearman(a as number[], b as number[])));
  const pooled = (id: ReadoutId): (number | null)[] => ARMS.flatMap((arm) => inp.seeds.map((s) => d.values[arm][s][id]));
  const within = (arm: AnyArm, id: ReadoutId): (number | null)[] => inp.seeds.map((s) => d.values[arm][s][id]);
  for (let i = 0; i < inp.kept.length; i++) for (let j = i + 1; j < inp.kept.length; j++) {
    const a = inp.kept[i], b = inp.kept[j];
    const r = rho(pooled(a), pooled(b));
    const w = Object.fromEntries(ARMS.map((arm) => [arm, rho(within(arm, a), within(arm, b))]));
    d.correlations.push({ a, b, rho: r, within: w, flagged: (r !== null && Math.abs(r) > R2B.CORR_FLAG) || Object.values(w).some((x) => x !== null && Math.abs(x) > R2B.CORR_FLAG) });
  }
  // 3-5. Labels in order.
  if (d.sepBlocked.length === 0) { d.label = "NOT-SEPARATED"; return d; }
  d.pair = passPair(d.both);
  if (d.pair.length) { d.label = "PASS"; return d; }
  d.label = "PHYSARUM-EXPLAINS";
  const nonExposed = d.both.filter((id) => NON_EXPOSED.includes(id));
  if (d.both.length === 0) d.subcases.push("a");
  else if (nonExposed.length === 0) d.subcases.push("b");
  else d.subcases.push("c");
  if (d.sepBlocked.length === 1) d.subcases.push("d");
  return d;
}

// ---- agreement between two analyses (section 9) ---------------------------------------------------------------

/** What an independent analysis must reproduce: the label, the sets and every test's p, adjusted p, delta and Hodges-Lehmann shift. */
export interface DecisionSummary {
  format: "mycelium-r2b-summary-1";
  label: Label;
  subcases: string[];
  kept: string[];
  both: string[];
  sepBlocked: string[];
  sepPhysarum: string[];
  tests: Record<"blocked" | "physarum", { readout: string; p: number; adjusted: number; delta: number; hl: number; method: string }[]>;
  intersection: { readout: string; p: number; adjusted: number }[];
}

export const summaryOf = (d: Decision): DecisionSummary => ({
  format: "mycelium-r2b-summary-1", label: d.label, subcases: [...d.subcases], kept: [...d.kept], both: [...d.both], sepBlocked: [...d.sepBlocked], sepPhysarum: [...d.sepPhysarum],
  tests: {
    blocked: d.tests.blocked.map((t) => ({ readout: t.readout, p: t.p, adjusted: t.adjusted, delta: t.delta, hl: t.hl, method: t.method })),
    physarum: d.tests.physarum.map((t) => ({ readout: t.readout, p: t.p, adjusted: t.adjusted, delta: t.delta, hl: t.hl, method: t.method })),
  },
  intersection: d.intersection.map((t) => ({ readout: t.readout, p: t.p, adjusted: t.adjusted })),
});

/**
 * The tolerance of section 9, stated once. Equal: the label, the sub-cases, the kept set, Both, both separation sets, the method of every test,
 * every delta (to 1e-9) and every Hodges-Lehmann shift (to 1e-9 relative). An exact p (no ties) and its adjusted values agree to 1e-9 relative. A
 * Monte Carlo p cannot be reproduced without the repo's counter-based PRNG, so two analyses agree when they differ by at most five standard errors
 * of the difference of two independent estimates, 5 sqrt(2 p (1 - p) / perms), plus 2 / perms; adjusted and intersection p-values get that
 * bound times the family size. The label and the sets above must still be equal, so a Monte Carlo difference cannot move a label unnoticed.
 */
export function agreementProblems(a: DecisionSummary, b: DecisionSummary, perms: number = PERMUTATIONS): string[] {
  const bad: string[] = [];
  const same = (what: string, x: unknown, y: unknown) => { if (JSON.stringify(x) !== JSON.stringify(y)) bad.push(`${what} differ: ${JSON.stringify(x)} against ${JSON.stringify(y)}`); };
  const num = (what: string, x: unknown, y: unknown): [number, number] | null => {
    if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) { bad.push(`${what}: a missing or non-finite number (${JSON.stringify(x)} against ${JSON.stringify(y)})`); return null; }
    return [x, y];
  };
  if (b.format !== a.format) bad.push(`the other analysis has format ${b.format}`);
  same("labels", a.label, b.label);
  same("sub-cases", a.subcases, b.subcases);
  same("kept sets", a.kept, b.kept);
  same("Both", a.both, b.both);
  same("separating-from-blocked sets", a.sepBlocked, b.sepBlocked);
  same("separating-from-physarum sets", a.sepPhysarum, b.sepPhysarum);
  const pTol = (x: number, y: number, method: string, m: number): number => {
    if (method === "exact" || method === "degenerate") return m * 1e-9 * Math.max(x, y);
    const pm = (x + y) / 2;
    return m * (5 * Math.sqrt((2 * pm * (1 - pm)) / perms) + 2 / perms);
  };
  // Every comparison is written as "not within tolerance", so a missing or NaN value cannot pass by making a comparison false.
  for (const vs of ["blocked", "physarum"] as const) {
    const ta = a.tests[vs], tb = b.tests?.[vs];
    if (!Array.isArray(tb) || ta.length !== tb.length) { bad.push(`${vs}: ${ta.length} tests against ${Array.isArray(tb) ? tb.length : "none"}`); continue; }
    const m = ta.length;
    ta.forEach((t, k) => {
      const u = tb[k];
      const at = `${vs} ${t.readout}`;
      if (u.readout !== t.readout) { bad.push(`${at}: the other analysis has ${u.readout} in this place`); return; }
      if (u.method !== t.method) bad.push(`${at}: method ${t.method} against ${u.method}`);
      const dl = num(`${at} delta`, t.delta, u.delta); if (dl && !(Math.abs(dl[0] - dl[1]) <= 1e-9)) bad.push(`${at}: delta ${t.delta} against ${u.delta}`);
      const hl = num(`${at} Hodges-Lehmann`, t.hl, u.hl); if (hl && !(Math.abs(hl[0] - hl[1]) <= 1e-9 * Math.max(1, Math.abs(hl[0])))) bad.push(`${at}: Hodges-Lehmann ${t.hl} against ${u.hl}`);
      const p = num(`${at} p`, t.p, u.p); if (p && !(Math.abs(p[0] - p[1]) <= pTol(p[0], p[1], t.method, 1))) bad.push(`${at}: p ${t.p} against ${u.p}`);
      const aj = num(`${at} adjusted p`, t.adjusted, u.adjusted); if (aj && !(Math.abs(aj[0] - aj[1]) <= pTol(aj[0], aj[1], t.method, m))) bad.push(`${at}: adjusted p ${t.adjusted} against ${u.adjusted}`);
    });
  }
  const ia = a.intersection, ib = b.intersection;
  if (!Array.isArray(ib) || ia.length !== ib.length) bad.push(`intersection family: ${ia.length} tests against ${Array.isArray(ib) ? ib.length : "none"}`);
  else {
    const m = ia.length;
    ia.forEach((t, k) => {
      const u = ib[k];
      if (u.readout !== t.readout) { bad.push(`intersection ${t.readout}: the other analysis has ${u.readout} in this place`); return; }
      const mc = a.tests.blocked.concat(a.tests.physarum).some((x) => x.readout === t.readout && x.method === "permutation");
      const method = mc ? "permutation" : "exact";
      const p = num(`intersection ${t.readout} p`, t.p, u.p); if (p && !(Math.abs(p[0] - p[1]) <= pTol(p[0], p[1], method, 1))) bad.push(`intersection ${t.readout}: p ${t.p} against ${u.p}`);
      const aj = num(`intersection ${t.readout} adjusted p`, t.adjusted, u.adjusted); if (aj && !(Math.abs(aj[0] - aj[1]) <= pTol(aj[0], aj[1], method, m))) bad.push(`intersection ${t.readout}: adjusted p ${t.adjusted} against ${u.adjusted}`);
    });
  }
  return bad;
}
