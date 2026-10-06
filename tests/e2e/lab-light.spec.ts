import { expect, test } from "@playwright/test";

test("the Light view is the eighth view and answers key 8", async ({ page }) => {
  await page.goto("/lab/");
  await expect(page.locator("#simulation-status")).not.toHaveText(/Planting|No world yet/, { timeout: 60_000 });
  const light = page.locator('#views [data-mode="light"]');
  await expect(light).toHaveText("Light");
  await expect(page.locator("#views button")).toHaveCount(8);
  await light.click();
  await expect(light).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#legend")).toContainText("Showing Light");
  await page.locator('#views [data-mode="composite"]').click();
  await page.locator("#world").focus();
  await page.keyboard.press("8");
  await expect(light).toHaveAttribute("aria-pressed", "true");
});

test("the Light view draws the light the physics uses at the current step and leaves the state alone", async ({ page }) => {
  await page.goto("/selftest.html");
  const result = await page.evaluate(async ({ gpuPath, schemaPath }) => {
    const { GpuSim, Renderer, requestDevice } = await import(/* @vite-ignore */ gpuPath);
    const { allocState, defaultConfig, CH, stateHash } = await import(/* @vite-ignore */ schemaPath);
    const device: GPUDevice = await requestDevice(navigator.gpu);
    const validation: string[] = [];
    device.addEventListener("uncapturederror", (e) => validation.push((e as GPUUncapturedErrorEvent).error.message));
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext("webgpu")!;
    ctx.configure({ device, format: "rgba8unorm", usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
    const outputs: { kind: string; red: number[]; stable: boolean }[] = [];
    const cases = [
      { kind: "uniform", lightMode: "uniform", lightBase: 40, lightAmp: 160, step: 0 },
      { kind: "gradient", lightMode: "gradient", lightBase: 20, lightAmp: 220, step: 0 },
      { kind: "patches", lightMode: "patches", lightBase: 20, lightAmp: 160, step: 0 },
      { kind: "sweep0", lightMode: "sweep", lightBase: 20, lightAmp: 220, dayPeriod: 128, step: 0 },
      { kind: "sweep32", lightMode: "sweep", lightBase: 20, lightAmp: 220, dayPeriod: 128, step: 32 },
      { kind: "season0", lightMode: "uniform", lightBase: 100, lightAmp: 0, seasonPeriod: 128, seasonAmp: 60, step: 0 },
      { kind: "season64", lightMode: "uniform", lightBase: 100, lightAmp: 0, seasonPeriod: 128, seasonAmp: 60, step: 64 },
    ];
    for (const { kind, step, ...light } of cases) {
      const state = allocState({ ...defaultConfig(), tileW: 64, tileH: 64, kernelRadius: 2, ...light });
      state.step = step;
      state.cells.fill(32, CH.A * 4096, (CH.A + 1) * 4096);
      const sim = await GpuSim.create(device, state);
      const renderer = new Renderer(device, ctx, "rgba8unorm", sim);
      const before = stateHash(await sim.readState());
      renderer.draw("light", { x: 0, y: 0, w: 64, h: 64 }, 64, 64);
      const buffer = device.createBuffer({ size: 64 * 256, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      const enc = device.createCommandEncoder();
      enc.copyTextureToBuffer({ texture: ctx.getCurrentTexture() }, { buffer, bytesPerRow: 256 }, { width: 64, height: 64 });
      device.queue.submit([enc.finish()]);
      await buffer.mapAsync(GPUMapMode.READ);
      const pixels = new Uint8Array(buffer.getMappedRange()).slice();
      buffer.unmap(); buffer.destroy();
      // Top-left, two cells along the top row, and the bottom-left corner.
      const red = [0, 16, 32, 63 * 64].map((i) => pixels[i * 4]);
      outputs.push({ kind, red, stable: stateHash(await sim.readState()) === before });
      renderer.destroy(); sim.destroy();
    }
    device.destroy();
    return { outputs, validation };
  }, { gpuPath: `/@fs${new URL("../../packages/sim-gpu/src/index.ts", import.meta.url).pathname}`, schemaPath: `/@fs${new URL("../../packages/schema/src/index.ts", import.meta.url).pathname}` });
  expect(result.validation).toEqual([]);
  const row = (kind: string) => result.outputs.find((r) => r.kind === kind)!;
  // The red channel is light / 255 at full scale, so it reads the light level directly, within rounding.
  const approximately = (actual: number[], expected: number[]) => expected.forEach((v, i) => expect(Math.abs(actual[i] - v)).toBeLessThanOrEqual(1));
  approximately(row("uniform").red, [200, 200, 200, 200]);
  approximately(row("gradient").red, [20, 20, 20, 240]);
  approximately(row("patches").red, [180, 180, 20, 20]);
  approximately(row("sweep0").red, [240, 130, 20, 240]);
  approximately(row("sweep32").red, [130, 240, 130, 130]);
  approximately(row("season0").red, [160, 160, 160, 160]);
  approximately(row("season64").red, [100, 100, 100, 100]);
  expect(result.outputs.every((r) => r.stable)).toBe(true);
});
