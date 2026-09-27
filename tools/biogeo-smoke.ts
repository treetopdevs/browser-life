// Smoke run for the island-biogeography pipeline: proves founder placement
// -> stepping -> migration -> species classification (tileSpeciesCensus) ->
// richness/turnover/species-area runs end-to-end. See
// experiments/biogeography-island.md.
//
//   deno run -A tools/biogeo-smoke.ts
//
// Always runs all three checks, in order: Part A (in-memory RefSim sanity
// checks, no filesystem, no GPU), resolveExperimentDir (GPU-free filesystem
// unit checks), and Part B (a real, tiny sweep through tools/biogeo-sweep.ts's
// own runExperiment/fsSink loop, analyzed by the real tools/biogeo-analyze.ts
// CLI). Part B is the one that actually proves the pipeline end to end, so it
// is never optional -- there is no separate "default" path that skips it and
// reports success without having exercised runExperiment or biogeo-analyze at
// all. It requires a real WebGPU device (same as every other real run in this
// codebase -- runExperiment has no CPU-backed path); Part A and
// resolveExperimentDir need neither GPU nor filesystem writes outside a temp
// dir and complete almost instantly.
//
// Completes in well under a minute.
import { RefSim } from "@bl/sim-ref";
import { requestDevice } from "@bl/sim-gpu";
import { runExperiment, specConfig, type RunSpec } from "@bl/runner";
import { applyMigration, archipelagoWorld, defaultConfig, M3_FOUNDER_SET } from "@bl/schema";
import {
  founderPersistenceSets,
  geneticRichnessByTile,
  tileSpeciesCensus,
  turnoverEquilibrium,
  turnoverSeries,
  unclusteredId,
  type SpeciesFrame,
} from "@bl/metrics";
import { buildExperimentManifest, buildSweepPoints, fsSink, m3FounderGenomes, resolveExperimentDir, specForPoint, type SweepOptions } from "./biogeo-sweep.ts";
import { loadExperimentManifest } from "./biogeo-analyze.ts";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`smoke assertion failed: ${msg}`);
}

// ---------------------------------------------------------------------
// Part A: in-memory pipeline check (RefSim only, no filesystem).
// ---------------------------------------------------------------------
async function partA() {
  const cfg = defaultConfig({ tileW: 24, tileH: 24, tilesX: 2, tilesY: 2, kernelRadius: 9, lightMode: "gradient", migrationPeriod: 8, migrantCount: 2, seed: 1 });
  const start = archipelagoWorld(cfg, m3FounderGenomes());
  const sim = new RefSim(start);
  const anchors = m3FounderGenomes();
  const frames: SpeciesFrame[] = [{ step: sim.state.step, cfg: sim.state.cfg, genome: sim.state.genome.slice() }];
  for (let boundary = 0; boundary < 5; boundary++) {
    sim.run(8);
    const { state } = applyMigration(sim.state, sim.state.step);
    sim.state = state;
    frames.push({ step: sim.state.step, cfg: sim.state.cfg, genome: sim.state.genome.slice() });
  }

  const sets = founderPersistenceSets(frames[0], anchors);
  assert(sets.length === cfg.tilesX * cfg.tilesY, "founderPersistenceSets returns one set per tile");
  assert(sets.every((s) => s.size <= anchors.length + 1), "no tile reports more species than anchors+unclustered");

  const richness0 = geneticRichnessByTile(frames[0]);
  assert(richness0.every((r) => r >= 0), "geneticRichnessByTile is never negative");

  const census0 = tileSpeciesCensus(frames[0], anchors);
  assert(census0.length === cfg.tilesX * cfg.tilesY, "tileSpeciesCensus returns one row per tile");
  assert(census0.every((r) => r.geneticRichness === richness0[r.tile]), "tileSpeciesCensus.geneticRichness matches geneticRichnessByTile on the same frame");
  assert(census0.every((r) => r.founderPresenceMask >= 0 && r.founderPresenceMask < 1 << anchors.length), "founderPresenceMask fits in anchors.length bits");

  // Turnover over the captured migration boundaries, tile 0, unclustered dropped.
  const history = frames.map((f) => {
    const set = new Set(founderPersistenceSets(f, anchors)[0]);
    set.delete(unclusteredId(anchors));
    return { step: f.step, species: set };
  });
  const rows = turnoverSeries(history);
  assert(rows.length === frames.length, "turnoverSeries returns one row per frame");
  const eq = turnoverEquilibrium(rows); // too short a run to reach equilibrium -- nulls are a valid result, not a failure.
  assert(eq.crossingStep === null || typeof eq.crossingStep === "number", "turnoverEquilibrium returns a well-formed result");
  // speciesAreaFit itself is unit-tested on hand-built fixtures in
  // packages/metrics/test/biogeography.test.ts -- Part B below is what proves it end to end on
  // real simulated richness, never hand-picked numbers standing in for a real fit.

  console.log("Part A (in-memory pipeline check): OK");
}

// ---------------------------------------------------------------------
// resolveExperimentDir: GPU-free filesystem unit checks (no RefSim, no
// stepping) -- the immutable-manifest refusal/resume rules tools/biogeo-sweep.ts's
// CLI relies on.
// ---------------------------------------------------------------------
async function partResolveExperimentDir() {
  const tmp = await Deno.makeTempDir({ prefix: "biogeo-smoke-resolve-" });
  const opts: SweepOptions = { areas: [24, 32], isoTile: 24, isoRates: [2], migrationPeriod: 40, seeds: [1] };
  const manifest = buildExperimentManifest("exp", opts, 100, 20, 0);

  assert((await resolveExperimentDir(tmp, manifest)) === "fresh", "a fresh (absent) experiment directory resolves to \"fresh\" and writes experiment.json");
  assert((await resolveExperimentDir(tmp, manifest)) === "resume", "rerunning with an identical manifest (generatedAt aside) resolves to \"resume\", without rewriting the file");

  const different = buildExperimentManifest("exp", { ...opts, areas: [24, 32, 48] }, 100, 20, 0);
  let threw: string | null = null;
  try {
    await resolveExperimentDir(tmp, different);
  } catch (e) {
    threw = (e as Error).message;
  }
  assert(threw && /different experiment/.test(threw), `a manifest differing in even one field must throw naming a new --experiment, got: ${threw}`);

  // Founder-set identity: resolveExperimentDir must refuse to resume an experiment.json recorded
  // under a different founder set than this code's current M3_FOUNDER_SET, even when every other
  // field (config/cadences) is byte-identical -- otherwise a founder-set change (e.g. a cluster
  // dropped from packages/schema/src/founders.ts) could silently conflate an old sweep's runs with
  // a new one's under the same --experiment name.
  const fsExp = "founder-set-check";
  const fsManifest = buildExperimentManifest(fsExp, opts, 100, 20, 0);
  assert((await resolveExperimentDir(tmp, fsManifest)) === "fresh", "fixture setup: fresh dir for the founder-set check");
  const fsManifestPath = `${tmp}/${fsExp}/experiment.json`;
  const staleFounderSetId = "m3-stale0000000";
  const onDisk = JSON.parse(await Deno.readTextFile(fsManifestPath));
  await Deno.writeTextFile(fsManifestPath, JSON.stringify({ ...onDisk, founderSetId: staleFounderSetId }, null, 2));
  let founderThrew: string | null = null;
  try {
    await resolveExperimentDir(tmp, fsManifest); // fsManifest itself carries the real, current founderSetId
  } catch (e) {
    founderThrew = (e as Error).message;
  }
  assert(founderThrew && /different experiment/.test(founderThrew), `resuming once experiment.json's founderSetId no longer matches this code's M3_FOUNDER_SET must throw, got: ${founderThrew}`);

  // tools/biogeo-analyze.ts's loadExperimentManifest must independently reject a standalone-read
  // experiment.json with a stale founderSetId -- the "re-analyze an already-complete experiment
  // with newer code" path, which never calls resolveExperimentDir again.
  let analyzeThrew: string | null = null;
  try {
    await loadExperimentManifest(`${tmp}/${fsExp}`);
  } catch (e) {
    analyzeThrew = (e as Error).message;
  }
  assert(analyzeThrew !== null && /founder set/.test(analyzeThrew), `loadExperimentManifest must reject a founder-set mismatch, got: ${analyzeThrew}`);

  // Restored to the real founderSetId, loadExperimentManifest accepts it cleanly.
  await Deno.writeTextFile(fsManifestPath, JSON.stringify({ ...onDisk, founderSetId: M3_FOUNDER_SET }, null, 2));
  const reloaded = await loadExperimentManifest(`${tmp}/${fsExp}`);
  assert(reloaded.founderSetId === M3_FOUNDER_SET, "loadExperimentManifest accepts an experiment.json whose founderSetId matches this code's M3_FOUNDER_SET");

  await Deno.remove(tmp, { recursive: true });
  console.log("Part resolveExperimentDir: OK -- fresh, resume, mismatch-throws, and founder-set-identity checks all behave correctly");
}

// ---------------------------------------------------------------------
// Part B: a real end-to-end run -- tools/biogeo-sweep.ts's own real run loop
// (buildSweepPoints/specForPoint/runExperiment/fsSink, the exact functions
// its `import.meta.main` CLI block uses), on a tiny archipelago, then the
// real tools/biogeo-analyze.ts CLI as a subprocess over that output. Numbers
// are real, not hand-faked -- but at this fixture's tiny scale (a few
// hundred cells, 120 steps) they are NOT ecologically meaningful; this
// proves the pipeline end to end, not the biology. Requires a real WebGPU
// device (GpuSim, same as runExperiment always needs) -- Part A above is the
// GPU-free check.
// ---------------------------------------------------------------------
async function runAnalyze(root: string, outDir: string): Promise<{ code: number; stdout: string; stderr: string }> {
  const cmd = new Deno.Command(Deno.execPath(), { args: ["run", "-A", "tools/biogeo-analyze.ts", root, "--out", outDir], stdout: "piped", stderr: "piped" });
  const out = await cmd.output();
  return { code: out.code, stdout: new TextDecoder().decode(out.stdout), stderr: new TextDecoder().decode(out.stderr) };
}

async function partB() {
  const tmp = await Deno.makeTempDir({ prefix: "biogeo-smoke-real-" });
  const experiment = "biogeo-smoke-real";
  // 3 distinct areas (speciesAreaFit's own minimum to identify a slope). isoTile=24 with the
  // default treatment migrantCount (2) makes isoRates=[2] collide with AREA's own tileW=24
  // treatment point, and the unconditional rate-0 control collides with AREA's tileW=24
  // no-migration point -- the same shared-arm case the real default sweep produces.
  const opts: SweepOptions = { areas: [24, 32, 40], isoTile: 24, isoRates: [2], migrationPeriod: 40, seeds: [1, 2] };
  const steps = 120, censusEvery = 20, checkpointEvery = 0;
  const points = buildSweepPoints(opts);
  const manifest = buildExperimentManifest(experiment, opts, steps, censusEvery, checkpointEvery);
  const dir = `${tmp}/${experiment}`;
  assert((await resolveExperimentDir(tmp, manifest)) === "fresh", "fixture setup: a fresh temp dir resolves to \"fresh\"");

  // tools/biogeo-sweep.ts's own real run loop, verbatim: real device, real runExperiment, real
  // fsSink -- the same species-output/manifest code path a real sweep exercises, just on tiny
  // points instead of the default 6-area/5-rate/5-seed sweep.
  const anchors = m3FounderGenomes();
  const firstSpec = specForPoint(experiment, points[0], steps, censusEvery, checkpointEvery);
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
  const device = await requestDevice(navigator.gpu, specConfig(firstSpec));
  const host = { host: "biogeo-smoke", adapter: adapter?.info?.description || "unknown" };
  for (let i = 0; i < points.length; i++) {
    const run = manifest.runs[i];
    const spec: RunSpec = { ...specForPoint(experiment, points[i], steps, censusEvery, checkpointEvery), speciesCensus: true, runId: run.runId };
    const start = archipelagoWorld(run.config, anchors);
    const { summary } = await runExperiment(device, spec, fsSink(`${dir}/${run.runId}`), host, () => {}, { start });
    assert(summary.conservationOk, `run ${run.runId} violated conservation`);
  }

  const result = await runAnalyze(dir, `${tmp}/report`);
  assert(result.code === 0, `analyze should succeed on the real end-to-end fixture (stderr: ${result.stderr})`);
  const report = JSON.parse(await Deno.readTextFile(`${tmp}/report/report.json`));
  assert(report.rejectedRuns.length === 0, `no runs should be rejected, got: ${JSON.stringify(report.rejectedRuns)}`);
  assert(report.eligibleRuns === manifest.runs.length, `expected ${manifest.runs.length} eligible runs (one per unique manifest run), got ${report.eligibleRuns}`);

  for (const condition of ["treatment", "no-migration"] as const) {
    const fit = report.areaFits[condition];
    assert(!("error" in fit), `${condition} area fit should not error on a 3-distinct-area fixture, got: ${JSON.stringify(fit)}`);
    assert(Number.isFinite(fit.z), `${condition} area fit's z must be finite, got z=${fit.z}`);
    // Both fixture seeds should survive to feed each condition's fit -- a null CI here would mean
    // only one seed's points made it through, itself a regression this fixture is meant to catch.
    assert(fit.ci !== null, `${condition} area fit's CI should be available (2 seeds are expected to survive), got ci=${JSON.stringify(fit.ci)}`);
    assert(Number.isFinite(fit.ci[0]) && Number.isFinite(fit.ci[1]), `${condition} area fit's CI must be finite, got ci=${fit.ci}`);
    assert(fit.ci[1] >= fit.ci[0], `${condition} area fit's CI must be ordered, got ${JSON.stringify(fit.ci)}`);
  }

  assert(!("error" in report.isolation), `isolation analysis should not error (missing the rate-0 control would be the regression this catches), got: ${JSON.stringify(report.isolation)}`);
  const ratesSeen = report.isolation.meanByRate.map((r: { rate: number }) => r.rate).sort((a: number, b: number) => a - b);
  assert(ratesSeen.includes(0), `isolation results must include the rate-0 (no-migration) control, got rates [${ratesSeen}]`);
  assert(ratesSeen.length >= 2, `isolation results must include the shared treatment rate alongside the control, got rates [${ratesSeen}]`);
  assert(Number.isFinite(report.isolation.bestRateVsNoMigration.p), `bestRateVsNoMigration.p must be a real number, not NaN, got ${report.isolation.bestRateVsNoMigration.p}`);

  assert(report.diagnostics.foundingDensityByArea.length === 3, `expected founding-density diagnostics for 3 distinct areas, got ${report.diagnostics.foundingDensityByArea.length}`);
  assert(report.diagnostics.perAreaExtinction.length > 0, "expected per-area extinction diagnostics to be non-empty");
  assert(report.diagnostics.livingTransferByRate.length > 0, "expected living-transfer-fraction diagnostics to be non-empty");
  assert(report.diagnostics.livingTransferByRate.some((d: { n: number }) => d.n > 0), "expected at least one rate with real (n>0) living-transfer data");

  console.log(
    `Part B (real end-to-end smoke): OK -- ${report.eligibleRuns} runs, ` +
      `species-area z(treatment)=${report.areaFits.treatment.z.toFixed(3)} z(no-migration)=${report.areaFits["no-migration"].z.toFixed(3)}, ` +
      `isolation rates seen [${ratesSeen}] (NOTE: these numbers are real but NOT ecologically meaningful at this fixture's tiny scale -- a few hundred cells, ${steps} steps, 2 seeds)`,
  );
  await Deno.remove(tmp, { recursive: true });
}

await partA();
await partResolveExperimentDir();
await partB();
