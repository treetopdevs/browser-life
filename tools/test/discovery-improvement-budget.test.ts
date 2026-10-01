import { join, relative, resolve } from "node:path";
import { sha256 } from "../lib/founder-policy.ts";
import {
  budget,
  validateAssayHostEnvelope,
} from "../discovery_improvement_assay.ts";
import {
  assertHistoryLaunchAuthorized,
  payloadHash,
  type SuccessorLedger,
  type SuccessorPayload,
  summarizeSuccessor,
  validateCpuOperations,
  validateSettledParents,
  verifySuccessorLedger,
} from "../discovery_improvement_budget.ts";
function assert(x: unknown): asserts x {
  if (!x) throw Error("assertion failed");
}
function fails(f: () => unknown) {
  let failed = false;
  try {
    f();
  } catch {
    failed = true;
  }
  assert(failed);
}
async function rejects(f: () => Promise<unknown>) {
  let failed = false;
  try {
    await f();
  } catch {
    failed = true;
  }
  assert(failed);
}
const a = JSON.parse(
  await Deno.readTextFile(
    "experiments/founder-discovery/v1/improvement-study/distribution-v1/allocation.json",
  ),
);
Deno.test("successor replaces retired local reservation once and preserves failed CPU charges", () => {
  const p = {
    retirements: [{
      hostId: "local",
      actualSeconds: 22942.16142741812,
      actualInvocations: 35,
    }],
    cpu: {
      priorReserveSeconds: 3600,
      reserveSeconds: 13600,
      transferSeconds: 10000,
      priorChargedSeconds: 1900,
    },
  } as SuccessorPayload;
  const proof = summarizeSuccessor(a, p, {
    seconds: 22942.16142741812,
    invocations: 35,
    cpuCharged: 1900,
  });
  assert(
    proof.recoveredUnallocatedInvocations === 135 &&
      proof.remainingInvocations === 290 &&
      proof.cpuFutureAvailableSeconds === 11700,
  );
  assert(
    Math.abs((345600 - proof.remainingSeconds + 86000) - 278022.10751829314) <
      1e-8,
  );
  assert(Math.abs((proof.remainingSeconds - 86000) - 67577.89248170686) < 1e-8);
  assert(budget(a).cpuReservedSeconds === 3600);
  assert(budget(a, proof).cpuReservedSeconds === 13600);
  const assayHosts = a.hosts.map((h: any) => ({
    ...h,
    keys: [],
    capSeconds: 43000,
    maxInvocations: 75,
  }));
  validateAssayHostEnvelope(assayHosts, true);
  fails(() =>
    validateAssayHostEnvelope(
      assayHosts.map((h: any, i: number) =>
        i === 0 ? { ...h, capSeconds: 50000 } : h
      ),
      true,
    )
  );
  fails(() =>
    validateAssayHostEnvelope(
      assayHosts.map((h: any, i: number) =>
        i === 1 ? { ...h, maxInvocations: 100 } : h
      ),
      true,
    )
  );
  const administrative = {
    format: "discovery-improvement-budget-successor/v1",
    status: "REVIEWED",
    payload: p,
  } as SuccessorLedger;
  fails(() => assertHistoryLaunchAuthorized(administrative, "local"));
  assertHistoryLaunchAuthorized(administrative, "work-mac");

  fails(() =>
    summarizeSuccessor(a, {
      ...p,
      retirements: [...p.retirements, ...p.retirements],
    }, { seconds: 22942.16142741812, invocations: 35, cpuCharged: 1900 })
  );
  fails(() =>
    summarizeSuccessor(a, {
      ...p,
      retirements: [{ ...p.retirements[0], hostId: "remote" }],
    }, { seconds: 22942.16142741812, invocations: 35, cpuCharged: 1900 })
  );
  fails(() =>
    summarizeSuccessor(a, p, {
      seconds: 100001,
      invocations: 35,
      cpuCharged: 1900,
    })
  );
  assert(
    validateCpuOperations(
      [{ releaseSha256: "r", status: "reserved", chargedSeconds: 600 }, {
        releaseSha256: "r",
        status: "failed",
        chargedSeconds: 600,
      }],
      "r",
      600,
    ) === 1200,
  );
  fails(() =>
    validateCpuOperations(
      [{ releaseSha256: "r", status: "reserved", chargedSeconds: 1 }],
      "r",
      600,
    )
  );
  fails(() =>
    validateSettledParents(
      [{
        allocationHash: "a",
        hostId: "remote",
        status: "settled",
        chargedSeconds: 1,
        supervisorPid: 1,
      }],
      "a",
      "local",
    )
  );
  fails(() =>
    validateSettledParents(
      [{
        allocationHash: "a",
        hostId: "local",
        status: "reserved",
        chargedSeconds: 3600,
        supervisorPid: 1,
      }],
      "a",
      "local",
    )
  );
});
Deno.test("reviewed successor verifies pinned raw closure and immutable CPU prefix, rejects drift", async () => {
  const dir = resolve("runs", `.budget-test-${crypto.randomUUID()}`);
  await Deno.mkdir(dir, { recursive: true });
  try {
    const closureDir = join(dir, "closed"), cpuDir = join(dir, "cpu");
    await Deno.mkdir(closureDir);
    await Deno.mkdir(cpuDir);
    const allocationSha = sha256(
        await Deno.readFile(
          "experiments/founder-discovery/v1/improvement-study/distribution-v1/allocation.json",
        ),
      ),
      pin = async (p: string) => ({
        path: relative(Deno.cwd(), p),
        sha256: sha256(await Deno.readFile(p)),
      });
    const terminalLog = {
      hostId: "local",
      complete: true,
      newCheckpoints: 1,
      elapsedSeconds: 1,
    };
    await Deno.writeTextFile(
      join(closureDir, "shard-supervisor.log"),
      JSON.stringify(terminalLog) + "\n",
    );
    const files: any[] = [];
    for (let i = 1; i <= 35; i++) {
      const name = `parent-invocation-${i}-1.json`,
        raw = JSON.stringify({
          allocationHash: allocationSha,
          hostId: "local",
          status: "settled",
          chargedSeconds: i === 1 ? 22942.16142741812 : 0,
          supervisorPid: 1,
        });
      await Deno.writeTextFile(join(closureDir, name), raw);
      files.push({
        path: name,
        sha256: sha256(raw),
        bytes: new TextEncoder().encode(raw).length,
      });
    }
    const logBytes = await Deno.readFile(
      join(closureDir, "shard-supervisor.log"),
    );
    files.push({
      path: "shard-supervisor.log",
      sha256: sha256(logBytes),
      bytes: logBytes.length,
    });
    const host = a.hosts.find((h: any) => h.id === "local"),
      closure = {
        format: "discovery-history-host-closure/v1",
        hostId: "local",
        allocationSha256: allocationSha,
        originalRoot: resolve(host.root, host.outputRel),
        processEvidence: { locksAbsent: true, psExitCode: 1, stdout: "" },
        terminalLog,
        terminalHistorySteps: Object.fromEntries(
          host.unitIds.map((id: string) => [id, 1000000]),
        ),
        parentReceiptCount: 35,
        chargedSeconds: 22942.16142741812,
        assignedRuntimeCapSeconds: 100000,
        unspentAllocationSeconds: 100000 - 22942.16142741812,
        files,
      };
    await Deno.writeTextFile(
      join(closureDir, "closure.json"),
      JSON.stringify(closure),
    );
    const closurePin = await pin(join(closureDir, "closure.json"));
    await Deno.writeTextFile(
      join(closureDir, "review.json"),
      JSON.stringify({
        format: "discovery-history-closure-review/v1",
        verdict: "clear",
        closureSha256: closurePin.sha256,
        reviewer: "synthetic fixture only",
      }),
    );
    const cpuRelease = join(dir, "cpu-release.json");
    await Deno.writeTextFile(
      cpuRelease,
      JSON.stringify({
        format: "discovery-importer-release/v1",
        allocationSha256: allocationSha,
        operationsCapSeconds: 3600,
        maximumOperationSeconds: 600,
      }),
    );
    const cpuReleasePin = await pin(cpuRelease),
      operationFiles: Record<string, string> = {};
    for (let i = 1; i <= 14; i++) {
      const name = `${String(i).padStart(3, "0")}-fixture.json`,
        raw = JSON.stringify({
          releaseSha256: cpuReleasePin.sha256,
          status: [8, 11, 12].includes(i) ? "reserved" : "settled",
          chargedSeconds: [8, 11, 12].includes(i) ? 600 : i === 1 ? 100 : 0,
        });
      await Deno.writeTextFile(join(cpuDir, name), raw);
      operationFiles[name] = sha256(raw);
    }
    const payload: SuccessorPayload = {
      predecessorAllocationSha256: allocationSha,
      retirements: [{
        hostId: "local",
        closure: closurePin,
        closureReview: await pin(join(closureDir, "review.json")),
        evidenceDirectory: relative(Deno.cwd(), closureDir),
        actualSeconds: 22942.16142741812,
        actualInvocations: 35,
      }],
      cpu: {
        priorReserveSeconds: 3600,
        reserveSeconds: 13600,
        transferSeconds: 10000,
        priorRelease: cpuReleasePin,
        snapshotDirectory: relative(Deno.cwd(), cpuDir),
        operationFiles,
        priorChargedSeconds: 1900,
      },
    };
    const decisionPath = join(dir, "decision.json");
    await Deno.writeTextFile(
      decisionPath,
      JSON.stringify({
        format: "discovery-improvement-budget-successor-review/v1",
        verdict: "approved",
        predecessorAllocationSha256: allocationSha,
        payloadSha256: payloadHash(payload),
        retiredHostIds: ["local"],
        reviewedBy: "synthetic fixture only",
        reviewedAt: new Date().toISOString(),
      }),
    );
    const ledger: SuccessorLedger = {
      format: "discovery-improvement-budget-successor/v1",
      status: "REVIEWED",
      payload,
      decision: await pin(decisionPath),
    };
    const proof = await verifySuccessorLedger(a, allocationSha, ledger);
    assert(proof.cpuPriorChargedSeconds === 1900);
    await rejects(() => verifySuccessorLedger(a, "0".repeat(64), ledger));
    await rejects(() =>
      verifySuccessorLedger(
        a,
        allocationSha,
        { ...ledger, status: "PREPARED" } as any,
      )
    );
    const target = join(cpuDir, "008-fixture.json"),
      original = await Deno.readFile(target);
    await Deno.writeTextFile(target, "{}\n");
    await rejects(() => verifySuccessorLedger(a, allocationSha, ledger));
    await Deno.writeFile(target, original);
    await Deno.writeTextFile(join(cpuDir, "015-extra.json"), "{}");
    await rejects(() => verifySuccessorLedger(a, allocationSha, ledger));
    await Deno.remove(join(cpuDir, "015-extra.json"));
    const parent = join(closureDir, "parent-invocation-1-1.json"),
      originalParent = await Deno.readFile(parent);
    await Deno.writeTextFile(parent, "{}\n");
    await rejects(() => verifySuccessorLedger(a, allocationSha, ledger));
    await Deno.writeFile(parent, originalParent);
    await Deno.symlink(cpuRelease, join(closureDir, "foreign-link"));
    await rejects(() => verifySuccessorLedger(a, allocationSha, ledger));
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
