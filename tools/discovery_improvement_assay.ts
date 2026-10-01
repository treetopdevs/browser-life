// Operational assay execution. PREPARED candidates never authorize GPU execution.
// A reviewed release pins reconciler evidence; this verifier validates emitted requests,
// without inventing biological samples absent from the readiness report.
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { statfsSync } from "node:fs";
import { fromHex, toHex } from "./lib/selection-funnel-audit.ts";
import { sha256 } from "./lib/founder-policy.ts";
import {
  ASSAY_SEEDS,
  assayCacheKey,
  type AssayRequest,
  type AssayResult,
  type DrawRequest,
  type Manifest,
  TIMES,
  validateAssayResult,
  validateManifest,
  writeNew,
} from "./lib/discovery-improvement-runtime.ts";
import { discoveryCompetitionConfig } from "./lib/discovery-competition.ts";
import {
  adapterText,
  type Allocation,
  mapped,
  validateAllocation,
} from "./discovery_improvement_shard.ts";
import { noSymlinks } from "./discovery_improvement_import.ts";
export type Roster = {
  manifestHash: string;
  draws: DrawRequest[];
  assays: AssayRequest[];
  uniqueKeys: string[];
};
export type Request = {
  cacheKey: string;
  descendantHex: string;
  founderHex: string;
  seed: number;
  assignment: number;
};
import type {
  Pin,
  verifySuccessorLedger,
} from "./discovery_improvement_budget.ts";
type VerifiedSuccessor = Awaited<ReturnType<typeof verifySuccessorLedger>>;
export interface Candidate {
  format: "discovery-improvement-assay-candidate/v1";
  status: "PREPARED";
  authorizesGpu: false;
  manifestHash: string;
  sourceManifestHash: string;
  inputs: {
    manifest: { path: string; sha256: string };
    allocation: { path: string; sha256: string };
    readiness: { path: string; sha256: string };
    roster: { path: string; sha256: string };
  };
  successorBudgetLedger?: Pin;
  executionSources: Record<string, string>;
  budget: {
    globalCapSeconds: 345600;
    globalMaxInvocations: 576;
    historyReservedSeconds: number;
    historyReservedInvocations: number;
    engineeringReservedSeconds: number;
    engineeringReservedInvocations: number;
    cpuReservedSeconds: number;
    remainingSeconds: number;
    remainingInvocations: number;
    reservationSeconds: 3600;
  };
  hosts: {
    id: string;
    root: string;
    outputRel: string;
    keys: string[];
    capSeconds: number;
    maxInvocations: number;
  }[];
  minimumFreeBytes: number;
}
export interface Release {
  format: "discovery-improvement-assay-release/v1";
  status: "RELEASED";
  candidatePath: string;
  candidateSha256: string;
  reviewedBy: string;
  reviewReference: string;
  reviewedAt: string;
}
const same = (a: unknown, b: unknown) =>
    JSON.stringify(a) === JSON.stringify(b),
  hex = /^[0-9a-f]{64}$/;
async function exists(p: string) {
  try {
    await Deno.lstat(p);
    return true;
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return false;
    throw e;
  }
}
async function bytes(p: string) {
  await noSymlinks(p);
  const before = await Deno.lstat(p);
  if (!before.isFile) throw Error("expected regular file");
  const b = await Deno.readFile(p), after = await Deno.lstat(p);
  if (
    after.isSymlink || before.ino !== after.ino || before.size !== after.size ||
    before.mtime?.getTime() !== after.mtime?.getTime()
  ) throw Error("concurrent input drift");
  return b;
}
const parse = (b: Uint8Array) => JSON.parse(new TextDecoder().decode(b));
function within(root: string, p: string) {
  const rel = relative(root, p);
  return rel === "" ||
    (!isAbsolute(rel) && rel !== ".." && !rel.startsWith("../"));
}
function localPath(p: string) {
  if (isAbsolute(p) || !within(Deno.cwd(), resolve(p))) {
    throw Error("input must be relative within frozen root");
  }
  return resolve(p);
}
export function validateRoster(
  m: Manifest,
  r: Roster,
  readiness: any,
  raw?: Uint8Array,
): Map<string, Request> {
  if (
    !r || r.manifestHash !== m.manifestHash || !Array.isArray(r.draws) ||
    r.draws.length !== 384 || !Array.isArray(r.assays) ||
    r.assays.length !== 6144 || !Array.isArray(r.uniqueKeys) ||
    r.uniqueKeys.length > 2112 ||
    new Set(r.uniqueKeys).size !== r.uniqueKeys.length
  ) throw Error("global roster identity/completeness drift");
  if (
    readiness.format !== "discovery-improvement-global-readiness/v1" ||
    readiness.manifestHash !== m.manifestHash ||
    readiness.sourceManifestHash !== m.sourceManifestHash ||
    readiness.physicalComplete !== true ||
    !Array.isArray(readiness.unexpected) || readiness.unexpected.length ||
    !Array.isArray(readiness.slots) || readiness.slots.length !== 64 ||
    new Set(readiness.slots.map((s: any) => s.unitId)).size !== 64 ||
    m.units.some((u) =>
      !readiness.slots.some((s: any) =>
        s.unitId === u.id && s.status === "complete"
      )
    )
  ) throw Error("complete pinned reconciliation required");
  const expectedDraws: DrawRequest[] = [],
    expectedAssays: AssayRequest[] = [],
    keys = new Set<string>(),
    representatives = new Map<string, Request>(),
    statuses: Record<string, number> = {};
  let i = 0;
  for (const unit of m.units) {
    for (let t = 0; t < TIMES.length; t++) {
      const pair = r.draws.slice(i, i + 2);
      if (pair.length !== 2 || pair[0].status !== pair[1].status) {
        throw Error("paired sample status drift");
      }
      for (let draw = 0; draw < 2; draw++) {
        const actual = r.draws[i++],
          status = actual.status,
          descendantHex = actual.descendantHex;
        if (
          !["scheduled", "absent", "unresolved"].includes(status) ||
          (status === "scheduled"
            ? !(typeof descendantHex === "string" &&
              toHex(fromHex(descendantHex)) === descendantHex)
            : descendantHex !== null)
        ) throw Error("invalid/unavailable draw outcome");
        expectedDraws.push({
          id: `${unit.id}-t${TIMES[t]}-d${draw}`,
          unitId: unit.id,
          founderId: unit.founderId,
          founderHex: unit.founderHex,
          seed: unit.seed,
          mode: unit.mode,
          time: TIMES[t],
          draw,
          sampleSeed: unit.drawSeeds[t][draw],
          status,
          descendantHex,
        });
        statuses[status] = (statuses[status] ?? 0) + 1;
      }
    }
  }
  if (!same(expectedDraws, r.draws)) {
    throw Error("draw schedule/lineage identity drift");
  }
  for (const d of expectedDraws) {
    for (const seed of ASSAY_SEEDS) {
      for (let assignment = 0; assignment < 4; assignment++) {
        const key = d.status === "scheduled"
          ? assayCacheKey(
            d.descendantHex!,
            d.founderHex,
            seed,
            assignment,
            m.sourceManifestHash,
          )
          : null;
        expectedAssays.push({
          id: `${d.id}-s${seed}-a${assignment}`,
          drawId: d.id,
          assaySeed: seed,
          assignment,
          status: d.status,
          cacheKey: key,
        });
        if (key) {
          keys.add(key);
          if (!representatives.has(key)) {
            representatives.set(key, {
              cacheKey: key,
              descendantHex: d.descendantHex!,
              founderHex: d.founderHex,
              seed,
              assignment,
            });
          }
        }
      }
    }
  }
  if (!same(expectedAssays, r.assays) || !same([...keys], r.uniqueKeys)) {
    throw Error("assay reference/cache roster drift");
  }
  if (
    !same(readiness.semanticCounts, {
      draws: 384,
      requests: 6144,
      uniqueConfigurations: keys.size,
      drawStatuses: statuses,
    })
  ) throw Error("readiness semantic counts drift");
  if (
    raw &&
    (sha256(raw) !== readiness.rosterSha256 ||
      new TextDecoder().decode(raw) !== JSON.stringify(r) + "\n")
  ) throw Error("roster byte identity/canonical drift");
  return representatives;
}
export function partition(
  keys: string[],
  hostIds: string[],
): Record<string, string[]> {
  if (
    hostIds.length !== 2 || new Set(hostIds).size !== 2 ||
    new Set(keys).size !== keys.length
  ) throw Error("invalid key/host partition");
  const sorted = [...keys].sort();
  return Object.fromEntries(
    hostIds.map((id, index) => [id, sorted.filter((_, i) => i % 2 === index)]),
  );
}
export function budget(a: Allocation, successor?: VerifiedSuccessor) {
  if (successor) return successor;
  const historyReservedSeconds = a.globalPriorSeconds +
      a.hosts.reduce((n, h) => n + h.capSeconds, 0),
    historyReservedInvocations = a.priorInvocations +
      a.hosts.reduce((n, h) => n + h.maxInvocations, 0),
    engineeringReservedSeconds = a.engineeringReserveSeconds,
    engineeringReservedInvocations = a.engineeringReserveInvocations;
  const remainingSeconds = 345600 - historyReservedSeconds -
      engineeringReservedSeconds - 3600,
    remainingInvocations = 576 - historyReservedInvocations -
      engineeringReservedInvocations;
  if (
    !Number.isFinite(remainingSeconds) || remainingSeconds < 86000 ||
    !Number.isInteger(remainingInvocations) || remainingInvocations < 150
  ) throw Error("conservative assay budget insufficient");
  return {
    globalCapSeconds: 345600 as const,
    globalMaxInvocations: 576 as const,
    historyReservedSeconds,
    historyReservedInvocations,
    engineeringReservedSeconds,
    engineeringReservedInvocations,
    cpuReservedSeconds: 3600 as const,
    remainingSeconds,
    remainingInvocations,
    reservationSeconds: 3600 as const,
  };
}
export function requireRelease(r: Release) {
  if (
    r.format !== "discovery-improvement-assay-release/v1" ||
    r.status !== "RELEASED" || !hex.test(r.candidateSha256) ||
    ![r.reviewedBy, r.reviewReference, r.reviewedAt, r.candidatePath].every(
      (s) => typeof s === "string" && s.length > 0,
    ) || !Number.isFinite(Date.parse(r.reviewedAt))
  ) throw Error("explicit reviewed RELEASED assay release required");
}
const operationFiles = [
  "tools/discovery_improvement_assay.ts",
  "tools/discovery_improvement_assay_continue.py",
  "tools/discovery_improvement_shard.ts",
  "tools/discovery_improvement_reconcile.ts",
  "tools/discovery_improvement_import.ts",
  "tools/discovery_improvement_adapter.generated.ts",
];
async function closure(m: Manifest) {
  for (const [p, h] of Object.entries(m.sources)) {
    if (sha256(await bytes(localPath(p))) !== h) {
      throw Error(`scientific source drift ${p}`);
    }
  }
  for (const [p, h] of Object.entries(m.inputs)) {
    if (sha256(await bytes(mapped(p, m.sourceRoot, Deno.cwd()))) !== h) {
      throw Error(`frozen scientific input drift ${p}`);
    }
  }
  const source = await Deno.readTextFile("tools/discovery_improvement.ts"),
    derived = await Deno.readTextFile(
      "tools/discovery_improvement_adapter.generated.ts",
    );
  if (derived !== adapterText(source)) {
    throw Error("frozen helper adapter drift");
  }
}
async function inputs(c: Candidate) {
  const entries = Object.fromEntries(
    await Promise.all(
      Object.entries(c.inputs).map(async ([k, v]) => {
        const b = await bytes(localPath(v.path));
        if (sha256(b) !== v.sha256) throw Error(`input drift ${k}`);
        return [k, b];
      }),
    ),
  );
  const m = validateManifest(parse(entries.manifest)),
    a = parse(entries.allocation) as Allocation,
    ready = parse(entries.readiness),
    r = parse(entries.roster) as Roster;
  validateAllocation(a, m);
  const routingBytes = await bytes(localPath(a.routingPath));
  if (sha256(routingBytes) !== a.routingSha256) {
    throw Error("history routing proof drift");
  }
  const routing = parse(routingBytes);
  let prior = 0;
  if (routing.priorInvocations.length !== a.priorInvocations) {
    throw Error("prior invocation count drift");
  }
  for (const record of routing.priorInvocations) {
    const raw = await bytes(
      localPath(join(a.priorReceiptDir, record.path.split("/").at(-1))),
    );
    if (sha256(raw) !== record.sha256) throw Error("prior receipt proof drift");
    const value = parse(raw);
    if (
      value.manifestHash !== m.manifestHash ||
      value.releaseSha256 !== routing.releaseSha256 ||
      value.elapsedSeconds !== record.elapsedSeconds
    ) throw Error("prior receipt identity drift");
    prior += value.elapsedSeconds;
  }
  if (prior !== a.globalPriorSeconds) {
    throw Error("prior charged seconds drift");
  }

  if (
    c.manifestHash !== m.manifestHash ||
    c.sourceManifestHash !== m.sourceManifestHash ||
    a.manifestSha256 !== c.inputs.manifest.sha256 ||
    ready.manifestSha256 !== c.inputs.manifest.sha256 ||
    ready.allocationSha256 !== c.inputs.allocation.sha256
  ) throw Error("frozen input identities differ");
  await closure(m);
  return {
    m,
    a,
    ready,
    r,
    requests: validateRoster(m, r, ready, entries.roster),
  };
}
async function successorProof(
  c: Pick<Candidate, "successorBudgetLedger" | "executionSources">,
  a: Allocation,
  allocationSha256: string,
) {
  if (!c.successorBudgetLedger) return undefined;
  const modulePath = "tools/discovery_improvement_budget.ts";
  if (
    !hex.test(c.executionSources[modulePath] ?? "") ||
    sha256(await bytes(modulePath)) !== c.executionSources[modulePath]
  ) throw Error("successor verifier code drift");
  const raw = await bytes(localPath(c.successorBudgetLedger.path));
  if (sha256(raw) !== c.successorBudgetLedger.sha256) {
    throw Error("successor ledger bytes drift");
  }
  const { verifySuccessorLedger } = await import(
    "./discovery_improvement_budget.ts"
  );
  return await verifySuccessorLedger(a, allocationSha256, parse(raw));
}
async function candidate(
  manifestPath: string,
  allocationPath: string,
  readinessPath: string,
  rosterPath: string,
  out: string,
  successorPath?: string,
) {
  const paths = {
      manifest: manifestPath,
      allocation: allocationPath,
      readiness: readinessPath,
      roster: rosterPath,
    },
    records: any = {};
  for (const [k, p] of Object.entries(paths)) {
    const rel = relative(Deno.cwd(), resolve(p));
    records[k] = { path: rel, sha256: sha256(await bytes(localPath(rel))) };
  }
  const m = validateManifest(parse(await bytes(manifestPath))),
    a = parse(await bytes(allocationPath)) as Allocation;
  await closure(m);
  const sources: Record<string, string> = {};
  for (const p of operationFiles) sources[p] = sha256(await bytes(p));
  const successorBudgetLedger = successorPath
    ? {
      path: relative(Deno.cwd(), successorPath),
      sha256: sha256(await bytes(successorPath)),
    }
    : undefined;
  if (successorBudgetLedger) {
    sources["tools/discovery_improvement_budget.ts"] = sha256(
      await bytes("tools/discovery_improvement_budget.ts"),
    );
  }
  const successor = await successorProof(
    { successorBudgetLedger, executionSources: sources },
    a,
    records.allocation.sha256,
  );
  const r = parse(await bytes(rosterPath)) as Roster,
    parts = partition(r.uniqueKeys, a.hosts.map((h) => h.id));
  const c: Candidate = {
    format: "discovery-improvement-assay-candidate/v1",
    status: "PREPARED",
    authorizesGpu: false,
    manifestHash: m.manifestHash,
    sourceManifestHash: m.sourceManifestHash,
    inputs: records,
    executionSources: sources,
    ...(successorBudgetLedger ? { successorBudgetLedger } : {}),
    budget: budget(a, successor),
    hosts: a.hosts.map((h) => ({
      id: h.id,
      root: h.root,
      outputRel: `runs/founder-discovery-improvement-assays-${h.id}-v1`,
      keys: parts[h.id],
      capSeconds: 43000,
      maxInvocations: 75,
    })),
    minimumFreeBytes: 20 * 1024 ** 3,
  };
  await validateCandidate(c);
  await noSymlinks(out);
  await writeNew(out, JSON.stringify(c, null, 2) + "\n");
}
export function validateAssayHostEnvelope(
  hosts: Candidate["hosts"],
  successorUsed: boolean,
) {
  if (
    successorUsed &&
    (hosts.length !== 2 ||
      hosts.some((h) => h.capSeconds !== 43000 || h.maxInvocations !== 75))
  ) {
    throw Error(
      "successor preserves exact assay caps; recovered resources remain unallocated",
    );
  }
}
export async function validateCandidate(c: Candidate) {
  if (
    c.format !== "discovery-improvement-assay-candidate/v1" ||
    c.status !== "PREPARED" || c.authorizesGpu !== false ||
    c.minimumFreeBytes < 20 * 1024 ** 3 || !Number.isFinite(c.minimumFreeBytes)
  ) throw Error("invalid PREPARED assay candidate");
  for (const p of operationFiles) {
    if (
      !hex.test(c.executionSources[p] ?? "") ||
      sha256(await bytes(p)) !== c.executionSources[p]
    ) throw Error(`operational source drift ${p}`);
  }
  const data = await inputs(c),
    successor = await successorProof(c, data.a, c.inputs.allocation.sha256),
    expectedBudget = budget(data.a, successor);
  validateAssayHostEnvelope(c.hosts, !!c.successorBudgetLedger);
  if (
    !same(c.budget, expectedBudget) || c.hosts.length !== 2 ||
    c.hosts.reduce((n, h) => n + h.capSeconds, 0) > c.budget.remainingSeconds ||
    c.hosts.reduce((n, h) => n + h.maxInvocations, 0) >
      c.budget.remainingInvocations
  ) throw Error("assay aggregate envelope drift");
  const parts = partition(data.r.uniqueKeys, data.a.hosts.map((h) => h.id));
  for (let index = 0; index < 2; index++) {
    const h = c.hosts[index], old = data.a.hosts[index];
    if (
      h.id !== old.id || h.root !== old.root || !same(h.keys, parts[h.id]) ||
      !Number.isFinite(h.capSeconds) || h.capSeconds <= 0 ||
      !Number.isInteger(h.maxInvocations) || h.maxInvocations <= 0 ||
      isAbsolute(h.outputRel) ||
      !within(join(h.root, "runs"), resolve(h.root, h.outputRel)) ||
      h.outputRel === "runs"
    ) throw Error("host assignment/output drift");
    for (const prior of data.a.hosts) {
      if (
        within(
          resolve(prior.root, prior.outputRel),
          resolve(h.root, h.outputRel),
        ) ||
        within(
          resolve(h.root, h.outputRel),
          resolve(prior.root, prior.outputRel),
        )
      ) throw Error("assay output overlaps histories");
    }
    if (
      within(data.ready.consolidated, resolve(h.root, h.outputRel)) ||
      within(resolve(h.root, h.outputRel), data.ready.consolidated)
    ) throw Error("assay output overlaps consolidation");
  }
  if (
    c.hosts[0].root === c.hosts[1].root &&
    (within(
      resolve(c.hosts[0].root, c.hosts[0].outputRel),
      resolve(c.hosts[1].root, c.hosts[1].outputRel),
    ) ||
      within(
        resolve(c.hosts[1].root, c.hosts[1].outputRel),
        resolve(c.hosts[0].root, c.hosts[0].outputRel),
      ))
  ) throw Error("host outputs overlap");
  return data;
}
async function released(path: string) {
  const releaseBytes = await bytes(path),
    release = parse(releaseBytes) as Release;
  requireRelease(release);
  const cb = await bytes(localPath(release.candidatePath));
  if (sha256(cb) !== release.candidateSha256) {
    throw Error("released candidate bytes drift");
  }
  const c = parse(cb) as Candidate, data = await validateCandidate(c);
  return { ...data, c, release, releaseHash: sha256(releaseBytes) };
}
export function validateCached(
  raw: Uint8Array,
  request: Request,
  source: string,
): AssayResult {
  const value = parse(raw) as AssayResult;
  validateAssayResult(
    value,
    request.cacheKey,
    request.descendantHex,
    request.founderHex,
    request.seed,
    request.assignment,
    source,
  );
  if (new TextDecoder().decode(raw) !== JSON.stringify(value) + "\n") {
    throw Error("cached canonical result bytes drift");
  }
  return value;
}
async function idle(out: string) {
  await noSymlinks(out);
  for (
    const p of [
      "RUNNING",
      "SUPERVISOR",
      "SHARD_RUNNING",
      "SHARD_SUPERVISOR",
      "ASSAY_RUNNING",
    ]
  ) if (await exists(join(out, p))) throw Error("active output lock");
}
function hostProvenance(
  c: Candidate,
  m: Manifest,
  release: Release,
  releaseHash: string,
  hostId: string,
  key: string,
  resultSha256: string,
) {
  return {
    format: "discovery-improvement-assay-host-provenance/v1",
    manifestHash: m.manifestHash,
    sourceManifestHash: m.sourceManifestHash,
    rosterSha256: c.inputs.roster.sha256,
    readinessSha256: c.inputs.readiness.sha256,
    candidateSha256: release.candidateSha256,
    releaseHash,
    hostId,
    cacheKey: key,
    resultSha256,
  };
}
async function cache(
  out: string,
  keys: string[],
  requests: Map<string, Request>,
  data: Awaited<ReturnType<typeof released>>,
  hostId: string,
) {
  const done = new Set<string>(),
    dir = join(out, "assays"),
    provenanceDir = join(out, "provenance");
  for (const p of [dir, provenanceDir]) await noSymlinks(p);
  if (await exists(dir)) {
    for await (const e of Deno.readDir(dir)) {
      const key = e.name.slice(0, -5);
      if (
        !e.isFile || e.isSymlink || !e.name.endsWith(".json") ||
        !keys.includes(key) || !requests.has(key)
      ) throw Error("foreign assay cache entry");
      const raw = await bytes(join(dir, e.name));
      validateCached(raw, requests.get(key)!, data.m.sourceManifestHash);
      const p = await bytes(join(provenanceDir, e.name));
      if (
        new TextDecoder().decode(p) !==
          JSON.stringify(
              hostProvenance(
                data.c,
                data.m,
                data.release,
                data.releaseHash,
                hostId,
                key,
                sha256(raw),
              ),
            ) + "\n"
      ) throw Error("cached host provenance drift");
      done.add(key);
    }
  }
  if (await exists(provenanceDir)) {
    for await (const e of Deno.readDir(provenanceDir)) {
      if (
        !e.isFile || e.isSymlink || !e.name.endsWith(".json") ||
        !done.has(e.name.slice(0, -5))
      ) {
        throw Error("foreign/orphan assay provenance");
      }
    }
  }
  return done;
}
async function run(
  releasePath: string,
  hostId: string,
  out: string,
  seconds: number,
) {
  const started = performance.now(),
    data = await released(releasePath),
    { c, m, requests, releaseHash } = data,
    host = c.hosts.find((h) => h.id === hostId);
  if (
    !host || await Deno.realPath(Deno.cwd()) !== host.root ||
    resolve(out) !== resolve(host.root, host.outputRel) ||
    !Number.isFinite(seconds) || seconds <= 0 || seconds > 600
  ) throw Error("host/output/tranche drift");
  await idle(out);
  if (await exists(out)) {
    for await (const e of Deno.readDir(out)) {
      if (
        e.isSymlink ||
        (!["assays", "provenance", "ASSAY_SUPERVISOR", "assay-supervisor.log"]
          .includes(e.name) &&
          !/^parent-invocation-[0-9]+-[0-9]+\.json$/.test(e.name))
      ) throw Error("unexpected assay output artifact");
    }
  }

  const parentPath = Deno.env.get("BL_ASSAY_RESERVATION");
  if (!parentPath || dirname(parentPath) !== resolve(out)) {
    throw Error("active parent reservation required");
  }
  const parent = parse(await bytes(parentPath));
  if (
    parent.releaseHash !== releaseHash || parent.hostId !== hostId ||
    parent.status !== "reserved" || parent.chargedSeconds !== 3600
  ) throw Error("parent reservation identity drift");
  await Deno.mkdir(out, { recursive: true });
  const lock = join(out, "ASSAY_RUNNING");
  await writeNew(
    lock,
    JSON.stringify({ pid: Deno.pid, hostId, releaseHash }) + "\n",
  );
  let device: GPUDevice | null = null, newAssays = 0;
  try {
    const done = await cache(out, host.keys, requests, data, hostId);
    for (const key of host.keys) {
      if (done.has(key)) continue;
      if ((performance.now() - started) / 1000 >= seconds) break;
      const fs = statfsSync(out);
      if (
        Number(fs.bavail) * Number(fs.bsize) < c.minimumFreeBytes + 1024 * 1024
      ) throw Error("assay storage floor reached");
      if (!device) {
        device = await (await import("@bl/sim-gpu")).requestDevice(
          navigator.gpu,
          discoveryCompetitionConfig(requests.get(key)!.seed),
        );
      }
      const helper = await import(
          new URL(
            `file://${
              resolve("tools/discovery_improvement_adapter.generated.ts")
            }`,
          ).href
        ),
        result = await helper.executeAssay(device, m, requests.get(key));
      const canonical = JSON.stringify(result) + "\n";
      validateCached(
        new TextEncoder().encode(canonical),
        requests.get(key)!,
        m.sourceManifestHash,
      );
      for (const p of [join(out, "assays"), join(out, "provenance")]) {
        await noSymlinks(p);
      }
      await writeNew(join(out, "assays", `${key}.json`), canonical);
      done.add(key);
      newAssays++;
      await writeNew(
        join(out, "provenance", `${key}.json`),
        JSON.stringify(
          hostProvenance(
            c,
            m,
            data.release,
            releaseHash,
            hostId,
            key,
            sha256(canonical),
          ),
        ) + "\n",
      );
      if ((performance.now() - started) / 1000 > 3500) {
        throw Error("assay boundary exceeded parent watchdog");
      }
    }
    const final = await released(releasePath);
    if (final.releaseHash !== releaseHash) {
      throw Error("release changed during run");
    }
    console.log(
      JSON.stringify({
        hostId,
        newAssays,
        complete: done.size === host.keys.length,
      }),
    );
  } finally {
    device?.destroy();
    await Deno.remove(lock);
  }
}
if (import.meta.main) {
  const [stage, ...args] = Deno.args;
  if (stage === "candidate" && (args.length === 5 || args.length === 6)) {
    await candidate(
      ...args.map((p) => resolve(p)) as [
        string,
        string,
        string,
        string,
        string,
        string?,
      ],
    );
  } else if (stage === "verify" && args.length === 1) {
    await released(resolve(args[0]));
    console.log("verified RELEASED");
  } else if (stage === "run" && args.length === 4) {
    await run(resolve(args[0]), args[1], resolve(args[2]), Number(args[3]));
  } else {throw Error(
      "usage: candidate MANIFEST HISTORY_ALLOCATION READINESS ROSTER NEW_PREPARED_CANDIDATE [REVIEWED_SUCCESSOR_LEDGER] | verify RELEASED_FILE | run RELEASED_FILE HOST OUT SECONDS",
    );}
}
