import { expect, test } from "@playwright/test";
import { decodeArtifact } from "@bl/runner";
import { stateHash } from "@bl/schema";
import type { FromWorker, ToWorker } from "../../apps/lab/src/protocol.ts";

// A Feed or Drain on a pond world is refused by design (packages/schema/src/feed.ts `feedError`: the pond cycle fixes each
// pond's matter). The refusal is a notice and the world goes on; it is not a failure of the world (playtest kit, amendment
// of 2026-10-18). A feed that fails for any other reason, or a feed on a world that has failed, still arrives as an error
// (tests/e2e/fixtures/faulty-sim.worker.ts makes the GPU simulation fail on demand).

const POND_REFUSAL = /feeding is not defined for pond worlds/;
const faultySimWorker = `/@fs${new URL("./fixtures/faulty-sim.worker.ts", import.meta.url).pathname}`;

test("lab worker: a feed or drain on a pond world is refused, changes nothing, and the world steps on; a feed that fails is an error", async ({ page }) => {
  test.setTimeout(600_000);
  await page.route("**/lab-pond-refusal-test", (route) => route.fulfill({ contentType: "text/html", body: "<html><body></body></html>" }));
  await page.goto("/lab-pond-refusal-test");
  const result = await page.evaluate(async (workerPath) => {
    const worker = new Worker(workerPath, { type: "module" });
    const messages: (FromWorker | { type: "test-sim-fault-hit"; method: string })[] = [];
    const errors: { message: string; failed: boolean }[] = [];
    let lastStep: number | null = null;
    worker.onmessage = (ev: MessageEvent<FromWorker>) => {
      if (ev.data.type === "stats") lastStep = ev.data.step;
      if (ev.data.type === "error") errors.push({ message: ev.data.message, failed: ev.data.failed === true });
      else messages.push(ev.data);
    };
    const send = (m: ToWorker, transfer: Transferable[] = []) => worker.postMessage(m, transfer);
    const fault = (method: "feed" | "drainLedger") => worker.postMessage({ type: "test-sim-fault", method });
    /** The error after the first `count`, once it arrives. */
    const nextError = async (count: number) => {
      const deadline = performance.now() + 240_000;
      while (errors.length <= count && performance.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
      if (errors.length <= count) throw new Error("worker timed out waiting for an error");
      return errors[count];
    };
    async function wait<T extends FromWorker["type"]>(type: T, predicate: (m: Extract<FromWorker, { type: T }>) => boolean = () => true): Promise<Extract<FromWorker, { type: T }>> {
      const deadline = performance.now() + 240_000;
      while (performance.now() < deadline) {
        const index = messages.findIndex((m) => m.type === type && predicate(m as Extract<FromWorker, { type: T }>));
        if (index >= 0) return messages.splice(index, 1)[0] as Extract<FromWorker, { type: T }>;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error(`worker timed out waiting for ${type} (last stats at t=${lastStep}); errors: ${errors.map((e) => e.message).join(" | ")}`);
    }
    const exported = async () => {
      send({ type: "export" });
      return Array.from(new Uint8Array((await wait("exported")).bytes));
    };
    try {
      const canvas = document.createElement("canvas").transferControlToOffscreen();
      send({ type: "init", canvas, width: 64, height: 64 }, [canvas]);
      await wait("ready");
      send({ type: "load", presetId: "ponds-small", seed: 1 });
      const refusedWorld = (await wait("loaded")).world!;
      send({ type: "step", count: 200 });
      await wait("stats", (m) => m.step === 200);

      send({ type: "feed", x: 20, y: 20, r: 4, amount: 4 });
      const fed = await wait("refused", (m) => m.request === "feed");
      send({ type: "feed", x: 20, y: 20, r: 4, amount: -4 });
      const drained = await wait("refused", (m) => m.request === "feed");
      const errorsAfterRefusals = [...errors];

      send({ type: "step", count: 100 });
      const after = await wait("stats", (m) => m.step === 300);
      const refusedBytes = await exported();
      // The run's history, which a checkpoint does not carry: a refused feed or drain must not be logged there either.
      send({ type: "sessionExport", world: refusedWorld, id: 1 });
      const session = JSON.parse((await wait("sessionFile", (m) => m.id === 1)).text) as { interventions: { kind: string }[]; final: { step: number } };

      // A feed the simulation fails (not a refusal) is an error, though the world is not marked failed and steps on. On a
      // world of its own, before the twin: in this harness a world has been seen not to step on after a second export.
      messages.length = 0;
      send({ type: "load", presetId: "ponds-small", seed: 1, keep: "discard" });
      await wait("loaded");
      send({ type: "step", count: 100 });
      await wait("stats", (m) => m.step === 100);
      fault("feed");
      send({ type: "feed", x: 20, y: 20, r: 4, amount: 4 });
      const feedError = await nextError(errors.length);
      const feedFaultHit = messages.some((m) => m.type === "test-sim-fault-hit" && m.method === "feed");
      send({ type: "step", count: 100 });
      const afterFeedError = await wait("stats", (m) => m.step === 200);
      // A census that fails marks the world failed; a feed then is an error of a failed world, never a notice.
      fault("drainLedger");
      send({ type: "step", count: 100 });
      const censusError = await nextError(errors.length);
      const censusFaultHit = messages.some((m) => m.type === "test-sim-fault-hit" && m.method === "drainLedger");
      send({ type: "feed", x: 20, y: 20, r: 4, amount: 4 });
      const failedFeedError = await nextError(errors.length);
      const refusedAfter = messages.filter((m) => m.type === "refused").map((m) => (m as Extract<FromWorker, { type: "refused" }>).message);

      // The same world as the first, never offered a feed, at the same step.
      messages.length = 0;
      send({ type: "load", presetId: "ponds-small", seed: 1, keep: "discard" });
      await wait("loaded");
      send({ type: "step", count: 300 });
      await wait("stats", (m) => m.step === 300);
      const twinBytes = await exported();
      return {
        fed: fed.message, drained: drained.message, errorsAfterRefusals, feeds: after.feeds, refusedBytes, twinBytes,
        sessionStep: session.final.step, logged: session.interventions.map((iv) => iv.kind),
        feedError, feedFaultHit, afterFeedError: { step: afterFeedError.step, feeds: afterFeedError.feeds }, censusError, censusFaultHit, failedFeedError, refusedAfter,
      };
    } finally {
      worker.terminate();
    }
  }, faultySimWorker);

  expect(result.fed).toMatch(POND_REFUSAL);
  expect(result.drained).toMatch(POND_REFUSAL);
  expect(result.errorsAfterRefusals).toEqual([]);
  // Nothing was fed, booked or logged: the world is the one that was never offered a feed.
  expect(result.feeds).toBe(0);
  const refused = decodeArtifact(new Uint8Array(result.refusedBytes)), twin = decodeArtifact(new Uint8Array(result.twinBytes));
  expect(refused.state.step).toBe(300);
  expect(stateHash(refused.state)).toBe(stateHash(twin.state));
  expect(refused.observer).toEqual(twin.observer);
  expect(result.sessionStep).toBe(300);
  expect(result.logged).not.toContain("feed");
  // The failing feed reached the simulation, came back as an error, booked nothing, and the world went on.
  expect(result.feedFaultHit).toBe(true);
  expect(result.feedError).toEqual({ message: "test: feed failed on the device", failed: false });
  expect(result.afterFeedError).toEqual({ step: 200, feeds: 0 });
  // The failed census marked the world failed, and the feed after it was an error of that failed world.
  expect(result.censusFaultHit).toBe(true);
  expect(result.censusError).toMatchObject({ message: expect.stringMatching(/^census at t=\d+ failed \(test: drainLedger failed on the device\)/), failed: true });
  expect(result.failedFeedError).toEqual({ message: result.censusError.message, failed: true });
  expect(result.refusedAfter).toEqual([]);
});

test("lab page: Feed and Drain on a pond world show a notice, and the world keeps running", async ({ page }) => {
  test.setTimeout(600_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/lab/?world=ponds-small&seed=1");
  await expect(page.locator("#simulation-status")).toHaveText("Paused", { timeout: 120_000 });
  await expect(page.locator("#world-heading")).toHaveText(/Pond cycle/);
  const play = page.locator("#btn-play");
  await play.click();
  await expect(play).toHaveAttribute("aria-pressed", "true");
  const box = (await page.locator("#world").boundingBox())!;
  const stepNow = async () => Number((await page.locator("#chip-step").textContent())?.replace(/[^0-9]/g, ""));

  for (const tool of ["Feed", "Drain"]) {
    await page.getByRole("button", { name: tool, exact: true }).click();
    await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.4);
    await expect(page.locator("#toast")).toHaveClass(/show/, { timeout: 60_000 });
    await expect(page.locator("#toast")).toContainText(POND_REFUSAL);
    // No alert, no pause: the world is still the one running.
    await expect(page.locator("#stage-alert")).toBeHidden();
    await expect(play).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#simulation-status")).not.toHaveText("World stopped");
    const t = await stepNow();
    await expect.poll(stepNow, { timeout: 120_000 }).toBeGreaterThan(t);
    // The notice fades, so the next tool's notice is its own.
    await expect(page.locator("#toast")).not.toHaveClass(/show/, { timeout: 60_000 });
  }
  await expect(page.locator("#k-fed")).toHaveText("none");
  await expect(page.locator("#stage-alert")).toBeHidden();
});
