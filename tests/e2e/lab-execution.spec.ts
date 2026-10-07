import { expect, test } from "@playwright/test";
import { decodeArtifact } from "@bl/runner";
import { stateHash } from "@bl/schema";
import type { FromWorker, ToWorker } from "../../apps/lab/src/protocol.ts";

test("lab worker settles queued saves, replays migration, and clears steps on adoption", async ({ page }) => {
  // An empty same-origin page gives this test its own worker and GPU device.
  await page.route("**/lab-worker-test", (route) => route.fulfill({ contentType: "text/html", body: "<html><body></body></html>" }));
  await page.goto("/lab-worker-test");
  const result = await page.evaluate(async () => {
    const workerModule = "/src/sim.worker.ts?worker";
    const WorkerConstructor = (await import(/* @vite-ignore */ workerModule)).default;
    const worker: Worker = new WorkerConstructor();
    const messages: FromWorker[] = [];
    worker.onmessage = (ev: MessageEvent<FromWorker>) => { messages.push(ev.data); };
    const send = (m: ToWorker, transfer: Transferable[] = []) => worker.postMessage(m, transfer);
    async function wait<T extends FromWorker["type"]>(type: T, predicate: (m: Extract<FromWorker, { type: T }>) => boolean = () => true): Promise<Extract<FromWorker, { type: T }>> {
      const deadline = performance.now() + 60_000;
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
      const overrides = { tileW: 32, tileH: 32, tilesX: 2, tilesY: 1, kernelRadius: 2, migrationPeriod: 200, migrantCount: 2 };
      send({ type: "load", presetId: "spots", seed: 19, overrides });
      await wait("loaded");
      send({ type: "step", count: 125 });
      await wait("stats", (m) => m.step === 125);
      // Both arrive together: export must wait for save's settlement/migration.
      send({ type: "save" });
      send({ type: "export" });
      const saved = await wait("session", (m) => m.view.checkpoints.length > 0);
      const first = await wait("exported");
      send({ type: "verify", steps: 400 });
      const replay = await wait("verify");
      send({ type: "export" });
      const continued = await wait("exported");

      // Queued requests for the old world cannot advance the new world.
      send({ type: "step", count: 100_000 });
      send({ type: "load", presetId: "spots", seed: 20, overrides, keep: "discard" });
      const loaded = await wait("loaded");
      send({ type: "export" });
      const fresh = await wait("exported");

      const importedBytes = first.bytes.slice(0);
      send({ type: "import", bytes: importedBytes, name: first.name }, [importedBytes]);
      const imported = await wait("loaded");
      send({ type: "verify", steps: 400 });
      const restoredReplay = await wait("verify");
      send({ type: "export" });
      const restored = await wait("exported");
      send({ type: "speed", stepsPerFrame: 512 });
      send({ type: "play", playing: true });
      await wait("stats", (m) => m.step > 600);
      // Playback can have a census readback in flight when save arrives.
      send({ type: "play", playing: false });
      send({ type: "save" });
      send({ type: "export" });
      await wait("session", (m) => m.view.checkpoints.some((c) => c.step > 600));
      const playback = await wait("exported");
      return {
        adapter: ready.adapter, checkpointSteps: saved.view.checkpoints.map((c) => c.step),
        replay, restoredReplay, loadedStep: loaded.step, importedStep: imported.step,
        playback: Array.from(new Uint8Array(playback.bytes)),
        first: Array.from(new Uint8Array(first.bytes)), continued: Array.from(new Uint8Array(continued.bytes)),
        fresh: Array.from(new Uint8Array(fresh.bytes)), restored: Array.from(new Uint8Array(restored.bytes)),
      };
    } finally {
      worker.terminate();
    }
  });
  console.log("lab worker adapter:", result.adapter);
  expect(result.checkpointSteps).toContain(200);
  expect(result.replay.ok, result.replay.detail).toBe(true);
  expect(result.restoredReplay.ok, result.restoredReplay.detail).toBe(true);
  expect(result.loadedStep).toBe(0);
  expect(result.importedStep).toBe(200);
  const first = decodeArtifact(new Uint8Array(result.first));
  const continued = decodeArtifact(new Uint8Array(result.continued));
  const fresh = decodeArtifact(new Uint8Array(result.fresh));
  const restored = decodeArtifact(new Uint8Array(result.restored));
  expect(first.state.step).toBe(200);
  expect(first.observer.censusIdx).toBe(2);
  expect(continued.state.step).toBe(600);
  expect(continued.observer.censusIdx).toBe(6);
  expect(fresh.state.step).toBe(0);
  expect(fresh.observer.censusIdx).toBe(0);
  expect(stateHash(restored.state)).toBe(stateHash(continued.state));
  expect(restored.observer).toEqual(continued.observer);
  const playback = decodeArtifact(new Uint8Array(result.playback));
  expect(playback.state.step).toBeGreaterThan(600);
  expect(playback.state.step % 100).toBe(0);
  expect(playback.observer.step).toBe(playback.state.step);
  expect(playback.observer.censusIdx).toBe(playback.state.step / 100);
});
