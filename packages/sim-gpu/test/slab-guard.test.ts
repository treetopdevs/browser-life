import { describe, expect, it } from "vitest";
import { defaultConfig, generalistGenome3, slabSpotsWorld } from "@bl/schema";
import { GpuSim } from "../src/gpu-sim.ts";

describe("GpuSim refuses slab states", () => {
  const slab = slabSpotsWorld(defaultConfig({ tileW: 32, tileH: 32, kernelRadius: 3, tileD: 8, lightK: 1024, lightMode: "uniform" }), generalistGenome3(154, 24), 2);
  it("upload() throws before any buffer write", () => {
    const touched: string[] = [];
    const fake = new Proxy({}, { get: (_t, k) => { touched.push(String(k)); return undefined; } });
    expect(() => GpuSim.prototype.upload.call(fake as GpuSim, slab)).toThrow(/slab/);
    expect(touched).toEqual([]);
  });
  it("create() throws too", async () => {
    await expect(GpuSim.create({} as GPUDevice, slab)).rejects.toThrow(/slab/);
  });
});
