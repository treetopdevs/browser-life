import { expect, test } from "@playwright/test";
import { decodeArtifact } from "@bl/runner";
import { stateHash } from "@bl/schema";
import type { FromWorker, ToWorker } from "../../apps/lab/src/protocol.ts";

// The lineage inspector in the real lab worker (WebGPU): the ledger's mutation edges replay a living
// lineage exactly, a jump back replays to the same world, and the edges survive a checkpoint round trip.
test("lab worker inspects a lineage, jumps back to a step, and keeps its genealogy across restore", async ({ page }) => {
  await page.route("**/lab-lineage-test", (route) => route.fulfill({ contentType: "text/html", body: "<html><body></body></html>" }));
  await page.goto("/lab-lineage-test");
  const result = await page.evaluate(async () => {
    const WorkerConstructor = (await import(/* @vite-ignore */ "/src/sim.worker.ts?worker")).default;
    const worker: Worker = new WorkerConstructor();
    const messages: FromWorker[] = [];
    worker.onmessage = (ev: MessageEvent<FromWorker>) => { messages.push(ev.data); };
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
    /** Stats queued before a world change describe the old world. */
    const dropStats = () => {
      for (let i = messages.length - 1; i >= 0; i--) if (messages[i].type === "stats") messages.splice(i, 1);
    };
    try {
      const canvas = document.createElement("canvas").transferControlToOffscreen();
      send({ type: "init", canvas, width: 64, height: 64 }, [canvas]);
      await wait("ready");
      send({ type: "load", presetId: "spots", seed: 7, overrides: { tileW: 64, tileH: 64, kernelRadius: 4, mutRate: 429_497 * 40 } });
      await wait("loaded");
      send({ type: "step", count: 1000 });
      await wait("stats", (m) => m.step === 1000);
      send({ type: "save" });
      await wait("session", (m) => m.view.checkpoints.some((c) => c.step === 1000));
      send({ type: "step", count: 600 });
      await wait("stats", (m) => m.step === 1600);
      const census = await wait("census", (m) => m.step === 1600 && m.top.length > 0);
      const key = census.top[0].key;

      send({ type: "lineage", key });
      const first = await wait("lineage");

      // Jump back: the present is saved, t=1000 restored, and the world replayed to t=1300.
      send({ type: "jump", step: 1300, key });
      await wait("loaded");
      const highlight = await wait("highlight");
      dropStats();
      await wait("stats", (m) => m.step === 1300);
      send({ type: "step", count: 300 });
      dropStats();
      await wait("stats", (m) => m.step === 1600);
      send({ type: "export" });
      const replayed = await wait("exported");

      // Back to the saved present: same world, and the same genealogy read back from storage.
      const list = await wait("session", (m) => m.view.checkpoints.some((c) => c.step === 1600 && !c.auto));
      const present = list.view.checkpoints.find((c) => c.step === 1600 && !c.auto)!;
      send({ type: "restore", file: present.file, keep: "discard" });
      await wait("loaded", (m) => m.step === 1600);
      send({ type: "export" });
      const restoredPresent = await wait("exported");
      send({ type: "lineage", key });
      const again = await wait("lineage");
      return {
        key,
        first: first.view,
        checkpoints: first.checkpoints,
        highlight: highlight.key,
        again: again.view,
        replayed: Array.from(new Uint8Array(replayed.bytes)),
        present: Array.from(new Uint8Array(restoredPresent.bytes)),
      };
    } finally {
      worker.terminate();
    }
  });

  const v = result.first;
  expect(v.subject).toBe(result.key);
  expect(v.censusStep).toBe(1600);
  expect(v.chain[v.chain.length - 1].key).toBe(result.key);
  expect(v.mutations).toHaveLength(v.chain.length - 1);
  // A world built in the lab knows its founders, so the whole ancestry replays and the subject's live genome checks it.
  expect(v.chain[0].minted).toBeNull();
  expect(v.chain[0].genomeFrom).toBe("start world");
  expect(v.chain.slice(1).every((n) => n.genomeFrom === "replayed")).toBe(true);
  expect(v.chain[v.chain.length - 1].checkedBy).toContain("live world");
  expect(v.mutations.every((m) => m.before !== null && m.expression !== null)).toBe(true);
  expect(v.gaps).toEqual([]);
  expect(result.checkpoints).toContain(1000);
  expect(result.highlight).toBe(result.key);

  const replayed = decodeArtifact(new Uint8Array(result.replayed));
  const present = decodeArtifact(new Uint8Array(result.present));
  expect(replayed.state.step).toBe(1600);
  expect(stateHash(replayed.state)).toBe(stateHash(present.state));

  expect(result.again.chain.map((n) => n.key)).toEqual(v.chain.map((n) => n.key));
  expect(result.again.chain[0].genomeFrom).toBe("start world");
  expect(result.again.gaps).toEqual([]);
});

// The lab page: a probed cell opens the lineage drawer, which lists the ancestry and toggles the highlight.
test("lab page opens the lineage drawer from a probed cell", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/lab/");
  await expect(page.locator("#simulation-status")).toHaveText("Paused", { timeout: 60_000 });
  await page.locator("#speed").fill("6");
  await page.locator("#btn-play").click();
  await expect.poll(async () => Number((await page.locator("#chip-step").textContent())?.replace(/[^0-9]/g, "")), { timeout: 60_000 }).toBeGreaterThan(600);
  await page.locator("#btn-play").click();

  // Probe across the field until a living cell (one with a lineage) is selected.
  const box = (await page.locator("#world").boundingBox())!;
  const inspect = page.locator("#btn-lineage");
  search: for (let gy = 1; gy < 12; gy++)
    for (let gx = 1; gx < 12; gx++) {
      // Probes queue behind GPU frames: judge each click by its own answer, which names a new cell.
      const before = await page.locator("#probe-kv").textContent();
      await page.mouse.click(box.x + (box.width * gx) / 12, box.y + (box.height * gy) / 12);
      await expect.poll(() => page.locator("#probe-kv").textContent(), { timeout: 10_000 }).not.toBe(before);
      if (await inspect.isVisible()) break search;
    }
  await expect(inspect).toBeVisible();
  await inspect.click();

  const drawer = page.locator("#lineage-drawer");
  const rows = drawer.locator(".lineage-table tbody tr");
  await expect(drawer).toBeVisible();
  await expect(rows.first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator("#lineage-heading")).toHaveText(/^Lineage \d+:\d+$/);
  await expect(rows.first().locator("td").nth(3)).toContainText("root");

  const highlight = drawer.locator("button[data-highlight]");
  await highlight.click();
  await expect(highlight).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#lineage-highlight-state")).toContainText("Field highlight:");
  await page.screenshot({ path: testInfo.outputPath("lineage-drawer.png") });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.screenshot({ path: testInfo.outputPath("lineage-drawer-narrow.png") });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.locator("#lineage-close").click();
  await expect(drawer).toBeHidden();
  expect(errors).toEqual([]);
});
