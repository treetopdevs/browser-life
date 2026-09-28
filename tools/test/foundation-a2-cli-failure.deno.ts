/**
 * CPU-only A2 CLI failure integration tests. Requires the authenticated local
 * A1/source-1 artifacts. Each case clones the source tree into a temporary
 * repository; the GPU and garden boundaries are explicitly mocked. Nothing in
 * these tests is a simulated history or a scientific result.
 *
 * Run: deno test -A tools/test/foundation-a2-cli-failure.deno.ts
 */
import assert from "node:assert/strict";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  allocState,
  cellCount,
  CH,
  encodeGenome,
  generalistGenome,
  GENOME_CHANNELS,
} from "@bl/schema";
import { specConfig } from "@bl/runner";
import { extractCellPacket } from "../lib/foundation-transplant.ts";
import { prepareV2Start } from "../lib/foundation-serial-v2.ts";
import { sha256 } from "../lib/foundation-replay.ts";
import type { SourceIdentity } from "../lib/foundation-replay.ts";

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const sourcePlan = join(
  sourceRoot,
  "runs/foundations-next/serial-v2-stage-0-plan-v3/plan.json",
);
const deno = Deno.execPath();

async function command(cwd: string, args: string[]) {
  const result = await new Deno.Command(deno, {
    args,
    cwd,
    stdout: "piped",
    stderr: "piped",
  }).output();
  return {
    code: result.code,
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
  };
}

async function cloneFixture() {
  const temporary = await Deno.makeTempDir({ prefix: "a2-cli-failure-" });
  const root = await Deno.realPath(temporary); // macOS /var is a /private/var alias.
  for (const name of ["tools", "packages", "docs"]) {
    const copy = await new Deno.Command("cp", {
      args: ["-R", join(sourceRoot, name), join(root, name)],
      stdout: "piped",
      stderr: "piped",
    }).output();
    assert.equal(copy.code, 0, `copy ${name} failed`);
  }
  for (const name of ["deno.json", "deno.lock", "package.json"]) {
    await Deno.copyFile(join(sourceRoot, name), join(root, name));
  }
  await Deno.symlink(
    join(sourceRoot, "node_modules"),
    join(root, "node_modules"),
  );
  await Deno.mkdir(join(root, "runs/foundations-next"), { recursive: true });

  const frozen = JSON.parse(await Deno.readTextFile(sourcePlan)) as {
    a1PlanPath: string;
    inputPaths: { seedAudit: string; seedLedger: string };
  };
  const out = join(root, "runs/foundations-next/stage-0-test");
  const planArgs = [
    "run",
    "-A",
    "tools/foundation-serial-transfer-v2.ts",
    "--a1-dir",
    dirname(frozen.a1PlanPath),
    "--seed-audit",
    frozen.inputPaths.seedAudit,
    "--seed-ledger",
    frozen.inputPaths.seedLedger,
    "--out",
    out,
    "--max-seconds",
    "600",
  ];
  const executeArgs = [
    "run",
    "-A",
    "--preload",
    join(root, "fake-gpu.ts"),
    "tools/foundation-serial-transfer-v2.ts",
    "--execute",
    "--out",
    out,
  ];
  const gpuSentinel = join(root, "gpu-boundary-called");
  await Deno.writeTextFile(
    join(root, "fake-gpu.ts"),
    `
Object.defineProperty(navigator, "gpu", { configurable: true, value: {
  requestAdapter: async () => {
    await Deno.writeTextFile(${JSON.stringify(gpuSentinel)}, "requested");
    return { features: new Set(), info: { vendor: "CPU mock", architecture: "none",
      device: "none", description: "test-only boundary" },
      requestDevice: async () => ({ destroy() {} }) };
  },
} });
`,
  );
  return {
    root,
    out,
    planArgs,
    executeArgs,
    gpuSentinel,
    cleanup: () => Deno.remove(temporary, { recursive: true }),
  };
}

async function makePlan(fixture: Awaited<ReturnType<typeof cloneFixture>>) {
  const planned = await command(fixture.root, fixture.planArgs);
  assert.equal(planned.code, 0, planned.stderr);
  const plan = JSON.parse(
    await Deno.readTextFile(join(fixture.out, "plan.json")),
  );
  assert.equal(plan.status, "planned");
  assert.equal(plan.arms.length, 4);
}

Deno.test("A2 rejects live on-disk source drift before requesting a GPU", async () => {
  const fixture = await cloneFixture();
  try {
    await makePlan(fixture);
    const path = join(fixture.root, "docs/foundations-serial-transfer-v2.md");
    await Deno.writeTextFile(
      path,
      `${await Deno.readTextFile(path)}\nTEST SOURCE DRIFT\n`,
    );
    const executed = await command(fixture.root, fixture.executeArgs);
    assert.notEqual(executed.code, 0);
    const result = JSON.parse(
      await Deno.readTextFile(join(fixture.out, "result.json")),
    );
    assert.equal(result.status, "failed");
    assert.match(result.failure, /changed before GPU/);
    assert.equal(result.runtime.adapter, null);
    await assert.rejects(Deno.stat(fixture.gpuSentinel), Deno.errors.NotFound);
    await assert.rejects(
      Deno.stat(
        join(
          fixture.root,
          "runs/foundations-next/seed-use-640020101/reservation.json",
        ),
      ),
      Deno.errors.NotFound,
    );
  } finally {
    await fixture.cleanup();
  }
});

Deno.test("A2 records partial progress and terminal receipt on a mid-garden cap", async () => {
  const fixture = await cloneFixture();
  try {
    // Replace only the run boundary in this temporary repository. The CLI,
    // planning, source checks, result writer, and receipt writer remain real.
    await Deno.writeTextFile(
      join(fixture.root, "tools/lib/foundation-serial-v2-run.ts"),
      `
export async function runV2Garden(_device: unknown, _start: unknown, _host: unknown,
  _check: unknown, progress: (row: unknown) => Promise<void>) {
  await progress({ step: 25, phase: "mock-partial" });
  const { V2TimeCapError } = await import("../foundation-serial-transfer-v2.ts");
  throw new V2TimeCapError("injected cap after partial");
}
`,
    );
    await makePlan(fixture);
    const planBytes = await Deno.readFile(join(fixture.out, "plan.json"));
    const executed = await command(fixture.root, fixture.executeArgs);
    assert.notEqual(executed.code, 0);
    await Deno.stat(fixture.gpuSentinel); // the mock boundary, never a physical GPU.
    const resultPath = join(fixture.out, "result.json");
    const resultBytes = await Deno.readFile(resultPath);
    const result = JSON.parse(new TextDecoder().decode(resultBytes));
    assert.equal(result.status, "incomplete-time-cap");
    assert.equal(result.rows[0].status, "incomplete-time-cap");
    assert.deepEqual(result.rows[0].partial, {
      step: 25,
      phase: "mock-partial",
    });
    assert.equal(result.rows[0].outcome, null);
    assert.equal(result.rows[1].status, "planned");
    assert.equal(result.postExecutionRevalidated, false);
    assert.ok(result.endedAt);

    const receiptDir = join(
      fixture.root,
      "runs/foundations-next/seed-use-640020101",
    );
    const reservationBytes = await Deno.readFile(
      join(receiptDir, "reservation.json"),
    );
    const reservation = JSON.parse(new TextDecoder().decode(reservationBytes));
    const completion = JSON.parse(
      await Deno.readTextFile(join(receiptDir, "completion.json")),
    );
    assert.equal(reservation.planFile.sha256, sha256(planBytes).sha256);
    assert.equal(reservation.outputPath, fixture.out);
    assert.equal(completion.status, "incomplete-time-cap");
    assert.equal(
      completion.reservationFile.sha256,
      sha256(reservationBytes).sha256,
    );
    assert.equal(completion.resultFile.sha256, sha256(resultBytes).sha256);

    // A failed attempt is still a use of that plan/output; createNew refuses a retry.
    const second = await command(fixture.root, fixture.executeArgs);
    assert.notEqual(second.code, 0);
    assert.match(second.stderr, /already exists|AlreadyExists/i);
    assert.deepEqual(await Deno.readFile(resultPath), resultBytes);
  } finally {
    await fixture.cleanup();
  }
});

Deno.test("A2 rejects malformed packet geometry during CPU preparation", () => {
  const source = {
    runId: "m4/gradient-m3/treatment/seed-1",
    spec: {
      experiment: "m4",
      presetId: "gradient-m3",
      condition: "treatment",
      seed: 1,
      steps: 1_000_000,
      censusEvery: 100,
      deepEvery: 500,
      checkpointEvery: 0,
    },
  } as SourceIdentity;
  const state = allocState(specConfig(source.spec));
  const n = cellCount(state.cfg);
  const sites = [
    128 * 256 + 128,
    128 * 256 + 129,
    129 * 256 + 128,
    129 * 256 + 129,
  ];
  const words = encodeGenome(
    generalistGenome(state.cfg.defaultMu, state.cfg.defaultSigma),
    0,
    1,
  );
  for (const i of sites) {
    state.cells[CH.B * n + i] = 75;
    state.cells[CH.A * n + i] = 32;
    for (let g = 0; g < GENOME_CHANNELS; g++) {
      state.genome[g * n + i] = words[g];
    }
  }
  const intact = extractCellPacket(state, sites);
  assert.equal(
    prepareV2Start(source, 0, "donor", intact).eligibleRootsAtStep0,
    1,
  );
  const malformed = { ...intact, sourceWorldW: intact.sourceWorldW + 1 };
  assert.throws(
    () => prepareV2Start(source, 0, "donor", malformed),
    /packet source geometry\/configuration mismatch/,
  );
});
