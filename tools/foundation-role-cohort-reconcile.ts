// CPU-only exact-input recovery after an abruptly terminated v5 execution report.
// deno run -A tools/foundation-role-cohort-reconcile.ts --plan <frozen-v5-plan> \
//   --report <completed-or-running-report> [--report ...] \
//   --interruption-receipt <receipt-for-running-report> --out <new-analysis-path>
import { createHash } from "node:crypto";
import { dirname } from "node:path";
import { analyzeRoleCohort, ROLE_COHORT_SEEDS, type RoleCandidate, type RoleSeedResult } from "./lib/foundation-role-cohort.ts";
import { checkRoleReport, type InterruptionReceipt, type ReconcileReport } from "./lib/foundation-role-cohort-reconcile.ts";

interface Digest { sha256: string; bytes: number }
const digest = (bytes: Uint8Array): Digest => ({ sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length });
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
async function readJSON<T>(path: string): Promise<{ value: T; digest: Digest }> {
  const bytes = await Deno.readFile(path);
  return { value: JSON.parse(new TextDecoder().decode(bytes)) as T, digest: digest(bytes) };
}
function parse(args: string[]) {
  const reports: string[] = [];
  let plan: string | null = null, receipt: string | null = null, out: string | null = null;
  for (let i = 0; i < args.length; i++) {
    const key = args[i], value = args[i + 1];
    if (!["--plan", "--report", "--interruption-receipt", "--out"].includes(key) || !value || value.startsWith("--"))
      throw new Error(`invalid option ${key}`);
    i++;
    if (key === "--report") reports.push(value);
    else if (key === "--plan" && !plan) plan = value;
    else if (key === "--interruption-receipt" && !receipt) receipt = value;
    else if (key === "--out" && !out) out = value;
    else throw new Error(`duplicate option ${key}`);
  }
  if (!plan || !reports.length || !out) throw new Error("--plan, one or more --report, and --out required");
  return { plan, reports, receipt, out };
}
interface PlanFile { format: string; status: string;
  source: { screenPlan: { path: string; digest: Digest }; screenReports: { path: string; digest: Digest }[];
    seedAudit: { path: string; digest: Digest } };
  selectedSourceHashes: Record<string, Digest>; protocol: { freshSeeds: number[] };
  nomination: { candidates: RoleCandidate[] } }
async function verifySources(plan: PlanFile) {
  for (const [path, expected] of Object.entries(plan.selectedSourceHashes))
    if (!same(digest(await Deno.readFile(path)), expected)) throw new Error(`frozen role source changed: ${path}`);
  const inputs = [plan.source.screenPlan, ...plan.source.screenReports, plan.source.seedAudit];
  for (const input of inputs)
    if (!same(digest(await Deno.readFile(input.path)), input.digest)) throw new Error(`frozen role evidence changed: ${input.path}`);
}
async function main() {
  const args = parse(Deno.args), savedPlan = await readJSON<PlanFile>(args.plan), plan = savedPlan.value;
  if (plan.format !== "foundation-m3-role-cohort-plan/v1" || plan.status !== "planned" ||
      !same(plan.protocol.freshSeeds, ROLE_COHORT_SEEDS) || plan.nomination.candidates.length !== 25)
    throw new Error("not the frozen complete role-cohort plan");
  await verifySources(plan);
  const savedReceipt = args.receipt ? await readJSON<InterruptionReceipt>(args.receipt) : null;
  const seen = new Set<number>(), results: RoleSeedResult[] = [];
  const reports: { path: string; digest: Digest; status: string; savedSeeds: number[];
    attemptElapsedLowerBoundSeconds: number; attemptElapsedUpperBoundSeconds: number | null;
    interruptionReceipt: { path: string; digest: Digest } | null }[] = [];
  let receiptUsed = false;
  for (const path of args.reports) {
    const saved = await readJSON<ReconcileReport>(path), r = saved.value;
    const receipt = r.status === "running" ? savedReceipt?.value ?? null : null;
    const checked = checkRoleReport(plan.nomination.candidates, savedPlan.digest.sha256,
      plan.selectedSourceHashes, r, path, saved.digest.sha256, receipt);
    if (checked.interrupted) {
      if (receiptUsed || !savedReceipt) throw new Error("one exact interruption receipt required per running report");
      receiptUsed = true;
    }
    for (const result of checked.results) {
      if (seen.has(result.seed)) throw new Error(`duplicate seed ${result.seed} across reports`);
      seen.add(result.seed);
      results.push(result);
    }
    const stat = await Deno.stat(path);
    const receiptTime = receipt ? Date.parse(receipt.createdAt) : NaN;
    const upper = checked.interrupted && stat.birthtime && Number.isFinite(receiptTime) ?
      (receiptTime - stat.birthtime.getTime()) / 1000 : null;
    if (upper !== null && upper < checked.lowerBoundAttemptSeconds)
      throw new Error("interruption timing bounds inconsistent");
    reports.push({ path, digest: saved.digest, status: r.status, savedSeeds: checked.savedSeeds,
      attemptElapsedLowerBoundSeconds: checked.lowerBoundAttemptSeconds,
      attemptElapsedUpperBoundSeconds: upper,
      interruptionReceipt: checked.interrupted ? { path: args.receipt!, digest: savedReceipt!.digest } : null });
  }
  if (savedReceipt && !receiptUsed) throw new Error("unused interruption receipt");
  const analysis = analyzeRoleCohort(plan.nomination.candidates, results);
  await verifySources(plan);
  if (!same(digest(await Deno.readFile(args.plan)), savedPlan.digest)) throw new Error("role plan changed during reconciliation");
  await Deno.mkdir(dirname(args.out), { recursive: true });
  await Deno.writeTextFile(args.out, JSON.stringify({ format: "foundation-m3-role-cohort-reconciled-analysis/v1",
    status: analysis.status, sourcePlan: { path: args.plan, digest: savedPlan.digest },
    adapterSource: { path: "tools/foundation-role-cohort-reconcile.ts",
      digest: digest(await Deno.readFile("tools/foundation-role-cohort-reconcile.ts")) },
    adapterLibrarySource: { path: "tools/lib/foundation-role-cohort-reconcile.ts",
      digest: digest(await Deno.readFile("tools/lib/foundation-role-cohort-reconcile.ts")) },
    reports, analysis, recoveryNote: "The raw interrupted report remains status running; its saved prefix was admitted only with exact terminal receipt and frozen v5 row checks. Attempt duration after last save is bounded, not invented." }, null, 2) + "\n", { createNew: true });
  console.log(`${analysis.status}: ${analysis.observedSeeds.length}/32 verified seeds; ${reports.length} attempts`);
  if (analysis.status !== "complete") Deno.exitCode = 2;
}
if (import.meta.main) main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); Deno.exitCode = 1; });
