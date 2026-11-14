// Mycelium world, rung R1: the WebGPU port of tools/mycelium/world.ts.
//
// Contract: after the same number of steps, readbacks encode to the same bytes as the CPU reference
// (stateDigest equal), bit for bit, up to 65,536 particles, including the CPU's per-birth refusals when the
// particle-id or genotype-id space runs out, and steps past 2^32 (the step is a (lo, hi) pair, the PRNG keys on lo,
// which is the CPU's step mod 2^32). Two CPU bounds are detected, not ported, because the CPU throws there:
// the lifetime ledger passing 2^50, and the step passing 2^53 (past what the CPU's double holds exactly).
// Each sets an error bit and read() throws. Steps queued after such a step keep running until read(); the state
// is then unusable.
// No floating point anywhere in the step: every
// quantity is u32 or i32 with WGSL wrapping semantics, as in the CPU helpers (packages/schema/src/int.ts).
// The rules are in tools/mycelium/RULES.md ("R1 (GPU)" says how the order-dependent parts are done).
//
// Runs unchanged under Deno native WebGPU and in the browser (no Deno.* here). Follows tools/soup/gpu.ts:
// one object owns the buffers and pipelines, step(n) queues work without waiting, read() waits and returns a
// full MyceliumState. All config values are baked into the shader as consts, so a GpuMycelium is tied to one
// config; upload(state) takes any state with the same config (resume).
import { NN_BYTES, NN_H, NN_I, NN_O } from "@bl/schema";
import { createWorld, ID_MAX, LEDGER_MAX, type MyceliumConfig, type MyceliumState, POS_SHIFT, type Totals } from "./world.ts";

const WG = 256;
const GENOME_WORDS = NN_BYTES / 4;
/** Controller layout offsets (the kernel's): W1 [input][hidden], B1, W2 [hidden][output], B2. */
const W1_OFF = 0, B1_OFF = NN_I * NN_H, W2_OFF = B1_OFF + NN_H, B2_OFF = W2_OFF + NN_H * NN_O;

// ---- buffer layouts, shared by the shader (as consts) and the host ------------------------------------------

/** ctl words: scalars, then the per-step stat pairs, then the cumulative total pairs (lo, hi). */
const C = { n: 0, nextId: 1, nextGid: 2, step: 3, err: 4, surv: 5, wantTotal: 6, newGids: 7, stepHi: 8, cut: 9, stat: 16, tot: 32, words: 64 } as const;
/** Order of the seven counter pairs, same as Totals. */
const COUNTERS = ["lightIn", "heat", "births", "deaths", "refused", "contended", "mutations"] as const;
const ERR_LEDGER = 2, ERR_STEP = 4;
/** The step counter is exact up to 2^53 (the CPU's double): high word 2^21 with a zero low word. */
const STEP_HI_MAX = 2 ** 21;

function layouts(c: MyceliumConfig) {
  const N = c.width * c.height, cap = c.maxParticles;
  // Field buffer, in units of N words: A, C, P persist; D, R, taken are per-step cell scratch; SENT is diffusion scratch (4N).
  const F = { A: 0, C: N, P: 2 * N, D: 3 * N, R: 4 * N, TK: 5 * N, SENT: 6 * N, words: 10 * N };
  // Particle buffer (one of two, ping-ponged): eight u32 planes of cap, then genome words (40 per slot).
  const P = { ID: 0, PAR: cap, GID: 2 * cap, X: 3 * cap, Y: 4 * cap, M: 5 * cap, E: 6 * cap, AGE: 7 * cap, GEN: 8 * cap, words: (8 + GENOME_WORDS) * cap };
  // Per-step particle scratch: planes of cap words, then three block-offset arrays of 256.
  const T = {
    CELL: 0, REQ: cap, GRANT: 2 * cap, MX: 3 * cap, MY: 4 * cap, DREQ: 5 * cap, SPL: 6 * cap, ALIVE: 7 * cap, WANTS: 8 * cap, NOVEL: 9 * cap,
    LA: 10 * cap, LW: 11 * cap, LN: 12 * cap, BA: 13 * cap, BW: 13 * cap + 256, BN: 13 * cap + 512, words: 13 * cap + 768,
  };
  return { N, cap, F, P, T };
}

// ---- WGSL ----------------------------------------------------------------------------------------------------

function wgsl(c: MyceliumConfig): string {
  const { N, cap, F, P, T } = layouts(c);
  const u = (v: number) => `${v >>> 0}u`;
  const consts: Record<string, number> = {
    W: c.width, H: c.height, N, CAP: cap, SPANX: c.width << POS_SHIFT, SPANY: c.height << POS_SHIFT,
    SEED: c.seed, PSEED: (c.seed ^ 0x6d796331) >>> 0, DSEED: (c.seed ^ 0x64696666) >>> 0,
    EA: c.eA, MAXEAT: c.maxEat, BODYMAX: c.bodyMax, SPEED: c.speed, UPKEEP: c.upkeep, MOVECOST: c.moveCost,
    MASSUPK: 1 << (16 - c.massUpkeepShift), MAXDEP: c.maxDeposit, DEPCOST: c.depositCost, EXCK: 1 << (16 - c.excreteShift),
    SPLITE: c.splitEnergy, SPLITM: c.splitMatter, EMAX: c.energyMax, LIGHT: c.light, LGRAD: c.lightPattern === "gradient" ? 1 : 0,
    PDECAY: c.pDecay, DIFFA: c.diffA, DIFFC: c.diffC, HER: c.heredity === "inherit" ? 0 : c.heredity === "frozen" ? 1 : 2,
    PHYS: c.controller === "physarum" ? 1 : 0, PDEP_SET: c.physarumDeposit === undefined ? 0 : 1, PDEP: c.physarumDeposit ?? 0, BLIND: c.blindTrailGradient === true ? 1 : 0,
    MUTRATE: c.mutRate, MUTCOUNT: c.mutCount, MUTSTEP: c.mutStep, SPAN: c.weightSpan, SSHIFT: c.sensorShift, ESHIFT: c.energyShift, MSHIFT: c.massShift,
    NN_BYTES, W1_OFF, B1_OFF, W2_OFF, B2_OFF, GW: GENOME_WORDS,
    C_N: C.n, C_NEXTID: C.nextId, C_NEXTGID: C.nextGid, C_STEP: C.step, C_ERR: C.err, C_SURV: C.surv, C_WANTT: C.wantTotal, C_NEWG: C.newGids, C_STEPHI: C.stepHi, C_CUT: C.cut,
    S_LIGHT: C.stat, S_HEAT: C.stat + 2, S_BIRTHS: C.stat + 4, S_DEATHS: C.stat + 6, S_REFUSED: C.stat + 8, S_CONTENDED: C.stat + 10, S_MUT: C.stat + 12,
    TOT0: C.tot, ID_MAX_V: ID_MAX, ERR_LEDGER, ERR_STEP, STEP_HI_MAX, LEDGER_HI: Math.floor(LEDGER_MAX / 2 ** 32),
    F_A: F.A, F_C: F.C, F_P: F.P, F_D: F.D, F_R: F.R, F_TK: F.TK, F_SENT: F.SENT,
    P_ID: P.ID, P_PAR: P.PAR, P_GID: P.GID, P_X: P.X, P_Y: P.Y, P_M: P.M, P_E: P.E, P_AGE: P.AGE, P_GEN: P.GEN,
    T_CELL: T.CELL, T_REQ: T.REQ, T_GRANT: T.GRANT, T_MX: T.MX, T_MY: T.MY, T_DREQ: T.DREQ, T_SPL: T.SPL, T_ALIVE: T.ALIVE, T_WANTS: T.WANTS,
    T_NOVEL: T.NOVEL, T_LA: T.LA, T_LW: T.LW, T_LN: T.LN, T_BA: T.BA, T_BW: T.BW, T_BN: T.BN,
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
fn sat(v: u32) -> i32 { return i32(min(v, 127u)); }
fn wb(b: u32) -> i32 { return extractBits(bitcast<i32>(gw[b >> 2u]), (b & 3u) * 8u, 8u); }

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

@compute @workgroup_size(256)
fn k_clear(@builtin(global_invocation_id) g: vec3<u32>) {
  if (g.x < 3u * N) { atomicStore(&fld[F_D + g.x], 0u); }
}

@compute @workgroup_size(1)
fn k_begin() {
  for (var k = 0u; k < 14u; k++) { atomicStore(&ctl[S_LIGHT + k], 0u); }
  atomicStore(&ctl[C_CUT], 0xffffffffu);
}

// 1. Bin.
@compute @workgroup_size(256)
fn k_bin(@builtin(global_invocation_id) g: vec3<u32>) {
  let i = g.x;
  if (i >= ld(C_N)) { return; }
  let ci = (pc[P_Y + i] >> 8u) * W + (pc[P_X + i] >> 8u);
  tmp[T_CELL + i] = ci;
  atomicAdd(&fld[F_D + ci], 1u);
}

// 2-3. Sense the start-of-step field, think, and request nutrient.
@compute @workgroup_size(256)
fn k_think(@builtin(global_invocation_id) g: vec3<u32>) {
  let i = g.x;
  if (i >= ld(C_N)) { return; }
  let ci = tmp[T_CELL + i];
  let cx = ci % W;
  let cy = ci / W;
  let e = cy * W + (cx + 1u) % W;
  let w = cy * W + (cx + W - 1u) % W;
  let so = ((cy + 1u) % H) * W + cx;
  let no = ((cy + H - 1u) % H) * W + cx;
  var xin: array<i32, 10>;
  xin[0] = sat(atomicLoad(&fld[F_A + ci]) >> SSHIFT);
  xin[1] = sat(atomicLoad(&fld[F_C + ci]) >> SSHIFT);
  xin[2] = sat(atomicLoad(&fld[F_P + ci]) >> SSHIFT);
  xin[3] = clamp(sat(atomicLoad(&fld[F_P + e]) >> SSHIFT) - sat(atomicLoad(&fld[F_P + w]) >> SSHIFT), -127, 127);
  xin[4] = clamp(sat(atomicLoad(&fld[F_P + so]) >> SSHIFT) - sat(atomicLoad(&fld[F_P + no]) >> SSHIFT), -127, 127);
  xin[5] = clamp(sat(atomicLoad(&fld[F_A + e]) >> SSHIFT) - sat(atomicLoad(&fld[F_A + w]) >> SSHIFT), -127, 127);
  xin[6] = clamp(sat(atomicLoad(&fld[F_A + so]) >> SSHIFT) - sat(atomicLoad(&fld[F_A + no]) >> SSHIFT), -127, 127);
  let m0 = pc[P_M + i];
  xin[7] = sat(pc[P_E + i] >> ESHIFT);
  xin[8] = sat(m0 >> MSHIFT);
  xin[9] = sat(atomicLoad(&fld[F_D + ci]) * 16u);
  if (BLIND == 1u) { xin[3] = 0; xin[4] = 0; }
  var o: array<i32, 5>;
  if (PHYS == 1u) {
    // The R2 null (world.ts physarumThink): up the trail gradient at half speed plus a small random turn, or a wander
    // where there is no trail. The genome is carried and never read. R2b: DEPOSIT = 32 * u with u from physarumDeposit.
    let pbp = pbase(ld(C_STEP), pc[P_ID + i]);
    let gx = xin[3];
    let gy = xin[4];
    let gm = max(abs(gx), abs(gy));
    var bx = 0;
    var by = 0;
    if (gm > 0) {
      bx = (gx * 64) / gm;
      by = (gy * 64) / gm;
    } else {
      bx = i32(draw(pbp, 62u) % 129u) - 64;
      by = i32(draw(pbp, 63u) % 129u) - 64;
    }
    o[0] = clamp(bx + i32(draw(pbp, 60u) % 33u) - 16, -127, 127);
    o[1] = clamp(by + i32(draw(pbp, 61u) % 33u) - 16, -127, 127);
    o[2] = 127;
    o[3] = 32;
    if (PDEP_SET == 1u) {
      var pu = PDEP >> 8u;
      if ((draw(pbp, 64u) % 256u) < (PDEP & 255u)) { pu += 1u; }
      o[3] = i32(32u * pu);
    }
    o[4] = 127;
  } else {
    for (var q = 0u; q < GW; q++) { gw[q] = pc[P_GEN + i * GW + q]; }
    var hh: array<i32, 8>;
    for (var j = 0u; j < 8u; j++) {
      var acc = wb(B1_OFF + j) * 128;
      for (var k = 0u; k < 10u; k++) { acc += wb(W1_OFF + k * 8u + j) * xin[k]; }
      hh[j] = clamp(acc / 128, 0, 127);
    }
    for (var k = 0u; k < 5u; k++) {
      var acc = wb(B2_OFF + k) * 128;
      for (var j = 0u; j < 8u; j++) { acc += wb(W2_OFF + j * 8u + k) * hh[j]; }
      o[k] = clamp(acc / 128, -127, 127);
    }
  }
  tmp[T_MX + i] = bitcast<u32>(o[0]);
  tmp[T_MY + i] = bitcast<u32>(o[1]);
  var room = 0u;
  if (BODYMAX > m0) { room = BODYMAX - m0; }
  let r = min((MAXEAT * u32(max(o[2], 0))) >> 7u, room);
  tmp[T_REQ + i] = r;
  if (r > 0u) { atomicAdd(&fld[F_R + ci], r); }
  tmp[T_DREQ + i] = (MAXDEP * u32(max(o[3], 0))) >> 7u;
  tmp[T_SPL + i] = select(0u, 1u, o[4] > 0);
}

// 4. Eat, grants: requests share a contended cell pro rata from start-of-step A (r * A < 2^32, RULES.md).
@compute @workgroup_size(256)
fn k_grant(@builtin(global_invocation_id) g: vec3<u32>) {
  let i = g.x;
  if (i >= ld(C_N)) { return; }
  let ci = tmp[T_CELL + i];
  let r = tmp[T_REQ + i];
  let a = atomicLoad(&fld[F_A + ci]);
  let rs = atomicLoad(&fld[F_R + ci]);
  var gr = r;
  if (rs > a) { gr = (r * a) / rs; }
  tmp[T_GRANT + i] = gr;
  if (gr > 0u) { atomicAdd(&fld[F_TK + ci], gr); }
}

@compute @workgroup_size(256)
fn k_apply_eat(@builtin(global_invocation_id) g: vec3<u32>, @builtin(local_invocation_index) t: u32) {
  let k = g.x;
  var cont = 0u;
  if (k < N) {
    let a = atomicLoad(&fld[F_A + k]);
    if (atomicLoad(&fld[F_R + k]) > a) { cont = 1u; }
    atomicStore(&fld[F_A + k], a - atomicLoad(&fld[F_TK + k]));
  }
  atomicAdd(&w_c, cont);
  workgroupBarrier();
  if (t == 0u) {
    let c = atomicLoad(&w_c);
    if (c > 0u) { atomicAdd(&ctl[S_CONTENDED], c); }
  }
}

// 5. Live. Returns (heat, died). Field writes are additions into the particle's own cell.
fn live_one(i: u32) -> vec2<u32> {
  tmp[T_ALIVE + i] = 0u;
  tmp[T_WANTS + i] = 0u;
  let ci = tmp[T_CELL + i];
  let gr = tmp[T_GRANT + i];
  var m = pc[P_M + i] + gr;
  var en = pc[P_E + i] + gr * EA;
  var heat = 0u;
  if (en > EMAX) { heat += en - EMAX; en = EMAX; }
  let mx = bitcast<i32>(tmp[T_MX + i]);
  let my = bitcast<i32>(tmp[T_MY + i]);
  let pb = pbase(ld(C_STEP), pc[P_ID + i]);
  let cost = UPKEEP + (((u32(abs(mx)) + u32(abs(my))) * MOVECOST) >> 7u) + mul_frac(m, MASSUPK, 16u, draw(pb, 90u));
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
  let ex = mul_frac(m, EXCK, 16u, draw(pb, 91u));
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
  pc[P_X + i] = u32(i32(pc[P_X + i] + SPANX) + dx) % SPANX;
  pc[P_Y + i] = u32(i32(pc[P_Y + i] + SPANY) + dy) % SPANY;
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
    pn[P_X + qs] = (xP + SPANX + (draw(base, 0u) & 255u) - 128u) % SPANX;
    pn[P_Y + qs] = (yP + SPANY + (draw(base, 1u) & 255u) - 128u) % SPANY;
    pn[P_M + qs] = cm;
    pn[P_E + qs] = ce;
    pn[P_AGE + qs] = 0u;
    pn[P_GID + qs] = gidP;
    var novel = false;
    if (HER == 2u) {
      for (var q = 0u; q < GW; q++) { gw[q] = 0u; }
      for (var b = 0u; b < NN_BYTES; b++) {
        let v = i32(draw(base, 100u + b) % (2u * SPAN + 1u)) - i32(SPAN);
        gw[b >> 2u] = gw[b >> 2u] | ((u32(v) & 0xffu) << ((b & 3u) * 8u));
      }
      novel = true;
    } else if (HER == 0u && (draw(base, 2u) & 0xffffu) < MUTRATE) {
      for (var j = 0u; j < MUTCOUNT; j++) {
        let slot = draw(base, 3u + j) % NN_BYTES;
        var delta = i32(draw(base, 40u + j) % (2u * MUTSTEP + 1u)) - i32(MUTSTEP);
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

// 8. Field: light turns waste into nutrient, trail decays to waste.
@compute @workgroup_size(256)
fn k_light(@builtin(global_invocation_id) g: vec3<u32>, @builtin(local_invocation_index) t: u32) {
  let k = g.x;
  var li = 0u;
  if (k < N) {
    let step = ld(C_STEP);
    let fb = cell_base(SEED, step, k);
    var L = LIGHT;
    if (LGRAD == 1u) {
      let lf = LIGHT * ((k % W) + 1u);
      L = lf / W;
      if ((draw(fb, 1u) % W) < (lf % W)) { L += 1u; }
    }
    let cw = atomicLoad(&fld[F_C + k]);
    let conv = min(cw, L);
    atomicStore(&fld[F_C + k], cw - conv);
    atomicStore(&fld[F_A + k], atomicLoad(&fld[F_A + k]) + conv);
    li = conv * EA;
    let pv = atomicLoad(&fld[F_P + k]);
    if (pv > 0u && PDECAY > 0u) {
      let dec = min(pv, mul_frac(pv, PDECAY, 16u, draw(fb, 0u)));
      atomicStore(&fld[F_P + k], pv - dec);
      atomicStore(&fld[F_C + k], atomicLoad(&fld[F_C + k]) + dec);
    }
  }
  w_add(li);
  workgroupBarrier();
  if (t == 0u) { add64(S_LIGHT, atomicLoad(&w_lo), atomicLoad(&w_hi)); }
}

// Diffusion: each cell's four sends (the kernel's diffOut) go to a scratch plane, then every cell gathers.
fn send(f0: u32, De: u32, sp: u32, k: u32) {
  let base = cell_base(DSEED, ld(C_STEP), k);
  let q = atomicLoad(&fld[f0 + k]);
  let rot = base >> 30u;
  for (var d = 0u; d < 4u; d++) {
    var portion = q >> 2u;
    if (((d + rot) & 3u) < (q & 3u)) { portion += 1u; }
    atomicStore(&fld[F_SENT + 4u * k + d], mul_frac(portion, De * 4u, 10u, draw(base, 1u + d * 3u + sp)));
  }
}
fn gather(f0: u32, k: u32) {
  let cx = k % W;
  let cy = k / W;
  let east = cy * W + (cx + 1u) % W;
  let west = cy * W + (cx + W - 1u) % W;
  let south = ((cy + 1u) % H) * W + cx;
  let north = ((cy + H - 1u) % H) * W + cx;
  let out = atomicLoad(&fld[F_SENT + 4u * k]) + atomicLoad(&fld[F_SENT + 4u * k + 1u]) + atomicLoad(&fld[F_SENT + 4u * k + 2u]) + atomicLoad(&fld[F_SENT + 4u * k + 3u]);
  let inflow = atomicLoad(&fld[F_SENT + 4u * east + 1u]) + atomicLoad(&fld[F_SENT + 4u * west]) + atomicLoad(&fld[F_SENT + 4u * south + 3u]) + atomicLoad(&fld[F_SENT + 4u * north + 2u]);
  atomicStore(&fld[f0 + k], atomicLoad(&fld[f0 + k]) - out + inflow);
}
@compute @workgroup_size(256)
fn k_send_a(@builtin(global_invocation_id) g: vec3<u32>) { if (g.x < N) { send(F_A, DIFFA, 0u, g.x); } }
@compute @workgroup_size(256)
fn k_gather_a(@builtin(global_invocation_id) g: vec3<u32>) { if (g.x < N) { gather(F_A, g.x); } }
@compute @workgroup_size(256)
fn k_send_c(@builtin(global_invocation_id) g: vec3<u32>) { if (g.x < N) { send(F_C, DIFFC, 1u, g.x); } }
@compute @workgroup_size(256)
fn k_gather_c(@builtin(global_invocation_id) g: vec3<u32>) { if (g.x < N) { gather(F_C, g.x); } }

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
  var hi = ld(C_STEPHI);
  if (ns == 0u) { hi += 1u; atomicStore(&ctl[C_STEPHI], hi); }
  if (hi > STEP_HI_MAX || (hi == STEP_HI_MAX && ns > 0u)) { atomicOr(&ctl[C_ERR], ERR_STEP); }
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

export async function myceliumDevice(): Promise<GPUDevice> {
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
  if (!adapter) throw new Error("WebGPU: no adapter");
  return adapter.requestDevice();
}

const sameConfig = (a: MyceliumConfig, b: MyceliumConfig) => JSON.stringify(a) === JSON.stringify(b);
const pair = (v: number): [number, number] => [v % 2 ** 32, Math.floor(v / 2 ** 32)];

export class GpuMycelium {
  readonly config: MyceliumConfig;
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

  private constructor(readonly device: GPUDevice, config: MyceliumConfig) {
    this.config = { ...config };
    const L = this.L = layouts(config);
    const d = device;
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
    for (const name of ["k_clear", "k_begin", "k_bin", "k_think", "k_grant", "k_apply_eat", "k_live", "k_scan_aw", "k_top_aw", "k_compact",
      "k_scan_n", "k_top_n", "k_assign_gid", "k_trim", "k_light", "k_send_a", "k_gather_a", "k_send_c", "k_gather_c", "k_finish"]) {
      this.pl[name] = d.createComputePipeline({ layout, compute: { module, entryPoint: name } });
    }
    const bg = (a: GPUBuffer, b: GPUBuffer) => d.createBindGroup({
      layout: bgl, entries: [this.ctl, this.fld, a, b, this.tmp].map((buffer, binding) => ({ binding, resource: { buffer } })),
    });
    this.bgs = [bg(this.parts[0], this.parts[1]), bg(this.parts[1], this.parts[0])];
  }

  /**
   * Builds a GpuMycelium from a state (resume) or a config (founders come from createWorld, on the CPU).
   * Throws if the shader or pipelines failed validation, which WebGPU otherwise reports nowhere.
   */
  static async create(device: GPUDevice, init: MyceliumState | MyceliumConfig): Promise<GpuMycelium> {
    const state = "A" in init ? init : createWorld(init);
    device.pushErrorScope("validation");
    const g = new GpuMycelium(device, state.config);
    const err = await device.popErrorScope();
    if (err) throw new Error(`mycelium shader: ${err.message}`);
    g.upload(state);
    return g;
  }

  destroy(): void {
    for (const b of [this.ctl, this.fld, this.parts[0], this.parts[1], this.tmp]) b.destroy();
  }

  /** Replaces the whole GPU state with `s` (same config required). */
  upload(s: MyceliumState): void {
    if (!sameConfig(s.config, this.config)) throw new Error("GpuMycelium.upload: the state's config differs from this object's");
    if (!Number.isInteger(s.step) || s.step < 0 || s.step > 2 ** 53) throw new Error("GpuMycelium.upload: the step must be an integer in [0, 2^53]");
    if (s.nextId > ID_MAX + 1 || s.nextGid > ID_MAX + 1) throw new Error("GpuMycelium.upload: nextId or nextGid is beyond ID_MAX + 1");
    const { N, cap, P } = this.L;
    const q = this.device.queue;
    const ctl = new Uint32Array(C.words);
    ctl[C.n] = s.n; ctl[C.nextId] = s.nextId; ctl[C.nextGid] = s.nextGid; [ctl[C.step], ctl[C.stepHi]] = pair(s.step);
    COUNTERS.forEach((k, j) => { [ctl[C.tot + 2 * j], ctl[C.tot + 2 * j + 1]] = pair(s.totals[k]); });
    q.writeBuffer(this.ctl, 0, ctl);
    const f = new Uint32Array(this.L.F.words);
    f.set(s.A.subarray(0, N), 0); f.set(s.C.subarray(0, N), N); f.set(s.P.subarray(0, N), 2 * N);
    q.writeBuffer(this.fld, 0, f);
    const buf = this.parts[this.cur];
    if (s.n > 0) {
      [s.id, s.parent, s.gid, s.x, s.y, s.M, s.E, s.age].forEach((a, j) => q.writeBuffer(buf, j * cap * 4, new Uint32Array(a.buffer as ArrayBuffer, a.byteOffset, s.n)));
      q.writeBuffer(buf, P.GEN * 4, new Uint8Array(s.genome.buffer as ArrayBuffer, s.genome.byteOffset, s.n * NN_BYTES));
    }
    this.matter0 = s.matter0; this.energy0 = s.energy0;
  }

  /** Queues `n` steps. Returns once they are submitted, not finished. */
  step(n = 1): void {
    const { N, cap } = this.L;
    const pg = Math.ceil(cap / WG), cg = Math.ceil(N / WG);
    const c = this.config;
    for (let done = 0; done < n;) {
      const batch = Math.min(32, n - done);
      const enc = this.device.createCommandEncoder();
      const pass = enc.beginComputePass();
      for (let b = 0; b < batch; b++) {
        pass.setBindGroup(0, this.bgs[this.cur]);
        const run = (name: string, x: number, y = 1) => { pass.setPipeline(this.pl[name]); pass.dispatchWorkgroups(x, y); };
        run("k_clear", Math.ceil(3 * N / WG));
        run("k_begin", 1);
        run("k_bin", pg); run("k_think", pg); run("k_grant", pg); run("k_apply_eat", cg); run("k_live", pg);
        run("k_scan_aw", pg, 2); run("k_top_aw", 2);
        run("k_compact", pg);
        run("k_scan_n", pg); run("k_top_n", 1); run("k_assign_gid", pg); run("k_trim", pg);
        run("k_light", cg);
        if (c.diffA > 0) { run("k_send_a", cg); run("k_gather_a", cg); }
        if (c.diffC > 0) { run("k_send_c", cg); run("k_gather_c", cg); }
        run("k_finish", 1);
        this.cur ^= 1;
      }
      pass.end();
      this.device.queue.submit([enc.finish()]);
      done += batch;
    }
  }

  /**
   * Read-only handles for a renderer (the lab page): the GPU buffers and their word offsets. Nothing here writes or
   * changes the simulation. `cur` is the index in `parts` of the buffer holding the current state and flips with every
   * queued step, so read it when encoding a frame. A reader's first word of `ctl` is the live particle count.
   */
  get view() {
    const { N, cap, F, P } = this.L;
    return {
      ctl: this.ctl, fld: this.fld, parts: this.parts, cur: this.cur,
      N, cap, ctlN: C.n, ctlStep: C.step, ctlStepHi: C.stepHi,
      field: { A: F.A, C: F.C, P: F.P },
      planes: { id: P.ID, parent: P.PAR, gid: P.GID, x: P.X, y: P.Y, M: P.M, E: P.E, age: P.AGE },
    };
  }

  /** Resolves when everything queued so far has finished. */
  async sync(): Promise<void> { await this.device.queue.onSubmittedWorkDone(); }

  /** Waits for queued work and returns the full state, byte-comparable with the CPU reference. */
  async read(): Promise<MyceliumState> {
    const d = this.device, { N, cap, P } = this.L;
    const mk = (size: number) => d.createBuffer({ size, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const sCtl = mk(C.words * 4), sFld = mk(3 * N * 4), sPart = mk(P.words * 4);
    const enc = d.createCommandEncoder();
    enc.copyBufferToBuffer(this.ctl, 0, sCtl, 0, C.words * 4);
    enc.copyBufferToBuffer(this.fld, 0, sFld, 0, 3 * N * 4);
    enc.copyBufferToBuffer(this.parts[this.cur], 0, sPart, 0, P.words * 4);
    d.queue.submit([enc.finish()]);
    await Promise.all([sCtl.mapAsync(GPUMapMode.READ), sFld.mapAsync(GPUMapMode.READ), sPart.mapAsync(GPUMapMode.READ)]);
    const ctl = new Uint32Array(sCtl.getMappedRange().slice(0));
    const fld = new Uint32Array(sFld.getMappedRange().slice(0));
    const part = new Uint32Array(sPart.getMappedRange().slice(0));
    sCtl.destroy(); sFld.destroy(); sPart.destroy();
    if (ctl[C.err] & ERR_STEP) throw new Error("GpuMycelium: the step counter passed 2^53, past what a double holds exactly (RULES.md, R1)");
    if (ctl[C.err] & ERR_LEDGER) throw new Error("GpuMycelium: ledger counters passed 2^50; the run is over");
    const n = ctl[C.n];
    const totals = {} as Totals;
    COUNTERS.forEach((k, j) => { totals[k] = ctl[C.tot + 2 * j + 1] * 2 ** 32 + ctl[C.tot + 2 * j]; });
    const plane = (off: number) => { const a = new Uint32Array(cap); a.set(part.subarray(off, off + n)); return a; };
    const genome = new Int8Array(cap * NN_BYTES);
    genome.set(new Int8Array(part.buffer, part.byteOffset + P.GEN * 4, n * NN_BYTES));
    return {
      config: { ...this.config }, step: ctl[C.stepHi] * 2 ** 32 + ctl[C.step],
      A: fld.slice(0, N), C: fld.slice(N, 2 * N), P: fld.slice(2 * N, 3 * N),
      n, id: plane(P.ID), parent: plane(P.PAR), gid: plane(P.GID), x: plane(P.X), y: plane(P.Y), M: plane(P.M), E: plane(P.E), age: plane(P.AGE),
      genome, nextId: ctl[C.nextId], nextGid: ctl[C.nextGid], matter0: this.matter0, energy0: this.energy0, totals,
    };
  }
}
