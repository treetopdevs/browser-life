// Ray march, ported from the 3D volume sandbox: one full-screen pass walks a ray through the whole box, front to back,
// adding up colour and light. Reads only the contract's vox and aux textures. The sandbox's 8^3 brick skipping is left
// out: one brick would span all eight layers of a slab, and the top layers of a canopy are full, so it would skip nothing.
import type { Approach, FrameInfo, ParamSpec, ParamValue, VolumeSource } from "../../contract.ts";
import { Disposer } from "../disposer.ts";
import { clipped, linearSampler, visibleMax } from "../common.ts";
import { WGSL } from "./shader.ts";

const PARAMS: ParamSpec[] = [
  { key: "thickness", kind: "range", label: "Body thickness", hint: "How solid living bodies look. Low is a glowing, see-through cloud where the lower layers show through; high is opaque bodies that hide what is under them.", min: 4, max: 160, step: 1, value: 28 },
  { key: "surface", kind: "range", label: "Surface look", hint: "0 is a soft glowing cloud. Higher adds lit and shaded sides to bodies so they read as shapes.", min: 0, max: 1, step: 0.01, value: 0.6 },
  { key: "haze", kind: "range", label: "Water and nutrient haze", hint: "The cool fog of the water and the nutrient in it. More shows where food is and gives a sense of depth; less is crisper.", min: 0, max: 1, step: 0.01, value: 0.3 },
  { key: "detail", kind: "range", label: "Detail", hint: "Samples per voxel along each ray. Higher is smoother but slower; 1 is about one sample per voxel.", min: 0.5, max: 2, step: 0.05, value: 1 },
  { key: "glass", kind: "toggle", label: "Glass edge", hint: "Draws a faint bright edge where the box's walls are, so the world reads as a container.", value: true },
];

export function create(): Approach {
  const d = new Disposer();
  let device: GPUDevice | null = null;
  let ctx: GPUCanvasContext | null = null;
  let pipe: GPURenderPipeline;
  let group: GPUBindGroup;
  let ubo: GPUBuffer;
  let frameNo = 0;
  const data = new Float32Array(48);
  const values: Record<string, ParamValue> = Object.fromEntries(PARAMS.map((p) => [p.key, p.value]));

  return {
    id: "raymarch",
    label: "Ray march",
    blurb: "Marches a ray through the whole slab and adds up light and colour, so life looks like a glowing layer with real depth: bodies under the canopy are dimmer, light falls from above, and shaded sides give them shape.",
    params: PARAMS,
    async mount(canvas: HTMLCanvasElement, src: VolumeSource) {
      device = src.device;
      const format = navigator.gpu.getPreferredCanvasFormat();
      ctx = canvas.getContext("webgpu") as GPUCanvasContext;
      ctx.configure({ device, format, alphaMode: "opaque" });
      const module = device.createShaderModule({ label: "volume3d-raymarch", code: WGSL });
      const bgl = device.createBindGroupLayout({
        entries: [
          { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
          { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { viewDimension: "3d" } },
          { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { viewDimension: "3d" } },
          { binding: 3, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
        ],
      });
      pipe = device.createRenderPipeline({
        label: "volume3d-raymarch",
        layout: device.createPipelineLayout({ bindGroupLayouts: [bgl] }),
        vertex: { module, entryPoint: "vs" },
        fragment: { module, entryPoint: "fs", targets: [{ format }] },
        primitive: { topology: "triangle-list" },
      });
      ubo = d.add(device.createBuffer({ label: "volume3d-raymarch-u", size: data.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }));
      group = device.createBindGroup({
        layout: bgl,
        entries: [{ binding: 0, resource: { buffer: ubo } }, { binding: 1, resource: src.voxView }, { binding: 2, resource: src.auxView }, { binding: 3, resource: linearSampler(device) }],
      });
    },
    render(f: FrameInfo) {
      if (!device || !ctx) return;
      const { W, H, D } = f.dims;
      data.set(f.camera.invViewProj, 0);
      data.set([...f.camera.eye, 0], 16);
      data.set([...f.sunDir, frameNo++], 20);
      data.set([...f.background, 1], 24);
      data.set([...f.ext, 0], 28);
      data.set([...visibleMax(f), clipped(f) ? 1 : 0], 32);
      data.set([W, D, H, 0], 36);
      data.set([values.thickness as number, values.detail as number, values.surface as number, values.haze as number], 40);
      data.set([values.glass ? 1 : 0, 0, 0, 0], 44);
      device.queue.writeBuffer(ubo, 0, data);
      const enc = device.createCommandEncoder({ label: "volume3d-raymarch" });
      const pass = enc.beginRenderPass({ colorAttachments: [{ view: ctx.getCurrentTexture().createView(), loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 1 } }] });
      pass.setPipeline(pipe);
      pass.setBindGroup(0, group);
      pass.draw(3);
      pass.end();
      device.queue.submit([enc.finish()]);
    },
    setParam(key, value) {
      values[key] = value;
    },
    unmount() {
      ctx?.unconfigure();
      ctx = null;
      d.disposeAll();
      device = null;
    },
  };
}
