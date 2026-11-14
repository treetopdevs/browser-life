// Mycelium rung R3: per-run readouts, the three directional tests, the label and the attainability helpers
// (docs/mycelium-r3-2026-11-13/PROTOCOL.md sections 4-7). Pure functions, no Deno, no clock; every random draw comes from the repo's
// counter-based PRNG with a key fixed here (the Mann-Whitney permutations use r2b-stats' fixed key).
//
// Deliberately NOT r2b-decide.ts: its structure readout (Moran's I) is mass-filtered (open Sol P1 in R2b's RESULT). R3 uses only readouts that are
// defined at zero trail: a window mean of the deposit rate d, a window mean of trail mass per particle TM, and a bounded change score g.
import { cellBase, draw } from "@bl/schema";
import { runValues, type R2bSeries, seriesProblems } from "./observe-r2b.ts";
import { cliffsDelta, holm, mannWhitney, mean } from "./r2b-stats.ts";
import { armConfig, armCost, armHeredity, PROTOCOL_ID, R3, type R3Arm } from "./r3-protocol.ts";

// ---- per-run readouts -----------------------------------------------------------------------------------------

export interface RunReadout {
  arm: R3Arm;
  /** The registered slot. */
  slot: number;
  /** Window mean of the deposit measure d over the early window (0, 5,000] and the late window (50,000, 100,000]. */
  dE: number;
  dL: number;
  /** Window mean of trail mass per particle over the same two windows. */
  tmE: number;
  tmL: number;
  /** n < 200 at any scalar census of either window. */
  guard: boolean;
}

/** The readouts of one stored series over the early window (eLo, eHi] and the late window (lLo, hi] (the same function for every arm and for R2b's reused dev series). */
export function readoutsOfWindows(arm: R3Arm, slot: number, ser: R2bSeries, eLo: number, eHi: number, lLo: number, lHi: number): RunReadout {
  const e = runValues(ser, eLo, eHi, null), l = runValues(ser, lLo, lHi, null);
  if (e.d === null || l.d === null || e.TM === null || l.TM === null) throw new Error(`${arm} ${slot}: a window has no census`);
  return { arm, slot, dE: e.d, dL: l.d, tmE: e.TM, tmL: l.TM, guard: e.guardTripped || l.guardTripped };
}

/** The protocol's windows: E = (0, 5,000], L = (50,000, 100,000]. */
export const readoutsOf = (arm: R3Arm, slot: number, ser: R2bSeries): RunReadout => readoutsOfWindows(arm, slot, ser, R3.E_LO, R3.E_HI, R3.L_LO, R3.STEPS);

/**
 * The change score g = (dL - dE) / (dL + dE), in [-1, 1], defined at zero. With no deposit in either window g := -1: deposit is gone however early
 * it vanished, which is the limit of the formula along dL = 0 (any positive dE with dL = 0 gives -1), so a purge that finishes before the first heavy
 * census cannot read as "no change".
 */
export const gScore = (dE: number, dL: number): number => (dE + dL === 0 ? -1 : (dL - dE) / (dL + dE));

// ---- the trend statistic (Jonckheere-Terpstra) -------------------------------------------------------------------

/**
 * Jonckheere-Terpstra over groups ordered by increasing cost: the mean over group pairs a < b of Cliff's delta of group a against group b
 * (so +1: every lower-cost value above every higher-cost value). Positive = the score falls as the cost rises (the predicted direction of D3).
 */
export function trendTau(groups: readonly (readonly number[])[]): number {
  let t = 0, c = 0;
  for (let a = 0; a < groups.length; a++) for (let b = a + 1; b < groups.length; b++) { t += cliffsDelta(groups[a], groups[b]); c++; }
  return t / c;
}

/**
 * Two-sided permutation p of trendTau: `perms` fixed-key relabellings of the pooled values over the group sizes (a partial Fisher-Yates per
 * permutation); p = (1 + #{|tau*| >= |tau|}) / (1 + perms). Ties are handled exactly as in Cliff's delta (equal values count 0).
 */
export function trendPermutationP(groups: readonly (readonly number[])[], perms: number = R3.TREND_PERMS, key: number = R3.TREND_KEY): { tau: number; p: number } {
  const sizes = groups.map((g) => g.length);
  const pool = Float64Array.from(groups.flat());
  const N = pool.length;
  const tauOf = (v: Float64Array): number => {
    let t = 0, c = 0, start = 0;
    const starts = sizes.map((s) => { const o = start; start += s; return o; });
    for (let a = 0; a < sizes.length; a++) for (let b = a + 1; b < sizes.length; b++) {
      let u2 = 0;
      for (let i = starts[a]; i < starts[a] + sizes[a]; i++) { const x = v[i]; for (let j = starts[b]; j < starts[b] + sizes[b]; j++) { const y = v[j]; u2 += x > y ? 1 : x < y ? -1 : 0; } }
      t += u2 / (sizes[a] * sizes[b]); c++;
    }
    return t / c;
  };
  const obs = tauOf(pool);
  const work = Float64Array.from(pool);
  let hits = 0;
  const eps = 1e-12;
  for (let b = 0; b < perms; b++) {
    const base = cellBase(key, b, 0);
    for (let k = 0; k < N - 1; k++) { const j = k + (draw(base, k) % (N - k)); const t = work[j]; work[j] = work[k]; work[k] = t; }
    if (Math.abs(tauOf(work)) >= Math.abs(obs) - eps) hits++;
  }
  return { tau: obs, p: (1 + hits) / (1 + perms) };
}

// ---- the tests ---------------------------------------------------------------------------------------------------

export type Verdict = "SUPPORT" | "CONTRADICT" | "NULL";
export type TestId = "D1" | "D2" | "D3";

export interface TestResult {
  id: TestId;
  what: string;
  /** Group sizes (D1, D2: inherit then blocked; D3: the groups in cost order). */
  n: number[];
  /** Signed so that positive supports the hypothesis: -Cliff's delta for D1 and D2 (inherit against blocked), the trend tau for D3. */
  effect: number;
  /** Two-sided p, Holm-adjusted over D1-D3, and the Holm rejection at alpha. */
  p: number;
  adjusted: number;
  reject: boolean;
  floor: number;
  verdict: Verdict;
  note?: string;
}

const by = (runs: readonly RunReadout[], arm: R3Arm): RunReadout[] => runs.filter((r) => r.arm === arm).sort((a, b) => a.slot - b.slot);

/**
 * D3's scores. Each inherit-family run is divided by the early deposit of the blocked-family run of the SAME SLOT at the same cost: z = dE(inherit-c, slot) /
 * dE(blocked-c, slot). The two runs are independent worlds, so the scores are independent across runs (a shared estimated baseline would make them dependent
 * and the permutation null invalid), and under "the ratio distribution does not depend on the cost" they are exchangeable across costs. The pairing by slot
 * number is arbitrary and fixed in advance; the blocked early deposit varies by a few percent between worlds, so it adds little noise. A slot present in
 * only one of the pair is not scored; a blocked early deposit of 0 makes D3 undefined.
 */
export function doseScores(runs: readonly RunReadout[]): { groups: number[][]; problems: string[] } {
  const groups: number[][] = [], problems: string[] = [];
  for (const cost of R3.COSTS) {
    const inh = by(runs, cost === 1 ? "inherit-c1" : cost === 4 ? "inherit-c4" : "inherit");
    const blk = by(runs, cost === 1 ? "blocked-c1" : cost === 4 ? "blocked-c4" : "blocked");
    const bySlot = new Map(blk.map((r) => [r.slot, r.dE]));
    const g: number[] = [];
    for (const r of inh) {
      const b = bySlot.get(r.slot);
      if (b === undefined) continue;
      if (!(b > 0)) { problems.push(`cost ${cost}, slot ${r.slot}: the paired blocked early deposit is ${b}, so the score is undefined`); continue; }
      g.push(r.dE / b);
    }
    groups.push(g);
  }
  return { groups, problems };
}

const MIN_GROUP = 3;

export interface Options { perms?: number; trendPerms?: number }

/** D1, D2 and D3 with one Holm over the three two-sided p-values. */
export function runTests(runs: readonly RunReadout[], opt: Options = {}): TestResult[] {
  const inh = by(runs, "inherit"), blk = by(runs, "blocked");
  const out: TestResult[] = [];
  const raw: number[] = [], eff: number[] = [], valid: boolean[] = [], ns: number[][] = [];
  const two = (id: TestId, what: string, x: number[], y: number[]) => {
    ns.push([x.length, y.length]);
    if (x.length < MIN_GROUP || y.length < MIN_GROUP) { raw.push(1); eff.push(0); valid.push(false); out.push({ id, what, n: [x.length, y.length], effect: 0, p: 1, adjusted: 1, reject: false, floor: R3.DELTA_FLOOR, verdict: "NULL", note: "a group has fewer than 3 runs" } as TestResult); return; }
    const mw = mannWhitney(x, y, opt.perms);
    raw.push(mw.p); eff.push(-mw.delta); valid.push(true);
    out.push({ id, what, n: [x.length, y.length], effect: -mw.delta, p: mw.p, adjusted: 1, reject: false, floor: R3.DELTA_FLOOR, verdict: "NULL" });
  };
  two("D1", "late deposit rate dL, inherit against blocked (default cost)", inh.map((r) => r.dL), blk.map((r) => r.dL));
  two("D2", "change score g = (dL - dE)/(dL + dE), inherit against blocked (default cost)", inh.map((r) => gScore(r.dE, r.dL)), blk.map((r) => gScore(r.dE, r.dL)));
  const dose = doseScores(runs);
  if (dose.problems.length || dose.groups.some((g) => g.length < MIN_GROUP)) {
    ns.push(dose.groups.map((g) => g.length)); raw.push(1); eff.push(0); valid.push(false);
    out.push({ id: "D3", what: "dose: normalised early deposit falls as the deposit cost rises (1, 2, 4)", n: dose.groups.map((g) => g.length), effect: 0, p: 1, adjusted: 1, reject: false, floor: R3.TAU_FLOOR, verdict: "NULL", note: dose.problems.join("; ") || "a cost group has fewer than 3 runs" });
  } else {
    const tr = trendPermutationP(dose.groups, opt.trendPerms ?? R3.TREND_PERMS);
    ns.push(dose.groups.map((g) => g.length)); raw.push(tr.p); eff.push(tr.tau); valid.push(true);
    out.push({ id: "D3", what: "dose: normalised early deposit falls as the deposit cost rises (1, 2, 4)", n: dose.groups.map((g) => g.length), effect: tr.tau, p: tr.p, adjusted: 1, reject: false, floor: R3.TAU_FLOOR, verdict: "NULL" });
  }
  const h = holm(raw, R3.ALPHA);
  out.forEach((t, i) => {
    t.adjusted = h.adjusted[i]; t.reject = h.reject[i];
    if (!valid[i]) return;
    if (t.reject && t.effect >= t.floor) t.verdict = "SUPPORT";
    else if (t.reject && t.effect <= -t.floor) t.verdict = "CONTRADICT";
  });
  return out;
}

// ---- the label ----------------------------------------------------------------------------------------------------

export type Label = "PASS" | "FAIL" | "INCONCLUSIVE";

export interface FrozenRead {
  /** Cliff's delta and raw two-sided p of the frozen arm's dL against blocked's (predicted negative), and of inherit's against the frozen arm's and against blocked's. */
  deltaVsBlocked: number | null; pVsBlocked: number | null;
  deltaInheritVsFrozen: number | null; pInheritVsFrozen: number | null;
  deltaInheritVsBlocked: number | null; pInheritVsBlocked: number | null;
  /** FROZEN-LOW: delta <= -0.5 and p < 0.05 against blocked; FROZEN-NOT-LOW otherwise; null when the arm is missing. */
  reading: "FROZEN-LOW" | "FROZEN-NOT-LOW" | null;
  inheritBelowFrozen: boolean | null;
  /** Whether a purge exists to explain: inherit's dL below blocked's with delta <= -0.5 and p < 0.05. Takes precedence over everything below. */
  purgePresent: boolean | null;
  /**
   * The written reading (PROTOCOL.md section 5, D4): NO-PURGE (nothing to explain), FROZEN-SUFFICES (frozen low, inherit not below frozen), FROZEN-PLUS-MUTATION
   * (frozen low, inherit below frozen), MUTATION-NEEDED (frozen not low, inherit below frozen), UNRESOLVED (frozen not low, inherit not below frozen).
   */
  interpretation: "NO-PURGE" | "FROZEN-SUFFICES" | "FROZEN-PLUS-MUTATION" | "MUTATION-NEEDED" | "UNRESOLVED" | null;
}

export function frozenRead(runs: readonly RunReadout[], opt: Options = {}): FrozenRead {
  const inh = by(runs, "inherit"), blk = by(runs, "blocked"), fz = by(runs, "frozen");
  const none: FrozenRead = { deltaVsBlocked: null, pVsBlocked: null, deltaInheritVsFrozen: null, pInheritVsFrozen: null, deltaInheritVsBlocked: null, pInheritVsBlocked: null, reading: null, inheritBelowFrozen: null, purgePresent: null, interpretation: null };
  if (fz.length < MIN_GROUP || blk.length < MIN_GROUP) return none;
  const a = mannWhitney(fz.map((r) => r.dL), blk.map((r) => r.dL), opt.perms);
  const b = inh.length >= MIN_GROUP ? mannWhitney(inh.map((r) => r.dL), fz.map((r) => r.dL), opt.perms) : null;
  const c = inh.length >= MIN_GROUP ? mannWhitney(inh.map((r) => r.dL), blk.map((r) => r.dL), opt.perms) : null;
  const low = a.delta <= -R3.DELTA_FLOOR && a.p < R3.ALPHA;
  const below = b ? b.delta <= -R3.DELTA_FLOOR && b.p < R3.ALPHA : null;
  const purge = c ? c.delta <= -R3.DELTA_FLOOR && c.p < R3.ALPHA : null;
  const interpretation = purge === null || below === null ? null : !purge ? "NO-PURGE" : low ? (below ? "FROZEN-PLUS-MUTATION" : "FROZEN-SUFFICES") : below ? "MUTATION-NEEDED" : "UNRESOLVED";
  return {
    deltaVsBlocked: a.delta, pVsBlocked: a.p, deltaInheritVsFrozen: b?.delta ?? null, pInheritVsFrozen: b?.p ?? null, deltaInheritVsBlocked: c?.delta ?? null, pInheritVsBlocked: c?.p ?? null,
    reading: low ? "FROZEN-LOW" : "FROZEN-NOT-LOW", inheritBelowFrozen: below, purgePresent: purge, interpretation,
  };
}

export interface Decision {
  label: Label;
  tests: TestResult[];
  /** C1: Cliff's delta of the late trail mass per particle, inherit against blocked; needs <= -0.33 for a PASS. */
  tmConcordance: { delta: number | null; ok: boolean };
  frozen: FrozenRead;
  guard: { tripped: { arm: string; slot: number }[]; labelWithout: Label | null; sensitive: boolean };
  reasons: string[];
}

function labelOf(tests: readonly TestResult[], tmOk: boolean): { label: Label; reasons: string[] } {
  const reasons: string[] = [];
  const contra = tests.filter((t) => t.verdict === "CONTRADICT");
  if (contra.length) return { label: "FAIL", reasons: [`contradicted: ${contra.map((t) => t.id).join(", ")}`] };
  const notSupported = tests.filter((t) => t.verdict !== "SUPPORT");
  if (notSupported.length) reasons.push(`not supported: ${notSupported.map((t) => `${t.id}${t.note ? ` (${t.note})` : ""}`).join(", ")}`);
  if (!tmOk) reasons.push("the trail-mass concordance (C1) is not met");
  return reasons.length ? { label: "INCONCLUSIVE", reasons } : { label: "PASS", reasons: ["D1, D2 and D3 are all supported and C1 holds"] };
}

function core(runs: readonly RunReadout[], opt: Options) {
  const tests = runTests(runs, opt);
  const inh = by(runs, "inherit"), blk = by(runs, "blocked");
  const delta = inh.length >= MIN_GROUP && blk.length >= MIN_GROUP ? cliffsDelta(inh.map((r) => r.tmL), blk.map((r) => r.tmL)) : null;
  const tm = { delta, ok: delta !== null && delta <= -R3.TM_CONCORD };
  return { tests, tm, ...labelOf(tests, tm.ok) };
}

/**
 * The label (section 6). PASS needs D1, D2 and D3 all SUPPORT (Holm-adjusted two-sided p < 0.05 AND the effect beyond its floor in the predicted
 * direction) and C1. FAIL is any test CONTRADICT (the same significance and floor, opposite direction). Anything else is INCONCLUSIVE, floor ties
 * and underpowered tests included. If a run tripped the population guard the label is recomputed without the tripped runs and must agree, or the
 * label is INCONCLUSIVE. The frozen arm is read separately (section 6, D4) and never changes the label.
 */
export function decide(runs: readonly RunReadout[], opt: Options = {}): Decision {
  const main = core(runs, opt);
  const tripped = runs.filter((r) => r.guard).map((r) => ({ arm: r.arm as string, slot: r.slot }));
  let label = main.label;
  const reasons = [...main.reasons];
  let without: Label | null = null;
  if (tripped.length) {
    without = core(runs.filter((r) => !r.guard), opt).label;
    if (without !== main.label) { label = "INCONCLUSIVE"; reasons.push(`the label changes (${main.label} with, ${without} without) when ${tripped.length} guard-tripped run(s) are removed`); }
  }
  return { label, tests: main.tests, tmConcordance: main.tm, frozen: frozenRead(runs, opt), guard: { tripped, labelWithout: without, sensitive: without !== null && without !== main.label }, reasons };
}

// ---- attainability helpers (section 8) ----------------------------------------------------------------------------

/** Swaps the heredity family of every run: inherit <-> blocked at each cost. The flipped data must give a FAIL. */
export function flipLabels(runs: readonly RunReadout[]): RunReadout[] {
  const swap = (arm: R3Arm): R3Arm => {
    const c = armCost(arm), h = armHeredity(arm);
    if (h === "frozen") return arm;
    const to = h === "inherit" ? "blocked" : "inherit";
    return (c === 2 ? to : `${to}-c${c}`) as R3Arm;
  };
  return runs.map((r) => ({ ...r, arm: swap(r.arm) }));
}

/**
 * A null dataset: the inherit and blocked readouts at each cost are pooled and dealt back at random (fixed key), so no arm effect exists. Each dealt arm
 * gets the slots 6001, 6002, ... so that D3's slot pairs stay complete (the original slots would be scattered by the deal). The null is exact for D1 and D2;
 * for D3 it also needs the ratio distribution to be the same at every cost, which pooling within a cost gives only if the pooled early deposits have the same
 * shape (up to scale) at the three costs: the calibration's null rates are a sanity check, not a proof.
 */
export function shuffleLabels(runs: readonly RunReadout[], key: number): RunReadout[] {
  const out: RunReadout[] = [];
  for (const [i, pair] of ([["inherit", "blocked"], ["inherit-c1", "blocked-c1"], ["inherit-c4", "blocked-c4"]] as [R3Arm, R3Arm][]).entries()) {
    const a = by(runs, pair[0]), b = by(runs, pair[1]);
    const pool = [...a, ...b];
    const base = cellBase(key, i, 0);
    for (let k = 0; k < pool.length - 1; k++) { const j = k + (draw(base, k) % (pool.length - k)); const t = pool[j]; pool[j] = pool[k]; pool[k] = t; }
    pool.forEach((r, idx) => out.push({ ...r, arm: idx < a.length ? pair[0] : pair[1], slot: 6001 + (idx < a.length ? idx : idx - a.length) }));
  }
  return [...out, ...runs.filter((r) => armHeredity(r.arm) === "frozen")];
}

/** Resamples `n` runs with replacement from a pool (fixed key), relabelled with consecutive slots. */
export function resample(pool: readonly RunReadout[], n: number, key: number, stream: number, arm: R3Arm): RunReadout[] {
  const base = cellBase(key, stream, 0);
  return Array.from({ length: n }, (_, i) => ({ ...pool[draw(base, i) % pool.length], arm, slot: 6001 + i }));
}

/**
 * A planted dataset with the predicted structure, built from dev pools (inherit and blocked at the default cost): n runs per arm resampled from
 * the pools, then the early and late deposit of every non-default-cost arm scaled by `mult[arm]`. Planting a dose response (inherit's early deposit
 * rising at cost 1 and falling at cost 4 against the blocked arm's mechanical drift) shows the rules reach PASS at the confirmation sample size.
 */
export function planted(inheritPool: readonly RunReadout[], blockedPool: readonly RunReadout[], n: number, key: number, mult: Partial<Record<R3Arm, number>>): RunReadout[] {
  const scale = (rs: RunReadout[], m: number): RunReadout[] => rs.map((r) => ({ ...r, dE: r.dE * m, dL: r.dL * m, tmE: r.tmE * m, tmL: r.tmL * m }));
  const arms: [R3Arm, readonly RunReadout[], number][] = [
    ["inherit", inheritPool, 0], ["blocked", blockedPool, 1], ["frozen", inheritPool, 2],
    ["inherit-c1", inheritPool, 3], ["inherit-c4", inheritPool, 4], ["blocked-c1", blockedPool, 5], ["blocked-c4", blockedPool, 6],
  ];
  return arms.flatMap(([arm, pool, s]) => scale(resample(pool, n, key, s, arm), mult[arm] ?? 1));
}

// ---- a stored run file ----------------------------------------------------------------------------------------------

/** What r3.ts writes to <root>/<phase>/<arm>/seed-<slot>/series.json. */
export interface R3RunFile {
  format: "mycelium-r3-run-1";
  protocol: typeof PROTOCOL_ID;
  ruleId: string;
  phase: "dev" | "confirm" | "smoke";
  arm: R3Arm;
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
  series: R2bSeries;
}

/** Problems with a stored R3 run (empty = usable): identity, config, ledger, incomplete series, a readout that differs from its recomputation, or another code hash. */
export function r3RunFileProblems(f: R3RunFile, want: { phase: string; arm: R3Arm; seed: number; codeHash: string | null }): string[] {
  const bad: string[] = [];
  const at = `${want.phase} ${want.arm} ${want.seed}`;
  if (f.format !== "mycelium-r3-run-1") bad.push(`${at}: format ${f.format}`);
  if (f.protocol !== PROTOCOL_ID) bad.push(`${at}: protocol ${f.protocol}`);
  if (f.phase !== want.phase || f.arm !== want.arm || f.seed !== want.seed || f.steps !== R3.STEPS) bad.push(`${at}: the file is ${f.phase} ${f.arm} ${f.seed} for ${f.steps} steps`);
  if (f.engine !== "gpu") bad.push(`${at}: engine ${f.engine}`);
  if (JSON.stringify(f.config) !== JSON.stringify(armConfig(want.arm, want.seed))) bad.push(`${at}: the stored config is not the arm's config`);
  if (f.ledgerResidual !== 0) bad.push(`${at}: ledger residual ${f.ledgerResidual}`);
  if (f.ledgerChecks !== R3.STEPS / R3.SCALAR_EVERY) bad.push(`${at}: ${f.ledgerChecks} ledger checks, expected ${R3.STEPS / R3.SCALAR_EVERY}`);
  bad.push(...seriesProblems(f.series, R3.STEPS).map((p) => `${at}: ${p}`));
  const re = readoutsOf(want.arm, want.seed, f.series);
  for (const k of Object.keys(re) as (keyof RunReadout)[]) if (!Object.is(re[k], f.readout[k])) bad.push(`${at}: stored readout ${k} is ${f.readout[k]}, recomputed ${re[k]}`);
  if (want.codeHash !== null && f.codeHash !== want.codeHash) bad.push(`${at}: run under code ${f.codeHash}, frozen code is ${want.codeHash}`);
  return bad;
}
