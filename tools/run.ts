// Headless experiment runner on native WebGPU (Deno + wgpu).
//
//   deno run -A tools/run.ts --experiment pilot --preset spots --conditions treatment,neutral \
//     --seeds 1-3 --steps 50000 --census 100 [--deep 10] [--checkpoint 0] [--out runs] [--threshold N]
//     [--lineage-obs] [--solo-founder K | --solo-genome HEX | --founder-set HEX,HEX,...] [--pre-cycle B,B,...]
//     [--override mutRate=0,pondDeath=65536] [--branch-from DIR --branch-boundary B]
//
// --lineage-obs adds the foundations-review observer files (RunSpec.lineageObs); --solo-founder K
// founds an m3 preset from M3 founder K alone (RunSpec.soloFounder), --solo-genome from a genome given
// as genomes.tsv hex words (RunSpec.soloGenome), --founder-set from a comma-separated list of those
// hexes cycled across founder discs (RunSpec.founderSet). --pre-cycle 34,100 (pond presets) also
// writes the state before each listed boundary's cycle to checkpoints/b<NNN>-pre.blck, with its hash
// in the manifest (RunSpec.preCycleCheckpoints); without it the bundle is as before.
//
// --override sets RunSpec.overrides from a comma list of key=integer, the keys mutRate and pondDeath only: the
// transition hunt's D3 runs (--override mutRate=0) and G1 fallback (e = 1, --override pondDeath=65536, for the
// conditions pond-nat and pond-shuf, whose own pondDeath it replaces). Without it the spec has no overrides.
// --branch-from DIR --branch-boundary B (both, with --conditions pond-nat or pond-shuf) starts each run from the
// pre-cycle checkpoint of boundary B in the bundle at DIR (its manifest's preCycleCheckpoints entry, whose hash the
// file must match) and applies that boundary's transform under the run's own seed first (RunSpec.branch, the hunt's
// "Branch contract"); --steps then counts from the source's step, and --pre-cycle may list only boundaries after B.
// Every seed of the invocation branches from the same source.
//
// Each (condition, seed) history writes a bundle to <out>/<experiment>/<preset>/<condition>/seed-<n>/.
import { parseArgs } from "jsr:@std/cli@1/parse-args";
import { validateConfig, type WorldState } from "@bl/schema";
import { requestDevice } from "@bl/sim-gpu";
import { branchError, parseOverrides, preCycleError, runExperiment, runId, sameCompletedRun, specConfig, validateSpec, type BranchSpec, type RunSpec, type Sink } from "@bl/runner";
import { branchFlagsError, branchSource } from "./lib/branch-source.ts";

const a = parseArgs(Deno.args, {
  string: ["experiment", "preset", "conditions", "seeds", "out", "steps", "census", "deep", "checkpoint", "threshold", "solo-founder", "solo-genome", "founder-set", "pre-cycle", "override", "branch-from", "branch-boundary"],
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

const unpaired = branchFlagsError(a["branch-from"], a["branch-boundary"]);
if (unpaired) {
  console.error(unpaired);
  Deno.exit(2);
}
let overrides: RunSpec["overrides"];
let source: { branch: BranchSpec; state: WorldState } | undefined;
try {
  if (a.override !== undefined) overrides = parseOverrides(a.override);
  if (a["branch-from"] !== undefined) source = await branchSource(a["branch-from"], Number(a["branch-boundary"]));
} catch (e) {
  console.error((e as Error).message);
  Deno.exit(2);
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
      ...(a["pre-cycle"] !== undefined ? { preCycleCheckpoints: a["pre-cycle"].split(",").map((b) => Number(b.trim())) } : {}),
      ...(overrides !== undefined ? { overrides } : {}),
      ...(source ? { branch: source.branch } : {}),
    });

for (const spec of specs) {
  const errs = validateSpec(spec);
  if (errs.length) {
    console.error(`invalid spec for ${runId(spec)}: ${errs.join("; ")}`);
    Deno.exit(2);
  }
  const cfg = specConfig(spec); // throws for unsupported preset/condition combinations
  const cfgErrs = validateConfig(cfg); // e.g. --override pondDeath on an arm other than nat and shuf
  if (cfgErrs.length) {
    console.error(`invalid spec for ${runId(spec)}: ${cfgErrs.join("; ")}`);
    Deno.exit(2);
  }
  const branchBad = branchError(spec, cfg, { branchFrom: source?.state });
  if (branchBad) {
    console.error(`invalid spec for ${runId(spec)}: ${branchBad}`);
    Deno.exit(2);
  }
  const preCycleBad = preCycleError(spec, cfg, source?.state.step ?? 0); // every run here starts from its preset at step 0, or a branch from its source's step
  if (preCycleBad) {
    console.error(`invalid spec for ${runId(spec)}: ${preCycleBad}`);
    Deno.exit(2);
  }
}
const device = await requestDevice(navigator.gpu, specConfig(specs[0]));
for (const spec of specs) {
  const dir = `${a.out}/${runId(spec)}`;
  try {
    const done = JSON.parse(await Deno.readTextFile(`${dir}/manifest.json`));
    const same = sameCompletedRun(done, spec);
    if (!same) {
      console.error(`refusing to reuse ${dir}: it holds a run with a different spec (a different branch included), config or rule version; choose a new --experiment name`);
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
  const { summary } = await runExperiment(device, spec, fsSink(dir), { host: `deno ${Deno.version.deno} ${Deno.build.os}-${Deno.build.arch}`, adapter: adapterDesc }, (m) => console.log(`  ${m}`), {
    branchFrom: source?.state,
  });
  console.log(`  done: ${summary.stepsPerSecond.toFixed(0)} st/s, ${summary.finalIndividuals} individuals, ${summary.finalLineages} lineages, conservation ${summary.conservationOk ? "exact" : "VIOLATED"}`);
}
