// Pure packers and census helpers for /mycelium3d/: one read-back of the 3D mycelium world (tools/mycelium3d/world.ts)
// becomes the volume renderer's two RGBA8 3D textures (apps/lab/src/volume3d/contract.ts), a list of particle instances
// for the particle-and-haze renderer, the bonds as link segments, and a census by layer group. CPU-only and pure, so they are unit-tested without a
// GPU (apps/lab/test/mycelium3d-pack.test.ts). Nothing here changes the state.
//
// Texture channels, as the volume contract names them, filled for this world:
// - vox: rgb = linear family colour of the heaviest particle in the cell, a = sqrt(min(1, body matter / bodyUnit)) where
//   particles are, 0 elsewhere. The stock renderers (ray march, slices, points) draw particles as cells from this.
// - aux: r = trail, log-scaled to trailUnit; g = light, the simulation's own light plane (lightPlane in world.ts, the plane
//   the next step uses) as a fraction of the unshaded surface; b = waste, log-scaled to wasteUnit; a = 1 where particles are.
// Layer 0 (the surface) is the top slab of texels, as for the slab (cell (x, y, z) is texel (x, D - 1 - z, y)).
import { BOND_NONE, POS_SHIFT, slotOfId, type Mycelium3dState } from '../../../../tools/mycelium3d/world.ts';
import { familyRGB } from '../mycelium/colour.ts';
import { voxelCount, type VolumeDims } from '../volume3d/contract.ts';
import type { Packed } from '../volume3d/pack.ts';

export interface FieldPackOptions {
  /** Body matter in one cell at which it is fully dense. */
  bodyUnit?: number;
  /** Trail P in one cell at which the trail haze is fullest (log scale). */
  trailUnit?: number;
  /** Waste C in one cell at which the waste haze is fullest (log scale). */
  wasteUnit?: number;
}
/** Founders carry 32 matter and split at 48. Tuned on a 64 x 64 x 32 jar with fast sinking at step 6,200 (seed 1): trail per
 *  cell had 99th percentile 2 and maximum 10; waste had median 0, 90th percentile 24 and 99th percentile 838 (the floor). */
export const FIELD_DEFAULTS = { bodyUnit: 64, trailUnit: 8, wasteUnit: 512 } as const;

/** sRGB 0..1 -> linear byte. */
const linByte = (c: number) => Math.round(Math.pow(Math.min(1, Math.max(0, c)), 2.2) * 255);
/** min(1, log2(1 + q) / log2(1 + unit)) as a byte: a haze that shows one unit of trail and still separates a heap of waste. */
const logByte = (q: number, unit: number) => (q <= 0 ? 0 : Math.round(255 * Math.min(1, Math.log2(1 + q) / Math.log2(1 + unit))));

export const dimsOf = (s: Mycelium3dState): VolumeDims => ({ W: s.config.width, H: s.config.height, D: s.config.depth });

/** The 3D cell index of particle slot i. */
export const particleCell = (s: Mycelium3dState, i: number) =>
  ((s.z[i] >>> POS_SHIFT) * s.config.height + (s.y[i] >>> POS_SHIFT)) * s.config.width + (s.x[i] >>> POS_SHIFT);

/** Linear family colours by genotype id, cached (the hash is stable, so a family keeps its colour all run). */
const famCache = new Map<number, [number, number, number]>();
export function familyLinear(gid: number): [number, number, number] {
  let c = famCache.get(gid);
  if (!c) {
    const s = familyRGB(gid);
    c = [linByte(s[0]), linByte(s[1]), linByte(s[2])];
    if (famCache.size > 200_000) famCache.clear();
    famCache.set(gid, c);
  }
  return c;
}

/**
 * Packs one state into `into` when the dims match (the output buffers are reused; two per-cell scratch arrays are still
 * allocated per call), else into fresh buffers. `I` is lightPlane(s).
 * `live` lists the texels holding particles, in texel order.
 */
export function packField(s: Mycelium3dState, I: Uint32Array, opts: FieldPackOptions = {}, into?: Packed): Packed {
  const dims = dimsOf(s);
  const { W, H, D } = dims;
  const n = voxelCount(dims);
  const out = into && into.dims.W === W && into.dims.H === H && into.dims.D === D ? into
    : { dims, vox: new Uint8Array(n * 4), aux: new Uint8Array(n * 4), live: new Uint32Array(n), liveCount: 0 };
  const bodyUnit = opts.bodyUnit ?? FIELD_DEFAULTS.bodyUnit;
  const trailUnit = opts.trailUnit ?? FIELD_DEFAULTS.trailUnit;
  const wasteUnit = opts.wasteUnit ?? FIELD_DEFAULTS.wasteUnit;
  const top = s.config.light << 8;
  // Body matter per cell and the slot of its heaviest particle (the lowest slot on a tie).
  const Mb = new Uint32Array(n);
  const heavy = new Int32Array(n).fill(-1);
  for (let i = 0; i < s.n; i++) {
    const k = particleCell(s, i);
    Mb[k] += s.M[i];
    if (heavy[k] < 0 || s.M[i] > s.M[heavy[k]]) heavy[k] = i;
  }
  const { vox, aux, live } = out;
  const plane = W * H;
  let count = 0;
  for (let y = 0; y < H; y++) {
    for (let v = 0; v < D; v++) {
      const z = D - 1 - v;
      for (let x = 0; x < W; x++) {
        const k = z * plane + y * W + x;
        const o = (x + W * (v + D * y)) * 4;
        const h = heavy[k];
        if (h >= 0) {
          const c = familyLinear(s.gid[h]);
          vox[o] = c[0]; vox[o + 1] = c[1]; vox[o + 2] = c[2];
          vox[o + 3] = Math.max(1, Math.round(255 * Math.sqrt(Math.min(1, Mb[k] / bodyUnit))));
          aux[o + 3] = 255;
          live[count++] = o >> 2;
        } else {
          vox[o] = vox[o + 1] = vox[o + 2] = vox[o + 3] = 0;
          aux[o + 3] = 0;
        }
        aux[o] = logByte(s.P[k], trailUnit);
        aux[o + 1] = top === 0 ? 0 : Math.round((255 * Math.min(I[k], top)) / top);
        aux[o + 2] = logByte(s.C[k], wasteUnit);
      }
    }
  }
  out.liveCount = count;
  return out;
}

/** Floats per particle instance: texel-space centre (u east, v up, w south), radius in voxels, linear rgb, light 0..1. */
export const INSTANCE_FLOATS = 8;

export interface Instances {
  data: Float32Array;
  count: number;
}

/**
 * One instance per live particle, at its true fixed-point position in voxels: u = (x + 0.5) / 256, v = D - (z + 0.5) / 256
 * (so layer 0 is the top of the box), w = (y + 0.5) / 256. The half unit keeps every particle strictly inside the texel of
 * its own cell (cell (x, y, z) is texel (x, D - 1 - z, y)). The radius grows with body matter; the light is the light plane at its cell.
 */
export function packParticles(s: Mycelium3dState, I: Uint32Array, into?: Instances): Instances {
  const need = s.n * INSTANCE_FLOATS;
  const out = into && into.data.length >= need ? into : { data: new Float32Array(Math.max(need, INSTANCE_FLOATS)), count: 0 };
  const D = s.config.depth;
  const top = s.config.light << 8;
  const scale = 1 / (1 << POS_SHIFT);
  const d = out.data;
  for (let i = 0; i < s.n; i++) {
    const o = i * INSTANCE_FLOATS;
    const c = familyLinear(s.gid[i]);
    d[o] = (s.x[i] + 0.5) * scale;
    d[o + 1] = D - (s.z[i] + 0.5) * scale;
    d[o + 2] = (s.y[i] + 0.5) * scale;
    d[o + 3] = 0.22 + 0.3 * Math.sqrt(Math.min(1, s.M[i] / 64));
    d[o + 4] = c[0] / 255; d[o + 5] = c[1] / 255; d[o + 6] = c[2] / 255;
    d[o + 7] = top === 0 ? 0 : Math.min(1, I[particleCell(s, i)] / top);
  }
  out.count = s.n;
  return out;
}

// ---- bond links --------------------------------------------------------------------------------------------------------

/** Floats per link instance, in the instances' texel space: drawn start (a particle), drawn end, and the partner's true centre. */
export const LINK_FLOATS = 9;

export interface Links {
  data: Float32Array;
  /** Link instances: one per bond, two (a stub at each end) for a bond across an x or y seam. */
  count: number;
  bonds: number;
  /** Bonds whose shortest way between the partners crosses a wrapped wall (x or y). */
  seamBonds: number;
}

/**
 * The bond graph as line segments, each bond once (from the smaller slot, which is the smaller id). Partners are joined by the
 * shortest way in the wrapped x and y (the minimal image). When that way crosses a wall, the bond is drawn as two stubs, one
 * from each partner to the wall it leaves through, so no line spans the jar. Each instance also carries the partner's true
 * centre, so the renderer can hide a link whose either particle is peeled or cut away. Null without bond slots.
 */
export function packLinks(s: Mycelium3dState, into?: Links): Links | null {
  const b0 = s.bond0, b1 = s.bond1;
  if (!b0 || !b1) return null;
  const n = s.n;
  // at most n bonds (degree 2), each at most two instances
  const need = 2 * n * LINK_FLOATS;
  const out = into && into.data.length >= need ? into : { data: new Float32Array(Math.max(need, LINK_FLOATS)), count: 0, bonds: 0, seamBonds: 0 };
  const { width: W, height: H, depth: D } = s.config;
  const PW = W << POS_SHIFT, PH = H << POS_SHIFT;
  const scale = 1 / (1 << POS_SHIFT);
  const d = out.data;
  let count = 0, bonds = 0, seam = 0;
  const put = (au: number, av: number, aw: number, eu: number, ev: number, ew: number, qu: number, qv: number, qw: number) => {
    const o = count++ * LINK_FLOATS;
    d[o] = au; d[o + 1] = av; d[o + 2] = aw; d[o + 3] = eu; d[o + 4] = ev; d[o + 5] = ew; d[o + 6] = qu; d[o + 7] = qv; d[o + 8] = qw;
  };
  /** From p (inside the box) along e: the point where it leaves [0, W] x [0, H] in u and w, or p + e if it stays inside. */
  const stub = (pu: number, pv: number, pw: number, eu: number, ev: number, ew: number, qu: number, qv: number, qw: number) => {
    let t = 1;
    if (pu + eu > W) t = Math.min(t, (W - pu) / eu); else if (pu + eu < 0) t = Math.min(t, -pu / eu);
    if (pw + ew > H) t = Math.min(t, (H - pw) / ew); else if (pw + ew < 0) t = Math.min(t, -pw / ew);
    put(pu, pv, pw, pu + eu * t, pv + ev * t, pw + ew * t, qu, qv, qw);
  };
  for (let i = 0; i < n; i++) {
    for (const pid of [b0[i], b1[i]]) {
      if (pid === BOND_NONE) continue;
      const j = slotOfId(s.id, n, pid);
      if (j <= i) continue; // each bond once, from its smaller slot (a partner not alive is never drawn)
      bonds++;
      let dx = s.x[j] - s.x[i], dy = s.y[j] - s.y[i];
      if (dx > PW / 2) dx -= PW; else if (dx < -PW / 2) dx += PW;
      if (dy > PH / 2) dy -= PH; else if (dy < -PH / 2) dy += PH;
      const iu = (s.x[i] + 0.5) * scale, iv = D - (s.z[i] + 0.5) * scale, iw = (s.y[i] + 0.5) * scale;
      const ju = (s.x[j] + 0.5) * scale, jv = D - (s.z[j] + 0.5) * scale, jw = (s.y[j] + 0.5) * scale;
      const crosses = s.x[i] + dx < 0 || s.x[i] + dx >= PW || s.y[i] + dy < 0 || s.y[i] + dy >= PH;
      if (!crosses) { put(iu, iv, iw, ju, jv, jw, ju, jv, jw); continue; }
      seam++;
      // Known limit: a bond that crosses both the x and the y seam (a corner) gets its two end stubs only; the short piece
      // between the two wall crossings is not drawn.
      const eu = dx * scale, ev = jv - iv, ew = dy * scale;
      stub(iu, iv, iw, eu, ev, ew, ju, jv, jw);
      stub(ju, jv, jw, -eu, -ev, -ew, iu, iv, iw);
    }
  }
  out.count = count; out.bonds = bonds; out.seamBonds = seam;
  return out;
}

// ---- census by depth -------------------------------------------------------------------------------------------------

/** Layer groups for the census: at most eight, each the same number of layers (D is 16, 32 or 64 on this page). */
export function layerGroups(D: number): [number, number][] {
  const g = D <= 8 ? D : 8;
  const per = Math.ceil(D / g);
  const out: [number, number][] = [];
  for (let z = 0; z < D; z += per) out.push([z, Math.min(D, z + per) - 1]);
  return out;
}

export interface GroupCensus {
  /** First and last layer, inclusive; 0 is the surface. */
  z0: number;
  z1: number;
  particles: number;
  /** Body matter of the particles in the group. */
  M: number;
  A: number;
  C: number;
  P: number;
  /** Mean light over the group's cells, as a fraction of the unshaded surface (0..1). */
  light: number;
}

export interface Census {
  step: number;
  particles: number;
  families: number;
  groups: GroupCensus[];
  /** Matter now minus matter at planting, and energy now minus (energy at planting + light in - heat). Both must be 0. */
  matterResidual: number;
  energyResidual: number;
  births: number;
  deaths: number;
  refused: number;
}

/** The census of one state; `I` is lightPlane(s). Reads state, changes nothing. */
export function census(s: Mycelium3dState, I: Uint32Array): Census {
  const c = s.config;
  const WH = c.width * c.height;
  const top = c.light << 8;
  const groups: GroupCensus[] = layerGroups(c.depth).map(([z0, z1]) => ({ z0, z1, particles: 0, M: 0, A: 0, C: 0, P: 0, light: 0 }));
  const per = groups[0]!.z1 - groups[0]!.z0 + 1;
  let field = 0, chem = 0;
  for (const g of groups) {
    let l = 0;
    for (let k = g.z0 * WH; k < (g.z1 + 1) * WH; k++) { g.A += s.A[k]; g.C += s.C[k]; g.P += s.P[k]; l += I[k]; }
    g.light = top === 0 ? 0 : l / ((g.z1 - g.z0 + 1) * WH * top);
    field += g.A + g.C + g.P;
    chem += g.A;
  }
  const fams = new Set<number>();
  let body = 0, energy = 0;
  for (let i = 0; i < s.n; i++) {
    const g = groups[Math.floor((s.z[i] >>> POS_SHIFT) / per)]!;
    g.particles++; g.M += s.M[i];
    body += s.M[i]; energy += s.E[i];
    fams.add(s.gid[i]);
  }
  return {
    step: s.step, particles: s.n, families: fams.size, groups,
    matterResidual: field + body - s.matter0,
    energyResidual: chem * c.eA + energy - (s.energy0 + s.totals.lightIn - s.totals.heat),
    births: s.totals.births, deaths: s.totals.deaths, refused: s.totals.refused,
  };
}

/** Events per 100 steps between two censuses of the same world; null when no steps passed. */
export function ratePer100(a: Pick<Census, 'step' | 'births' | 'deaths' | 'refused'>, b: Pick<Census, 'step' | 'births' | 'deaths' | 'refused'>) {
  const span = b.step - a.step;
  if (span <= 0) return null;
  const r = (k: 'births' | 'deaths' | 'refused') => Math.round(((b[k] - a[k]) * 100) / span);
  return { births: r('births'), deaths: r('deaths'), refused: r('refused') };
}
