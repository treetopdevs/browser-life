// The WebGPU painter: draws the world straight from GpuMycelium's own buffers, with no readback.
//
// One render pass per frame: a full-screen triangle whose fragment shader looks up the cell under each pixel in the
// field buffer (an integer lookup, no sampler, so cells stay crisp at any zoom), then one instanced quad per
// particle slot, read from the current particle buffer. Slots at or beyond the live count n (word 0 of `ctl`) are
// culled in the vertex shader, so the CPU never needs to know n. The buffers are bound read-only: this file cannot
// change the simulation.
import { WGSL_COLOUR, type ColourMode, MODES, LAYER } from './colour.ts';
import { scaleOf, type View } from './view.ts';
import type { GpuMycelium } from '../../../../tools/mycelium/gpu.ts';

const SHADER = /* wgsl */ `
struct U {
  cx: f32, cy: f32, scale: f32, psize: f32,
  cw: f32, ch: f32, ww: f32, wh: f32,
  mode: u32, layers: u32, cap: u32, ctln: u32,
  oA: u32, oC: u32, oP: u32, oX: u32,
  oY: u32, oGid: u32, oM: u32, oE: u32,
  oAge: u32, emax: f32, bmax: f32, pad: u32,
}
@group(0) @binding(0) var<storage, read> ctl: array<u32>;
@group(0) @binding(1) var<storage, read> fld: array<u32>;
@group(0) @binding(2) var<storage, read> pc: array<u32>;
@group(0) @binding(3) var<uniform> u: U;
${WGSL_COLOUR}
@vertex
fn vs_field(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4<f32> {
  let p = vec2<f32>(f32((vi << 1u) & 2u), f32(vi & 2u));
  return vec4<f32>(p * 2.0 - 1.0, 0.0, 1.0);
}
@fragment
fn fs_field(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
  let wp = (pos.xy - vec2<f32>(u.cw, u.ch) * 0.5) / u.scale + vec2<f32>(u.cx, u.cy);
  if (wp.x < 0.0 || wp.y < 0.0 || wp.x >= u.ww || wp.y >= u.wh) { return vec4<f32>(0.016, 0.035, 0.047, 1.0); }
  let k = u32(wp.y) * u32(u.ww) + u32(wp.x);
  return vec4<f32>(field_rgb(fld[u.oA + k], fld[u.oC + k], fld[u.oP + k], u.layers), 1.0);
}
struct PV { @builtin(position) pos: vec4<f32>, @location(0) col: vec3<f32>, @location(1) local: vec2<f32> }
@vertex
fn vs_part(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> PV {
  var o: PV;
  o.col = vec3<f32>(0.0);
  o.local = vec2<f32>(0.0);
  if (ii >= ctl[u.ctln]) { o.pos = vec4<f32>(2.0, 2.0, 0.0, 1.0); return o; }
  let corner = vec2<f32>(f32(vi & 1u), f32(vi >> 1u)) - vec2<f32>(0.5);
  let w = vec2<f32>(f32(pc[u.oX + ii]), f32(pc[u.oY + ii])) / 256.0;
  let s = (w - vec2<f32>(u.cx, u.cy)) * u.scale + vec2<f32>(u.cw, u.ch) * 0.5 + corner * u.psize;
  o.pos = vec4<f32>(s.x / u.cw * 2.0 - 1.0, 1.0 - s.y / u.ch * 2.0, 0.0, 1.0);
  o.local = corner;
  if (u.mode == 0u) { o.col = family_rgb(pc[u.oGid + ii]); }
  else if (u.mode == 1u) { o.col = ramp_rgb(min(1.0, sqrt(f32(pc[u.oE + ii]) / u.emax))); }
  else if (u.mode == 2u) { o.col = ramp_rgb(min(1.0, log2(1.0 + f32(pc[u.oAge + ii])) / AGE_OCTAVES)); }
  else { o.col = ramp_rgb(min(1.0, f32(pc[u.oM + ii]) / u.bmax)); }
  return o;
}
@fragment
fn fs_part(v: PV) -> @location(0) vec4<f32> {
  if (u.psize > 6.0 && length(v.local) > 0.5) { discard; }
  return vec4<f32>(v.col, 1.0);
}
`;

const UNIFORM_WORDS = 24;

export class GpuRenderer {
  private readonly ctx: GPUCanvasContext;
  private readonly format: GPUTextureFormat;
  private readonly fieldPipe: GPURenderPipeline;
  private readonly partPipe: GPURenderPipeline;
  private readonly bgl: GPUBindGroupLayout;
  private readonly ubuf: GPUBuffer;
  private readonly words = new ArrayBuffer(UNIFORM_WORDS * 4);
  private readonly f32 = new Float32Array(this.words);
  private readonly u32 = new Uint32Array(this.words);
  private bgs: [GPUBindGroup, GPUBindGroup] | null = null;
  private bound: GpuMycelium | null = null;

  private constructor(readonly device: GPUDevice, readonly canvas: HTMLCanvasElement, ctx: GPUCanvasContext) {
    this.ctx = ctx;
    this.format = navigator.gpu.getPreferredCanvasFormat();
    ctx.configure({ device, format: this.format, alphaMode: 'opaque' });
    this.ubuf = device.createBuffer({ size: UNIFORM_WORDS * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const vf = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT;
    this.bgl = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: vf, buffer: { type: 'read-only-storage' } },
        { binding: 1, visibility: vf, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: vf, buffer: { type: 'read-only-storage' } },
        { binding: 3, visibility: vf, buffer: { type: 'uniform' } },
      ],
    });
    const layout = device.createPipelineLayout({ bindGroupLayouts: [this.bgl] });
    const module = device.createShaderModule({ code: SHADER });
    const target = { format: this.format };
    this.fieldPipe = device.createRenderPipeline({
      layout, vertex: { module, entryPoint: 'vs_field' }, fragment: { module, entryPoint: 'fs_field', targets: [target] }, primitive: { topology: 'triangle-list' },
    });
    this.partPipe = device.createRenderPipeline({
      layout, vertex: { module, entryPoint: 'vs_part' }, fragment: { module, entryPoint: 'fs_part', targets: [target] }, primitive: { topology: 'triangle-strip' },
    });
  }

  /** Builds the painter for a canvas that has not been given another context type. Throws if shaders or pipelines are invalid. */
  static async create(device: GPUDevice, canvas: HTMLCanvasElement): Promise<GpuRenderer> {
    const ctx = canvas.getContext('webgpu');
    if (!ctx) throw new Error('this canvas has no WebGPU context');
    device.pushErrorScope('validation');
    const r = new GpuRenderer(device, canvas, ctx);
    const err = await device.popErrorScope();
    if (err) throw new Error(`mycelium renderer: ${err.message}`);
    return r;
  }

  /** Point the painter at a simulation's buffers (one bind group per particle ping-pong side). */
  bind(sim: GpuMycelium): void {
    const v = sim.view;
    const mk = (side: 0 | 1) => this.device.createBindGroup({
      layout: this.bgl,
      entries: [
        { binding: 0, resource: { buffer: v.ctl } }, { binding: 1, resource: { buffer: v.fld } },
        { binding: 2, resource: { buffer: v.parts[side] } }, { binding: 3, resource: { buffer: this.ubuf } },
      ],
    });
    this.bgs = [mk(0), mk(1)];
    this.bound = sim;
  }

  /** Release the uniform buffer and the canvas's WebGPU configuration. The painter draws nothing afterwards. The simulation's buffers are not ours to free. */
  destroy(): void {
    this.bgs = null; this.bound = null;
    this.ubuf.destroy();
    try { this.ctx.unconfigure(); } catch { /* the canvas is going away */ }
  }

  /** Match the drawing buffer to the canvas's CSS size, in device pixels. Returns true when it changed. */
  resize(cssSize: number, dpr: number): boolean {
    const px = Math.max(1, Math.min(4096, Math.round(cssSize * dpr)));
    if (this.canvas.width === px && this.canvas.height === px) return false;
    this.canvas.width = px; this.canvas.height = px;
    return true;
  }

  draw(v: View, mode: ColourMode, layers: number, cssSize: number, dpr: number): void {
    const sim = this.bound;
    if (!sim || !this.bgs) return;
    const sv = sim.view;
    const world = sim.config.width;
    const sc = scaleOf(v, world, cssSize) * dpr;
    const f = this.f32, u = this.u32;
    f[0] = v.cx; f[1] = v.cy; f[2] = sc; f[3] = Math.max(3 * dpr, 0.5 * sc);
    f[4] = this.canvas.width; f[5] = this.canvas.height; f[6] = sim.config.width; f[7] = sim.config.height;
    u[8] = MODES.indexOf(mode); u[9] = layers; u[10] = sv.cap; u[11] = sv.ctlN;
    u[12] = sv.field.A; u[13] = sv.field.C; u[14] = sv.field.P; u[15] = sv.planes.x;
    u[16] = sv.planes.y; u[17] = sv.planes.gid; u[18] = sv.planes.M; u[19] = sv.planes.E;
    u[20] = sv.planes.age; f[21] = sim.config.energyMax; f[22] = sim.config.bodyMax; u[23] = 0;
    this.device.queue.writeBuffer(this.ubuf, 0, this.words);
    const enc = this.device.createCommandEncoder();
    const pass = enc.beginRenderPass({
      colorAttachments: [{ view: this.ctx.getCurrentTexture().createView(), clearValue: { r: 0.016, g: 0.035, b: 0.047, a: 1 }, loadOp: 'clear', storeOp: 'store' }],
    });
    pass.setBindGroup(0, this.bgs[sv.cur]);
    pass.setPipeline(this.fieldPipe);
    pass.draw(3);
    if (layers & LAYER.particles) {
      pass.setPipeline(this.partPipe);
      pass.draw(4, sv.cap);
    }
    pass.end();
    this.device.queue.submit([enc.finish()]);
  }
}
