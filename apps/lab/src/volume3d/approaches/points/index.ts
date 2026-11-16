// Points, ported from the 3D volume sandbox: one lit bead per living voxel, so single cells stay crisp. The sandbox's
// compute compaction is replaced by the CPU packer's live-voxel list (the frame is on the CPU anyway), drawn instanced; the
// peel, the cut and the density threshold hide beads in the vertex shader. Nothing blends or sorts.
import type { Approach, FrameInfo, ParamSpec, ParamValue, VolumeSource } from "../../contract.ts";
import { Disposer } from "../disposer.ts";
import { visibleMax } from "../common.ts";
import { SHADER } from "./shader.ts";

const SAMPLES = 4;
const DEPTH_FORMAT: GPUTextureFormat = "depth32float";

const PARAMS: ParamSpec[] = [
  {
    kind: "select", key: "mode", label: "Look", value: "spheres",
    hint: "Spheres: a soft lit bead per cell. Cubes: the blocky control, shows the raw grid of cells.",
    options: [{ value: "spheres", label: "Soft spheres" }, { value: "cubes", label: "Cubes" }],
  },
  { kind: "range", key: "size", label: "Bead size", min: 0.5, max: 1.6, step: 0.05, value: 1.1, hint: "Bigger beads fill the gaps and look like solid tissue; smaller ones keep single cells visible." },
  { kind: "range", key: "threshold", label: "Show from density", min: 0, max: 0.9, step: 0.05, value: 0, hint: "Cells with less body than this are hidden. Raise it to keep only the densest cells." },
  { kind: "range", key: "jitter", label: "Scatter", min: 0, max: 1, step: 0.05, value: 0.3, hint: "How far each bead strays from its grid cell. It hides the lattice and gives a faint drift; 0 keeps the grid exact." },
  { kind: "range", key: "halo", label: "Glow", min: 0, max: 1, step: 0.05, value: 0.4, hint: "A faint halo around each bead, like light caught in water. Costs drawing time on phones." },
  { kind: "range", key: "fog", label: "Depth haze", min: 0, max: 1, step: 0.05, value: 0.4, hint: "Fades the far side of the slab into the background so near and far read apart." },
  { kind: "toggle", key: "outline", label: "Box outline", value: true, hint: "A thin frame of the world's box, as a depth reference while you turn the view." },
];

export function create(): Approach {
  const d = new Disposer();
  const sized = new Disposer();
  const p = { mode: "spheres", size: 1.1, threshold: 0, jitter: 0.3, halo: 0.4, fog: 0.4, outline: true };
  let device: GPUDevice | null = null;
  let ctx: GPUCanvasContext | null = null;
  let src: VolumeSource | null = null;
  let format: GPUTextureFormat = "bgra8unorm";
  let uni: GPUBuffer | null = null;
  let group: GPUBindGroup | null = null;
  let pSprite: GPURenderPipeline, pHalo: GPURenderPipeline, pCube: GPURenderPipeline, pLine: GPURenderPipeline;
  let msaaView: GPUTextureView | null = null;
  let depthView: GPUTextureView | null = null;
  let tw = 0, th = 0;
  let time = 0;
  const ub = new Float32Array(64);

  function ensureTargets() {
    if (!device || !ctx) return;
    const tex = ctx.getCurrentTexture();
    if (msaaView && tex.width === tw && tex.height === th) return;
    sized.disposeAll();
    tw = tex.width; th = tex.height;
    const usage = GPUTextureUsage.RENDER_ATTACHMENT;
    msaaView = sized.add(device.createTexture({ label: "volume3d-points-msaa", size: [tw, th], format, sampleCount: SAMPLES, usage })).createView();
    depthView = sized.add(device.createTexture({ label: "volume3d-points-depth", size: [tw, th], format: DEPTH_FORMAT, sampleCount: SAMPLES, usage })).createView();
  }

  return {
    id: "points",
    label: "Points",
    blurb: "One lit bead per living cell, so single cells stay crisp. Beads are lit from above and darken in the shade of the canopy, tinted by lineage. It cannot show cloudy depth the way the ray march does.",
    params: PARAMS,

    async mount(canvas: HTMLCanvasElement, source: VolumeSource) {
      src = source;
      device = source.device;
      format = navigator.gpu.getPreferredCanvasFormat();
      ctx = canvas.getContext("webgpu") as GPUCanvasContext;
      ctx.configure({ device, format, alphaMode: "opaque" });
      uni = d.add(device.createBuffer({ label: "volume3d-points-u", size: ub.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }));
      const vis = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT;
      const bgl = device.createBindGroupLayout({
        entries: [
          { binding: 0, visibility: vis, buffer: { type: "uniform" } },
          { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: "read-only-storage" } },
          { binding: 2, visibility: GPUShaderStage.VERTEX, texture: { sampleType: "float", viewDimension: "3d" } },
          { binding: 3, visibility: GPUShaderStage.VERTEX, texture: { sampleType: "float", viewDimension: "3d" } },
        ],
      });
      const layout = device.createPipelineLayout({ bindGroupLayouts: [bgl] });
      const module = device.createShaderModule({ label: "volume3d-points", code: SHADER });
      const info = await module.getCompilationInfo();
      const errs = info.messages.filter((m) => m.type === "error");
      if (errs.length) throw new Error("points shader: " + errs.map((m) => `${m.lineNum}: ${m.message}`).join("; "));
      const multisample = { count: SAMPLES };
      const depth = (write: boolean): GPUDepthStencilState => ({ format: DEPTH_FORMAT, depthWriteEnabled: write, depthCompare: "less-equal" });
      const over: GPUBlendState = {
        color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha", operation: "add" },
        alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
      };
      pSprite = device.createRenderPipeline({
        label: "volume3d-points-sprite", layout,
        vertex: { module, entryPoint: "vsSprite", constants: { QS: 1 } },
        fragment: { module, entryPoint: "fsSprite", targets: [{ format }] },
        primitive: { topology: "triangle-list", cullMode: "none" },
        depthStencil: depth(true),
        multisample: { count: SAMPLES, alphaToCoverageEnabled: true },
      });
      pHalo = device.createRenderPipeline({
        label: "volume3d-points-halo", layout,
        vertex: { module, entryPoint: "vsSprite", constants: { QS: 2.6 } },
        fragment: { module, entryPoint: "fsHalo", targets: [{ format, blend: over }] },
        primitive: { topology: "triangle-list", cullMode: "none" },
        depthStencil: depth(false), multisample,
      });
      pCube = device.createRenderPipeline({
        label: "volume3d-points-cube", layout,
        vertex: { module, entryPoint: "vsCube" },
        fragment: { module, entryPoint: "fsCube", targets: [{ format }] },
        primitive: { topology: "triangle-list", cullMode: "none" },
        depthStencil: depth(true), multisample,
      });
      pLine = device.createRenderPipeline({
        label: "volume3d-points-line", layout,
        vertex: { module, entryPoint: "vsLine" },
        fragment: { module, entryPoint: "fsLine", targets: [{ format, blend: over }] },
        primitive: { topology: "line-list" },
        depthStencil: depth(false), multisample,
      });
      group = device.createBindGroup({
        layout: bgl,
        entries: [
          { binding: 0, resource: { buffer: uni } }, { binding: 1, resource: { buffer: source.live } },
          { binding: 2, resource: source.voxView }, { binding: 3, resource: source.auxView },
        ],
      });
    },

    render(f: FrameInfo) {
      if (!device || !ctx || !uni || !group || !src) return;
      ensureTargets();
      if (!msaaView || !depthView) return;
      time += f.dt;
      const cam = f.camera;
      const v = cam.view;
      const { W, H, D } = f.dims;
      ub.set(cam.viewProj, 0);
      ub.set([v[0]!, v[4]!, v[8]!, 0], 16);
      ub.set([v[1]!, v[5]!, v[9]!, 0], 20);
      ub.set([v[2]!, v[6]!, v[10]!, 0], 24);
      ub.set([...cam.eye, 0], 28);
      ub.set([...f.background, 1], 32);
      ub.set([...f.sunDir, 0], 36);
      const dist = Math.hypot(cam.eye[0] - f.ext[0] / 2, cam.eye[1] - f.ext[1] / 2, cam.eye[2] - f.ext[2] / 2);
      ub.set([time, p.size, p.fog, p.halo], 40);
      ub.set([p.mode === "cubes" ? 0 : p.jitter, p.threshold, dist, 0], 44);
      ub.set([...f.ext, 0], 48);
      ub.set([W, D, H, 0], 52);
      ub.set([...visibleMax(f), 0], 56);
      device.queue.writeBuffer(uni, 0, ub);

      const cubes = p.mode === "cubes";
      const count = src.liveCount();
      const enc = device.createCommandEncoder({ label: "volume3d-points" });
      const [r, g, b] = f.background;
      const pass = enc.beginRenderPass({
        colorAttachments: [{ view: msaaView, resolveTarget: ctx.getCurrentTexture().createView(), loadOp: "clear", storeOp: "discard", clearValue: { r, g, b, a: 1 } }],
        depthStencilAttachment: { view: depthView, depthClearValue: 1, depthLoadOp: "clear", depthStoreOp: "discard" },
      });
      pass.setBindGroup(0, group);
      if (count > 0) {
        pass.setPipeline(cubes ? pCube : pSprite);
        pass.draw(cubes ? 36 : 6, count);
        if (!cubes && p.halo > 0.01) {
          pass.setPipeline(pHalo);
          pass.draw(6, count);
        }
      }
      if (p.outline) {
        pass.setPipeline(pLine);
        pass.draw(24);
      }
      pass.end();
      device.queue.submit([enc.finish()]);
    },

    setParam(key: string, value: ParamValue) {
      (p as unknown as Record<string, ParamValue>)[key] = value;
    },

    unmount() {
      ctx?.unconfigure();
      ctx = null;
      device = null;
      src = null;
      uni = null; group = null; msaaView = null; depthView = null;
      tw = th = 0;
      sized.disposeAll();
      d.disposeAll();
    },
  };
}
