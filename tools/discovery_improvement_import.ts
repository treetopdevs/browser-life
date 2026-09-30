// CPU-only inventory and additive import of terminal, immutable history snapshots.
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import { sha256 } from "./lib/founder-policy.ts";
import {
  CHECKPOINT_STEPS,
  checkpointPaths,
  loadCheckpointChain,
  type Manifest,
  type Unit,
  validateManifest,
  writeNew,
} from "./lib/discovery-improvement-runtime.ts";
import { statfsSync } from "node:fs";
import type { Allocation } from "./discovery_improvement_shard.ts";
export interface HistoryInventory {
  format: "discovery-improvement-history-inventory/v1";
  manifestHash: string;
  manifestSha256: string;
  sourceManifestHash: string;
  allocationSha256: string;
  hostId: string;
  sourceOutput: string;
  observedAt: string;
  units: {
    id: string;
    finalReceiptSha256: string;
    files: Record<string, string>;
  }[];
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
export async function noSymlinks(path: string): Promise<void> {
  const absolute = resolve(path);
  let cursor = absolute;
  while (true) {
    if (await exists(cursor)) {
      const s = await Deno.lstat(cursor);
      if (s.isSymlink) throw Error(`symlink forbidden ${cursor}`);
    }
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
}
function within(parent: string, path: string) {
  const rel = relative(parent, path);
  return rel === "" ||
    (!isAbsolute(rel) && rel !== ".." && !rel.startsWith("../"));
}
async function idle(path: string) {
  await noSymlinks(path);
  for (
    const name of [
      "RUNNING",
      "SUPERVISOR",
      "SHARD_RUNNING",
      "SHARD_SUPERVISOR",
      "IMPORT_RUNNING",
    ]
  ) {
    if (await exists(join(path, name))) {
      throw Error(`active output ${path}/${name}`);
    }
  }
}
export function canonicalNames(): string[] {
  return CHECKPOINT_STEPS.flatMap((step) =>
    Object.values(checkpointPaths("", step)).map((path) => basename(path))
  ).sort();
}
async function stableBytes(path: string): Promise<Uint8Array> {
  await noSymlinks(path);
  const before = await Deno.lstat(path);
  if (!before.isFile) throw Error(`nonfile ${path}`);
  const bytes = await Deno.readFile(path), after = await Deno.lstat(path);
  if (
    after.isSymlink || before.ino !== after.ino || before.size !== after.size ||
    before.mtime?.getTime() !== after.mtime?.getTime() ||
    before.size !== bytes.length
  ) throw Error(`concurrent file drift ${path}`);
  return bytes;
}
export async function fileInventory(
  dir: string,
): Promise<Record<string, string>> {
  await noSymlinks(dir);
  const expected = canonicalNames(), actual: string[] = [];
  for await (const e of Deno.readDir(dir)) {
    if (!e.isFile || e.isSymlink) {
      throw Error(`nonfile history artifact ${e.name}`);
    }
    actual.push(e.name);
  }
  const extras = actual.filter((x) => !expected.includes(x));
  // The optional optimization cache is excluded: no-cache semantic validation remains authoritative.
  if (extras.some((x) => x !== "verified-chain-cache.json")) {
    throw Error("extra history artifacts");
  }
  if (expected.some((x) => !actual.includes(x))) {
    throw Error("terminal history missing canonical files");
  }
  const hashes: Record<string, string> = {};
  for (const name of expected) {
    hashes[name] = sha256(await stableBytes(join(dir, name)));
  }
  return hashes;
}
function same(a: unknown, b: unknown) {
  return JSON.stringify(a) === JSON.stringify(b);
}
export async function validateTerminal(
  dir: string,
  m: Manifest,
  unit: Unit,
  expected?: Record<string, string>,
) {
  const before = await fileInventory(dir);
  if (expected && !same(before, expected)) {
    throw Error(`inventory drift ${unit.id}`);
  }
  const chain = await loadCheckpointChain(dir, m, unit);
  if (!chain || chain.state.step !== 1000000) {
    throw Error(`nonterminal history ${unit.id}`);
  }
  const after = await fileInventory(dir);
  if (!same(before, after)) {
    throw Error(`history changed during validation ${unit.id}`);
  }
  return { id: unit.id, finalReceiptSha256: chain.receiptSha256, files: after };
}
async function identities(manifestPath: string, allocationPath: string) {
  await noSymlinks(manifestPath);
  await noSymlinks(allocationPath);
  const mb = await stableBytes(manifestPath),
    ab = await stableBytes(allocationPath),
    m = validateManifest(JSON.parse(new TextDecoder().decode(mb))),
    a = JSON.parse(new TextDecoder().decode(ab)) as Allocation;
  if (
    a.manifestSha256 !== sha256(mb) || a.manifestHash !== m.manifestHash ||
    a.sourceManifestHash !== m.sourceManifestHash
  ) throw Error("manifest/allocation identity drift");
  const all = a.hosts.flatMap((h) => h.unitIds);
  if (
    all.length !== m.units.length || new Set(all).size !== all.length ||
    m.units.some((u) => !all.includes(u.id))
  ) throw Error("ownership partition drift");
  // Validate the actual scientific validator bytes against the immutable source closure.
  for (const [path, hash] of Object.entries(m.sources)) {
    if (sha256(await stableBytes(resolve(path))) !== hash) {
      throw Error(`source closure drift ${path}`);
    }
  }
  for (
    const path of [
      "tools/lib/discovery-improvement-runtime.ts",
      "tools/lib/discovery-evolution.ts",
      "tools/lib/founder-policy.ts",
    ]
  ) if (!m.sources[path]) throw Error("validator source closure incomplete");
  return { m, a, manifestSha256: sha256(mb), allocationSha256: sha256(ab) };
}
export async function inventory(
  manifestPath: string,
  allocationPath: string,
  hostId: string,
  source: string,
  report: string,
  ids: string[],
) {
  const identity = await identities(manifestPath, allocationPath),
    { m, a } = identity,
    host = a.hosts.find((h) => h.id === hostId);
  if (!host || resolve(source) !== resolve(host.root, host.outputRel)) {
    throw Error("source host/output mismatch");
  }
  if (within(source, report)) {
    throw Error("inventory report must be outside production output");
  }
  if (
    !ids.length || new Set(ids).size !== ids.length ||
    ids.some((id) => !host.unitIds.includes(id))
  ) throw Error("foreign/duplicate/empty inventory units");
  const units = [];
  for (const id of ids) {
    units.push(
      await validateTerminal(
        join(source, "histories", id),
        m,
        m.units.find((u) => u.id === id)!,
      ),
    );
  }
  const finalIdentity = await identities(manifestPath, allocationPath);
  if (
    finalIdentity.manifestSha256 !== identity.manifestSha256 ||
    finalIdentity.allocationSha256 !== identity.allocationSha256
  ) throw Error("identity changed during inventory");
  const value: HistoryInventory = {
    format: "discovery-improvement-history-inventory/v1",
    manifestHash: m.manifestHash,
    manifestSha256: identity.manifestSha256,
    sourceManifestHash: m.sourceManifestHash,
    allocationSha256: identity.allocationSha256,
    hostId,
    sourceOutput: resolve(source),
    observedAt: new Date().toISOString(),
    units,
  };
  await noSymlinks(report);
  await writeNew(report, JSON.stringify(value, null, 2) + "\n");
  return value;
}
export async function importHistories(
  manifestPath: string,
  allocationPath: string,
  inventoryPath: string,
  staging: string,
  destination: string,
) {
  const { m, a, manifestSha256, allocationSha256 } = await identities(
      manifestPath,
      allocationPath,
    ),
    ib = await stableBytes(inventoryPath),
    inv = JSON.parse(new TextDecoder().decode(ib)) as HistoryInventory,
    host = a.hosts.find((h) => h.id === inv.hostId);
  if (
    inv.format !== "discovery-improvement-history-inventory/v1" ||
    inv.manifestHash !== m.manifestHash ||
    inv.manifestSha256 !== manifestSha256 ||
    inv.sourceManifestHash !== m.sourceManifestHash ||
    inv.allocationSha256 !== allocationSha256 || !host ||
    inv.sourceOutput !== resolve(host.root, host.outputRel)
  ) throw Error("inventory identity/ownership drift");
  staging = resolve(staging);
  destination = resolve(destination);
  if (
    within(staging, destination) || within(destination, staging) ||
    staging === inv.sourceOutput
  ) throw Error("staging/source/destination overlap");
  for (const h of a.hosts) {
    const active = resolve(h.root, h.outputRel);
    if (
      within(active, destination) || within(destination, active) ||
      within(active, staging) || within(staging, active)
    ) throw Error("active production path overlap");
  }
  if (
    !within(resolve("runs"), destination) || destination === resolve("runs")
  ) throw Error("consolidation must be a dedicated runs subdirectory");
  await idle(staging);
  await idle(destination);
  for (
    const path of [
      join(destination, "histories"),
      join(destination, "provenance"),
    ]
  ) await noSymlinks(path);
  if (await exists(join(destination, "histories"))) {
    for await (const e of Deno.readDir(join(destination, "histories"))) {
      if (
        !e.isDirectory || e.isSymlink || !m.units.some((u) => u.id === e.name)
      ) throw Error("unexpected destination history");
    }
  }
  await noSymlinks(inventoryPath);
  if (
    !inv.units.length ||
    new Set(inv.units.map((u) => u.id)).size !== inv.units.length ||
    inv.units.some((u) => !host.unitIds.includes(u.id))
  ) throw Error("inventory foreign/duplicate/empty units");
  const ids = inv.units.map((u) => u.id).sort(), actual = [];
  for await (const e of Deno.readDir(join(staging, "histories"))) {
    if (!e.isDirectory || e.isSymlink) {
      throw Error("non-directory staged history");
    }
    actual.push(e.name);
  }
  if (!same(actual.sort(), ids)) {
    throw Error("staging unit roster missing/extra");
  }
  // Preflight every source and every existing destination before copying any bytes.
  for (const entry of inv.units) {
    const u = m.units.find((u) => u.id === entry.id)!;
    const checked = await validateTerminal(
      join(staging, "histories", u.id),
      m,
      u,
      entry.files,
    );
    if (checked.finalReceiptSha256 !== entry.finalReceiptSha256) {
      throw Error("final receipt drift");
    }
    const target = join(destination, "histories", u.id);
    if (await exists(target)) await validateTerminal(target, m, u, entry.files);
  }
  let required = 0;
  for (const entry of inv.units) {
    if (!await exists(join(destination, "histories", entry.id))) {
      for (const name of Object.keys(entry.files)) {
        required +=
          (await Deno.lstat(join(staging, "histories", entry.id, name))).size;
      }
    }
  }
  const floor = a.minimumFreeBytes;
  if (!Number.isFinite(floor) || floor < 20 * 1024 ** 3) {
    throw Error("invalid import storage floor");
  }
  const free = (path: string) => {
    const fs = statfsSync(path);
    return Number(fs.bavail) * Number(fs.bsize);
  };
  let storagePath = destination;
  while (!await exists(storagePath)) storagePath = dirname(storagePath);
  if (free(storagePath) < required + floor) {
    throw Error("import storage envelope insufficient");
  }
  await Deno.mkdir(destination, { recursive: true });
  await noSymlinks(destination);
  const lock = join(destination, "IMPORT_RUNNING");
  await Deno.writeTextFile(
    lock,
    JSON.stringify({ pid: Deno.pid, inventorySha256: sha256(ib) }) + "\n",
    { createNew: true },
  );
  try {
    for (const entry of inv.units) {
      const source = join(staging, "histories", entry.id),
        target = join(destination, "histories", entry.id),
        u = m.units.find((u) => u.id === entry.id)!;
      await validateTerminal(source, m, u, entry.files);
      if (await exists(target)) {
        await validateTerminal(target, m, u, entry.files);
      } else {
        await noSymlinks(dirname(target));
        await Deno.mkdir(dirname(target), { recursive: true });
        await noSymlinks(dirname(target));
        const temporary = await Deno.makeTempDir({
          dir: dirname(target),
          prefix: ".import-",
        });
        try {
          for (const [name, hash] of Object.entries(entry.files)) {
            await noSymlinks(temporary);
            const bytes = await stableBytes(join(source, name));
            if (sha256(bytes) !== hash) throw Error("copy source drift");
            if (free(destination) < floor + bytes.length) {
              throw Error("import storage floor reached");
            }
            await Deno.writeFile(join(temporary, name), bytes, {
              createNew: true,
            });
          }
          await validateTerminal(temporary, m, u, entry.files);
          await validateTerminal(source, m, u, entry.files);
          await noSymlinks(target);
          if (await exists(target)) {
            throw Error("destination appeared concurrently");
          }
          await Deno.rename(temporary, target);
        } catch (e) {
          await Deno.remove(temporary, { recursive: true });
          throw e;
        }
      }
    }
    if (sha256(await stableBytes(inventoryPath)) !== sha256(ib)) {
      throw Error("inventory changed during import");
    }
    const finalIdentity = await identities(manifestPath, allocationPath);
    if (
      finalIdentity.manifestSha256 !== manifestSha256 ||
      finalIdentity.allocationSha256 !== allocationSha256
    ) throw Error("identity changed during import");
    await noSymlinks(join(destination, "provenance"));
    const provenance = {
      format: "discovery-improvement-history-import/v1",
      observedAt: new Date().toISOString(),
      manifestHash: m.manifestHash,
      manifestSha256,
      allocationSha256,
      inventorySha256: sha256(ib),
      hostId: inv.hostId,
      sourceOutput: inv.sourceOutput,
      staging,
      destination,
      units: inv.units,
    };
    await writeNew(
      join(
        destination,
        "provenance",
        `${Date.now()}-${crypto.randomUUID()}.json`,
      ),
      JSON.stringify(provenance, null, 2) + "\n",
    );
    return provenance;
  } finally {
    await Deno.remove(lock);
  }
}
if (import.meta.main) {
  const [command, ...args] = Deno.args;
  if (command === "inventory" && args.length >= 6) {
    await inventory(
      resolve(args[0]),
      resolve(args[1]),
      args[2],
      resolve(args[3]),
      resolve(args[4]),
      args.slice(5),
    );
  } else if (command === "import" && args.length === 5) {
    await importHistories(
      ...args.map((path) => resolve(path)) as [
        string,
        string,
        string,
        string,
        string,
      ],
    );
  } else {throw Error(
      "usage: inventory MANIFEST ALLOCATION HOST SOURCE NEW_REPORT UNIT_ID... | import MANIFEST ALLOCATION INVENTORY STAGING CONSOLIDATION",
    );}
}
