// Checkpoint storage in the Origin Private File System (worker-only sync handles).

import type { CheckpointMeta } from "./protocol.ts";

async function dir(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle("checkpoints", { create: true });
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
  const h = await syncHandle(name, true);
  try {
    h.truncate(0);
    h.write(bytes, { at: 0 });
    h.flush();
  } finally {
    h.close();
  }
}

export async function readFile(name: string): Promise<Uint8Array> {
  const h = await syncHandle(name, false);
  try {
    const out = new Uint8Array(h.getSize());
    h.read(out, { at: 0 });
    return out;
  } finally {
    h.close();
  }
}

export async function removeFile(name: string): Promise<void> {
  const d = await dir();
  await d.removeEntry(name);
}

export async function listCheckpoints(): Promise<CheckpointMeta[]> {
  const d = await dir();
  let index: CheckpointMeta[] = [];
  try {
    index = JSON.parse(new TextDecoder().decode(await readFile("index.json")));
  } catch {
    index = [];
  }
  const present = new Set<string>();
  for await (const [name] of (d as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) present.add(name);
  return index.filter((m) => present.has(m.file));
}

export async function recordCheckpoint(meta: CheckpointMeta): Promise<void> {
  const list = (await listCheckpoints()).filter((m) => m.file !== meta.file);
  list.push(meta);
  await writeFile("index.json", new TextEncoder().encode(JSON.stringify(list)));
}

export async function forgetCheckpoint(file: string): Promise<void> {
  const list = (await listCheckpoints()).filter((m) => m.file !== file);
  await writeFile("index.json", new TextEncoder().encode(JSON.stringify(list)));
  // The checkpoint and its mutation-edges sidecar (the lineage inspector's), either possibly already gone.
  for (const f of [file, `${file}.edges`]) {
    try {
      await removeFile(f);
    } catch {
      // already gone
    }
  }
}
