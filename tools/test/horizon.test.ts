// The stone horizon's pure core (tools/lib/horizon.ts; docs/garden-stone-horizon-2026-10-18.md): torus regions, the per-cell
// reduction and comparison, the horizon rule, the cap arithmetic, the readout, CPU twins on a small RefSim world, and the
// group driver with a fake segment runner.
import { describe, expect, it } from "vitest";
import { CH, G, cellCount, defaultConfig, initWorld, stateHash, type WorldState } from "@bl/schema";
import { RefSim, applyLesion } from "@bl/sim-ref";
import {
  ConservationFault,
  ControlFault,
  bindingError,
  censusGate,
  centreDraw,
  compactGroup,
  compactJson,
  compareRegions,
  fmix32,
  groupFits,
  groupWorstSeconds,
  horizonOf,
  livingIn,
  nearMask,
  nearNotAboveFar,
  ratio,
  readout,
  recomputePairs,
  runGroup,
  sideReadings,
  recordRadii,
  isFounding,
  signatureOf,
  sourceDepth,
  stoneCentre,
  torusDisc,
  wrapOffset,
  type GroupBinding,
  type GroupFile,
  type GroupIo,
  type HorizonPoint,
  type PairRecord,
  type Signature,
  type TwinPlan,
} from "../lib/horizon.ts";

/** MurmurHash3's fmix32 in BigInt arithmetic, an independent reference. */
function fmixRef(h0: bigint): number {
  const M = (1n << 32n) - 1n;
  let h = h0 & M;
  h ^= h >> 16n;
  h = (h * 0x85ebca6bn) & M;
  h ^= h >> 13n;
  h = (h * 0xc2b2ae35n) & M;
  h ^= h >> 16n;
  return Number(h);
}

const count = (m: Uint8Array) => m.reduce((s, v) => s + v, 0);

describe("fmix32 and the centre draw", () => {
  it("matches a BigInt reference", () => {
    expect(fmix32(0)).toBe(0);
    for (const v of [1, 2, 0x9e3779b1, 0xffffffff, 123456789]) expect(fmix32(v)).toBe(fmixRef(BigInt(v)));
  });
  it("mixes seed and step mod 2^32 as §2 writes it", () => {
    for (const [seed, N] of [[1, 131072], [3, 393216], [5, 262144]])
      expect(centreDraw(seed, N)).toBe(fmixRef(BigInt(seed) * 0x9e3779b1n + BigInt(N)));
  });
});

describe("torus regions", () => {
  it("wrapOffset matches §4's formula at 512", () => {
    for (const [x, cx] of [[0, 0], [511, 0], [0, 511], [300, 10], [10, 300], [256, 0]]) expect(wrapOffset(x, cx, 512)).toBe(((x - cx + 768) % 512) - 256);
  });
  it("discMask matches dx²+dy² ≤ r² and wraps", () => {
    let brute = 0;
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) if (dx * dx + dy * dy <= 9) brute++;
    const m = torusDisc(32, 32, 0, 0, 3);
    expect(count(m)).toBe(brute);
    expect(m[0 * 32 + 31]).toBe(1); // (31, 0) is dx = -1
    expect(m[31 * 32 + 31]).toBe(1); // (31, 31) is (-1, -1)
    expect(m[0 * 32 + 4]).toBe(0);
    expect(count(torusDisc(32, 32, 17, 5, 3))).toBe(brute); // the same under translation
    expect(count(torusDisc(40, 24, 39, 23, 5))).toBe(count(torusDisc(40, 24, 20, 12, 5)));
  });
  it("nearMask is the disc of twice the radius and refuses 4R ≥ min(W, H)", () => {
    expect(nearMask(32, 32, 3, 4, 2)).toEqual(torusDisc(32, 32, 3, 4, 4));
    expect(() => nearMask(32, 32, 0, 0, 8)).toThrow(/meets itself/);
    expect(() => nearMask(512, 512, 0, 0, 128)).toThrow(/meets itself/);
    expect(() => nearMask(512, 512, 0, 0, 64)).not.toThrow();
    expect(() => torusDisc(32, 32, 32, 0, 1)).toThrow(/off the/);
  });
});

/** A synthetic state of n cells with the given B, P and lineage per cell (genome words beyond the lineage set to junk). */
function synthState(n: number, cellsOf: (i: number) => { B: number; P: number; hi: number; lo: number }): { cells: Uint32Array; genome: Uint32Array } {
  const cells = new Uint32Array(7 * n), genome = new Uint32Array(44 * n);
  for (let i = 0; i < n; i++) {
    const c = cellsOf(i);
    cells[CH.B * n + i] = c.B;
    cells[CH.P * n + i] = c.P;
    genome[G.LIN_HI * n + i] = c.hi;
    genome[G.LIN_LO * n + i] = c.lo;
    genome[5 * n + i] = 77;
  }
  return { cells, genome };
}

describe("signatureOf and compareRegions", () => {
  it("signatureOf: B=0 is EMPTY whatever the genome words", () => {
    const s = signatureOf(synthState(4, (i) => ({ B: i === 0 ? 0 : 5, P: 3, hi: 9, lo: i + 1 })));
    expect([...s.alive]).toEqual([0, 1, 1, 1]);
    expect(s.labHi[0]).toBe(0);
    expect(s.labLo[0]).toBe(0);
    expect([...s.bp]).toEqual([3, 8, 8, 8]);
    expect(s.living).toBe(3);
  });
  it("both-empty cells are in neither union nor diff; identical inputs give zeros", () => {
    const a = signatureOf(synthState(6, (i) => ({ B: i < 3 ? 0 : 1, P: 0, hi: 7, lo: 7 })));
    const b = signatureOf(synthState(6, (i) => ({ B: i < 3 ? 0 : 1, P: 0, hi: 1, lo: 1 }))); // dead cells' genome words differ
    const mask = Uint8Array.from([1, 1, 1, 0, 0, 0]);
    const same = compareRegions(a, a, mask);
    expect(same.near).toEqual({ cells: 3, union: 0, diff: 0, bpUnion: 0, bpDiff: 0 });
    expect(same.far).toEqual({ cells: 3, union: 3, diff: 0, bpUnion: 3, bpDiff: 0 });
    const d = compareRegions(a, b, mask);
    expect(d.near).toEqual({ cells: 3, union: 0, diff: 0, bpUnion: 0, bpDiff: 0 }); // both empty: same label
    expect(d.far.diff).toBe(3); // living, other lineage
  });
  it("counts alive-in-one-only as a difference and B+P alone in the light cone", () => {
    const a = signatureOf(synthState(3, (i) => ({ B: [1, 0, 2][i], P: [0, 4, 0][i], hi: 1, lo: 1 })));
    const b = signatureOf(synthState(3, (i) => ({ B: [0, 0, 3][i], P: [0, 5, 0][i], hi: 1, lo: 1 })));
    const c = compareRegions(a, b, new Uint8Array(3));
    expect(c.far).toEqual({ cells: 3, union: 2, diff: 1, bpUnion: 3, bpDiff: 3 });
  });
});

describe("nearNotAboveFar", () => {
  it("compares the ratios by integer cross-multiplication", () => {
    expect(nearNotAboveFar({ diff: 1, union: 3 }, { diff: 2, union: 6 })).toBe(true); // equal is not above
    expect(nearNotAboveFar({ diff: 2, union: 5 }, { diff: 1, union: 3 })).toBe(false);
    expect(nearNotAboveFar({ diff: 0, union: 0 }, { diff: 0, union: 0 })).toBe(true); // empty union counts 0
    expect(nearNotAboveFar({ diff: 1, union: 4 }, { diff: 0, union: 0 })).toBe(false);
    expect(nearNotAboveFar({ diff: 0, union: 4 }, { diff: 0, union: 0 })).toBe(true);
    expect(nearNotAboveFar({ diff: 262_143, union: 262_144 }, { diff: 262_144, union: 262_144 })).toBe(true);
  });
});

const pt = (k: number, nd: number, fd: number, extinct = false): HorizonPoint => ({ k, near: { diff: nd, union: 100 }, far: { diff: fd, union: 100 }, extinct });
const series = (pattern: string) => [...pattern].map((c, j) => (c === "x" ? pt(j + 1, 0, 0, true) : c === "1" ? pt(j + 1, 1, 5) : pt(j + 1, 9, 5)));
const H = { K: 4, kMax: 10, censusEvery: 1024 };

describe("horizonOf", () => {
  it("rejects a single dip", () => {
    expect(horizonOf(series("0010000"), H)).toEqual({ kind: "pending" });
  });
  it("the first run of four decides, at its first census", () => {
    expect(horizonOf(series("00111011110"), H)).toEqual({ kind: "horizon", k: 7, steps: 7 * 1024 - 1, decidedAt: 10 });
    expect(horizonOf(series("1111"), H)).toEqual({ kind: "horizon", k: 1, steps: 1023, decidedAt: 4 });
  });
  it("is censored when no run of four starts by kMax", () => {
    expect(horizonOf(series("0000000000"), H)).toEqual({ kind: "censored", window: 10 * 1024 - 1, decidedAt: 10 });
    expect(horizonOf(series("000000000111"), H)).toEqual({ kind: "pending" }); // a run from 10 is still possible
    expect(horizonOf(series("0000000001110"), H)).toEqual({ kind: "censored", window: 10 * 1024 - 1, decidedAt: 13 });
    expect(horizonOf(series("0000000001111"), H)).toEqual({ kind: "horizon", k: 10, steps: 10 * 1024 - 1, decidedAt: 13 });
  });
  it("all zero at k = 1 is no mark", () => {
    expect(horizonOf([pt(1, 0, 0), pt(2, 3, 0)], H)).toEqual({ kind: "no-mark", decidedAt: 1 });
  });
  it("extinction before a decision is extinct", () => {
    expect(horizonOf(series("011x1111"), H)).toEqual({ kind: "extinct", k: 4, decidedAt: 4 });
    expect(horizonOf(series("1111x"), H).kind).toBe("horizon"); // decided before
  });
  it("refuses a series that skips a census", () => {
    expect(() => horizonOf([pt(1, 1, 1), pt(3, 1, 1)], H)).toThrow(/labelled/);
  });
});

describe("stoneCentre", () => {
  const n = 64, W = 8;
  const cells = new Uint32Array(7 * n);
  for (const i of [3, 10, 41, 63]) cells[CH.B * n + i] = 1;
  it("is deterministic and picks the draw's living cell in index order", () => {
    const c = stoneCentre(cells, n, W, 1, 131072)!;
    const want = [3, 10, 41, 63][centreDraw(1, 131072) % 4];
    expect(c).toEqual({ x: want % W, y: Math.floor(want / W), index: want, living: 4 });
    expect(stoneCentre(cells, n, W, 1, 131072)).toEqual(c);
    expect(cells[CH.B * n + stoneCentre(cells, n, W, 2, 262144)!.index]).toBeGreaterThan(0);
  });
  it("returns null on an extinct world", () => {
    expect(stoneCentre(new Uint32Array(7 * n), n, W, 1, 1)).toBeNull();
  });
});

describe("the cap", () => {
  const base = { pilotSeconds: 600, srcRate: 400, twinRate: 400, capSeconds: 6 * 3600, factor: 0.75, wander: 131072, censusEvery: 1024, K: 4, control: 16, seeds: 3 };
  it("a group's worst case is U0 and three stones to census 131, plus the control", () => {
    expect(groupWorstSeconds(base, 128)).toBeCloseTo(((4 * 131 + 16) * 1024) / 300, 6);
    expect(groupWorstSeconds(base, 64)).toBeCloseTo(((4 * 67 + 16) * 1024) / 300, 6);
  });
  it("sourceDepth picks the largest depth that fits", () => {
    // sources(d) = 3 d 131072 / 300 = 1310.72 d s; group worst = 1843.2 s; pilot 600.
    expect(sourceDepth(base)).toMatchObject({ depth: 3, kMax: 128, fallback: false });
    expect(sourceDepth({ ...base, capSeconds: 600 + 2 * 1310.72 + 3 * 1843.2 + 1 })).toMatchObject({ depth: 2, kMax: 128 });
    expect(sourceDepth({ ...base, capSeconds: 600 + 1310.72 + 3 * 1843.2 })).toMatchObject({ depth: 1, kMax: 128 });
  });
  it("falls back to d = 1 and a 64-census window when nothing fits", () => {
    expect(sourceDepth({ ...base, capSeconds: 3600 })).toMatchObject({ depth: 1, kMax: 64, fallback: true });
  });
  it("groupFits compares the worst case with what is left", () => {
    expect(groupFits(100, 100)).toBe(true);
    expect(groupFits(99, 100)).toBe(false);
  });
});

describe("readout", () => {
  const o = { kMax: 128, censusEvery: 1024, wound: 13000, wander: 131072 };
  const h = (seed: number, R: number, steps: number): PairRecord => ({ seed, N: 131072, R, outcome: { kind: "horizon", k: (steps + 1) / 1024, steps, decidedAt: 0 } });
  const cen = (seed: number, R: number): PairRecord => ({ seed, N: 131072, R, outcome: { kind: "censored", window: 131071, decidedAt: 131 } });
  it("censored sorts above measured; the even-count median is the lower middle", () => {
    const r = readout([cen(1, 32), h(2, 32, 50175), h(3, 32, 2047), h(4, 32, 9215)], o).radii[0];
    expect(r.valid.map((v) => v.steps)).toEqual([2047, 9215, 50175, null]);
    expect(r.median).toEqual({ steps: 9215 });
    expect(r.verdict).toMatch(/a mark with no lasting effect: median 9,215 steps, also under/);
  });
  it("R = 8: holds, holds in the median, fails", () => {
    expect(readout([h(1, 8, 1023), h(2, 8, 4095), h(3, 8, 12287)], o).radii[0].verdict).toMatch(/the prediction holds: every valid horizon \(3\)/);
    expect(readout([h(1, 8, 1023), h(2, 8, 4095), cen(3, 8)], o).radii[0].verdict).toMatch(/holds in the median \(4,095 steps\); 1 of 3/);
    expect(readout([h(1, 8, 1023), h(2, 8, 13311), cen(3, 8)], o).radii[0].verdict).toMatch(/fails: the median is 13,311 steps/);
    expect(readout([h(1, 8, 1023), cen(2, 8), cen(3, 8)], o).radii[0].verdict).toMatch(/fails: the median is censored/);
  });
  it("meteor, mark, the pace on R = 32, and exclusions", () => {
    const ro = readout([cen(1, 32), cen(2, 32), h(3, 32, 1023), { seed: 4, N: 1, R: 32, outcome: { kind: "extinct", k: 2, decidedAt: 2 } }, h(1, 64, 20479)], o);
    expect(ro.radii[0]).toMatchObject({ R: 32, median: { steps: null } });
    expect(ro.radii[0].verdict).toMatch(/a meteor/);
    expect(ro.radii[0].excluded).toEqual([{ seed: 4, N: 1, kind: "extinct" }]);
    expect(ro.radii[1].verdict).toMatch(/R = 64: a mark with no lasting effect: median 20,479 steps, not under/);
    expect(ro.pace).toMatch(/censored: a stone outlasts one wander/);
    expect(readout([h(1, 32, 4095)], o).pace).toMatch(/the day stays one wander/);
    expect(readout([h(1, 8, 4095)], o).pace).toMatch(/no reading/);
    expect(readout([{ seed: 1, N: 1, R: 8, outcome: { kind: "not-run-cap" } }], o).radii[0].verdict).toMatch(/no reading/);
  });
  it("defers the meteor call and the pace under the fallback window", () => {
    const ro = readout([{ seed: 1, N: 1, R: 32, outcome: { kind: "censored", window: 65535, decidedAt: 64 } }], { ...o, kMax: 64 });
    expect(ro.radii[0].verdict).toMatch(/fallback window \(legible beyond 65,535 steps\): the meteor call is deferred/);
    expect(ro.pace).toMatch(/deferred/);
  });
});

/** A small CPU world (the lineage fixture's settings) for twins. */
function smallWorld(): WorldState {
  const cfg = defaultConfig({ tileW: 32, tileH: 32, kernelRadius: 4, seed: 23 });
  return initWorld(cfg, { kind: "m3", founders: 13, nutrient: 256, biomass: 256 });
}
const clone = (s: WorldState): WorldState => ({ ...s, cells: s.cells.slice(), genome: s.genome.slice(), flux: [...s.flux] });

describe("CPU twins on a 32×32 RefSim", () => {
  it("without a stone the twins are identical at every census; a stone marks near and not far, then spreads", () => {
    const s0 = smallWorld();
    const u0 = new RefSim(clone(s0)), u1 = new RefSim(clone(s0)), st = new RefSim(clone(s0));
    const n = cellCount(s0.cfg);
    for (let t = 0; t < 40; t++) (u0.step(), u1.step(), st.step());
    const c = stoneCentre(st.state.cells, n, 32, 1, 40)!;
    expect(c).not.toBeNull();
    const R = 3;
    const mask = nearMask(32, 32, c.x, c.y, R);
    const before = signatureOf(st.state);
    applyLesion(st, c.x, c.y, R);
    // The lesion clears exactly the lesion's own disc: every cell of torusDisc is dead after it, and no cell outside changed.
    const disc = torusDisc(32, 32, c.x, c.y, R);
    const after = signatureOf(st.state);
    for (let i = 0; i < n; i++) {
      if (disc[i]) expect(after.alive[i]).toBe(0);
      else expect([after.alive[i], after.labHi[i], after.labLo[i], after.bp[i]]).toEqual([before.alive[i], before.labHi[i], before.labLo[i], before.bp[i]]);
    }
    const at0 = compareRegions(after, signatureOf(u0.state), mask);
    expect(at0.near.diff).toBeGreaterThan(0);
    expect(at0.far.diff).toBe(0);
    let spread = false;
    for (let k = 1; k <= 6; k++) {
      for (let t = 0; t < 5; t++) (u0.step(), u1.step(), st.step());
      expect(stateHash(u1.state)).toBe(stateHash(u0.state));
      const ctl = compareRegions(signatureOf(u1.state), signatureOf(u0.state), mask);
      expect(ctl.near.diff + ctl.far.diff + ctl.near.bpDiff + ctl.far.bpDiff).toBe(0);
      const cmp = compareRegions(signatureOf(st.state), signatureOf(u0.state), mask);
      // Five steps on, near is still above far; on this 1,024-cell carpet the whole jar has diverged by 15 steps, after which
      // the label measure's ceiling is lower near the stone (its few local lineages regrow in place), so later censuses are not asserted.
      if (k === 1) expect(nearNotAboveFar(cmp.near, cmp.far)).toBe(false);
      if (cmp.far.bpDiff > 0) spread = true;
    }
    expect(spread).toBe(true); // the light cone has left the near disc by 30 steps
  });
});

// ---- The group driver with a fake segment runner (synthetic signatures, no physics)

const NN = 40; // cells; the near mask is the first 10
const MASK = Uint8Array.from({ length: NN }, (_, i) => (i < 10 ? 1 : 0));
function sigOf(nearDiff: number, farDiff: number, living = NN): Signature {
  // Every cell alive with lineage (1, 1), except the first `nearDiff` near cells and first `farDiff` far cells, lineage (2, 2).
  return signatureOf(synthState(NN, (i) => {
    const differs = i < 10 ? i < nearDiff : i - 10 < farDiff;
    return { B: i < living ? 1 : 0, P: 0, hi: differs ? 2 : 1, lo: differs ? 2 : 1 };
  }));
}

interface FakeCall { twin: string; firstK: number; censuses: number }
/** A fake io: each twin's census k is `behave(twin, k)`; a twin's continuation is just its last census. */
function fakeIo(
  behave: (twin: TwinPlan, k: number) => Signature,
  opts: { deadline?: number; hash?: (twin: string) => string | null; short?: (twin: string) => number; appliedR?: (R: number) => number | null; tick?: (twin: string) => number } = {},
) {
  const calls: FakeCall[] = [];
  let clock = 0;
  const io: GroupIo<number> = {
    deadline: opts.deadline ?? Infinity,
    now: () => clock,
    async runSegment(twin, from, firstK, censuses, onCensus) {
      if ((from ?? 0) !== firstK - 1) throw new Error(`${twin.name}: continuation ${from} for census ${firstK}`);
      calls.push({ twin: twin.name, firstK, censuses });
      clock += opts.tick ? opts.tick(twin.name) : censuses;
      // The runner logs a lesion when it applies it (step N + 1), before any census, so a stopped segment carries it too.
      const r = twin.stone && firstK === 1 ? (opts.appliedR ? opts.appliedR(twin.stone.r) : twin.stone.r) : null;
      const applied = twin.stone && r !== null ? [{ step: twin.stone.step, r }] : [];
      let reached = firstK - 1;
      const last = firstK + censuses - (opts.short ? opts.short(twin.name) : 0);
      for (let k = firstK; k < last; k++) {
        reached = k;
        if (onCensus(k, behave(twin, k))) return { next: null, finalHash: null, stopStateHash: `stop-${twin.name}-${k}`, reached, applied, seconds: 1 };
      }
      return { next: reached, finalHash: opts.hash ? opts.hash(twin.name) : `h-${twin.name.startsWith("U") ? "U" : twin.name}-${reached}`, stopStateHash: null, reached, applied, seconds: 1 };
    },
  };
  return { io, calls };
}
const plan = (radii: number[], kMax = 10, chunk = 4) => ({
  centre: { x: 0, y: 0 },
  radii,
  masks: new Map(radii.map((R) => [R, MASK])),
  chunk,
  horizon: { K: 4, kMax, censusEvery: 1024 },
  stoneStep: 4097,
});
/** Stone R's near differs (5 of 10) before census `until`, then matches; far differs 1 of 30 throughout. */
const fading = (until: Record<string, number>) => (twin: TwinPlan, k: number) => (twin.stone ? sigOf(k < until[twin.name] ? 5 : 0, 1) : sigOf(0, 0));

describe("runGroup with a fake runSegment", () => {
  it("decides each stone, does not run a decided stone again, and stops U0 once all stones stopped", async () => {
    const { io, calls } = fakeIo(fading({ S8: 2, S32: 6, S64: 1000 }));
    const g = await runGroup(io, plan([8, 32, 64]));
    const byR = Object.fromEntries(g.stones.map((s) => [s.R, s]));
    expect(byR[8].outcome).toEqual({ kind: "horizon", k: 2, steps: 2047, decidedAt: 5 });
    expect(byR[32].outcome).toEqual({ kind: "horizon", k: 6, steps: 6143, decidedAt: 9 });
    expect(byR[64].outcome).toEqual({ kind: "censored", window: 10239, decidedAt: 10 });
    expect(byR[8].effectiveR).toBe(8);
    expect(byR[8].stopStateHash).toBe("stop-S8-5");
    expect(byR[8].reached).toBe(5);
    expect(g.control).toMatchObject({ censuses: 4, diff: 0, bpDiff: 0, ok: true });
    // Chunks of 4 to census 13 (kMax 10 + K - 1): S8 decided in chunk 2 is absent from chunk 3; U1 only in chunk 1.
    expect(calls.filter((c) => c.twin === "S8").map((c) => c.firstK)).toEqual([1, 5]);
    expect(calls.filter((c) => c.twin === "U1").map((c) => c.firstK)).toEqual([1]);
    // S32 and S64 are decided in chunk 3 (censuses 9..12), so U0 never runs chunk 4.
    expect(calls.filter((c) => c.twin === "U0").map((c) => c.firstK)).toEqual([1, 5, 9]);
    expect(g.u0.reached).toBe(12);
    expect(g.stoppedByCap).toBe(false);
  });
  it("runs to the last census K - 1 past kMax with a short final chunk", async () => {
    const { io, calls } = fakeIo(fading({ S8: 10 }));
    const g = await runGroup(io, plan([8], 10, 4));
    expect(g.stones[0].outcome).toEqual({ kind: "horizon", k: 10, steps: 10239, decidedAt: 13 });
    expect(calls.filter((c) => c.twin === "U0").map((c) => [c.firstK, c.censuses])).toEqual([[1, 4], [5, 4], [9, 4], [13, 1]]);
  });
  it("a no-mark stone and an extinct pair are decided at once", async () => {
    const { io } = fakeIo((twin, k) => (twin.name === "S8" ? sigOf(0, 0) : twin.name === "S32" ? sigOf(5, 1, k >= 2 ? 0 : NN) : sigOf(0, 0)));
    const g = await runGroup(io, plan([8, 32]));
    expect(g.stones[0].outcome).toEqual({ kind: "no-mark", decidedAt: 1 });
    expect(g.stones[1].outcome).toEqual({ kind: "extinct", k: 2, decidedAt: 2 });
  });
  it("a control mismatch voids the group and throws", async () => {
    const { io } = fakeIo((twin, k) => (twin.name === "U1" && k === 3 ? sigOf(0, 1) : twin.stone ? sigOf(5, 1) : sigOf(0, 0)));
    await expect(runGroup(io, plan([8]))).rejects.toThrow(ControlFault);
    const h = fakeIo(fading({ S8: 2 }), { hash: (t) => `x-${t}` });
    await expect(runGroup(h.io, plan([8]))).rejects.toThrow(/hashes x-U0 vs x-U1/);
  });
  it("past the deadline the group stops at the end of its chunk: stopped (cap)", async () => {
    const { io, calls } = fakeIo(fading({ S8: 1, S32: 1000 }), { deadline: 10 });
    const g = await runGroup(io, plan([8, 32], 20));
    expect(g.stoppedByCap).toBe(true);
    expect(g.stones[0].outcome.kind).toBe("horizon");
    expect(g.stones[1].outcome).toEqual({ kind: "stopped-cap", reached: 4 });
    // Chunk 1 costs U0 4 + U1 4 + S8 4 + S32 4 = 16 > 10 on the fake clock, so no second chunk runs.
    expect(calls.map((c) => c.firstK)).toEqual([1, 1, 1, 1]);
  });
});

describe("compactJson", () => {
  it("keeps number arrays on one line and round-trips", () => {
    const v = { a: [0.5, 1, -2, 1e-7], b: { c: [], d: [1, "x"], e: [[1, 2], [3]] }, f: null };
    const t = compactJson(v);
    expect(JSON.parse(t)).toEqual(v);
    expect(t).toContain('"a": [0.5,1,-2,1e-7]');
    expect(t).toContain("[1,2]");
  });
  it("never rewrites strings, even ones that look like number arrays or like its placeholder", () => {
    const v = { s: "literal [1, 2]", p: "/tmp/run [ 1 ]/x", tag: "numarr0", k: { "numarr1": [3, 4] }, a: [5, 6] };
    const t = compactJson(v);
    expect(JSON.parse(t)).toEqual(v);
    expect(t).toContain('"literal [1, 2]"');
    expect(t).toContain('"/tmp/run [ 1 ]/x"');
    expect(t).toContain('"numarr1": [3,4]');
    expect(t).toContain('"a": [5,6]');
    expect(compactJson([1, 2])).toBe("[1,2]");
  });
});

// ---- Review fixes (2026-10-18): coverage the first version lacked

describe("signatureOf and compareRegions: both lineage words", () => {
  it("a lineage differing only in LIN_HI, or only in LIN_LO, is a difference", () => {
    const a = signatureOf(synthState(3, () => ({ B: 1, P: 0, hi: 5, lo: 6 })));
    const hiOnly = signatureOf(synthState(3, (i) => ({ B: 1, P: 0, hi: i === 0 ? 9 : 5, lo: 6 })));
    const loOnly = signatureOf(synthState(3, (i) => ({ B: 1, P: 0, hi: 5, lo: i === 1 ? 9 : 6 })));
    expect([...hiOnly.labHi]).toEqual([9, 5, 5]);
    expect([...loOnly.labLo]).toEqual([6, 9, 6]);
    expect(compareRegions(a, hiOnly, new Uint8Array(3)).far).toMatchObject({ diff: 1, bpDiff: 1 });
    expect(compareRegions(a, loOnly, new Uint8Array(3)).far).toMatchObject({ diff: 1, bpDiff: 1 });
  });
});

describe("livingIn and ratio", () => {
  it("livingIn counts B > 0 inside the mask and the mask's size", () => {
    const st = synthState(6, (i) => ({ B: [0, 2, 3, 0, 1, 1][i], P: 0, hi: 1, lo: 1 }));
    expect(livingIn(st.cells, 6, Uint8Array.from([1, 1, 1, 1, 0, 0]))).toEqual({ living: 2, cells: 4 });
    expect(livingIn(st.cells, 6, new Uint8Array(6))).toEqual({ living: 0, cells: 0 });
  });
  it("ratio rounds diff / union to four places and reads an empty union as 0", () => {
    expect(ratio({ diff: 1, union: 3 })).toBe(0.3333);
    expect(ratio({ diff: 2, union: 3 })).toBe(0.6667);
    expect(ratio({ diff: 0, union: 0 })).toBe(0);
    expect(ratio({ diff: 1, union: 8 }, 2)).toBe(0.13);
  });
});

describe("torus regions: index layout and the lesion's own disc across the edge", () => {
  it("a non-square torus is indexed y * W + x", () => {
    const m = torusDisc(40, 24, 39, 23, 5);
    expect(m[23 * 40 + 39]).toBe(1); // the centre
    expect(m[0 * 40 + 0]).toBe(1); // (0, 0) is (+1, +1)
    expect(m[23 * 40 + 4]).toBe(1); // (4, 23) is (+5, 0)
    expect(m[23 * 40 + 5]).toBe(0); // (5, 23) is (+6, 0)
    expect(m[4 * 40 + 39]).toBe(1); // (39, 4) is (0, +5)
    expect(m[5 * 40 + 39]).toBe(0); // (39, 5) is (0, +6)
  });
  it("applyLesion clears exactly torusDisc, also where the disc wraps", () => {
    const s0 = smallWorld();
    const n = cellCount(s0.cfg);
    for (const [cx, cy, R] of [[0, 31, 3], [31, 0, 5], [1, 1, 4], [30, 16, 6]]) {
      const s = clone(s0);
      for (let i = 0; i < n; i++) s.cells[CH.B * n + i] = 1; // every cell alive
      applyLesion(new RefSim(s), cx, cy, R);
      const disc = torusDisc(32, 32, cx, cy, R);
      const cleared = Uint8Array.from({ length: n }, (_, i) => (s.cells[CH.B * n + i] === 0 ? 1 : 0));
      expect(cleared).toEqual(disc);
    }
  });
});

describe("horizonOf: no mark only at census 1", () => {
  it("both diffs 0 at a later census is not no-mark", () => {
    expect(horizonOf([pt(1, 9, 5), pt(2, 0, 0), pt(3, 0, 0), pt(4, 0, 0), pt(5, 0, 0)], H)).toEqual({ kind: "horizon", k: 2, steps: 2047, decidedAt: 5 });
  });
});

describe("the cap: the fallback's numbers", () => {
  it("sourceDepth's fallback reports the 64-census worst case and its budget", () => {
    const c = { pilotSeconds: 600, srcRate: 400, twinRate: 400, capSeconds: 3600, factor: 0.75, wander: 131072, censusEvery: 1024, K: 4, control: 16, seeds: 3 };
    const d = sourceDepth(c);
    expect(d.groupWorst).toBeCloseTo(groupWorstSeconds(c, 64), 9);
    expect(d.budget).toBeCloseTo(600 + (3 * 131072) / 300 + 3 * groupWorstSeconds(c, 64), 6);
  });
});

describe("readout: the window's edge", () => {
  it("a measured median exactly at the window is a mark (§8 amended: at or under), not a meteor", () => {
    const o = { kMax: 128, censusEvery: 1024, wound: 13000, wander: 131072 };
    const r = readout([{ seed: 1, N: 1, R: 32, outcome: { kind: "horizon", k: 128, steps: 131071, decidedAt: 131 } }], o);
    expect(r.radii[0].verdict).toMatch(/a mark with no lasting effect: median 131,071 steps/);
    const f = readout([{ seed: 1, N: 1, R: 64, outcome: { kind: "horizon", k: 64, steps: 65535, decidedAt: 67 } }], { ...o, kMax: 64 });
    expect(f.radii[0].verdict).toMatch(/a mark with no lasting effect: median 65,535 steps/);
  });
});

describe("runGroup: the control's other terms, the effective radius and the deadline guard", () => {
  it("a light-cone-only difference in U1 (same lineages, other B + P) is a control fault", async () => {
    const bpOnly = () => {
      const s = signatureOf(synthState(NN, () => ({ B: 1, P: 0, hi: 1, lo: 1 })));
      s.bp[3] = 7;
      return s;
    };
    const { io } = fakeIo((twin, k) => (twin.name === "U1" && k === 2 ? bpOnly() : twin.stone ? sigOf(5, 1) : sigOf(0, 0)));
    await expect(runGroup(io, plan([8]))).rejects.toThrow(/diff 0, light-cone 1/);
  });
  it("a control that ends early, or two missing hashes, is a control fault", async () => {
    const early = fakeIo(fading({ S8: 2 }), { short: (t) => (t === "U1" ? 1 : 0) });
    await expect(runGroup(early.io, plan([8]))).rejects.toThrow(/control U1 differs from U0: 3 censuses/);
    const nul = fakeIo(fading({ S8: 2 }), { hash: () => null });
    await expect(runGroup(nul.io, plan([8]))).rejects.toThrow(ControlFault);
  });
  it("throws when the lesion applied with another radius, or not at all", async () => {
    const clamped = fakeIo(fading({ S8: 2, S32: 2 }), { appliedR: (r) => (r === 32 ? 31 : r) });
    await expect(runGroup(clamped.io, plan([8, 32]))).rejects.toThrow(/S32: the lesion at step 4097 applied with radius 31, not 32/);
    const missing = fakeIo(fading({ S8: 2 }), { appliedR: () => null });
    await expect(runGroup(missing.io, plan([8]))).rejects.toThrow(/applied with radius null, not 8/);
  });
  it("past the deadline on the chunk where the last stone decides, nothing is stopped by the cap", async () => {
    const { io } = fakeIo(fading({ S8: 1 }), { deadline: 1 });
    const g = await runGroup(io, plan([8]));
    expect(g.stones[0].outcome.kind).toBe("horizon");
    expect(g.stoppedByCap).toBe(false);
  });
});

describe("censusGate (the CLI sink's census logic)", () => {
  const line = (step: number, ok = true) => JSON.stringify({ step, conservationOk: ok }) + "\n";
  it("turns census checkpoints into k in sequence and ignores other files", () => {
    const g = censusGate({ name: "S8", N: 4096, censusEvery: 1024, firstK: 3 });
    expect(g.checkpoint("checkpoints/b001-pre.blck", 7168)).toBeNull();
    expect(g.checkpoint("final.blck", 7168)).toBeNull();
    g.series(line(7168));
    expect(g.checkpoint("checkpoints/t7168.blck", 7168)).toBe(3);
    g.series(line(8192));
    expect(g.checkpoint("checkpoints/t8192.blck", 8192)).toBe(4);
    expect(g.reached).toBe(4);
  });
  it("refuses a skipped census and a checkpoint without its series line", () => {
    const g = censusGate({ name: "U0", N: 0, censusEvery: 1024, firstK: 1 });
    g.series(line(2048));
    expect(() => g.checkpoint("checkpoints/t2048.blck", 2048)).toThrow(/k = 2, expected 1/);
    const h = censusGate({ name: "U0", N: 0, censusEvery: 1024, firstK: 1 });
    expect(() => h.checkpoint("checkpoints/t1024.blck", 1024)).toThrow(/without its census line/);
  });
  it("a census line with conservationOk false throws a ConservationFault before the checkpoint can decide", () => {
    const g = censusGate({ name: "S8", N: 0, censusEvery: 1024, firstK: 1 });
    g.series(line(1024));
    expect(g.checkpoint("checkpoints/t1024.blck", 1024)).toBe(1);
    expect(() => g.series(line(2048, false))).toThrow(ConservationFault);
    expect(() => g.checkpoint("checkpoints/t2048.blck", 2048)).toThrow(ConservationFault);
  });
});

describe("bindingError", () => {
  const b: GroupBinding = { seed: 1, N: 131072, checkpointHash: "ab", radii: [8, 32, 64], K: 4, kMax: 128, censusEvery: 1024, chunk: 16, stoneStep: 131073, centre: { x: 1, y: 2 } };
  it("agrees with itself and names the first field that differs", () => {
    expect(bindingError(b, { ...b })).toBeNull();
    expect(bindingError(b, { ...b, kMax: 64 })).toMatch(/kMax is 128 in the group file, 64 in this run/);
    expect(bindingError(b, { ...b, radii: [8, 32] })).toMatch(/radii/);
    expect(bindingError(b, { ...b, checkpointHash: "cd" })).toMatch(/checkpointHash/);
    expect(bindingError(b, { ...b, centre: { x: 1, y: 3 } })).toMatch(/centre/);
    expect(bindingError(undefined, b)).toMatch(/no binding/);
  });
});

describe("the record: integer counts, recomputed outcomes, side readings", () => {
  async function group(): Promise<GroupFile> {
    const { io } = fakeIo(fading({ S8: 2, S32: 6, S64: 1000 }));
    const result = await runGroup(io, plan([8, 32, 64]));
    const disc = { living: 1, cells: 2 };
    return { seed: 1, N: 4096, status: "done", centre: { x: 0, y: 0, living: NN }, stones: [8, 32, 64].map((R) => ({ R, stoneDisc: disc, nearDisc: disc })), result };
  }
  it("compactGroup keeps the integer counts and U0's living cells per census", async () => {
    const c = compactGroup(await group(), [8, 32, 64]);
    const s8 = c.stones!.find((s) => s.R === 8)!;
    expect(s8.nearDiff).toEqual([5, 0, 0, 0, 0]);
    expect(s8.nearUnion).toEqual([10, 10, 10, 10, 10]);
    expect(s8.farDiff).toEqual([1, 1, 1, 1, 1]);
    expect(s8.farUnion).toEqual([30, 30, 30, 30, 30]);
    expect(s8.living).toEqual([NN, NN, NN, NN, NN]);
    expect(c.u0!.living).toHaveLength(10); // the longest series (S64, censored at census 10)
    expect(s8.livingFraction).toEqual({ stone: 0.5, near: 0.5 });
  });
  it("recomputePairs reruns the rule from the counts and refuses a record whose outcome disagrees", async () => {
    const c = compactGroup(await group(), [8, 32, 64]);
    const pairs = recomputePairs([c] as Parameters<typeof recomputePairs>[0], [8, 32, 64], { K: 4, kMax: 10, censusEvery: 1024 });
    expect(pairs.map((p) => p.outcome.kind)).toEqual(["horizon", "horizon", "censored"]);
    // A stored outcome the counts do not give fails loudly.
    const bad = structuredClone(c);
    bad.stones![0].outcome = { kind: "horizon", k: 1, steps: 1023, decidedAt: 4 };
    expect(() => recomputePairs([bad] as Parameters<typeof recomputePairs>[0], [8, 32, 64], { K: 4, kMax: 10, censusEvery: 1024 })).toThrow(/R 8: the record's counts give/);
    expect(recomputePairs([{ seed: 2, N: 4096, status: "not run (cap)" }], [8], { K: 4, kMax: 10, censusEvery: 1024 })[0].outcome).toEqual({ kind: "not-run-cap" });
  });
  it("sideReadings classifies how each horizon was decided, from the counts", () => {
    const stone = (R: number, nd: number[], fd: number[], k: number | null) => ({
      R,
      outcome: k === null ? ({ kind: "censored", window: 1, decidedAt: 1 } as const) : ({ kind: "horizon", k, steps: k * 1024 - 1, decidedAt: k + 3 } as const),
      nearDiff: nd,
      nearUnion: nd.map(() => 100),
      farDiff: fd,
      farUnion: fd.map(() => 100),
      living: nd.map(() => 1),
    });
    const rising = stone(8, [50, 50, 50, 50, 50], [20, 60, 70, 80, 85], 2); // far overtakes a steady near while under 0.9
    const fading = stone(32, [80, 30, 30, 30, 30], [40, 40, 40, 40, 40], 2); // near falls below far
    const saturated = Array.from({ length: 20 }, () => 100);
    const sat = stone(64, saturated.map((_, j) => (j < 11 ? 100 : 99)), saturated, 12); // both at the ceiling from census 12
    const sr = sideReadings([{ seed: 1, N: 1, status: "done", stones: [rising, fading, sat] }]);
    expect(sr.farAtCensus1).toEqual({ min: 0.2, max: 1 });
    expect(sr.farReaches09).toEqual({ pairs: 1, of: 3, min: 1, max: 1, median: 1 });
    expect(sr.bothSaturatedAfter16).toEqual({ censuses: 4, of: 4 });
    expect(sr.horizons).toEqual({ total: 3, afterCensus10: 1, afterCensus10Saturated: 1, farBelow09: 2, nearBelowCensus1: 2, atCensus1: 0, nearFellIntoCrossing: 2, farRoseIntoCrossing: 1, bothMovedIntoCrossing: 0 });
    expect(sr.pairs.map((p) => [p.R, p.farBelow09, p.nearBelowCensus1, p.saturatedAtK, p.nearFellIntoCrossing, p.farRoseIntoCrossing])).toEqual([
      [8, true, false, false, false, true], // far rose 0.2 -> 0.6 past a steady near
      [32, true, true, false, true, false], // near fell 0.8 -> 0.3 under a steady far
      [64, false, true, true, true, false], // near 1 -> 0.99 at census 12, far steady at 1
    ]);
  });
  it("sideReadings: a crossing where near falls from census k - 1 counts even when near stays above its census-1 value", () => {
    // Near 0.5, 1, 1, 0.9 ...: below census k - 1 at k = 4, not below census 1 (0.5).
    const st = { R: 8, outcome: { kind: "horizon", k: 4, steps: 4095, decidedAt: 7 } as const, nearDiff: [50, 100, 100, 90, 90, 90, 90], nearUnion: Array(7).fill(100), farDiff: [40, 95, 96, 95, 95, 95, 95], farUnion: Array(7).fill(100), living: Array(7).fill(1) };
    const h = sideReadings([{ seed: 1, N: 1, status: "done", stones: [st] }]).horizons;
    expect(h).toMatchObject({ total: 1, nearBelowCensus1: 0, nearFellIntoCrossing: 1, farRoseIntoCrossing: 0, bothMovedIntoCrossing: 0, atCensus1: 0 });
    const both = { ...st, farDiff: [40, 95, 89, 95, 95, 95, 95] }; // far 0.89 -> 0.95 while near 1 -> 0.9
    expect(sideReadings([{ seed: 1, N: 1, status: "done", stones: [both] }]).horizons).toMatchObject({ nearFellIntoCrossing: 1, farRoseIntoCrossing: 1, bothMovedIntoCrossing: 1 });
    const k1 = { ...st, outcome: { kind: "horizon", k: 1, steps: 1023, decidedAt: 4 } as const, nearDiff: [10, 10, 10, 10], nearUnion: Array(4).fill(100), farDiff: [20, 20, 20, 20], farUnion: Array(4).fill(100), living: Array(4).fill(1) };
    const p = sideReadings([{ seed: 1, N: 1, status: "done", stones: [k1] }]);
    expect(p.horizons).toMatchObject({ atCensus1: 1, nearFellIntoCrossing: 0, farRoseIntoCrossing: 0 });
    expect(p.pairs[0]).toMatchObject({ nearFellIntoCrossing: null, farRoseIntoCrossing: null });
  });
  it("recordRadii: stored grid first, then a group's stones, then the stored readout (a record with every group excluded)", () => {
    expect(recordRadii({ radii: [8, 32], groups: [] })).toEqual([8, 32]);
    expect(recordRadii({ groups: [{}, { stones: [{ R: 8 }, { R: 64 }] }] })).toEqual([8, 64]);
    expect(recordRadii({ groups: [{}, {}], readout: { radii: [{ R: 8 }, { R: 32 }, { R: 64 }] } })).toEqual([8, 32, 64]);
    // Every group excluded: the pairs are still the grid's, so the readout lists them as excluded.
    const pairs = recomputePairs([{ seed: 1, N: 4096, status: "not run (cap)" }, { seed: 2, N: 4096, status: "extinct source" }], recordRadii({ radii: [8, 32], groups: [] }), { K: 4, kMax: 10, censusEvery: 1024 });
    expect(pairs.map((p) => [p.seed, p.R, p.outcome.kind])).toEqual([[1, 8, "not-run-cap"], [1, 32, "not-run-cap"], [2, 8, "extinct-source"], [2, 32, "extinct-source"]]);
    // No pair has a census: the side readings say so rather than an impossible range.
    expect(sideReadings([{ seed: 1, N: 4096, status: "not run (cap)" }]).farAtCensus1).toBeNull();
  });
  it("isFounding: §1's feed alone, in any key order, with the runner's optional matter assertion; nothing else", () => {
    const F = { step: 0, kind: "feed", x: 256, y: 256, r: 255, amount: 16 };
    expect(isFounding([{ amount: 16, r: 255, y: 256, x: 256, kind: "feed", step: 0 }], F)).toBe(true);
    expect(isFounding([{ ...F, matter: 3268304 }], F)).toBe(true);
    expect(isFounding(undefined, F)).toBe(false);
    expect(isFounding([], F)).toBe(false);
    expect(isFounding([null], F)).toBe(false);
    expect(isFounding([{ ...F, amount: 32 }], F)).toBe(false);
    expect(isFounding([{ ...F, extra: 1 }], F)).toBe(false);
    expect(isFounding([F, { step: 4096, kind: "lesion", x: 1, y: 1, r: 8 }], F)).toBe(false);
    // An array-like object is not an array: a later entry cannot hide behind length 1.
    expect(isFounding({ length: 1, 0: F, 1: { step: 4096, kind: "lesion", x: 1, y: 1, r: 8 } }, F)).toBe(false);
  });
});
