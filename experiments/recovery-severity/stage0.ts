/** Bounded engineering parity only (advances saved worlds when explicitly run). deno run -A experiments/recovery-severity/stage0.ts V1_DIR NEW_OUT_DIR SHARED_BUDGET_JSON */
import {
  canonicalObserverJSON,
  decodeCheckpoint,
  ledgerResidual,
  stateHash,
  totalsOf,
  validateState,
} from "@bl/schema";
import {
  type CaseResult,
  genomeHex,
  initialState,
  subjects,
  validateCase,
  worldConfig,
} from "../recovery-accessibility/protocol.ts";
import { enumerateCandidatesDetailed, selectPair } from "./selector.ts";

const [source, out, budgetPath, ...extra] = Deno.args;
if (!source || !out || !budgetPath || extra.length) {
  throw new Error("usage: stage0.ts V1_DIR NEW_OUT_DIR SHARED_BUDGET_JSON");
}
const EXPECTED_MANIFEST =
  "8c68136f8e68f551a8ec5f34a93349c729ef0268ad7e2182c6fd2431877dc1f7";
const enc = new TextEncoder();
const stable = canonicalObserverJSON;
const sha = async (b: Uint8Array) =>
  [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", b as Uint8Array<ArrayBuffer>),
    ),
  ].map((x) => x.toString(16).padStart(2, "0")).join("");
const digest = async (v: unknown) => sha(enc.encode(stable(v)));
const read = async (p: string) => JSON.parse(await Deno.readTextFile(p));
try {
  await Deno.stat(out);
  throw new Error("output already exists; use a new directory");
} catch (e) {
  if (!(e instanceof Deno.errors.NotFound)) throw e;
}
const manifest = await read(`${source}/manifest.json`);
if (
  await digest(manifest) !== EXPECTED_MANIFEST ||
  (await read(`${source}/manifest-digest.json`)).sha256 !== EXPECTED_MANIFEST
) throw new Error("not the frozen v1 manifest");
const genotypes = subjects();
const audit = await read("docs/recovery-severity-2026-10-24/audit.json");
const pinnedCases = new Map<string, string>(
  audit.cases.map((
    r: { id: string; source_sha256: string },
  ) => [r.id, r.source_sha256]),
);
if (pinnedCases.size !== 64) throw new Error("incomplete case inventory");

import { GpuSim, requestDevice } from "@bl/sim-gpu";
import { encodeCheckpoint } from "@bl/schema";
import {
  assertConserved,
  branchTrace,
  type Disc,
  type Factory,
  referenceBackend,
  stateIdentity,
} from "./parity.ts";
import {
  diagnoseBranch,
  injuryFacts,
  STAGE0_VERSION,
} from "./branch-diagnostic.ts";
import { OBSERVER_VERSION } from "../recovery-accessibility/observer.ts";
import {
  type BranchRecord,
  finishBranch,
  readBranchRecord,
} from "./branch-record.ts";
import { openBudget } from "./budget.ts";
const allowance = await openBudget(budgetPath);
const started = Date.now(),
  MAX_MS = allowance.maxMs,
  MAX_BYTES = allowance.maxBytes;
const inputEvidence: {
  id: string;
  caseSha256: string;
  checkpointSha256: string;
}[] = [];
const guard = () => {
  if (Date.now() - started >= MAX_MS - 1000) {
    throw new Error("CAP: 20 minute engineering execution limit");
  }
};
let writtenBytes = 0;
const artifacts: { path: string; bytes: number; sha256: string }[] = [];
let ownsOutput = false;
const writeBytes = async (name: string, b: Uint8Array) => {
  guard();
  if (writtenBytes + b.length > MAX_BYTES - 4096) {
    throw new Error("CAP: 512 MiB storage limit");
  }
  await Deno.writeFile(`${out}/${name}.tmp`, b, { createNew: true });
  await Deno.rename(`${out}/${name}.tmp`, `${out}/${name}`);
  writtenBytes += b.length;
  artifacts.push({ path: name, bytes: b.length, sha256: await sha(b) });
};
const write = async (name: string, v: unknown) =>
  writeBytes(name, enc.encode(JSON.stringify(v, null, 2) + "\n"));
async function load(seed: number, subject: "parent" | "mutant") {
  const id = `science-${subject}-${seed}`, folder = `${source}/cases/${id}`;
  const caseBytes = await Deno.readFile(`${folder}/case.json`);
  if (await sha(caseBytes) !== pinnedCases.get(id)) {
    throw new Error(`case differs from pinned engineering inventory: ${id}`);
  }
  const c: CaseResult = JSON.parse(new TextDecoder().decode(caseBytes));
  const caseSha256 = await digest(c);
  if ((await read(`${folder}/digest.json`)).sha256 !== caseSha256) {
    throw new Error(`case digest mismatch: ${id}`);
  }
  validateCase(c, {
    manifestHash: EXPECTED_MANIFEST,
    id,
    seed,
    subject,
    genome: genomeHex(genotypes[subject]),
  });
  const a = c.artifacts.find((a) => a.path === "grown.blck");
  if (!a || c.artifacts.filter((a) => a.path === "grown.blck").length !== 1) {
    throw new Error(`missing/duplicate grown artifact: ${id}`);
  }
  const bytes = await Deno.readFile(`${folder}/grown.blck`);
  const checkpointSha256 = await sha(bytes);
  if (bytes.length !== a.bytes || checkpointSha256 !== a.sha256) {
    throw new Error(`grown digest mismatch: ${id}`);
  }
  const state = decodeCheckpoint(bytes).state;
  const errors = validateState(state);
  if (errors.length) {
    throw new Error(`invalid grown state: ${errors.join(", ")}`);
  }
  const baseline = totalsOf(
    state.cfg,
    initialState(seed, genotypes[subject]).cells,
  );
  if (
    totalsOf(state.cfg, state.cells).matter !== baseline.matter ||
    ledgerResidual(baseline, state) !== 0n
  ) throw new Error(`grown conservation mismatch: ${id}`);
  if (
    stable(state.cfg) !== stable(worldConfig(seed)) || state.step !== 3000 ||
    stateHash(state) !== c.observation.states.grown.hash
  ) throw new Error(`grown identity mismatch: ${id}`);
  if (!c.observation.target) throw new Error(`missing original target: ${id}`);
  inputEvidence.push({ id, caseSha256, checkpointSha256 });
  return { state, target: c.observation.target, caseBytes };
}
let device: GPUDevice | undefined;
let accountingAttempted = false;
let lastDiagnosticPath: string | null = null;
try {
  const parentDir = out.includes("/")
    ? out.slice(0, out.lastIndexOf("/")) || "/"
    : ".";
  await Deno.mkdir(parentDir, { recursive: true });
  await Deno.mkdir(out);
  ownsOutput = true;
  const paths = [
    "experiments/recovery-severity/stage0.ts",
    "experiments/recovery-severity/parity.ts",
    "experiments/recovery-severity/budget.ts",
    "experiments/recovery-severity/continuity.ts",
    "experiments/recovery-severity/branch-diagnostic.ts",
    "experiments/recovery-severity/branch-record.ts",
    "experiments/recovery-severity/read-stage0.ts",
    "experiments/recovery-severity/attempt-gates.ts",
    "experiments/recovery-severity/selector.ts",
    "experiments/recovery-accessibility/observer.ts",
    "docs/recovery-severity-2026-10-24/PLAN.md",
    "docs/recovery-severity-2026-10-24/audit.json",
  ];
  const git = async (args: string[]) => {
    const r = await new Deno.Command("git", {
      args,
      stdout: "piped",
      stderr: "piped",
    }).output();
    if (!r.success) throw new Error("source capture failed");
    return new TextDecoder().decode(r.stdout);
  };
  const revision = {
    head: (await git(["rev-parse", "HEAD"])).trim(),
    patch: await git(["diff", "HEAD", "--"]),
  };
  const sourcePaths = [
    ...new Set([
      ...paths,
      ...(await git([
        "ls-files",
        "packages",
        "experiments/recovery-accessibility",
        "deno.json",
      ])).trim().split("\n"),
    ]),
  ];
  const sources = [];
  for (const path of sourcePaths) {
    sources.push({ path, sha256: await sha(await Deno.readFile(path)) });
  }
  await write("manifest.json", {
    protocol: STAGE0_VERSION,
    observerVersion: OBSERVER_VERSION,
    stage: "engineering-only",
    sourceManifest: EXPECTED_MANIFEST,
    revision,
    sources,
    runtime: Deno.version,
    maxMs: MAX_MS,
    maxBytes: MAX_BYTES,
    priorBudget: allowance.snapshot,
    startedAt: new Date(started).toISOString(),
    seeds: [2026102401, 2026102402],
    recoverySteps: 2000,
  });
  // Load and authenticate all four inputs before requesting a GPU or advancing time.
  const cases = [];
  for (const seed of [2026102401, 2026102402]) {
    const parent = await load(seed, "parent"),
      mutant = await load(seed, "mutant");
    guard();
    const p = enumerateCandidatesDetailed(parent.state, parent.target),
      m = enumerateCandidatesDetailed(mutant.state, mutant.target);
    const selected = selectPair(p.candidates, m.candidates);
    await write(`pair-${seed}-selection.json`, {
      seed,
      parent: p.counts,
      mutant: m.counts,
      selected,
    });
    if (!selected) {
      throw new Error("prescribed engineering pair is unmatchable");
    }
    cases.push({ seed, parent, mutant, selected });
  }
  await write("inputs.json", inputEvidence);
  device = await requestDevice(navigator.gpu);
  const gpu: Factory = async (s) => GpuSim.create(device!, s);
  const results = [];
  await Deno.mkdir(`${out}/execution-source`);
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
    ]
  ) {
    await writeBytes(
      `execution-source/${name}`,
      await Deno.readFile(`experiments/recovery-severity/${name}`),
    );
  }
  await writeBytes(
    "execution-source/observer.ts",
    await Deno.readFile("experiments/recovery-accessibility/observer.ts"),
  );
  for (const pair of cases) {
    for (const subject of ["parent", "mutant"] as const) {
      const { state, target } = pair[subject];
      await writeBytes(
        `${pair.seed}-${subject}-case.json`,
        pair[subject].caseBytes,
      );
      await writeBytes(
        `${pair.seed}-${subject}-grown.blck`,
        encodeCheckpoint(state),
      );
      for (const arm of ["legacy", "mass-targeted", "sham"] as const) {
        const disc: Disc | null = arm === "sham"
          ? null
          : arm === "legacy"
          ? target.lesion
          : pair.selected[subject];
        if (arm === "legacy" && !disc) {
          throw new Error("missing legacy lesion");
        }
        const id = `${pair.seed}-${subject}-${arm}`;
        const traces = [];
        for (
          const [name, factory, cadence] of [["cpu25", referenceBackend, 25], [
            "gpu25",
            gpu,
            25,
          ], ["gpu50", gpu, 50]] as const
        ) {
          const trace = await branchTrace(
            factory,
            state,
            target,
            disc,
            cadence,
            guard,
            async (phase, s) => {
              if (name === "gpu25") {
                await writeBytes(`${id}-${phase}.blck`, encodeCheckpoint(s));
              }
            },
          );
          traces.push(trace);
          await write(`${id}-${name}.json`, trace);
          console.log(`${id} ${name}: complete (${Date.now() - started} ms)`);
        }
        const post =
          decodeCheckpoint(await Deno.readFile(`${out}/${id}-post.blck`)).state;
        const diagnostic = diagnoseBranch(
          {
            id,
            arm,
            referenceMass: target.mass,
            startStep: state.step,
            injury: injuryFacts(
              state,
              post,
              target,
              traces[1].track.initialLabel,
              disc !== null,
            ),
          },
          traces[0],
          traces[1],
          traces[2],
        );
        const pin = (path: string) => {
          const a = artifacts.find((a) => a.path === path);
          if (!a) throw new Error(`missing branch evidence: ${path}`);
          return a;
        };
        const sourceSnapshots = [
          "stage0.ts",
          "parity.ts",
          "budget.ts",
          "continuity.ts",
          "branch-diagnostic.ts",
          "branch-record.ts",
          "read-stage0.ts",
          "attempt-gates.ts",
          "observer.ts",
        ].map((name) => {
          const sourcePath = name === "observer.ts"
            ? "experiments/recovery-accessibility/observer.ts"
            : `experiments/recovery-severity/${name}`;
          return { ...pin(`execution-source/${name}`), sourcePath };
        });
        const record: BranchRecord = {
          version: "recovery-severity-branch-record-v1",
          mode: "engineering-execution",
          diagnostic,
          evidence: {
            manifest: pin("manifest.json"),
            inputs: pin("inputs.json"),
            sourceCase: pin(`${pair.seed}-${subject}-case.json`),
            selection: pin(`pair-${pair.seed}-selection.json`),
            grown: pin(`${pair.seed}-${subject}-grown.blck`),
            post: pin(`${id}-post.blck`),
            final: pin(`${id}-final.blck`),
            cpu25: pin(`${id}-cpu25.json`),
            gpu25: pin(`${id}-gpu25.json`),
            gpu50: pin(`${id}-gpu50.json`),
            sources: sourceSnapshots,
          },
        };
        const diagnosticPath = `${id}-diagnostic.json`;
        lastDiagnosticPath = diagnosticPath;
        await finishBranch(
          record,
          diagnosticPath,
          write,
          (path) => Deno.readFile(`${out}/${path}`),
        );
        const T = diagnostic.endpoint.T;
        if (pair.seed === 2026102401) {
          // Repeat both GPU observation schedules; exact trace includes hashes, edges and outcomes.
          for (const [index, cadence] of [[1, 25], [2, 50]] as const) {
            const replay = await branchTrace(
              gpu,
              state,
              target,
              disc,
              cadence,
              guard,
            );
            await write(`${id}-replay${cadence}.json`, replay);
            if (stable(replay) !== stable(traces[index])) {
              throw new Error(`replay mismatch: ${id}/${cadence}`);
            }
          }
        }
        results.push({
          id,
          disc,
          T,
          diagnosticPath,
          finalHash: traces[1].rows.at(-1)!.identity,
        });
      }
    }
  }
  // Authenticate every saved artifact and source before publishing success.
  for (const a of artifacts) {
    const b = await Deno.readFile(`${out}/${a.path}`);
    if (b.length !== a.bytes || await sha(b) !== a.sha256) {
      throw new Error(`saved artifact mismatch: ${a.path}`);
    }
  }
  for (const s of sources) {
    if (await sha(await Deno.readFile(s.path)) !== s.sha256) {
      throw new Error(`source changed during attempt: ${s.path}`);
    }
  }
  for (const r of results) {
    const fast = await read(`${out}/${r.id}-gpu25.json`),
      slow = await read(`${out}/${r.id}-gpu50.json`);
    const savedDiagnostic = await readBranchRecord(
      r.diagnosticPath,
      (path) => Deno.readFile(`${out}/${path}`),
    );
    if (savedDiagnostic.diagnostic.stage0 !== "PASS") {
      throw new Error("saved Stage 0 gate failed");
    }
    const pair = cases.find((p) => r.id.startsWith(String(p.seed)))!;
    const subject = r.id.includes("-parent-") ? "parent" : "mutant";
    if (savedDiagnostic.diagnostic.endpoint.T !== r.T) {
      throw new Error("saved outcome mismatch");
    }
    for (const phase of ["post", "final"]) {
      const saved =
        decodeCheckpoint(await Deno.readFile(`${out}/${r.id}-${phase}.blck`))
          .state;
      assertConserved(pair[subject].state, saved);
      if (
        stateIdentity(saved) !==
          (phase === "post" ? fast.rows[0] : fast.rows.at(-1)).identity
      ) throw new Error("saved checkpoint mismatch");
    }
    if (pair.seed === 2026102401) {
      for (const cadence of [25, 50]) {
        if (
          stable(await read(`${out}/${r.id}-replay${cadence}.json`)) !==
            stable(cadence === 25 ? fast : slow)
        ) throw new Error("saved replay mismatch");
      }
    }
  }
  const result = {
    artifacts: [...artifacts],
    status: "STAGE0-PARITY-PASS",
    meaning:
      "Engineering parity only; no fresh scientific worlds or recovery advantage claim.",
    results,
    inputEvidence,
    elapsedMs: Date.now() - started,
    writtenBytes,
    scientificSeedsRun: 0,
  };
  const resultBytes = enc.encode(JSON.stringify(result, null, 2) + "\n");
  const digestBytes = enc.encode(
    JSON.stringify({ sha256: await digest(result) }, null, 2) + "\n",
  );
  accountingAttempted = true;
  await allowance.settle(
    out,
    resultBytes.length + digestBytes.length,
    async () => {
      await writeBytes("result-digest.json", digestBytes);
      await writeBytes("result.json", resultBytes);
    },
  );
  console.log(result.status);
} catch (e) {
  // Keep the failure marker even if the execution deadline has been reached.
  if (ownsOutput) {
    await Deno.writeTextFile(
      `${out}/failure.json`,
      JSON.stringify(
        {
          status: "TECHNICAL-STOP",
          branchDiagnostic: lastDiagnosticPath,
          error: String(e),
          elapsedMs: Date.now() - started,
          scientificSeedsRun: 0,
        },
        null,
        2,
      ) + "\n",
      { createNew: true },
    );
  }
  throw e;
} finally {
  device?.destroy();
  if (!accountingAttempted) {
    await allowance.settle(ownsOutput ? out : "/nonexistent-stage0-output");
  }
}
