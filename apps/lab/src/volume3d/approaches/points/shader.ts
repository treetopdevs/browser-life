// Render shaders for the points look, ported from the 3D volume sandbox. Live voxels arrive as a texel-index list packed
// on the CPU (pack.ts) and are drawn instanced: lit sphere impostors (billboards that write sphere depth, so overlap needs
// no sorting), a faint halo pass, flat cubes for the blocky control, and the box outline. Texel (u, v, w) of a W x D x H
// texture sits at world ((u, v, w) + 0.5) * voxel inside the box [0, ext].
export const SHADER = /* wgsl */ `
struct R {
  viewProj: mat4x4<f32>,
  right: vec4<f32>, up: vec4<f32>, back: vec4<f32>, eye: vec4<f32>, bg: vec4<f32>, sun: vec4<f32>,
  p0: vec4<f32>, // time, size, fog, halo
  p1: vec4<f32>, // jitter, threshold (0..1 density), camera distance to the box centre, 0
  ext: vec4<f32>, // xyz box size
  tex: vec4<f32>, // texels per axis (W, D, H)
  vis: vec4<f32>, // xyz visible box max (peel and cut)
};
@group(0) @binding(0) var<uniform> R_: R;
@group(0) @binding(1) var<storage, read> list: array<u32>;
@group(0) @binding(2) var vox: texture_3d<f32>;
@group(0) @binding(3) var aux: texture_3d<f32>;

override QS: f32 = 1.0;

fn lowbias32(x0: u32) -> u32 {
  var x = x0;
  x ^= x >> 16u; x *= 0x7feb352du; x ^= x >> 15u; x *= 0x846ca68bu; x ^= x >> 16u;
  return x;
}
fn hash3(i: u32) -> vec3<f32> {
  let a = lowbias32(i * 3u + 1u);
  let b = lowbias32(i * 3u + 2u);
  let c = lowbias32(i * 3u + 3u);
  return vec3<f32>(f32(a & 0xffffu), f32(b & 0xffffu), f32(c & 0xffffu)) / 65535.0;
}

struct VOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) @interpolate(flat) col: vec3<f32>,
  @location(2) @interpolate(flat) light: f32,
  @location(3) @interpolate(flat) center: vec3<f32>,
  @location(4) @interpolate(flat) rad: f32,
  @location(5) @interpolate(flat) nrm: vec3<f32>,
};

var<private> quad: array<vec2<f32>, 6> = array<vec2<f32>, 6>(
  vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0), vec2<f32>(1.0, 1.0),
  vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, 1.0), vec2<f32>(-1.0, 1.0));

struct Voxel { p: vec3<i32>, dens: f32, col: vec3<f32>, light: f32, h: vec3<f32>, hide: bool, vsz: vec3<f32> };
fn loadVoxel(inst: u32) -> Voxel {
  let i = list[inst];
  let W = u32(R_.tex.x);
  let D = u32(R_.tex.y);
  let p = vec3<i32>(i32(i % W), i32((i / W) % D), i32(i / (W * D)));
  let v = textureLoad(vox, p, 0);
  let a = textureLoad(aux, p, 0);
  let vsz = R_.ext.xyz / R_.tex.xyz;
  let c = (vec3<f32>(p) + 0.5) * vsz;
  let hide = v.a < R_.p1.y || any(c > R_.vis.xyz);
  return Voxel(p, v.a, v.rgb, a.g, hash3(i), hide, vsz);
}

@vertex
fn vsSprite(@builtin(vertex_index) vi: u32, @builtin(instance_index) inst: u32) -> VOut {
  let v = loadVoxel(inst);
  let t = R_.p0.x;
  let vl = min(min(v.vsz.x, v.vsz.y), v.vsz.z);
  // sub-voxel jitter: a fixed hashed offset plus a slow drift, so the lattice never reads as a grid
  let wob = sin(t * (0.4 + v.h.x) + v.h.yzx * 6.2831) * 0.22;
  let off = ((v.h - 0.5) * 0.9 + wob) * R_.p1.x;
  let c = (vec3<f32>(v.p) + 0.5 + off) * v.vsz;
  let rad = (0.30 + 0.48 * v.dens) * R_.p0.y * vl;
  let q = quad[vi];
  let w = c + (R_.right.xyz * q.x + R_.up.xyz * q.y) * rad * QS;
  var o: VOut;
  o.pos = R_.viewProj * vec4<f32>(w, 1.0);
  o.uv = q;
  o.col = v.col; o.light = v.light; o.center = c; o.rad = rad; o.nrm = vec3<f32>(0.0);
  if (v.hide) { o.pos = vec4<f32>(2.0, 2.0, 2.0, 1.0); }
  return o;
}

@vertex
fn vsCube(@builtin(vertex_index) vi: u32, @builtin(instance_index) inst: u32) -> VOut {
  let v = loadVoxel(inst);
  let face = vi / 6u;
  let axis = face / 2u;
  let sgn = select(-1.0, 1.0, (face & 1u) == 1u);
  let q = quad[vi % 6u];
  var dv = vec3<f32>(0.0);
  dv[axis] = sgn;
  dv[(axis + 1u) % 3u] = q.x;
  dv[(axis + 2u) % 3u] = q.y;
  var n = vec3<f32>(0.0);
  n[axis] = sgn;
  let h = (0.34 + 0.16 * v.dens) * R_.p0.y;
  let c = (vec3<f32>(v.p) + 0.5) * v.vsz;
  var o: VOut;
  o.pos = R_.viewProj * vec4<f32>(c + dv * h * v.vsz, 1.0);
  o.uv = q;
  o.col = v.col; o.light = v.light; o.center = c; o.rad = h * min(min(v.vsz.x, v.vsz.y), v.vsz.z); o.nrm = n;
  if (v.hide) { o.pos = vec4<f32>(2.0, 2.0, 2.0, 1.0); }
  return o;
}

fn shade(albedo: vec3<f32>, n: vec3<f32>, light: f32, p: vec3<f32>) -> vec3<f32> {
  let sun = R_.sun.xyz;
  let V = normalize(R_.eye.xyz - p);
  let wrap = clamp((dot(n, sun) + 0.3) / 1.3, 0.0, 1.0);
  let sunCol = vec3<f32>(1.0, 0.92, 0.76) * 1.3;
  let up = n.y * 0.5 + 0.5;
  let hemi = mix(vec3<f32>(0.05, 0.05, 0.08), vec3<f32>(0.28, 0.34, 0.45), up) * (0.3 + 0.7 * light);
  var c = albedo * (sunCol * wrap * light + hemi);
  let hv = normalize(sun + V);
  c += vec3<f32>(1.0, 0.97, 0.9) * pow(max(dot(n, hv), 0.0), 56.0) * 0.28 * light;
  let rim = pow(1.0 - max(dot(n, V), 0.0), 3.0);
  c += albedo * vec3<f32>(0.55, 0.8, 1.0) * rim * (0.12 + 0.3 * light);
  // depth cue: the far side of the box fades toward the background
  let bgl = pow(R_.bg.rgb, vec3<f32>(2.2));
  let d = length(p - R_.eye.xyz);
  let fogT = clamp((d - (R_.p1.z - 0.55)) / 1.1, 0.0, 1.0) * R_.p0.z;
  return mix(c, bgl, fogT * 0.85);
}
fn encode(c: vec3<f32>) -> vec3<f32> { return pow(clamp(c, vec3<f32>(0.0), vec3<f32>(1.0)), vec3<f32>(1.0 / 2.2)); }

struct FOut { @location(0) color: vec4<f32>, @builtin(frag_depth) depth: f32 };

@fragment
fn fsSprite(in: VOut) -> FOut {
  let r2 = dot(in.uv, in.uv);
  if (r2 > 1.0) { discard; }
  let z = sqrt(1.0 - r2);
  let n = normalize(R_.right.xyz * in.uv.x + R_.up.xyz * in.uv.y + R_.back.xyz * z);
  let p = in.center + n * in.rad;
  let clip = R_.viewProj * vec4<f32>(p, 1.0);
  var o: FOut;
  o.color = vec4<f32>(encode(shade(in.col, n, in.light, p)), 1.0 - smoothstep(0.78, 1.0, sqrt(r2)));
  o.depth = clip.z / clip.w;
  return o;
}

@fragment
fn fsCube(in: VOut) -> @location(0) vec4<f32> {
  let p = in.center + in.nrm * in.rad;
  var c = shade(in.col, in.nrm, in.light, p);
  let e = max(abs(in.uv.x), abs(in.uv.y));
  c *= 1.0 - 0.28 * smoothstep(0.82, 1.0, e);
  return vec4<f32>(encode(c), 1.0);
}

@fragment
fn fsHalo(in: VOut) -> @location(0) vec4<f32> {
  let r2 = dot(in.uv, in.uv);
  if (r2 > 1.0) { discard; }
  let a = R_.p0.w * 0.11 * exp(-r2 * 4.5) * (0.35 + 0.65 * in.light);
  let tint = mix(in.col, vec3<f32>(1.0), 0.25);
  return vec4<f32>(encode(tint * (0.9 + 0.5 * in.light)), a);
}

// ---- box outline -------------------------------------------------------------------------------------------------
struct LOut { @builtin(position) pos: vec4<f32> };
@vertex
fn vsLine(@builtin(vertex_index) vi: u32) -> LOut {
  var p = vec3<f32>(0.0);
  let e = vi / 2u;
  let a = e / 4u;
  let k = e % 4u;
  p[(a + 1u) % 3u] = f32(k & 1u);
  p[(a + 2u) % 3u] = f32((k >> 1u) & 1u);
  p[a] = f32(vi & 1u);
  var o: LOut;
  o.pos = R_.viewProj * vec4<f32>(p * R_.ext.xyz, 1.0);
  return o;
}
@fragment
fn fsLine() -> @location(0) vec4<f32> {
  let lum = dot(R_.bg.rgb, vec3<f32>(0.3, 0.6, 0.1));
  let c = select(vec3<f32>(0.8, 0.9, 1.0), vec3<f32>(0.1, 0.12, 0.16), lum > 0.5);
  return vec4<f32>(c, 0.4);
}
`;
