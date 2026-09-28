/** Post-execution A1 fixed-placement-age diagnostic; CPU only, create-new output. */
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sha256, type FileDigest } from "./lib/foundation-replay.ts";
import { joinA1Organization, type A1Transition, type A1Material,
  type A1Morphology, type A1CensusHash } from "./lib/foundation-a1-organization.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const digest = async (path: string) => sha256(await Deno.readFile(path));
const equal = (a: FileDigest, b: FileDigest) => a.sha256 === b.sha256 && a.bytes === b.bytes;
const readJson = async (path: string) => JSON.parse(await Deno.readTextFile(path));

export async function buildA1OrganizationReport(args: { planPath: string; resultPath: string }) {
  const plan = await readJson(args.planPath), result = await readJson(args.resultPath);
  if (plan.status !== "planned" || result.status !== "verified" ||
      result.serialTraceMatched !== true || result.terminalPhysicsMatched !== true ||
      result.originalArtifactMatched !== true || result.observationHashesMatched !== true ||
      result.overrun || result.parityThroughStep !== 250 || result.fullParitySteps.length !== 10)
    throw new Error("A1 diagnostic is not fully authenticated and complete");
  if (!equal(await digest(args.planPath), result.planFile))
    throw new Error("A1 result does not bind its immutable plan");
  const serialPath = plan.inputs.priorSerial;
  const serialPlanPath = join(dirname(serialPath), "plan.json");
  if (!equal(await digest(serialPath), plan.priorSerialFile) ||
      !equal(await digest(serialPlanPath), plan.priorSerialPlanFile))
    throw new Error("saved serial source differs from A1 plan");
  const serial = await readJson(serialPath);
  const donor = serial.rows?.[0];
  if (serial.status !== "complete" || serial.postExecutionRevalidated !== true ||
      donor?.arm !== "donor" || donor.status !== "complete" ||
      donor.outcome?.capture?.complete !== true ||
      donor.initialStateHash !== plan.oldDonor.initialStateHash ||
      donor.outcome.measuredPhysicsHash !== plan.oldDonor.measuredPhysicsHash ||
      donor.outcome.measuredArtifactHash !== plan.oldDonor.measuredArtifactHash)
    throw new Error("saved donor trace is not the bound completed garden");
  const dependencies: Record<string, FileDigest> = {};
  const add = async (path: string, expected: FileDigest) => {
    const got = await digest(path);
    if (!equal(got, expected)) throw new Error(`authenticated dependency changed: ${path}`);
    dependencies[path] = got;
  };
  for (const [name, expected] of Object.entries(plan.preflight.sourceFiles) as [string, FileDigest][])
    await add(join(plan.inputs.source, name), expected);
  await add(join(plan.inputs.cache, "manifest.json"), plan.preflight.cacheManifestFile);
  await add(plan.inputs.catalog, plan.preflight.catalogFile);
  await add(plan.inputs.rule, plan.preflight.ruleFile);
  for (const [name, expected] of Object.entries(plan.preflight.codeFiles) as [string, FileDigest][])
    await add(join(root, name), expected);
  await add(args.planPath, await digest(args.planPath));
  await add(args.resultPath, await digest(args.resultPath));
  await add(serialPath, plan.priorSerialFile);
  await add(serialPlanPath, plan.priorSerialPlanFile);
  const adapterCode = ["tools/foundation-a1-organization.ts",
    "tools/lib/foundation-a1-organization.ts"];
  for (const name of adapterCode) dependencies[join(root, name)] = await digest(join(root, name));

  const capture = donor.outcome.capture;
  const rows = joinA1Organization({
    transitions: result.censusTransitions as A1Transition[],
    material: result.materialEvidence as A1Material[],
    morphology: capture.morphology as A1Morphology[],
    census100: capture.censuses100 as A1CensusHash[],
    serialTraceMatched: result.serialTraceMatched,
  });
  for (const [path, expected] of Object.entries(dependencies))
    if (!equal(await digest(path), expected)) throw new Error(`dependency changed during report: ${path}`);
  const byAvailability: Record<string, number> = {};
  for (const row of rows) byAvailability[row.morphologyAvailability] =
    (byAvailability[row.morphologyAvailability] ?? 0) + 1;
  return { format: 1, status: "source-bound-post-execution-descriptive" as const,
    createdAt: new Date().toISOString(), source: {
      a1Plan: resolve(args.planPath), a1Result: resolve(args.resultPath),
      serialManifest: serialPath, serialPlan: serialPlanPath,
      authentication: "A1 exact trace-label parity plus bound serial-v1 capture; no independent second membership digest",
      dependencies },
    selection: "Fixed time-since-placement 100/200 chosen after original execution; all A1 components retained",
    rows, counts: { components: rows.length, byAvailability,
      fixedPlacementAge100: rows.filter(x => x.step === 100).length,
      fixedPlacementAge200: rows.filter(x => x.step === 200).length },
    limitations: ["Biological age is unknown.",
      "Morphology of components absent from saved serial capture is unavailable, not zero.",
      "Step-175 and step-225 material rows have no saved morphology frame.",
      "Zero polymer makes membrane traits uninformative; measured zero remains zero.",
      "Same-census traits and copy-origin observations cannot establish organization reconstruction or genetic heritability."] };
}

if (import.meta.main) {
  if (Deno.args.length !== 6 || Deno.args[0] !== "--plan" || Deno.args[2] !== "--result" ||
      Deno.args[4] !== "--out") throw new Error("usage: --plan PATH --result PATH --out NEW_PATH");
  const out = resolve(Deno.args[5]);
  if (!out.includes(`${join(root, "runs", "foundations-next")}/`))
    throw new Error("output must be under runs/foundations-next");
  const report = await buildA1OrganizationReport({ planPath: resolve(Deno.args[1]),
    resultPath: resolve(Deno.args[3]) });
  const file = await Deno.open(out, { write: true, createNew: true });
  try { await file.write(new TextEncoder().encode(JSON.stringify(report, null, 2) + "\n")); }
  finally { file.close(); }
  console.log(`${out}: ${report.counts.components} component rows`);
}
