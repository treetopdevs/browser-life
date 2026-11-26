// Tables and labels of the bootstrap screen from finished run files (docs/mycelium-bootstrap-2026-11-14/DESIGN.md sections 9 and 10), EXPLORATORY.
//
// Pure: no Deno, no file system. The runner loads <out>/runs/*.json and passes the rows in; vitest feeds hand-built rows. Every function says what it
// could not compute (a missing twin, a window without reads) instead of dropping the case: an unavailable input makes a vote unresolved or a label
// INCOMPLETE, never a silent negative.
import {
  aliveAndWindow, colWindow, intakesOf, joint, judge, labelD, labelF, labelT, need, noiseFloor, type ColSeries, type DInputs, type NoiseFloor, type Rels,
  relsOf, type Snap, telescopeProblem, vote, type Vote, type Verdict, windowSide, branchWindows, ratesOf, type LabelOut, half, atMost, labelO, noTollLabel, EFF_BAND,
} from "./observe-bootstrap.ts";
import { cpubRealisedVoid, meanEffFromHist, realisedCpubRatio } from "./observe-owner.ts";
import { armsOf, branchCheckpoints, lowDoseF, runConfig, type Sizing } from "./bootstrap-arms.ts";
import type { Heredity } from "./bootstrap-seeds.ts";

export interface BranchSideFile { snaps: Snap[]; ledgerBad: number; nEnd: number; ghostCorr?: number | null; error?: string }
export interface BranchFile { at: number; len: number; variants: Record<string, BranchSideFile> }
/** The stored run file (what the runner writes). Only the fields the analysis reads are typed. */
export interface RunFile {
  /** Planned branch checkpoints (written by the runner); older files fall back to the arm definition. */
  branchAt?: number[]; branchLen?: number; branchGrid?: number; branchErrors?: number; sizing?: string;
  id: string; series: string; armId: string; heredity: string; slot: number; worldSeed: number; steps: number; seconds?: number; smoke?: boolean;
  config: { eA: number; diffA: number; trailFreeLayer?: number; trailConduit?: number; trailConduitCap?: number; trailOwner?: string; ownerDefend?: number; ownerConduit?: number; [k: string]: unknown };
  ledgerChecks: number; ledgerBadChecks: number; minN: number;
  snaps: Snap[]; telescope: string | null;
  roadSeries: ColSeries | null; bootSeries: ColSeries;
  late: { runValues: Record<string, number | null>; r4: Record<string, number> | null; conduit: Record<string, number | null>; boot: Record<string, number | null>; owner?: Record<string, number | null> | null };
  early?: { runValues: Record<string, number | null> };
  conduitSeries?: { step: number[]; cols: Record<string, (number | null)[]> };
  /** Owner worlds made after the owner addendum: the owned-edge census series, the pooled late edge histograms and the strength the census used. */
  ownerSeries?: ColSeries | null; ownerHist?: { own: number[]; pub: number[]; edges: number; censuses: number } | null; ownerG?: number | null;
  branches: BranchFile[];
}

const med = (a: readonly number[]): number | null => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
export const fmt = (v: number | null | undefined, d = 3): string => (v === null || v === undefined || Number.isNaN(v) ? "-" : v.toFixed(d));
const pc = (v: number | null | undefined): string => (v === null || v === undefined ? "-" : `${(100 * v).toFixed(1)}%`);

export function indexRows(rows: readonly RunFile[]): Map<string, RunFile> { return new Map(rows.map((r) => [`${r.series}|${r.armId}|${r.heredity}|${r.slot}`, r])); }
export const slotsOfArm = (rows: readonly RunFile[], series: string, arm: string, h: string): number[] => rows.filter((r) => r.series === series && r.armId === arm && r.heredity === h).map((r) => r.slot).sort((a, b) => a - b);

// ---- one pair over one window --------------------------------------------------------------------------------------

export function pairRels(on: RunFile, comp: RunFile, lo: number, hi: number): Rels | null {
  const a = windowSide(on.snaps, lo, hi, on.config.eA), b = windowSide(comp.snaps, lo, hi, comp.config.eA);
  return a && b ? relsOf(a, b) : null;
}

export interface PairSet { slots: number[]; rels: (Rels | null)[]; nf: NoiseFloor | null; verdicts: (Verdict | null)[]; note: string[] }

/** on against off per slot over (lo, hi]; noise floor from the butterfly twins against their off runs (max over the slots that have all three). */
export function pairSet(on: Map<number, RunFile>, off: Map<number, RunFile>, bf: Map<number, RunFile> | null, lo: number, hi: number): PairSet {
  const slots = [...on.keys()].filter((s) => off.has(s)).sort((a, b) => a - b);
  const note: string[] = [];
  const rels = slots.map((s) => pairRels(on.get(s)!, off.get(s)!, lo, hi));
  const bfRels: Rels[] = [];
  if (bf) for (const s of slots) { const bb = bf.get(s); if (bb) { const r = pairRels(bb, off.get(s)!, lo, hi); if (r) bfRels.push(r); } }
  let nf: NoiseFloor | null = null;
  if (!bf) note.push("no butterfly twin: noise floor unavailable");
  else if (bfRels.length < slots.length) note.push(`butterfly twins available for ${bfRels.length} of ${slots.length} slots: noise floor unresolved`);
  // A missing or unreadable twin leaves the cohort's noise floor unresolved: a floor from the twins that happen to be readable could only be lower.
  if (bf && bfRels.length && bfRels.length === slots.length) nf = noiseFloor(bfRels);
  const verdicts = rels.map((r) => (r && nf ? judge(r, nf) : null));
  return { slots, rels, nf, verdicts, note };
}

/** A label needs a complete cohort: 8 slots, or 16 after the extension. */
export const cohortProblem = (n: number): string | null => (n === 8 || n === 16 ? null : `cohort of ${n} seeds (8, or 16 after the extension, are required)`);
const incomplete = (why: string[]): LabelOut => ({ label: "INCOMPLETE", note: `no label: ${why.join("; ")}` });

const passes = (v: (Verdict | null)[], k: "pay" | "damp" | "harm"): (boolean | null)[] => v.map((x) => (x ? x[k] : null));

// ---- series T ---------------------------------------------------------------------------------------------------------

/** Smoke rows (stand-in or smoke slots) sit in the same --out but are never part of a label: every arm of every analysis comes through here. */
const armMap = (rows: readonly RunFile[], series: string, arm: string, h = "inherit"): Map<number, RunFile> =>
  new Map(rows.filter((r) => !r.smoke && r.series === series && r.armId === arm && r.heredity === h).map((r) => [r.slot, r]));

/** The rows a label may rest on, and what was left out and why (printed by the runner). */
export function labelRows(rows: readonly RunFile[]): { rows: RunFile[]; notes: string[] } {
  const smoke = rows.filter((r) => r.smoke), bad = rows.filter((r) => !r.smoke && (r.ledgerBadChecks || r.branchErrors));
  const notes: string[] = [];
  if (smoke.length) notes.push(`${smoke.length} smoke rows left out of every label`);
  if (bad.length) notes.push(`${bad.length} runs carry ledger residuals or failed branch variants (${bad.map((r) => r.id).slice(0, 5).join(", ")}${bad.length > 5 ? ", ..." : ""}); those variants read as unresolved`);
  return { rows: rows.filter((r) => !r.smoke), notes };
}

function nIn(r: RunFile, lo: number, hi: number): number | null {
  const ns = r.snaps.filter((s) => s.step > lo && s.step <= hi).map((s) => s.n);
  return ns.length ? Math.min(...ns) : null;
}

export interface TReport {
  lines: string[];
  perStrength: Record<string, { pw: [number, number] | null; len: number; unreadable: boolean; payRows: Vote; dampRows: Vote; relI: (number | null)[]; thrI: number | null }>;
  inputs: import("./observe-bootstrap.ts").TInputs | null; label: LabelOut | null;
}

/** Everything the T series says, per the design: PAY and DAMP on the primary window of each strength, the label for P2, controls and mechanism. */
/** DESIGN 4.3: the diffA-matched twin is void when its diffA is further than this (relative) from the on-twin's realised mean Dd over PW. */
export const TWIN_VOID = 0.15;
export function analyzeT(rows: readonly RunFile[], sz: Sizing, d0Vote: Vote | null): TReport {
  const L: string[] = [];
  const t0 = sz.t0;
  const arms = (name: string) => ({ on: armMap(rows, "T", `${name}.on-P2`), off: armMap(rows, "T", `${name}.off`), bf: armMap(rows, "T", `${name}.bf`) });
  const rowsG = arms("rows-G"), carpetG = arms("carpet-G"), colsG = arms("cols-G"), carpetU = arms("carpet-U");
  const perStrength: TReport["perStrength"] = {};
  if (sz.provisional) L.push("WARNING: the sizing is PROVISIONAL (not measured): windows, strengths and the diffA twin are stand-ins. Smoke only.");
  L.push(`T windows: W1 (0,300], W2 (300,1000], W3 (1000,3000]; primary window PW(q) = (t0 = ${t0}, min(t_alive(q), 1000)] from the sizing step.\n`);
  L.push("| strength | PW | PW length | readable | PAY rows-G (votes Y/N/I) | DAMP | per-seed rel_i (on vs off) | thr_i |");
  L.push("|---|---|---|---|---|---|---|---|");
  const strengths: [string, 1 | 2 | 3][] = [["P1", 1], ["P2", 2], ["P3", 3], ["R", 1]];
  let p2: PairSet | null = null, p2Win: [number, number] | null = null, p2Readable = false;
  for (const [name, q] of strengths) {
    const w = aliveAndWindow(rowsG.off.size ? tAliveOf(sz, q) : [], q, t0);
    const on = armMap(rows, "T", `rows-G.on-${name}`);
    if (!w.pw) { perStrength[name] = { pw: null, len: w.len, unreadable: true, payRows: "I", dampRows: "I", relI: [], thrI: null }; L.push(`| ${name} | none | ${w.len} | UNREADABLE | - | - | - | - |`); continue; }
    const ps = pairSet(on, rowsG.off, rowsG.bf, w.pw[0], w.pw[1]);
    const guard = ps.slots.map((s) => { const a = nIn(on.get(s)!, w.pw![0], w.pw![1]), b = nIn(rowsG.off.get(s)!, w.pw![0], w.pw![1]); return a !== null && b !== null && a >= 100 && b >= 100; });
    const readable = !w.unreadable && guard.filter(Boolean).length >= ps.slots.length - Math.floor(0.25 * Math.max(1, ps.slots.length)) && ps.slots.length > 0;
    const payV = vote(passes(ps.verdicts, "pay").map((x, i) => (guard[i] ? x : null))), dampV = vote(passes(ps.verdicts, "damp"));
    perStrength[name] = { pw: w.pw, len: w.len, unreadable: !readable, payRows: payV, dampRows: dampV, relI: ps.rels.map((r) => r?.i ?? null), thrI: ps.nf?.i == null ? null : Math.max(0.03, 2 * ps.nf.i) };
    L.push(`| ${name} | (${w.pw[0]},${w.pw[1]}] | ${w.len} | ${readable ? "yes" : "UNREADABLE"} | ${payV} (${passes(ps.verdicts, "pay").filter((x) => x === true).length}Y ${passes(ps.verdicts, "pay").filter((x) => x === false).length}N ${passes(ps.verdicts, "pay").filter((x) => x === null).length}unres) | ${dampV} | ${ps.rels.map((r) => pc(r?.i)).join(" ")} | ${fmt(perStrength[name].thrI)} |`);
    if (name === "P2") { p2 = ps; p2Win = w.pw; p2Readable = readable; }
    for (const n of ps.note) L.push(`  (${name}: ${n})`);
  }
  if (!p2 || !p2Win) { L.push("\nP2 has no readable primary window: no T label can be issued."); return { lines: L, perStrength, inputs: null, label: null }; }
  const [lo, hi] = p2Win;
  // Carpet ceiling, cols (orthogonal), diffA-matched twin.
  const carpet = pairSet(carpetG.on, carpetG.off, carpetG.bf, lo, hi);
  const cols = pairSet(colsG.on, colsG.off, colsG.bf, lo, hi);
  const diffA = pairSet(armMap(rows, "T", "rows-G.diffA"), rowsG.off, rowsG.bf, lo, hi);
  const cU = pairSet(carpetU.on, carpetU.off, carpetU.bf, lo, hi);
  const payCarpet = vote(passes(carpet.verdicts, "pay"));
  // DESIGN 4.3 and 7: the twin's frozen diffA must match the realised mean Dd of the on-twin over PW (strength P2 = plateau q 2, meanDd2); beyond 15 percent
  // the twin is void and every vote that needs it is unresolved. Missing readings are unverified, which is void too, never a pass.
  const onP2 = armMap(rows, "T", "rows-G.on-P2"), twinRows = [...armMap(rows, "T", "rows-G.diffA").values()];
  const ddOn = med([...onP2.values()].map((r) => (r.roadSeries ? colWindow(r.roadSeries, lo, hi).meanDd2 : null)).filter((x): x is number => x !== null && x !== undefined));
  const twinA = med(twinRows.map((r) => r.config.diffA));
  const twinMismatch = ddOn === null || twinA === null || ddOn === 0 ? null : Math.abs(twinA - ddOn) / ddOn;
  const twinVoid = twinMismatch === null || twinMismatch > TWIN_VOID;
  const payDiffA = diffA.slots.length && !twinVoid ? vote(passes(diffA.verdicts, "pay")) : "I";
  // GRAD: per seed rel_i(rows) - rel_i(cols) at least max(3 percent, 2 nf_i(rows), 2 nf_i(cols)) and PAY for rows.
  const margin = Math.max(0.03, 2 * (p2.nf?.i ?? Infinity), 2 * (cols.nf?.i ?? Infinity));
  const gradSeeds = p2.slots.map((s, k) => {
    const j = cols.slots.indexOf(s);
    const a = p2!.rels[k]?.i, b = j < 0 ? null : cols.rels[j]?.i;
    if (a == null || b == null || !Number.isFinite(margin)) return null;
    const pay = p2!.verdicts[k]?.pay;
    return pay === null || pay === undefined ? null : pay && a - b >= margin;
  });
  const grad = vote(gradSeeds);
  // NET: lattice minus patches (the same margin rule, rows-G noise).
  const lat = pairSet(armMap(rows, "T", "lat-G.on-P2"), armMap(rows, "T", "lat-G.off"), null, lo, hi), pat = pairSet(armMap(rows, "T", "pat-G.on-P2"), armMap(rows, "T", "pat-G.off"), null, lo, hi);
  const netSeeds = lat.slots.map((s, k) => { const j = pat.slots.indexOf(s); const a = lat.rels[k]?.i, b = j < 0 ? null : pat.rels[j]?.i; return a == null || b == null || p2!.nf?.i == null ? null : a - b >= Math.max(0.03, 2 * p2!.nf.i); });
  const net = netSeeds.length ? vote(netSeeds) : "I";
  // MECH: median over seeds of the PW mean cross-column flux, positive and above cols'.
  const fl = (m: Map<number, RunFile>) => med([...m.values()].map((r) => (r.roadSeries ? colWindow(r.roadSeries, lo, hi).xflux : null)).filter((x): x is number => x !== null && x !== undefined));
  const fRows = fl(rowsG.on), fCols = fl(colsG.on);
  const mech = fRows !== null && fRows > 0 && fCols !== null && fRows > fCols;   // a missing cols flux does not satisfy "above cols'"
  // ROAD.
  const roadV = [...rowsG.on.keys()].map((s) => { const a = rowsG.on.get(s)!.roadSeries, b = rowsG.off.get(s)?.roadSeries; if (!a || !b) return null; return (colWindow(a, lo, hi).road ?? NaN) - (colWindow(b, lo, hi).road ?? NaN) >= 0.05; });
  const road = vote(roadV.map((x) => (x === false && roadV.some((y) => y === null) ? null : x)));
  // Anchor and null arms, descriptive.
  const phys = pairSet(armMap(rows, "T", "phys-rows-G.on-P2", "physarum"), armMap(rows, "T", "phys-rows-G.off", "physarum"), null, lo, hi);
  const inputs = {
    readable: p2Readable, payRows: perStrength.P2.payRows, payCarpet, dampRows: perStrength.P2.dampRows, grad, payDiffA, mech, payD0: d0Vote ?? "I",
  } satisfies import("./observe-bootstrap.ts").TInputs;
  const missing: string[] = [];
  // The cohort is every rows-G.on-P2 slot, before pairing: an extension with 16 on rows and 8 off rows is not a complete cohort of 8.
  const cp = cohortProblem(onP2.size); if (cp) missing.push(cp);
  if ([...onP2.keys()].some((s) => !rowsG.off.has(s))) missing.push(`rows-G off missing for some of the ${onP2.size} on slots`);
  const need8 = (name: string, m: Map<number, RunFile>) => { if (p2!.slots.some((s) => !m.has(s))) missing.push(`${name} missing for some of the ${p2!.slots.length} slots`); };
  need8("rows-G butterfly twin", rowsG.bf); need8("carpet-G on", carpetG.on); need8("carpet-G off", carpetG.off); need8("carpet-G butterfly twin", carpetG.bf);
  need8("cols-G on", colsG.on); need8("cols-G off", colsG.off); need8("cols-G butterfly twin", colsG.bf); need8("diffA-matched twin", armMap(rows, "T", "rows-G.diffA"));
  const label = missing.length ? incomplete(missing) : labelT(inputs);
  L.push("");
  L.push(`Controls over PW of P2 (${lo},${hi}]: carpet-G (ceiling) PAY ${payCarpet}; diffA-matched twin PAY ${payDiffA} (twin diffA ${fmt(twinA, 1)} against realised on-twin mean Dd ${fmt(ddOn, 1)}: mismatch ${twinMismatch === null ? "unmeasurable" : pc(twinMismatch)}${twinVoid ? ", TWIN VOID: unresolved" : ""}); GRAD ${grad} (margin ${fmt(margin)}); NET (lattice minus patches) ${net}; MECH ${mech ? "holds" : "fails"} (flux rows ${fmt(fRows)} / cols ${fmt(fCols)}); ROAD ${road}.`);
  L.push(`carpet-U (null arm, never mechanism): PAY ${vote(passes(cU.verdicts, "pay"))}. Physarum rows-G (frozen follower): PAY ${vote(passes(phys.verdicts, "pay"))}, DAMP ${vote(passes(phys.verdicts, "damp"))}.`);
  L.push(`V(PAY-D0) = ${d0Vote ?? "not run"}.`);
  L.push(`\n**T label (P2): ${label.label}**${label.note ? ` (${label.note})` : ""}`);
  return { lines: L, perStrength, inputs, label };
}

const tAliveOf = (sz: Sizing, q: 1 | 2 | 3): { step: number; xMed: number }[] => {
  // Reconstruct a monotone reads list whose last step with xMed >= q is the sized t_alive (the sizing step stores only that last step).
  const t = sz.tAlive[q];
  return [{ step: t, xMed: q }];
};

/** The D0 vote: PAY(on vs off) on (t0, t0 + 2000] over durable rows-G, noise from the D0 butterfly twins. */
export function analyzeD0(rows: readonly RunFile[], sz: Sizing): { vote: Vote; lines: string[] } {
  const on = armMap(rows, "D0", "rows-G.on-P2"), off = armMap(rows, "D0", "rows-G.off"), bf = armMap(rows, "D0", "rows-G.bf");
  if (!on.size || !off.size) return { vote: "I", lines: ["D0: not run"] };
  const lo = sz.t0, hi = sz.t0 + 2000;
  // A partial D0 never finalises a T NO-PAY (DESIGN 8: final only over the full cohort): fewer than 8 slots, or a missing off run or butterfly twin, is an
  // unresolved vote, and a single twin would shrink the noise floor (a max over fewer seeds) and make PAY easier.
  const slots = [...on.keys()].sort((a, b) => a - b), why: string[] = [];
  const cp = cohortProblem(slots.length); if (cp) why.push(cp);
  if (slots.some((s) => !off.has(s))) why.push("off run missing for some slots");
  if (slots.some((s) => !bf.has(s))) why.push("butterfly twin missing for some slots");
  if (why.length) return { vote: "I", lines: [`D0 INCOMPLETE (vote I, not final): ${why.join("; ")}`] };
  const ps = pairSet(on, off, bf, lo, hi);
  const v = vote(passes(ps.verdicts, "pay"));
  return { vote: v, lines: [`D0 (durable rows-G, window (${lo},${hi}]): PAY ${v} (per-seed rel_i ${ps.rels.map((r) => pc(r?.i)).join(" ")}, thr_i ${fmt(ps.nf?.i == null ? null : Math.max(0.03, 2 * ps.nf.i))})${ps.note.length ? " " + ps.note.join("; ") : ""}`] };
}

/** D refinement inputs: D1 (t0, 2000], D2 (2000, 10000], PERSIST at 5000, GRAD in D1, SELECT. */
export function analyzeD(rows: readonly RunFile[], sz: Sizing): { inputs: DInputs | null; label: LabelOut | null; lines: string[] } {
  const on = armMap(rows, "D", "rows-G.on-P2"), off = armMap(rows, "D", "rows-G.off"), bf = armMap(rows, "D", "rows-G.bf");
  if (!on.size) return { inputs: null, label: null, lines: ["D: not run"] };
  const d1 = pairSet(on, off, bf, sz.t0, 2000), d2 = pairSet(on, off, bf, 2000, 10000);
  const persist = [...on.keys()].map((s) => { const rs = on.get(s)!.roadSeries; if (!rs) return null; const at = rs.step.indexOf(5000); if (at < 0) return null; const x = rs.cols.xMed[at], g2 = rs.cols.xGe2[at]; return x === null || g2 === null ? null : x >= 2 && g2 >= 0.25; });
  // GRAD (DESIGN 9.2) compares rows with cols at the SAME strength. D carries cols only at the rising strength R, so the rows side is rows-G.on-R (not the
  // label strength P2: a P2-vs-R difference is a strength difference, not a gradient effect). D has no cols butterfly twin, so the cols noise floor does
  // not exist here and the margin is max(3 percent, 2 nf_i(rows)); the printed line says so.
  const rowsR = pairSet(armMap(rows, "D", "rows-G.on-R"), off, bf, sz.t0, 2000);
  const cols = pairSet(armMap(rows, "D", "cols-G.on-R"), armMap(rows, "D", "cols-G.off"), null, sz.t0, 2000);
  const gradSeeds = rowsR.slots.map((s, k) => { const j = cols.slots.indexOf(s); const a = rowsR.rels[k]?.i, b = j < 0 ? null : cols.rels[j]?.i; return a == null || b == null || rowsR.nf?.i == null ? null : a - b >= Math.max(0.03, 2 * rowsR.nf.i) && rowsR.verdicts[k]?.pay === true; });
  const base = armMap(rows, "D", "base-G"), offI = off;
  const dLate = (m: Map<number, RunFile>, s: number) => m.get(s)?.late.runValues.d ?? null;
  const tmLate = (m: Map<number, RunFile>, s: number) => m.get(s)?.late.runValues.TM ?? null;
  const slotsD = [...on.keys()].sort((x, y) => x - y);
  // SELECT (DESIGN 9.3): late deposit measure at least 1.2x the no-road durable world and 1.2x off, K (late trail per particle >= 0.1) in on but not in off or the
  // no-road world (on in at least 6 of 8, the others in at most 2), and no lift in the blocked arms. D's blocked arms exist only at the rising strength R, so
  // that last condition compares blocked on-R with blocked off: a proxy, printed as such; without blocked arms the vote is unresolved, never Y.
  const dOk = slotsD.map((s) => { const a = dLate(on, s), b = dLate(base, s), c = dLate(offI, s); return a === null || b === null || c === null ? null : a >= 1.2 * b && a >= 1.2 * c; });
  // K in on, but not in off or the no-road world: an unread on run is not K, an unread control counts as K (never helps SELECT).
  const kOn = slotsD.filter((s) => (tmLate(on, s) ?? 0) >= 0.1).length, kOff = slotsD.filter((s) => (tmLate(offI, s) ?? Infinity) >= 0.1).length, kBase = slotsD.filter((s) => (tmLate(base, s) ?? Infinity) >= 0.1).length;
  const kOk = kOn >= need(slotsD.length) && kOff <= atMost(slotsD.length) && kBase <= atMost(slotsD.length);
  const bOn = armMap(rows, "D", "rows-G.on-R", "blocked"), bOff = armMap(rows, "D", "rows-G.off", "blocked");
  // Every inherit slot needs its blocked on/off pair and both late deposit readings: one pair out of eight (or one lift-free pair among unread ones) is not a vote.
  const bComplete = slotsD.length > 0 && slotsD.every((s) => bOn.has(s) && bOff.has(s) && dLate(bOn, s) !== null && dLate(bOff, s) !== null);
  const blockedNoLift: boolean | null = bComplete ? slotsD.filter((s) => dLate(bOn, s)! / dLate(bOff, s)! < 1.2).length >= need(slotsD.length) : null;
  const sel = dOk.map((x) => (x === null || blockedNoLift === null ? null : x && kOk && blockedNoLift));
  const missD: string[] = []; const cpD = cohortProblem(slotsD.length); if (cpD) missD.push(cpD);
  for (const [name, m] of [["off", off], ["butterfly twin", bf], ["rows-G on-R", armMap(rows, "D", "rows-G.on-R")], ["cols-G on-R", armMap(rows, "D", "cols-G.on-R")], ["cols-G off", armMap(rows, "D", "cols-G.off")], ["blocked rows-G on-R", bOn], ["blocked rows-G off", bOff]] as const) if (slotsD.some((s) => !m.has(s))) missD.push(`${name} missing for some slots`);
  const inputs: DInputs = { payD1: vote(passes(d1.verdicts, "pay")), payD2: vote(passes(d2.verdicts, "pay")), persist: vote(persist), grad: vote(gradSeeds), select: vote(sel) };
  const label = missD.length ? incomplete(missD) : labelD(inputs);
  return { inputs, label, lines: [`D: PAY D1 ${inputs.payD1}, D2 ${inputs.payD2}, PERSIST ${inputs.persist}, GRAD(D1, rows R vs cols R, rows noise floor only) ${inputs.grad}, SELECT ${inputs.select} (K on/off/base ${kOn}/${kOff}/${kBase}; blocked no-lift ${blockedNoLift === null ? "unavailable" : blockedNoLift ? "yes" : "no"}, read at strength R) -> ${label.label}${label.note ? ` (${label.note})` : ""}`] };
}

// ---- branches (D, F, O; the 2,000-step "does it pay on existing trail" read) --------------------------------------------

export interface BranchPair { variant: string; whole: Verdict; last: Verdict; relWhole: Rels | null; relLast: Rels | null; nf: NoiseFloor | null }

/** DESIGN 8: a branch shorter than this many steps is not the "does it pay on existing trail" read; every pair of it is unresolved. */
export const MIN_BRANCH_LEN = 2000;
/** DESIGN 8 and 9: (a) and (a-damp) are read "at both checkpoints"; a run planned with fewer cannot pass them (it can still fail). */
export const MIN_CHECKPOINTS = 2;
/** DESIGN 4.3 and 6.1: above this correlation (real against displaced field) the ghost control is void for that run. */
export const GHOST_CORR_VOID = 0.5;
/** Why a displaced-read ghost variant is void (correlation missing, a constant field, or above 0.5); null when it is a valid control or not a ghost. */
export function ghostVoidReason(name: string, v: BranchSideFile | undefined): string | null {
  if (name !== "ghost" && name !== "oghost") return null;
  const c = v?.ghostCorr;
  if (c === undefined || c === null || Number.isNaN(c)) return "ghost control void: no correlation report (missing, or a constant field)";
  return c > GHOST_CORR_VOID ? `ghost control void: corr ${c.toFixed(2)} above ${GHOST_CORR_VOID}` : null;
}
/** The same test for a main-run ghost arm (F GHOST, O EC-ghost), from its stored late correlation. */
export const mainGhostVoid = (corr: number | null | undefined): boolean => corr === undefined || corr === null || Number.isNaN(corr) || corr > GHOST_CORR_VOID;

/** `on` against every other variant of a branch, on the whole branch and its last half; the noise floor is the maximum of |on-nullA|, |nullA-nullB|, |on-nullB|. */
export function branchPairs(b: BranchFile, eA: number): BranchPair[] {
  const w = branchWindows(b.len);
  const on = b.variants.on, out: BranchPair[] = [];
  if (!on) return out;
  // A variant whose ledger broke or that threw is not evidence: its side is missing, so every pair it enters is unresolved (never read as a result).
  const failed = (v: BranchSideFile | undefined): boolean => !!v && (v.ledgerBad > 0 || v.error !== undefined);
  const sideOf = (v: BranchSideFile | undefined, win: [number, number]) => (v && !failed(v) ? windowSide(v.snaps, win[0], win[1], eA) : null);
  const nfOf = (win: [number, number]): NoiseFloor | null => {
    const o = sideOf(on, win), a = sideOf(b.variants.nullA, win), c = sideOf(b.variants.nullB, win);
    if (!o || !a || !c) return null;
    return noiseFloor([relsOf(o, a), relsOf(a, c), relsOf(o, c)]);
  };
  for (const [name, v] of Object.entries(b.variants)) {
    if (name === "on" || name.startsWith("relax-")) continue;
    const verdict = (win: [number, number]): { v: Verdict; r: Rels | null; nf: NoiseFloor | null } => {
      const gv = ghostVoidReason(name, v);
      const why = b.len < MIN_BRANCH_LEN ? `branch of ${b.len} steps is under the ${MIN_BRANCH_LEN} the design requires` : gv;
      if (why) return { v: { pay: null, payStrong: null, damp: null, harm: null, thrI: null, unresolved: why }, r: null, nf: null };
      const o = sideOf(on, win), x = sideOf(v, win), nf = nfOf(win);
      if (!o || !x || !nf) return { v: { pay: null, payStrong: null, damp: null, harm: null, thrI: null, unresolved: [on, v, b.variants.nullA, b.variants.nullB].some(failed) ? "a variant had a ledger residual or failed" : "missing side or noise floor" }, r: null, nf };
      const r = relsOf(o, x);
      return { v: judge(r, nf), r, nf };
    };
    const a = verdict(w.whole), z = verdict(w.last);
    out.push({ variant: name, whole: a.v, last: z.v, relWhole: a.r, relLast: z.r, nf: a.nf });
  }
  return out;
}

/** The checkpoints a run was planned to branch at: what the runner stored, else the arm definition (null when neither is known). */
export function plannedAt(r: RunFile, sz: Sizing): number[] | null {
  if (r.branchAt) return r.branchAt;
  const a = armsOf(r.series, sz).find((x) => x.id === r.armId);
  return a ? branchCheckpoints(a.branch, r.steps, { noBranch: false, stepsGiven: r.steps !== a.steps }) : null;
}

/**
 * (a) for one run: PAY(on vs noconduit) and PAY(on vs ghost) at EVERY planned checkpoint, whole and last window. A planned checkpoint with no branch
 * (the run was extinct there, or was run with --no-branch) is unresolved, never silently dropped: false when any read fails, null when anything is
 * unresolved or missing, true only when every planned checkpoint passes.
 */
export function payOnTrail(r: RunFile, versus: readonly string[], planned: readonly number[] | null): boolean | null {
  if (!planned || !planned.length) return null;
  let unres = false;
  for (const at of planned) {
    const b = r.branches.find((x) => x.at === at);
    if (!b) { unres = true; continue; }
    const ps = branchPairs(b, r.config.eA);
    for (const v of versus) {
      const p = ps.find((x) => x.variant === v);
      if (!p) { unres = true; continue; }   // no comparator at this checkpoint: unresolved, not a failed comparison
      for (const x of [p.whole, p.last]) { if (x.pay === null) unres = true; else if (!x.pay) return false; }
    }
  }
  return unres || planned.length < MIN_CHECKPOINTS ? null : true;
}

/** DAMP or HARM of `on` against one variant at every planned checkpoint, whole and last window; null when a checkpoint or the comparator is missing or unresolved. */
export function flagOnTrail(r: RunFile, variant: string, flag: "damp" | "harm", planned: readonly number[] | null): boolean | null {
  if (!planned || !planned.length) return null;
  let unres = false;
  for (const at of planned) {
    const b = r.branches.find((x) => x.at === at);
    if (!b) { unres = true; continue; }
    const p = branchPairs(b, r.config.eA).find((x) => x.variant === variant);
    if (!p) { unres = true; continue; }
    for (const x of [p.whole, p.last]) { if (x[flag] === null) unres = true; else if (!x[flag]) return false; }
  }
  return unres || planned.length < MIN_CHECKPOINTS ? null : true;
}
/** (a-damp) for one run: DAMP(on vs noconduit) at every planned checkpoint, whole and last window; null when a checkpoint is missing or unresolved. */
export const dampOnTrail = (r: RunFile, planned: readonly number[] | null): boolean | null => flagOnTrail(r, "noconduit", "damp", planned);

export function branchTable(rows: readonly RunFile[]): string[] {
  const L: string[] = ["| run | checkpoint | variant | PAY (whole / last) | DAMP | HARM | rel i / N / d / b (whole) | thr_i | unresolved |", "|---|---|---|---|---|---|---|---|---|"];
  for (const r of [...rows].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    for (const b of r.branches) for (const p of branchPairs(b, r.config.eA)) {
      const y = (x: boolean | null) => (x === null ? "?" : x ? "Y" : "n");
      L.push(`| ${r.id} | ${b.at} | ${p.variant} | ${y(p.whole.pay)} / ${y(p.last.pay)} | ${y(p.whole.damp)} | ${y(p.whole.harm)} | ${pc(p.relWhole?.i)} / ${pc(p.relWhole?.N)} / ${pc(p.relWhole?.d)} / ${pc(p.relWhole?.b)} | ${fmt(p.whole.thrI)} | ${p.whole.unresolved ?? ""} |`);
    }
  }
  return L;
}

// ---- series F ---------------------------------------------------------------------------------------------------------

/**
 * K, S, NB, L, U of one treated run against its FREE-ONLY partner (same slot): K kept above the layer, S subsidy-only, NB no bite, L lost, U unread.
 * An extinct or unread run (a null trail reading) is U: it must not turn into 0 and read as "no bite".
 */
export function keptClass(treated: RunFile, freeOnly: RunFile): "K" | "S" | "NB" | "L" | "U" {
  const tAbove = treated.late.boot.tmAbove ?? null, tTot = treated.late.boot.tm ?? null, fAbove = freeOnly.late.boot.tmAbove ?? null, fTot = freeOnly.late.boot.tm ?? null;
  if (tAbove === null || tTot === null) return "U";
  if (tAbove >= 0.1) { if (fAbove === null) return "U"; if (fAbove <= tAbove / 2) return "K"; }
  if (tTot >= 0.1) return "S";
  if (fTot === null) return "U";
  return fTot < 0.1 ? "NB" : "L";
}

/** Share of the late (second-half) heavy censuses of a run in which both the layer and the non-layer groups reached the minimum size (impLayer and impNon defined); null without a conduit series. */
export function importCoverage(r: RunFile): number | null {
  const cs = r.conduitSeries; if (!cs || !cs.cols.impLayer || !cs.cols.impNon) return null;
  const lo = r.steps / 2; let all = 0, ok = 0;
  for (let i = 0; i < cs.step.length; i++) if (cs.step[i] > lo && cs.step[i] <= r.steps) { all++; if (cs.cols.impLayer[i] !== null && cs.cols.impNon[i] !== null) ok++; }
  return all ? ok / all : null;
}

export interface FReport { lines: string[]; label: LabelOut | null }
export function analyzeF(rows: readonly RunFile[], sz: Sizing): FReport {
  const F = sz.Fstar, T = `T-${F}-mid`, lowF = lowDoseF(F), L: string[] = [];
  const treated = armMap(rows, "F", T), free = armMap(rows, "F", `FREE-${F}`), blk = armMap(rows, "F", T, "blocked"), ghost = armMap(rows, "F", "GHOST"), diff = armMap(rows, "F", "DIFF");
  if (!treated.size) return { lines: ["F: not run"], label: null };
  const slots = [...treated.keys()].sort((a, b) => a - b);
  const miss: string[] = [];
  const cpF = cohortProblem(slots.length); if (cpF) miss.push(cpF);
  for (const [name, m] of [["FREE-ONLY", free], ["blocked partner", blk], ["GHOST", ghost], ["DIFF", diff]] as const) if (slots.some((s) => !m.has(s))) miss.push(`${name} missing for some slots`);
  if (miss.length) { const lb = incomplete(miss); return { lines: [`F (labelled at ${T}, ${slots.length} inherit slots): ${lb.note}`, `**F label (${T}): ${lb.label}**`], label: lb }; }
  const cls = slots.map((s) => keptClass(treated.get(s)!, free.get(s)!));
  L.push(`F (labelled at ${T}, ${slots.length} inherit slots): K classes per slot ${cls.join(" ")}`);
  const a = slots.map((s) => payOnTrail(treated.get(s)!, ["noconduit", "ghost"], plannedAt(treated.get(s)!, sz)));
  const aDampPairs = slots.map((s) => dampOnTrail(treated.get(s)!, plannedAt(treated.get(s)!, sz)));
  const cl = (s: number) => treated.get(s)!.late.conduit, tr = (s: number) => treated.get(s)!.late.r4!;
  // (b) also needs both groups at 20 or more particles in at least half the late heavy censuses; the window mean over the censuses that qualify says nothing about that.
  const bPred = slots.map((s) => { const c = cl(s); if (c.impLayer == null || c.impNon == null) return null; const cov = importCoverage(treated.get(s)!); if (cov === null || cov < 0.5) return null; return c.impLayer > 0 && c.impLayer > c.impNon; });
  // H (DESIGN 9.4 c): (i) occx - occxShift above the paired blocked run's by 0.25, or (ii) sensLevel or sensNut at least 0.005 and twice the blocked run's, or
  // (iii) acute above the blocked run's by half the physarum anchors' median acute. (iv) investment evidence never satisfies H and is not read here.
  // Any branch true gives true; with none true, an unreadable branch makes the seed unresolved; all readable and none true gives false.
  const physAcute = med([...armMap(rows, "F", `anchor-phys-${T}`, "physarum").values()].map((r) => r.late.r4?.acute).filter((x): x is number => x != null));
  const hPred = slots.map((s) => {
    const b = blk.get(s); if (!b) return null;
    const c = cl(s), cb = b.late.conduit;
    const i = c.occx == null || c.occxShift == null || cb.occx == null || cb.occxShift == null ? null : (c.occx - c.occxShift) - (cb.occx - cb.occxShift) > 0.25;
    const sens = (x: number | null | undefined, y: number | null | undefined) => (x == null || y == null ? null : x >= 0.005 && x >= 2 * y);
    const lv = sens(c.sensLevel, cb.sensLevel), nu = sens(c.sensNut, cb.sensNut);
    const ii = lv === true || nu === true ? true : lv === null && nu === null ? null : false;
    const ac = b.late.r4?.acute, on = treated.get(s)!.late.r4?.acute;
    // (iii) needs a positive anchor median: with 0 (R4 gives acute 0 when no particle qualifies) the threshold is 0 and equal treated and blocked would pass.
    const iii = ac == null || on == null || physAcute === null ? null : physAcute > 0 && on - ac >= 0.5 * physAcute;
    return [i, ii, iii].some((x) => x === true) ? true : [i, ii, iii].some((x) => x === null) ? null : false;
  });
  const gPred = slots.map((s) => { const b = blk.get(s); if (!b || !tr(s) || !b.late.r4) return null; return tr(s).speed >= 0.05 && tr(s).speed >= 0.5 * b.late.r4.speed; });
  const cPred = joint(hPred, gPred);
  const dPred = slots.map((s) => { const c = cl(s); return c.csat == null ? null : c.csat <= 0.5; });
  const fLed = slots.map((s) => {
    const r = treated.get(s)!, planned = plannedAt(r, sz); if (!planned || !planned.length) return null;
    let unres = false;
    for (const at of planned) {
      const b = r.branches.find((x) => x.at === at);
      if (!b) { unres = true; continue; }
      const ps = branchPairs(b, r.config.eA), nf = ps.find((x) => x.variant === "nofree"), nc = ps.find((x) => x.variant === "noconduit"); const rb = nf?.relWhole?.b, rc = nc?.relWhole?.b;
      if (rb == null || rc == null) { unres = true; continue; }
      if (!(rb >= 0.03 && rb >= rc)) return false;
    }
    return unres ? null : true;
  });
  // An unread control (null trail) counts as kept: a control that could not be read never helps its own predicate.
  const keptCtl = (r: RunFile) => (r.late.boot.tmAbove ?? Infinity) >= 0.1;
  // A GHOST arm whose displaced field correlates above 0.5 with the real one (or has no correlation report) is a void control: it counts as kept, never as a pass.
  // Counted over the treated slots only (every one has both controls, checked above): held or extension controls on other slots never dilute the limit.
  const ghostS = slots.map((s) => ghost.get(s)!), diffS = slots.map((s) => diff.get(s)!);
  const ghostK = ghostS.filter((r) => keptCtl(r) || mainGhostVoid(r.late.boot.ghostCorr)).length, diffK = diffS.filter(keptCtl).length;
  const f = slots.length > 0 && ghostK <= atMost(slots.length) && diffK <= atMost(slots.length);
  L.push(`(f) controls: GHOST kept ${ghostK}/${slots.length}, DIFF kept ${diffK}/${slots.length} -> ${f ? "holds" : "does not hold or arms missing"}`);
  // Anchors (DESIGN 9.4): the verdict needs the full anchor cohort, one physarum and one blind run per treated slot. A partial cohort is INCOMPLETE: need(1) = 1
  // would otherwise let a single finished pair read YES, the gate of KEPT-AND-PAYS.
  const anchorOf = (arm: string, h: string) => [...armMap(rows, "F", arm, h).entries()].sort((x, y) => x[0] - y[0]).map((x) => x[1]);
  const ap = anchorOf(`anchor-phys-${T}`, "physarum"), ab = anchorOf(`anchor-blind-${T}`, "blind");
  const ay = (rs: RunFile[]) => rs.filter((r) => payOnTrail(r, ["noconduit", "ghost"], plannedAt(r, sz)) === true).length;
  const adamp = (rs: RunFile[]) => rs.filter((r) => dampOnTrail(r, plannedAt(r, sz)) === true).length;
  const nA = slots.length;
  const anchorFull = ap.length === nA && ab.length === nA && ap.every((r) => slots.includes(r.slot)) && ab.every((r) => slots.includes(r.slot));
  const anchor: "YES" | "NO-DAMPS" | "MIXED" | "INCOMPLETE" = !anchorFull ? "INCOMPLETE" : ay(ap) >= need(nA) && ay(ab) >= need(nA) ? "YES" : adamp(ap) >= need(nA) && adamp(ab) >= need(nA) ? "NO-DAMPS" : "MIXED";
  L.push(`anchor verdict ${anchor} (phys ${ay(ap)}/${ap.length} pay, ${adamp(ap)} damp; blind ${ay(ab)}/${ab.length} pay, ${adamp(ab)} damp; ${nA} treated slots)`);
  // (e) dose: every dose arm must exist for every slot, and the trail is compared above ONE ceiling (F*): tmAboveStar. TMabove at each arm's own ceiling is not
  // comparable (trail above 4 is at least trail above 16 for any trail distribution, which biases T-low <= T-F* toward false).
  const doseArms = [`FREE-${lowF}`, `T-${lowF}-mid`, `T-${F}-lo`, `T-${F}-hi`];
  const extras = doseArms.every((nm) => armMap(rows, "F", nm).size === slots.length && slots.every((s) => armMap(rows, "F", nm).has(s)));
  const mTm = (arm: string) => med([...armMap(rows, "F", arm).values()].map((r) => r.late.boot.tmAboveStar).filter((x): x is number => x != null));
  const le = (x: number | null, y: number | null, k = 1) => x !== null && y !== null && x <= k * y;
  const mid = mTm(T);
  const e = extras && le(mTm(`T-${lowF}-mid`), mid) && le(mTm(`T-${F}-lo`), mid) && mid !== null && mTm(`T-${F}-hi`) !== null && mTm(`T-${F}-hi`)! >= 0.8 * mid;
  const nTrue = (x: (boolean | null)[]) => x.filter((y) => y === true).length;
  L.push(`(b) import: layers above non-layers with both groups at the minimum size in at least half the late heavy censuses, in ${nTrue(bPred)}/${nA}`);
  L.push(`(c) behaviour: H (occx, sens or acute branch) in ${nTrue(hPred)}/${nA}, G (movement guard) in ${nTrue(gPred)}/${nA}; (e) dose ${e ? "holds" : extras ? "does not hold" : "not evaluated: dose arms missing"} (low dose F = ${lowF}, trail above F* = ${F})`);
  const H = hPred, G = gPred;
  const label = labelF({ n: slots.length, cls, a, aDamp: aDampPairs, b: bPred, c: cPred, d: dPred, H, G, fLed, e, f, anchor, extras });
  L.push(`**F label (${T}): ${label.label}**${label.note ? ` (${label.note})` : ""}`);
  void half;
  return { lines: L, label };
}

// ---- series O (owner addendum: docs/mycelium-bootstrap-owner-2026-11-15/DESIGN.md sections 3 and 4) -----------------------------

/** The O extras a K = Y label needs (dose arms, low mutation, the "id" pair, blocked-id, no-toll), as [arm, heredity]. */
export const O_EXTRA_ARMS: readonly (readonly [string, string])[] = [
  ["T-EC-thLo", "inherit"], ["T-EC-thHi", "inherit"], ["T-EC-gLo", "inherit"], ["T-EC-gHi", "inherit"], ["T-EC-lowmut", "inherit"], ["T-EC-id", "inherit"],
  ["blk-id-T-P", "blocked"], ["blk-id-T-EC", "blocked"], ["N-P", "inherit"], ["N-E", "inherit"], ["N-EC", "inherit"],
];
/** CONDUIT-IDLE: a T-EC slot operates when at least this share of the directed edges out of occupied cells has a positive owner extra rate (late window). */
export const LIVE_MIN = 0.25;
const K_MIN = 0.1;

/** K of an owner arm against the same slot's passive run: late trail per particle at least 0.1 and at least half the passive arm's. null = unread (extinct or missing). */
export function keptO(r: RunFile | undefined, passive: RunFile | undefined): boolean | null {
  // A run that went extinct at any read is unread: its window mean keeps the trail of the censuses before the extinction (colWindow drops the nulls).
  const dead = (x: RunFile | undefined) => !x || x.minN === 0;
  const tm = dead(r) ? null : r!.late.boot.tm ?? null, pt = dead(passive) ? null : passive!.late.boot.tm ?? null;
  if (tm === null) return null;
  if (tm < K_MIN) return false;
  return pt === null ? null : tm >= 0.5 * pt;
}

/** Share of a run's late heavy censuses in which both the layer and non-layer groups reached the minimum size on the owner census; null without one. */
export function ownerImportCoverage(r: RunFile): number | null {
  const cs = r.ownerSeries; if (!cs || !cs.cols.impLayer || !cs.cols.impNon) return null;
  const lo = r.steps / 2; let all = 0, ok = 0;
  for (let i = 0; i < cs.step.length; i++) if (cs.step[i] > lo && cs.step[i] <= r.steps) { all++; if (cs.cols.impLayer[i] !== null && cs.cols.impNon[i] !== null) ok++; }
  return all ? ok / all : null;
}

export interface OReport { lines: string[]; label: LabelOut | null; qualifiers: string[] }
export function analyzeO(rows: readonly RunFile[], sz: Sizing): OReport {
  const L: string[] = [], Q: string[] = [];
  // Only rows made at this sizing's strengths enter: a file whose config differs from its arm's definition (an old stand-in run) is left out, as if not run.
  // Equality is of the whole config (Sol round 2): the file's config must be exactly what the arm, heredity and seed build, so no unregistered key rides along.
  const defs = new Map(armsOf("O", sz).map((a) => [a.id, a]));
  const canon = (c: unknown): string => JSON.stringify(Object.entries(JSON.parse(JSON.stringify(c)) as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  const sized = (r: RunFile): boolean => {
    const def = defs.get(r.armId); if (!def) return false;
    return canon(r.config) === canon(runConfig(def.over, def.light, r.heredity as Heredity, r.worldSeed));
  };
  const A = (arm: string, h = "inherit") => new Map([...armMap(rows, "O", arm, h)].filter(([, r]) => sized(r)));
  const unsized = rows.filter((r) => !r.smoke && r.series === "O" && !sized(r)).length;
  if (armMap(rows, "O", "T-EC").size && !A("T-EC").size) { const lb = incomplete(["T-EC was not run at the sized theta and gOwner (stand-in files)"]); return { lines: [`O: ${lb.note}`, `**O label (T-EC): ${lb.label}**`], label: lb, qualifiers: [] }; }
  const ec = A("T-EC"), pas = A("T-P"), eArm = A("T-E"), cpub = A("T-C-pub"), ghost = A("T-EC-ghost"), tbase = A("T-base");
  if (!ec.size) return { lines: ["O: not run"], label: null, qualifiers: [] };
  const slots = [...ec.keys()].sort((a, b) => a - b), n = slots.length;
  const fail = (why: string[]): OReport => { const lb = incomplete(why); return { lines: [`O (labelled at T-EC, ${n} inherit slots): ${lb.note}`, `**O label (T-EC): ${lb.label}**`], label: lb, qualifiers: [] }; };
  if (sz.ownerStopRule) { const lb = labelO({ n, e: [], kEC: [], kE: [], payECvsCoff: "I", payAll: "I", harmOrDamp: false, b: [], c: [], d: [], H: [], G: [], f: false, g: false, payCpub: "I", stopRule: true, extras: false }); return { lines: [`**O label (T-EC): ${lb.label}** (${lb.note})`], label: lb, qualifiers: [] }; }
  const unmeasured = ["theta", "gOwner", "gCpub"].filter((k) => !sz.measured.includes(k));
  if (unmeasured.length) return fail([`the sizing did not measure ${unmeasured.join(", ")} (stand-in strengths)`]);
  if (slots.some((s) => !ec.get(s)!.late.owner || !ec.get(s)!.ownerHist)) return fail(["the T-EC run files carry no owned-edge readouts (made before the owner addendum)"]);
  const miss: string[] = [];
  const cp = cohortProblem(n); if (cp) miss.push(cp);
  if (unsized) L.push(`NOTE: ${unsized} O rows are not at this sizing's strengths and were left out`);
  for (const [name, m] of [["T-P", pas], ["T-E", eArm], ["T-C-pub", cpub], ["T-EC-ghost", ghost]] as const) if (slots.some((s) => !m.has(s))) miss.push(`${name} missing for some slots`);
  if (miss.length) return fail(miss);
  const E = (s: number) => ec.get(s)!, own = (s: number) => E(s).late.owner!;
  const nT = (x: (boolean | null)[]) => x.filter((y) => y === true).length;
  const cnt = (x: (boolean | null)[]) => `${nT(x)}/${n}${x.some((y) => y === null) ? ` (${x.filter((y) => y === null).length} unread)` : ""}`;
  const medOf = (xs: (number | null | undefined)[]) => med(xs.filter((x): x is number => x != null));

  // K and territory sanity.
  const kEC = slots.map((s) => keptO(E(s), pas.get(s))), kE = slots.map((s) => keptO(eArm.get(s), pas.get(s))), kCpub = slots.map((s) => keptO(cpub.get(s), pas.get(s)));
  const ePred = slots.map((s) => {
    const nE = E(s).late.runValues.meanN, nP = pas.get(s)!.late.runValues.meanN, o = E(s).late.boot.own, op = E(s).late.boot.open;
    if (nE == null || nP == null) return null;
    if (nE < 0.5 * nP) return false;
    return o == null || op == null ? null : o + op >= 0.5;
  });
  L.push(`O (labelled at T-EC, theta ${sz.theta.mid}, owner g ${sz.gOwner.mid}, public g' ${sz.gCpub}; ${n} inherit slots)`);
  L.push(`K (trail kept, at least half the passive arm's): T-EC ${cnt(kEC)}, T-E ${cnt(kE)}, T-C-pub ${cnt(kCpub)}; (e) territory sanity ${cnt(ePred)}`);

  // Qualifiers (never change the label).
  const pasKept = slots.map((s) => { const t = pas.get(s)!.late.boot.tm; return t == null ? null : t >= K_MIN; });
  if (nT(pasKept) >= need(n)) Q.push(`TOLL-HELD: the passive arm keeps trail in ${nT(pasKept)}/${n} slots, so a "kept" is most likely the toll's doing; T-E and T-C-pub are then expected to be kept too, which fails (g)`);
  const live = slots.map((s) => { const v = own(s).live; return v == null ? null : v >= LIVE_MIN; });
  if (nT(live) < need(n)) Q.push(`CONDUIT-IDLE: the owner conduit has a positive extra rate on at least ${LIVE_MIN} of occupied-cell edges in only ${nT(live)}/${n} slots; in the others a PAY of N is not evidence about a working conduit`);
  const effMed = medOf(slots.map((s) => own(s).effP50));
  const inBand = effMed !== null && effMed >= EFF_BAND[0] && effMed <= EFF_BAND[1];
  if (!inBand) Q.push(`OUT-OF-BAND: median late owner extra rate on occupied-cell edges is ${fmt(effMed, 1)} (band ${EFF_BAND[0]} to ${EFF_BAND[1]})`);
  L.push(`operating: live share (median) ${fmt(medOf(slots.map((s) => own(s).live)))}, same-owner share of occupied-cell edges ${fmt(medOf(slots.map((s) => own(s).sameOcc)))}, median extra rate ${fmt(effMed, 1)}, same-owner x p50 ${fmt(medOf(slots.map((s) => own(s).xP50)), 1)}, csat ${fmt(medOf(slots.map((s) => own(s).csat)))}`);

  // PAY votes over the branches.
  const pay = (vs: readonly string[]) => slots.map((s) => payOnTrail(E(s), vs, plannedAt(E(s), sz)));
  const pCoff = pay(["coff"]), pEoff = pay(["eoff"]), pBoth = pay(["both"]), pGhost = pay(["oghost"]), pAll = pay(["coff", "eoff", "both", "oghost"]), pCpub = pay(["cpub"]);
  const hd = slots.map((s) => {
    const pl = plannedAt(E(s), sz);
    const fl = [flagOnTrail(E(s), "coff", "damp", pl), ...["coff", "eoff", "both", "oghost"].map((v) => flagOnTrail(E(s), v, "harm", pl))];
    return fl.some((x) => x === true) ? true : fl.some((x) => x === null) ? null : false;
  });
  const harmOrDamp = nT(hd) >= half(n);
  const opAll = slots.map((_, j) => (live[j] === true ? pAll[j] : null)).filter((_, j) => live[j] === true), opCoff = slots.map((_, j) => pCoff[j]).filter((_, j) => live[j] === true);
  L.push(`PAY at both checkpoints (whole and last 1,000): vs conduit off ${cnt(pCoff)}, vs enclosure off ${cnt(pEoff)}, vs both off ${cnt(pBoth)}, vs owner ghost ${cnt(pGhost)}; PAYALL ${cnt(pAll)}; vs public conduit ${cnt(pCpub)}; DAMP or HARM ${cnt(hd)}`);
  L.push(`among the ${opAll.length} operating slots (report only): PAY vs conduit off ${nT(opCoff)}/${opCoff.length}, PAYALL ${nT(opAll)}/${opAll.length}`);

  // (b), (d) on the owner census; (c) within "id".
  const bPred = slots.map((s) => { const c = own(s); if (c.impLayer == null || c.impNon == null) return null; const cov = ownerImportCoverage(E(s)); if (cov === null || cov < 0.5) return null; return c.impLayer > 0 && c.impLayer > c.impNon; });
  const dPred = slots.map((s) => { const c = own(s).csat; return c == null ? null : c <= 0.5; });
  const idEC = A("T-EC-id"), blkEC = A("blk-id-T-EC", "blocked");
  // The acute branch needs the whole physarum anchor cohort (one read anchor per slot): a partial cohort's median is not the threshold.
  const physRuns = slots.map((s) => A("anchor-phys-EC", "physarum").get(s)?.late.r4?.acute);
  const physAcute = physRuns.every((x) => x != null) ? med(physRuns as number[]) : null;
  const hPred = slots.map((s) => {
    const t = idEC.get(s), b = blkEC.get(s); if (!t || !b || !t.late.owner || !b.late.owner) return null;
    const c = t.late.owner, cb = b.late.owner, lc = t.late.conduit, lb = b.late.conduit;
    const i = c.occx == null || c.occxShift == null || cb.occx == null || cb.occxShift == null ? null : (c.occx - c.occxShift) - (cb.occx - cb.occxShift) > 0.25;
    const sens = (x: number | null | undefined, y: number | null | undefined) => (x == null || y == null ? null : x >= 0.005 && x >= 2 * y);
    const lv = sens(lc.sensLevel, lb.sensLevel), nu = sens(lc.sensNut, lb.sensNut);
    const ii = lv === true || nu === true ? true : lv === null && nu === null ? null : false;
    const ac = b.late.r4?.acute, on = t.late.r4?.acute;
    const iii = ac == null || on == null || physAcute === null ? null : physAcute > 0 && on - ac >= 0.5 * physAcute;
    return [i, ii, iii].some((x) => x === true) ? true : [i, ii, iii].some((x) => x === null) ? null : false;
  });
  const gPred = slots.map((s) => { const t = idEC.get(s)?.late.r4, b = blkEC.get(s)?.late.r4; if (!t || !b) return null; return t.speed >= 0.05 && t.speed >= 0.5 * b.speed; });
  const cPred = joint(hPred, gPred);
  L.push(`(b) import, layers above non-layers on the owner rate ${cnt(bPred)}; (c) behaviour, read within "id" (T-EC-id against blocked-id): H ${cnt(hPred)}, G ${cnt(gPred)}; (d) csat at most 0.5 ${cnt(dPred)}`);
  L.push(`owner import (report only): OWN ${fmt(medOf(slots.map((s) => own(s).impOwn)), 4)}, not OWN ${fmt(medOf(slots.map((s) => own(s).impOther)), 4)}, all ${fmt(medOf(slots.map((s) => own(s).impAll)), 4)} per particle (median over slots)`);

  // Extras and (f) dose.
  const extras = O_EXTRA_ARMS.every(([arm, h]) => slots.every((s) => A(arm, h).has(s)));
  // A dose median needs every slot read and alive: an arm with unread slots gives no median (and (f) does not hold).
  const mTm = (arm: string) => { const m = A(arm); const v = slots.map((s) => (m.get(s) && m.get(s)!.minN > 0 ? m.get(s)!.late.boot.tm : null)); return v.every((x) => x != null) ? med(v as number[]) : null; };
  const mid = mTm("T-EC"), le = (x: number | null) => x !== null && mid !== null && x <= mid, near = (x: number | null) => x !== null && mid !== null && Math.abs(x - mid) <= 0.2 * mid;
  // (f) is unread (null), not failed, when a dose median is missing: the label then cannot rest a negative on it.
  const doseM = ["T-EC-thLo", "T-EC-gLo", "T-EC-thHi", "T-EC-gHi"].map(mTm);
  const f: boolean | null = !extras || mid === null || doseM.some((x) => x === null) ? null : le(doseM[0]) && le(doseM[1]) && near(doseM[2]) && near(doseM[3]);
  L.push(`(f) dose, median late trail per particle: thLo ${fmt(doseM[0], 1)}, gLo ${fmt(doseM[1], 1)}, mid ${fmt(mid, 1)}, thHi ${fmt(doseM[2], 1)}, gHi ${fmt(doseM[3], 1)} -> ${extras ? (f === null ? "unread (a dose arm with an unread slot gives no median)" : f ? "holds" : "does not hold") : "not evaluated: extras missing"}`);
  for (const arm of ["T-EC-gLo", "T-EC-gHi"]) {
    const rs = slots.map((s) => A(arm).get(s)).filter((r): r is RunFile => !!r && r.branches.length > 0);
    if (rs.length) L.push(`PAY by dose (report only), ${arm} (g ${rs[0].config.ownerConduit}): vs conduit off ${rs.filter((r) => payOnTrail(r, ["coff"], plannedAt(r, sz)) === true).length}/${rs.length}, PAYALL ${rs.filter((r) => payOnTrail(r, ["coff", "eoff", "both", "oghost"], plannedAt(r, sz)) === true).length}/${rs.length}, live share ${fmt(medOf(rs.map((r) => r.late.owner?.live)))}, eff p50 ${fmt(medOf(rs.map((r) => r.late.owner?.effP50)), 1)}, csat ${fmt(medOf(rs.map((r) => r.late.owner?.csat)))}`);
  }

  // (g) the matched public conduit: void (sizing or realised) fails it; otherwise it must keep in at most a quarter of the slots.
  const ratios = slots.map((s) => {
    const c = cpub.get(s)!, e = E(s);
    if (!c.ownerHist || !e.ownerHist || c.config.trailConduit === undefined || e.config.ownerConduit === undefined) return null;
    return realisedCpubRatio(meanEffFromHist(c.ownerHist.pub, c.ownerHist.edges, c.config.trailConduit, c.config.diffA), meanEffFromHist(e.ownerHist.own, e.ownerHist.edges, e.config.ownerConduit, e.config.diffA));
  });
  const cpubVoid = !!sz.cpubVoid || cpubRealisedVoid(ratios);
  const cpubKept = kCpub.filter((x) => x !== false).length;   // an unread control counts as kept: it never helps its own predicate
  const g = !cpubVoid && cpubKept <= atMost(n);
  L.push(`(g) public conduit at matched mean extra rate: realised ratio public/owner (median over slots) ${fmt(medOf(ratios))}${cpubVoid ? " VOID" : ""}; kept ${cpubKept}/${n} -> ${g ? "holds" : "does not hold"}`);

  // Report-only rows.
  const same = slots.filter((s) => tbase.has(s) && JSON.stringify(tbase.get(s)!.snaps) === JSON.stringify(pas.get(s)!.snaps)).length;
  L.push(`passive planes: T-P equals T-base (identical totals at every read) in ${same}/${slots.filter((s) => tbase.has(s)).length} slots`);
  const ghostK = slots.map((s) => keptO(ghost.get(s), pas.get(s))), ghostVoid = slots.filter((s) => mainGhostVoid(ghost.get(s)!.late.boot.ownerGhostCorr)).length;
  L.push(`T-EC-ghost (main arm; its owner census reads the real map, not the displaced one the rule used): kept ${cnt(ghostK)}, void by correlation in ${ghostVoid}/${n}`);
  const rowOf = (arm: string, h = "inherit") => { const m = A(arm, h); if (!m.size) return null; const rs = [...m.values()]; return `${arm}${h === "inherit" ? "" : ` (${h})`}: n ${fmt(medOf(rs.map((r) => r.late.runValues.meanN)), 0)}, trail ${fmt(medOf(rs.map((r) => r.late.boot.tm)), 1)}, same-owner ${fmt(medOf(rs.map((r) => r.late.boot.sameEdge)))}, live ${fmt(medOf(rs.map((r) => r.late.owner?.live)))}, eff p50 ${fmt(medOf(rs.map((r) => r.late.owner?.effP50)), 1)} (${rs.length} runs)`; };
  const armRows = [["T-base"], ["N-base"], ["T-P"], ["T-E"], ["T-C"], ["T-C-pas"], ["T-EC"], ["T-EC-ghost"], ["T-C-pub"], ...O_EXTRA_ARMS].map(([a, h]) => rowOf(a, h ?? "inherit")).filter((x): x is string => x !== null);
  L.push("arm medians (late window): " + armRows.join("; "));
  const cpas = A("T-C-pas"), cArm = A("T-C");
  if (cpas.size) L.push(`conduit only at the passive-sized strength (T-C-pas, g ${sz.gPassive}; report only): kept ${[...cpas.keys()].filter((s) => keptO(cpas.get(s), pas.get(s)) === true).length}/${cpas.size}, T-C at gOwner.mid kept ${[...cArm.keys()].filter((s) => keptO(cArm.get(s), pas.get(s)) === true).length}/${cArm.size}`);
  for (const [arm, h] of [["anchor-phys-EC", "physarum"], ["anchor-blind-EC", "blind"]] as const) {
    const rs = [...A(arm, h).values()]; if (!rs.length) { L.push(`${arm}: not run`); continue; }
    const k = need(rs.length), c = (p: (r: RunFile) => boolean | null) => rs.filter((r) => p(r) === true).length;
    const pays = c((r) => payOnTrail(r, ["both", "coff"], plannedAt(r, sz))), damps = c((r) => flagOnTrail(r, "coff", "damp", plannedAt(r, sz))), harms = c((r) => flagOnTrail(r, "coff", "harm", plannedAt(r, sz)));
    L.push(`${arm}: ${pays >= k ? "ANCHOR-PAYS" : damps >= k ? "ANCHOR-DAMPS" : harms >= k ? "ANCHOR-HARMS" : "ANCHOR-FLAT"} (pay ${pays}, damp ${damps}, harm ${harms} of ${rs.length})`);
  }
  const nEC = A("N-EC"), nE = A("N-E");
  if (nEC.size) {
    const kN = slots.map((s) => { const t = nEC.get(s)?.late.boot.tm; return t != null && t >= K_MIN; });
    L.push(`no-toll substrate: ${noTollLabel(kN, slots.every((s) => nE.get(s)?.late.boot.tm != null))} (N-EC keeps trail in ${kN.filter(Boolean).length}/${n})`);
  }

  const label = labelO({ n, e: ePred, kEC, kE, payECvsCoff: vote(pCoff), payAll: vote(pAll), payAllS: pAll, harmOrDamp, b: bPred, c: cPred, d: dPred, H: hPred, G: gPred, f, g, payCpub: vote(pCpub), stopRule: false, extras });
  for (const q of Q) L.push(`qualifier ${q}`);
  L.push(`**O label (T-EC): ${label.label}**${label.note ? ` (${label.note})` : ""}${Q.length ? ` [${Q.map((q) => q.split(":")[0]).join(", ")}]` : ""}`);
  return { lines: L, label, qualifiers: Q.map((q) => q.split(":")[0]) };
}

// ---- tables -----------------------------------------------------------------------------------------------------------

export function runTable(rows: readonly RunFile[]): string[] {
  const L = ["| run | world seed | steps | n late | births / d late (per 1000 particle-steps) | TM late | TM above F | free / paid per particle-step | intake per particle-step | ledger | smoke |", "|---|---|---|---|---|---|---|---|---|---|---|"];
  for (const r of [...rows].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const w = windowSide(r.snaps, Math.floor(r.steps / 2), r.steps, r.config.eA);
    const q = w ? ratesOf(w) : null;
    L.push(`| ${r.id} | ${r.worldSeed} | ${r.steps} | ${fmt(r.late.runValues.meanN, 0)} | ${q ? `${fmt(1000 * q.b, 3)} / ${fmt(1000 * q.d, 3)}` : "-"} | ${fmt(r.late.runValues.TM)} | ${fmt(r.late.boot.tmAbove)} | ${q && q.free !== null ? `${fmt(q.free, 4)} / ${fmt(q.paid, 4)}` : "-"} | ${q ? fmt(q.i, 4) : "-"} | ${r.ledgerChecks - r.ledgerBadChecks}/${r.ledgerChecks} exact${r.telescope ? `; TELESCOPE ${r.telescope}` : ""} | ${r.smoke ? "smoke" : ""} |`);
  }
  return L;
}

/** The intake identity restated per run (sum of per-read intakes equals the telescoped value): lines that name any run where it fails. */
export function identityProblems(rows: readonly RunFile[]): string[] {
  const bad: string[] = [];
  for (const r of rows) { const p = telescopeProblem(r.snaps, r.config.eA); if (p) bad.push(`${r.id}: ${p}`); if (r.telescope) bad.push(`${r.id}: runner recorded ${r.telescope}`); void intakesOf; }
  return bad;
}
