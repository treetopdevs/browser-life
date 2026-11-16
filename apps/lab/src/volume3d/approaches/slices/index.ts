// Slices, ported from the 3D volume sandbox: three orthogonal planes read straight from `vox` and `aux`. The contract's
// truth check and a cheap reference, not judged for beauty: if the packing is wrong, it shows here first. The horizontal
// plane sits on the top layer the peel leaves, so peeling walks it down from the surface one layer at a time.
import type { Approach, FrameInfo, ParamSpec, ParamValue, VolumeSource } from "../../contract.ts";
import { Disposer } from "../disposer.ts";
import { linearSampler, sampleBounds, visibleMax } from "../common.ts";

const WGSL = /* wgsl */ `
struct P { vp: mat4x4<f32>, planes: vec4<f32>, flags: vec4<f32>, ext: vec4<f32>, bg: vec4<f32>, vis: vec4<f32>, lo: vec4<f32>, hi: vec4<f32> };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var vox: texture_3d<f32>;
@group(0) @binding(2) var aux: texture_3d<f32>;
@group(0) @binding(3) var smp: sampler;

struct VOut { @builtin(position) pos: vec4<f32>, @location(0) f: vec3<f32>, @location(1) @interpolate(flat) pl: u32 };

// planes.xyz: plane positions as fractions of the box; f is the fragment's position as a fraction of the box.
@vertex
fn vsPlane(@builtin(vertex_index) vi: u32, @builtin(instance_index) plane: u32) -> VOut {
  var corners = array<vec2<f32>, 6>(vec2(0.0, 0.0), vec2(1.0, 0.0), vec2(1.0, 1.0), vec2(0.0, 0.0), vec2(1.0, 1.0), vec2(0.0, 1.0));
  let uv = corners[vi];
  let top = p.vis.y / p.ext.y;
  let south = p.vis.z / p.ext.z;
  var f = vec3<f32>(p.planes.x, uv.x * top, uv.y * south);
  if (plane == 1u) { f = vec3<f32>(uv.x, p.planes.y, uv.y * south); }
  if (plane == 2u) { f = vec3<f32>(uv.x, uv.y * top, min(p.planes.z, south)); }
  var o: VOut;
  o.f = f;
  o.pl = plane;
  o.pos = p.vp * vec4<f32>(f * p.ext.xyz, 1.0);
  if (((u32(p.flags.y) >> plane) & 1u) == 0u) { o.pos = vec4<f32>(2.0, 2.0, 2.0, 1.0); }
  return o;
}

@fragment
fn fsPlane(in: VOut) -> @location(0) vec4<f32> {
  // held between the centres of the retained texels (sampleBounds), so the peel and cut faces never blend in removed cells
  let q = clamp(in.f, p.lo.xyz, p.hi.xyz);
  let v = textureSampleLevel(vox, smp, q, 0.0);
  let a = textureSampleLevel(aux, smp, q, 0.0);
  var col = vec3<f32>(0.0);
  let mode = u32(p.flags.x);
  if (mode == 0u) {
    let lit = 0.22 + 0.78 * a.g;
    let water = vec3<f32>(0.01, 0.045, 0.06) * (0.35 + 0.65 * a.g) + vec3<f32>(0.02, 0.07, 0.14) * a.r;
    col = mix(water, v.rgb * lit * 1.5, v.a);
  } else if (mode == 1u) {
    col = vec3<f32>(a.g);
  } else if (mode == 2u) {
    col = vec3<f32>(0.1, 0.4, 0.95) * a.r;
  } else {
    col = vec3<f32>(v.a);
  }
  let haze = clamp((in.pos.z - 0.5) * 2.0, 0.0, 1.0) * 0.18;
  col = mix(col, p.bg.rgb, haze);
  return vec4<f32>(pow(clamp(col, vec3<f32>(0.0), vec3<f32>(1.0)), vec3<f32>(1.0 / 2.2)), 1.0);
}

@vertex
fn vsEdge(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4<f32> {
  let e = vi / 2u;
  let k = vi % 2u;
  let a = e / 4u;
  let c = e % 4u;
  var q = vec3<f32>(0.0);
  q[(a + 1u) % 3u] = f32(c & 1u);
  q[(a + 2u) % 3u] = f32((c >> 1u) & 1u);
  q[a] = f32(k);
  return p.vp * vec4<f32>(q * p.ext.xyz, 1.0);
}

@fragment
fn fsEdge() -> @location(0) vec4<f32> { return vec4<f32>(0.55, 0.62, 0.65, 1.0); }
`;

const PARAMS: ParamSpec[] = [
  { key: "view", kind: "select", label: "Show", hint: "What the planes display. Colour is the packed picture; the others show one channel so you can check it: the light estimate, the nutrient, or density alone.", value: "colour", options: [{ value: "colour", label: "Colour" }, { value: "light", label: "Light" }, { value: "nutrient", label: "Nutrient" }, { value: "density", label: "Density" }] },
  { key: "showX", kind: "toggle", label: "Plane across east-west", hint: "Show or hide the upright plane that cuts the slab left to right, showing every layer along one column line.", value: true },
  { key: "showY", kind: "toggle", label: "Horizontal plane", hint: "Show or hide the flat plane. It sits on the top layer left by the peel, so peel to walk it down.", value: true },
  { key: "showZ", kind: "toggle", label: "Plane across north-south", hint: "Show or hide the upright plane that cuts the slab front to back. It follows the cut-away when that is on.", value: true },
  { key: "posX", kind: "range", label: "East-west plane position", hint: "Where the east-west plane sits, from the west edge (0) to the east edge (1).", min: 0, max: 1, step: 0.01, value: 0.5 },
  { key: "posZ", kind: "range", label: "North-south plane position", hint: "Where the north-south plane sits, from the north edge (0) to the south edge (1).", min: 0, max: 1, step: 0.01, value: 1 },
];
const MODES = ["colour", "light", "nutrient", "density"];

export function create(): Approach {
  const d = new Disposer();
  const dDepth = new Disposer();
  let device: GPUDevice | null = null;
  let ctx: GPUCanvasContext | null = null;
  let planePipe: GPURenderPipeline;
  let edgePipe: GPURenderPipeline;
  let group: GPUBindGroup;
  let ubo: GPUBuffer;
  let depth: GPUTexture | null = null;
  const values: Record<string, ParamValue> = Object.fromEntries(PARAMS.map((p) => [p.key, p.value]));

  function ensureDepth(w: number, h: number) {
    if (!device || (depth && depth.width === w && depth.height === h)) return;
    dDepth.disposeAll();
    depth = dDepth.add(device.createTexture({ label: "volume3d-slices-depth", size: [w, h], format: "depth24plus", usage: GPUTextureUsage.RENDER_ATTACHMENT }));
  }

  return {
    id: "slices",
    label: "Slices",
    blurb: "Three flat cuts through the slab, drawn exactly as packed. Not pretty on purpose: it is the check that the other looks show the right cells in the right layers.",
    params: PARAMS,
    async mount(canvas: HTMLCanvasElement, src: VolumeSource) {
      device = src.device;
      const format = navigator.gpu.getPreferredCanvasFormat();
      ctx = canvas.getContext("webgpu") as GPUCanvasContext;
      ctx.configure({ device, format, alphaMode: "opaque" });
      const module = device.createShaderModule({ label: "volume3d-slices", code: WGSL });
      const depthState: GPUDepthStencilState = { format: "depth24plus", depthWriteEnabled: true, depthCompare: "less" };
      const bgl = device.createBindGroupLayout({
        entries: [
          { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
          { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { viewDimension: "3d" } },
          { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { viewDimension: "3d" } },
          { binding: 3, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
        ],
      });
      const layout = device.createPipelineLayout({ bindGroupLayouts: [bgl] });
      planePipe = device.createRenderPipeline({
        label: "volume3d-slices", layout,
        vertex: { module, entryPoint: "vsPlane" },
        fragment: { module, entryPoint: "fsPlane", targets: [{ format }] },
        primitive: { cullMode: "none" },
        depthStencil: depthState,
      });
      edgePipe = device.createRenderPipeline({
        label: "volume3d-slices-edge", layout,
        vertex: { module, entryPoint: "vsEdge" },
        fragment: { module, entryPoint: "fsEdge", targets: [{ format }] },
        primitive: { topology: "line-list" },
        depthStencil: { ...depthState, depthWriteEnabled: false, depthCompare: "less-equal" },
      });
      ubo = d.add(device.createBuffer({ label: "volume3d-slices-u", size: 44 * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }));
      group = device.createBindGroup({
        layout: bgl,
        entries: [{ binding: 0, resource: { buffer: ubo } }, { binding: 1, resource: src.voxView }, { binding: 2, resource: src.auxView }, { binding: 3, resource: linearSampler(device) }],
      });
    },
    render(f: FrameInfo) {
      if (!device || !ctx) return;
      const tex = ctx.getCurrentTexture();
      ensureDepth(tex.width, tex.height);
      const vis = visibleMax(f);
      const keep = Math.round((vis[1] / f.ext[1]) * f.dims.D);
      const data = new Float32Array(44);
      data.set(f.camera.viewProj, 0);
      const mask = (values.showX ? 1 : 0) | (values.showY ? 2 : 0) | (values.showZ ? 4 : 0);
      data.set([values.posX as number, (keep - 0.5) / f.dims.D, values.posZ as number, 0], 16);
      data.set([Math.max(0, MODES.indexOf(values.view as string)), mask, 0, 0], 20);
      data.set([...f.ext, 0], 24);
      data.set([...f.background, 1], 28);
      data.set([...vis, 0], 32);
      const { lo, hi } = sampleBounds(f);
      data.set([...lo, 0], 36);
      data.set([...hi, 0], 40);
      device.queue.writeBuffer(ubo, 0, data);
      const enc = device.createCommandEncoder({ label: "volume3d-slices" });
      const [r, g, b] = f.background;
      const pass = enc.beginRenderPass({
        colorAttachments: [{ view: tex.createView(), loadOp: "clear", storeOp: "store", clearValue: { r, g, b, a: 1 } }],
        depthStencilAttachment: { view: depth!.createView(), depthClearValue: 1, depthLoadOp: "clear", depthStoreOp: "store" },
      });
      pass.setBindGroup(0, group);
      pass.setPipeline(planePipe);
      pass.draw(6, 3);
      pass.setPipeline(edgePipe);
      pass.draw(24);
      pass.end();
      device.queue.submit([enc.finish()]);
    },
    setParam(key, value) {
      values[key] = value;
    },
    unmount() {
      ctx?.unconfigure();
      ctx = null;
      dDepth.disposeAll();
      depth = null;
      d.disposeAll();
      device = null;
    },
  };
}
