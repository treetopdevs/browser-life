// CPU-only assay collection. OS closure observations are explicit root attestations;
// settled ledgers, final log completion, ownership, and copied bytes are verified here.
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import { statfsSync } from "node:fs";
import { sha256 } from "./lib/founder-policy.ts";
import {
  type Candidate,
  type Release,
  type Request,
  requireRelease,
  validateCached,
  validateCandidate,
} from "./discovery_improvement_assay.ts";
import { noSymlinks } from "./discovery_improvement_import.ts";
import type { Manifest } from "./lib/discovery-improvement-runtime.ts";
export interface ClosureAttestation {
  format: "discovery-improvement-assay-host-closure/v1";
  releaseSha256: string;
  hostId: string;
  originalRoot: string;
  originalOutputRel: string;
  stagedSource: string;
  observedAt: string;
  attestedBy: string;
  osAssertions: { originalSupervisorAbsent: true; originalWorkerAbsent: true };
  sourceFiles: Record<string, string>;
}
const same = (a: unknown, b: unknown) =>
    JSON.stringify(a) === JSON.stringify(b),
  hash = /^[a-f0-9]{64}$/;
function within(a: string, b: string) {
  const r = relative(a, b);
  return r === "" || (!isAbsolute(r) && r !== ".." && !r.startsWith("../"));
}
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
  const a = await Deno.lstat(p);
  if (!a.isFile) throw Error("expected regular file");
  const b = await Deno.readFile(p), z = await Deno.lstat(p);
  if (
    z.isSymlink || a.ino !== z.ino || a.size !== z.size ||
    a.mtime?.getTime() !== z.mtime?.getTime()
  ) throw Error("source file changed during read");
  return b;
}
const parse = (b: Uint8Array) => JSON.parse(new TextDecoder().decode(b));
function safeRelative(p: string) {
  return !isAbsolute(p) && p !== "" && within(Deno.cwd(), resolve(p));
}
async function idle(p: string) {
  await noSymlinks(p);
  for (
    const name of [
      "RUNNING",
      "SUPERVISOR",
      "SHARD_RUNNING",
      "SHARD_SUPERVISOR",
      "ASSAY_RUNNING",
      "ASSAY_SUPERVISOR",
      "IMPORT_RUNNING",
      "ASSAY_IMPORT_RUNNING",
    ]
  ) {
    if (await exists(join(p, name))) {
      throw Error(`active/stale lock ${p}/${name}`);
    }
  }
}
export function expectedProvenance(
  c: Candidate,
  m: Manifest,
  r: Release,
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
    candidateSha256: r.candidateSha256,
    releaseHash,
    hostId,
    cacheKey: key,
    resultSha256,
  };
}
async function releaseIdentity(path: string) {
  const raw = await bytes(path), r = parse(raw) as Release;
  requireRelease(r);
  if (!safeRelative(r.candidatePath)) {
    throw Error("candidate outside frozen root");
  }
  const cb = await bytes(resolve(r.candidatePath));
  if (sha256(cb) !== r.candidateSha256) throw Error("released candidate drift");
  const c = parse(cb) as Candidate, data = await validateCandidate(c);
  return { ...data, c, release: r, roster: data.r, releaseHash: sha256(raw) };
}
export async function sourceInventory(source: string) {
  await idle(source);
  const files: Record<string, string> = {};
  for await (const e of Deno.readDir(source)) {
    if (e.isSymlink) throw Error("source symlink artifact");
    if (["assays", "provenance"].includes(e.name)) {
      if (!e.isDirectory) throw Error("expected source directory");
      for await (const child of Deno.readDir(join(source, e.name))) {
        if (!child.isFile || child.isSymlink || !child.name.endsWith(".json")) {
          throw Error("unexpected source cache artifact");
        }
        files[`${e.name}/${child.name}`] = sha256(
          await bytes(join(source, e.name, child.name)),
        );
      }
    } else {
      if (
        !e.isFile ||
        (!/^parent-invocation-[0-9]+-[0-9]+\.json$/.test(e.name) &&
          e.name !== "assay-supervisor.log")
      ) throw Error("unexpected source artifact");
      files[e.name] = sha256(await bytes(join(source, e.name)));
    }
  }
  return Object.fromEntries(
    Object.entries(files).sort(([a], [b]) => a.localeCompare(b)),
  );
}
export function validateClosure(
  a: ClosureAttestation,
  host: Candidate["hosts"][number],
  source: string,
  releaseHash: string,
  files: Record<string, string>,
) {
  if (
    a.format !== "discovery-improvement-assay-host-closure/v1" ||
    a.releaseSha256 !== releaseHash || a.hostId !== host.id ||
    a.originalRoot !== host.root || a.originalOutputRel !== host.outputRel ||
    a.stagedSource !== source || !a.attestedBy ||
    !Number.isFinite(Date.parse(a.observedAt)) ||
    a.osAssertions?.originalSupervisorAbsent !== true ||
    a.osAssertions?.originalWorkerAbsent !== true || !same(a.sourceFiles, files)
  ) throw Error("root closure attestation identity/inventory mismatch");
}
export function validateTerminalLog(
  text: string,
  hostId: string,
  keyCount: number,
) {
  const last = text.trim().split(/\r?\n/).at(-1);
  if (!last) throw Error("terminal supervisor log missing");
  let value: any;
  try {
    value = JSON.parse(last);
  } catch {
    throw Error("final log line is not terminal completion");
  }
  if (
    value.complete !== true || value.hostId !== hostId ||
    (value.totalKeys !== undefined && value.totalKeys !== keyCount) ||
    (value.completedKeys !== undefined && value.completedKeys !== keyCount)
  ) throw Error("terminal host completion log mismatch");
  return value;
}
export function exactHostRoster(files: Record<string, string>, keys: string[]) {
  const expected = [
      ...keys.map((k) => `assays/${k}.json`),
      ...keys.map((k) => `provenance/${k}.json`),
    ].sort(),
    actual = Object.keys(files).filter((p) =>
      p.startsWith("assays/") || p.startsWith("provenance/")
    ).sort();
  if (!same(expected, actual)) {
    throw Error("missing/orphan/foreign assigned assay files");
  }
}
export function globalCoverage(
  hostIds: string[],
  committedIds: string[],
  keys: string[],
  actualKeys: string[],
) {
  return hostIds.length === 2 && new Set(committedIds).size === 2 &&
    hostIds.every((h) => committedIds.includes(h)) &&
    same([...keys].sort(), [...actualKeys].sort());
}
async function atomicIdentical(path: string, raw: Uint8Array) {
  await noSymlinks(path);
  if (await exists(path)) {
    if (sha256(await bytes(path)) !== sha256(raw)) {
      throw Error(`destination byte conflict ${path}`);
    }
    return;
  }
  await Deno.mkdir(dirname(path), { recursive: true });
  await noSymlinks(dirname(path));
  const temporary = join(
    dirname(path),
    `.assay-import-${crypto.randomUUID()}.tmp`,
  );
  try {
    const f = await Deno.open(temporary, { createNew: true, write: true });
    try {
      let offset = 0;
      while (offset < raw.length) offset += await f.write(raw.subarray(offset));
      await f.sync();
    } finally {
      f.close();
    }
    await Deno.link(temporary, path);
  } catch (e) {
    if (e instanceof Deno.errors.AlreadyExists) {
      if (sha256(await bytes(path)) !== sha256(raw)) {
        throw Error("concurrent destination byte conflict");
      }
    } else throw e;
  } finally {
    if (await exists(temporary)) await Deno.remove(temporary);
  }
}
async function destinationPreflight(
  destination: string,
  data: Awaited<ReturnType<typeof releaseIdentity>>,
) {
  await idle(destination);
  for (
    const dir of [
      "assays",
      "assay-host-provenance",
      "assay-import-receipts",
      "assay-host-closure",
    ]
  ) await noSymlinks(join(destination, dir));
  if (await exists(join(destination, "assays"))) {
    for await (const e of Deno.readDir(join(destination, "assays"))) {
      const key = e.name.slice(0, -5);
      if (
        !e.isFile || e.isSymlink || !e.name.endsWith(".json") ||
        !data.requests.has(key)
      ) {
        throw Error("foreign global assay result");
      }
      validateCached(
        await bytes(join(destination, "assays", e.name)),
        data.requests.get(key)!,
        data.m.sourceManifestHash,
      );
    }
  }
  if (await exists(join(destination, "assay-host-provenance"))) {
    for await (
      const h of Deno.readDir(join(destination, "assay-host-provenance"))
    ) {
      const host = data.c.hosts.find((x) => x.id === h.name);
      if (!host || !h.isDirectory || h.isSymlink) {
        throw Error("foreign host provenance directory");
      }
      for await (
        const e of Deno.readDir(
          join(destination, "assay-host-provenance", h.name),
        )
      ) {
        const key = e.name.slice(0, -5);
        if (
          !e.isFile || e.isSymlink || !e.name.endsWith(".json") ||
          !host.keys.includes(key)
        ) throw Error("foreign host provenance result");
        const result = await bytes(join(destination, "assays", e.name));
        if (
          new TextDecoder().decode(
            await bytes(
              join(destination, "assay-host-provenance", h.name, e.name),
            ),
          ) !==
            JSON.stringify(
                expectedProvenance(
                  data.c,
                  data.m,
                  data.release,
                  data.releaseHash,
                  host.id,
                  key,
                  sha256(result),
                ),
              ) + "\n"
        ) throw Error("global host provenance drift");
      }
    }
  }
  if (await exists(join(destination, "assay-host-closure"))) {
    for await (
      const h of Deno.readDir(join(destination, "assay-host-closure"))
    ) {
      if (
        !h.isDirectory || h.isSymlink ||
        !data.c.hosts.some((x) => x.id === h.name)
      ) throw Error("foreign host closure directory");
      for await (
        const e of Deno.readDir(join(destination, "assay-host-closure", h.name))
      ) {
        if (
          !e.isFile || e.isSymlink ||
          !(e.name === "root-attestation.json" ||
            e.name === "assay-supervisor.log" ||
            /^parent-invocation-[0-9]+-[0-9]+\.json$/.test(e.name))
        ) throw Error("unknown host closure artifact");
      }
    }
  }
  if (await exists(join(destination, "assay-import-receipts"))) {
    for await (
      const e of Deno.readDir(join(destination, "assay-import-receipts"))
    ) {
      const host = data.c.hosts.find((h) => e.name === `${h.id}.json`);
      if (!host || !e.isFile || e.isSymlink) {
        throw Error("foreign host import receipt");
      }
      const receipt = parse(
        await bytes(join(destination, "assay-import-receipts", e.name)),
      );
      if (
        receipt.format !== "discovery-improvement-assay-host-import/v1" ||
        receipt.hostId !== host.id ||
        receipt.releaseSha256 !== data.releaseHash ||
        receipt.candidateSha256 !== data.release.candidateSha256 ||
        receipt.rosterSha256 !== data.c.inputs.roster.sha256 ||
        receipt.readinessSha256 !== data.c.inputs.readiness.sha256 ||
        receipt.manifestHash !== data.m.manifestHash ||
        receipt.sourceManifestHash !== data.m.sourceManifestHash ||
        receipt.originalRoot !== host.root ||
        receipt.originalOutputRel !== host.outputRel ||
        !same(receipt.assignedKeys, host.keys) ||
        !hash.test(receipt.attestationSha256)
      ) throw Error("host commit marker drift");
      const attestationRaw = await bytes(
        join(
          destination,
          "assay-host-closure",
          host.id,
          "root-attestation.json",
        ),
      );
      if (sha256(attestationRaw) !== receipt.attestationSha256) {
        throw Error("preserved root attestation drift");
      }
      validateClosure(
        parse(attestationRaw),
        host,
        receipt.stagedSource,
        data.releaseHash,
        receipt.sourceFiles,
      );
      exactHostRoster(receipt.sourceFiles, host.keys);
      let charged = 0, ledgerCount = 0;
      for (const [path, h] of Object.entries(receipt.sourceFiles)) {
        if (!hash.test(h as string)) {
          throw Error("closure source hash malformed");
        }
        const copiedPath = path.startsWith("assays/")
          ? path
          : path.startsWith("provenance/")
          ? `assay-host-provenance/${host.id}/${basename(path)}`
          : `assay-host-closure/${host.id}/${path}`;
        if (
          !safeRelative(path) ||
          sha256(await bytes(join(destination, copiedPath))) !== h
        ) throw Error("preserved closure source bytes drift");
        if (path.startsWith("parent-invocation-")) {
          const ledger = parse(await bytes(join(destination, copiedPath)));
          if (
            ledger.status !== "settled" ||
            ledger.releaseHash !== data.releaseHash ||
            ledger.hostId !== host.id ||
            !Number.isFinite(ledger.chargedSeconds) ||
            ledger.chargedSeconds < 0 ||
            !Number.isInteger(ledger.supervisorPid) || ledger.supervisorPid <= 0
          ) throw Error("preserved settled ledger drift");
          charged += ledger.chargedSeconds;
          ledgerCount++;
        } else if (
          !path.startsWith("assays/") && !path.startsWith("provenance/") &&
          path !== "assay-supervisor.log"
        ) throw Error("unknown preserved diagnostic");
      }
      if (
        !ledgerCount || charged > host.capSeconds ||
        ledgerCount > host.maxInvocations
      ) throw Error("preserved ledger envelope drift");
      validateTerminalLog(
        new TextDecoder().decode(
          await bytes(
            join(
              destination,
              "assay-host-closure",
              host.id,
              "assay-supervisor.log",
            ),
          ),
        ),
        host.id,
        host.keys.length,
      );
      const bothExtinct = await Promise.all(
        host.keys.map(async (key) =>
          parse(await bytes(join(destination, "assays", `${key}.json`))).status
        ),
      );
      if (
        !same(receipt.mechanicallyVerified, {
          settledParentInvocations: ledgerCount,
          chargedSeconds: charged,
          terminalLogComplete: true,
          assignedResultCount: host.keys.length,
          bothExtinctCount: bothExtinct.filter((x) =>
            x === "both-extinct"
          ).length,
        })
      ) throw Error("mechanical closure summary drift");
      const actualClosure: string[] = [];
      for await (
        const artifact of Deno.readDir(
          join(destination, "assay-host-closure", host.id),
        )
      ) actualClosure.push(artifact.name);
      const expectedClosure = [
        "root-attestation.json",
        ...Object.keys(receipt.sourceFiles).filter((p) =>
          !p.startsWith("assays/") && !p.startsWith("provenance/")
        ),
      ].sort();
      if (!same(actualClosure.sort(), expectedClosure)) {
        throw Error("committed closure has missing/extra evidence files");
      }
      const expected = [
        ...Object.keys(receipt.sourceFiles).filter((p) =>
          !p.startsWith("assays/") && !p.startsWith("provenance/")
        ).map((p) => `assay-host-closure/${host.id}/${p}`),
        `assay-host-closure/${host.id}/root-attestation.json`,
        ...host.keys.map((k) => `assays/${k}.json`),
        ...host.keys.map((k) => `assay-host-provenance/${host.id}/${k}.json`),
      ].sort();
      if (
        !same(Object.keys(receipt.publishedFiles).sort(), expected)
      ) throw Error("host commit published roster drift");
      for (const [p, h] of Object.entries(receipt.publishedFiles)) {
        if (
          !hash.test(h as string) ||
          sha256(await bytes(join(destination, p))) !== h
        ) throw Error("host committed bytes drift");
      }
    }
  }
}
export async function importAssays(
  releasePath: string,
  hostId: string,
  source: string,
  attestationPath: string,
  destination: string,
  newReceipt: string,
) {
  source = resolve(source);
  destination = resolve(destination);
  const data = await releaseIdentity(releasePath),
    { c, m, release: r, releaseHash } = data,
    host = c.hosts.find((h) => h.id === hostId);
  if (!host) throw Error("unknown assay host");
  if (within(source, destination) || within(destination, source)) {
    throw Error("source/destination overlap");
  }
  if (destination !== resolve(data.ready.consolidated)) {
    throw Error("destination differs from pinned readiness consolidation");
  }
  for (const h of [...data.a.hosts, ...c.hosts]) {
    const protectedPath = resolve(h.root, h.outputRel);
    if (
      within(protectedPath, resolve(newReceipt)) ||
      within(resolve(newReceipt), protectedPath)
    ) throw Error("external receipt overlaps protected host output");
    if (
      within(protectedPath, destination) || within(destination, protectedPath)
    ) throw Error("destination overlaps protected host output");
  }
  if (
    within(destination, resolve(newReceipt)) ||
    within(source, resolve(newReceipt))
  ) throw Error("external receipt must be outside collection/source");
  for (const p of [destination, source, attestationPath, newReceipt]) {
    await noSymlinks(p);
  }
  if (await exists(newReceipt)) {
    throw Error("new collection observation receipt already exists");
  }
  for (const h of data.a.hosts) {
    const protectedPath = resolve(h.root, h.outputRel);
    if (within(protectedPath, source) || within(source, protectedPath)) {
      throw Error("source overlaps protected history output");
    }
  }

  const files = await sourceInventory(source),
    attestationBytes = await bytes(attestationPath),
    attestation = parse(attestationBytes) as ClosureAttestation;
  validateClosure(attestation, host, source, releaseHash, files);
  exactHostRoster(files, host.keys);
  const ledgers = Object.keys(files).filter((p) =>
    p.startsWith("parent-invocation-")
  );
  if (!ledgers.length) throw Error("settled terminal parent ledger required");
  let charged = 0;
  for (const p of ledgers) {
    const receipt = parse(await bytes(join(source, p)));
    if (
      receipt.releaseHash !== releaseHash || receipt.hostId !== hostId ||
      receipt.status !== "settled" ||
      !Number.isFinite(receipt.chargedSeconds) || receipt.chargedSeconds < 0 ||
      !Number.isInteger(receipt.supervisorPid) || receipt.supervisorPid <= 0
    ) throw Error("unsettled/foreign parent ledger");
    charged += receipt.chargedSeconds;
  }
  if (charged > host.capSeconds || ledgers.length > host.maxInvocations) {
    throw Error("host ledger envelope exceeded");
  }
  for (
    const p of Object.keys(files).filter((p) =>
      p.startsWith("assay-invocation-")
    )
  ) {
    const diagnostic = parse(await bytes(join(source, p)));
    if (
      diagnostic.releaseHash !== releaseHash || diagnostic.hostId !== hostId
    ) throw Error("foreign child diagnostic");
  }
  validateTerminalLog(
    new TextDecoder().decode(await bytes(join(source, "assay-supervisor.log"))),
    hostId,
    host.keys.length,
  );
  let publication: Record<string, string> = {};
  let required = 0, bothExtinct = 0;
  for (const key of host.keys) {
    const result = await bytes(join(source, "assays", `${key}.json`)),
      value = validateCached(
        result,
        data.requests.get(key)!,
        m.sourceManifestHash,
      );
    if (value.status === "both-extinct") bothExtinct++;
    const provenance = await bytes(join(source, "provenance", `${key}.json`));
    if (
      new TextDecoder().decode(provenance) !==
        JSON.stringify(
            expectedProvenance(
              c,
              m,
              r,
              releaseHash,
              hostId,
              key,
              sha256(result),
            ),
          ) + "\n"
    ) throw Error("host provenance pin drift");
    for (
      const [rel, raw] of [[`assays/${key}.json`, result], [
        `assay-host-provenance/${hostId}/${key}.json`,
        provenance,
      ]] as [string, Uint8Array][]
    ) {
      publication[rel] = sha256(raw);
      const target = join(destination, rel);
      await noSymlinks(target);
      if (await exists(target)) {
        if (sha256(await bytes(target)) !== sha256(raw)) {
          throw Error("destination preflight byte conflict");
        }
      } else required += raw.length;
    }
  }
  for (
    const path of Object.keys(files).filter((p) =>
      !p.startsWith("assays/") && !p.startsWith("provenance/")
    )
  ) {
    const raw = await bytes(join(source, path)),
      rel = `assay-host-closure/${hostId}/${path}`;
    publication[rel] = sha256(raw);
    const target = join(destination, rel);
    await noSymlinks(target);
    if (await exists(target)) {
      if (sha256(await bytes(target)) !== sha256(raw)) {
        throw Error("closure destination preflight conflict");
      }
    } else required += raw.length;
  }
  const preservedAttestation =
    `assay-host-closure/${hostId}/root-attestation.json`;
  publication[preservedAttestation] = sha256(attestationBytes);
  await noSymlinks(join(destination, preservedAttestation));
  if (await exists(join(destination, preservedAttestation))) {
    if (
      sha256(await bytes(join(destination, preservedAttestation))) !==
        sha256(attestationBytes)
    ) throw Error("attestation destination conflict");
  } else required += attestationBytes.length;
  await destinationPreflight(destination, data);
  publication = Object.fromEntries(
    Object.entries(publication).sort(([a], [b]) => a.localeCompare(b)),
  );
  const commit = {
    format: "discovery-improvement-assay-host-import/v1",
    hostId,
    manifestHash: m.manifestHash,
    sourceManifestHash: m.sourceManifestHash,
    releaseSha256: releaseHash,
    candidateSha256: r.candidateSha256,
    rosterSha256: c.inputs.roster.sha256,
    readinessSha256: c.inputs.readiness.sha256,
    originalRoot: host.root,
    originalOutputRel: host.outputRel,
    stagedSource: source,
    attestationSha256: sha256(attestationBytes),
    osClosureAuthority: "explicit root attestation",
    mechanicallyVerified: {
      settledParentInvocations: ledgers.length,
      chargedSeconds: charged,
      terminalLogComplete: true,
      assignedResultCount: host.keys.length,
      bothExtinctCount: bothExtinct,
    },
    assignedKeys: host.keys,
    sourceFiles: files,
    publishedFiles: publication,
  };
  const commitBytes = new TextEncoder().encode(
      JSON.stringify(commit, null, 2) + "\n",
    ),
    commitPath = join(destination, "assay-import-receipts", `${hostId}.json`);
  await noSymlinks(commitPath);
  if (
    await exists(commitPath) &&
    sha256(await bytes(commitPath)) !== sha256(commitBytes)
  ) throw Error("conflicting host commit marker");
  const free = () => {
    const fs = statfsSync(destination);
    return Number(fs.bavail) * Number(fs.bsize);
  };
  if (
    free() < c.minimumFreeBytes + required + commitBytes.length + 1024 * 1024
  ) throw Error("assay import storage envelope insufficient");
  if (!same(files, await sourceInventory(source))) {
    throw Error("source drift before publication");
  }
  await destinationPreflight(destination, data);
  const lock = join(destination, "ASSAY_IMPORT_RUNNING");
  await Deno.writeTextFile(
    lock,
    JSON.stringify({ pid: Deno.pid, releaseHash, hostId }) + "\n",
    { createNew: true },
  );
  try {
    for (const [rel, h] of Object.entries(publication)) {
      const sourceRel = rel.startsWith("assays/")
        ? rel
        : rel.startsWith("assay-host-provenance/")
        ? `provenance/${basename(rel)}`
        : basename(rel);
      const raw = sourceRel === "root-attestation.json"
        ? await bytes(attestationPath)
        : await bytes(join(source, sourceRel));
      if (sha256(raw) !== h) throw Error("source drift during publication");
      if (free() < c.minimumFreeBytes + raw.length) {
        throw Error("assay import storage floor reached");
      }
      await atomicIdentical(join(destination, rel), raw);
    }
    if (
      !same(files, await sourceInventory(source)) ||
      sha256(await bytes(attestationPath)) !== sha256(attestationBytes)
    ) throw Error("source/attestation changed during copy");
    const final = await releaseIdentity(releasePath);
    if (final.releaseHash !== releaseHash) {
      throw Error("release drift during import");
    }
    await atomicIdentical(commitPath, commitBytes);
  } finally {
    await Deno.remove(lock);
  }
  await destinationPreflight(destination, data);
  const committed: string[] = [];
  for (const h of c.hosts) {
    if (
      await exists(join(destination, "assay-import-receipts", `${h.id}.json`))
    ) committed.push(h.id);
  }
  const actual: string[] = [];
  if (await exists(join(destination, "assays"))) {
    for await (const e of Deno.readDir(join(destination, "assays"))) {
      actual.push(e.name.slice(0, -5));
    }
  }
  const globalComplete = globalCoverage(
    c.hosts.map((h) => h.id),
    committed,
    data.roster.uniqueKeys,
    actual,
  );
  const receipt = {
    format: "discovery-improvement-assay-collection-observation/v1",
    releaseSha256: releaseHash,
    manifestHash: m.manifestHash,
    rosterSha256: c.inputs.roster.sha256,
    readinessSha256: c.inputs.readiness.sha256,
    hostId,
    hostCommitSha256: sha256(commitBytes),
    attestationSha256: sha256(attestationBytes),
    globalComplete,
    committedHosts: committed,
    globalResultCount: actual.length,
    globalUniqueConfigurations: data.roster.uniqueKeys.length,
    requestedReferences: data.roster.assays.length,
    unavailableReferences:
      data.roster.assays.filter((x) => x.status !== "scheduled").length,
  };
  await atomicIdentical(
    newReceipt,
    new TextEncoder().encode(JSON.stringify(receipt, null, 2) + "\n"),
  );
  return receipt;
}
if (import.meta.main) {
  if (Deno.args.length !== 6) {
    throw Error(
      "usage: RELEASED_FILE HOST SOURCE ROOT_CLOSURE_ATTESTATION CONSOLIDATION NEW_RECEIPT",
    );
  }
  const [r, h, s, a, d, n] = Deno.args;
  await importAssays(
    resolve(r),
    h,
    resolve(s),
    resolve(a),
    resolve(d),
    resolve(n),
  );
}
