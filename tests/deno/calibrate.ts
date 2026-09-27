// tools/calibrate.ts coverage (Astra review, 2026-09-27):
//   1. tools/lib/calibration-decision.ts's evaluateFreezeability -- pure unit
//      tests over synthetic cohorts (identity mismatch, missing/duplicate/
//      extra seed, conservation exclusion, schedule/quantile mismatch, the
//      freezeable happy path). No filesystem needed for any of these.
//   2. tools/calibrate.ts's CLI wiring against real, tiny synthetic pilots:
//      invalid numeric options refused before touching the filesystem, an
//      empty pooled activity distribution reported unavailable (never a
//      spurious "value: Infinity" success), a provisional (not freezeable)
//      report when the eligible cohort doesn't exactly match what
//      experiments/endpoints.ts declares, and the freezeable happy path
//      against the REAL ACTIVITY_THRESHOLDS declaration.
//
// Run from the repo root: deno run -A tests/deno/calibrate.ts
import { initWorld, METRICS_VERSION, PRESETS, presetIdentity, RULE_VERSION, SCHEMA_VERSION, stateHash } from "@bl/schema";
import { specConfig, type RunSpec } from "@bl/runner";
import { ACTIVITY_THRESHOLDS } from "../../experiments/endpoints.ts";
import { evaluateFreezeability, type CohortRunInfo, type FreezeabilityDeclaration } from "../../tools/lib/calibration-decision.ts";

let ok = true;
const check = (name: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${detail && !cond ? `: ${detail}` : ""}`);
  ok &&= cond;
};

// ============================================================
// 1. evaluateFreezeability -- pure unit tests, no filesystem
// ============================================================
{
  const declaration: FreezeabilityDeclaration = {
    declaredExperiment: "calib-neutral",
    declaredPresetId: "gradient-m3",
    declaredSeeds: [1001, 1005], // a small range for readable test fixtures
    declaredRuns: 5,
    declaredSchedule: { steps: 1000, censusEvery: 100, deepEvery: 10 },
    declaredQuantile: 0.95,
  };
  const goodSchedule = declaration.declaredSchedule;
  const goodQuantile = declaration.declaredQuantile;
  const happyCohort = (): CohortRunInfo[] =>
    Array.from({ length: 5 }, (_, i) => ({ seed: 1001 + i, experiment: "calib-neutral", presetId: "gradient-m3", conservationOk: true }));

  // Freezeable happy path.
  {
    const r = evaluateFreezeability(happyCohort(), declaration, goodSchedule, goodQuantile);
    check("freezeable happy path: exact cohort match is freezeable", r.freezeable === true, JSON.stringify(r));
  }

  // Identity mismatch: wrong experiment on one run, wrong presetId on another.
  {
    const cohort = happyCohort();
    cohort[0] = { ...cohort[0], experiment: "some-other-experiment" };
    cohort[1] = { ...cohort[1], presetId: "spots-m3" };
    const r = evaluateFreezeability(cohort, declaration, goodSchedule, goodQuantile);
    check("identity mismatch: not freezeable", r.freezeable === false);
    if (!r.freezeable) {
      check("...names the wrong experiment", r.reasons.some((x) => /manifest experiment "some-other-experiment"/.test(x)), JSON.stringify(r.reasons));
      check("...names the wrong presetId", r.reasons.some((x) => /manifest presetId "spots-m3"/.test(x)), JSON.stringify(r.reasons));
    }
  }

  // Missing seed: one declared seed absent entirely.
  {
    const cohort = happyCohort().filter((r) => r.seed !== 1003);
    const r = evaluateFreezeability(cohort, declaration, goodSchedule, goodQuantile);
    check("missing seed: not freezeable", r.freezeable === false);
    if (!r.freezeable) check("...names the missing seed", r.reasons.some((x) => /missing declared seed\(s\): 1003/.test(x)), JSON.stringify(r.reasons));
  }

  // Duplicate seed: the same seed appears twice (e.g. "seed-1002" and "seed-01002" both parsing to 1002).
  {
    const cohort = happyCohort();
    cohort.push({ seed: 1002, experiment: "calib-neutral", presetId: "gradient-m3", conservationOk: true });
    const r = evaluateFreezeability(cohort, declaration, goodSchedule, goodQuantile);
    check("duplicate seed: not freezeable", r.freezeable === false);
    if (!r.freezeable) check("...names the duplicate", r.reasons.some((x) => /seed 1002 appears 2 times \(duplicate\)/.test(x)), JSON.stringify(r.reasons));
  }

  // Extra seed: an eligible run outside the declared range.
  {
    const cohort = happyCohort();
    cohort.push({ seed: 1099, experiment: "calib-neutral", presetId: "gradient-m3", conservationOk: true });
    const r = evaluateFreezeability(cohort, declaration, goodSchedule, goodQuantile);
    check("extra seed: not freezeable", r.freezeable === false);
    if (!r.freezeable) check("...names the extra seed", r.reasons.some((x) => /unexpected seed\(s\) outside the declared range 1001.1005: 1099/.test(x)), JSON.stringify(r.reasons));
  }

  // Conservation exclusion: a declared seed present but failing conservation.
  {
    const cohort = happyCohort();
    cohort[2] = { ...cohort[2], conservationOk: false };
    const r = evaluateFreezeability(cohort, declaration, goodSchedule, goodQuantile);
    check("conservation exclusion: not freezeable", r.freezeable === false);
    if (!r.freezeable) {
      check("...names the failed seed", r.reasons.some((x) => /declared seed\(s\) failed conservation: 1003/.test(x)), JSON.stringify(r.reasons));
      check("...does NOT also call it missing (present, just excluded)", !r.reasons.some((x) => /missing declared seed/.test(x)), JSON.stringify(r.reasons));
    }
  }

  // Schedule mismatch.
  {
    const r = evaluateFreezeability(happyCohort(), declaration, { steps: 2000, censusEvery: 100, deepEvery: 10 }, goodQuantile);
    check("schedule mismatch: not freezeable", r.freezeable === false);
    if (!r.freezeable) check("...names the schedule", r.reasons.some((x) => /schedule steps=2000/.test(x)), JSON.stringify(r.reasons));
  }

  // Quantile mismatch.
  {
    const r = evaluateFreezeability(happyCohort(), declaration, goodSchedule, 0.5);
    check("quantile mismatch: not freezeable", r.freezeable === false);
    if (!r.freezeable) check("...names the quantile", r.reasons.some((x) => /quantile 0.5/.test(x)), JSON.stringify(r.reasons));
  }
}

// ============================================================
// 2. CLI wiring -- real subprocess, synthetic bundles
// ============================================================
const root = await Deno.makeTempDir({ prefix: "bl-calibrate-test-" });

async function writeNeutralRun(pilotRoot: string, presetId: string, spec: RunSpec, opts: { lineages?: boolean; conservationOk?: boolean; provenance?: boolean } = {}) {
  const cfg = specConfig(spec);
  const dir = `${pilotRoot}/${presetId}/${spec.condition}/seed-${spec.seed}`;
  await Deno.mkdir(dir, { recursive: true });
  const nCensus = Math.ceil(spec.steps / spec.censusEvery);
  const series = Array.from({ length: nCensus }, (_, i) => ({ step: Math.min((i + 1) * spec.censusEvery, spec.steps), pools: { B: 0, P: 0 }, individuals: 3, lineages: 2 }));
  // Provenance (Astra review, 2026-09-27, item 1): matches what
  // packages/runner/src/runner.ts now actually records on every fresh run.
  // `opts.provenance: false` omits it entirely, simulating a legacy bundle
  // written before this was recorded.
  const preset = PRESETS.find((p) => p.id === presetId);
  const provenance = opts.provenance === false || !preset ? {} : { presetIdentity: presetIdentity(preset), init: preset.init, initHash: stateHash(initWorld(cfg, preset.init)) };
  const manifest = {
    spec,
    cfg,
    ...provenance,
    ruleVersion: RULE_VERSION,
    schemaVersion: SCHEMA_VERSION,
    metricsVersion: METRICS_VERSION,
    startStep: 0,
    summary: {
      steps: spec.steps,
      conservationOk: opts.conservationOk ?? true,
      finalHash: "0",
      wallSeconds: 1,
      stepsPerSecond: spec.steps,
      mutations: 0,
      fissions: 0,
      fusions: 0,
      buddings: 0,
      maxGeneration: 0,
      finalIndividuals: 3,
      finalLineages: 2,
    },
  };
  await Deno.writeTextFile(`${dir}/manifest.json`, JSON.stringify(manifest));
  await Deno.writeTextFile(`${dir}/series.jsonl`, series.map((s) => JSON.stringify(s)).join("\n") + "\n");
  const lineageLines = ["step\tlineage\tcells"];
  if (opts.lineages !== false) {
    // A couple of synthetic lineages with varying abundance, enough for a
    // non-trivial, non-empty pooled activity distribution.
    for (const s of series) {
      lineageLines.push(`${s.step}\taaaa\t${1 + (s.step % 5)}`);
      lineageLines.push(`${s.step}\tbbbb\t${1 + (s.step % 3)}`);
    }
  }
  await Deno.writeTextFile(`${dir}/lineages.tsv`, lineageLines.join("\n") + "\n");
}

async function runCalibrate(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const cmd = new Deno.Command(Deno.execPath(), { args: ["run", "-A", "tools/calibrate.ts", ...args], stdout: "piped", stderr: "piped" });
  const { code, stdout, stderr } = await cmd.output();
  return { code, stdout: new TextDecoder().decode(stdout), stderr: new TextDecoder().decode(stderr) };
}

// --- invalid options refused before touching the filesystem ---
{
  const nonexistent = `${root}/does-not-exist`;
  for (const [flag, value, label] of [
    ["--q", "0", "q must be in (0,1), 0 is the boundary"],
    ["--q", "1", "q must be in (0,1), 1 is the boundary"],
    ["--q", "1.5", "q out of range"],
    ["--alpha", "0", "alpha must be in (0,1)"],
    ["--alpha", "-0.1", "alpha out of range"],
    ["--draws", "0", "draws must be positive"],
    ["--draws", "1.5", "draws must be an integer"],
    ["--draws", "-3", "draws must be positive"],
    ["--seed", "1.5", "seed must be a safe integer"],
  ] as const) {
    const { code, stderr } = await runCalibrate([nonexistent, "--presets", "gradient-m3", flag, value]);
    check(`invalid option ${flag}=${value} (${label}): refused (non-zero exit)`, code !== 0, `exit ${code}: ${stderr}`);
  }
}

// --- empty pooled activity distribution -> unavailable, never "value: Infinity" ---
{
  const pilotRoot = `${root}/empty-dist`;
  const spec = (seed: number): RunSpec => ({ experiment: "calib-neutral", presetId: "gradient-m3", condition: "neutral", seed, steps: 200, censusEvery: 100, deepEvery: 2, checkpointEvery: 0 });
  await writeNeutralRun(pilotRoot, "gradient-m3", spec(1), { lineages: false });
  await writeNeutralRun(pilotRoot, "gradient-m3", spec(2), { lineages: false });
  const outPath = `${pilotRoot}/out.json`;
  const { code } = await runCalibrate([pilotRoot, "--presets", "gradient-m3", "--out", outPath]);
  check("empty pooled distribution: non-zero exit", code !== 0);
  const report = JSON.parse(await Deno.readTextFile(outPath));
  const preset = report.presets.find((p: any) => p.presetId === "gradient-m3");
  check("...status is 'unavailable', not 'ok'", preset?.status === "unavailable", JSON.stringify(preset));
  check("...reason mentions 'empty'", /empty/.test(preset?.reason ?? ""), JSON.stringify(preset));
  check("...no 'value' field printed as a success", !("value" in (preset ?? {})) || preset.value === undefined);
}

// --- legacy pilot (no provenance) -> unavailable, never silently trusted (Astra review, item 1) ---
{
  const pilotRoot = `${root}/legacy-provenance`;
  const spec = (seed: number): RunSpec => ({ experiment: "calib-neutral", presetId: "gradient-m3", condition: "neutral", seed, steps: 200, censusEvery: 100, deepEvery: 2, checkpointEvery: 0 });
  await writeNeutralRun(pilotRoot, "gradient-m3", spec(1), { provenance: false });
  await writeNeutralRun(pilotRoot, "gradient-m3", spec(2), { provenance: false });
  const outPath = `${pilotRoot}/out.json`;
  const { code } = await runCalibrate([pilotRoot, "--presets", "gradient-m3", "--out", outPath]);
  check("legacy pilot (no provenance): non-zero exit", code !== 0);
  const report = JSON.parse(await Deno.readTextFile(outPath));
  const preset = report.presets.find((p: any) => p.presetId === "gradient-m3");
  check("...status is 'unavailable'", preset?.status === "unavailable", JSON.stringify(preset));
  check("...reason mentions provenance", /provenance check failed/.test(preset?.reason ?? ""), JSON.stringify(preset));
  check("...names it a legacy bundle", /legacy bundle lacks provenance/.test(preset?.reason ?? ""), JSON.stringify(preset));
}

// --- initHash mismatch (tampered founders) -> unavailable (Astra review, item 1) ---
{
  const pilotRoot = `${root}/tampered-founders`;
  const spec = (seed: number): RunSpec => ({ experiment: "calib-neutral", presetId: "gradient-m3", condition: "neutral", seed, steps: 200, censusEvery: 100, deepEvery: 2, checkpointEvery: 0 });
  await writeNeutralRun(pilotRoot, "gradient-m3", spec(1));
  await writeNeutralRun(pilotRoot, "gradient-m3", spec(2));
  // Tamper the second run's manifest as if its actual founder content
  // differed from what current code produces for this cfg (a corrupted
  // bundle, or one written by a build with a silent founder-placement bug)
  // while everything else -- presetIdentity, init, cfg -- still claims to
  // agree.
  const dir = `${pilotRoot}/gradient-m3/neutral/seed-2`;
  const m = JSON.parse(await Deno.readTextFile(`${dir}/manifest.json`));
  m.initHash = "0000000000000000";
  await Deno.writeTextFile(`${dir}/manifest.json`, JSON.stringify(m));
  const outPath = `${pilotRoot}/out.json`;
  const { code } = await runCalibrate([pilotRoot, "--presets", "gradient-m3", "--out", outPath]);
  check("tampered founders (initHash mismatch): non-zero exit", code !== 0);
  const report = JSON.parse(await Deno.readTextFile(outPath));
  const preset = report.presets.find((p: any) => p.presetId === "gradient-m3");
  check("...status is 'unavailable'", preset?.status === "unavailable", JSON.stringify(preset));
  check("...names the initHash mismatch, not just 'legacy'", /initHash 0000000000000000 does not match/.test(preset?.reason ?? ""), JSON.stringify(preset));
}

// --- provisional: missing + duplicate seed against the real declared pilot ---
{
  const declared = ACTIVITY_THRESHOLDS["spots-m3"];
  if (!declared) {
    check('experiments/endpoints.ts registers "spots-m3" in ACTIVITY_THRESHOLDS (test assumption)', false, "not registered -- update this test if renamed/removed");
  } else {
    const pilotRoot = `${root}/provisional-spots`;
    const spec = (seed: number): RunSpec => ({
      experiment: declared.pilot.experiment,
      presetId: "spots-m3",
      condition: "neutral",
      seed,
      steps: declared.pilot.steps,
      censusEvery: declared.pilot.censusEvery,
      deepEvery: declared.pilot.deepEvery,
      checkpointEvery: 0,
    });
    // Seeds declared.pilot.seeds[0] .. declared.pilot.seeds[1]-1 (one short of
    // the full declared range: the last declared seed is simply never
    // written, so it's "missing"), plus a duplicate of the first seed under
    // a differently-formatted directory name that parses to the same number.
    const [lo, hi] = declared.pilot.seeds;
    for (let s = lo; s < hi; s++) await writeNeutralRun(pilotRoot, "spots-m3", spec(s));
    // Duplicate: a second directory for seed `lo`, name padded with a
    // leading zero so it's a distinct directory but the same parsed seed.
    const dupDir = `${pilotRoot}/spots-m3/neutral/seed-0${lo}`;
    await Deno.mkdir(dupDir, { recursive: true });
    const dupSrc = `${pilotRoot}/spots-m3/neutral/seed-${lo}`;
    for (const f of ["manifest.json", "series.jsonl", "lineages.tsv"]) await Deno.copyFile(`${dupSrc}/${f}`, `${dupDir}/${f}`);

    const outPath = `${pilotRoot}/out.json`;
    const { code } = await runCalibrate([pilotRoot, "--presets", "spots-m3", "--out", outPath]);
    check("provisional (missing + duplicate seed): non-zero exit", code !== 0);
    const report = JSON.parse(await Deno.readTextFile(outPath));
    const preset = report.presets.find((p: any) => p.presetId === "spots-m3");
    check("...status is 'provisional'", preset?.status === "provisional", JSON.stringify(preset));
    check("...freezeabilityReasons mentions the missing seed", (preset?.freezeabilityReasons ?? []).some((x: string) => /missing declared seed\(s\).*\b(\d+)\b/.test(x) && x.includes(String(hi))), JSON.stringify(preset?.freezeabilityReasons));
    check("...freezeabilityReasons mentions the duplicate", (preset?.freezeabilityReasons ?? []).some((x: string) => /duplicate/.test(x)), JSON.stringify(preset?.freezeabilityReasons));
  }
}

// --- freezeable happy path against the REAL declared pilot metadata ---
{
  const declared = ACTIVITY_THRESHOLDS["gradient-m3"];
  if (!declared) {
    check('experiments/endpoints.ts registers "gradient-m3" in ACTIVITY_THRESHOLDS (test assumption)', false, "not registered -- update this test if renamed/removed");
  } else {
    const pilotRoot = `${root}/happy-gradient`;
    const [lo, hi] = declared.pilot.seeds;
    const spec = (seed: number): RunSpec => ({
      experiment: declared.pilot.experiment,
      presetId: "gradient-m3",
      condition: "neutral",
      seed,
      steps: declared.pilot.steps,
      censusEvery: declared.pilot.censusEvery,
      deepEvery: declared.pilot.deepEvery,
      checkpointEvery: 0,
    });
    for (let s = lo; s <= hi; s++) await writeNeutralRun(pilotRoot, "gradient-m3", spec(s));
    const outPath = `${pilotRoot}/out.json`;
    const { code, stdout } = await runCalibrate([pilotRoot, "--presets", "gradient-m3", "--out", outPath]);
    check("freezeable happy path (exact declared cohort): exit 0", code === 0, `exit ${code}`);
    check("...stdout prints the paste-in instruction (not the PROVISIONAL one)", /paste into experiments\/endpoints\.ts/.test(stdout) && !/PROVISIONAL entry/.test(stdout), stdout);
    const report = JSON.parse(await Deno.readTextFile(outPath));
    const preset = report.presets.find((p: any) => p.presetId === "gradient-m3");
    check("...status is 'ok'", preset?.status === "ok", JSON.stringify(preset));
    check("...eligibleRuns matches the declared count", preset?.eligibleRuns === declared.pilot.runs, JSON.stringify(preset));
    check("...eligibleSeeds is the full sorted declared range", JSON.stringify(preset?.eligibleSeeds) === JSON.stringify(Array.from({ length: hi - lo + 1 }, (_, i) => lo + i)));
    check("...value is finite and positive", Number.isFinite(preset?.value) && preset.value > 0, JSON.stringify(preset?.value));
    check("...identity.presetIdentity is a non-empty string matching the current preset", preset?.identity?.presetIdentity === declared.pilot.presetIdentity, JSON.stringify(preset?.identity));
    check("...identity.calibrationDistributionIdentity matches the current code's neutral-condition distribution", preset?.identity?.calibrationDistributionIdentity === declared.pilot.calibrationDistributionIdentity, JSON.stringify(preset?.identity));
    check("...identity rule/schema/metrics versions match current code", preset?.identity?.ruleVersion === declared.pilot.ruleVersion && preset?.identity?.schemaVersion === declared.pilot.schemaVersion && preset?.identity?.metricsVersion === declared.pilot.metricsVersion);
    check("...bootstrap records seed/draws/alpha", preset?.bootstrap?.seed === 1 && preset?.bootstrap?.draws === 2000 && preset?.bootstrap?.alpha === 0.1, JSON.stringify(preset?.bootstrap));
    check("...bootstrap interval brackets the point estimate reasonably", preset.bootstrap.lower <= preset.value + 1e-6, JSON.stringify(preset));
  }
}

await Deno.remove(root, { recursive: true });
Deno.exit(ok ? 0 : 1);
