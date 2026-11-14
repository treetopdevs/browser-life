// WGSL kernels of the slab (rung 1b, 3D). A twin of packages/sim-ref/src/step3d.ts, written to
// docs/3d-rung1b-step-spec.md; any change to the slab rules is made in both places and must pass the
// slab golden cases. The 2D kernels in shaders.ts are untouched.

import {
  B1_OFF3,
  B2_OFF3,
  CH,
  EVENT_WORDS,
  FLUX_COUNT,
  FLUX_NAMES,
  G,
  GENOME_CHANNELS3,
  GOLDEN,
  LEDGER,
  MOT_ZERO3,
  NN_BYTES3,
  NN_H3,
  NN_I3,
  NN_O3,
  NN_WORDS3,
  OUT3,
  POOL_MAX3,
  RND3,
  U32_MAX,
  W1_OFF3,
  W2_OFF3,
  buildKernel3,
  cellCount,
  encodeGenome3,
  generalistGenome3,
  isSlab,
  lightModeId,
  type WorldConfig,
} from "@bl/schema";

/** Workgroup shape of the per-cell passes (affinity is the timed shape of the rung 1a re-rule). */
export const WG3: readonly [number, number, number] = [8, 8, 4];
/** Light pass workgroup: one thread per column. */
export const WGL3: readonly [number, number, number] = [8, 8, 1];
/** Affinity tile: (8+6) * (8+6) * (4+6) words = 7,840 bytes, one workgroup declaration. */
export const AFF3_SW = [14, 14, 10] as const;
export const AFF3_SMN = 14 * 14 * 10;

export const STATS3_WORDS = 16;
export const STATS3 = { SUMS: 0, LIVING: 12, DENSE: 13 } as const;

const u = (v: number) => `${v >>> 0}u`;
const i = (v: number) => `${v | 0}i`;

export function prelude3(c: WorldConfig): string {
  if (!isSlab(c)) throw new Error("prelude3: not a slab config (tileD is absent)");
  const n = cellCount(c);
  const W = c.tileW;
  const H = c.tileH;
  const D = c.tileD!;
  const k = buildKernel3(3);
  const consts: Record<string, string> = {
    N: u(n),
    TILE_W: u(W),
    TILE_H: u(H),
    TILE_D: u(D),
    WH: u(W * H),
    SEED: u(c.seed),
    GOLDEN: u(GOLDEN),
    E_A: u(c.eA),
    E_B: u(c.eB),
    E_C: u(c.eC),
    E_P: u(c.eP),
    MASS_UNIT: u(c.massUnit),
    MASS_DIV: i(8 * c.massUnit),
    THETA: u(c.thetaMass),
    DT_Q: i(c.dtQ),
    HW: i(32 + c.spread),
    D1: u(2 * (32 + c.spread)),
    DMAX: i(64 - c.spread),
    DEF_MU: u(c.defaultMu),
    DEF_SIGMA: u(c.defaultSigma),
    DIFF_A: u(c.diffA),
    DIFF_C: u(c.diffC),
    DIFF_S: u(c.diffS),
    GATE_K: u(c.gateK),
    K_CAT_HALF: u(c.kCatHalf),
    POOL_MAX3: u(POOL_MAX3),
    K_PHOTO: u(c.kPhoto),
    K_RESP: u(c.kResp),
    K_DECOMP: u(c.kDecomp),
    K_GROW: u(c.kGrow),
    K_BUILD: u(c.kBuild),
    K_EMIT: u(c.kEmit),
    K_COST: u(c.kCost),
    K_MAINT: u(c.kMaint),
    K_PDECAY: u(c.kPDecay),
    K_BDECAY: u(c.kBDecay),
    K_ELEAK: u(c.kELeak),
    K_SDECAY: u(c.kSDecay),
    K_ABIO: u(c.kAbio),
    MUT_RATE: u(c.mutRate),
    MUT_CAP: u(c.mutRate === 0 ? 0 : Math.floor(U32_MAX / c.mutRate)),
    MUT_STEP: i(c.mutStep),
    LIGHT_MODE: u(lightModeId(c.lightMode)),
    LIGHT_BASE: i(c.lightBase),
    LIGHT_AMP: u(c.lightAmp),
    SEASON_PERIOD: u(c.seasonPeriod),
    SEASON_AMP: i(c.seasonAmp),
    LIGHT_K: u(c.lightK!),
    SIGNAL_GAIN: i(c.signalGain ?? 1),
    EVENT_CAP: u(c.eventCap),
    KN: u(k.count),
    KSUM: u(k.sum),
    CH_A: u(CH.A * n),
    CH_B: u(CH.B * n),
    CH_C: u(CH.C * n),
    CH_P: u(CH.P * n),
    CH_E: u(CH.E * n),
    CH_S: u(CH.S * n),
    CH_MOT: u(CH.MOT * n),
    G_LIN_HI: u(G.LIN_HI * n),
    G_LIN_LO: u(G.LIN_LO * n),
    G_PARAM0: u(G.PARAM0 * n),
    G_PARAM1: u(G.PARAM1 * n),
    G_W0: u(G.W0),
    GENOME_CH: u(GENOME_CHANNELS3),
    NN_I: u(NN_I3),
    NN_H: u(NN_H3),
    NN_O: u(NN_O3),
    NN_BYTES: u(NN_BYTES3),
    NN_WORDS: u(NN_WORDS3),
    W1_OFF: u(W1_OFF3),
    B1_OFF: u(B1_OFF3),
    W2_OFF: u(W2_OFF3),
    B2_OFF: u(B2_OFF3),
    MOT_ZERO: u(MOT_ZERO3),
    L_LIGHT_LO: u(LEDGER.LIGHT_LO),
    L_LIGHT_HI: u(LEDGER.LIGHT_HI),
    L_HEAT_LO: u(LEDGER.HEAT_LO),
    L_HEAT_HI: u(LEDGER.HEAT_HI),
    L_EVENTS: u(LEDGER.EVENTS),
    L_DROPPED: u(LEDGER.EVENTS_DROPPED),
    L_STEP: u(LEDGER.STEP),
    L_FLAGS: u(LEDGER.FLAGS),
    L_FLUX: u(LEDGER.FLUX),
    FLUX_N: u(FLUX_COUNT),
    EVENT_WORDS: u(EVENT_WORDS),
    OUTSIDE: "0xffffffffu",
  };
  consts.NEUTRAL = c.neutral ? "true" : "false";
  consts.MOTILITY = c.motility === false ? "false" : "true";
  FLUX_NAMES.forEach((name, j) => (consts[`FX_${name.toUpperCase()}`] = u(j)));
  const ref = encodeGenome3(generalistGenome3(c.defaultMu, c.defaultSigma), 0, 0);
  consts.REF_PARAM1 = u(ref[G.PARAM1]);
  consts.REF_W = `array<u32, ${NN_WORDS3}>(${Array.from(ref.subarray(G.W0)).map(u).join(", ")})`;
  for (const [name, v] of Object.entries(RND3)) consts[`RND_${name}`] = u(v);
  for (const [name, v] of Object.entries(OUT3)) consts[`OUT_${name}`] = u(v);
  const lines = Object.entries(consts).map(([key, v]) => `const ${key} = ${v};`);
  return `${lines.join("\n")}
${COMMON3}`;
}

const COMMON3 = /* wgsl */ `
fn lowbias32(v: u32) -> u32 {
  var x = v;
  x ^= x >> 16u;
  x *= 0x7feb352du;
  x ^= x >> 15u;
  x *= 0x846ca68bu;
  x ^= x >> 16u;
  return x;
}
fn cell_base(step: u32, cell: u32) -> u32 {
  return lowbias32(cell ^ lowbias32(step ^ lowbias32(SEED)));
}
fn draw(base: u32, k: u32) -> u32 {
  return lowbias32(base ^ ((k + 1u) * GOLDEN));
}
fn mul_shr(a: u32, b: u32, s: u32) -> u32 {
  let mask = (1u << s) - 1u;
  return (a >> s) * b + (((a & mask) * b) >> s);
}
fn mul_frac(q: u32, k: u32, s: u32, rnd: u32) -> u32 {
  let mask = (1u << s) - 1u;
  let hi = (q >> s) * k;
  let lo = (q & mask) * k;
  var r = hi + (lo >> s);
  if ((lo & mask) > (rnd & mask)) { r += 1u; }
  return r;
}
// Slab neighbour: x and y wrap, z does not; a z outside [0, TILE_D) is OUTSIDE (never a valid cell).
fn nb3(x: u32, y: u32, z: u32, dx: i32, dy: i32, dz: i32) -> u32 {
  let zz = i32(z) + dz;
  if (zz < 0 || zz >= i32(TILE_D)) { return OUTSIDE; }
  let xx = u32((i32(x) + dx + i32(TILE_W)) % i32(TILE_W));
  let yy = u32((i32(y) + dy + i32(TILE_H)) % i32(TILE_H));
  return (u32(zz) * TILE_H + yy) * TILE_W + xx;
}
// The light entering layer 0 of column (x, y): RefSim.light restricted to uniform and gradient, one tile.
fn light_surface(x: u32, y: u32, step: u32) -> u32 {
  var L = LIGHT_BASE;
  if (LIGHT_MODE == 0u) {
    L += i32(LIGHT_AMP);
  } else {
    L += i32((LIGHT_AMP * y) / (TILE_H - 1u));
  }
  if (SEASON_PERIOD > 0u) {
    let period = max(SEASON_PERIOD, 1u); // avoid const-eval x/0 when disabled
    let ph = ((step % period) * 512u) / period;
    let tri = abs(i32(ph) - 256);
    L += (SEASON_AMP * tri) >> 8u;
  }
  return u32(clamp(L, 0, 255));
}
// Cell-in-bounds guard shared by the per-cell passes.
fn in_slab(g: vec3<u32>) -> bool { return g.x < TILE_W && g.y < TILE_H && g.z < TILE_D; }
fn cell_index(g: vec3<u32>) -> u32 { return (g.z * TILE_H + g.y) * TILE_W + g.x; }
`;

const SM = AFF3_SW;

export function affinityShader3(c: WorldConfig): string {
  const k = buildKernel3(3);
  const lines: string[] = [];
  for (let t = 0; t < k.count; t++) {
    const dx = k.taps[t * 4], dy = k.taps[t * 4 + 1], dz = k.taps[t * 4 + 2], w = k.taps[t * 4 + 3];
    lines.push(`  conv += ${w}u * sm[b + ${(dz * SM[1] + dy) * SM[0] + dx}];`);
  }
  return /* wgsl */ `${prelude3(c)}
@group(0) @binding(0) var<storage, read> cells: array<u32>;
@group(0) @binding(1) var<storage, read> genome: array<u32>;
@group(0) @binding(2) var<storage, read_write> U: array<i32>;

const SWX = ${SM[0]}u; const SWY = ${SM[1]}u;
const SMN = ${AFF3_SMN}u;
var<workgroup> sm: array<u32, ${AFF3_SMN}>;

fn growth(u: u32, mu: u32, sigma: u32) -> i32 {
  let diff = select(mu - u, u - mu, u > mu);
  let dd = diff * diff;
  let s9 = 9u * sigma * sigma;
  if (dd >= s9) { return -256; }
  let xx = ((s9 - dd) << 8u) / s9;
  let y = (xx * xx) >> 8u;
  let z = (y * y) >> 8u;
  return 2 * i32(z) - 256;
}

@compute @workgroup_size(${WG3[0]}, ${WG3[1]}, ${WG3[2]})
fn main(@builtin(local_invocation_id) lid: vec3<u32>, @builtin(workgroup_id) wid: vec3<u32>,
        @builtin(local_invocation_index) li: u32) {
  let ox = wid.x * ${WG3[0]}u;
  let oy = wid.y * ${WG3[1]}u;
  let oz = wid.z * ${WG3[2]}u;
  for (var k = li; k < SMN; k += ${WG3[0] * WG3[1] * WG3[2]}u) {
    let tx = k % SWX;
    let ty = (k / SWX) % SWY;
    let tz = k / (SWX * SWY);
    let gx = (ox + tx + TILE_W - 3u) % TILE_W;
    let gy = (oy + ty + TILE_H - 3u) % TILE_H;
    let gz = i32(oz + tz) - 3;
    if (gz < 0 || gz >= i32(TILE_D)) {
      sm[k] = 0u;
    } else {
      let j = (u32(gz) * TILE_H + gy) * TILE_W + gx;
      sm[k] = min(cells[CH_B + j] + cells[CH_P + j], 16383u);
    }
  }
  workgroupBarrier();
  let x = ox + lid.x;
  let y = oy + lid.y;
  let z = oz + lid.z;
  if (x >= TILE_W || y >= TILE_H || z >= TILE_D) { return; }
  let b = i32(((lid.z + 3u) * SWY + (lid.y + 3u)) * SWX + lid.x + 3u);
  var conv = 0u;
${lines.join("\n")}
  let i = (z * TILE_H + y) * TILE_W + x;
  let uq = conv / KSUM;
  let uu = min((uq * 1024u) / MASS_UNIT, 4095u);
  var mu = DEF_MU;
  var sigma = DEF_SIGMA;
  if (!NEUTRAL && (genome[G_LIN_HI + i] | genome[G_LIN_LO + i]) != 0u) {
    let p0 = genome[G_PARAM0 + i];
    mu = p0 & 0xffffu;
    sigma = p0 >> 16u;
  }
  U[i] = growth(uu, min(mu, 4095u), clamp(sigma, 1u, 1023u));
}
`;
}

export function flowShader3(c: WorldConfig): string {
  return /* wgsl */ `${prelude3(c)}
@group(0) @binding(0) var<storage, read> cells: array<u32>;
@group(0) @binding(1) var<storage, read> genome: array<u32>;
@group(0) @binding(2) var<storage, read> U: array<i32>;
@group(0) @binding(3) var<storage, read_write> disp: array<u32>;

fn m(j: u32) -> i32 { return i32(min(cells[CH_B + j] + cells[CH_P + j], 16383u)); }
// Neighbour with x, y wrapped and z clamped into the slab (replicate padding at the walls).
fn nbc(x: u32, y: u32, z: u32, a: i32, b: i32, c: i32) -> u32 {
  let zz = u32(clamp(i32(z) + c, 0, i32(TILE_D) - 1));
  let xx = u32((i32(x) + a + i32(TILE_W)) % i32(TILE_W));
  let yy = u32((i32(y) + b + i32(TILE_H)) % i32(TILE_H));
  return (zz * TILE_H + yy) * TILE_W + xx;
}

@compute @workgroup_size(${WG3[0]}, ${WG3[1]}, ${WG3[2]})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (!in_slab(gid)) { return; }
  let x = gid.x;
  let y = gid.y;
  let z = gid.z;
  let i = cell_index(gid);
  var gUx = 0; var gUy = 0; var gUz = 0;
  var gMx = 0; var gMy = 0; var gMz = 0;
  for (var c = -1; c <= 1; c++) {
    for (var b = -1; b <= 1; b++) {
      for (var a = -1; a <= 1; a++) {
        let j = nbc(x, y, z, a, b, c);
        let fu = U[j];
        let fm = m(j);
        // Sobel numerators: sum over taps of (axis offset) * (smoothing weights of the other two axes) * f.
        let sx = (2 - abs(b)) * (2 - abs(c));
        let sy = (2 - abs(a)) * (2 - abs(c));
        let sz = (2 - abs(a)) * (2 - abs(b));
        gUx += a * sx * fu; gMx += a * sx * fm;
        gUy += b * sy * fu; gMy += b * sy * fm;
        gUz += c * sz * fu; gMz += c * sz * fm;
      }
    }
  }
  gUx = gUx / 4; gUy = gUy / 4; gUz = gUz / 4;
  gMx = gMx / 4; gMy = gMy / 4; gMz = gMz / 4;
  let Mi = u32(m(i));
  var alpha = 256;
  if (Mi < THETA) { alpha = i32((Mi * Mi * 256u) / (THETA * THETA)); }
  let Fx = ((256 - alpha) * gUx) / 2048 - (alpha * gMx) / MASS_DIV;
  let Fy = ((256 - alpha) * gUy) / 2048 - (alpha * gMy) / MASS_DIV;
  let Fz = ((256 - alpha) * gUz) / 2048 - (alpha * gMz) / MASS_DIV;
  var dx = (DT_Q * Fx) / 1024;
  var dy = (DT_Q * Fy) / 1024;
  var dz = (DT_Q * Fz) / 1024;
  if (MOTILITY && (genome[G_LIN_HI + i] | genome[G_LIN_LO + i]) != 0u) {
    let mot = cells[CH_MOT + i];
    let gain = i32(select(genome[G_PARAM1 + i], REF_PARAM1, NEUTRAL) & 0xffu);
    dx += ((i32(mot & 0xffu) - 128) * gain) / 256;
    dy += ((i32((mot >> 8u) & 0xffu) - 128) * gain) / 256;
    dz += ((i32((mot >> 16u) & 0xffu) - 128) * gain) / 256;
  }
  dx = clamp(dx, -DMAX, DMAX);
  dy = clamp(dy, -DMAX, DMAX);
  dz = clamp(dz, -DMAX, DMAX);
  disp[i] = u32(dx + 64) | (u32(dy + 64) << 8u) | (u32(dz + 64) << 16u);
}
`;
}

export function transportShader3(c: WorldConfig): string {
  return /* wgsl */ `${prelude3(c)}
@group(0) @binding(0) var<storage, read> cells: array<u32>;
@group(0) @binding(1) var<storage, read> genome: array<u32>;
@group(0) @binding(2) var<storage, read> disp: array<u32>;
@group(0) @binding(3) var<storage, read_write> cellsOut: array<u32>;
@group(0) @binding(4) var<storage, read_write> genomeOut: array<u32>;
@group(0) @binding(5) var<storage, read> ctrl: array<u32>;

fn w1d(d: i32, o: i32) -> u32 {
  let lo = max(d - HW, 64 * o - 32);
  let hi = min(d + HW, 64 * o + 32);
  return u32(max(hi - lo, 0));
}

// floor(q * w / D1), split form (w <= D1 <= 128).
fn share_d(q: u32, w: u32) -> u32 {
  return (q / D1) * w + ((q % D1) * w) / D1;
}
// Nested per-axis shares in the fixed x, y, z order.
fn share3(q: u32, wx: u32, wy: u32, wz: u32) -> u32 {
  return share_d(share_d(share_d(q, wx), wy), wz);
}

fn diff_out6(q: u32, d: u32, De: u32, baseS: u32, sp: u32) -> u32 {
  let rot = draw(baseS, RND_DIFF_ROT) % 6u;
  var portion = q / 6u;
  if (((d + rot) % 6u) < (q % 6u)) { portion += 1u; }
  return mul_frac(portion, De * 4u, 10u, draw(baseS, RND_DIFF + d * 3u + sp));
}

@compute @workgroup_size(${WG3[0]}, ${WG3[1]}, ${WG3[2]})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (!in_slab(gid)) { return; }
  let x = gid.x;
  let y = gid.y;
  let z = gid.z;
  let i = cell_index(gid);
  let step = ctrl[L_STEP];
  var inB = 0u;
  var inP = 0u;
  var inE = 0u;
  var srcs: array<u32, 27>;
  var lot: array<u32, 27>;
  for (var oz = -1; oz <= 1; oz++) {
    for (var oy = -1; oy <= 1; oy++) {
      for (var ox = -1; ox <= 1; ox++) {
        let k = u32((oz + 1) * 9 + (oy + 1) * 3 + (ox + 1));
        let s = nb3(x, y, z, ox, oy, oz);
        srcs[k] = s;
        if (s == OUTSIDE) { lot[k] = 0u; continue; }
        let d = disp[s];
        let dx = i32(d & 0xffu) - 64;
        let dy = i32((d >> 8u) & 0xffu) - 64;
        let dz = i32((d >> 16u) & 0xffu) - 64;
        let qB = cells[CH_B + s];
        let qP = cells[CH_P + s];
        let qE = cells[CH_E + s];
        var sB: u32;
        var sP: u32;
        var sE: u32;
        if (ox == 0 && oy == 0 && oz == 0) {
          sB = qB; sP = qP; sE = qE;
          for (var tz = -1; tz <= 1; tz++) {
            let zt = i32(z) + tz;
            if (zt < 0 || zt >= i32(TILE_D)) { continue; }
            let wz = w1d(dz, tz);
            if (wz == 0u) { continue; }
            for (var ty = -1; ty <= 1; ty++) {
              let wy = w1d(dy, ty);
              if (wy == 0u) { continue; }
              for (var tx = -1; tx <= 1; tx++) {
                if (tx == 0 && ty == 0 && tz == 0) { continue; }
                let wx = w1d(dx, tx);
                if (wx == 0u) { continue; }
                sB -= share3(qB, wx, wy, wz);
                sP -= share3(qP, wx, wy, wz);
                sE -= share3(qE, wx, wy, wz);
              }
            }
          }
        } else {
          let wx = w1d(dx, -ox);
          let wy = w1d(dy, -oy);
          let wz = w1d(dz, -oz);
          sB = share3(qB, wx, wy, wz);
          sP = share3(qP, wx, wy, wz);
          sE = share3(qE, wx, wy, wz);
        }
        inB += sB;
        inP += sP;
        inE += sE;
        lot[k] = sB + sP;
      }
    }
  }
  cellsOut[CH_B + i] = inB;
  cellsOut[CH_P + i] = inP;
  cellsOut[CH_E + i] = inE;

  let T = inB + inP;
  if (T == 0u) {
    genomeOut[G_LIN_HI + i] = 0u;
    genomeOut[G_LIN_LO + i] = 0u;
    cellsOut[CH_MOT + i] = MOT_ZERO;
  } else {
    let r = draw(cell_base(step, i), RND_LOTTERY) % T;
    var cum = 0u;
    var win = 0u;
    for (var j = 0u; j < 27u; j++) {
      cum += lot[j];
      if (cum > r) { win = j; break; }
    }
    let s = srcs[win];
    let hi = genome[G_LIN_HI + s];
    let lo = genome[G_LIN_LO + s];
    if (genomeOut[G_LIN_HI + i] != hi || genomeOut[G_LIN_LO + i] != lo || (hi | lo) == 0u) {
      for (var g = 0u; g < GENOME_CH; g++) { genomeOut[g * N + i] = genome[g * N + s]; }
    }
    cellsOut[CH_MOT + i] = cells[CH_MOT + s];
  }

  // Diffusion of A, C and S over six directions (+x, -x, +y, -y, +z, -z); a direction leaving the slab in z is absent.
  let baseT = cell_base(step, i);
  var nbs: array<u32, 6>;
  nbs[0] = nb3(x, y, z, 1, 0, 0);
  nbs[1] = nb3(x, y, z, -1, 0, 0);
  nbs[2] = nb3(x, y, z, 0, 1, 0);
  nbs[3] = nb3(x, y, z, 0, -1, 0);
  nbs[4] = nb3(x, y, z, 0, 0, 1);
  nbs[5] = nb3(x, y, z, 0, 0, -1);
  let Pt = cells[CH_P + i];
  for (var sp = 0u; sp < 3u; sp++) {
    var ch = CH_A;
    var Dsp = DIFF_A;
    if (sp == 1u) { ch = CH_C; Dsp = DIFF_C; }
    if (sp == 2u) { ch = CH_S; Dsp = DIFF_S; }
    let qt = cells[ch + i];
    var v = qt;
    for (var d = 0u; d < 6u; d++) {
      let nbi = nbs[d];
      if (nbi == OUTSIDE) { continue; }
      let Pn = cells[CH_P + nbi];
      var De = Dsp;
      if (sp < 2u) { De = (Dsp * GATE_K) / (GATE_K + Pt + Pn); }
      v -= diff_out6(qt, d, De, baseT, sp);
      let qn = cells[ch + nbi];
      v += diff_out6(qn, d ^ 1u, De, cell_base(step, nbi), sp);
    }
    cellsOut[ch + i] = v;
  }
}
`;
}

export function lightShader3(c: WorldConfig): string {
  return /* wgsl */ `${prelude3(c)}
@group(0) @binding(0) var<storage, read> cells: array<u32>;
@group(0) @binding(1) var<storage, read_write> light: array<u32>;
@group(0) @binding(2) var<storage, read> ctrl: array<u32>;

@compute @workgroup_size(${WGL3[0]}, ${WGL3[1]}, ${WGL3[2]})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = gid.x;
  let y = gid.y;
  if (x >= TILE_W || y >= TILE_H) { return; }
  let step = ctrl[L_STEP];
  var L = light_surface(x, y, step);
  light[y * TILE_W + x] = L;
  for (var z = 1u; z < TILE_D; z++) {
    let above = ((z - 1u) * TILE_H + y) * TILE_W + x;
    let mm = min(cells[CH_B + above] + cells[CH_P + above], 16383u);
    let T = (256u * LIGHT_K) / (LIGHT_K + mm);
    L = (L * T) >> 8u;
    light[(z * TILE_H + y) * TILE_W + x] = L;
  }
}
`;
}

export function reactShader3(c: WorldConfig): string {
  const rps = c.rpsTypes !== undefined;
  const rpsConstants = rps ? `const RPS_RATE = ${c.rpsRate}u;\nconst RPS_MIN = ${c.rpsMin}u;\nconst RND_RPS_KILL = 40u;\n` : "";
  const vacancy = rps ? `    if (living && RPS_RATE > 0u) {
      let t_own = (genome[G_PARAM1 + i] >> 8u) & 0xffu;
      var ndom = 0u;
      for (var dd = 0u; dd < 6u; dd++) {
        var ddx = 0; var ddy = 0; var ddz = 0;
        if (dd == 0u) { ddx = 1; } else if (dd == 1u) { ddx = -1; } else if (dd == 2u) { ddy = 1; } else if (dd == 3u) { ddy = -1; } else if (dd == 4u) { ddz = 1; } else { ddz = -1; }
        let jn = nb3(x, y, z, ddx, ddy, ddz);
        if (jn == OUTSIDE) { continue; }
        if (cells[CH_B + jn] >= RPS_MIN && ((cells[CH_MOT + jn] >> (24u + t_own)) & 1u) == 1u) { ndom += 1u; }
      }
      if (ndom > 0u && (draw(base, RND_RPS_KILL) & 0xffffu) < min(65536u, RPS_RATE * ndom)) {
        hadd(B * (E_B - E_C)); hadd(P * (E_P - E_C)); hadd(E);
        C += B + P; B = 0u; P = 0u; E = 0u;
      }
    }
` : "";

  return /* wgsl */ `${prelude3(c)}
${rpsConstants}@group(0) @binding(0) var<storage, read> cells: array<u32>;
@group(0) @binding(1) var<storage, read_write> genome: array<u32>;
@group(0) @binding(2) var<storage, read> U: array<i32>;
@group(0) @binding(3) var<storage, read_write> cellsOut: array<u32>;
@group(0) @binding(4) var<storage, read_write> ledger: array<atomic<u32>>;
@group(0) @binding(5) var<storage, read_write> events: array<u32>;
@group(0) @binding(6) var<storage, read_write> roles: array<u32>;
@group(0) @binding(7) var<storage, read> light: array<u32>;

// 64-bit (lo, hi) workgroup accumulators: per-cell values stay below 2^32
// under the state bounds, but workgroup sums may not.
// Layout: [light lo, hi, heat lo, hi, flux0 lo, hi, ...].
var<workgroup> wg: array<atomic<u32>, ${4 + 2 * FLUX_COUNT}>;
// Per-cell heat as a 64-bit (lo, hi) pair.
var<private> heatLo: u32;
var<private> heatHi: u32;

fn hadd(v: u32) {
  let o = heatLo;
  heatLo = o + v;
  if (heatLo < o) { heatHi += 1u; }
}

fn wg_add(k: u32, v: u32) {
  if (v == 0u) { return; }
  let o = atomicAdd(&wg[k], v);
  if (o + v < o) { atomicAdd(&wg[k + 1u], 1u); }
}

// floor(B*K/(B+K)) = K - ceil(K^2/(B+K)); exact and overflow-free for K <= 65535.
fn cat(B: u32) -> u32 {
  if (B == 0u) { return 0u; }
  let D = B + K_CAT_HALF;
  let kk = K_CAT_HALF * K_CAT_HALF;
  var cl = kk / D;
  if (kk % D != 0u) { cl += 1u; }
  return B - (K_CAT_HALF - cl);
}
fn sat(v: u32) -> i32 { return i32(min(v, 127u)); }
fn cap24(v: u32) -> u32 { return min(v, 0xffffffu); }
fn wbyte(words: ptr<function, array<u32, ${NN_WORDS3}>>, b: u32) -> i32 {
  return extractBits(bitcast<i32>((*words)[b >> 2u]), (b & 3u) * 8u, 8u);
}

fn add_hi(hi: u32, v: u32) {
  if (v == 0u) { return; }
  let oh = atomicAdd(&ledger[hi], v);
  // A wrapped high word means the 64-bit total overflowed: sticky flag.
  if (oh + v < oh) { atomicOr(&ledger[L_FLAGS], 1u); }
}
fn add64(lo: u32, hi: u32, v: u32) {
  if (v == 0u) { return; }
  let old = atomicAdd(&ledger[lo], v);
  if (old + v < old) { add_hi(hi, 1u); }
}

fn mutate(i: u32, which: u32, deltaRnd: u32) {
  let slot = which % (NN_BYTES + 3u);
  var delta = i32(deltaRnd % u32(2 * MUT_STEP + 1)) - MUT_STEP;
  if (delta == 0) { delta = 1; }
  if (slot < NN_BYTES) {
    let wi = (G_W0 + (slot >> 2u)) * N + i;
    let sh = (slot & 3u) * 8u;
    let word = genome[wi];
    let v = clamp(extractBits(bitcast<i32>(word), sh, 8u) + delta, -127, 127);
    genome[wi] = (word & ~(0xffu << sh)) | ((u32(v) & 0xffu) << sh);
  } else if (slot == NN_BYTES) {
    let p0 = genome[G_PARAM0 + i];
    let mu = clamp(i32(p0 & 0xffffu) + delta, 16, 4095);
    genome[G_PARAM0 + i] = (p0 & 0xffff0000u) | u32(mu);
  } else if (slot == NN_BYTES + 1u) {
    let p0 = genome[G_PARAM0 + i];
    var sd = delta >> 2u;
    if (sd == 0) { sd = select(-1, 1, delta > 0); }
    let sigma = clamp(i32(p0 >> 16u) + sd, 2, 1023);
    genome[G_PARAM0 + i] = (p0 & 0xffffu) | (u32(sigma) << 16u);
  } else {
    let p1 = genome[G_PARAM1 + i];
    let gain = clamp(i32(p1 & 0xffu) + delta, 0, 255);
    genome[G_PARAM1 + i] = (p1 & 0xffffff00u) | u32(gain);
  }
}

@compute @workgroup_size(${WG3[0]}, ${WG3[1]}, ${WG3[2]})
fn main(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(local_invocation_index) lid: u32) {
  let x = gid.x;
  let y = gid.y;
  let z = gid.z;
  var lightIn = 0u;
  heatLo = 0u;
  heatHi = 0u;
  var F: array<u32, ${FLUX_COUNT}>;
  if (in_slab(gid)) {
    let i = cell_index(gid);
    let step = atomicLoad(&ledger[L_STEP]);
    let base = cell_base(step, i);
    var A = cells[CH_A + i];
    var B = cells[CH_B + i];
    var C = cells[CH_C + i];
    var P = cells[CH_P + i];
    var E = cells[CH_E + i];
    var S = cells[CH_S + i];
    var mot = MOT_ZERO;
    let L = light[i];
    var newB = 0u;
    let living = (genome[G_LIN_HI + i] | genome[G_LIN_LO + i]) != 0u;
    if (E > POOL_MAX3) { hadd(E - POOL_MAX3); E = POOL_MAX3; }
    if (S > POOL_MAX3) { hadd(S - POOL_MAX3); S = POOL_MAX3; }

${vacancy}    if (living && B > 0u) {
      var words: array<u32, ${NN_WORDS3}>;
      if (NEUTRAL) {
        words = REF_W;
      } else {
        for (var w = 0u; w < NN_WORDS; w++) { words[w] = genome[(G_W0 + w) * N + i]; }
      }
      // Signal neighbours: an outside one (above the surface, below the floor) reads the cell's own capped S.
      let Sown = i32(cap24(cells[CH_S + i]));
      let Se = i32(cap24(cells[CH_S + nb3(x, y, z, 1, 0, 0)]));
      let Sw = i32(cap24(cells[CH_S + nb3(x, y, z, -1, 0, 0)]));
      let Ss = i32(cap24(cells[CH_S + nb3(x, y, z, 0, 1, 0)]));
      let Sn = i32(cap24(cells[CH_S + nb3(x, y, z, 0, -1, 0)]));
      let jb = nb3(x, y, z, 0, 0, 1);
      let ja = nb3(x, y, z, 0, 0, -1);
      var Sb = Sown;
      var Sa = Sown;
      if (jb != OUTSIDE) { Sb = i32(cap24(cells[CH_S + jb])); }
      if (ja != OUTSIDE) { Sa = i32(cap24(cells[CH_S + ja])); }
      var xin: array<i32, ${NN_I3}>;
      xin[0] = sat(A >> 2u);
      xin[1] = sat(B >> 2u);
      xin[2] = sat(C >> 2u);
      xin[3] = sat(P >> 2u);
      xin[4] = sat((cap24(E) * 16u) / (B + 1u));
      xin[5] = i32(L >> 1u);
      xin[6] = sat(S >> 2u);
      xin[7] = clamp(((Se - Sw) * SIGNAL_GAIN) / 4, -127, 127);
      xin[8] = clamp(((Ss - Sn) * SIGNAL_GAIN) / 4, -127, 127);
      xin[9] = clamp(U[i] / 2, -127, 127);
      xin[10] = clamp(((Sb - Sa) * SIGNAL_GAIN) / 4, -127, 127);
      var h: array<i32, ${NN_H3}>;
      for (var j = 0u; j < NN_H; j++) {
        var acc = wbyte(&words, B1_OFF + j) * 128;
        for (var k = 0u; k < NN_I; k++) { acc += wbyte(&words, W1_OFF + k * NN_H + j) * xin[k]; }
        h[j] = clamp(acc / 128, 0, 127);
      }
      var o: array<i32, ${NN_O3}>;
      for (var k = 0u; k < NN_O; k++) {
        var acc = wbyte(&words, B2_OFF + k) * 128;
        for (var j = 0u; j < NN_H; j++) { acc += wbyte(&words, W2_OFF + j * NN_O + k) * h[j]; }
        o[k] = clamp(acc / 128, -127, 127);
      }
      var r: array<u32, 6>;
      for (var k = 0u; k < 6u; k++) { r[k] = u32(max(o[k], 0)); }
      mot = u32(o[OUT_MX] + 128) | (u32(o[OUT_MY] + 128) << 8u) | (u32(o[OUT_MZ] + 128) << 16u);

      var t = mul_shr(cat(B), r[OUT_PHOTO], 7u);
      t = mul_shr(t, L, 8u);
      var q = min(A, mul_frac(t, K_PHOTO, 12u, draw(base, RND_PHOTO)));
      A -= q; B += q; newB += q; F[FX_PHOTO] = q;
      lightIn += q * (E_B - E_A);

      t = mul_shr(cat(B), r[OUT_RESP], 7u);
      q = min(B, mul_frac(t, K_RESP, 12u, draw(base, RND_RESP)));
      B -= q; C += q; E += q * (E_B - E_C); F[FX_RESP] = q;
      if (E > POOL_MAX3) { hadd(E - POOL_MAX3); E = POOL_MAX3; }

      t = mul_shr(cat(B), r[OUT_DECOMP], 7u);
      q = min(C, mul_frac(t, K_DECOMP, 12u, draw(base, RND_DECOMP)));
      C -= q; A += q; E += q * (E_C - E_A); F[FX_DECOMP] = q;
      if (E > POOL_MAX3) { hadd(E - POOL_MAX3); E = POOL_MAX3; }

      var g = E_B - E_A;
      t = mul_shr(cat(B), r[OUT_GROW], 7u);
      q = min(min(A, E / g), mul_frac(t, K_GROW, 12u, draw(base, RND_GROW)));
      A -= q; B += q; E -= q * g; newB += q; F[FX_GROW] = q;

      g = E_P - E_B;
      t = mul_shr(cat(B), r[OUT_BUILD], 7u);
      q = min(min(B, E / g), mul_frac(t, K_BUILD, 12u, draw(base, RND_BUILD)));
      B -= q; P += q; E -= q * g; F[FX_BUILD] = q;

      t = mul_shr(cat(B), r[OUT_EMIT], 7u);
      q = min(E, mul_frac(t, K_EMIT, 12u, draw(base, RND_EMIT)));
      E -= q; S += q; F[FX_EMIT] = q;
      if (S > POOL_MAX3) { hadd(S - POOL_MAX3); S = POOL_MAX3; }

      let sumr = r[0] + r[1] + r[2] + r[3] + r[4] + r[5];
      t = mul_shr(cat(B), sumr, 7u);
      let cost = mul_frac(t, K_COST, 16u, draw(base, RND_COST)) + mul_frac(B, K_MAINT, 16u, draw(base, RND_MAINT));
      if (E >= cost) {
        E -= cost;
        hadd(cost);
      } else {
        let deficit = cost - E;
        hadd(E);
        E = 0u;
        q = min(B, deficit);
        B -= q; C += q; F[FX_STARVE] = q;
        hadd(q * (E_B - E_C));
      }

      if (newB > 0u && MUT_CAP > 0u) {
        var p = 0xffffffffu;
        if (newB <= MUT_CAP) { p = newB * MUT_RATE; }
        if (draw(base, RND_MUT) < p) {
          let parentHi = genome[G_LIN_HI + i];
          let parentLo = genome[G_LIN_LO + i];
          mutate(i, draw(base, RND_MUT_WHICH), draw(base, RND_MUT_DELTA));
          let childLo = i;
          genome[G_LIN_HI + i] = step + 1u;
          genome[G_LIN_LO + i] = childLo;
          // Counters saturate (sticky flag) instead of wrapping: at most one
          // increment per cell per dispatch, so checking at 2^31 cannot overshoot 2^32.
          if (atomicLoad(&ledger[L_EVENTS]) < 0x80000000u) {
            let slot = atomicAdd(&ledger[L_EVENTS], 1u);
            if (slot < EVENT_CAP) {
              events[slot * EVENT_WORDS] = step + 1u;
              events[slot * EVENT_WORDS + 1u] = childLo;
              events[slot * EVENT_WORDS + 2u] = parentHi;
              events[slot * EVENT_WORDS + 3u] = parentLo;
            } else if (atomicLoad(&ledger[L_DROPPED]) < 0x80000000u) {
              atomicAdd(&ledger[L_DROPPED], 1u);
            }
          } else {
            atomicOr(&ledger[L_FLAGS], 2u);
          }
        }
      }
    }

    var q = mul_frac(P, K_PDECAY, 16u, draw(base, RND_PDECAY));
    P -= q; C += q; hadd(q * (E_P - E_C)); F[FX_PDECAY] = q;
    q = mul_frac(B, K_BDECAY, 16u, draw(base, RND_BDECAY));
    B -= q; C += q; hadd(q * (E_B - E_C)); F[FX_BDECAY] = q;
    q = mul_frac(E, K_ELEAK, 16u, draw(base, RND_ELEAK));
    E -= q; hadd(q);
    q = mul_frac(S, K_SDECAY, 16u, draw(base, RND_SDECAY));
    S -= q; hadd(q);
    let ta = mul_frac(C, L, 8u, draw(base, RND_ABIO1));
    q = min(C, mul_frac(ta, K_ABIO, 16u, draw(base, RND_ABIO2)));
    C -= q; A += q; hadd(q * (E_C - E_A)); F[FX_ABIO] = q;

    if (living && B == 0u && P == 0u) {
      genome[G_LIN_HI + i] = 0u;
      genome[G_LIN_LO + i] = 0u;
    }
    cellsOut[CH_A + i] = A;
    cellsOut[CH_B + i] = B;
    cellsOut[CH_C + i] = C;
    cellsOut[CH_P + i] = P;
    cellsOut[CH_E + i] = E;
    cellsOut[CH_S + i] = S;
${rps ? `    var mm = 0u;
    if ((genome[G_LIN_HI + i] | genome[G_LIN_LO + i]) != 0u) { mm = (genome[G_PARAM1 + i] >> 16u) & 0xffu; }
    cellsOut[CH_MOT + i] = mot | (mm << 24u);` : "    cellsOut[CH_MOT + i] = mot;"}
    roles[i * 2u] = min(F[FX_PHOTO], 0xffffu) | (min(F[FX_GROW], 0xffffu) << 16u);
    roles[i * 2u + 1u] = min(F[FX_DECOMP], 0xffffu) | (min(F[FX_RESP], 0xffffu) << 16u);
  }
  wg_add(0u, lightIn);
  wg_add(2u, heatLo);
  if (heatHi > 0u) { atomicAdd(&wg[3], heatHi); }
  for (var k = 0u; k < FLUX_N; k++) { wg_add(4u + 2u * k, F[k]); }
  workgroupBarrier();
  if (lid == 0u) {
    add64(L_LIGHT_LO, L_LIGHT_HI, atomicLoad(&wg[0]));
    add_hi(L_LIGHT_HI, atomicLoad(&wg[1]));
    add64(L_HEAT_LO, L_HEAT_HI, atomicLoad(&wg[2]));
    add_hi(L_HEAT_HI, atomicLoad(&wg[3]));
  } else if (lid <= FLUX_N) {
    let k = lid - 1u;
    add64(L_FLUX + 2u * k, L_FLUX + 2u * k + 1u, atomicLoad(&wg[4u + 2u * k]));
    add_hi(L_FLUX + 2u * k + 1u, atomicLoad(&wg[5u + 2u * k]));
  }
}
`;
}

export function statsShader3(c: WorldConfig): string {
  return /* wgsl */ `${prelude3(c)}
@group(0) @binding(0) var<storage, read> cells: array<u32>;
@group(0) @binding(1) var<storage, read> genome: array<u32>;
@group(0) @binding(2) var<storage, read_write> stats: array<atomic<u32>>;

var<workgroup> acc: array<atomic<u32>, 14>; // 6 channel (lo, hi) pairs, living, dense

@compute @workgroup_size(${WG3[0]}, ${WG3[1]}, ${WG3[2]})
fn main(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(local_invocation_index) lid: u32) {
  if (in_slab(gid)) {
    let i = cell_index(gid);
    for (var ch = 0u; ch < 6u; ch++) {
      let v = cells[ch * N + i];
      if (v > 0u) {
        let o = atomicAdd(&acc[2u * ch], v);
        if (o + v < o) { atomicAdd(&acc[2u * ch + 1u], 1u); }
      }
    }
    if ((genome[G_LIN_HI + i] | genome[G_LIN_LO + i]) != 0u) { atomicAdd(&acc[12], 1u); }
    if (cells[CH_B + i] + cells[CH_P + i] >= 64u) { atomicAdd(&acc[13], 1u); }
  }
  workgroupBarrier();
  if (lid < 6u) {
    let v = atomicLoad(&acc[2u * lid]);
    let old = atomicAdd(&stats[lid * 2u], v);
    if (old + v < old) { atomicAdd(&stats[lid * 2u + 1u], 1u); }
    atomicAdd(&stats[lid * 2u + 1u], atomicLoad(&acc[2u * lid + 1u]));
  } else if (lid < 8u) {
    atomicAdd(&stats[12u + lid - 6u], atomicLoad(&acc[12u + lid - 6u]));
  }
}
`;
}
