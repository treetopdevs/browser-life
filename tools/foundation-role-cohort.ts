// New M3-aligned diagnostic role cohort. Default mode only writes a frozen plan.
// Plan: deno run -A tools/foundation-role-cohort.ts --screen-plan runs/foundations/screen-plan-7200-v1.json \
//   --screen-report runs/foundations/screen-batches-1-8-v1.json [repeat for all 15] \
//   --seed-audit runs/foundations-next/seed-audit.json --out runs/foundations-next/role-cohort-plan.json
// Execute: deno run -A tools/foundation-role-cohort.ts --execute --plan <plan> \
//   --seed-start-offset 0 --max-seeds 8 --max-seconds 600 --out <new-report>
// Smoke (pipeline only): deno run -A tools/foundation-role-cohort.ts --smoke --plan <plan> \
//   --max-seconds 120 --out <new-smoke-report>
// Analyze: deno run -A tools/foundation-role-cohort.ts --analyze --plan <plan> \
//   --result <report> [repeat] --out <new-analysis>
import { createHash } from "node:crypto";
import { dirname } from "node:path";
import { requestDevice } from "@bl/sim-gpu";
import { evaluateBatch } from "@bl/search";
import { mutationNeighborhood } from "../packages/search/src/mutation-neighborhood.ts";
import { buildScreenPlan, SCREEN_EVAL, type ScreenPlan } from "./lib/foundation-screen.ts";
import { collectScreenRows, type ScreenExecutionInput } from "./lib/foundation-validation.ts";
import { analyzeRoleCohort, executeRoleSeed, nominateRoleCohort, roleSlots, ROLE_COHORT_SALT,
  ROLE_COHORT_SEEDS, ROLE_COHORT_SMOKE_SEEDS, type RoleNomination, type RoleSeedResult } from "./lib/foundation-role-cohort.ts";

type Mode = "plan" | "execute" | "analyze" | "smoke";
interface Args { mode: Mode; out: string; screenPlan?: string; screenReports: string[]; seedAudit?: string;
  plan?: string; results: string[]; seedStartOffset?: number; maxSeeds?: number; maxSeconds?: number }
function parse(args: string[]): Args {
  const values = new Map<string, string[]>();
  let mode: Mode = "plan";
  for (let i = 0; i < args.length; i++) {
    const name = args[i];
    if (name === "--execute" || name === "--analyze" || name === "--smoke") {
      if (mode !== "plan") throw new Error("choose only one mode");
      mode = name === "--execute" ? "execute" : name === "--analyze" ? "analyze" : "smoke";
      continue;
    }
    if (!name.startsWith("--") || !args[i + 1] || args[i + 1].startsWith("--")) throw new Error(`invalid option ${name}`);
    if (!["--out", "--screen-plan", "--screen-report", "--seed-audit", "--plan", "--result",
      "--seed-start-offset", "--max-seeds", "--max-seconds"].includes(name)) throw new Error(`unknown option ${name}`);
    if (!["--screen-report", "--result"].includes(name) && values.has(name)) throw new Error(`duplicate option ${name}`);
    values.set(name, [...(values.get(name) ?? []), args[++i]]);
  }
  const one = (name: string) => values.get(name)?.[0];
  const integer = (name: string) => { const raw = one(name);
    if (raw === undefined) return undefined;
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw))) throw new Error(`${name} must be a nonnegative safe integer`);
    return Number(raw); };
  const out = one("--out"), screenPlan = one("--screen-plan"), screenReports = values.get("--screen-report") ?? [],
    seedAudit = one("--seed-audit"), plan = one("--plan"), results = values.get("--result") ?? [];
  if (!out) throw new Error("--out <new path> required");
  const seedStartOffset = integer("--seed-start-offset"), maxSeeds = integer("--max-seeds");
  const rawSeconds = one("--max-seconds"), maxSeconds = rawSeconds === undefined ? undefined : Number(rawSeconds);
  if (mode === "plan" && (!screenPlan || !screenReports.length || !seedAudit || plan || results.length ||
      seedStartOffset !== undefined || maxSeeds !== undefined || maxSeconds !== undefined))
    throw new Error("plan requires --screen-plan, all --screen-report files and --seed-audit");
  if (mode === "execute" && (!plan || screenPlan || screenReports.length || seedAudit || results.length ||
      seedStartOffset === undefined || maxSeeds === undefined || maxSeconds === undefined || seedStartOffset > 31 ||
      maxSeeds < 1 || maxSeeds > 8 || seedStartOffset + maxSeeds > 32 ||
      !Number.isFinite(maxSeconds) || maxSeconds <= 0 || maxSeconds > 600))
    throw new Error("execute requires --plan, --seed-start-offset 0..31, --max-seeds 1..8 within 32 and --max-seconds in (0,600]");
  if (mode === "analyze" && (!plan || !results.length || screenPlan || screenReports.length || seedAudit ||
      seedStartOffset !== undefined || maxSeeds !== undefined || maxSeconds !== undefined))
    throw new Error("analyze requires --plan and one or more --result paths");
  if (mode === "smoke" && (!plan || screenPlan || screenReports.length || seedAudit || results.length ||
      seedStartOffset !== undefined || maxSeeds !== undefined || maxSeconds === undefined ||
      !Number.isFinite(maxSeconds) || maxSeconds <= 0 || maxSeconds > 120))
    throw new Error("smoke requires --plan and --max-seconds in (0,120], with no scientific seed offset");
  return { mode, out, screenPlan, screenReports, seedAudit, plan, results, seedStartOffset, maxSeeds, maxSeconds };
}

interface Digest { sha256: string; bytes: number }
const digest = (bytes: Uint8Array): Digest => ({ sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length });
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const readJSON = async <T>(path: string): Promise<{ value: T; digest: Digest }> => {
  const bytes = await Deno.readFile(path);
  return { value: JSON.parse(new TextDecoder().decode(bytes)) as T, digest: digest(bytes) };
};
const codeFiles = ["deno.json", "deno.lock", "package.json",
  "packages/search/src/index.ts", "packages/sim-gpu/src/index.ts", "packages/metrics/src/index.ts",
  "packages/schema/src/index.ts", "packages/sim-ref/src/index.ts",
  "tools/foundation-role-cohort.ts", "tools/lib/foundation-role-cohort.ts",
  "tools/lib/foundation-validation.ts", "tools/lib/foundation-screen.ts",
  "packages/search/src/evaluate.ts", "packages/search/src/foundation-behavior.ts", "packages/search/src/mutation-neighborhood.ts",
  "packages/schema/src/config.ts", "packages/schema/src/genome.ts", "packages/schema/src/layout.ts",
  "packages/schema/src/founders.ts", "packages/schema/src/world.ts", "packages/schema/src/accounting.ts",
  "packages/metrics/src/stats.ts", "packages/metrics/src/census.ts", "packages/metrics/src/tracker.ts",
  "packages/metrics/src/ecology.ts", "packages/metrics/src/complexity.ts",
  "packages/sim-gpu/src/gpu-sim.ts", "packages/sim-gpu/src/shaders.ts"];
async function codeHashes(): Promise<Record<string, Digest>> {
  return Object.fromEntries(await Promise.all(codeFiles.map(async (path) => [path, digest(await Deno.readFile(path))] as const)));
}
interface SeedAudit { status: string; reservedSeeds: number[]; engineeringSmokeSeeds: number[];
  checkedSources: unknown[]; collisions: unknown[] }
interface RolePlanFile {
  format: "foundation-m3-role-cohort-plan/v1"; status: "planned";
  source: { screenPlan: { path: string; digest: Digest }; screenReports: { path: string; digest: Digest }[];
    screenCodeIdentity: unknown; seedAudit: { path: string; digest: Digest } };
  selectedSourceHashes: Record<string, Digest>;
  protocol: { salt: typeof ROLE_COHORT_SALT; freshSeeds: number[]; evalTemplate: typeof SCREEN_EVAL;
    capacity: number; slots: ReturnType<typeof roleSlots>; panels: string; inference: string };
  nomination: RoleNomination; limitations: string[];
}
async function verifiedSeedAudit(file: { path: string; digest: Digest }) {
  const saved = await readJSON<SeedAudit>(file.path);
  if (!same(saved.digest, file.digest) || saved.value.status !== "cleared" ||
      !same(saved.value.reservedSeeds, ROLE_COHORT_SEEDS) ||
      !same(saved.value.engineeringSmokeSeeds, ROLE_COHORT_SMOKE_SEEDS) ||
      !Array.isArray(saved.value.checkedSources) || saved.value.checkedSources.length === 0 ||
      !Array.isArray(saved.value.collisions) || saved.value.collisions.length !== 0)
    throw new Error("seed audit bytes, fresh seed list or collision status invalid");
}
async function sourceNomination(source: RolePlanFile["source"]): Promise<RoleNomination> {
  const screen = await readJSON<{ format: string; status: string; sourceIdentity: { selectedSourceSha256?: Record<string, string> };
    plan: ScreenPlan }>(source.screenPlan.path);
  if (!same(screen.digest, source.screenPlan.digest) || screen.value.format !== "foundation-screen-plan/v1" ||
      screen.value.status !== "planned" || !same(screen.value.sourceIdentity, source.screenCodeIdentity))
    throw new Error("frozen screen plan bytes or identity changed");
  const p = screen.value.plan;
  const rebuilt = buildScreenPlan(mutationNeighborhood(p.neighborhood.drawSeed, p.neighborhood.samplesPerFounderPerScale), p.seeds.screen[0]);
  if (!same(rebuilt, p)) throw new Error("screen plan differs from deterministic generator");
  const hashes = screen.value.sourceIdentity?.selectedSourceSha256;
  if (!hashes || !Object.keys(hashes).length) throw new Error("screen plan lacks source hashes");
  for (const [path, expected] of Object.entries(hashes))
    if (digest(await Deno.readFile(path)).sha256 !== expected) throw new Error(`screen source changed: ${path}`);
  const inputs: ScreenExecutionInput[] = [];
  for (const file of source.screenReports) {
    const report = await readJSON<ScreenExecutionInput>(file.path);
    if (!same(report.digest, file.digest)) throw new Error(`screen report bytes changed: ${file.path}`);
    inputs.push(report.value);
  }
  const collected = collectScreenRows(p, inputs, screen.digest.sha256, screen.value.sourceIdentity);
  await verifiedSeedAudit(source.seedAudit);
  const nomination = nominateRoleCohort(p, collected.rows, collected.batchCount);
  if (nomination.coverage.eligibleProposalAssays !== 866 ||
      nomination.coverage.eligibleDistinctFounderGenotypes !== 728 ||
      nomination.candidates.filter((c) => c.kind === "role-nominee").length !== 13)
    throw new Error("role cohort differs from reviewed 866-row, 728-genotype, 13-nominee inventory");
  return nomination;
}
async function loadPlan(path: string): Promise<{ value: RolePlanFile; digest: Digest }> {
  const saved = await readJSON<RolePlanFile>(path), p = saved.value;
  if (p.format !== "foundation-m3-role-cohort-plan/v1" || p.status !== "planned" ||
      !same(p.protocol.freshSeeds, ROLE_COHORT_SEEDS) || p.protocol.salt !== ROLE_COHORT_SALT ||
      !same(p.protocol.evalTemplate, SCREEN_EVAL) || p.protocol.capacity !== 64 ||
      !same(p.protocol.slots, roleSlots(p.nomination.candidates)) ||
      !same(p.selectedSourceHashes, await codeHashes()) ||
      !same(p.nomination, await sourceNomination(p.source)))
    throw new Error("role plan, provenance or selected code identity changed");
  return saved;
}
async function reserve(path: string, value: unknown) {
  await Deno.mkdir(dirname(path), { recursive: true });
  await Deno.writeTextFile(path, JSON.stringify(value, null, 2) + "\n", { createNew: true });
}
async function main() {
  const a = parse(Deno.args);
  if (a.mode === "plan") {
    const screen = await readJSON<{ sourceIdentity: unknown }>(a.screenPlan!);
    const source: RolePlanFile["source"] = { screenPlan: { path: a.screenPlan!, digest: screen.digest },
      screenReports: await Promise.all(a.screenReports.map(async (path) => ({ path, digest: digest(await Deno.readFile(path)) }))),
      screenCodeIdentity: screen.value.sourceIdentity,
      seedAudit: { path: a.seedAudit!, digest: digest(await Deno.readFile(a.seedAudit!)) } };
    const nomination = await sourceNomination(source);
    const output: RolePlanFile = { format: "foundation-m3-role-cohort-plan/v1", status: "planned", source,
      selectedSourceHashes: await codeHashes(), protocol: { salt: ROLE_COHORT_SALT, freshSeeds: ROLE_COHORT_SEEDS,
        evalTemplate: SCREEN_EVAL, capacity: 64, slots: roleSlots(nomination.candidates),
        panels: "two fixed slots i and i+25 for every logical entry, analyzed separately over the same 32 seeds",
        inference: "six absolute 32-seed gates and endpoint-specific paired harm per candidate and position; role changes descriptive" },
      nomination, limitations: ["Nominees were selected from the completed exploratory screen; no mutation-population frequency is inferred.",
        "Two positions use the same seeds and are conditional panels, not independent evolutionary histories.",
        "Fixed role changes are measured variation, not novel ecological functions."] };
    await reserve(a.out, output);
    console.log(`planned ${nomination.candidates.length - 12} nominees, 12 controls, 50 fixed slots; no GPU requested`);
    return;
  }
  const plan = await loadPlan(a.plan!);
  if (a.mode === "smoke") {
    const seed = ROLE_COHORT_SMOKE_SEEDS[0];
    const report = { format: "foundation-m3-role-cohort-smoke/v1", status: "planned",
      purpose: "full-schedule pipeline-only engineering smoke; excluded from scientific 32-seed analysis",
      sourcePlan: { path: a.plan!, sha256: plan.digest.sha256 }, selectedSourceHashes: plan.value.selectedSourceHashes,
      seed, maxSeconds: a.maxSeconds!, evalConfig: { ...SCREEN_EVAL, seed },
      runtime: { deno: Deno.version, build: Deno.build,
        gpu: { status: "not-requested", vendor: null as string | null, architecture: null as string | null,
          device: null as string | null, description: null as string | null } },
      execution: { elapsedSeconds: 0, overrunSeconds: 0, incompleteStage: null as string | null, error: null as string | null },
      technicalChecks: null as null | { slots: number; framesPerSlot: number; identityControlComparisonsExact: number;
        parentRepeatExact: boolean; biologyOutcomesRetained: false } };
    await reserve(a.out, report);
    const persist = () => Deno.writeTextFile(a.out, JSON.stringify(report, null, 2) + "\n");
    const started = performance.now(), elapsed = () => (performance.now() - started) / 1000;
    class SmokeBudgetStop extends Error { constructor(readonly stage: string) { super(`smoke cap reached before ${stage}`); } }
    let device: GPUDevice | null = null;
    try {
      report.status = "running";
      await persist();
      if (elapsed() >= a.maxSeconds!) throw new SmokeBudgetStop("GPU acquisition");
      device = await requestDevice(navigator.gpu);
      const info = (device as GPUDevice & { adapterInfo?: GPUAdapterInfo }).adapterInfo;
      report.runtime.gpu = { status: info ? "available" : "unavailable", vendor: info?.vendor || null,
        architecture: info?.architecture || null, device: info?.device || null, description: info?.description || null };
      await persist();
      const before = (stage: "parent" | "parent-repeat" | "mutant") => {
        if (elapsed() >= a.maxSeconds!) throw new SmokeBudgetStop(stage);
      };
      const result = await executeRoleSeed(plan.value.nomination.candidates, seed,
        (genomes, ec, onSample) => evaluateBatch(device!, genomes, ec, { onBehaviorSample: onSample }),
        before, true, true);
      report.technicalChecks = { slots: result.rows.length, framesPerSlot: 30,
        identityControlComparisonsExact: result.rows.filter((r) => r.identityControlExact === true).length,
        parentRepeatExact: result.exactParentRepeat.evaluationIdentical && result.exactParentRepeat.traceIdentical,
        biologyOutcomesRetained: false };
      report.execution.elapsedSeconds = elapsed();
      report.execution.overrunSeconds = Math.max(0, report.execution.elapsedSeconds - a.maxSeconds!);
      if (!same(await codeHashes(), plan.value.selectedSourceHashes) ||
          !same(await sourceNomination(plan.value.source), plan.value.nomination) ||
          !same(digest(await Deno.readFile(a.plan!)), plan.digest))
        throw new Error("smoke source, audit, screen evidence or code changed during execution");
      report.status = report.execution.overrunSeconds > 0 ? "over-budget-incomplete" : "completed";
      await persist();
    } catch (error) {
      report.status = error instanceof SmokeBudgetStop ? "over-budget-incomplete" : "failed";
      report.execution.incompleteStage = error instanceof SmokeBudgetStop ? error.stage : null;
      report.execution.error = error instanceof Error ? error.message : String(error);
      report.execution.elapsedSeconds = elapsed();
      report.execution.overrunSeconds = Math.max(0, report.execution.elapsedSeconds - a.maxSeconds!);
      await persist();
      if (!(error instanceof SmokeBudgetStop)) throw error;
    } finally { device?.destroy(); }
    console.log(`engineering smoke ${report.status}: ${report.technicalChecks?.identityControlComparisonsExact ?? 0}/24 exact controls`);
    if (report.status !== "completed") Deno.exitCode = 2;
    return;
  }
  if (a.mode === "analyze") {
    const sources: { path: string; digest: Digest }[] = [], results: RoleSeedResult[] = [];
    for (const path of a.results) {
      const saved = await readJSON<{ format: string; status: string; sourcePlan: { sha256: string };
        selectedSourceHashes: Record<string, Digest>;
        budget: { seedStartOffset: number; maxSeeds: number; selectedSeeds: number[] }; results: RoleSeedResult[] }>(path);
      const selected = ROLE_COHORT_SEEDS.slice(saved.value.budget?.seedStartOffset,
        saved.value.budget?.seedStartOffset + saved.value.budget?.maxSeeds);
      if (saved.value.format !== "foundation-m3-role-cohort-execution/v1" ||
          !["bounded-complete", "over-budget-incomplete"].includes(saved.value.status) ||
          saved.value.sourcePlan?.sha256 !== plan.digest.sha256 ||
          !same(saved.value.selectedSourceHashes, plan.value.selectedSourceHashes) ||
          !same(saved.value.budget.selectedSeeds, selected) || saved.value.results.length > selected.length ||
          saved.value.results.some((r, i) => r.seed !== selected[i]) ||
          saved.value.results.length > 0 && !same(saved.value.results[0].exactParentRepeat,
            { evaluated: true, evaluationIdentical: true, traceIdentical: true }))
        throw new Error(`role report source, schedule or first parent repeat invalid: ${path}`);
      sources.push({ path, digest: saved.digest });
      results.push(...saved.value.results);
    }
    const analysis = analyzeRoleCohort(plan.value.nomination.candidates, results);
    await reserve(a.out, { format: "foundation-m3-role-cohort-analysis/v1", status: analysis.status,
      sourcePlan: { path: a.plan, digest: plan.digest }, sources, analysis });
    console.log(`${analysis.status}: ${analysis.observedSeeds.length}/32 seeds, ${analysis.panels.length} candidate-position panels`);
    if (analysis.status !== "complete") Deno.exitCode = 2;
    return;
  }
  const selected = ROLE_COHORT_SEEDS.slice(a.seedStartOffset!, a.seedStartOffset! + a.maxSeeds!);
  const report = { format: "foundation-m3-role-cohort-execution/v1", status: "planned",
    sourcePlan: { path: a.plan!, sha256: plan.digest.sha256 }, selectedSourceHashes: plan.value.selectedSourceHashes,
    budget: { seedStartOffset: a.seedStartOffset!, maxSeeds: a.maxSeeds!, maxSeconds: a.maxSeconds!, selectedSeeds: selected },
    runtime: { deno: Deno.version, build: Deno.build,
      gpu: { status: "not-requested", vendor: null as string | null, architecture: null as string | null,
        device: null as string | null, description: null as string | null } },
    execution: { elapsedSeconds: 0, overrunSeconds: 0, incompleteSeed: null as number | null,
      incompleteStage: null as string | null, error: null as string | null }, results: [] as RoleSeedResult[] };
  await reserve(a.out, report); // Fail before GPU acquisition if the requested output already exists.
  const persist = () => Deno.writeTextFile(a.out, JSON.stringify(report, null, 2) + "\n");
  const started = performance.now(), elapsed = () => (performance.now() - started) / 1000;
  class BudgetStop extends Error { constructor(readonly stage: string) { super(`role-cohort time cap reached before ${stage}`); } }
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
        const result = await executeRoleSeed(plan.value.nomination.candidates, seed,
          (genomes, ec, onSample) => evaluateBatch(device!, genomes, ec, { onBehaviorSample: onSample }),
          before, seed === selected[0]);
        report.results.push(result);
        report.execution.elapsedSeconds = elapsed();
        report.execution.overrunSeconds = Math.max(0, report.execution.elapsedSeconds - a.maxSeconds!);
        await persist();
        console.log(`role seed ${seed}: 50 matched slots`);
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
    if (!same(await codeHashes(), plan.value.selectedSourceHashes) ||
        !same(await sourceNomination(plan.value.source), plan.value.nomination) ||
        !same(digest(await Deno.readFile(a.plan!)), plan.digest))
      throw new Error("role source, audit, screen evidence or code changed during execution");
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
  if (report.status !== "bounded-complete") Deno.exitCode = 2;
}
if (import.meta.main) main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); Deno.exitCode = 1; });
