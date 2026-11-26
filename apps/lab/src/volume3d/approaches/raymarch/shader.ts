// Front-to-back ray march through the box, ported from the 3D volume sandbox and generalised from its 64^3 unit cube to
// any W x D x H texture inside the box [0, ext]. One full-screen triangle; every pixel builds a ray from invViewProj, clips
// it to the visible part of the box (peel and cut shrink it), then walks it through `vox` and `aux`. Lengths are measured
// in voxels and scaled to the sandbox's 64-voxel cube (`per64`), so its tuned opacity and haze constants keep their look at
// any resolution: a 256-wide slab is as opaque per voxel as the 64^3 jar was.
export const WGSL = /* wgsl */ `
struct U {
  inv: mat4x4<f32>,
  eye: vec4<f32>,      // xyz
  sun: vec4<f32>,      // xyz sun direction, w = frame counter (jitter)
  bg: vec4<f32>,       // rgb
  ext: vec4<f32>,      // xyz box size
  vis: vec4<f32>,      // xyz visible box max (peel and cut), w = 1 when peel or cut is on
  tex: vec4<f32>,      // texels per axis (W, D, H)
  a: vec4<f32>,        // thickness, detail, surface, haze
  b: vec4<f32>,        // glass, 0, 0, 0
};
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var vox: texture_3d<f32>;
@group(0) @binding(2) var aux: texture_3d<f32>;
@group(0) @binding(3) var smp: sampler;

struct VOut { @builtin(position) pos: vec4<f32>, @location(0) uv: vec2<f32> };

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VOut {
  var p = array<vec2<f32>, 3>(vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
  var o: VOut;
  o.pos = vec4<f32>(p[vi], 0.0, 1.0);
  o.uv = vec2<f32>(p[vi].x * 0.5 + 0.5, 0.5 - p[vi].y * 0.5);
  return o;
}

const WATER = vec3<f32>(0.010, 0.085, 0.140);
const HAZE = vec3<f32>(0.030, 0.140, 0.300);
const SUN = vec3<f32>(1.0, 0.92, 0.76);

fn ign(p: vec2<f32>) -> f32 {
  return fract(52.9829189 * fract(dot(p, vec2<f32>(0.06711056, 0.00583715))));
}

fn ndcToWorld(x: f32, y: f32, z: f32) -> vec3<f32> {
  let h = u.inv * vec4<f32>(x, y, z, 1.0);
  return h.xyz / h.w;
}

// Ray interval inside the box [0, hi].
fn boxSpan(ro: vec3<f32>, rd: vec3<f32>, hi: vec3<f32>) -> vec2<f32> {
  let d = select(rd, vec3<f32>(1e-6), abs(rd) < vec3<f32>(1e-6));
  let inv = 1.0 / d;
  let t0 = (vec3<f32>(0.0) - ro) * inv;
  let t1 = (hi - ro) * inv;
  let tn = max(max(min(t0.x, t1.x), min(t0.y, t1.y)), min(t0.z, t1.z));
  let tf = min(min(max(t0.x, t1.x), max(t0.y, t1.y)), max(t0.z, t1.z));
  return vec2<f32>(tn, tf);
}

fn boxNormal(p: vec3<f32>) -> vec3<f32> {
  let q = (p - 0.5 * u.ext.xyz) / (0.5 * u.ext.xyz);
  let aq = abs(q);
  if (aq.x >= aq.y && aq.x >= aq.z) { return vec3<f32>(sign(q.x), 0.0, 0.0); }
  if (aq.y >= aq.z) { return vec3<f32>(0.0, sign(q.y), 0.0); }
  return vec3<f32>(0.0, 0.0, sign(q.z));
}

// Texture coordinate of world point p, held inside the centres of the visible texels so a peeled layer never bleeds in.
fn uvw(p: vec3<f32>) -> vec3<f32> {
  let half = 0.5 / u.tex.xyz;
  let top = u.vis.xyz / u.ext.xyz - half;
  return clamp(p / u.ext.xyz, half, top);
}

fn density(p: vec3<f32>) -> f32 { return textureSampleLevel(vox, smp, uvw(p), 0.0).a; }

fn glassRim(p: vec3<f32>, rd: vec3<f32>) -> vec3<f32> {
  let n = boxNormal(p);
  let f = pow(1.0 - clamp(abs(dot(n, rd)), 0.0, 1.0), 3.0);
  let refl = reflect(rd, n);
  let sdir = normalize(vec3<f32>(0.35, 0.85, 0.25));
  let spec = pow(max(dot(refl, sdir), 0.0), 48.0);
  return vec3<f32>(0.55, 0.78, 0.92) * f * 0.28 + SUN * spec * 0.55;
}

@fragment
fn fs(in: VOut) -> @location(0) vec4<f32> {
  let ndc = vec2<f32>(in.uv.x * 2.0 - 1.0, 1.0 - in.uv.y * 2.0);
  let nearP = ndcToWorld(ndc.x, ndc.y, 0.0);
  let farP = ndcToWorld(ndc.x, ndc.y, 1.0);
  let rd = normalize(farP - nearP);
  let ro = u.eye.xyz;

  // Backdrop: a slow vertical gradient so the box has something to sit against. u.bg is sRGB, as for the other renderers.
  let bgCol = pow(u.bg.rgb, vec3<f32>(2.2)) * (0.85 + 0.3 * (1.0 - in.uv.y));
  var out = bgCol;

  let full = boxSpan(ro, rd, u.ext.xyz);
  let span0 = boxSpan(ro, rd, u.vis.xyz);
  let span = vec2<f32>(max(span0.x, 0.0), span0.y);
  let glass = u.b.x > 0.5;
  if (span.y <= span.x) {
    // Outside the visible part: the backdrop only. Glass over a peeled or cut-away part would read as a solid grey block.
    if (glass && u.vis.w < 0.5 && full.y > max(full.x, 0.0)) { out += glassRim(ro + rd * full.x, rd) * 0.6; }
    out = vec3<f32>(1.0) - exp(-out * 1.25);
    return vec4<f32>(pow(clamp(out, vec3<f32>(0.0), vec3<f32>(1.0)), vec3<f32>(1.0 / 2.2)), 1.0);
  }

  let vsz = u.ext.xyz / u.tex.xyz;                  // one voxel in world units
  let voxLen = min(min(vsz.x, vsz.y), vsz.z);
  let per64 = 1.0 / (64.0 * voxLen);                // world length -> the sandbox's 64-voxel units
  let thick = u.a.x;
  let detail = u.a.y;
  let surf = u.a.z;
  let haze = u.a.w;
  let sunD = normalize(u.sun.xyz);
  let waterAbs = 0.10 + 0.55 * haze;
  let hazeSig = 1.6 * haze;
  let h = voxLen / detail;

  var col = vec3<f32>(0.0);
  var T = 1.0;
  let jitter = ign(in.pos.xy + vec2<f32>(fract(u.sun.w * 0.61803) * 64.0));
  var t = span.x + jitter * h;
  var first = true;
  for (var it = 0; it < 1536; it++) {
    if (t >= span.y || T < 0.03) { break; }
    let p = ro + rd * t;
    let seg = min(h, span.y - t);
    let L = seg * per64;
    let q = uvw(p);
    let a = textureSampleLevel(aux, smp, q, 0.0);
    let lit = a.g;
    // Water and nutrient haze: a cool, light-lit fog.
    let sig = waterAbs + hazeSig * a.r;
    let scat = (WATER * waterAbs + HAZE * hazeSig * a.r) * (0.12 + 0.88 * lit) * 1.6;
    let tr = exp(-sig * L);
    col += T * scat * (1.0 - tr) / max(sig, 1e-4);
    T *= tr;
    let v = textureSampleLevel(vox, smp, q, 0.0);
    let dens = v.a;
    if (dens > 0.004) {
      let alpha = 1.0 - exp(-dens * thick * L);
      var n = vec3<f32>(0.0, 1.0, 0.0);
      var gl = 0.0;
      if (surf > 0.01) {
        let e = vsz * 1.75;
        let g = vec3<f32>(
          density(p + vec3<f32>(e.x, 0.0, 0.0)) - density(p - vec3<f32>(e.x, 0.0, 0.0)),
          density(p + vec3<f32>(0.0, e.y, 0.0)) - density(p - vec3<f32>(0.0, e.y, 0.0)),
          density(p + vec3<f32>(0.0, 0.0, e.z)) - density(p - vec3<f32>(0.0, 0.0, e.z)));
        gl = length(g);
        if (gl > 1e-3) { n = -g / gl; }
      }
      let edge = smoothstep(0.02, 0.35, gl) * surf;
      let ndl = max(dot(n, sunD), 0.0);
      let direct = lit * mix(1.0, 0.25 + 0.95 * ndl, edge);
      let sky = mix(vec3<f32>(0.05, 0.09, 0.13), vec3<f32>(0.20, 0.28, 0.32), q.y);
      let amb = sky * (0.45 + 0.55 * lit) * mix(1.0, 0.55 + 0.45 * (n.y * 0.5 + 0.5), edge);
      var c = v.rgb * (amb + SUN * 1.5 * direct);
      // Light bleeding through thin tissue, and a lineage-tinted rim where the surface turns away.
      c += v.rgb * SUN * lit * 0.35 * (1.0 - dens) * 0.5;
      let rim = pow(1.0 - clamp(dot(n, -rd), 0.0, 1.0), 3.0) * edge;
      c += v.rgb * (0.25 + 0.6 * lit) * rim * 0.7;
      col += T * alpha * c;
      T *= 1.0 - alpha;
    }
    t += seg;
    // The jittered first sample stands for the whole first cell [span.x, span.x + h), so the next cell starts on the grid.
    if (first) { t = span.x + seg; }
    first = false;
  }
  out = col + T * bgCol;
  // Glass: a bright rim where the ray enters and leaves the whole box (not on faces the peel or cut opened).
  if (glass) {
    if (abs(span.x - full.x) < 1e-5 && full.x > 0.0) { out += glassRim(ro + rd * full.x, rd); }
    if (abs(span.y - full.y) < 1e-5) { out += T * glassRim(ro + rd * full.y, rd) * 0.6; }
  }
  // Soft shoulder, then gamma.
  out = vec3<f32>(1.0) - exp(-out * 1.25);
  return vec4<f32>(pow(clamp(out, vec3<f32>(0.0), vec3<f32>(1.0)), vec3<f32>(1.0 / 2.2)), 1.0);
}
`;
