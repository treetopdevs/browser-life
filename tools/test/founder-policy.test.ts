import { assert, assertEquals, assertThrows } from "jsr:@std/assert@1";
import { CH, G, GENOME_CHANNELS, M3_FOUNDERS, PRESETS, defaultConfig, encodeCheckpoint, encodeGenome, founderGenome, initWorld, packLineageLo, stateHash } from "@bl/schema";
import { Random, ancestryResolver, assayTerm, competitionScore, crossedBootstrap, designFromInputs, drawCohort, eligibleFromViable, interval, linear, parseMutationTsv, percentile, policyWorld, positionSlots, rootMasses, sampleRoot, sha256, simHex, type Design, type EligibleGenome, type HistoryUnit, type ResolvedConfigs, type SampleUnit } from "../lib/founder-policy.ts";
import { fromHex, normalizeGenome, toHex } from "../lib/selection-funnel-audit.ts";
import { assayConfig, assertMutationOffState, competitionWorld, evolutionConfig, sampleEvolutionState, type EvolutionProgress } from "../lib/founder-policy-runtime.ts";
import { assayIdentity, evaluatePilot, pilotRequests, type PilotResult } from "../lib/founder-policy-pilot.ts";
import { analyze, buildAssayRequests, crossedExpression, rootContrast, substituteKnown, type AssayRequest } from "../lib/founder-policy-analysis.ts";
import { validateRelease, type ComparisonRelease } from "../lib/founder-policy-release.ts";
import { latestProgress } from "../founder-policy.ts";

const genome = (change = 0) => normalizeGenome({ mu: 60 + change, sigma: 20, motGain: 0, weights: Array(160).fill(0) });
const row = (change: number, survived: number) => ({ genome: genome(change), eval: { survived } });

Deno.test("committed prefix, complete normalization, and source observations", () => {
  const rows = [row(0, 1), row(0, 2), row(1, 0), { malformed: true }];
  const got = eligibleFromViable(rows, 3);
  assertEquals(got.length, 1); assertEquals(got[0].observations, [0, 1]);
  assertThrows(() => eligibleFromViable(rows, 4), Error, "malformed");
});

Deno.test("complete signed/hex genome identity and cluster-balanced draws", () => {
  const g = genome(); g.weights[0] = -128; g.weights[159] = 127;
  assertEquals(fromHex(toHex(g)), g);
  const eligible: EligibleGenome[] = Array.from({ length: 13 }, (_, cluster) => ({ hex: toHex({ ...g, mu: g.mu + cluster }), firstObservation: cluster, observations: [cluster], cluster }));
  const first = drawCohort(eligible, 6200001, "random-1"), again = drawCohort(eligible, 6200001, "random-1");
  assertEquals(first, again); assertEquals(new Set(first.clusterIds).size, 12);
  first.clusterIds.forEach((cluster, i) => assertEquals(first.genomeHex[i], eligible[cluster].hex));
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

Deno.test("sampling refuses off-grid states and requires exact 24 draw-seed entries", () => {
  const cfg = defaultConfig({ tileW: 32, tileH: 32, seed: 1 });
  const state = { cfg, step: 1, cells: new Uint32Array(1024 * 7), genome: new Uint32Array(1024 * GENOME_CHANNELS), lightIn: 0n, heatOut: 0n, flux: Array(10).fill(0n) };
  assertThrows(() => sampleEvolutionState(state, {}, [], []), Error, "unplanned sample step");
  state.step = 100000;
  assertThrows(() => sampleEvolutionState(state, {}, [], []), Error, "24 exact-time");
});

Deno.test("mutation-off physical state rejects edges and changed carried genomes", () => {
  const unit: HistoryUnit = { id: "historical-seed-6210001-off", cohort: "historical", seed: 6210001, seedIndex: 0, mode: "off", slots: positionSlots(0) };
  const cohort = { id: "historical", source: "historical" as const, drawSeed: null, clusterIds: [], genomeHex: M3_FOUNDERS.map((f) => simHex(founderGenome(f))) };
  const built = policyWorld(evolutionConfig(unit), cohort, 0), state = built.state;
  assertMutationOffState(state, built.founderRoots, cohort.genomeHex, []);
  assertThrows(() => assertMutationOffState(state, built.founderRoots, cohort.genomeHex, [{ child: "1:1", parent: "0:1" }]), Error, "condition/edge");
  const n = state.cfg.tileW * state.cfg.tileH;
  const lineage = state.genome[G.LIN_LO * n + state.genome.findIndex((_, i) => i < n && state.genome[i] === 0 && state.genome[G.LIN_LO * n + i] !== 0)];
  for (let i = 0; i < n; i++) if (state.genome[G.LIN_LO * n + i] === lineage) state.genome[G.PARAM0 * n + i] ^= 1;
  assertThrows(() => assertMutationOffState(state, built.founderRoots, cohort.genomeHex, []), Error, "changed genome");
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

Deno.test("paired root requires full informative roster even if missing baseline cancels", () => {
  const requests: AssayRequest[] = [];
  for (const mode of ["normal", "off"] as const) for (const time of [0, 1000000]) for (const draw of [0, 1]) for (const assaySeed of [1, 2, 3, 4]) for (let assignment = 0; assignment < 4; assignment++) {
    requests.push({ id: `${mode}:${time}:${draw}:${assaySeed}:${assignment}`, history: mode, cohort: "historical", seed: 10, mode, time, root: 0, draw, assaySeed, assignment, status: "scheduled", descendantHex: "x", ancestorHex: "x", assayKey: time === 0 ? assayIdentity("x", "x", assaySeed, assignment, assayConfig(assaySeed)) : `${mode}:${draw}:${assaySeed}:${assignment}` });
  }
  const scores = Object.fromEntries(requests.filter((r) => r.time !== 0).map((r) => [r.assayKey!, r.mode === "normal" ? 0.4 : 0.1]));
  const estimate = rootContrast(requests, scores);
  assertEquals(estimate.status, "assay-missing"); assertEquals(estimate.availableValue, null);
  const canceled = interval(estimate.contrast, scores);
  assertEquals(canceled.missing, []); assert(Math.abs(canceled.lower - 0.3) < 1e-12 && Math.abs(canceled.upper - 0.3) < 1e-12);
  const absent = structuredClone(requests);
  for (const r of absent) if (r.mode === "off" && r.time === 1000000) { r.status = "absent"; r.assayKey = null; r.descendantHex = null; }
  const bound = interval(rootContrast(absent, scores).contrast, scores);
  assert(bound.lower < -0.59 && bound.upper > 1.39); // known on arm retained, absent off arm bounded
  const asymmetricBaseline = structuredClone(requests);
  for (const r of asymmetricBaseline) if (r.mode === "normal" && r.time === 0) { r.status = "unresolved"; r.assayKey = null; r.descendantHex = null; }
  const asymmetricBound = interval(rootContrast(asymmetricBaseline, scores).contrast, scores);
  assert(Math.abs(asymmetricBound.lower - 0.3) < 1e-12 && Math.abs(asymmetricBound.upper - 0.3) < 1e-12);
  const localOnly = new Set(requests.filter((r) => r.time === 1000000).map((r) => r.assayKey!));
  const compressed = rootContrast(requests, {}, new Set(), localOnly);
  const uncompressed = rootContrast(requests, {});
  assertEquals(interval(compressed.contrast, {}).lower, interval(uncompressed.contrast, {}).lower);
  assert(Object.keys(compressed.contrast.terms).length < Object.keys(uncompressed.contrast.terms).length);
  const partiallyObserved = Object.fromEntries(requests.filter((r) => r.time === 1000000 && r.assignment < 2).map((r) => [r.assayKey!, r.mode === "normal" ? 0.4 : 0.1]));
  const sharedKey = requests.find((r) => r.mode === "normal" && r.time === 1000000 && r.assignment === 2)!.assayKey!;
  const trulyLocal = new Set([...localOnly].filter((key) => key !== sharedKey)); // a cross-group key must stay explicit
  const partialCompressed = interval(rootContrast(requests, partiallyObserved, new Set(), trulyLocal).contrast, partiallyObserved);
  const partialPlain = interval(rootContrast(requests, partiallyObserved).contrast, partiallyObserved);
  assert(Math.abs(partialCompressed.lower - partialPlain.lower) < 1e-12 && Math.abs(partialCompressed.upper - partialPlain.upper) < 1e-12);
  assert(Object.keys(rootContrast(requests, partiallyObserved, new Set(), trulyLocal).contrast.terms).includes(sharedKey));
});

Deno.test("crossed estimator counts shared historical reference once per seed block", () => {
  const random = Array.from({ length: 8 }, () => [0, 1, 2, 3].map(() => ({ constant: 2, terms: {} })));
  const historical = [10, 20, 30, 40].map((constant) => ({ constant, terms: {} }));
  const crossed = crossedExpression(random, historical, [0, 0, 3, 3, 6, 6, 7, 7], [0, 0, 1, 1]);
  assertEquals(crossed.historical.constant, 15); assertEquals(crossed.difference.constant, -13);
  const known = substituteKnown({ constant: 1, terms: { a: 2, b: -1 } }, { a: 0.5 });
  assertEquals(known, { constant: 2, terms: { b: -1 } });
});

Deno.test("complete-roster cost release rejects optimistic cache and stale cumulative spend", () => {
  const empty = sha256("[]");
  const release: ComparisonRelease = { format: "founder-policy-comparison-release/v1", manifestSha256: "a".repeat(64), pilotGateSha256: "b".repeat(64), approvedAt: "2026-09-29T01:00:00Z", execution: "paid", allInHourlyUSD: 1, priceSource: "synthetic", forecast: { histories: 72, requestedAssays: 82944, conservativeUniqueAssays: 30000, evolutionSeconds: 3600, assaySeconds: 3600, storageUSD: 1, teardownUSD: 1 }, globalRemainingUSD: 50, comparisonSpentUSD: 0, externalSpentUSD: 0, priorReceiptsSha256: empty, spentThroughAt: "2026-09-29T00:00:00Z", maxInvocationSeconds: 3600 };
  assertEquals(validateRelease(release, release.manifestSha256, release.pilotGateSha256, 3600, empty, 0, 29000).projectedTotalUSD, 4);
  assertThrows(() => validateRelease({ ...release, forecast: { ...release.forecast, conservativeUniqueAssays: 1 } }, release.manifestSha256, release.pilotGateSha256, 3600, empty, 0, 29000), Error, "below conservative");
  assertThrows(() => validateRelease(release, release.manifestSha256, release.pilotGateSha256, 3600, "c".repeat(64), 1, 29000), Error, "stale cumulative");
  const resumed = { ...release, priorReceiptsSha256: "c".repeat(64), comparisonSpentUSD: 1, globalRemainingUSD: 49 };
  assertEquals(validateRelease(resumed, release.manifestSha256, release.pilotGateSha256, 3600, "c".repeat(64), 1, 29000).invocationCostCeilingUSD, 1);
  assertThrows(() => validateRelease({ ...resumed, comparisonSpentUSD: 35, externalSpentUSD: 34 }, release.manifestSha256, release.pilotGateSha256, 3600, "c".repeat(64), 1, 29000), Error, "exceeds");
});

Deno.test("ten-thousand crossed constant-matrix draws are bounded CPU work", () => {
  const matrix = Array.from({ length: 8 }, (_, i) => Array.from({ length: 4 }, (_, j) => ({ constant: i / 10 + j / 20, terms: {} })));
  const reference = Array.from({ length: 4 }, (_, j) => ({ constant: j / 30, terms: {} }));
  const rng = new Random(6250001), start = performance.now(); let sum = 0;
  for (let i = 0; i < 10000; i++) { const cs = Array.from({ length: 8 }, () => rng.int(8)), ss = Array.from({ length: 4 }, () => rng.int(4)); sum += crossedExpression(matrix, reference, cs, ss).difference.constant; }
  assert(Number.isFinite(sum)); assert(performance.now() - start < 10000);
});

Deno.test("ten-thousand crossed missingness draws scale after root-time aggregation", () => {
  const matrix = Array.from({ length: 8 }, (_, c) => Array.from({ length: 4 }, (_, s) => ({ constant: 0, terms: Object.fromEntries(Array.from({ length: 12 }, (_, r) => [`unknown:${c}:${s}:${r}`, 1 / 12])) })));
  const reference = Array.from({ length: 4 }, (_, s) => ({ constant: 0, terms: Object.fromEntries(Array.from({ length: 12 }, (_, r) => [`reference:${s}:${r}`, 1 / 12])) }));
  const rng = new Random(6250001), start = performance.now(); let upper = 0;
  for (let i = 0; i < 10000; i++) { const cs = Array.from({ length: 8 }, () => rng.int(8)), ss = Array.from({ length: 4 }, () => rng.int(4)); upper += interval(crossedExpression(matrix, reference, cs, ss).difference, {}).upper; }
  assert(upper > 0); assert(performance.now() - start < 60000);
});

Deno.test("full 82944-request technical-missing roster remains bounded and inconclusive", () => {
  const viable = Array.from({ length: 13 }, (_, i) => ({ genome: normalizeGenome({ mu: 60, sigma: 20, motGain: 0, weights: Array(160).fill(i - 6) }), eval: { survived: 1 } }));
  const founderHex = M3_FOUNDERS.map((f) => simHex(founderGenome(f)));
  const design = designFromInputs("a".repeat(64), {}, {} as ResolvedConfigs, { viableCount: 13 }, viable, founderHex);
  const progress: Record<string, EvolutionProgress> = {}; let unique = 1000;
  for (const unit of design.histories) {
    const cohort = design.cohorts.find((x) => x.id === unit.cohort)!;
    const samples = design.times.map((time) => ({ time, roots: Array.from({ length: 12 }, (_, root) => {
      const original = cohort.genomeHex[root];
      const draws = unit.mode === "normal" && time > 0 ? [0, 1].map(() => toHex({ ...genome(), mu: unique++ })) : [original, original];
      return { root, status: "present" as const, mass: 1, draws, unresolvedMass: 0 };
    }), rootMasses: Array(12).fill(1), unknownAncestryMass: 0, unassociatedMass: 0, stateHash: "b".repeat(16) }));
    progress[unit.id] = { unit, cohortHex: cohort.genomeHex, step: 1000000, samples, mutationEdges: [], founderRoots: {}, stateHash: "b".repeat(16), startedAt: "2026-09-29T00:00:00Z", updatedAt: "2026-09-29T00:00:01Z", complete: true };
  }
  const started = performance.now(), requests = buildAssayRequests(design, progress);
  assertEquals(requests.length, 82944);
  const report = analyze(design, "c".repeat(64), requests, [], progress);
  assertEquals(report.decision, "inconclusive-or-tradeoff"); assert(report.missingness.technicalMissing > 27000);
  assert(performance.now() - started < 60000);
});

Deno.test({ name: "resume checkpoint binds progress, cohort, mapping, state and exact samples", permissions: { read: true, write: true }, fn: async () => {
  const out = await Deno.makeTempDir();
  try {
    const unit: HistoryUnit = { id: "historical-seed-6210001-normal", cohort: "historical", seed: 6210001, seedIndex: 0, mode: "normal", slots: positionSlots(0) };
    const cohort = { id: "historical", source: "historical" as const, drawSeed: null, clusterIds: [], genomeHex: M3_FOUNDERS.map((f) => simHex(founderGenome(f))) };
    const sampleUnits: SampleUnit[] = [0, 100000].flatMap((time) => Array.from({ length: 12 }, (_, root) => [0, 1].map((draw) => ({ history: unit.id, time, root, draw, seed: 6240001 + time / 100000 * 24 + root * 2 + draw }))).flat());
    const design = { histories: [unit], cohorts: [cohort], sampleUnits } as unknown as Design, built = policyWorld(evolutionConfig(unit), cohort, 0);
    const atZero = sampleEvolutionState(built.state, built.founderRoots, [], sampleUnits.filter((x) => x.time === 0));
    const state = { ...built.state, step: 100000 }, atHundred = sampleEvolutionState(state, built.founderRoots, [], sampleUnits.filter((x) => x.time === 100000));
    const progress: EvolutionProgress = { unit, cohortHex: cohort.genomeHex, step: 100000, samples: [atZero, atHundred], mutationEdges: [], founderRoots: built.founderRoots, stateHash: stateHash(state), startedAt: "2026-09-29T00:00:00Z", updatedAt: "2026-09-29T00:01:00Z", complete: false };
    const manifestSha256 = "a".repeat(64), progressSha256 = sha256(JSON.stringify(progress));
    const checkpoint = encodeCheckpoint(state, { experiment: "founder-policy", unit: unit.id, manifestSha256, progressSha256 });
    const dir = `${out}/histories/${unit.id}`; await Deno.mkdir(dir, { recursive: true });
    await Deno.writeFile(`${dir}/checkpoint-100000.blck`, checkpoint);
    const receipt = { manifestSha256, checkpointSha256: sha256(checkpoint), progressSha256, progress };
    await Deno.writeTextFile(`${dir}/progress-100000.json`, JSON.stringify(receipt));
    assertEquals((await latestProgress(out, unit.id, manifestSha256, design))?.progress.step, 100000);
    const drift = { ...progress, cohortHex: [...progress.cohortHex].reverse() }, driftHash = sha256(JSON.stringify(drift));
    const driftCheckpoint = encodeCheckpoint(state, { experiment: "founder-policy", unit: unit.id, manifestSha256, progressSha256: driftHash });
    await Deno.writeFile(`${dir}/checkpoint-100000.blck`, driftCheckpoint);
    await Deno.writeTextFile(`${dir}/progress-100000.json`, JSON.stringify({ manifestSha256, checkpointSha256: sha256(driftCheckpoint), progressSha256: driftHash, progress: drift }));
    let rejected = false; try { await latestProgress(out, unit.id, manifestSha256, design); } catch (e) { rejected = e instanceof Error && e.message.includes("state/unit mismatch"); }
    assert(rejected);
  } finally { await Deno.remove(out, { recursive: true }); }
} });

Deno.test("crossed bootstrap reuses one historical reference per seed block", () => {
  const cohorts = Array.from({ length: 8 }, (_, i) => i), seeds = [0, 1, 2, 3];
  const a = crossedBootstrap(cohorts, seeds, 12, (cs, ss) => cs.reduce((x, y) => x + y, 0) + ss.reduce((x, y) => x + y, 0));
  const b = crossedBootstrap(cohorts, seeds, 12, (cs, ss) => cs.reduce((x, y) => x + y, 0) + ss.reduce((x, y) => x + y, 0));
  assertEquals(a, b);
});
