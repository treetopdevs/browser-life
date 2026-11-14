// Tests added with the fixes to the final Codex review of Part A (2026-10-24, Sol 6.1 at High). Every test names the finding it covers.
// This file holds the arithmetic of the turnover threshold (finding 3); the other findings' tests sit with the code they test
// (rps-kernel-job.test.ts, rps-gate0-spike.test.ts, rps-readout.test.ts, rps-boundaries.test.ts). Nothing here is a result: every number
// is made up to land on one side of a threshold.

import { describe, expect, it } from "vitest";
import { TURNOVER_DYNAMIC, analyzeRun, turnoverRatio, windowTurnover } from "../3d-rps/readout-jobs.ts";
import { NCELLS, mkJob, type RowSpec } from "./rps-fixtures.ts";

const job = (rows: RowSpec[]) => mkJob({ stage: "g0.table", seed: 401, spread: 16, rate: 32, cls: { custom: (k) => rows[k], nRun: rows.length } });
const row = (turnover: number, ndom = 250, nanti = 50): RowSpec => ({ liv: 0.9, turnover, ndom, nanti });
const gcd = (a: bigint, b: bigint): bigint => (b === 0n ? a : gcd(b, a % b));

describe("0 Dynamic: the mean turnover of the final window is exact, and 0.02 is 1 / 50 (final review, finding 3)", () => {
  it("the threshold constant is the double nearest 1 / 50, which is the fraction windowTurnover compares with", () => {
    expect(TURNOVER_DYNAMIC).toBe(1 / 50);
  });

  it("turnoverRatio recovers k / n, in lowest terms, from the double the census wrote, for every fraction with a small denominator", () => {
    for (let n = 1; n <= 400; n++) {
      for (let k = 0; k <= n; k++) {
        const g = gcd(BigInt(k), BigInt(n));
        expect(turnoverRatio(k / n, 65_536)).toEqual({ num: BigInt(k) / g, den: BigInt(n) / g });
      }
    }
  });

  it("... and for denominators up to the 262,144 cells of the largest world, k / n being the double the census would write", () => {
    let s = 12345;
    const rnd = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32;
    for (let t = 0; t < 20_000; t++) {
      const n = 1 + Math.floor(rnd() * 262_144);
      const k = Math.floor(rnd() * (n + 1));
      const g = gcd(BigInt(k), BigInt(n));
      const r = turnoverRatio(k / n, 262_144);
      expect(r).toEqual({ num: BigInt(k) / g, den: BigInt(n) / g });
    }
    // the neighbours of 1 / 50 and of 0 and 1, where doubles are densest
    for (const [k, n] of [[1310, 65_501], [1310, 65_499], [1, 65_536], [65_535, 65_536], [1, 262_144], [262_143, 262_144]] as const) {
      expect(turnoverRatio(k / n, 262_144)).toEqual({ num: BigInt(k), den: BigInt(n) });
    }
  });

  it("turnoverRatio gives null for a value that is no quotient of two counts, for values outside 0..1, and for a denominator beyond the limit", () => {
    expect(turnoverRatio(0.1234567891234, 65_536)).toBeNull();
    expect(turnoverRatio(Math.PI / 10, 65_536)).toBeNull();
    expect(turnoverRatio(5e-324, 65_536)).toBeNull();
    expect(turnoverRatio(-0.1, 65_536)).toBeNull();
    expect(turnoverRatio(1.0000001, 65_536)).toBeNull();
    expect(turnoverRatio(NaN, 65_536)).toBeNull();
    expect(turnoverRatio(Infinity, 65_536)).toBeNull();
    expect(turnoverRatio(1 / 65_537, 65_536)).toBeNull();
    expect(turnoverRatio(1 / 65_537, 65_537)).toEqual({ num: 1n, den: 65_537n });
    expect(turnoverRatio(0, 65_536)).toEqual({ num: 0n, den: 1n });
    expect(turnoverRatio(1, 65_536)).toEqual({ num: 1n, den: 1n });
  });

  it("fifteen turnovers of 500 / 50,000 and five of 2,500 / 50,000 average exactly 0.02: dynamic, in any order, although floating-point addition says 0.019999999999999997 (the review's case)", () => {
    const turn = [...Array<number>(15).fill(500 / 50_000), ...Array<number>(5).fill(2_500 / 50_000)];
    // the premise: a left-to-right float sum of these values falls short of the threshold, and its reverse does not
    const naive = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(naive(turn)).toBeLessThan(0.02);
    expect(naive([...turn].reverse())).toBeGreaterThanOrEqual(0.02);
    for (const xs of [turn, [...turn].reverse(), [...turn.slice(10), ...turn.slice(0, 10)]]) {
      const w = windowTurnover(xs, NCELLS);
      expect(w).toEqual({ mean: 0.02, dynamic: true });
    }
  });

  it("through the readout: those turnovers with n_dom 12,000 and n_anti 8,000 over the window (chi_fw exactly 0.2) are class DC, in either order, and the mean is reported as 0.02", () => {
    const turn = [...Array<number>(15).fill(500 / 50_000), ...Array<number>(5).fill(2_500 / 50_000)];
    for (const xs of [turn, [...turn].reverse()]) {
      const a = analyzeRun(job(xs.map((t) => row(t, 600, 400))), {});
      expect(a.cls).toBe("DC");
      expect(a.chiFw).toBe(0.2);
      expect(a.turnoverFw).toBe(0.02);
    }
    // one count fewer of change, or one more, moves the class: FC just below, DC above (no tolerance in either direction)
    const below = [...Array<number>(15).fill(500 / 50_000), ...Array<number>(4).fill(2_500 / 50_000), 2_499 / 50_000];
    const above = [...Array<number>(15).fill(500 / 50_000), ...Array<number>(4).fill(2_500 / 50_000), 2_501 / 50_000];
    expect(analyzeRun(job(below.map((t) => row(t, 600, 400))), {}).cls).toBe("FC");
    expect(analyzeRun(job(above.map((t) => row(t, 600, 400))), {}).cls).toBe("DC");
  });

  it("no tolerance: nineteen turnovers of exactly 1 / 50 and a twentieth 3 x 10^-7 below it (1310 / 65,501) are FC, and one 3 x 10^-7 above it (1310 / 65,499) is dynamic", () => {
    const base = Array<number>(19).fill(0.02);
    expect(windowTurnover([...base, 1310 / 65_501], NCELLS)?.dynamic).toBe(false);
    expect(windowTurnover([...base, 1310 / 65_499], NCELLS)?.dynamic).toBe(true);
    expect(windowTurnover([...base, 0.02], NCELLS)?.dynamic).toBe(true);
    expect(analyzeRun(job([...base, 1310 / 65_501].map((t) => row(t))), {}).cls).toBe("FC");
    expect(analyzeRun(job([...base, 1310 / 65_499].map((t) => row(t))), {}).cls).toBe("DC"); // dynamic, and the default rows carry the cyclic signature
  });

  it("twenty identical turnovers of 0.02 (the old boundary test) and the other exact ties: dynamic; windowTurnover is null for a value that is no ratio of counts", () => {
    expect(windowTurnover(Array<number>(20).fill(0.02), NCELLS)).toEqual({ mean: 0.02, dynamic: true });
    expect(windowTurnover(Array<number>(20).fill(0.0199), NCELLS)?.dynamic).toBe(false);
    expect(windowTurnover([0.02, 0.1234567891234], NCELLS)).toBeNull();
    expect(windowTurnover([], NCELLS)).toBeNull();
  });

  it("agrees with exact integer arithmetic over 40,000 random windows built around the tie: turnovers m / 62,500 whose m add up to exactly 25,000 (the threshold), or to up to 2 under or 2 over", () => {
    // each turnover is m_i / 62,500 (62,500 <= 65,536 cells); the mean is at least 1/50 exactly when sum(m_i) >= 25,000 (20 x 62,500 / 50)
    let s = 987654321;
    const rnd = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32;
    let floatWrong = 0;
    for (let t = 0; t < 40_000; t++) {
      const target = 25_000 + Math.floor(rnd() * 5) - 2; // 24,998 .. 25,002
      // split the target into 20 non-negative parts, some large, some small
      const cuts = Array.from({ length: 19 }, () => Math.floor(rnd() * (target + 1))).sort((a, b) => a - b);
      const m = [cuts[0], ...cuts.slice(1).map((c, k) => c - cuts[k]), target - cuts[18]];
      if (m.some((x) => x < 0 || x > 62_500)) continue;
      const values = m.map((x) => x / 62_500);
      const want = m.reduce((a, b) => a + b, 0) >= 25_000;
      expect(windowTurnover(values, NCELLS)?.dynamic).toBe(want);
      if (values.reduce((a, b) => a + b, 0) / 20 >= 0.02 !== want) floatWrong++;
    }
    // the test has teeth: plain floating-point addition gets some of these windows wrong
    expect(floatWrong).toBeGreaterThan(0);
  });

  it("a value that is no quotient of two cell counts is unusable input (exit 2) where the class needs the turnover, and does not matter where it does not", () => {
    const odd = Array<number>(20).fill(0.1);
    odd[5] = 0.1234567891234;
    let err: unknown = null;
    try {
      analyzeRun(job(odd.map((t) => row(t))), {});
    } catch (e) {
      err = e;
    }
    expect(err).toMatchObject({ code: 2 });
    expect((err as Error).message).toMatch(/census\.tsv step 12000: turnover 0\.1234567891234 is not a quotient of two cell counts \(at most 65536 cells\), which B\.2 requires/);
    // SPARSE is decided by liv alone: the same turnovers do not stop it, and the (plain) mean is still reported
    const sparse = analyzeRun(job(odd.map((t) => ({ ...row(t), liv: 0.1 }))), {});
    expect(sparse.cls).toBe("SPARSE");
    expect(sparse.turnoverFw).toBeCloseTo((19 * 0.1 + 0.1234567891234) / 20, 12);
  });
});
