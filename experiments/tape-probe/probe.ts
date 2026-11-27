// The common probe: arms (controller representations), panels (starting controllers), the three-way
// classification and per-cell statistics. Exploratory, no gate.
//
// Viability is an output-envelope PROXY (the tape controller cannot be plugged into RefSim without editing
// sim-ref), parent-relative and computed from grid outputs only; it is calibrated on the weight arm only.
//   carried channel k<6: grid mean of the parent >= 8.
//   LETHAL iff (L1) a carried channel's mutant mean falls below `factor` x parent mean (function lost; factor 1/2 main)
//        or (L2) summed catalytic mutant mean > 2 x parent sum + 32 (cost blowout).
// Class order: NEUTRAL (outs identical) first, then LETHAL, else CHANGED-VIABLE. Only FUNCTIONAL parents get
// viability classes; for others a changed mutant is "na-changed".
import { NN_BYTES, decodeGenome, defaultConfig, emptyGenome, encodeGenome, randomGenome } from "@bl/schema";
import { mutateInPlace } from "@bl/sim-ref";
import { describeProbes, type Probe } from "@bl/lineage";
import { GRID_POINTS, NCAT, NO, SALT, channelMeans, functional, hashOuts, keyedWith, nnOuts, parentBootstrap, permille, rd, strId, wilson } from "./common.ts";
import { TAPE_BYTES, byteResample, byteStep, decodeChanging, deleteInstr, dupInstr, insertInstr, instrResample, randomTape, tapeOuts } from "./tape.ts";
import { bffByteResample, bffOuts, randomBff, type BffPrior, BFF_PROG } from "./bff-controller.ts";
import { withWeights } from "@bl/lineage";

export type Operator = (parent: Uint8Array, sub: number) => Uint8Array;
export interface Arm {
  name: string;
  genomeLen: number;
  outsOf(g: Uint8Array): Int16Array;
  random(base: number): Uint8Array;
  operators: Record<string, Operator>;
  /** true when the mutant's canonical decode differs from the parent's (default: always true). */
  decodeChanging?(parent: Uint8Array, mutant: Uint8Array): boolean;
}

const int8 = (g: Uint8Array): Int8Array => new Int8Array(g.buffer.slice(g.byteOffset, g.byteOffset + g.length));
const asBytes = (w: Int8Array): Uint8Array => new Uint8Array(w.buffer.slice(0));
const TEMPLATE = encodeGenome(emptyGenome(60, 20), 0, 0);
const CFG = defaultConfig();

export const NN_ARM: Arm = {
  name: "weights",
  genomeLen: NN_BYTES,
  outsOf: (g) => nnOuts(int8(g)),
  random: (base) => asBytes(randomGenome(base, 60, 20).weights),
  operators: {
    // the real mutateInPlace (mutStep 24), `which` forced into the 160 controller slots
    "W-step": (p, sub) => {
      const words = withWeights(TEMPLATE, int8(p));
      mutateInPlace(words, 1, 0, CFG, rd(sub, 0, NN_BYTES), rd(sub, 1, 1 << 20));
      return asBytes(decodeGenome(words).weights);
    },
    "W-resample": (p, sub) => { const t = p.slice(); t[rd(sub, 0, NN_BYTES)] = (rd(sub, 1, 255) - 127) & 255; return t; },
  },
};

export const TAPE_ARM: Arm = {
  name: "tape-R",
  genomeLen: TAPE_BYTES,
  outsOf: tapeOuts,
  random: randomTape,
  decodeChanging,
  operators: {
    "T-byte-step": byteStep, "T-byte-resample": byteResample, "T-instr-resample": instrResample,
    "T-insert": insertInstr, "T-delete": deleteInstr, "T-dup": dupInstr,
  },
};

export const bffArm = (prior: BffPrior): Arm => ({
  name: `bff-${prior}`,
  genomeLen: BFF_PROG,
  outsOf: bffOuts,
  random: (b) => randomBff(b, prior),
  operators: { "B-byte-resample": (p, s) => bffByteResample(p, s, prior) },
});

// ---- measurement ----
export interface Diff { pointsChanged: number; valuesChanged: number; sumAbsDelta: number; maxDelta: number; outputsMoved: number }
export function diffStats(a: Int16Array, b: Int16Array): Diff {
  let pointsChanged = 0, valuesChanged = 0, sumAbsDelta = 0, maxDelta = 0;
  const per = new Array<number>(NO).fill(0);
  for (let p = 0; p < GRID_POINTS; p++) {
    let any = false;
    for (let k = 0; k < NO; k++) {
      const d = Math.abs(b[p * NO + k] - a[p * NO + k]);
      if (d) { any = true; valuesChanged++; sumAbsDelta += d; per[k]++; if (d > maxDelta) maxDelta = d; }
    }
    if (any) pointsChanged++;
  }
  // same breadth rule as describeProbes: channels changing at >= 10 permille of the grid
  const outputsMoved = per.filter((c) => Math.floor((1000 * c) / GRID_POINTS) >= 10).length;
  return { pointsChanged, valuesChanged, sumAbsDelta, maxDelta, outputsMoved };
}
export const breadthOf = (a: Int16Array, b: Int16Array): number => describeProbes({ outs: a } as Probe, { outs: b } as Probe).breadth;

export interface ParentInfo { outs: Int16Array; means: number[]; catSum: number; functional: boolean }
export function parentInfo(outs: Int16Array): ParentInfo {
  const means = channelMeans(outs);
  return { outs, means, catSum: means.slice(0, NCAT).reduce((x, y) => x + y, 0), functional: functional(outs) };
}

export type Cls = "neutral" | "viable" | "lethal" | "na-changed";
/** num/den = L1 factor (1/2 main; 1/4 and 3/4 in the sweep). */
export function classify(P: ParentInfo, mMeans: number[], changed: boolean, num = 1, den = 2): Cls {
  if (!changed) return "neutral";
  if (!P.functional) return "na-changed";
  let mSum = 0;
  for (let k = 0; k < NCAT; k++) {
    mSum += mMeans[k];
    if (P.means[k] >= 8 && mMeans[k] * den < P.means[k] * num) return "lethal";
  }
  if (mSum > 2 * P.catSum + 32) return "lethal";
  return "viable";
}

export const classifyOuts = (P: ParentInfo, mOuts: Int16Array, changed: boolean, num = 1, den = 2): Cls =>
  classify(P, changed ? channelMeans(mOuts) : P.means, changed, num, den);

export interface Parent { id: string; g: Uint8Array }
export interface Panel { id: string; parents: Parent[]; acceptance?: { tried: number; accepted: number } }

export function buildPanelRaw(arm: Arm, n: number, salt = SALT): Panel {
  const parents: Parent[] = [];
  for (let i = 0; i < n; i++) parents.push({ id: `raw${i}`, g: arm.random(keyedWith(salt, strId(arm.name), strId("raw"), i)) });
  return { id: "raw", parents };
}
/** Rejection-sample the same prior until functional (max `maxTries` per parent). Acceptance counts every try. */
export function buildPanelFunc(arm: Arm, n: number, maxTries = 2000, salt = SALT): Panel {
  const parents: Parent[] = [];
  let tried = 0, accepted = 0;
  for (let i = 0; i < n; i++) {
    for (let t = 0; t < maxTries; t++) {
      const g = arm.random(keyedWith(salt, strId(arm.name), strId("func"), i, t));
      tried++;
      if (functional(arm.outsOf(g))) { accepted++; parents.push({ id: `func${i}`, g }); break; }
    }
  }
  return { id: "func", parents, acceptance: { tried, accepted } };
}

export interface CellOpts { arm: Arm; panel: Panel; kind: string; mutantsPerParent: number; salt?: number }

const mid = (a: number[]): number => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const same = (a: Uint8Array, b: Uint8Array): boolean => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; };

export function runCell(o: CellOpts) {
  const { arm, panel, kind, mutantsPerParent } = o;
  const salt = o.salt ?? SALT;
  const op = arm.operators[kind];
  if (!op) throw new Error(`no operator ${kind} for ${arm.name}`);
  const FACT: [string, number, number][] = [["quarter", 1, 4], ["half", 1, 2], ["threeQuarter", 3, 4]];
  const sweep: Record<string, { neutral: number; viable: number; lethal: number }> = {};
  for (const [nm] of FACT) sweep[nm] = { neutral: 0, viable: 0, lethal: 0 };
  let n = 0, degenerate = 0, redraws = 0, neutral = 0, viable = 0, lethal = 0, naChanged = 0, dcN = 0, dcNeutral = 0;
  let valuesChanged = 0, sumAbsDelta = 0, sumMax = 0, sumMoved = 0, nChanged = 0;
  const bins = [0, 0, 0, 0];
  const pN: number[] = [], pNeutral: number[] = [], pChanged: number[] = [], pDistinct: number[] = [];
  let funcParents = 0;
  for (let pi = 0; pi < panel.parents.length; pi++) {
    const par = panel.parents[pi];
    const P = parentInfo(arm.outsOf(par.g));
    if (P.functional) funcParents++;
    const base = keyedWith(salt, strId(panel.id), pi, strId(kind));
    const hashes = new Set<string>();
    let pn = 0, pne = 0, pch = 0;
    for (let m = 0; m < mutantsPerParent; m++) {
      let mut: Uint8Array | null = null;
      for (let a = 0; a < 8; a++) {
        const t = op(par.g, keyedWith(base, m, a));
        if (!same(t, par.g)) { mut = t; redraws += a; break; }
      }
      if (!mut) { degenerate++; redraws += 8; continue; }
      const mOuts = arm.outsOf(mut);
      const d = diffStats(P.outs, mOuts);
      const changed = d.pointsChanged > 0;
      const mMeans = changed ? channelMeans(mOuts) : P.means;
      const cls = classify(P, mMeans, changed);
      for (const [nm, nu, de] of FACT) { const c = classify(P, mMeans, changed, nu, de); if (c === "neutral") sweep[nm].neutral++; else if (c === "viable") sweep[nm].viable++; else if (c === "lethal") sweep[nm].lethal++; }
      n++; pn++;
      const dc = arm.decodeChanging ? arm.decodeChanging(par.g, mut) : true;
      if (dc) { dcN++; if (cls === "neutral") dcNeutral++; }
      if (cls === "neutral") { neutral++; pne++; }
      else {
        if (cls === "viable") viable++; else if (cls === "lethal") lethal++; else naChanged++;
        nChanged++; pch++; hashes.add(hashOuts(mOuts));
        valuesChanged += d.valuesChanged; sumAbsDelta += d.sumAbsDelta; sumMax += d.maxDelta; sumMoved += d.outputsMoved;
        const f100 = d.pointsChanged * 100, f10 = d.pointsChanged * 10;
        bins[f100 < GRID_POINTS ? 0 : f10 < GRID_POINTS ? 1 : d.pointsChanged * 2 <= GRID_POINTS ? 2 : 3]++;
      }
    }
    pN.push(pn); pNeutral.push(pne); pChanged.push(pch); pDistinct.push(hashes.size);
  }
  for (const v of [valuesChanged, sumAbsDelta, sumMax]) if (!Number.isSafeInteger(v)) throw new Error("accumulator overflow");
  const P = panel.parents.length;
  const perParentNeutral = pN.map((x, i) => permille(pNeutral[i], x));
  const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
  const sorted = perParentNeutral.slice().sort((x, y) => x - y);
  return {
    rep: arm.name, panel: panel.id, kind, parents: P, functionalParents: funcParents, mutantsPerParent, n, degenerate, redraws,
    neutral, changedViable: viable, lethal, viableNA: naChanged,
    neutralDecodeChanging: { n: dcN, neutral: dcNeutral },
    permille: { neutral: permille(neutral, n), changedViable: permille(viable, n), lethal: permille(lethal, n) },
    wilson: { neutral: wilson(neutral, n), changedViable: wilson(viable, n), lethal: wilson(lethal, n) },
    parentSpread: P ? { min: sorted[0], median: mid(perParentNeutral), max: sorted[P - 1] } : { min: 0, median: 0, max: 0 },
    parentBoot: parentBootstrap(pNeutral, pN, strId(arm.name + panel.id + kind)),
    changed: nChanged,
    bins, // changed mutants by fraction of grid points changed: <1%, 1-10%, 10-50%, >50%
    meanAbsDeltaInt: valuesChanged ? Math.floor(sumAbsDelta / valuesChanged) : 0,
    meanMaxDelta: nChanged ? Math.floor(sumMax / nChanged) : 0,
    meanOutputsMovedMilli: nChanged ? Math.floor((1000 * sumMoved) / nChanged) : 0,
    distinct: {
      perParentMeanMilli: P ? Math.floor((1000 * sum(pDistinct)) / P) : 0,
      changedPerParentMeanMilli: P ? Math.floor((1000 * sum(pChanged)) / P) : 0,
      pooledRatioPermille: permille(sum(pDistinct), sum(pChanged)),
    },
    sweep,
  };
}
export type CellRecord = ReturnType<typeof runCell>;
