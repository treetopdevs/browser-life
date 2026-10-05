// WGSL kernels. A line-for-line port of packages/sim-ref/src/step.ts; any
// change to the rules must be made in both places and pass the golden tests.

import {
  B1_OFF,
  B2_OFF,
  CELL_CHANNELS,
  CH,
  EVENT_WORDS,
  G,
  GENOME_CHANNELS,
  GOLDEN,
  LEDGER,
  NN_BYTES,
  NN_H,
  NN_I,
  NN_O,
  NN_WORDS,
  OUT,
  RND,
  U32_MAX,
  W1_OFF,
  W2_OFF,
  POOL_MAX,
  DEFAULT_K_ADHESION,
  RING_CELL_BITS,
  RING_CELL_MASK,
  FLUX_COUNT,
  FLUX_NAMES,
  encodeGenome,
  generalistGenome,
  buildKernel,
  cellCount,
  lightModeId,
  worldW,
  worldH,
  type WorldConfig,
} from "@bl/schema";

export const WG = 8;

const u = (v: number) => `${v >>> 0}u`;
const i = (v: number) => `${v | 0}i`;

export function prelude(c: WorldConfig): string {
  const n = cellCount(c);
  const k = buildKernel(c.kernelRadius);
  const consts: Record<string, string> = {
    N: u(n),
    WORLD_W: u(worldW(c)),
    WORLD_H: u(worldH(c)),
    TILE_W: u(c.tileW),
    TILE_H: u(c.tileH),
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
    D2: u(4 * (32 + c.spread) ** 2),
    DMAX: i(64 - c.spread),
    DEF_MU: u(c.defaultMu),
    DEF_SIGMA: u(c.defaultSigma),
    DIFF_A: u(c.diffA),
    DIFF_C: u(c.diffC),
    DIFF_S: u(c.diffS),
    GATE_K: u(c.gateK),
    K_CAT_HALF: u(c.kCatHalf),
    POOL_MAX: u(POOL_MAX),
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
    GENOME_CH: u(GENOME_CHANNELS),
    NN_I: u(NN_I),
    NN_H: u(NN_H),
    NN_O: u(NN_O),
    NN_BYTES: u(NN_BYTES),
    NN_WORDS: u(NN_WORDS),
    W1_OFF: u(W1_OFF),
    B1_OFF: u(B1_OFF),
    W2_OFF: u(W2_OFF),
    B2_OFF: u(B2_OFF),
    MOT_ZERO: u(128 | (128 << 8)),
    L_LIGHT_LO: u(LEDGER.LIGHT_LO),
    L_LIGHT_HI: u(LEDGER.LIGHT_HI),
    L_HEAT_LO: u(LEDGER.HEAT_LO),
    L_HEAT_HI: u(LEDGER.HEAT_HI),
    L_EVENTS: u(LEDGER.EVENTS),
    L_DROPPED: u(LEDGER.EVENTS_DROPPED),
    L_STEP: u(LEDGER.STEP),
    L_FLAGS: u(LEDGER.FLAGS),
    EVENT_WORDS: u(EVENT_WORDS),
  };
  consts.NEUTRAL = c.neutral ? "true" : "false";
  consts.MOTILITY = c.motility === false ? "false" : "true";
  consts.POLYMER_TRANSPORT = c.polymerTransport === false ? "false" : "true";
  consts.POLYMER_DRAG = c.polymerDrag === true ? "true" : "false";
  consts.ADHESION = c.adhesion === true ? "true" : "false";
  consts.K_ADHESION = i(c.kAdhesion ?? DEFAULT_K_ADHESION);
  // See WorldConfig.ringNamespace / packLineageLo (@bl/schema): a mutation's
  // childLo packs the ring namespace into the top RING_NAMESPACE_BITS bits
  // when configured, unchanged (just the cell index) otherwise -- the
  // `select` at the mutation site below picks the unnamespaced branch
  // whenever HAS_RING_NAMESPACE is false, so an unnamespaced config mints
  // exactly the id it always has.
  consts.HAS_RING_NAMESPACE = c.ringNamespace !== undefined ? "true" : "false";
  consts.RING_NAMESPACE = u(c.ringNamespace ?? 0);
  consts.RING_CELL_SHIFT = u(RING_CELL_BITS);
  consts.RING_CELL_MASK = u(RING_CELL_MASK);
  consts.L_FLUX = u(LEDGER.FLUX);
  consts.FLUX_N = u(FLUX_COUNT);
  FLUX_NAMES.forEach((name, k) => (consts[`FX_${name.toUpperCase()}`] = u(k)));
  const ref = encodeGenome(generalistGenome(c.defaultMu, c.defaultSigma), 0, 0);
  consts.REF_PARAM1 = u(ref[G.PARAM1]);
  consts.REF_W = `array<u32, ${NN_WORDS}>(${Array.from(ref.subarray(G.W0)).map(u).join(", ")})`;
  for (const [name, v] of Object.entries(RND)) consts[`RND_${name}`] = u(v);
  for (const [name, v] of Object.entries(OUT)) consts[`OUT_${name}`] = u(v);
  void CELL_CHANNELS;
  const lines = Object.entries(consts).map(([k, v]) => `const ${k} = ${v};`);
  return `${lines.join("\n")}
${COMMON}`;
}

const COMMON = /* wgsl */ `
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
fn nb(x: u32, y: u32, dx: i32, dy: i32) -> u32 {
  let tx = x / TILE_W;
  let ty = y / TILE_H;
  let lx = u32(i32(x - tx * TILE_W) + dx + i32(TILE_W)) % TILE_W;
  let ly = u32(i32(y - ty * TILE_H) + dy + i32(TILE_H)) % TILE_H;
  return (ty * TILE_H + ly) * WORLD_W + tx * TILE_W + lx;
}
fn light_at(x: u32, y: u32, step: u32) -> u32 {
  let lx = x % TILE_W;
  let ly = y % TILE_H;
  var L = LIGHT_BASE;
  if (LIGHT_MODE == 0u) {
    L += i32(LIGHT_AMP);
  } else if (LIGHT_MODE == 1u) {
    L += i32((LIGHT_AMP * ly) / (TILE_H - 1u));
  } else if ((((lx >> 5u) + (ly >> 5u)) & 1u) == 0u) {
    L += i32(LIGHT_AMP);
  }
  if (SEASON_PERIOD > 0u) {
    let period = max(SEASON_PERIOD, 1u); // avoid const-eval x/0 when disabled
    let ph = ((step % period) * 512u) / period;
    let tri = abs(i32(ph) - 256);
    L += (SEASON_AMP * tri) >> 8u;
  }
  return u32(clamp(L, 0, 255));
}
`;

const at = (xy: string) => /* wgsl */ `
  let x = ${xy}.x;
  let y = ${xy}.y;
  if (x >= WORLD_W || y >= WORLD_H) { return; }
  let i = y * WORLD_W + x;`;

/** Affinity uses 2x2 register blocking when tiles are multiples of 16. */
export const affinityBlock = (c: WorldConfig) => (c.tileW % 16 === 0 && c.tileH % 16 === 0 ? 2 : 1);

export function affinityShader(c: WorldConfig): string {
  // Shared-memory tile with the halo, then a fully unrolled convolution with
  // compile-time taps. Each thread computes BxB cells, reusing every shared
  // load across the cells whose kernel covers it. Tiles are multiples of the
  // block, so a workgroup never straddles two independent worlds. Integer
  // sums are order-independent, so the result is identical to the reference.
  const R = c.kernelRadius;
  const Bk = affinityBlock(c);
  const CB = WG * Bk; // cells per workgroup side
  const SW = CB + 2 * R;
  const k = buildKernel(R);
  const wmap = new Map<string, number>();
  for (let t = 0; t < k.count; t++) wmap.set(`${k.taps[t * 4]},${k.taps[t * 4 + 1]}`, k.taps[t * 4 + 2]);
  const lines: string[] = [];
  for (let dy = -R; dy <= R + Bk - 1; dy++) {
    for (let dx = -R; dx <= R + Bk - 1; dx++) {
      const terms: string[] = [];
      for (let cy = 0; cy < Bk; cy++)
        for (let cx = 0; cx < Bk; cx++) {
          const w = wmap.get(`${dx - cx},${dy - cy}`);
          if (w) terms.push(`conv[${cy * Bk + cx}] += ${w}u * v;`);
        }
      if (!terms.length) continue;
      lines.push(`  { let v = sm[b + ${dy * SW + dx}]; ${terms.join(" ")} }`);
    }
  }
  return /* wgsl */ `${prelude(c)}
@group(0) @binding(0) var<storage, read> cells: array<u32>;
@group(0) @binding(1) var<storage, read> genome: array<u32>;
@group(0) @binding(2) var<storage, read_write> U: array<i32>;

const R = ${R}u;
const SW = ${SW}u;
const BK = ${Bk}u;
var<workgroup> sm: array<u32, ${SW * SW}>;

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

@compute @workgroup_size(${WG}, ${WG})
fn main(@builtin(local_invocation_id) lid: vec3<u32>, @builtin(workgroup_id) wid: vec3<u32>,
        @builtin(local_invocation_index) li: u32) {
  let ox = wid.x * ${CB}u;
  let oy = wid.y * ${CB}u;
  for (var k = li; k < SW * SW; k += ${WG * WG}u) {
    let dx = i32(k % SW) - i32(R);
    let dy = i32(k / SW) - i32(R);
    let j = nb(ox, oy, dx, dy);
    sm[k] = min(cells[CH_B + j] + cells[CH_P + j], 16383u);
  }
  workgroupBarrier();
  let bx = ox + lid.x * BK;
  let by = oy + lid.y * BK;
  if (bx >= WORLD_W || by >= WORLD_H) { return; }
  let b = i32((lid.y * BK + R) * SW + lid.x * BK + R);
  var conv: array<u32, ${Bk * Bk}>;
${lines.join("\n")}
  for (var q = 0u; q < BK * BK; q++) {
    let x = bx + (q % BK);
    let y = by + (q / BK);
    let i = y * WORLD_W + x;
    let uq = conv[q] / KSUM;
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
}
`;
}

export function flowShader(c: WorldConfig): string {
  return /* wgsl */ `${prelude(c)}
@group(0) @binding(0) var<storage, read> cells: array<u32>;
@group(0) @binding(1) var<storage, read> genome: array<u32>;
@group(0) @binding(2) var<storage, read> U: array<i32>;
@group(0) @binding(3) var<storage, read_write> disp: array<u32>;

fn m(j: u32) -> i32 { return i32(min(cells[CH_B + j] + cells[CH_P + j], 16383u)); }
fn poly(j: u32) -> i32 { return i32(min(cells[CH_P + j], 16383u)); }

@compute @workgroup_size(${WG}, ${WG})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  ${at("gid")}
  let e = nb(x, y, 1, 0);
  let w = nb(x, y, -1, 0);
  let s = nb(x, y, 0, 1);
  let nn = nb(x, y, 0, -1);
  let ne = nb(x, y, 1, -1);
  let nw = nb(x, y, -1, -1);
  let se = nb(x, y, 1, 1);
  let sw = nb(x, y, -1, 1);
  let gUx = U[ne] + 2 * U[e] + U[se] - (U[nw] + 2 * U[w] + U[sw]);
  let gUy = U[sw] + 2 * U[s] + U[se] - (U[nw] + 2 * U[nn] + U[ne]);
  let gMx = m(ne) + 2 * m(e) + m(se) - (m(nw) + 2 * m(w) + m(sw));
  let gMy = m(sw) + 2 * m(s) + m(se) - (m(nw) + 2 * m(nn) + m(ne));
  let Mi = u32(m(i));
  var alpha = 256;
  if (Mi < THETA) { alpha = i32((Mi * Mi * 256u) / (THETA * THETA)); }
  var Fx = ((256 - alpha) * gUx) / 2048 - (alpha * gMx) / MASS_DIV;
  var Fy = ((256 - alpha) * gUy) / 2048 - (alpha * gMy) / MASS_DIV;
  // Adhesion (off by default): climb the local polymer gradient, same Sobel
  // shape as gU/gM but over P alone (and, like them, scaled by DT_Q below),
  // pulling a cell toward denser nearby P. Its effect on holding a moving
  // colony together is not demonstrated (see WorldConfig.adhesion in
  // packages/schema/src/config.ts).
  if (ADHESION) {
    let gPx = poly(ne) + 2 * poly(e) + poly(se) - (poly(nw) + 2 * poly(w) + poly(sw));
    let gPy = poly(sw) + 2 * poly(s) + poly(se) - (poly(nw) + 2 * poly(nn) + poly(ne));
    Fx += (K_ADHESION * gPx) / MASS_DIV;
    Fy += (K_ADHESION * gPy) / MASS_DIV;
  }
  var dx = (DT_Q * Fx) / 1024;
  var dy = (DT_Q * Fy) / 1024;
  if (MOTILITY && (genome[G_LIN_HI + i] | genome[G_LIN_LO + i]) != 0u) {
    let mot = cells[CH_MOT + i];
    let gain = i32(select(genome[G_PARAM1 + i], REF_PARAM1, NEUTRAL) & 0xffu);
    dx += ((i32(mot & 0xffu) - 128) * gain) / 256;
    dy += ((i32((mot >> 8u) & 0xffu) - 128) * gain) / 256;
  }
  dx = clamp(dx, -DMAX, DMAX);
  dy = clamp(dy, -DMAX, DMAX);
  disp[i] = u32(dx + 64) | (u32(dy + 64) << 8u);
}
`;
}

export function transportShader(c: WorldConfig): string {
  return /* wgsl */ `${prelude(c)}
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

fn share(q: u32, w: u32) -> u32 {
  return (q / D2) * w + ((q % D2) * w) / D2;
}

// The outgoing direction and draw belong to the source at both endpoints.
fn bound_share(q: u32, w: u32, sourceP: u32, baseS: u32, direction: u32, species: u32) -> u32 {
  let offer = share(q, w);
  if (!POLYMER_DRAG) { return offer; }
  let mobility = max(1u, 8192u / (32u + sourceP));
  return mul_frac(offer, mobility, 8u, draw(baseS, RND_POLYMER_DRAG + species * 9u + direction));
}

fn diff_out(q: u32, d: u32, De: u32, baseS: u32, sp: u32) -> u32 {
  let rot = baseS >> 30u;
  var portion = q >> 2u;
  if (((d + rot) & 3u) < (q & 3u)) { portion += 1u; }
  return mul_frac(portion, De * 4u, 10u, draw(baseS, RND_DIFF + d * 3u + sp));
}

@compute @workgroup_size(${WG}, ${WG})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  ${at("gid")}
  let step = ctrl[L_STEP];
  var inB = 0u;
  var inP = 0u;
  var inE = 0u;
  var srcs: array<u32, 9>;
  var lot: array<u32, 9>;
  var k = 0u;
  for (var oy = -1; oy <= 1; oy++) {
    for (var ox = -1; ox <= 1; ox++) {
      let s = nb(x, y, ox, oy);
      srcs[k] = s;
      let d = disp[s];
      let dx = i32(d & 0xffu) - 64;
      let dy = i32((d >> 8u) & 0xffu) - 64;
      let qB = cells[CH_B + s];
      let qP = cells[CH_P + s];
      let qE = cells[CH_E + s];
      var baseS = 0u;
      if (POLYMER_DRAG) { baseS = cell_base(step, s); }
      var sB: u32;
      var sP: u32;
      var sE: u32;
      if (ox == 0 && oy == 0) {
        sB = qB; sP = qP; sE = qE;
        for (var ty = -1; ty <= 1; ty++) {
          for (var tx = -1; tx <= 1; tx++) {
            if (tx == 0 && ty == 0) { continue; }
            let w = w1d(dx, tx) * w1d(dy, ty);
            if (w == 0u) { continue; }
            let direction = u32((ty + 1) * 3 + tx + 1);
            sB -= bound_share(qB, w, qP, baseS, direction, 0u);
            sP -= bound_share(qP, w, qP, baseS, direction, 1u);
            sE -= bound_share(qE, w, qP, baseS, direction, 2u);
          }
        }
      } else {
        let w = w1d(dx, -ox) * w1d(dy, -oy);
        let direction = u32((1 - oy) * 3 + 1 - ox);
        sB = bound_share(qB, w, qP, baseS, direction, 0u);
        sP = bound_share(qP, w, qP, baseS, direction, 1u);
        sE = bound_share(qE, w, qP, baseS, direction, 2u);
      }
      inB += sB;
      inP += sP;
      inE += sE;
      lot[k] = sB + sP;
      k++;
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
    for (var j = 0u; j < 9u; j++) {
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

  let baseT = cell_base(step, i);
  let nbs = array<u32, 4>(nb(x, y, 1, 0), nb(x, y, -1, 0), nb(x, y, 0, 1), nb(x, y, 0, -1));
  let Pt = cells[CH_P + i];
  for (var sp = 0u; sp < 3u; sp++) {
    var ch = CH_A;
    var D = DIFF_A;
    if (sp == 1u) { ch = CH_C; D = DIFF_C; }
    if (sp == 2u) { ch = CH_S; D = DIFF_S; }
    let qt = cells[ch + i];
    var v = qt;
    for (var d = 0u; d < 4u; d++) {
      let nbi = nbs[d];
      let Pn = cells[CH_P + nbi];
      var De = D;
      if (sp < 2u && POLYMER_TRANSPORT) { De = (D * GATE_K) / (GATE_K + Pt + Pn); }
      v -= diff_out(qt, d, De, baseT, sp);
      let qn = cells[ch + nbi];
      v += diff_out(qn, d ^ 1u, De, cell_base(step, nbi), sp);
    }
    cellsOut[ch + i] = v;
  }
}
`;
}

export function reactShader(c: WorldConfig): string {
  return /* wgsl */ `${prelude(c)}
@group(0) @binding(0) var<storage, read> cells: array<u32>;
@group(0) @binding(1) var<storage, read_write> genome: array<u32>;
@group(0) @binding(2) var<storage, read> U: array<i32>;
@group(0) @binding(3) var<storage, read_write> cellsOut: array<u32>;
@group(0) @binding(4) var<storage, read_write> ledger: array<atomic<u32>>;
@group(0) @binding(5) var<storage, read_write> events: array<u32>;
@group(0) @binding(6) var<storage, read_write> roles: array<u32>;

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
fn wbyte(words: ptr<function, array<u32, ${NN_WORDS}>>, b: u32) -> i32 {
  return extractBits(bitcast<i32>((*words)[b >> 2u]), (b & 3u) * 8u, 8u);
}

fn add_hi(hi: u32, v: u32) {
  if (v == 0u) { return; }
  let oh = atomicAdd(&ledger[hi], v);
  // A wrapped high word means the 64-bit total overflowed: sticky flag.
  if (oh + v < oh) { atomicOr(&ledger[L_FLAGS], ${1}u); }
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

@compute @workgroup_size(${WG}, ${WG})
fn main(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(local_invocation_index) lid: u32) {
  let x = gid.x;
  let y = gid.y;
  var lightIn = 0u;
  heatLo = 0u;
  heatHi = 0u;
  var F: array<u32, ${FLUX_COUNT}>;
  if (x < WORLD_W && y < WORLD_H) {
    let i = y * WORLD_W + x;
    let step = atomicLoad(&ledger[L_STEP]);
    let base = cell_base(step, i);
    var A = cells[CH_A + i];
    var B = cells[CH_B + i];
    var C = cells[CH_C + i];
    var P = cells[CH_P + i];
    var E = cells[CH_E + i];
    var S = cells[CH_S + i];
    var mot = MOT_ZERO;
    let L = light_at(x, y, step);
    var newB = 0u;
    let living = (genome[G_LIN_HI + i] | genome[G_LIN_LO + i]) != 0u;
    if (E > POOL_MAX) { hadd(E - POOL_MAX); E = POOL_MAX; }
    if (S > POOL_MAX) { hadd(S - POOL_MAX); S = POOL_MAX; }

    if (living && B > 0u) {
      var words: array<u32, ${NN_WORDS}>;
      if (NEUTRAL) {
        words = REF_W;
      } else {
        for (var w = 0u; w < NN_WORDS; w++) { words[w] = genome[(G_W0 + w) * N + i]; }
      }
      let Se = i32(cap24(cells[CH_S + nb(x, y, 1, 0)]));
      let Sw = i32(cap24(cells[CH_S + nb(x, y, -1, 0)]));
      let Ss = i32(cap24(cells[CH_S + nb(x, y, 0, 1)]));
      let Sn = i32(cap24(cells[CH_S + nb(x, y, 0, -1)]));
      var xin: array<i32, ${NN_I}>;
      xin[0] = sat(A >> 2u);
      xin[1] = sat(B >> 2u);
      xin[2] = sat(C >> 2u);
      xin[3] = sat(P >> 2u);
      xin[4] = sat((cap24(E) * 16u) / (B + 1u));
      xin[5] = i32(L >> 1u);
      xin[6] = sat(S >> 2u);
      xin[7] = clamp((Se - Sw) / 4, -127, 127);
      xin[8] = clamp((Ss - Sn) / 4, -127, 127);
      xin[9] = clamp(U[i] / 2, -127, 127);
      var h: array<i32, ${NN_H}>;
      for (var j = 0u; j < NN_H; j++) {
        var acc = wbyte(&words, B1_OFF + j) * 128;
        for (var k = 0u; k < NN_I; k++) { acc += wbyte(&words, W1_OFF + k * NN_H + j) * xin[k]; }
        h[j] = clamp(acc / 128, 0, 127);
      }
      var o: array<i32, ${NN_O}>;
      for (var k = 0u; k < NN_O; k++) {
        var acc = wbyte(&words, B2_OFF + k) * 128;
        for (var j = 0u; j < NN_H; j++) { acc += wbyte(&words, W2_OFF + j * NN_O + k) * h[j]; }
        o[k] = clamp(acc / 128, -127, 127);
      }
      var r: array<u32, 6>;
      for (var k = 0u; k < 6u; k++) { r[k] = u32(max(o[k], 0)); }
      mot = u32(o[OUT_MX] + 128) | (u32(o[OUT_MY] + 128) << 8u);

      var t = mul_shr(cat(B), r[OUT_PHOTO], 7u);
      t = mul_shr(t, L, 8u);
      var q = min(A, mul_frac(t, K_PHOTO, 12u, draw(base, RND_PHOTO)));
      A -= q; B += q; newB += q; F[FX_PHOTO] = q;
      lightIn += q * (E_B - E_A);

      t = mul_shr(cat(B), r[OUT_RESP], 7u);
      q = min(B, mul_frac(t, K_RESP, 12u, draw(base, RND_RESP)));
      B -= q; C += q; E += q * (E_B - E_C); F[FX_RESP] = q;
      if (E > POOL_MAX) { hadd(E - POOL_MAX); E = POOL_MAX; }

      t = mul_shr(cat(B), r[OUT_DECOMP], 7u);
      q = min(C, mul_frac(t, K_DECOMP, 12u, draw(base, RND_DECOMP)));
      C -= q; A += q; E += q * (E_C - E_A); F[FX_DECOMP] = q;
      if (E > POOL_MAX) { hadd(E - POOL_MAX); E = POOL_MAX; }

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
      if (S > POOL_MAX) { hadd(S - POOL_MAX); S = POOL_MAX; }

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
          // See WorldConfig.ringNamespace / packLineageLo (@bl/schema).
          let childLo = select(i, (RING_NAMESPACE << RING_CELL_SHIFT) | (i & RING_CELL_MASK), HAS_RING_NAMESPACE);
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
    cellsOut[CH_MOT + i] = mot;
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

export function tickShader(): string {
  return /* wgsl */ `
@group(0) @binding(0) var<storage, read_write> ledger: array<u32>;
@compute @workgroup_size(1)
fn main() { ledger[${LEDGER.STEP}u] += 1u; }
`;
}

export function lesionShader(c: WorldConfig): string {
  return /* wgsl */ `${prelude(c)}
struct Lesion { cx: u32, cy: u32, r: i32, pad: u32 }
@group(0) @binding(0) var<storage, read_write> cells: array<u32>;
@group(0) @binding(1) var<storage, read_write> genome: array<u32>;
@group(0) @binding(2) var<storage, read_write> ledger: array<atomic<u32>>;
@group(0) @binding(3) var<uniform> les: Lesion;

fn add_hi(hi: u32, v: u32) {
  if (v == 0u) { return; }
  let oh = atomicAdd(&ledger[hi], v);
  // A wrapped high word means the 64-bit total overflowed: sticky flag.
  if (oh + v < oh) { atomicOr(&ledger[L_FLAGS], ${1}u); }
}
fn add64(lo: u32, hi: u32, v: u32) {
  if (v == 0u) { return; }
  let old = atomicAdd(&ledger[lo], v);
  if (old + v < old) { add_hi(hi, 1u); }
}

@compute @workgroup_size(${WG}, ${WG})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let dx = i32(gid.x) - les.r;
  let dy = i32(gid.y) - les.r;
  if (dx > les.r || dy > les.r || dx * dx + dy * dy > les.r * les.r) { return; }
  let j = nb(les.cx, les.cy, dx, dy);
  let B = cells[CH_B + j];
  let P = cells[CH_P + j];
  let E = cells[CH_E + j];
  add64(L_HEAT_LO, L_HEAT_HI, B * (E_B - E_C));
  add64(L_HEAT_LO, L_HEAT_HI, P * (E_P - E_C));
  add64(L_HEAT_LO, L_HEAT_HI, E);
  cells[CH_C + j] += B + P;
  cells[CH_B + j] = 0u;
  cells[CH_P + j] = 0u;
  cells[CH_E + j] = 0u;
  cells[CH_MOT + j] = MOT_ZERO;
  genome[G_LIN_HI + j] = 0u;
  genome[G_LIN_LO + j] = 0u;
}
`;
}

export const STATS_WORDS = 16;
export const STATS = { SUMS: 0, LIVING: 12, DENSE: 13 } as const;

export function statsShader(c: WorldConfig): string {
  return /* wgsl */ `${prelude(c)}
@group(0) @binding(0) var<storage, read> cells: array<u32>;
@group(0) @binding(1) var<storage, read> genome: array<u32>;
@group(0) @binding(2) var<storage, read_write> stats: array<atomic<u32>>;

var<workgroup> acc: array<atomic<u32>, 14>; // 6 channel (lo, hi) pairs, living, dense

@compute @workgroup_size(${WG}, ${WG})
fn main(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(local_invocation_index) lid: u32) {
  if (gid.x < WORLD_W && gid.y < WORLD_H) {
    let i = gid.y * WORLD_W + gid.x;
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
