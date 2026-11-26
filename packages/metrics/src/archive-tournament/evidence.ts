// Archive tournament, evidence part: frozen config and fixture shapes, the job schedule, summaries recomputed from raw run
// records, control gates, verdicts, payload and seal. Node-only (node:crypto); no simulator import, so `--check` recomputes
// everything from a saved file without simulating. Reuses the first rung's JobSpec/RunRec/validateRuns/canonical/sha256.
import {
  ARMS, canonical, sha256, twinOf, validateRuns, G2_MEAN_MAX, type JobSpec, type RunRec,
} from "../opponents/evidence.ts";
import { blockPayoff, summarizePair, vigourExpected, signFlipP, atFloor, EDGE_MIN_BLOCKS, EDGE_MIN_OFFSET, COMPLETE_FRACTION, FAMILY, FLOOR_DIV, type BlockPayoff, type Obs, type PairSummary } from "../opponents/payoff.ts";
import { mean } from "../stats.ts";
import {
  analyze, chainFixture, runFixtures, temporalLabel, permutedValues, TEMPORAL_LABELS,
  type Analysis, type FixtureResult, type Mat, type PanelMatrix, type TemporalLabel,
} from "./index.ts";

export { canonical, sha256 };
export type Dict<T> = Record<string, T>;

export const STATEMENTS = [
  "CPU only",
  "no GPU evidence",
  "not the M3 environment: small sim-ref worlds, one fixed chemistry, mutation off",
  "archive time is search time: the bootstrap batch index at which an elite was offered, not ecological time and not an evaluation count",
  "archives are the final surviving elites, not snapshots captured at fixed times during a run; snapshots are related and not exchangeable",
  "descriptive tournament: no confirmatory historical-improvement claim, no multiplicity-corrected claim, no pooled rank or p across sources",
  "payoff is the share of biomass at a step, not reproduction or fitness",
  "no score here selected anything",
] as const;
export const SALT_NOTE = "all numbers regenerate from the raw run records; summaries and verdicts are recomputed by --check";

export interface ChainSpec { percents: number[] }
export interface ArchiveConfig {
  kind: "historical-opponents-archive-config";
  version: 1;
  arena: { tile: number; radius: number; steps: number };
  bins: number;
  minViableBins: number;
  sources: { name: string; short: string }[];
  screen: { seeds: number[]; mask: "m01" };
  seeds: number[];
  reserveSeeds: number[];
  searchSeeds: [number, number];
  weakenPercent: number;
  rDirMax: number;
  chain: ChainSpec;
  scrambled: string[];
  /** Read from the first rung's config.json at freeze and copied here so the evidence is self-describing. */
  effectTarget: number;
  depletion: { lightBase: number; lightAmp: number; kBDecay: number; kELeak: number };
  verdictTableVersion: 1;
}

export interface SnapshotRec { id: string; bin: number; cell: [number, number]; born: number; quality: number; hex: string; sharedWith: string[] }
export interface BinRec { bin: number; lo: number; hi: number; status: "viable" | "empty"; candidates: number; screened: number; snapshot: string | null }
export interface SourceFixture {
  name: string; short: string; file: string; fileSha256: string; evaluated: number; elites: number; horizon: number; resumeExact: boolean | null;
  bins: BinRec[]; snapshots: SnapshotRec[]; status: "kept" | "dropped"; dropReason: string | null;
  compat: { ok: boolean; problems: string[] };
  /** Screen outcomes per screened genome: solo biomass at the last checkpoint against its step-zero biomass, one entry per screen seed. */
  screens: { hex: string; viable: boolean; b0: number[]; b300: number[] }[];
}
export interface ArchiveFixture {
  kind: "historical-opponents-archive-fixture"; version: 1;
  transferConditions: string[];
  screenSeeds: number[];
  sources: SourceFixture[];
}

export const keptSources = (fx: ArchiveFixture): SourceFixture[] => fx.sources.filter((s) => s.status === "kept");
export const chainId = (k: number): string => `p${k}`;
export const weakId = (id: string): string => `${id}w`;
const pk = (a: string, b: string): string => `${a}|${b}`;
const MASKS: Dict<number[]> = { m01: [0, 1], m23: [2, 3] };

export interface Plan {
  jobs: JobSpec[];
  /** Per kept source: snapshot ids in time order and the latest id (twin and weakened copy are of it). */
  sources: { short: string; ids: string[] }[];
  starved: [string, string] | null;
  chain: string[];
}
export function planOf(cfg: ArchiveConfig, fx: ArchiveFixture): Plan {
  const jobs: JobSpec[] = [];
  const bal = (a: string, b: string, depletion = false): void => {
    for (const seed of cfg.seeds) for (const pos of ["P1", "P2"] as const) {
      const s = ARMS.bal[pos];
      jobs.push({ key: `${depletion ? "d" : "c"}|${pk(a, b)}|${depletion ? "" : "bal|"}${pos}|${seed}`, seed, a, b, slotsA: [...s.A], slotsB: [...s.B], depletion });
    }
  };
  const solo = (id: string): void => {
    for (const seed of cfg.seeds) for (const m of ["m01", "m23"]) jobs.push({ key: `s|${id}|${m}|${seed}`, seed, a: id, b: null, slotsA: MASKS[m], slotsB: [], depletion: false });
  };
  const sources: Plan["sources"] = [];
  for (const s of keptSources(fx)) {
    const ids = s.snapshots.map((x) => x.id);
    sources.push({ short: s.short, ids });
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) bal(ids[i], ids[j]);
    ids.forEach(solo);
    const L = ids[ids.length - 1];
    bal(L, twinOf(L));
    bal(L, weakId(L));
    solo(weakId(L));
  }
  // calibrated weakened-copy gate and the planted chain (instrument genomes)
  bal("G", "W");
  solo("G"); solo("W");
  const chain = cfg.chain.percents.map((_, k) => chainId(k));
  for (let i = 0; i < chain.length; i++) for (let j = i + 1; j < chain.length; j++) bal(chain[i], chain[j]);
  chain.forEach(solo);
  const first = sources[0];
  const starved: [string, string] | null = first && first.ids.length >= 2 ? [first.ids[0], first.ids[1]] : null;
  if (starved) bal(starved[0], starved[1], true);
  jobs.sort((x, y) => (x.key < y.key ? -1 : x.key > y.key ? 1 : 0));
  const seen = new Set<string>();
  for (const j of jobs) { if (seen.has(j.key)) throw new Error(`duplicate job key ${j.key}`); seen.add(j.key); }
  return { jobs, sources, starved, chain };
}

export interface ScheduleCounts { jobs: number; contests: number; solo: number; depletion: number }
export const scheduleCounts = (jobs: readonly JobSpec[]): ScheduleCounts => ({
  jobs: jobs.length, contests: jobs.filter((j) => j.key[0] === "c").length, solo: jobs.filter((j) => j.key[0] === "s").length, depletion: jobs.filter((j) => j.key[0] === "d").length,
});

// ---- summaries ---------------------------------------------------------------------------------------------------------

const obs = (r: RunRec, k: number): Obs => ({ b0A: r.b0[0], b0B: r.b0[1], bA: r.cp[k][0], bB: r.cp[k][1] });
type Index = Map<string, RunRec>;
function blocksFor(idx: Index, a: string, b: string, seeds: number[], k: number, kind: "c" | "d" = "c"): BlockPayoff[] {
  return seeds.map((seed) => {
    const mk = (pos: string): RunRec => {
      const r = idx.get(kind === "c" ? `c|${pk(a, b)}|bal|${pos}|${seed}` : `d|${pk(a, b)}|${pos}|${seed}`);
      if (!r) throw new Error(`missing run ${pk(a, b)} ${pos} ${seed}`);
      return r;
    };
    return blockPayoff(seed, [obs(mk("P1"), k), obs(mk("P2"), k)]);
  });
}
/** Mean over seeds of observed payoff minus solo-predicted share; null when no seed is usable. */
function residualOf(idx: Index, a: string, b: string, seeds: number[], k: number): { observed: number; expected: number; residual: number; blocks: number } | null {
  const per: { payoff: number; expected: number }[] = [];
  for (const seed of seeds) {
    const blk = blocksFor(idx, a, b, [seed], k)[0];
    if (blk.payoff === null) continue;
    const v = (id: string, m: string): number => (idx.get(`s|${id}|${m}|${seed}`) as RunRec).cp[k][0];
    const e1 = vigourExpected(v(a, "m01"), v(b, "m23")), e2 = vigourExpected(v(a, "m23"), v(b, "m01"));
    if (e1 === null || e2 === null) continue;
    per.push({ payoff: blk.payoff, expected: (e1 + e2) / 2 });
  }
  return per.length ? { observed: mean(per.map((x) => x.payoff)), expected: mean(per.map((x) => x.expected)), residual: mean(per.map((x) => x.payoff - x.expected)), blocks: per.length } : null;
}

export interface PairRec { a: string; b: string; summary: PairSummary; vigour: { observed: number; expected: number; residual: number; blocks: number } | null }
export interface TournamentSummary {
  ids: string[];
  pairs: PairRec[];
  payoff: Mat;
  resid: Mat;
  edges: boolean[][];
  analysis: Analysis;
  permuted: number[];
  /** Descriptive extras: solo growth at the primary checkpoint per snapshot (mean over masks and seeds) and its step-zero biomass. */
  solo: Dict<{ mean: number; b0: number; aliveAll: boolean }>;
}
/** One tournament over `ids` in time order. */
export function tournament(idx: Index, ids: string[], seeds: number[], k: number): TournamentSummary {
  const n = ids.length;
  const payoff: Mat = Array.from({ length: n }, () => new Array(n).fill(null));
  const resid: Mat = Array.from({ length: n }, () => new Array(n).fill(null));
  const edges = Array.from({ length: n }, () => new Array(n).fill(false));
  const pairs: PairRec[] = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const summary = summarizePair(blocksFor(idx, ids[i], ids[j], seeds, k), COMPLETE_FRACTION.balanced);
    const vigour = residualOf(idx, ids[i], ids[j], seeds, k);
    pairs.push({ a: ids[i], b: ids[j], summary, vigour });
    if (summary.status === "informative" && summary.mean !== null) {
      payoff[i][j] = summary.mean;
      resid[i][j] = vigour ? vigour.residual : null;
    }
    if (summary.edge === "A>B") edges[i][j] = true;
    if (summary.edge === "B>A") edges[j][i] = true;
  }
  const analysis = analyze({ payoff, resid, edges });
  const solo: TournamentSummary["solo"] = {};
  for (const id of ids) {
    const rs = [...idx.values()].filter((r) => r.key.startsWith(`s|${id}|`));
    solo[id] = { mean: mean(rs.map((r) => r.cp[k][0])), b0: mean(rs.map((r) => r.b0[0])), aliveAll: rs.every((r) => !atFloor(r.cp[k][0], r.b0[0])) };
  }
  return { ids, pairs, payoff, resid, edges, analysis, permuted: permutedValues(payoff), solo };
}

export interface TwinSummary { id: string; labelInvariance: boolean; positionAdvantage: (number | null)[]; signFlipP: number | null; meanAbs: number | null; effectTarget: number; positionOk: boolean }
function twinSummary(idx: Index, id: string, seeds: number[], k: number, target: number): TwinSummary {
  const t = twinOf(id);
  let inv = true;
  const adv: (number | null)[] = [];
  for (const seed of seeds) {
    const r1 = idx.get(`c|${pk(id, t)}|bal|P1|${seed}`) as RunRec, r2 = idx.get(`c|${pk(id, t)}|bal|P2|${seed}`) as RunRec;
    // same genome under two labels: the reciprocal worlds are one physical world, so counts swap exactly
    if (r1.b0[0] !== r2.b0[1] || r1.b0[1] !== r2.b0[0]) inv = false;
    r1.cp.forEach((c, kk) => { const d = r2.cp[kk]; if (c[0] !== d[1] || c[1] !== d[0] || c[2] !== d[3] || c[3] !== d[2]) inv = false; });
    const o = obs(r1, k);
    adv.push(o.bA + o.bB === 0 ? null : o.bA / (o.bA + o.bB) - o.b0A / (o.b0A + o.b0B));
  }
  const ok = adv.filter((v): v is number => v !== null);
  const p = ok.length === adv.length ? signFlipP(ok) : null;
  const meanAbs = ok.length === adv.length && ok.length ? mean(ok.map(Math.abs)) : null;
  return { id, labelInvariance: inv, positionAdvantage: adv, signFlipP: p, meanAbs, effectTarget: target, positionOk: p !== null && p > 0.05 && meanAbs !== null && meanAbs < target };
}

export interface WeakSummary { a: string; b: string; complete: number; allBelowHalf: boolean; meanPayoffB: number | null; soloAboveFloor: boolean | null; detected: boolean }
function weakSummary(idx: Index, a: string, b: string, seeds: number[], k: number, soloCheck: boolean): WeakSummary {
  const s = summarizePair(blocksFor(idx, a, b, seeds, k));
  const wp = s.payoffs.map((x) => 1 - x);
  const alive = soloCheck ? ["m01", "m23"].every((m) => seeds.every((sd) => { const r = idx.get(`s|${b}|${m}|${sd}`) as RunRec; return !atFloor(r.cp[k][0], r.b0[0]); })) : null;
  const allBelowHalf = wp.length > 0 && wp.every((x) => x < 0.5);
  const meanB = wp.length ? mean(wp) : null;
  return { a, b, complete: wp.length, allBelowHalf, meanPayoffB: meanB, soloAboveFloor: alive, detected: allBelowHalf && wp.length >= EDGE_MIN_BLOCKS && meanB !== null && meanB <= G2_MEAN_MAX && alive !== false };
}

export interface SourceSummary {
  short: string; name: string; tournament: TournamentSummary; twin: TwinSummary;
  /** Descriptive: weakened copy of the latest snapshot, with its solo viability. */
  weakCopy: WeakSummary;
  label: TemporalLabel; underlying: TemporalLabel | null;
  flags: { controlInvalid: boolean; insensitiveOrBiased: boolean };
}
export interface Starved { pair: [string, string]; bothBelowFloorEveryRun: boolean; status: string; inventories: { seed: number; pos: string; fracA: number; fracB: number }[] }
export interface Summary {
  checkpoint: number;
  sources: SourceSummary[];
  gw: WeakSummary;
  starved: Starved | null;
  chain: { ids: string[]; percents: number[]; tournament: TournamentSummary; fixture: FixtureResult };
  fixtures: FixtureResult[];
  naiveVersusSealed: { id: string; naive: number; label: TemporalLabel }[];
  global: { runsValid: boolean; starvedOk: boolean; gwDetected: boolean; assayOk: boolean };
  labelCounts: Dict<number>;
}
export const labelsOf = (s: Summary): Dict<string> => Object.fromEntries(s.sources.map((x) => [x.short, x.label]));

export interface FirstRung { ids: string[]; payoff: Mat; edges: boolean[][]; resid: Mat | null; meanPayoff: Dict<number | null> }
/** Full-layout panel matrix from the first rung's committed summary (payoff mirrored, residual antisymmetric). */
export function panelFromFirstRung(p: { summary: { matrix: { ids: string[]; payoff: Mat; edges: boolean[][]; meanPayoff: Dict<number | null> }; vigour: Dict<{ residual: number | null } | null> } }): PanelMatrix {
  const { ids, payoff, edges, meanPayoff } = p.summary.matrix;
  const resid: Mat = ids.map(() => ids.map(() => null));
  for (const [k, v] of Object.entries(p.summary.vigour)) {
    const [a, b] = k.split("|");
    const i = ids.indexOf(a), j = ids.indexOf(b);
    if (v && v.residual !== null) { resid[i][j] = v.residual; resid[j][i] = -v.residual; }
  }
  return { ids, payoff, resid, edges, meanPayoff };
}

export function summarize(cfg: ArchiveConfig, fx: ArchiveFixture, runs: RunRec[], panel: PanelMatrix, checkpoints: number[]): Summary {
  const idx: Index = new Map(runs.map((r) => [r.key, r]));
  const plan = planOf(cfg, fx);
  if (plan.jobs.length !== runs.length || plan.jobs.some((j) => !idx.has(j.key))) throw new Error("run records do not match the schedule");
  const k = checkpoints.length - 1;
  const runsValid = validateRuns({ arena: cfg.arena } as never, runs, checkpoints).length === 0;
  const gw = weakSummary(idx, "G", "W", cfg.seeds, k, true);
  let starved: Starved | null = null;
  if (plan.starved) {
    const [a, b] = plan.starved;
    const inventories: Starved["inventories"] = [];
    let all = true;
    for (const seed of cfg.seeds) for (const pos of ["P1", "P2"]) {
      const o = obs(idx.get(`d|${pk(a, b)}|${pos}|${seed}`) as RunRec, k);
      inventories.push({ seed, pos, fracA: o.bA / o.b0A, fracB: o.bB / o.b0B });
      if (!(atFloor(o.bA, o.b0A) && atFloor(o.bB, o.b0B))) all = false;
    }
    starved = { pair: [a, b], bothBelowFloorEveryRun: all, status: summarizePair(blocksFor(idx, a, b, cfg.seeds, k, "d")).status, inventories };
  }
  const starvedOk = !plan.starved || (!!starved && starved.bothBelowFloorEveryRun && starved.status === "uninformative");
  const chainT = tournament(idx, plan.chain, cfg.seeds, k);
  const chainFx = chainFixture(chainT.analysis, cfg.rDirMax, plan.chain);
  const fixtures = [...runFixtures({ rDirMax: cfg.rDirMax, scrambled: cfg.scrambled, panel }), chainFx];
  const byId = (id: string): FixtureResult => fixtures.find((f) => f.id === id) as FixtureResult;
  const assayOk = chainFx.pass && byId("strength-scrambled").pass && byId("vigour-only").pass && byId("cycle-fools-naive").pass && byId("long-cycle-fools-naive").pass && byId("strength-aligned").pass;
  const sources: SourceSummary[] = plan.sources.map((ps) => {
    const name = keptSources(fx).find((s) => s.short === ps.short)!.name;
    const t = tournament(idx, ps.ids, cfg.seeds, k);
    const L = ps.ids[ps.ids.length - 1];
    const twin = twinSummary(idx, L, cfg.seeds, k, cfg.effectTarget);
    const weakCopy = weakSummary(idx, L, weakId(L), cfg.seeds, k, true);
    const controlInvalid = !runsValid || !twin.labelInvariance || !starvedOk;
    const insensitiveOrBiased = !twin.positionOk || !gw.detected;
    const { label, underlying } = temporalLabel({
      controlInvalid, insensitiveOrBiased, assayFailed: !assayOk, scheduled: t.analysis.scheduled, informative: t.analysis.informative,
      rDir: t.analysis.rank.rDir, rDirResid: t.analysis.residRank?.rDir ?? null, ordered: t.analysis.ordered, rDirMax: cfg.rDirMax,
    });
    return { short: ps.short, name, tournament: t, twin, weakCopy, label, underlying, flags: { controlInvalid, insensitiveOrBiased } };
  });
  const labelCounts: Dict<number> = Object.fromEntries(TEMPORAL_LABELS.map((l) => [l, 0]));
  for (const s of sources) labelCounts[s.label]++;
  const naiveVersusSealed = [
    ...fixtures.map((f) => ({ id: f.id, naive: f.naive.fraction, label: f.label })),
    ...sources.map((s) => ({ id: `source:${s.short}`, naive: s.tournament.analysis.naive.fraction, label: s.label })),
  ];
  return {
    checkpoint: checkpoints[k], sources, gw, starved, chain: { ids: plan.chain, percents: cfg.chain.percents, tournament: chainT, fixture: chainFx }, fixtures, naiveVersusSealed,
    global: { runsValid, starvedOk, gwDetected: gw.detected, assayOk }, labelCounts,
  };
}

// ---- payload and seal ----------------------------------------------------------------------------------------------------

export const LIMITS = [
  "descriptive tournament of related surviving elites from three related bootstrap searches (all record search seed 1); no confirmatory claim, no pooled rank or p",
  "archive time is the bootstrap batch index (`born`), not ecological time; the archive holds final elites, one per MAP-Elites cell, not snapshots captured during the run",
  "the permutation rank r_dir is a rank against relabelled times in a genealogically related, non-exchangeable set; it is never called significant",
  "the search optimised survival, recovery and light dependence, not arena competition; the arena is a 32x32 tile with gradient light, amplitude 200 and mu/sigma 154/24, unlike the search worlds (uniform light, amplitude 160, 60/20)",
  "payoff is biomass share at step 300 in a small CPU arena with one chemistry; balanced arm only; rare starts are not run because they are biased against the rare side even for identical genomes",
  "'nothing-beyond-null' means none detected at this resolution, never that none exists; ten seed blocks give wide intervals",
  "the weakened copy of an archive genome is descriptive: the edit scales one generalist-specific weight and can leave a negative-weight genome less impaired",
  "the cycle and vigour-only fixtures are synthetic; strength-not-time is a pure-matrix fixture on the first rung's committed panel matrix, with no in-world rerun",
  "no fixture or control reaches directional-rank: strength-aligned and the planted chain land on directional-vigour-only, so the top label has no positive control and a real directional-rank would be unvalidated",
  "no physics, schema, preset or RULE_VERSION change; no paid calls; not on the public site",
];

export interface Payload {
  kind: "historical-opponents-archive-evidence"; version: 1;
  statements: readonly string[]; note: string;
  config: ArchiveConfig;
  archiveSha256: string;
  firstRungEvidenceSha256: string;
  panel: PanelMatrix;
  hex: Dict<string>;
  constants: { floorDiv: number; edgeMinBlocks: number; edgeMinOffset: number; familySize: number; g2MeanMax: number; completeFraction: number; checkpoints: number[]; plant: Dict<number>; ruleVersion: number };
  schedule: ScheduleCounts;
  runs: RunRec[];
  summary: Summary;
  verdict: Dict<string>;
  limits: string[];
  integritySha256?: string;
}
export const expectedConstants = (checkpoints: number[], plant: Dict<number>, ruleVersion: number): Payload["constants"] => ({
  floorDiv: FLOOR_DIV, edgeMinBlocks: EDGE_MIN_BLOCKS, edgeMinOffset: EDGE_MIN_OFFSET, familySize: FAMILY, g2MeanMax: G2_MEAN_MAX, completeFraction: COMPLETE_FRACTION.balanced, checkpoints, plant, ruleVersion,
});

export function buildPayload(
  cfg: ArchiveConfig, fx: ArchiveFixture, runs: RunRec[], panel: PanelMatrix, hex: Dict<string>, archiveSha256: string, firstRungEvidenceSha256: string,
  checkpoints: number[], plant: Dict<number>, ruleVersion: number,
): Payload {
  const sorted = [...runs].sort((x, y) => (x.key < y.key ? -1 : 1));
  const bad = validateRuns({ arena: cfg.arena } as never, sorted, checkpoints);
  if (bad.length) throw new Error(`invalid run records: ${bad.join("; ")}`);
  const summary = summarize(cfg, fx, sorted, panel, checkpoints);
  return {
    kind: "historical-opponents-archive-evidence", version: 1, statements: STATEMENTS, note: SALT_NOTE, config: cfg, archiveSha256, firstRungEvidenceSha256, panel, hex,
    constants: expectedConstants(checkpoints, plant, ruleVersion), schedule: scheduleCounts(planOf(cfg, fx).jobs), runs: sorted, summary, verdict: labelsOf(summary), limits: LIMITS,
  };
}
export function sealPayload(p: Payload): Payload {
  const { integritySha256: _d, ...rest } = p;
  return { ...rest, integritySha256: sha256(canonical(rest)) };
}
export function verifySeal(p: Payload): boolean {
  const { integritySha256, ...rest } = p;
  return typeof integritySha256 === "string" && integritySha256 === sha256(canonical(rest));
}

/** Recompute every summary and verdict from the raw runs alone and report differences from what is stored. */
export function recompute(p: Payload, fx: ArchiveFixture): string[] {
  const problems: string[] = [];
  try {
    const bad = validateRuns({ arena: p.config.arena } as never, p.runs, p.constants.checkpoints);
    if (bad.length) return bad.map((m) => `invalid run record: ${m}`);
    const summary = summarize(p.config, fx, p.runs, p.panel, p.constants.checkpoints);
    const norm = (x: unknown): string => canonical(JSON.parse(JSON.stringify(x)));
    if (norm(summary) !== norm(p.summary)) problems.push("stored summary differs from the summary recomputed from the raw runs");
    if (norm(labelsOf(summary)) !== norm(p.verdict)) problems.push(`stored verdict ${JSON.stringify(p.verdict)} differs from recomputed ${JSON.stringify(labelsOf(summary))}`);
    if (norm(p.limits) !== norm(LIMITS)) problems.push("stored limits differ from the current limits");
    if (norm(scheduleCounts(planOf(p.config, fx).jobs)) !== norm(p.schedule)) problems.push("stored schedule counts differ");
  } catch (e) {
    problems.push(`recompute failed: ${(e as Error).message}`);
  }
  return problems;
}
