// Checkpoint storage in the Origin Private File System (worker-only sync handles).
//
// Some browsers keep none: WebKit's ephemeral sessions (Safari Private Browsing among them) reject getDirectory
// with "UnknownError". Every failure here is a StorageError, which refuses the request that met it and leaves the
// world running; `storageProblem` finds out once, up front, whether this browser keeps checkpoints at all.

import type { CheckpointMeta, RunManifest } from "./protocol.ts";
import type { RewindRecord } from "./session-file.ts";

/** The checkpoint store would not open, read or write. The world is untouched: only the copy is missing. */
export class StorageError extends Error {
  /** `detail`: the browser's own words; `cause`: its error, when there was one. */
  constructor(message: string, readonly detail: string, options?: ErrorOptions) {
    super(message, options);
  }
}

const said = (e: unknown) => (e instanceof Error ? e.message || e.name : String(e));

async function stored<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof StorageError) throw e;
    throw new StorageError(`This browser wouldn't let the lab keep or read its copies here (${said(e)}). The world itself is fine, and Download still gives you a file.`, said(e), { cause: e });
  }
}

/** The file asked for is not there: an answer from the store, unlike a store that would not answer. */
export const missingFile = (e: unknown): boolean => e instanceof StorageError && (e.cause as { name?: unknown } | undefined)?.name === "NotFoundError";

async function dir(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle("checkpoints", { create: true });
}

/**
 * Why this browser keeps no checkpoints here, in the browser's own words, or null when it does. Opens the
 * checkpoints directory, which every save opens anyway, and writes no file. The lab waits for this before its
 * first world, so a store that has not answered within `waitMs` counts as none.
 */
export async function storageProblem(waitMs = 5000): Promise<string | null> {
  const handle = (globalThis as { FileSystemFileHandle?: { prototype: object } }).FileSystemFileHandle;
  if (!handle || !("createSyncAccessHandle" in handle.prototype)) return "no synchronous file access in workers";
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<string>((resolve) => (timer = setTimeout(() => resolve(`no answer from storage within ${waitMs / 1000} s`), waitMs)));
  try {
    return await Promise.race([dir().then(() => null), late]);
  } catch (e) {
    return said(e);
  } finally {
    clearTimeout(timer);
  }
}

type SyncHandle = {
  write(buf: ArrayBufferView, opts?: { at: number }): number;
  read(buf: ArrayBufferView, opts?: { at: number }): number;
  getSize(): number;
  truncate(n: number): void;
  flush(): void;
  close(): void;
};

async function syncHandle(name: string, create: boolean): Promise<SyncHandle> {
  const d = await dir();
  const fh = await d.getFileHandle(name, { create });
  return (fh as unknown as { createSyncAccessHandle(): Promise<SyncHandle> }).createSyncAccessHandle();
}

/**
 * Writes a file in place. One that fails after the truncate leaves the file empty or cut short: fine for a
 * checkpoint, which is new per save and listed only once written, but not for a record (`writeRecord`).
 */
export async function writeFile(name: string, bytes: Uint8Array): Promise<void> {
  return stored(async () => {
    const h = await syncHandle(name, true);
    try {
      h.truncate(0);
      const wrote = h.write(bytes, { at: 0 });
      if (wrote !== bytes.byteLength) throw new Error(`wrote ${wrote} of ${bytes.byteLength} bytes`);
      h.flush();
    } finally {
      h.close();
    }
  });
}

export async function readFile(name: string): Promise<Uint8Array> {
  return stored(async () => {
    const h = await syncHandle(name, false);
    try {
      const out = new Uint8Array(h.getSize());
      h.read(out, { at: 0 });
      return out;
    } finally {
      h.close();
    }
  });
}

/**
 * Records: small JSON files updated in place (the shelf's index, each run's manifest). An update copies the
 * record's current version to `<name>.prev` before rewriting it, and a record that does not parse, or is not what
 * `valid` expects, reads as that previous version. A write or flush that fails partway, or a page closed in the
 * middle, so leaves a reader the version before the update instead of nothing: `.prev` is written only while the
 * record is intact, and the record only once `.prev` holds its last intact version.
 * Copy-then-rewrite rather than write-then-move: OPFS file handles have move() (Chrome 102, Firefox 111, Safari 15.2),
 * but moving onto an existing name is shown to work only in Chromium (web-platform-tests runs no move test in
 * Safari), and a remove-then-move would open a gap with no record at all.
 */
const previous = (name: string) => `${name}.prev`;

/** The record and its bytes when the file is there and holds one, null when it is missing or torn. */
async function intact<T>(name: string, valid: (v: unknown) => v is T): Promise<{ value: T; bytes: Uint8Array } | null> {
  let bytes: Uint8Array;
  try {
    bytes = await readFile(name);
  } catch (e) {
    // A missing file is an answer; a store that would not read it is none.
    if (missingFile(e)) return null;
    throw e;
  }
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return valid(value) ? { value, bytes } : null;
  } catch {
    return null;
  }
}

/** The record named, or its version before an update that did not finish; null when there is neither. */
async function readRecord<T>(name: string, valid: (v: unknown) => v is T): Promise<T | null> {
  return stored(async () => ((await intact(name, valid)) ?? (await intact(previous(name), valid)))?.value ?? null);
}

/**
 * Replaces the record named. Its current version, when intact, goes to `<name>.prev` first; a torn one is not
 * copied, since `.prev` then holds the last version that was. A failure throws, and the record reads as before.
 */
async function writeRecord<T>(name: string, value: T, valid: (v: unknown) => v is T): Promise<void> {
  return stored(async () => {
    const current = await intact(name, valid);
    if (current) await writeFile(previous(name), current.bytes);
    await writeFile(name, new TextEncoder().encode(JSON.stringify(value)));
  });
}

export async function removeFile(name: string): Promise<void> {
  return stored(async () => {
    const d = await dir();
    await d.removeEntry(name);
  });
}

/** How long a request waits for another lab tab to finish with the records before it is refused. */
export const RECORDS_WAIT_MS = 10_000;

/**
 * Runs `fn` holding the origin's lock on the records, so an update in one lab tab never interleaves with another
 * tab's: without it, a tab could write an index that misses the other tab's save, or copy a version it read earlier
 * over the only intact one. Not reentrant, so nothing run under it takes it again. A browser without Web Locks
 * runs `fn` at once, as before; a lock not granted within RECORDS_WAIT_MS refuses the request.
 */
async function locked<T>(fn: () => Promise<T>): Promise<T> {
  const locks = (navigator as { locks?: LockManager }).locks;
  if (!locks) return fn();
  const late = new AbortController();
  const timer = setTimeout(() => late.abort(new Error("another lab tab is still using the saved copies")), RECORDS_WAIT_MS);
  try {
    return await locks.request("lab-checkpoint-records", { signal: late.signal }, () => {
      clearTimeout(timer);
      return fn();
    });
  } finally {
    clearTimeout(timer);
  }
}

const INDEX = "index.json";

const isIndex = (v: unknown): v is CheckpointMeta[] =>
  Array.isArray(v) && v.every((m: Partial<CheckpointMeta> | null) => typeof m?.file === "string" && typeof m.runId === "string" && typeof m.step === "number");

/** The shelf, read under the lock its caller holds. */
async function shelfNow(): Promise<CheckpointMeta[]> {
  const d = await dir();
  // No index yet is an empty shelf; one whose last update did not finish is the shelf before it. An index the
  // store would not read is no answer: taking it for empty would let the next save write an index without the others.
  const index = (await readRecord(INDEX, isIndex)) ?? [];
  const present = new Set<string>();
  for await (const [name] of (d as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) present.add(name);
  return index.filter((m) => present.has(m.file));
}

export async function listCheckpoints(): Promise<CheckpointMeta[]> {
  return stored(() => locked(shelfNow));
}

export async function recordCheckpoint(meta: CheckpointMeta): Promise<void> {
  return stored(() =>
    locked(async () => {
      const list = (await shelfNow()).filter((m) => m.file !== meta.file);
      list.push(meta);
      await writeRecord(INDEX, list, isIndex);
    }),
  );
}

const manifestFile = (runId: string) => `${runId}.run.json`;

const isManifest = (v: unknown): v is RunManifest =>
  typeof v === "object" && v !== null && typeof (v as RunManifest).runId === "string" && Array.isArray((v as RunManifest).checkpoints) && Array.isArray((v as RunManifest).interventions);

/** Legacy manifests get a content token until their first revisioned save. */
const revisionOf = (m: RunManifest): string => m.storageRevision ?? JSON.stringify(m);

/** Reads the recoverable version and remembers exactly which history a continued run may replace. */
export async function readManifest(runId: string): Promise<RunManifest | null> {
  return stored(() => locked(async () => {
    const m = await readRecord(manifestFile(runId), isManifest);
    return m ? { ...m, storageRevision: revisionOf(m) } : null;
  }));
}

function needLocks(): void {
  if (!(navigator as { locks?: LockManager }).locks) {
    throw new StorageError("This browser cannot safely coordinate saved runs. Download still gives you a file.", "Web Locks unavailable");
  }
}

/** Caller holds the records lock, including throughout any destructive pruning. */
async function checkRevision(m: RunManifest): Promise<void> {
  const current = await readRecord(manifestFile(m.runId), isManifest);
  if ((current ? revisionOf(current) : undefined) !== m.storageRevision) {
    throw new StorageError("Another tab changed this saved run. Your world is still running: Download it to keep your changes, or open the latest saved copy before continuing. No saved history was replaced.", "saved run changed in another tab");
  }
}

async function commitManifest(m: RunManifest): Promise<void> {
  const next = { ...m, storageRevision: crypto.randomUUID() };
  await writeRecord(manifestFile(m.runId), next, isManifest);
  // Failed writes retain the expected revision so a retry can use .prev recovery.
  m.storageRevision = next.storageRevision;
}

/** Compare and replace under the same origin lock. Conflicts touch neither record nor recovery copy. */
export async function writeManifest(m: RunManifest): Promise<void> {
  return stored(async () => {
    // A comparison without serialization could let both writers pass.
    needLocks();
    await locked(async () => {
      await checkRevision(m);
      await commitManifest(m);
    });
  });
}

/** Pruning checks the writer before deleting, under the same lock as every manifest update. */
export async function pruneCheckpoints(m: RunManifest, files: readonly string[]): Promise<void> {
  return stored(async () => {
    needLocks();
    await locked(async () => {
      await checkRevision(m);
      for (const file of files) {
        await forgetNow(file);
        m.checkpoints = m.checkpoints.filter((c) => c.file !== file);
      }
      await commitManifest(m);
    });
  });
}

/**
 * A checkpoint's log of firsts (its `RewindRecord`), kept in a sidecar beside it rather than in the checkpoint, whose bytes and
 * observer digest it would change (docs/pond-keeper-v0-2026-10-17.md, amendment of 2026-10-18). Written once, before the
 * manifest and the shelf list the checkpoint, and never updated; a record all the same, so a write cut short reads as none.
 */
export const rewindFile = (checkpoint: string) => `${checkpoint}.rewind`;

interface RewindSidecar {
  format: "cadence-garden.rewind";
  version: 1;
  /** The checkpoint file it was saved with: a sidecar under another name is not this checkpoint's. */
  checkpoint: string;
  record: RewindRecord;
}

const isInt = (v: unknown): v is number => Number.isInteger(v);

/** The envelope only: whether the snapshots inside hold up, and for which state, `openFirstsLog` decides on restore. */
const isRewind = (v: unknown): v is RewindSidecar => {
  const s = v as Partial<RewindSidecar> | null;
  if (typeof s !== "object" || s === null || s.format !== "cadence-garden.rewind" || s.version !== 1 || typeof s.checkpoint !== "string") return false;
  const r = s.record as Partial<RewindRecord> | undefined;
  if (typeof r !== "object" || r === null || typeof r.firsts !== "object" || r.firsts === null || typeof r.hash !== "string") return false;
  if (!Array.isArray(r.picks) || !r.picks.every((p) => Array.isArray(p) && p.length === 2 && isInt(p[0]) && typeof p[1] === "boolean")) return false;
  if (r.families === undefined) return true;
  const f = r.families as Partial<NonNullable<RewindRecord["families"]>> | null;
  const g = f?.genealogy;
  return typeof f?.tree === "object" && f.tree !== null && typeof g === "object" && g !== null && isInt(g.edgesFrom) && isInt(g.edges) && isInt(g.dropped);
};

/** Called only while holding the records lock. A sidecar already gone is no failure. */
async function dropRewindNow(checkpoint: string): Promise<void> {
  try {
    await removeFile(rewindFile(checkpoint));
  } catch (e) {
    if (!missingFile(e)) throw e;
  }
}

/**
 * Keeps `record` beside `checkpoint`. A failure throws a StorageError; what the write left (a torn sidecar, which would
 * read as none) is removed at once, so it holds no room the checkpoint's records need, or, if the store will not remove
 * it either, goes with its checkpoint. The save that asked keeps its checkpoint without a log (sim.worker.ts `saveCheckpoint`).
 */
export async function writeRewind(checkpoint: string, record: RewindRecord): Promise<void> {
  const sidecar: RewindSidecar = { format: "cadence-garden.rewind", version: 1, checkpoint, record };
  return stored(() =>
    locked(async () => {
      try {
        await writeRecord(rewindFile(checkpoint), sidecar, isRewind);
      } catch (e) {
        await dropRewindNow(checkpoint).catch(() => {});
        throw e;
      }
    }),
  );
}

/**
 * Removes the sidecar beside `checkpoint`: a save gives up the optional log when the store has no room left for the records
 * that list the checkpoint (sim.worker.ts `saveCheckpoint`). Throws a StorageError when the store will not remove it.
 */
export async function dropRewind(checkpoint: string): Promise<void> {
  return stored(() => locked(() => dropRewindNow(checkpoint)));
}

/** The store refused a write for want of room (its quota), as against one it would not open or one another tab changed. */
export const storeFull = (e: unknown): boolean => e instanceof StorageError && (e.cause as { name?: unknown } | undefined)?.name === "QuotaExceededError";

/**
 * The record kept beside `checkpoint`, or null when there is none to use: a checkpoint saved before sidecars, one whose log had
 * stopped, or a sidecar cut short. A store that will not read it throws, since that says nothing about whether there is one.
 */
export async function readRewind(checkpoint: string): Promise<RewindRecord | null> {
  return stored(() =>
    locked(async () => {
      const s = await readRecord(rewindFile(checkpoint), isRewind);
      return s && s.checkpoint === checkpoint ? s.record : null;
    }),
  );
}

/** Called only while holding the records lock. Failed removals remain available for a later retry. */
async function forgetNow(file: string): Promise<void> {
  // A sidecar is written once under a new name, so it never has a `.prev` to remove.
  for (const f of [file, `${file}.edges`, rewindFile(file)]) {
    try {
      await removeFile(f);
    } catch (e) {
      if (!missingFile(e)) throw e;
    }
  }
  const list = (await shelfNow()).filter((m) => m.file !== file);
  await writeRecord(INDEX, list, isIndex);
}

export async function forgetCheckpoint(file: string): Promise<void> {
  return stored(() => locked(() => forgetNow(file)));
}
