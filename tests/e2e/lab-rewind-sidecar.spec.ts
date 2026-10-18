import { expect, test } from "@playwright/test";
import type { FromWorker, ToWorker } from "../../apps/lab/src/protocol.ts";

// The log of firsts and the family tree kept beside a saved checkpoint in a `.rewind` sidecar (docs/pond-keeper-v0-2026-10-17.md,
// amendment of 2026-10-18): a restore on another page (a reload, a new worker) brings them back as they stood; a checkpoint with
// no sidecar starts afresh ("watching since"); a store that will not open the sidecar refuses the restore; a save whose sidecar
// the store will not write, or that leaves no room for the records listing the checkpoint, keeps the checkpoint without a log, and says so. The checkpoint's own bytes are what an export gives.

const flakyStorageWorker = `/@fs${new URL("./fixtures/flaky-storage.worker.ts", import.meta.url).pathname}`;

test("lab worker: a checkpoint's log comes back from its sidecar on a fresh page, and starts afresh without one", async ({ page, browserName }) => {
  test.skip(browserName === "webkit", "Playwright's WebKit context keeps no files at all");
  test.setTimeout(900_000);
  await page.route("**/lab-rewind-test", (route) => route.fulfill({ contentType: "text/html", body: "<html><body></body></html>" }));
  await page.goto("/lab-rewind-test");
  const result = await page.evaluate(async (workerPath) => {
    type Op = "open" | "remove" | "write" | "flush";
    /** A lab worker on this origin's storage, as a fresh page would start one: its memory holds no log of any checkpoint. */
    async function lab() {
      const worker = new Worker(workerPath, { type: "module" });
      const messages: FromWorker[] = [];
      worker.onmessage = (ev: MessageEvent<FromWorker>) => { messages.push(ev.data); };
      const send = (m: ToWorker) => worker.postMessage(m);
      const fault = (pattern: string, ops: Op[]) => worker.postMessage({ type: "test-fault", pattern, times: 1, ops });
      const check = () => {
        const error = messages.find((m) => m.type === "error");
        if (error?.type === "error") throw new Error(error.message);
      };
      async function wait<T extends FromWorker["type"]>(type: T, predicate: (m: Extract<FromWorker, { type: T }>) => boolean = () => true): Promise<Extract<FromWorker, { type: T }>> {
        const deadline = performance.now() + 300_000;
        while (performance.now() < deadline) {
          check();
          const index = messages.findIndex((m) => m.type === type && predicate(m as Extract<FromWorker, { type: T }>));
          if (index >= 0) return messages.splice(index, 1)[0] as Extract<FromWorker, { type: T }>;
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        throw new Error(`worker timed out waiting for ${type}`);
      }
      /** The newest message of `type` that matches, once there is one; left in place. */
      async function latest<T extends FromWorker["type"]>(type: T, predicate: (m: Extract<FromWorker, { type: T }>) => boolean): Promise<Extract<FromWorker, { type: T }>> {
        const deadline = performance.now() + 300_000;
        while (performance.now() < deadline) {
          check();
          const found = messages.filter((m): m is Extract<FromWorker, { type: T }> => m.type === type && predicate(m as Extract<FromWorker, { type: T }>));
          if (found.length) return found[found.length - 1];
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        throw new Error(`worker timed out waiting for ${type}`);
      }
      const canvas = document.createElement("canvas").transferControlToOffscreen();
      worker.postMessage({ type: "init", canvas, width: 64, height: 64 }, [canvas]);
      await wait("ready");
      send({ type: "load", presetId: "ponds-small", seed: 1 });
      await wait("loaded");
      /** Restores `file` and gives the restored world's number. */
      const restore = async (file: string) => {
        messages.length = 0;
        send({ type: "restore", file, keep: "discard" });
        const loaded = await wait("loaded");
        return loaded.world!;
      };
      const shelf = async () => {
        for (let i = messages.length - 1; i >= 0; i--) if (messages[i].type === "session") messages.splice(i, 1);
        send({ type: "listCheckpoints" });
        return (await wait("session")).view.checkpoints.map((c) => c.file).sort();
      };
      return { worker, messages, send, fault, wait, latest, restore, shelf };
    }
    const dir = async () => (await navigator.storage.getDirectory()).getDirectoryHandle("checkpoints");
    const names = async () => {
      const out: string[] = [];
      for await (const name of (await dir() as unknown as { keys(): AsyncIterable<string> }).keys()) out.push(name);
      return out.sort();
    };
    const log = (m: Extract<FromWorker, { type: "firsts" }>) => ({ fromStart: m.fromStart, watchedFrom: m.summary.watchedFrom, step: m.summary.step, entries: m.entries });

    // A: a world watched from its start, saved at t=500, and its export at the same moment.
    const a = await lab();
    a.send({ type: "step", count: 500 });
    await a.wait("stats", (m) => m.step === 500);
    a.send({ type: "save" });
    const file = (await a.wait("session", (m) => m.view.checkpoints.length > 0)).view.checkpoints[0].file;
    const before = log(await a.latest("firsts", (m) => m.summary.step === 500));
    const familiesBefore = await a.latest("families", (m) => m.step === 500);
    a.send({ type: "export" });
    const exportedBytes = Array.from(new Uint8Array((await a.wait("exported")).bytes));
    a.worker.terminate();
    const savedFile = await (await (await dir()).getFileHandle(file)).getFile();
    const savedBytes = Array.from(new Uint8Array(await savedFile.arrayBuffer()));
    const filesAfterSave = await names();

    // B: a fresh page restores it, and the log is the one A kept.
    const b = await lab();
    const bWorld = await b.restore(file);
    const restored = log(await b.latest("firsts", (m) => m.world === bWorld));
    const familiesRestored = await b.latest("families", (m) => m.world === bWorld);
    b.worker.terminate();

    // C: the same checkpoint with no sidecar, as one saved before sidecars were kept: watching since the next census.
    await (await dir()).removeEntry(`${file}.rewind`);
    const c = await lab();
    const cWorld = await c.restore(file);
    c.send({ type: "step", count: 100 });
    await c.wait("stats", (m) => m.step === 600);
    const afresh = log(await c.latest("firsts", (m) => m.world === cWorld && m.summary.step === 600));
    // A save of that later world keeps its own log, watched since t=600.
    c.send({ type: "save" });
    const later = (await c.wait("session", (m) => m.view.checkpoints.some((k) => k.step === 600))).view.checkpoints.find((k) => k.step === 600)!.file;
    c.worker.terminate();

    // D: a store that will not open the sidecar refuses the restore and keeps the world on screen; the next restore reads it.
    const d = await lab();
    d.fault("\\.rewind$", ["open"]);
    d.messages.length = 0;
    d.send({ type: "restore", file: later, keep: "discard" });
    const refusedRestore = (await d.wait("refused", (m) => m.request === "restore")).message;
    const loadedAfterRefusal = d.messages.some((m) => m.type === "loaded");
    const dWorld = await d.restore(later);
    const fromLater = log(await d.latest("firsts", (m) => m.world === dWorld));
    // A save whose sidecar the store will not write keeps the checkpoint, says the log was not kept, and removes the torn sidecar.
    const shelfBefore = await d.shelf();
    d.fault("\\.rewind$", ["write"]);
    d.send({ type: "save" });
    const unkeptNotice = (await d.wait("notice", (m) => m.message.startsWith("Saved "))).message;
    const shelfAfter = await d.shelf();
    const unkept = shelfAfter.find((f) => !shelfBefore.includes(f));
    const tornLeft = unkept ? (await names()).includes(`${unkept}.rewind`) : null;
    // A save whose sidecar is written but leaves no room for the run's record: the sidecar is given up, the record written once
    // more, and the checkpoint listed without a log.
    d.fault("\\.run\\.json$", ["write"]);
    d.send({ type: "save" });
    const fullNotice = (await d.wait("notice", (m) => m.message.startsWith("Saved "))).message;
    const shelfFull = await d.shelf();
    const full = shelfFull.find((f) => !shelfAfter.includes(f));
    const fullFiles = full ? (await names()).filter((n) => n.startsWith(full)) : [];
    // The same for the shelf's index, written after the run's record: its one failed write is retried without the sidecar.
    d.fault("^index\\.json$", ["write"]);
    d.send({ type: "save" });
    const indexNotice = (await d.wait("notice", (m) => m.message.startsWith("Saved "))).message;
    const shelfIndex = await d.shelf();
    const indexed = shelfIndex.filter((f) => !shelfFull.includes(f));
    const indexedFiles = indexed.length === 1 ? (await names()).filter((n) => n.startsWith(indexed[0])) : [];
    const refusedAny = d.messages.some((m) => m.type === "refused");
    d.worker.terminate();

    return {
      file, before, familiesBefore: { fromStart: familiesBefore.fromStart, families: familiesBefore.families, events: familiesBefore.events },
      restored, familiesRestored: { fromStart: familiesRestored.fromStart, families: familiesRestored.families, events: familiesRestored.events },
      exportedBytes, savedBytes, filesAfterSave, afresh, refusedRestore, loadedAfterRefusal, fromLater, unkeptNotice, shelfBefore, shelfAfter, unkept, tornLeft, fullNotice, shelfFull, full, fullFiles, indexNotice, shelfIndex, indexed, indexedFiles, refusedAny,
    };
  }, flakyStorageWorker);

  // The sidecar sits beside the checkpoint and its edges; the checkpoint's bytes are an export's.
  expect(result.filesAfterSave).toEqual(expect.arrayContaining([result.file, `${result.file}.edges`, `${result.file}.rewind`]));
  expect(result.savedBytes).toEqual(result.exportedBytes);
  // A watched the world from its start, and had something to keep: entries in the log and families in the tree.
  expect(result.before).toMatchObject({ fromStart: true, watchedFrom: 100, step: 500 });
  expect(result.before.entries.length).toBeGreaterThan(0);
  expect(result.familiesBefore.fromStart).toBe(true);
  expect(result.familiesBefore.families.length).toBeGreaterThan(0);
  // B, on a page that never saw it, has A's log and tree back.
  expect(result.restored).toEqual(result.before);
  expect(result.familiesRestored).toEqual(result.familiesBefore);
  // Without the sidecar: watching since the first census after the restore, and no error.
  expect(result.afresh).toMatchObject({ fromStart: false, watchedFrom: 600, step: 600 });
  expect(result.refusedRestore).toContain("The world itself is fine");
  expect(result.loadedAfterRefusal).toBe(false);
  expect(result.fromLater).toMatchObject({ fromStart: false, watchedFrom: 600, step: 600 });
  expect(result.unkeptNotice).toMatch(/Its log of firsts couldn't be kept beside it \(.*\): restored on another page, the log watches from the next census\.$/);
  expect(result.refusedAny).toBe(false);
  expect(result.shelfAfter).toHaveLength(result.shelfBefore.length + 1);
  expect(result.unkept).toMatch(/\.blck$/);
  expect(result.tornLeft).toBe(false);
  expect(result.fullNotice).toMatch(/Its log of firsts couldn't be kept beside it \(.*storage quota.*\): restored on another page, the log watches from the next census\.$/);
  expect(result.shelfFull).toHaveLength(result.shelfAfter.length + 1);
  expect(result.full).toMatch(/\.blck$/);
  expect(result.fullFiles.sort()).toEqual([result.full, `${result.full}.edges`].sort());
  expect(result.indexNotice).toMatch(/Its log of firsts couldn't be kept beside it \(.*storage quota.*\): restored on another page, the log watches from the next census\.$/);
  expect(result.shelfIndex).toHaveLength(result.shelfFull.length + 1);
  expect(result.indexed).toHaveLength(1);
  expect(result.indexed[0]).toMatch(/\.blck$/);
  expect(result.indexedFiles.sort()).toEqual([result.indexed[0], `${result.indexed[0]}.edges`].sort());
});

test("lab page: a saved copy restored after a reload keeps its log, not 'watching since'", async ({ page, browserName }) => {
  test.skip(browserName === "webkit", "Playwright's WebKit context keeps no files at all");
  test.setTimeout(900_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/lab/?world=ponds-small&seed=1");
  await expect(page.locator("#simulation-status")).toHaveText("Paused", { timeout: 120_000 });
  const play = page.locator("#btn-play");
  const stepNow = async () => Number((await page.locator("#chip-step").textContent())?.replace(/[^0-9]/g, ""));
  await play.click();
  await expect(play).toHaveAttribute("aria-pressed", "true");
  await expect.poll(stepNow, { timeout: 300_000 }).toBeGreaterThanOrEqual(300);
  await play.click();
  await expect(play).toHaveAttribute("aria-pressed", "false");
  await page.locator("#btn-save").click();
  await expect(page.locator("#ckpts li")).toHaveCount(1, { timeout: 120_000 });
  const savedStep = Number((await page.locator("#ckpts li span").first().textContent())?.split("·")[0].replace(/[^0-9]/g, ""));
  expect(savedStep).toBeGreaterThanOrEqual(300);
  expect(savedStep % 100).toBe(0);
  await expect(page.locator("#firsts-watch")).toBeHidden();
  const entriesBefore = await page.locator("#firsts-list li").allTextContents();
  expect(entriesBefore.length).toBeGreaterThan(0);

  await page.reload();
  await expect(page.locator("#simulation-status")).toHaveText("Paused", { timeout: 120_000 });
  await expect(page.locator("#ckpts li")).toHaveCount(1, { timeout: 60_000 });
  await page.locator("#ckpts li").getByRole("button", { name: /^Restore / }).click();
  const without = page.getByRole("button", { name: "Restore without saving" });
  if (await without.isVisible().catch(() => false)) await without.click();
  await expect(page.locator("#chip-step")).toHaveText(new RegExp(`t = ${savedStep.toLocaleString("en-US")}$`), { timeout: 120_000 });
  // Past the next census: a log started afresh would now say "Watching since".
  await play.click();
  await expect.poll(stepNow, { timeout: 300_000 }).toBeGreaterThan(savedStep + 150);
  await play.click();
  await expect(page.locator("#firsts-watch")).toBeHidden();
  const entriesAfter = await page.locator("#firsts-list li").allTextContents();
  // Newest first: the entries from before the save are the oldest ones now.
  expect(entriesAfter.slice(entriesAfter.length - entriesBefore.length)).toEqual(entriesBefore);
});
