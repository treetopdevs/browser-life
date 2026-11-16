// Mycelium in a volume, rung R0: the WebGPU twin of tools/mycelium3d/world.ts.
//
// Contract: after the same number of steps, readbacks encode to the same bytes as the CPU reference (stateDigest
// equal), bit for bit, up to 65,536 particles, including the CPU's per-birth refusals when the particle-id or
// genotype-id space runs out, and steps past 2^32 (the step is a (lo, hi) pair, the PRNG keys on lo, which is the CPU's
// step mod 2^32). The CPU's throws are detected, not ported: a step started at 2^53 - 1, an event counter too close to
// 2^50 to step, and the lifetime ledger passing 2^50. Each sets an error bit and read() throws. Steps queued after such
// a step keep running until read(); the state is then unusable.
// No floating point anywhere in the step: every quantity is u32 or i32 with WGSL wrapping semantics, as in the CPU
// helpers (packages/schema/src/int.ts). The rules are in tools/mycelium3d/RULES.md.
//
// Follows the 2D twin (tools/mycelium/gpu.ts) and does not import it: one object owns the buffers and pipelines,
// step(n) queues work without waiting, read() waits and returns a full Mycelium3dState. Every config value is baked
// into the shader as a const, so a GpuMycelium3d is tied to one config; upload(state) takes any state with the same
// config (resume). What differs from 2D: 3D binning with the per-cell body matter, the light plane (one thread per
// column, top to bottom), 13 -> 8 -> 9 with MZ, the z clamp, the optional sinking (sends to scratch, then applied),
// and six-face diffusion with diffOut6 (a missing z face sends 0).
import { RND3 } from "@bl/schema";
import {
  B1_OFF3, B2_OFF3, createWorld, ID_MAX, LEDGER_MAX, MCAP, type Mycelium3dConfig, type Mycelium3dState, NN_BYTES3, NN_WEIGHTS3, POS_SHIFT, STEP_MAX,
  type Totals, W1_OFF3, W2_OFF3,
} from "./world.ts";

const WG = 256;
const GENOME_WORDS = NN_BYTES3 / 4;
/** Cell kernels run on a 2D grid of workgroups: at most this many along x (WebGPU allows 65535 per dimension). */
const GRID_X = 32768;

// ---- buffer layouts, shared by the shader (as consts) and the host ------------------------------------------

/** ctl words: scalars, then the per-step stat pairs, then the cumulative total pairs (lo, hi). */
const C = { n: 0, nextId: 1, nextGid: 2, step: 3, err: 4, surv: 5, wantTotal: 6, newGids: 7, stepHi: 8, cut: 9, stat: 16, tot: 32, words: 64 } as const;
/** Order of the seven counter pairs, same as Totals. */
const COUNTERS = ["lightIn", "heat", "births", "deaths", "refused", "contended", "mutations"] as const;
const ERR_LEDGER = 2, ERR_STEP = 4, ERR_COUNT = 8;
/** Particle planes in checkpoint order (world.ts PLANES). */
const PLANES = ["id", "parent", "gid", "x", "y", "z", "M", "E", "age"] as const;

/**
 * The field buffer's plane offsets in words. The persistent planes come first and are read back in one copy: A, C, P,
 * then (only with trailOwner) Z and Q. Then per-step scratch: CROWD, MB, R, TK (cleared each step, adjacent), the light
 * plane I, SENT (six words per cell: diffusion sends, and the sinking sends before them) and, with trailOwner, the claim
 * scratch W1, W2 (cleared each step, adjacent).
 */
export function fieldLayout3d(c: Pick<Mycelium3dConfig, "width" | "height" | "depth" | "trailOwner">) {
  const N = c.width * c.height * c.depth;
  const own = c.trailOwner !== undefined;
  const F = { A: 0, C: N, P: 2 * N, Z: 0, Q: 0, persist: 3 * N, CROWD: 0, MB: 0, R: 0, TK: 0, I: 0, SENT: 0, W1: 0, W2: 0, words: 0 };
  let w = 3 * N;
  if (own) { F.Z = w; F.Q = w + N; w += 2 * N; F.persist = w; }
  F.CROWD = w; F.MB = w + N; F.R = w + 2 * N; F.TK = w + 3 * N; w += 4 * N;
  F.I = w; w += N;
  F.SENT = w; w += 6 * N;
  if (own) { F.W1 = w; F.W2 = w + N; w += 2 * N; }
  F.words = w;
  return F;
}

function layouts(c: Mycelium3dConfig) {
  const N = c.width * c.height * c.depth, cap = c.maxParticles;
  const F = fieldLayout3d(c);
  // Particle buffer (one of two, ping-ponged): nine u32 planes of cap in checkpoint order, then genome words (49 per slot).
  const P = { ID: 0, PAR: cap, GID: 2 * cap, X: 3 * cap, Y: 4 * cap, Z: 5 * cap, M: 6 * cap, E: 7 * cap, AGE: 8 * cap, GEN: 9 * cap, words: (9 + GENOME_WORDS) * cap };
  // Per-step particle scratch: planes of cap words, three block-offset arrays of 256, then DISC and (only with trailOwner) CDEP.
  const names = ["CELL", "REQ", "GRANT", "MX", "MY", "MZ", "DREQ", "SPL", "ALIVE", "WANTS", "NOVEL", "LA", "LW", "LN"] as const;
  const T = Object.fromEntries(names.map((k, i) => [k, i * cap])) as Record<(typeof names)[number] | "BA" | "BW" | "BN" | "DISC" | "CDEP" | "words", number>;
  let w = names.length * cap;
  T.BA = w; T.BW = w + 256; T.BN = w + 512; w += 768;
  T.DISC = w; w += cap;
  T.CDEP = 0;
  if (c.trailOwner !== undefined) { T.CDEP = w; w += cap; }
  T.words = w;
  return { N, cap, F, P, T };
}

// ---- WGSL ----------------------------------------------------------------------------------------------------

function wgsl(c: Mycelium3dConfig): string {
  const { N, cap, F, P, T } = layouts(c);
  const u = (v: number) => `${v >>> 0}u`;
  const top = c.light << 8;
  // world.ts step(): an event counter above 2^50 - max(cells, maxParticles) cannot step.
  const room = LEDGER_MAX - Math.max(N, cap);
  const consts: Record<string, number> = {
    W: c.width, H: c.height, D: c.depth, WH: c.width * c.height, N, CAP: cap, SPANX: c.width << POS_SHIFT, SPANY: c.height << POS_SHIFT,
    ZMAX: (c.depth << POS_SHIFT) - 1, TOPC: N - c.width * c.height,
    SEED: c.seed, PSEED: (c.seed ^ 0x6d796331) >>> 0, DSEED: (c.seed ^ 0x64696666) >>> 0,
    EA: c.eA, MAXEAT: c.maxEat, BODYMAX: c.bodyMax, SPEED: c.speed, UPKEEP: c.upkeep, MOVECOST: c.moveCost,
    MASSUPK: 1 << (16 - c.massUpkeepShift), MAXDEP: c.maxDeposit, DEPCOST: c.depositCost, EXCK: 1 << (16 - c.excreteShift),
    SPLITE: c.splitEnergy, SPLITM: c.splitMatter, EMAX: c.energyMax, TOP: top, TOPD: Math.max(top, 1), LGRAD: c.lightPattern === "gradient" ? 1 : 0,
    LK: c.lightK, LNUM: 256 * c.lightK, MCAP,
    PDECAY: c.pDecay, DIFFA: c.diffA, DIFFC: c.diffC, HER: c.heredity === "inherit" ? 0 : c.heredity === "frozen" ? 1 : 2,
    WS_SET: c.wasteShade === undefined ? 0 : 1, WSHIFT: c.wasteShade ?? 0,
    SINK_SET: c.sinkShift === undefined ? 0 : 1, SINKK: c.sinkShift === undefined ? 0 : 1 << (16 - c.sinkShift),
    TD_SET: c.trailMoveDiscount === undefined ? 0 : 1, TD: c.trailMoveDiscount ?? 0, TOLL: c.trailDiscountMode === "toll" ? 1 : 0,
    CG_SET: c.trailConduit === undefined ? 0 : 1, CG: c.trailConduit ?? 0, CQ: c.trailConduitCap ?? 255,
    GH_SET: c.trailConduitGhost === undefined ? 0 : 1, GH: c.trailConduitGhost ?? 0,
    OWN: c.trailOwner === undefined ? 0 : c.trailOwner === "id" ? 1 : 2, TH_SET: c.ownerDefend === undefined ? 0 : 1, TH: c.ownerDefend ?? 0,
    OC_SET: c.ownerConduit === undefined ? 0 : 1, OCG: c.ownerConduit ?? 0, OCQ: c.ownerConduitCap ?? 255, OGH_SET: c.ownerGhost === undefined ? 0 : 1, OGH: c.ownerGhost ?? 0,
    MUTRATE: c.mutRate, MUTCOUNT: c.mutCount, MUTSTEP: c.mutStep, SPAN: c.weightSpan, SSHIFT: c.sensorShift, ESHIFT: c.energyShift, MSHIFT: c.massShift,
    NWEIGHTS: NN_WEIGHTS3, W1_OFF: W1_OFF3, B1_OFF: B1_OFF3, W2_OFF: W2_OFF3, B2_OFF: B2_OFF3, GW: GENOME_WORDS,
    R_DX: 0, R_DY: 1, R_MUT: 2, R_MUT_SLOT: 3, R_MUT_DELTA: 40, R_UPKEEP: 90, R_EXCRETE: 91, R_DZ: 92, R_WEIGHT: 100,
    FL_DECAY: 0, FL_LIGHT: 1, FL_SINK_C: 2, FL_SINK_P: 3, RND_DIFF: RND3.DIFF, RND_DIFF_ROT: RND3.DIFF_ROT,
    C_N: C.n, C_NEXTID: C.nextId, C_NEXTGID: C.nextGid, C_STEP: C.step, C_ERR: C.err, C_SURV: C.surv, C_WANTT: C.wantTotal, C_NEWG: C.newGids, C_STEPHI: C.stepHi, C_CUT: C.cut,
    S_LIGHT: C.stat, S_HEAT: C.stat + 2, S_BIRTHS: C.stat + 4, S_DEATHS: C.stat + 6, S_REFUSED: C.stat + 8, S_CONTENDED: C.stat + 10, S_MUT: C.stat + 12,
    TOT0: C.tot, ID_MAX_V: ID_MAX, ERR_LEDGER, ERR_STEP, ERR_COUNT, LEDGER_HI: Math.floor(LEDGER_MAX / 2 ** 32),
    // The last step a state may start from is 2^53 - 2 (world.ts: step refuses at STEP_MAX = 2^53 - 1).
    STEP_LAST_HI: Math.floor((STEP_MAX - 1) / 2 ** 32), STEP_LAST_LO: (STEP_MAX - 1) % 2 ** 32,
    ROOM_HI: Math.floor(room / 2 ** 32), ROOM_LO: room % 2 ** 32,
    F_A: F.A, F_C: F.C, F_P: F.P, F_Z: F.Z, F_Q: F.Q, F_CROWD: F.CROWD, F_MB: F.MB, F_R: F.R, F_TK: F.TK, F_I: F.I, F_SENT: F.SENT, F_W1: F.W1, F_W2: F.W2,
    P_ID: P.ID, P_PAR: P.PAR, P_GID: P.GID, P_X: P.X, P_Y: P.Y, P_Z: P.Z, P_M: P.M, P_E: P.E, P_AGE: P.AGE, P_GEN: P.GEN,
    T_CELL: T.CELL, T_REQ: T.REQ, T_GRANT: T.GRANT, T_MX: T.MX, T_MY: T.MY, T_MZ: T.MZ, T_DREQ: T.DREQ, T_SPL: T.SPL, T_ALIVE: T.ALIVE, T_WANTS: T.WANTS,
    T_NOVEL: T.NOVEL, T_LA: T.LA, T_LW: T.LW, T_LN: T.LN, T_BA: T.BA, T_BW: T.BW, T_BN: T.BN, T_DISC: T.DISC, T_CDEP: T.CDEP,
  };
  const head = Object.entries(consts).map(([k, v]) => `const ${k} = ${u(v)};`).join("\n");
  return `${head}\n${BODY}`;
}

const BODY = /* wgsl */ `
@group(0) @binding(0) var<storage, read_write> ctl: array<atomic<u32>>;
@group(0) @binding(1) var<storage, read_write> fld: array<atomic<u32>>;
@group(0) @binding(2) var<storage, read_write> pc: array<u32>;
@group(0) @binding(3) var<storage, read_write> pn: array<u32>;
@group(0) @binding(4) var<storage, read_write> tmp: array<u32>;

var<workgroup> w_lo: atomic<u32>;
var<workgroup> w_hi: atomic<u32>;
var<workgroup> w_c: atomic<u32>;
var<workgroup> sh: array<u32, 256>;
var<private> gw: array<u32, GW>;
var<private> pw: array<u32, GW>;

// Same bodies as packages/sim-gpu/src/shaders.ts COMMON (lowbias32, draw, mul_frac) and int.ts cellBase;
// the seed is an argument here because this rule has three streams.
fn lowbias32(v: u32) -> u32 {
  var x = v;
  x ^= x >> 16u;
  x *= 0x7feb352du;
  x ^= x >> 15u;
  x *= 0x846ca68bu;
  x ^= x >> 16u;
  return x;
}
fn cell_base(seed: u32, step: u32, cell: u32) -> u32 {
  return lowbias32(cell ^ lowbias32(step ^ lowbias32(seed)));
}
fn draw(base: u32, k: u32) -> u32 {
  return lowbias32(base ^ ((k + 1u) * 0x9e3779b9u));
}
fn mul_frac(q: u32, k: u32, s: u32, rnd: u32) -> u32 {
  let mask = (1u << s) - 1u;
  let hi = (q >> s) * k;
  let lo = (q & mask) * k;
  var r = hi + (lo >> s);
  if ((lo & mask) > (rnd & mask)) { r += 1u; }
  return r;
}
fn pbase(step: u32, id: u32) -> u32 { return cell_base(PSEED, step, id); }

fn ld(i: u32) -> u32 { return atomicLoad(&ctl[i]); }
fn fl(i: u32) -> u32 { return atomicLoad(&fld[i]); }
fn sat(v: u32) -> i32 { return i32(min(v, 127u)); }
fn wb(b: u32) -> i32 { return extractBits(bitcast<i32>(gw[b >> 2u]), (b & 3u) * 8u, 8u); }
// The linear index of a cell kernel's thread (cell kernels run on a 2D grid of workgroups).
fn cidx(g: vec3<u32>, nw: vec3<u32>) -> u32 { return g.x + g.y * nw.x * 256u; }

// 64-bit counters are (lo, hi) word pairs. Each addend is below 2^32, so one carry per add is exact.
fn add64(idx: u32, lo: u32, hi: u32) {
  let o = atomicAdd(&ctl[idx], lo);
  var h = hi;
  if (o + lo < o) { h += 1u; }
  if (h != 0u) { atomicAdd(&ctl[idx + 1u], h); }
}
fn w_add(v: u32) {
  let o = atomicAdd(&w_lo, v);
  if (o + v < o) { atomicAdd(&w_hi, 1u); }
}

// Per-step cell scratch: CROWD, MB, R, TK are adjacent.
@compute @workgroup_size(256)
fn k_clear(@builtin(global_invocation_id) g: vec3<u32>, @builtin(num_workgroups) nw: vec3<u32>) {
  let k = cidx(g, nw);
  if (k < 4u * N) { atomicStore(&fld[F_CROWD + k], 0u); }
}
// The owner claim scratch (W1, W2 are adjacent).
@compute @workgroup_size(256)
fn k_own_clear(@builtin(global_invocation_id) g: vec3<u32>, @builtin(num_workgroups) nw: vec3<u32>) {
  let k = cidx(g, nw);
  if (k < 2u * N) { atomicStore(&fld[F_W1 + k], 0u); }
}

// Clears the per-step stats and checks world.ts step()'s refusals: a step started at 2^53 - 1, or an event counter
// above 2^50 - max(cells, maxParticles). The CPU throws before changing anything; here read() throws.
@compute @workgroup_size(1)
fn k_begin() {
  for (var k = 0u; k < 14u; k++) { atomicStore(&ctl[S_LIGHT + k], 0u); }
  atomicStore(&ctl[C_CUT], 0xffffffffu);
  let sl = ld(C_STEP);
  let shi = ld(C_STEPHI);
  if (shi > STEP_LAST_HI || (shi == STEP_LAST_HI && sl > STEP_LAST_LO)) { atomicOr(&ctl[C_ERR], ERR_STEP); }
  for (var k = 2u; k < 7u; k++) {
    let lo = ld(TOT0 + 2u * k);
    let hi = ld(TOT0 + 2u * k + 1u);
    if (hi > ROOM_HI || (hi == ROOM_HI && lo > ROOM_LO)) { atomicOr(&ctl[C_ERR], ERR_COUNT); }
  }
}

// The owner tag of particle slot i: id + 1 or gid + 1 (exact, no wrap: ids end at 0xfffffffe). 0 means no owner.
fn own_tag(i: u32) -> u32 {
  if (OWN == 1u) { return pc[P_ID + i] + 1u; }
  return pc[P_GID + i] + 1u;
}

// 1. Bin: the 3D cell, the crowding count and the body matter per cell (both sums are below 2^31: total matter).
@compute @workgroup_size(256)
fn k_bin(@builtin(global_invocation_id) g: vec3<u32>) {
  let i = g.x;
  if (i >= ld(C_N)) { return; }
  let ci = ((pc[P_Z + i] >> 8u) * H + (pc[P_Y + i] >> 8u)) * W + (pc[P_X + i] >> 8u);
  tmp[T_CELL + i] = ci;
  atomicAdd(&fld[F_CROWD + ci], 1u);
  atomicAdd(&fld[F_MB + ci], pc[P_M + i]);
}

// 1b. The light plane, one thread per column, top to bottom, from start-of-step P, the binned M and, with wasteShade, C >> WSHIFT
// (1/256 units). P + M + C is at most the total matter (2^31), so the sum never wraps before the min.
@compute @workgroup_size(256)
fn k_shade(@builtin(global_invocation_id) g: vec3<u32>) {
  let k = g.x;
  if (k >= WH) { return; }
  var L = TOP;
  if (LGRAD == 1u) { L = (TOP * ((k % W) + 1u)) / W; }
  atomicStore(&fld[F_I + k], L);
  for (var z = 1u; z < D; z++) {
    let above = (z - 1u) * WH + k;
    var sm = fl(F_P + above) + fl(F_MB + above);
    if (WS_SET == 1u) { sm += fl(F_C + above) >> WSHIFT; }
    let m = min(sm, MCAP);
    let t = LNUM / (LK + m);
    L = (L * t) >> 8u;
    atomicStore(&fld[F_I + z * WH + k], L);
  }
}

// 2-3. Sense the start-of-step field, think, and request nutrient.
@compute @workgroup_size(256)
fn k_think(@builtin(global_invocation_id) g: vec3<u32>) {
  let i = g.x;
  if (i >= ld(C_N)) { return; }
  let ci = tmp[T_CELL + i];
  let cx = ci % W;
  let cy = (ci / W) % H;
  let cz = ci / WH;
  let layer = cz * WH;
  let e = layer + cy * W + (cx + 1u) % W;
  let w = layer + cy * W + (cx + W - 1u) % W;
  let so = layer + ((cy + 1u) % H) * W + cx;
  let no = layer + ((cy + H - 1u) % H) * W + cx;
  // A z neighbour outside the volume reads the cell's own value.
  var up = ci;
  var dn = ci;
  if (cz > 0u) { up = ci - WH; }
  if (cz + 1u < D) { dn = ci + WH; }
  var xin: array<i32, 13>;
  xin[0] = sat(fl(F_A + ci) >> SSHIFT);
  xin[1] = sat(fl(F_C + ci) >> SSHIFT);
  xin[2] = sat(fl(F_P + ci) >> SSHIFT);
  xin[3] = clamp(sat(fl(F_P + e) >> SSHIFT) - sat(fl(F_P + w) >> SSHIFT), -127, 127);
  xin[4] = clamp(sat(fl(F_P + so) >> SSHIFT) - sat(fl(F_P + no) >> SSHIFT), -127, 127);
  xin[5] = clamp(sat(fl(F_A + e) >> SSHIFT) - sat(fl(F_A + w) >> SSHIFT), -127, 127);
  xin[6] = clamp(sat(fl(F_A + so) >> SSHIFT) - sat(fl(F_A + no) >> SSHIFT), -127, 127);
  let m0 = pc[P_M + i];
  xin[7] = sat(pc[P_E + i] >> ESHIFT);
  xin[8] = sat(m0 >> MSHIFT);
  xin[9] = sat(fl(F_CROWD + ci) * 16u);
  xin[10] = clamp(sat(fl(F_P + dn) >> SSHIFT) - sat(fl(F_P + up) >> SSHIFT), -127, 127);
  xin[11] = clamp(sat(fl(F_A + dn) >> SSHIFT) - sat(fl(F_A + up) >> SSHIFT), -127, 127);
  // TOPD is TOP, or 1 when there is no light (the branch then gives 0), so the shader never divides by a const 0.
  xin[12] = 0;
  if (TOP != 0u) { xin[12] = i32((fl(F_I + ci) * 127u) / TOPD); }
  for (var q = 0u; q < GW; q++) { gw[q] = pc[P_GEN + i * GW + q]; }
  var hh: array<i32, 8>;
  for (var j = 0u; j < 8u; j++) {
    var acc = wb(B1_OFF + j) * 128;
    for (var k = 0u; k < 13u; k++) { acc += wb(W1_OFF + k * 8u + j) * xin[k]; }
    hh[j] = clamp(acc / 128, 0, 127);
  }
  var o: array<i32, 9>;
  for (var k = 0u; k < 9u; k++) {
    if (k >= 5u && k < 8u) { continue; } // outputs 5..7 are reserved
    var acc = wb(B2_OFF + k) * 128;
    for (var j = 0u; j < 8u; j++) { acc += wb(W2_OFF + j * 9u + k) * hh[j]; }
    o[k] = clamp(acc / 128, -127, 127);
  }
  tmp[T_MX + i] = bitcast<u32>(o[0]);
  tmp[T_MY + i] = bitcast<u32>(o[1]);
  tmp[T_MZ + i] = bitcast<u32>(o[8]);
  var room = 0u;
  if (BODYMAX > m0) { room = BODYMAX - m0; }
  var r = min((MAXEAT * u32(max(o[2], 0))) >> 7u, room);
  // Eating gate (owner worlds): a cell owned by a stranger with Q >= theta refuses my request, zeroed before the store and before the sum.
  if (TH_SET == 1u) {
    let z = fl(F_Z + ci);
    if (z != 0u && z != own_tag(i) && fl(F_Q + ci) >= TH) { r = 0u; }
  }
  tmp[T_REQ + i] = r;
  if (r > 0u) { atomicAdd(&fld[F_R + ci], r); }
  let dreq = (MAXDEP * u32(max(o[3], 0))) >> 7u;
  tmp[T_DREQ + i] = dreq;
  // Toll road (optional): the discount factor from the START-of-step trail in this cell, stored here where the field is untouched.
  if (TD_SET == 1u) {
    var f = 0u;
    if (TOLL == 0u || dreq > 0u) { f = min(min(fl(F_P + ci), 256u) * TD, 256u); }
    tmp[T_DISC + i] = f;
  }
  tmp[T_SPL + i] = select(0u, 1u, o[4] > 0);
}

// 4. Eat, grants: requests share a contended cell pro rata from start-of-step A (r * A < 2^32, RULES.md).
@compute @workgroup_size(256)
fn k_grant(@builtin(global_invocation_id) g: vec3<u32>) {
  let i = g.x;
  if (i >= ld(C_N)) { return; }
  let ci = tmp[T_CELL + i];
  let r = tmp[T_REQ + i];
  let a = fl(F_A + ci);
  let rs = fl(F_R + ci);
  var gr = r;
  if (rs > a) { gr = (r * a) / rs; }
  tmp[T_GRANT + i] = gr;
  if (gr > 0u) { atomicAdd(&fld[F_TK + ci], gr); }
}

@compute @workgroup_size(256)
fn k_apply_eat(@builtin(global_invocation_id) g: vec3<u32>, @builtin(num_workgroups) nw: vec3<u32>, @builtin(local_invocation_index) t: u32) {
  let k = cidx(g, nw);
  var cont = 0u;
  if (k < N) {
    let a = fl(F_A + k);
    if (fl(F_R + k) > a) { cont = 1u; }
    atomicStore(&fld[F_A + k], a - fl(F_TK + k));
  }
  atomicAdd(&w_c, cont);
  workgroupBarrier();
  if (t == 0u) {
    let c = atomicLoad(&w_c);
    if (c > 0u) { atomicAdd(&ctl[S_CONTENDED], c); }
  }
}

// 5. Live. Returns (heat, died). Field writes are additions into the particle's own (start-of-step) cell.
fn live_one(i: u32) -> vec2<u32> {
  tmp[T_ALIVE + i] = 0u;
  tmp[T_WANTS + i] = 0u;
  if (OWN != 0u) { tmp[T_CDEP + i] = 0u; }
  let ci = tmp[T_CELL + i];
  let gr = tmp[T_GRANT + i];
  var m = pc[P_M + i] + gr;
  var en = pc[P_E + i] + gr * EA;
  var heat = 0u;
  if (en > EMAX) { heat += en - EMAX; en = EMAX; }
  let mx = bitcast<i32>(tmp[T_MX + i]);
  let my = bitcast<i32>(tmp[T_MY + i]);
  let mz = bitcast<i32>(tmp[T_MZ + i]);
  let pb = pbase(ld(C_STEP), pc[P_ID + i]);
  // MZ is paid in full even when the z clamp stops the motion.
  let raw = (u32(abs(mx)) + u32(abs(my)) + u32(abs(mz))) * MOVECOST;
  var mv = raw >> 7u;
  if (TD_SET == 1u) { mv = (raw * (256u - tmp[T_DISC + i])) >> 15u; }
  let cost = UPKEEP + mv + mul_frac(m, MASSUPK, 16u, draw(pb, R_UPKEEP));
  if (en < cost) {
    heat += en;
    atomicAdd(&fld[F_C + ci], m);
    return vec2<u32>(heat, 1u);
  }
  en -= cost;
  heat += cost;
  var dep = min(tmp[T_DREQ + i], m);
  if (dep * DEPCOST > en) { dep = en / DEPCOST; }
  en -= dep * DEPCOST;
  heat += dep * DEPCOST;
  m -= dep;
  if (dep > 0u) { atomicAdd(&fld[F_P + ci], dep); }
  if (OWN != 0u && dep > 0u) {
    // Z is not written until k_light, so this is the start-of-step owner. Mine: the owned trail grows. None: a claim candidate (k_claim_*).
    let z = fl(F_Z + ci);
    if (z == own_tag(i)) { atomicAdd(&fld[F_Q + ci], dep); }
    else if (z == 0u) { tmp[T_CDEP + i] = dep; }
  }
  let ex = mul_frac(m, EXCK, 16u, draw(pb, R_EXCRETE));
  m -= ex;
  if (ex > 0u) { atomicAdd(&fld[F_C + ci], ex); }
  if (m == 0u) {
    heat += en;
    return vec2<u32>(heat, 1u);
  }
  pc[P_M + i] = m;
  pc[P_E + i] = en;
  let dx = (mx * i32(SPEED)) / 128;
  let dy = (my * i32(SPEED)) / 128;
  let dz = (mz * i32(SPEED)) / 128;
  pc[P_X + i] = u32(i32(pc[P_X + i] + SPANX) + dx) % SPANX;
  pc[P_Y + i] = u32(i32(pc[P_Y + i] + SPANY) + dy) % SPANY;
  pc[P_Z + i] = u32(clamp(i32(pc[P_Z + i]) + dz, 0, i32(ZMAX)));
  pc[P_AGE + i] = pc[P_AGE + i] + 1u;
  tmp[T_ALIVE + i] = 1u;
  if (tmp[T_SPL + i] != 0u && en >= SPLITE && m >= SPLITM) { tmp[T_WANTS + i] = 1u; }
  return vec2<u32>(heat, 0u);
}

@compute @workgroup_size(256)
fn k_live(@builtin(global_invocation_id) g: vec3<u32>, @builtin(local_invocation_index) t: u32) {
  let i = g.x;
  var res = vec2<u32>(0u, 0u);
  if (i < ld(C_N)) { res = live_one(i); }
  w_add(res.x);
  atomicAdd(&w_c, res.y);
  workgroupBarrier();
  if (t == 0u) {
    add64(S_HEAT, atomicLoad(&w_lo), atomicLoad(&w_hi));
    let d = atomicLoad(&w_c);
    if (d > 0u) { atomicAdd(&ctl[S_DEATHS], d); }
  }
}

// 5b. Owner claims, three passes: the largest deposit per cell (W1), the largest tag among those (W2), then every
// candidate with that tag adds its own deposit to Q. k_light gives a cell with no owner the tag W2. T_CDEP is 0 for a non-candidate.
@compute @workgroup_size(256)
fn k_claim_a(@builtin(global_invocation_id) g: vec3<u32>) {
  let i = g.x;
  if (i >= ld(C_N)) { return; }
  let d = tmp[T_CDEP + i];
  if (d > 0u) { atomicMax(&fld[F_W1 + tmp[T_CELL + i]], d); }
}
@compute @workgroup_size(256)
fn k_claim_b(@builtin(global_invocation_id) g: vec3<u32>) {
  let i = g.x;
  if (i >= ld(C_N)) { return; }
  let d = tmp[T_CDEP + i];
  let ci = tmp[T_CELL + i];
  if (d > 0u && d == fl(F_W1 + ci)) { atomicMax(&fld[F_W2 + ci], own_tag(i)); }
}
@compute @workgroup_size(256)
fn k_claim_c(@builtin(global_invocation_id) g: vec3<u32>) {
  let i = g.x;
  if (i >= ld(C_N)) { return; }
  let d = tmp[T_CDEP + i];
  let ci = tmp[T_CELL + i];
  if (d > 0u && own_tag(i) == fl(F_W2 + ci)) { atomicAdd(&fld[F_Q + ci], d); }
}

// 6-7. Scans over slot order: block-local exclusive prefix, then a prefix over the (at most 256) block totals.
fn flags_off(which: u32) -> u32 { return select(select(T_ALIVE, T_WANTS, which == 1u), T_NOVEL, which == 2u); }
fn lscan_off(which: u32) -> u32 { return select(select(T_LA, T_LW, which == 1u), T_LN, which == 2u); }
fn boff_off(which: u32) -> u32 { return select(select(T_BA, T_BW, which == 1u), T_BN, which == 2u); }
// The CPU refuses births one at a time: no free slot, no particle id left (ids run to ID_MAX = 0xfffffffe, so
// 0xffffffff - nextId remain), or no genotype id left. The first two limits are known before any child exists:
// births_of() is the number of wanting survivors they allow, which k_compact builds speculatively. The genotype-id
// limit depends on the children's novelty (the scan of the novel flags), so it cuts that list afterwards:
// room() genotype ids remain, a birth is refused once the novel children before it use them all, and every later
// birth is refused too (the CPU's count stops growing), so the accepted births are again a prefix.
// k_assign_gid records the cut in C_CUT, births_final() applies it and k_trim undoes the cut parents' halving.
fn births_of() -> u32 { return min(min(ld(C_WANTT), CAP - ld(C_SURV)), 0xffffffffu - ld(C_NEXTID)); }
fn room() -> u32 { return 0xffffffffu - ld(C_NEXTGID); }
fn births_final() -> u32 {
  if (room() == 0u) { return 0u; }
  return min(births_of(), ld(C_CUT));
}

fn scan_block(which: u32, wgid: u32, t: u32) {
  let i = wgid * 256u + t;
  var lim = ld(C_N);
  if (which == 2u) { lim = births_of(); }
  var f = 0u;
  if (i < lim) { f = tmp[flags_off(which) + i]; }
  sh[t] = f;
  workgroupBarrier();
  for (var off = 1u; off < 256u; off = off << 1u) {
    var a = 0u;
    if (t >= off) { a = sh[t - off]; }
    workgroupBarrier();
    sh[t] = sh[t] + a;
    workgroupBarrier();
  }
  let incl = sh[t];
  if (i < CAP) { tmp[lscan_off(which) + i] = incl - f; }
  if (t == 255u) { tmp[boff_off(which) + wgid] = incl; }
}

fn scan_top(which: u32, t: u32) {
  var v = 0u;
  if (t < (CAP + 255u) / 256u) { v = tmp[boff_off(which) + t]; }
  sh[t] = v;
  workgroupBarrier();
  for (var off = 1u; off < 256u; off = off << 1u) {
    var a = 0u;
    if (t >= off) { a = sh[t - off]; }
    workgroupBarrier();
    sh[t] = sh[t] + a;
    workgroupBarrier();
  }
  let incl = sh[t];
  if (t < (CAP + 255u) / 256u) { tmp[boff_off(which) + t] = incl - v; }
  if (t == 255u) {
    let slot = select(select(C_SURV, C_WANTT, which == 1u), C_NEWG, which == 2u);
    atomicStore(&ctl[slot], incl);
  }
}

@compute @workgroup_size(256)
fn k_scan_aw(@builtin(workgroup_id) wid: vec3<u32>, @builtin(local_invocation_index) t: u32) { scan_block(wid.y, wid.x, t); }
@compute @workgroup_size(256)
fn k_scan_n(@builtin(workgroup_id) wid: vec3<u32>, @builtin(local_invocation_index) t: u32) { scan_block(2u, wid.x, t); }
@compute @workgroup_size(256)
fn k_top_aw(@builtin(workgroup_id) wid: vec3<u32>, @builtin(local_invocation_index) t: u32) { scan_top(wid.x, t); }
@compute @workgroup_size(256)
fn k_top_n(@builtin(local_invocation_index) t: u32) { scan_top(2u, t); }

// 6-7. Compact survivors to their scan slot in the other particle buffer and place each accepted child at
// survivors + rank. Everything reads pc and writes pn, so threads never see each other's writes.
@compute @workgroup_size(256)
fn k_compact(@builtin(global_invocation_id) g: vec3<u32>) {
  let i = g.x;
  if (i >= ld(C_N) || tmp[T_ALIVE + i] == 0u) { return; }
  let p = tmp[T_LA + i] + tmp[T_BA + (i >> 8u)];
  let survivors = ld(C_SURV);
  let pid = pc[P_ID + i];
  var mP = pc[P_M + i];
  var eP = pc[P_E + i];
  let xP = pc[P_X + i];
  let yP = pc[P_Y + i];
  let zP = pc[P_Z + i];
  let gidP = pc[P_GID + i];
  for (var q = 0u; q < GW; q++) {
    let wv = pc[P_GEN + i * GW + q];
    pw[q] = wv;
    gw[q] = wv;
  }
  var accepted = false;
  var rank = 0u;
  if (tmp[T_WANTS + i] != 0u) {
    rank = tmp[T_LW + i] + tmp[T_BW + (i >> 8u)];
    accepted = rank < births_of();
  }
  if (accepted) {
    let cm = mP >> 1u;
    let ce = eP >> 1u;
    mP -= cm;
    eP -= ce;
    let base = pbase(ld(C_STEP), pid);
    let qs = survivors + rank;
    pn[P_ID + qs] = ld(C_NEXTID) + rank;
    pn[P_PAR + qs] = pid;
    pn[P_X + qs] = (xP + SPANX + (draw(base, R_DX) & 255u) - 128u) % SPANX;
    pn[P_Y + qs] = (yP + SPANY + (draw(base, R_DY) & 255u) - 128u) % SPANY;
    pn[P_Z + qs] = u32(clamp(i32(zP) + i32(draw(base, R_DZ) & 255u) - 128, 0, i32(ZMAX)));
    pn[P_M + qs] = cm;
    pn[P_E + qs] = ce;
    pn[P_AGE + qs] = 0u;
    pn[P_GID + qs] = gidP;
    var novel = false;
    if (HER == 2u) {
      // Blocked: all 193 weight bytes redrawn, the padding stays 0; always a new genotype.
      for (var q = 0u; q < GW; q++) { gw[q] = 0u; }
      for (var b = 0u; b < NWEIGHTS; b++) {
        let v = i32(draw(base, R_WEIGHT + b) % (2u * SPAN + 1u)) - i32(SPAN);
        gw[b >> 2u] = gw[b >> 2u] | ((u32(v) & 0xffu) << ((b & 3u) * 8u));
      }
      novel = true;
    } else if (HER == 0u && (draw(base, R_MUT) & 0xffffu) < MUTRATE) {
      for (var j = 0u; j < MUTCOUNT; j++) {
        let slot = draw(base, R_MUT_SLOT + j) % NWEIGHTS;
        var delta = i32(draw(base, R_MUT_DELTA + j) % (2u * MUTSTEP + 1u)) - i32(MUTSTEP);
        if (delta == 0) { delta = 1; }
        let sh8 = (slot & 3u) * 8u;
        let cur = extractBits(bitcast<i32>(gw[slot >> 2u]), sh8, 8u);
        let nv = clamp(cur + delta, -127, 127);
        gw[slot >> 2u] = (gw[slot >> 2u] & ~(0xffu << sh8)) | ((u32(nv) & 0xffu) << sh8);
      }
      for (var q = 0u; q < GW; q++) { if (gw[q] != pw[q]) { novel = true; } }
    }
    for (var q = 0u; q < GW; q++) { pn[P_GEN + qs * GW + q] = gw[q]; }
    tmp[T_NOVEL + rank] = select(0u, 1u, novel);
  }
  pn[P_ID + p] = pid;
  pn[P_PAR + p] = pc[P_PAR + i];
  pn[P_GID + p] = gidP;
  pn[P_X + p] = xP;
  pn[P_Y + p] = yP;
  pn[P_Z + p] = zP;
  pn[P_M + p] = mP;
  pn[P_E + p] = eP;
  pn[P_AGE + p] = pc[P_AGE + i];
  for (var q = 0u; q < GW; q++) { pn[P_GEN + p * GW + q] = pw[q]; }
}

// Children whose controller differs from the parent's take the next genotype ids, in birth order.
@compute @workgroup_size(256)
fn k_assign_gid(@builtin(global_invocation_id) g: vec3<u32>) {
  let r = g.x;
  if (r >= births_of()) { return; }
  if (tmp[T_NOVEL + r] != 0u) {
    let before = tmp[T_LN + r] + tmp[T_BN + (r >> 8u)];
    pn[P_GID + ld(C_SURV) + r] = ld(C_NEXTGID) + before;
    // This child takes the last genotype id: the birth after it is the first one refused.
    if (before + 1u == room()) { atomicStore(&ctl[C_CUT], r + 1u); }
  }
}

// Parents whose child was cut by the genotype-id limit keep their whole body and energy.
@compute @workgroup_size(256)
fn k_trim(@builtin(global_invocation_id) g: vec3<u32>) {
  let i = g.x;
  if (i >= ld(C_N) || tmp[T_ALIVE + i] == 0u || tmp[T_WANTS + i] == 0u) { return; }
  let rank = tmp[T_LW + i] + tmp[T_BW + (i >> 8u)];
  if (rank < births_final() || rank >= births_of()) { return; }
  let p = tmp[T_LA + i] + tmp[T_BA + (i >> 8u)];
  pn[P_M + p] = pc[P_M + i];
  pn[P_E + p] = pc[P_E + i];
}

// 8.1 Field: light (from the start-of-step plane) turns waste into nutrient, trail decays to waste.
@compute @workgroup_size(256)
fn k_light(@builtin(global_invocation_id) g: vec3<u32>, @builtin(num_workgroups) nw: vec3<u32>, @builtin(local_invocation_index) t: u32) {
  let k = cidx(g, nw);
  var li = 0u;
  if (k < N) {
    let fb = cell_base(SEED, ld(C_STEP), k);
    let ii = fl(F_I + k);
    var L = ii >> 8u;
    if ((draw(fb, FL_LIGHT) & 255u) < (ii & 255u)) { L += 1u; }
    let cw = fl(F_C + k);
    let conv = min(cw, L);
    atomicStore(&fld[F_C + k], cw - conv);
    atomicStore(&fld[F_A + k], fl(F_A + k) + conv);
    li = conv * EA;
    // A cell with no owner at the start of the step takes the claim winner's tag (W2 is 0 where nobody claimed).
    if (OWN != 0u && fl(F_Z + k) == 0u) { atomicStore(&fld[F_Z + k], fl(F_W2 + k)); }
    let pv = fl(F_P + k);
    if (pv > 0u && PDECAY > 0u) {
      let rd = draw(fb, FL_DECAY);
      let dec = min(pv, mul_frac(pv, PDECAY, 16u, rd));
      atomicStore(&fld[F_P + k], pv - dec);
      atomicStore(&fld[F_C + k], fl(F_C + k) + dec);
      // Owned trail decays with the same draw; a cell whose Q reaches 0 has no owner.
      if (OWN != 0u) {
        let qv = fl(F_Q + k);
        if (qv > 0u) {
          let qn = qv - min(qv, mul_frac(qv, PDECAY, 16u, rd));
          atomicStore(&fld[F_Q + k], qn);
          if (qn == 0u) { atomicStore(&fld[F_Z + k], 0u); }
        }
      }
    }
  }
  w_add(li);
  workgroupBarrier();
  if (t == 0u) { add64(S_LIGHT, atomicLoad(&w_lo), atomicLoad(&w_hi)); }
}

// 8.2 Sinking (optional): every cell above the floor computes its sends from the post-decay amounts into scratch
// (C at SENT + k, P at SENT + N + k); owned trail falls with the P draw and loses its owner. Then k_sink_apply moves them.
@compute @workgroup_size(256)
fn k_sink_send(@builtin(global_invocation_id) g: vec3<u32>, @builtin(num_workgroups) nw: vec3<u32>) {
  let k = cidx(g, nw);
  if (k >= TOPC) { return; }
  let fb = cell_base(SEED, ld(C_STEP), k);
  atomicStore(&fld[F_SENT + k], mul_frac(fl(F_C + k), SINKK, 16u, draw(fb, FL_SINK_C)));
  let rp = draw(fb, FL_SINK_P);
  atomicStore(&fld[F_SENT + N + k], mul_frac(fl(F_P + k), SINKK, 16u, rp));
  if (OWN != 0u) {
    let qv = fl(F_Q + k);
    if (qv > 0u) {
      let qn = qv - min(qv, mul_frac(qv, SINKK, 16u, rp));
      atomicStore(&fld[F_Q + k], qn);
      if (qn == 0u) { atomicStore(&fld[F_Z + k], 0u); }
    }
  }
}
@compute @workgroup_size(256)
fn k_sink_apply(@builtin(global_invocation_id) g: vec3<u32>, @builtin(num_workgroups) nw: vec3<u32>) {
  let k = cidx(g, nw);
  if (k >= N) { return; }
  var cv = fl(F_C + k);
  var pv = fl(F_P + k);
  if (k < TOPC) { cv -= fl(F_SENT + k); pv -= fl(F_SENT + N + k); }
  if (k >= WH) { cv += fl(F_SENT + k - WH); pv += fl(F_SENT + N + k - WH); }
  atomicStore(&fld[F_C + k], cv);
  atomicStore(&fld[F_P + k], pv);
}

// 8.3 Diffusion over six faces with the slab's diffOut6: each cell's sends go to SENT (six per cell, 0 toward a
// missing z face), then every cell gathers. Directions 0 +x, 1 -x, 2 +y, 3 -y, 4 +z (down), 5 -z (up); OUT marks a missing face.
const OUT = 0xffffffffu;
fn nb6(k: u32, d: u32) -> u32 {
  let cx = k % W;
  let cy = (k / W) % H;
  let cz = k / WH;
  let layer = cz * WH;
  switch d {
    case 0u: { return layer + cy * W + (cx + 1u) % W; }
    case 1u: { return layer + cy * W + (cx + W - 1u) % W; }
    case 2u: { return layer + ((cy + 1u) % H) * W + cx; }
    case 3u: { return layer + ((cy + H - 1u) % H) * W + cx; }
    case 4u: { if (cz + 1u < D) { return k + WH; } return OUT; }
    default: { if (cz > 0u) { return k - WH; } return OUT; }
  }
}
// The cell index of k shifted by (+s, +s) within its layer (the ghost controls read the field there).
fn shift_cell(k: u32, s: u32) -> u32 {
  let cz = k / WH;
  return cz * WH + (((k / W) % H + s) % H) * W + (k % W + s) % W;
}
// isA: species A, where the trail conduit or the owner conduit (with their ghosts) set the per-edge rate.
fn send(f0: u32, De: u32, sp: u32, k: u32, isA: bool) {
  let base = cell_base(DSEED, ld(C_STEP), k);
  let q = fl(f0 + k);
  let rot = draw(base, RND_DIFF_ROT) % 6u;
  for (var d = 0u; d < 6u; d++) {
    let j = nb6(k, d);
    if (j == OUT) { atomicStore(&fld[F_SENT + 6u * k + d], 0u); continue; }
    var portion = q / 6u;
    if (((d + rot) % 6u) < (q % 6u)) { portion += 1u; }
    var dd = De;
    if (isA && CG_SET == 1u) {
      var a = k;
      var b = j;
      if (GH_SET == 1u) { a = shift_cell(k, GH); b = shift_cell(j, GH); }
      let pm = min(min(fl(F_P + a), fl(F_P + b)), CQ);
      dd = min(De + ((pm * CG) >> 4u), 128u);
    } else if (isA && OC_SET == 1u) {
      var a = k;
      var b = j;
      if (OGH_SET == 1u) { a = shift_cell(k, OGH); b = shift_cell(j, OGH); }
      let za = fl(F_Z + a);
      if (za != 0u && za == fl(F_Z + b)) {
        let qm = min(min(fl(F_Q + a), fl(F_Q + b)), OCQ);
        dd = min(De + ((qm * OCG) >> 4u), 128u);
      }
    }
    atomicStore(&fld[F_SENT + 6u * k + d], mul_frac(portion, dd * 4u, 10u, draw(base, RND_DIFF + d * 3u + sp)));
  }
}
fn gather(f0: u32, k: u32) {
  var o = 0u;
  var inflow = 0u;
  for (var d = 0u; d < 6u; d++) {
    o += fl(F_SENT + 6u * k + d);
    // The neighbour in direction d sends toward this cell in the opposite direction d ^ 1.
    let j = nb6(k, d);
    if (j != OUT) { inflow += fl(F_SENT + 6u * j + (d ^ 1u)); }
  }
  atomicStore(&fld[f0 + k], fl(f0 + k) - o + inflow);
}
@compute @workgroup_size(256)
fn k_send_a(@builtin(global_invocation_id) g: vec3<u32>, @builtin(num_workgroups) nw: vec3<u32>) { let k = cidx(g, nw); if (k < N) { send(F_A, DIFFA, 0u, k, true); } }
@compute @workgroup_size(256)
fn k_gather_a(@builtin(global_invocation_id) g: vec3<u32>, @builtin(num_workgroups) nw: vec3<u32>) { let k = cidx(g, nw); if (k < N) { gather(F_A, k); } }
@compute @workgroup_size(256)
fn k_send_c(@builtin(global_invocation_id) g: vec3<u32>, @builtin(num_workgroups) nw: vec3<u32>) { let k = cidx(g, nw); if (k < N) { send(F_C, DIFFC, 1u, k, false); } }
@compute @workgroup_size(256)
fn k_gather_c(@builtin(global_invocation_id) g: vec3<u32>, @builtin(num_workgroups) nw: vec3<u32>) { let k = cidx(g, nw); if (k < N) { gather(F_C, k); } }

// Close the step: births and refusals, new counts and ids, cumulative counters, step.
@compute @workgroup_size(1)
fn k_finish() {
  let sv = ld(C_SURV);
  let births = births_final();
  let wt = ld(C_WANTT);
  atomicStore(&ctl[S_BIRTHS], births);
  atomicStore(&ctl[S_REFUSED], wt - births);
  atomicStore(&ctl[C_N], sv + births);
  atomicStore(&ctl[C_NEXTID], ld(C_NEXTID) + births);
  // Novel children among the accepted births: all of them, unless the genotype-id limit cut the list.
  let g = ld(C_NEXTGID);
  let ng = min(ld(C_NEWG), room());
  atomicStore(&ctl[C_NEXTGID], g + ng);
  atomicStore(&ctl[S_MUT], select(0u, ng, HER == 0u));
  // The step is a (lo, hi) pair. The PRNG keys on lo, which is the CPU's step mod 2^32.
  let ns = ld(C_STEP) + 1u;
  atomicStore(&ctl[C_STEP], ns);
  if (ns == 0u) { atomicStore(&ctl[C_STEPHI], ld(C_STEPHI) + 1u); }
  for (var k = 0u; k < 7u; k++) {
    let lo = ld(S_LIGHT + 2u * k);
    let hi = ld(S_LIGHT + 2u * k + 1u);
    let o = ld(TOT0 + 2u * k);
    let nl = o + lo;
    var carry = 0u;
    if (nl < o) { carry = 1u; }
    let nh = ld(TOT0 + 2u * k + 1u) + hi + carry;
    atomicStore(&ctl[TOT0 + 2u * k], nl);
    atomicStore(&ctl[TOT0 + 2u * k + 1u], nh);
    if (k < 2u && (nh > LEDGER_HI || (nh == LEDGER_HI && nl > 0u))) { atomicOr(&ctl[C_ERR], ERR_LEDGER); }
  }
}
`;

// ---- host ----------------------------------------------------------------------------------------------------

/** A device with the adapter's largest buffer limits (a large volume needs more than the WebGPU defaults). */
export async function mycelium3dDevice(): Promise<GPUDevice> {
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
  if (!adapter) throw new Error("WebGPU: no adapter");
  return adapter.requestDevice({
    requiredLimits: { maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize, maxBufferSize: adapter.limits.maxBufferSize },
  });
}

const sameConfig = (a: Mycelium3dConfig, b: Mycelium3dConfig) => JSON.stringify(a) === JSON.stringify(b);
const pair = (v: number): [number, number] => [v % 2 ** 32, Math.floor(v / 2 ** 32)];
/** Workgroups for `count` threads as a 2D grid (cidx() in the shader undoes it). */
const grid = (count: number): [number, number] => {
  const g = Math.max(1, Math.ceil(count / WG));
  const x = Math.min(g, GRID_X);
  return [x, Math.ceil(g / x)];
};

export class GpuMycelium3d {
  readonly config: Mycelium3dConfig;
  private readonly L: ReturnType<typeof layouts>;
  private readonly ctl: GPUBuffer;
  private readonly fld: GPUBuffer;
  private readonly parts: [GPUBuffer, GPUBuffer];
  private readonly tmp: GPUBuffer;
  private readonly bgs: [GPUBindGroup, GPUBindGroup];
  private readonly pl: Record<string, GPUComputePipeline> = {};
  /** Which particle buffer holds the current state. */
  private cur = 0;
  private matter0 = 0;
  private energy0 = 0;

  private constructor(readonly device: GPUDevice, config: Mycelium3dConfig) {
    this.config = { ...config };
    const L = this.L = layouts(config);
    const d = device;
    // Buffers made before a throw are destroyed here (create() never sees the object).
    try {
      const usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST;
      this.ctl = d.createBuffer({ size: C.words * 4, usage });
      this.fld = d.createBuffer({ size: L.F.words * 4, usage });
      this.parts = [d.createBuffer({ size: L.P.words * 4, usage }), d.createBuffer({ size: L.P.words * 4, usage })];
      this.tmp = d.createBuffer({ size: L.T.words * 4, usage });
      const bgl = d.createBindGroupLayout({
        entries: [0, 1, 2, 3, 4].map((binding) => ({ binding, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" as const } })),
      });
      const layout = d.createPipelineLayout({ bindGroupLayouts: [bgl] });
      const module = d.createShaderModule({ code: wgsl(config) });
      for (const name of ["k_clear", "k_own_clear", "k_begin", "k_bin", "k_shade", "k_think", "k_grant", "k_apply_eat", "k_live", "k_claim_a", "k_claim_b", "k_claim_c",
        "k_scan_aw", "k_top_aw", "k_compact", "k_scan_n", "k_top_n", "k_assign_gid", "k_trim", "k_light", "k_sink_send", "k_sink_apply",
        "k_send_a", "k_gather_a", "k_send_c", "k_gather_c", "k_finish"]) {
        this.pl[name] = d.createComputePipeline({ layout, compute: { module, entryPoint: name } });
      }
      const bg = (a: GPUBuffer, b: GPUBuffer) => d.createBindGroup({
        layout: bgl, entries: [this.ctl, this.fld, a, b, this.tmp].map((buffer, binding) => ({ binding, resource: { buffer } })),
      });
      this.bgs = [bg(this.parts[0], this.parts[1]), bg(this.parts[1], this.parts[0])];
    } catch (e) {
      this.destroy();
      throw e;
    }
  }

  /**
   * Builds a GpuMycelium3d from a state (resume) or a config (founders come from createWorld, on the CPU).
   * Throws if the shader or pipelines failed validation, which WebGPU otherwise reports nowhere.
   */
  static async create(device: GPUDevice, init: Mycelium3dState | Mycelium3dConfig): Promise<GpuMycelium3d> {
    const state = "A" in init ? init : createWorld(init);
    GpuMycelium3d.checkLimits(device, state.config);
    let g: GpuMycelium3d | null = null;
    let err: GPUError | null = null;
    device.pushErrorScope("validation");
    try {
      g = new GpuMycelium3d(device, state.config);
    } finally {
      // Balanced whether or not the constructor threw, so no error scope is left open on the device.
      err = await device.popErrorScope();
    }
    try {
      if (err) throw new Error(`mycelium3d shader: ${err.message}`);
      g.upload(state);
    } catch (e) {
      g.destroy();
      throw e;
    }
    return g;
  }

  /**
   * The largest buffer a config needs, in bytes. A buffer above the device's limits would fail validation and every dispatch
   * would be dropped silently, so create() refuses such a config before allocating anything.
   */
  static bufferBytes(config: Mycelium3dConfig): number {
    const L = layouts(config);
    return Math.max(L.F.words, L.P.words, L.T.words) * 4;
  }
  static checkLimits(device: GPUDevice, config: Mycelium3dConfig): void {
    const most = GpuMycelium3d.bufferBytes(config);
    const lim = Math.min(device.limits.maxStorageBufferBindingSize, device.limits.maxBufferSize);
    if (most > lim) throw new Error(`GpuMycelium3d: a ${most}-byte buffer exceeds this device's limit of ${lim} bytes (use mycelium3dDevice(), or a smaller volume)`);
  }

  destroy(): void {
    for (const b of [this.ctl, this.fld, this.parts?.[0], this.parts?.[1], this.tmp]) b?.destroy();
  }

  /** Replaces the whole GPU state with `s` (same config required). */
  upload(s: Mycelium3dState): void {
    if (!sameConfig(s.config, this.config)) throw new Error("GpuMycelium3d.upload: the state's config differs from this object's");
    if (!Number.isInteger(s.step) || s.step < 0 || s.step > STEP_MAX) throw new Error("GpuMycelium3d.upload: the step must be an integer in [0, 2^53 - 1]");
    if (s.nextId > ID_MAX + 1 || s.nextGid > ID_MAX + 1) throw new Error("GpuMycelium3d.upload: nextId or nextGid is beyond ID_MAX + 1");
    const { N, cap, F, P } = this.L;
    const q = this.device.queue;
    const ctl = new Uint32Array(C.words);
    ctl[C.n] = s.n; ctl[C.nextId] = s.nextId; ctl[C.nextGid] = s.nextGid; [ctl[C.step], ctl[C.stepHi]] = pair(s.step);
    COUNTERS.forEach((k, j) => { [ctl[C.tot + 2 * j], ctl[C.tot + 2 * j + 1]] = pair(s.totals[k]); });
    q.writeBuffer(this.ctl, 0, ctl);
    const f = new Uint32Array(F.persist);
    f.set(s.A.subarray(0, N), F.A); f.set(s.C.subarray(0, N), F.C); f.set(s.P.subarray(0, N), F.P);
    if (this.config.trailOwner !== undefined) {
      if (!s.Z || !s.Q) throw new Error("GpuMycelium3d.upload: trailOwner needs the Z and Q planes");
      f.set(s.Z.subarray(0, N), F.Z); f.set(s.Q.subarray(0, N), F.Q);
    }
    q.writeBuffer(this.fld, 0, f);
    const buf = this.parts[this.cur];
    if (s.n > 0) {
      PLANES.forEach((k, j) => { const a = s[k]; q.writeBuffer(buf, j * cap * 4, new Uint32Array(a.buffer as ArrayBuffer, a.byteOffset, s.n)); });
      q.writeBuffer(buf, P.GEN * 4, new Uint8Array(s.genome.buffer as ArrayBuffer, s.genome.byteOffset, s.n * NN_BYTES3));
    }
    this.matter0 = s.matter0; this.energy0 = s.energy0;
  }

  /** Queues `n` steps. Returns once they are submitted, not finished. */
  step(n = 1): void {
    const { N, cap } = this.L;
    const c = this.config;
    const pg = Math.ceil(cap / WG), cg = grid(N);
    const WH = c.width * c.height;
    const sink = c.sinkShift !== undefined && c.depth > 1;
    for (let done = 0; done < n;) {
      const batch = Math.min(32, n - done);
      const enc = this.device.createCommandEncoder();
      const pass = enc.beginComputePass();
      for (let b = 0; b < batch; b++) {
        pass.setBindGroup(0, this.bgs[this.cur]);
        const run = (name: string, x: number, y = 1) => { pass.setPipeline(this.pl[name]); pass.dispatchWorkgroups(x, y); };
        run("k_clear", ...grid(4 * N));
        if (c.trailOwner !== undefined) run("k_own_clear", ...grid(2 * N));
        run("k_begin", 1);
        run("k_bin", pg); run("k_shade", Math.ceil(WH / WG)); run("k_think", pg); run("k_grant", pg); run("k_apply_eat", ...cg); run("k_live", pg);
        if (c.trailOwner !== undefined) { run("k_claim_a", pg); run("k_claim_b", pg); run("k_claim_c", pg); }
        run("k_scan_aw", pg, 2); run("k_top_aw", 2);
        run("k_compact", pg);
        run("k_scan_n", pg); run("k_top_n", 1); run("k_assign_gid", pg); run("k_trim", pg);
        run("k_light", ...cg);
        if (sink) { run("k_sink_send", ...grid(N - WH)); run("k_sink_apply", ...cg); }
        // The conduits also run with diffA 0, as on the CPU.
        if (c.diffA > 0 || c.trailConduit !== undefined || c.ownerConduit !== undefined) { run("k_send_a", ...cg); run("k_gather_a", ...cg); }
        if (c.diffC > 0) { run("k_send_c", ...cg); run("k_gather_c", ...cg); }
        run("k_finish", 1);
        this.cur ^= 1;
      }
      pass.end();
      this.device.queue.submit([enc.finish()]);
      done += batch;
    }
  }

  /**
   * Read-only handles for a renderer: the GPU buffers and their word offsets. Nothing here writes or changes the
   * simulation. `cur` is the index in `parts` of the buffer holding the current state and flips with every queued step,
   * so read it when encoding a frame. The first word of `ctl` is the live particle count. The light plane `I` is the one
   * the last step used (start of that step), not the next one.
   */
  get view() {
    const { N, cap, F, P } = this.L;
    return {
      ctl: this.ctl, fld: this.fld, parts: this.parts, cur: this.cur,
      N, cap, ctlN: C.n, ctlStep: C.step, ctlStepHi: C.stepHi,
      field: { A: F.A, C: F.C, P: F.P, I: F.I },
      planes: { id: P.ID, parent: P.PAR, gid: P.GID, x: P.X, y: P.Y, z: P.Z, M: P.M, E: P.E, age: P.AGE },
    };
  }

  /** Resolves when everything queued so far has finished. */
  async sync(): Promise<void> { await this.device.queue.onSubmittedWorkDone(); }

  /** Waits for queued work and returns the full state, byte-comparable with the CPU reference. */
  async read(): Promise<Mycelium3dState> {
    const d = this.device, { N, cap, P, F } = this.L;
    // Everything the state takes from this object is captured before the first await: an upload() queued while this read
    // waits runs after the copies below, so the arrays are the old state, and the anchors must be too.
    const config = { ...this.config }, matter0 = this.matter0, energy0 = this.energy0;
    const mk = (size: number) => d.createBuffer({ size, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const sCtl = mk(C.words * 4), sFld = mk(F.persist * 4), sPart = mk(P.words * 4);
    let ctl: Uint32Array, fld: Uint32Array, part: Uint32Array;
    try {
      const enc = d.createCommandEncoder();
      enc.copyBufferToBuffer(this.ctl, 0, sCtl, 0, C.words * 4);
      enc.copyBufferToBuffer(this.fld, 0, sFld, 0, F.persist * 4);
      enc.copyBufferToBuffer(this.parts[this.cur], 0, sPart, 0, P.words * 4);
      d.queue.submit([enc.finish()]);
      await Promise.all([sCtl.mapAsync(GPUMapMode.READ), sFld.mapAsync(GPUMapMode.READ), sPart.mapAsync(GPUMapMode.READ)]);
      ctl = new Uint32Array(sCtl.getMappedRange().slice(0));
      fld = new Uint32Array(sFld.getMappedRange().slice(0));
      part = new Uint32Array(sPart.getMappedRange().slice(0));
    } finally {
      sCtl.destroy(); sFld.destroy(); sPart.destroy();
    }
    if (ctl[C.err] & ERR_STEP) throw new Error("GpuMycelium3d: a step started at 2^53 - 1, where the CPU refuses to step");
    if (ctl[C.err] & ERR_COUNT) throw new Error("GpuMycelium3d: an event counter was too close to 2^50 to step, where the CPU refuses");
    if (ctl[C.err] & ERR_LEDGER) throw new Error("GpuMycelium3d: ledger counters passed 2^50; the run is over");
    const n = ctl[C.n];
    const totals = {} as Totals;
    COUNTERS.forEach((k, j) => { totals[k] = ctl[C.tot + 2 * j + 1] * 2 ** 32 + ctl[C.tot + 2 * j]; });
    const plane = (off: number) => { const a = new Uint32Array(cap); a.set(part.subarray(off, off + n)); return a; };
    const genome = new Int8Array(cap * NN_BYTES3);
    genome.set(new Int8Array(part.buffer, part.byteOffset + P.GEN * 4, n * NN_BYTES3));
    const state: Mycelium3dState = {
      config, step: ctl[C.stepHi] * 2 ** 32 + ctl[C.step],
      A: fld.slice(F.A, F.A + N), C: fld.slice(F.C, F.C + N), P: fld.slice(F.P, F.P + N),
      n, id: plane(P.ID), parent: plane(P.PAR), gid: plane(P.GID), x: plane(P.X), y: plane(P.Y), z: plane(P.Z), M: plane(P.M), E: plane(P.E), age: plane(P.AGE),
      genome, nextId: ctl[C.nextId], nextGid: ctl[C.nextGid], matter0, energy0, totals,
    };
    if (config.trailOwner !== undefined) { state.Z = fld.slice(F.Z, F.Z + N); state.Q = fld.slice(F.Q, F.Q + N); }
    return state;
  }
}
