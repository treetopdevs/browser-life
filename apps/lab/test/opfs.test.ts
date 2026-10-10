import { afterEach, describe, expect, it, vi } from "vitest";
import { StorageError, forgetCheckpoint, listCheckpoints, recordCheckpoint, storageProblem, writeFile } from "../src/opfs.ts";
import type { CheckpointMeta } from "../src/protocol.ts";

/** What WebKit's ephemeral sessions (Safari Private Browsing among them) answer to getDirectory. */
const refused = () => Promise.reject(new DOMException("The operation failed for an unknown transient reason (e.g. out of memory).", "UnknownError"));

/** A browser with sync access handles in workers and the given getDirectory. */
function browser(getDirectory: () => Promise<unknown>) {
  vi.stubGlobal("FileSystemFileHandle", class { createSyncAccessHandle() {} });
  vi.stubGlobal("navigator", { storage: { getDirectory } });
}

/** An in-memory checkpoints directory. `open` names a file the store will not open the next time it is asked; `remove`, one it will not remove. */
function store(faults: { open?: string; remove?: string }) {
  const files = new Map<string, Uint8Array>();
  const notFound = () => new DOMException("A requested file or directory could not be found.", "NotFoundError");
  const dir = {
    async getFileHandle(name: string, { create = false } = {}) {
      if (!files.has(name)) {
        if (!create) throw notFound();
        files.set(name, new Uint8Array());
      }
      return {
        async createSyncAccessHandle() {
          if (faults.open === name) {
            delete faults.open;
            await refused();
          }
          return {
            getSize: () => files.get(name)!.byteLength,
            read: (buf: Uint8Array) => (buf.set(files.get(name)!), buf.byteLength),
            write: (buf: Uint8Array) => (files.set(name, buf.slice()), buf.byteLength),
            truncate: (n: number) => files.set(name, files.get(name)!.slice(0, n)),
            flush() {},
            close() {},
          };
        },
      };
    },
    async removeEntry(name: string) {
      if (faults.remove === name) await refused();
      if (!files.delete(name)) throw notFound();
    },
    async *entries() {
      for (const name of files.keys()) yield [name, {}];
    },
  };
  browser(async () => ({ getDirectoryHandle: async () => dir }));
  return files;
}

const meta = (file: string): CheckpointMeta => ({ file, runId: "spots-s1", step: 100, bytes: 4, savedAt: "2026-10-09T00:00:00.000Z" });
const shelf = async () => (await listCheckpoints()).map((m) => m.file);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("lab checkpoint storage", () => {
  it("names why a browser keeps no checkpoints, in the browser's words", async () => {
    browser(refused);
    expect(await storageProblem()).toBe("The operation failed for an unknown transient reason (e.g. out of memory).");
    vi.stubGlobal("navigator", {});
    expect(await storageProblem()).toMatch(/getDirectory|undefined/);
    vi.stubGlobal("FileSystemFileHandle", undefined);
    expect(await storageProblem()).toBe("no synchronous file access in workers");
  });

  it("finds storage when the checkpoints directory opens, and gives up on one that never answers", async () => {
    const opened = vi.fn(async () => ({}));
    browser(async () => ({ getDirectoryHandle: opened }));
    expect(await storageProblem()).toBeNull();
    expect(opened).toHaveBeenCalledWith("checkpoints", { create: true });

    vi.useFakeTimers();
    browser(() => new Promise(() => {}));
    const pending = storageProblem(5000);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await pending).toBe("no answer from storage within 5 s");
  });

  it("turns every storage failure into a StorageError that says the world is fine", async () => {
    browser(refused);
    for (const op of [() => writeFile("x.blck", new Uint8Array(4)), () => listCheckpoints()]) {
      const e = await op().then(() => null, (err: unknown) => err);
      expect(e).toBeInstanceOf(StorageError);
      expect((e as Error).message).toContain("unknown transient reason");
      expect((e as Error).message).toContain("The world itself is fine, and Download still gives you a file.");
    }
  });

  it("never takes an index the store would not read for an empty one", async () => {
    const faults: { open?: string } = {};
    const files = store(faults);
    expect(await shelf()).toEqual([]);
    for (const f of ["a.blck", "b.blck"]) {
      await writeFile(f, new Uint8Array(4));
      await recordCheckpoint(meta(f));
    }
    // The index will not open once, and would have been written the moment after.
    await writeFile("c.blck", new Uint8Array(4));
    faults.open = "index.json";
    await expect(recordCheckpoint(meta("c.blck"))).rejects.toBeInstanceOf(StorageError);
    expect(await shelf()).toEqual(["a.blck", "b.blck"]);
    faults.open = "index.json";
    await expect(listCheckpoints()).rejects.toBeInstanceOf(StorageError);
    // An index that does not parse is an empty shelf, as before.
    files.set("index.json", new TextEncoder().encode("{"));
    expect(await shelf()).toEqual([]);
  });

  it("forgets a checkpoint only once its file is gone, and shrugs at files already gone", async () => {
    const faults: { remove?: string } = {};
    store(faults);
    for (const f of ["a.blck", "a.blck.edges", "b.blck"]) await writeFile(f, new Uint8Array(4));
    for (const f of ["a.blck", "b.blck"]) await recordCheckpoint(meta(f));
    faults.remove = "a.blck";
    await expect(forgetCheckpoint("a.blck")).rejects.toBeInstanceOf(StorageError);
    expect(await shelf()).toEqual(["a.blck", "b.blck"]);
    delete faults.remove;
    await forgetCheckpoint("a.blck");
    // b has no edges sidecar: a file already gone is no failure.
    await forgetCheckpoint("b.blck");
    expect(await shelf()).toEqual([]);
  });
});
