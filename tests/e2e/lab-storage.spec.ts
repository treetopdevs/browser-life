import { expect, test, type Page } from "@playwright/test";
import type { FromWorker, ToWorker } from "../../apps/lab/src/protocol.ts";

// A browser that keeps no files for the page (Safari Private Browsing, WebKit's ephemeral sessions): the world
// keeps running, Save and saved copies are off with the reason beside them, and Download and Open a file work.
const noStorageWorker = `/@fs${new URL("./fixtures/no-storage.worker.ts", import.meta.url).pathname}`;
const flakyStorageWorker = `/@fs${new URL("./fixtures/flaky-storage.worker.ts", import.meta.url).pathname}`;
const REFUSED = "The operation failed for an unknown transient reason (e.g. out of memory).";

const planted = (page: Page) => expect(page.locator("#simulation-status")).not.toHaveText(/Planting|No world yet|Warming up/, { timeout: 60_000 });

test("without storage the lab worker runs past an automatic checkpoint, refuses saving, and still downloads and opens", async ({ page }) => {
  await page.route("**/lab-storage-test", (route) => route.fulfill({ contentType: "text/html", body: "<html><body></body></html>" }));
  await page.goto("/lab-storage-test");
  const result = await page.evaluate(async (workerPath) => {
    const worker = new Worker(workerPath, { type: "module" });
    const log: FromWorker[] = [];
    const messages: FromWorker[] = [];
    worker.onmessage = (ev: MessageEvent<FromWorker>) => { log.push(ev.data); messages.push(ev.data); };
    const send = (m: ToWorker, transfer: Transferable[] = []) => worker.postMessage(m, transfer);
    async function wait<T extends FromWorker["type"]>(type: T, predicate: (m: Extract<FromWorker, { type: T }>) => boolean = () => true): Promise<Extract<FromWorker, { type: T }>> {
      const deadline = performance.now() + 90_000;
      while (performance.now() < deadline) {
        const error = messages.find((m) => m.type === "error");
        if (error?.type === "error") throw new Error(error.message);
        const index = messages.findIndex((m) => m.type === type && predicate(m as Extract<FromWorker, { type: T }>));
        if (index >= 0) return messages.splice(index, 1)[0] as Extract<FromWorker, { type: T }>;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error(`worker timed out waiting for ${type}`);
    }
    try {
      const canvas = document.createElement("canvas").transferControlToOffscreen();
      send({ type: "init", canvas, width: 64, height: 64 }, [canvas]);
      const ready = await wait("ready");
      const overrides = { tileW: 32, tileH: 32, tilesX: 2, tilesY: 1, kernelRadius: 2 };
      send({ type: "load", presetId: "spots", seed: 19, overrides });
      await wait("loaded");
      const first = await wait("session");
      // Past the automatic checkpoint at 20,000 steps, which a browser without storage skips.
      send({ type: "step", count: 20_100 });
      const grown = await wait("stats", (m) => m.step === 20_100);

      send({ type: "save" });
      const save = await wait("refused", (m) => m.request === "save");
      send({ type: "listCheckpoints" });
      const shelf = await wait("session");
      send({ type: "export" });
      const exported = await wait("exported");
      const census = await wait("census", (m) => m.top.length > 0);
      send({ type: "lineage", key: census.top[0].key });
      const lineage = await wait("lineage");
      const refusals: string[] = [];
      for (const m of [{ type: "restore", file: "absent.blck" }, { type: "deleteCheckpoint", file: "absent.blck" }, { type: "jump", step: 100, key: null }] as ToWorker[]) {
        send(m);
        refusals.push((await wait("refused", (r) => r.request === m.type)).message);
      }

      // Replacing the uncovered world asks first; downloading it first hands over the file before the new world.
      send({ type: "load", presetId: "spots", seed: 20, overrides });
      const held = await wait("session", (m) => m.view.held !== null);
      const mark = log.length;
      send({ type: "load", presetId: "spots", seed: 20, overrides, keep: "download" });
      const kept = await wait("exported");
      const replaced = await wait("loaded");
      const order = log.slice(mark).map((m) => m.type).filter((t) => t === "exported" || t === "loaded");

      const bytes = exported.bytes.slice(0);
      send({ type: "import", bytes, name: exported.name, keep: "discard" }, [bytes]);
      const opened = await wait("loaded");
      return {
        storage: ready.storage,
        firstShelf: first.view.checkpoints.length,
        grown: grown.step,
        save: save.message,
        shelf: shelf.view.checkpoints.length,
        exported: exported.name,
        lineageCheckpoints: lineage.checkpoints,
        refusals,
        held: held.view.held,
        kept: kept.name,
        order,
        replacedSeed: replaced.manifest.seed,
        opened: opened.step,
        notices: log.filter((m) => m.type === "notice").map((m) => (m as { message: string }).message),
      };
    } finally {
      worker.terminate();
    }
  }, noStorageWorker);

  expect(result.storage).toBe(REFUSED);
  expect(result.firstShelf).toBe(0);
  expect(result.grown).toBe(20_100);
  expect(result.notices.filter((n) => /automatic copy/.test(n))).toEqual([]);
  expect(result.save).toContain("isn't letting the lab keep copies here");
  expect(result.shelf).toBe(0);
  expect(result.exported).toMatch(/-t20100\.blck$/);
  expect(result.lineageCheckpoints).toEqual([]);
  expect(result.refusals).toHaveLength(3);
  for (const r of result.refusals) expect(r).toContain("Download still gives you a file");
  expect(result.held).toBe("plant");
  expect(result.kept).toMatch(/-t20100\.blck$/);
  expect(result.order).toEqual(["exported", "loaded"]);
  expect(result.replacedSeed).toBe(20);
  expect(result.opened).toBe(20_100);
});

test("a store that fails now and then refuses the one request and loses no saved copy or run history", async ({ page, browserName }) => {
  test.skip(browserName === "webkit", "Playwright's WebKit context keeps no files at all; the test above covers it");
  await page.route("**/lab-storage-test", (route) => route.fulfill({ contentType: "text/html", body: "<html><body></body></html>" }));
  await page.goto("/lab-storage-test");
  const result = await page.evaluate(async (workerPath) => {
    const worker = new Worker(workerPath, { type: "module" });
    const messages: FromWorker[] = [];
    worker.onmessage = (ev: MessageEvent<FromWorker>) => { messages.push(ev.data); };
    const send = (m: ToWorker) => worker.postMessage(m);
    const fault = (pattern: string | null, times = 1) => worker.postMessage({ type: "test-fault", pattern, times });
    async function wait<T extends FromWorker["type"]>(type: T, predicate: (m: Extract<FromWorker, { type: T }>) => boolean = () => true): Promise<Extract<FromWorker, { type: T }>> {
      const deadline = performance.now() + 90_000;
      while (performance.now() < deadline) {
        const error = messages.find((m) => m.type === "error");
        if (error?.type === "error") throw new Error(error.message);
        const index = messages.findIndex((m) => m.type === type && predicate(m as Extract<FromWorker, { type: T }>));
        if (index >= 0) return messages.splice(index, 1)[0] as Extract<FromWorker, { type: T }>;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error(`worker timed out waiting for ${type}`);
    }
    // The shelf as the worker lists it now, not as an earlier session message had it.
    const listed = async () => {
      for (let i = messages.length - 1; i >= 0; i--) if (messages[i].type === "session") messages.splice(i, 1);
      send({ type: "listCheckpoints" });
      return (await wait("session")).view.checkpoints;
    };
    const shelf = async () => (await listed()).map((c) => c.step).sort((a, b) => a - b);
    try {
      const canvas = document.createElement("canvas").transferControlToOffscreen();
      worker.postMessage({ type: "init", canvas, width: 64, height: 64 }, [canvas]);
      const ready = await wait("ready");
      send({ type: "load", presetId: "spots", seed: 19, overrides: { tileW: 32, tileH: 32, tilesX: 2, tilesY: 1, kernelRadius: 2 } });
      const loaded = await wait("loaded");
      for (const step of [100, 200]) {
        send({ type: "step", count: 100 });
        await wait("stats", (m) => m.step === step);
        send({ type: "save" });
        await wait("session", (m) => m.view.checkpoints.length === step / 100);
      }
      const first = (await listed()).find((c) => c.step === 100)!.file;

      // The run's manifest will not open once: restoring the earlier copy is refused, not forked without its history.
      fault("\\.run\\.json$");
      send({ type: "restore", file: first, keep: "discard" });
      const restore = await wait("refused", (m) => m.request === "restore");
      const stillHere = !messages.some((m) => m.type === "loaded");
      send({ type: "restore", file: first, keep: "discard" });
      const restored = await wait("loaded");
      // The restored world is settled once its first account is out (adoption has listed the shelf), and stats
      // from the world before it at t=200 must not pass for this one's.
      await wait("session", (m) => m.view.world?.runId === restored.manifest.runId);
      for (let i = messages.length - 1; i >= 0; i--) if (messages[i].type === "stats") messages.splice(i, 1);

      // The index will not open once: the save is refused, and the copies already listed stay listed.
      send({ type: "step", count: 100 });
      await wait("stats", (m) => m.step === 200);
      fault("^index\\.json$");
      send({ type: "save" });
      const save = await wait("refused", (m) => m.request === "save");
      const afterSave = await shelf();

      // The store will not remove the checkpoint: the delete is refused and the copy stays listed.
      fault(`^${first.replace(/[.]/g, "\\.")}$`);
      send({ type: "deleteCheckpoint", file: first });
      const del = await wait("refused", (m) => m.request === "deleteCheckpoint");
      const afterDelete = await shelf();
      return { storage: ready.storage, runId: loaded.manifest.runId, restore: restore.message, stillHere, restoredRun: restored.manifest.runId, restoredLog: restored.manifest.checkpoints.map((c) => c.step), save: save.message, afterSave, del: del.message, afterDelete };
    } finally {
      worker.terminate();
    }
  }, flakyStorageWorker);

  expect(result.storage).toBeNull();
  expect(result.restore).toContain(REFUSED);
  expect(result.stillHere).toBe(true);
  // Once the store answers, the earlier copy restores as a branch of its run, with the run's history up to it.
  expect(result.restoredRun.startsWith(`${result.runId}-b`)).toBe(true);
  expect(result.restoredLog).toEqual([100]);
  expect(result.save).toContain(REFUSED);
  expect(result.afterSave).toEqual([100, 200]);
  expect(result.del).toContain(REFUSED);
  expect(result.afterDelete).toEqual([100, 200]);
});

test("without storage the lab page keeps the world running, says why Save is off, and still downloads and opens", async ({ page }) => {
  // The page's own worker, swapped for the same worker in a browser that keeps no files.
  await page.route(/\/src\/sim\.worker\.ts\?worker_file/, (route) => route.fulfill({ contentType: "text/javascript", body: `import ${JSON.stringify(noStorageWorker)};` }));
  await page.goto("/lab/");
  await planted(page);
  await expectNoStorage(page);

  await page.locator("#btn-play").click();
  await expect.poll(async () => Number((await page.locator("#chip-step").textContent())?.replace(/\D/g, "")), { timeout: 60_000 }).toBeGreaterThan(400);
  await page.locator("#btn-play").click();
  await expect(page.locator("#stage-alert")).toBeHidden();

  const download = page.waitForEvent("download");
  await page.locator("#btn-export").click();
  const file = await (await download).path();
  expect((await download).suggestedFilename()).toMatch(/\.blck$/);

  // Planting over the uncovered world offers to download it first, in place of saving it.
  const runBefore = await page.locator("#run-id").textContent();
  await page.locator("#btn-new").click();
  const guard = page.locator("#guard-new");
  await expect(guard).toContainText("Nothing from this run is saved yet");
  await expect(guard.getByRole("button")).toHaveText(["Download, then plant", "Plant without saving", "Cancel"]);
  const kept = page.waitForEvent("download");
  await guard.getByRole("button", { name: "Download, then plant" }).click();
  expect((await kept).suggestedFilename()).toMatch(/\.blck$/);
  await expect(page.locator("#run-id")).not.toHaveText(runBefore ?? "");
  await expect(page.locator("#stage-alert")).toBeHidden();

  // The fresh world has nothing to lose, so the file opens at once.
  await page.locator("#import").setInputFiles(file);
  await expect(page.locator("#world-heading")).toHaveText("Opened world");
  await expect(page.locator("#stage-alert")).toBeHidden();
  await expectNoStorage(page);
});

test("in WebKit's ephemeral session the lab keeps the world running and turns Save off", async ({ page, browserName }) => {
  test.skip(browserName !== "webkit", "the real refusal is WebKit's (Playwright WebKit 26.6, a context without a profile)");
  await page.goto("/lab/");
  await planted(page);
  await expectNoStorage(page);
  await page.locator("#btn-play").click();
  await expect.poll(async () => Number((await page.locator("#chip-step").textContent())?.replace(/\D/g, "")), { timeout: 60_000 }).toBeGreaterThan(400);
  await expect(page.locator("#stage-alert")).toBeHidden();
});

async function expectNoStorage(page: Page) {
  await expect(page.locator("#stage-alert")).toBeHidden();
  await expect(page.locator("#btn-save")).toBeVisible();
  await expect(page.locator("#btn-save")).toBeDisabled();
  await expect(page.locator("#btn-save")).toHaveAttribute("aria-describedby", "ckpt-storage");
  await expect(page.locator("#ckpt-storage")).toHaveText("This browser isn't letting the lab keep copies here (private browsing?). Download still gives you a file.");
  await expect(page.locator("#ckpt-storage")).toBeVisible();
  await expect(page.locator("#checkpoint-empty")).toBeHidden();
  await expect(page.locator("#btn-export")).toBeEnabled();
  await expect(page.locator("#btn-import")).toBeEnabled();
}
