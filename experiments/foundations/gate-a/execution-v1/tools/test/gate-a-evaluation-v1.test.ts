import assert from "node:assert/strict";
import { CH, allocState, cellCount, cloneState, defaultConfig, encodeGenome, generalistGenome, GENOME_CHANNELS } from "@bl/schema";
import { RefSim } from "@bl/sim-ref";
import { advanceFocal, chooseCandidate, initialFocal, interventionLink, isolateSupport, lesionSupport, linkSupport, maintenance, negativeCalibration, overallCalibration, productionEvidence, quenchSupport, recovery, sensitivityOrigin, supportFrame, PRIMARY_RULE, SENSITIVITY_RULE, type WindowSample } from "../lib/gate-a-evaluation-v1.ts";

const cfg = defaultConfig({ tileW: 8, tileH: 8, tilesX: 1, tilesY: 1, kernelRadius: 2 });
const n = cellCount(cfg);
function state(siteMass: [number, number][]) { const s = allocState(cfg); for (const [site, mass] of siteMass) s.cells[CH.B * n + site] = mass; return s; }
function frame(step: number, sites: [number, number][], rule = PRIMARY_RULE) { return supportFrame(cfg, step, state(sites).cells, rule); }
function series(masses: number[], activities: (boolean | null)[]): WindowSample[] { return masses.map((m, i) => ({ frame: frame(3000 + i * 100, [[10, m]]), focal: initialFocal(0), localActivity: activities[i] })); }

Deno.test("inert persistence stays linked but fails maintenance; growth alone is not production", () => {
  const a = frame(0, [[10, 100]]), b = frame(1, [[10, 300]]);
  assert.equal(linkSupport(a, b, 0).status, "unique");
  assert.equal(productionEvidence(null).status, "unavailable");
  assert.equal(maintenance(series(Array(21).fill(300), Array(21).fill(false)), 300).status, "refuted");
});
Deno.test("support membership is genome independent and periodic", () => {
  const s = state([[0, 100], [7, 100]]); const original = supportFrame(cfg, 0, s.cells);
  s.genome.fill(123); const replaced = supportFrame(cfg, 0, s.cells);
  assert.deepEqual(replaced.supports.map((x) => x.sites), original.supports.map((x) => x.sites));
  assert.equal(original.supports.length, 1);
  assert.equal(original.supports[0].perimeter, 6);
});
Deno.test("transient fragmentation and fusion remain ambiguous without reacquisition", () => {
  const a = frame(0, [[10, 100], [11, 100], [12, 100]]), b = frame(1, [[10, 100], [12, 100]]), c = frame(2, [[10, 100], [11, 100], [12, 100]]);
  assert.equal(linkSupport(a, b, 0).status, "split");
  const lost = advanceFocal(initialFocal(0), a, b).focal;
  assert.equal(advanceFocal(lost, b, c).focal.status, "unresolved");
  assert.equal(linkSupport(b, c, 0).status, "merge");
});
Deno.test("translation without overlap and absent support are unresolved, not death", () => {
  assert.equal(linkSupport(frame(0, [[10, 100]]), frame(1, [[20, 100]]), 0).status, "no-overlap");
  assert.equal(linkSupport(frame(0, [[10, 100]]), frame(1, []), 0).status, "no-overlap");
  assert.equal(linkSupport(frame(0, [[10, 100]]), frame(2, [[10, 100]]), 0).status, "missing-frame");
});
Deno.test("multiple bodies tie by site; threshold sensitivity retains selected origin", () => {
  const s = state([[10, 300], [11, 1], [30, 300]]);
  const primary = supportFrame(cfg, 0, s.cells), low = supportFrame(cfg, 0, s.cells, SENSITIVITY_RULE);
  assert.equal(chooseCandidate(primary)?.minSite, 10);
  assert.equal(sensitivityOrigin(primary.supports[0], low), low.labels[10]);
  assert.equal(low.supports[low.labels[10]].sites.length, 2);
  assert.equal(overallCalibration({ status: "supported", reasons: [] }, { status: "refuted", reasons: ["x"] }).status, "unavailable");
});
Deno.test("isolation and lesion clear only selected bound channels; disconnected residual invalid", () => {
  const s = state([[10, 400], [11, 400], [12, 400], [30, 400]]); s.cells[CH.A * n + 30] = 77; s.cells[CH.E * n + 30] = 9;
  const support = chooseCandidate(supportFrame(cfg, 0, s.cells))!;
  const isolated = isolateSupport(s, support);
  assert.equal(isolated.removedBoundMass, 400); assert.equal(isolated.state.cells[CH.A * n + 30], 77); assert.equal(isolated.state.cells[CH.E * n + 30], 0);
  const lesion = lesionSupport(isolated.state, support);
  assert(lesion.fraction >= 0.3); assert.equal(lesion.state.cells[CH.A * n + 30], 77);
  const before = supportFrame(cfg, 0, isolated.state.cells), after = supportFrame(cfg, 0, lesion.state.cells);
  assert.equal(interventionLink(before, after, 0).status, "unique");
  const quenched = quenchSupport(isolated.state); assert.equal(quenched.cells[CH.B * n + 10], 400); assert.equal(quenched.cells[CH.E * n + 10], 0);
});
Deno.test("recovery uses final 90% only and malformed samples cannot pass", () => {
  const masses = Array(21).fill(300); masses[16] = 100; masses[20] = 290;
  const samples = series(masses, Array(21).fill(true));
  assert.equal(maintenance(samples, 300).status, "refuted");
  assert.equal(recovery(samples, 300, true).status, "supported");
  assert.equal(recovery(samples, 300, false).status, "unavailable");
  assert.equal(maintenance(samples.slice(1), 300).status, "unavailable");
  assert.equal(maintenance(samples, 0).status, "unavailable");
  samples[20].localActivity = null; assert.equal(recovery(samples, 300, true).status, "unavailable");
});
Deno.test("quenched negative must have no final-five local activity", () => {
  assert.equal(negativeCalibration(series(Array(21).fill(300), Array(21).fill(false))).status, "supported");
  const activity = Array(21).fill(false); activity[19] = true;
  assert.equal(negativeCalibration(series(Array(21).fill(300), activity)).status, "refuted");
});
Deno.test("scripted production evidence remains synthetic", () => {
  assert.equal(productionEvidence({ kind: "synthetic-classifier-control", independentCausalEvidence: true, independentlyFunctioningDescendants: true }).status, "supported-synthetic");
  assert.equal(productionEvidence({ kind: "synthetic-classifier-control", independentCausalEvidence: true, independentlyFunctioningDescendants: false }).status, "unavailable");
});
Deno.test("malformed frames reject missing geometry and roles", () => {
  assert.throws(() => supportFrame(cfg, 0, new Uint32Array(1)));
  assert.throws(() => supportFrame(cfg, 0, state([]).cells, PRIMARY_RULE, new Uint32Array(1)));
});
Deno.test("20-step forced-mutation observer twin is nondemolition", async () => {
  const fixture = JSON.parse(await Deno.readTextFile(new URL("../fixtures/reset-material-bounds-mutation-v1.json", import.meta.url)));
  const c = defaultConfig({ seed: fixture.seed, tileW: fixture.tileW, tileH: fixture.tileH, tilesX: 1, tilesY: 1, kernelRadius: fixture.kernelRadius, mutRate: fixture.mutRate });
  const start = allocState(c), count = cellCount(c);
  for (let i = 0; i < count; i++) start.cells[CH.A * count + i] = fixture.nutrientPerSite;
  const words = encodeGenome(generalistGenome(c.defaultMu, c.defaultSigma), 0, 1);
  for (const [i, q] of fixture.initialB) { start.cells[CH.B * count + i] = q; start.cells[CH.E * count + i] = 1000; for (let k = 0; k < GENOME_CHANNELS; k++) start.genome[k * count + i] = words[k]; }
  for (const [i, q] of fixture.initialP) start.cells[CH.P * count + i] = q;
  const observed = new RefSim(cloneState(start)), plain = new RefSim(cloneState(start)); let mutations = 0;
  for (let step = 0; step < 20; step++) {
    const before = cloneState(observed.state);
    const result = observed.step(), baseline = plain.step(); mutations += result.events.length;
    const serialized = JSON.stringify({ cells: [...observed.state.cells], genome: [...observed.state.genome], step: observed.state.step, light: String(observed.state.lightIn), heat: String(observed.state.heatOut), flux: observed.state.flux.map(String) });
    supportFrame(c, observed.state.step, observed.state.cells, PRIMARY_RULE, observed.roles);
    supportFrame(c, observed.state.step, observed.state.cells, SENSITIVITY_RULE, observed.roles);
    assert.deepEqual(observed.state.cells, plain.state.cells); assert.deepEqual(observed.state.genome, plain.state.genome);
    assert.equal(observed.state.step, plain.state.step); assert.equal(observed.state.lightIn, plain.state.lightIn); assert.equal(observed.state.heatOut, plain.state.heatOut); assert.deepEqual(observed.state.flux, plain.state.flux); assert.deepEqual(result.events, baseline.events);
    assert.equal(JSON.stringify({ cells: [...observed.state.cells], genome: [...observed.state.genome], step: observed.state.step, light: String(observed.state.lightIn), heat: String(observed.state.heatOut), flux: observed.state.flux.map(String) }), serialized);
    assert.equal(before.step + 1, observed.state.step);
  }
  assert(mutations > 0, "forced mutation fixture must cover actual mutation events");
});
