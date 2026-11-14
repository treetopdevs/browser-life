// Rung 1a (throwaway): WGSL generator for the 3D affinity pass and the 27-source transport stub.
// Mirrors affinityShader in packages/sim-gpu/src/shaders.ts: shared-memory halo tile, fully
// unrolled compile-time taps, register blocking, u32 accumulate, KSUM divide, genome branch,
// growth(), U write. The growth() text is copied verbatim (the original is not exported).
import { buildKernel3 } from "./kernel3d.ts";

export interface Aff3Opts {
  sx: number; sy: number; sz: number;
  radius: number;
  wg: [number, number, number];
  block: number;
  haloOnly?: boolean;
  /** Max words per `var<workgroup>` declaration. Deno/wgpu/Metal has a cost cliff for one declaration above ~8 KiB (see results.md), so a larger tile is split into several declarations behind ld()/st(). */
  split?: number;
  massUnit?: number; defMu?: number; defSigma?: number;
}

export interface Aff3Shader {
  code: string;
  dispatch: [number, number, number];
  smWords: number;
  nDecl: number;
  threads: number;
  taps: number;
  ksum: number;
  cells: number;
}

export const CELL_CH = 7;      // CELL_CHANNELS
export const GENOME_CH = 44;   // GENOME_CHANNELS
const CH_B = 1, CH_P = 3;      // CH.B, CH.P
const G_LIN_HI = 0, G_LIN_LO = 1, G_PARAM0 = 2;

export function affinity3dShader(o: Aff3Opts): Aff3Shader {
  const { sx, sy, sz, radius: R, wg, block: Bk } = o;
  const n = sx * sy * sz;
  const cb = wg.map((w) => w * Bk);
  const sw = cb.map((c) => c + 2 * R);
  const dispatch: [number, number, number] = [sx / cb[0], sy / cb[1], sz / cb[2]];
  if (dispatch.some((d) => !Number.isInteger(d))) throw new Error(`world ${sx}x${sy}x${sz} not divisible by block ${cb}`);
  const k = buildKernel3(R);
  const wmap = new Map<string, [number, number]>();
  for (let t = 0; t < k.count; t++) wmap.set(`${k.taps[t * 4]},${k.taps[t * 4 + 1]},${k.taps[t * 4 + 2]}`, [k.taps[t * 4 + 3], 0]);
  const lines: string[] = [];
  const S1 = sw[0], S2 = sw[0] * sw[1];
  if (o.haloOnly) {
    lines.push(`  for (var q = 0u; q < ${Bk * Bk * Bk}u; q++) { conv[q] = ld(b + i32(q)); }`);
  } else {
    for (let dz = -R; dz <= R + Bk - 1; dz++)
      for (let dy = -R; dy <= R + Bk - 1; dy++)
        for (let dx = -R; dx <= R + Bk - 1; dx++) {
          const terms: string[] = [];
          for (let cz = 0; cz < Bk; cz++)
            for (let cy = 0; cy < Bk; cy++)
              for (let cx = 0; cx < Bk; cx++) {
                const w = wmap.get(`${dx - cx},${dy - cy},${dz - cz}`);
                if (w) terms.push(`conv[${(cz * Bk + cy) * Bk + cx}] += ${w[0]}u * v;`);
              }
          if (!terms.length) continue;
          lines.push(`  { let v = ld(b + ${dz * S2 + dy * S1 + dx}); ${terms.join(" ")} }`);
        }
  }
  const threads = wg[0] * wg[1] * wg[2];
  const smWords = sw[0] * sw[1] * sw[2];
  const nCh = o.split ? Math.ceil(smWords / o.split) : 1;
  const CHW = Math.ceil(smWords / nCh);
  const decl = nCh === 1 ? `var<workgroup> sm: array<u32, ${smWords}>;` : Array.from({ length: nCh }, (_, c) => `var<workgroup> sm${c}: array<u32, ${c === nCh - 1 ? smWords - CHW * c : CHW}>;`).join("\n");
  const ldst = nCh === 1 ? `fn ld(i: i32) -> u32 { return sm[i]; }\nfn st(k: u32, v: u32) { sm[k] = v; }` :
    `fn ld(i: i32) -> u32 {\n${Array.from({ length: nCh - 1 }, (_, c) => `  if (i < ${(c + 1) * CHW}) { return sm${c}[i - ${c * CHW}]; }`).join("\n")}\n  return sm${nCh - 1}[i - ${(nCh - 1) * CHW}];\n}\nfn st(k: u32, v: u32) {\n${Array.from({ length: nCh - 1 }, (_, c) => `  if (k < ${(c + 1) * CHW}u) { sm${c}[k - ${c * CHW}u] = v; return; }`).join("\n")}\n  sm${nCh - 1}[k - ${(nCh - 1) * CHW}u] = v;\n}`;
  const code = /* wgsl */ `
const WX = ${sx}u; const WY = ${sy}u; const WZ = ${sz}u;
const N = ${n}u;
const CH_B = ${CH_B * n}u; const CH_P = ${CH_P * n}u;
const G_LIN_HI = ${G_LIN_HI * n}u; const G_LIN_LO = ${G_LIN_LO * n}u; const G_PARAM0 = ${G_PARAM0 * n}u;
const KSUM = ${k.sum}u;
const MASS_UNIT = ${o.massUnit ?? 256}u;
const DEF_MU = ${o.defMu ?? 1024}u;
const DEF_SIGMA = ${o.defSigma ?? 100}u;
const NEUTRAL = false;
@group(0) @binding(0) var<storage, read> cells: array<u32>;
@group(0) @binding(1) var<storage, read> genome: array<u32>;
@group(0) @binding(2) var<storage, read_write> U: array<i32>;

const R = ${R}u;
const SWX = ${sw[0]}u; const SWY = ${sw[1]}u;
const SMN = ${smWords}u;
const BK = ${Bk}u;
${decl}
${ldst}

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

@compute @workgroup_size(${wg[0]}, ${wg[1]}, ${wg[2]})
fn main(@builtin(local_invocation_id) lid: vec3<u32>, @builtin(workgroup_id) wid: vec3<u32>,
        @builtin(local_invocation_index) li: u32) {
  let ox = wid.x * ${cb[0]}u;
  let oy = wid.y * ${cb[1]}u;
  let oz = wid.z * ${cb[2]}u;
  for (var k = li; k < SMN; k += ${threads}u) {
    let tx = k % SWX;
    let ty = (k / SWX) % SWY;
    let tz = k / (SWX * SWY);
    let gx = (ox + tx + WX - R) % WX;
    let gy = (oy + ty + WY - R) % WY;
    let gz = (oz + tz + WZ - R) % WZ;
    let j = (gz * WY + gy) * WX + gx;
    st(k, min(cells[CH_B + j] + cells[CH_P + j], 16383u));
  }
  workgroupBarrier();
  let bx = ox + lid.x * BK;
  let by = oy + lid.y * BK;
  let bz = oz + lid.z * BK;
  let b = i32(((lid.z * BK + R) * SWY + (lid.y * BK + R)) * SWX + lid.x * BK + R);
  var conv: array<u32, ${Bk * Bk * Bk}>;
${lines.join("\n")}
  for (var q = 0u; q < BK * BK * BK; q++) {
    let x = bx + (q % BK);
    let y = by + ((q / BK) % BK);
    let z = bz + (q / (BK * BK));
    let i = (z * WY + y) * WX + x;
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
  return { code, nDecl: nCh, dispatch, smWords, threads, taps: k.count, ksum: k.sum, cells: n };
}

/** Trivial 27-source gather: 27 wrapped neighbour reads of `src`, one write. Not the real transport. */
export function transport27Shader(sx: number, sy: number, sz: number): { code: string; dispatch: [number, number, number]; cells: number } {
  const wg = 4;
  return {
    cells: sx * sy * sz,
    dispatch: [sx / wg, sy / wg, sz / wg],
    code: /* wgsl */ `
const WX = ${sx}u; const WY = ${sy}u; const WZ = ${sz}u;
@group(0) @binding(0) var<storage, read> src: array<u32>;
@group(0) @binding(1) var<storage, read_write> dst: array<u32>;
@compute @workgroup_size(${wg}, ${wg}, ${wg})
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  var acc = 0u;
  for (var dz = 0u; dz < 3u; dz++) {
    for (var dy = 0u; dy < 3u; dy++) {
      for (var dx = 0u; dx < 3u; dx++) {
        let x = (g.x + WX + dx - 1u) % WX;
        let y = (g.y + WY + dy - 1u) % WY;
        let z = (g.z + WZ + dz - 1u) % WZ;
        acc += src[(z * WY + y) * WX + x];
      }
    }
  }
  dst[(g.z * WY + g.y) * WX + g.x] = acc;
}
`,
  };
}
