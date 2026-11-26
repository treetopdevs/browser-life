/**
 * Phase B2: Bit-Exact Integer/Fixed-Point WGSL Compute Shaders for Pointer-Free Zwicker Active Droplets
 * + Conserved Obligate Phage (Kill-the-Winner).
 *
 * Line-for-line WGSL twin of `DropletKernelRef` in `droplets-kernel.ts`:
 * - ZERO floating-point arithmetic.
 * - ZERO atomics.
 * - Uses only 4 storage buffers (universal WebGPU limit is 8):
 *     state[0..N-1] = A, state[N..2N-1] = F, state[2N..8N-1] = W, state[8N..14N-1] = P
 *     state2[...]   = ping-pong copy
 *     scratch[0..6N-1] = mu, scratch[6N..12N-1] = jE, scratch[12N..18N-1] = jS
 */

export const DROPLET_WG = 64;

export const DROPLET_SHADER_WGSL = /* wgsl */ `
const MOTIFS: u32 = 6u;
const SCALE: u32 = 1024u;

struct Params {
  width: u32,
  height: u32,
  seed: u32,
  bulkBQ16: u32,
  kappa6Q16: u32,
  chiQ16: u32,
  mobQ16: u32,
  diffWQ16: u32,
  noiseQ8: u32,
  diffFQ16: u32,
  diffAQ16: u32,
  kLightQ16: u32,
  kSynQ16: u32,
  kDegQ16: u32,
  mutMotifU32: u32,
  coreMinInt: u32,
  kInfectQ16: u32,
  neutralPhage: u32,
  phageYieldQ16: u32,
  diffPQ16: u32,
  kDecayPQ16: u32,
  mutPhageU32: u32,
  _pad0: u32,
  _pad1: u32,
};

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read_write> stepBuf: array<u32>;
@group(0) @binding(2) var<storage, read_write> state: array<u32>;
@group(0) @binding(3) var<storage, read_write> state2: array<u32>;
@group(0) @binding(4) var<storage, read_write> scratch: array<i32>;

fn hash32(seed: u32, step: u32, tile: u32, ch: u32) -> u32 {
  var h: u32 = seed ^ (step * 0x9e3779b1u) ^ (tile * 0x85ebca6bu) ^ (ch * 0xc2b2ae35u);
  h = h ^ (h >> 16u);
  h = h * 0x7feb352du;
  h = h ^ (h >> 15u);
  h = h * 0x846ca68bu;
  h = h ^ (h >> 16u);
  return h;
}

fn mulStochQ16(val: u32, rateQ16: u32, rnd: u32) -> u32 {
  let hi: u32 = (val >> 16u) * rateQ16;
  let lo: u32 = (val & 0xffffu) * rateQ16 + (rnd & 0xffffu);
  return hi + (lo >> 16u);
}

fn diffOut(val: u32, rateQ16: u32, rnd: u32) -> u32 {
  if (val == 0u || rateQ16 == 0u) { return 0u; }
  var out: u32 = mulStochQ16(val, rateQ16, rnd);
  if (out > val) { out = val; }
  return out;
}

fn diffSend(val: u32, rateQ16: u32, rnd: u32, dir: u32) -> u32 {
  if (val == 0u || rateQ16 == 0u) { return 0u; }
  var out: u32 = mulStochQ16(val, rateQ16, rnd);
  if (out > val) { out = val; }
  if (out == 0u) { return 0u; }
  let q: u32 = out >> 2u;
  let rem: u32 = out & 3u;
  var extra: u32 = 0u;
  if (rem == 1u) {
    if (((rnd >> 16u) & 3u) == dir) { extra = 1u; }
  } else if (rem == 2u) {
    let pairIdx: u32 = (rnd >> 16u) % 6u;
    var a: u32 = 2u;
    var b: u32 = 3u;
    if (pairIdx < 3u) {
      a = 0u;
      b = pairIdx + 1u;
    } else if (pairIdx < 5u) {
      a = 1u;
      b = pairIdx - 1u;
    }
    if (dir == a || dir == b) { extra = 1u; }
  } else if (rem == 3u) {
    if (((rnd >> 16u) & 3u) != dir) { extra = 1u; }
  }
  return q + extra;
}

@compute @workgroup_size(1)
fn pass0_tick() {
  stepBuf[0] = stepBuf[0] + 1u;
}

@compute @workgroup_size(${DROPLET_WG})
fn pass1_chem(@builtin(global_invocation_id) gid: vec3<u32>) {
  let N: u32 = params.width * params.height;
  let i: u32 = gid.x;
  if (i >= N) { return; }

  let offF: u32 = N;
  let offW: u32 = 2u * N;
  let offP: u32 = 8u * N;
  let step: u32 = stepBuf[0];
  let seed: u32 = params.seed;
  let base: u32 = i * MOTIFS;
  var a: u32 = state[i];
  var f: u32 = state[offF + i];

  var wSum: u32 = 0u;
  for (var m: u32 = 0u; m < MOTIFS; m = m + 1u) {
    wSum = wSum + state[offW + base + m];
  }
  var solvQ10: u32 = 0u;
  if (wSum < SCALE) { solvQ10 = SCALE - wSum; }

  // 1a. Light: A -> F in dilute solvent
  if (a > 0u && params.kLightQ16 > 0u && solvQ10 > 0u) {
    let lightRateQ16: u32 = (params.kLightQ16 * solvQ10) >> 10u;
    var dAF: u32 = mulStochQ16(a, lightRateQ16, hash32(seed, step, i, 10u));
    if (dAF > a) { dAF = a; }
    a = a - dAF;
    f = f + dAF;
  }

  // 1b. Hydrolysis W_m -> A & symmetric synthesis demand F + 2W_m -> 3W_m
  let f0: u32 = f;
  var synDem: array<u32, 6>;
  var demSum: u32 = 0u;
  for (var m: u32 = 0u; m < MOTIFS; m = m + 1u) {
    synDem[m] = 0u;
    var wm: u32 = state[offW + base + m];
    if (wm == 0u) { continue; }

    var dWA: u32 = mulStochQ16(wm, params.kDegQ16, hash32(seed, step, i, 20u + m));
    if (dWA > wm) { dWA = wm; }
    wm = wm - dWA;
    a = a + dWA;
    state[offW + base + m] = wm;

    if (f0 > 0u) {
      let wm0: u32 = wm + dWA;
      var c: u32 = wm0;
      if (c > 1536u) { c = 1536u; }
      let c2Q10: u32 = (c * c) >> 10u;
      var clampedRate: u32 = (params.kSynQ16 * c2Q10) >> 10u;
      if (clampedRate > 65536u) { clampedRate = 65536u; }
      var f0Clamped: u32 = f0;
      if (f0Clamped > 0xffffu) { f0Clamped = 0xffffu; }
      let demQ8: u32 = (f0Clamped * clampedRate) >> 8u;
      synDem[m] = demQ8;
      demSum = demSum + demQ8;
    }
  }

  if (demSum > 0u && f0 > 0u) {
    var f0Clamped: u32 = f0;
    if (f0Clamped > 0xffffu) { f0Clamped = 0xffffu; }
    let f0Q8: u32 = f0Clamped << 8u;
    var fLeft: u32 = f0;
    let m0: u32 = hash32(seed, step, i, 35u) % MOTIFS;
    for (var off: u32 = 0u; off < MOTIFS; off = off + 1u) {
      if (fLeft == 0u) { break; }
      let m: u32 = (m0 + off) % MOTIFS;
      let dem: u32 = synDem[m];
      if (dem == 0u) { continue; }
      var effQ8: u32 = dem;
      if (demSum > f0Q8) {
        let num: u32 = f0Q8 >> 8u;
        var den: u32 = demSum >> 8u;
        if (den == 0u) { den = 1u; }
        var scaleQ16: u32 = (num << 16u) / den;
        if (scaleQ16 > 65536u) { scaleQ16 = 65536u; }
        effQ8 = mulStochQ16(dem, scaleQ16, 0u);
      }
      let rnd: u32 = hash32(seed, step, i, 40u + m) & 0xffu;
      var dFW: u32 = (effQ8 + rnd) >> 8u;
      if (dFW > fLeft) { dFW = fLeft; }
      fLeft = fLeft - dFW;
      f = f - dFW;
      state[offW + base + m] = state[offW + base + m] + dFW;
    }
  }

  // 1c. Phage infection: W_m -> dP + dA
  if (params.kInfectQ16 > 0u) {
    if (params.neutralPhage != 0u) {
      var pTot: u32 = 0u;
      for (var m: u32 = 0u; m < MOTIFS; m = m + 1u) { pTot = pTot + state[offP + base + m]; }
      if (pTot > 0u) {
        var pCap: u32 = pTot;
        if (pCap > 4096u) { pCap = 4096u; }
        var rateQ16: u32 = (params.kInfectQ16 * pCap) >> 10u;
        if (rateQ16 > 62259u) { rateQ16 = 62259u; }
        for (var m: u32 = 0u; m < MOTIFS; m = m + 1u) {
          let wm: u32 = state[offW + base + m];
          if (wm == 0u) { continue; }
          var d: u32 = mulStochQ16(wm, rateQ16, hash32(seed, step, i, 400u + m));
          if (d > wm) { d = wm; }
          if (d > 0u) {
            var dP: u32 = mulStochQ16(d, params.phageYieldQ16, hash32(seed, step, i, 410u + m));
            if (dP > d) { dP = d; }
            let dA: u32 = d - dP;
            state[offW + base + m] = wm - d;
            state[offP + base + 0u] = state[offP + base + 0u] + dP;
            a = a + dA;
          }
        }
      }
    } else {
      for (var m: u32 = 0u; m < MOTIFS; m = m + 1u) {
        let wm: u32 = state[offW + base + m];
        let pm: u32 = state[offP + base + m];
        if (wm == 0u || pm == 0u) { continue; }
        var pCap: u32 = pm;
        if (pCap > 4096u) { pCap = 4096u; }
        var rateQ16: u32 = (params.kInfectQ16 * pCap) >> 10u;
        if (rateQ16 > 62259u) { rateQ16 = 62259u; }
        var d: u32 = mulStochQ16(wm, rateQ16, hash32(seed, step, i, 400u + m));
        if (d > wm) { d = wm; }
        if (d > 0u) {
          var dP: u32 = mulStochQ16(d, params.phageYieldQ16, hash32(seed, step, i, 410u + m));
          if (dP > d) { dP = d; }
          let dA: u32 = d - dP;
          state[offW + base + m] = wm - d;
          state[offP + base + m] = pm + dP;
          a = a + dA;
        }
      }
    }
  }

  // 1d. Phage decay: P_m -> A
  if (params.kDecayPQ16 > 0u) {
    for (var m: u32 = 0u; m < MOTIFS; m = m + 1u) {
      let pm: u32 = state[offP + base + m];
      if (pm == 0u) { continue; }
      var dec: u32 = mulStochQ16(pm, params.kDecayPQ16, hash32(seed, step, i, 420u + m));
      if (dec > pm) { dec = pm; }
      if (dec > 0u) {
        state[offP + base + m] = pm - dec;
        a = a + dec;
      }
    }
  }

  // 1e. Rare conserved prophage emergence: 5-unit W_dom -> P_target
  if (params.mutPhageU32 > 0u && hash32(seed, step, i, 430u) < params.mutPhageU32) {
    var domM: i32 = -1;
    var domW: u32 = 0u;
    for (var m: u32 = 0u; m < MOTIFS; m = m + 1u) {
      let wm: u32 = state[offW + base + m];
      if (wm > domW) { domW = wm; domM = i32(m); }
    }
    if (domM >= 0 && domW >= 10u) {
      var targetM: u32 = 0u;
      if (params.neutralPhage == 0u) {
        targetM = hash32(seed, step, i, 431u) % MOTIFS;
      }
      var q: u32 = 5u;
      if (domW < 5u) { q = domW; }
      state[offW + base + u32(domM)] = domW - q;
      state[offP + base + targetM] = state[offP + base + targetM] + q;
    }
  }

  state[i] = a;
  state[offF + i] = f;
}

@compute @workgroup_size(${DROPLET_WG})
fn pass2_mu(@builtin(global_invocation_id) gid: vec3<u32>) {
  let width: u32 = params.width;
  let height: u32 = params.height;
  let N: u32 = width * height;
  let i: u32 = gid.x;
  if (i >= N) { return; }

  let offW: u32 = 2u * N;
  let x: u32 = i % width;
  let y: u32 = i / width;
  let xL: u32 = select(width - 1u, x - 1u, x > 0u);
  let xR: u32 = select(0u, x + 1u, x + 1u < width);
  let yU: u32 = select(height - 1u, y - 1u, y > 0u) * width;
  let y0: u32 = y * width;
  let yD: u32 = select(0u, y + 1u, y + 1u < height) * width;
  let base: u32 = i * MOTIFS;

  var wTot: u32 = 0u;
  for (var m: u32 = 0u; m < MOTIFS; m = m + 1u) { wTot = wTot + state[offW + base + m]; }

  for (var m: u32 = 0u; m < MOTIFS; m = m + 1u) {
    let wm: u32 = state[offW + base + m];
    var c: i32 = i32(wm);
    if (c > 2048) { c = 2048; }
    var cOther: i32 = i32(wTot - wm);
    if (cOther > 4096) { cOther = 4096; }

    let wmCap: i32 = i32(min(wm, 4096u));
    let card: i32 = i32(
      min(state[offW + (y0 + xR) * MOTIFS + m], 4096u) +
      min(state[offW + (y0 + xL) * MOTIFS + m], 4096u) +
      min(state[offW + (yD + x) * MOTIFS + m], 4096u) +
      min(state[offW + (yU + x) * MOTIFS + m], 4096u)
    );
    let diag: i32 = i32(
      min(state[offW + (yU + xL) * MOTIFS + m], 4096u) +
      min(state[offW + (yU + xR) * MOTIFS + m], 4096u) +
      min(state[offW + (yD + xL) * MOTIFS + m], 4096u) +
      min(state[offW + (yD + xR) * MOTIFS + m], 4096u)
    );
    let lap9Raw: i32 = (4 * card + diag) - 20 * wmCap;
    let lapClamped: i32 = clamp(lap9Raw, -65536, 65536);
    let lapTerm: i32 = (i32(params.kappa6Q16) * lapClamped) >> 16u;

    let t1: i32 = (c * (1024 - c)) >> 10u;
    let t2: i32 = (t1 * (1024 - 2 * c)) >> 10u;
    var pack: i32 = 0;
    if (c > 1024) { pack = 2 * (c - 1024); }
    let bulkTerm: i32 = (i32(params.bulkBQ16) * (t2 + pack)) >> 16u;
    let chiTerm: i32 = (i32(params.chiQ16) * cOther) >> 16u;

    scratch[base + m] = bulkTerm + chiTerm - lapTerm;
  }
}

@compute @workgroup_size(${DROPLET_WG})
fn pass3_flux(@builtin(global_invocation_id) gid: vec3<u32>) {
  let width: u32 = params.width;
  let height: u32 = params.height;
  let N: u32 = width * height;
  let i: u32 = gid.x;
  if (i >= N) { return; }

  let offW: u32 = 2u * N;
  let offJE: u32 = 6u * N;
  let offJS: u32 = 12u * N;
  let step: u32 = stepBuf[0];
  let seed: u32 = params.seed;
  let x: u32 = i % width;
  let y: u32 = i / width;
  let xR: u32 = select(0u, x + 1u, x + 1u < width);
  let yD: u32 = select(0u, y + 1u, y + 1u < height) * width;
  let iE: u32 = y * width + xR;
  let iS: u32 = yD + x;
  let base: u32 = i * MOTIFS;
  let baseE: u32 = iE * MOTIFS;
  let baseS: u32 = iS * MOTIFS;

  for (var m: u32 = 0u; m < MOTIFS; m = m + 1u) {
    let wi: u32 = state[offW + base + m];
    let mui: i32 = scratch[base + m];

    // East edge
    {
      let we: u32 = state[offW + baseE + m];
      let r: u32 = hash32(seed, step, i, 100u + m * 2u);
      let nSigned: i32 = i32(r >> 16u) - 32768;
      var noiseQ16: i32 = 0;
      if (params.noiseQ8 > 0u) { noiseQ16 = (nSigned * i32(params.noiseQ8)) >> 8u; }
      let dMu: i32 = mui - scratch[baseE + m];
      let dW: i32 = i32(wi) - i32(we);
      let rawQ16: i32 = i32(params.mobQ16) * dMu + i32(params.diffWQ16) * dW + noiseQ16;
      var j: i32 = (rawQ16 + i32(r & 0xffffu)) >> 16u;
      let maxOutI: i32 = i32(wi >> 2u);
      let maxOutE: i32 = i32(we >> 2u);
      j = clamp(j, -maxOutE, maxOutI);
      scratch[offJE + base + m] = j;
    }

    // South edge
    {
      let ws: u32 = state[offW + baseS + m];
      let r: u32 = hash32(seed, step, i, 101u + m * 2u);
      let nSigned: i32 = i32(r >> 16u) - 32768;
      var noiseQ16: i32 = 0;
      if (params.noiseQ8 > 0u) { noiseQ16 = (nSigned * i32(params.noiseQ8)) >> 8u; }
      let dMu: i32 = mui - scratch[baseS + m];
      let dW: i32 = i32(wi) - i32(ws);
      let rawQ16: i32 = i32(params.mobQ16) * dMu + i32(params.diffWQ16) * dW + noiseQ16;
      var j: i32 = (rawQ16 + i32(r & 0xffffu)) >> 16u;
      let maxOutI: i32 = i32(wi >> 2u);
      let maxOutS: i32 = i32(ws >> 2u);
      j = clamp(j, -maxOutS, maxOutI);
      scratch[offJS + base + m] = j;
    }
  }
}

@compute @workgroup_size(${DROPLET_WG})
fn pass4_apply_diff(@builtin(global_invocation_id) gid: vec3<u32>) {
  let width: u32 = params.width;
  let height: u32 = params.height;
  let N: u32 = width * height;
  let i: u32 = gid.x;
  if (i >= N) { return; }

  let offF: u32 = N;
  let offW: u32 = 2u * N;
  let offP: u32 = 8u * N;
  let offJE: u32 = 6u * N;
  let offJS: u32 = 12u * N;
  let step: u32 = stepBuf[0];
  let seed: u32 = params.seed;
  let x: u32 = i % width;
  let y: u32 = i / width;
  let xL: u32 = select(width - 1u, x - 1u, x > 0u);
  let xR: u32 = select(0u, x + 1u, x + 1u < width);
  let yU: u32 = select(height - 1u, y - 1u, y > 0u) * width;
  let y0: u32 = y * width;
  let yD: u32 = select(0u, y + 1u, y + 1u < height) * width;
  let iE: u32 = y0 + xR;
  let iW: u32 = y0 + xL;
  let iS: u32 = yD + x;
  let iN: u32 = yU + x;
  let base: u32 = i * MOTIFS;

  for (var m: u32 = 0u; m < MOTIFS; m = m + 1u) {
    let wNew: i32 = i32(state[offW + base + m])
      + scratch[offJE + iW * MOTIFS + m] - scratch[offJE + base + m]
      + scratch[offJS + iN * MOTIFS + m] - scratch[offJS + base + m];
    state2[offW + base + m] = u32(wNew);
  }

  // F diffusion
  {
    let f0: u32 = state[offF + i];
    let outF: u32 = diffOut(f0, params.diffFQ16, hash32(seed, step, i, 200u));
    let inW: u32 = diffSend(state[offF + iW], params.diffFQ16, hash32(seed, step, iW, 200u), 0u);
    let inE: u32 = diffSend(state[offF + iE], params.diffFQ16, hash32(seed, step, iE, 200u), 1u);
    let inN: u32 = diffSend(state[offF + iN], params.diffFQ16, hash32(seed, step, iN, 200u), 2u);
    let inS: u32 = diffSend(state[offF + iS], params.diffFQ16, hash32(seed, step, iS, 200u), 3u);
    state2[offF + i] = f0 - outF + inW + inE + inN + inS;
  }

  // A diffusion
  {
    let a0: u32 = state[i];
    let outA: u32 = diffOut(a0, params.diffAQ16, hash32(seed, step, i, 201u));
    let inW: u32 = diffSend(state[iW], params.diffAQ16, hash32(seed, step, iW, 201u), 0u);
    let inE: u32 = diffSend(state[iE], params.diffAQ16, hash32(seed, step, iE, 201u), 1u);
    let inN: u32 = diffSend(state[iN], params.diffAQ16, hash32(seed, step, iN, 201u), 2u);
    let inS: u32 = diffSend(state[iS], params.diffAQ16, hash32(seed, step, iS, 201u), 3u);
    state2[i] = a0 - outA + inW + inE + inN + inS;
  }

  // P diffusion
  for (var m: u32 = 0u; m < MOTIFS; m = m + 1u) {
    let ch: u32 = 440u + m;
    let p0: u32 = state[offP + base + m];
    let outP: u32 = diffOut(p0, params.diffPQ16, hash32(seed, step, i, ch));
    let inW: u32 = diffSend(state[offP + iW * MOTIFS + m], params.diffPQ16, hash32(seed, step, iW, ch), 0u);
    let inE: u32 = diffSend(state[offP + iE * MOTIFS + m], params.diffPQ16, hash32(seed, step, iE, ch), 1u);
    let inN: u32 = diffSend(state[offP + iN * MOTIFS + m], params.diffPQ16, hash32(seed, step, iN, ch), 2u);
    let inS: u32 = diffSend(state[offP + iS * MOTIFS + m], params.diffPQ16, hash32(seed, step, iS, ch), 3u);
    state2[offP + base + m] = p0 - outP + inW + inE + inN + inS;
  }
}

@compute @workgroup_size(${DROPLET_WG})
fn pass5_mut_motif_copy(@builtin(global_invocation_id) gid: vec3<u32>) {
  let width: u32 = params.width;
  let height: u32 = params.height;
  let N: u32 = width * height;
  let j: u32 = gid.x;
  if (j >= N) { return; }

  let offF: u32 = N;
  let offW: u32 = 2u * N;
  let offP: u32 = 8u * N;
  let step: u32 = stepBuf[0];
  let seed: u32 = params.seed;
  let jb: u32 = j * MOTIFS;

  state[j] = state2[j];
  state[offF + j] = state2[offF + j];
  for (var m: u32 = 0u; m < MOTIFS; m = m + 1u) {
    state[offP + jb + m] = state2[offP + jb + m];
    state[offW + jb + m] = state2[offW + jb + m];
  }

  if (params.mutMotifU32 == 0u) { return; }

  let x: i32 = i32(j % width);
  let y: i32 = i32(j / width);
  let wi: i32 = i32(width);
  let hi: i32 = i32(height);

  var bestPrio: u32 = 0u;
  var bestIdx: i32 = -1;
  var bestDomM: u32 = 0u;
  var bestNewM: u32 = 0u;

  for (var dy: i32 = -3; dy <= 3; dy = dy + 1) {
    let cy: u32 = u32((y + dy + hi) % hi);
    let row: u32 = cy * width;
    for (var dx: i32 = -3; dx <= 3; dx = dx + 1) {
      if (dx * dx + dy * dy > 9) { continue; }
      let cx: u32 = u32((x + dx + wi) % wi);
      let cIdx: u32 = row + cx;
      if (hash32(seed, step, cIdx, 310u) >= params.mutMotifU32) { continue; }

      let cb: u32 = cIdx * MOTIFS;
      var domM: i32 = -1;
      var domW: u32 = 0u;
      for (var m: u32 = 0u; m < MOTIFS; m = m + 1u) {
        let wm: u32 = state2[offW + cb + m];
        if (wm > domW) { domW = wm; domM = i32(m); }
      }
      if (domM < 0 || domW < params.coreMinInt) { continue; }

      let prio: u32 = hash32(seed, step, cIdx, 312u);
      if (bestIdx < 0 || prio > bestPrio || (prio == bestPrio && i32(cIdx) > bestIdx)) {
        bestPrio = prio;
        bestIdx = i32(cIdx);
        bestDomM = u32(domM);
        bestNewM = (u32(domM) + 1u + (hash32(seed, step, cIdx, 311u) % (MOTIFS - 1u))) % MOTIFS;
      }
    }
  }

  if (bestIdx >= 0) {
    let wm: u32 = state[offW + jb + bestDomM];
    if (wm > 0u) {
      state[offW + jb + bestDomM] = 0u;
      state[offW + jb + bestNewM] = state[offW + jb + bestNewM] + wm;
    }
  }
}
`;
