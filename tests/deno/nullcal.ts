// Deno smoke tests for tools/nullcal.ts and the tools/analyze.ts loader/pure-
// function split it depends on (docs/plan.md "Gate calibration"). Following
// tests/deno/analyze.ts's own check(name, cond, detail) pattern.
//
// Run from the repo root: deno run -A tests/deno/nullcal.ts
import { METRICS_VERSION, SCHEMA_VERSION } from "@bl/schema";
import { analyzeEnsemble, loadEnsemble } from "../../tools/analyze.ts";
import { buildManifest, makeSpec, NULLCAL_CONDITIONS, plantedSignal, type Identity } from "../../tools/lib/nullgen.ts";

let ok = true;
const check = (name: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${detail && !cond ? `: ${detail}` : ""}`);
  ok &&= cond;
};

const root = await Deno.makeTempDir({ prefix: "bl-nullcal-test-" });

// --- nullcal CLI smoke test ---
{
  const out = `${root}/cli-out`;
  const cmd = new Deno.Command(Deno.execPath(), {
    args: [
      "run", "-A", "tools/nullcal.ts",
      "--nulls", "longPeriodLoop",
      "--windows", "20000",
      "--replicates", "3",
      "--seeds-per-condition", "6",
      "--census-every", "200",
      "--deep-every", "4",
      "--bounded", "false",
      "--out", out,
    ],
    stdout: "piped",
    stderr: "piped",
  });
  const { code, stderr } = await cmd.output();
  check("nullcal CLI smoke test exits 0", code === 0, new TextDecoder().decode(stderr));
  const report = JSON.parse(await Deno.readTextFile(`${out}/report.json`));
  const rowKeys = Object.keys(report.tallies).filter((k) => k.startsWith("longPeriodLoop@20000::"));
  check("nullcal CLI: rows recorded for the requested (null, window) cell", rowKeys.length > 0, JSON.stringify(Object.keys(report.tallies)));
  for (const k of rowKeys) {
    const t = report.tallies[k];
    check(`nullcal CLI: ${k} k/n well-formed`, t.k >= 0 && t.k <= t.n, JSON.stringify(t));
    if (t.n > 0 && t.ci) check(`nullcal CLI: ${k} CI well-formed`, t.ci.lower >= 0 && t.ci.lower <= t.ci.upper && t.ci.upper <= 1, JSON.stringify(t.ci));
  }
  check("nullcal CLI: exactly 3 trials recorded", report.trials.length === 3, `got ${report.trials.length}`);
  for (const t of report.trials) check("nullcal CLI: trial provenance recorded", Object.keys(t.generatorParams).length > 0, JSON.stringify(t));
  for (const t of report.trials) check("nullcal CLI: trial decisions recorded", !!t.decisions && Object.keys(t.decisions).length > 0, JSON.stringify(t));
  check(
    "nullcal CLI: codeIdentity records the historical preset law and current schema/metrics",
    report.codeIdentity?.ruleVersion === 1 && report.codeIdentity?.schemaVersion === SCHEMA_VERSION && report.codeIdentity?.metricsVersion === METRICS_VERSION,
    JSON.stringify(report.codeIdentity),
  );
  check(
    "nullcal CLI: codeIdentity's commitId is either a 40-char hex jj commit id or \"unknown\"",
    report.codeIdentity?.commitId === "unknown" || /^[0-9a-f]{40}$/.test(report.codeIdentity?.commitId ?? ""),
    JSON.stringify(report.codeIdentity?.commitId),
  );

  // Determinism at the CLI level: same --seed, into a different --out, byte-identical report.json.
  // report.json carries no wall-clock timing (that's console/report.md only, see nullcal.ts), so
  // this compares the files as written, with no fields stripped first.
  const out2 = `${root}/cli-out-2`;
  const cmd2 = new Deno.Command(Deno.execPath(), {
    args: ["run", "-A", "tools/nullcal.ts", "--nulls", "longPeriodLoop", "--windows", "20000", "--replicates", "3", "--seeds-per-condition", "6", "--census-every", "200", "--deep-every", "4", "--bounded", "false", "--out", out2],
    stdout: "null",
    stderr: "piped",
  });
  const { code: code2, stderr: stderr2 } = await cmd2.output();
  check("nullcal CLI second run exits 0", code2 === 0, new TextDecoder().decode(stderr2));
  const r1 = await Deno.readTextFile(`${out}/report.json`);
  const r2 = await Deno.readTextFile(`${out2}/report.json`);
  check("nullcal CLI: two runs with the same --seed produce byte-identical report.json", r1 === r2);
}

// --- --out must not already exist ---
{
  const out = `${root}/fresh-out`;
  const cmd1 = new Deno.Command(Deno.execPath(), {
    args: ["run", "-A", "tools/nullcal.ts", "--nulls", "longPeriodLoop", "--windows", "20000", "--replicates", "1", "--seeds-per-condition", "4", "--census-every", "200", "--deep-every", "4", "--bounded", "false", "--out", out],
    stdout: "null",
    stderr: "piped",
  });
  const r1 = await cmd1.output();
  check("--out refusal: first run into a fresh --out exits 0", r1.code === 0, new TextDecoder().decode(r1.stderr));
  const cmd2 = new Deno.Command(Deno.execPath(), {
    args: ["run", "-A", "tools/nullcal.ts", "--nulls", "longPeriodLoop", "--windows", "20000", "--replicates", "1", "--seeds-per-condition", "4", "--census-every", "200", "--deep-every", "4", "--bounded", "false", "--out", out],
    stdout: "null",
    stderr: "piped",
  });
  const r2 = await cmd2.output();
  const stderr2 = new TextDecoder().decode(r2.stderr);
  check("--out refusal: rerunning into the SAME --out is rejected", r2.code !== 0 && stderr2.includes("already exists"), stderr2);
}

// --- duplicate --nulls / --windows entries are rejected, not silently doubled ---
{
  const cmd = new Deno.Command(Deno.execPath(), {
    args: ["run", "-A", "tools/nullcal.ts", "--nulls", "longPeriodLoop,longPeriodLoop", "--windows", "20000", "--replicates", "1", "--out", `${root}/dup-nulls`],
    stdout: "null",
    stderr: "piped",
  });
  const { code, stderr } = await cmd.output();
  check("nullcal CLI: duplicate --nulls entries are rejected", code !== 0 && new TextDecoder().decode(stderr).includes("duplicate"), new TextDecoder().decode(stderr));
}
{
  const cmd = new Deno.Command(Deno.execPath(), {
    args: ["run", "-A", "tools/nullcal.ts", "--nulls", "longPeriodLoop", "--windows", "20000,20000", "--replicates", "1", "--out", `${root}/dup-windows`],
    stdout: "null",
    stderr: "piped",
  });
  const { code, stderr } = await cmd.output();
  check("nullcal CLI: duplicate --windows entries are rejected", code !== 0 && new TextDecoder().decode(stderr).includes("duplicate"), new TextDecoder().decode(stderr));
}

// --- --replicates outside the numerically-verified-safe range is rejected ---
{
  const cmd = new Deno.Command(Deno.execPath(), {
    args: ["run", "-A", "tools/nullcal.ts", "--replicates", "501", "--out", `${root}/too-many-reps`],
    stdout: "null",
    stderr: "piped",
  });
  const { code, stderr } = await cmd.output();
  check("nullcal CLI: --replicates above MAX_REPLICATES is rejected", code !== 0 && new TextDecoder().decode(stderr).includes("MAX_REPLICATES"), new TextDecoder().decode(stderr));
}

// --- coexistence boundary: a window whose true observable span is EXACTLY
// the endpoint's own minSteps must be decided, not excluded as unavailable
// (the real endpoint's coexistenceQualifies accepts duration >= minSteps).
// --windows 100100 --census-every 100 --deep-every 10 gives a span of
// exactly 100000 == ecological-closure-coexistence's minSteps.
{
  const out = `${root}/coexistence-boundary`;
  const cmd = new Deno.Command(Deno.execPath(), {
    args: ["run", "-A", "tools/nullcal.ts", "--nulls", "longPeriodLoop", "--windows", "100100", "--replicates", "1", "--seeds-per-condition", "4", "--census-every", "100", "--deep-every", "10", "--bounded", "false", "--out", out],
    stdout: "null",
    stderr: "piped",
  });
  const { code, stderr } = await cmd.output();
  check("coexistence boundary: nullcal CLI exits 0", code === 0, new TextDecoder().decode(stderr));
  const report = JSON.parse(await Deno.readTextFile(`${out}/report.json`));
  const key = "longPeriodLoop@100100::ecological-closure-coexistence";
  const t = report.tallies[key];
  check("coexistence boundary: span == minSteps (100000) is decided, not excluded as unavailable", !!t && t.n === 1 && t.unavailable === 0, JSON.stringify(t));
  const gateKey = "longPeriodLoop@100100::ecological-closure-coexistence.gate";
  const g = report.tallies[gateKey];
  check("coexistence boundary: the .gate row at the same span is also decided, not excluded", !!g && g.n === 1 && g.unavailable === 0, JSON.stringify(g));
}

// --- the loader/pure-function split didn't change behavior: the real CLI
// (loadEnsemble -> analyzeEnsemble -> disk) and the direct in-process call
// (loadEnsemble -> analyzeEnsemble, no disk write) must produce byte-
// identical report.json for the same fixture -- the permanent regression
// guard that the CLI and nullcal's own in-memory call never diverge.
{
  const dir = `${root}/split-fixture`;
  const experiment = "nullcal-split-check";
  const windowSteps = 6000; // >= 30 censuses at censusEvery=200, plenty of deep censuses at deepEvery=4
  const censusEvery = 200, deepEvery = 4;
  for (const [seedIndex, conditionId] of NULLCAL_CONDITIONS.flatMap((c) => [0, 1].map((s) => [s, c] as const))) {
    const id: Identity = { masterSeed: 1, nullId: "split-check", windowSteps, replicateIndex: 0, condition: conditionId, seedIndex };
    const spec = makeSpec(experiment, conditionId, seedIndex, windowSteps, censusEvery, deepEvery);
    const bundle = plantedSignal(id, spec);
    const manifest = buildManifest(spec, "split-check", windowSteps, 0, bundle.generatorParams);
    const runDir = `${dir}/${experiment}/gradient-m3/${conditionId}/seed-${spec.seed}`;
    await Deno.mkdir(runDir, { recursive: true });
    await Deno.writeTextFile(`${runDir}/manifest.json`, JSON.stringify(manifest));
    await Deno.writeTextFile(`${runDir}/series.jsonl`, bundle.series.map((s) => JSON.stringify(s)).join("\n") + "\n");
    // Census order, as tools/run.ts writes it (analyze streams lineages.tsv and requires it).
    const rows = [...bundle.lineages].sort((x, y) => x.step - y.step);
    const lines = ["step\tlineage\tcells", ...rows.map((l) => `${l.step}\t${l.key}\t${l.cells}`)];
    await Deno.writeTextFile(`${runDir}/lineages.tsv`, lines.join("\n") + "\n");
  }

  const ensembleRoot = `${dir}/${experiment}/gradient-m3`;
  const cliOut = `${dir}/report-cli`;
  // --ignore-frozen-threshold: this fixture reuses the registered
  // "gradient-m3" preset id (like tools/nullcal.ts's own real trials) but
  // carries none of that preset's calibration-pilot provenance, so the CLI
  // must be told to use the exploratory (in-sample) threshold path, exactly
  // as tools/nullcal.ts itself always does -- see its own comment.
  const cliCmd = new Deno.Command(Deno.execPath(), { args: ["run", "-A", "tools/analyze.ts", ensembleRoot, "--out", cliOut, "--ignore-frozen-threshold"], stdout: "null", stderr: "piped" });
  const { code: cliCode, stderr: cliStderr } = await cliCmd.output();
  check("split check: the real analyze.ts CLI exits 0 on the fixture", cliCode === 0, new TextDecoder().decode(cliStderr));
  const cliReport = JSON.parse(await Deno.readTextFile(`${cliOut}/report.json`));

  const loaded = await loadEnsemble(ensembleRoot);
  const { json: directJson } = await analyzeEnsemble(loaded, ensembleRoot, { ignoreFrozenThreshold: true });

  check(
    "split check: the CLI's report.json equals the direct in-process analyzeEnsemble call's json, on the same fixture",
    JSON.stringify(cliReport) === JSON.stringify(directJson),
  );
  // The two checks above only prove the CLI and an in-process call agree with
  // EACH OTHER -- both go through today's analyzeEnsemble, so neither one can
  // catch analyzeEnsemble itself growing a new top-level report.json field
  // (e.g. leaking the `results`/`heldOut` endpoint decisions nullcal consumes
  // in-process into the CLI's own file). Since the activity threshold was
  // frozen (2026-09-27), report.json's top-level shape has been exactly
  // these keys (m4Descriptive, roleCutSensitivity and heredity added before the pre-registration freeze) (tests/deno/analyze.ts pins the CLI's own end-to-end
  // behavior against real ACTIVITY_THRESHOLDS entries); pin that shape
  // directly here too.
  const expectedKeys = "adaptiveActivityNote,calibrated,ensembleIdentity,heredity,inSampleNeutralQuantile,m4Descriptive,presetId,q,roleCutSensitivity,runs,threshold,thresholdMode,unavailableReason";
  check(
    "split check: the CLI's report.json has exactly the current top-level shape, no extra or missing keys",
    Object.keys(cliReport).sort().join(",") === expectedKeys,
    JSON.stringify(Object.keys(cliReport).sort()),
  );
}

await Deno.remove(root, { recursive: true });
Deno.exit(ok ? 0 : 1);
