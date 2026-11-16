// The particle-and-haze look for /mycelium3d/, a volume3d Approach (apps/lab/src/volume3d/contract.ts) of its own.
//
// Two passes per frame. First every particle is drawn at its true position as a lit sphere impostor (a billboard that
// writes sphere depth, so overlap needs no sorting) into an offscreen colour and depth target. Then one full-screen pass
// marches a ray through the box, front to back, through the haze in `aux` (trail in one colour, waste as a faint dark
// absorber, water lit by the light plane, so the light falls off from the surface down), and stops where the ray meets a
// particle's depth, which it composites behind the haze in front of it. Peel and cut clip both passes to visibleMax; the
// depth stretch arrives through `ext`; a `still` frame keeps one jitter pattern. Particle instances come from the page
// through a ParticleStore (packParticles in pack.ts), uploaded here when its version changes.
import type { Approach, FrameInfo, ParamSpec, ParamValue, VolumeSource } from '../volume3d/contract.ts';
import { Disposer } from '../volume3d/approaches/disposer.ts';
import { clipped, linearSampler, visibleMax } from '../volume3d/approaches/common.ts';
import { INSTANCE_FLOATS, type Instances } from './pack.ts';
import { PARTICLE_CAP } from './settings.ts';

/** The page writes the latest instances here and bumps `version`; the renderer uploads them on its next frame. */
export interface ParticleStore { inst: Instances | null; version: number }

const PARAMS: ParamSpec[] = [
  { key: 'size', kind: 'range', label: 'Particle size', hint: 'How big each particle is drawn, relative to its body matter. Bigger fills the jar with bodies; smaller shows single particles and the haze between them.', min: 0.4, max: 2.5, step: 0.05, value: 1 },
  { key: 'trail', kind: 'range', label: 'Trail haze', hint: 'How strongly laid trail shows as a violet haze. Trail is often thin or gone, so a stronger haze finds what little is left; 0 hides it.', min: 0, max: 1, step: 0.01, value: 0.6 },
  { key: 'waste', kind: 'toggle', label: 'Waste haze', hint: 'Waste as a faint dark haze. With sinking on it piles up on the floor, where light cannot turn it back into food. Off draws clear water instead.', value: true },
  { key: 'water', kind: 'range', label: 'Water and light', hint: 'The faint blue water, lit by the light that reaches each cell, so the brightness falls from the surface to the floor. Less is crisper.', min: 0, max: 1, step: 0.01, value: 0.35 },
  { key: 'detail', kind: 'range', label: 'Detail', hint: 'Samples per voxel along each ray. Higher is smoother but slower.', min: 0.5, max: 2, step: 0.05, value: 1 },
  { key: 'glass', kind: 'toggle', label: 'Glass edge', hint: 'A faint bright edge where the jar’s walls are, so the world reads as a container.', value: true },
];

const COMMON = /* wgsl */ `
struct U {
  viewProj: mat4x4<f32>,
  inv: mat4x4<f32>,
  right: vec4<f32>, up: vec4<f32>, back: vec4<f32>,
  eye: vec4<f32>,
  bg: vec4<f32>,
  ext: vec4<f32>,
  vis: vec4<f32>,  // visible box max (peel and cut), w = 1 when either is on
  tex: vec4<f32>,  // texels per axis (W, D, H)
  a: vec4<f32>,    // particle size, trail, water, detail
  b: vec4<f32>,    // waste on, frame (jitter), glass, 0
  sun: vec4<f32>,
};
@group(0) @binding(0) var<uniform> u: U;
const SUN = vec3<f32>(1.0, 0.92, 0.76);
`;

const PARTICLES = /* wgsl */ `${COMMON}
@group(0) @binding(1) var<storage, read> inst: array<f32>;

struct VOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) @interpolate(flat) col: vec3<f32>,
  @location(2) @interpolate(flat) light: f32,
  @location(3) @interpolate(flat) center: vec3<f32>,
  @location(4) @interpolate(flat) rad: f32,
};
var<private> quad: array<vec2<f32>, 6> = array<vec2<f32>, 6>(
  vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0), vec2<f32>(1.0, 1.0),
  vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, 1.0), vec2<f32>(-1.0, 1.0));

@vertex
fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  let o = ii * ${INSTANCE_FLOATS}u;
  let vsz = u.ext.xyz / u.tex.xyz;
  let c = vec3<f32>(inst[o], inst[o + 1u], inst[o + 2u]) * vsz;
  let rad = inst[o + 3u] * u.a.x * min(min(vsz.x, vsz.y), vsz.z);
  let q = quad[vi];
  var out: VOut;
  out.pos = u.viewProj * vec4<f32>(c + (u.right.xyz * q.x + u.up.xyz * q.y) * rad, 1.0);
  out.uv = q;
  out.col = vec3<f32>(inst[o + 4u], inst[o + 5u], inst[o + 6u]);
  out.light = inst[o + 7u];
  out.center = c;
  out.rad = rad;
  if (any(c > u.vis.xyz)) { out.pos = vec4<f32>(2.0, 2.0, 2.0, 1.0); }
  return out;
}

struct FOut { @location(0) color: vec4<f32>, @builtin(frag_depth) depth: f32 };

@fragment
fn fs(in: VOut) -> FOut {
  let r2 = dot(in.uv, in.uv);
  if (r2 > 1.0) { discard; }
  let n = normalize(u.right.xyz * in.uv.x + u.up.xyz * in.uv.y + u.back.xyz * sqrt(1.0 - r2));
  let p = in.center + n * in.rad;
  let sun = normalize(u.sun.xyz);
  let V = normalize(u.eye.xyz - p);
  let wrap = clamp((dot(n, sun) + 0.35) / 1.35, 0.0, 1.0);
  // Display curve: the floor of a default jar still gets about a third of the surface light, so squaring makes the fall-off read.
  let L = in.light * in.light;
  let hemi = mix(vec3<f32>(0.06, 0.06, 0.09), vec3<f32>(0.30, 0.36, 0.46), n.y * 0.5 + 0.5) * (0.35 + 0.65 * L);
  var c = in.col * (SUN * 1.25 * wrap * (0.18 + 0.82 * L) + hemi);
  c += vec3<f32>(1.0, 0.97, 0.9) * pow(max(dot(n, normalize(sun + V)), 0.0), 48.0) * 0.25 * (0.3 + 0.7 * L);
  c += in.col * pow(1.0 - max(dot(n, V), 0.0), 3.0) * (0.18 + 0.3 * L);
  let clip = u.viewProj * vec4<f32>(p, 1.0);
  var out: FOut;
  out.color = vec4<f32>(c, 1.0);
  out.depth = clip.z / clip.w;
  return out;
}
`;

const HAZE = /* wgsl */ `${COMMON}
@group(0) @binding(1) var aux: texture_3d<f32>;
@group(0) @binding(2) var smp: sampler;
@group(0) @binding(3) var pcol: texture_2d<f32>;
@group(0) @binding(4) var pdep: texture_depth_2d;

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4<f32> {
  var p = array<vec2<f32>, 3>(vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
  return vec4<f32>(p[vi], 0.0, 1.0);
}

const WATER = vec3<f32>(0.040, 0.150, 0.230);
const TRAIL = vec3<f32>(0.62, 0.36, 0.95);
const WASTE = vec3<f32>(0.090, 0.055, 0.025);

fn ign(p: vec2<f32>) -> f32 { return fract(52.9829189 * fract(dot(p, vec2<f32>(0.06711056, 0.00583715)))); }
fn world(x: f32, y: f32, z: f32) -> vec3<f32> { let h = u.inv * vec4<f32>(x, y, z, 1.0); return h.xyz / h.w; }
fn boxSpan(ro: vec3<f32>, rd: vec3<f32>, hi: vec3<f32>) -> vec2<f32> {
  let d = select(rd, vec3<f32>(1e-6), abs(rd) < vec3<f32>(1e-6));
  let t0 = (vec3<f32>(0.0) - ro) / d;
  let t1 = (hi - ro) / d;
  return vec2<f32>(max(max(min(t0.x, t1.x), min(t0.y, t1.y)), min(t0.z, t1.z)), min(min(max(t0.x, t1.x), max(t0.y, t1.y)), max(t0.z, t1.z)));
}
fn glassRim(p: vec3<f32>, rd: vec3<f32>) -> vec3<f32> {
  let q = (p - 0.5 * u.ext.xyz) / (0.5 * u.ext.xyz);
  let aq = abs(q);
  var n = vec3<f32>(0.0, 0.0, sign(q.z));
  if (aq.x >= aq.y && aq.x >= aq.z) { n = vec3<f32>(sign(q.x), 0.0, 0.0); } else if (aq.y >= aq.z) { n = vec3<f32>(0.0, sign(q.y), 0.0); }
  let f = pow(1.0 - clamp(abs(dot(n, rd)), 0.0, 1.0), 3.0);
  let spec = pow(max(dot(reflect(rd, n), normalize(vec3<f32>(0.35, 0.85, 0.25))), 0.0), 48.0);
  return vec3<f32>(0.55, 0.78, 0.92) * f * 0.28 + SUN * spec * 0.55;
}
fn finish(c: vec3<f32>) -> vec4<f32> {
  let o = vec3<f32>(1.0) - exp(-c * 1.25);
  return vec4<f32>(pow(clamp(o, vec3<f32>(0.0), vec3<f32>(1.0)), vec3<f32>(1.0 / 2.2)), 1.0);
}

@fragment
fn fs(@builtin(position) fp: vec4<f32>) -> @location(0) vec4<f32> {
  let size = vec2<f32>(textureDimensions(pcol));
  let px = vec2<i32>(fp.xy);
  let ndc = vec2<f32>(fp.x / size.x * 2.0 - 1.0, 1.0 - fp.y / size.y * 2.0);
  let ro = u.eye.xyz;
  let rd = normalize(world(ndc.x, ndc.y, 1.0) - world(ndc.x, ndc.y, 0.0));
  let bgCol = pow(u.bg.rgb, vec3<f32>(2.2)) * (0.85 + 0.3 * (1.0 - fp.y / size.y));
  let d = textureLoad(pdep, px, 0);
  let hit = d < 1.0;
  var tHit = 1e9;
  if (hit) { tHit = dot(world(ndc.x, ndc.y, d) - ro, rd); }
  let behind = select(bgCol, textureLoad(pcol, px, 0).rgb, hit);

  let full = boxSpan(ro, rd, u.ext.xyz);
  let s0 = boxSpan(ro, rd, u.vis.xyz);
  let span = vec2<f32>(max(s0.x, 0.0), min(s0.y, tHit));
  let glass = u.b.z > 0.5;
  if (span.y <= span.x) {
    var out = behind;
    if (!hit && glass && u.vis.w < 0.5 && full.y > max(full.x, 0.0)) { out += glassRim(ro + rd * full.x, rd) * 0.6; }
    return finish(out);
  }
  let vsz = u.ext.xyz / u.tex.xyz;
  let voxLen = min(min(vsz.x, vsz.y), vsz.z);
  let per64 = 1.0 / (64.0 * voxLen);
  let trailSig = 2.4 * u.a.y;
  let wasteSig = 1.6 * u.b.x;
  let waterAbs = 0.03 + 0.45 * u.a.z;
  let h = voxLen / u.a.w;
  let half = 0.5 / u.tex.xyz;
  let hiUV = u.vis.xyz / u.ext.xyz - half;
  var col = vec3<f32>(0.0);
  var T = 1.0;
  var t = span.x + ign(fp.xy + vec2<f32>(fract(u.b.y * 0.61803) * 64.0)) * h;
  var first = true;
  for (var it = 0; it < 2048; it++) {
    if (t >= span.y || T < 0.02) { break; }
    let seg = min(h, span.y - t);
    let L = seg * per64;
    let q = clamp((ro + rd * t) / u.ext.xyz, half, hiUV);
    let a = textureSampleLevel(aux, smp, q, 0.0);
    let lit = a.g;
    let sig = waterAbs + trailSig * a.r + wasteSig * a.b;
    // Water glows with the light that reaches it (bright under the surface, dim at the floor); waste is a dark brown sediment.
    let scat = WATER * waterAbs * (0.03 + 2.0 * lit * lit * lit) * 2.2 + TRAIL * trailSig * a.r * (0.30 + 0.70 * lit) * 0.9 + WASTE * wasteSig * a.b * (0.2 + 0.8 * lit);
    let tr = exp(-sig * L);
    col += T * scat * (1.0 - tr) / max(sig, 1e-4);
    T *= tr;
    t += seg;
    if (first) { t = span.x + seg; }
    first = false;
  }
  var out = col + T * behind;
  if (glass) {
    if (abs(span.x - full.x) < 1e-5 && full.x > 0.0) { out += glassRim(ro + rd * full.x, rd); }
    if (!hit && abs(s0.y - full.y) < 1e-5) { out += T * glassRim(ro + rd * full.y, rd) * 0.6; }
  }
  return finish(out);
}
`;

const COLOUR_FORMAT: GPUTextureFormat = 'rgba16float';
const DEPTH_FORMAT: GPUTextureFormat = 'depth32float';

export function createParticleHaze(store: ParticleStore): Approach {
  const d = new Disposer();
  const sized = new Disposer();
  let device: GPUDevice | null = null;
  let ctx: GPUCanvasContext | null = null;
  let src: VolumeSource | null = null;
  let pPart: GPURenderPipeline, pHaze: GPURenderPipeline;
  let hazeLayout: GPUBindGroupLayout;
  let partGroup: GPUBindGroup;
  let hazeGroup: GPUBindGroup | null = null;
  let ubo: GPUBuffer, instBuf: GPUBuffer;
  let colView: GPUTextureView | null = null, depView: GPUTextureView | null = null;
  let tw = 0, th = 0, frameNo = 0, uploaded = -1, count = 0;
  const data = new Float32Array(80);
  const values: Record<string, ParamValue> = Object.fromEntries(PARAMS.map((p) => [p.key, p.value]));

  function ensureTargets(w: number, h: number) {
    if (!device || !src || (colView && w === tw && h === th)) return;
    sized.disposeAll();
    tw = w; th = h;
    const usage = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING;
    colView = sized.add(device.createTexture({ label: 'mycelium3d-particles', size: [w, h], format: COLOUR_FORMAT, usage })).createView();
    depView = sized.add(device.createTexture({ label: 'mycelium3d-depth', size: [w, h], format: DEPTH_FORMAT, usage })).createView();
    hazeGroup = device.createBindGroup({
      layout: hazeLayout,
      entries: [{ binding: 0, resource: { buffer: ubo } }, { binding: 1, resource: src.auxView }, { binding: 2, resource: linearSampler(device) }, { binding: 3, resource: colView }, { binding: 4, resource: depView }],
    });
  }

  return {
    id: 'particles',
    label: 'Particles and haze',
    blurb: 'Every particle as a small lit bead at its true position, coloured by family, inside a ray-marched haze of trail (violet) and waste (dark), with the water lit by the light that reaches it.',
    params: PARAMS,
    async mount(canvas: HTMLCanvasElement, source: VolumeSource) {
      src = source;
      device = source.device;
      const format = navigator.gpu.getPreferredCanvasFormat();
      ctx = canvas.getContext('webgpu') as GPUCanvasContext;
      ctx.configure({ device, format, alphaMode: 'opaque' });
      const vis = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT;
      const partLayout = device.createBindGroupLayout({
        entries: [{ binding: 0, visibility: vis, buffer: { type: 'uniform' } }, { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } }],
      });
      hazeLayout = device.createBindGroupLayout({
        entries: [
          { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
          { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { viewDimension: '3d' } },
          { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
          { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } },
          { binding: 4, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'depth' } },
        ],
      });
      const mPart = device.createShaderModule({ label: 'mycelium3d-particles', code: PARTICLES });
      const mHaze = device.createShaderModule({ label: 'mycelium3d-haze', code: HAZE });
      for (const m of [mPart, mHaze]) {
        const errs = (await m.getCompilationInfo()).messages.filter((x) => x.type === 'error');
        if (errs.length) throw new Error('mycelium3d shader: ' + errs.map((x) => `${x.lineNum}: ${x.message}`).join('; '));
      }
      pPart = device.createRenderPipeline({
        label: 'mycelium3d-particles', layout: device.createPipelineLayout({ bindGroupLayouts: [partLayout] }),
        vertex: { module: mPart, entryPoint: 'vs' },
        fragment: { module: mPart, entryPoint: 'fs', targets: [{ format: COLOUR_FORMAT }] },
        primitive: { topology: 'triangle-list', cullMode: 'none' },
        depthStencil: { format: DEPTH_FORMAT, depthWriteEnabled: true, depthCompare: 'less' },
      });
      pHaze = device.createRenderPipeline({
        label: 'mycelium3d-haze', layout: device.createPipelineLayout({ bindGroupLayouts: [hazeLayout] }),
        vertex: { module: mHaze, entryPoint: 'vs' },
        fragment: { module: mHaze, entryPoint: 'fs', targets: [{ format }] },
        primitive: { topology: 'triangle-list' },
      });
      ubo = d.add(device.createBuffer({ label: 'mycelium3d-u', size: data.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }));
      instBuf = d.add(device.createBuffer({ label: 'mycelium3d-instances', size: PARTICLE_CAP * INSTANCE_FLOATS * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }));
      partGroup = device.createBindGroup({ layout: partLayout, entries: [{ binding: 0, resource: { buffer: ubo } }, { binding: 1, resource: { buffer: instBuf } }] });
      uploaded = -1;
    },
    render(f: FrameInfo) {
      if (!device || !ctx || !src) return;
      const target = ctx.getCurrentTexture();
      ensureTargets(target.width, target.height);
      if (!colView || !depView || !hazeGroup) return;
      if (uploaded !== store.version) {
        const inst = store.inst;
        count = inst ? Math.min(inst.count, PARTICLE_CAP) : 0;
        if (inst && count > 0) device.queue.writeBuffer(instBuf, 0, inst.data, 0, count * INSTANCE_FLOATS);
        uploaded = store.version;
      }
      const cam = f.camera, v = cam.view;
      const { W, H, D } = f.dims;
      data.set(cam.viewProj, 0);
      data.set(cam.invViewProj, 16);
      data.set([v[0]!, v[4]!, v[8]!, 0], 32);
      data.set([v[1]!, v[5]!, v[9]!, 0], 36);
      data.set([v[2]!, v[6]!, v[10]!, 0], 40);
      data.set([...cam.eye, 0], 44);
      data.set([...f.background, 1], 48);
      data.set([...f.ext, 0], 52);
      data.set([...visibleMax(f), clipped(f) ? 1 : 0], 56);
      data.set([W, D, H, 0], 60);
      data.set([values.size as number, values.trail as number, values.water as number, values.detail as number], 64);
      data.set([values.waste ? 1 : 0, f.still ? 0 : frameNo++, values.glass ? 1 : 0, 0], 68);
      data.set([...f.sunDir, 0], 72);
      device.queue.writeBuffer(ubo, 0, data);
      const enc = device.createCommandEncoder({ label: 'mycelium3d' });
      const p1 = enc.beginRenderPass({
        colorAttachments: [{ view: colView, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 0 } }],
        depthStencilAttachment: { view: depView, depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' },
      });
      if (count > 0) { p1.setPipeline(pPart); p1.setBindGroup(0, partGroup); p1.draw(6, count); }
      p1.end();
      const p2 = enc.beginRenderPass({ colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }] });
      p2.setPipeline(pHaze);
      p2.setBindGroup(0, hazeGroup);
      p2.draw(3);
      p2.end();
      device.queue.submit([enc.finish()]);
    },
    setParam(key, value) { values[key] = value; },
    unmount() {
      ctx?.unconfigure();
      ctx = null;
      device = null;
      src = null;
      colView = depView = null;
      hazeGroup = null;
      tw = th = 0;
      sized.disposeAll();
      d.disposeAll();
    },
  };
}
