/** Saved-evidence projection only. Never requests a GPU or advances a simulation.
 * deno run -A reanalyse-stage0-v4.ts OLD_ATTEMPT V1_DIR NEW_OUT SHARED_BUDGET_JSON
 */
import { decodeCheckpoint } from "@bl/schema";
import { OBSERVER_VERSION } from "../recovery-accessibility/observer.ts";
import {
  diagnoseBranch,
  injuryFacts,
  STAGE0_VERSION,
  type Trace,
} from "./branch-diagnostic.ts";
import {
  type BranchRecord,
  type FilePin,
  jsonBytes,
  pinBytes,
  publishBranchRecord,
  sha256,
} from "./branch-record.ts";
import { openBudget } from "./budget.ts";
const [old, source, out, budgetPath, ...extra] = Deno.args;
if (!old || !source || !out || !budgetPath || extra.length) {
  throw Error(
    "usage: reanalyse-stage0-v4.ts OLD_ATTEMPT V1_DIR NEW_OUT SHARED_BUDGET_JSON",
  );
}
try {
  await Deno.stat(out);
  throw Error("output already exists");
} catch (e) {
  if (!(e instanceof Deno.errors.NotFound)) throw e;
}
const auditBytes = await Deno.readFile(
  "docs/recovery-severity-2026-10-24/STAGE0-AUDIT.json",
);
const audit = JSON.parse(new TextDecoder().decode(auditBytes));
const id = "2026102402-mutant-mass-targeted";
const copyNames = [
  "manifest.json",
  "inputs.json",
  `${id}-cpu25.json`,
  `${id}-gpu25.json`,
  `${id}-gpu50.json`,
  "2026102402-mutant-grown.blck",
  `${id}-post.blck`,
  `${id}-final.blck`,
];
const originals = new Map<string, Uint8Array>();
for (const path of copyNames) {
  const b = await Deno.readFile(`${old}/${path}`),
    pin = audit.artifacts.find((a: FilePin) => a.path === path);
  if (!pin || b.length !== pin.bytes || await sha256(b) !== pin.sha256) {
    throw Error(`source attempt does not match saved inventory: ${path}`);
  }
  originals.set(path, b);
}
const allowance = await openBudget(budgetPath), started = Date.now();
let bytes = 0, ownsOutput = false;
const pins = new Map<string, FilePin>();
const writeBytes = async (path: string, b: Uint8Array) => {
  if (
    Date.now() - started >= allowance.maxMs - 1000 ||
    bytes + b.length > allowance.maxBytes - 4096
  ) throw Error("saved-analysis budget exhausted");
  await Deno.writeFile(`${out}/${path}.tmp`, b, { createNew: true });
  await Deno.rename(`${out}/${path}.tmp`, `${out}/${path}`);
  bytes += b.length;
  pins.set(path, await pinBytes(path, b));
};
const write = (path: string, value: unknown) =>
  writeBytes(path, jsonBytes(value));
try {
  await Deno.mkdir(out, { recursive: false });
  ownsOutput = true;
  await Deno.mkdir(`${out}/execution-source`);
  for (const [path, b] of originals) {
    await writeBytes(
      path === "manifest.json" ? "origin-manifest.json" : path,
      b,
    );
  }
  await writeBytes("origin-audit.json", auditBytes);
  const casePath = "2026102402-mutant-case.json";
  await writeBytes(
    casePath,
    await Deno.readFile(`${source}/cases/science-mutant-2026102402/case.json`),
  );
  await write(
    "pair-2026102402-selection.json",
    audit.selections.find((r: { seed: number }) => r.seed === 2026102402),
  );
  const sources = [];
  for (
    const name of [
      "stage0.ts",
      "parity.ts",
      "budget.ts",
      "continuity.ts",
      "branch-diagnostic.ts",
      "branch-record.ts",
      "read-stage0.ts",
      "attempt-gates.ts",
      "reanalyse-stage0-v4.ts",
      "observer.ts",
    ]
  ) {
    const sourcePath = name === "observer.ts"
      ? "experiments/recovery-accessibility/observer.ts"
      : `experiments/recovery-severity/${name}`;
    const path = `execution-source/${name}`;
    await writeBytes(path, await Deno.readFile(sourcePath));
    sources.push({ ...pins.get(path)!, sourcePath });
  }
  await write("manifest.json", {
    protocol: STAGE0_VERSION,
    observerVersion: OBSERVER_VERSION,
    stage: "saved-evidence-only",
    sourceManifest:
      "8c68136f8e68f551a8ec5f34a93349c729ef0268ad7e2182c6fd2431877dc1f7",
    sources: sources.map((s) => ({ path: s.sourcePath, sha256: s.sha256 })),
    origin: {
      manifest: pins.get("origin-manifest.json"),
      audit: pins.get("origin-audit.json"),
    },
    simulationStepsRun: 0,
    scientificSeedsRun: 0,
  });
  const parse = <T>(path: string): T =>
    JSON.parse(new TextDecoder().decode(originals.get(path)!));
  const cpu = parse<Trace>(`${id}-cpu25.json`),
    fast = parse<Trace>(`${id}-gpu25.json`),
    slow = parse<Trace>(`${id}-gpu50.json`);
  const c = JSON.parse(await Deno.readTextFile(`${out}/${casePath}`));
  const grown =
      decodeCheckpoint(originals.get("2026102402-mutant-grown.blck")!).state,
    post = decodeCheckpoint(originals.get(`${id}-post.blck`)!).state;
  const diagnostic = diagnoseBranch(
    {
      id,
      arm: "mass-targeted",
      referenceMass: c.observation.target.mass,
      startStep: grown.step,
      injury: injuryFacts(
        grown,
        post,
        c.observation.target,
        fast.track.initialLabel,
        true,
      ),
    },
    cpu,
    fast,
    slow,
  );
  const pin = (path: string) => {
    const p = pins.get(path);
    if (!p) throw Error(`missing evidence ${path}`);
    return p;
  };
  const record: BranchRecord = {
    version: "recovery-severity-branch-record-v1",
    mode: "saved-trace-reanalysis",
    diagnostic,
    evidence: {
      manifest: pin("manifest.json"),
      inputs: pin("inputs.json"),
      sourceCase: pin(casePath),
      selection: pin("pair-2026102402-selection.json"),
      grown: pin("2026102402-mutant-grown.blck"),
      post: pin(`${id}-post.blck`),
      final: pin(`${id}-final.blck`),
      cpu25: pin(`${id}-cpu25.json`),
      gpu25: pin(`${id}-gpu25.json`),
      gpu50: pin(`${id}-gpu50.json`),
      sources,
    },
  };
  const path = `${id}-diagnostic.json`;
  await publishBranchRecord(
    record,
    path,
    write,
    (p) => Deno.readFile(`${out}/${p}`),
  );
  await write("failure.json", {
    status: "TECHNICAL-STOP",
    branchDiagnostic: path,
    reason: diagnostic.endpoint.status,
    mode: record.mode,
    simulationStepsRun: 0,
    scientificSeedsRun: 0,
  });
  console.log(JSON.stringify(
    {
      mode: record.mode,
      status: diagnostic.stage0,
      diagnostic: path,
      firstDisagreement: diagnostic.cadenceConcordance.firstDisagreement,
      endpoint: diagnostic.endpoint,
      simulationStepsRun: 0,
      scientificSeedsRun: 0,
    },
    null,
    2,
  ));
} catch (e) {
  if (ownsOutput) {
    try {
      await Deno.writeTextFile(
        `${out}/failure.json`,
        JSON.stringify({
          status: "TECHNICAL-STOP",
          error: String(e),
          simulationStepsRun: 0,
          scientificSeedsRun: 0,
        }),
        { createNew: true },
      );
    } catch (reportError) {
      if (
        !(reportError instanceof Deno.errors.AlreadyExists)
      ) throw reportError;
    }
  }
  throw e;
} finally {
  await allowance.settle(ownsOutput ? out : "/nonexistent-stage0-reanalysis");
}
