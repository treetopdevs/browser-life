import { describe, expect, it } from "vitest";
import { CH, allocState, cellCount, defaultConfig, type FluxName } from "@bl/schema";
import { globalBound, reactBoundCohort, regionBound, selectedInterval,
  unknownReactionBoundCohort,
  type BoundCohort, type CellFlux } from "../lib/reset-material-bounds-v1.ts";

const cfg = defaultConfig({ tileW: 8, tileH: 8, tilesX: 1, tilesY: 1, kernelRadius: 2 });
const emptyFlux = (): CellFlux => Object.fromEntries(
  ["photo", "resp", "decomp", "grow", "build", "emit", "starve", "pdecay", "bdecay", "abio"]
    .map(k => [k, 0])) as Record<FluxName, number>;
const arr = (n: number, value = { lo: 0, hi: 0 }) => Array.from({ length: n }, () => ({ ...value }));
const world = (step: number, pools: Partial<Record<"A" | "B" | "C" | "P", number>>) => {
  const s = allocState(cfg), n = cellCount(cfg); s.step = step;
  for (const name of ["A", "B", "C", "P"] as const)
    s.cells[CH[name] * n] = pools[name] ?? 0;
  return s;
};
const cohortAtZero = (oldB: number, oldP: number): BoundCohort => {
  const n = cellCount(cfg), c: BoundCohort = { B: arr(n), P: arr(n),
    totalLo: oldB + oldP, totalHi: oldB + oldP };
  c.B[0] = { lo: oldB, hi: oldB }; c.P[0] = { lo: oldP, hi: oldP };
  return c;
};
const fluxAtZero = (amounts: Partial<CellFlux>): CellFlux[] => {
  const flux = Array.from({ length: cellCount(cfg) }, emptyFlux);
  Object.assign(flux[0], amounts); return flux;
};

describe("continuously bound material intervals", () => {
  it("contains every integer allocation of a selected transport or loss share", () => {
    for (let pool = 0; pool <= 8; pool++) for (let lo = 0; lo <= pool; lo++)
      for (let hi = lo; hi <= pool; hi++) for (let selected = 0; selected <= pool; selected++) {
        const interval = selectedInterval({ lo, hi }, pool, selected);
        for (let actualOld = lo; actualOld <= hi; actualOld++)
          for (let pickedOld = Math.max(0, selected - (pool - actualOld));
            pickedOld <= Math.min(actualOld, selected); pickedOld++) {
            expect(interval.lo).toBeLessThanOrEqual(pickedOld);
            expect(interval.hi).toBeGreaterThanOrEqual(pickedOld);
          }
      }
  });

  it("keeps synthesis separate from old bound material through same-step loss and build", () => {
    const n = cellCount(cfg), pre = allocState(cfg), post = allocState(cfg);
    pre.cells[CH.A * n] = 10; pre.cells[CH.B * n] = 10;
    pre.cells[CH.P * n] = 1;
    post.step = 1;
    post.cells[CH.A * n] = 3; post.cells[CH.B * n] = 8;
    post.cells[CH.C * n] = 7; post.cells[CH.P * n] = 3;
    const cohort: BoundCohort = { B: arr(n), P: arr(n), totalLo: 11, totalHi: 11 };
    cohort.B[0] = { lo: 10, hi: 10 }; cohort.P[0] = { lo: 1, hi: 1 };
    const flux = Array.from({ length: n }, emptyFlux);
    Object.assign(flux[0], { photo: 5, resp: 3, grow: 2, build: 4,
      starve: 1, pdecay: 2, bdecay: 1 });
    const result = reactBoundCohort(pre, post, cohort, flux);
    const total = globalBound(result);
    // Enumerate compatible token choices independently of the interval code.
    const possible = new Set<number>();
    const take = (old: number, fresh: number, amount: number): number[] => {
      const choices: number[] = [];
      for (let k = 0; k <= amount; k++) if (k <= old && amount - k <= fresh) choices.push(k);
      return choices;
    };
    for (const respOld of take(10, 5, 3)) {
      const b1 = 10 - respOld, f1 = 5 - (3 - respOld) + 2;
      for (const buildOld of take(b1, f1, 4)) {
        const b2 = b1 - buildOld, f2 = f1 - (4 - buildOld);
        for (const starveOld of take(b2, f2, 1)) {
          const b3 = b2 - starveOld, f3 = f2 - (1 - starveOld);
          for (const pDecayOld of take(1 + buildOld, 4 - buildOld, 2))
            for (const bDecayOld of take(b3, f3, 1))
              possible.add(b3 - bDecayOld + 1 + buildOld - pDecayOld);
        }
      }
    }
    expect(possible.size).toBeGreaterThan(1);
    for (const actual of possible) {
      expect(total.lo).toBeLessThanOrEqual(actual);
      expect(total.hi).toBeGreaterThanOrEqual(actual);
    }
    expect(total.hi).toBeLessThanOrEqual(11);
  });

  it("rejects invented local extents even if B/P happens to balance", () => {
    const n = cellCount(cfg), pre = allocState(cfg), post = allocState(cfg);
    pre.cells[CH.A * n] = 10; pre.cells[CH.B * n] = 10;
    post.step = 1; post.cells[CH.A * n] = 10; post.cells[CH.B * n] = 10;
    const c: BoundCohort = { B: arr(n), P: arr(n), totalLo: 1, totalHi: 1 };
    c.B[0] = { lo: 1, hi: 1 };
    const flux = Array.from({ length: n }, emptyFlux);
    flux[0].photo = 1; flux[0].resp = 1;
    expect(() => reactBoundCohort(pre, post, c, flux)).toThrow("dissolved balance");
  });

  it("preserves an initial joint cap after repeated independent site projections", () => {
    const c: BoundCohort = { B: [{ lo: 0, hi: 8 }, { lo: 0, hi: 8 }],
      P: [{ lo: 0, hi: 0 }, { lo: 0, hi: 0 }], totalLo: 0, totalHi: 8 };
    expect(globalBound(c)).toEqual({ lo: 0, hi: 8 });
  });

  it("uses complement mass to tighten a selected region", () => {
    const c: BoundCohort = { B: [{ lo: 0, hi: 8 }, { lo: 0, hi: 3 }],
      P: [{ lo: 0, hi: 0 }, { lo: 0, hi: 0 }], totalLo: 8, totalHi: 8 };
    expect(regionBound(c, new Set([0]))).toEqual({ lo: 5, hi: 8 });
  });

  it("carries exact no-loss total and persistent guaranteed decay loss", () => {
    const n = cellCount(cfg), pre = allocState(cfg), post = allocState(cfg);
    pre.cells[CH.B * n] = 10; post.step = 1; post.cells[CH.B * n] = 7;
    post.cells[CH.C * n] = 3;
    const c: BoundCohort = { B: arr(n), P: arr(n), totalLo: 10, totalHi: 10 };
    c.B[0] = { lo: 10, hi: 10 };
    const flux = Array.from({ length: n }, emptyFlux); flux[0].bdecay = 3;
    const after = reactBoundCohort(pre, post, c, flux);
    expect(globalBound(after)).toEqual({ lo: 7, hi: 7 });
    expect(after.totalHi).toBe(7);
  });

  it("retains all old B and P exactly with no reaction", () => {
    const result = reactBoundCohort(world(0, { B: 7, P: 3 }),
      world(1, { B: 7, P: 3 }), cohortAtZero(7, 3), fluxAtZero({}));
    expect(result.B[0]).toEqual({ lo: 7, hi: 7 });
    expect(result.P[0]).toEqual({ lo: 3, hi: 3 });
    expect(globalBound(result)).toEqual({ lo: 10, hi: 10 });
  });

  it("detects complete replacement despite equal final bound mass", () => {
    // Respiration precedes growth in the actual rule: all old B is lost first.
    const result = reactBoundCohort(world(0, { A: 10, B: 10 }),
      world(1, { B: 10, C: 10 }), cohortAtZero(10, 0),
      fluxAtZero({ resp: 10, grow: 10 }));
    expect(result.B[0]).toEqual({ lo: 0, hi: 0 });
    expect(globalBound(result)).toEqual({ lo: 0, hi: 0 });
  });

  it("keeps partial mixed B-to-P transfer uncertain while conserving the total", () => {
    const c = cohortAtZero(5, 0);
    const result = reactBoundCohort(world(0, { B: 10 }),
      world(1, { B: 6, P: 4 }), c, fluxAtZero({ build: 4 }));
    expect(result.B[0]).toEqual({ lo: 1, hi: 5 });
    expect(result.P[0]).toEqual({ lo: 0, hi: 4 });
    expect(globalBound(result)).toEqual({ lo: 5, hi: 5 });
  });

  it("does not relabel recycled atoms as continuously bound material", () => {
    const lost = reactBoundCohort(world(0, { B: 10 }), world(1, { C: 10 }),
      cohortAtZero(10, 0), fluxAtZero({ resp: 10 }));
    const dissolved = reactBoundCohort(world(1, { C: 10 }), world(2, { A: 10 }),
      lost, fluxAtZero({ decomp: 10 }));
    const rebuilt = reactBoundCohort(world(2, { A: 10 }), world(3, { B: 10 }),
      dissolved, fluxAtZero({ grow: 10 }));
    expect(globalBound(rebuilt)).toEqual({ lo: 0, hi: 0 });
    expect(rebuilt.B[0]).toEqual({ lo: 0, hi: 0 });
  });

  it("preserves all old material through pure B-to-P polymerization", () => {
    const result = reactBoundCohort(world(0, { B: 10 }), world(1, { P: 10 }),
      cohortAtZero(10, 0), fluxAtZero({ build: 10 }));
    expect(result.B[0]).toEqual({ lo: 0, hi: 0 });
    expect(result.P[0]).toEqual({ lo: 10, hi: 10 });
    expect(globalBound(result)).toEqual({ lo: 10, hi: 10 });
  });

  it("rejects NaN and negative local cohort values before propagation", () => {
    const pre = world(0, { B: 10 }), post = world(1, { B: 10 });
    for (const invalid of [NaN, -1]) {
      const c = cohortAtZero(5, 0); c.B[0].lo = invalid;
      expect(() => reactBoundCohort(pre, post, c, fluxAtZero({})))
        .toThrow("invalid cohort interval/pool");
      expect(() => unknownReactionBoundCohort(pre, post, c))
        .toThrow("invalid cohort interval/pool");
      expect(() => globalBound(c)).toThrow("invalid cohort interval/pool");
      expect(() => regionBound(c, new Set([0]))).toThrow("invalid cohort interval/pool");
    }
  });
});
