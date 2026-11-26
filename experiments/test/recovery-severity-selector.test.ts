import { describe, expect, it } from "vitest";
import { allocState, CH, defaultConfig, cellCount, stateHash } from "@bl/schema";
import { enumerateCandidates, enumerateCandidatesDetailed, selectPair, type SeverityCandidate } from "../recovery-severity/selector.ts";

function line(length = 10, amount = 100) {
  const state = allocState({ ...defaultConfig(), tileW: 64, tileH: 64, tilesX: 1, tilesY: 1 });
  const cells = Array.from({ length }, (_, x) => 20 * 64 + 20 + x);
  const n = cellCount(state.cfg);
  for (const i of cells) state.cells[CH.B * n + i] = amount;
  return { state, target: { cells, mass: length * amount }, n };
}
function candidate(overrides: Partial<SeverityCandidate> = {}): SeverityCandidate {
  return { center: 1, radius: 2, damage: 400, originalMass: 1000, collateral: 0, survivingMass: 600,
    remnantLabel: 0, remnantMass: 600, remnantTargetMass: 600, remnantOverlapCells: 6, ...overrides };
}
describe("zero-step severity selector", () => {
  it("enumerates measured 40% lesions, preserves input, and keeps contiguous survivors", () => {
    const { state, target } = line();
    const before = stateHash(state);
    const { candidates, counts } = enumerateCandidatesDetailed(state, target);
    expect(candidates.length).toBeGreaterThan(0);
    expect(counts.enumerated).toBe(310);
    expect(Object.entries(counts).filter(([k]) => k !== "enumerated").reduce((s, [, v]) => s + v, 0)).toBe(310);
    for (const c of candidates) {
      expect(c.damage).toBe(400); expect(c.survivingMass).toBe(600);
      expect(c.remnantTargetMass).toBe(600); expect(c.collateral).toBe(0);
    }
    expect(stateHash(state)).toBe(before);
  });
  it("rejects a balanced split even when delivered dose is within range", () => {
    const { state, target } = line(13);
    const { candidates, counts } = enumerateCandidatesDetailed(state, target);
    expect(counts.fragmented).toBeGreaterThan(0);
    expect(candidates.some(c => c.center === target.cells[6] && c.radius === 2)).toBe(false);
  });
  it("accepts an 80% retained remnant and rejects one unit shifted to the split daughter", () => {
    const { state, target, n } = line(8);
    // A three-cell interior cut leaves a four-cell remnant and one isolated cell.
    // Both cases destroy exactly 400 of 1000; only surviving topology/mass changes.
    const masses = [120, 120, 120, 120, 134, 133, 133, 120];
    target.mass = 1000;
    for (let k = 0; k < masses.length; k++) state.cells[CH.B * n + target.cells[k]] = masses[k];
    const chosen = (c: SeverityCandidate) => c.center === target.cells[5] && c.radius === 1;
    const boundary = enumerateCandidates(state, target).find(chosen);
    expect(boundary?.damage).toBe(400);
    expect(boundary?.remnantTargetMass).toBe(480);
    expect(boundary?.survivingMass).toBe(600);
    state.cells[CH.B * n + target.cells[0]]--;
    state.cells[CH.B * n + target.cells[7]]++;
    expect(enumerateCandidates(state, target).some(chosen)).toBe(false);
  });
  it("rejects collateral above 5% and accepts the exact boundary", () => {
    const { state, target, n } = line();
    const center = target.cells[0];
    const outside = center - 2 * 64;
    state.cells[CH.P * n + outside] = 50;
    expect(enumerateCandidates(state, target).some(c => c.center === center && c.radius === 3 && c.collateral === 50)).toBe(true);
    state.cells[CH.P * n + outside] = 51;
    const result = enumerateCandidatesDetailed(state, target);
    expect(result.candidates.some(c => c.center === center && c.radius === 3)).toBe(false);
    expect(result.counts.collateralRejected).toBeGreaterThan(0);
  });
  it("uses toroidal geometry and both bound channels", () => {
    const { state, n } = line(0);
    const cells = [62, 63, 0, 1, 2, 3, 4, 5, 6, 7].map(x => 20 * 64 + x);
    for (const i of cells) { state.cells[CH.B * n + i] = 40; state.cells[CH.P * n + i] = 60; }
    expect(enumerateCandidates(state, { cells, mass: 1000 }).some(c => c.center === cells[0] && c.radius === 3 && c.damage === 400)).toBe(true);
  });
  it("rejects a mass-consistent subset of the original component", () => {
    const { state, target } = line();
    expect(() => enumerateCandidates(state, { cells: target.cells.slice(1), mass: 900 })).toThrow(/complete original census component/);
  });
  it("rejects target cells combined from distinct original components", () => {
    const { state, target, n } = line();
    const remote = 40 * 64 + 40;
    state.cells[CH.B * n + remote] = 100;
    expect(() => enumerateCandidates(state, { cells: [...target.cells, remote], mass: 1100 })).toThrow(/complete original census component/);
  });
  it("rejects stale target metadata", () => {
    const { state, target } = line();
    expect(() => enumerateCandidates(state, { ...target, mass: 999 })).toThrow(/target mass/);
  });
});
describe("joint rational objective", () => {
  it("accepts exactly 2.5pp difference, rejects above it and empty sets", () => {
    const p = candidate();
    expect(selectPair([p], [candidate({ damage: 425 })])).not.toBeNull();
    expect(selectPair([candidate({ damage: 375 })], [candidate({ damage: 401 })])).toBeNull();
    expect(selectPair([], [p])).toBeNull();
  });
  it("prioritizes maximum error, then dose difference, then collateral", () => {
    const m = candidate({ damage: 410 });
    const exact = candidate({ damage: 400, collateral: 50 });
    const worse = candidate({ damage: 380 });
    expect(selectPair([worse, exact], [m])?.parent).toBe(exact);
    const matching = candidate({ damage: 410, collateral: 50 });
    expect(selectPair([exact, matching], [m])?.parent).toBe(matching);
    const clean = candidate({ damage: 410, center: 100 });
    expect(selectPair([matching, clean], [m])?.parent).toBe(clean);
  });
  it("breaks exact rational ties by radius sum then centers then individual radii regardless of input order", () => {
    const m = candidate();
    const large = candidate({ radius: 4, center: 0 });
    const small = candidate({ radius: 1, center: 8 });
    const earlier = candidate({ radius: 1, center: 3, damage: 800, originalMass: 2000 });
    expect(selectPair([large, small, earlier], [m])?.parent).toBe(earlier);
    expect(selectPair([earlier, small, large], [m])?.parent).toBe(earlier);
  });
  it("distinguishes rational errors below floating point cross-product precision", () => {
    const mass = 8_000_000_000_000_000;
    const exact = candidate({ originalMass: mass, damage: 3_200_000_000_000_000, center: 99 });
    const off = candidate({ originalMass: mass, damage: 3_200_000_000_000_001, center: 0 });
    expect(selectPair([off, exact], [exact])?.parent).toBe(exact);
  });
});
