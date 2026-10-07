import { expect, test } from "@playwright/test";
import { decodeArtifact } from "@bl/runner";
import { applyFeed, stateHash, totalsOf } from "@bl/schema";
import type { FromWorker, ToWorker } from "../../apps/lab/src/protocol.ts";

// Mid-run feeding as a logged intervention (packages/schema/src/feed.ts).

test("lab worker feeds and drains exactly, logs it, keeps the ledger exact, and restores the log with a checkpoint", async ({ page }) => {
  await page.route("**/lab-feed-test", (route) => route.fulfill({ contentType: "text/html", body: "<html><body></body></html>" }));
  await page.goto("/lab-feed-test");
  const result = await page.evaluate(async () => {
    const workerModule = "/src/sim.worker.ts?worker";
    const WorkerConstructor = (await import(/* @vite-ignore */ workerModule)).default;
    const worker: Worker = new WorkerConstructor();
    const messages: FromWorker[] = [];
    let errors: string[] = [];
    worker.onmessage = (ev: MessageEvent<FromWorker>) => {
      if (ev.data.type === "error") errors.push(ev.data.message);
      else messages.push(ev.data);
    };
    const send = (m: ToWorker, transfer: Transferable[] = []) => worker.postMessage(m, transfer);
    async function wait<T extends FromWorker["type"]>(type: T, predicate: (m: Extract<FromWorker, { type: T }>) => boolean = () => true): Promise<Extract<FromWorker, { type: T }>> {
      const deadline = performance.now() + 60_000;
      while (performance.now() < deadline) {
        const index = messages.findIndex((m) => m.type === type && predicate(m as Extract<FromWorker, { type: T }>));
        if (index >= 0) return messages.splice(index, 1)[0] as Extract<FromWorker, { type: T }>;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error(`worker timed out waiting for ${type}; errors: ${errors.join(" | ")}`);
    }
    const stats = (feeds: number) => wait("stats", (m) => m.feeds === feeds);
    const exported = async () => {
      send({ type: "export" });
      return Array.from(new Uint8Array((await wait("exported")).bytes));
    };
    try {
      const canvas = document.createElement("canvas").transferControlToOffscreen();
      send({ type: "init", canvas, width: 64, height: 64 }, [canvas]);
      await wait("ready");
      send({ type: "load", presetId: "spots", seed: 19, overrides: { tileW: 32, tileH: 32, tilesX: 2, tilesY: 1, kernelRadius: 2 } });
      await wait("loaded");
      send({ type: "step", count: 100 });
      await wait("stats", (m) => m.step === 100);
      const before = await exported();
      const s0 = await stats(0);

      send({ type: "feed", x: 30.7, y: 4.2, r: 6, amount: 16 });
      const s1 = await stats(1);
      const afterFeed = await exported();
      send({ type: "feed", x: 30.7, y: 4.2, r: 3, amount: -1000 });
      const s2 = await stats(2);
      const afterDrain = await exported();

      // A checkpoint after two feeds; a third feed; then back to the checkpoint.
      send({ type: "save" });
      const saved = await wait("session", (m) => m.view.checkpoints.length > 0);
      send({ type: "feed", x: 50, y: 20, r: 4, amount: 5 });
      const s3 = await stats(3);
      send({ type: "step", count: 200 });
      const later = await wait("stats", (m) => m.step === 300 && m.feeds === 3);
      send({ type: "verify", steps: 200 });
      const replay = await wait("verify");
      send({ type: "restore", file: saved.view.checkpoints[0].file, keep: "discard" });
      await wait("loaded");
      const restored = await stats(2);

      // Refused: an amount out of range. The world stays usable and nothing is logged.
      send({ type: "feed", x: 10, y: 10, r: 4, amount: 100_000 });
      const deadline = performance.now() + 10_000;
      while (!errors.length && performance.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
      const refusal = errors.join(" | ");
      errors = [];
      send({ type: "step", count: 100 });
      const afterRefusal = await wait("stats", (m) => m.step === 200);
      return { before, afterFeed, afterDrain, s0, s1, s2, s3, later, replay, restored, refusal, afterRefusal, saved: saved.view.checkpoints.map((c) => c.step) };
    } finally {
      worker.terminate();
    }
  });

  // The worker's feed equals the reference transform on the exported state, feed and drain alike.
  const ref = decodeArtifact(new Uint8Array(result.before)).state;
  const t0 = totalsOf(ref.cfg, ref.cells).matter;
  const fed = applyFeed(ref, 30, 4, 6, 16);
  expect(stateHash(decodeArtifact(new Uint8Array(result.afterFeed)).state)).toBe(stateHash(ref));
  const drained = applyFeed(ref, 30, 4, 3, -1000);
  expect(stateHash(decodeArtifact(new Uint8Array(result.afterDrain)).state)).toBe(stateHash(ref));
  expect(fed.matter).toBeGreaterThan(0);
  expect(drained.matter).toBeLessThan(0);
  expect(totalsOf(ref.cfg, ref.cells).matter - t0).toBe(BigInt(fed.matter + drained.matter));

  // The ledger panel's numbers: exact against the moved baseline, with the amount fed stated.
  expect([result.s0.fed, result.s0.matterDelta, result.s0.residual]).toEqual(["0", "0", "0"]);
  expect([result.s1.fed, result.s1.matterDelta, result.s1.residual]).toEqual([String(fed.matter), "0", "0"]);
  expect([result.s2.fed, result.s2.matterDelta, result.s2.residual]).toEqual([String(fed.matter + drained.matter), "0", "0"]);
  expect(Number(result.s3.fed)).toBeGreaterThan(Number(result.s2.fed));
  // Still exact 200 steps on, and a replay from the fed state reproduces the live world.
  expect([result.later.matterDelta, result.later.residual]).toEqual(["0", "0"]);
  expect(result.replay.ok, result.replay.detail).toBe(true);
  // Restoring the checkpoint restores exactly the feeds it had seen.
  expect(result.saved).toContain(100);
  expect([result.restored.fed, result.restored.feeds, result.restored.matterDelta, result.restored.residual]).toEqual([String(fed.matter + drained.matter), 2, "0", "0"]);
  // A refused feed says why, logs nothing, and the world steps on, exact.
  expect(result.refusal).toMatch(/feed amount must be a non-zero integer/);
  expect([result.afterRefusal.feeds, result.afterRefusal.matterDelta, result.afterRefusal.residual]).toEqual([2, "0", "0"]);
});

test("lab page: the Feed and Drain brushes change the world and the ledger says so", async ({ page }) => {
  await page.goto("/lab/");
  await expect(page.locator("#simulation-status")).toHaveText("Paused", { timeout: 60_000 });
  await expect(page.locator("#k-fed")).toHaveText("none", { timeout: 30_000 });
  await expect(page.locator("#ledger-badge")).toHaveText("sealed");
  await expect(page.locator("#feed-hint")).toBeHidden();
  await expect(page.locator("#amount")).toBeDisabled();

  await page.getByRole("button", { name: "Feed", exact: true }).click();
  await expect(page.locator("#feed-hint")).toBeVisible();
  await expect(page.locator("#amount")).toBeEnabled();
  await expect(page.locator("#radius")).toBeEnabled();
  const box = (await page.locator("#world").boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.4);
  await expect(page.locator("#k-fed")).toHaveText(/^\+[\d,]+ in 1 feed$/, { timeout: 30_000 });
  await expect(page.locator("#ledger-badge")).toHaveText("fed by hand, all accounted");
  await expect(page.locator("#k-matter")).toHaveText("0");
  await expect(page.locator("#k-resid")).toHaveText("0");
  const fedText = await page.locator("#k-fed").textContent();

  await page.getByRole("button", { name: "Drain", exact: true }).click();
  await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.4);
  await expect(page.locator("#k-fed")).toHaveText(/ in 2 feeds$/, { timeout: 30_000 });
  expect(await page.locator("#k-fed").textContent()).not.toBe(fedText);
  await expect(page.locator("#ledger-badge")).toHaveText("fed by hand, all accounted");

  // Keyboard: Enter on the focused field applies the brush at the focus cursor.
  await page.getByRole("button", { name: "Feed", exact: true }).click();
  await page.locator("#world").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#k-fed")).toHaveText(/ in 3 feeds$/, { timeout: 30_000 });

  // Stepping on keeps the ledger exact against the moved baseline.
  await page.locator("#btn-step").click();
  await expect(page.locator("#chip-step")).toHaveText("t = 1", { timeout: 30_000 });
  await expect(page.locator("#k-matter")).toHaveText("0");
  await expect(page.locator("#k-resid")).toHaveText("0");
  await page.screenshot({ path: "test-results/lab-feed.png", fullPage: false });
  const pressed = () => page.locator("#tools button:not([hidden])").evaluateAll((bs) => bs.map((b) => `${b.textContent}:${b.getAttribute("aria-pressed")}`).join(" "));
  expect(await pressed()).toBe("Look:false Wound:false Feed:true Drain:false Move:false");
  await page.getByRole("button", { name: "Look", exact: true }).click();
  expect(await pressed()).toBe("Look:true Wound:false Feed:false Drain:false Move:false");
  await expect(page.locator("#feed-hint")).toBeHidden();
  await expect(page.locator("#amount")).toBeDisabled();
  await expect(page.locator("#radius")).toBeDisabled();
});

test("a jump back re-applies the logged feeds and lesions, and an exported fed world still says it was fed", async ({ page }) => {
  await page.route("**/lab-feed-jump-test", (route) => route.fulfill({ contentType: "text/html", body: "<html><body></body></html>" }));
  await page.goto("/lab-feed-jump-test");
  const result = await page.evaluate(async () => {
    const workerModule = "/src/sim.worker.ts?worker";
    const WorkerConstructor = (await import(/* @vite-ignore */ workerModule)).default;
    const worker: Worker = new WorkerConstructor();
    const messages: FromWorker[] = [];
    const errors: string[] = [];
    worker.onmessage = (ev: MessageEvent<FromWorker>) => {
      if (ev.data.type === "error") errors.push(ev.data.message);
      else messages.push(ev.data);
    };
    const send = (m: ToWorker, transfer: Transferable[] = []) => worker.postMessage(m, transfer);
    async function wait<T extends FromWorker["type"]>(type: T, predicate: (m: Extract<FromWorker, { type: T }>) => boolean = () => true): Promise<Extract<FromWorker, { type: T }>> {
      const deadline = performance.now() + 60_000;
      while (performance.now() < deadline) {
        const index = messages.findIndex((m) => m.type === type && predicate(m as Extract<FromWorker, { type: T }>));
        if (index >= 0) return messages.splice(index, 1)[0] as Extract<FromWorker, { type: T }>;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error(`worker timed out waiting for ${type}; errors: ${errors.join(" | ")}`);
    }
    const exported = async () => {
      send({ type: "export" });
      return (await wait("exported")).bytes;
    };
    try {
      const canvas = document.createElement("canvas").transferControlToOffscreen();
      send({ type: "init", canvas, width: 64, height: 64 }, [canvas]);
      await wait("ready");
      send({ type: "load", presetId: "spots", seed: 19, overrides: { tileW: 32, tileH: 32, tilesX: 2, tilesY: 1, kernelRadius: 2 } });
      await wait("loaded");
      send({ type: "step", count: 100 });
      await wait("stats", (m) => m.step === 100);
      // A checkpoint that has seen no intervention, then a feed at the same step, and two more mid-interval.
      send({ type: "save" });
      await wait("session", (m) => m.view.checkpoints.some((c) => c.step === 100));
      send({ type: "feed", x: 20, y: 12, r: 6, amount: 24 });
      await wait("stats", (m) => m.feeds === 1);
      send({ type: "step", count: 50 });
      await wait("stats", (m) => m.step === 150);
      send({ type: "lesion", x: 20, y: 12, r: 5 });
      send({ type: "feed", x: 44, y: 20, r: 4, amount: -9 });
      await wait("stats", (m) => m.feeds === 2);
      send({ type: "step", count: 150 });
      const live = await wait("stats", (m) => m.step === 300 && m.feeds === 2);
      const liveBytes = await exported();

      // Jump to t=300: restores the t=100 checkpoint and must re-apply all three interventions on the way.
      messages.length = 0;
      send({ type: "jump", step: 300, key: null });
      await wait("loaded");
      const jumped = await wait("stats", (m) => m.step === 300);
      const jumpedBytes = await exported();

      // Harder: two jumps back to back (the second arrives while the first is still replaying), then a
      // refused manual feed during the replay. Neither may lose a queued intervention.
      messages.length = 0;
      send({ type: "jump", step: 300, key: null });
      send({ type: "jump", step: 300, key: null });
      send({ type: "feed", x: 10, y: 10, r: 4, amount: 100_000 });
      await wait("loaded");
      await wait("loaded");
      const again = await wait("stats", (m) => m.step === 300);
      const againBytes = await exported();

      // The exported fed world, imported as a file with no manifest: it still carries what it was fed.
      const copy = liveBytes.slice(0);
      send({ type: "import", bytes: copy, name: "fed.blck", keep: "discard" }, [copy]);
      await wait("loaded");
      const imported = await wait("stats", (m) => m.step === 300);
      return {
        live: [live.fed, live.feeds, live.matterDelta, live.residual],
        jumped: [jumped.fed, jumped.feeds, jumped.matterDelta, jumped.residual],
        again: [again.fed, again.feeds, again.matterDelta, again.residual],
        againBytes: Array.from(new Uint8Array(againBytes)),
        imported: [imported.fed, imported.feeds, imported.matterDelta, imported.residual],
        liveBytes: Array.from(new Uint8Array(liveBytes)),
        jumpedBytes: Array.from(new Uint8Array(jumpedBytes)),
        errors,
      };
    } finally {
      worker.terminate();
    }
  });
  // The only error is the refused manual feed.
  expect(result.errors.length).toBe(1);
  expect(result.errors[0]).toMatch(/feed amount must be a non-zero integer/);
  const live = decodeArtifact(new Uint8Array(result.liveBytes)), jumped = decodeArtifact(new Uint8Array(result.jumpedBytes));
  const again = decodeArtifact(new Uint8Array(result.againBytes));
  expect(stateHash(again.state)).toBe(stateHash(live.state));
  expect(again.observer).toEqual(live.observer);
  expect(result.again).toEqual(result.live);
  expect(live.state.step).toBe(300);
  // The world a jump reaches is the one that was observed: same physics, same observer, same feed total.
  expect(stateHash(jumped.state)).toBe(stateHash(live.state));
  expect(jumped.observer).toEqual(live.observer);
  expect(live.observer.fed?.feeds).toBe(2);
  expect(result.live[1]).toBe(2);
  expect(Number(result.live[0])).not.toBe(0);
  expect(result.live.slice(2)).toEqual(["0", "0"]);
  expect(result.jumped).toEqual(result.live);
  // Provenance survives export and import: the artifact's observer state carries the total.
  expect(result.imported).toEqual(result.live);
});
