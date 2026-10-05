// Operational adapter for unchanged, frozen histories. Assays require a later allocation.
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { statfsSync } from "node:fs";
import { encodeCheckpoint, DEFAULT_RULE_VERSION, stateHash } from "@bl/schema";
import { sha256 } from "./lib/founder-policy.ts";
import {
  loadCheckpointChain,
  type Manifest,
  validateManifest,
  writeNew,
} from "./lib/discovery-improvement-runtime.ts";
import { validatePilotDesign } from "./discovery_competition_pilot.ts";
import { discoveryEvolutionWorld } from "./lib/discovery-evolution.ts";
const adapterPath = resolve("tools/discovery_improvement_adapter.generated.ts");
const marker = "if (import.meta.main) {";
export function adapterText(source: string): string {
  const index = source.lastIndexOf(marker);
  if (index < 0 || source.indexOf(marker) !== index) {
    throw Error("runner dispatch marker drift");
  }
  return source.slice(0, index) +
    "\nexport { advanceHistory, executeAssay, sourceHashes, hashMap, pilotEvidence, eligiblePilot, sortedEdges };\n";
}
export function mapped(path: string, oldRoot: string, root: string): string {
  const rel = relative(oldRoot, path);
  if (rel === ".." || rel.startsWith("../") || isAbsolute(rel)) {
    throw Error(`unmapped frozen path ${path}`);
  }
  return join(root, rel);
}
async function json(path: string): Promise<any> {
  return JSON.parse(await Deno.readTextFile(path));
}
async function present(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return false;
    throw e;
  }
}
async function adapter(manifest: Manifest) {
  const source = await Deno.readTextFile("tools/discovery_improvement.ts");
  if (
    sha256(new TextEncoder().encode(source)) !==
      manifest.sources["tools/discovery_improvement.ts"]
  ) throw Error("runner source drift");
  const expected = adapterText(source);
  if (await present(adapterPath)) {
    if (await Deno.readTextFile(adapterPath) !== expected) {
      throw Error("generated adapter drift");
    }
  } else await Deno.writeTextFile(adapterPath, expected, { createNew: true });
  return await import(new URL(`file://${adapterPath}`).href);
}
export interface Allocation {
  format: "discovery-improvement-history-allocation/v1";
  manifestHash: string;
  manifestSha256: string;
  sourceManifestHash: string;
  globalPriorSeconds: number;
  globalCapSeconds: number;
  routingPath: string;
  routingSha256: string;
  priorReceiptDir: string;
  engineeringReserveSeconds: number;
  engineeringReserveInvocations: number;
  executionSources: Record<string, string>;
  hosts: {
    id: string;
    root: string;
    outputRel: string;
    unitIds: string[];
    capSeconds: number;
    maxInvocations: number;
    estimatedStorageBytes: number;
  }[];
  priorInvocations: number;
  minimumFreeBytes: number;
  reservationSeconds: number;
}
export function validateAllocation(a: Allocation, m: Manifest): void {
  const positive = (x: number) => Number.isFinite(x) && x > 0;
  if (
    a.format !== "discovery-improvement-history-allocation/v1" ||
    a.manifestHash !== m.manifestHash ||
    a.sourceManifestHash !== m.sourceManifestHash ||
    a.globalCapSeconds !== 345600 || a.reservationSeconds !== 3600 ||
    a.minimumFreeBytes < 20 * 1024 ** 3 || !positive(a.minimumFreeBytes) ||
    !Number.isFinite(a.globalPriorSeconds) || a.globalPriorSeconds < 0 ||
    !Number.isInteger(a.priorInvocations) || a.priorInvocations < 0 ||
    a.hosts.length !== 2
  ) throw Error("invalid allocation identity/budget");
  const units = a.hosts.flatMap((h) => h.unitIds);
  if (
    new Set(a.hosts.map((h) => h.id)).size !== 2 ||
    units.length !== m.units.length || new Set(units).size !== units.length ||
    m.units.some((u) => !units.includes(u.id))
  ) throw Error("allocation must partition complete fixed unit roster");
  if (
    a.globalPriorSeconds + a.engineeringReserveSeconds +
          a.hosts.reduce((n, h) => n + h.capSeconds, 0) > a.globalCapSeconds ||
    a.priorInvocations + a.engineeringReserveInvocations +
          a.hosts.reduce((n, h) => n + h.maxInvocations, 0) > 576
  ) throw Error("aggregate resource envelope exceeded");
  for (const h of a.hosts) {
    if (
      !positive(h.capSeconds) || !Number.isInteger(h.maxInvocations) ||
      h.maxInvocations <= 0 || !positive(h.estimatedStorageBytes)
    ) throw Error("invalid host reservation");
  }
}
async function verify(manifestPath: string, allocation: Allocation) {
  const bytes = await Deno.readFile(manifestPath),
    m = validateManifest(JSON.parse(new TextDecoder().decode(bytes))),
    root = await Deno.realPath(Deno.cwd());
  validateAllocation(allocation, m);
  if (
    sha256(bytes) !== allocation.manifestSha256 ||
    m.ruleVersion !== DEFAULT_RULE_VERSION
  ) throw Error("manifest bytes/rule drift");
  for (const [path, hash] of Object.entries(allocation.executionSources)) {
    if (sha256(await Deno.readFile(join(root, path))) !== hash) {
      throw Error(`operational source drift ${path}`);
    }
  }
  for (
    const path of [
      "tools/discovery_improvement_shard.ts",
      "tools/discovery_improvement_shard_continue.py",
    ]
  ) {
    if (!allocation.executionSources[path]) {
      throw Error("operational release incomplete");
    }
  }
  const routingBytes = await Deno.readFile(join(root, allocation.routingPath));
  if (sha256(routingBytes) !== allocation.routingSha256) {
    throw Error("routing identity drift");
  }
  const routing = JSON.parse(new TextDecoder().decode(routingBytes));
  let prior = 0;
  if (
    routing.manifestHash !== m.manifestHash ||
    routing.priorInvocations.length !== allocation.priorInvocations ||
    allocation.engineeringReserveSeconds !== 1000 ||
    allocation.engineeringReserveInvocations !== 2
  ) throw Error("prior/engineering envelope mismatch");
  for (const entry of routing.priorInvocations) {
    const b = await Deno.readFile(
      join(root, allocation.priorReceiptDir, entry.path.split("/").at(-1)),
    );
    if (sha256(b) !== entry.sha256) throw Error("prior receipt drift");
    const r = JSON.parse(new TextDecoder().decode(b));
    if (
      r.manifestHash !== m.manifestHash ||
      r.releaseSha256 !== routing.releaseSha256 ||
      r.elapsedSeconds !== entry.elapsedSeconds
    ) throw Error("prior identity drift");
    prior += r.elapsedSeconds;
  }
  if (prior !== allocation.globalPriorSeconds) {
    throw Error("prior debit mismatch");
  }
  for (const host of allocation.hosts) {
    if (
      JSON.stringify(host.unitIds) !==
        JSON.stringify(routing.hosts[host.id]?.unitIds) ||
      host.capSeconds !== routing.hosts[host.id]?.proposedCapSeconds ||
      host.maxInvocations !== routing.hosts[host.id]?.proposedMaxInvocations
    ) throw Error("routing ownership drift");
  }
  const helpers = await adapter(m), actual = await helpers.sourceHashes(root);
  if (
    JSON.stringify(actual) !== JSON.stringify(m.sources) ||
    helpers.hashMap(actual) !== m.sourceManifestHash
  ) throw Error("full source closure drift");
  for (const [path, hash] of Object.entries(m.inputs)) {
    if (
      sha256(await Deno.readFile(mapped(path, m.sourceRoot, root))) !== hash
    ) throw Error(`input drift ${path}`);
  }
  const pilotDir = join(
      root,
      "experiments/founder-discovery/v1/competition-pilot",
    ),
    designBytes = await Deno.readFile(join(pilotDir, "pilot-design.json")),
    analysisBytes = await Deno.readFile(join(pilotDir, "final-analysis.json"));
  if (
    sha256(designBytes) !== m.pilotDesignSha256 ||
    sha256(analysisBytes) !== m.pilotAnalysisSha256
  ) throw Error("pilot identity drift");
  const design = validatePilotDesign(
    JSON.parse(new TextDecoder().decode(designBytes)),
  );
  for (const records of [design.sources, design.inputs]) {
    for (const [path, hash] of Object.entries(records)) {
      if (
        sha256(
          await Deno.readFile(
            isAbsolute(path)
              ? mapped(path, m.sourceRoot, root)
              : join(root, path),
          ),
        ) !== hash
      ) {
        throw Error(`pilot closure drift ${path}`);
      }
    }
  }
  // Run the original eligibility reconstruction under the verified explicit relocation.
  // Its sole filesystem verifier is replaced in a separate derived module below.
  const pilotSource = await Deno.readTextFile("tools/discovery_improvement.ts"),
    replacement = "await verifyFrozenPilot(design);";
  if (pilotSource.split(replacement).length !== 2) {
    throw Error("pilot verifier marker drift");
  }
  const relocated = adapterText(
    pilotSource.replace(
      replacement,
      "/* Mapped closure verified by operational caller. */",
    ),
  );
  const relocatedPath = resolve(
    "tools/discovery_improvement_pilot_adapter.generated.ts",
  );
  if (await present(relocatedPath)) {
    if (await Deno.readTextFile(relocatedPath) !== relocated) {
      throw Error("pilot adapter drift");
    }
  } else {await Deno.writeTextFile(relocatedPath, relocated, {
      createNew: true,
    });}
  await (await import(new URL(`file://${relocatedPath}`).href)).eligiblePilot(
    pilotDir,
  );
  return { m, helpers, root };
}
function contained(root: string, path: string) {
  const rel = relative(root, path);
  if (!rel || rel === ".." || rel.startsWith("../") || isAbsolute(rel)) {
    throw Error("output must be under runs/");
  }
}
async function run(
  manifestPath: string,
  allocationPath: string,
  hostId: string,
  out: string,
  seconds: number,
) {
  const invocationStarted = performance.now();
  const allocationBytes = await Deno.readFile(allocationPath),
    a = JSON.parse(new TextDecoder().decode(allocationBytes)) as Allocation,
    allocationHash = sha256(allocationBytes),
    { m, helpers, root } = await verify(manifestPath, a),
    host = a.hosts.find((h) => h.id === hostId);
  if (!host || !Number.isFinite(seconds) || seconds <= 0 || seconds > 600) {
    throw Error("unknown host/tranche");
  }
  if (root !== host.root || out !== resolve(root, host.outputRel)) {
    throw Error("host root/output binding mismatch");
  }
  for (const name of ["RUNNING", "SUPERVISOR"]) {
    if (await present(join(out, name))) {
      throw Error("legacy worker lock active");
    }
  }
  if (await present(join(out, "histories"))) {
    for await (const e of Deno.readDir(join(out, "histories"))) {
      if (!host.unitIds.includes(e.name)) {
        throw Error("unassigned history present");
      }
    }
  }
  contained(join(root, "runs"), out);
  await Deno.mkdir(out, { recursive: true });
  const lock = join(out, "SHARD_RUNNING");
  await Deno.writeTextFile(
    lock,
    JSON.stringify({ pid: Deno.pid, hostId, allocationHash }),
    { createNew: true },
  );
  let reservationPath: string | null = null;
  const started = invocationStarted;
  try {
    let charged = 0, count = 0;
    for await (const e of Deno.readDir(out)) {
      if (e.name.startsWith("parent-invocation-") && e.name.endsWith(".json")) {
        const r = await json(join(out, e.name));
        if (
          r.allocationHash !== allocationHash || r.hostId !== hostId ||
          !Number.isFinite(r.chargedSeconds) || r.chargedSeconds < 0
        ) throw Error("invocation identity drift");
        charged += r.chargedSeconds;
        count++;
      }
    }
    if (charged > host.capSeconds || count > host.maxInvocations) {
      throw Error("host resource reservation exhausted");
    }
    const parentPath = Deno.env.get("BL_SHARD_RESERVATION");
    if (!parentPath || dirname(parentPath) !== out) {
      throw Error("active supervisor reservation required");
    }
    const parentRecord = await json(parentPath);
    if (
      parentRecord.allocationHash !== allocationHash ||
      parentRecord.hostId !== hostId || parentRecord.status !== "reserved" ||
      parentRecord.chargedSeconds !== 3600
    ) throw Error("invalid parent reservation");
    reservationPath = join(
      out,
      `shard-invocation-${Date.now()}-${Deno.pid}.json`,
    );
    const record = {
      allocationHash,
      hostId,
      startedAt: new Date().toISOString(),
      chargedSeconds: a.reservationSeconds,
      status: "reserved",
    };
    await writeNew(reservationPath, JSON.stringify(record) + "\n");
    const fs = statfsSync(out);
    if (
      Number(fs.bavail) * Number(fs.bsize) <
        a.minimumFreeBytes + (count === 1 ? host.estimatedStorageBytes : 0)
    ) throw Error("host storage envelope insufficient");
    let device: GPUDevice | null = null, newCheckpoints = 0, complete = true;
    try {
      for (const id of host.unitIds) {
        const unit = m.units.find((u) => u.id === id)!;
        let latest = await loadCheckpointChain(
          join(out, "histories", id),
          m,
          unit,
        );
        while ((latest?.state.step ?? -100000) < 1000000) {
          if ((performance.now() - started) / 1000 >= seconds) break;
          if (
            Number(statfsSync(out).bavail) * Number(statfsSync(out).bsize) <
              a.minimumFreeBytes
          ) throw Error("storage floor reached");
          if (!device) {
            device = await (await import("@bl/sim-gpu")).requestDevice(
              navigator.gpu,
              discoveryEvolutionWorld(unit.seed, unit.mode, unit.founderHex)
                .state.cfg,
            );
          }
          latest = await helpers.advanceHistory(device, out, m, unit, latest);
          newCheckpoints++;
          if ((performance.now() - started) / 1000 > a.reservationSeconds) {
            throw Error("atomic boundary exceeded reservation; fail closed");
          }
        }
        if ((latest?.state.step ?? 0) < 1000000) {
          complete = false;
          break;
        }
      }
    } finally {
      device?.destroy();
    }
    await verify(manifestPath, a);
    if (sha256(await Deno.readFile(allocationPath)) !== allocationHash) {
      throw Error("allocation drift");
    }
    const elapsed = (performance.now() - started) / 1000;
    const settlement = reservationPath + ".settlement";
    await Deno.writeTextFile(
      settlement,
      JSON.stringify({
        ...record,
        chargedSeconds: elapsed + 5,
        status: "settled",
        finishedAt: new Date().toISOString(),
        newCheckpoints,
      }) + "\n",
      { createNew: true },
    );
    await Deno.rename(settlement, reservationPath);
    console.log(
      JSON.stringify({
        hostId,
        newCheckpoints,
        elapsedSeconds: elapsed,
        complete,
      }),
    );
  } finally {
    await Deno.remove(lock);
  }
}
async function probe(
  manifestPath: string,
  allocationPath: string,
  report: string,
) {
  const { m, helpers } = await verify(manifestPath, await json(allocationPath));
  const results = [];
  const { GpuSim, requestDevice } = await import("@bl/sim-gpu");
  for (const mode of ["normal", "off"] as const) {
    const unit = m.units.find((u) => u.mode === mode)!,
      initial = discoveryEvolutionWorld(unit.seed, mode, unit.founderHex).state,
      device = await requestDevice(navigator.gpu, initial.cfg),
      sim = await GpuSim.create(device, initial),
      events = [];
    try {
      for (let step = 100; step <= 10000; step += 100) {
        sim.run(100);
        await device.queue.onSubmittedWorkDone();
        const ledger = await sim.drainLedger();
        if (
          ledger.step !== step || ledger.dropped !== 0 ||
          (mode === "off" && ledger.events.length)
        ) throw Error("probe ledger drift");
        events.push(...ledger.events);
      }
      const final = await sim.readState();
      if (mode === "normal" && events.length === 0) {
        throw Error("probe has no mutations; insufficient lineage evidence");
      }
      results.push({
        unitId: unit.id,
        mode,
        steps: 10000,
        initialStateHash: stateHash(initial),
        finalStateHash: stateHash(final),
        checkpointSha256: sha256(encodeCheckpoint(final)),
        sortedLedgerHash: sha256(JSON.stringify(helpers.sortedEdges(events))),
        eventCount: events.length,
      });
    } finally {
      sim.destroy();
      device.destroy();
    }
  }
  await writeNew(
    report,
    JSON.stringify(
      {
        format: "engineering-frozen-study-probe/v1",
        manifestHash: m.manifestHash,
        sourceManifestHash: m.sourceManifestHash,
        results,
      },
      null,
      2,
    ) + "\n",
  );
}
if (import.meta.main) {
  const [command, ...args] = Deno.args;
  if (command === "run" && args.length === 5) {
    await run(
      resolve(args[0]),
      resolve(args[1]),
      args[2],
      resolve(args[3]),
      Number(args[4]),
    );
  } else if (command === "verify" && args.length === 2) {
    await verify(resolve(args[0]), await json(resolve(args[1])));
    console.log("verified");
  } else if (command === "probe" && args.length === 3) {
    await probe(resolve(args[0]), resolve(args[1]), resolve(args[2]));
  } else {throw Error(
      "usage: verify MANIFEST ALLOCATION | run MANIFEST ALLOCATION HOST OUT SECONDS | probe MANIFEST ALLOCATION NEW_REPORT",
    );}
}
