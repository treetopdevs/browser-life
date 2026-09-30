import { assert, assertEquals, assertThrows } from "jsr:@std/assert@1";
import { CH, G, GENOME_CHANNELS, M3_FOUNDERS, PRESETS, defaultConfig, encodeGenome, founderGenome, initWorld, packLineageLo } from "@bl/schema";
import { Random, ancestryResolver, assayTerm, competitionScore, crossedBootstrap, eligibleFromViable, interval, linear, parseMutationTsv, percentile, policyWorld, positionSlots, rootMasses, sampleRoot, simHex, type Design } from "../lib/founder-policy.ts";
import { normalizeGenome } from "../lib/selection-funnel-audit.ts";
import { assayConfig, competitionWorld } from "../lib/founder-policy-runtime.ts";
import { evaluatePilot, pilotRequests, type PilotResult } from "../lib/founder-policy-pilot.ts";

const genome = (change = 0) => normalizeGenome({ mu: 60 + change, sigma: 20, motGain: 0, weights: Array(160).fill(0) });
const row = (change: number, survived: number) => ({ genome: genome(change), eval: { survived } });

Deno.test("committed prefix, complete normalization, and source observations", () => {
  const rows = [row(0, 1), row(0, 2), row(1, 0), { malformed: true }];
  const got = eligibleFromViable(rows, 3);
  assertEquals(got.length, 1); assertEquals(got[0].observations, [0, 1]);
  assertThrows(() => eligibleFromViable(rows, 4), Error, "malformed");
});

Deno.test("unbiased integer generator stays in bounds and each stock position has one slot", () => {
  const rng = new Random(6200001), bins = Array(7).fill(0);
  for (let i = 0; i < 70000; i++) bins[rng.int(7)]++;
  assert(bins.every((n) => n > 9000 && n < 11000));
  assert(rng.int53(2 ** 40) >= 0);
  for (let i = 0; i < 4; i++) { const slots = positionSlots(i); assertEquals(slots.length, 12); assertEquals(new Set(slots).size, 12); }
});

Deno.test("identity slot mapping preserves exact stock initial cell and genome buffers", () => {
  const preset = PRESETS.find((p) => p.id === "gradient-m3")!;
  const cfg = defaultConfig({ ...preset.cfg, seed: 6210001 });
  const stock = initWorld(cfg, preset.init);
  const cohort = { id: "historical", source: "historical" as const, drawSeed: null, clusterIds: [], genomeHex: M3_FOUNDERS.map((f) => simHex(founderGenome(f))) };
  const swapped = policyWorld(cfg, cohort, 0, Array.from({ length: 12 }, (_, i) => i));
  assertEquals(swapped.state.cells, stock.cells); assertEquals(swapped.state.genome, stock.genome);
  assertEquals(Object.keys(swapped.founderRoots).length, 12); assertEquals(swapped.discSlots.length, 12);
});

Deno.test("all label and position assignments have identical equal initial material", () => {
  const cfg = assayConfig(6220101), a = simHex(founderGenome(M3_FOUNDERS[0])), b = simHex(founderGenome(M3_FOUNDERS[2]));
  const worlds = [0, 1, 2, 3].map((assignment) => competitionWorld(cfg, a, b, assignment));
  for (const world of worlds) assertEquals(world.state.cells, worlds[0].state.cells);
  assertEquals(new Set(worlds.map((world) => world.descendantLineage + world.positions.descendant)).size, 4);
});

Deno.test("full mutation ancestry rejects conflicts and cycles", () => {
  const roots = { "0:1": 0, "0:2": 1 };
  const resolve = ancestryResolver(roots, [{ child: "2:8", parent: "1:7" }, { child: "1:7", parent: "0:2" }]);
  assertEquals(resolve("2:8"), 1); assertEquals(resolve("9:9"), null);
  assertThrows(() => ancestryResolver(roots, [{ child: "1:1", parent: "0:1" }, { child: "1:1", parent: "0:2" }]), Error, "conflicting");
  assertThrows(() => ancestryResolver(roots, [{ child: "1:1", parent: "1:2" }, { child: "1:2", parent: "1:1" }])("1:1"), Error, "cycle");
  assertEquals(parseMutationTsv("childHi\tchildLo\tparentHi\tparentLo\n1\t3\t0\t2\n"), [{ child: "1:3", parent: "0:2" }]);
});

Deno.test("mass stays with ancestry even for identical genotype and detects lineage conflict", () => {
  const cfg = defaultConfig({ tileW: 32, tileH: 32, seed: 1 }); const n = 1024;
  const state = { cfg, step: 0, cells: new Uint32Array(n * 7), genome: new Uint32Array(n * GENOME_CHANNELS), lightIn: 0n, heatOut: 0n, flux: Array(10).fill(0n) };
  const g = genome(), words1 = encodeGenome({ ...g, weights: Int8Array.from(g.weights) }, 0, packLineageLo(cfg, 1)), words2 = encodeGenome({ ...g, weights: Int8Array.from(g.weights) }, 0, packLineageLo(cfg, 2));
  state.cells[CH.B * n + 0] = 3; state.cells[CH.P * n + 1] = 4;
  for (let j = 0; j < GENOME_CHANNELS; j++) { state.genome[j * n] = words1[j]; state.genome[j * n + 1] = words2[j]; }
  const resolve = ancestryResolver({ "0:1": 0, "0:2": 1 }, []);
  const got = rootMasses(state, resolve);
  assertEquals(got.roots[0].totalMass, 3); assertEquals(got.roots[1].totalMass, 4);
  assertEquals(got.roots[2].totalMass, 0); assertEquals(sampleRoot(got.roots[2], [1, 2]).status, "absent");
  assertEquals(sampleRoot(got.roots[0], [1, 2]).draws, [simHex({ ...g, weights: Int8Array.from(g.weights) }), simHex({ ...g, weights: Int8Array.from(g.weights) })]);
  assertEquals(sampleRoot(got.roots[2], [1, 2], 1).status, "unresolved");
  state.genome[G.LIN_LO * n + 1] = words1[G.LIN_LO]; state.genome[G.PARAM0 * n + 1] ^= 1;
  assertThrows(() => rootMasses(state, resolve), Error, "conflicting genome words");
});

Deno.test("both-extinct is not a tie; one extinct is a scored loss", () => {
  assertEquals(competitionScore(0, 0).status, "both-extinct");
  assertEquals(competitionScore(0, 9), { status: "scored", value: -1, descendantMass: 0, ancestorMass: 9 });
  assertThrows(() => competitionScore(-1, 1));
});

Deno.test("pilot gate enforces complete both-positive controls and rejects malformed cache receipts", () => {
  const design = { pilotGenomeHex: Array.from({ length: 8 }, (_, i) => simHex(founderGenome(M3_FOUNDERS[i]))), seeds: { pilotAssay: [6220101, 6220102, 6220103, 6220104] } } as Design;
  const requests = pilotRequests(design, assayConfig);
  const results: PilotResult[] = requests.map((request) => ({ request, status: "scored", score: request.kind === "identical" ? 0 : 0.5, descendantMass: request.kind === "identical" ? 100 : 150, ancestorMass: request.kind === "identical" ? 100 : 50, startHash: "a".repeat(16), finalHash: "b".repeat(16), cfg: assayConfig(request.seed), startedAt: "2026-09-29T00:00:00Z", finishedAt: "2026-09-29T00:00:01Z", wallSeconds: 1, manifestSha256: "c".repeat(64) }));
  assert(evaluatePilot(requests, results, true).pass);
  assert(!evaluatePilot(requests, results.slice(1), true).complete);
  const extinct = structuredClone(results); extinct[0] = { ...extinct[0], status: "both-extinct", score: null, descendantMass: 0, ancestorMass: 0 };
  assert(!evaluatePilot(requests, extinct, true).pass);
  const asymmetric = structuredClone(results);
  for (const r of asymmetric) if (r.request.kind === "identical" && r.request.genotypeIndex === 0) { const positive = r.request.assignment % 2 === 0; r.descendantMass = positive ? 120 : 80; r.ancestorMass = positive ? 80 : 120; r.score = positive ? 0.2 : -0.2; }
  const asymmetricGate = evaluatePilot(requests, asymmetric, true);
  assertEquals(asymmetricGate.overallIdenticalMean, 0); assert(!asymmetricGate.pass);
  assert(asymmetricGate.reasons.some((x) => x.includes("mean absolute identical")));
  const boundary = structuredClone(results);
  for (const r of boundary) if (r.request.kind === "disabled" && r.request.genotypeIndex === 7) { r.descendantMass = 120; r.ancestorMass = 80; r.score = 0.2; }
  assert(evaluatePilot(requests, boundary, true).pass); // exactly 7/8 strictly above 0.20
  for (const r of boundary) if (r.request.kind === "disabled" && r.request.genotypeIndex === 6) { r.descendantMass = 120; r.ancestorMass = 80; r.score = 0.2; }
  assert(!evaluatePilot(requests, boundary, true).pass);
  const malformed = structuredClone(results); malformed[0].score = Number.NaN;
  assertThrows(() => evaluatePilot(requests, malformed, true), Error, "score mismatch");
});

Deno.test("symbolic shared baseline cancels before unavailable-score bounds", () => {
  const baseline = assayTerm("shared-baseline"), on = assayTerm("on"), off = assayTerm("off");
  const contrast = linear({ score: linear({ score: on, weight: 1 }, { score: baseline, weight: -1 }), weight: 1 }, { score: linear({ score: off, weight: 1 }, { score: baseline, weight: -1 }), weight: -1 });
  assertEquals(interval(contrast, {}).missing.sort(), ["off", "on"]);
  assertEquals(interval(contrast, { on: 0.4 }).lower, -0.6);
  assertEquals(percentile([0, 2, 4], 0.25), 1);
});

Deno.test("crossed bootstrap reuses one historical reference per seed block", () => {
  const cohorts = Array.from({ length: 8 }, (_, i) => i), seeds = [0, 1, 2, 3];
  const a = crossedBootstrap(cohorts, seeds, 12, (cs, ss) => cs.reduce((x, y) => x + y, 0) + ss.reduce((x, y) => x + y, 0));
  const b = crossedBootstrap(cohorts, seeds, 12, (cs, ss) => cs.reduce((x, y) => x + y, 0) + ss.reduce((x, y) => x + y, 0));
  assertEquals(a, b);
});
