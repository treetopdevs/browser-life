// The volume view's renderer switching, with stand-in renderers whose mounts resolve when the test says, a fake GPU device
// and a hand-driven animation-frame queue: the sequence a real browser hits only by timing, here made exact.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Approach } from "../src/volume3d/contract.ts";
import type { ApproachEntry } from "../src/volume3d/approaches/registry.ts";
import { VolumeView } from "../src/volume3d/view.ts";
import type { EcoFrame } from "../src/slab/render.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const g = globalThis as Any;
let rafQueue: Map<number, (t: number) => void>;
let rafId = 0;
const saved: Record<string, unknown> = {};

beforeEach(() => {
  rafQueue = new Map();
  for (const k of ["requestAnimationFrame", "cancelAnimationFrame", "ResizeObserver", "GPUTextureUsage", "GPUBufferUsage", "window"]) saved[k] = g[k];
  g.requestAnimationFrame = (cb: (t: number) => void) => { rafQueue.set(++rafId, cb); return rafId; };
  g.cancelAnimationFrame = (id: number) => { rafQueue.delete(id); };
  g.ResizeObserver = class { observe() {} };
  g.GPUTextureUsage = { TEXTURE_BINDING: 4, COPY_DST: 2 };
  g.GPUBufferUsage = { STORAGE: 128, COPY_DST: 8 };
  g.window = { devicePixelRatio: 1 };
});
afterEach(() => { for (const [k, v] of Object.entries(saved)) g[k] = v; });

const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
async function runFrames(t = 16) {
  const cbs = [...rafQueue.values()];
  rafQueue.clear();
  for (const cb of cbs) cb(t);
  await flush();
}

function fakeDevice() {
  const texture = () => ({ createView: () => ({}), destroy() {} });
  return {
    createTexture: texture, createBuffer: () => ({ destroy() {} }), addEventListener() {},
    queue: { writeTexture() {}, writeBuffer() {} },
  } as Any as GPUDevice;
}
function fakeCanvas() {
  return { clientWidth: 320, clientHeight: 200, width: 0, height: 0, style: {}, addEventListener() {}, setPointerCapture() {} } as Any as HTMLCanvasElement;
}

interface Stub { entry: ApproachEntry; mounts: (() => void)[]; renders: number; unmounts: number }
function stub(id: ApproachEntry["id"]): Stub {
  const s: Stub = { entry: null as Any, mounts: [], renders: 0, unmounts: 0 };
  s.entry = {
    id, title: id, text: id,
    load: async () => ({
      id, label: id, blurb: id, params: [],
      mount: () => new Promise<void>((r) => s.mounts.push(r)),
      render: () => { s.renders++; },
      setParam() {},
      unmount: () => { s.unmounts++; },
    } as Approach),
  };
  return s;
}

function ecoFrame(): EcoFrame {
  const n = 4 * 4 * 2;
  const hi = new Uint32Array(n).fill(1), B = new Uint32Array(n).fill(20);
  return { kind: "eco", step: 0, dims: { W: 4, H: 4, D: 2 }, B, P: new Uint32Array(n), A: new Uint32Array(n), hi, lo: new Uint32Array(n) };
}

describe("VolumeView renderer switching", () => {
  it("choosing B while A is mounting ends with B mounted and painted, A unmounted, even when A's mount finishes before B's frame", async () => {
    const a = stub("raymarch"), b = stub("points");
    const v = new VolumeView(fakeCanvas(), () => {}, [a.entry, b.entry]);
    v.attach(fakeDevice());
    v.upload(ecoFrame(), {});
    v.setActive(true);
    await runFrames(); // A's mount starts
    expect(a.mounts.length).toBe(1);
    v.setRenderer("points"); // B chosen while A mounts; B's frame is queued, not yet run
    a.mounts[0]!(); // A's mount completes first
    await flush();
    expect(a.renders).toBe(0); // A never paints over the choice of B
    await runFrames(); // B's queued frame
    expect(b.mounts.length).toBe(1);
    b.mounts[0]!();
    await flush();
    await runFrames();
    expect([v.renderer, v.mountedRenderer, v.lastPainted]).toEqual(["points", "points", "points"]);
    expect(b.renders).toBeGreaterThan(0);
    expect(a.unmounts).toBeGreaterThanOrEqual(1);
  });

  it("a burst of choices mounts and paints only the last one", async () => {
    const r = stub("raymarch"), p = stub("points"), s = stub("slices");
    const v = new VolumeView(fakeCanvas(), () => {}, [r.entry, p.entry, s.entry]);
    v.attach(fakeDevice());
    v.upload(ecoFrame(), {});
    v.setActive(true);
    await runFrames();
    for (const id of ["points", "slices", "raymarch", "points", "slices"] as const) {
      v.setRenderer(id);
      for (const st of [r, p, s]) while (st.mounts.length) st.mounts.shift()!();
      await flush();
      await runFrames();
    }
    for (let i = 0; i < 5; i++) { for (const st of [r, p, s]) while (st.mounts.length) st.mounts.shift()!(); await flush(); await runFrames(); }
    expect([v.renderer, v.mountedRenderer, v.lastPainted]).toEqual(["slices", "slices", "slices"]);
  });

  it("going back to an already-mounted renderer while another is mounting keeps drawing (A mounted, B pending, A again)", async () => {
    const a = stub("raymarch"), b = stub("points");
    const v = new VolumeView(fakeCanvas(), () => {}, [a.entry, b.entry]);
    v.attach(fakeDevice());
    v.upload(ecoFrame(), {});
    v.setActive(true);
    await runFrames();
    a.mounts.shift()!(); // A mounted
    await flush();
    await runFrames();
    const before = a.renders;
    expect(before).toBeGreaterThan(0);
    v.setRenderer("points"); // B starts mounting, A is unmounted
    await runFrames();
    expect(b.mounts.length).toBe(1);
    v.setRenderer("raymarch"); // back to A before B finishes
    b.mounts.shift()!(); // B's mount completes and is discarded
    for (let i = 0; i < 5; i++) { while (a.mounts.length) a.mounts.shift()!(); await flush(); await runFrames(); }
    expect([v.renderer, v.mountedRenderer]).toEqual(["raymarch", "raymarch"]);
    v.upload(ecoFrame(), {}); // a new frame must still be drawn
    for (let i = 0; i < 3; i++) { while (a.mounts.length) a.mounts.shift()!(); await flush(); await runFrames(); }
    expect(a.renders).toBeGreaterThan(before);
    expect(v.lastPainted).toBe("raymarch");
  });
});
