// tools/analyze.ts's metapopulation refusal (see its own "ringed seeds are
// not independent replicates" comment): a ring's seeds exchange matter and
// genomes at every segment boundary, so pooling them as independent
// replicates the way every ensemble statistic does would silently misrepresent
// one ring's degrees of freedom. This is a coverage gap review P2 flagged --
// small, hand-written synthetic bundles (no GPU run needed: the refusal fires
// from manifest.json alone, before any physics-derived statistic is touched).
//
// Run from the repo root: deno run -A tests/deno/analyze.ts
import { METRICS_VERSION, RULE_VERSION, SCHEMA_VERSION } from "@bl/schema";
import { specConfig, type RunSpec } from "@bl/runner";

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
// an unrelated reason.
async function writeRun(experiment: string, presetId: string, spec: RunSpec) {
  const cfg = specConfig(spec);
  const dir = `${root}/${experiment}/${presetId}/${spec.condition}/seed-${spec.seed}`;
  await Deno.mkdir(dir, { recursive: true });
  const steps = spec.steps;
  const censusEvery = spec.censusEvery;
  const nCensus = Math.ceil(steps / censusEvery);
  const series = Array.from({ length: nCensus }, (_, i) => ({ step: Math.min((i + 1) * censusEvery, steps) }));
  const manifest = {
    spec,
    cfg,
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
}

async function runAnalyze(runRoot: string): Promise<{ code: number; stderr: string }> {
  const cmd = new Deno.Command(Deno.execPath(), {
    args: ["run", "-A", "tools/analyze.ts", runRoot],
    stdout: "null",
    stderr: "piped",
  });
  const { code, stderr } = await cmd.output();
  return { code, stderr: new TextDecoder().decode(stderr) };
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

await Deno.remove(root, { recursive: true });
Deno.exit(ok ? 0 : 1);
