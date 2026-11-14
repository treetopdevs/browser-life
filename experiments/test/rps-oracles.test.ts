// Differential tests: the readout against independent implementations of the rule text (conformance review, summary). Each oracle below
// was written from the sentences of runs/rps/rule-draft.md (sections 0, 2.3 to 2.6, 4.3, 4.4, 4.6 and G0.2) and not from the readout's
// code; the real functions are compared with it over seeded random inputs that reach every row of the table in question, so that a
// threshold one count off, or a row tried in the wrong order, shows up as a mismatch somewhere. Deterministic (a fixed generator),
// nothing is read from or written to disk, and nothing here is a result.

import { describe, expect, it } from "vitest";
import { analyzeRun } from "../3d-rps/readout-jobs.ts";
import { gridRule } from "../3d-rps/readout-gate0.ts";
import { edgePairs, spreadStar, sweepOutcome, type SweepSpread } from "../3d-rps/readout-kernel.ts";
import { LAT_M, analyzePair, evaluateLattice, type LatticeCell } from "../3d-rps/readout-lattice.ts";
import { NCELLS, mkJob, type RowSpec } from "./rps-fixtures.ts";

/** A small linear congruential generator, so that the cases are the same on every machine. */
function generator(seed: number) {
  let s = seed >>> 0;
  const rnd = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
  const ri = (n: number) => Math.floor(rnd() * n);
  const pick = <T>(a: readonly T[]): T => a[ri(a.length)];
  const gauss = () => {
    let t = 0;
    for (let i = 0; i < 6; i++) t += rnd();
    return (t - 3) / 0.7071;
  };
  return { rnd, ri, pick, gauss };
}

// ---------------------------------------------------------------------------------------------------------------------
// Section 0: the run classes, T_cx, chi_fw and chi_all
// ---------------------------------------------------------------------------------------------------------------------

interface R {
  liv: number;
  coexist: boolean;
  /** The turnover of the census in thousandths: an integer, so that the oracle's mean is exact (final review, finding 3). */
  pm: number;
  ndom: number;
  nanti: number;
}
const LOST = [1, 1, 0, 0, 0, 0, 0, 0];

/** chi over a set of censuses: (dom - anti) / (dom + anti), and 0 when fewer than 200 changes fall in the set. */
function chi(rows: R[]): number {
  let d = 0;
  let a = 0;
  for (const r of rows) {
    d += r.ndom;
    a += r.nanti;
  }
  return d + a < 200 ? 0 : (d - a) / (d + a);
}

/** Section 0, from the sentences: the class table, T_cx, the final window and the two chirality sets. */
function oracle0(burn: R[], run: R[]): { cls: string; tcx: number | "CENSORED" | null; chiFw: number; chiAll: number; floatDyn?: boolean } | "unusable" {
  const last = burn[burn.length - 1];
  // NOSTART: at the last burn-in census liv < 0.50 or coexist false, or liv < 0.01 at any burn-in census
  if (burn.some((r) => r.liv < 0.01) || last.liv < 0.5 || !last.coexist) return { cls: "NOSTART", tcx: null, chiFw: 0, chiAll: 0 };
  // the job stops at the first run census at which liv < 0.01 or a sustained loss (coexist false at three censuses in a row) completes
  let stop = -1;
  let streak = 0;
  for (let k = 0; k < run.length; k++) {
    streak = run[k].coexist ? 0 : streak + 1;
    if (run[k].liv < 0.01 || streak >= 3) {
      stop = k;
      break;
    }
  }
  const used = stop >= 0 ? run.slice(0, stop + 1) : run;
  const window = used.length >= 20 ? used.slice(used.length - 20) : null;
  const lossComplete = stop >= 0 && streak >= 3; // a sustained loss ends at the stop census (also when that census is the EXT one)
  // chi_all: every run census up to the last one before a sustained loss (all of them if there is none)
  const chiAll = chi(lossComplete ? used.slice(0, used.length - 3) : used);
  const chiFw = window ? chi(window) : 0;
  const rstep = (k: number) => 1000 * (k + 1);
  if (stop >= 0 && run[stop].liv < 0.01) return { cls: "EXT", tcx: rstep(stop), chiFw, chiAll };
  if (lossComplete) return { cls: "LOSS", tcx: rstep(stop - 2), chiFw, chiAll };
  if (window === null) return "unusable";
  if (window.some((r) => r.liv < 0.2)) return { cls: "SPARSE", tcx: "CENSORED", chiFw, chiAll };
  if (window.some((r) => !r.coexist)) return { cls: "LATE", tcx: "CENSORED", chiFw, chiAll };
  // dynamic iff the mean turnover over the 20 censuses is at least 0.02, that is, iff the thousandths add up to at least 20 x 20: an
  // integer comparison, with no floating-point sum to round (the oracle used to repeat the readout's rounding)
  // (floatDyn is what a left-to-right sum of the doubles would decide, kept only to show that the random jobs reach windows where it differs)
  const floatDyn = window.reduce((s, r) => s + r.pm / 1000, 0) / 20 >= 0.02;
  if (window.reduce((s, r) => s + r.pm, 0) < 400) return { cls: "FC", tcx: "CENSORED", chiFw, chiAll, floatDyn };
  return { cls: chiFw >= 0.2 ? "DC" : "CHURN", tcx: "CENSORED", chiFw, chiAll, floatDyn };
}

describe("0 run classes: the readout against an oracle written from the rule text", () => {
  it("agrees on class, T_cx, chi_fw and chi_all over 12,000 random jobs that reach all eight classes", () => {
    const g = generator(424242);
    const LIVS = [0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.6, 0.5, 0.45, 0.25, 0.2, 0.19, 0.0102, 0.0098, 0.005];
    const TURN_PM = [100, 300, 15, 20, 25, 5, 50];
    const row = (healthy: number): R => ({ liv: Math.round((g.rnd() < healthy ? 0.9 : g.pick(LIVS)) * NCELLS) / NCELLS, coexist: g.rnd() < 0.93, pm: g.pick(TURN_PM), ndom: g.ri(31), nanti: g.ri(31) });
    const spec = (r: R): RowSpec => ({ liv: r.liv, shares: r.coexist ? [1, 1, 1] : LOST, turnover: r.pm / 1000, ndom: r.ndom, nanti: r.nanti });
    const tally: Record<string, number> = {};
    const bad: string[] = [];
    let floatDiffers = 0;
    for (let n = 0; n < 12_000; n++) {
      const healthy = g.pick([0.99, 0.995, 0.998, 0.9995]);
      const mode = g.ri(4);
      const burn = Array.from({ length: 6 }, () => ({ ...row(0.97), coexist: g.rnd() < 0.985 }));
      if (g.rnd() < 0.8) burn.forEach((b) => { b.liv = Math.max(b.liv, 0.5); b.coexist = true; });
      const nRun = 20 + g.ri(30);
      const run = Array.from({ length: nRun }, () => {
        const r = row(healthy);
        if (mode === 0) r.pm = g.pick([5, 10, 20, 30, 50]);
        if (mode === 1) { r.ndom = g.ri(12); r.nanti = g.ri(4); }
        if (mode >= 2 && g.rnd() < 0.97) r.coexist = true;
        return r;
      });
      const want = oracle0(burn, run);
      const job = mkJob({ stage: "g0.table", seed: 401, spread: 16, rate: 32, nRun, rows: { burn: burn.map(spec), run: run.map(spec) } });
      let got: ReturnType<typeof analyzeRun> | null = null;
      try {
        got = analyzeRun(job, {});
      } catch {
        got = null;
      }
      if (want === "unusable") {
        if (got !== null) bad.push(`expected unusable input, got ${got.cls}`);
        continue;
      }
      tally[want.cls] = (tally[want.cls] ?? 0) + 1;
      if (want.floatDyn !== undefined && want.floatDyn !== (want.cls !== "FC")) floatDiffers++;
      if (got === null) {
        bad.push(`threw, want ${JSON.stringify(want)}`);
        continue;
      }
      const same = got.cls === want.cls && got.tcx === want.tcx && Math.abs(got.chiFw - want.chiFw) < 1e-12 && Math.abs(got.chiAll - want.chiAll) < 1e-12;
      if (!same) bad.push(JSON.stringify({ got: { cls: got.cls, tcx: got.tcx, chiFw: got.chiFw, chiAll: got.chiAll }, want }));
    }
    expect(bad.slice(0, 3)).toEqual([]);
    for (const c of ["NOSTART", "EXT", "LOSS", "SPARSE", "LATE", "FC", "CHURN", "DC"]) expect(tally[c] ?? 0, c).toBeGreaterThan(20);
    // the jobs reach exact ties of the mean at which floating-point addition would decide the other way (final review, finding 3)
    expect(floatDiffers).toBeGreaterThan(0);
  }, 120_000);
});

// ---------------------------------------------------------------------------------------------------------------------
// Sections 4.3, 4.4 and 4.6: edges, the outcome row and spread*
// ---------------------------------------------------------------------------------------------------------------------

type S = SweepSpread;

function oracleEdges(g: S[], T: number): string[] {
  const out: string[] = [];
  for (let i = 0; i + 1 < g.length; i++) {
    const a = g[i];
    const b = g[i + 1];
    if (!(a.informative && b.informative)) continue;
    const above = g.filter((v, k) => k > i + 1 && v.informative);
    const below = g.filter((v, k) => k < i && v.informative);
    if (a.nDyn >= 4 && b.nDyn <= 1 && b.Tmed! <= T / 4 && above.every((v) => v.nDyn <= 2)) out.push(`L(${a.spread},${b.spread})`);
    if (a.nDyn <= 1 && b.nDyn >= 4 && a.Tmed! <= T / 4 && below.every((v) => v.nDyn <= 2)) out.push(`I(${a.spread},${b.spread})`);
    if (a.nFc >= 4 && b.nDyn >= 4 && below.every((v) => v.nDyn <= 1)) out.push(`F(${a.spread},${b.spread})`);
  }
  return out;
}

function oracleRow(g: S[], T: number): string {
  const inf = g.filter((v) => v.informative);
  const e = oracleEdges(g, T);
  const Ls = e.filter((x) => x[0] === "L");
  const Is = e.filter((x) => x[0] === "I");
  const Fs = e.filter((x) => x[0] === "F");
  const parse = (x: string) => x.slice(2, -1).split(",").map(Number); // [a, b]
  const none = e.length === 0;
  if (inf.length < 4) return "A7";
  if (Fs.length === 1 && Ls.length === 1 && Is.length === 0) {
    const [, b1] = parse(Fs[0]);
    const [a2] = parse(Ls[0]);
    if (b1 <= a2 && inf.filter((v) => v.spread >= b1 && v.spread <= a2).every((v) => v.nDyn >= 3)) return "A9";
  }
  if (Ls.length === 1 && Fs.length === 0 && Is.length === 0) return "A1";
  if (Is.length === 1 && Fs.length === 0 && Ls.length === 0) return "A2";
  if (Fs.length === 1 && Ls.length === 0 && Is.length === 0) {
    const [, b] = parse(Fs[0]);
    if (inf.filter((v) => v.spread >= b).every((v) => v.nDyn >= 3)) return "A8";
  }
  if (none && inf.every((v) => v.nDyn >= 4)) return "A3";
  if (none && inf.every((v) => v.nSig <= 1) && inf.some((v) => v.nChurn >= 4)) return "A11";
  if (none && inf.every((v) => v.nDyn <= 1) && inf.some((v) => v.nFc >= 4)) return "A6";
  if (none && inf.every((v) => v.nDyn <= 1) && inf.some((v) => v.nSparse >= 3)) return "A10";
  if (none && inf.every((v) => v.nDyn <= 1 && v.nFc <= 3 && v.nLost + v.nExt >= 3)) return "A4";
  return "A5";
}

/** 4.6 as amended (decision O-2): the smallest informative v with n_dyn >= 4 whose informative neighbours all have n_dyn >= 3, else the smallest informative v with n_dyn >= 4. */
function oracleStar(g: S[]): number | null {
  for (let k = 0; k < g.length; k++) {
    if (!g[k].informative || g[k].nDyn < 4) continue;
    const nb = [g[k - 1], g[k + 1]].filter((x): x is S => x !== undefined && x.informative);
    if (nb.every((x) => x.nDyn >= 3)) return g[k].spread;
  }
  for (let k = 0; k < g.length; k++) if (g[k].informative && g[k].nDyn >= 4) return g[k].spread;
  return null;
}

describe("4.3, 4.4 and 4.6: the readout against an oracle written from the rule text", () => {
  it("agrees on the edge pairs, the outcome row and spread* over 150,000 random sweeps that reach all eleven rows", () => {
    const g = generator(12345);
    const T = 50_000;
    const counts = () => {
      let left = 5;
      const take = () => {
        const v = g.ri(left + 1);
        left -= v;
        return v;
      };
      const arr = [take(), take(), take(), take(), take(), left];
      for (let i = arr.length - 1; i > 0; i--) {
        const j = g.ri(i + 1);
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return { nDyn: arr[0], nFc: arr[1], nChurn: arr[2], nLost: arr[3], nExt: arr[4], nSparse: arr[5] };
    };
    const mk = (spread: number): S => ({ spread, informative: g.rnd() < 0.85, incomplete: false, nTreat: 5, nCtrl: 3, ...counts(), nSig: g.ri(6), Tmed: g.pick([3000, 12_500, 12_501, 50_000, 51_000]), ctlKeeps: 3, ctlMedAbsChi: 0 });
    const tally: Record<string, number> = {};
    const bad: string[] = [];
    for (let n = 0; n < 150_000; n++) {
      const len = 2 + g.ri(7);
      const grid = Array.from({ length: len }, (_, k) => mk(2 + 3 * k));
      // bias a third of the sweeps toward structured shapes, so that every row is reached
      if (n % 3 === 0) {
        for (const s of grid) {
          const c = g.ri(4);
          if (c === 0) Object.assign(s, { nDyn: 4 + g.ri(2), nFc: 0, nChurn: 0, nLost: 0, nExt: 0, nSparse: 0 });
          else if (c === 1) Object.assign(s, { nDyn: 0, nFc: 4 + g.ri(2), nChurn: 0, nLost: 0, nExt: 0, nSparse: 0 });
          else if (c === 2) Object.assign(s, { nDyn: 0, nFc: 0, nChurn: 0, nLost: 3 + g.ri(3), nExt: 0, nSparse: 0, Tmed: 3000 });
        }
      }
      const want = oracleRow(grid, T);
      tally[want] = (tally[want] ?? 0) + 1;
      const real = sweepOutcome(grid, T);
      if (real.row !== want) bad.push(`row ${real.row} against ${want}: ${JSON.stringify(grid.map((s) => [s.informative ? 1 : 0, s.nDyn, s.nFc, s.nChurn, s.nLost, s.nExt, s.nSparse, s.nSig, s.Tmed]))}`);
      const re = edgePairs(grid, T).map((e) => `${e.kind}(${e.a},${e.b})`);
      if (JSON.stringify(re) !== JSON.stringify(oracleEdges(grid, T))) bad.push(`edges ${re} against ${oracleEdges(grid, T)}`);
      if (spreadStar(grid) !== oracleStar(grid)) bad.push(`spread* ${spreadStar(grid)} against ${oracleStar(grid)}`);
    }
    expect(bad.slice(0, 3)).toEqual([]);
    for (const r of ["A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8", "A9", "A10", "A11"]) expect(tally[r] ?? 0, r).toBeGreaterThan(0);
  }, 120_000);
});

// ---------------------------------------------------------------------------------------------------------------------
// Sections 2.3 to 2.6 and G0.2's grid rule
// ---------------------------------------------------------------------------------------------------------------------

const SIZES = [20, 30, 40, 60];
const se = (k: number, R: number) => {
  const p = (k + 1) / (R + 2);
  return Math.sqrt((p * (1 - p)) / (R + 2));
};

/** 2.3: the first supported sign change of a pair; "supported" needs a deep negative value at M <= Ma (Ma included) and a deep positive one at M >= Mb. */
function oraclePair(k1: number[], k2: number[]): { valid: boolean; est: number | null } {
  const D = LAT_M.map((_, i) => (k2[i] - k1[i]) / 600);
  const SD = LAT_M.map((_, i) => Math.sqrt(se(k1[i], 600) ** 2 + se(k2[i], 600) ** 2));
  for (let ia = 0; ia + 1 < D.length; ia++) {
    if (!(D[ia] <= 0 && D[ia + 1] > 0)) continue;
    let neg = false;
    let pos = false;
    for (let j = 0; j <= ia; j++) if (D[j] < 0 && D[j] <= -2 * SD[j]) neg = true;
    for (let j = ia + 1; j < D.length; j++) if (D[j] > 0 && D[j] >= 2 * SD[j]) pos = true;
    if (neg && pos) {
      if (D[ia] === 0) return { valid: true, est: LAT_M[ia] };
      const xa = Math.log10(LAT_M[ia]);
      const xb = Math.log10(LAT_M[ia + 1]);
      return { valid: true, est: 10 ** (xa + (-D[ia] * (xb - xa)) / (D[ia + 1] - D[ia])) };
    }
  }
  return { valid: false, est: null };
}

const medianOf = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

function oracle26(k: Record<number, number[]>): { V: number; Mc: number | null; r3: boolean; row: number } {
  const est: number[] = [];
  for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) {
    const p = oraclePair(k[SIZES[i]], k[SIZES[j]]);
    if (p.valid) est.push(p.est!);
  }
  const V = est.length;
  const Mc = V ? medianOf(est) : null;
  const r3 = (k[60][10] - k[60][0]) / 600 >= 0.2;
  const inBand = (x: number, lo: number, hi: number) => x >= lo && x <= hi;
  let row = 5;
  if (V >= 4) {
    if (r3 && inBand(Mc!, 3e-4, 6e-4)) row = 1;
    else if (r3 && inBand(Mc!, 2.25e-4, 9e-4)) row = 2;
    else if (r3) row = 3;
    else row = 4;
  }
  return { V, Mc, r3, row };
}

describe("2.3 to 2.6 and G0.2: the readout against an oracle written from the rule text", () => {
  it("agrees on V, M_c, R3 and the outcome row over 20,000 random result sets that reach all five rows", () => {
    const g = generator(777);
    const curves = (): Record<number, number[]> => {
      const Mc = 10 ** (-4.6 + 1.6 * g.rnd());
      const out: Record<number, number[]> = {};
      const steep = g.rnd() < 0.5 ? [1.5, 2.5, 4, 8] : [0.5 + g.rnd(), 0.5 + 2 * g.rnd(), 0.5 + 3 * g.rnd(), 0.5 + 4 * g.rnd()];
      SIZES.forEach((L, i) => {
        out[L] = LAT_M.map((M) => {
          const p = 1 / (1 + Math.exp(-steep[i] * (Math.log10(M) - Math.log10(Mc))));
          const noise = g.rnd() < 0.3 ? 0 : 0.03 * g.gauss();
          return Math.max(0, Math.min(600, Math.round(600 * Math.max(0, Math.min(1, p + noise)))));
        });
      });
      if (g.rnd() < 0.2) out[60][0] = Math.round(out[60][10] - 120 + (g.rnd() < 0.5 ? 0 : 1)); // the R3 boundary
      out[60][0] = Math.max(0, out[60][0]);
      return out;
    };
    const rows: Record<number, number> = {};
    const bad: string[] = [];
    for (let n = 0; n < 20_000; n++) {
      const k = curves();
      const cells: LatticeCell[] = [];
      for (const L of SIZES) LAT_M.forEach((M, iM) => cells.push({ L, iM, M, R: 600, k: k[L][iM] }));
      const want = oracle26(k);
      const got = evaluateLattice(cells).main!;
      rows[want.row] = (rows[want.row] ?? 0) + 1;
      const sameMc = got.Mc === want.Mc || (got.Mc !== null && want.Mc !== null && Math.abs(got.Mc - want.Mc) / want.Mc < 1e-12);
      if (!(got.V === want.V && sameMc && got.r3 === want.r3 && got.outcome.row === want.row)) bad.push(JSON.stringify({ got: { V: got.V, Mc: got.Mc, r3: got.r3, row: got.outcome.row }, want }));
      // and the pair by pair estimates, through analyzePair
      const map = new Map(cells.map((c) => [`${c.L}:${c.iM}`, c]));
      const p = analyzePair(20, 30, map, LAT_M);
      const o = oraclePair(k[20], k[30]);
      if (p.valid !== o.valid || (p.valid && Math.abs((p.estimate as number) - (o.est as number)) / (o.est as number) > 1e-12)) bad.push(`pair (20, 30) ${p.valid} ${p.estimate} against ${o.valid} ${o.est}`);
    }
    expect(bad.slice(0, 3)).toEqual([]);
    for (const r of [1, 2, 3, 4, 5]) expect(rows[r] ?? 0, `row ${r}`).toBeGreaterThan(0);
  }, 120_000);

  it("G0.2's grid rule: the first carpet spread, then each v with D_lab >= max(1.3 D_lab(last taken), 0.005), at most 8", () => {
    const g = generator(31337);
    const bad: string[] = [];
    for (let n = 0; n < 20_000; n++) {
      const spreads = [2, 3, 4, 6, 8, 10, 12, 16, 20, 24, 28, 32].filter(() => g.rnd() < 0.8);
      const dl = new Map<number, number>(spreads.map((v) => [v, g.rnd() < 0.15 ? 0 : 0.002 * 1.25 ** (g.rnd() * 14) * (g.rnd() < 0.3 ? 0.6 : 1)]));
      const G: number[] = [];
      for (const v of spreads) {
        if (G.length === 0) {
          G.push(v);
          continue;
        }
        if (G.length >= 8) break;
        if (dl.get(v)! >= Math.max(1.3 * dl.get(G[G.length - 1])!, 0.005)) G.push(v);
      }
      if (JSON.stringify(G) !== JSON.stringify(gridRule(spreads, dl))) bad.push(`${spreads} ${[...dl.values()]} -> ${G} against ${gridRule(spreads, dl)}`);
    }
    expect(bad.slice(0, 3)).toEqual([]);
  });
});
