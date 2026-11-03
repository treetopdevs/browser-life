// Verdict arithmetic on per-replicate rows (PLAN R7, R8). Pure functions of stored rows: tests feed hand-made rows.
import { cmpRat, type Rat } from "../readouts.ts";
import { identityAtLeastHalf, identityReturn, persistent } from "./readouts.ts";
import { DPROTOCOL, type ProcessId } from "./protocol.ts";

export interface ConnArm {
  n1: number; n2: number; roundCounts: number[];
  identity: Rat | null; persistence: boolean;
  cw: number; level: boolean | null; high: boolean;
}
export interface Arm {
  removedMass: number; sweptMass: number; regrownMass: number; occupiedAfterDamage: number; occupiedFinal: number; residual: number;
  c4: ConnArm; c8: ConnArm; d4: ConnArm;
}
export interface ScrambleRow { targetCopies: number; sharedBound: number | null; reuseRatio: Rat | null; dagKeys: number; objects: number }
export interface Row {
  process: ProcessId; replicate: number; kind: string; targetKey: string; objectSize: number;
  n0: { c4: number; c8: number; d4: number };
  original: { cw: number; sharedBound: number | null; reuseRatio: Rat | null; objects: number };
  partial: Arm; total: Arm;
  /** identityReturn of the store-deleted arm after lesion-total (null when the process has no store arm) */
  nostore: { identity: Rat | null; n2: number } | null;
  scramble: ScrambleRow;
}

export type Label = "reconstructs" | "reappears-by-templating-only" | "level-only" | "absent";
export const isRecipeDependent = (p: ProcessId): boolean => (DPROTOCOL.recipeDependentTruth as readonly string[]).includes(p);
const hasStoreArm = (p: ProcessId): boolean => (DPROTOCOL.storeProcesses as readonly string[]).includes(p);
const identityZero = (r: Rat | null): boolean => r !== null && r.num === 0;

export type Variant = "c4" | "c8" | "d4";
/** C1: recipe-dependent reconstruction after total destruction, with store ablation. No store arm: false (documented n/a). */
export function c1(row: Row, v: Variant = "c4"): boolean {
  if (!hasStoreArm(row.process) || !row.nostore) return false;
  const t = row.total[v];
  return identityAtLeastHalf(t.identity) && t.persistence && identityZero(row.nostore.identity);
}
/** C2: the naive level classifier: copy-weighted construction returns after partial destruction (undefined counts false). */
export const c2 = (row: Row, v: Variant = "c4"): boolean => row.partial[v].level === true;
/** C3: occupancy return: final mass after lesion-total within one object of M. */
export const c3 = (row: Row): boolean => Math.abs(DPROTOCOL.patch.mass - row.total.occupiedFinal) <= row.objectSize;

export function processLabel(rows: readonly Row[], v: Variant = "c4"): Label {
  if (rows.length === 0) return "absent";
  if (rows.every((r) => c1(r, v) && r.total[v].high)) return "reconstructs";
  if (rows.every((r) => identityAtLeastHalf(r.partial[v].identity) && identityZero(r.total[v].identity))) return "reappears-by-templating-only";
  if (rows.every((r) => r.partial[v].level === true && identityZero(r.partial[v].identity))) return "level-only";
  return "absent";
}

export interface Accuracy { correct: number; total: number }
export interface Classifiers { c1: Accuracy; c2: Accuracy; c3: Accuracy }

export function accuracy(rows: readonly Row[]): Classifiers {
  const out: Classifiers = { c1: { correct: 0, total: 0 }, c2: { correct: 0, total: 0 }, c3: { correct: 0, total: 0 } };
  for (const r of rows) {
    const truth = isRecipeDependent(r.process);
    for (const [k, pred] of [["c1", c1(r)], ["c2", c2(r)], ["c3", c3(r)]] as const) {
      out[k].total++;
      if (pred === truth) out[k].correct++;
    }
  }
  return out;
}

export interface ScrambleGate { kind: string; replicates: number; sharedBoundWorse: number; reuseRatioWorse: number; pass: boolean }
/** Organisation control: per readout, the count of replicates that moved to the worse (higher cost) side; undefined counts as moved. */
export function scrambleGate(kind: string, rows: readonly Row[]): ScrambleGate {
  const worse = (before: Rat | null, after: Rat | null) => after === null || before === null || cmpRat(after, before) > 0;
  let sb = 0, rr = 0;
  for (const r of rows) {
    const asRat = (n: number | null): Rat | null => (n === null ? null : { num: n, den: 1 });
    if (r.scramble.dagKeys < 2 || worse(asRat(r.original.sharedBound), asRat(r.scramble.sharedBound))) sb++;
    if (r.scramble.dagKeys < 2 || worse(r.original.reuseRatio, r.scramble.reuseRatio)) rr++;
  }
  return { kind, replicates: rows.length, sharedBoundWorse: sb, reuseRatioWorse: rr, pass: sb >= DPROTOCOL.scrambleMin && rr >= DPROTOCOL.scrambleMin };
}

export interface ProcessTable {
  process: ProcessId; truth: "recipe-dependent" | "not-recipe-dependent"; label: Label; labelC8: Label; labelD4: Label; segmentationDominated: boolean;
  measurementLimited: boolean;
  c1Count: number; c2Count: number; c3Count: number; replicates: number;
}

const posRat = (r: Rat | null): boolean => r !== null && Number.isInteger(r.num) && Number.isInteger(r.den) && r.den > 0 && r.num >= 0 && r.num <= r.den;

/** Structural validation; a problem rejects the run (missing or unknown rows, bad rationals, inconsistent counts, broken mass identity). */
export function validateRows(rows: readonly Row[], replicates: number = DPROTOCOL.replicates): string[] {
  const problems: string[] = [];
  const known = new Set<string>(DPROTOCOL.processes);
  for (const r of rows) if (!known.has(r.process)) problems.push(`unknown process ${r.process}`);
  if (rows.length !== DPROTOCOL.processes.length * replicates) problems.push(`row count ${rows.length} != ${DPROTOCOL.processes.length * replicates}`);
  for (const p of DPROTOCOL.processes) {
    const mine = rows.filter((r) => r.process === p);
    const reps = mine.map((r) => r.replicate).sort((a, b) => a - b);
    if (reps.length !== replicates || reps.some((x, i) => x !== i)) problems.push(`${p}: replicate set is incomplete`);
    for (const r of mine) {
      for (const [name, arm] of [["partial", r.partial], ["total", r.total]] as const) {
        if (DPROTOCOL.patch.mass - arm.removedMass - arm.sweptMass + arm.regrownMass !== arm.occupiedFinal) problems.push(`${p} r${r.replicate} ${name}: mass identity broken`);
        if (arm.occupiedFinal + arm.residual !== DPROTOCOL.patch.mass) problems.push(`${p} r${r.replicate} ${name}: residual inconsistent`);
        for (const v of ["c4", "c8", "d4"] as const) {
          const a = arm[v], n0 = r.n0[v];
          if (!posRat(a.identity)) problems.push(`${p} r${r.replicate} ${name} ${v}: identityReturn undefined or not a rational in [0,1]`);
          if (a.roundCounts.length !== DPROTOCOL.rounds) problems.push(`${p} r${r.replicate} ${name} ${v}: round counts missing`);
          else {
            if (a.n2 !== a.roundCounts[a.roundCounts.length - 1]) problems.push(`${p} r${r.replicate} ${name} ${v}: n2 differs from the last round`);
            if (a.persistence !== persistent(a.roundCounts, n0)) problems.push(`${p} r${r.replicate} ${name} ${v}: persistence inconsistent with round counts`);
          }
          const want = identityReturn(n0, a.n1, a.n2);
          if (want === null || a.identity === null || want.num * a.identity.den !== a.identity.num * want.den) problems.push(`${p} r${r.replicate} ${name} ${v}: identityReturn inconsistent with n0, n1, n2`);
        }
      }
      if (hasStoreArm(p) && (!r.nostore || !posRat(r.nostore.identity))) problems.push(`${p} r${r.replicate}: nostore arm missing`);
      if (!hasStoreArm(p) && r.nostore) problems.push(`${p} r${r.replicate}: unexpected nostore arm`);
    }
  }
  return problems;
}

export interface Tables {
  base: { rows: number; classifiers: Classifiers };
  extended: { rows: number; classifiers: Classifiers };
  processes: ProcessTable[];
  scrambleGates: ScrambleGate[];
}

export function deriveTables(rows: readonly Row[]): Tables {
  const byProc = (p: ProcessId) => rows.filter((r) => r.process === p);
  const gates = (["hier", "crystal"] as const).map((k) => {
    // one process per kind carries the original patch; the originals are identical across processes of a kind
    const first = DPROTOCOL.processes.find((p) => rows.some((r) => r.process === p && r.kind === k));
    return scrambleGate(k, first ? rows.filter((r) => r.process === first) : []);
  });
  const limited = (kind: string) => gates.some((g) => g.kind === kind && !g.pass);
  const base = rows.filter((r) => (DPROTOCOL.baseProcesses as readonly string[]).includes(r.process));
  const processes: ProcessTable[] = DPROTOCOL.processes.map((p) => {
    const mine = byProc(p);
    const label = processLabel(mine, "c4"), labelC8 = processLabel(mine, "c8"), labelD4 = processLabel(mine, "d4");
    return {
      process: p, truth: isRecipeDependent(p) ? "recipe-dependent" : "not-recipe-dependent", label, labelC8, labelD4, segmentationDominated: label !== labelC8 || label !== labelD4,
      measurementLimited: mine.length > 0 && limited(mine[0].kind),
      c1Count: mine.filter((r) => c1(r)).length, c2Count: mine.filter((r) => c2(r)).length, c3Count: mine.filter((r) => c3(r)).length, replicates: mine.length,
    };
  });
  return {
    base: { rows: base.length, classifiers: accuracy(base) },
    extended: { rows: rows.length, classifiers: accuracy(rows) },
    processes, scrambleGates: gates,
  };
}
