// Behavioral checks at the same preparation interface used by both CLIs.
// Run: deno run -A tests/deno/cohort.ts
import { initWorld, METRICS_VERSION, PRESETS, presetIdentity, SCHEMA_VERSION, stateHash } from "@bl/schema";
import { specConfig, type RunSpec } from "@bl/runner";
import { prepareCohort } from "../../tools/lib/bundle.ts";

let ok = true;
function check(name: string, condition: boolean) {
  console.log(`${condition ? "PASS" : "FAIL"} ${name}`);
  ok &&= condition;
}
const root = await Deno.makeTempDir({ prefix: "bl-cohort-test-" });
async function writeRun(group: string, seed: number, opts: { valid?: boolean; provenance?: boolean; poison?: boolean; complete?: boolean } = {}) {
  const presetId = "spots";
  const spec: RunSpec = { experiment: group, presetId, condition: "neutral", seed, steps: 200, censusEvery: 100, deepEvery: 2, checkpointEvery: 0 };
  const cfg = specConfig(spec);
  const preset = PRESETS.find((p) => p.id === presetId)!;
  const dir = `${root}/${group}/neutral/seed-${seed}`;
  await Deno.mkdir(dir, { recursive: true });
  await Deno.writeTextFile(`${dir}/manifest.json`, JSON.stringify({
    spec, cfg, ruleVersion: cfg.ruleVersion, schemaVersion: SCHEMA_VERSION, metricsVersion: METRICS_VERSION,
    ...(opts.complete === false ? {} : { summary: { steps: 200, conservationOk: opts.valid !== false } }),
    ...(opts.provenance === false ? {} : { presetIdentity: presetIdentity(preset), init: preset.init, initHash: stateHash(initWorld(cfg, preset.init)) }),
  }));
  await Deno.writeTextFile(`${dir}/series.jsonl`, '{"step":100}\n{"step":200}\n');
  await Deno.writeTextFile(`${dir}/lineages.tsv`, opts.poison
    ? 'step\tlineage\tcells\n200\taaaa\t2\n100\taaaa\t2\n'
    : 'step\tlineage\tcells\n100\taaaa\t2\n200\taaaa\t2\n');
}
try {
  // The excluded seed stays reserved, but its missing provenance and corrupt
  // lineage history do not invalidate registered analysis. Calibration's
  // stricter provenance policy must still reject that very same history.
  await writeRun("policies", 3);
  await writeRun("policies", 1);
  await writeRun("policies", 2, { valid: false, provenance: false, poison: true });
  await writeRun("policies", 4, { complete: false, poison: true });
  const analysis = await prepareCohort(`${root}/policies`, { kind: "analysis", registeredPresets: ["spots"] });
  check("registered analysis excludes conservation failure before provenance", analysis.ok);
  if (analysis.ok) {
    check("excluded seed remains in completed cohort evidence", analysis.loaded.length === 3 && analysis.loaded.some((r) => r.seed === 2));
    check("incomplete seed is not treated as completed evidence", !analysis.loaded.some((r) => r.seed === 4));
    check("only eligible histories contribute pooled activities", analysis.runs.length === 2 && analysis.invalid[0]?.seed === 2 && analysis.neutralActivities.length === 2);
  }
  const calibration = await prepareCohort(`${root}/policies`, { kind: "calibration", presetId: "spots" });
  check("calibration requires provenance even for conservation exclusions", !calibration.ok && calibration.issue.kind === "provenance");

  await writeRun("legacy", 1, { provenance: false });
  const exploratory = await prepareCohort(`${root}/legacy`, { kind: "analysis", registeredPresets: [] });
  check("exploratory analysis still accepts legacy provenance", exploratory.ok);
  const registered = await prepareCohort(`${root}/legacy`, { kind: "analysis", registeredPresets: ["spots"] });
  check("registered analysis still refuses legacy provenance", !registered.ok && registered.issue.kind === "provenance");

  await writeRun("small", 1, { poison: true });
  const insufficient = await prepareCohort(`${root}/small`, { kind: "calibration", presetId: "spots" });
  check("insufficient pilot is refused before replay", !insufficient.ok && insufficient.issue.kind === "insufficient" && insufficient.issue.count === 1);

  await writeRun("sorted", 3);
  await writeRun("sorted", 1);
  await writeRun("sorted", 2);
  const sorted = await prepareCohort(`${root}/sorted`, { kind: "calibration", presetId: "spots" });
  check("calibration retains per-run activities in deterministic seed order", sorted.ok && JSON.stringify(sorted.neutralActivities.map((r) => r.seed)) === "[1,2,3]" && sorted.neutralActivities.every((r) => r.activities.length === 1));
} finally {
  await Deno.remove(root, { recursive: true });
}
Deno.exit(ok ? 0 : 1);
