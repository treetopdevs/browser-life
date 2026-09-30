import { stateHash } from "@bl/schema";
import { join, relative, resolve } from "node:path";
import { sha256 } from "../lib/founder-policy.ts";
import {
  type AssayResult,
  requestsFromSamples,
  type Sample,
  validateManifest,
} from "../lib/discovery-improvement-runtime.ts";
import {
  discoveryCompetitionConfig,
  discoveryCompetitionWorld,
} from "../lib/discovery-competition.ts";
import {
  budget,
  type Candidate,
  partition,
  validateRoster,
} from "../discovery_improvement_assay.ts";
import {
  type ClosureAttestation,
  exactHostRoster,
  expectedProvenance,
  globalCoverage,
  importAssays,
  sourceInventory,
  validateTerminalLog,
} from "../discovery_improvement_assay_import.ts";
function assert(x: unknown): asserts x {
  if (!x) throw Error("assertion failed");
}
async function rejects(f: () => Promise<unknown>, pattern: RegExp) {
  try {
    await f();
  } catch (e) {
    if (pattern.test(String(e))) return;
    throw e;
  }
  throw Error("expected rejection");
}
Deno.test("terminal host coverage includes empty hosts and rejects earlier complete log", () => {
  exactHostRoster({ "assay-supervisor.log": "a" }, []);
  let failed = false;
  try {
    validateTerminalLog(
      '{"complete":true,"hostId":"local"}\n{"complete":false,"hostId":"local"}',
      "local",
      0,
    );
  } catch {
    failed = true;
  }
  assert(failed);
  assert(globalCoverage(["a", "b"], ["a", "b"], [], []));
  assert(!globalCoverage(["a", "b"], ["a"], [], []));
  failed = false;
  try {
    exactHostRoster({ "assays/foreign.json": "a" }, []);
  } catch {
    failed = true;
  }
  assert(failed);
});
Deno.test("synthetic terminal host collection preserves bytes and requires both commit markers", async () => {
  const fixture = resolve("runs", `.assay-import-test-${crypto.randomUUID()}`);
  await Deno.mkdir(fixture, { recursive: true });
  try {
    const manifestPath = resolve(
        "experiments/founder-discovery/v1/improvement-study/manifest.json",
      ),
      allocationPath = resolve(
        "experiments/founder-discovery/v1/improvement-study/distribution-v1/allocation.json",
      ),
      m = validateManifest(JSON.parse(await Deno.readTextFile(manifestPath))),
      a = JSON.parse(await Deno.readTextFile(allocationPath));
    const samples = Object.fromEntries(
        m.units.map((
          u,
          ui,
        ) => [
          u.id,
          Object.fromEntries(m.times.map((time, t) => [time, {
            time,
            drawSeeds: u.drawSeeds[t],
            draws: ui === 0 && t === 0
              ? {
                status: "present",
                genomes: [u.founderHex, u.founderHex],
                unresolvedMass: 0,
              }
              : { status: "absent", genomes: [], unresolvedMass: 0 },
          } as Sample])),
        ]),
      ),
      roster = {
        manifestHash: m.manifestHash,
        ...requestsFromSamples(m, samples),
      },
      rosterPath = join(fixture, "synthetic-roster.json"),
      readyPath = join(fixture, "synthetic-readiness.json"),
      dest = join(fixture, "consolidation");
    await Deno.mkdir(dest);
    await Deno.mkdir(join(dest, "histories"));
    await Deno.writeTextFile(
      join(dest, "histories", "keep.txt"),
      "existing history untouched",
    );
    await Deno.writeTextFile(rosterPath, JSON.stringify(roster) + "\n");
    const statuses: Record<string, number> = {};
    for (const d of roster.draws) {
      statuses[d.status] = (statuses[d.status] ?? 0) + 1;
    }
    const ready = {
      format: "discovery-improvement-global-readiness/v1",
      manifestHash: m.manifestHash,
      manifestSha256: sha256(await Deno.readFile(manifestPath)),
      sourceManifestHash: m.sourceManifestHash,
      allocationSha256: sha256(await Deno.readFile(allocationPath)),
      consolidated: dest,
      physicalComplete: true,
      unexpected: [],
      slots: m.units.map((u) => ({ unitId: u.id, status: "complete" })),
      semanticCounts: {
        draws: 384,
        requests: 6144,
        uniqueConfigurations: roster.uniqueKeys.length,
        drawStatuses: statuses,
      },
      rosterSha256: sha256(await Deno.readFile(rosterPath)),
    };
    await Deno.writeTextFile(readyPath, JSON.stringify(ready));
    const records: any = {};
    for (
      const [k, p] of Object.entries({
        manifest: manifestPath,
        allocation: allocationPath,
        readiness: readyPath,
        roster: rosterPath,
      })
    ) {
      records[k] = {
        path: relative(Deno.cwd(), p),
        sha256: sha256(await Deno.readFile(p)),
      };
    }
    const sources: Record<string, string> = {};
    for (
      const p of [
        "tools/discovery_improvement_assay.ts",
        "tools/discovery_improvement_assay_continue.py",
        "tools/discovery_improvement_shard.ts",
        "tools/discovery_improvement_reconcile.ts",
        "tools/discovery_improvement_import.ts",
        "tools/discovery_improvement_adapter.generated.ts",
      ]
    ) sources[p] = sha256(await Deno.readFile(p));
    const divided = partition(roster.uniqueKeys, a.hosts.map((h: any) => h.id));
    const c: Candidate = {
      format: "discovery-improvement-assay-candidate/v1",
      status: "PREPARED",
      authorizesGpu: false,
      manifestHash: m.manifestHash,
      sourceManifestHash: m.sourceManifestHash,
      inputs: records,
      executionSources: sources,
      budget: budget(a),
      hosts: a.hosts.map((h: any) => ({
        id: h.id,
        root: h.root,
        outputRel: `runs/synthetic-assay-test-${h.id}-${crypto.randomUUID()}`,
        keys: divided[h.id],
        capSeconds: 43000,
        maxInvocations: 75,
      })),
      minimumFreeBytes: 20 * 1024 ** 3,
    };
    const candidatePath = join(fixture, "synthetic-candidate.json");
    await Deno.writeTextFile(candidatePath, JSON.stringify(c));
    const release = {
        format: "discovery-improvement-assay-release/v1" as const,
        status: "RELEASED" as const,
        candidatePath: relative(Deno.cwd(), candidatePath),
        candidateSha256: sha256(await Deno.readFile(candidatePath)),
        reviewedBy: "synthetic test fixture only",
        reviewReference: "not production",
        reviewedAt: new Date().toISOString(),
      },
      releasePath = join(fixture, "synthetic-release.json");
    await Deno.writeTextFile(releasePath, JSON.stringify(release));
    const releaseHash = sha256(await Deno.readFile(releasePath)),
      requests = validateRoster(
        m,
        roster,
        ready,
        await Deno.readFile(rosterPath),
      );
    for (const host of c.hosts) {
      const source = join(fixture, `staged-${host.id}`);
      await Deno.mkdir(join(source, "assays"), { recursive: true });
      await Deno.mkdir(join(source, "provenance"));
      for (const key of host.keys) {
        const request = requests.get(key)!,
          cfg = discoveryCompetitionConfig(request.seed),
          world = discoveryCompetitionWorld(
            cfg,
            request.descendantHex,
            request.founderHex,
            request.assignment,
          );
        const result: AssayResult = {
            format: "discovery-improvement-assay/v1",
            cacheKey: key,
            sourceManifestHash: m.sourceManifestHash,
            descendantHex: request.descendantHex,
            founderHex: request.founderHex,
            cfg,
            seed: request.seed,
            assignment: request.assignment,
            steps: 20000,
            initialStateHash: stateHash(world.state),
            finalStateHash: "0".repeat(16),
            descendantMass: 0,
            ancestorMass: 0,
            unassociatedMass: 0,
            status: "both-extinct",
            score: null,
            elapsedSeconds: 1,
          },
          raw = JSON.stringify(result) + "\n";
        await Deno.writeTextFile(join(source, "assays", `${key}.json`), raw);
        await Deno.writeTextFile(
          join(source, "provenance", `${key}.json`),
          JSON.stringify(
            expectedProvenance(
              c,
              m,
              release,
              releaseHash,
              host.id,
              key,
              sha256(raw),
            ),
          ) + "\n",
        );
      }
      await Deno.writeTextFile(
        join(source, "parent-invocation-1-1.json"),
        JSON.stringify({
          releaseHash,
          hostId: host.id,
          status: "settled",
          chargedSeconds: 1,
          supervisorPid: 1,
        }),
      );
      await Deno.writeTextFile(
        join(source, "assay-supervisor.log"),
        JSON.stringify({
          hostId: host.id,
          complete: true,
          newAssays: host.keys.length,
        }) + "\n",
      );
      const attestation: ClosureAttestation = {
          format: "discovery-improvement-assay-host-closure/v1",
          releaseSha256: releaseHash,
          hostId: host.id,
          originalRoot: host.root,
          originalOutputRel: host.outputRel,
          stagedSource: source,
          observedAt: new Date().toISOString(),
          attestedBy: "synthetic test fixture; no OS observation performed",
          osAssertions: {
            originalSupervisorAbsent: true,
            originalWorkerAbsent: true,
          },
          sourceFiles: await sourceInventory(source),
        },
        attestationPath = join(
          fixture,
          `synthetic-attestation-${host.id}.json`,
        );
      await Deno.writeTextFile(attestationPath, JSON.stringify(attestation));
      await rejects(
        () =>
          importAssays(
            releasePath,
            host.id,
            source,
            attestationPath,
            dest,
            join(
              a.hosts[0].root,
              a.hosts[0].outputRel,
              `must-not-write-${crypto.randomUUID()}.json`,
            ),
          ),
        /protected/,
      );
      const linkedSource = join(fixture, `linked-source-${host.id}`);
      await Deno.symlink(source, linkedSource);
      await rejects(
        () =>
          importAssays(
            releasePath,
            host.id,
            linkedSource,
            attestationPath,
            dest,
            join(fixture, `link-source-${host.id}.json`),
          ),
        /symlink/,
      );
      await Deno.remove(linkedSource);
      if (host.id === c.hosts[0].id) {
        const outside = join(fixture, "outside");
        await Deno.mkdir(outside);
        await Deno.symlink(outside, join(dest, "assay-host-closure"));
        await rejects(
          () =>
            importAssays(
              releasePath,
              host.id,
              source,
              attestationPath,
              dest,
              join(fixture, "nested-link.json"),
            ),
          /symlink/,
        );
        assert([...Deno.readDirSync(outside)].length === 0);
        await Deno.remove(join(dest, "assay-host-closure"));
      } else {
        const priorLedger = join(
            dest,
            "assay-host-closure",
            c.hosts[0].id,
            "parent-invocation-1-1.json",
          ),
          original = await Deno.readFile(priorLedger);
        await Deno.writeTextFile(priorLedger, "{}\n");
        await rejects(
          () =>
            importAssays(
              releasePath,
              host.id,
              source,
              attestationPath,
              dest,
              join(fixture, "prior-closure-drift.json"),
            ),
          /drift/,
        );
        await Deno.writeFile(priorLedger, original);
        const extraLedger = join(
          dest,
          "assay-host-closure",
          c.hosts[0].id,
          "parent-invocation-999-999.json",
        );
        await Deno.writeTextFile(
          extraLedger,
          JSON.stringify({ status: "reserved" }) + "\n",
        );
        await rejects(
          () =>
            importAssays(
              releasePath,
              host.id,
              source,
              attestationPath,
              dest,
              join(fixture, "prior-extra-ledger.json"),
            ),
          /missing\/extra evidence/,
        );
        await Deno.remove(extraLedger);
      }
      const external = join(fixture, `receipt-${host.id}.json`);
      const observation = await importAssays(
        releasePath,
        host.id,
        source,
        attestationPath,
        dest,
        external,
      );
      assert(observation.globalComplete === (host.id === c.hosts[1].id));
      assert(observation.unavailableReferences === 6112);
      assert(
        sha256(await Deno.readFile(attestationPath)) ===
          sha256(
            await Deno.readFile(
              join(
                dest,
                "assay-host-closure",
                host.id,
                "root-attestation.json",
              ),
            ),
          ),
      );
      await rejects(
        () =>
          importAssays(
            releasePath,
            host.id,
            source,
            attestationPath,
            dest,
            external,
          ),
        /already exists/,
      );

      const retry = await importAssays(
        releasePath,
        host.id,
        source,
        attestationPath,
        dest,
        join(fixture, `retry-${host.id}.json`),
      );
      assert(retry.globalResultCount === observation.globalResultCount);
      for (const key of host.keys) {
        assert(
          sha256(await Deno.readFile(join(source, "assays", `${key}.json`))) ===
            sha256(await Deno.readFile(join(dest, "assays", `${key}.json`))),
        );
      }
      await Deno.writeTextFile(join(source, "ASSAY_RUNNING"), "{}");
      await rejects(
        () =>
          importAssays(
            releasePath,
            host.id,
            source,
            attestationPath,
            dest,
            join(fixture, `lock-${host.id}.json`),
          ),
        /lock/,
      );
      await Deno.remove(join(source, "ASSAY_RUNNING"));
      await Deno.writeTextFile(join(source, "foreign.txt"), "extra");
      await rejects(
        () =>
          importAssays(
            releasePath,
            host.id,
            source,
            attestationPath,
            dest,
            join(fixture, `foreign-${host.id}.json`),
          ),
        /unexpected/,
      );
      await Deno.remove(join(source, "foreign.txt"));
    }
    assert(
      await Deno.readTextFile(join(dest, "histories", "keep.txt")) ===
        "existing history untouched",
    );
    const key = c.hosts[0].keys[0],
      target = join(dest, "assays", `${key}.json`);
    await Deno.writeTextFile(target, "conflicting\n");
    await rejects(
      () =>
        importAssays(
          releasePath,
          c.hosts[0].id,
          join(fixture, `staged-${c.hosts[0].id}`),
          join(fixture, `synthetic-attestation-${c.hosts[0].id}.json`),
          dest,
          join(fixture, "conflict.json"),
        ),
      /conflict|JSON/,
    );
  } finally {
    await Deno.remove(fixture, { recursive: true });
  }
});
