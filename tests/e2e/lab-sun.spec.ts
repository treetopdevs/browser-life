import { expect, test } from "@playwright/test";
import { decodeArtifact } from "@bl/runner";
import { cloneState, stateHash, sunLight } from "@bl/schema";
import { SunRefSim } from "@bl/sim-ref";
import type { FromWorker, ToWorker } from "../../apps/lab/src/protocol.ts";

// The lab's Sun (docs/garden-sun-2026-10-18.md): the Light view draws a sun's light, the worker sets, logs, ends and replays a sun
// exactly as the reference does, and the page's Sun tool says what each choice does to this world and refuses what it cannot take.

test("the Light view draws a sun's light (Renderer.setLight), and setLight leaves the state alone", async ({ page }) => {
  await page.goto("/selftest.html");
  const result = await page.evaluate(async ({ gpuPath, schemaPath }) => {
    const { GpuSim, Renderer, requestDevice } = await import(/* @vite-ignore */ gpuPath);
    const { allocState, defaultConfig, CH, stateHash, sunLight } = await import(/* @vite-ignore */ schemaPath);
    const device: GPUDevice = await requestDevice(navigator.gpu);
    const validation: string[] = [];
    device.addEventListener("uncapturederror", (e) => validation.push((e as GPUUncapturedErrorEvent).error.message));
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext("webgpu")!;
    ctx.configure({ device, format: "rgba8unorm", usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
    const state = allocState({ ...defaultConfig(), tileW: 64, tileH: 64, kernelRadius: 2, lightMode: "uniform", lightBase: 40, lightAmp: 160 });
    state.cells.fill(32, CH.A * 4096, (CH.A + 1) * 4096);
    const sim = await GpuSim.create(device, state);
    const renderer = new Renderer(device, ctx, "rgba8unorm", sim);
    const red = async () => {
      renderer.draw("light", { x: 0, y: 0, w: 64, h: 64 }, 64, 64);
      const buffer = device.createBuffer({ size: 64 * 256, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      const enc = device.createCommandEncoder();
      enc.copyTextureToBuffer({ texture: ctx.getCurrentTexture() }, { buffer, bytesPerRow: 256 }, { width: 64, height: 64 });
      device.queue.submit([enc.finish()]);
      await buffer.mapAsync(GPUMapMode.READ);
      const px = new Uint8Array(buffer.getMappedRange()).slice();
      buffer.unmap(); buffer.destroy();
      return px[0];
    };
    const before = stateHash(await sim.readState());
    const own = await red();
    const light = sunLight(sim.cfg, 50);
    await sim.setLight(light);
    renderer.setLight(light);
    const dim = await red();
    const active = sim.activeLight;
    await sim.setLight(null);
    renderer.setLight(null);
    const back = await red();
    const after = stateHash(await sim.readState());
    const cfgSame = JSON.stringify((await sim.readState()).cfg) === JSON.stringify(state.cfg);
    renderer.destroy(); sim.destroy(); device.destroy();
    return { own, dim, back, active, stable: before === after, cfgSame, validation };
  }, { gpuPath: `/@fs${new URL("../../packages/sim-gpu/src/index.ts", import.meta.url).pathname}`, schemaPath: `/@fs${new URL("../../packages/schema/src/index.ts", import.meta.url).pathname}` });
  expect(result.validation).toEqual([]);
  // Even light 40 + 160 = 200; half of it is 20 + 80 = 100.
  expect(Math.abs(result.own - 200)).toBeLessThanOrEqual(1);
  expect(Math.abs(result.dim - 100)).toBeLessThanOrEqual(1);
  expect(Math.abs(result.back - 200)).toBeLessThanOrEqual(1);
  expect(result.active).toEqual({ lightBase: 20, lightAmp: 80, seasonAmp: 0 });
  expect(result.stable && result.cfgSame).toBe(true);
});

test("lab worker sets a sun, logs it, ends it at its span, refuses what the world cannot take, and a jump back replays it", async ({ page }) => {
  await page.route("**/lab-sun-test", (route) => route.fulfill({ contentType: "text/html", body: "<html><body></body></html>" }));
  await page.goto("/lab-sun-test");
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
      return Array.from(new Uint8Array((await wait("exported")).bytes));
    };
    try {
      const canvas = document.createElement("canvas").transferControlToOffscreen();
      send({ type: "init", canvas, width: 64, height: 64 }, [canvas]);
      await wait("ready");
      send({ type: "load", presetId: "spots", seed: 19, overrides: { tileW: 32, tileH: 32, tilesX: 2, tilesY: 1, kernelRadius: 2 } });
      const gen = (await wait("loaded")).world!;
      const first = await wait("sun");
      send({ type: "step", count: 100 });
      await wait("stats", (m) => m.step === 100);
      send({ type: "save" });
      await wait("session", (m) => m.view.checkpoints.some((c) => c.step === 100));
      const before = await exported();
      // Too bright for even light (60 + 240 > 255): refused, nothing logged.
      send({ type: "sun", percent: 150, span: 50 });
      const refusal = await wait("refused", (m) => m.request === "sun");
      // Values the page never sends are refused as sent, not rounded into another sun (a 75% sun of 10 steps would make the 50%
      // sun below overlap); so is a sun chosen for a world that has since been replaced.
      const odd: string[] = [];
      for (const [percent, span, world] of [[75.9, 10, gen], [75, 10.8, gen], ["75", "10", gen], [75, 10, gen + 1]] as const) {
        send({ type: "sun", percent, span, world } as unknown as ToWorker);
        odd.push((await wait("refused", (m) => m.request === "sun")).message);
      }
      send({ type: "sun", percent: 50, span: 150, world: gen });
      const set = await wait("sun", (m) => m.sun !== null);
      // A second sun while one shines is refused.
      send({ type: "sun", percent: 75, span: 10 });
      const second = await wait("refused", (m) => m.request === "sun");
      send({ type: "step", count: 200 });
      const ended = await wait("sun", (m) => m.sun === null);
      await wait("stats", (m) => m.step === 300);
      const liveBytes = await exported();
      send({ type: "verify", steps: 100 });
      const replay = await wait("verify");
      // Jump to t=300: restores the t=100 checkpoint (saved before the sun) and re-applies the logged sun on the way.
      messages.length = 0;
      send({ type: "jump", step: 300, key: null });
      await wait("loaded");
      await wait("stats", (m) => m.step === 300);
      const jumpedBytes = await exported();
      return { first: first.sun, refusal: refusal.message, odd, set: set.sun, second: second.message, ended: ended.sun, before, liveBytes, jumpedBytes, replay, errors };
    } finally {
      worker.terminate();
    }
  });
  expect(result.errors).toEqual([]);
  expect(result.first).toBeNull();
  expect(result.refusal).toMatch(/cannot take that sun/);
  expect(result.odd).toHaveLength(4);
  expect(result.odd[3]).toMatch(/chosen for a world that has since been replaced/);
  expect(result.set).toEqual({ step: 100, percent: 50, span: 150 });
  expect(result.second).toMatch(/already shining .* returns at step 250/);
  expect(result.ended).toBeNull();
  expect(result.replay.ok, result.replay.detail).toBe(true);
  // The worker's world is the reference's under the same sun.
  const start = decodeArtifact(new Uint8Array(result.before)).state;
  const ref = new SunRefSim(cloneState(start));
  ref.setLightNow(sunLight(start.cfg, 50));
  ref.run(150);
  ref.setLightNow(null);
  ref.run(50);
  const live = decodeArtifact(new Uint8Array(result.liveBytes));
  expect(live.state.step).toBe(300);
  expect(stateHash(live.state)).toBe(stateHash(ref.state));
  expect(live.observer.sun).toBeUndefined();
  // A jump back replays the logged sun: the same world, the same observer.
  const jumped = decodeArtifact(new Uint8Array(result.jumpedBytes));
  expect(stateHash(jumped.state)).toBe(stateHash(live.state));
  expect(jumped.observer).toEqual(live.observer);
});

test("lab page: the Sun tool says what each choice does to this world, refuses what it cannot take, and sets a sun", async ({ page }) => {
  await page.goto("/lab/");
  await expect(page.locator("#simulation-status")).toHaveText("Paused", { timeout: 60_000 });
  await expect(page.locator("#sun-panel")).toBeHidden();
  await page.getByRole("button", { name: "Sun", exact: true }).click();
  await expect(page.locator("#sun-panel")).toBeVisible();
  await expect(page.locator("#tool-says")).toContainText("Sun. Dim the whole sky for a while (on some worlds you can brighten it instead)");
  const choices = page.locator("#sun-choices .sun-choice");
  await expect(choices).toHaveCount(4);
  await expect(page.locator("#sun-choices")).toContainText("This world's own light: base");
  // The planted world's light decides which choices it takes; at least one is too bright for any preset's light here.
  const disabled = await page.locator('#sun-choices input[name="sun-percent"]:disabled').count();
  expect(disabled).toBeGreaterThanOrEqual(1);
  await expect(page.locator('#sun-choices input[value="50"]')).toBeEnabled();
  await page.locator('#sun-choices input[value="50"]').check();
  await page.locator("#sun-span").fill("500");
  await expect(page.locator("#btn-sun")).toBeEnabled();
  await page.locator("#btn-sun").click();
  await expect(page.locator("#sun-status")).toContainText("A sun of 50% shines from step", { timeout: 30_000 });
  await expect(page.locator("#sun-status")).toContainText("returns at step");
  await expect(page.locator("#btn-sun")).toBeDisabled();
  await page.locator("#sun-span").fill("0");
  await expect(page.locator("#btn-sun")).toBeDisabled();
});
