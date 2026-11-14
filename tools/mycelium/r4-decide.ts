// Mycelium rung R4: per-run readouts, the gates, the label and the attainability helpers
// (docs/mycelium-r4-2026-11-14/PROTOCOL.md sections 4-8). Pure functions, no Deno, no clock; every random draw comes from the repo's
// counter-based PRNG with a key fixed here or in r2b-stats (the Mann-Whitney permutations and the bootstrap keys).
//
// Deliberately NOT r2b-decide.ts (open Sol P1 about mass-filtered Moran's I). R4 uses readouts that are defined at zero trail and
// decides from lesion contrasts anchored to a physarum reference, with an equivalence rule for the null pattern.
import { cellBase, draw } from "@bl/schema";
import { runValues } from "./observe-r2b.ts";
import { type R4Series, r4SeriesProblems, r4WindowMeans } from "./observe-r4.ts";
import { seriesProblems } from "./observe-r2b.ts";
import { cliffsDelta, effectSize, fisherExact, holm, mannWhitney, median } from "./r2b-stats.ts";
import { armConfig, PROTOCOL_ID, R4, type R4Arm } from "./r4-protocol.ts";

// ---- per-run readouts -----------------------------------------------------------------------------------------

export interface RunReadout {
  arm: R4Arm;
  /** The registered slot. */
  slot: number;
  /** Late-window means (50,000, 100,000]: trail per particle, and the trail-use readouts (observe-r4.ts). */
  tmL: number;
  align: number;
  alignBlind: number;
  acute: number;
  occ: number;
  occShift: number;
  req1: number;
  req2p: number;
  sat: number;
  speed: number;
  speedBlind: number;
  sensMove: number;
  sensAll: number;
  /** Late-window life-history readouts (R2b's): deposit measure d, mean population, turnover, median age. */
  d: number;
  n: number;
  turn: number;
  age: number;
  /** Mid-window (10,000, 20,000] trail per particle (descriptive). */
  tmM: number;
  /** n < 200 at any scalar census of the late window. */
  guard: boolean;
}

/** A run is "in the toll state" when its late trail per particle is at least IN_STATE_TM (section 4); readouts of use are compared among such runs. */
export const IN_STATE_TM = R4.IN_STATE_TM;
export const kept = (r: RunReadout): boolean => r.tmL >= IN_STATE_TM;

/** The readouts of one stored series over the late window (lLo, lHi] and the mid window (mLo, mHi]. */
export function readoutsOfWindows(arm: R4Arm, slot: number, ser: R4Series, lLo: number, lHi: number, mLo: number, mHi: number): RunReadout {
  const L = runValues(ser, lLo, lHi, null), M = runValues(ser, mLo, mHi, null), w = r4WindowMeans(ser, lLo, lHi);
  if (w === null || L.TM === null || L.d === null || M.TM === null || L.meanN === null) throw new Error(`${arm} ${slot}: a window has no census`);
  return {
    arm, slot, tmL: L.TM, align: w.align, alignBlind: w.alignBlind, acute: w.acute, occ: w.occ, occShift: w.occShift, req1: w.req1, req2p: w.req2p, sat: w.sat,
    speed: w.speed, speedBlind: w.speedBlind, sensMove: w.sensMove, sensAll: w.sensAll, d: L.d, n: L.meanN,
    // Median age and turnover are undefined when no particle lives through the window (R2b's runValues gives null); the run is recorded with 0 for both and
    // is guard-flagged (n < 200), so an extinct run is stored, counted in retention and visible to the population guard.
    turn: L.TURN ?? 0, age: L.AGE ?? 0, tmM: M.TM, guard: L.guardTripped,
  };
}

/** The protocol's windows: L = (50,000, 100,000], M = (10,000, 20,000]. */
export const readoutsOf = (arm: R4Arm, slot: number, ser: R4Series): RunReadout => readoutsOfWindows(arm, slot, ser, R4.L_LO, R4.STEPS, R4.M_LO, R4.M_HI);

const by = (runs: readonly RunReadout[], arm: R4Arm): RunReadout[] => runs.filter((r) => r.arm === arm).sort((a, b) => a.slot - b.slot);
const col = (rs: readonly RunReadout[], k: keyof RunReadout): number[] => rs.map((r) => r[k] as number);

// ---- one-sample bootstrap -------------------------------------------------------------------------------------------

/** 95% percentile bootstrap interval of the median of x: `boots` resamples with indices draw(cellBase(key, b, 0), i) % n (fixed key). */
export function medianCI(x: readonly number[], boots: number = R4.BOOTS, key: number = R4.BOOT_KEY1): [number, number] {
  const n = x.length, ms: number[] = [], buf = new Array<number>(n);
  for (let b = 0; b < boots; b++) {
    const base = cellBase(key, b, 0);
    for (let i = 0; i < n; i++) buf[i] = x[draw(base, i) % n];
    ms.push(median(buf));
  }
  ms.sort((a, b) => a - b);
  return [ms[Math.floor(0.025 * boots)], ms[Math.min(boots - 1, Math.ceil(0.975 * boots) - 1)]];
}

// ---- the decision ---------------------------------------------------------------------------------------------------

export type Label = "FUNCTIONAL" | "TOLL-ONLY" | "MINOR-USE" | "INCONCLUSIVE";
export type Status = "USE" | "SMALL" | "WRONG" | "EQUIV" | "UNRESOLVED";

/** The fixed margins: THETA times the dev anchor spans (PROTOCOL.md section 6). Computed once at calibration, stored in CALIBRATION.json, read by the confirmation. */
export interface Margins { align: number; occ: number; acute: number; sens: number }

export interface Endpoint {
  id: "ALIGN" | "OCC" | "ACUTE" | "SENS";
  /** ALIGN, OCC: inherit minus blind, the Hodges-Lehmann shift. ACUTE, SENS: the median over in-state inherit runs (a blind arm's value is 0 by construction). */
  shift: number;
  ci: [number, number];
  /** Cliff's delta, raw and Holm-adjusted p of inherit against blind (ACUTE and SENS have no two-sample test; null). */
  delta: number | null;
  p: number | null;
  adjusted: number | null;
  reject: boolean;
  margin: number;
  status: Status;
}

export interface Options { perms?: number; boots?: number }

export interface Decision {
  label: Label;
  /** Runs in the toll state per arm (of n). */
  counts: Record<R4Arm, { n: number; kept: number }>;
  gates: { S: { ok: boolean; why: string[] }; G: { ok: boolean; why: string[] } };
  /** The confirmation's own anchor (physarum minus blind, in-state): used by gate G only; the margins are the fixed ones. */
  anchor: { spanAlign: number | null; spanOcc: number | null; acute: number | null; sens: number | null; deltaAlign: number | null; deltaOcc: number | null };
  margins: Margins;
  endpoints: Endpoint[];
  floor: { req1: number | null; req2p: number | null; sat: number | null; ok: boolean };
  retention: { inherit: string; blind: string; fisherP: number | null; differs: boolean };
  match: { inheritD: number | null; physarumD: number | null; ratio: number | null; inBand: boolean | null };
  secondary: { id: string; deltaVsBlind: number | null; p: number | null }[];
  guard: { tripped: { arm: string; slot: number }[]; labelWithout: Label | null; sensitive: boolean };
  reasons: string[];
}

/** The minimum number of runs in the toll state in each of inherit, blind and physarum for the label to be read (gate S). */
export const MIN_IN_STATE = R4.MIN_IN_STATE;

/** The anchor of a set of runs (in-state physarum against in-state blind), or null when an arm has no in-state run. */
export function anchorOf(runs: readonly RunReadout[]) {
  const IBk = by(runs, "blind").filter(kept), PHk = by(runs, "physarum").filter(kept);
  if (!IBk.length || !PHk.length) return null;
  return {
    spanAlign: median(col(PHk, "align")) - median(col(IBk, "align")), spanOcc: median(col(PHk, "occ")) - median(col(IBk, "occ")),
    acute: median(col(PHk, "acute")), sens: median(col(PHk, "sensAll")),
    deltaAlign: cliffsDelta(col(PHk, "align"), col(IBk, "align")), deltaOcc: cliffsDelta(col(PHk, "occ"), col(IBk, "occ")),
  };
}

/** The fixed margins from a set of runs (the dev runs, at calibration): THETA times each anchor quantity. */
export function marginsOf(runs: readonly RunReadout[]): Margins {
  const a = anchorOf(runs);
  if (!a) throw new Error("no anchor: blind or physarum has no run in the toll state");
  return { align: R4.THETA * a.spanAlign, occ: R4.THETA * a.spanOcc, acute: R4.THETA * a.acute, sens: R4.THETA * a.sens };
}

function core(runs: readonly RunReadout[], margins: Margins, opt: Options): Omit<Decision, "guard"> {
  const arms = ["inherit", "blocked", "physarum", "blind", "keyless"] as const;
  const counts = Object.fromEntries(arms.map((a) => { const r = by(runs, a); return [a, { n: r.length, kept: r.filter(kept).length }]; })) as Decision["counts"];
  const I = by(runs, "inherit"), IB = by(runs, "blind"), PH = by(runs, "physarum");
  const Ik = I.filter(kept), IBk = IB.filter(kept), PHk = PH.filter(kept);
  const reasons: string[] = [];
  const out: Omit<Decision, "guard"> = {
    label: "INCONCLUSIVE", counts, gates: { S: { ok: false, why: [] }, G: { ok: false, why: [] } },
    anchor: { spanAlign: null, spanOcc: null, acute: null, sens: null, deltaAlign: null, deltaOcc: null }, margins, endpoints: [],
    floor: { req1: null, req2p: null, sat: null, ok: false }, retention: { inherit: `${counts.inherit.kept}/${counts.inherit.n}`, blind: `${counts.blind.kept}/${counts.blind.n}`, fisherP: null, differs: false },
    match: { inheritD: null, physarumD: null, ratio: null, inBand: null }, secondary: [], reasons,
  };

  // Retention (a warning test and a TOLL-ONLY / MINOR-USE condition): kept counts, inherit against blind (Fisher exact, two-sided). Passing it means "no detected difference".
  if (I.length && IB.length) {
    const p = fisherExact(counts.inherit.kept, counts.inherit.n - counts.inherit.kept, counts.blind.kept, counts.blind.n - counts.blind.kept);
    out.retention = { ...out.retention, fisherP: p, differs: p < R4.ALPHA };
  }
  // Match (reported; a calibration gate): realised late d of physarum against inherit's, in-state runs.
  if (Ik.length && PHk.length) {
    const di = median(col(Ik, "d")), dp = median(col(PHk, "d"));
    out.match = { inheritD: di, physarumD: dp, ratio: di > 0 ? dp / di : null, inBand: di > 0 ? Math.abs(dp / di - 1) <= R4.MATCH_BAND : null };
  }
  // Gate S: enough runs in the toll state in the three arms the label reads.
  const sWhy: string[] = [];
  for (const [name, k] of [["inherit", Ik], ["blind", IBk], ["physarum", PHk]] as const) if (k.length < MIN_IN_STATE) sWhy.push(`${name}: ${k.length} runs in the toll state (needs ${MIN_IN_STATE})`);
  out.gates.S = { ok: sWhy.length === 0, why: sWhy };
  if (!out.gates.S.ok) { reasons.push(`gate S: ${sWhy.join("; ")}`); return out; }

  // Gate G: the anchor still shows use in this dataset: physarum above blind on both readouts, a large span, an acute effect.
  const a = anchorOf(runs)!;
  out.anchor = a;
  const gWhy: string[] = [];
  if (!(a.deltaAlign >= R4.ANCHOR_DELTA)) gWhy.push(`ALIGN: physarum above blind with delta ${a.deltaAlign.toFixed(3)} (needs ${R4.ANCHOR_DELTA})`);
  if (!(a.deltaOcc >= R4.ANCHOR_DELTA)) gWhy.push(`OCC: physarum above blind with delta ${a.deltaOcc.toFixed(3)} (needs ${R4.ANCHOR_DELTA})`);
  if (!(a.spanAlign >= R4.ANCHOR_MIN_SPAN_ALIGN)) gWhy.push(`ALIGN span ${a.spanAlign.toFixed(3)} (needs ${R4.ANCHOR_MIN_SPAN_ALIGN})`);
  if (!(a.spanOcc >= R4.ANCHOR_MIN_SPAN_OCC)) gWhy.push(`OCC span ${a.spanOcc.toFixed(3)} (needs ${R4.ANCHOR_MIN_SPAN_OCC})`);
  if (!(a.acute >= R4.ANCHOR_MIN_ACUTE)) gWhy.push(`physarum acute effect ${a.acute.toFixed(3)} (needs ${R4.ANCHOR_MIN_ACUTE})`);
  out.gates.G = { ok: gWhy.length === 0, why: gWhy };
  if (!out.gates.G.ok) { reasons.push(`gate G: ${gWhy.join("; ")}`); return out; }

  // The two lesion tests (Holm over ALIGN and OCC) and the intervals, against the FIXED margins.
  const boots = opt.boots ?? R4.BOOTS;
  const mw = [mannWhitney(col(Ik, "align"), col(IBk, "align"), opt.perms), mannWhitney(col(Ik, "occ"), col(IBk, "occ"), opt.perms)];
  const h = holm(mw.map((m) => m.p), R4.ALPHA);
  const eff = [effectSize(col(Ik, "align"), col(IBk, "align"), boots), effectSize(col(Ik, "occ"), col(IBk, "occ"), boots)];
  const mAt = [margins.align, margins.occ];
  const dm = (m: number) => R4.DETECT * m;
  const statusOf = (reject: boolean, delta: number, ci: [number, number], m: number): Status => {
    if (reject && delta >= R4.DELTA_FLOOR && ci[0] > m) return "USE";
    if (reject && delta >= R4.DELTA_FLOOR && ci[0] > dm(m) && ci[1] < m) return "SMALL";
    if (reject && delta <= -R4.DELTA_FLOOR && ci[1] < -dm(m)) return "WRONG";
    return ci[0] > -m && ci[1] < m ? "EQUIV" : "UNRESOLVED";
  };
  const eps: Endpoint[] = (["ALIGN", "OCC"] as const).map((id, i) => ({
    id, shift: eff[i].hl, ci: eff[i].hlCI, delta: mw[i].delta, p: mw[i].p, adjusted: h.adjusted[i], reject: h.reject[i], margin: mAt[i],
    status: statusOf(h.reject[i], mw[i].delta, eff[i].hlCI, mAt[i]),
  }));
  // ACUTE: inherit's own acute lesion effect (signed; its counterpart in a blind arm is 0 by construction): median and bootstrap interval, no two-sample test.
  const ac = col(Ik, "acute"), acMed = median(ac), acCI = medianCI(ac, boots);
  const mAc = margins.acute;
  const acStatus: Status = acCI[0] > mAc ? "USE" : acCI[1] < -dm(mAc) ? "WRONG" : acCI[0] > -mAc && acCI[1] < mAc ? (acCI[0] > dm(mAc) ? "SMALL" : "EQUIV") : "UNRESOLVED";
  eps.push({ id: "ACUTE", shift: acMed, ci: acCI, delta: null, p: null, adjusted: null, reject: false, margin: mAc, status: acStatus });
  // SENS: general dependence of the five outputs on the gradient inputs (never negative, and a controller that never saw the gradient still shows a small
  // positive value, so there is no SMALL): USE when the interval is above the margin, EQUIV when it is provably below it.
  const se = col(Ik, "sensAll"), seMed = median(se), seCI = medianCI(se, boots, R4.BOOT_KEY1 + 1);
  const mSe = margins.sens;
  eps.push({ id: "SENS", shift: seMed, ci: seCI, delta: null, p: null, adjusted: null, reject: false, margin: mSe, status: seCI[0] > mSe ? "USE" : seCI[1] < mSe ? "EQUIV" : "UNRESOLVED" });
  out.endpoints = eps;

  // The floor: inherit's medians of req1, req2p and sat among runs in the toll state.
  const fl = { req1: median(col(Ik, "req1")), req2p: median(col(Ik, "req2p")), sat: median(col(Ik, "sat")) };
  out.floor = { ...fl, ok: fl.req1 >= R4.FLOOR_REQ1 && fl.req2p <= R4.FLOOR_REQ2P && fl.sat >= R4.FLOOR_SAT };

  // Secondary lesion contrasts among runs in the toll state: descriptive only, never in the label.
  out.secondary = (["n", "turn", "age", "d", "tmL", "speed"] as const).map((id) => {
    const m = mannWhitney(col(Ik, id), col(IBk, id), opt.perms);
    return { id, deltaVsBlind: m.delta, p: m.p };
  });

  const st = eps.map((e) => `${e.id} ${e.status}`).join(", ");
  const noUse = eps.every((e) => e.status === "EQUIV"), traceOnly = eps.every((e) => e.status === "EQUIV" || e.status === "SMALL");
  if (eps.every((e) => e.status === "USE")) {
    out.label = "FUNCTIONAL";
    reasons.push(`ALIGN, OCC, ACUTE and SENS all show use, each with a 95% interval above its margin (${st})`);
  } else if (noUse && out.floor.ok && !out.retention.differs) {
    out.label = "TOLL-ONLY";
    reasons.push(`every endpoint is provably within the margin of no use, the state sits at the floor, and no retention difference is detected (${st})`);
  } else if (traceOnly && out.floor.ok && !out.retention.differs) {
    out.label = "MINOR-USE";
    reasons.push(`a detectable trace of use that is provably below the margin on every endpoint, the state sits at the floor, and no retention difference is detected (${st})`);
  } else {
    const why: string[] = [`endpoints: ${st}`];
    if (traceOnly) {
      if (!out.floor.ok) why.push("no use above the margin, but the state is not at the floor (req1, req2p or sat outside their bounds)");
      if (out.retention.differs) why.push(`no use above the margin, but a retention difference is detected (inherit ${out.retention.inherit}, blind ${out.retention.blind}, Fisher p ${out.retention.fisherP?.toFixed(4)})`);
    }
    reasons.push(...why);
  }
  return out;
}

/**
 * The label (section 6), against fixed margins. FUNCTIONAL: ALIGN and OCC (inherit above blind: Holm over the two, Cliff's delta at least 0.5 and the 95%
 * interval of the Hodges-Lehmann shift above the margin), ACUTE (the acute lesion effect, interval above its margin) and SENS (general dependence, interval above
 * its margin) all show use. TOLL-ONLY: all four are provably within the margin (95% interval inside), the state is at the floor and no retention difference is
 * detected. MINOR-USE: the same, but at least one endpoint is detectably above no use (Holm-significant with |delta| at least 0.5 and the interval above a quarter of the margin, or an acute-effect interval above a quarter of
 * the margin) while its 95% interval stays below the margin. A difference below that quarter-margin detection floor is EQUIV: a random controller's dependence on inputs it
 * was never selected on is small but not exactly 0, and that baseline is not use. Anything else, gates included, is INCONCLUSIVE. If a run tripped the population guard the label is
 * recomputed without the tripped runs and must agree, or the label is INCONCLUSIVE.
 */
export function decide(runs: readonly RunReadout[], margins: Margins, opt: Options = {}): Decision {
  const main = core(runs, margins, opt);
  const tripped = runs.filter((r) => r.guard).map((r) => ({ arm: r.arm as string, slot: r.slot }));
  let label = main.label;
  const reasons = [...main.reasons];
  let without: Label | null = null;
  if (tripped.length) {
    without = core(runs.filter((r) => !r.guard), margins, opt).label;
    if (without !== main.label) { label = "INCONCLUSIVE"; reasons.push(`the label changes (${main.label} with, ${without} without) when ${tripped.length} guard-tripped run(s) are removed`); }
  }
  return { ...main, label, reasons, guard: { tripped, labelWithout: without, sensitive: without !== null && without !== main.label } };
}

// ---- attainability helpers (section 8) ----------------------------------------------------------------------------

/** Relabels every run of arm `from` as arm `to` (slots kept). */
export const relabel = (runs: readonly RunReadout[], from: R4Arm, to: R4Arm): RunReadout[] => runs.map((r) => (r.arm === from ? { ...r, arm: to } : r));

/** Resamples `n` runs with replacement from a pool (fixed key), relabelled with consecutive slots. */
export function resample(pool: readonly RunReadout[], n: number, key: number, stream: number, arm: R4Arm): RunReadout[] {
  const base = cellBase(key, stream, 0);
  return Array.from({ length: n }, (_, i) => ({ ...pool[draw(base, i) % pool.length], arm, slot: 7001 + i }));
}

const lerp = (a: number, b: number, l: number) => a + l * (b - a);

/**
 * The pools for the synthetic scenarios: the full pools (retention, the comparison arms) and the donor pools of runs in the toll state, from which the use readouts of a
 * synthetic inherit run are drawn (the comparison is among runs in the toll state, so a lost world must never donate a use readout to a kept one).
 */
export function donors(pools: Record<R4Arm, readonly RunReadout[]>) {
  const k = (a: R4Arm) => {
    const d = pools[a].filter(kept);
    if (!d.length) throw new Error(`no ${a} run in the toll state to donate readouts`);
    return d;
  };
  return { inherit: pools.inherit.filter(kept), blind: k("blind"), physarum: k("physarum"), blocked: k("blocked") };
}

export interface PlantOptions {
  /** Build exactly this many runs in the toll state in each of inherit, blind and physarum (the rest are lost worlds), instead of the pools' own mix. */
  keptCount?: number;
}

/**
 * A planted dataset: n runs per arm resampled from the dev pools, except the use readouts of inherit. For the i-th inherit run an inherit run h (which supplies
 * everything that is not a use readout: retention, the floor columns, life history), a blind run b, a physarum run p and a blocked run r are drawn, the last three from
 * the donors in the toll state, and the planted effect is added on top of a no-use baseline:
 *   `{ lambda }`: ALIGN and OCC = b + lambda (p - b); ACUTE, SENS = r + lambda p. lambda 0 is the explicit joint no-use null (r is a blocked run: random controllers never
 *   selected on the trail, the no-selection baseline of dependence on inputs 3 and 4, small but not exactly 0); lambda 1 gives physarum's use.
 *   `{ atMargin: f }`: every endpoint's true value is f times its own fixed margin: ALIGN = b + f m_align, OCC = b + f m_occ, ACUTE = f m_acute + (r - median blocked ACUTE),
 *   SENS = f m_sens + (r - median blocked SENS); f 1 puts every estimand exactly on its margin (the boundary the intervals must not cross), f 0 on the no-use baseline.
 */
export function planted(
  pools: Record<R4Arm, readonly RunReadout[]>, n: number, key: number, effect: { lambda: number } | { atMargin: number; margins: Margins }, opt: PlantOptions = {},
): RunReadout[] {
  const dn = donors(pools);
  const pick = <T>(pool: readonly T[], stream: number, i: number): T => pool[draw(cellBase(key, stream, 0), i) % pool.length];
  const kc = opt.keptCount;
  const lost = (r: RunReadout): RunReadout => ({ ...r, tmL: 0.1 });
  const medAc = median(col(dn.blocked, "acute")), medSe = median(col(dn.blocked, "sensAll"));
  const inherit = Array.from({ length: n }, (_, i) => {
    const h0 = kc === undefined ? pick(pools.inherit, 89, i) : i < kc ? pick(dn.inherit.length ? dn.inherit : pools.inherit, 89, i) : lost(pick(pools.inherit, 89, i));
    const b = pick(dn.blind, 90, i), p = pick(dn.physarum, 91, i), r = pick(dn.blocked, 88, i);
    const use = "lambda" in effect
      ? { align: lerp(b.align, p.align, effect.lambda), occ: lerp(b.occ, p.occ, effect.lambda), acute: r.acute + effect.lambda * p.acute, sensAll: r.sensAll + effect.lambda * p.sensAll, sensMove: r.sensMove + effect.lambda * p.sensMove }
      : { align: b.align + effect.atMargin * effect.margins.align, occ: b.occ + effect.atMargin * effect.margins.occ, acute: effect.atMargin * effect.margins.acute + (r.acute - medAc), sensAll: effect.atMargin * effect.margins.sens + (r.sensAll - medSe), sensMove: r.sensMove };
    return { ...h0, arm: "inherit" as R4Arm, slot: 7001 + i, ...use, alignBlind: b.alignBlind };
  });
  const arm = (a: R4Arm, s: number): RunReadout[] => {
    const rs = resample(pools[a], n, key, s, a);
    if (kc === undefined || (a !== "blind" && a !== "physarum")) return rs;
    return rs.map((r, i) => (i < kc ? { ...pick(dn[a], 80 + s, i), arm: a, slot: 7001 + i } : lost(r)));
  };
  return [...inherit, ...(["blocked", "physarum", "blind", "keyless"] as const).flatMap((a, s) => arm(a, s))];
}

/**
 * A label-permutation dataset for U1 and U2 only: the inherit and blind readouts of the pool are pooled and dealt back at random (fixed key), so no
 * between-arm contrast exists; the first n dealt runs become inherit and the next n blind. It is NOT a null for ACUTE or SENS (inherit's own values travel with the
 * runs): use `planted(..., 0)` for the joint no-use null.
 */
export function dealt(pools: Record<R4Arm, readonly RunReadout[]>, n: number, key: number): RunReadout[] {
  const pool = [...pools.inherit, ...pools.blind];
  if (pool.length < 2 * n) throw new Error("the pool is smaller than 2n");
  const base = cellBase(key, 92, 0);
  for (let k = 0; k < pool.length - 1; k++) { const j = k + (draw(base, k) % (pool.length - k)); const t = pool[j]; pool[j] = pool[k]; pool[k] = t; }
  const inh = pool.slice(0, n).map((r, i) => ({ ...r, arm: "inherit" as R4Arm, slot: 7001 + i }));
  const blk = pool.slice(n, 2 * n).map((r, i) => ({ ...r, arm: "blind" as R4Arm, slot: 7001 + i }));
  return [...inh, ...blk, ...(["blocked", "physarum", "keyless"] as const).flatMap((a, s) => resample(pools[a], n, key, s, a))];
}

// ---- a stored run file ----------------------------------------------------------------------------------------------

/** What r4.ts writes to <root>/<phase>/<arm>/seed-<slot>/series.json. */
export interface R4RunFile {
  format: "mycelium-r4-run-1";
  protocol: typeof PROTOCOL_ID;
  ruleId: string;
  phase: "dev" | "confirm" | "smoke";
  arm: R4Arm;
  seed: number;
  steps: number;
  config: unknown;
  engine: "gpu";
  digest: string;
  ledgerChecks: number;
  ledgerResidual: number;
  cpuLockstep: boolean;
  codeHash: string;
  readout: RunReadout;
  series: R4Series;
}

/** Problems with a stored R4 run (empty = usable): identity, config, ledger, incomplete series, a readout that differs from its recomputation, or another code hash. */
export function r4RunFileProblems(f: R4RunFile, want: { phase: string; arm: R4Arm; seed: number; codeHash: string | null }): string[] {
  const bad: string[] = [];
  const at = `${want.phase} ${want.arm} ${want.seed}`;
  if (f.format !== "mycelium-r4-run-1") bad.push(`${at}: format ${f.format}`);
  if (f.protocol !== PROTOCOL_ID) bad.push(`${at}: protocol ${f.protocol}`);
  if (f.phase !== want.phase || f.arm !== want.arm || f.seed !== want.seed || f.steps !== R4.STEPS) bad.push(`${at}: the file is ${f.phase} ${f.arm} ${f.seed} for ${f.steps} steps`);
  if (f.engine !== "gpu") bad.push(`${at}: engine ${f.engine}`);
  if (JSON.stringify(f.config) !== JSON.stringify(armConfig(want.arm, want.seed))) bad.push(`${at}: the stored config is not the arm's config`);
  if (f.ledgerResidual !== 0) bad.push(`${at}: ledger residual ${f.ledgerResidual}`);
  if (f.ledgerChecks !== R4.STEPS / R4.SCALAR_EVERY) bad.push(`${at}: ${f.ledgerChecks} ledger checks, expected ${R4.STEPS / R4.SCALAR_EVERY}`);
  bad.push(...seriesProblems(f.series, R4.STEPS).map((p) => `${at}: ${p}`), ...r4SeriesProblems(f.series).map((p) => `${at}: ${p}`));
  if (!bad.length) {
    const re = readoutsOf(want.arm, want.seed, f.series);
    for (const k of Object.keys(re) as (keyof RunReadout)[]) if (!Object.is(re[k], f.readout[k])) bad.push(`${at}: stored readout ${k} is ${f.readout[k]}, recomputed ${re[k]}`);
  }
  if (want.codeHash !== null && f.codeHash !== want.codeHash) bad.push(`${at}: run under code ${f.codeHash}, frozen code is ${want.codeHash}`);
  return bad;
}
