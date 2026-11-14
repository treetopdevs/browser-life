// Mycelium rung R2b readouts (tools/mycelium/observe-r2b.ts): Moran's I, the median age, SIG and the deposit measure d on small states whose
// values are worked out by hand, every readout of a run series built by hand, the streaming observer on a real short run, and the run-file checks.
import { describe, expect, it } from "vitest";
import { NN_BYTES, NN_H, NN_I, NN_O } from "@bl/schema";
import {
  depositMeasure, emptySeries, halfWindowDrift, medianAge, medianOf, moransI, probeSignature, R2bObserver, type R2bSeries, runFileProblems, type RunFileLike, runValues, seriesProblems, verifyCached,
} from "../mycelium/observe-r2b.ts";
import { PROBE_INPUTS, R2B } from "../mycelium/r2b-protocol.ts";
import { createWorld, defaultConfig, encode, energyTotal, matterTotal, type MyceliumState, stateDigest, step } from "../mycelium/world.ts";

const B2_OFF = NN_I * NN_H + NN_H + NN_H * NN_O;
const W1_OFF = 0, W2_OFF = NN_I * NN_H + NN_H;
const small = (over = {}) => defaultConfig({ width: 32, height: 32, founders: 128, maxParticles: 1024, ...over });

describe("Moran's I of the trail", () => {
  it("a checkerboard on an even torus is -1 and a half-and-half split is 0.75 (worked by hand)", () => {
    const W = 8, H = 8;
    const checker = new Uint32Array(W * H).map((_, i) => (((i % W) + Math.floor(i / W)) % 2 === 0 ? 100 : 0));
    expect(moransI(checker, W, H).value).toBeCloseTo(-1, 12);
    // columns 0-3 hold 100, columns 4-7 hold 0: 16 of the 128 undirected neighbour pairs cross (two seams of 8), z = +-50;
    // sum over ordered pairs of z_i z_j = (224 same - 32 opposite) * 2500 = 480000, sum z^2 = 64 * 2500 = 160000, I = 480000 / (4 * 160000).
    const half = new Uint32Array(W * H).map((_, i) => (i % W < 4 ? 100 : 0));
    expect(moransI(half, W, H).value).toBeCloseTo(0.75, 12);
    expect(moransI(half, W, H).valid).toBe(true);
  });

  it("is invariant to scaling the field, and equals the textbook sums on a random field", () => {
    const W = 16, H = 12;
    let x = 12345;
    const rnd = () => { x = (Math.imul(x, 1103515245) + 12345) >>> 0; return x; };
    const P = new Uint32Array(W * H).map(() => rnd() % 50);
    const scaled = P.map((v) => v * 7);
    expect(moransI(scaled, W, H).value).toBeCloseTo(moransI(P, W, H).value, 10);
    // direct definition
    const N = W * H, m = P.reduce((t, v) => t + v, 0) / N;
    let num = 0, den = 0;
    for (let y = 0; y < H; y++) for (let xx = 0; xx < W; xx++) {
      const z = P[y * W + xx] - m;
      const nb = [P[y * W + ((xx + 1) % W)], P[y * W + ((xx + W - 1) % W)], P[((y + 1) % H) * W + xx], P[((y + H - 1) % H) * W + xx]];
      for (const v of nb) num += z * (v - m);
      den += z * z;
    }
    expect(moransI(P, W, H).value).toBeCloseTo(num / (4 * den), 10);
  });

  it("is invalid (value 0) below 500 units of trail, with no trail, and for a uniform field", () => {
    const W = 8, H = 8;
    const few = new Uint32Array(W * H); few[3] = 100; few[20] = 100;
    expect(moransI(few, W, H)).toEqual({ value: 0, valid: false });
    expect(moransI(new Uint32Array(W * H), W, H).valid).toBe(false);
    expect(moransI(new Uint32Array(W * H).fill(50), W, H).valid).toBe(false);
    const enough = new Uint32Array(W * H); enough[3] = 500;
    expect(moransI(enough, W, H).valid).toBe(true);
    expect(moransI(enough, W, H, 501).valid).toBe(false);
  });
});

describe("median age, SIG and the deposit measure", () => {
  it("the median of the ages uses the mean of the two middle values for an even count", () => {
    expect(medianOf([5, 1, 3])).toBe(3);
    expect(medianOf([4, 1, 3, 10])).toBe(3.5);
    expect(medianOf([])).toBeNull();
    const s = createWorld(small({ founders: 5 }));
    s.age.set([10, 0, 2, 7, 3]);
    expect(medianAge(s)).toBe(3);
    s.n = 4; // the fifth slot is not live
    expect(medianAge(s)).toBe(4.5); // ages 10, 0, 2, 7 sorted 0, 2, 7, 10
  });

  it("SIG is 1 for a constant positive deposit bias, 0 for a negative one, and 1/6 for a genome that fires only on the east-gradient probe", () => {
    const set = (f: (i: number, s: MyceliumState) => void) => { const s = createWorld(small()); s.genome.fill(0); for (let i = 0; i < s.n; i++) f(i, s); return probeSignature(s); };
    expect(set((i, s) => { s.genome[i * NN_BYTES + B2_OFF + 3] = 5; })).toBe(1);
    expect(set((i, s) => { s.genome[i * NN_BYTES + B2_OFF + 3] = -5; })).toBe(0);
    expect(set(() => {})).toBe(0); // output 0 is not above 0
    // hidden unit 0 = relu(64 * trail east-west / 128); output 3 = 64 * h0 / 128. Probe 3 (gradient +100) gives h0 = 50, o3 = 25; probe 4 (-100) and the rest give 0.
    expect(set((i, s) => { s.genome[i * NN_BYTES + W1_OFF + 3 * NN_H + 0] = 64; s.genome[i * NN_BYTES + W2_OFF + 0 * NN_O + 3] = 64; })).toBeCloseTo(1 / 6, 12);
    expect(PROBE_INPUTS.length).toBe(6);
    for (const p of PROBE_INPUTS) expect(p.length).toBe(NN_I);
    expect(probeSignature(createWorld(small({ founders: 0 })))).toBeNull();
  });

  it("d is the next step's deposit per particle, as step() applies it, and changes nothing", () => {
    // Every particle's DEPOSIT output is 127: (maxDeposit 4 * 127) >> 7 = 3 units, within its body (32) and energy (512 / 2 per unit).
    const s = createWorld(small());
    s.genome.fill(0);
    for (let i = 0; i < s.n; i++) s.genome[i * NN_BYTES + B2_OFF + 3] = 127;
    s.matter0 = matterTotal(s); s.energy0 = energyTotal(s);
    const before = stateDigest(s);
    expect(depositMeasure(s)).toBe(3);
    expect(stateDigest(s)).toBe(before);
    // Against the real step with decay off: the same number, with the config's own decay on (the measure turns it off on its copy).
    const t = createWorld(small({ pDecay: 0 }));
    t.genome.set(s.genome);
    t.matter0 = matterTotal(t); t.energy0 = energyTotal(t);
    const sumP = (x: MyceliumState) => x.P.reduce((a, v) => a + v, 0);
    const p0 = sumP(t);
    step(t);
    expect((sumP(t) - p0) / 128).toBe(3);
  });

  it("d follows the energy limit: a particle that cannot pay for the trail deposits less", () => {
    const s = createWorld(small({ founderEnergy: 12, depositCost: 4, upkeep: 0, moveCost: 0 }));
    s.genome.fill(0);
    for (let i = 0; i < s.n; i++) s.genome[i * NN_BYTES + B2_OFF + 3] = 127;
    s.matter0 = matterTotal(s); s.energy0 = energyTotal(s);
    // request 3 units at 4 each = 12 energy, but the step's mass upkeep (32 / 64 = 0.5, rounded stochastically) can leave 11 or 12: 2 or 3 units.
    const d = depositMeasure(s);
    expect(d).toBeGreaterThanOrEqual(2);
    expect(d).toBeLessThan(3.0001);
    expect(depositMeasure(createWorld(small({ founders: 0 })))).toBe(0);
  });

  it("the physarum null's d follows physarumDeposit: 0 deposits nothing, 256 one unit, 768 three", () => {
    const d = (v: number) => depositMeasure(createWorld(small({ controller: "physarum", heredity: "frozen", physarumDeposit: v })));
    expect(d(0)).toBe(0);
    expect(d(256)).toBe(1);
    expect(d(768)).toBe(3);
    const mid = d(128); // half a unit on average, drawn per particle: within sampling noise of 0.5
    expect(Math.abs(mid - 0.5)).toBeLessThan(0.15);
  });
});

/** A run series with the given scalar and heavy censuses, built by hand. */
function series(steps: number, f: { n: (t: number) => number; sumP: (t: number) => number; births: (t: number) => number; heavy?: (t: number) => Partial<Record<keyof R2bSeries["heavy"], number | null>> }): R2bSeries {
  const s = emptySeries();
  for (let t = 100; t <= steps; t += 100) {
    s.scalar.step.push(t); s.scalar.n.push(f.n(t)); s.scalar.sumP.push(f.sumP(t)); s.scalar.births.push(f.births(t)); s.scalar.refused.push(0);
  }
  for (let t = 500; t <= steps; t += 500) {
    const h = f.heavy?.(t) ?? {};
    s.heavy.step.push(t); s.heavy.n.push(f.n(t)); s.heavy.sumP.push(f.sumP(t));
    s.heavy.moran.push((h.moran as number) ?? 0); s.heavy.moranInvalid.push((h.moranInvalid as number) ?? 0);
    s.heavy.medianAge.push((h.medianAge as number | null) ?? null); s.heavy.sig.push((h.sig as number | null) ?? null);
    s.heavy.d.push((h.d as number) ?? 0); s.heavy.meanM.push(10); s.heavy.meanE.push(100); s.heavy.genotypes.push(1);
  }
  return s;
}

describe("runValues: every readout of a hand-built series", () => {
  // 1,000 scalar censuses: n = 1000 always; sum P = 5000 for steps <= 50,000 and 20,000 after; births grow 10 per census before the window and 30 inside it.
  const ser = series(100_000, {
    n: () => 1000,
    sumP: (t) => (t <= 50_000 ? 5000 : 20_000),
    births: (t) => (t <= 50_000 ? (t / 100) * 10 : 5000 + ((t - 50_000) / 100) * 30),
    heavy: (t) => ({ moran: t <= 50_000 ? 0.1 : 0.5, medianAge: t <= 75_000 ? 100 : 300, sig: 0.25, d: 2, moranInvalid: t === 100_000 ? 1 : 0 }),
  });

  it("TM, MI, AGE, TURN, SIG and d over the window (50,000, 100,000]", () => {
    const v = runValues(ser, R2B.LO, R2B.STEPS, null);
    expect(v.TM).toBe(20); // 20,000 / 1,000 at every census in the window
    expect(v.MI).toBeNull(); // the census at 100,000 is invalid, so there is no MI (the draft's zero-filled mean would have been 0.495)
    expect(v.AGE).toBeCloseTo((50 * 100 + 50 * 300) / 100, 12); // heavy censuses at 50,500..75,000 give 100 (50 of them), 75,500..100,000 give 300
    expect(v.TURN).toBeCloseTo((1000 * 500 * 30) / (50_000 * 1000), 12); // 15,000 births / (50,000 steps * mean n 1000) * 1000 = 0.3
    expect(v.TURN).toBeCloseTo(0.3, 12);
    expect(v.SIG).toBe(0.25);
    expect(v.d).toBe(2);
    expect(v.scalarCensuses).toBe(500);
    expect(v.heavyCensuses).toBe(100);
    expect(v.moranInvalidFraction).toBeCloseTo(0.01, 12);
    expect(v.minN).toBe(1000);
    expect(v.guardTripped).toBe(false);
    expect(v.REG).toBeNull(); // no tau
  });

  it("MI is the mean of Moran's I over all the window's censuses, and undefined when any of them is invalid (no zero fill, no selection by the mass cutoff)", () => {
    const mk = (invalidFrom: number) => series(100_000, { n: () => 1000, sumP: () => 5000, births: (t) => t, heavy: (t) => (t > invalidFrom ? { moran: 0, moranInvalid: 1 } : { moran: 0.4, moranInvalid: 0 }) });
    expect(runValues(mk(100_000), R2B.LO, R2B.STEPS, null).MI).toBeCloseTo(0.4, 12); // every census valid
    // the last census alone invalid: no MI (the zero-filled mean would have been 0.396, the valid-only mean 0.4: either would let the cutoff choose the data)
    const one = runValues(mk(99_500), R2B.LO, R2B.STEPS, null);
    expect(one.MI).toBeNull();
    expect(one.moranInvalidFraction).toBeCloseTo(0.01, 12);
    expect(runValues(mk(50_000), R2B.LO, R2B.STEPS, null).MI).toBeNull(); // no valid census at all
    expect(R2B.MI_MIN_VALID_FRACTION).toBe(1);
  });

  it("REG is the fraction of censuses with TM_t >= tau, inclusive", () => {
    expect(runValues(ser, R2B.LO, R2B.STEPS, 20).REG).toBe(1);
    expect(runValues(ser, R2B.LO, R2B.STEPS, 20.0001).REG).toBe(0);
    // a window that straddles the change: (45,000, 55,000] has 50 censuses at TM 5 and 50 at 20.
    expect(runValues(ser, 45_000, 55_000, 10).REG).toBeCloseTo(0.5, 12);
    expect(runValues(ser, R2B.LO, R2B.STEPS, 0).REG).toBe(1);
  });

  it("the guard trips on n below 200 at any scalar census in the window, not outside it, and a census with no particles counts 0 for TM", () => {
    const dip = series(100_000, { n: (t) => (t === 70_000 ? 199 : 1000), sumP: () => 1000, births: (t) => t });
    expect(runValues(dip, R2B.LO, R2B.STEPS, null).guardTripped).toBe(true);
    expect(runValues(dip, R2B.LO, R2B.STEPS, null).minN).toBe(199);
    const early = series(100_000, { n: (t) => (t === 30_000 ? 5 : 1000), sumP: () => 1000, births: (t) => t });
    expect(runValues(early, R2B.LO, R2B.STEPS, null).guardTripped).toBe(false);
    const exact = series(100_000, { n: (t) => (t === 70_000 ? 200 : 1000), sumP: () => 1000, births: (t) => t });
    expect(runValues(exact, R2B.LO, R2B.STEPS, null).guardTripped).toBe(false);
    const dead = series(100_000, { n: (t) => (t > 90_000 ? 0 : 1000), sumP: () => 1000, births: (t) => t });
    const v = runValues(dead, R2B.LO, R2B.STEPS, null);
    expect(v.guardTripped).toBe(true);
    expect(v.TM).toBeCloseTo((1 * 400) / 500 + 0 * (100 / 500), 12); // 400 censuses at 1000 / 1000 = 1, 100 at 0
  });

  it("the median TM is the median of the per-census TM", () => {
    const s = series(100_000, { n: () => 100 + 100, sumP: (t) => (t % 300 === 0 ? 10_000 : 200), births: (t) => t });
    const v = runValues(s, R2B.LO, R2B.STEPS, null);
    expect(v.medianTM).toBe(1); // two thirds of the censuses have TM 200 / 200 = 1
  });

  it("half-window drift is (second - first) / window mean for TM, n and sum P", () => {
    const s = series(100_000, { n: (t) => (t <= 75_000 ? 1000 : 1500), sumP: (t) => (t <= 75_000 ? 4000 : 8000), births: (t) => t });
    const d = halfWindowDrift(s, R2B.LO, R2B.STEPS);
    // n: first 1000, second 1500, mean 1250 -> 0.4; sum P: 4000 / 8000, mean 6000 -> 0.6667
    expect(d.n).toBeCloseTo(0.4, 12);
    expect(d.sumP).toBeCloseTo(4000 / 6000, 12);
    // TM: first 4, second 8 / 1.5 = 5.333, window mean (4 + 5.333) / 2 = 4.667 -> 1.3333 / 4.667
    expect(d.TM).toBeCloseTo((8 / 1.5 - 4) / ((4 + 8 / 1.5) / 2), 12);
  });

  it("cached values are checked against a recomputation, and an incomplete series is refused", () => {
    const values = runValues(ser, R2B.LO, R2B.STEPS, null);
    expect(verifyCached(ser, { lo: R2B.LO, hi: R2B.STEPS, values })).toEqual([]);
    expect(verifyCached(ser, { lo: R2B.LO, hi: R2B.STEPS, values: { ...values, TM: 21 } }).join()).toMatch(/TM is 21/);
    expect(seriesProblems(ser, 100_000)).toEqual([]);
    const short = JSON.parse(JSON.stringify(ser)) as R2bSeries;
    short.scalar.step.pop();
    expect(seriesProblems(short, 100_000).join()).toMatch(/scalar census steps/);
    const ragged = JSON.parse(JSON.stringify(ser)) as R2bSeries;
    ragged.heavy.moran.pop();
    expect(seriesProblems(ragged, 100_000).join()).toMatch(/heavy column moran/);
  });
});

describe("the streaming observer and run-file checks on a real short run", () => {
  const cfg = small({ seed: 3 });
  const s = createWorld(cfg);
  const obs = new R2bObserver(true);
  for (let t = 1; t <= 1000; t++) {
    step(s);
    if (t % 100 === 0) obs.scalar(s);
    if (t % 500 === 0) obs.heavy(s);
  }
  const ser = obs.series();

  it("keeps a census per 100 steps and per 500 steps, with real values", () => {
    expect(seriesProblems(ser, 1000)).toEqual([]);
    expect(ser.scalar.n.at(-1)).toBe(s.n);
    expect(ser.scalar.births.at(-1)).toBe(s.totals.births);
    expect(ser.scalar.sumP.at(-1)).toBe(s.P.reduce((a, v) => a + v, 0));
    expect(ser.heavy.genotypes.at(-1)).toBeGreaterThan(0);
    expect(ser.heavy.sig.at(-1)).not.toBeNull();
    expect(ser.heavy.d.at(-1)).toBeGreaterThanOrEqual(0);
    const v = runValues(ser, 500, 1000, null);
    expect(v.TM).toBeGreaterThanOrEqual(0);
    expect(v.TURN).toBeGreaterThan(0);
    expect(v.guardTripped).toBe(v.minN! < 200);
    expect(v.minN).toBe(Math.min(...ser.scalar.n.slice(5)));
  });

  it("refuses a census off the cadence or out of order, and the physarum observer keeps no SIG", () => {
    const o = new R2bObserver(false);
    const t = createWorld(small());
    for (let k = 0; k < 100; k++) step(t);
    o.scalar(t);
    expect(() => o.scalar(t)).toThrow(/increase/);
    expect(() => o.heavy(t)).toThrow(/multiple of 500/);
    for (let k = 0; k < 400; k++) step(t);
    o.heavy(t);
    expect(o.series().heavy.sig).toEqual([null]);
  });

  const file = (): RunFileLike => ({
    format: "mycelium-r2b-run-1", protocol: "mycelium-r2b", phase: "dev", arm: "inherit", seed: 3, steps: 1000, v: null, config: s.config, engine: "gpu", digest: stateDigest(s),
    ledgerChecks: 10, ledgerResidual: 0, codeHash: "c0de", cached: { lo: 500, hi: 1000, values: runValues(ser, 500, 1000, null) }, series: ser,
  });
  const want = { phase: "dev", arm: "inherit", seed: 3, steps: 1000, config: cfg, codeHash: "c0de", v: null };

  it("runFileProblems passes a good file and names each corruption", () => {
    expect(runFileProblems(file(), want)).toEqual([]);
    expect(runFileProblems({ ...file(), ledgerResidual: 1 }, want).join()).toMatch(/ledger residual 1/);
    expect(runFileProblems({ ...file(), ledgerChecks: 9 }, want).join()).toMatch(/9 ledger checks, expected 10/);
    expect(runFileProblems({ ...file(), codeHash: "other" }, want).join()).toMatch(/run under code other/);
    expect(runFileProblems({ ...file(), seed: 4 }, want).join()).toMatch(/the file is/);
    expect(runFileProblems({ ...file(), v: 100 }, want).join()).toMatch(/physarumDeposit 100/);
    expect(runFileProblems({ ...file(), config: { ...cfg, light: 4 } }, want).join()).toMatch(/not the arm's config/);
    const bad = file(); bad.cached.values = { ...bad.cached.values, TM: 999 };
    expect(runFileProblems(bad, want).join()).toMatch(/cached TM is 999/);
    expect(runFileProblems({ ...file(), engine: "cpu" }, want).join()).toMatch(/engine/);
  });

  it("encode of the run is unchanged by observing it (the observer only reads)", () => {
    const a = createWorld(cfg), b = createWorld(cfg);
    const o = new R2bObserver(true);
    for (let t = 1; t <= 500; t++) { step(a); step(b); if (t % 100 === 0) o.scalar(b); if (t === 500) o.heavy(b); }
    expect(Buffer.from(encode(a)).equals(Buffer.from(encode(b)))).toBe(true);
  });
});
