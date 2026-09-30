// CPU-only global readiness gate. No simulation, assay execution, or analysis.
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { sha256 } from "./lib/founder-policy.ts";
import {
  loadCheckpointChain,
  type Manifest,
  requestsFromSamples,
  type Sample,
  validateManifest,
} from "./lib/discovery-improvement-runtime.ts";
import {
  canonicalNames,
  fileInventory,
  type HistoryInventory,
  noSymlinks,
} from "./discovery_improvement_import.ts";
import type { Allocation } from "./discovery_improvement_shard.ts";
export async function atomicNew(path: string, text: string) {
  await noSymlinks(path);
  await Deno.mkdir(dirname(path), { recursive: true });
  await noSymlinks(dirname(path));
  const temporary = join(
    dirname(path),
    `.reconcile-${crypto.randomUUID()}.tmp`,
  );
  try {
    const file = await Deno.open(temporary, { write: true, createNew: true });
    try {
      const b = new TextEncoder().encode(text);
      let offset = 0;
      while (offset < b.length) offset += await file.write(b.subarray(offset));
      await file.sync();
    } finally {
      file.close();
    }
    await Deno.link(temporary, path);
  } finally {
    if (await exists(temporary)) await Deno.remove(temporary);
  }
}
export interface Slot {
  unitId: string;
  hostId: string;
  status: "missing" | "invalid" | "complete";
  error?: string;
  finalReceiptSha256?: string;
  files?: Record<string, string>;
  provenanceSha256?: string[];
  inventorySha256?: string[];
}
const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
const hashPattern = /^[a-f0-9]{64}$/;
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
  if (!a.isFile) throw Error("expected regular evidence file");
  const b = await Deno.readFile(p), z = await Deno.lstat(p);
  if (
    z.isSymlink || z.ino !== a.ino || z.size !== a.size ||
    z.mtime?.getTime() !== a.mtime?.getTime()
  ) throw Error("concurrent evidence drift");
  return b;
}
async function idle(p: string) {
  await noSymlinks(p);
  for (
    const name of [
      "RUNNING",
      "SUPERVISOR",
      "SHARD_RUNNING",
      "SHARD_SUPERVISOR",
      "IMPORT_RUNNING",
    ]
  ) if (await exists(join(p, name))) throw Error(`active output ${name}`);
}
export function readiness(
  m: Manifest,
  slots: Slot[],
  unexpected: string[],
  samples: Record<string, Record<number, Sample>>,
) {
  const exact = slots.length === 64 &&
    new Set(slots.map((s) => s.unitId)).size === 64 &&
    m.units.length === 64 &&
    m.units.every((u) => slots.some((s) => s.unitId === u.id));
  const physicalComplete = exact && unexpected.length === 0 &&
    slots.every((s) => s.status === "complete");
  if (!physicalComplete) {
    return { physicalComplete: false, roster: null, rosterBytes: null };
  }
  for (const u of m.units) {
    for (const time of m.times) {
      if (!samples[u.id]?.[time]) {
        throw Error(`complete history lacks scheduled sample ${u.id}/${time}`);
      }
    }
  }
  const roster = requestsFromSamples(m, samples);
  if (
    roster.draws.length !== 384 || roster.assays.length !== 6144 ||
    roster.uniqueKeys.length > 2112 ||
    roster.draws.some((d) => d.status === "missing")
  ) throw Error("global request roster resource/completeness drift");
  return {
    physicalComplete: true,
    roster,
    rosterBytes: JSON.stringify({ manifestHash: m.manifestHash, ...roster }) +
      "\n",
  };
}
export function provenanceMatches(
  p: any,
  inv: HistoryInventory,
  slot: Slot,
  m: Manifest,
  manifestSha256: string,
  allocationSha256: string,
  consolidated: string,
  expectedSource: string,
): boolean {
  const entry = p.units?.find((u: any) => u.id === slot.unitId),
    original = inv.units?.find((u) => u.id === slot.unitId);
  return Array.isArray(p.units) && p.units.length > 0 &&
    same(p.units, inv.units) &&
    p.format === "discovery-improvement-history-import/v1" &&
    p.manifestHash === m.manifestHash && p.manifestSha256 === manifestSha256 &&
    p.allocationSha256 === allocationSha256 && p.hostId === slot.hostId &&
    p.sourceOutput === expectedSource && p.destination === consolidated &&
    hashPattern.test(p.inventorySha256) &&
    inv.format === "discovery-improvement-history-inventory/v1" &&
    inv.manifestHash === m.manifestHash &&
    inv.manifestSha256 === manifestSha256 &&
    inv.sourceManifestHash === m.sourceManifestHash &&
    inv.allocationSha256 === allocationSha256 && inv.hostId === slot.hostId &&
    inv.sourceOutput === expectedSource && !!entry && !!original &&
    entry.finalReceiptSha256 === slot.finalReceiptSha256 &&
    original.finalReceiptSha256 === slot.finalReceiptSha256 &&
    same(entry.files, slot.files) && same(original.files, slot.files);
}
async function identity(manifestPath: string, allocationPath: string) {
  const mb = await bytes(manifestPath),
    ab = await bytes(allocationPath),
    m = validateManifest(JSON.parse(new TextDecoder().decode(mb))),
    a = JSON.parse(new TextDecoder().decode(ab)) as Allocation;
  if (
    a.manifestHash !== m.manifestHash || a.manifestSha256 !== sha256(mb) ||
    a.sourceManifestHash !== m.sourceManifestHash
  ) throw Error("manifest/allocation drift");
  const ids = a.hosts.flatMap((h) => h.unitIds);
  if (
    ids.length !== 64 || new Set(ids).size !== 64 ||
    m.units.some((u) => !ids.includes(u.id)) ||
    new Set(a.hosts.map((h) => h.id)).size !== a.hosts.length
  ) throw Error("ownership roster drift");
  for (const [path, h] of Object.entries(m.sources)) {
    if (sha256(await bytes(resolve(path))) !== h) {
      throw Error(`source closure drift ${path}`);
    }
  }
  return { m, a, manifestSha256: sha256(mb), allocationSha256: sha256(ab) };
}
export async function reconcile(
  manifestPath: string,
  allocationPath: string,
  consolidated: string,
  reportPath: string,
  rosterPath: string,
) {
  const initial = await identity(manifestPath, allocationPath),
    { m, a, manifestSha256, allocationSha256 } = initial;
  consolidated = resolve(consolidated);
  await idle(consolidated);
  if (
    !within(resolve("runs"), consolidated) || consolidated === resolve("runs")
  ) throw Error("consolidation must be dedicated ignored runs output");
  for (const host of a.hosts) {
    const active = resolve(host.root, host.outputRel);
    if (within(active, consolidated) || within(consolidated, active)) {
      throw Error("consolidation overlaps active shard");
    }
    for (const p of [reportPath, rosterPath]) {
      if (within(active, resolve(p))) {
        throw Error("report/roster overlaps active shard");
      }
    }
  }
  if (
    resolve(reportPath) === resolve(rosterPath) ||
    within(consolidated, resolve(reportPath)) ||
    within(consolidated, resolve(rosterPath))
  ) throw Error("reports must be distinct paths outside consolidated evidence");
  for (const p of [reportPath, rosterPath]) {
    await noSymlinks(p);
    if (await exists(p)) throw Error("new output path already exists");
  }
  async function structure() {
    const snapshot: Record<string, string[]> = {};
    for (const rel of ["", "histories", "provenance", "inventories"]) {
      const p = join(consolidated, rel);
      const names: string[] = [];
      if (await exists(p)) {
        for await (const e of Deno.readDir(p)) {
          names.push(
            `${e.name}:${
              e.isDirectory ? "dir" : e.isFile ? "file" : "other"
            }:${e.isSymlink}`,
          );
        }
      }
      snapshot[rel] = names.sort();
    }
    return snapshot;
  }
  const initialStructure = await structure();
  const unexpected: string[] = [];
  for await (const e of Deno.readDir(consolidated)) {
    if (
      !e.isDirectory || e.isSymlink ||
      !["histories", "provenance", "inventories"].includes(e.name)
    ) unexpected.push(e.name);
  }
  const histories = join(consolidated, "histories"),
    provenanceDir = join(consolidated, "provenance"),
    inventoryDir = join(consolidated, "inventories");
  for (const p of [histories, provenanceDir, inventoryDir]) await noSymlinks(p);
  if (await exists(histories)) {
    for await (const e of Deno.readDir(histories)) {
      if (
        !e.isDirectory || e.isSymlink || !m.units.some((u) => u.id === e.name)
      ) unexpected.push(`histories/${e.name}`);
    }
  }
  const records: { value: any; hash: string }[] = [],
    inventories = new Map<string, HistoryInventory>(),
    evidenceFiles: Record<string, string> = {};
  if (await exists(inventoryDir)) {
    for await (const e of Deno.readDir(inventoryDir)) {
      try {
        if (
          !e.isFile || e.isSymlink || !/^([a-f0-9]{64})\.json$/.test(e.name)
        ) {
          throw Error("unexpected inventory artifact");
        }
        const b = await bytes(join(inventoryDir, e.name)), hash = sha256(b);
        if (e.name !== `${hash}.json`) {
          throw Error("inventory bytes hash mismatch");
        }
        const inv = JSON.parse(new TextDecoder().decode(b)) as HistoryInventory;
        const owner = a.hosts.find((h) => h.id === inv.hostId);
        if (
          !owner ||
          inv.format !== "discovery-improvement-history-inventory/v1" ||
          inv.manifestHash !== m.manifestHash ||
          inv.manifestSha256 !== manifestSha256 ||
          inv.allocationSha256 !== allocationSha256 ||
          inv.sourceManifestHash !== m.sourceManifestHash ||
          inv.sourceOutput !== resolve(owner.root, owner.outputRel) ||
          !Array.isArray(inv.units) || !inv.units.length ||
          new Set(inv.units.map((u) => u.id)).size !== inv.units.length ||
          inv.units.some((u) =>
            !owner.unitIds.includes(u.id) ||
            !hashPattern.test(u.finalReceiptSha256) ||
            !same(Object.keys(u.files).sort(), canonicalNames()) ||
            Object.values(u.files).some((h) => !hashPattern.test(h))
          )
        ) throw Error("foreign/malformed inventory");
        inventories.set(hash, inv);
        evidenceFiles[`inventories/${e.name}`] = hash;
      } catch (err) {
        unexpected.push(`inventories/${e.name}: ${String(err)}`);
      }
    }
  }
  if (await exists(provenanceDir)) {
    for await (const e of Deno.readDir(provenanceDir)) {
      try {
        if (!e.isFile || e.isSymlink || !e.name.endsWith(".json")) {
          throw Error("unexpected provenance artifact");
        }
        const b = await bytes(join(provenanceDir, e.name)),
          p = JSON.parse(new TextDecoder().decode(b));
        if (
          p.format !== "discovery-improvement-history-import/v1" ||
          !Array.isArray(p.units) || p.units.some((u: any) =>
            !m.units.some((x) => x.id === u.id)
          ) || new Set(p.units.map((u: any) => u.id)).size !== p.units.length
        ) throw Error("foreign/malformed provenance");
        const inv = inventories.get(p.inventorySha256),
          owner = a.hosts.find((h) => h.id === p.hostId);
        if (
          !inv || !owner || !p.units.length || !same(p.units, inv.units) ||
          p.units.some((u: any) =>
            !owner.unitIds.includes(u.id) ||
            !provenanceMatches(
              p,
              inv,
              {
                unitId: u.id,
                hostId: owner.id,
                status: "complete",
                finalReceiptSha256: u.finalReceiptSha256,
                files: u.files,
              },
              m,
              manifestSha256,
              allocationSha256,
              consolidated,
              resolve(owner.root, owner.outputRel),
            )
          )
        ) throw Error("provenance whole-inventory/header mismatch");
        records.push({ value: p, hash: sha256(b) });
        evidenceFiles[`provenance/${e.name}`] = sha256(b);
      } catch (err) {
        unexpected.push(`provenance/${e.name}: ${String(err)}`);
      }
    }
  }
  for (const record of records) {
    if (!inventories.has(record.value.inventorySha256)) {
      unexpected.push(`provenance/${record.hash}: raw inventory missing`);
    }
  }
  for (const hash of inventories.keys()) {
    if (!records.some((r) => r.value.inventorySha256 === hash)) {
      unexpected.push(`inventories/${hash}: unreferenced inventory`);
    }
  }
  records.sort((x, y) => x.hash.localeCompare(y.hash));
  const slots: Slot[] = [],
    samples: Record<string, Record<number, Sample>> = {};
  for (const unit of m.units) {
    const host = a.hosts.find((h) => h.unitIds.includes(unit.id))!,
      slot: Slot = { unitId: unit.id, hostId: host.id, status: "missing" };
    slots.push(slot);
    const dir = join(histories, unit.id);
    if (!await exists(dir)) continue;
    try {
      const before = await fileInventory(dir);
      const chain = await loadCheckpointChain(dir, m, unit);
      if (!chain || chain.state.step !== 1000000) {
        throw Error("incomplete physical history");
      }
      if (!same(before, await fileInventory(dir))) {
        throw Error("physical evidence changed during validation");
      }
      const terminal = {
        finalReceiptSha256: chain.receiptSha256,
        files: before,
      };
      slot.finalReceiptSha256 = terminal.finalReceiptSha256;
      slot.files = terminal.files;
      const matches = records.filter((r) => {
        const inv = inventories.get(r.value.inventorySha256);
        return !!inv &&
          provenanceMatches(
            r.value,
            inv,
            slot,
            m,
            manifestSha256,
            allocationSha256,
            consolidated,
            resolve(host.root, host.outputRel),
          );
      });
      if (!matches.length) {
        throw Error("matching verified import inventory/provenance missing");
      }
      const related = records.filter((r) =>
        r.value.units.some((entry: any) => entry.id === unit.id)
      );
      if (related.length !== matches.length) {
        throw Error("conflicting import provenance for unit");
      }
      samples[unit.id] = chain.samples;
      slot.provenanceSha256 = matches.map((r) => r.hash);
      slot.inventorySha256 = [
        ...new Set(matches.map((r) => r.value.inventorySha256)),
      ].sort();
      slot.status = "complete";
    } catch (err) {
      slot.status = "invalid";
      slot.error = String(err);
      delete samples[unit.id];
    }
  }
  // Verify all evidence remains byte-identical and idle before producing any roster.
  await idle(consolidated);
  if (!same(initialStructure, await structure())) {
    throw Error("evidence directory structure changed during reconciliation");
  }
  for (const [path, h] of Object.entries(evidenceFiles)) {
    if (sha256(await bytes(join(consolidated, path))) !== h) {
      throw Error("provenance/inventory changed during reconciliation");
    }
  }
  for (const slot of slots) {
    if (
      slot.status === "complete" &&
      !same(await fileInventory(join(histories, slot.unitId)), slot.files)
    ) {
      slot.status = "invalid";
      slot.error = "physical evidence changed during reconciliation";
      delete samples[slot.unitId];
    }
  }
  const final = await identity(manifestPath, allocationPath);
  if (
    final.manifestSha256 !== manifestSha256 ||
    final.allocationSha256 !== allocationSha256
  ) throw Error("identity changed during reconciliation");
  unexpected.sort();
  const gate = readiness(m, slots, unexpected, samples), roster = gate.roster;
  const counts: Record<string, number> = {};
  for (const draw of roster?.draws ?? []) {
    counts[draw.status] = (counts[draw.status] ?? 0) + 1;
  }
  const report = {
    format: "discovery-improvement-global-readiness/v1",
    manifestHash: m.manifestHash,
    manifestSha256,
    sourceManifestHash: m.sourceManifestHash,
    allocationSha256,
    consolidated,
    physicalComplete: gate.physicalComplete,
    slots,
    unexpected,
    evidenceFiles: Object.fromEntries(
      Object.entries(evidenceFiles).sort(([a], [b]) => a.localeCompare(b)),
    ),
    semanticCounts: roster
      ? {
        draws: roster.draws.length,
        requests: roster.assays.length,
        uniqueConfigurations: roster.uniqueKeys.length,
        drawStatuses: counts,
      }
      : null,
    rosterSha256: gate.rosterBytes ? sha256(gate.rosterBytes) : null,
  };
  await atomicNew(reportPath, JSON.stringify(report, null, 2) + "\n");
  if (gate.rosterBytes) await atomicNew(rosterPath, gate.rosterBytes);
  return report;
}
if (import.meta.main) {
  if (Deno.args.length !== 5) {
    throw Error(
      "usage: MANIFEST ALLOCATION CONSOLIDATED_DIR NEW_REPORT NEW_ROSTER",
    );
  }
  await reconcile(
    ...Deno.args.map((p) => resolve(p)) as [
      string,
      string,
      string,
      string,
      string,
    ],
  );
}
