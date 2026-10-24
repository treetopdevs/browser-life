// Regime meters, the companion page (plan docs/3d-regime-meters-plan-2026-10-23.md section 8.6): docs/3d-regime-meters-map.html, built from
// regime-results.json (the reader's output) and the captures, self-contained (data inlined as one JSON script tag, no network).
//
//   deno run -A --no-lock experiments/3d-slab/regime-html.ts --results=runs/regime/regime-results.json [--captures=runs/regime/captures] [--out=docs/3d-regime-meters-map.html]
//   deno run -A --no-lock experiments/3d-slab/regime-html.ts --synthetic [--keep=runs/regime/synthetic] [--out=docs/3d-regime-meters-map.html]
//
// Labelling. A page is labelled in exactly one of three ways, from the results it is given:
//   SYNTHETIC  results.synthetic is true (they came from the synthetic generator below, through the real reader): the header says
//              "synthetic: not a result" and the title says so.
//   DRAFT      results.draft is true (the reader ran with --draft, before the freeze): the header says DRAFT. Allowed, never presented as a result.
//   RESULT     only if results.rule.status is FROZEN and results.rule.sha256 equals the SHA-256 of experiments/3d-slab/regime-rule.md AND the last
//              hash in experiments/3d-slab/REGIME-FROZEN. Anything else is REFUSED (exit 2): this builder never labels a page "result" for results
//              that do not carry the frozen rule's hash. An INVALID-RUN results file is refused too.
//
// The synthetic generator (first half of this file) builds job files of the shape the runner writes, with banks whose classes are chosen by a
// latent regime value, so that the reader's whole path (summaries, settings, gate, late check, outcome, cards, curves) runs on data whose
// answer is known. It is also what the reader's tests use for their fixtures. Nothing it makes is a measurement.
import { Buffer } from "node:buffer";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { lowbias32 } from "@bl/schema";
import {
  B0_ID, B0_PARAMS, DIFF_COLUMNS, REGIME, SLAB_GEOM, diffLogFromRows, gateSlabId, jobId, refTimes, selectionSeed, storedSteps, sweepSettings, voxelAt,
} from "@bl/metrics";
import type { CheckName, CheckResult, Combination, DiffLog, DiffRow, JobRole, Rung, SettingSpec, SiteLog, TwinBank } from "@bl/metrics";
import { ReaderError, bundleJobs, evaluateGateJobs, evaluateSweepJobs, parseHashFile, round6, sha256Hex } from "./regime-readout.ts";
import type { Capture, GateFile, JobExtras, JobFile, ResultsJson, RuleInfo } from "./regime-readout.ts";

// =====================================================================================================================
// Synthetic twin banks

/**
 * A regime for one decider of one bank. The latent `z` (0 critical, positive chaotic, negative ordered) sets the response ratio at step 30,
 * s30 = exp(0.7 z), and the exponent of the S series from step 30 on, b = bOfZ(z); both can be overridden. N(t), the damaged blocks per site, is
 * 1 at t = 0, s30^(t/30) up to 30 and s30 (t/30)^b after.
 */
export interface SynthRegime {
  z: number;
  s30?: number;
  b?: number;
  /** U twin's damage as a fraction of S's (the dust ratio at step 30). */
  ratioU?: number;
  /** The damage extent does not grow (reach stays at 4): a frozen scar. */
  frozen?: boolean;
  /** Reach growth per step after step 100 (default 0.012, above SPEED_MIN = 8 / 900). */
  speed?: number;
  /** The largest reach in voxels (default 19; 20 or more makes a site "spread", R6.5). */
  reachCap?: number;
}
export interface SynthBankOpts {
  rung?: Rung;
  mS?: number;
  nCol?: number;
  liveblk?: number;
  /** R's living voxels (the log's live_R). */
  live?: number;
  net?: SynthRegime;
  occ?: SynthRegime;
  doses?: number[];
  withS?: boolean;
  withU?: boolean;
  withN?: boolean;
  withF?: boolean;
  /** The F pair's trajectory: frozen (default, ORDERED), or a regime that makes it read CRITICAL or CHAOTIC. */
  fRegime?: SynthRegime;
  /** F's damage at step 30 as a multiple of S's (default 0.5: F < S < N). */
  fLevel?: number;
  /** N's damage as a fraction of the living blocks (default 0.5, saturated). */
  nSat?: number;
  /** U twin's block-net count held constant at this many blocks (the dust floor go/no-go b), and its median block difference (go/no-go c). */
  uNetLevel?: number;
  uMedianBlock?: number;
  k?: number;
  thetaB?: number;
  thetaV?: number;
  /** Seeds the dither of the per-site counts (default 0). */
  salt?: number;
  /** U dose as a fraction of the S dose (default 1/12; above 0.25 the U twin is unavailable). */
  uDoseFrac?: number;
}

const DEFAULT_REGIME: SynthRegime = { z: 0 };
const regimeS30 = (r: SynthRegime): number => r.s30 ?? Math.exp(0.7 * r.z);
/** The exponent of the S series from the latent: ordered below -1.2, flat across the critical middle, growing above 1 (the saturation test then reads CHAOTIC). */
const B_KNOTS: readonly (readonly [number, number])[] = [[-2, -0.7], [-1.3, -0.62], [-0.6, -0.15], [0, 0], [0.6, 0.05], [1.0, 0.2], [1.4, 0.4], [2, 0.5]];
export function bOfZ(z: number): number {
  if (z <= B_KNOTS[0][0]) return B_KNOTS[0][1];
  for (let i = 1; i < B_KNOTS.length; i++) {
    const [z0, b0] = B_KNOTS[i - 1], [z1, b1] = B_KNOTS[i];
    if (z <= z1) return b0 + ((b1 - b0) * (z - z0)) / (z1 - z0);
  }
  return B_KNOTS[B_KNOTS.length - 1][1];
}
const regimeB = (r: SynthRegime): number => r.b ?? bOfZ(r.z);
/** N(t) of a regime: damaged blocks per site per kicked block. */
export function regimeN(r: SynthRegime, t: number): number {
  const s30 = regimeS30(r);
  if (t <= 0) return 1;
  if (t < 30) return Math.pow(s30, t / 30);
  return s30 * Math.pow(t / 30, regimeB(r));
}
const reachOf = (r: SynthRegime, t: number): number => {
  const cap = r.reachCap ?? 19;
  if (t <= 0) return 0;
  if (r.frozen) return Math.min(cap, 4);
  const speed = r.speed ?? 0.012;
  const base = t < 100 ? (4 * t) / 100 : 4 + speed * (t - 100);
  const hot = regimeS30(r) > 2 ? 4 + t / 60 : 0;
  return Math.min(cap, Math.max(base, hot));
};
const SITE_W = [0.7, 1, 1.3];
/** Damaged blocks of site j at step t: N(t) times the site's weight, rounded stochastically with a deterministic dither (so the expectation holds). */
const siteCount = (r: SynthRegime, j: number, t: number, salt: number): number =>
  t <= 0 ? 1 : Math.floor(regimeN(r, t) * SITE_W[j % 3] + lowbias32((j * 7919 + t * 104729 + salt) >>> 0) / 4294967296);

function logOf(len: number, col: (t: number) => Partial<DiffRow>, liveblk: number, live = 60000): DiffLog {
  const rows: DiffRow[] = [];
  for (let t = 0; t < len; t++) {
    const row = Object.fromEntries(DIFF_COLUMNS.map((k) => [k, 0])) as DiffRow;
    Object.assign(row, { liveblk_R: liveblk, live_R: live, live_X: live, SB_R: live * 13, SB_X: live * 13 }, col(t));
    rows.push(row);
  }
  return diffLogFromRows(rows);
}
/** A log whose net and occupancy block counts are given (the other columns follow from the net count so that every TSV column has a number). */
function sLog(len: number, net: (t: number) => number, occ: (t: number) => number, liveblk: number, live = 60000): DiffLog {
  return logOf(len, (t) => {
    const n = net(t);
    return {
      n_blk: n, n_occ: occ(t), n_blk2: Math.floor(n / 2), L1c: n * 10, n_thetaV: n * 4, n_2thetaV: n * 2, n_1: n * 12, n_live: Math.floor(n / 5), n_vox: n * 15,
      L1_A: n, L1_B: n * 20, L1_C: n * 20, L1_P: n, SB_X: live * 13 + (t > 0 ? 3 : 0), live_X: live - Math.floor(n / 50),
    };
  }, liveblk, live);
}

/** A twin bank for one rung: the S twin and its per-site log, the dose twins, U, N and (optionally) the F pair, all consistent with the regimes given. */
export function synthBank(o: SynthBankOpts = {}): TwinBank {
  const mS = o.mS ?? 12;
  const nCol = o.nCol ?? 3;
  const liveblk = o.liveblk ?? 300;
  const live = o.live ?? 60000;
  const net = o.net ?? DEFAULT_REGIME;
  const occ = o.occ ?? net;
  const k = o.k ?? 12;
  const sites = Array.from({ length: mS }, (_, j) => voxelAt(20 + 45 * (j % 5), 20 + 45 * Math.floor(j / 5), 3, SLAB_GEOM));
  const colonies: number[][] = Array.from({ length: nCol }, () => []);
  sites.forEach((_, j) => colonies[j % nCol].push(j));
  const salt = o.salt ?? 0;
  const nSite = (r: SynthRegime, j: number, t: number): number => siteCount(r, j, t, salt);
  const total = (r: SynthRegime, t: number): number => sites.reduce((a, _, j) => a + nSite(r, j, t), 0);
  const doseList = o.doses ?? [4, 8, 16];
  const bank: TwinBank = {
    rung: o.rung ?? "P1", k, thetaB: o.thetaB ?? Math.ceil(k / 2), thetaV: o.thetaV ?? Math.max(2, Math.ceil(k / 4)), sites, nCol, colonies: colonies.filter((c) => c.length),
    n0: mS, n0Site: new Array(mS).fill(1), doseS: mS * k,
    doses: doseList.map((m, i) => ({
      m, n0: m, log: logOf(301, (t) => ({ n_blk: m * regimeN(net, t) * (1 - 0.04 * i), n_occ: m * regimeN(occ, t) * (1 - 0.04 * i) }), liveblk, live),
    })),
  };
  if (o.withS !== false) {
    const steps = storedSteps();
    const perSite = (f: (j: number, t: number) => number) => Array.from({ length: mS }, (_, j) => steps.map((t) => f(j, t)));
    const siteLog: SiteLog = {
      steps, n_blk: perSite((j, t) => nSite(net, j, t)), n_occ: perSite((j, t) => nSite(occ, j, t)), reach_blk: perSite((_, t) => reachOf(net, t)), reach_occ: perSite((_, t) => reachOf(occ, t)),
    };
    bank.S = { log: sLog(1001, (t) => total(net, t), (t) => (t === 0 ? 0 : total(occ, t)), liveblk, live), sites: siteLog };
    if (o.withU !== false) {
      const rn = net.ratioU ?? 0.1, ro = occ.ratioU ?? rn;
      const uNet = (t: number) => (o.uNetLevel !== undefined ? (t === 0 ? mS : o.uNetLevel) : rn * total(net, t));
      bank.U = {
        log: sLog(301, uNet, (t) => (t === 0 ? 0 : ro * total(occ, t)), liveblk, live),
        doseU: mS * k * (o.uDoseFrac ?? 1 / 12), medianBlock30: o.uMedianBlock ?? 3,
      };
    }
    if (o.withF) {
      const fr = o.fRegime ?? { z: 0, frozen: true };
      const fl = o.fLevel ?? 0.5;
      const fNet = (t: number) => (t === 0 ? mS : fl * total(net, 30) * Math.min(1, t / 30));
      const fOcc = (t: number) => (t === 0 ? 0 : fl * total(occ, 30) * Math.min(1, t / 30));
      const fSites: SiteLog = {
        steps, n_blk: perSite((j, t) => nSite(fr, j, t)), n_occ: perSite((j, t) => nSite(fr, j, t)), reach_blk: perSite((_, t) => reachOf(fr, t)), reach_occ: perSite((_, t) => reachOf(fr, t)),
      };
      bank.F = { log: sLog(1001, fNet, fOcc, liveblk, live), sites: fSites };
    }
  }
  if (o.withN !== false) {
    const level = (o.nSat ?? 0.5) * liveblk;
    bank.N = { log: sLog(301, (t) => (t === 0 ? 0 : level), (t) => (t === 0 ? 0 : level), liveblk, live) };
  }
  return bank;
}

// =====================================================================================================================
// Synthetic job files

export const SYNTH_STAMPS = { ruleSha: "synthetic", codeCommit: "synthetic", srcHash: "synthetic", treeClean: true } as const;
const OK: CheckResult = { ok: true };

export interface SynthJobOpts {
  role?: JobRole;
  kind?: "slab" | "2d";
  world: string;
  seed: number;
  T?: number;
  dev?: boolean;
  /** One bank per rung: gate and Stage 0 jobs have both, a sweep job one. */
  banks?: Partial<Record<Rung, SynthBankOpts>>;
  /** A sweep job's id carries the decider. */
  decider?: "net" | "occ";
  status?: "metered" | "extinct" | "notarget";
  extinctAt?: number;
  /** Living fraction at T (default 0.2). */
  f?: number;
  /** R's living fraction at the end of the twin phase (default f); set it out of the window for DRIFT. */
  fEnd?: number;
  /** The step of the twin phase at which R's living count reaches 0 (DIED_IN_PHASE). */
  diedAt?: number;
  checks?: Partial<Record<CheckName, CheckResult>>;
  m4?: { mode: "json" | "tsv-rounded"; path?: string };
  extras?: Partial<JobExtras>;
  stamps?: Partial<{ ruleSha: string; codeCommit: string; srcHash: string; treeClean: boolean }>;
  Bstar?: number;
  NE?: number;
}

/** Descriptive columns (R6.9, R6.10) with deterministic values that grow with the damage, so that every column of the TSV has a number. */
function descriptiveExtras(id: string, perSite1000: number): Partial<JobExtras> {
  const h = (k: string) => parseInt(sha256Hex(`${id}|${k}`).slice(0, 6), 16) / 0xffffff;
  const g = 1 - Math.exp(-0.15 * perSite1000);
  const at = (t: number) => ({ Jid: Math.min(0.99, g * (0.4 + 0.5 * h(`jid${t}`)) * (t / 1000 + 0.3)), Jg: Math.min(0.99, g * (0.35 + 0.4 * h(`jg${t}`)) * (t / 1000 + 0.3)), ngdiff: Math.round(900 * g * (t / 1000 + 0.2) * (0.5 + h(`ng${t}`))) });
  return {
    entropy: { H0: 0.9 + 0.3 * h("H0"), h_sp: 0.5 + 0.2 * h("hsp"), h_z: 0.3 + 0.2 * h("hz"), h_st: 0.4 + 0.2 * h("hst"), c_ratio: 0.5 + 0.3 * h("cr") },
    divergence: { "100": at(100), "300": at(300), "1000": at(1000) },
    scaleCurve: [1, 2, 4, 8, 16, 32].map((s, i) => Math.max(0.0005, 0.12 * g * Math.exp(-0.9 * i) * (0.8 + 0.4 * h(`sc${s}`)))),
  };
}

/** The files of one synthetic job: one per rung in `banks` (none: one file without a bank). */
export function synthJob(o: SynthJobOpts): JobFile[] {
  const kind = o.kind ?? "slab";
  const T = o.T ?? REGIME.T0;
  const cells = kind === "slab" ? 524288 : 65536;
  const status = o.status ?? "metered";
  const f = status === "extinct" ? 0 : (o.f ?? 0.2);
  const living = Math.round(f * cells);
  const liveblk = Math.min(1024, Math.max(40, Math.round(f * 2600)));
  const rungs = (o.banks ? (Object.keys(o.banks) as Rung[]) : []).sort();
  const make = (rung: Rung | null): JobFile => {
    const bank = rung && status === "metered" ? synthBank({ liveblk, live: living, ...o.banks![rung]!, rung }) : undefined;
    const liveR = bank?.S?.log.live_R ?? new Array(1001).fill(living);
    const liveRDied = o.diedAt !== undefined ? liveR.map((v, t) => (t >= o.diedAt! ? 0 : v)) : liveR;
    const id = jobId({ dev: o.dev, kind, world: o.world, seed: o.seed, T, rung: rung ?? "P1", decider: !o.dev && (o.role === "SWEEP" || o.role === "B0" || o.role === undefined) ? (o.decider ?? "net") : undefined });
    const checks: Partial<Record<CheckName, CheckResult>> = { C1: OK, C2: OK, C3: OK, C4: o.m4 ? { ok: true } : { ok: true, applicable: false }, C5: OK, C6: OK, C7: OK, C8: OK, ...o.checks };
    const j: JobFile = {
      id, role: o.role ?? "SWEEP", kind, world: o.world, seed: o.seed, T, dev: o.dev, extinctAt: status === "extinct" ? (o.extinctAt ?? 6000) : null, cells, living,
      Bstar: status === "extinct" ? null : 12, NE: status === "notarget" ? 10 : (o.NE ?? 200), liveblkT: liveblk, liveT: living || 1, h0: selectionSeed(o.seed, T),
      liveR: liveRDied, livingEnd: o.diedAt !== undefined ? 0 : Math.round((o.fEnd ?? f) * cells), bank, checks,
      ruleSha: o.stamps?.ruleSha ?? SYNTH_STAMPS.ruleSha, codeCommit: o.stamps?.codeCommit ?? SYNTH_STAMPS.codeCommit, srcHash: o.stamps?.srcHash ?? SYNTH_STAMPS.srcHash,
      treeClean: o.stamps?.treeClean ?? SYNTH_STAMPS.treeClean, m4Mode: o.m4 ? o.m4.mode : "none",
      synthetic: true, stateHashT: sha256Hex(`${id}|hash`).slice(0, 16), stateDigestT: sha256Hex(`${o.world}|${o.seed}|digest`).slice(0, 16),
      seconds: 100, stepsPerSec: 200, device: "synthetic", livingTrace: [],
      ...(bank ? descriptiveExtras(id, bank.S ? bank.S.log.n_blk[1000] / Math.max(bank.sites.length, 1) : 0) : {}), ...o.extras,
    };
    if (o.m4) j.m4Source = { path: o.m4.path ?? `m4-calibration/${o.world}-seed${o.seed}.json`, sha256: sha256Hex(`m4|${o.world}|${o.seed}`), mode: o.m4.mode };
    return j;
  };
  return rungs.length ? rungs.map((r) => make(r)) : [make(null)];
}

// =====================================================================================================================
// The synthetic sweep: M4's real living fractions at T0 for groups A and B, regimes chosen by hand for the rest

export interface M4Run { extinctAt: number | null; living: number; livingFrac: number; trace: number[] }
/** Reads experiments/3d-slab/m4-results.tsv into runs keyed `mu-sigma-lightK-seed`. */
export function readM4Tsv(path: string): Map<string, M4Run> {
  const out = new Map<string, M4Run>();
  if (!existsSync(path)) return out;
  const lines = readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean);
  const head = lines[0].split("\t");
  const col = (n: string) => head.indexOf(n);
  for (const line of lines.slice(1)) {
    const c = line.split("\t");
    const ext = c[col("extinctAt")];
    out.set(`${c[col("mu")]}-${c[col("sigma")]}-${c[col("lightK")]}-${c[col("seed")]}`, {
      extinctAt: ext ? Number(ext) : null, living: Number(c[col("living")]), livingFrac: Number(c[col("livingFrac")]), trace: (c[col("livingFracEvery5k")] ?? "").split(" ").filter(Boolean).map(Number),
    });
  }
  return out;
}

export type M4Label = "extinct" | "sparse" | "transient" | "carpet";
/** M4's label of a (mu, sigma, lightK) at 50,000 steps by majority of its three seeds: extinct, carpet (>= 85 percent living), sparse (alive, under 1 percent) or transient (in the livable window, still changing). Descriptive only. */
export function m4Label(m4: Map<string, M4Run>, mu: number, sigma: number, lightK: number): M4Label | null {
  const runs = [101, 102, 103].map((s) => m4.get(`${mu}-${sigma}-${lightK}-${s}`)).filter((r): r is M4Run => !!r);
  if (runs.length < 3) return null;
  if (runs.filter((r) => r.extinctAt !== null).length >= 2) return "extinct";
  if (runs.filter((r) => r.livingFrac >= REGIME.WINDOW_HI).length >= 2) return "carpet";
  if (runs.filter((r) => r.extinctAt === null && r.livingFrac < REGIME.WINDOW_LO).length >= 2) return "sparse";
  return "transient";
}

const hash01 = (s: string): number => lowbias32(parseInt(sha256Hex(s).slice(0, 8), 16)) / 4294967296;

/**
 * The latent regime of a windowed job of a setting: a table for the story the page tells (B0 and a ring of neighbours read critical at T0, a few read
 * ordered, a few hot, one is dusty, one splits), and a late-check shift of +1.4 (everything is hot at T1).
 */
const Z_TABLE: Record<string, number> = {
  "mu30-s8-k256": 0.2, "mu30-s12-k256": 0.95, "mu30-s16-k256": -0.2, "mu30-s20-k256": -1.5, "mu40-s8-k256": 1.6, "mu40-s20-k256": 1.3,
  "mu30-s8-k1024": 1.5, "mu30-s16-k1024": -1.45, "mu30-s20-k1024": -0.5, "mu30-s16-k4096": 1.7, "mu30-s20-k4096": 0.1,
  "mu30-s8-k256-dA100": -0.3, "mu30-s8-k256-dA240": 1.5, "mu30-s8-k256-dC100": 0.15, "mu30-s8-k256-dC240": 0.0, "mu30-s8-k256-dS75": -1.6, "mu30-s8-k256-dS240": 0.35,
  "mu30-s8-k256-gK16": 0.3, "mu30-s8-k256-gK256": 0.2, "mu30-s8-k256-gK1024": 0.2, "mu30-s8-k256-dtQ26": -0.1, "mu30-s8-k256-dtQ102": 1.7, "mu30-s8-k256-sp4": 0.1,
  "mu30-s8-k256-sp16": 1.4, "mu30-s8-k256-nomut": 0.25,
};
export function synthZ(spec: SettingSpec, late = false): number {
  const z = Z_TABLE[spec.id] ?? 1.8;
  return late ? z + 1.4 : z;
}

const SEEDS3 = [101, 102, 103];
function sweepJobs(m4: Map<string, M4Run>, T: number, only?: readonly string[]): JobFile[] {
  const out: JobFile[] = [];
  const b0 = (seed: number) => m4.get(`30-8-256-${seed}`);
  for (const spec of sweepSettings()) {
    if (only && !only.includes(spec.id)) continue;
    const p = spec.params;
    for (const seed of SEEDS3) {
      const inAB = spec.group === "A" || spec.group === "B";
      const run = inAB ? m4.get(`${p.mu}-${p.sigma}-${p.lightK}-${seed}`) : b0(seed);
      const at = (t: number) => (run && run.trace.length ? run.trace[Math.min(run.trace.length - 1, t / 5000 - 1)] : 0.15);
      const extinct = run ? run.extinctAt !== null && run.extinctAt <= T : false;
      const f = T === REGIME.T1 ? (spec.group === "C" || spec.group === "D" || spec.group === "control" ? 0.3 : at(T)) : at(T);
      const fJob = extinct ? 0 : spec.group === "C" || spec.group === "D" || spec.group === "control" ? Math.min(0.5, f * (1 + 0.1 * (hash01(`${spec.id}${seed}`) - 0.5))) : f;
      const j = hash01(`${spec.id}|${seed}`) - 0.5;
      const z = synthZ(spec, T === REGIME.T1) + 0.28 * j;
      const dusty = spec.id === "mu30-s8-k256-dtQ102";
      const reg = { z, ratioU: dusty ? 0.6 : Math.min(0.2, 0.07 + 0.05 * Math.max(0, z)) };
      const m4json = inAB && seed <= 103 && T === REGIME.T0 ? ({ mode: "json" } as const) : undefined;
      const extras: Partial<JobExtras> = {};
      if (spec.params.gateK !== B0_PARAMS.gateK && (p.gateK === 256 || p.gateK === 1024)) extras.stateDigestT = sha256Hex(`${B0_ID}|${seed}|digest`).slice(0, 16);
      out.push(...synthJob({
        world: spec.id, seed, T, decider: "net", status: extinct ? "extinct" : "metered", extinctAt: run?.extinctAt ?? 6000, f: fJob,
        banks: { P1: { net: reg, salt: seed * 31 + Math.round(1000 * hash01(spec.id)) } }, m4: m4json, extras,
      }));
    }
  }
  return out;
}

/** What a job of the gate or Stage 0 bank is, passed to the tweak callbacks that bend a fixture. */
export interface GateCtx {
  role: JobRole;
  world: string;
  T: number;
  seed: number;
  rung: Rung | null;
}
export interface SynthGateOpts {
  /** Extra bank options for the job's bank under this rung (merged over the passing default; `net` and `occ` replace the default regimes). */
  bank?: (c: GateCtx & { rung: Rung }) => Partial<SynthBankOpts> | undefined;
  /** Extra job options (status, checks, stamps, f, ...) for the job. */
  job?: (c: GateCtx) => Partial<SynthJobOpts> | undefined;
  /** Build only the jobs that a callback bent (the tests re-analyse those and reuse the rest of the passing set). */
  touchedOnly?: boolean;
}

const ALIVE_REGIME: SynthRegime = { z: 0, ratioU: 0.1 };
const bothRungs = (c: GateCtx, base: SynthBankOpts, o: SynthGateOpts): { banks: Partial<Record<Rung, SynthBankOpts>>; touched: boolean } => {
  const out: Partial<Record<Rung, SynthBankOpts>> = {};
  let touched = false;
  for (const [rung, salt] of [["P1", 1], ["P2", 2]] as const) {
    const t = o.bank?.({ ...c, rung });
    if (t) touched = true;
    out[rung] = { ...base, salt: salt + c.seed, ...(t ?? {}) };
  }
  return { banks: out, touched };
};

/**
 * Gate jobs that pass: the dead world, both alive 2D worlds at T1 and T2, the carpet and the relic, each with both rungs. `o` bends them
 * (a regime, a dust ratio, a control, a status, a stamp) so that every cause of R9.2 can be produced.
 */
export function syntheticGateJobs(o: SynthGateOpts = {}): JobFile[] {
  const out: JobFile[] = [];
  const alive: SynthBankOpts = { net: ALIVE_REGIME, occ: ALIVE_REGIME, withF: true, withN: true, nCol: 3 };
  const mk = (c: GateCtx, base: Partial<SynthJobOpts>, bank: SynthBankOpts | null) => {
    const ctx = { ...c };
    const b = bank ? bothRungs(ctx, bank, o) : null;
    const tweak = o.job?.(ctx);
    if (o.touchedOnly && !(b && b.touched) && !tweak) return;
    out.push(...synthJob({ role: c.role, world: c.world, seed: c.seed, T: c.T, ...base, banks: b ? b.banks : base.banks, ...(tweak ?? {}) }));
  };
  // a dead world has no twins, but the runner writes both rung files for it (the reader joins them): two files with no bank
  [6000, 9000, 4000].forEach((extinctAt, i) => mk({ role: "G1", world: gateSlabId("G1"), T: REGIME.T0, seed: 101 + i, rung: null }, { status: "extinct", extinctAt, m4: { mode: "json" }, banks: { P1: {}, P2: {} } }, null));
  for (const world of ["spots-m3", "gradient-m3"]) for (const T of refTimes(REGIME)) for (const seed of SEEDS3)
    mk({ role: "G2", world, T, seed, rung: null }, { kind: "2d", f: 0.78 }, alive);
  const carpet: SynthBankOpts = { net: { z: 2.2, ratioU: 0.12 }, occ: { z: 2.2, ratioU: 0.12 }, withF: true, withN: true, nCol: 1 };
  for (const seed of SEEDS3) mk({ role: "G3", world: gateSlabId("G3"), T: REGIME.T0, seed, rung: null }, { f: 0.97, m4: { mode: "json" } }, carpet);
  for (const seed of [101, 102]) mk({ role: "G4", world: gateSlabId("G4"), T: REGIME.T0, seed, rung: null }, { f: 0.02, m4: { mode: "json" } }, { ...alive, nCol: 3 });
  return out;
}

/** Stage 0 jobs (development seeds 9001 to 9003, ids prefixed dev-): the gate worlds without G1 and G4, plus B0 for information. */
export function syntheticDevJobs(o: SynthGateOpts = {}): JobFile[] {
  const out: JobFile[] = [];
  const alive: SynthBankOpts = { net: ALIVE_REGIME, occ: ALIVE_REGIME, withF: true, withN: true, nCol: 3 };
  const mk = (c: GateCtx, base: Partial<SynthJobOpts>, bank: SynthBankOpts) => {
    const b = bothRungs(c, bank, o);
    const tweak = o.job?.(c);
    if (o.touchedOnly && !b.touched && !tweak) return;
    out.push(...synthJob({ role: c.role, world: c.world, seed: c.seed, T: c.T, dev: true, ...base, banks: b.banks, ...(tweak ?? {}) }));
  };
  const DEV_SEEDS = [9001, 9002, 9003];
  for (const world of ["spots-m3", "gradient-m3"]) for (const T of refTimes(REGIME)) for (const seed of DEV_SEEDS)
    mk({ role: "G2", world, T, seed, rung: null }, { kind: "2d", f: 0.78 }, alive);
  for (const seed of DEV_SEEDS) mk({ role: "G3", world: gateSlabId("G3"), T: REGIME.T0, seed, rung: null }, { f: 0.97 }, { net: { z: 2.2, ratioU: 0.12 }, occ: { z: 2.2, ratioU: 0.12 }, withF: true, withN: true, nCol: 1 });
  for (const seed of DEV_SEEDS) mk({ role: "B0", world: B0_ID, T: REGIME.T0, seed, rung: null }, { f: 0.15 }, { net: { z: 0.3, ratioU: 0.1 }, occ: { z: 0.3, ratioU: 0.1 }, withF: true, withN: true, nCol: 3 });
  return out;
}

export const SYNTH_COMBO: Combination = { rung: "P1", decider: "net" };
export function syntheticRule(): RuleInfo {
  return { status: "DRAFT", path: "(synthetic: no rule file)", sha256: sha256Hex("synthetic rule"), combo: SYNTH_COMBO, comboWhy: null, devLog: "(synthetic)", devLogSha: sha256Hex("(synthetic)") };
}

/** A deterministic capture for an example job: damaged voxels around its sites at steps 10, 100 and 1000, growing as the job's regime says (at most 4,000 points each). */
export function syntheticCapture(job: JobFile, e: number | null): Capture {
  const steps: Record<string, number[]> = {};
  const sites = job.bank?.sites ?? [];
  const grow = e === null ? 0 : e;
  for (const t of [10, 100, 1000]) {
    const reach = Math.max(2, Math.min(60, (t === 10 ? 3 : t === 100 ? 6 : 10) * (1 + 1.4 * Math.max(0, grow) + 0.4 * Math.min(0, grow) * (t === 1000 ? 1.5 : 0.5))));
    const n = Math.min(4000, Math.round((t === 10 ? 20 : t === 100 ? 80 : 160) * sites.length * Math.max(0.15, 1 + 1.2 * grow)));
    const pts: number[] = [];
    for (let i = 0; i < n; i++) {
      const site = sites[i % Math.max(sites.length, 1)] ?? 0;
      const x = site % 256, y = Math.floor(site / 256) % 256;
      const u1 = lowbias32((i * 2654435761 + t) >>> 0) / 4294967296, u2 = lowbias32((i * 40503 + t * 977 + 7) >>> 0) / 4294967296, u3 = lowbias32((i * 69069 + t * 31) >>> 0) / 4294967296;
      const r = reach * Math.sqrt(u1), a = 2 * Math.PI * u2;
      pts.push((((Math.round(x + r * Math.cos(a)) % 256) + 256) % 256), (((Math.round(y + r * Math.sin(a)) % 256) + 256) % 256), Math.min(7, Math.floor(u3 * 8)));
    }
    steps[String(t)] = pts;
  }
  return { id: job.id, W: 256, H: 256, D: 8, steps };
}

export interface SyntheticBundle {
  results: ResultsJson;
  gate: GateFile;
  jobs: { t0: JobFile[]; t1: JobFile[]; gate: JobFile[] };
  captures: Record<string, Capture>;
}

/**
 * The synthetic sweep through the real reader: gate jobs -> gate.json; T0 jobs -> setting rows -> the late check names the settings to re-run ->
 * their T1 jobs -> the outcome. Everything carries synthetic: true, so every output says SYNTHETIC.
 */
export function syntheticResults(o: { m4Path?: string; sensitivity?: boolean; boot?: number } = {}): SyntheticBundle {
  const consts = o.boot === undefined ? REGIME : { ...REGIME, BOOT: o.boot };
  const m4 = readM4Tsv(o.m4Path ?? resolve(dirname(fileURLToPath(import.meta.url)), "m4-results.tsv"));
  const rule = syntheticRule();
  const gateFiles = syntheticGateJobs();
  const gateBundles = bundleJobs(gateFiles.map((job) => ({ file: `${job.id}.json`, job })), ["net", "occ"], null, consts);
  const gate = evaluateGateJobs(gateBundles, rule, SYNTH_COMBO, "SYNTHETIC").gate;
  const t0 = sweepJobs(m4, REGIME.T0);
  const eval1 = (t1: JobFile[], sens: boolean) =>
    evaluateSweepJobs(bundleJobs([...t0, ...t1].map((job) => ({ file: `${job.id}.json`, job })), ["net"], null, consts), rule, gate, SYNTH_COMBO, { label: "SYNTHETIC", screen: null, capturesDir: null, sensitivity: sens });
  const first = eval1([], false);
  const late0 = first.results.outcome.late?.late0 ?? [];
  const t1 = sweepJobs(m4, REGIME.T1, late0);
  const final = eval1(t1, o.sensitivity !== false);
  const captures: Record<string, Capture> = {};
  for (const c of final.results.cards) {
    if (!c.id) continue;
    const job = t0.find((j) => j.id === c.id);
    if (job) captures[c.id] = syntheticCapture(job, c.e);
  }
  return { results: final.results, gate, jobs: { t0, t1, gate: gateFiles }, captures };
}

// =====================================================================================================================
// The page: labelling and refusal

export type PageLabel = "synthetic" | "draft" | "result";

/**
 * The SHA-256 of the frozen rule if experiments/3d-slab/regime-rule.md exists and the last hash in REGIME-FROZEN and the last in
 * runs/regime/RULE.sha256 both equal it (the reader and the runner read the two records the same way), else null.
 */
export function frozenRuleHash(root: string): string | null {
  const rule = resolve(root, "experiments/3d-slab/regime-rule.md");
  const rec = resolve(root, "experiments/3d-slab/REGIME-FROZEN");
  const second = resolve(root, "runs/regime/RULE.sha256");
  if (!existsSync(rule) || !existsSync(rec) || !existsSync(second)) return null;
  const sha = sha256Hex(readFileSync(rule));
  const a = parseHashFile(readFileSync(rec, "utf8"));
  const b = parseHashFile(readFileSync(second, "utf8"));
  return a.length && b.length && a[a.length - 1] === sha && b[b.length - 1] === sha ? sha : null;
}

/**
 * The label a page may carry. Synthetic results are labelled synthetic, draft results draft; results without either are a "result" only if they
 * carry the frozen rule's hash: otherwise the builder refuses. An INVALID-RUN file is refused whatever it says.
 */
export function pageLabel(results: ResultsJson, frozenSha: string | null): PageLabel {
  if (results.schema !== "regime-results/1") throw new ReaderError("REFUSED: not a regime-results/1 file");
  if (results.outcome.id === "INVALID-RUN") throw new ReaderError("REFUSED: the results are an INVALID-RUN (no outcome); no page is built from them");
  if (results.synthetic) return "synthetic";
  if (results.draft || results.rule.status === "DRAFT") return "draft";
  if (!frozenSha) throw new ReaderError("REFUSED: these results claim a frozen rule, but experiments/3d-slab/regime-rule.md is missing or does not match REGIME-FROZEN");
  if (results.rule.sha256 !== frozenSha) throw new ReaderError(`REFUSED: the results carry rule hash ${results.rule.sha256.slice(0, 12)}, the frozen rule is ${frozenSha.slice(0, 12)}; a page is not labelled as a result without the frozen rule's hash`);
  if (results.gate.ruleSha !== frozenSha) throw new ReaderError("REFUSED: the gate behind these results does not carry the frozen rule's hash");
  return "result";
}

export const esc = (s: unknown): string => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
/** JSON for a script tag: no `<` so that `</script>` and `<!--` cannot occur. */
export const jsonForScript = (x: unknown): string => JSON.stringify(x, round6).replace(/</g, "\\u003c").split(String.fromCharCode(0x2028)).join("\\u2028").split(String.fromCharCode(0x2029)).join("\\u2029");

/** Splits a long outcome sentence at its "(job ids ...)" or "(jobs ...)" list so the page can fold the list. */
export function foldJobIds(text: string): { head: string; ids: string[]; tail: string } {
  const m = /^(.*?)\s*\((?:job ids|jobs) ([^)]*)\)(.*)$/s.exec(text);
  if (!m || m[2] === "none") return { head: text, ids: [], tail: "" };
  return { head: m[1], ids: m[2].split(/,\s*/).filter(Boolean), tail: m[3] };
}

const HEADLINES: Record<string, string> = {
  "INVALID-RUN": "Invalid run", "GATE-FAIL": "Gate failed", "NO-CONTRAST": "No contrast", "PENDING-LATE-CHECK": "Late check pending", "BAND-FOUND": "Band found",
  "LATE-INCONCLUSIVE": "Late check inconclusive", "TRANSIENT-BAND": "Transient band", "EMPTY-WINDOW": "Empty window", "TOO-MANY-UNMETERABLE": "Too many unmeterable",
  "THIN-POOL": "Thin pool", "SENSITIVE-EVERYWHERE": "Sensitive everywhere", "UNDER-SUPPORTED": "Under-supported", "UNRESOLVED": "Unresolved", "UNRESOLVED-FINAL": "Unresolved, final",
  "CROSSING-BRACKETED": "Crossing bracketed", "NO-BAND": "No band",
};
export const headlineOf = (r: ResultsJson): string => (r.outcome.id === "BAND-FOUND" && r.outcome.refClass === "CHAOTIC" ? "Alive-like settings found" : HEADLINES[r.outcome.id] ?? r.outcome.id);

// =====================================================================================================================
// The page: server-rendered parts

function bannerHtml(label: PageLabel, r: ResultsJson): string {
  if (label === "synthetic")
    return `<div class="banner synth" role="note"><p class="big">synthetic: not a result</p><p>Every number, class and outcome on this page was generated by <code>regime-html.ts --synthetic</code> and run through the real reader, to show what the page looks like. No run produced it, and nothing on it says anything about the slab. It will be rebuilt from the real <code>regime-results.json</code> once the gate and the sweep have run.</p></div>`;
  if (label === "draft")
    return `<div class="banner draft" role="note"><p class="big">DRAFT: the rule was not frozen</p><p>These results were read with <code>--draft</code> against <code>${esc(r.rule.path)}</code> (SHA-256 <code>${esc(r.rule.sha256.slice(0, 16))}</code>). They are not a result of the registered programme.</p></div>`;
  return "";
}

function chipsHtml(label: PageLabel, r: ResultsJson): string {
  const chips: string[] = [];
  chips.push(label === "synthetic" ? `<li class="chip note">Synthetic: not a result</li>` : label === "draft" ? `<li class="chip note">DRAFT</li>` : `<li class="chip">Frozen rule ${esc(r.rule.sha256.slice(0, 12))}</li>`);
  chips.push(`<li class="chip">Combination (${esc(r.combo.rung)}, ${esc(r.combo.decider)})</li>`);
  chips.push(`<li class="chip">Gate ${r.gate.pass ? "passed" : "failed"}</li>`);
  chips.push(`<li class="chip">${r.counts.t0} jobs at T0${r.counts.t1 ? `, ${r.counts.t1} at T1` : ""}</li>`);
  return `<ul class="chips">${chips.join("")}</ul>`;
}

function outcomeHtml(r: ResultsJson, label: PageLabel): string {
  const o = r.outcome;
  const f = foldJobIds(o.text);
  const prefix = label === "synthetic" ? `<span class="synthtag">synthetic: not a result</span> ` : label === "draft" ? `<span class="synthtag">DRAFT</span> ` : "";
  const ids = f.ids.length ? ` <details class="ids"><summary>job ids (${f.ids.length})</summary><p class="mono">${f.ids.map(esc).join(", ")}</p></details>` : "";
  const details = o.details.length ? `<ul class="details">${o.details.map((d) => `<li>${esc(d)}</li>`).join("")}</ul>` : "";
  return `<section id="verdict" aria-labelledby="verdict-h"><h2 id="verdict-h"><span class="idx">1</span>What the rule concluded</h2>
<div class="verdict-card"><p class="verdict">${prefix}${esc(headlineOf(r))}</p><p class="outcome-text">${esc(f.head)}${esc(f.tail.trim())}${ids}</p>${details}<p class="scale">${esc(o.footer)}</p></div></section>`;
}

function gateHtml(r: ResultsJson): string {
  const g = r.gate;
  const mark = (c: { holds: boolean | null; info: boolean }) => (c.holds === null ? `<span class="tag plain">label</span>` : c.holds ? `<span class="ok">${c.info ? "yes (info)" : "holds"}</span>` : `<span class="bad">${c.info ? "no (info)" : "fails"}</span>`);
  const rows = g.conditions.map((c) => `<tr><td class="mono">${esc(c.id)}</td><td>${esc(c.what)}</td><td>${mark(c)}</td><td>${esc(c.detail)}</td></tr>`).join("");
  return `<section id="gate" aria-labelledby="gate-h"><h2 id="gate-h"><span class="idx">2</span>The gate</h2>
<p class="sub">${esc(g.text)} ${g.details.map(esc).join(" ")}</p>
<div class="tablewrap"><table class="gate"><thead><tr><th>id</th><th>condition</th><th>reading</th><th>detail</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
}

function cardShell(i: number, c: ResultsJson["cards"][number]): string {
  const title = c.id ? `<p class="mono jobid">${esc(c.id)}</p>` : `<p class="muted">no job</p>`;
  const kindTag = c.kind === "class" ? `${c.slot}` : c.kind === "none" ? "none" : "nearest, labelled";
  const nums = c.id
    ? `<dl class="nums"><dt>job class</dt><dd>${esc(c.jobClass ?? "no class")}</dd><dt>e</dt><dd>${c.e === null ? "n/a" : esc(Number(c.e.toFixed(3)))}</dd><dt>s(30)</dt><dd>${c.s30 === null ? "n/a" : esc(Number(c.s30.toFixed(3)))}</dd><dt>b</dt><dd>${c.b === null ? "n/a" : esc(Number(c.b.toFixed(3)))}</dd><dt>ratio U / S</dt><dd>${c.ratioU === null ? "n/a" : esc(Number(c.ratioU.toFixed(3)))} (${esc(c.dust ?? "")})</dd><dt>form</dt><dd>${esc(c.form ?? "n/a")}${c.saturated ? ", saturated" : ""}</dd><dt>k, sites</dt><dd>${c.k ?? "n/a"}, ${c.mS ?? "n/a"} in ${c.nCol ?? "n/a"} colonies</dd></dl>`
    : "";
  return `<article class="card runcard${c.kind === "class" ? " lit" : ""}" data-card="${i}"><p class="tag${c.kind === "class" ? "" : " plain"}">${esc(c.slot)}${c.kind === "class" ? "" : ` · ${esc(kindTag)}`}</p>${title}<p class="note">${esc(c.note)}</p>${nums}
<div class="charts" data-charts="${i}"></div><div class="proj" data-proj="${i}"></div></article>`;
}

/** Packs a capture for the page: per step, the flat [x, y, z] bytes as base64. */
export function packCapture(c: Capture): { W: number; H: number; D: number; steps: Record<string, string> } {
  const steps: Record<string, string> = {};
  for (const [t, pts] of Object.entries(c.steps)) steps[t] = Buffer.from(Uint8Array.from(pts.slice(0, 12000).map((v) => Math.max(0, Math.min(255, v))))).toString("base64");
  return { W: c.W, H: c.H, D: c.D, steps };
}

// =====================================================================================================================
// The page: assets (generated from the brainstorm page tokens and the page script; edit by regenerating)
export const TOKENS_AND_BASE_CSS = String.raw`:root {
  color-scheme: light;
  --bg: oklch(94.5% 0.012 88);
  --surface: oklch(98.5% 0.007 88);
  --raised: oklch(91.5% 0.014 88);
  --hover: oklch(87.5% 0.018 88);
  --line: oklch(83% 0.016 88);
  --line-soft: oklch(90% 0.012 88);
  --text: oklch(23% 0.022 80);
  --muted: oklch(45% 0.022 80);
  --soft: oklch(51% 0.022 80);
  --control-line: oklch(62% 0.022 82);
  --sun: oklch(87% 0.165 93);
  --sun-soft: oklch(94% 0.08 95);
  --sun-ink: oklch(49% 0.125 72);
  --life: oklch(52% 0.15 150);
  --life-fill: oklch(86% 0.13 150);
  --error: oklch(51% 0.18 28);
  --field: oklch(12% 0.01 160);
  --sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, system-ui, sans-serif;
  --mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  --radius: 8px;
  --radius-lg: 14px;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    color-scheme: dark;
    --bg: oklch(17% 0.012 80);
    --surface: oklch(20.5% 0.013 80);
    --raised: oklch(26% 0.016 80);
    --hover: oklch(31% 0.018 80);
    --line: oklch(35% 0.016 80);
    --line-soft: oklch(28% 0.014 80);
    --text: oklch(94% 0.012 85);
    --muted: oklch(71% 0.016 85);
    --soft: oklch(64% 0.016 85);
    --control-line: oklch(52% 0.016 82);
    --sun: oklch(85% 0.16 92);
    --sun-soft: oklch(36% 0.06 85);
    --sun-ink: oklch(82% 0.14 88);
    --life: oklch(80% 0.14 150);
    --life-fill: oklch(74% 0.15 150);
    --error: oklch(76% 0.14 28);
  }
}
:root[data-theme="dark"] {
  color-scheme: dark;
  --bg: oklch(17% 0.012 80);
  --surface: oklch(20.5% 0.013 80);
  --raised: oklch(26% 0.016 80);
  --hover: oklch(31% 0.018 80);
  --line: oklch(35% 0.016 80);
  --line-soft: oklch(28% 0.014 80);
  --text: oklch(94% 0.012 85);
  --muted: oklch(71% 0.016 85);
  --soft: oklch(64% 0.016 85);
  --control-line: oklch(52% 0.016 82);
  --sun: oklch(85% 0.16 92);
  --sun-soft: oklch(36% 0.06 85);
  --sun-ink: oklch(82% 0.14 88);
  --life: oklch(80% 0.14 150);
  --life-fill: oklch(74% 0.15 150);
  --error: oklch(76% 0.14 28);
}
* { box-sizing: border-box; }
html, body { margin: 0; }
body { background: var(--bg); color: var(--text); font: 15px/1.5 var(--sans); -webkit-font-smoothing: antialiased; padding: 0 16px 64px; }
a { color: inherit; text-decoration-color: var(--control-line); text-underline-offset: .15em; overflow-wrap: anywhere; }
a:hover { text-decoration-color: currentColor; }
code { font-family: var(--mono); font-size: .9em; background: var(--raised); padding: .05em .3em; border-radius: 4px; overflow-wrap: anywhere; }
.wrap { max-width: 1040px; margin: 0 auto; }
header.top { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 18px 0 8px; flex-wrap: wrap; }
.eyebrow { font-size: 12px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--sun-ink); margin: 0; }
h1 { font-size: clamp(28px, 4.5vw, 40px); line-height: 1.1; letter-spacing: -.02em; font-weight: 800; margin: 6px 0 10px; }
.lede { font-size: 17px; max-width: 64ch; color: var(--muted); margin: 0 0 6px; }
.lede strong { color: var(--text); }
.chips { display: flex; gap: 8px; flex-wrap: wrap; margin: 10px 0 0; padding: 0; list-style: none; }
.chip { font-size: 12px; font-weight: 600; padding: 3px 9px; border-radius: 999px; background: var(--raised); color: var(--muted); }
.chip.note { background: var(--sun-soft); color: var(--sun-ink); }
button.theme { font: inherit; font-size: 13px; font-weight: 600; color: var(--text); background: var(--raised); border: 0; border-radius: var(--radius); padding: 7px 12px; cursor: pointer; }
button.theme:hover { background: var(--hover); }
button:focus-visible, [tabindex]:focus-visible { outline: 2px solid var(--text); outline-offset: 2px; }
section { margin: 40px 0 0; }
h2 { font-size: 22px; letter-spacing: -.01em; margin: 0 0 4px; }
h2 .idx { font-family: var(--mono); font-weight: 500; color: var(--sun-ink); margin-right: 8px; font-size: 15px; }
.sub { color: var(--muted); margin: 0 0 16px; max-width: 72ch; }
figure { margin: 0; background: var(--surface); border: 1px solid var(--line-soft); border-radius: var(--radius-lg); padding: 16px; overflow-x: auto; }
figure + figure, figure + .cards, .cards + figure, .cards + .cards { margin-top: 14px; }
figcaption { font-size: 13px; color: var(--soft); margin-top: 10px; max-width: 80ch; }
.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(240px, 100%), 1fr)); gap: 12px; }
.cards > *, .grid2 > * { min-width: 0; }
.card { background: var(--surface); border: 1px solid var(--line-soft); border-radius: var(--radius-lg); padding: 14px 16px; }
.card h3 { margin: 0 0 6px; font-size: 15px; }
.card p { margin: 0; color: var(--muted); font-size: 14px; }
.card p + p { margin-top: 6px; }
.card .tag { display: inline-block; font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--sun-ink); margin-bottom: 6px; }
.card .tag.plain { color: var(--soft); }
table { border-collapse: collapse; margin-top: 8px; font-size: 14px; }
th, td { text-align: left; padding: 4px 12px 4px 0; border-bottom: 1px solid var(--line-soft); vertical-align: top; }
td.num, th.num { text-align: right; font-family: var(--mono); font-variant-numeric: tabular-nums; }
th { font-weight: 600; color: var(--muted); font-size: 13px; }
.grid2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(300px, 100%), 1fr)); gap: 14px; }
footer { margin-top: 48px; font-size: 13px; color: var(--soft); border-top: 1px solid var(--line-soft); padding-top: 14px; }
@media (max-width: 640px) { body { font-size: 14px; } figure { padding: 12px; } }

/* ---- regime page: divergence scale tokens, both themes ---- */
:root { --cold: oklch(58% 0.13 250); --hot: oklch(68% 0.17 48); --neutral: oklch(90% 0.014 88); --halo: oklch(98.5% 0.007 88); }
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) { --cold: oklch(64% 0.12 250); --hot: oklch(72% 0.16 52); --neutral: oklch(30% 0.016 80); --halo: oklch(20.5% 0.013 80); }
}
:root[data-theme="dark"] { --cold: oklch(64% 0.12 250); --hot: oklch(72% 0.16 52); --neutral: oklch(30% 0.016 80); --halo: oklch(20.5% 0.013 80); }
.mono { font-family: var(--mono); font-size: .9em; overflow-wrap: anywhere; }
.muted { color: var(--muted); }
.banner { border: 2px solid var(--sun-ink); background: var(--sun-soft); color: var(--text); border-radius: var(--radius-lg); padding: 12px 16px; margin: 14px 0 0; }
.banner.draft { border-style: dashed; }
.banner .big { font-size: 22px; font-weight: 800; letter-spacing: -.01em; margin: 0 0 4px; color: var(--sun-ink); text-transform: uppercase; }
.banner p { margin: 0; font-size: 14px; }
.banner p + p { margin-top: 4px; }
.synthtag { font-size: 12px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; background: var(--sun-soft); color: var(--sun-ink); padding: 2px 8px; border-radius: 999px; margin-right: 8px; vertical-align: 3px; white-space: nowrap; }
.verdict-card { background: var(--surface); border: 1px solid var(--sun-ink); border-radius: var(--radius-lg); padding: 16px 18px; }
.verdict { font-size: 24px; font-weight: 800; margin: 0 0 6px; letter-spacing: -.01em; }
.outcome-text { margin: 0; font-size: 15px; max-width: 80ch; overflow-wrap: anywhere; }
.details { margin: 8px 0 0; padding-left: 18px; font-size: 14px; color: var(--muted); overflow-wrap: anywhere; }
.scale { margin: 12px 0 0; font-size: 12.5px; color: var(--soft); max-width: 90ch; border-top: 1px solid var(--line-soft); padding-top: 8px; overflow-wrap: anywhere; }
details.ids { display: block; margin-top: 6px; }
details.ids summary { cursor: pointer; color: var(--sun-ink); font-weight: 600; font-size: 13px; }
details.ids p { margin: 6px 0 0; font-size: 12.5px; color: var(--muted); }
.tablewrap { overflow-x: auto; max-width: 100%; }
table.gate { width: 100%; }
table.gate td:first-child { white-space: nowrap; }
ul.legend-list { margin: 10px 0 0; padding-left: 18px; font-size: 13px; color: var(--muted); }
ul.legend-list li { margin: 2px 0; }
svg.chart.swatch { width: 26px; height: 10px; display: inline-block; vertical-align: middle; }
@media (max-width: 560px) {
  table.gate, table.gate tbody, table.gate tr, table.gate td { display: block; width: 100%; }
  table.gate thead { display: none; }
  table.gate tr { border-bottom: 1px solid var(--line-soft); padding: 8px 0; }
  table.gate td { border: 0; padding: 1px 0; }
  table.gate td:first-child { font-weight: 700; }
}
table.gate td, table.gate th { padding-right: 10px; }
.ok { color: var(--life); font-weight: 700; }
.bad { color: var(--error); font-weight: 700; }
.tag.plain { color: var(--soft); }
.mapgrid { display: grid; grid-template-columns: minmax(0, 330px) minmax(0, 1fr); gap: 16px; align-items: start; }
@media (max-width: 800px) { .mapgrid { grid-template-columns: minmax(0, 1fr); } }
.controls { background: var(--surface); border: 1px solid var(--line-soft); border-radius: var(--radius-lg); padding: 12px 14px; }
.ctl { margin: 0 0 12px; }
.ctl:last-child { margin-bottom: 0; }
.ctl .lab { display: flex; justify-content: space-between; gap: 8px; font-size: 13px; font-weight: 600; color: var(--muted); margin-bottom: 2px; }
.ctl output { font-family: var(--mono); color: var(--text); font-weight: 700; }
.ctl input[type=range] { width: 100%; margin: 2px 0; accent-color: var(--sun-ink); }
.ticks { display: none; grid-template-columns: repeat(9, minmax(0, 1fr)); font-size: 9.5px; color: var(--soft); font-family: var(--mono); padding: 0 6px; }
@media (min-width: 560px) { .ticks { display: grid; } }
.ticks span { text-align: center; white-space: nowrap; overflow: visible; }
.ticks span.on { color: var(--text); font-weight: 700; }
.ctlgroup { border-top: 1px solid var(--line-soft); padding-top: 10px; margin-top: 4px; }
.ctlgroup h3 { margin: 0 0 8px; font-size: 12px; letter-spacing: .06em; text-transform: uppercase; color: var(--soft); }
.seg { display: inline-flex; border: 1px solid var(--control-line); border-radius: var(--radius); overflow: hidden; flex-wrap: wrap; }
.seg button { font: inherit; font-size: 13px; padding: 6px 10px; border: 0; background: var(--surface); color: var(--text); cursor: pointer; }
.seg button + button { border-left: 1px solid var(--control-line); }
.seg button[aria-pressed=true] { background: var(--sun); color: oklch(23% 0.022 80); font-weight: 700; }
.seg button:hover { background: var(--hover); }
.seg button[aria-pressed=true]:hover { background: var(--sun); }
.mapfig { background: var(--surface); border: 1px solid var(--line-soft); border-radius: var(--radius-lg); padding: 12px; min-width: 0; }
svg.map { width: 100%; height: auto; display: block; font-family: var(--sans); }
svg.map text { fill: var(--text); }
svg.map .halo { paint-order: stroke; stroke: var(--halo); stroke-width: 3px; stroke-linejoin: round; }
svg.map .lab { fill: var(--muted); font-size: 12px; }
svg.map .axname { fill: var(--text); font-size: 13px; font-weight: 700; }
svg.map .cell { cursor: pointer; outline: none; }
svg.map .cell .sel { fill: none; stroke: none; }
svg.map .cell:focus-visible .sel, svg.map .cell.selected .sel { stroke: var(--text); stroke-width: 3; }
svg.map .empty { fill: none; stroke: var(--line); stroke-dasharray: 3 4; }
svg.map .m4 { font-size: 9.5px; font-weight: 700; fill: var(--soft); }
svg.map .glyph { font-size: 13px; font-weight: 800; }
svg.map .val { font-size: 13px; font-family: var(--mono); font-weight: 600; }
svg.map .t1 { font-size: 12px; font-weight: 800; }
.legend { display: flex; flex-wrap: wrap; gap: 10px 18px; margin: 10px 0 0; font-size: 12px; color: var(--muted); }
.legend .bar { height: 12px; border-radius: 6px; min-width: 200px; flex: 1 1 200px; border: 1px solid var(--line); background: linear-gradient(90deg, var(--cold) 0%, var(--neutral) 37.5%, var(--neutral) 62.5%, var(--hot) 100%); }
.legend .barlab { display: flex; justify-content: space-between; font-size: 11px; color: var(--soft); margin-top: 2px; gap: 6px; }
.legend .keys { display: flex; flex-wrap: wrap; gap: 4px 14px; }
.legend .keys span b { font-family: var(--mono); color: var(--text); }
.notice { margin: 10px 0 0; padding: 8px 10px; border-radius: var(--radius); background: var(--sun-soft); color: var(--text); font-size: 13px; }
.detail { margin: 14px 0 0; background: var(--surface); border: 1px solid var(--line-soft); border-radius: var(--radius-lg); padding: 12px 14px; }
.detail h3 { margin: 0 0 4px; font-size: 15px; overflow-wrap: anywhere; }
.detail dl { display: grid; grid-template-columns: max-content 1fr; gap: 3px 12px; margin: 8px 0; font-size: 13.5px; }
.detail dt { color: var(--soft); }
.detail dd { margin: 0; overflow-wrap: anywhere; }
.runs { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(300px, 100%), 1fr)); gap: 14px; }
.runs > * { min-width: 0; }
.runcard { padding: 14px 16px; }
.runcard .jobid { margin: 0 0 4px; color: var(--text); font-size: 12.5px; }
.runcard .note { font-size: 12.5px; color: var(--soft); margin: 0 0 8px; }
dl.nums { display: grid; grid-template-columns: max-content 1fr; gap: 2px 10px; margin: 0 0 8px; font-size: 13px; }
dl.nums dt { color: var(--soft); }
dl.nums dd { margin: 0; font-family: var(--mono); font-size: 12.5px; overflow-wrap: anywhere; }
svg.chart { width: 100%; height: auto; display: block; font-family: var(--sans); }
svg.chart text { fill: var(--muted); font-size: 11px; }
svg.chart .grid { stroke: var(--line-soft); }
svg.chart .axis { stroke: var(--line); }
svg.chart .ttl { fill: var(--text); font-size: 12px; font-weight: 700; }
svg.chart .halo { paint-order: stroke; stroke: var(--surface); stroke-width: 3px; stroke-linejoin: round; }
svg.chart .sline { fill: none; stroke: var(--text); stroke-width: 2; }
svg.chart .uline { fill: none; stroke: var(--sun-ink); stroke-width: 1.8; stroke-dasharray: 6 4; }
svg.chart .nline { fill: none; stroke: var(--hot); stroke-width: 1.8; stroke-dasharray: 2 3; }
svg.chart .band { fill: var(--sun-soft); fill-opacity: .7; stroke: var(--sun-ink); stroke-dasharray: 4 3; stroke-width: 1; }
svg.chart .ref { stroke: var(--text); stroke-width: 1.2; }
svg.chart .rline { stroke: var(--cold); stroke-dasharray: 3 3; stroke-width: 1.2; }
.proj { margin-top: 10px; }
.proj canvas { width: 100%; height: auto; aspect-ratio: 1 / 1; display: block; background: var(--field); border-radius: var(--radius); image-rendering: pixelated; }
.proj .row { display: flex; align-items: center; gap: 10px; margin-top: 6px; flex-wrap: wrap; font-size: 12px; color: var(--soft); }
.layerbar { height: 8px; width: 120px; border-radius: 4px; }
.proj .none { padding: 24px 12px; text-align: center; border: 1px dashed var(--line); border-radius: var(--radius); color: var(--soft); font-size: 13px; }
.curvebox { background: var(--surface); border: 1px solid var(--line-soft); border-radius: var(--radius-lg); padding: 12px; }
.curvebox select { font: inherit; font-size: 14px; padding: 6px 8px; border-radius: var(--radius); border: 1px solid var(--control-line); background: var(--surface); color: var(--text); max-width: 100%; }
.curvebar { display: flex; flex-wrap: wrap; gap: 10px 16px; align-items: center; margin-bottom: 8px; }
.curvebar label { font-size: 13px; color: var(--muted); font-weight: 600; display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.curvecap { font-size: 12.5px; color: var(--soft); margin: 8px 0 0; max-width: 80ch; }
.checkline { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; color: var(--muted); }
noscript p { padding: 10px; background: var(--sun-soft); border-radius: var(--radius); }
.vh { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
`;

export const PAGE_JS = String.raw`(function () {
  "use strict";
  var NS = "http://www.w3.org/2000/svg";
  var D = JSON.parse(document.getElementById("data").textContent);
  var R = D.results;
  var TAU = [30, 100, 300];

  function S(tag, attrs, text) {
    var e = document.createElementNS(NS, tag);
    if (attrs) for (var k in attrs) if (attrs[k] !== null && attrs[k] !== undefined) e.setAttribute(k, String(attrs[k]));
    if (text !== undefined && text !== null) e.textContent = String(text);
    return e;
  }
  function H(tag, attrs, kids) {
    var e = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      if (k === "text") e.textContent = attrs[k];
      else if (attrs[k] !== null && attrs[k] !== undefined) e.setAttribute(k, String(attrs[k]));
    }
    (kids || []).forEach(function (c) { if (c) e.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return e;
  }
  function $(id) { return document.getElementById(id); }
  function clear(e) { while (e.firstChild) e.removeChild(e.firstChild); return e; }
  function num(x, d) { return x === null || x === undefined || !isFinite(x) ? "n/a" : String(Number(x.toFixed(d === undefined ? 2 : d))); }

  // ---- theme (as in docs/3d-brainstorm-2026-10-22.html) ----
  (function () {
    var root = document.documentElement;
    var btn = $("theme");
    var prefersDark = matchMedia("(prefers-color-scheme: dark)");
    var apply = function (mode) {
      if (mode) root.setAttribute("data-theme", mode); else root.removeAttribute("data-theme");
      var dark = mode ? mode === "dark" : prefersDark.matches;
      btn.textContent = dark ? "Day" : "Night";
      btn.setAttribute("aria-pressed", String(dark));
    };
    var saved = null;
    try { saved = localStorage.getItem("bl-theme"); } catch (e) {}
    apply(saved === "dark" || saved === "light" ? saved : null);
    btn.addEventListener("click", function () {
      var dark = root.getAttribute("data-theme") ? root.getAttribute("data-theme") === "dark" : prefersDark.matches;
      var next = dark ? "light" : "dark";
      apply(next);
      try { localStorage.setItem("bl-theme", next); } catch (e) {}
    });
    prefersDark.addEventListener("change", function () { if (!root.getAttribute("data-theme")) apply(null); });
  })();

  // ---- colour scales: blue (damage dies) through a neutral plateau to orange (spreading) ----
  function mix(kind, t) { return "color-mix(in oklab, var(--" + kind + ") " + Math.round(t * 100) + "%, var(--neutral))"; }
  function colE(e) {
    if (e === null || e === undefined) return null;
    var a = Math.abs(e);
    if (a <= 0.5) return "var(--neutral)";
    return mix(e > 0 ? "hot" : "cold", Math.min(1, (a - 0.5) / 1.5));
  }
  function colL(v) {
    if (v === null || v === undefined) return null;
    var a = Math.abs(v), edge = Math.LN2;
    if (a <= edge) return "var(--neutral)";
    return mix(v > 0 ? "hot" : "cold", Math.min(1, (a - edge) / (2 - edge)));
  }

  // ---- the regime map ----
  var AX = R.axes;
  var AXN = AX.map(function (a) { return a.name; });
  var SET = R.settings.filter(function (s) { return !s.control; });
  var CTRL = R.settings.filter(function (s) { return s.control; })[0] || null;
  var M4 = D.m4 || {};
  var M4SHORT = { extinct: "ext", sparse: "spr", transient: "trn", carpet: "car" };
  var T1MARK = { "AGREES": "✓", "TRANSIENT": "~", "INCONCLUSIVE": "?", "PENDING": "...", "UNCHECKED-CAP": "-" };
  var st = { x: AXN.indexOf("mu"), y: AXN.indexOf("sigma"), held: {}, mode: "e", sel: null };
  AX.forEach(function (a) { st.held[a.name] = Math.max(0, a.values.indexOf(a.base)); });
  var withE = SET.filter(function (s) { return s.eMed !== null; });
  var allSat = D.allSaturated === true;
  if (allSat) st.mode = "lns";
  var OUTL = {
    ORDERED: { w: 2, d: null, c: "var(--text)" },
    CRITICAL: { w: 4, d: null, c: "var(--sun-ink)" },
    CHAOTIC: { w: 3, d: "7 4", c: "var(--text)" },
    SPLIT: { w: 2, d: "2 3", c: "var(--text)" },
    DUSTY: { w: 2, d: "8 3 2 3", c: "var(--text)" },
    INSUFFICIENT: { w: 1, d: null, c: "var(--soft)" },
    none: { w: 1, d: null, c: "var(--line)" }
  };
  function letter(s) {
    if (s.status === "UNMETERABLE") return "U";
    if (s.status === "CARPET") return "K";
    if (s.status === "RELIC") return "R";
    return { ORDERED: "O", CRITICAL: "C", CHAOTIC: "X", SPLIT: "S", DUSTY: "D", INSUFFICIENT: "I" }[s.cls] || "I";
  }
  function cellValue(s) { return st.mode === "e" ? s.eMed : s.lnS30Med; }
  function cellFill(s) { var v = cellValue(s); return v === null || v === undefined ? "var(--raised)" : (st.mode === "e" ? colE(v) : colL(v)); }

  function buildControls() {
    var box = clear($("axis-controls"));
    ["x", "y"].forEach(function (k) {
      var id = "ax-" + k;
      var out = H("output", { id: id + "-out", "for": id });
      var inp = H("input", { type: "range", id: id, min: 0, max: AX.length - 1, step: 1, value: st[k] });
      inp.addEventListener("input", function () { st[k] = Number(inp.value); sync(); });
      var ticks = H("div", { "class": "ticks", "aria-hidden": "true", id: id + "-ticks" }, AXN.map(function (n, i) { var sp = H("span", { text: n }); sp.style.gridColumn = String(i + 1); sp.style.gridRow = i % 2 ? "2" : "1"; return sp; }));
      box.appendChild(H("div", { "class": "ctl" }, [H("div", { "class": "lab" }, [H("label", { "for": id, text: k === "x" ? "Horizontal axis" : "Vertical axis" }), out]), inp, ticks]));
    });
    var held = H("div", { "class": "ctlgroup", id: "held" }, [H("h3", { text: "Held axes (they start at B0's values)" })]);
    AX.forEach(function (a) {
      var id = "h-" + a.name;
      var out = H("output", { id: id + "-out", "for": id });
      var inp = H("input", { type: "range", id: id, min: 0, max: a.values.length - 1, step: 1, value: st.held[a.name] });
      inp.addEventListener("input", function () { st.held[a.name] = Number(inp.value); sync(); });
      held.appendChild(H("div", { "class": "ctl", id: "hw-" + a.name }, [H("div", { "class": "lab" }, [H("label", { "for": id, text: a.name }), out]), inp]));
    });
    box.appendChild(held);
    var seg = H("div", { "class": "seg", role: "group", "aria-label": "Cell colour" });
    [["e", "Divergence exponent e"], ["lns", "Response ratio ln s(30)"]].forEach(function (m) {
      var b = H("button", { type: "button", "data-mode": m[0], text: m[1], "aria-pressed": String(st.mode === m[0]) });
      b.addEventListener("click", function () { st.mode = m[0]; sync(); });
      seg.appendChild(b);
    });
    box.appendChild(H("div", { "class": "ctlgroup" }, [H("h3", { text: "Colour" }), seg]));
  }

  function sync() {
    ["x", "y"].forEach(function (k) {
      $("ax-" + k + "-out").textContent = AXN[st[k]];
      $("ax-" + k).setAttribute("aria-valuetext", AXN[st[k]]);
      $("ax-" + k).value = st[k];
      var spans = $("ax-" + k + "-ticks").children;
      for (var i = 0; i < spans.length; i++) spans[i].className = i === st[k] ? "on" : "";
    });
    AX.forEach(function (a, i) {
      $("hw-" + a.name).hidden = i === st.x || i === st.y;
      var v = a.values[st.held[a.name]];
      $("h-" + a.name + "-out").textContent = v + (v === a.base ? " (B0)" : "");
    });
    var bs = document.querySelectorAll(".seg button[data-mode]");
    for (var j = 0; j < bs.length; j++) bs[j].setAttribute("aria-pressed", String(bs[j].getAttribute("data-mode") === st.mode));
    renderMap();
  }

  function findSetting(v) {
    for (var i = 0; i < SET.length; i++) {
      var s = SET[i], ok = true;
      for (var j = 0; j < AX.length; j++) if (s.params[AX[j].name] !== v[AX[j].name]) { ok = false; break; }
      if (ok) return s;
    }
    return null;
  }

  function defs() {
    var d = S("defs");
    function pat(id, build) { var p = S("pattern", { id: id, width: 8, height: 8, patternUnits: "userSpaceOnUse" }); build(p); d.appendChild(p); }
    pat("hatch-U", function (p) { p.setAttribute("patternTransform", "rotate(45)"); p.appendChild(S("line", { x1: 0, y1: 0, x2: 0, y2: 8, stroke: "var(--soft)", "stroke-width": 3, opacity: 0.55 })); });
    pat("hatch-K", function (p) { p.setAttribute("patternTransform", "rotate(-45)"); p.appendChild(S("line", { x1: 0, y1: 0, x2: 0, y2: 8, stroke: "var(--soft)", "stroke-width": 1.5, opacity: 0.6 })); });
    pat("hatch-R", function (p) { p.appendChild(S("circle", { cx: 4, cy: 4, r: 1.3, fill: "var(--soft)", opacity: 0.7 })); });
    return d;
  }

  function renderMap() {
    var xs = AX[st.x].values, ys = st.y === st.x ? [null] : AX[st.y].values.slice().reverse();
    var CW = 100, CH = 76, LM = 62, TM = 8, BM = 40;
    var W = LM + xs.length * CW + 6, Hh = TM + ys.length * CH + BM;
    var svg = S("svg", { "class": "map", viewBox: "0 0 " + W + " " + Hh, role: "group", "aria-label": "Regime map: " + AXN[st.x] + " across, " + (st.y === st.x ? "no second axis" : AXN[st.y] + " up") });
    svg.appendChild(defs());
    var inView = [];
    ys.forEach(function (yv, yi) {
      if (yv !== null) svg.appendChild(S("text", { x: LM - 10, y: TM + yi * CH + CH / 2 + 4, "text-anchor": "end", "class": "lab" }, yv));
      xs.forEach(function (xv, xi) {
        var vals = {};
        AX.forEach(function (a) { vals[a.name] = a.values[st.held[a.name]]; });
        vals[AXN[st.x]] = xv;
        if (yv !== null) vals[AXN[st.y]] = yv;
        var s = findSetting(vals);
        var X = LM + xi * CW, Y = TM + yi * CH, w = CW - 6, hh = CH - 6;
        if (yi === ys.length - 1) svg.appendChild(S("text", { x: X + w / 2, y: Y + CH + 12, "text-anchor": "middle", "class": "lab" }, xv));
        if (!s) {
          var e = S("g", { "aria-label": "not swept" });
          e.appendChild(S("rect", { "class": "empty", x: X, y: Y, width: w, height: hh, rx: 8 }));
          e.appendChild(S("text", { x: X + w / 2, y: Y + hh / 2 + 4, "text-anchor": "middle", "class": "lab" }, "not swept"));
          svg.appendChild(e);
          return;
        }
        inView.push(s);
        var m4 = M4[s.id];
        var desc = s.id + ": " + (s.cls || s.status) + ", e " + num(s.eMed) + ", ln s(30) " + num(s.lnS30Med) + (m4 ? ", M4 " + m4 : "");
        var g = S("g", { "class": "cell" + (st.sel === s.id ? " selected" : ""), tabindex: 0, role: "button", "aria-label": desc, "data-id": s.id });
        var box = S("rect", { x: X, y: Y, width: w, height: hh, rx: 8 });
        box.style.fill = cellFill(s);
        var o = OUTL[s.cls] || OUTL.none;
        box.setAttribute("stroke", o.c);
        box.setAttribute("stroke-width", o.w);
        if (o.d) box.setAttribute("stroke-dasharray", o.d);
        g.appendChild(box);
        if (s.status === "UNMETERABLE") g.appendChild(S("rect", { x: X, y: Y, width: w, height: hh, rx: 8, fill: "url(#hatch-U)" }));
        else if (s.status === "CARPET") g.appendChild(S("rect", { x: X, y: Y, width: w, height: hh, rx: 8, fill: "url(#hatch-K)" }));
        else if (s.status === "RELIC") g.appendChild(S("rect", { x: X, y: Y, width: w, height: hh, rx: 8, fill: "url(#hatch-R)" }));
        g.appendChild(S("text", { x: X + 9, y: Y + 19, "class": "glyph halo" }, letter(s)));
        var v = cellValue(s);
        g.appendChild(S("text", { x: X + w / 2, y: Y + hh / 2 + 6, "text-anchor": "middle", "class": "val halo" }, v === null || v === undefined ? "-" : num(v, 2)));
        if (m4) g.appendChild(S("text", { x: X + w - 7, y: Y + 16, "text-anchor": "end", "class": "m4 halo" }, M4SHORT[m4] || m4));
        if (s.t1) g.appendChild(S("text", { x: X + w - 8, y: Y + hh - 8, "text-anchor": "end", "class": "t1 halo" }, T1MARK[s.t1.status] || ""));
        if (s.inert) g.appendChild(S("text", { x: X + 9, y: Y + hh - 8, "class": "m4 halo" }, "inert"));
        g.appendChild(S("rect", { "class": "sel", x: X - 2, y: Y - 2, width: w + 4, height: hh + 4, rx: 10 }));
        g.appendChild(S("title", null, desc));
        g.addEventListener("click", function () { select(s.id); });
        g.addEventListener("keydown", function (ev) { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); select(s.id); } });
        svg.appendChild(g);
      });
    });
    svg.appendChild(S("text", { x: LM + (xs.length * CW) / 2, y: Hh - 6, "text-anchor": "middle", "class": "axname" }, AXN[st.x] + (st.y === st.x ? "" : "  (across)")));
    if (st.y !== st.x) svg.appendChild(S("text", { x: 4, y: TM + 12, "class": "axname" }, AXN[st.y]));
    clear($("map-svg")).appendChild(svg);
    // notices and legend
    var sliceE = inView.filter(function (s) { return s.eMed !== null; });
    var note = clear($("map-notice"));
    if (st.x === st.y) note.appendChild(H("p", { "class": "notice", text: "Both sliders select the same axis, so only one row is drawn. Pick two different axes for a grid." }));
    if (allSat && st.mode === "e") note.appendChild(H("p", { "class": "notice", text: "Every metered setting is saturated (e = +2), so this map is one colour. Switch to the response ratio ln s(30) for a map that varies." }));
    else if (allSat) note.appendChild(H("p", { "class": "notice", text: "Every metered setting is saturated (e = +2): the divergence exponent would paint one colour, so the map is coloured by the response ratio ln s(30), the log of damaged blocks per kicked block at step 30. The exponent view is one click away." }));
    else if (st.mode === "e" && sliceE.length > 1 && sliceE.every(function (s) { return s.eMed >= 1.999; })) note.appendChild(H("p", { "class": "notice", text: "Every cell in this slice is saturated (e = +2). The response ratio ln s(30) may separate them." }));
    buildLegend();
    buildTable(inView);
    $("map-count").textContent = "Showing " + inView.length + " of " + SET.length + " settings in this slice; the rest of the grid was not swept.";
    if (st.sel) { var cur = SET.concat(CTRL ? [CTRL] : []).filter(function (s) { return s.id === st.sel; })[0]; if (cur) fillDetail(cur); }
  }

  function buildLegend() {
    var lg = clear($("map-legend"));
    var isE = st.mode === "e";
    var bar = H("div", null, [H("div", { "class": "bar", role: "img", "aria-label": isE ? "colour scale from blue at e = -2 through a neutral plateau from -0.5 to +0.5 to orange at e = +2" : "colour scale from blue to orange, neutral between s = 0.5 and 2" }),
      H("div", { "class": "barlab" }, isE ? [H("span", { text: "-2 damage dies" }), H("span", { text: "-0.5 to +0.5 flat" }), H("span", { text: "+2 spreading" })] : [H("span", { text: "ln s = -2 (s 0.14)" }), H("span", { text: "ln 0.5 to ln 2" }), H("span", { text: "ln s = +2 (s 7.4)" })])]);
    bar.style.flex = "1 1 220px";
    lg.appendChild(bar);
    lg.appendChild(H("div", { "class": "keys" }, [
      H("span", null, [H("b", { text: "O C X" }), " class: ordered, critical, chaotic"]),
      H("span", null, [H("b", { text: "S D I" }), " split, dusty, insufficient"]),
      H("span", null, [H("b", { text: "U K R" }), " hatched: unmeterable, carpet, relic"]),
      H("span", null, [H("b", { text: "thick gold" }), " outline critical; ", H("b", { text: "dashed" }), " chaotic; ", H("b", { text: "dotted" }), " split"]),
      H("span", null, [H("b", { text: "ext spr trn car" }), " M4's label at 50,000 steps"]),
      H("span", null, [H("b", { text: "✓ ~ ? ... -" }), " late check: agrees, transient, inconclusive, pending, unchecked"])
    ]));
  }

  function buildTable(list) {
    var box = clear($("map-table"));
    var rows = list.map(function (s) {
      return H("tr", null, [H("td", { "class": "mono", text: s.id }), H("td", { text: s.cls || s.status }), H("td", { "class": "num", text: num(s.eMed) }), H("td", { "class": "num", text: num(s.lnS30Med) }), H("td", { text: s.t1 ? s.t1.status : "" })]);
    });
    var t = H("table", null, [H("thead", null, [H("tr", null, ["setting", "class", "e", "ln s(30)", "late check"].map(function (h) { return H("th", { text: h }); }))]), H("tbody", null, rows)]);
    box.appendChild(H("div", { "class": "tablewrap" }, [t]));
  }

  function select(id) {
    st.sel = id;
    var cur = SET.concat(CTRL ? [CTRL] : []).filter(function (s) { return s.id === id; })[0];
    if (cur) { fillDetail(cur); var sel = $("curve-setting"); if (sel && sel.querySelector('option[value="' + id + '"]')) { sel.value = id; drawCurve(); } }
    var cells = document.querySelectorAll("svg.map .cell");
    for (var i = 0; i < cells.length; i++) cells[i].setAttribute("class", "cell" + (cells[i].getAttribute("data-id") === id ? " selected" : ""));
  }

  function fillDetail(s) {
    var box = clear($("map-detail"));
    box.hidden = false;
    var pdl = H("dl", null, []);
    AXN.forEach(function (n) { pdl.appendChild(H("dt", { text: n })); pdl.appendChild(H("dd", { text: s.params[n] + (s.params[n] === AX[AXN.indexOf(n)].base ? "" : "  (B0: " + AX[AXN.indexOf(n)].base + ")") })); });
    var facts = H("dl", null, []);
    [["status", s.status], ["class", s.cls || "none"], ["would-be class", s.cls === "DUSTY" ? s.wouldBe : ""], ["votes O / C / X", s.votes.ORDERED + " / " + s.votes.CRITICAL + " / " + s.votes.CHAOTIC], ["voting / valid jobs", s.voting + " / " + s.valid],
      ["e (median of " + s.eN + ")", num(s.eMed, 3)], ["ln s(30) (median)", num(s.lnS30Med, 3)], ["ell, d to target", num(s.ell, 3) + ", " + num(s.d, 3)], ["target class", s.target ? "yes" : "no"],
      ["late check", s.t1 ? s.t1.status + (s.t1.cls ? " (" + s.t1.cls + " at T1)" : "") : "not run"], ["M4 at 50,000", M4[s.id] || "no M4 data"], ["brackets", s.brackets.join(", ")], ["INERT gateK", s.inert ? "yes" : ""]].forEach(function (p) {
      if (p[1] === "" || p[1] === undefined) return;
      facts.appendChild(H("dt", { text: p[0] })); facts.appendChild(H("dd", { text: p[1] }));
    });
    var jt = H("table", null, [H("thead", null, [H("tr", null, ["seed", "status", "class", "T / D", "e", "s(30)", "U/S", "dust", "vote"].map(function (h) { return H("th", { text: h }); }))]),
      H("tbody", null, s.jobs.map(function (j) { return H("tr", null, [H("td", { text: j.seed }), H("td", { text: j.status + (j.flags ? " " + j.flags : "") }), H("td", { text: j.jobClass || "-" }), H("td", { text: j.tClass + " / " + (j.dClass || "-") }), H("td", { "class": "num", text: num(j.e) }), H("td", { "class": "num", text: num(j.s30) }), H("td", { "class": "num", text: num(j.ratioU) }), H("td", { text: j.dust }), H("td", { text: j.vote ? "yes" : "no" })]); }))]);
    box.appendChild(H("h3", { text: s.id + (s.control ? " (control: mutRate 0)" : "") }));
    box.appendChild(H("div", { "class": "grid2" }, [H("div", null, [H("p", { "class": "muted", text: "Setting" }), pdl]), H("div", null, [H("p", { "class": "muted", text: "Reading" }), facts])]));
    box.appendChild(H("div", { "class": "tablewrap" }, [jt]));
  }

  // ---- charts ----
  function lg(lo, hi, a, b) { var l0 = Math.log(lo), l1 = Math.log(hi); return function (v) { return a + ((Math.log(v) - l0) / (l1 - l0)) * (b - a); }; }
  function lin(lo, hi, a, b) { return function (v) { return a + ((v - lo) / (hi - lo)) * (b - a); }; }
  function decades(lo, hi) { var out = [], p = Math.floor(Math.log10(lo)); for (var k = p; k <= Math.ceil(Math.log10(hi)); k++) { var v = Math.pow(10, k); if (v >= lo * 0.999 && v <= hi * 1.001) out.push(v); } return out; }
  function tickText(v) { return v >= 1 ? String(v) : String(Number(v.toPrecision(2))); }

  function axesFrame(svg, o) {
    var plot = o.plot;
    (o.xticks || []).forEach(function (t) { svg.appendChild(S("line", { x1: o.x(t), x2: o.x(t), y1: plot.t, y2: plot.b, "class": "grid" })); svg.appendChild(S("text", { x: o.x(t), y: plot.b + 14, "text-anchor": "middle" }, tickText(t))); });
    (o.yticks || []).forEach(function (t) { svg.appendChild(S("line", { x1: plot.l, x2: plot.r, y1: o.y(t), y2: o.y(t), "class": "grid" })); svg.appendChild(S("text", { x: plot.l - 6, y: o.y(t) + 4, "text-anchor": "end" }, tickText(t))); });
    svg.appendChild(S("line", { x1: plot.l, x2: plot.r, y1: plot.b, y2: plot.b, "class": "axis" }));
    svg.appendChild(S("line", { x1: plot.l, x2: plot.l, y1: plot.t, y2: plot.b, "class": "axis" }));
  }
  function poly(ts, vs, x, y, floor) {
    var pts = [];
    for (var i = 0; i < ts.length; i++) { var v = vs[i]; if (v === null || v === undefined) continue; pts.push(x(ts[i]).toFixed(1) + "," + y(Math.max(v, floor)).toFixed(1)); }
    return pts.join(" ");
  }

  function drawNt(box, c) {
    var s = c.series, W = 340, Hh = 250, plot = { l: 44, r: 12, t: 52, b: Hh - 30 };
    var svg = S("svg", { "class": "chart", viewBox: "0 0 " + W + " " + Hh, role: "img", "aria-label": "Damaged blocks per site over 1000 steps, log scale, for the S twin, the unit-kick twin U and the noise-swapped twin N" });
    var vals = [];
    s.S.concat(s.U, s.N).forEach(function (v) { if (v !== null && v > 0) vals.push(v); });
    var anchor = s.anchorN && s.anchorN > 0 ? s.anchorN : null;
    var ymin = 0.01, ymax = Math.max.apply(null, vals.concat([2, anchor ? anchor * 3.4 : 0, s.satN || 0])) * 1.5;
    var xr = W - plot.r;
    var x = lg(1, 1000, plot.l, xr), y = lg(ymin, ymax, plot.b, plot.t);
    var frame = { plot: { l: plot.l, r: xr, t: plot.t, b: plot.b }, x: x, y: y, xticks: [1, 10, 100, 1000], yticks: decades(ymin, ymax) };
    axesFrame(svg, frame);
    svg.appendChild(S("text", { x: plot.l, y: 14, "class": "ttl" }, "Damaged blocks per site, N(t)"));
    if (anchor) {
      var up = anchor * Math.pow(10, 0.5), dn = anchor * Math.pow(10, -0.5);
      svg.appendChild(S("polygon", { "class": "band", points: x(100) + "," + y(anchor) + " " + x(1000) + "," + y(up) + " " + x(1000) + "," + y(dn) }));
    }
    if (s.ordN > ymin && s.ordN < ymax) { svg.appendChild(S("line", { x1: plot.l, x2: xr, y1: y(s.ordN), y2: y(s.ordN), "class": "rline" })); svg.appendChild(S("text", { x: plot.l + 4, y: y(s.ordN) - 3, "class": "halo" }, "r = 0.1 (ORDERED below)")); }
    if (s.satN && s.satN > ymin && s.satN < ymax) { svg.appendChild(S("line", { x1: plot.l, x2: xr, y1: y(s.satN), y2: y(s.satN), "class": "rline" })); svg.appendChild(S("text", { x: plot.l + 4, y: y(s.satN) - 3, "class": "halo" }, "5% of living blocks")); }
    svg.appendChild(S("line", { x1: plot.l, x2: xr, y1: plot.b - 1, y2: plot.b - 1, stroke: "var(--soft)", "stroke-width": 1, opacity: 0.6 }));
    svg.appendChild(S("polyline", { "class": "nline", points: poly(s.t, s.N, x, y, ymin) }));
    svg.appendChild(S("polyline", { "class": "uline", points: poly(s.t, s.U, x, y, ymin) }));
    svg.appendChild(S("polyline", { "class": "sline", points: poly(s.t, s.S, x, y, ymin) }));
    [["sline", "S", 4, 24], ["uline", "U (small kick)", 44, 24], ["nline", "N (other noise)", 150, 24]].forEach(function (k) {
      svg.appendChild(S("line", { x1: plot.l + k[2], x2: plot.l + k[2] + 18, y1: k[3], y2: k[3], "class": k[0] }));
      svg.appendChild(S("text", { x: plot.l + k[2] + 22, y: k[3] + 4 }, k[1]));
    });
    svg.appendChild(S("text", { x: plot.l + 4, y: 42 }, "Z (no kick): exactly 0"));
    svg.appendChild(S("text", { x: (plot.l + xr) / 2, y: Hh - 4, "text-anchor": "middle" }, "steps after the kick (log); band: slope ±0.5 from step 100"));
    box.appendChild(svg);
  }

  function drawSurv(box, c) {
    var s = c.series, W = 340, Hh = 180, plot = { l: 44, r: 12, t: 24, b: Hh - 30 }, xr = W - plot.r;
    var svg = S("svg", { "class": "chart", viewBox: "0 0 " + W + " " + Hh, role: "img", "aria-label": "Share of kicked sites whose damage is still present, over 1000 steps, log axes" });
    var floor = 1 / (2 * Math.max(c.mS || 12, 1));
    var x = lg(1, 1000, plot.l, xr), y = lg(floor, 1, plot.b, plot.t);
    var yt = [0.1, 1].filter(function (v) { return v >= floor; });
    axesFrame(svg, { plot: { l: plot.l, r: xr, t: plot.t, b: plot.b }, x: x, y: y, xticks: [1, 10, 100, 1000], yticks: yt });
    svg.appendChild(S("text", { x: plot.l, y: 14, "class": "ttl" }, "Survival: share of sites with damage"));
    svg.appendChild(S("polyline", { "class": "sline", points: poly(s.t, s.surv, x, y, floor) }));
    svg.appendChild(S("text", { x: plot.l - 6, y: plot.b + 3, "text-anchor": "end" }, "0"));
    svg.appendChild(S("text", { x: (plot.l + xr) / 2, y: Hh - 4, "text-anchor": "middle" }, "steps after the kick (log); zero is drawn on the floor"));
    box.appendChild(svg);
  }

  function layerColour(z) { return "hsl(" + Math.round(35 + z * 28) + ",78%," + Math.round(64 - z * 3) + "%)"; }
  function b64bytes(b64) { var bin = atob(b64), out = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }

  function drawProj(box, c) {
    var cap = c.id && D.captures ? D.captures[c.id] : null;
    if (!cap) { box.appendChild(H("div", { "class": "none", text: c.id ? "Damaged-voxel capture not run for this job (--capture)." : "No job." })); return; }
    var steps = Object.keys(cap.steps).sort(function (a, b) { return a - b; });
    var canvas = H("canvas", { width: cap.W, height: cap.H, role: "img", "aria-label": "Horizontal projection of the damaged voxels, coloured by layer" });
    var seg = H("div", { "class": "seg", role: "group", "aria-label": "Step shown" });
    var count = H("span", { text: "" });
    function show(t) {
      var ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, cap.W, cap.H);
      var bytes = b64bytes(cap.steps[t]);
      for (var i = 0; i + 2 < bytes.length; i += 3) { ctx.fillStyle = layerColour(bytes[i + 2]); ctx.fillRect(bytes[i], bytes[i + 1], 2, 2); }
      count.textContent = (bytes.length / 3) + " damaged voxels shown at step " + t;
      var bs = seg.children;
      for (var j = 0; j < bs.length; j++) bs[j].setAttribute("aria-pressed", String(bs[j].getAttribute("data-t") === String(t)));
    }
    steps.forEach(function (t) { var b = H("button", { type: "button", "data-t": t, text: "step " + t, "aria-pressed": "false" }); b.addEventListener("click", function () { show(t); }); seg.appendChild(b); });
    var bar = H("div", { "class": "layerbar" });
    bar.style.background = "linear-gradient(90deg, " + [0, 1, 2, 3, 4, 5, 6, 7].map(layerColour).join(",") + ")";
    box.appendChild(H("p", { "class": "muted", text: "Damaged voxels seen from above" }));
    box.appendChild(seg); box.appendChild(canvas);
    box.appendChild(H("div", { "class": "row" }, [H("span", { text: "top layer" }), bar, H("span", { text: "bottom" }), count]));
    show(steps[Math.min(1, steps.length - 1)]);
  }

  function drawCards() {
    R.cards.forEach(function (c, i) {
      var shell = document.querySelector('[data-card="' + i + '"]');
      if (!shell) return;
      var ch = shell.querySelector("[data-charts]"), pr = shell.querySelector("[data-proj]");
      clear(ch); clear(pr);
      if (c.series) { drawNt(ch, c); drawSurv(ch, c); } else ch.appendChild(H("div", { "class": "none", text: "No series." }));
      drawProj(pr, c);
    });
  }

  // ---- the response curve ----
  var curveSt = { tau: 0, gate: false };
  var SEEDCLS = ["sline", "uline", "nline"];
  function curveOptions() {
    var sel = clear($("curve-setting"));
    R.settings.forEach(function (s) {
      var has = s.jobs.some(function (j) { return R.curves[j.id]; });
      if (has) sel.appendChild(H("option", { value: s.id, text: s.id + (s.cls ? "  [" + s.cls + "]" : "  [" + s.status + "]") }));
    });
    var b0 = sel.querySelector('option[value="mu30-s8-k256"]');
    if (b0) sel.value = "mu30-s8-k256";
    sel.addEventListener("change", function () { drawCurve(); });
    var seg = clear($("curve-tau"));
    TAU.forEach(function (t, i) {
      var b = H("button", { type: "button", text: "tau = " + t, "aria-pressed": String(i === curveSt.tau) });
      b.addEventListener("click", function () { curveSt.tau = i; var bs = seg.children; for (var j = 0; j < bs.length; j++) bs[j].setAttribute("aria-pressed", String(j === i)); drawCurve(); });
      seg.appendChild(b);
    });
    $("curve-gate").addEventListener("change", function (ev) { curveSt.gate = ev.target.checked; drawCurve(); });
  }
  function drawCurve() {
    var box = clear($("curve-svg")), leg = clear($("curve-legend"));
    var id = $("curve-setting").value;
    var s = R.settings.filter(function (q) { return q.id === id; })[0];
    if (!s) return;
    var series = [];
    s.jobs.forEach(function (j, i) { var c = R.curves[j.id]; if (c) series.push({ label: "seed " + j.seed, cls: SEEDCLS[i % 3], c: c, pooled: c.pooled[curveSt.tau], job: j }); });
    var overlay = [];
    if (curveSt.gate && R.gate.curves) {
      var seen = {};
      R.gate.curves.forEach(function (g) { var k = g.world; if (seen[k]) return; seen[k] = true; overlay.push({ label: g.world + " (gate, seed " + g.seed + ")", c: g.curve }); });
    }
    var xsAll = [], ysAll = [];
    series.concat(overlay).forEach(function (q) { q.c.x.forEach(function (v, k) { if (v > 0) xsAll.push(v); var yv = q.c.s[curveSt.tau][k]; if (yv !== null && yv > 0) ysAll.push(yv); }); });
    if (!xsAll.length) { box.appendChild(H("div", { "class": "none", text: "No dose curve for this setting (no twin bank)." })); return; }
    var xmin = Math.min.apply(null, xsAll) / 1.6, xmax = Math.max.apply(null, xsAll) * 1.6;
    var ymin = Math.min.apply(null, ysAll.concat([0.4])) / 1.6, ymax = Math.max.apply(null, ysAll.concat([2.5])) * 1.6;
    var avail = $("curve-svg").clientWidth || 640;
    var W = Math.round(Math.max(300, Math.min(640, avail))), Hh = Math.round(Math.max(240, W * 0.56)), plot = { l: 54, r: 16, t: 20, b: Hh - 46 };
    var svg = S("svg", { "class": "chart", viewBox: "0 0 " + W + " " + Hh, role: "img", "aria-label": "Response ratio against kicked-block fraction, log axes, tau " + TAU[curveSt.tau] });
    var x = lg(xmin, xmax, plot.l, W - plot.r), y = lg(ymin, ymax, plot.b, plot.t);
    var yt = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50].filter(function (v) { return v >= ymin && v <= ymax; });
    var xt = [0.0001, 0.0003, 0.001, 0.003, 0.01, 0.03, 0.1, 0.3].filter(function (v) { return v >= xmin && v <= xmax; });
    axesFrame(svg, { plot: { l: plot.l, r: W - plot.r, t: plot.t, b: plot.b }, x: x, y: y, xticks: xt, yticks: yt });
    svg.appendChild(S("rect", { "class": "band", x: plot.l, y: y(2), width: W - plot.r - plot.l, height: y(0.5) - y(2) }));
    svg.appendChild(S("line", { "class": "ref", x1: plot.l, x2: W - plot.r, y1: y(1), y2: y(1) }));
    svg.appendChild(S("text", { x: W - plot.r - 4, y: y(1) - 4, "text-anchor": "end" }, "s = 1"));
    svg.appendChild(S("text", { x: W - plot.r - 4, y: y(2) - 4, "text-anchor": "end" }, "band 0.5 to 2"));
    overlay.forEach(function (q, i) {
      var pts = q.c.x.map(function (xv, k) { return q.c.s[curveSt.tau][k] === null ? null : x(xv).toFixed(1) + "," + y(Math.max(q.c.s[curveSt.tau][k], ymin)).toFixed(1); }).filter(Boolean).join(" ");
      var pl = S("polyline", { points: pts, fill: "none", stroke: ["var(--hot)", "var(--cold)", "var(--soft)"][i % 3], "stroke-width": 1.6, "stroke-dasharray": "5 3", opacity: 0.9 });
      svg.appendChild(pl);
    });
    series.forEach(function (q) {
      var pts = q.c.x.map(function (xv, k) { return q.c.s[curveSt.tau][k] === null ? null : [xv, q.c.s[curveSt.tau][k]]; }).filter(Boolean);
      svg.appendChild(S("polyline", { "class": q.cls, points: pts.map(function (p) { return x(p[0]).toFixed(1) + "," + y(Math.max(p[1], ymin)).toFixed(1); }).join(" ") }));
      pts.forEach(function (p) { svg.appendChild(S("circle", { cx: x(p[0]), cy: y(Math.max(p[1], ymin)), r: 3, fill: "var(--surface)", stroke: "var(--text)", "stroke-width": 1.4 })); });
    });
    svg.appendChild(S("text", { x: (plot.l + W - plot.r) / 2, y: Hh - 6, "text-anchor": "middle" }, "kicked-block fraction n0(m) / liveblk_R (log)"));
    svg.appendChild(S("text", { x: 14, y: (plot.t + plot.b) / 2, "text-anchor": "middle", transform: "rotate(-90 14 " + (plot.t + plot.b) / 2 + ")" }, (W < 480 ? "s_m(tau)" : "damaged blocks per kicked block, s_m(tau)")));
    box.appendChild(svg);
    series.forEach(function (q) {
      var li = H("li", null, []);
      var sw = S("svg", { width: 26, height: 10, viewBox: "0 0 26 10", "aria-hidden": "true", "class": "chart swatch" });
      sw.appendChild(S("line", { x1: 0, x2: 26, y1: 5, y2: 5, "class": q.cls }));
      li.appendChild(sw);
      li.appendChild(document.createTextNode(" " + q.label + ": pooled s(" + TAU[curveSt.tau] + ") = " + num(q.pooled, 2) + "; class " + (q.job.jobClass || "none") + "; " + q.c.m.length + " doses (m = " + q.c.m.join(", ") + ")"));
      leg.appendChild(li);
    });
    overlay.forEach(function (q) { leg.appendChild(H("li", { text: "dashed: " + q.label + ", pooled s(" + TAU[curveSt.tau] + ") = " + num(q.c.pooled[curveSt.tau], 2) })); });
  }

  buildControls();
  sync();
  drawCards();
  curveOptions();
  drawCurve();
  var resizeTimer = null, lastW = window.innerWidth;
  window.addEventListener("resize", function () {
    if (window.innerWidth === lastW) return;
    lastW = window.innerWidth;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(drawCurve, 120);
  });
})();
`;

// =====================================================================================================================
// The page

export interface PageInput {
  results: ResultsJson;
  label: PageLabel;
  /** Captures by job id (the damaged voxels at steps 10, 100, 1000); a card without one says so. */
  captures: Record<string, Capture>;
  /** M4's label per (mu, sigma, lightK) at 50,000 steps, for groups A and B only. */
  m4Labels: Record<string, M4Label>;
}

/** Every metered setting of the sweep is saturated (e = +2): the map would be one colour, so the page colours it by ln s(30) and says why (plan 8.6 item 1). */
export function allSaturated(r: ResultsJson): boolean {
  const withE = r.settings.filter((s) => !s.control && s.eMed !== null);
  return withE.length > 0 && withE.every((s) => (s.eMed as number) >= 1.999);
}

export function m4LabelsFor(results: ResultsJson, m4: Map<string, M4Run>): Record<string, M4Label> {
  const out: Record<string, M4Label> = {};
  for (const s of results.settings) {
    if (s.group !== "A" && s.group !== "B") continue;
    const l = m4Label(m4, s.params.mu, s.params.sigma, s.params.lightK);
    if (l) out[s.id] = l;
  }
  return out;
}

const DESCRIPTION = "Companion page to the regime meters plan: the map of what the pre-stated rule read for each swept setting, three example runs, the response curve, the gate and the outcome.";

export function buildPage(p: PageInput): string {
  const r = p.results;
  const synthetic = p.label === "synthetic";
  const title = `Regime meters map${synthetic ? " (synthetic)" : p.label === "draft" ? " (draft)" : ""}`;
  const swept = r.gate.pass && r.settings.length > 0 && r.outcome.id !== "GATE-FAIL";
  const data = {
    label: p.label,
    allSaturated: allSaturated(r),
    results: r,
    m4: p.m4Labels,
    captures: Object.fromEntries(Object.entries(p.captures).map(([k, v]) => [k, packCapture(v)])),
  };
  const cardsHtml = r.cards.map((c, i) => cardShell(i, c)).join("\n");
  const sections = swept
    ? `<section id="map" aria-labelledby="map-h"><h2 id="map-h"><span class="idx">3</span>The regime map</h2>
<p class="sub">One cell is one setting, read at T0 (20,000 steps). Colour is the divergence exponent <i>e</i> of the damage count (blue: the damage dies, neutral: flat, orange: it spreads). The outline is the class the rule gave the setting, hatching marks settings that were extinct, carpets or relics, and M4's label of the same setting at 50,000 steps sits in the corner where M4 has data. Two sliders choose the axes; the other seven stay at the values you set, starting at B0. Most cells of a grid are empty: the sweep varies one constant at a time from B0.</p>
<div class="mapgrid"><div class="controls" id="axis-controls"><noscript><p>The map needs JavaScript.</p></noscript></div>
<div class="mapfig"><div id="map-svg"></div><div id="map-notice"></div><div id="map-legend" class="legend"></div><p class="curvecap" id="map-count"></p><details><summary>Settings in view as a table</summary><div id="map-table"></div></details></div></div>
<div class="detail" id="map-detail" hidden></div></section>
<section id="runs" aria-labelledby="runs-h"><h2 id="runs-h"><span class="idx">4</span>Three example runs</h2>
<p class="sub">The pool job with the lowest <i>e</i> among the ORDERED ones, the CRITICAL one with <i>e</i> nearest 0, and the CHAOTIC one with the highest <i>e</i>. A card that had no job of its class says so and shows the nearest job, labelled. Each shows the damaged blocks per site over 1,000 steps with the controls beside it (Z, the no-kick twin, is exactly zero; U is a much smaller kick; N is the same state under another noise seed), the share of sites whose damage survives, and where the damage is.</p>
<div class="runs">${cardsHtml}</div></section>
<section id="curve" aria-labelledby="curve-h"><h2 id="curve-h"><span class="idx">5</span>The response curve</h2>
<p class="sub">How many blocks are damaged per kicked block, <i>s<sub>m</sub></i>(tau), against the fraction of the world that was kicked, for the dose twins of one setting (m = 4 to 64 kicks, each run only if it kicked a tenth of the living blocks or fewer). The line s = 1 and the band 0.5 to 2 are the rule's window; the class at tau = 30 is decided by the pooled ratio.</p>
<div class="curvebox"><div class="curvebar"><label>Setting <select id="curve-setting"></select></label><div class="seg" id="curve-tau" role="group" aria-label="Step tau"></div><label class="checkline"><input type="checkbox" id="curve-gate"> overlay the gate worlds</label></div>
<div id="curve-svg"></div><ul class="legend-list" id="curve-legend"></ul>
<p class="curvecap">Finite-amplitude, same-noise, block-scale responses: a kick of ${esc(r.cards.find((c) => c.k !== null)?.k ?? "k")} units, blocks of 8 x 8 x 8 voxels. This is a reading of the rule's meters, not an estimate of a slope at the origin.</p></div></section>`
    : `<section id="nosweep"><h2><span class="idx">3</span>No sweep was read</h2><p class="sub">${r.outcome.id === "GATE-FAIL" ? "The held-out gate failed, so by the rule no sweep is read (R9.4)." : "There is nothing to map."}</p></section>`;
  const footerText = synthetic
    ? "synthetic: not a result. Generated by experiments/3d-slab/regime-html.ts --synthetic through the reader of experiments/3d-slab/regime-readout.ts."
    : `Built from regime-results.json by experiments/3d-slab/regime-html.ts. Rule ${r.rule.status} ${r.rule.sha256}. Stamps: ruleSha ${r.stamps.ruleSha.join(", ") || "none"}; codeCommit ${r.stamps.codeCommit.join(", ") || "none"}.`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(DESCRIPTION)}">
<link rel="icon" href="data:,">
<style>
${TOKENS_AND_BASE_CSS}
</style>
</head>
<body>
<div class="wrap">
<header class="top">
  <div>
    <p class="eyebrow">Candidate 8 · the slab's dynamics${synthetic ? " · synthetic: not a result" : ""}</p>
    <h1>Regime meters map</h1>
    <p class="lede"><strong>Is the slab ordered, critical or chaotic?</strong> A pre-stated rule reads how a small kick spreads, setting by setting. This page shows what the rule concluded and nothing else. Companion to <a href="3d-regime-meters-plan-2026-10-23.md">3d-regime-meters-plan-2026-10-23.md</a>.</p>
    ${chipsHtml(p.label, r)}
  </div>
  <button class="theme" type="button" id="theme" aria-pressed="false">Night</button>
</header>
${bannerHtml(p.label, r)}
${outcomeHtml(r, p.label)}
${gateHtml(r)}
${sections}
<footer>${esc(footerText)}</footer>
</div>
<noscript><p>The map, the example-run charts and the response curve need JavaScript; the verdict and the gate above do not.</p></noscript>
<script type="application/json" id="data">${jsonForScript(data)}</script>
<script>
${PAGE_JS}
</script>
</body>
</html>
`;
}

// =====================================================================================================================
// CLI

const HTML_USAGE = `usage: regime-html.ts (--results=FILE [--captures=DIR] | --synthetic [--keep=DIR] [--quick]) [--out=FILE] [--root=DIR] [--m4=FILE]
  --quick  with --synthetic: skip the sensitivity table (the page does not show it) and use 20 bootstrap resamples instead of 1,000`;

export function readCaptures(dir: string, ids: readonly (string | null)[]): Record<string, Capture> {
  const out: Record<string, Capture> = {};
  for (const id of ids) {
    if (!id) continue;
    const f = join(dir, `${id}.json`);
    if (existsSync(f)) out[id] = JSON.parse(readFileSync(f, "utf8")) as Capture;
  }
  return out;
}

export function htmlMain(argv: readonly string[], log: (s: string) => void = console.log): number {
  try {
    const kv: Record<string, string> = {};
    const flags = new Set<string>();
    for (const a of argv) {
      const m = /^--([a-z0-9-]+)(?:=(.*))?$/.exec(a);
      if (!m) throw new ReaderError(`unknown argument ${a}\n${HTML_USAGE}`);
      if (m[2] === undefined) flags.add(m[1]); else kv[m[1]] = m[2];
    }
    for (const k of [...flags, ...Object.keys(kv)]) if (!["results", "captures", "synthetic", "keep", "out", "root", "m4", "quick"].includes(k)) throw new ReaderError(`unknown option --${k}\n${HTML_USAGE}`);
    if (flags.has("synthetic") === (kv.results !== undefined)) throw new ReaderError(`give exactly one of --results=FILE and --synthetic\n${HTML_USAGE}`);
    const root = resolve(kv.root ?? resolve(dirname(fileURLToPath(import.meta.url)), "..", ".."));
    const m4 = readM4Tsv(resolve(root, kv.m4 ?? "experiments/3d-slab/m4-results.tsv"));
    let results: ResultsJson;
    let captures: Record<string, Capture>;
    if (flags.has("synthetic")) {
      const b = syntheticResults({ m4Path: resolve(root, kv.m4 ?? "experiments/3d-slab/m4-results.tsv"), sensitivity: !flags.has("quick"), boot: flags.has("quick") ? 20 : undefined });
      results = b.results;
      captures = b.captures;
      if (kv.keep !== undefined) {
        const keep = resolve(root, kv.keep);
        mkdirSync(join(keep, "jobs"), { recursive: true });
        mkdirSync(join(keep, "captures"), { recursive: true });
        for (const j of [...b.jobs.t0, ...b.jobs.t1, ...b.jobs.gate]) writeFileSync(join(keep, "jobs", `${j.id}.json`), JSON.stringify(j));
        for (const [id, c] of Object.entries(b.captures)) writeFileSync(join(keep, "captures", `${id}.json`), JSON.stringify(c));
        writeFileSync(join(keep, "regime-results.SYNTHETIC.json"), JSON.stringify(b.results, round6));
        writeFileSync(join(keep, "gate.SYNTHETIC.json"), JSON.stringify(b.gate, null, 1));
        log(`kept the synthetic jobs, captures, gate and results under ${keep}`);
      }
    } else {
      const rp = resolve(root, kv.results);
      if (!existsSync(rp)) throw new ReaderError(`${rp} does not exist`);
      results = JSON.parse(readFileSync(rp, "utf8")) as ResultsJson;
      captures = readCaptures(resolve(root, kv.captures ?? join(dirname(rp), "captures")), results.cards.map((c) => c.id));
    }
    const label = pageLabel(results, frozenRuleHash(root));
    const html = buildPage({ results, label, captures, m4Labels: m4LabelsFor(results, m4) });
    const out = resolve(root, kv.out ?? "docs/3d-regime-meters-map.html");
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, html);
    log(`wrote ${out} (${html.length} bytes), labelled ${label}`);
    return 0;
  } catch (e) {
    if (e instanceof ReaderError) { console.error(e.message); return e.exit; }
    throw e;
  }
}

if ((import.meta as { main?: boolean }).main === true) process.exit(htmlMain(process.argv.slice(2)));
