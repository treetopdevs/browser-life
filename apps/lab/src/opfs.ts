// Checkpoint storage in the Origin Private File System (worker-only sync handles).
//
// Some browsers keep none: WebKit's ephemeral sessions (Safari Private Browsing among them) reject getDirectory
// with "UnknownError". Every failure here is a StorageError, which refuses the request that met it and leaves the
// world running; `storageProblem` finds out once, up front, whether this browser keeps checkpoints at all.

import type { CheckpointMeta } from "./protocol.ts";

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

export async function writeFile(name: string, bytes: Uint8Array): Promise<void> {
  return stored(async () => {
    const h = await syncHandle(name, true);
    try {
      h.truncate(0);
      h.write(bytes, { at: 0 });
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

export async function removeFile(name: string): Promise<void> {
  return stored(async () => {
    const d = await dir();
    await d.removeEntry(name);
  });
}

export async function listCheckpoints(): Promise<CheckpointMeta[]> {
  return stored(async () => {
    const d = await dir();
    let index: CheckpointMeta[] = [];
    try {
      index = JSON.parse(new TextDecoder().decode(await readFile("index.json")));
    } catch (e) {
      // No index yet, or one that does not parse, is an empty shelf. An index the store would not read is no
      // answer: taking it for empty would let the next save write an index without the others.
      if (e instanceof StorageError && !missingFile(e)) throw e;
      index = [];
    }
    const present = new Set<string>();
    for await (const [name] of (d as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) present.add(name);
    return index.filter((m) => present.has(m.file));
  });
}

export async function recordCheckpoint(meta: CheckpointMeta): Promise<void> {
  return stored(async () => {
    const list = (await listCheckpoints()).filter((m) => m.file !== meta.file);
    list.push(meta);
    await writeFile("index.json", new TextEncoder().encode(JSON.stringify(list)));
  });
}

export async function forgetCheckpoint(file: string): Promise<void> {
  return stored(async () => {
    // The checkpoint and its mutation-edges sidecar (the lineage inspector's), either possibly already gone. The
    // files go first: a removal the store refuses leaves the shelf naming a checkpoint that is still there.
    for (const f of [file, `${file}.edges`]) {
      try {
        await removeFile(f);
      } catch (e) {
        if (!missingFile(e)) throw e;
      }
    }
    const list = (await listCheckpoints()).filter((m) => m.file !== file);
    await writeFile("index.json", new TextEncoder().encode(JSON.stringify(list)));
  });
}
