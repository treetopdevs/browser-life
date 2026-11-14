// GpuSim3.create / upload without a GPU: a mocked device records buffers, error scopes and writes.
import { describe, expect, it } from "vitest";
import { cloneState, defaultConfig, generalistGenome3, slabSpotsWorld, type WorldState } from "@bl/schema";
import { GpuSim3, configDiff } from "../src/gpu-sim3.ts";

const cfgOf = (over = {}) => defaultConfig({ tileW: 8, tileH: 8, tileD: 4, kernelRadius: 3, lightK: 1024, lightMode: "uniform", seed: 5, ...over });
const world = (over = {}): WorldState => slabSpotsWorld(cfgOf(over), generalistGenome3(154, 24), 2);

interface Mock {
  device: GPUDevice;
  buffers: { destroyed: boolean }[];
  scopes: { pushed: number; popped: number };
  writes: number;
}

function mockDevice(o: { shaderError?: boolean; scopeError?: boolean } = {}): Mock {
  const m: Mock = { device: null as unknown as GPUDevice, buffers: [], scopes: { pushed: 0, popped: 0 }, writes: 0 };
  let moduleCount = 0;
  const device = {
    createBuffer: () => {
      const b = { destroyed: false, destroy() { this.destroyed = true; } };
      m.buffers.push(b);
      return b;
    },
    createShaderModule: () => ({
      getCompilationInfo: async () => ({ messages: o.shaderError && ++moduleCount === 3 ? [{ type: "error", lineNum: 1, linePos: 1, message: "boom" }] : [] }),
    }),
    createComputePipelineAsync: async () => ({ getBindGroupLayout: () => ({}) }),
    createBindGroup: () => ({}),
    pushErrorScope: () => void m.scopes.pushed++,
    popErrorScope: async () => (m.scopes.popped++, o.scopeError ? { message: "late validation error" } : null),
    queue: { writeBuffer: () => void m.writes++ },
  };
  m.device = device as unknown as GPUDevice;
  return m;
}

describe("GpuSim3.create", () => {
  it("succeeds with the scope popped and no buffer destroyed", async () => {
    const m = mockDevice();
    const sim = await GpuSim3.create(m.device, world());
    expect(m.scopes).toEqual({ pushed: 1, popped: 1 });
    expect(m.buffers.length).toBeGreaterThan(0);
    expect(m.buffers.every((b) => !b.destroyed)).toBe(true);
    sim.destroy();
  });

  it("pops the error scope when a shader fails to compile", async () => {
    const m = mockDevice({ shaderError: true });
    await expect(GpuSim3.create(m.device, world())).rejects.toThrow(/boom/);
    expect(m.scopes).toEqual({ pushed: 1, popped: 1 });
  });

  it("destroys every buffer when validation fails after construction", async () => {
    const m = mockDevice({ scopeError: true });
    await expect(GpuSim3.create(m.device, world())).rejects.toThrow(/late validation error/);
    expect(m.scopes).toEqual({ pushed: 1, popped: 1 });
    expect(m.buffers.length).toBeGreaterThan(0);
    expect(m.buffers.every((b) => b.destroyed)).toBe(true);
  });
});

describe("GpuSim3.upload", () => {
  it("accepts a new state of the same config and rejects any other config before writing", async () => {
    const m = mockDevice();
    const sim = await GpuSim3.create(m.device, world());
    const writes = m.writes;
    sim.upload(cloneState(world())); // same config, different content is fine
    expect(m.writes).toBeGreaterThan(writes);
    const after = m.writes;
    for (const other of [world({ seed: 6 }), world({ lightK: 2048 }), world({ tileW: 16 })]) {
      expect(() => sim.upload(other)).toThrow(/config differs/);
    }
    expect(m.writes).toBe(after);
  });

  it("configDiff names the differing keys and treats absent and undefined alike", () => {
    expect(configDiff(cfgOf(), cfgOf({ seed: 6, lightK: 7 }))).toEqual(["lightK", "seed"]);
    expect(configDiff(cfgOf(), { ...cfgOf(), pondPeriod: undefined })).toEqual([]);
  });
});
