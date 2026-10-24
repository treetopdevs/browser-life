import { expect, test } from "@playwright/test";

test("Membrane is view nine, answers key 9 and refreshes its shell context when worlds change", async ({ page }) => {
  await page.goto("/lab/?world=breeder&seed=1");
  await expect(page.locator("#simulation-status")).toHaveText("Paused", { timeout: 60_000 });
  const membrane = page.locator('#views [data-mode="membrane"]');
  await expect(page.locator("#views button")).toHaveCount(9);
  await expect(page.locator("#views button").nth(8)).toHaveText("Membrane");
  await membrane.click();
  await expect(membrane).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#legend")).toContainText("low amounts boosted");
  await expect(page.locator("#legend")).toContainText("Tile borders and lineage highlighting overlay these colours");
  await expect(page.locator("#legend")).not.toContainText("require 2");
  await page.locator('#views [data-mode="composite"]').click();
  await page.locator("#world").focus();
  await page.keyboard.press("9");
  await expect(membrane).toHaveAttribute("aria-pressed", "true");
  for (const [preset, shell] of [["breeder-wounded-shell", true], ["breeder", false]] as const) {
    await page.locator("#preset").selectOption(preset);
    // Picking a preset does not change the world on screen or its legend.
    if (shell) await expect(page.locator("#legend")).not.toContainText("require 2");
    else await expect(page.locator("#legend")).toContainText("require 2");
    await page.locator("#btn-new").click();
    const guard = page.locator("#guard-new").getByRole("button", { name: /without saving/i });
    if (await guard.waitFor({ state: "visible", timeout: 1_000 }).then(() => true, () => false)) await guard.click();
    await expect(page.locator("#world-heading")).toHaveText(shell ? "The breeder (wounded, shells)" : "The breeder", { timeout: 60_000 });
    await expect(membrane).toHaveAttribute("aria-pressed", "true");
    if (shell) {
      await expect(page.locator("#legend")).toContainText("scheduled wounds require 2 membrane in a living cell");
      await expect(page.locator("#legend")).toContainText("the Wound tool still cuts through shells");
    }
    else await expect(page.locator("#legend")).not.toContainText("require 2");
  }
  await page.locator("#btn-step100").click();
  await expect(page.locator("#chip-step")).toHaveText("t = 100", { timeout: 60_000 });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: "test-results/membrane-view-desktop.png" });
  await page.locator("#theme-toggle").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.screenshot({ path: "test-results/membrane-view-night.png" });
  await page.locator("#theme-toggle").click();
  await page.setViewportSize({ width: 390, height: 844 });
  await membrane.click();
  await expect(membrane).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/membrane-view-mobile.png" });
});

test("Membrane pixels show only P quantity and rendering leaves current and future simulation hashes unchanged", async ({ page }) => {
  await page.goto("/selftest.html");
  const result = await page.evaluate(async ({ gpuPath, schemaPath }) => {
    const { GpuSim, Renderer, requestDevice, VIEW_MODES } = await import(/* @vite-ignore */ gpuPath);
    const { allocState, defaultConfig, CH, G, stateHash } = await import(/* @vite-ignore */ schemaPath);
    const device: GPUDevice = await requestDevice(navigator.gpu);
    const validation: string[] = [];
    device.addEventListener("uncapturederror", e => validation.push((e as GPUUncapturedErrorEvent).error.message));
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext("webgpu")!;
    ctx.configure({ device, format: "rgba8unorm", usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
    const outputs: { pixels: number[][]; highlighted: number[]; stable: boolean; futureStable: boolean }[] = [];
    for (const injuryShell of [undefined, 2]) {
      const cfg = { ...defaultConfig(), tileW: 64, tileH: 64, kernelRadius: 2, ...(injuryShell === undefined ? {} : { injuryShell, injuryPeriod: 13, injuryRadius: 3, injuryProb: 100_000 }) };
      const state = allocState(cfg);
      const amounts = [0, 1, 2, 4, 4, 64, 256, 512];
      for (let i = 0; i < amounts.length; i++) {
        state.cells[CH.P * 4096 + i] = amounts[i];
        // Other channels and lineage vary independently; equal P must still give equal pixels.
        state.cells[CH.A * 4096 + i] = 20 + i * 10;
        state.cells[CH.B * 4096 + i] = 40 + i;
        state.cells[CH.C * 4096 + i] = i * 3;
        state.cells[CH.E * 4096 + i] = 80;
        state.genome[G.LIN_LO * 4096 + i] = i % 2;
      }
      state.genome[G.LIN_LO * 4096] = 1; // Selected lineage with zero P: highlight is an explicit overlay.
      const sim = await GpuSim.create(device, state);
      const twin = await GpuSim.create(device, state);
      const renderer = new Renderer(device, ctx, "rgba8unorm", sim);
      const before = stateHash(await sim.readState());
      renderer.draw("membrane", { x: 0, y: 0, w: 64, h: 64 }, 64, 64);
      const buffer = device.createBuffer({ size: 64 * 256, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      const enc = device.createCommandEncoder();
      enc.copyTextureToBuffer({ texture: ctx.getCurrentTexture() }, { buffer, bytesPerRow: 256 }, { width: 64, height: 64 });
      device.queue.submit([enc.finish()]);
      await buffer.mapAsync(GPUMapMode.READ);
      const bytes = new Uint8Array(buffer.getMappedRange()).slice();
      buffer.unmap(); buffer.destroy();
      const pixels = amounts.map((_, i) => Array.from(bytes.slice(i * 4, i * 4 + 4)));
      renderer.draw("membrane", { x: 0, y: 0, w: 64, h: 64 }, 64, 64, 256, [0, 1]);
      const highlightedBuffer = device.createBuffer({ size: 256, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      const highlightedCopy = device.createCommandEncoder();
      highlightedCopy.copyTextureToBuffer({ texture: ctx.getCurrentTexture() }, { buffer: highlightedBuffer, bytesPerRow: 256 }, { width: 64, height: 1 });
      device.queue.submit([highlightedCopy.finish()]);
      await highlightedBuffer.mapAsync(GPUMapMode.READ);
      const highlighted = Array.from(new Uint8Array(highlightedBuffer.getMappedRange()).slice(0, 4));
      highlightedBuffer.unmap(); highlightedBuffer.destroy();
      const stable = stateHash(await sim.readState()) === before;
      const step = device.createCommandEncoder();
      sim.encodeStep(step); twin.encodeStep(step);
      device.queue.submit([step.finish()]);
      const futureStable = stateHash(await sim.readState()) === stateHash(await twin.readState());
      outputs.push({ pixels, highlighted, stable, futureStable });
      renderer.destroy(); sim.destroy(); twin.destroy();
    }
    device.destroy();
    return { modes: [...VIEW_MODES], outputs, validation };
  }, { gpuPath: `/@fs${new URL("../../packages/sim-gpu/src/index.ts", import.meta.url).pathname}`, schemaPath: `/@fs${new URL("../../packages/schema/src/index.ts", import.meta.url).pathname}` });
  expect(result.modes).toEqual(["composite", "lineage", "nutrient", "waste", "energy", "signal", "affinity", "light", "membrane"]);
  expect(result.validation).toEqual([]);
  for (const out of result.outputs) {
    expect(out.highlighted[0]).toBeGreaterThan(0);
    expect(out.highlighted[0]).toBeGreaterThan(out.highlighted[1]);
    expect(out.highlighted[1]).toBeGreaterThan(out.highlighted[2]);
    expect(out.stable).toBe(true);
    expect(out.futureStable).toBe(true);
    const expected = [0, 16, 23, 32, 32, 128, 255, 255];
    out.pixels.forEach(([r, g, b, a], i) => {
      expect(Math.abs(r - expected[i])).toBeLessThanOrEqual(1);
      expect(g).toBe(r); expect(b).toBe(r); expect(a).toBe(255);
    });
  }
  expect(result.outputs[0].pixels).toEqual(result.outputs[1].pixels);
});
