// Headless experiment runner on native WebGPU (Deno + wgpu).
//
//   deno run -A tools/run.ts --experiment pilot --preset spots --conditions treatment,neutral \
//     --seeds 1-3 --steps 50000 --census 100 [--deep 10] [--checkpoint 0] [--out runs] [--threshold N]
//     [--lineage-obs] [--solo-founder K | --solo-genome HEX | --founder-set HEX,HEX,...]
//
// --lineage-obs adds the foundations-review observer files (RunSpec.lineageObs); --solo-founder K
// founds an m3 preset from M3 founder K alone (RunSpec.soloFounder), --solo-genome from a genome given
// as genomes.tsv hex words (RunSpec.soloGenome), --founder-set from a comma-separated list of those
// hexes cycled across founder discs (RunSpec.founderSet).
//
// Each (condition, seed) history writes a bundle to <out>/<experiment>/<preset>/<condition>/seed-<n>/.
import { parseArgs } from "jsr:@std/cli@1/parse-args";
import { requestDevice } from "@bl/sim-gpu";
import { runExperiment, runId, sameCompletedRun, specConfig, validateSpec, type RunSpec, type Sink } from "@bl/runner";

const a = parseArgs(Deno.args, {
  string: ["experiment", "preset", "conditions", "seeds", "out", "steps", "census", "deep", "checkpoint", "threshold", "solo-founder", "solo-genome", "founder-set"],
  boolean: ["lineage-obs"],
  default: { experiment: "pilot", preset: "spots", conditions: "treatment", seeds: "1", out: "runs", steps: "20000", census: "100", deep: "10", checkpoint: "0" },
});

function seeds(s: string): number[] {
  return s.split(",").flatMap((part) => {
    const [lo, hi] = part.split("-").map(Number);
    return hi === undefined ? [lo] : Array.from({ length: hi - lo + 1 }, (_, k) => lo + k);
  });
}

function fsSink(dir: string): Sink {
  const p = (f: string) => `${dir}/${f}`;
  return {
    async writeText(f, t) {
      await Deno.mkdir(p(f).replace(/\/[^/]+$/, ""), { recursive: true });
      await Deno.writeTextFile(p(f), t);
    },
    async appendText(f, t) {
      await Deno.writeTextFile(p(f), t, { append: true });
    },
    async writeBytes(f, b) {
      await Deno.mkdir(p(f).replace(/\/[^/]+$/, ""), { recursive: true });
      await Deno.writeFile(p(f), b);
    },
  };
}

const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
const info = adapter?.info;
const adapterDesc = [info?.vendor, info?.architecture, info?.description].filter(Boolean).join(" ") || "unknown";
const specs: RunSpec[] = [];
for (const condition of a.conditions.split(","))
  for (const seed of seeds(a.seeds))
    specs.push({
      experiment: a.experiment,
      presetId: a.preset,
      condition,
      seed,
      steps: Number(a.steps),
      censusEvery: Number(a.census),
      deepEvery: Number(a.deep),
      checkpointEvery: Number(a.checkpoint),
      activityThreshold: a.threshold ? Number(a.threshold) : undefined,
      ...(a["lineage-obs"] ? { lineageObs: true } : {}),
      ...(a["solo-founder"] !== undefined ? { soloFounder: Number(a["solo-founder"]) } : {}),
      ...(a["solo-genome"] !== undefined ? { soloGenome: a["solo-genome"] } : {}),
      ...(a["founder-set"] !== undefined ? { founderSet: a["founder-set"].split(",").map((h) => h.trim()).filter(Boolean) } : {}),
    });

for (const spec of specs) {
  const errs = validateSpec(spec);
  if (errs.length) {
    console.error(`invalid spec for ${runId(spec)}: ${errs.join("; ")}`);
    Deno.exit(2);
  }
  specConfig(spec); // throws for unsupported preset/condition combinations
}
const device = await requestDevice(navigator.gpu, specConfig(specs[0]));
for (const spec of specs) {
  const dir = `${a.out}/${runId(spec)}`;
  try {
    const done = JSON.parse(await Deno.readTextFile(`${dir}/manifest.json`));
    const same = sameCompletedRun(done, spec);
    if (!same) {
      console.error(`refusing to reuse ${dir}: it holds a run with a different spec, config or rule version; choose a new --experiment name`);
      Deno.exit(2);
    }
    if (done.summary) {
      console.log(`skip ${runId(spec)} (complete, identical spec)`);
      continue;
    }
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) throw e;
  }
  console.log(`run ${runId(spec)} (${spec.steps} steps)`);
  const { summary } = await runExperiment(device, spec, fsSink(dir), { host: `deno ${Deno.version.deno} ${Deno.build.os}-${Deno.build.arch}`, adapter: adapterDesc }, (m) =>
    console.log(`  ${m}`),
  );
  console.log(`  done: ${summary.stepsPerSecond.toFixed(0)} st/s, ${summary.finalIndividuals} individuals, ${summary.finalLineages} lineages, conservation ${summary.conservationOk ? "exact" : "VIOLATED"}`);
}
