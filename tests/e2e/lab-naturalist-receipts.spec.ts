import { expect, test } from "@playwright/test";
import type { FromWorker, ToWorker } from "../../apps/lab/src/protocol.ts";

test("worker: waiting donors refuse the tagged wound and preserve untagged refusal shape", async ({ page }) => {
  await page.route("**/lab-receipts-test", route => route.fulfill({ contentType: "text/html", body: "<html><body></body></html>" }));
  await page.goto("/lab-receipts-test");
  const got = await page.evaluate(async () => {
    const Constructor = (await import(/* @vite-ignore */ "/src/sim.worker.ts?worker")).default;
    const worker: Worker = new Constructor();
    const messages: FromWorker[] = [];
    worker.onmessage = (event: MessageEvent<FromWorker>) => messages.push(event.data);
    const send = (message: ToWorker, transfer: Transferable[] = []) => worker.postMessage(message, transfer);
    async function wait<T extends FromWorker["type"]>(type: T, index = 0): Promise<Extract<FromWorker, { type: T }>> {
      const deadline = performance.now() + 60_000;
      while (performance.now() < deadline) {
        const error = messages.find(m => m.type === "error");
        if (error?.type === "error") throw new Error(error.message);
        const found = messages.filter((m): m is Extract<FromWorker, { type: T }> => m.type === type)[index];
        if (found) return found;
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      throw new Error(`Timed out waiting for ${type}`);
    }
    try {
      const canvas = document.createElement("canvas").transferControlToOffscreen();
      send({ type: "init", canvas, width: 64, height: 64 }, [canvas]);
      await wait("ready");
      send({ type: "load", presetId: "ponds-small", seed: 1, overrides: { pondPeriod: 100 } });
      const loaded = await wait("loaded");
      // A tagged accepted wound has a receipt even when the world has no naturalist baseline.
      send({ type: "lesion", x: 10, y: 10, r: 1, world: loaded.world, id: 200 });
      const accepted = await wait("naturalistTouched");
      send({ type: "breeder", on: true });
      send({ type: "step", count: 100 });
      await wait("pondAwait");
      send({ type: "lesion", x: 10, y: 10, r: 1, world: loaded.world, id: 201 });
      const tagged = await wait("refused");
      send({ type: "lesion", x: 10, y: 10, r: 1 });
      const untagged = await wait("refused", 1);
      return { accepted, tagged, untagged, touches: messages.filter(m => m.type === "naturalistTouched").length };
    } finally { worker.terminate(); }
  });
  expect(got.accepted.id).toBe(200);
  expect(got.tagged.id).toBe(201);
  expect(got.tagged.request).toBe("lesion");
  expect(got.tagged.message).toContain("waiting for its donors");
  expect(got.untagged).not.toHaveProperty("id");
  expect(got.touches).toBe(1);
});
