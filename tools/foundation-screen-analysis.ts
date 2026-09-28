// CPU-only complete-screen analysis. All 113 batches are required.
// deno run -A tools/foundation-screen-analysis.ts --plan runs/foundations/screen-plan-7200-v1.json \
//   --report runs/foundations/screen-chunk-0.json --report runs/foundations/screen-chunk-1.json \
//   --out runs/foundations/screen-summary.json
import { createHash } from "node:crypto";
import { dirname } from "node:path";
import { mutationNeighborhood } from "../packages/search/src/mutation-neighborhood.ts";
import { buildScreenPlan, type ScreenPlan } from "./lib/foundation-screen.ts";
import { analyzeCompleteScreen, collectCompleteScreen, type CompleteScreenInput } from "./lib/foundation-screen-analysis.ts";

interface Args { plan: string; reports: string[]; out: string }
function parse(args: string[]): Args {
  let plan: string | undefined, out: string | undefined;
  const reports: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const option = args[i], value = args[++i];
    if (!value || value.startsWith("--")) throw new Error(`missing value for ${option}`);
    if (option === "--plan" && !plan) plan = value;
    else if (option === "--out" && !out) out = value;
    else if (option === "--report") reports.push(value);
    else throw new Error(`unknown or duplicate option ${option}`);
  }
  if (!plan || !out || !reports.length) throw new Error("--plan, one or more --report, and --out are required");
  return { plan, reports, out };
}
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const read = async <T>(path: string) => {
  const bytes = await Deno.readFile(path);
  return { value: JSON.parse(new TextDecoder().decode(bytes)) as T, digest: { sha256: sha(bytes), bytes: bytes.length } };
};
async function main() {
  const args = parse(Deno.args);
  try {
    await Deno.lstat(args.out);
    throw new Error(`output already exists: ${args.out}`);
  } catch (error) { if (!(error instanceof Deno.errors.NotFound)) throw error; }
  const source = await read<{ format: string; status: string; sourceIdentity: {
    selectedSourceSha256: Record<string, string> }; plan: ScreenPlan }>(args.plan);
  if (source.value.format !== "foundation-screen-plan/v1" || source.value.status !== "planned" ||
      source.value.plan?.schema !== "foundation-screen-plan/v1")
    throw new Error("source is not a saved planned screen");
  const plan = source.value.plan;
  const rebuilt = buildScreenPlan(mutationNeighborhood(plan.neighborhood.drawSeed,
    plan.neighborhood.samplesPerFounderPerScale), plan.seeds.screen[0]);
  if (!same(plan, rebuilt)) throw new Error("screen plan differs from deterministic proposal generator");
  const savedHashes = source.value.sourceIdentity?.selectedSourceSha256;
  if (!savedHashes || !Object.keys(savedHashes).length) throw new Error("missing screen code identity");
  for (const [path, expected] of Object.entries(savedHashes)) {
    const actual = sha(await Deno.readFile(new URL(`../${path}`, import.meta.url)));
    if (actual !== expected) throw new Error(`screen source code changed: ${path}`);
  }
  const reports = await Promise.all(args.reports.map((path) => read<CompleteScreenInput>(path)));
  const rows = collectCompleteScreen(plan, reports.map((r) => r.value), source.digest.sha256,
    source.value.sourceIdentity);
  const analysis = analyzeCompleteScreen(rows);
  const analysisFiles = ["tools/foundation-screen-analysis.ts", "tools/lib/foundation-screen-analysis.ts"];
  const output = { format: "foundation-screen-analysis/v1", status: "complete",
    source: { plan: { path: args.plan, ...source.digest },
      reports: args.reports.map((path, i) => ({ path, ...reports[i].digest })),
      screenCodeIdentity: source.value.sourceIdentity,
      analysisCodeSha256: Object.fromEntries(await Promise.all(analysisFiles.map(async (path) =>
        [path, sha(await Deno.readFile(new URL(`../${path}`, import.meta.url)))] as const))) },
    design: { assay: "reps=1, identical parent/mutant tile index and seed within each batch",
      nesting: "raw proposals nested within founder×scale; batch and tile are assay coordinates",
      completeness: "all 113 planned batches and all 7200 proposals with exact first-local-batch parent repeat controls" },
    analysis };
  await Deno.mkdir(dirname(args.out), { recursive: true });
  await Deno.writeTextFile(args.out, JSON.stringify(output, null, 2) + "\n", { createNew: true });
  console.log(`complete descriptive screen: 113 batches, 7200 proposals; ${args.out}`);
}
await main();
