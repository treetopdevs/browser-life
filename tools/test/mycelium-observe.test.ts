// Mycelium rung R2 readouts (tools/mycelium/observe.ts): every readout on a small state whose value is worked
// out by hand, a "no structure" and a "strong structure" fixture for each field readout, the torus seam, the
// threshold edges, and the streaming observer against an independent recomputation on a real run.
import { describe, expect, it } from "vitest";
import {
  cellCounts, detrend, lloydPatchiness, meanCrowding, mergeHistograms, oscillation, PHistogram, PROTOCOL_WINDOW, R2, R2Observer, type R2Series, readoutsFromSeries, relativeDrift, thetaFromHistogram, trailConnectivity, turnover, verifyResult,
} from "../mycelium/observe.ts";
import { createWorld, defaultConfig, step } from "../mycelium/world.ts";
import { lowbias32 } from "@bl/schema";

const grid = (W: number, H: number, cells: [number, number, number][]) => {
  const P = new Uint32Array(W * H);
  for (const [x, y, v] of cells) P[y * W + x] = v;
  return P;
};
const block = (x0: number, y0: number, w: number, h: number, v: number, W: number): [number, number, number][] => {
  const out: [number, number, number][] = [];
  for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) out.push([(x0 + dx) % W, y0 + dy, v]);
  return out;
};

describe("R1 trail connectivity", () => {
  it("no structure: scattered single cells give 0, and so does no trail at all", () => {
    const P = grid(16, 16, [[1, 1, 9], [5, 3, 9], [9, 9, 9], [13, 2, 9], [4, 12, 9]]);
    const r = trailConnectivity(P, 16, 16, 4);
    expect(r.value).toBe(0);
    expect(r.components).toBe(0);
    expect(r.totalMass).toBe(45);
    expect(trailConnectivity(new Uint32Array(256), 16, 16, 4).value).toBe(0);
  });

  it("strong structure: a 6x6 block counts, isolated cells and sub-threshold cells do not, and the denominator is all trail", () => {
    // block mass 36 * 10 = 360; three isolated cells of 5 (>= theta, 1 cell each); four cells of 1 (< theta).
    const cells = [...block(2, 2, 6, 6, 10, 16), [12, 1, 5], [14, 8, 5], [1, 13, 5], [10, 10, 1], [11, 12, 1], [9, 14, 1], [15, 15, 1]] as [number, number, number][];
    const r = trailConnectivity(grid(16, 16, cells), 16, 16, 4);
    expect(r.connectedMass).toBe(360);
    expect(r.totalMass).toBe(360 + 15 + 4);
    expect(r.value).toBe(360 / 379);
    expect(r.components).toBe(1);
    expect(r.largest).toBe(36);
  });

  it("the size bar is 25 cells: 25 counts, 24 does not", () => {
    expect(trailConnectivity(grid(16, 16, block(2, 2, 5, 5, 3, 16)), 16, 16, 2).value).toBe(1);
    // 4 x 6 = 24 cells, one short of the bar.
    expect(trailConnectivity(grid(16, 16, block(2, 2, 4, 6, 3, 16)), 16, 16, 2).value).toBe(0);
  });

  it("components wrap the torus in both directions, and diagonal touching is not connected", () => {
    // a 5x5 block straddling the east-west seam: columns 14, 15, 0, 1, 2.
    expect(trailConnectivity(grid(16, 16, block(14, 4, 5, 5, 3, 16)), 16, 16, 2).value).toBe(1);
    // a 5-wide, 5-tall block straddling the north-south seam: rows 14, 15, 0, 1, 2.
    const v: [number, number, number][] = [];
    for (let dy = 0; dy < 5; dy++) for (let dx = 0; dx < 5; dx++) v.push([4 + dx, (14 + dy) % 16, 3]);
    expect(trailConnectivity(grid(16, 16, v), 16, 16, 2).value).toBe(1);
    // two cells touching only at a corner are two components of 1; one wrapping pair is one component of 2.
    expect(trailConnectivity(grid(16, 16, [[3, 3, 5], [4, 4, 5]]), 16, 16, 2, 2).value).toBe(0);
    expect(trailConnectivity(grid(16, 16, [[0, 3, 5], [15, 3, 5]]), 16, 16, 2, 2).value).toBe(1);
  });

  it("the threshold is inclusive: P >= theta is in the mask", () => {
    const P = grid(8, 8, block(1, 1, 5, 5, 4, 8));
    expect(trailConnectivity(P, 8, 8, 4).value).toBe(1);
    expect(trailConnectivity(P, 8, 8, 5).value).toBe(0);
  });
});

describe("theta from a streaming histogram", () => {
  it("is the nearest-rank 75th percentile of nonzero trail, with a minimum of 2", () => {
    // 100 cells each of P = 1, 2, 3, 4: N = 400, rank 300, reached at P = 3.
    const h = new PHistogram();
    for (let v = 1; v <= 4; v++) h.add(new Uint32Array(100).fill(v));
    h.add(new Uint32Array(5000)); // zeros are not counted
    expect(h.bins[0]).toBe(0);
    expect(thetaFromHistogram(h.bins)).toBe(3);
    // rank rounds up: N = 5 gives rank 4.
    const g = new PHistogram();
    g.add(Uint32Array.from([2, 2, 2, 7, 9]));
    expect(thetaFromHistogram(g.bins)).toBe(7);
  });

  it("enforces the minimum, handles no trail, and clamps large values into the last bin", () => {
    const h = new PHistogram();
    h.add(new Uint32Array(40).fill(1));
    expect(thetaFromHistogram(h.bins)).toBe(2);
    expect(thetaFromHistogram(new PHistogram().bins)).toBe(2);
    const big = new PHistogram();
    big.add(Uint32Array.from([100000, 100000, 5, 6]));
    expect(big.bins[255]).toBe(2);
    expect(thetaFromHistogram(big.bins)).toBe(255);
  });

  it("sums histograms across runs", () => {
    const a = new PHistogram(), b = new PHistogram();
    a.add(Uint32Array.from([1, 2, 3])); b.add(Uint32Array.from([3, 3, 4]));
    const m = mergeHistograms([a.bins, b.bins]);
    expect(m[3]).toBe(3);
    expect(m.reduce((t, v) => t + v, 0)).toBe(6);
    expect(() => mergeHistograms([[1, 2, 3]])).toThrow(/256 bins/);
  });
});

describe("R2 patchiness (Lloyd)", () => {
  it("no structure: one particle per cell gives 0; a hand-worked mixed case gives 0.5", () => {
    expect(lloydPatchiness(new Uint32Array(100).fill(1), 100, 100)).toBe(0);
    // D = [2, 1, 1, 0]: sum D^2 = 6, n = 4, cells = 4: ((6 / 4) - 1) / (4 / 4) = 0.5.
    expect(lloydPatchiness(Uint32Array.from([2, 1, 1, 0]), 4, 4)).toBe(0.5);
  });

  it("strong structure: everything in one cell gives (n - 1) * cells / n", () => {
    const D = new Uint32Array(100); D[7] = 10;
    expect(lloydPatchiness(D, 10, 100)).toBe((9 * 100) / 10);
  });

  it("is about 1 for a random scatter and undefined for n = 0", () => {
    const cells = 4096, n = 4096;
    const D = new Uint32Array(cells);
    for (let i = 0; i < n; i++) D[lowbias32(i * 7919 + 13) % cells]++;
    expect(lloydPatchiness(D, n, cells)).toBeGreaterThan(0.9);
    expect(lloydPatchiness(D, n, cells)).toBeLessThan(1.1);
    expect(lloydPatchiness(new Uint32Array(4), 0, 4)).toBeNaN();
  });

  it("cellCounts bins positions by cell (256 units per cell)", () => {
    const s = createWorld(defaultConfig({ width: 8, height: 8, founders: 4, maxParticles: 16 }));
    const at: [number, number][] = [[0, 0], [255, 255], [256, 0], [3 * 256 + 10, 2 * 256 + 5]];
    at.forEach(([x, y], i) => { s.x[i] = x; s.y[i] = y; });
    const D = cellCounts(s);
    expect(D[0]).toBe(2);
    expect(D[1]).toBe(1);
    expect(D[2 * 8 + 3]).toBe(1);
    expect(Array.from(D).reduce((t, v) => t + v, 0)).toBe(4);
  });
});

describe("R3 oscillation strength", () => {
  it("strong structure: a period-40 wave with noise and a linear trend gives a high peak at lag 40", () => {
    const N = 1000;
    const x = Array.from({ length: N }, (_, i) => 3000 + 0.7 * i + 100 * Math.sin((2 * Math.PI * i) / 40) + ((lowbias32(i) % 21) - 10));
    const r = oscillation(x);
    expect(r.constant).toBe(false);
    expect(r.firstDip).toBe(11);
    expect(r.lag).toBe(40);
    expect(r.value).toBeGreaterThan(0.9);
    expect(r.value).toBeLessThan(1);
  });

  it("no structure: pure noise gives a small value", () => {
    const x = Array.from({ length: 1000 }, (_, i) => 1000 + (lowbias32(i * 31 + 5) % 201) - 100);
    expect(oscillation(x).value).toBeLessThan(0.25);
  });

  it("hand-worked: [1,-1,-1,1] has rho = -0.25, -0.5, +0.25, so the first dip is lag 1 and the peak lag 3", () => {
    const r = oscillation([1, -1, -1, 1]);
    expect(r.rho).toEqual([-0.25, -0.5, 0.25]);
    expect(r.firstDip).toBe(1);
    expect(r.lag).toBe(3);
    expect(r.value).toBe(0.25);
  });

  it("no dip below zero within the lags gives 0", () => {
    // [1,0,-2,0,1] is already zero-mean and trend-free; rho(1) = 0 is not below zero, rho(2) = -2/3.
    const x = [1, 0, -2, 0, 1];
    expect(oscillation(x, 1).value).toBe(0);
    expect(oscillation(x, 1).lag).toBeNull();
    expect(oscillation(x, 2).firstDip).toBe(2);
    // rho stays negative after the first dip (-2/3 at lag 2), so there is no recurrence: floored at 0, no lag, no period.
    expect(oscillation(x, 2).value).toBe(0);
    expect(oscillation(x, 2).lag).toBeNull();
  });

  it("is never negative: a slow cosine whose rho goes negative and stays so after the dip reads 0 with no period", () => {
    // period 400 samples, maxLag 250: rho falls below zero near lag 100 and stays negative to lag 250, so no positive recurrence within the lags
    const x = Array.from({ length: 1000 }, (_, i) => 100 * Math.cos((2 * Math.PI * i) / 400));
    const r = oscillation(x, 250);
    expect(r.firstDip).not.toBeNull();
    expect(r.value).toBe(0);
    expect(r.lag).toBeNull();
    expect(Math.min(...r.rho)).toBeLessThan(0);
  });

  it("a constant or purely linear series has no variance after detrending: defined as 0", () => {
    expect(oscillation([5, 5, 5, 5, 5, 5])).toMatchObject({ value: 0, constant: true });
    expect(oscillation([-3, -1, 1, 3])).toMatchObject({ value: 0, constant: true });
  });

  it("detrend removes the least-squares line and caps lags at N - 1", () => {
    const d = detrend([2, 4, 6, 8, 10]);
    for (const v of d) expect(Math.abs(v)).toBeLessThan(1e-12);
    expect(oscillation([1, -1, -1, 1], 250).rho.length).toBe(3);
  });

  it("agrees with an independent evaluation of the formula", () => {
    const x = Array.from({ length: 300 }, (_, i) => 50 + Math.sin(i / 7) * 10 + (lowbias32(i + 99) % 7));
    const N = x.length, tm = (N - 1) / 2, xm = x.reduce((t, v) => t + v, 0) / N;
    let num = 0, den = 0;
    x.forEach((v, i) => { num += (i - tm) * (v - xm); den += (i - tm) ** 2; });
    const y = x.map((v, i) => v - xm - (num / den) * (i - tm));
    const rho = (l: number) => { let a = 0, b = 0; for (let i = 0; i < N; i++) { b += y[i] * y[i]; if (i + l < N) a += y[i] * y[i + l]; } return a / b; };
    const r = oscillation(x, 100);
    for (const l of [1, 5, 22, 60, 100]) expect(r.rho[l - 1]).toBeCloseTo(rho(l), 9);
  });
});

describe("R4 turnover", () => {
  it("is births per particle per 1,000 steps", () => {
    expect(turnover(3000, 10000, 1500)).toBeCloseTo(0.2, 12);
    expect(turnover(0, 10000, 1500)).toBe(0);
    expect(turnover(10, 10000, 0)).toBeNaN();
  });
});

describe("the streaming observer on a real run", () => {
  const window = { steps: 400, burn: 200 };
  const cfg = defaultConfig({ width: 48, height: 48, founders: 256, maxParticles: 2048, seed: 7 });

  it("matches an independent recomputation of the windows, births, patchiness and connectivity", () => {
    const s = createWorld(cfg), o = new R2Observer(window, 3);
    const n10: number[] = [], births: Record<number, number> = {};
    const r2s: number[] = [], r1s: number[] = [];
    for (let t = 1; t <= 400; t++) {
      step(s); o.observe(s);
      if (t % 10 === 0) { n10.push(s.n); births[t] = s.totals.births; }
      if (t % 100 === 0 && t > 200) {
        r2s.push(lloydPatchiness(cellCounts(s), s.n, 48 * 48));
        r1s.push(trailConnectivity(s.P, 48, 48, 3).value);
      }
    }
    const res = o.finish();
    const wn = n10.slice(20);
    expect(wn.length).toBe(20);
    expect(res.samples.n).toEqual(n10);
    const meanN = wn.reduce((t, v) => t + v, 0) / wn.length;
    expect(res.readouts.R4).toBeCloseTo((1000 * (births[400] - births[200])) / (200 * meanN), 12);
    expect(res.readouts.R2).toBeCloseTo(r2s.reduce((t, v) => t + v, 0) / 2, 12);
    expect(res.readouts.R1).toBeCloseTo(r1s.reduce((t, v) => t + v, 0) / 2, 12);
    expect(res.readouts.R3).toBe(oscillation(wn).value);
    expect(res.descriptive.nAtBurn).toBe(n10[19]);
    expect(res.descriptive.nAtEnd).toBe(n10[39]);
    expect(res.guard.samples).toBe(20); // the guard covers all of W
    expect(res.guard.minN).toBe(Math.min(...n10.slice(20)));
    expect(res.census.r1.length).toBe(4);
    expect(res.descriptive.depositFrac).not.toBeNull();
    expect(res.pHist.reduce((t, v) => t + v, 0)).toBeGreaterThan(0);
  });

  it("pass-1 observers skip R1 and still return the histogram", () => {
    const s = createWorld(cfg), o = new R2Observer(window, null);
    for (let t = 1; t <= 400; t++) { step(s); o.observe(s); }
    const res = o.finish();
    expect(res.readouts.R1).toBeNull();
    expect(res.pHist.some((v) => v > 0)).toBe(true);
  });

  it("the guard trips when n is under 200 at any sample of W, and not otherwise", () => {
    const run = (c: typeof cfg) => { const s = createWorld(c), o = new R2Observer(window, 3); for (let t = 1; t <= 400; t++) { step(s); o.observe(s); } return o.finish(); };
    const capped = run({ ...cfg, maxParticles: 150, founders: 150 });
    expect(capped.guard.tripped).toBe(true);
    expect(capped.guard.minN).toBeLessThan(200);
    expect(run(cfg).guard.tripped).toBe(false);
  });

  it("rejects skipped steps and an early finish", () => {
    const s = createWorld(cfg), o = new R2Observer(window, 3);
    step(s); o.observe(s);
    step(s); step(s);
    expect(() => o.observe(s)).toThrow(/consecutive/);
    expect(() => new R2Observer({ steps: 400, burn: 200 }, 1)).toThrow(/theta/);
    expect(() => o.finish()).toThrow(/observed/);
  });

  it("the protocol constants are the protocol's", () => {
    expect([R2.STEPS, R2.BURN, R2.MAX_LAG, R2.MIN_COMPONENT_CELLS, R2.GUARD_MIN_N]).toEqual([20000, 10000, 250, 25, 200]);
    expect(PROTOCOL_WINDOW).toEqual({ steps: 20000, burn: 10000 });
  });
});

describe("the guard covers all of W, and a result can be checked against its own series", () => {
  const ser = (n: number[]): R2Series => {
    const m = n.length; // 40 samples = 400 steps, burn 200
    return { samples: { n, births: n.map((_, i) => i), refused: n.map(() => 0), sumP: n.map(() => 1) }, census: { r1: Array(m / 10).fill(0.5), r2: Array(m / 10).fill(2), crowding: Array(m / 10).fill(1), families: [], meanM: [], meanE: [], meanAge: [], depositFrac: [], eatFrac: [], moveMean: [] } };
  };
  it("an early collapse that recovers by the end trips; a final-quarter minimum alone is not what counts", () => {
    const n = [...Array(20).fill(400), ...Array(5).fill(100), ...Array(15).fill(300)];
    const r = readoutsFromSeries({ steps: 400, burn: 200 }, 3, ser(n));
    expect(r.guard).toMatchObject({ tripped: true, minN: 100, samples: 20 });
    const ok = readoutsFromSeries({ steps: 400, burn: 200 }, 3, ser([...Array(20).fill(100), ...Array(20).fill(300)])); // low only in burn-in: fine
    expect(ok.guard.tripped).toBe(false);
  });
  it("verifyResult accepts a real run, and names a tampered readout or guard", () => {
    const cfg = defaultConfig({ width: 48, height: 48, founders: 256, maxParticles: 2048, seed: 7 });
    const s = createWorld(cfg), o = new R2Observer({ steps: 400, burn: 200 }, 3);
    for (let t = 1; t <= 400; t++) { step(s); o.observe(s); }
    const res = o.finish();
    expect(verifyResult(res)).toEqual([]);
    expect(verifyResult({ ...res, readouts: { ...res.readouts, R2: (res.readouts.R2 as number) + 1 } }).join()).toMatch(/readout R2/);
    expect(verifyResult({ ...res, guard: { ...res.guard, tripped: !res.guard.tripped } }).join()).toMatch(/guard/);
    expect(verifyResult({ ...res, window: { steps: 400, burn: 100 } }).length).toBeGreaterThan(0);
  });
  it("relativeDrift is (second half - first half) / mean, and null for a zero mean; meanCrowding is sum D^2 / n - 1", () => {
    expect(relativeDrift([1, 1, 3, 3])).toBeCloseTo(1, 12);
    expect(relativeDrift([2, 2, 2, 2])).toBe(0);
    expect(relativeDrift([0, 0, 0, 0])).toBeNull();
    expect(meanCrowding([2, 0, 1, 1], 4)).toBe(1.5 - 1);
  });
});
