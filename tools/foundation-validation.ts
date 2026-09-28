// Prespecified mutation validation. Plan-only is the default; GPU use requires --execute.
// Plan: deno run -A tools/foundation-validation.ts --screen-plan runs/foundations/screen-plan-7200-v1.json \
//   --screen-report runs/foundations/screen-batch-0-v1.json --out runs/foundations/validation-plan.json
// Execute: deno run -A tools/foundation-validation.ts --execute --plan runs/foundations/validation-plan.json \
//   --seed-start-offset 0 --max-seeds 1 --max-seconds 120 --out runs/foundations/validation-seeds-0.json
// Analyze: deno run -A tools/foundation-validation.ts --analyze --plan runs/foundations/validation-plan.json \
//   --result runs/foundations/validation-seeds-0.json --out runs/foundations/validation-analysis.json
import { createHash } from "node:crypto";
import { dirname } from "node:path";
import { requestDevice } from "@bl/sim-gpu";
import { evaluateBatch } from "@bl/search";
import { mutationNeighborhood } from "../packages/search/src/mutation-neighborhood.ts";
import { buildScreenPlan, SCREEN_EVAL, type ScreenPlan } from "./lib/foundation-screen.ts";
import { analyzeValidation, collectScreenRows, executeValidationSeed, nominate, VALIDATION_SEEDS,
  type Nomination, type ScreenExecutionInput, type ValidationSeedResult } from "./lib/foundation-validation.ts";

type Mode = "plan" | "execute" | "analyze";
interface Args { mode: Mode; out: string; screenPlan?: string; screenReports: string[]; plan?: string;
  results: string[]; seedStartOffset?: number; maxSeeds?: number; maxSeconds?: number }
function parse(args: string[]): Args {
  const values = new Map<string, string[]>();
  let mode: Mode = "plan";
  for (let i = 0; i < args.length; i++) {
    const name = args[i];
    if (name === "--execute" || name === "--analyze") {
      if (mode !== "plan") throw new Error("choose only one mode");
      mode = name === "--execute" ? "execute" : "analyze";
      continue;
    }
    if (!name.startsWith("--") || !args[i + 1] || args[i + 1].startsWith("--")) throw new Error(`invalid option ${name}`);
    if (!["--out", "--screen-plan", "--screen-report", "--plan", "--result", "--seed-start-offset", "--max-seeds", "--max-seconds"].includes(name))
      throw new Error(`unknown option ${name}`);
    if (!["--screen-report", "--result"].includes(name) && values.has(name)) throw new Error(`duplicate option ${name}`);
    values.set(name, [...(values.get(name) ?? []), args[++i]]);
  }
  const one = (name: string) => values.get(name)?.[0];
  const integer = (name: string) => { const raw = one(name);
    if (raw === undefined) return undefined;
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw))) throw new Error(`${name} must be a nonnegative safe integer`);
    return Number(raw); };
  const out = one("--out");
  if (!out) throw new Error("--out <new path> is required");
  const screenPlan = one("--screen-plan"), screenReports = values.get("--screen-report") ?? [],
    plan = one("--plan"), results = values.get("--result") ?? [];
  const seedStartOffset = integer("--seed-start-offset"), maxSeeds = integer("--max-seeds");
  const rawSeconds = one("--max-seconds"), maxSeconds = rawSeconds === undefined ? undefined : Number(rawSeconds);
  if (mode === "plan" && (!screenPlan || !screenReports.length || plan || results.length || seedStartOffset !== undefined || maxSeeds !== undefined || maxSeconds !== undefined))
    throw new Error("plan-only requires --screen-plan and one or more --screen-report paths");
  if (mode === "execute" && (!plan || screenPlan || screenReports.length || results.length || seedStartOffset === undefined ||
      maxSeeds === undefined || maxSeconds === undefined || seedStartOffset > 31 || maxSeeds < 1 || maxSeeds > 8 ||
      !Number.isFinite(maxSeconds) || maxSeconds <= 0 || maxSeconds > 600))
    throw new Error("--execute requires --plan, --seed-start-offset 0..31, --max-seeds 1..8 and --max-seconds in (0,600]");
  if (mode === "analyze" && (!plan || !results.length || screenPlan || screenReports.length ||
      seedStartOffset !== undefined || maxSeeds !== undefined || maxSeconds !== undefined))
    throw new Error("--analyze requires --plan and one or more --result paths");
  return { mode, out, screenPlan, screenReports, plan, results, seedStartOffset, maxSeeds, maxSeconds };
}

interface Digest { sha256: string; bytes: number }
const digest = (bytes: Uint8Array): Digest => ({ sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length });
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const readJSON = async <T>(path: string): Promise<{ value: T; digest: Digest }> => {
  const bytes = await Deno.readFile(path);
  return { value: JSON.parse(new TextDecoder().decode(bytes)) as T, digest: digest(bytes) };
};
const codeFiles = ["tools/foundation-validation.ts", "tools/lib/foundation-validation.ts",
  "tools/foundation-screen.ts", "tools/lib/foundation-screen.ts",
  "packages/search/src/evaluate.ts", "packages/search/src/foundation-behavior.ts", "packages/search/src/mutation-neighborhood.ts",
  "packages/schema/src/config.ts", "packages/schema/src/genome.ts", "packages/schema/src/layout.ts",
  "packages/schema/src/founders.ts", "packages/schema/src/world.ts", "packages/schema/src/accounting.ts",
  "packages/metrics/src/stats.ts", "packages/metrics/src/census.ts", "packages/metrics/src/tracker.ts",
  "packages/metrics/src/ecology.ts", "packages/metrics/src/complexity.ts",
  "packages/sim-gpu/src/gpu-sim.ts", "packages/sim-gpu/src/shaders.ts"];
async function codeHashes(): Promise<Record<string, Digest>> {
  return Object.fromEntries(await Promise.all(codeFiles.map(async (path) => [path, digest(await Deno.readFile(path))] as const)));
}
async function screenCodeMatches(identity: { selectedSourceSha256?: Record<string, string> }): Promise<boolean> {
  if (!identity?.selectedSourceSha256 || !Object.keys(identity.selectedSourceSha256).length) return false;
  for (const [path, expected] of Object.entries(identity.selectedSourceSha256))
    if ((await readJSONOrBytes(path)).sha256 !== expected) return false;
  return true;
}
async function readJSONOrBytes(path: string) { return digest(await Deno.readFile(path)); }

interface ValidationPlanFile {
  format: "foundation-mutation-validation-plan/v1"; status: "planned";
  source: { screenPlan: { path: string; digest: Digest }; screenReports: { path: string; digest: Digest }[];
    screenCodeIdentity: unknown };
  validationCodeHashes: Record<string, Digest>;
  protocol: { salt: string; freshSeeds: number[]; evalTemplate: typeof SCREEN_EVAL; capacity: number;
    priority: string[]; inference: string };
  nomination: Nomination;
  limitations: string[];
}
async function sourceNomination(source: ValidationPlanFile["source"]): Promise<Nomination> {
  const saved = await readJSON<{ format: string; status: string; sourceIdentity: unknown; plan: ScreenPlan }>(source.screenPlan.path);
  if (!same(saved.digest, source.screenPlan.digest) || saved.value.format !== "foundation-screen-plan/v1" ||
      saved.value.status !== "planned" || !same(saved.value.sourceIdentity, source.screenCodeIdentity))
    throw new Error("screen plan bytes, status or code identity changed");
  const p = saved.value.plan;
  const rebuilt = buildScreenPlan(mutationNeighborhood(p.neighborhood.drawSeed, p.neighborhood.samplesPerFounderPerScale), p.seeds.screen[0]);
  if (!same(rebuilt, p)) throw new Error("screen plan differs from deterministic proposal generator");
  if (!await screenCodeMatches(saved.value.sourceIdentity as { selectedSourceSha256?: Record<string, string> }))
    throw new Error("screen source code differs from saved screen plan identity");
  const inputs: ScreenExecutionInput[] = [];
  for (const file of source.screenReports) {
    const report = await readJSON<ScreenExecutionInput>(file.path);
    if (!same(report.digest, file.digest)) throw new Error(`screen report bytes changed: ${file.path}`);
    inputs.push(report.value);
  }
  const collected = collectScreenRows(p, inputs, saved.digest.sha256, saved.value.sourceIdentity);
  return nominate(p, collected.rows, collected.batchCount);
}
async function loadPlan(path: string): Promise<{ plan: ValidationPlanFile; digest: Digest }> {
  const saved = await readJSON<ValidationPlanFile>(path);
  const p = saved.value;
  if (p.format !== "foundation-mutation-validation-plan/v1" || p.status !== "planned" ||
      !same(p.protocol.freshSeeds, VALIDATION_SEEDS) || !same(p.protocol.evalTemplate, SCREEN_EVAL) ||
      p.protocol.capacity !== 64 || p.nomination.candidates.length > 60 ||
      !same(await codeHashes(), p.validationCodeHashes) || !same(await sourceNomination(p.source), p.nomination))
    throw new Error("validation plan, source evidence or code identity changed");
  return { plan: p, digest: saved.digest };
}
async function reserve(path: string, value: unknown) {
  await Deno.mkdir(dirname(path), { recursive: true });
  await Deno.writeTextFile(path, JSON.stringify(value, null, 2) + "\n", { createNew: true });
}
async function main() {
  const a = parse(Deno.args);
  if (a.mode === "plan") {
    const screen = await readJSON<{ format: string; status: string; sourceIdentity: unknown; plan: ScreenPlan }>(a.screenPlan!);
    const source = { screenPlan: { path: a.screenPlan!, digest: screen.digest },
      screenReports: await Promise.all(a.screenReports.map(async (path) => ({ path, digest: digest(await Deno.readFile(path)) }))),
      screenCodeIdentity: screen.value.sourceIdentity };
    const nomination = await sourceNomination(source);
    const output: ValidationPlanFile = { format: "foundation-mutation-validation-plan/v1", status: "planned", source,
      validationCodeHashes: await codeHashes(),
      protocol: { salt: "foundation-mutation-validation-v1", freshSeeds: VALIDATION_SEEDS,
        evalTemplate: SCREEN_EVAL, capacity: 64, priority: ["role-shift-preserved", "changed-preserved", "observed-loss", "observed-unresponsive"],
        inference: "32 fresh seeds; six existing absolute probability gates; endpoint-specific paired harmful upper bounds only when all absolute gates pass; <=10ppt viability check uses survival harm" },
      nomination,
      limitations: ["Diagnostic nominees are selected from observed screen rows, not sampled as independent mutation outcomes.",
        "Missing classes on a partial screen are unavailable, not absent from the full proposal plan.",
        "No new mutation draw is made during validation; fixed role labels are not novel functions."] };
    await reserve(a.out, output);
    console.log(`planned ${nomination.candidates.length - 12} nominees + 12 identity controls from ${nomination.coverage.screenedProposals}/7200 screened proposals; no GPU requested`);
    return;
  }
  const loaded = await loadPlan(a.plan!);
  if (a.mode === "analyze") {
    const results: ValidationSeedResult[] = [];
    const sources: { path: string; digest: Digest }[] = [];
    for (const path of a.results) {
      const saved = await readJSON<{ format: string; status: string; sourcePlan: { sha256: string };
        sourceScreen: ValidationPlanFile["source"]; validationCodeHashes: Record<string, Digest>;
        budget: { seedStartOffset: number; maxSeeds: number; selectedSeeds: number[] };
        results: ValidationSeedResult[] }>(path);
      if (saved.value.format !== "foundation-mutation-validation-execution/v1" ||
          !["bounded-complete", "over-budget-incomplete"].includes(saved.value.status) ||
          saved.value.sourcePlan.sha256 !== loaded.digest.sha256 ||
          !same(saved.value.sourceScreen, loaded.plan.source) ||
          !same(saved.value.validationCodeHashes, loaded.plan.validationCodeHashes) ||
          !same(saved.value.budget.selectedSeeds,
            VALIDATION_SEEDS.slice(saved.value.budget.seedStartOffset, saved.value.budget.seedStartOffset + saved.value.budget.maxSeeds)) ||
          saved.value.results.length > saved.value.budget.selectedSeeds.length ||
          saved.value.results.some((r, i) => r.seed !== saved.value.budget.selectedSeeds[i]) ||
          saved.value.results.length > 0 && !same(saved.value.results[0].exactParentRepeat,
            { evaluated: true, evaluationIdentical: true, traceIdentical: true }))
        throw new Error(`validation result source, seed schedule or parent control conflict: ${path}`);
      sources.push({ path, digest: saved.digest });
      results.push(...saved.value.results);
    }
    const analysis = analyzeValidation(loaded.plan.nomination.candidates, results);
    await reserve(a.out, { format: "foundation-mutation-validation-analysis/v1", status: analysis.status,
      sourcePlan: { path: a.plan, digest: loaded.digest }, sources, analysis });
    console.log(`${analysis.status}: ${analysis.observedSeeds.length}/32 distinct fresh seeds`);
    if (analysis.status !== "complete") Deno.exitCode = 2;
    return;
  }
  const selected = VALIDATION_SEEDS.slice(a.seedStartOffset!, a.seedStartOffset! + a.maxSeeds!);
  const report = { format: "foundation-mutation-validation-execution/v1", status: "planned", sourcePlan: { path: a.plan!, sha256: loaded.digest.sha256 },
    sourceScreen: loaded.plan.source, validationCodeHashes: loaded.plan.validationCodeHashes,
    budget: { seedStartOffset: a.seedStartOffset!, maxSeeds: a.maxSeeds!, maxSeconds: a.maxSeconds!, selectedSeeds: selected },
    runtime: { deno: Deno.version, build: Deno.build,
      gpu: { status: "not-requested", vendor: null as string | null, architecture: null as string | null,
        device: null as string | null, description: null as string | null } },
    execution: { elapsedSeconds: 0, overrunSeconds: 0, incompleteSeed: null as number | null,
      incompleteStage: null as string | null, error: null as string | null }, results: [] as ValidationSeedResult[] };
  await reserve(a.out, report); // all results and failures retain a new path before GPU acquisition
  const persist = () => Deno.writeTextFile(a.out, JSON.stringify(report, null, 2) + "\n");
  const started = performance.now(), elapsed = () => (performance.now() - started) / 1000;
  class BudgetStop extends Error { constructor(readonly stage: string) { super(`validation time cap reached before ${stage}`); } }
  let device: GPUDevice | null = null;
  try {
    report.status = "running";
    await persist();
    if (elapsed() >= a.maxSeconds!) throw new BudgetStop("GPU acquisition");
    device = await requestDevice(navigator.gpu);
    const info = (device as GPUDevice & { adapterInfo?: GPUAdapterInfo }).adapterInfo;
    report.runtime.gpu = { status: info ? "available" : "unavailable", vendor: info?.vendor || null,
      architecture: info?.architecture || null, device: info?.device || null, description: info?.description || null };
    await persist();
    for (const seed of selected) {
      const before = (stage: "parent" | "parent-repeat" | "mutant") => {
        if (elapsed() >= a.maxSeconds!) throw new BudgetStop(stage);
      };
      try {
        const result = await executeValidationSeed(loaded.plan.nomination.candidates, seed,
          (genomes, ec, onSample) => evaluateBatch(device!, genomes, ec, { onBehaviorSample: onSample }),
          before, seed === selected[0]);
        report.results.push(result);
        report.execution.elapsedSeconds = elapsed();
        report.execution.overrunSeconds = Math.max(0, report.execution.elapsedSeconds - a.maxSeconds!);
        await persist();
        console.log(`validated seed ${seed}: ${result.rows.length} matched rows`);
      } catch (error) {
        if (error instanceof BudgetStop) {
          report.execution.incompleteSeed = seed;
          report.execution.incompleteStage = error.stage;
          break;
        }
        throw error;
      }
      if (elapsed() >= a.maxSeconds!) break;
    }
    report.execution.elapsedSeconds = elapsed();
    report.execution.overrunSeconds = Math.max(0, report.execution.elapsedSeconds - a.maxSeconds!);
    if (!same(await codeHashes(), loaded.plan.validationCodeHashes) ||
        !same(await sourceNomination(loaded.plan.source), loaded.plan.nomination) ||
        !same(digest(await Deno.readFile(a.plan!)), loaded.digest))
      throw new Error("validation source, screen evidence or code changed during execution");
    report.status = report.execution.overrunSeconds > 0 ? "over-budget-incomplete" : "bounded-complete";
    await persist();
  } catch (error) {
    report.status = error instanceof BudgetStop ? "over-budget-incomplete" : "failed";
    report.execution.error = error instanceof Error ? error.message : String(error);
    report.execution.elapsedSeconds = elapsed();
    report.execution.overrunSeconds = Math.max(0, report.execution.elapsedSeconds - a.maxSeconds!);
    await persist();
    if (!(error instanceof BudgetStop)) throw error;
  } finally { device?.destroy(); }
  console.log(`${report.status}: ${report.results.length}/${selected.length} selected seeds`);
  if (report.status === "over-budget-incomplete" || report.status === "failed") Deno.exitCode = 2;
}
if (import.meta.main) main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); Deno.exitCode = 1; });
