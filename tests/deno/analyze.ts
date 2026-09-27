// tools/analyze.ts's metapopulation refusal (see its own "ringed seeds are
// not independent replicates" comment): a ring's seeds exchange matter and
// genomes at every segment boundary, so pooling them as independent
// replicates the way every ensemble statistic does would silently misrepresent
// one ring's degrees of freedom. This is a coverage gap review P2 flagged --
// small, hand-written synthetic bundles (no GPU run needed: the refusal fires
// from manifest.json alone, before any physics-derived statistic is touched).
//
// Run from the repo root: deno run -A tests/deno/analyze.ts
//
// Also covers tools/analyze.ts's activity-threshold decision (2026-09-27,
// freezing the threshold from a separate calibration pilot instead of
// in-sample neutral runs): a pure unit-test section for
// tools/lib/threshold.ts's decideActivityThreshold (all four branches,
// including a non-null frozen value, which no preset in this repo's real
// experiments/endpoints.ts has yet -- the pilot hasn't been run), plus two
// end-to-end synthetic-bundle checks against the real ACTIVITY_THRESHOLDS
// map (both registered presets currently have value: null): the
// not-yet-calibrated "unavailable" report, and the schedule-mismatch
// refusal.
import { initWorld, METRICS_VERSION, PRESETS, presetIdentity, RULE_VERSION, SCHEMA_VERSION, stateHash } from "@bl/schema";
import { quantile } from "@bl/metrics";
import { specConfig, type RunSpec } from "@bl/runner";
import { ACTIVITY_THRESHOLDS } from "../../experiments/endpoints.ts";
import { decideActivityThreshold } from "../../tools/lib/threshold.ts";
import { provenanceProblems, type Run } from "../../tools/lib/bundle.ts";

let ok = true;
const check = (name: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${detail && !cond ? `: ${detail}` : ""}`);
  ok &&= cond;
};

const root = await Deno.makeTempDir({ prefix: "bl-analyze-test-" });

// Writes one synthetic, minimal-but-ensemble-compatible run bundle: enough
// for tools/analyze.ts's own "is this one ensemble" check (exact config match
// via specConfig, matching census grid) to accept it, so execution reaches
// the metapopulation refusal (or passes it) rather than failing earlier for
// an unrelated reason. `full`: also give every census record the fields
// analyze.ts's report-only sections (the "Bound mass (B+P)" chart in
// particular) dereference directly without an optional-chain guard --
// needed for a test that runs analyze.ts all the way to a written report,
// not just far enough to hit one particular check.
async function writeRun(experiment: string, presetId: string, spec: RunSpec, full = false) {
  const cfg = specConfig(spec);
  const dir = `${root}/${experiment}/${presetId}/${spec.condition}/seed-${spec.seed}`;
  await Deno.mkdir(dir, { recursive: true });
  const steps = spec.steps;
  const censusEvery = spec.censusEvery;
  const nCensus = Math.ceil(steps / censusEvery);
  const series = Array.from({ length: nCensus }, (_, i) => ({
    step: Math.min((i + 1) * censusEvery, steps),
    ...(full ? { pools: { B: 0, P: 0 }, individuals: 0, lineages: 0 } : {}),
  }));
  // Provenance (Astra review, 2026-09-27, item 1): matches what
  // packages/runner/src/runner.ts now actually records on every fresh run,
  // computed the same way (presetIdentity(preset), preset.init,
  // stateHash(initWorld(cfg, preset.init))) -- so a synthetic bundle for a
  // known preset is "legitimate" by default; tests that specifically need a
  // legacy or tampered bundle mutate the written manifest afterward
  // (`tamperManifest`) rather than constructing one from scratch.
  const preset = PRESETS.find((p) => p.id === presetId);
  const provenance = preset ? { presetIdentity: presetIdentity(preset), init: preset.init, initHash: stateHash(initWorld(cfg, preset.init)) } : {};
  const manifest = {
    spec,
    cfg,
    ...provenance,
    ruleVersion: RULE_VERSION,
    schemaVersion: SCHEMA_VERSION,
    metricsVersion: METRICS_VERSION,
    startStep: 0,
    summary: {
      steps,
      conservationOk: true,
      finalHash: "0000000000000000",
      wallSeconds: 1,
      stepsPerSecond: steps,
      mutations: 0,
      fissions: 0,
      fusions: 0,
      buddings: 0,
      maxGeneration: 0,
      finalIndividuals: 0,
      finalLineages: 0,
    },
  };
  await Deno.writeTextFile(`${dir}/manifest.json`, JSON.stringify(manifest));
  await Deno.writeTextFile(`${dir}/series.jsonl`, series.map((s) => JSON.stringify(s)).join("\n") + "\n");
  await Deno.writeTextFile(`${dir}/lineages.tsv`, "step\tlineage\tcells\n");
  return { dir };
}

/** Reads a run bundle's manifest.json, applies `patch` (mutating or replacing fields), and rewrites it -- used to build a deliberately legacy/tampered bundle from an otherwise-legitimate one `writeRun` already wrote. */
async function tamperManifest(dir: string, patch: (m: any) => void) {
  const m = JSON.parse(await Deno.readTextFile(`${dir}/manifest.json`));
  patch(m);
  await Deno.writeTextFile(`${dir}/manifest.json`, JSON.stringify(m));
}

async function runAnalyze(runRoot: string, outDir?: string): Promise<{ code: number; stdout: string; stderr: string }> {
  const args = ["run", "-A", "tools/analyze.ts", runRoot];
  if (outDir) args.push("--out", outDir);
  const cmd = new Deno.Command(Deno.execPath(), { args, stdout: "piped", stderr: "piped" });
  const { code, stdout, stderr } = await cmd.output();
  return { code, stdout: new TextDecoder().decode(stdout), stderr: new TextDecoder().decode(stderr) };
}

const baseSpec = (seed: number, condition: string, ringNamespace?: number): RunSpec => ({
  experiment: "analyze-ring",
  presetId: "spots",
  condition,
  seed,
  steps: 200,
  censusEvery: 100,
  deepEvery: 2,
  checkpointEvery: 0,
  ...(ringNamespace !== undefined ? { metapopulation: { salt: 1, migrantCount: 4, ringNamespace } } : {}),
});

// --- a metapopulation ring under "treatment" is refused ---
{
  const ringRoot = `${root}/ring-treatment`;
  await Deno.mkdir(ringRoot, { recursive: true });
  await writeRun("e1", "spots", baseSpec(10, "treatment", 1));
  await writeRun("e1", "spots", baseSpec(20, "treatment", 2));
  const { code, stderr } = await runAnalyze(`${root}/e1/spots`);
  check("analyze.ts refuses a metapopulation ring's seeds as an ensemble (non-zero exit)", code !== 0, `exit ${code}: ${stderr}`);
  check("...with the 'not independent replicates' explanation", /not independent replicates/.test(stderr), stderr);
  check("...naming the affected condition", /treatment/.test(stderr), stderr);
}

// --- the same ring, but every seed is "no-migration" (the metapopulation-level control) -- exempt ---
{
  await writeRun("e2", "spots", baseSpec(10, "no-migration", 1));
  await writeRun("e2", "spots", baseSpec(20, "no-migration", 2));
  const { stderr } = await runAnalyze(`${root}/e2/spots`);
  // "no-migration" runs never get import_from wiring even within a
  // metapopulation experiment (Coordinator.Queue's own control at that
  // level -- see conditions.ts), so they genuinely are independent replicates
  // and must not trip this refusal, whatever else does or doesn't happen
  // later in this synthetic, otherwise-minimal run (e.g. the neutral
  // threshold or per-run statistics sections, which this test doesn't try to
  // satisfy).
  check("analyze.ts does not refuse a metapopulation experiment's \"no-migration\" (control) seeds as a ring", !/not independent replicates/.test(stderr), stderr);
}

// --- an ordinary (non-metapopulation) ensemble is entirely unaffected ---
{
  await writeRun("e3", "spots", baseSpec(10, "treatment"));
  await writeRun("e3", "spots", baseSpec(20, "treatment"));
  const { stderr } = await runAnalyze(`${root}/e3/spots`);
  check("analyze.ts does not refuse an ordinary, non-metapopulation ensemble as a ring", !/not independent replicates/.test(stderr), stderr);
}

// ---- decideActivityThreshold (tools/lib/threshold.ts) -- pure unit tests ----
// A fake thresholds map, not the real ACTIVITY_THRESHOLDS: it needs a
// registered preset with a non-null frozen value to exercise the "frozen
// value used" branch, which no real preset has yet (the pilot hasn't been
// run and reduced).
{
  const pilot = {
    experiment: "calib-neutral",
    seeds: [1001, 1020] as [number, number],
    runs: 20,
    steps: 1_000_000,
    censusEvery: 100,
    deepEvery: 10,
    ruleVersion: 1,
    schemaVersion: 3,
    metricsVersion: 2,
    presetIdentity: "deadbeefcafef00d",
    calibrationDistributionIdentity: "0102030405060708",
  };
  const fakeThresholds = {
    "gradient-m3": { value: 483172.5, quantile: 0.95, pilot },
    "spots-m3": { value: null, quantile: 0.95, pilot },
  };
  const schedule = { steps: pilot.steps, censusEvery: pilot.censusEvery, deepEvery: pilot.deepEvery };
  // Matches the fake pilot's recorded identity exactly -- the "everything
  // agrees" baseline every mismatch test below perturbs one field of.
  const matchingIdentity = {
    ruleVersion: pilot.ruleVersion,
    schemaVersion: pilot.schemaVersion,
    metricsVersion: pilot.metricsVersion,
    presetIdentity: pilot.presetIdentity,
    calibrationDistributionIdentity: pilot.calibrationDistributionIdentity,
  };
  const noOverlapSeeds = [1, 2, 3]; // well outside the fake pilot's reserved 1001-1020

  // 1. Frozen value used.
  {
    const outcome = decideActivityThreshold("gradient-m3", fakeThresholds, schedule, 0.95, [], matchingIdentity, noOverlapSeeds);
    check("frozen value used: mode is 'frozen'", outcome.kind === "ok" && outcome.decision.mode === "frozen");
    check("frozen value used: calibrated", outcome.kind === "ok" && outcome.decision.calibrated === true);
    check("frozen value used: threshold is the registered value, not computed from neutralActs", outcome.kind === "ok" && outcome.decision.threshold === 483172.5);
    check("frozen value used: no unavailable reason", outcome.kind === "ok" && outcome.decision.unavailableReason === null);
  }

  // 2. Null value -> unavailable (not a refusal: analyze.ts still produces a report, with activity endpoints marked unavailable).
  {
    const outcome = decideActivityThreshold("spots-m3", fakeThresholds, schedule, 0.95, [1, 2, 3], matchingIdentity, noOverlapSeeds);
    check("null value: still 'ok' (not a refusal)", outcome.kind === "ok");
    check("null value: mode is 'frozen'", outcome.kind === "ok" && outcome.decision.mode === "frozen");
    check("null value: not calibrated", outcome.kind === "ok" && outcome.decision.calibrated === false);
    check("null value: unavailable reason mentions 'not yet calibrated'", outcome.kind === "ok" && /not yet calibrated/.test(outcome.decision.unavailableReason ?? ""));
    // Ignores this ensemble's own neutral runs entirely for the frozen path -- no silent in-sample fallback.
    check("null value: threshold is Infinity, not computed from neutralActs", outcome.kind === "ok" && outcome.decision.threshold === Infinity);
  }

  // 3. Schedule mismatch -> refused.
  {
    const mismatched = { steps: 200, censusEvery: 100, deepEvery: 2 };
    const outcome = decideActivityThreshold("gradient-m3", fakeThresholds, mismatched, 0.95, [], matchingIdentity, noOverlapSeeds);
    check("schedule mismatch: refused", outcome.kind === "refuse");
    check("schedule mismatch: reason names the mismatch", outcome.kind === "refuse" && /different observation schedule/.test(outcome.reason));
  }

  // 3b. --q overridden against a registered preset is refused the same way.
  {
    const outcome = decideActivityThreshold("gradient-m3", fakeThresholds, schedule, 0.5, [], matchingIdentity, noOverlapSeeds);
    check("--q override on a registered preset: refused", outcome.kind === "refuse");
    check("--q override: reason names --q", outcome.kind === "refuse" && /--q/.test(outcome.reason));
  }

  // 3c. Rule/schema/metrics version mismatch -> refused (Astra review, P1).
  {
    for (const [field, bad] of [["ruleVersion", 2], ["schemaVersion", 4], ["metricsVersion", 3]] as const) {
      const identity = { ...matchingIdentity, [field]: bad };
      const outcome = decideActivityThreshold("gradient-m3", fakeThresholds, schedule, 0.95, [], identity, noOverlapSeeds);
      check(`${field} mismatch: refused`, outcome.kind === "refuse", JSON.stringify(outcome));
      check(`${field} mismatch: reason mentions versions`, outcome.kind === "refuse" && /versions/.test(outcome.reason));
    }
  }

  // 3d. Preset identity mismatch -> refused (Astra review, P1): the preset's cfg/init/founder set changed since calibration.
  {
    const identity = { ...matchingIdentity, presetIdentity: "0000000000000000" };
    const outcome = decideActivityThreshold("gradient-m3", fakeThresholds, schedule, 0.95, [], identity, noOverlapSeeds);
    check("presetIdentity mismatch: refused", outcome.kind === "refuse");
    check("presetIdentity mismatch: reason names 'changed since'", outcome.kind === "refuse" && /changed since/.test(outcome.reason));
  }

  // 3d2. Calibration-distribution identity mismatch -> refused (Astra review, item 2): simulates a changed neutral
  // transform (e.g. conditions.ts's "neutral" additionally zeroing mutRate) that leaves presetIdentity unchanged.
  {
    const identity = { ...matchingIdentity, calibrationDistributionIdentity: "ffffffffffffffff" };
    const outcome = decideActivityThreshold("gradient-m3", fakeThresholds, schedule, 0.95, [], identity, noOverlapSeeds);
    check("calibrationDistributionIdentity mismatch: refused", outcome.kind === "refuse");
    check("calibrationDistributionIdentity mismatch: reason names the neutral-condition distribution", outcome.kind === "refuse" && /calibration distribution has changed/.test(outcome.reason), outcome.kind === "refuse" ? outcome.reason : "");
    // A presetIdentity match alone is not enough -- both identities must agree.
    check("calibrationDistributionIdentity mismatch: reason is distinct from a plain presetIdentity mismatch", outcome.kind === "refuse" && !/changed since its activity threshold was calibrated \(presetIdentity/.test(outcome.reason));
  }

  // 3e. Seed overlap with the pilot's reserved range -> refused (Astra review, P2).
  {
    const outcome = decideActivityThreshold("gradient-m3", fakeThresholds, schedule, 0.95, [], matchingIdentity, [5, 1005, 1010]);
    check("seed overlap: refused", outcome.kind === "refuse");
    check("seed overlap: reason names the overlapping seeds", outcome.kind === "refuse" && /1005, 1010/.test(outcome.reason), outcome.kind === "refuse" ? outcome.reason : "");
  }
  {
    // Seeds entirely outside the reserved range never trip this -- only exact overlap does.
    const outcome = decideActivityThreshold("gradient-m3", fakeThresholds, schedule, 0.95, [], matchingIdentity, [1000, 1021]);
    check("seeds adjacent to (but outside) the reserved range: not refused for overlap", outcome.kind === "ok");
  }

  // 3f. A non-null frozen value that isn't finite and positive is a configuration error, refused defensively (Astra review, P2).
  {
    for (const bad of [Infinity, -Infinity, NaN, 0, -5]) {
      const thresholds = { "gradient-m3": { value: bad, quantile: 0.95, pilot } };
      const outcome = decideActivityThreshold("gradient-m3", thresholds, schedule, 0.95, [], matchingIdentity, noOverlapSeeds);
      check(`invalid frozen value ${bad}: refused`, outcome.kind === "refuse", JSON.stringify(outcome));
      check(`invalid frozen value ${bad}: reason names it a configuration error`, outcome.kind === "refuse" && /configuration error/.test(outcome.reason));
    }
  }

  // 4. Exploratory preset (absent from the map) is entirely unchanged: in-sample quantile of its own neutral runs, whatever schedule it ran at.
  {
    const outcome = decideActivityThreshold("spots", fakeThresholds, { steps: 200, censusEvery: 100, deepEvery: 2 }, 0.95, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], matchingIdentity, noOverlapSeeds);
    check("exploratory preset: mode is 'exploratory'", outcome.kind === "ok" && outcome.decision.mode === "exploratory");
    check("exploratory preset: calibrated from its own neutral runs", outcome.kind === "ok" && outcome.decision.calibrated === true);
    check("exploratory preset: no schedule check applied (200 steps, not the pilot's 1e6)", outcome.kind === "ok");
    // The direct in-sample computation this ensemble's own report would also perform, compared against decideActivityThreshold's result.
    const direct = quantile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.95);
    check("exploratory preset: threshold equals a direct in-sample quantile computation", outcome.kind === "ok" && outcome.decision.threshold === direct, `${outcome.kind === "ok" ? outcome.decision.threshold : "n/a"} vs ${direct}`);
  }
  {
    // An exploratory preset with no neutral runs at all is uncalibrated, not refused.
    const outcome = decideActivityThreshold("spots", fakeThresholds, { steps: 200, censusEvery: 100, deepEvery: 2 }, 0.95, [], matchingIdentity, noOverlapSeeds);
    check("exploratory preset, no neutral runs: uncalibrated, not refused", outcome.kind === "ok" && outcome.decision.calibrated === false);
  }
  {
    // Exploratory presets never check identity/versions/seed overlap at all -- a mismatched or garbage identity/seed set changes nothing.
    const garbageIdentity = { ruleVersion: -1, schemaVersion: -1, metricsVersion: -1, presetIdentity: "garbage", calibrationDistributionIdentity: "garbage" };
    const outcome = decideActivityThreshold("spots", fakeThresholds, { steps: 200, censusEvery: 100, deepEvery: 2 }, 0.95, [1, 2, 3], garbageIdentity, [1001, 1010]);
    check("exploratory preset: identity/seed checks never apply", outcome.kind === "ok" && outcome.decision.mode === "exploratory");
  }
}

// ---- provenanceProblems (tools/lib/bundle.ts) -- pure unit tests ----
// packages/runner/src/runner.ts now records presetIdentity/init/initHash on
// every fresh run's manifest (Astra review, 2026-09-27, item 1) -- these
// check that a run's manifest is actually verified against CURRENT code,
// not just trusted because its spec.presetId *label* matches. Real
// @bl/schema functions (presetIdentity, initWorld, stateHash) build the
// "correct" fixture once; each test then tampers exactly one field of a
// fresh copy.
{
  const presetId = "gradient-m3";
  const preset = PRESETS.find((p) => p.id === presetId)!;
  const cfg = specConfig({ experiment: "prov", presetId, condition: "neutral", seed: 1001, steps: 200, censusEvery: 100, deepEvery: 2, checkpointEvery: 0 });
  const correctManifest = {
    spec: { presetId, condition: "neutral", seed: 1001 },
    cfg,
    presetIdentity: presetIdentity(preset),
    init: preset.init,
    initHash: stateHash(initWorld(cfg, preset.init)),
  };
  const makeRun = (manifest: any): Run => ({ condition: "neutral", seed: 1001, dir: "", series: [], lineages: new Map(), manifest });

  // Happy path: a correctly-provenanced run has no problems.
  {
    const problems = provenanceProblems([makeRun(correctManifest)], presetId);
    check("provenanceProblems: a correctly-provenanced run has no problems", problems.length === 0, JSON.stringify(problems));
  }

  // Missing provenance (legacy bundle): each of the three fields absent, one at a time, and all three at once.
  for (const omit of [["presetIdentity"], ["init"], ["initHash"], ["presetIdentity", "init", "initHash"]] as const) {
    const m = { ...correctManifest };
    for (const k of omit) delete (m as any)[k];
    const problems = provenanceProblems([makeRun(m)], presetId);
    check(`provenanceProblems: missing ${omit.join("+")} is refused as legacy`, problems.length === 1 && /legacy bundle lacks provenance/.test(problems[0]), JSON.stringify(problems));
  }

  // Manifest init mismatch: founders count differs from the current preset's (e.g. 1 recorded founder vs today's 13).
  {
    const m = { ...correctManifest, init: { ...preset.init, founders: 1 } };
    const problems = provenanceProblems([makeRun(m)], presetId);
    check("provenanceProblems: manifest.init mismatch is refused", problems.some((p) => /manifest\.init/.test(p)), JSON.stringify(problems));
  }

  // initHash mismatch (tampered/wrong founder content): init and presetIdentity both correct, but the recorded hash doesn't match what current code actually produces for this cfg.
  {
    const m = { ...correctManifest, initHash: "0000000000000000" };
    const problems = provenanceProblems([makeRun(m)], presetId);
    check("provenanceProblems: initHash mismatch is refused", problems.some((p) => /initHash 0000000000000000 does not match/.test(p)), JSON.stringify(problems));
  }

  // presetIdentity mismatch on its own (init/initHash otherwise correct for this cfg).
  {
    const m = { ...correctManifest, presetIdentity: "0000000000000000" };
    const problems = provenanceProblems([makeRun(m)], presetId);
    check("provenanceProblems: presetIdentity mismatch is refused", problems.some((p) => /presetIdentity 0000000000000000 does not match/.test(p)), JSON.stringify(problems));
  }

  // Multiple runs: only the bad one is named, the good one contributes no problems.
  {
    const bad = { ...correctManifest, init: { ...preset.init, founders: 1 } };
    const problems = provenanceProblems([makeRun(correctManifest), { ...makeRun(bad), seed: 1002 }], presetId);
    check("provenanceProblems: a mixed cohort names only the bad run", problems.length === 1 && /seed-1002/.test(problems[0]), JSON.stringify(problems));
  }
}

// ---- end-to-end against the real ACTIVITY_THRESHOLDS (experiments/endpoints.ts) ----
// Exercises analyze.ts's actual wiring against the declared entry: a null
// value (before the calib-neutral pilot was reduced) gives an uncalibrated
// report; a frozen value must be used exactly.
{
  const gradientM3 = ACTIVITY_THRESHOLDS["gradient-m3"];
  if (!gradientM3) {
    check("experiments/endpoints.ts registers \"gradient-m3\" in ACTIVITY_THRESHOLDS (test assumption)", false, "not registered -- update this test if the registration was renamed or removed");
  } else {
    const { pilot } = gradientM3;
    const matchingSpec = (seed: number): RunSpec => ({
      experiment: "calib-real-check",
      presetId: "gradient-m3",
      condition: "treatment",
      seed,
      steps: pilot.steps,
      censusEvery: pilot.censusEvery,
      deepEvery: pilot.deepEvery,
      checkpointEvery: 0,
    });
    if (gradientM3.value === null) {
      // --- matching schedule, still-null value -> report generated, activity endpoints unavailable, exit 0 ---
      await writeRun("e4", "gradient-m3", matchingSpec(10), true);
      await writeRun("e4", "gradient-m3", matchingSpec(20), true);
      const outDir = `${root}/e4-report`;
      const { code, stdout, stderr } = await runAnalyze(`${root}/e4/gradient-m3`, outDir);
      check("null frozen value, matching schedule: analyze.ts succeeds (writes a report, doesn't throw)", code === 0, `exit ${code}: ${stderr}`);
      check("...stdout says activity endpoints are unavailable", /Activity endpoints unavailable/.test(stdout), stdout);
      check("...naming 'not yet calibrated'", /not yet calibrated/.test(stdout), stdout);
      let reportJson: any = null;
      try {
        reportJson = JSON.parse(await Deno.readTextFile(`${outDir}/report.json`));
      } catch (e) {
        check("...report.json is written and parses", false, String(e));
      }
      if (reportJson) {
        check("...report.json: thresholdMode is 'frozen'", reportJson.thresholdMode === "frozen", JSON.stringify(reportJson.thresholdMode));
        check("...report.json: calibrated is false", reportJson.calibrated === false);
        check("...report.json: threshold is null (Infinity is not valid JSON, serialized as null)", reportJson.threshold === null);
      }
    } else {
      // --- matching schedule, frozen value -> report uses exactly the frozen value ---
      await writeRun("e4", "gradient-m3", matchingSpec(10), true);
      await writeRun("e4", "gradient-m3", matchingSpec(20), true);
      const outDir = `${root}/e4-report`;
      const { code, stderr } = await runAnalyze(`${root}/e4/gradient-m3`, outDir);
      check("frozen value, matching schedule: analyze.ts succeeds", code === 0, `exit ${code}: ${stderr}`);
      let reportJson: any = null;
      try {
        reportJson = JSON.parse(await Deno.readTextFile(`${outDir}/report.json`));
      } catch (e) {
        check("...report.json is written and parses", false, String(e));
      }
      if (reportJson) {
        check("...report.json: thresholdMode is 'frozen'", reportJson.thresholdMode === "frozen", JSON.stringify(reportJson.thresholdMode));
        check("...report.json: calibrated is true", reportJson.calibrated === true);
        check("...report.json: threshold is the frozen value", reportJson.threshold === gradientM3.value, JSON.stringify(reportJson.threshold));
      }
    }

    // --- mismatched schedule -> refused, regardless of whether the value is null ---
    const mismatchedSpec: RunSpec = { ...matchingSpec(10), steps: 200, censusEvery: 100, deepEvery: 2 };
    await writeRun("e5", "gradient-m3", mismatchedSpec);
    await writeRun("e5", "gradient-m3", { ...mismatchedSpec, seed: 20 });
    const { code, stderr } = await runAnalyze(`${root}/e5/gradient-m3`);
    check("schedule mismatch against the real pilot metadata: analyze.ts refuses (non-zero exit)", code !== 0, `exit ${code}: ${stderr}`);
    check("...naming the schedule mismatch", /different observation schedule/.test(stderr), stderr);

    // --- seed reused from the real pilot's reserved range -> refused (matching schedule, so the seed check is actually reached) ---
    await writeRun("e7", "gradient-m3", matchingSpec(pilot.seeds[0] + 3), true); // inside [1001, 1020]
    await writeRun("e7", "gradient-m3", matchingSpec(20), true); // outside it
    const seedOverlap = await runAnalyze(`${root}/e7/gradient-m3`);
    check("seed reused from the real pilot's reserved range: analyze.ts refuses (non-zero exit)", seedOverlap.code !== 0, `exit ${seedOverlap.code}: ${seedOverlap.stderr}`);
    check("...naming the reserved seed", new RegExp(String(pilot.seeds[0] + 3)).test(seedOverlap.stderr), seedOverlap.stderr);
  }
}

// ---- exploratory preset end-to-end: unchanged report shape ----
{
  await writeRun("e6", "spots", baseSpec(10, "treatment"), true);
  await writeRun("e6", "spots", baseSpec(20, "treatment"), true);
  const outDir = `${root}/e6-report`;
  const { code, stderr } = await runAnalyze(`${root}/e6/spots`, outDir);
  check("exploratory preset (\"spots\", unregistered): analyze.ts succeeds", code === 0, `exit ${code}: ${stderr}`);
  if (code === 0) {
    const reportJson = JSON.parse(await Deno.readTextFile(`${outDir}/report.json`));
    check("...report.json: thresholdMode is 'exploratory'", reportJson.thresholdMode === "exploratory", JSON.stringify(reportJson.thresholdMode));
    // No neutral runs in this fixture -> uncalibrated, exactly as before this threshold was ever frozen for any preset.
    check("...report.json: calibrated is false (no neutral runs in this fixture)", reportJson.calibrated === false);
  }
}

await Deno.remove(root, { recursive: true });
Deno.exit(ok ? 0 : 1);
