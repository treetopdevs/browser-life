import { describe, expect, it } from "vitest";
import type { Census } from "@bl/metrics";
import { cleanRecovery, RemnantTrack } from "../recovery-accessibility/observer.ts";

function frame(step: number, labels: number[], masses: number[]): Census {
  return { step, labels: Int32Array.from(labels), livingCells: labels.filter(x => x >= 0).length, lineages: [],
    components: masses.map((mass, idx) => ({ idx, mass, cells: labels.filter(x => x === idx).length,
      biomass: mass, cx: 0, cy: 0, tile: 0, lineage: "0:1", purity: 1, mu: 60, sigma: 20 })) };
}

describe("recovery remnant continuity", () => {
  it("accepts the same growing remnant but rejects replacement at a different location", () => {
    const start = frame(0, [0, 0, -1, -1], [200]);
    const growth = new RemnantTrack(start, 0, 300);
    growth.update(frame(50, [0, 0, 0, -1], [300]));
    expect(growth.result().recovered).toBe(true);
    const replacement = new RemnantTrack(start, 0, 300);
    replacement.update(frame(50, [-1, -1, 0, 0], [300]));
    expect(replacement.result().recovered).toBe(false);
    expect(replacement.result().lost).toBe(true);
  });
});

it("rejects incoming overlap even when the tracker does not report a full fusion", () => {
  const t = new RemnantTrack(frame(0, [0, 0, 1, 1, 1, -1], [200, 300]), 0, 300);
  // The other parent retains its own child, so Tracker's fusion event can omit it.
  t.update(frame(50, [0, 0, 0, 1, 1, -1], [300, 200]));
  expect(t.result().retained).toBe(true);
  expect(t.result().merged).toBe(true);
  expect(t.result().recovered).toBe(false);
});

it("does not sum split daughters or count dead/subthreshold remnants", () => {
  const t = new RemnantTrack(frame(0, [0, 0, 0, 0], [300]), 0, 400);
  t.update(frame(50, [0, 0, 1, 1], [200, 200]));
  expect(t.result().recovered).toBe(false);
  const dead = new RemnantTrack(frame(0, [-1, -1], []), undefined, 300);
  dead.update(frame(50, [0, 0], [400]));
  expect(dead.result().recovered).toBe(false);
  const tiny = new RemnantTrack(frame(0, [0, 0], [120]), 0, 200);
  tiny.update(frame(50, [0, 0], [300]));
  expect(tiny.result().recovered).toBe(false);
});

import { evalConfig, genomeHex, pairedTest, PROTOCOL, SCIENCE_SEEDS, subjects, summarize, validateCase, worldConfig, type CaseResult, type Pair } from "../recovery-accessibility/protocol.ts";
import type { RecoveryObservation } from "../recovery-accessibility/observer.ts";
function sample(seed: number, subject: "parent" | "mutant", R: boolean): CaseResult {
  const history = { step: 0, mass: R ? 300 : 200, label: 0, edges: [{ from: 0, to: 0, cells: 2 }], split: false, merged: false, lost: false };
  const track = { initialLabel: 0, recovered: R, retained: R, merged: false, lost: false, mass: R ? 300 : 200, history: Array.from({ length: 40 }, (_, i) => ({ ...history, step: 3000 + (i + 1) * 50 })) };
  const states = Object.fromEntries(["initial", "grown", "tile-lesion-end", "regen-start", "regen-end", "dark-end", "light-end"].map(p => [p, { hash: "0".repeat(16), step: p === "initial" ? 0 : p === "grown" || p === "regen-start" ? 3000 : 5000, matter: "1000", residual: "0", B: "300", P: "0" }]));
  const observation: RecoveryObservation = { target: { tile: 0, idx: 0, cells: [0, 1], mass: 300, lesion: { center: 0, radius: 1 } }, targetCells: [], removedMass: 90, immediateMass: 210, originalCellsInRemnant: 1, R, R_clean: R, reason: R ? "recovery" : "insufficient-regrowth", sensitivity: { low: R, high: R }, tracks: { normal: track, fast: { ...track, history: Array.from({ length: 80 }, (_, i) => ({ ...history, step: 3000 + (i + 1) * 25 })) }, low: track, high: track }, states };
  return { protocol: PROTOCOL, manifestHash: "test", id: `${subject}-${seed}`, seed, subject, genome: "test", config: worldConfig(seed), artifacts: [], observation,
    evaluation: { survived: 1, recovered: 1, lightDependent: 1, reps: 1, individuals: 1, meanMass: 300, speed: 0, mass: 300, recovery: 1, regenerated: Number(R), reproduction: 0,
      perRep: [{ alive: true, recovery: 1, recovered: true, regenerated: R, lightDependent: true, individuals: 1, meanMass: 300, speed: 0, mass: 300, reproduction: 0 }] } };
}
function pairs(n: number, extra: number): Pair[] {
  return SCIENCE_SEEDS.slice(0, n).map((seed, i) => ({ seed, parent: sample(seed, "parent", i >= extra), mutant: sample(seed, "mutant", true) }));
}
it("extends only when both recovery endpoints and every first-batch guard earn it", () => {
  const p = pairs(32, 2);
  expect(summarize(p, SCIENCE_SEEDS.slice(0, 32), "first32").status).toBe("EXTEND-TO-128");
  p[0].mutant.observation.R_clean = false;
  expect(summarize(p, SCIENCE_SEEDS.slice(0, 32), "first32").status).toBe("NO-LEAD-IN-FIRST-32");
  expect(() => summarize(p.slice(0, 31), SCIENCE_SEEDS.slice(0, 32), "first32")).toThrow(/incomplete/);
  p[1].seed = p[0].seed;
  expect(() => summarize(p, SCIENCE_SEEDS.slice(0, 32), "first32")).toThrow(/duplicated/);
});
it("uses exact discordant-pair tails and never mistakes 32 rows for final confirmation", () => {
  expect(pairedTest(7, 2).p).toBe(0.08984375);
  expect(pairedTest(5, 0).p).toBe(0.03125);
  expect(pairedTest(0, 0).pass).toBe(false);
  expect(summarize(pairs(128, 7), SCIENCE_SEEDS, "final128").status).toBe("ACCESSIBLE-ASSAY-IMPROVEMENT");
  expect(summarize(pairs(128, 6), SCIENCE_SEEDS, "final128").status).toBe("NOT-CONFIRMED");
  expect(() => summarize(pairs(32, 7), SCIENCE_SEEDS, "final128")).toThrow(/incomplete/);
});
it("rejects wrong case identity, config, missing observations and malformed recovery bits", () => {
  const c = sample(SCIENCE_SEEDS[0], "parent", true);
  const binding = { manifestHash: "test", seed: c.seed, subject: c.subject, genome: "test", id: c.id };
  expect(() => validateCase(c, binding)).not.toThrow();
  expect(() => validateCase(c, { ...binding, seed: c.seed + 1 })).toThrow(/identity/);
  c.config.mutRate = 1;
  expect(() => validateCase(c, binding)).toThrow(/configuration/);
  c.config = worldConfig(c.seed);
  c.observation.tracks.fast.history.pop();
  expect(() => validateCase(c, binding)).toThrow(/incomplete/);
});
it("constructs the already selected single mutation rather than a search mutation", () => {
  const g = subjects();
  const a = genomeHex(g.parent), b = genomeHex(g.mutant);
  expect(a).not.toBe(b);
  expect(g.parent.weights[12]).toBe(18);
  expect(g.mutant.weights[12]).toBe(-2);
  expect(evalConfig(1).side).toBe(1);
});

it("rejects a missed wound, a dead target, and merged apparent recovery at the score boundary", () => {
  expect(cleanRecovery(true, 300, 90, 2, true, true)).toBe(true);
  expect(cleanRecovery(true, 300, 0, 2, true, true)).toBe(false);
  expect(cleanRecovery(true, 300, 90, 0, true, true)).toBe(false);
  expect(cleanRecovery(true, 300, 90, 2, false, true)).toBe(false);
  expect(cleanRecovery(false, 300, 90, 2, true, true)).toBe(false);
});
it("refuses padded snapshots or fabricated clean-recovery decisions", () => {
  const c = sample(SCIENCE_SEEDS[0], "parent", true);
  const binding = { manifestHash: "test", seed: c.seed, subject: c.subject, genome: "test", id: c.id };
  c.observation.tracks.fast.history[1].step = c.observation.tracks.fast.history[0].step;
  expect(() => validateCase(c, binding)).toThrow(/cadence/);
  c.observation.tracks.fast.history[1].step = 3050;
  c.observation.R_clean = false;
  expect(() => validateCase(c, binding)).toThrow(/derived/);
});
it("rejects rescuing a split daughter and mutually forged legacy outcome bits", () => {
  const c = sample(SCIENCE_SEEDS[0], "parent", true);
  const binding = { manifestHash: "test", seed: c.seed, subject: c.subject, genome: "test", id: c.id };
  c.observation.tracks.normal.history[0] = { ...c.observation.tracks.normal.history[0], label: 1, edges: [{ from: 0, to: 0, cells: 3 }, { from: 0, to: 1, cells: 1 }] };
  expect(() => validateCase(c, binding)).toThrow(/retained/);
  const forged = sample(c.seed, "parent", false);
  forged.observation.R = true; forged.evaluation.regenerated = 1; forged.evaluation.perRep![0].regenerated = true;
  expect(() => validateCase(forged, binding)).toThrow(/legacy/);
});
it("conservatively flags fusion into a split daughter even while the main remnant continues", () => {
  const t = new RemnantTrack(frame(0, [0, 0, 0, 0, 1], [400, 200]), 0, 300);
  t.update(frame(50, [0, 0, 0, 1, 1], [300, 300]));
  expect(t.result().retained).toBe(true);
  expect(t.result().merged).toBe(true);
  expect(t.result().recovered).toBe(false);
});
it("the independent reader agrees with conservative split-daughter fusion evidence", () => {
  const c = sample(SCIENCE_SEEDS[0], "parent", true);
  const t = new RemnantTrack(frame(3000, [0, 0, 0, 0, 1], [400, 200]), 0, 300);
  for (let i = 1; i <= 40; i++) t.update(frame(3000 + 50 * i, [0, 0, 0, 1, 1], [300, 300]));
  c.observation.tracks.normal = t.result();
  c.observation.R_clean = false;
  expect(() => validateCase(c, { manifestHash: "test", seed: c.seed, subject: c.subject, genome: "test", id: c.id })).not.toThrow();
});
