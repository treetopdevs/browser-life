// The stone horizon's pure core (tools/lib/horizon.ts; docs/garden-stone-horizon-2026-10-18.md): torus regions, the per-cell
// reduction and comparison, the horizon rule, the cap arithmetic, the readout, CPU twins on a small RefSim world, and the
// group driver with a fake segment runner.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { CH, G, MOT_ZERO, cellCount, defaultConfig, initWorld, stateHash, type WorldState } from "@bl/schema";
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
  DeterminismFault,
  NullFault,
  compactNullGroup,
  discHalfWidths,
  discSize,
  discSums,
  fieldsDiffer,
  fineReadings,
  fineVerdict,
  finePointsOf,
  gapOf,
  isLesionNull,
  isStale,
  kickCell,
  largestNullRadius,
  lesionNullMask,
  notePrefix,
  nullBindingError,
  nullDiscCentre,
  nullReadout,
  recomputeFine,
  recomputeNullPairs,
  runArms,
  countsError,
  fineFileError,
  fineQuiet,
  fineWorstSeconds,
  matchedPairs,
  nullByDay,
  nullGroupWorst,
  nullReadings,
  nullScaleDown,
  sPairsFrom55,
  FineCap,
  cappedRun,
  fineTopError,
  fineGateError,
  gridError,
  parseRunStatus,
  psNoteOf,
  reducePsLine,
  scrubRecordPs,
  runStatusError,
  type ArmsPlan,
  type FineBinding,
  type FinePairRecord,
  type FinePoint,
  type NullBinding,
  type NullGroupFile,
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

// ==== Slice 34: the null stone, the kick and the finer cadence (the note's "Amendment, slice 34")

/** A W x H world, every cell at rest (MOT_ZERO) and lesion-null unless `cellOf` says otherwise. */
function handWorld(W: number, H: number, cellOf: (x: number, y: number) => Partial<{ B: number; P: number; E: number; MOT: number; hi: number; lo: number }>) {
  const n = W * H;
  const cells = new Uint32Array(7 * n), genome = new Uint32Array(44 * n);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x, c = cellOf(x, y);
      cells[CH.B * n + i] = c.B ?? 0;
      cells[CH.P * n + i] = c.P ?? 0;
      cells[CH.E * n + i] = c.E ?? 0;
      cells[CH.MOT * n + i] = c.MOT ?? MOT_ZERO;
      genome[G.LIN_HI * n + i] = c.hi ?? 0;
      genome[G.LIN_LO * n + i] = c.lo ?? 0;
    }
  return { cells, genome };
}
/** Living everywhere except the 9 x 9 square around (10, 10), which is lesion-null. */
const patch = (x: number, y: number) => (Math.abs(x - 10) <= 4 && Math.abs(y - 10) <= 4 ? {} : { B: 1, hi: 1, lo: 1 });

describe("slice 34: discs on the torus", () => {
  it("discHalfWidths is the lesion's disc row by row and discSize its cell count", () => {
    for (const R of [0, 1, 2, 3, 5, 8, 13, 32, 64]) {
      const w = discHalfWidths(R);
      w.forEach((h, k) => {
        const dy = k - R;
        expect(h * h + dy * dy).toBeLessThanOrEqual(R * R);
        expect((h + 1) * (h + 1) + dy * dy).toBeGreaterThan(R * R);
      });
      if (2 * R < 140) expect(discSize(R)).toBe(count(torusDisc(140, 140, 70, 70, R)));
    }
  });
  it("discSums matches a brute-force torus disc sum at every centre", () => {
    const W = 16, H = 12;
    let x = 12345;
    const ind = Uint8Array.from({ length: W * H }, () => ((x = (Math.imul(x, 1103515245) + 12345) >>> 0) >>> 16) & 1);
    for (const R of [0, 1, 3, 5]) {
      const s = discSums(ind, W, H, R);
      for (let cy = 0; cy < H; cy++)
        for (let cx = 0; cx < W; cx++) {
          const d = torusDisc(W, H, cx, cy, R);
          let b = 0;
          for (let i = 0; i < W * H; i++) b += d[i] * ind[i];
          expect(s[cy * W + cx]).toBe(b);
        }
    }
    expect(() => discSums(ind, W, H, 6)).toThrow(/meets itself/);
  });
});

/**
 * The small world carpets every cell, so dead ground is made: 40 steps, a radius-7 lesion at (16, 16), 4 steps of regrowth
 * (22 lesion-null cells and 3 dead cells holding E), then two hand-made stale cells (lineage words on dead cells; the big
 * jar has thousands), one also off rest.
 */
function deadGround(): WorldState {
  const sim = new RefSim(clone(smallWorld()));
  for (let t = 0; t < 40; t++) sim.step();
  applyLesion(sim, 16, 16, 7);
  for (let t = 0; t < 4; t++) sim.step();
  const s = sim.state, n = cellCount(s.cfg);
  const dead = [...Array(n).keys()].filter((i) => isLesionNull(s.cells, s.genome, n, i));
  s.genome[G.LIN_HI * n + dead[0]] = 41;
  s.genome[G.LIN_LO * n + dead[1]] = 7;
  s.cells[CH.MOT * n + dead[1]] = MOT_ZERO + 1;
  return clone(s);
}

describe("slice 34: lesion-null cells, null discs and r0", () => {
  it("isLesionNull holds exactly when an r = 0 applyLesion leaves cells, genome and heat bit-identical", () => {
    const base = deadGround(), n = cellCount(base.cfg);
    let nulls = 0, others = 0;
    for (let i = 0; i < n; i++) {
      const probe = new RefSim(clone(base));
      applyLesion(probe, i % 32, Math.floor(i / 32), 0);
      const same = probe.state.cells.every((v, j) => v === base.cells[j]) && probe.state.genome.every((v, j) => v === base.genome[j]) && probe.state.heatOut === base.heatOut;
      expect(isLesionNull(base.cells, base.genome, n, i)).toBe(same);
      if (same) nulls++;
      else others++;
    }
    expect(nulls).toBeGreaterThan(0);
    expect(others).toBeGreaterThan(0);
  });
  it("nullDiscCentre picks among lesion-null discs by the N + 1 draw in index order, and is null when none exists", () => {
    const st = handWorld(20, 20, patch);
    // R = 3 fits the 9 x 9 square exactly at centres (9..11, 9..11), listed here in index order.
    const cands = [9, 10, 11].flatMap((y) => [9, 10, 11].map((x) => y * 20 + x));
    for (const [seed, N] of [[1, 131072], [3, 262144], [4, 7]]) {
      const z = nullDiscCentre(st, 20, 3, seed, N)!;
      const want = cands[centreDraw(seed, N + 1) % 9];
      expect(z).toEqual({ x: want % 20, y: Math.floor(want / 20), index: want, count: 9 });
    }
    expect(nullDiscCentre(st, 20, 4, 1, 1)).toEqual({ x: 10, y: 10, index: 210, count: 1 });
    expect(nullDiscCentre(st, 20, 5, 1, 1)).toBeNull();
    expect(nullDiscCentre(handWorld(20, 20, () => ({ B: 1, hi: 1, lo: 1 })), 20, 0, 1, 1)).toBeNull();
  });
  it("a dead cell with E > 0, P > 0, MOT off rest or a stale lineage word is not lesion-null", () => {
    for (const bad of [{ E: 1 }, { P: 1 }, { MOT: MOT_ZERO + 1 }, { hi: 1 }, { lo: 1 }]) {
      const st = handWorld(20, 20, (x, y) => (x === 10 && y === 10 ? bad : patch(x, y)));
      expect(isLesionNull(st.cells, st.genome, 400, 210)).toBe(false);
      expect(nullDiscCentre(st, 20, 4, 1, 1)).toBeNull(); // the only R = 4 null disc is gone
    }
    const stale = handWorld(4, 4, (x) => (x === 0 ? { hi: 7 } : x === 1 ? { lo: 2, P: 3 } : x === 2 ? { B: 5, hi: 1 } : {}));
    expect([0, 1, 2, 3].map((x) => isStale(stale.cells, stale.genome, 16, x))).toEqual([true, true, false, false]);
  });
  it("largestNullRadius is r0 (a bisection that equals the downward scan), and -1 when no cell is lesion-null", () => {
    expect(largestNullRadius(handWorld(20, 20, patch), 20, 8)).toBe(4);
    expect(largestNullRadius(handWorld(20, 20, () => ({ B: 1 })), 20, 8)).toBe(-1);
    expect(largestNullRadius(handWorld(20, 20, (x, y) => (x === 3 && y === 4 ? {} : { B: 1 })), 20, 8)).toBe(0);
    // Random fields: the downward scan by brute force.
    let r = 99;
    for (let t = 0; t < 6; t++) {
      const st = handWorld(24, 24, () => ((((r = (Math.imul(r, 1103515245) + 12345) >>> 0) >>> 16) % 10) < 9 ? {} : { B: 1 }));
      const mask = lesionNullMask(st);
      let scan = -1;
      for (let R = 8; R >= 0; R--) if (discSums(mask, 24, 24, R).some((v) => v === discSize(R))) { scan = R; break; }
      expect(largestNullRadius(st, 24, 8)).toBe(scan);
    }
  });
});

describe("slice 34: the kick's cell", () => {
  // Stale cells (B = 0, lineage set): a: P 2; b: E 5; c: MOT off rest; d1, d2: P = E = 0 at rest. Not stale: a living cell
  // with P = E = 0 and a dead lineage-0 cell.
  const cellsAt: Record<string, [number, number]> = { a: [1, 1], b: [2, 1], c: [3, 1], d1: [4, 2], d2: [6, 3], live: [0, 0], dead: [5, 5] };
  const world = (without: string[] = []) =>
    handWorld(8, 8, (x, y) => {
      const k = Object.keys(cellsAt).find((k) => cellsAt[k][0] === x && cellsAt[k][1] === y);
      if (!k || without.includes(k)) return { B: 1, hi: 9, lo: 9, P: 1 }; // living filler, never a candidate
      return ({ a: { P: 2, hi: 3 }, b: { E: 5, lo: 4 }, c: { MOT: MOT_ZERO + 257, hi: 5 }, d1: { hi: 6, lo: 1 }, d2: { lo: 7 }, live: { B: 3, hi: 1 }, dead: {} } as Record<string, object>)[k];
    });
  const idx = (k: string) => cellsAt[k][1] * 8 + cellsAt[k][0];
  it("ranks stale cells by P, then E, then MOT off rest, ties by the N + 2 draw; a B > 0 or lineage-0 cell is never chosen", () => {
    for (const [seed, N] of [[1, 131072], [3, 131072], [4, 262144]]) {
      const k = kickCell(world(), 8, seed, N)!;
      expect(k.index).toBe([idx("d1"), idx("d2")][centreDraw(seed, N + 2) % 2]);
      expect(k).toMatchObject({ P: 0, E: 0, motOff: false, ties: 2, stale: 5 });
    }
    expect(kickCell(world(["d1", "d2"]), 8, 1, 1)).toMatchObject({ index: idx("c"), motOff: true, ties: 1 });
    expect(kickCell(world(["d1", "d2", "c"]), 8, 1, 1)).toMatchObject({ index: idx("b"), E: 5 });
    expect(kickCell(world(["d1", "d2", "c", "b"]), 8, 1, 1)).toMatchObject({ index: idx("a"), P: 2, linHi: 3 }); // P > 0 loses to every P = 0 cell
    expect(kickCell(world(["d1", "d2", "c", "b", "a"]), 8, 1, 1)).toBeNull();
  });
  it("the stone, N0 and kick draws use different salts (N, N + 1, N + 2)", () => {
    for (const [s, N] of [[1, 131072], [3, 262144], [4, 393216]]) {
      const d = [centreDraw(s, N), centreDraw(s, N + 1), centreDraw(s, N + 2)];
      expect(new Set(d).size).toBe(3);
    }
    // Seven lesion-null cells: R = 0 null discs; nullDiscCentre uses N + 1, not N.
    const seven = [3, 9, 17, 22, 40, 51, 60];
    const st = handWorld(8, 8, (x, y) => (seven.includes(y * 8 + x) ? {} : { B: 1 }));
    const [seed, N] = [[1, 131072], [3, 262144], [4, 393216], [2, 5]].find(([s, N]) => centreDraw(s, N) % 7 !== centreDraw(s, N + 1) % 7)!;
    expect(nullDiscCentre(st, 8, 0, seed, N)!.index).toBe(seven[centreDraw(seed, N + 1) % 7]);
    expect(nullDiscCentre(st, 8, 0, seed, N)!.index).not.toBe(seven[centreDraw(seed, N) % 7]);
  });
});

describe("slice 34: CPU twins on a 32×32 RefSim", () => {
  it("an N0 lesion leaves stateHash equal after 64 steps; a kick changes stateHash at once", () => {
    const sim = new RefSim(deadGround());
    const u0 = new RefSim(clone(sim.state)), n0 = new RefSim(clone(sim.state)), kk = new RefSim(clone(sim.state));
    const r0 = largestNullRadius(sim.state, 32, 4);
    expect(r0).toBeGreaterThanOrEqual(0);
    const z = nullDiscCentre(sim.state, 32, r0, 1, 44)!;
    applyLesion(n0, z.x, z.y, r0);
    expect(stateHash(n0.state)).toBe(stateHash(u0.state));
    const k = kickCell(sim.state, 32, 1, 44)!;
    expect(k).toMatchObject({ stale: 2, ties: 1, linHi: 41, motOff: false }); // the at-rest stale cell ranks first
    applyLesion(kk, k.x, k.y, 0);
    expect(stateHash(kk.state)).not.toBe(stateHash(u0.state));
    for (let t = 0; t < 64; t++) (u0.step(), n0.step(), kk.step());
    expect(stateHash(n0.state)).toBe(stateHash(u0.state));
  });
});

// ---- runArms with a fake runSegment: four regions of ten cells (A, B, C near the three K pairs; D far for all)

const REG = (r: number) => Uint8Array.from({ length: NN }, (_, i) => (Math.floor(i / 10) === r ? 1 : 0));
/** K's census k: region r's first five cells take lineage 2 while k < until[r]; one D cell differs always. U0 (and N0) lineage 1. */
function kSig(until: number[], k: number, living = NN): Signature {
  return signatureOf(synthState(NN, (i) => {
    const r = Math.floor(i / 10);
    const differs = r < 3 ? i % 10 < 5 && k < until[r] : i === 30;
    return { B: i < living ? 1 : 0, P: 0, hi: differs ? 2 : 1, lo: 1 };
  }));
}
function armsIo(
  behave: (twin: TwinPlan, k: number) => Signature,
  opts: { deadline?: number; hash?: (twin: string, k: number) => string; appliedR?: (twin: string, r: number) => number | null; finalHash?: (twin: string, reached: number) => string } = {},
) {
  const calls: FakeCall[] = [];
  let clock = 0;
  const io: GroupIo<number> = {
    deadline: opts.deadline ?? Infinity,
    now: () => clock,
    async runSegment(twin, from, firstK, censuses, onCensus) {
      if ((from ?? 0) !== firstK - 1) throw new Error(`${twin.name}: continuation ${from} for census ${firstK}`);
      calls.push({ twin: twin.name, firstK, censuses });
      clock += censuses;
      const e = twin.entry;
      const r = e && firstK === 1 ? (opts.appliedR ? opts.appliedR(twin.name, e.r) : e.r) : null;
      const applied = e && r !== null ? [{ step: e.step, r }] : [];
      const hash = (k: number) => (opts.hash ? opts.hash(twin.name, k) : `s-${twin.name === "K" ? "K" : "U"}-${k}`);
      let reached = firstK - 1;
      for (let k = firstK; k < firstK + censuses; k++) {
        reached = k;
        if (onCensus(k, behave(twin, k), () => hash(k))) return { next: null, finalHash: null, stopStateHash: hash(k), reached, applied, seconds: 1 };
      }
      return { next: reached, finalHash: opts.finalHash ? opts.finalHash(twin.name, reached) : `h-${twin.name === "K" ? "K" : "U"}-${reached}`, stopStateHash: null, reached, applied, seconds: 1 };
    },
  };
  return { io, calls };
}
const armsPlan = (o: Partial<ArmsPlan> = {}): ArmsPlan => ({
  nulls: [{ R: 8, x: 1, y: 1 }, { R: 32, x: 2, y: 2 }],
  kick: { x: 3, y: 3 },
  pairs: [8, 32, 64].map((R, r) => ({ label: `K|${R}`, R, mask: REG(r) })),
  controlMask: REG(0),
  chunk: 4,
  horizon: { K: 4, kMax: 10, censusEvery: 1024 },
  entryStep: 4097,
  ...o,
});
const kBehave = (until: number[]) => (twin: TwinPlan, k: number) => (twin.name === "K" ? kSig(until, k) : sigOf(0, 0));

describe("slice 34: runArms with a fake runSegment", () => {
  it("N0 equal to U0 runs one chunk and passes; a census-hash mismatch throws NullFault and K never runs", async () => {
    const { io, calls } = armsIo(kBehave([2, 2, 2]));
    const g = await runArms(io, armsPlan());
    expect(g.nulls.map((z) => [z.name, z.identical, z.censuses, z.effectiveR, z.finalStateHash])).toEqual([["N0-8", true, 4, 8, "s-U-4"], ["N0-32", true, 4, 32, "s-U-4"]]);
    expect(calls.filter((c) => c.twin.startsWith("N0")).map((c) => c.firstK)).toEqual([1, 1]);
    expect(g.control.ok).toBe(true);
    const bad = armsIo(kBehave([2, 2, 2]), { hash: (t, k) => (t === "N0-32" && k === 3 ? "other" : `s-${t === "K" ? "K" : "U"}-${k}`) });
    await expect(runArms(bad.io, armsPlan())).rejects.toThrow(NullFault);
    expect(bad.calls.some((c) => c.twin === "K")).toBe(false);
    // A whole-jar difference with equal hashes is also a fault (the comparison and the hash must both agree).
    const diff = armsIo((t, k) => (t.name === "N0-8" && k === 2 ? sigOf(1, 0) : t.name === "K" ? kSig([2, 2, 2], k) : sigOf(0, 0)));
    await expect(runArms(diff.io, armsPlan())).rejects.toThrow(/N0-8 is not U0/);
  });
  it("one K twin under three masks gives three independent outcomes and stops only when all three are decided; U0 stops after", async () => {
    const { io, calls } = armsIo(kBehave([2, 6, 1000]));
    const g = await runArms(io, armsPlan({ nulls: [] }));
    expect(g.pairs.map((p) => [p.label, p.outcome])).toEqual([
      ["K|8", { kind: "horizon", k: 2, steps: 2047, decidedAt: 5 }],
      ["K|32", { kind: "horizon", k: 6, steps: 6143, decidedAt: 9 }],
      ["K|64", { kind: "censored", window: 10239, decidedAt: 10 }],
    ]);
    expect(g.pairs.map((p) => p.series.length)).toEqual([5, 9, 10]); // a decided pair takes no more censuses
    expect(calls.filter((c) => c.twin === "K").map((c) => c.firstK)).toEqual([1, 5, 9]);
    expect(calls.filter((c) => c.twin === "U0").map((c) => c.firstK)).toEqual([1, 5, 9]);
    expect(g.kick).toMatchObject({ effectiveR: 0, reached: 10, stopStateHash: "s-K-10", finalHash: null, sameAsU0At1: false });
    expect(g.kick.living).toHaveLength(10);
    expect(g.u0.living).toHaveLength(12);
    const quiet = await runArms(armsIo((t) => sigOf(0, 0)).io, armsPlan({ nulls: [] }));
    expect(quiet.pairs.map((p) => p.outcome)).toEqual([0, 1, 2].map(() => ({ kind: "no-mark", decidedAt: 1 })));
  });
  it("the kick must apply with radius 0 and N0 with radius R, else it throws", async () => {
    await expect(runArms(armsIo(kBehave([2, 2, 2]), { appliedR: (t, r) => (t === "K" ? 1 : r) }).io, armsPlan())).rejects.toThrow(/K: the lesion at step 4097 applied with radius 1, not 0/);
    await expect(runArms(armsIo(kBehave([2, 2, 2]), { appliedR: (t, r) => (t === "N0-32" ? 31 : r) }).io, armsPlan())).rejects.toThrow(/N0-32: .* radius 31, not 32/);
    await expect(runArms(armsIo(kBehave([2, 2, 2]), { appliedR: (t, r) => (t === "K" ? null : r) }).io, armsPlan())).rejects.toThrow(/radius null, not 0/);
  });
  it("a U0 living series or hash different from #55's reference throws DeterminismFault; equal prefixes pass", async () => {
    const ref = { living: [NN, NN, NN, NN, NN, NN], reached: 8, finalHash: "h-U-8", chunk1Hash: "h-U-4" };
    const ok = await runArms(armsIo(kBehave([2, 2, 2])).io, armsPlan({ u0Reference: ref }));
    expect(ok.u0.reference).toEqual({ livingChecked: 6, chunk1HashChecked: true, finalHashChecked: true });
    await expect(runArms(armsIo(kBehave([2, 2, 2])).io, armsPlan({ u0Reference: { ...ref, living: [NN, NN, NN - 1] } }))).rejects.toThrow(DeterminismFault);
    await expect(runArms(armsIo(kBehave([2, 2, 2])).io, armsPlan({ u0Reference: { ...ref, chunk1Hash: "x" } }))).rejects.toThrow(/chunk 1/);
    await expect(runArms(armsIo(kBehave([2, 2, 2])).io, armsPlan({ u0Reference: { ...ref, finalHash: "x" } }))).rejects.toThrow(/census 8/);
    // A reference that ends on a census this U0 never ends a chunk on is not compared.
    const other = await runArms(armsIo(kBehave([2, 2, 2])).io, armsPlan({ u0Reference: { ...ref, reached: 7, finalHash: "x" } }));
    expect(other.u0.reference!.finalHashChecked).toBe(false);
  });
  it("past the deadline, undecided K pairs are stopped (cap)", async () => {
    const { io, calls } = armsIo(kBehave([1, 1000, 1000]), { deadline: 10 });
    const g = await runArms(io, armsPlan({ nulls: [], horizon: { K: 4, kMax: 20, censusEvery: 1024 } }));
    expect(g.stoppedByCap).toBe(true);
    expect(g.pairs.map((p) => p.outcome)).toEqual([{ kind: "horizon", k: 1, steps: 1023, decidedAt: 4 }, { kind: "stopped-cap", reached: 4 }, { kind: "stopped-cap", reached: 4 }]);
    expect(calls.map((c) => c.firstK)).toEqual([1, 1, 1]); // U0 4 + U1 4 + K 4 = 12 > 10
  });
});

describe("slice 34: the fine readings", () => {
  const fp = (j: number, nd: number, fd: number): FinePoint => ({ j, near: { diff: nd, union: 100 }, far: { diff: fd, union: 100 } });
  const o = { every: 64, Kf: 4, jMax: 17 };
  it("far50, far90, cross, gapArea and the fine horizon on a hand series", () => {
    const pts = [fp(1, 50, 10), fp(2, 50, 30), fp(3, 50, 50), fp(4, 60, 55), ...Array.from({ length: 16 }, (_, i) => fp(5 + i, 10, 95))];
    const r = fineReadings(pts, o);
    expect(r).toMatchObject({ far50: 3, far90: 5, cross: 3, fineHorizon: { kind: "horizon", j: 5, steps: 319 } });
    expect(r.gapArea).toBeCloseTo((0.4 + 0.2 + 0.05) * 64, 9);
    expect(gapOf({ diff: 1, union: 4 }, { diff: 0, union: 0 })).toBe(0.25);
    expect(gapOf({ diff: 1, union: 4 }, { diff: 1, union: 2 })).toBe(0);
  });
  it("the fine horizon is censored when no run starts by jMax, and the rule refuses a short series", () => {
    const alt = Array.from({ length: 20 }, (_, i) => fp(i + 1, i % 4 === 3 ? 90 : 10, 50)); // runs of three
    expect(fineReadings(alt, o).fineHorizon).toEqual({ kind: "censored", window: 17 * 64 - 1 });
    const late = Array.from({ length: 20 }, (_, i) => fp(i + 1, i < 17 ? 90 : 10, 50)); // a run from 18 > jMax
    expect(fineReadings(late, o)).toMatchObject({ cross: 18, fineHorizon: { kind: "censored" } });
    expect(() => fineReadings(alt.slice(0, 19), o)).toThrow(/needs 20/);
    expect(() => fineReadings([fp(2, 1, 1)], { every: 64, Kf: 1, jMax: 1 })).toThrow(/labelled/);
  });
  it("fineVerdict: material / like a kick / mixed by the factor-2 rule, with G(K) = 0", () => {
    expect(fineVerdict([{ gS: 3, gK: 1 }, { gS: 5, gK: 2 }, { gS: 1, gK: 0 }])).toBe("material");
    expect(fineVerdict([{ gS: 2, gK: 1 }, { gS: 0, gK: 0 }])).toBe("like a kick");
    expect(fineVerdict([{ gS: 3, gK: 1 }, { gS: 2, gK: 1 }])).toBe("mixed");
    expect(fineVerdict([])).toBe("no reading");
  });
  it("recomputeFine reproduces the stored readings and refuses a tampered count", () => {
    const counts = { nearDiff: Array(20).fill(30), nearUnion: Array(20).fill(100), farDiff: Array(20).fill(10), farUnion: Array(20).fill(100) };
    const kc = { ...counts, nearDiff: Array(20).fill(12) };
    const pair = (label: string, R: number, kind: "S" | "K", c: typeof counts) => ({ label, R, kind, ...c, readings: fineReadings(finePointsOf(c), o) });
    const g = { seed: 1, N: 131072, status: "done", pairs: [pair("S8", 8, "S", counts), pair("K|8", 8, "K", kc)] };
    const fr = recomputeFine([g], [8], o);
    expect(fr[0].verdict).toBe("material"); // 0.2 * 64 * 20 > 2 * 0.02 * 64 * 20
    const bad = structuredClone(g);
    bad.pairs[1].nearDiff[3] = 90;
    expect(() => recomputeFine([bad], [8], o)).toThrow(/K\|8: the counts give/);
  });
});

describe("slice 34: the readings (N6)", () => {
  const o = { kMax: 128, censusEvery: 1024, wander: 131072 };
  const pr = (seed: number, R: number, outcome: PairRecord["outcome"]): PairRecord => ({ seed, N: 131072, R, outcome });
  const hz = (steps: number) => ({ kind: "horizon" as const, k: (steps + 1) / 1024, steps, decidedAt: 0 });
  const cen = { kind: "censored" as const, window: 131071, decidedAt: 131 };
  const nm = { kind: "no-mark" as const, decidedAt: 1 };
  const S = [pr(1, 32, hz(26623)), pr(2, 32, hz(5119)), pr(3, 32, hz(99327))];
  it("divergence clock when the K median is at least half the S median, stone effect below; no mark lowest, censored highest", () => {
    const clock = nullReadout([pr(1, 32, nm), pr(2, 32, hz(20479)), pr(3, 32, cen)], S, o);
    expect(clock.radii[0]).toMatchObject({ R: 32, verdict: "divergence clock", sMedian: 26623, k: { median: 20479, noMark: 1, horizons: 1, censored: 1 } });
    expect(clock.radii[0].paired).toEqual({ atLeastHalf: 2, of: 3 }); // no mark < 13,311.5; 20,479 >= 2,559.5; censored >= anything
    expect(nullReadout([pr(1, 32, nm), pr(2, 32, nm), pr(3, 32, hz(20479))], S, o).radii[0]).toMatchObject({ verdict: "stone effect", k: { median: -1 } });
    expect(nullReadout([pr(1, 32, hz(1023)), pr(2, 32, hz(2047)), pr(3, 32, hz(5119))], S, o).radii[0].verdict).toBe("stone effect");
    expect(nullReadout([pr(1, 32, hz(13311)), pr(2, 32, hz(13311)), pr(3, 32, cen)], S, o).radii[0].verdict).toBe("stone effect"); // 2 * 13,311 < 26,623
    expect(nullReadout([pr(1, 32, hz(13311)), pr(2, 32, hz(14335)), pr(3, 32, cen)], S, o).radii[0].verdict).toBe("divergence clock");
    // A censored stone median needs a censored K median.
    const Sc = [pr(1, 64, cen), pr(2, 64, cen)];
    expect(nullReadout([pr(1, 64, hz(100351)), pr(2, 64, cen)], Sc, o).radii[0].verdict).toBe("stone effect");
    expect(nullReadout([pr(1, 64, cen), pr(2, 64, cen)], Sc, o).radii[0].verdict).toBe("divergence clock");
    // Excluded outcomes are not in the median.
    const ex = nullReadout([pr(1, 32, { kind: "extinct", k: 2, decidedAt: 2 }), pr(2, 32, { kind: "stopped-cap", reached: 3 }), pr(3, 32, hz(20479))], S, o).radii[0];
    expect(ex.k.excluded.map((x) => x.kind)).toEqual(["extinct", "stopped-cap"]);
    expect(nullReadout([pr(1, 32, { kind: "not-run-cap" })], S, o).radii[0].verdict).toBe("no reading");
  });
  it("the pace line on R = 32 follows N6", () => {
    const fineOf = (verdict: string) => [{ R: 32, verdict, rows: [], sHorizons: [{ seed: 1, N: 131072, fineHorizon: { kind: "horizon", j: 10, steps: 639 } }] }] as never;
    const clockK = [pr(1, 32, hz(20479)), pr(2, 32, hz(20479)), pr(3, 32, cen)];
    expect(nullReadout([pr(1, 32, nm)], S, o).pace).toMatch(/stone effect at R = 32 \(paired 0 of 1\): #55's R = 32 reading stands \(median 26,623 steps\).*one wander/); // the S median is over the matched group only
    expect(nullReadout(clockK, S, { ...o, fine: fineOf("material"), fineWindow: 8192 }).pace).toMatch(/divergence clock.*material \(on the fine pilot's groups only, N = 131,072\): a stone is a mark legible for about its fine horizon \(S-32: 639 steps\).*8,192/);
    expect(nullReadout(clockK, S, { ...o, fine: fineOf("like a kick"), fineWindow: 8192 }).pace).toMatch(/no measure here separates a stone from any perturbation/);
    expect(nullReadout(clockK, S, o).pace).toMatch(/no reading at R = 32/);
    expect(nullReadout([pr(1, 8, nm)], S, o).pace).toMatch(/no reading/);
  });
});

describe("slice 34: bindings, the compact record and the note's prefix", () => {
  const b: NullBinding = { seed: 1, N: 131072, checkpointHash: "abc", stoneCentre: { x: 1, y: 2 }, nulls: [{ R: 8, x: 3, y: 4 }], noNull: [64], r0: 40, kick: { x: 5, y: 6 }, K: 4, kMax: 128, censusEvery: 1024, chunk: 16, entryStep: 131073 };
  it("nullBindingError names the first differing field", () => {
    expect(nullBindingError(b, structuredClone(b))).toBeNull();
    expect(nullBindingError({ ...b, kick: { x: 5, y: 7 } }, b)).toMatch(/^kick is/);
    expect(nullBindingError({ ...b, nulls: [] }, b)).toMatch(/^nulls/);
    expect(nullBindingError(undefined, b)).toMatch(/no binding/);
    expect(fieldsDiffer({ a: 1, b: 2 }, { a: 1, b: 3 })).toBe("b is 2 in the group file, 3 in this run");
  });
  it("compactNullGroup keeps integer counts; recomputeNullPairs reproduces the outcomes and throws on a tampered count", async () => {
    const result = await runArms(armsIo(kBehave([2, 6, 1000])).io, armsPlan());
    const file: NullGroupFile = { seed: 1, N: 4096, status: "done", binding: b, result };
    const c = compactNullGroup(file) as ReturnType<typeof compactNullGroup> & { pairs: { nearDiff: number[] }[] };
    expect(c.pairs[0].nearDiff).toEqual([5, 0, 0, 0, 0]);
    const o = { K: 4, kMax: 10, censusEvery: 1024 };
    const pairs = recomputeNullPairs([c] as never, [8, 32, 64], o);
    expect(pairs.map((p) => [p.R, p.outcome.kind])).toEqual([[8, "horizon"], [32, "horizon"], [64, "censored"]]);
    const bad = structuredClone(c);
    bad.pairs[1].nearDiff[6] = 5;
    expect(() => recomputeNullPairs([bad] as never, [8, 32, 64], o)).toThrow(/K\|32: the record's counts give/);
    expect(recomputeNullPairs([{ seed: 3, N: 4096, status: "void" }], [8], o)[0].outcome).toEqual({ kind: "void" });
    // A group the run never reached (it ended on a fault) is not a cap decision.
    expect(recomputeNullPairs([{ seed: 3, N: 4096, status: "not run (stopped)" }, { seed: 4, N: 4096, status: "not run (cap)" }], [8], o).map((p) => p.outcome.kind)).toEqual(["not-run-stopped", "not-run-cap"]);
    expect(JSON.parse(compactJson(c))).toEqual(JSON.parse(JSON.stringify(c)));
  });
  it("notePrefix is the note before its appended readout", () => {
    const enc = (t: string) => new TextEncoder().encode(t);
    const dec = (b: Uint8Array) => new TextDecoder().decode(b);
    const H = "## Readout, slice 34 (2026-10-18)";
    const note = "# Title\n\nrules — é.\n";
    expect(dec(notePrefix(enc(note), H))).toBe(note);
    expect(dec(notePrefix(enc(`${note}\n${H}\n\n- a reading\n`), H))).toBe(note);
    expect(dec(notePrefix(enc(`${note}\n${H}\n\n- a reading\n\n${H}\n`), H))).toBe(note); // the first heading counts
  });
});

describe("slice 34: the #55 record still reads", () => {
  it("recomputePairs and readout on experiments/garden/stone-horizon-2026-10-18.json equal its stored readout", () => {
    const rec = JSON.parse(readFileSync(new URL("../../experiments/garden/stone-horizon-2026-10-18.json", import.meta.url), "utf8"));
    const pairs = recomputePairs(rec.groups, recordRadii(rec), { K: 4, kMax: rec.cap.kMax, censusEvery: 1024 });
    expect(readout(pairs, { kMax: rec.cap.kMax, censusEvery: 1024, wound: 13000, wander: 131072 })).toEqual(rec.readout);
  });
});

describe("slice 34 review: matched medians, by day, and the pace line's firmness", () => {
  const o = { kMax: 128, censusEvery: 1024, wander: 131072 };
  const hz = (steps: number) => ({ kind: "horizon" as const, k: (steps + 1) / 1024, steps, decidedAt: 0 });
  const pr = (seed: number, N: number, R: number, outcome: PairRecord["outcome"]): PairRecord => ({ seed, N, R, outcome });
  it("both medians are over the groups where K and S both ran: a cap-skipped K cannot move the stone's median", () => {
    // Codex's case: one completed group (K 20,479, S 100,351) and two cap-skipped K groups whose S horizons are 1,023.
    const S = [pr(1, 131072, 32, hz(100351)), pr(2, 131072, 32, hz(1023)), pr(3, 131072, 32, hz(1023))];
    const Kp = [pr(1, 131072, 32, hz(20479)), pr(2, 131072, 32, { kind: "not-run-cap" } as never), pr(3, 131072, 32, { kind: "not-run-cap" } as never)];
    const r = nullReadout(Kp, S, o).radii[0];
    expect(r).toMatchObject({ verdict: "stone effect", sMedian: 100351, k: { median: 20479 }, paired: { atLeastHalf: 0, of: 1 } });
    expect(r.k.excluded).toEqual([{ seed: 2, N: 131072, kind: "not-run-cap" }, { seed: 3, N: 131072, kind: "not-run-cap" }]);
    // A valid K whose stone pair is missing or not a horizon is excluded too, with the reason.
    const m = matchedPairs([pr(1, 131072, 32, hz(20479)), pr(4, 131072, 32, hz(1023))], [pr(1, 131072, 32, { kind: "no-mark", decidedAt: 1 })], 32);
    expect(m.matched).toEqual([]);
    expect(m.excluded.map((x) => x.kind)).toEqual(["stone no-mark", "stone missing"]);
    expect(nullReadout([pr(4, 131072, 32, hz(1023))], [], o).radii[0]).toMatchObject({ verdict: "no reading", text: "K|32: no reading (no group with a valid stone pair as well)" });
  });
  it("nullByDay splits the same reading by N; the pace line carries the paired count and the neighbouring verdicts", () => {
    const S = [pr(1, 1, 32, hz(99327)), pr(2, 1, 32, hz(99327)), pr(1, 2, 32, hz(5119)), pr(2, 2, 32, hz(5119))];
    const Kp = [pr(1, 1, 32, hz(1023)), pr(2, 1, 32, hz(1023)), pr(1, 2, 32, hz(50175)), pr(2, 2, 32, hz(50175))];
    const d = nullByDay(Kp, S, [32])[0].days;
    expect(d.map((x) => [x.N, x.kMedian, x.sMedian, x.verdict, x.paired.atLeastHalf])).toEqual([[1, 1023, 99327, "K under half S", 0], [2, 50175, 5119, "K at least half S", 2]]);
    const both = nullReadout([...Kp, pr(1, 1, 8, hz(1023))], [...S, pr(1, 1, 8, hz(99327))], o);
    expect(both.pace).toMatch(/^Pace: a stone effect at R = 32 \(paired 2 of 4; R = 8 stone effect\)/);
  });
  it("the pace line renders censored fine horizons as > the bound, and names the fine pilot's days", () => {
    const S = [pr(1, 131072, 32, hz(26623))];
    const fine = [{ R: 32, verdict: "material", rows: [{ seed: 1, N: 131072, gS: 9, gK: 1 }], sHorizons: [{ seed: 1, N: 131072, fineHorizon: { kind: "censored", window: 7231 } }] }] as never;
    expect(nullReadout([pr(1, 131072, 32, hz(26623))], S, { ...o, fine, fineWindow: 8192 }).pace).toContain("material (on the fine pilot's groups only, N = 131,072): a stone is a mark legible for about its fine horizon (S-32: > 7,231 steps)");
  });
});

describe("slice 34 review: the fine counts, the grid and the binding", () => {
  const o = { every: 64, Kf: 4, jMax: 17 };
  const J = 20;
  const counts = (nd: number, nu = 100, fd = 10, fu = 100) => ({ nearDiff: Array(J).fill(nd), nearUnion: Array(J).fill(nu), farDiff: Array(J).fill(fd), farUnion: Array(J).fill(fu) });
  const pair = (label: string, R: number, kind: "S" | "K", c: ReturnType<typeof counts>): FinePairRecord => ({ label, R, kind, ...c, readings: fineReadings(finePointsOf(c), o) });
  const group = (seed: number) => ({ seed, N: 131072, status: "done", pairs: [pair("S8", 8, "S", counts(30)), pair("K|8", 8, "K", counts(12))] });
  it("countsError: equal lengths, non-negative integers, diff <= union; an empty union is allowed", () => {
    expect(countsError(counts(0, 0, 0, 0), J)).toBeNull();
    // Codex's case: zero near diffs with no denominators and no far counts at all.
    expect(countsError({ nearDiff: Array(128).fill(0), nearUnion: [], farDiff: [], farUnion: [] }, 128)).toMatch(/nearUnion has 0 entries, not 128/);
    expect(countsError({ ...counts(1), farDiff: [...counts(1).farDiff.slice(1), 1.5] }, J)).toMatch(/farDiff\[19\] is 1.5/);
    expect(countsError({ ...counts(1), nearDiff: [-1, ...counts(1).nearDiff.slice(1)] }, J)).toMatch(/nearDiff\[0\] is -1/);
    expect(countsError(counts(101), J)).toMatch(/near diff 101 exceeds its union 100 at reading 1/);
    expect(countsError({ ...counts(1), farUnion: undefined }, J)).toMatch(/farUnion is not an array/);
    expect(countsError(counts(1), 21)).toMatch(/21/);
  });
  it("recomputeFine refuses malformed counts, a missing or doubled pair, and a grid other than the expected groups", () => {
    expect(recomputeFine([group(1), group(3)], [8], o, [{ seed: 1, N: 131072 }, { seed: 3, N: 131072 }])[0].verdict).toBe("material");
    const short = group(1);
    short.pairs[1] = { ...short.pairs[1], nearUnion: [], farDiff: [], farUnion: [] };
    expect(() => recomputeFine([short], [8], o)).toThrow(/K\|8: nearUnion has 0 entries, not 20/);
    const missing = group(3);
    missing.pairs.pop();
    expect(() => recomputeFine([group(1), missing], [8], o)).toThrow(/seed 3 .* 0 K pairs at R 8/);
    const doubled = group(3);
    doubled.pairs.push(doubled.pairs[0]);
    expect(() => recomputeFine([doubled], [8], o)).toThrow(/2 S pairs at R 8/);
    // Codex's case: one group's pairs gone from a done pilot must not turn "mixed" into "material" quietly.
    expect(() => recomputeFine([group(1)], [8], o, [{ seed: 1, N: 131072 }, { seed: 3, N: 131072 }])).toThrow(/N5 wants/);
    expect(() => recomputeFine([group(1), { ...group(3), status: "void" }], [8], o, [{ seed: 1, N: 131072 }, { seed: 3, N: 131072 }])).toThrow(/void in a done fine pilot/);
  });
  it("fineReadings: a fine horizon may start exactly at jMax, not after", () => {
    const fp = (j: number, near: number): FinePoint => ({ j, near: { diff: near, union: 100 }, far: { diff: 50, union: 100 } });
    const at = Array.from({ length: J }, (_, i) => fp(i + 1, i + 1 >= 17 ? 10 : 90));
    expect(fineReadings(at, o).fineHorizon).toEqual({ kind: "horizon", j: 17, steps: 17 * 64 - 1 });
    const after = Array.from({ length: J }, (_, i) => fp(i + 1, i + 1 >= 18 ? 10 : 90));
    expect(fineReadings(after, o).fineHorizon).toEqual({ kind: "censored", window: 17 * 64 - 1 });
  });
  it("fineQuiet: a fine horizon that starts before anything differs is vacuous", () => {
    const quiet = { ...counts(0, 0, 0, 100), nearDiff: Array(J).fill(0).map((_, i) => (i >= 9 ? 50 : 0)), nearUnion: Array(J).fill(0).map((_, i) => (i >= 9 ? 100 : 0)) };
    const p = pair("K|8", 8, "K", quiet);
    expect(p.readings.fineHorizon).toMatchObject({ kind: "horizon", j: 1 });
    expect(fineQuiet(p)).toEqual({ firstDiff: 10, emptyNear: 9, vacuous: true });
    expect(fineQuiet(pair("S8", 8, "S", counts(30)))).toEqual({ firstDiff: 1, emptyNear: 0, vacuous: false });
  });
  it("fineFileError: the plan's window and cadence, the prep's centres, and the binding when the file has one", () => {
    const want: FineBinding = { seed: 1, N: 131072, checkpointHash: "ck", stoneCentre: { x: 5, y: 6 }, kick: { x: 7, y: 8 }, window: 8192, every: 64, Kf: 16, jMax: 113 };
    const twins = [{ name: "U0" }, ...[8, 32, 64].map((R) => ({ name: `S${R}`, lesion: { x: 5, y: 6, r: R } })), { name: "K", lesion: { x: 7, y: 8, r: 0 } }];
    const f = { seed: 1, N: 131072, window: 8192, every: 64, Kf: 16, jMax: 113, twins };
    expect(fineFileError(f, want, [8, 32, 64])).toBeNull();
    expect(fineFileError({ ...f, binding: want }, want, [8, 32, 64])).toBeNull();
    // Codex's case: an 8,192-step fine directory beside a 4,096-step plan.
    expect(fineFileError(f, { ...want, window: 4096, jMax: 49 }, [8, 32, 64])).toMatch(/^window is 8192/);
    expect(fineFileError({ ...f, binding: { ...want, checkpointHash: "other" } }, want, [8, 32, 64])).toMatch(/^binding: checkpointHash/);
    expect(fineFileError({ ...f, twins: twins.map((t) => (t.name === "K" ? { name: "K", lesion: { x: 7, y: 9, r: 0 } } : t)) }, want, [8, 32, 64])).toMatch(/K's lesion/);
    expect(fineFileError({ ...f, twins: twins.slice(0, 4) }, want, [8, 32, 64])).toMatch(/^twins are/);
  });
});

describe("slice 34 review: N7's cap arithmetic", () => {
  const anchors = [{ N: 131072, steps: 6144 }, { N: 262144, steps: 5120 }];
  it("a group's and the fine pilot's worst cases", () => {
    expect(nullGroupWorst({ n0: 2, kMax: 128, K: 4, chunk: 16, censusEvery: 1024, rate: 1024 })).toBe(2 * 131 + 16 + 32);
    expect(nullGroupWorst({ n0: 0, kMax: 64, K: 4, chunk: 16, censusEvery: 1024, rate: 1024 })).toBe(2 * 67 + 16);
    // 3 * 5 * 2 * 8,192 * 1.3 plus the day-2 anchor; the day-1 anchor (6,144) is inside the 8,192 window but not the 4,096 one.
    expect(fineWorstSeconds({ window: 8192, rate: 1, groups: 3, anchors, day1: 131072 })).toBeCloseTo(30 * 8192 * 1.3 + 5120 * 1.3, 6);
    expect(fineWorstSeconds({ window: 4096, rate: 1, groups: 3, anchors, day1: 131072 })).toBeCloseTo(30 * 4096 * 1.3 + 5120 * 1.3 + 6144 * 1.3, 6);
  });
  it("nullScaleDown at each threshold: full, fine window 4,096, then the K window 64 as well", () => {
    const day1Worst = (kMax: number) => (kMax === 128 ? 1000 : 500);
    const fineWorst = (w: number) => (w === 8192 ? 400 : 200);
    const at = (cap: number) => nullScaleDown({ capSeconds: cap, elapsed: 100, day1Worst, fineWorst });
    expect(at(1500)).toMatchObject({ window: 8192, kMax: 128, scaleDown: "none", budget: 1500 });
    expect(at(1499)).toMatchObject({ window: 4096, kMax: 128, budget: 1300 });
    expect(at(1300).window).toBe(4096);
    expect(at(1299)).toMatchObject({ window: 4096, kMax: 64, budget: 800 });
    expect(at(1299).scaleDown).toMatch(/64 censuses/);
  });
});

describe("slice 34 review: branches of the arms and the compact record", () => {
  it("a kick whose census-1 hash equals U0's is recorded as such", async () => {
    const g = await runArms(armsIo(() => sigOf(0, 0), { hash: (_t, k) => `s-${k}` }).io, armsPlan({ nulls: [] }));
    expect(g.kick.sameAsU0At1).toBe(true);
  });
  it("recomputeNullPairs: a stopped-cap K pair must still be pending; malformed counts throw", async () => {
    const result = await runArms(armsIo(kBehave([1, 1000, 1000]), { deadline: 10 }).io, armsPlan({ nulls: [], horizon: { K: 4, kMax: 20, censusEvery: 1024 } }));
    const c = compactNullGroup({ seed: 1, N: 4096, status: "done", result }) as unknown as { pairs: { nearUnion: number[]; outcome: unknown }[] };
    const o = { K: 4, kMax: 20, censusEvery: 1024 };
    expect(recomputeNullPairs([c] as never, [8, 32, 64], o).map((p) => p.outcome.kind)).toEqual(["horizon", "stopped-cap", "stopped-cap"]);
    const decided = structuredClone(c);
    decided.pairs[0].outcome = { kind: "stopped-cap", reached: 4 }; // its counts decide it, so "stopped" is wrong
    expect(() => recomputeNullPairs([decided] as never, [8, 32, 64], o)).toThrow(/K\|8: the record's counts give/);
    const bad = structuredClone(c);
    bad.pairs[1].nearUnion = bad.pairs[1].nearUnion.slice(1);
    expect(() => recomputeNullPairs([bad] as never, [8, 32, 64], o)).toThrow(/K\|32: nearUnion has/);
  });
  it("compactNullGroup keeps a void group's fault and its prep", () => {
    const prep = { stoneCentre: { x: 1, y: 2 }, r0: 3, stale: 4, nulls: [], kick: { x: 5, y: 6 } } as never;
    expect(compactNullGroup({ seed: 1, N: 4096, status: "void", prep, fault: "NullFault: N0-8 is not U0" })).toEqual({ seed: 1, N: 4096, status: "void", prep, fault: "NullFault: N0-8 is not U0" });
  });
});

describe("slice 34: the slice-34 record still reads", () => {
  const rec = JSON.parse(readFileSync(new URL("../../experiments/garden/stone-null-2026-10-18.json", import.meta.url), "utf8"));
  const c = { radii: [8, 32, 64], K: 4, censusEvery: 1024, every: 64, Kf: 16, wander: 131072, day1: 131072 };
  const rec55File = JSON.parse(readFileSync(new URL("../../experiments/garden/stone-horizon-2026-10-18.json", import.meta.url), "utf8"));
  const grid55 = (rec55File.groups as { seed: number; N: number }[]).map((g) => ({ seed: g.seed, N: g.N }));
  it("nullReadings recomputed from the record's integer counts equals the readout it stores", () => {
    expect(JSON.parse(JSON.stringify(nullReadings(rec, c)))).toEqual(rec.readout);
    expect(JSON.parse(JSON.stringify(nullReadings(rec, { ...c, grid: grid55 })))).toEqual(rec.readout);
  });
  it("with #55's grid, a record that drops groups (and its fine groups) is refused (Codex pass 2)", () => {
    const cut = structuredClone(rec);
    const keep = (g: { seed: number }) => g.seed === 4;
    cut.groups = cut.groups.filter(keep);
    cut.sPairs = cut.sPairs.filter(keep);
    cut.fine.groups = cut.fine.groups.filter(keep);
    expect(() => nullReadings(cut, c)).not.toThrow(); // without the grid, the cut record reads (the defect)
    expect(() => nullReadings(cut, { ...c, grid: grid55 })).toThrow(/record: the groups are/);
  });
  it("its sPairs are #55's pairs recomputed from #55's own record", () => {
    const rec55 = JSON.parse(readFileSync(new URL("../../experiments/garden/stone-horizon-2026-10-18.json", import.meta.url), "utf8"));
    expect(sPairsFrom55(rec55, rec.groups, c.radii, c)).toEqual(rec.sPairs);
  });
  it("a tampered count or a dropped fine pair is refused", () => {
    const bad = structuredClone(rec);
    for (let j = 0; j < 4; j++) bad.groups[0].pairs[0].nearDiff[j] = bad.groups[0].pairs[0].nearUnion[j]; // near 1 > far: no horizon at census 1
    expect(() => nullReadings(bad, c)).toThrow(/the record's counts give/);
    const drop = structuredClone(rec);
    drop.fine.groups[1].pairs = drop.fine.groups[1].pairs.filter((p: { label: string }) => p.label !== "K|64");
    expect(() => nullReadings(drop, c)).toThrow(/0 K pairs at R 64/);
  });
});

describe("slice 34 review pass 2 (Codex)", () => {
  it("nearNotAboveFar and gapOf are exact past 2^53 (counts no jar holds, but a record could)", () => {
    const n = 134217728;
    const near = { diff: n - 1, union: n }, far = { diff: n - 2, union: n - 1 };
    // (n-1)(n-1) > (n-2)n by exactly 1, which doubles round away.
    expect((n - 1) * (n - 1) === (n - 2) * n).toBe(true);
    expect(nearNotAboveFar(near, far)).toBe(false);
    expect(gapOf(near, far)).toBeGreaterThan(0);
    const pts = Array.from({ length: 16 }, (_, i) => ({ j: i + 1, near, far }));
    const r = fineReadings(pts, { every: 64, Kf: 16, jMax: 1 });
    expect(r.cross).toBeNull();
    expect(r.gapArea).toBeGreaterThan(0);
    expect(r.fineHorizon).toEqual({ kind: "censored", window: 63 });
    // Small counts take the double path unchanged.
    expect(nearNotAboveFar({ diff: 1, union: 3 }, { diff: 2, union: 6 })).toBe(true);
    expect(gapOf({ diff: 2, union: 3 }, { diff: 1, union: 3 })).toBe((2 * 3 - 1 * 3) / (3 * 3));
  });
  it("runStatusError: exactly one valid pre-pilot hash, equal to the digest", () => {
    const d = "a".repeat(64);
    const head = "started 2026-10-18T17:58:34Z\n";
    expect(runStatusError(`${head}note-sha256-before-pilot ${d}\n== pilot x\n`, d)).toBeNull();
    expect(runStatusError("", d)).toMatch(/no note-sha256-before-pilot line/);
    expect(runStatusError(`note-sha256-before-pilot ${"a".repeat(63)}\n`, d)).toMatch(/malformed/);
    expect(runStatusError(`note-sha256-before-pilot ${"b".repeat(64)}\nnote-sha256-before-pilot ${d}\n`, d)).toMatch(/2 note-sha256-before-pilot lines/);
    expect(runStatusError(`note-sha256-before-pilot ${"b".repeat(64)}\n`, d)).toMatch(/hashed b+ before the pilot/);
    expect(parseRunStatus(`${head}note-sha256-before-pilot ${d}\n`).noteSha256BeforePilot).toBe(d);
  });
  it("cappedRun: a segment the deadline overtakes throws FineCap, never returns its result", async () => {
    let t = 0;
    const seg = (censuses: number) => async (stop: () => boolean) => {
      let ran = 0;
      for (let k = 1; k <= censuses; k++, t += 10) {
        ran = k;
        if (stop()) break;
      }
      return ran;
    };
    await expect(cappedRun(seg(8), () => t, 15, "a gate")).rejects.toBeInstanceOf(FineCap);
    t = 0;
    await expect(cappedRun(seg(8), () => t, 1_000, "a gate")).resolves.toBe(8);
  });
  it("fineFileError with gate evidence refuses failed gates, a wrong radius and a short U0 check", () => {
    const want: FineBinding = { seed: 1, N: 131072, checkpointHash: "ck", stoneCentre: { x: 5, y: 6 }, kick: { x: 7, y: 8 }, window: 8192, every: 64, Kf: 16, jMax: 113 };
    const ok = (name: string, lesion: { x: number; y: number; r: number } | null) => ({ name, lesion, effectiveR: lesion?.r ?? null, finalStateHash: `h${name}`, runnerStateHash: `h${name}`, gateOk: true });
    const twins = [ok("U0", null), ...[8, 32, 64].map((R) => ok(`S${R}`, { x: 5, y: 6, r: R })), ok("K", { x: 7, y: 8, r: 0 })];
    const f = { seed: 1, N: 131072, status: "done", window: 8192, every: 64, Kf: 16, jMax: 113, u0: { referenceChecked: 8 }, twins };
    const g = { u0Censuses: 8 };
    const R = [8, 32, 64];
    expect(fineFileError(f, want, R, g)).toBeNull();
    expect(fineFileError({ ...f, twins: twins.map((t) => ({ ...t, gateOk: false, runnerStateHash: "wrong" })) }, want, R)).toBeNull(); // without gate evidence (the defect)
    expect(fineFileError({ ...f, twins: twins.map((t) => ({ ...t, gateOk: false, runnerStateHash: "wrong" })) }, want, R, g)).toMatch(/U0's gate/);
    expect(fineFileError({ ...f, twins: twins.map((t) => (t.name === "S32" ? { ...t, runnerStateHash: "x" } : t)) }, want, R, g)).toMatch(/S32's gate/);
    expect(fineFileError({ ...f, twins: twins.map((t) => (t.name === "S64" ? { ...t, finalStateHash: null } : t)) }, want, R, g)).toMatch(/S64 has no final state hash/);
    expect(fineFileError({ ...f, twins: twins.map((t) => (t.name === "S8" ? { ...t, effectiveR: 7 } : t)) }, want, R, g)).toMatch(/S8's lesion was applied with radius 7/);
    expect(fineFileError({ ...f, u0: { referenceChecked: 0 } }, want, R, g)).toMatch(/at 0 censuses, not 8/);
    expect(fineFileError({ ...f, status: "void" }, want, R, g)).toMatch(/status is "void"/);
  });
  it("fineTopError: a done pilot has no failures and every anchor reproduced", () => {
    const A = [{ seed: 1, N: 131072, R: 8, steps: 6144, want: "aa" }, { seed: 4, N: 262144, R: 64, steps: 5120, want: "bb" }];
    const got = A.map((x) => ({ ...x, hash: x.want, ok: true }));
    expect(fineTopError({ status: "done", failures: [], anchors: got }, A)).toBeNull();
    expect(fineTopError({ status: "void", failures: ["x"], anchors: [] }, A)).toBeNull(); // not done: reads as nothing anyway
    expect(fineTopError({ status: "done", failures: ["x"], anchors: got }, A)).toMatch(/lists failures/);
    expect(fineTopError({ status: "done", failures: [], anchors: got.slice(1) }, A)).toMatch(/1 anchors, not 2/);
    expect(fineTopError({ status: "done", failures: [], anchors: [got[0], { ...got[1], hash: "cc", ok: false }] }, A)).toMatch(/S64 \+5120: hash "cc"/);
  });
  it("gridError compares (seed, N) sets exactly", () => {
    const w = [{ seed: 1, N: 1 }, { seed: 3, N: 1 }];
    expect(gridError([{ seed: 3, N: 1 }, { seed: 1, N: 1 }], w, "x")).toBeNull();
    expect(gridError([{ seed: 1, N: 1 }], w, "x")).toMatch(/^x: the groups are 1\/1, #55's are 1\/1, 3\/1/);
  });
});

describe("slice 34 review pass 3 (Codex)", () => {
  const rec = JSON.parse(readFileSync(new URL("../../experiments/garden/stone-null-2026-10-18.json", import.meta.url), "utf8"));
  const r55 = JSON.parse(readFileSync(new URL("../../experiments/garden/stone-horizon-2026-10-18.json", import.meta.url), "utf8"));
  const grid = (r55.groups as { seed: number; N: number }[]).map((g) => ({ seed: g.seed, N: g.N }));
  const anchors = [
    { seed: 1, N: 131_072, R: 8, steps: 6_144, want: "3067b35b80d9177f" },
    { seed: 4, N: 262_144, R: 64, steps: 5_120, want: "dd6f3f27cbfc6e70" },
  ];
  const J = rec.fine.window / 64;
  const u0Censuses = (g: { seed: number; N: number }) => Math.min(Math.floor(J / 16), r55.groups.find((x: { seed: number; N: number }) => x.seed === g.seed && x.N === g.N).u0.living.length);
  const c = { radii: [8, 32, 64], K: 4, censusEvery: 1024, every: 64, Kf: 16, wander: 131072, day1: 131072, grid, fineGate: { anchors, u0Censuses } };

  it("cappedRun: a deadline that passes after the last census callback still discards the result", async () => {
    let t = 0;
    // One census whose callback sees time 14 (deadline 15), then the final readback takes the clock to 16 before returning.
    const seg = async (stop: () => boolean) => {
      t = 14;
      stop();
      t = 16;
      return "result";
    };
    await expect(cappedRun(seg, () => t, 15, "a gate")).rejects.toBeInstanceOf(FineCap);
    t = 0;
    await expect(cappedRun(async (stop) => (stop(), "ok"), () => 10, 15, "a gate")).resolves.toBe("ok");
  });

  it("the record reads with its gate evidence, and with every gate check, as stored", () => {
    expect(JSON.parse(JSON.stringify(nullReadings(rec, c)))).toEqual(rec.readout);
    expect(rec.fine.groups.map(u0Censuses)).toEqual([8, 8, 8]);
  });

  it("a record whose fine evidence shows a failure, a failed gate or a wrong anchor does not read", () => {
    const tamper = (f: (r: typeof rec) => void) => {
      const r = structuredClone(rec);
      f(r);
      return r;
    };
    expect(() => nullReadings(tamper((r) => (r.fine.failures = ["x"])), c)).toThrow(/fine: a done fine pilot lists failures/);
    expect(() => nullReadings(tamper((r) => (r.fine.failures = undefined)), c)).toThrow(/lists failures/);
    expect(() => nullReadings(tamper((r) => (r.fine.anchors[1].ok = false)), c)).toThrow(/anchor seed 4/); // ok false alone, hash right
    expect(() => nullReadings(tamper((r) => (r.fine.anchors[0].hash = "wrong")), c)).toThrow(/anchor seed 1/);
    expect(() => nullReadings(tamper((r) => (r.fine.groups[1].twins[2].gateOk = "true")), c)).toThrow(/fine seed 3 N 131072: S32's gate/); // truthy, not true
    expect(() => nullReadings(tamper((r) => (r.fine.groups[0].twins[4].runnerStateHash = "wrong")), c)).toThrow(/K's gate/);
    expect(() => nullReadings(tamper((r) => (r.fine.groups[2].u0.referenceChecked = 7)), c)).toThrow(/at 7 censuses, not 8/);
    expect(() => nullReadings(tamper((r) => (r.fine.groups[2].status = "void")), c)).toThrow(/status is "void"/);
    // Without fineGate the reader does not look at the evidence (the defect).
    const { fineGate: _f, ...bare } = c;
    expect(() => nullReadings(tamper((r) => (r.fine.failures = ["x"])), bare)).not.toThrow();
  });

  it("with #55's grid, a record that drops a stone pair at R = 32 or 64 only is refused", () => {
    for (const R of [32, 64]) {
      const cut = structuredClone(rec);
      let kept = false;
      cut.sPairs = cut.sPairs.filter((p: { R: number; seed: number; N: number }) => p.R !== R || (p.seed === 3 && p.N === 131072 && !kept && (kept = true)));
      expect(() => nullReadings(cut, { ...c, fineGate: undefined, grid: undefined })).not.toThrow(); // without the grid it reads (the defect)
      expect(() => nullReadings(cut, c)).toThrow(new RegExp(`sPairs at R ${R}: the groups are 3/131072,`));
    }
    const dup = structuredClone(rec);
    dup.sPairs.push(dup.sPairs[0]);
    expect(() => nullReadings(dup, c)).toThrow(/sPairs at R 8: the groups are 1\/131072, 1\/131072,/);
    const extra = structuredClone(rec);
    extra.sPairs.push({ ...extra.sPairs[0], R: 16 });
    expect(() => nullReadings(extra, c)).toThrow(/28 pairs, not 9 groups x 3 radii/);
  });

  it("fineGateError: each check on its own", () => {
    const ok = (name: string, lesion: { x: number; y: number; r: number } | null) => ({ name, lesion, effectiveR: lesion?.r ?? null, finalStateHash: `h${name}`, runnerStateHash: `h${name}`, gateOk: true as unknown });
    const twins = [ok("U0", null), ok("S8", { x: 1, y: 2, r: 8 }), ok("K", { x: 3, y: 4, r: 0 })];
    const f = { status: "done", u0: { referenceChecked: 8 }, twins };
    expect(fineGateError(f, 8)).toBeNull();
    expect(fineGateError({ ...f, twins: twins.map((t) => (t.name === "S8" ? { ...t, gateOk: 1 } : t)) }, 8)).toMatch(/S8's gate/);
    expect(fineGateError({ ...f, twins: twins.map((t) => (t.name === "K" ? { ...t, lesion: null } : t)) }, 8)).toMatch(/K's lesion/);
    expect(fineGateError({ ...f, twins: [] }, 8)).toBe("no twins");
    expect(fineGateError({ ...f, u0: undefined }, 8)).toMatch(/at undefined censuses/);
  });
});

describe("ps notes keep pid, %cpu, elapsed and the program only (security review)", () => {
  const ROW = /^\s*\d+\s+\d+(?:[.,]\d+)?\s+[\d:-]+\s+[\w.+-]+(?: [\w.+-]+)?$/;
  const listing = [
    "  PID  %CPU ELAPSED COMMAND",
    "86223  89.5       00:00 deno run -A --no-lock tools/horizon.ts nullrun --prep /private/tmp/claude-501/scratch/prep.json",
    " 4100   1.0       00:05 /usr/bin/env BL_ADMIN_TOKEN=x deno run -A https://host.example/x.ts?k=v",
    " 4101   2.0       00:05 deno run -A --allow-net=https://host.example BL_ADMIN_TOKEN=x https://host.example/mod.ts",
    " 6693   0.0    19:52:03 node /Users/nicholas/develop/browser-life-main/node_modules/.bin/../vite/bin/vite.js --port 5173",
    " 5189   0.0  3-00:00:36 /opt/homebrew/bin/zsh -lc PATH=/opt/homebrew/opt/node/bin:$PATH BL_ADMIN_TOKEN=x pnpm vitest run > /tmp/out",
    "  812  12.5    01:02:03 /Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Helpers/Google Chrome Helper (GPU).app/Contents/MacOS/Google Chrome Helper (GPU) --type=gpu-process --user-data-dir=/Users/nicholas/x",
    " 7000   0.0       00:01 BL_ADMIN_TOKEN=x vite --open https://localhost:5173/?token=x",
  ].join("\n");
  const leaks = (out: string) => {
    for (const bad of ["/", "=", "://", "TOKEN", "BL_ADMIN", "Users", "private", "tmp", "host.example", "?"]) expect(out, `${bad} survived in ${JSON.stringify(out)}`).not.toContain(bad);
  };
  it("reducePsLine drops paths, KEY=value pairs and URLs", () => {
    expect(reducePsLine("86223  89.5       00:00 deno run -A --no-lock tools/horizon.ts nullrun --prep /private/tmp/p.json")).toBe("86223  89.5       00:00 deno horizon.ts");
    expect(reducePsLine(" 6693   0.0    19:52:03 node /Users/nicholas/x/node_modules/.bin/../vite/bin/vite.js")).toBe(" 6693   0.0    19:52:03 node vite.js");
    expect(reducePsLine(" 4100   1.0       00:05 /usr/bin/env BL_ADMIN_TOKEN=x deno run -A https://host.example/x.ts")).toBe(" 4100   1.0       00:05 env");
    expect(reducePsLine(" 4101   2.0       00:05 deno run -A https://host.example/mod.ts")).toBe(" 4101   2.0       00:05 deno");
    expect(reducePsLine("  812  12.5    01:02:03 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome Helper (GPU) --type=gpu-process")).toBe("  812  12.5    01:02:03 gpu-helper");
    expect(reducePsLine(" 7000   0.0       00:01 BL_ADMIN_TOKEN=x vite")).toBe(" 7000   0.0       00:01 unknown");
    expect(reducePsLine("  PID  %CPU ELAPSED COMMAND")).toBeNull();
    expect(reducePsLine("")).toBeNull();
  });
  it("psNoteOf: the whole listing filtered and reduced, nothing sensitive survives", () => {
    const out = psNoteOf(listing);
    leaks(out);
    const rows = out.split("\n");
    expect(rows).toHaveLength(7);
    for (const r of rows) expect(r).toMatch(ROW);
    expect(rows[0]).toBe("86223  89.5       00:00 deno horizon.ts");
  });
  it("parseRunStatus reduces a stage's ps lines the same way", () => {
    const text = `started 2026-10-18T17:58:34Z\n== pilot 2026-10-18T17:58:34Z\n${listing}\n13:58  up 16 days, load averages: 1.0 2.0 3.0\nexit pilot 0\n`;
    const st = parseRunStatus(text);
    expect(st.stages).toHaveLength(1);
    expect(st.stages[0].ps).toHaveLength(7);
    for (const r of st.stages[0].ps) expect(r).toMatch(ROW);
    leaks(st.stages[0].ps.join("\n"));
    expect(JSON.stringify(st.other ?? [])).not.toMatch(/TOKEN|Users|:\/\//);
  });
  it("only the entrypoint is named, and reducing twice changes nothing (Codex review)", () => {
    expect(reducePsLine("1 0.0 00:01 deno run https://host/app.ts --token SECRET.ts")).toBe("1 0.0 00:01 deno");
    expect(reducePsLine("1 0.0 00:01 deno run -A tools/x.ts --token SECRET.ts")).toBe("1 0.0 00:01 deno x.ts");
    expect(reducePsLine("1 0.0 00:01 node --require /Users/nicholas/s BL_ADMIN_TOKEN=x.js")).toBe("1 0.0 00:01 node");
    expect(reducePsLine("1 0.0 00:01 node --eval=setInterval(()=>{},1000) -- --token SECRET-vite.js")).toBe("1 0.0 00:01 node");
    expect(reducePsLine("1 0.0 00:01 node -e 0 SECRET-vite.js")).toBe("1 0.0 00:01 node");
    expect(reducePsLine("1 0.0 00:01 node - --token SECRET-vite.js")).toBe("1 0.0 00:01 node");
    expect(reducePsLine("1 0.0 00:01 node ./-vite.js")).toBe("1 0.0 00:01 node");
    expect(reducePsLine("1 0.0 00:01 node --enable-source-maps tools/vite.js")).toBe("1 0.0 00:01 node vite.js");
    for (const l of psNoteOf(listing).split("\n")) expect(reducePsLine(l)).toBe(l);
  });
  it("parseRunStatus: process rows outside a stage, or saying load averages, never survive whole (Codex review)", () => {
    const d = "c".repeat(64);
    const text = [
      `note-sha256-before-pilot ${d}`,
      "9 0.0 00:01 deno run /private/app.ts KEY=secret",
      "== pilot 2026-10-18T17:58:34Z",
      "10 0.0 00:01 deno run app.ts --label load averages: --token SECRET",
      "13:58  up 16 days, load averages: 1.0 2.0 3.0",
      "exit pilot 0",
      "11 0.0 00:01 node /Users/nicholas/x/vite.js BL_ADMIN_TOKEN=x",
      "something odd /Users/nicholas/secret BL_ADMIN_TOKEN=x https://host.example/?k=v plain",
    ].join("\n");
    const st = parseRunStatus(text);
    expect(st.stages[0].ps).toEqual(["10 0.0 00:01 deno app.ts"]);
    expect(st.stages[0].uptime).toBe("13:58  up 16 days, load averages: 1.0 2.0 3.0");
    expect(st.other).toEqual(["9 0.0 00:01 deno app.ts", "11 0.0 00:01 node vite.js", "something odd [redacted] [redacted] [redacted] plain"]);
    expect(JSON.stringify(st)).not.toMatch(/SECRET|secret|TOKEN|Users|private|:\/\//);
  });
  it("scrubRecordPs reduces both ps shapes of a record, and only them", () => {
    const rec = {
      host: "h",
      stages: [{ stage: "g", uptime: "u", ps: " 1 0.0 00:01 deno run -A /Users/nicholas/t/horizon.ts --prep /private/tmp/p\n 2 0.0 00:01 /bin/zsh -lc BL_ADMIN_TOKEN=x pnpm" }],
      runStatus: { file: "f", stages: [{ stage: "pilot", ps: [" 3 1.0 00:02 node /Users/nicholas/vite.js https://x/?t=1"] }], other: ["a /Users/x b"] },
    };
    expect(scrubRecordPs(structuredClone(rec))).toEqual({
      host: "h",
      stages: [{ stage: "g", uptime: "u", ps: " 1 0.0 00:01 deno horizon.ts\n 2 0.0 00:01 zsh" }],
      runStatus: { file: "f", stages: [{ stage: "pilot", ps: [" 3 1.0 00:02 node vite.js"] }], other: ["a [redacted] b"] },
    });
  });
  it("the committed slice-34 record carries only reduced ps lines", () => {
    const rec = JSON.parse(readFileSync(new URL("../../experiments/garden/stone-null-2026-10-18.json", import.meta.url), "utf8"));
    const lines = [
      ...(rec.stages as { ps?: string }[]).flatMap((s) => (s.ps ? s.ps.split("\n") : [])),
      ...(rec.runStatus.stages as { ps: string[] }[]).flatMap((s) => s.ps),
    ];
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) expect(l).toMatch(ROW);
    expect(JSON.stringify(scrubRecordPs(structuredClone(rec)))).toBe(JSON.stringify(rec));
  });
});
