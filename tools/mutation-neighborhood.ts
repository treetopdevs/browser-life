// Plan-only by default; writes one explicit, reproducible manifest and runs no
// simulation. An opt-in small GPU pilot assays parent and mutant separately in
// the same tile slots under the same seed (mutRate: 0 in evaluateBatch).
//
//   deno run -A tools/mutation-neighborhood.ts --out runs/foundations/mutations.json
//   deno run -A tools/mutation-neighborhood.ts --out runs/foundations/pilot.json --pilot 2
//     [--samples 16] [--draw-seed 610000001] [--assay-seed 620000001]
import { parseArgs } from "jsr:@std/cli@1/parse-args";
import { requestDevice } from "@bl/sim-gpu";
import { METRICS_VERSION, DEFAULT_RULE_VERSION, SCHEMA_VERSION } from "@bl/schema";
import { DEFAULT_EVAL, evaluateBatch, quality, type EvalConfig, type Evaluation } from "@bl/search";
import { compareBehaviorTraces, type BehaviorComparison, type BehaviorSample } from "../packages/search/src/foundation-behavior.ts";
import {
  ASSAY_SEED_RESERVATION, ASSAY_SMOKE_START, DRAW_SEED_RESERVATION,
  genomeFromManifest, mutationNeighborhood, selectPilotProposals,
} from "../packages/search/src/mutation-neighborhood.ts";

const args = parseArgs(Deno.args, {
  string: ["out", "samples", "draw-seed", "assay-seed", "pilot"], boolean: ["smoke", "behavior-trace"],
  default: { out: "runs/foundations/mutation-neighborhood.json", samples: "16", "draw-seed": String(DRAW_SEED_RESERVATION[0]), pilot: "0", smoke: false, "behavior-trace": false },
});
const integer = (name: "samples" | "draw-seed" | "assay-seed" | "pilot") => {
  const raw = args[name];
  if (typeof raw !== "string" || !/^\d+$/.test(raw)) throw new Error(`--${name} must be a nonnegative integer`);
  const n = Number(raw);
  if (!Number.isSafeInteger(n)) throw new Error(`--${name} is outside the safe integer range`);
  return n;
};
const samples = integer("samples"), drawSeed = integer("draw-seed");
const assaySeed = args["assay-seed"] === undefined ? (args.smoke ? ASSAY_SMOKE_START : ASSAY_SEED_RESERVATION[0]) : integer("assay-seed");
const pilotCount = integer("pilot");
const out = args.out;
try {
  await Deno.lstat(out);
  throw new Error(`output already exists: ${out}`);
} catch (error) {
  if (!(error instanceof Deno.errors.NotFound)) throw error;
}
if (pilotCount > 4) throw new Error("--pilot must be in 0..4; use a separate reviewed plan for a larger assay");
if (args.smoke && pilotCount !== 1) throw new Error("--smoke requires --pilot 1");
if (args["behavior-trace"] && pilotCount === 0) throw new Error("--behavior-trace requires --pilot 1..4");
if (assaySeed < (args.smoke ? ASSAY_SMOKE_START : ASSAY_SEED_RESERVATION[0]) ||
    assaySeed + Math.max(0, pilotCount - 1) > (args.smoke ? ASSAY_SEED_RESERVATION[1] : ASSAY_SMOKE_START - 1))
  throw new Error(`--assay-seed is outside the ${args.smoke ? "integration smoke" : "exploratory assay"} reservation`);
const neighborhood = mutationNeighborhood(drawSeed, samples);
const selected = selectPilotProposals(neighborhood, pilotCount);

const smokeEval: EvalConfig = {
  ...DEFAULT_EVAL, tile: 32, side: 2, reps: 1,
  growSteps: 16, recoverSteps: 16, darkSteps: 16, censusEvery: 8,
};
const evalTemplate = args.smoke ? smokeEval : DEFAULT_EVAL;
const sourceFiles = [
  "packages/schema/src/config.ts",
  "packages/schema/src/founders.ts",
  "packages/schema/src/genome.ts",
  "packages/schema/src/layout.ts",
  "packages/sim-ref/src/step.ts",
  "packages/sim-gpu/src/gpu-sim.ts",
  "packages/sim-gpu/src/shaders.ts",
  "packages/metrics/src/census.ts",
  "packages/metrics/src/ecology.ts",
  "packages/metrics/src/tracker.ts",
  "packages/search/src/evaluate.ts",
  "packages/search/src/foundation-behavior.ts",
  "packages/search/src/mutation-neighborhood.ts",
  "tools/mutation-neighborhood.ts",
];
const selectedSourceSha256: Record<string, string> = {};
for (const path of sourceFiles) {
  const bytes = await Deno.readFile(new URL(`../${path}`, import.meta.url));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource));
  selectedSourceSha256[path] = Array.from(digest, (x) => x.toString(16).padStart(2, "0")).join("");
}

interface PilotResult {
  proposalId: string;
  founderIndex: number;
  scale: number;
  seed: number;
  evalConfig: EvalConfig;
  matchedOn: string;
  parent: Evaluation;
  mutant: Evaluation;
  qualityDifference: number;
  behavior?: {
    source: string;
    schedule: { phase: "growth"; censusEvery: number; expectedSteps: number[]; replicateTiles: number[] };
    parent: BehaviorSample[];
    mutant: BehaviorSample[];
    pairedComparison: BehaviorComparison[];
    exactParentRepeat: { evaluation: Evaluation; trace: BehaviorSample[]; evaluationIdentical: boolean; traceIdentical: boolean };
  };
}
const results: PilotResult[] = [];
const manifest = {
  schema: "mutation-neighborhood/v1",
  versions: { rule: DEFAULT_RULE_VERSION, schema: SCHEMA_VERSION, metrics: METRICS_VERSION },
  sourceIdentity: {
    implementationBaseRevision: "c362d92ae560e64edf21f39113c8b6e2fc4c3b7b",
    revisionNote: "historical implementation base, not the runtime revision; investigation worktree may contain uncommitted changes",
    hashScope: "selected source files only; not a complete dependency closure",
    selectedSourceSha256,
  },
  purpose: "exploratory one-step mutational neighborhood; no M4 gate or strict probability claim",
  mode: args.smoke ? "pipeline-smoke" : pilotCount ? "bounded-pilot" : "plan-only",
  method: {
    mutation: "packages/sim-ref/src/step.ts mutateInPlace, one packed cell per independent parent proposal",
    rawDraws: "draw(lowbias32(drawSeed XOR founder/scale salts), 2*sampleIndex and 2*sampleIndex+1)",
    samplingCondition: "conditional on a mutation event; mutation-event frequency is not estimated here",
    noResampling: true,
    pilot: args.smoke ? "short pipeline check; changed tile, steps and reps; no biological inference" : pilotCount ? "evaluateBatch singleton parent and mutant assays, DEFAULT_EVAL with seed changed only; evaluator forces mutRate=0" : "none",
    interpretation: "pilot differences are descriptive; small replicate counts do not establish probability gates; smoke results test the pipeline only",
    behaviorTrace: args["behavior-trace"]
      ? "growth-only snapshots at each censusEvery step and final partial interval; roles are fixed-class labels from last-step flux, not new functions"
      : "not requested",
  },
  seedReservations: {
    mutationDraws: DRAW_SEED_RESERVATION,
    assays: [ASSAY_SEED_RESERVATION[0], ASSAY_SMOKE_START - 1],
    integrationSmoke: [ASSAY_SMOKE_START, ASSAY_SEED_RESERVATION[1]],
    plannedPilotSeeds: selected.map((_, i) => assaySeed + i),
  },
  evaluator: pilotCount ? evalTemplate : null,
  measurementStatus: {
    supportedByEvaluator: ["survival", "lesion recovery", "light dependence", "individual count", "mean individual mass", "speed", "mass", "reproduction events",
      ...(args["behavior-trace"] ? ["growth-census fixed-role fractions", "effective fixed-role diversity", "biomass, polymer and membrane fraction", "tracked component movement"] : [])],
    unsupportedByEvaluator: [...(args["behavior-trace"] ? [] : ["growth-census role fractions"]), "novel functions", "functional organization traits", "heritable role transitions", "long-run lineage persistence"],
    note: "No unsupported trait is inferred from mass, quality, or another surrogate.",
  },
  neighborhood,
  pilot: { requested: pilotCount, selectedProposalIds: selected.map((p) => p.id), results },
  runtimeGpu: { status: "not-requested" as string, vendor: null as string | null, architecture: null as string | null,
    device: null as string | null, description: null as string | null },
  execution: { status: (pilotCount ? "planned" : "plan-only") as string, completedPairs: 0, error: null as string | null },
};
const persist = () => Deno.writeTextFile(out, JSON.stringify(manifest, null, 2) + "\n");
await Deno.mkdir(new URL(".", new URL(out, `file://${Deno.cwd()}/`)), { recursive: true });
await Deno.writeTextFile(out, JSON.stringify(manifest, null, 2) + "\n", { createNew: true });
if (selected.length) {
  manifest.execution.status = "running";
  await persist();
  try {
    if (Deno.env.get("BL_MUTATION_TEST_FAIL_AFTER_RESERVE") === "1") throw new Error("injected failure after manifest reservation");
    const device = await requestDevice(navigator.gpu);
    try {
      const info = (device as GPUDevice & { adapterInfo?: GPUAdapterInfo }).adapterInfo;
      manifest.runtimeGpu = { status: info ? "available" : "unavailable", vendor: info?.vendor || null,
        architecture: info?.architecture || null, device: info?.device || null, description: info?.description || null };
      await persist();
      for (const [i, row] of selected.entries()) {
        const seed = assaySeed + i;
        const ec = { ...evalTemplate, seed };
        const parent = genomeFromManifest(neighborhood.founders[row.founderIndex].genome);
        const mutant = genomeFromManifest(row.genome);
        const parentTrace: BehaviorSample[] = [], mutantTrace: BehaviorSample[] = [];
        // A singleton batch always occupies tiles 0..reps-1. Running the pair
        // with the same seed matches tile coordinates and counter-based draws.
        const [parentEval] = await evaluateBatch(device, [parent], ec,
          args["behavior-trace"] ? { onBehaviorSample: (_k, _tile, sample) => parentTrace.push(sample) } : undefined);
        const [mutantEval] = await evaluateBatch(device, [mutant], ec,
          args["behavior-trace"] ? { onBehaviorSample: (_k, _tile, sample) => mutantTrace.push(sample) } : undefined);
        let behavior: PilotResult["behavior"];
        if (args["behavior-trace"]) {
          const repeatTrace: BehaviorSample[] = [];
          const [repeatEval] = await evaluateBatch(device, [parent], ec,
            { onBehaviorSample: (_k, _tile, sample) => repeatTrace.push(sample) });
          behavior = { source: "growth-only coherent GPU snapshots; role counters report the last simulation step",
            schedule: { phase: "growth", censusEvery: ec.censusEvery,
              expectedSteps: Array.from({ length: Math.ceil(ec.growSteps / ec.censusEvery) }, (_, k) => Math.min(ec.growSteps, (k + 1) * ec.censusEvery)),
              replicateTiles: Array.from({ length: ec.reps }, (_, t) => t) },
            parent: parentTrace, mutant: mutantTrace, pairedComparison: compareBehaviorTraces(parentTrace, mutantTrace),
            exactParentRepeat: { evaluation: repeatEval, trace: repeatTrace,
              evaluationIdentical: JSON.stringify(repeatEval) === JSON.stringify(parentEval),
              traceIdentical: JSON.stringify(repeatTrace) === JSON.stringify(parentTrace) } };
        }
        results.push({ proposalId: row.id, founderIndex: row.founderIndex, scale: row.scale, seed, evalConfig: ec,
          matchedOn: "same world seed, tile slots 0..reps-1, and evaluator config; independent singleton calls",
          parent: parentEval, mutant: mutantEval,
          qualityDifference: quality(mutantEval) - quality(parentEval), ...(behavior ? { behavior } : {}) });
        manifest.execution.completedPairs = results.length;
        await persist();
        if (behavior && (!behavior.exactParentRepeat.evaluationIdentical || !behavior.exactParentRepeat.traceIdentical))
          throw new Error(`exact-parent repeatability control failed for ${row.id}`);
        console.log(`paired pilot ${i + 1}/${selected.length}: ${row.id}, seed ${seed}`);
      }
    } finally {
      device.destroy();
    }
    manifest.execution.status = "completed";
    await persist();
  } catch (error) {
    manifest.execution.status = "failed";
    manifest.execution.error = error instanceof Error ? error.message : String(error);
    await persist();
    throw error;
  }
}
console.log(`wrote ${out}: ${neighborhood.counts.proposals} proposals, ${neighborhood.counts.unchangedAfterClamp} unchanged, ${neighborhood.counts.duplicateResults} duplicate results; ${results.length} paired assays`);
