import { expect, test } from "@playwright/test";
import { decodeArtifact, specConfig, type RunSpec } from "@bl/runner";
import { canonicalConfig, encodeCheckpoint, stateHash } from "@bl/schema";
import type { FromWorker, PondsMsg, ToWorker } from "../../apps/lab/src/protocol.ts";

// The Deno runner's state at t=4000 (after cycle 4) of the history the lab loads below:
//   deno run -A tools/run.ts --experiment lab-ponds --preset ponds-small --conditions treatment --seeds 1 \
//     --steps 4000 --census 100 --deep 5 --checkpoint 1000 --out "$DIR"
//   jq -r '.checkpoints[] | select(.step == 4000) | .hash' "$DIR"/lab-ponds/ponds-small/treatment/seed-1/manifest.json
// The full stateHash, config included, rather than the physical digest: treatment applies no keys and
// the spec has no overrides, so specConfig(REFERENCE) is presetConfig(ponds-small, 1), which is what the
// lab's load builds. The test asserts that identity first, so a config drift fails as such.
const REFERENCE: RunSpec = { experiment: "lab-ponds", presetId: "ponds-small", condition: "treatment", seed: 1, steps: 4000, censusEvery: 100, deepEvery: 5, checkpointEvery: 1000 };
const REFERENCE_HASH = "27a2a00415c69c96";
// The donor column of that run's ponds.tsv, cycles 1-4 (one donor pond per cycle in this history).
const REFERENCE_DONORS = [[0], [2], [0], [2]];

// Artifacts cross the page boundary as base64: at 128 x 128 cells, number arrays take tens of seconds.
const fromBase64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
const toBase64 = (bytes: Uint8Array) => {
  let text = "";
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
};

test("lab worker runs the runner's pond cycle, replays and resumes across it, and refuses a pre-cycle import", async ({ page }) => {
  // An empty same-origin page gives this test its own worker and GPU device.
  await page.route("**/lab-worker-test", (route) => route.fulfill({ contentType: "text/html", body: "<html><body></body></html>" }));
  // A pre-cycle artifact: a post-cycle one with its last cycle undone, re-encoded with the schema's codec.
  await page.exposeFunction("preCycle", (base64: string) => {
    const { state, observer } = decodeArtifact(fromBase64(base64));
    return toBase64(encodeCheckpoint(state, { ...observer, ponds: { lastCycle: observer.ponds!.lastCycle - 1 } }));
  });
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
    /** The next error, which the request just sent is expected to raise. */
    async function refused(): Promise<string> {
      const deadline = performance.now() + 60_000;
      while (performance.now() < deadline) {
        const index = messages.findIndex((m) => m.type === "error");
        if (index >= 0) return (messages.splice(index, 1)[0] as Extract<FromWorker, { type: "error" }>).message;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error("worker timed out waiting for an error");
    }
    /** Removes and returns every queued message of `type`, in arrival order. */
    const take = <T extends FromWorker["type"]>(type: T) => {
      const out = messages.filter((m) => m.type === type) as Extract<FromWorker, { type: T }>[];
      messages.splice(0, messages.length, ...messages.filter((m) => m.type !== type));
      return out;
    };
    const same = (a: ArrayBuffer, b: ArrayBuffer) => {
      const x = new Uint8Array(a), y = new Uint8Array(b);
      return x.length === y.length && x.every((v, i) => v === y[i]);
    };
    // The module's base64 helpers do not reach the page.
    const toBase64 = (bytes: ArrayBuffer) => {
      const u = new Uint8Array(bytes);
      let text = "";
      for (let i = 0; i < u.length; i += 0x8000) text += String.fromCharCode(...u.subarray(i, i + 0x8000));
      return btoa(text);
    };
    const preCycle = (window as unknown as { preCycle(base64: string): Promise<string> }).preCycle;
    try {
      // The worker's animation frames stop once its placeholder canvas is collected, so the DOM holds it.
      const canvas = document.body.appendChild(document.createElement("canvas")).transferControlToOffscreen();
      send({ type: "init", canvas, width: 64, height: 64 }, [canvas]);
      const ready = await wait("ready");
      send({ type: "load", presetId: "ponds-small", seed: 1 });
      const loaded = await wait("loaded");
      send({ type: "step", count: 800 });
      await wait("stats", (m) => m.step === 800);
      // t=800 -> 1200 crosses cycle 1 at t=1000, on the live world and its twin.
      send({ type: "verify", steps: 400 });
      const replay = await wait("verify");
      const firstCycle = await wait("ponds", (m) => m.cycle === 1);
      send({ type: "step", count: 1300 });
      await wait("stats", (m) => m.step === 2500);
      // A mid-period census: save and export there, then run on to cycle 4.
      send({ type: "save" });
      send({ type: "export" });
      const saved = await wait("checkpoints", (m) => m.list.some((c) => c.step === 2500));
      const mid = await wait("exported");
      send({ type: "step", count: 1500 });
      await wait("stats", (m) => m.step === 4000);
      send({ type: "export" });
      const continuous = await wait("exported");
      const cycles = take("ponds");

      // Importing the pre-cycle artifact is refused, and the world at t=4000 stays loaded.
      const pre = Uint8Array.from(atob(await preCycle(toBase64(continuous.bytes))), (c) => c.charCodeAt(0)).buffer;
      send({ type: "import", bytes: pre, name: "pre-cycle.blck" }, [pre]);
      const guard = await refused();
      send({ type: "export" });
      const kept = await wait("exported");

      // The mid-period export, imported and run to t=4000.
      const midBytes = mid.bytes.slice(0);
      send({ type: "import", bytes: midBytes, name: mid.name }, [midBytes]);
      const imported = await wait("loaded");
      // Statistics queued before adoption belong to the replaced world (also at t=4000).
      take("stats");
      send({ type: "step", count: 1500 });
      await wait("stats", (m) => m.step === 4000);
      send({ type: "export" });
      const resumed = await wait("exported");
      const resumedCycles = take("ponds");

      // An unknown preset is refused without falling back to another one.
      send({ type: "load", presetId: "no-such-preset", seed: 1 });
      const unknown = await refused();
      send({ type: "export" });
      const afterUnknown = await wait("exported");
      return {
        adapter: ready.adapter, loadedStep: loaded.step, importedStep: imported.step, replay,
        checkpointSteps: saved.list.map((c) => c.step),
        firstCycle, cycles, resumedCycles, guard, unknown,
        keptSame: same(kept.bytes, continuous.bytes), resumedSame: same(resumed.bytes, continuous.bytes),
        afterUnknownSame: same(afterUnknown.bytes, resumed.bytes), strayLoaded: messages.some((m) => m.type === "loaded"),
        mid: toBase64(mid.bytes), continuous: toBase64(continuous.bytes), resumed: toBase64(resumed.bytes),
      };
    } finally {
      worker.terminate();
    }
  });
  console.log("lab worker adapter:", result.adapter);
  expect(result.loadedStep).toBe(0);
  expect(result.replay.ok, result.replay.detail).toBe(true);
  expect(result.replay.detail).toContain("400 steps from t=800");
  // Display messages, one per cycle, with the runner's donors.
  const cycle = (m: PondsMsg) => ({ step: m.step, cycle: m.cycle, arm: m.arm, donors: m.donors });
  const want = REFERENCE_DONORS.map((donors, k) => ({ step: (k + 1) * 1000, cycle: k + 1, arm: "scaf", donors }));
  expect(cycle(result.firstCycle)).toEqual(want[0]);
  expect(result.cycles.map(cycle)).toEqual(want.slice(1));
  expect(result.resumedCycles.map(cycle)).toEqual(want.slice(2));

  expect(result.checkpointSteps).toContain(2500);
  const mid = decodeArtifact(fromBase64(result.mid));
  expect(mid.state.step).toBe(2500);
  expect(mid.observer.ponds).toEqual({ lastCycle: 2 });
  const continuous = decodeArtifact(fromBase64(result.continuous));
  expect(continuous.state.step).toBe(4000);
  expect(canonicalConfig(continuous.state.cfg)).toBe(canonicalConfig(specConfig(REFERENCE)));
  expect(stateHash(continuous.state)).toBe(REFERENCE_HASH);
  expect(continuous.observer.ponds).toEqual({ lastCycle: 4 });
  expect(continuous.observer.censusIdx).toBe(40);

  expect(result.guard).toContain("the observer's last pond cycle is 3, but t=4000 needs 4 (a pre-cycle state");
  expect(result.keptSame).toBe(true);

  expect(result.importedStep).toBe(2500);
  const resumed = decodeArtifact(fromBase64(result.resumed));
  expect(stateHash(resumed.state)).toBe(stateHash(continuous.state));
  expect(resumed.observer).toEqual(continuous.observer);
  expect(result.resumedSame).toBe(true);

  expect(result.unknown).toBe('unknown preset "no-such-preset"');
  expect(result.afterUnknownSame).toBe(true);
  expect(result.strayLoaded).toBe(false);
});
