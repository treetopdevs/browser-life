// Deterministic mutation screen plan, with separately bounded opt-in execution.
// Plan only:
//   deno run -A tools/foundation-screen.ts --out runs/foundations/screen-plan.json --samples 200
// Bounded execution from that exact fresh plan (no validation seeds used):
//   deno run -A tools/foundation-screen.ts --execute --plan runs/foundations/screen-plan.json \
//     --out runs/foundations/screen-chunk.json --batch-start 0 --max-batches 1 --max-seconds 120
import { parseArgs } from "jsr:@std/cli@1/parse-args";
import { METRICS_VERSION, RULE_VERSION, SCHEMA_VERSION } from "@bl/schema";
import { requestDevice } from "@bl/sim-gpu";
import { evaluateBatch } from "@bl/search";
import { mutationNeighborhood } from "../packages/search/src/mutation-neighborhood.ts";
import { buildScreenPlan, executeScreenBatch, screenCompletionStatus, SCREEN_SEED_START, type ScreenPlan,
  type ScreenBatchResult, type BeforeEvaluatorCall } from "./lib/foundation-screen.ts";

const a = parseArgs(Deno.args, {
  string: ["out", "samples", "draw-seed", "screen-seed", "plan", "batch-start", "max-batches", "max-seconds"],
  boolean: ["execute"],
  default: { samples: "200", "draw-seed": "610000001", "screen-seed": String(SCREEN_SEED_START), "batch-start": "0", execute: false },
});
const int = (name: "samples" | "draw-seed" | "screen-seed" | "batch-start" | "max-batches") => {
  const raw = a[name];
  if (typeof raw !== "string" || !/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)))
    throw new Error(`--${name} must be a nonnegative safe integer`);
  return Number(raw);
};
const seconds = () => {
  const raw = a["max-seconds"];
  if (typeof raw !== "string" || !/^(?:\d+)(?:\.\d+)?$/.test(raw)) throw new Error("--max-seconds must be a positive number");
  const n = Number(raw);
  if (!(n > 0 && n <= 600)) throw new Error("--max-seconds must be in (0,600]");
  return n;
};
if (!a.out) throw new Error("--out <new manifest path> is required");
const out = a.out;
try {
  await Deno.lstat(out);
  throw new Error(`output already exists: ${out}`);
} catch (error) { if (!(error instanceof Deno.errors.NotFound)) throw error; }
if (a.execute && !a.plan) throw new Error("--execute requires an existing --plan manifest");
if (!a.execute && a.plan) throw new Error("--plan is only used with --execute");

const selectedFiles = [
  "packages/schema/src/config.ts", "packages/schema/src/founders.ts", "packages/schema/src/genome.ts", "packages/schema/src/layout.ts",
  "packages/sim-ref/src/step.ts", "packages/sim-gpu/src/gpu-sim.ts", "packages/sim-gpu/src/shaders.ts",
  "packages/metrics/src/census.ts", "packages/metrics/src/ecology.ts", "packages/metrics/src/tracker.ts",
  "packages/search/src/evaluate.ts", "packages/search/src/foundation-behavior.ts", "packages/search/src/mutation-neighborhood.ts",
  "tools/lib/foundation-screen.ts", "tools/foundation-screen.ts",
];
const hex = (bytes: Uint8Array) => Array.from(bytes, (x) => x.toString(16).padStart(2, "0")).join("");
const sha = async (bytes: Uint8Array) => hex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource)));
const sourceHashes = async () => Object.fromEntries(await Promise.all(selectedFiles.map(async (path) =>
  [path, await sha(await Deno.readFile(new URL(`../${path}`, import.meta.url)))] as const)));
const source = {
  versions: { rule: RULE_VERSION, schema: SCHEMA_VERSION, metrics: METRICS_VERSION },
  hashScope: "selected source files only; not a complete dependency closure",
  selectedSourceSha256: await sourceHashes(),
};
const writeNew = async (value: unknown) => {
  await Deno.mkdir(new URL(".", new URL(out, `file://${Deno.cwd()}/`)), { recursive: true });
  await Deno.writeTextFile(out, JSON.stringify(value, null, 2) + "\n", { createNew: true });
};
const persist = (value: unknown) => Deno.writeTextFile(out, JSON.stringify(value, null, 2) + "\n");

if (!a.execute) {
  const plan = buildScreenPlan(mutationNeighborhood(int("draw-seed"), int("samples")), int("screen-seed"));
  const manifest = { format: "foundation-screen-plan/v1", status: "planned", sourceIdentity: source,
    explicitLimitations: ["Low-replicate screen is exploratory and cannot pass a strict probability gate.",
      "Fixed role classes and their changes do not establish novel functions.", "Validation seed range is reserved and unused."], plan };
  await writeNew(manifest);
  console.log(`planned ${plan.coverage.proposals} proposals in ${plan.batches.length} batches at ${out}; no GPU requested`);
} else {
  const maxBatches = int("max-batches"), maxSeconds = seconds(), batchStart = int("batch-start");
  if (!(maxBatches >= 1 && maxBatches <= 8)) throw new Error("--max-batches must be in 1..8");
  const planBytes = await Deno.readFile(a.plan!);
  const saved = JSON.parse(new TextDecoder().decode(planBytes)) as { format?: string; status?: string; sourceIdentity?: typeof source; plan?: ScreenPlan };
  if (saved.format !== "foundation-screen-plan/v1" || saved.status !== "planned" || !saved.plan ||
      saved.plan.schema !== "foundation-screen-plan/v1") throw new Error("source plan is not a fresh foundation screen plan");
  if (JSON.stringify(saved.sourceIdentity) !== JSON.stringify(source)) throw new Error("source plan code or versions differ from this checkout");
  const plan = saved.plan;
  const expectedPlan = buildScreenPlan(mutationNeighborhood(plan.neighborhood.drawSeed,
    plan.neighborhood.samplesPerFounderPerScale), plan.seeds.screen[0]);
  if (JSON.stringify(expectedPlan) !== JSON.stringify(plan)) throw new Error("source plan differs from deterministic sampler output");
  if (batchStart >= plan.batches.length) throw new Error("--batch-start exceeds planned batches");
  const selected = plan.batches.slice(batchStart, batchStart + maxBatches);
  const report = {
    format: "foundation-screen-execution/v1", status: "planned", sourceIdentity: source,
    sourcePlan: { path: a.plan, sha256: await sha(planBytes) },
    design: { nesting: "proposals nested in founder×scale strata; batch seed is an assay condition, not an independent history",
      matchedPositions: "parent and mutant lists use identical candidate indices and tile slots in separate evaluateBatch calls",
      mutation: "off during evaluator assay", roles: "fixed four-class last-step flux observer; not novelty",
      validation: "reserved but not used; no probability-gate claim" },
    budget: { batchStart, maxBatches, maxSeconds, selectedBatchIndices: selected.map((b) => b.index) },
    runtime: { deno: Deno.version, build: Deno.build,
      gpu: { status: "not-requested", vendor: null as string | null, architecture: null as string | null,
        device: null as string | null, description: null as string | null } },
    execution: { completedBatches: 0, completedProposals: 0, elapsedSeconds: 0, overrunSeconds: 0,
      incompleteBatch: null as null | { index: number; stage: string }, error: null as string | null },
    results: [] as ScreenBatchResult[],
  };
  await writeNew(report); // reserve before requesting GPU
  const started = performance.now();
  const elapsed = () => (performance.now() - started) / 1000;
  class BudgetStop extends Error { constructor(readonly stage: string) { super(`time budget reached before ${stage} evaluator call`); } }
  let device: GPUDevice | null = null;
  try {
    report.status = "running";
    await persist(report);
    device = await requestDevice(navigator.gpu);
    const info = (device as GPUDevice & { adapterInfo?: GPUAdapterInfo }).adapterInfo;
    report.runtime.gpu = { status: info ? "available" : "unavailable", vendor: info?.vendor || null,
      architecture: info?.architecture || null, device: info?.device || null, description: info?.description || null };
    await persist(report);
    for (const batch of selected) {
      const beforeCall: BeforeEvaluatorCall = (stage) => {
        if (elapsed() >= maxSeconds) throw new BudgetStop(stage);
      };
      try {
        const result = await executeScreenBatch(plan, batch,
          (genomes, ec, onSample) => evaluateBatch(device!, genomes, ec, { onBehaviorSample: onSample }),
          beforeCall, batch.index === selected[0].index);
        report.results.push(result);
        report.execution.completedBatches++;
        report.execution.completedProposals += result.rows.length;
        report.execution.elapsedSeconds = elapsed();
        report.execution.overrunSeconds = Math.max(0, report.execution.elapsedSeconds - maxSeconds);
        await persist(report);
        console.log(`screen batch ${batch.index}: ${result.rows.length} proposals, ${result.cacheHits} exact cache hits`);
      } catch (error) {
        if (error instanceof BudgetStop) {
          report.execution.incompleteBatch = { index: batch.index, stage: error.stage };
          break;
        }
        throw error;
      }
      if (elapsed() >= maxSeconds) break;
    }
    report.execution.elapsedSeconds = elapsed();
    report.execution.overrunSeconds = Math.max(0, report.execution.elapsedSeconds - maxSeconds);
    report.status = screenCompletionStatus(report.execution.completedBatches, plan.batches.length,
      batchStart, report.execution.elapsedSeconds, maxSeconds);
    if (JSON.stringify(await sourceHashes()) !== JSON.stringify(source.selectedSourceSha256))
      throw new Error("selected source files changed during screen execution");
    await persist(report);
  } catch (error) {
    report.status = "failed";
    report.execution.error = error instanceof Error ? error.message : String(error);
    report.execution.elapsedSeconds = elapsed();
    report.execution.overrunSeconds = Math.max(0, report.execution.elapsedSeconds - maxSeconds);
    await persist(report);
    throw error;
  } finally { device?.destroy(); }
  console.log(`${report.status}: ${report.execution.completedBatches}/${plan.batches.length} planned batches, ${report.execution.elapsedSeconds.toFixed(1)}s`);
}
