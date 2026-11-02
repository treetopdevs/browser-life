// Behaviour atlas (docs/behaviour-atlas-2026-11-01/PLAN.md): physical descriptors on known
// trajectories, the negative fixture (a new bin that is not a new capability), the proposal ledger
// and its stepping stones, selector/capability separation, the equal-budget comparison runner, and
// the descriptors on real CPU dynamics with an instrumented-versus-plain twin.
import { describe, expect, it } from "vitest";
import { CH, M3_FOUNDERS, NN_BYTES, buildWorld, cellCount, cloneState, defaultConfig, founderGenome, lowbias32, stateHash, type Genome } from "@bl/schema";
import { RefSim } from "@bl/sim-ref";
import type { CensusInput } from "@bl/metrics";
import {
  BehaviourAtlas,
  DEFAULT_ATLAS,
  DEFAULT_EVAL,
  OCCUPIED_MASS,
  SCREEN_ASSAY,
  TileDescriptors,
  assertSeparated,
  atlasGenomeKey,
  atlasObserver,
  capabilityCoverage,
  compareArms,
  descriptorsOf,
  genomeKey,
  type CapabilityTest,
  type Evaluation,
  type PhysicalDescriptors,
  type ScreenEvaluator,
} from "@bl/search";

const W = 32;

/** A square blob of bound mass `m` with its top-left corner at (x0, y0), wrapping on the tile torus. */
function blob(x0: number, y0: number, side = 5, m = 100): Float64Array {
  const f = new Float64Array(W * W);
  for (let dy = 0; dy < side; dy++) for (let dx = 0; dx < side; dx++) f[((y0 + dy) % W) * W + ((x0 + dx) % W)] = m;
  return f;
}

function run(frames: Float64Array[], interval = 100): PhysicalDescriptors | undefined {
  const d = new TileDescriptors(W, W, interval);
  frames.forEach((f, k) => d.push(k * interval, f));
  return d.result();
}

/** Each frame occupies a fresh random 10% of cells: flicker with no persistent body. */
function noise(frames: number, seed: number): Float64Array[] {
  return Array.from({ length: frames }, (_, k) => {
    const f = new Float64Array(W * W);
    for (let i = 0; i < f.length; i++) if (lowbias32(seed ^ (k * 0x9e3779b1) ^ (i * 0x85ebca6b)) % 10 === 0) f[i] = 100;
    return f;
  });
}

const genome = (fill: number): Genome => ({ mu: 60, sigma: 20, motGain: 0, weights: new Int8Array(NN_BYTES).fill(fill) });
const ev = (over: Partial<Evaluation> = {}): Evaluation => ({
  survived: 4, recovered: 0, lightDependent: 0, reps: 4, individuals: 1, meanMass: 256, speed: 0, mass: 256, recovery: 0, regenerated: 0, reproduction: 0, ...over,
});

describe("physical descriptors", () => {
  it("give a static blob zero displacement and full persistence", () => {
    const d = run(Array.from({ length: 6 }, () => blob(10, 10)))!;
    expect(d.displacement).toBeCloseTo(0, 9);
    expect(d.persistence).toBe(1);
  });

  it("give a translating blob its speed and a partial overlap", () => {
    // One cell right per 100 steps: a 5-wide blob keeps 4 of its 5 columns.
    const d = run(Array.from({ length: 8 }, (_, k) => blob(3 + k, 12)))!;
    expect(d.displacement).toBeCloseTo(1, 9);
    expect(d.persistence).toBeCloseTo(20 / 30, 9);
    // The same motion at half the census rate is half the cells per 100 steps.
    expect(run(Array.from({ length: 8 }, (_, k) => blob(3 + k, 12)), 200)!.displacement).toBeCloseTo(0.5, 9);
  });

  it("are the same for the same motion across the torus seam", () => {
    const here = run(Array.from({ length: 8 }, (_, k) => blob(3 + k, 12)))!;
    const seam = run(Array.from({ length: 8 }, (_, k) => blob(W - 4 + k, W - 2)))!;
    expect(seam.displacement).toBeCloseTo(here.displacement, 9);
    expect(seam.persistence).toBeCloseTo(here.persistence, 9);
  });

  it("count only cells at or above the occupancy threshold, and need two live frames", () => {
    const faint = blob(10, 10, 5, OCCUPIED_MASS - 1);
    const d = new TileDescriptors(W, W, 100);
    d.push(0, faint);
    expect(d.result()).toBeUndefined();
    d.push(100, faint);
    // Mass but no occupied cells: a centre exists, an occupancy overlap does not.
    expect(d.result()).toBeUndefined();
    // A dead frame breaks both chains; a uniform frame has no centre.
    const dead = run([blob(1, 1), new Float64Array(W * W), blob(1, 1)]);
    expect(dead).toBeUndefined();
    expect(run([new Float64Array(W * W).fill(100), new Float64Array(W * W).fill(100)])).toBeUndefined();
  });

  it("refuse a census at another interval", () => {
    const d = new TileDescriptors(W, W, 100);
    d.push(0, blob(1, 1));
    expect(() => d.push(150, blob(1, 1))).toThrow(/interval of 100/);
    expect(() => new TileDescriptors(W, W, 0)).toThrow(/positive integer/);
  });
});

describe("the negative fixture: a new bin is not a new capability", () => {
  it("puts flicker noise in a bin no body occupies, and it passes no held-out test", () => {
    const atlas = new BehaviourAtlas();
    const still = run(Array.from({ length: 8 }, () => blob(10, 10)))!;
    const mover = run(Array.from({ length: 8 }, (_, k) => blob(3 + k, 12)))!;
    const flicker = run(noise(8, 7))!;
    expect(flicker.persistence).toBeLessThan(0.2);
    expect(flicker.displacement).toBeGreaterThan(0);
    const cells = [still, mover, flicker].map((d, i) => atlas.offer({ genome: genome(i), operator: "seed", parents: [], seed: i, batch: 0 }, { survived: 4, reps: 4, descriptors: d }).cell!.join(","));
    expect(new Set(cells).size).toBe(3);
    expect(atlas.coverage()).toBe(3 / 64);
    // A transfer test on another assay: the flicker "specimen" fails it, so its new bin adds coverage but no capability.
    const transfer: CapabilityTest = { id: "moving-light-survival", version: "fixture", reads: ["rotating-sun:survived", "rotating-sun:reps"], passes: (e) => e["rotating-sun"].survived === e["rotating-sun"].reps };
    const heldOut = new Map([
      [genomeKey(genome(0)), { "rotating-sun": ev() }],
      [genomeKey(genome(1)), { "rotating-sun": ev() }],
      [genomeKey(genome(2)), { "rotating-sun": ev({ survived: 0 }) }],
    ]);
    const withNoise = capabilityCoverage([0, 1, 2].map((i) => genomeKey(genome(i))), heldOut, [transfer]);
    const without = capabilityCoverage([0, 1].map((i) => genomeKey(genome(i))), heldOut, [transfer]);
    expect(withNoise.covered).toBe(without.covered);
    expect(withNoise.perTest["moving-light-survival"]).toBe(2);
  });
});

describe("BehaviourAtlas", () => {
  // A fixed spec, so these cases do not move when the calibrated default ranges do.
  const SPEC = { ...DEFAULT_ATLAS, displacementRange: [0, 4] as [number, number], persistenceRange: [0, 1] as [number, number] };
  const d = (displacement: number, persistence: number): PhysicalDescriptors => ({ interval: 100, displacement, persistence });

  it("inserts on viability alone: a better regenerator with equal viability keeps out, a more viable one displaces", () => {
    const a = new BehaviourAtlas(SPEC);
    const first = a.offer({ genome: genome(1), operator: "seed", parents: [], seed: 0, batch: 0 }, { survived: 2, reps: 4, descriptors: d(1.1, 0.9) });
    expect(first.inserted).toBe(true);
    // The Screened type has no regeneration field at all; equal viability ties keep the incumbent.
    const tie = a.offer({ genome: genome(2), operator: "seed", parents: [], seed: 1, batch: 0 }, { survived: 2, reps: 4, descriptors: d(1.2, 0.95) });
    expect(tie.inserted).toBe(false);
    const better = a.offer({ genome: genome(3), operator: "seed", parents: [], seed: 2, batch: 0 }, { survived: 4, reps: 4, descriptors: d(1.0, 0.89) });
    expect(better.inserted).toBe(true);
    expect(a.ledger[first.id].displacedBy).toBe(better.id);
    expect(a.elites().map((e) => e.id)).toEqual([better.id]);
    // Non-viable and descriptor-less offers are ledgered, never inserted.
    expect(a.offer({ genome: genome(4), operator: "seed", parents: [], seed: 3, batch: 0 }, { survived: 0, reps: 4, descriptors: d(3, 0.1) }).inserted).toBe(false);
    expect(a.offer({ genome: genome(5), operator: "seed", parents: [], seed: 4, batch: 0 }, { survived: 4, reps: 4 }).inserted).toBe(false);
    expect(a.ledger).toHaveLength(5);
  });

  it("keeps displaced ancestors as stepping stones and flags duplicate genomes", () => {
    const a = new BehaviourAtlas(SPEC);
    const root = a.offer({ genome: genome(1), operator: "seed", parents: [], seed: 0, batch: 0 }, { survived: 2, reps: 4, descriptors: d(0.1, 0.95) });
    const mid = a.offer({ genome: genome(2), operator: "mutate", parents: [root.id], seed: 11, batch: 1 }, { survived: 2, reps: 4, descriptors: d(1.6, 0.6) });
    const tip = a.offer({ genome: genome(3), operator: "mutate", parents: [mid.id], seed: 12, batch: 2 }, { survived: 3, reps: 4, descriptors: d(3.6, 0.3) });
    // mid is then displaced from its cell by an unrelated, more viable genome.
    a.offer({ genome: genome(4), operator: "random", parents: [], seed: 13, batch: 2 }, { survived: 4, reps: 4, descriptors: d(1.7, 0.62) });
    expect(a.ledger[mid.id].displacedBy).toBe(3);
    expect(a.ancestorsOf(tip.id)).toEqual([root.id, mid.id]);
    // root still holds its own cell; mid is an ancestor of an elite without holding one.
    expect(a.steppingStones().map((e) => e.id)).toEqual([mid.id]);
    const dup = a.offer({ genome: genome(2), operator: "mutate", parents: [tip.id], seed: 14, batch: 3 }, { survived: 1, reps: 4, descriptors: d(1.6, 0.6) });
    expect(dup.duplicateOf).toBe(mid.id);
    expect(a.duplicateRate()).toBe(1 / 5);
    expect(() => a.offer({ genome: genome(9), operator: "mutate", parents: [99], seed: 0, batch: 3 }, { survived: 1, reps: 4 })).toThrow(/not in the ledger/);
  });

  it("keeps gene-distinct genomes apart, which genomeKey alone would merge", () => {
    const a = new BehaviourAtlas(SPEC);
    const plain = a.offer({ genome: genome(1), operator: "seed", parents: [], seed: 0, batch: 0 }, { survived: 4, reps: 4, descriptors: d(0.5, 0.5) });
    const gene = a.offer({ genome: { ...genome(1), genes: 3 }, operator: "seed", parents: [], seed: 1, batch: 0 }, { survived: 4, reps: 4, descriptors: d(2.5, 0.5) });
    expect(genomeKey({ ...genome(1), genes: 3 })).toBe(genomeKey(genome(1)));
    expect(gene.duplicateOf).toBeUndefined();
    expect(gene.key).not.toBe(plain.key);
    expect(atlasGenomeKey(genome(1))).toBe(genomeKey(genome(1)));
  });

  it("refuses descriptors sampled at another census interval", () => {
    const a = new BehaviourAtlas(SPEC);
    expect(() => a.offer({ genome: genome(1), operator: "seed", parents: [], seed: 0, batch: 0 }, { survived: 4, reps: 4, descriptors: { interval: 200, displacement: 1, persistence: 0.5 } })).toThrow(
      /every 200 steps offered to an atlas defined at 100/,
    );
    expect(a.ledger).toHaveLength(0);
    // A refused offer leaves no trace: the same genome offered properly is not its own duplicate.
    const ok = a.offer({ genome: genome(1), operator: "seed", parents: [], seed: 0, batch: 0 }, { survived: 4, reps: 4, descriptors: d(1, 0.5) });
    expect(ok.duplicateOf).toBeUndefined();
    expect(a.duplicateRate()).toBe(0);
  });

  it("is rebuilt exactly by replaying its ledger, including through JSON", () => {
    const a = new BehaviourAtlas(SPEC);
    for (let i = 0; i < 40; i++) {
      const u = lowbias32(i * 77 + 3);
      const parents = i > 0 && u % 3 === 0 ? [u % i] : [];
      a.offer(
        { genome: genome(i % 17), operator: parents.length ? "mutate" : "random", parents, seed: u, batch: i >> 3 },
        { survived: u % 5, reps: 3 + (u % 2), descriptors: u % 11 === 0 ? undefined : d((u % 400) / 100, ((u >>> 8) % 101) / 100) },
      );
    }
    const back = BehaviourAtlas.replay(a.ledger, SPEC);
    expect(back.ledger).toEqual(a.ledger);
    expect([...back.cells]).toEqual([...a.cells]);
    const revived = JSON.parse(JSON.stringify(a.ledger)).map((e: { genome: { weights: Record<string, number> } }) => ({ ...e, genome: { ...e.genome, weights: Int8Array.from(Object.values(e.genome.weights)) } }));
    expect([...BehaviourAtlas.replay(revived, SPEC).cells]).toEqual([...a.cells]);
  });
});

describe("selector/capability separation", () => {
  const regen: CapabilityTest = { id: "regen", version: "fixture", reads: [`${SCREEN_ASSAY}:regenerated`, `${SCREEN_ASSAY}:reps`], passes: (e) => e[SCREEN_ASSAY].regenerated > 0 };
  const transfer: CapabilityTest = { id: "transfer", version: "fixture", reads: ["rotating-sun:survived"], passes: (e) => e["rotating-sun"].survived > 0 };

  it("refuses a test that reads what a compared arm selects on", () => {
    expect(() => assertSeparated([regen], ["physical", "mass-speed"])).toThrow(/regen reads screen:regenerated, which arm mass-speed selects on/);
    // screen:reps is read by every arm, so even the physical-only comparison refuses this test.
    expect(() => assertSeparated([regen], ["physical"])).toThrow(/screen:reps/);
    expect(() => assertSeparated([transfer], ["random-viable", "mass-speed", "physical", "embedding"])).not.toThrow();
    expect(() => assertSeparated([transfer, transfer], ["physical"])).toThrow(/twice/);
  });

  it("treats per-replicate reads as the aggregate they reconstruct", () => {
    const viaRep: CapabilityTest = { id: "regen-by-rep", version: "fixture", reads: [`${SCREEN_ASSAY}:perRep.regenerated`], passes: () => true };
    const allRep: CapabilityTest = { id: "anything-by-rep", version: "fixture", reads: [`${SCREEN_ASSAY}:perRep`], passes: () => true };
    expect(() => assertSeparated([viaRep], ["mass-speed"])).toThrow(/regen-by-rep reads screen:perRep.regenerated, which arm mass-speed selects on \(screen:regenerated\)/);
    expect(() => assertSeparated([viaRep], ["physical"])).not.toThrow();
    const alive: CapabilityTest = { id: "alive-by-rep", version: "fixture", reads: [`${SCREEN_ASSAY}:perRep.alive`], passes: () => true };
    for (const arm of ["random-viable", "mass-speed", "physical"] as const) expect(() => assertSeparated([alive], [arm])).toThrow(/\(screen:survived\)/);
    expect(() => assertSeparated([allRep], ["random-viable"])).toThrow(/anything-by-rep/);
    expect(() => assertSeparated([{ ...transfer, reads: ["rotating-sun:perRep"] }], ["mass-speed", "physical"])).not.toThrow();
    expect(() => assertSeparated([{ ...transfer, reads: ["survived"] }], ["physical"])).toThrow(/not <assay>:<field>/);
  });

  it("refuses to score a member whose held-out evaluation is missing an assay, and lists untested members", () => {
    expect(() => capabilityCoverage(["k"], new Map([["k", { other: ev() }]]), [transfer])).toThrow(/lacks the rotating-sun evaluation/);
    expect(capabilityCoverage(["k"], new Map(), [transfer])).toEqual({ perTest: { transfer: 0 }, covered: 0, untested: ["k"] });
  });
});

describe("atlasObserver", () => {
  it("assigns tiles to genomes as evaluateBatch lays them out and averages live replicates", async () => {
    const ec = { ...DEFAULT_EVAL, tile: 8, side: 2, reps: 2, censusEvery: 100 };
    const cfg = defaultConfig({ ...ec.world, tileW: 8, tileH: 8, tilesX: 2, tilesY: 2 });
    const n = cellCount(cfg);
    const { observer, results } = atlasObserver(ec, 2);
    for (let k = 0; k < 4; k++) {
      const cells = new Uint32Array(n * 8);
      // Tile 0 static, tile 1 moving one cell right per census, tile 2 empty, tile 3 static.
      const put = (t: number, x: number, y: number) => (cells[CH.B * n + (Math.floor(t / 2) * 8 + y) * 16 + (t % 2) * 8 + (x % 8)] = 100);
      for (let dx = 0; dx < 2; dx++) for (let dy = 0; dy < 2; dy++) {
        put(0, 2 + dx, 2 + dy);
        put(1, 1 + k + dx, 4 + dy);
        put(3, 5 + dx, 5 + dy);
      }
      const input: CensusInput = { cfg, step: 100 * (k + 1), cells, genomeHead: new Uint32Array(n * 4) };
      await observer({ kind: "grow-census", input });
      await observer({ kind: "regen-census", input }); // other phases are ignored
    }
    const [g0, g1] = results();
    expect(g0.perRep[0]!.displacement).toBeCloseTo(0, 9);
    expect(g0.perRep[1]!.displacement).toBeCloseTo(1, 9);
    expect(g0.descriptors!.displacement).toBeCloseTo(0.5, 9);
    expect(g1.perRep[0]).toBeUndefined();
    expect(g1.descriptors).toEqual(g1.perRep[1]);
    expect(() => atlasObserver({ ...ec, medium: { background: genome(1) } }, 1)).toThrow(/background medium/);
    expect(() => atlasObserver(ec, 3)).toThrow(/batch holds 2 genomes/);
    expect(g0.descriptors!.interval).toBe(100);
  });

  it("skips the short final growth census that a non-dividing growSteps produces", async () => {
    // growSteps 250 at censusEvery 100: runChunked censuses at 100, 200 and 250.
    const ec = { ...DEFAULT_EVAL, tile: 8, side: 1, reps: 1, censusEvery: 100, growSteps: 250 };
    const cfg = defaultConfig({ ...ec.world, tileW: 8, tileH: 8, tilesX: 1, tilesY: 1 });
    const n = cellCount(cfg);
    const { observer, results } = atlasObserver(ec, 1);
    for (const step of [100, 200, 250]) {
      const cells = new Uint32Array(n * 8);
      cells[CH.B * n + 9] = cells[CH.B * n + 10] = 100;
      await observer({ kind: "grow-census", input: { cfg, step, cells, genomeHead: new Uint32Array(n * 4) } });
    }
    expect(results()[0].descriptors).toEqual({ interval: 100, displacement: 0, persistence: 1 });
  });
});

describe("compareArms", () => {
  /** Deterministic fake screen: viability and descriptors from the genome's first weights. */
  const fake = (log: string[]): ScreenEvaluator => async (gs, ctx) => {
    log.push(`${ctx.history}:${ctx.arm}:${ctx.batch}:${gs.length}`);
    return gs.map((g) => {
      const u = lowbias32((g.weights[0] & 0xff) | ((g.weights[1] & 0xff) << 8) | ((g.weights[2] & 0xff) << 16) | (g.mu << 24));
      return { eval: ev({ survived: u % 5, recovery: ((u >>> 20) % 4) / 4, regenerated: (u >>> 24) % 3, meanMass: 2 ** (7 + (u % 6)), speed: (u >>> 4) % 4 }), descriptors: { interval: 100, displacement: ((u >>> 8) % 400) / 100, persistence: ((u >>> 16) % 101) / 100 } };
    });
  };
  const spec = { arms: ["random-viable", "mass-speed", "physical", "embedding"] as const, histories: [1, 2], pool: [1, 2, 3, 4].map((i) => founderGenome(M3_FOUNDERS[i])), budget: 20, batchSize: 6, randomFraction: 0.25 };

  it("gives every arm the same pool and budget per history, and records the embedding arm as unimplemented", async () => {
    const log: string[] = [];
    const res = await compareArms({ ...spec, arms: [...spec.arms] }, fake(log));
    expect(res).toHaveLength(8);
    expect(log.filter((l) => l.includes(":pool:"))).toEqual(["1:pool:0:4", "2:pool:0:4"]);
    for (const r of res) {
      if (r.arm === "embedding") {
        expect(r).toMatchObject({ status: "unimplemented", evaluations: 0, selection: [] });
        continue;
      }
      expect(r.status).toBe("ran");
      expect(r.evaluations).toBe(20);
      expect(r.selection.length).toBeGreaterThan(0);
      expect(Object.keys(r.genomes).sort()).toEqual(r.selection);
    }
    const physical = res.find((r) => r.arm === "physical" && r.history === 1)!;
    expect(physical.ledger).toHaveLength(20);
    expect(physical.ledger!.slice(0, 4).every((e) => e.operator === "seed")).toBe(true);
    // Deterministic: the same spec and evaluator give the same selections.
    const again = await compareArms({ ...spec, arms: [...spec.arms] }, fake([]));
    expect(again.map((r) => r.selection)).toEqual(res.map((r) => r.selection));
  });

  it("refuses a budget smaller than the pool", async () => {
    await expect(compareArms({ ...spec, arms: ["physical"], budget: 3 }, fake([]))).rejects.toThrow(/smaller than the pool/);
  });
});

describe("descriptors on CPU reference dynamics", () => {
  // The evaluator's world at a reduced kernel radius, small enough for the CPU reference: an M3
  // founder condenses into a body within a few hundred steps. Empty tiles are covered above.
  it("are defined for a condensing M3 founder and leave the physics untouched", () => {
    const cfg = defaultConfig({ ...DEFAULT_EVAL.world, tileW: 24, tileH: 24, kernelRadius: 5, seed: 11, mutRate: 0 });
    const start = buildWorld(cfg, { nutrient: 32, founders: [{ x: 12, y: 12, radius: 4, genome: founderGenome(M3_FOUNDERS[0]), biomass: 64, energy: 128 }] });
    const plain = new RefSim(cloneState(start));
    const watched = new RefSim(cloneState(start));
    plain.run(100);
    watched.run(100);
    const frames: CensusInput[] = [];
    for (let k = 0; k < 5; k++) {
      if (k) {
        plain.run(50);
        watched.run(50);
      }
      const s = watched.state;
      frames.push({ cfg, step: s.step, cells: s.cells.slice(), genomeHead: s.genome.slice(0, cellCount(cfg) * 4) });
      expect(stateHash(watched.state)).toBe(stateHash(plain.state));
    }
    const live = descriptorsOf(frames, 0, 50)!;
    expect(live).toBeDefined();
    expect(live.persistence).toBeGreaterThan(0);
    expect(live.persistence).toBeLessThanOrEqual(1);
    expect(live.displacement).toBeGreaterThanOrEqual(0);
  }, 180_000);
});
