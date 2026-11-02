// Job schedule, summaries from raw run records, gates, fixtures, seal. Node-only (node:crypto); no simulator import,
// so the same summaries can be recomputed from a saved file without simulating. Deterministic payload: no clock or platform.
import { createHash } from "node:crypto";
import {
  EDGE_MIN_BLOCKS, EDGE_MIN_OFFSET, blockPayoff, breadth, classify, decideVerdict, findCycles, shareA, summarizeInvasion, summarizePair,
  vigourExpected, signFlipP, COMPLETE_FRACTION, FAMILY, FLOOR_DIV, atFloor, type BlockPayoff, type Gates, type InvasionSummary, type Obs, type PairSummary, type Verdict,
} from "./payoff.ts";
import { mean } from "../stats.ts";

export const sha256 = (v: string | Uint8Array): string => createHash("sha256").update(v).digest("hex");
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export const STATEMENTS = [
  "CPU only",
  "no GPU evidence",
  "not the M3 environment: small sim-ref worlds, one fixed chemistry, mutation off",
  "payoff is the share of biomass at a step, not reproduction or fitness",
  "no historical-archive tournament has been run",
  "no score here selected anything",
] as const;
export const SALT_NOTE = "all numbers regenerate from the raw run records; summaries are recomputed by --check";

export type Dict<T> = Record<string, T>;
export const GENOTYPES = ["G", "F1", "F2", "F3", "W"] as const;
/** Slot sets. Slots 0 and 1 share one diagonal of the tile, 2 and 3 the other. */
export const ARMS = {
  bal: { P1: { A: [0, 1], B: [2, 3] }, P2: { A: [2, 3], B: [0, 1] } },
  rA: { R1: { A: [0], B: [1, 2, 3] }, R2: { A: [2], B: [0, 1, 3] } },
  rB: { R1: { A: [1, 2, 3], B: [0] }, R2: { A: [0, 1, 3], B: [2] } },
} as const;
export const MASKS: Dict<number[]> = { m01: [0, 1], m23: [2, 3], m0: [0], m2: [2], m123: [1, 2, 3], m013: [0, 1, 3] };

export interface AssayConfig {
  arena: { tile: number; radius: number; steps: number };
  /** Config override for the depletion arena; null when calibration found none (classifier fixture stands in). */
  depletion: { override: Record<string, number | string | boolean>; pair: [string, string] } | null;
  weakenPercent: number;
  ids: string[];
  seeds: number[];
  rareSeeds: number[];
  /** 0 = no rare arms, 1 = R1 only, 2 = R1 and R2. */
  rarePositions: 0 | 1 | 2;
  twinG: boolean;
  /** Twin position-effect target, from calibration.json: at most half the W-versus-G margin. */
  effectTarget: number;
}

export interface RunRec { key: string; b0: [number, number]; e0: [number, number]; cp: [number, number, number, number][] }
export interface JobSpec { key: string; seed: number; a: string; b: string | null; slotsA: number[]; slotsB: number[]; depletion: boolean }

const pairKey = (a: string, b: string): string => `${a}|${b}`;
/** Twin label: the same genome under a second label. */
export const twinOf = (g: string): string => `${g}'`;

export function panelPairs(ids: readonly string[]): [string, string][] {
  const out: [string, string][] = [];
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) out.push([ids[i], ids[j]]);
  return out;
}
const rareArms = (cfg: AssayConfig): ("rA" | "rB")[] => (cfg.rarePositions ? ["rA", "rB"] : []);
const rareSlots = (cfg: AssayConfig): string[] => (cfg.rarePositions === 2 ? ["R1", "R2"] : cfg.rarePositions === 1 ? ["R1"] : []);

/** Every job of the schedule, sorted by key. */
export function schedule(cfg: AssayConfig): JobSpec[] {
  const jobs: JobSpec[] = [];
  const contests: [string, string][] = [...panelPairs(cfg.ids)];
  if (cfg.twinG) contests.push(["G", twinOf("G")]);
  for (const [a, b] of contests) {
    for (const seed of cfg.seeds) for (const pos of ["P1", "P2"] as const) {
      const s = ARMS.bal[pos];
      jobs.push({ key: `c|${pairKey(a, b)}|bal|${pos}|${seed}`, seed, a, b, slotsA: [...s.A], slotsB: [...s.B], depletion: false });
    }
    for (const arm of rareArms(cfg)) for (const seed of cfg.rareSeeds) for (const pos of rareSlots(cfg) as ("R1" | "R2")[]) {
      const s = ARMS[arm][pos];
      jobs.push({ key: `c|${pairKey(a, b)}|${arm}|${pos}|${seed}`, seed, a, b, slotsA: [...s.A], slotsB: [...s.B], depletion: false });
    }
  }
  for (const id of cfg.ids) {
    const masks = ["m01", "m23"];
    for (const seed of cfg.seeds) for (const m of masks) jobs.push({ key: `s|${id}|${m}|${seed}`, seed, a: id, b: null, slotsA: MASKS[m], slotsB: [], depletion: false });
    if (cfg.rarePositions) {
      const rm = cfg.rarePositions === 2 ? ["m0", "m2", "m123", "m013"] : ["m0", "m123"];
      for (const seed of cfg.rareSeeds) for (const m of rm) jobs.push({ key: `s|${id}|${m}|${seed}`, seed, a: id, b: null, slotsA: MASKS[m], slotsB: [], depletion: false });
    }
  }
  if (cfg.depletion) {
    const [a, b] = cfg.depletion.pair;
    for (const seed of cfg.seeds) for (const pos of ["P1", "P2"] as const) {
      const s = ARMS.bal[pos];
      jobs.push({ key: `d|${pairKey(a, b)}|${pos}|${seed}`, seed, a, b, slotsA: [...s.A], slotsB: [...s.B], depletion: true });
    }
  }
  jobs.sort((x, y) => (x.key < y.key ? -1 : x.key > y.key ? 1 : 0));
  return jobs;
}

// ---- raw record validation --------------------------------------------------------------------------------------------

/** MATTER_MAX of the rules (2^26): total world matter, so no label can hold more biomass than this. */
export const MATTER_BOUND = 2 ** 26;
const isCount = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && Number.isSafeInteger(v);
/**
 * Physical sanity of the raw records, checked before any aggregation: tuple shapes, checkpoint count, finite non-negative
 * integer inventories, positive step-zero inocula for every occupied label, cell counts within the tile, and a label has
 * cells exactly when it has biomass. Returns problems; empty when every record is possible.
 */
export function validateRuns(cfg: AssayConfig, runs: readonly RunRec[], checkpoints: readonly number[]): string[] {
  const out: string[] = [];
  const cells = cfg.arena.tile * cfg.arena.tile;
  const add = (m: string) => { if (out.length < 20) out.push(m); };
  if (!Array.isArray(runs)) return ["runs is not an array"];
  for (const r of runs) {
    const k = r?.key;
    if (typeof k !== "string") { add("a run record has no key"); continue; }
    const solo = k.startsWith("s|");
    if (!Array.isArray(r.b0) || r.b0.length !== 2 || !r.b0.every(isCount)) { add(`${k}: b0 is not a pair of non-negative integers`); continue; }
    if (!Array.isArray(r.e0) || r.e0.length !== 2 || !r.e0.every(isCount)) { add(`${k}: e0 is not a pair of non-negative integers`); continue; }
    if (solo && r.e0[1] !== 0) add(`${k}: solo run has energy on a second label`);
    if (r.b0[0] <= 0 || (solo ? r.b0[1] !== 0 : r.b0[1] <= 0)) add(`${k}: step-zero inoculum must be positive for every occupied label`);
    if (!Array.isArray(r.cp) || r.cp.length !== checkpoints.length) { add(`${k}: ${Array.isArray(r.cp) ? r.cp.length : "no"} checkpoints, expected ${checkpoints.length}`); continue; }
    (r.cp as unknown[]).forEach((c, i) => {
      if (!Array.isArray(c) || c.length !== 4 || !c.every(isCount)) { add(`${k}: checkpoint ${i} is not four non-negative integers`); return; }
      const [bA, bB, cA, cB] = c;
      if (cA + cB > cells) add(`${k}: checkpoint ${i} has ${cA + cB} occupied cells in a ${cells}-cell tile`);
      if ((bA > 0) !== (cA > 0) || (bB > 0) !== (cB > 0)) add(`${k}: checkpoint ${i} has biomass without cells or cells without biomass`);
      // every occupied cell holds at least one unit of biomass, and total matter is bounded (MATTER_MAX = 2^26)
      if (bA < cA || bB < cB) add(`${k}: checkpoint ${i} has fewer biomass units than occupied cells`);
      if (bA + bB > MATTER_BOUND) add(`${k}: checkpoint ${i} biomass exceeds the matter bound`);
      if (solo && (bB !== 0 || cB !== 0)) add(`${k}: solo run has a second label at checkpoint ${i}`);
    });
  }
  return out;
}

// ---- summaries ---------------------------------------------------------------------------------------------------

type Index = Map<string, RunRec>;
const obs = (r: RunRec, k: number): Obs => ({ b0A: r.b0[0], b0B: r.b0[1], bA: r.cp[k][0], bB: r.cp[k][1] });

function balancedBlocks(idx: Index, pair: string, seeds: number[], k: number, prefix = "c", arm = "bal"): BlockPayoff[] {
  return seeds.map((seed) => {
    const mk = (pos: string) => idx.get(prefix === "c" ? `c|${pair}|${arm}|${pos}|${seed}` : `d|${pair}|${pos}|${seed}`);
    const r1 = mk("P1"), r2 = mk("P2");
    if (!r1 || !r2) throw new Error(`missing balanced runs for ${pair} seed ${seed}`);
    return blockPayoff(seed, [obs(r1, k), obs(r2, k)]);
  });
}

/** Rare label's share change from its measured initial share, per seed (mean over positions); null when any position is both-floor. */
function rareBlocks(idx: Index, pair: string, arm: "rA" | "rB", seeds: number[], positions: string[], k: number): (number | null)[] {
  return seeds.map((seed) => {
    const ex: (number | null)[] = positions.map((pos) => {
      const r = idx.get(`c|${pair}|${arm}|${pos}|${seed}`);
      if (!r) throw new Error(`missing rare run ${pair} ${arm} ${pos} ${seed}`);
      const o = obs(r, k);
      const rareIsA = arm === "rA";
      const sh = rareIsA ? shareA(o.b0A, o.b0B, o.bA, o.bB) : shareA(o.b0B, o.b0A, o.bB, o.bA);
      if (sh === null) return null;
      const init = rareIsA ? o.b0A / (o.b0A + o.b0B) : o.b0B / (o.b0A + o.b0B);
      return sh - init;
    });
    return ex.every((v) => v !== null) ? mean(ex as number[]) : null;
  });
}

export interface FloorCounts { contested: number; decisive: number; bothFloor: number; total: number }
function floorCounts(runs: RunRec[], k: number): FloorCounts {
  const c: FloorCounts = { contested: 0, decisive: 0, bothFloor: 0, total: 0 };
  for (const r of runs) {
    const o = obs(r, k);
    const cls = classify(o.b0A, o.b0B, o.bA, o.bB);
    c.total++;
    if (cls === "contested") c.contested++; else if (cls === "decisive") c.decisive++; else c.bothFloor++;
  }
  return c;
}

export interface Summary {
  checkpoints: number[];
  primary: number;
  /** Per pair, per checkpoint index: the balanced-arm summary. Only checkpoint `primary` is confirmatory. */
  balanced: Dict<PairSummary[]>;
  /** Exploratory. */
  invasion: Dict<{
    /** Raw rare-label share change. NOT interpretable alone: a lone disc loses share to arrangement (see the twin pair). */
    rareA: InvasionSummary; rareB: InvasionSummary;
    interpretable: false;
    baseline: "twin";
    /** Raw excess minus the twin pair's excess for the same arm and seed; null for the twin pair itself or without a twin. */
    adjusted: { rareA: InvasionSummary; rareB: InvasionSummary } | null;
  } | null>;
  floor: Dict<Dict<FloorCounts[]>>;
  solo: Dict<Dict<{ mean: number[]; aliveAll: boolean[]; b0: number }>>;
  vigour: Dict<{ observed: number | null; expected: number | null; residual: number | null; blocks: number } | null>;
  matrix: { ids: string[]; payoff: (number | null)[][]; edges: boolean[][]; cycles: string[][]; noThreeCycle: boolean; breadth: Dict<number>; meanPayoff: Dict<number | null> };
  twin: null | {
    labelInvariance: boolean;
    positionAdvantage: number[];
    seeds: number[];
    signFlipP: number | null;
    meanAbs: number | null;
    effectTarget: number;
    naiveDecisiveRate: number | null;
    rare: Dict<number[]> | null;
  };
  depletion: null | { pair: string; bothBelowFloorEveryRun: boolean; status: string; naiveShare: number | null; inventories: { seed: number; pos: string; fracA: number; fracB: number }[] };
  weakened: null | { complete: number; allBelowHalf: boolean; meanPayoffW: number | null; soloAboveFloor: boolean; edgeAllowed: boolean };
}

/** Everything derived. Pure function of (cfg, runs). Throws if the run set differs from the schedule. */
export function summarize(cfg: AssayConfig, runs: RunRec[], checkpoints: number[]): Summary {
  const idx: Index = new Map(runs.map((r) => [r.key, r]));
  const want = schedule(cfg);
  if (want.length !== runs.length || want.some((j) => !idx.has(j.key))) throw new Error("run records do not match the schedule");
  const K = checkpoints.length, primary = K - 1;
  const pairs = panelPairs(cfg.ids);
  const balanced: Dict<PairSummary[]> = {};
  const invasion: Summary["invasion"] = {};
  const floor: Summary["floor"] = {};
  const prs = [...pairs.map(([a, b]) => pairKey(a, b)), ...(cfg.twinG ? [pairKey("G", twinOf("G"))] : [])];
  const positions = rareSlots(cfg);
  const twinKey = pairKey("G", twinOf("G"));
  for (const pr of prs) {
    balanced[pr] = checkpoints.map((_, k) => summarizePair(balancedBlocks(idx, pr, cfg.seeds, k)));
    invasion[pr] = null;
    if (cfg.rarePositions) {
      const minC = Math.ceil((5 / 6) * cfg.rareSeeds.length);
      const rawA = rareBlocks(idx, pr, "rA", cfg.rareSeeds, positions, primary), rawB = rareBlocks(idx, pr, "rB", cfg.rareSeeds, positions, primary);
      let adjusted: { rareA: InvasionSummary; rareB: InvasionSummary } | null = null;
      if (cfg.twinG && pr !== twinKey) {
        const tA = rareBlocks(idx, twinKey, "rA", cfg.rareSeeds, positions, primary), tB = rareBlocks(idx, twinKey, "rB", cfg.rareSeeds, positions, primary);
        const sub = (x: (number | null)[], t: (number | null)[]) => x.map((v, i) => (v === null || t[i] === null ? null : v - (t[i] as number)));
        adjusted = { rareA: summarizeInvasion(sub(rawA, tA), minC), rareB: summarizeInvasion(sub(rawB, tB), minC) };
      }
      invasion[pr] = { rareA: summarizeInvasion(rawA, minC), rareB: summarizeInvasion(rawB, minC), interpretable: false, baseline: "twin", adjusted };
    }
    floor[pr] = {};
    for (const arm of ["bal", ...rareArms(cfg)]) {
      const rs = runs.filter((r) => r.key.startsWith(`c|${pr}|${arm}|`));
      floor[pr][arm] = checkpoints.map((_, k) => floorCounts(rs, k));
    }
  }
  // solo growth per genotype and mask
  const solo: Summary["solo"] = {};
  for (const id of cfg.ids) {
    solo[id] = {};
    for (const m of new Set(runs.filter((r) => r.key.startsWith(`s|${id}|`)).map((r) => r.key.split("|")[2]))) {
      const rs = runs.filter((r) => r.key.startsWith(`s|${id}|${m}|`));
      solo[id][m] = {
        mean: checkpoints.map((_, k) => mean(rs.map((r) => r.cp[k][0]))),
        aliveAll: checkpoints.map((_, k) => rs.every((r) => !atFloor(r.cp[k][0], r.b0[0]))),
        b0: mean(rs.map((r) => r.b0[0])),
      };
    }
  }
  // descriptive vigour residual at the primary checkpoint, balanced arm
  const vigour: Summary["vigour"] = {};
  for (const [a, b] of pairs) {
    const pr = pairKey(a, b);
    const per: { payoff: number; expected: number }[] = [];
    for (const seed of cfg.seeds) {
      const blk = blockPayoff(seed, [obs(idx.get(`c|${pr}|bal|P1|${seed}`)!, primary), obs(idx.get(`c|${pr}|bal|P2|${seed}`)!, primary)]);
      if (blk.payoff === null) continue;
      const v = (id: string, m: string) => idx.get(`s|${id}|${m}|${seed}`)!.cp[primary][0];
      const e1 = vigourExpected(v(a, "m01"), v(b, "m23")), e2 = vigourExpected(v(a, "m23"), v(b, "m01"));
      if (e1 === null || e2 === null) continue;
      per.push({ payoff: blk.payoff, expected: (e1 + e2) / 2 });
    }
    vigour[pr] = per.length ? { observed: mean(per.map((x) => x.payoff)), expected: mean(per.map((x) => x.expected)), residual: mean(per.map((x) => x.payoff - x.expected)), blocks: per.length } : null;
  }
  // matrix, edges, cycles, breadth (confirmatory edges only)
  const ids = [...cfg.ids];
  const payoff: (number | null)[][] = ids.map(() => ids.map(() => null));
  const edges = ids.map(() => ids.map(() => false));
  for (const [a, b] of pairs) {
    const s = balanced[pairKey(a, b)][primary];
    const i = ids.indexOf(a), j = ids.indexOf(b);
    if (s.status === "informative" && s.mean !== null) { payoff[i][j] = s.mean; payoff[j][i] = 1 - s.mean; }
    if (s.edge === "A>B") edges[i][j] = true;
    if (s.edge === "B>A") edges[j][i] = true;
  }
  const cyc = findCycles(edges).map((c) => c.map((i) => ids[i]));
  const br = breadth(edges);
  const matrix: Summary["matrix"] = {
    ids, payoff, edges, cycles: cyc, noThreeCycle: cyc.length === 0,
    breadth: Object.fromEntries(ids.map((id, i) => [id, br[i]])),
    meanPayoff: Object.fromEntries(ids.map((id, i) => { const v = payoff[i].filter((x): x is number => x !== null); return [id, v.length ? mean(v) : null]; })),
  };
  // twin controls
  let twin: Summary["twin"] = null;
  if (cfg.twinG) {
    const pr = pairKey("G", twinOf("G"));
    let inv = true;
    const adv: number[] = [];
    let decisive = 0, nruns = 0;
    for (const seed of cfg.seeds) {
      const r1 = idx.get(`c|${pr}|bal|P1|${seed}`)!, r2 = idx.get(`c|${pr}|bal|P2|${seed}`)!;
      // same genome everywhere: the two reciprocal worlds are one physical world, so counts swap exactly
      if (r1.b0[0] !== r2.b0[1] || r1.b0[1] !== r2.b0[0]) inv = false;
      r1.cp.forEach((c, k) => { const d = r2.cp[k]; if (c[0] !== d[1] || c[1] !== d[0] || c[2] !== d[3] || c[3] !== d[2]) inv = false; });
      const o = obs(r1, primary);
      adv.push(o.bA / (o.bA + o.bB) - o.b0A / (o.b0A + o.b0B));
      for (const r of [r1, r2]) { const oo = obs(r, primary); const sh = oo.bA / (oo.bA + oo.bB); nruns++; if (Math.abs(sh - 0.5) > 0.1) decisive++; }
    }
    const rare: Dict<number[]> = {};
    if (cfg.rarePositions) for (const arm of ["rA", "rB"] as const) rare[arm] = rareBlocks(idx, pr, arm, cfg.rareSeeds, positions, primary).filter((v): v is number => v !== null);
    twin = {
      labelInvariance: inv, positionAdvantage: adv, seeds: cfg.seeds, signFlipP: signFlipP(adv), meanAbs: adv.length ? mean(adv.map(Math.abs)) : null,
      effectTarget: cfg.effectTarget, naiveDecisiveRate: nruns ? decisive / nruns : null, rare: cfg.rarePositions ? rare : null,
    };
  }
  // depletion arena
  let depletion: Summary["depletion"] = null;
  if (cfg.depletion) {
    const pr = pairKey(...cfg.depletion.pair);
    const inventories: { seed: number; pos: string; fracA: number; fracB: number }[] = [];
    let all = true;
    for (const seed of cfg.seeds) for (const pos of ["P1", "P2"]) {
      const r = idx.get(`d|${pr}|${pos}|${seed}`)!;
      const o = obs(r, primary);
      inventories.push({ seed, pos, fracA: o.bA / o.b0A, fracB: o.bB / o.b0B });
      if (!(atFloor(o.bA, o.b0A) && atFloor(o.bB, o.b0B))) all = false;
    }
    const sum = summarizePair(balancedBlocks(idx, pr, cfg.seeds, primary, "d"));
    depletion = { pair: pr, bothBelowFloorEveryRun: all, status: sum.status, naiveShare: sum.naiveMean, inventories };
  }
  // weakened-variant positive control
  let weakened: Summary["weakened"] = null;
  if (cfg.ids.includes("G") && cfg.ids.includes("W")) {
    const s = balanced[pairKey("G", "W")][primary];
    const gp = s.payoffs;
    const wp = gp.map((x) => 1 - x);
    weakened = {
      complete: gp.length, allBelowHalf: gp.length > 0 && wp.every((x) => x < 0.5), meanPayoffW: gp.length ? mean(wp) : null,
      soloAboveFloor: ["m01", "m23"].every((m) => solo.W[m].aliveAll[primary]), edgeAllowed: gp.length >= EDGE_MIN_BLOCKS,
    };
  }
  return { checkpoints, primary, balanced, invasion, floor, solo, vigour, matrix, twin, depletion, weakened };
}

// ---- pure-function fixtures (G5) ---------------------------------------------------------------------------------

const blocksOf = (vals: (number | null)[]): BlockPayoff[] => vals.map((v, i) => ({ seed: i, payoff: v, naive: v ?? 0.5, shares: [v] }));
const ten = (centre: number): number[] => Array.from({ length: 10 }, (_, i) => centre + ((i % 3) - 1) * 0.01);

export interface FixtureReport {
  vigourOnly: { payoff: number; expected: number | null; residual: number | null; naiveSays: string; pass: boolean };
  rpsSynthetic: { cycles: string[][]; pass: boolean; synthetic: true };
  transitive: { cycles: string[][]; pass: boolean };
  straddle: { edge: string | null; pass: boolean };
  asymmetricExclusion: { complete: number; excluded: number; status: string; naiveMean: number; keptMean: number | null; pass: boolean };
  bothFloorClassifier: { cls: string; share: number | null; naiveShare: number; pass: boolean };
  pass: boolean;
}
const edgeMatrix = (labels: string[], payoffs: Dict<number[]>): { cycles: string[][] } => {
  const e = labels.map(() => labels.map(() => false));
  for (const [k, v] of Object.entries(payoffs)) {
    const [a, b] = k.split("|");
    const s = summarizePair(blocksOf(v));
    const i = labels.indexOf(a), j = labels.indexOf(b);
    if (s.edge === "A>B") e[i][j] = true;
    if (s.edge === "B>A") e[j][i] = true;
  }
  return { cycles: findCycles(e).map((c) => c.map((i) => labels[i])) };
};

export function runFixtures(): FixtureReport {
  // vigour-only: solo growth 3:1, the contest payoff is exactly the vigour share
  const vExp = vigourExpected(300, 100);
  const vig = { payoff: 0.75, expected: vExp, residual: vExp === null ? null : 0.75 - vExp, naiveSays: "A dominates B", pass: false };
  vig.pass = vExp === 0.75 && vig.residual === 0;
  const L = ["A", "B", "C"];
  const rps = edgeMatrix(L, { "A|B": ten(0.8), "B|C": ten(0.8), "A|C": ten(0.2) });
  const tr = edgeMatrix(L, { "A|B": ten(0.8), "B|C": ten(0.8), "A|C": ten(0.8) });
  const rpsPass = rps.cycles.length === 1 && canonical(rps.cycles[0]) === canonical(["A", "B", "C"]);
  const strad = summarizePair(blocksOf([0.9, 0.9, 0.9, 0.9, 0.9, 0.1, 0.1, 0.1, 0.1, 0.1]));
  // 10 blocks, three of them with one position both-floor: the whole block goes, and the pair is uninformative (7 < 8)
  const ex = summarizePair(blocksOf([0.7, 0.7, 0.7, 0.7, 0.7, 0.7, 0.7, null, null, null]));
  const exPass = ex.complete === 7 && ex.excluded === 3 && ex.status === "uninformative" && ex.naiveMean < ex.mean! && ex.edge === null;
  const cls = classify(1000, 1000, 10, 20);
  const bf = { cls, share: shareA(1000, 1000, 10, 20), naiveShare: 0.5, pass: false };
  bf.pass = cls === "both-floor" && bf.share === null && classify(1000, 1000, 0, 0) === "both-floor" && classify(1000, 1000, 62, 500) === "decisive" && classify(1000, 1000, 63, 500) === "contested";
  const pass = vig.pass && rpsPass && tr.cycles.length === 0 && strad.edge === null && exPass && bf.pass;
  return {
    vigourOnly: vig, rpsSynthetic: { cycles: rps.cycles, pass: rpsPass, synthetic: true }, transitive: { cycles: tr.cycles, pass: tr.cycles.length === 0 },
    straddle: { edge: strad.edge, pass: strad.edge === null }, asymmetricExclusion: { complete: ex.complete, excluded: ex.excluded, status: ex.status, naiveMean: ex.naiveMean, keptMean: ex.mean, pass: exPass },
    bothFloorClassifier: bf, pass,
  };
}

// ---- gates -------------------------------------------------------------------------------------------------------

export interface GateReport { gates: Gates; detail: Dict<unknown>; verdict: Verdict }
export const G2_MEAN_MAX = 0.4;
export const G3_BOTH_FLOOR_MAX = 0.2;

export function evaluateGates(cfg: AssayConfig, s: Summary, fx: FixtureReport, invalid = false): GateReport {
  const P = s.primary;
  const t = s.twin;
  const G1a = !!t && t.labelInvariance;
  const G1b = !!t && t.signFlipP !== null && t.signFlipP > 0.05 && t.meanAbs !== null && t.meanAbs < t.effectTarget;
  const w = s.weakened;
  const G2 = !!w && w.allBelowHalf && w.complete >= EDGE_MIN_BLOCKS && w.meanPayoffW !== null && w.meanPayoffW <= G2_MEAN_MAX && w.soloAboveFloor;
  const floorFails: string[] = [];
  const uninformative: string[] = [];
  for (const [a, b] of panelPairs(cfg.ids)) {
    const pr = pairKey(a, b);
    if (s.balanced[pr][P].status === "uninformative") uninformative.push(pr);
    // every enabled rare arm needs its own complete-block eligibility, whatever its both-floor run fraction
    const inv = s.invasion[pr];
    if (inv) for (const arm of ["rareA", "rareB"] as const) if (inv[arm].class === "uninformative") uninformative.push(`${pr}/${arm === "rareA" ? "rA" : "rB"}`);
    for (const [arm, arr] of Object.entries(s.floor[pr])) { const c = arr[P]; if (c.total && c.bothFloor / c.total > G3_BOTH_FLOOR_MAX) floorFails.push(`${pr}/${arm}`); }
  }
  const G3 = floorFails.length === 0 && uninformative.length === 0;
  let G4: boolean;
  if (cfg.depletion) G4 = !!s.depletion && s.depletion.bothBelowFloorEveryRun && s.depletion.status === "uninformative" && fx.bothFloorClassifier.pass;
  else G4 = fx.bothFloorClassifier.pass;
  const G5 = fx.pass;
  const gates: Gates = { G1a, G1b, G2, G3, G4, G5, invalid };
  return { gates, detail: { floorFails, uninformativePairs: uninformative, depletionInWorld: !!cfg.depletion, weakenedEdgeAllowed: w?.edgeAllowed ?? null }, verdict: decideVerdict(gates) };
}

// ---- payload and seal ----------------------------------------------------------------------------------------------

export interface Payload {
  kind: "historical-opponents-assay-evidence";
  version: 1;
  statements: readonly string[];
  note: string;
  config: AssayConfig;
  panel: { founderSet: string; founderIndices: number[]; hex: Dict<string>; distances: Dict<number>; weakenPercent: number };
  constants: { floorDiv: number; edgeMinBlocks: number; edgeMinOffset: number; familySize: number; g2MeanMax: number; g3BothFloorMax: number; completeFraction: number; checkpoints: number[]; plant: Dict<number>; ruleVersion: number };
  schedule: { jobs: number; contests: number; solo: number; depletion: number };
  runs: RunRec[];
  summary: Summary;
  fixtures: FixtureReport;
  gates: GateReport;
  verdict: Verdict;
  limits: string[];
  integritySha256?: string;
}

export const LIMITS = [
  "sensitivity check on five genetically separated founders in small CPU arenas; not the M3 environment",
  "a payoff is the share of biomass at a step, not reproduction or fitness; wins can be vigour, see the monoculture residual",
  "the cycle fixture is synthetic; 'none detected' on the real panel is not 'none exist'",
  "rare-arm invasion, other checkpoints and the vigour residual are exploratory and feed no gate",
  "the weakened variant is a single manipulation, a sensitivity floor and not a spectrum of effect sizes",
  "an interval containing 0.5 is not evidence of equality; 10 seed blocks give wide intervals",
  "no historical-archive tournament, no GPU evidence, not on the public site",
  "rare-arm invasion classes are raw and not interpretable alone; the twin-adjusted classes subtract the identical-genome arrangement penalty per seed",
  "the position-bias gate (G1b) is low power: ten blocks, and a threshold fitted on three other seeds; it can pass when single-seed place effects reach +0.2",
  "exploratory: nothing was committed before the evidence was first written, so the thresholds' prospective freeze is not independently timestamped, and protocol corrections after review were made with the earlier outcomes known",
];

/** The frozen metadata of a payload, derived from the config and a few inputs the caller must supply (panel, checkpoints, plant, rule version). */
export function expectedMeta(cfg: AssayConfig, checkpoints: number[], plant: Dict<number>, ruleVersion: number): Pick<Payload, "constants" | "schedule"> {
  const jobs = schedule(cfg);
  return {
    constants: { floorDiv: FLOOR_DIV, edgeMinBlocks: EDGE_MIN_BLOCKS, edgeMinOffset: EDGE_MIN_OFFSET, familySize: FAMILY, g2MeanMax: G2_MEAN_MAX, g3BothFloorMax: G3_BOTH_FLOOR_MAX, completeFraction: COMPLETE_FRACTION.balanced, checkpoints, plant, ruleVersion },
    schedule: { jobs: jobs.length, contests: jobs.filter((j) => j.key[0] === "c").length, solo: jobs.filter((j) => j.key[0] === "s").length, depletion: jobs.filter((j) => j.key[0] === "d").length },
  };
}

export function buildPayload(cfg: AssayConfig, runs: RunRec[], panel: Payload["panel"], checkpoints: number[], plant: Dict<number>, ruleVersion: number): Payload {
  const sorted = [...runs].sort((x, y) => (x.key < y.key ? -1 : 1));
  const bad = validateRuns(cfg, sorted, checkpoints);
  if (bad.length) throw new Error(`invalid run records: ${bad.join("; ")}`);
  const summary = summarize(cfg, sorted, checkpoints);
  const fixtures = runFixtures();
  const gates = evaluateGates(cfg, summary, fixtures);
  const meta = expectedMeta(cfg, checkpoints, plant, ruleVersion);
  return {
    kind: "historical-opponents-assay-evidence", version: 1, statements: STATEMENTS, note: SALT_NOTE, config: cfg, panel,
    constants: meta.constants, schedule: meta.schedule,
    runs: sorted, summary, fixtures, gates, verdict: gates.verdict, limits: LIMITS,
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

/** Recompute summary, fixtures, gates and verdict from the raw run records alone; return the differences from what is stored. */
export function recompute(p: Payload): string[] {
  const problems: string[] = [];
  try {
    const bad = validateRuns(p.config, p.runs, p.constants.checkpoints);
    if (bad.length) return bad.map((m) => `invalid run record: ${m}`);
    const summary = summarize(p.config, p.runs, p.constants.checkpoints);
    const fixtures = runFixtures();
    const gates = evaluateGates(p.config, summary, fixtures);
    const norm = (x: unknown): string => canonical(JSON.parse(JSON.stringify(x)));
    if (norm(summary) !== norm(p.summary)) problems.push("stored summary differs from the summary recomputed from the raw runs");
    if (norm(fixtures) !== norm(p.fixtures)) problems.push("stored fixtures differ from recomputed fixtures");
    if (norm(p.limits) !== norm(LIMITS)) problems.push("stored limits differ from the current limits");
    if (norm(gates) !== norm(p.gates)) problems.push("stored gates differ from the gates recomputed from the raw runs");
    if (gates.verdict !== p.verdict) problems.push(`stored verdict ${p.verdict} differs from recomputed ${gates.verdict}`);
  } catch (e) {
    problems.push(`recompute failed: ${(e as Error).message}`);
  }
  return problems;
}
