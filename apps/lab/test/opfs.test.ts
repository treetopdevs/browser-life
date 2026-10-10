import { afterEach, describe, expect, it, vi } from "vitest";
import { RECORDS_WAIT_MS, StorageError, forgetCheckpoint, listCheckpoints, readManifest, recordCheckpoint, storageProblem, writeFile, writeManifest } from "../src/opfs.ts";
import type { CheckpointMeta, RunManifest } from "../src/protocol.ts";

/** What WebKit's ephemeral sessions (Safari Private Browsing among them) answer to getDirectory. */
const refused = () => Promise.reject(new DOMException("The operation failed for an unknown transient reason (e.g. out of memory).", "UnknownError"));

/** A browser with sync access handles in workers and the given getDirectory. */
function browser(getDirectory: () => Promise<unknown>) {
  vi.stubGlobal("FileSystemFileHandle", class { createSyncAccessHandle() {} });
  vi.stubGlobal("navigator", { storage: { getDirectory } });
}

type Faults = { open?: string; remove?: string; write?: string; flush?: string };

/**
 * An in-memory checkpoints directory. Each fault names a file and applies once: `open`, the store will not open it;
 * `remove`, will not remove it; `write`, the next write to it runs out of room halfway; `flush`, the next flush of it
 * fails and what was written is lost. A write or flush fault comes after the truncate, so the file is left torn.
 */
function store(faults: Faults) {
  const files = new Map<string, Uint8Array>();
  const notFound = () => new DOMException("A requested file or directory could not be found.", "NotFoundError");
  const once = (fault: keyof Faults, name: string) => faults[fault] === name && (delete faults[fault], true);
  const dir = {
    async getFileHandle(name: string, { create = false } = {}) {
      if (!files.has(name)) {
        if (!create) throw notFound();
        files.set(name, new Uint8Array());
      }
      return {
        async createSyncAccessHandle() {
          if (once("open", name)) await refused();
          return {
            getSize: () => files.get(name)!.byteLength,
            read: (buf: Uint8Array) => (buf.set(files.get(name)!), buf.byteLength),
            write: (buf: Uint8Array) => {
              if (once("write", name)) {
                files.set(name, buf.slice(0, buf.byteLength >> 1));
                throw new DOMException("The operation failed because it would cause the application to exceed its storage quota.", "QuotaExceededError");
              }
              files.set(name, buf.slice());
              return buf.byteLength;
            },
            truncate: (n: number) => files.set(name, files.get(name)!.slice(0, n)),
            flush() {
              if (once("flush", name)) {
                files.set(name, new Uint8Array());
                throw new DOMException("The operation failed for an unknown transient reason (e.g. out of memory).", "UnknownError");
              }
            },
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

/** Web Locks for the origin: requests for one name are granted one at a time, in order; a waiting one gives up when its signal aborts. */
function locks() {
  const tails = new Map<string, Promise<unknown>>();
  const request = (name: string, options: { signal?: AbortSignal }, fn: () => Promise<unknown>) => {
    const before = tails.get(name) ?? Promise.resolve();
    const granted = new Promise<void>((resolve, reject) => {
      void before.then(() => resolve());
      options.signal?.addEventListener("abort", () => reject(options.signal!.reason));
    });
    const run = granted.then(fn);
    tails.set(name, run.then(() => undefined, () => before));
    return run;
  };
  vi.stubGlobal("navigator", { ...navigator, locks: { request } });
  return { request };
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
    // An index that does not parse is the shelf before its last update, and with no earlier version, an empty one.
    files.set("index.json", new TextEncoder().encode("{"));
    expect(await shelf()).toEqual(["a.blck"]);
    files.set("index.json.prev", new TextEncoder().encode("[{}]"));
    expect(await shelf()).toEqual([]);
  });

  for (const fault of ["write", "flush"] as const) {
    it(`keeps the shelf when a ${fault} of its index fails partway`, async () => {
      const faults: Faults = {};
      const files = store(faults);
      for (const f of ["a.blck", "b.blck"]) {
        await writeFile(f, new Uint8Array(4));
        await recordCheckpoint(meta(f));
      }
      await writeFile("c.blck", new Uint8Array(4));
      faults[fault] = "index.json";
      await expect(recordCheckpoint(meta("c.blck"))).rejects.toBeInstanceOf(StorageError);
      // The index itself is torn, and the shelf is the one before the save that failed.
      expect(() => JSON.parse(new TextDecoder().decode(files.get("index.json")))).toThrow();
      expect(await shelf()).toEqual(["a.blck", "b.blck"]);
      // The next save adds to that shelf rather than starting a new one, and its earlier version stays intact.
      await writeFile("d.blck", new Uint8Array(4));
      await recordCheckpoint(meta("d.blck"));
      expect(await shelf()).toEqual(["a.blck", "b.blck", "d.blck"]);
      // A delete whose index update fails leaves the rest listed (the deleted file is gone, so it is not).
      faults[fault] = "index.json";
      await expect(forgetCheckpoint("a.blck")).rejects.toBeInstanceOf(StorageError);
      expect(await shelf()).toEqual(["b.blck", "d.blck"]);
      await forgetCheckpoint("b.blck");
      expect(await shelf()).toEqual(["d.blck"]);
    });
  }

  it("never lets a torn copy of the previous index stand in for a good one", async () => {
    const faults: Faults = {};
    const files = store(faults);
    for (const f of ["a.blck", "b.blck", "c.blck"]) await writeFile(f, new Uint8Array(4));
    for (const f of ["a.blck", "b.blck"]) await recordCheckpoint(meta(f));
    // Copying the current index aside fails: the save is refused before the index itself is touched.
    faults.write = "index.json.prev";
    await expect(recordCheckpoint(meta("c.blck"))).rejects.toBeInstanceOf(StorageError);
    expect(JSON.parse(new TextDecoder().decode(files.get("index.json"))).map((m: CheckpointMeta) => m.file)).toEqual(["a.blck", "b.blck"]);
    expect(await shelf()).toEqual(["a.blck", "b.blck"]);
    // A torn index is not copied over the intact version before it.
    faults.flush = "index.json";
    await expect(recordCheckpoint(meta("c.blck"))).rejects.toBeInstanceOf(StorageError);
    await expect(recordCheckpoint(meta("c.blck"))).resolves.toBeUndefined();
    expect(await shelf()).toEqual(["a.blck", "b.blck", "c.blck"]);
    expect(JSON.parse(new TextDecoder().decode(files.get("index.json.prev"))).map((m: CheckpointMeta) => m.file)).toEqual(["a.blck", "b.blck"]);
  });

  for (const fault of ["write", "flush"] as const) {
    it(`keeps a run's checkpoint history and interventions when a ${fault} of its manifest fails partway`, async () => {
      const faults: Faults = {};
      const files = store(faults);
      const run = (steps: number[], interventions: number): RunManifest =>
        ({ runId: "spots-s1", presetId: "spots", seed: 1, interventions: Array.from({ length: interventions }, (_, i) => ({ step: i })), checkpoints: steps.map((step) => ({ step, file: `spots-s1-t${step}.blck`, hash: "h", interventions })) }) as unknown as RunManifest;
      expect(await readManifest("spots-s1")).toBeNull();
      await writeManifest(run([100], 1));
      await writeManifest(run([100, 200], 2));
      faults[fault] = "spots-s1.run.json";
      await expect(writeManifest(run([100, 200, 300], 3))).rejects.toBeInstanceOf(StorageError);
      expect(() => JSON.parse(new TextDecoder().decode(files.get("spots-s1.run.json")))).toThrow();
      // What a restore reads: the run as of its last save that finished, with the interventions it had.
      const saved = await readManifest("spots-s1");
      expect(saved?.checkpoints.map((c) => c.step)).toEqual([100, 200]);
      expect(saved?.interventions).toHaveLength(2);
      await writeManifest(run([100, 200, 400], 4));
      expect((await readManifest("spots-s1"))?.checkpoints.map((c) => c.step)).toEqual([100, 200, 400]);
      // Neither version intact is no manifest at all, which a restore forks from as before.
      files.set("spots-s1.run.json", new Uint8Array());
      files.set("spots-s1.run.json.prev", new TextEncoder().encode('{"runId":"spots-s1"}'));
      expect(await readManifest("spots-s1")).toBeNull();
    });
  }

  it("lets two lab tabs save at once without either dropping the other's copy", async () => {
    store({});
    locks();
    for (const f of ["a.blck", "b.blck", "c.blck"]) await writeFile(f, new Uint8Array(4));
    await recordCheckpoint(meta("a.blck"));
    await Promise.all([recordCheckpoint(meta("b.blck")), recordCheckpoint(meta("c.blck")), forgetCheckpoint("a.blck")]);
    expect(await shelf()).toEqual(["b.blck", "c.blck"]);
  });

  it("refuses a request while another lab tab holds the saved copies too long, and serves the next one", async () => {
    store({});
    const { request } = locks();
    await writeFile("a.blck", new Uint8Array(4));
    let release = () => {};
    void request("lab-checkpoint-records", {}, () => new Promise<void>((resolve) => (release = resolve)));
    vi.useFakeTimers();
    const waiting = recordCheckpoint(meta("a.blck")).then(() => null, (err: unknown) => err);
    await vi.advanceTimersByTimeAsync(RECORDS_WAIT_MS);
    const e = await waiting;
    expect(e).toBeInstanceOf(StorageError);
    expect((e as StorageError).detail).toBe("another lab tab is still using the saved copies");
    vi.useRealTimers();
    release();
    await recordCheckpoint(meta("a.blck"));
    expect(await shelf()).toEqual(["a.blck"]);
  });

  it("refuses a write that the store cut short without saying so", async () => {
    const short = { createSyncAccessHandle: async () => ({ truncate() {}, write: () => 2, flush() {}, close() {} }) };
    vi.stubGlobal("navigator", { storage: { getDirectory: async () => ({ getDirectoryHandle: async () => ({ getFileHandle: async () => short }) }) } });
    const e = await writeFile("x.blck", new Uint8Array(4)).then(() => null, (err: unknown) => err);
    expect(e).toBeInstanceOf(StorageError);
    expect((e as StorageError).detail).toBe("wrote 2 of 4 bytes");
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
