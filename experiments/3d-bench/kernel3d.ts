// Rung 1a (throwaway): the 3D extension of buildKernel's exact integer rule,
// plus a CPU reference of the affinity convolution. Pure BigInt, no sim-ref.

export interface Kernel3 {
  radius: number;
  /** Flattened (dx, dy, dz, w) quadruples. */
  taps: Int32Array;
  count: number;
  sum: number;
}

function isqrt(n: bigint): bigint {
  if (n < 2n) return n;
  let x = n;
  let y = (x + 1n) >> 1n;
  while (y < x) {
    x = y;
    y = (x + n / x) >> 1n;
  }
  return x;
}

/** Same rule as packages/schema/src/kernel.ts buildKernel with dz added (d2 includes dz^2). `flat` forces dz = 0. */
export function buildKernel3(radius: number, flat = false): Kernel3 {
  const ONE = 1n << 16n;
  const R = BigInt(radius);
  const taps: number[] = [];
  let sum = 0;
  const zr = flat ? 0 : radius;
  for (let dz = -zr; dz <= zr; dz++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const d2 = BigInt(dx * dx + dy * dy + dz * dz);
        if (d2 === 0n || d2 >= R * R) continue;
        const r = isqrt(d2 << 32n) / R;
        const t = (4n * r * (ONE - r)) >> 16n;
        const t4 = (t * t * t * t) >> 48n;
        const w = Number((t4 * 255n + (ONE >> 1n)) >> 16n);
        if (w === 0) continue;
        taps.push(dx, dy, dz, w);
        sum += w;
      }
    }
  }
  return { radius, taps: Int32Array.from(taps), count: taps.length / 4, sum };
}

/** Throws unless the generator is the same rule and inside the u32 bound. `ref2d` is the repo's buildKernel. */
export function assertKernels(ref2d: (r: number) => { taps: Int32Array; count: number; sum: number }): Record<string, { count: number; sum: number }> {
  const out: Record<string, { count: number; sum: number }> = {};
  const want: Record<number, number> = { 3: 92, 4: 250, 5: 460 };
  for (const [r, c] of Object.entries(want)) {
    const k = buildKernel3(Number(r));
    if (k.count !== c) throw new Error(`3D tap count R=${r}: got ${k.count}, doc says ${c}`);
    if (k.count * 255 * 16383 >= 2 ** 32) throw new Error(`overflow bound broken at R=${r}`);
    out[`3d R=${r}`] = { count: k.count, sum: k.sum };
    // closed under axis permutations and sign flips
    const set = new Map<string, number>();
    for (let t = 0; t < k.count; t++) set.set(`${k.taps[t * 4]},${k.taps[t * 4 + 1]},${k.taps[t * 4 + 2]}`, k.taps[t * 4 + 3]);
    for (let t = 0; t < k.count; t++) {
      const v = [k.taps[t * 4], k.taps[t * 4 + 1], k.taps[t * 4 + 2]], w = k.taps[t * 4 + 3];
      for (const p of [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]])
        for (let s = 0; s < 8; s++) {
          const q = p.map((i, a) => v[i] * (s >> a & 1 ? -1 : 1));
          if (set.get(q.join(",")) !== w) throw new Error(`3D kernel R=${r} not symmetric at ${v}`);
        }
    }
  }
  for (const r of [3, 4, 9]) {
    const f = buildKernel3(r, true), g = ref2d(r);
    if (f.count !== g.count || f.sum !== g.sum) throw new Error(`flat kernel R=${r} differs from buildKernel (count/sum)`);
    for (let t = 0; t < g.count; t++)
      if (f.taps[t * 4] !== g.taps[t * 4] || f.taps[t * 4 + 1] !== g.taps[t * 4 + 1] || f.taps[t * 4 + 3] !== g.taps[t * 4 + 2]) throw new Error(`flat kernel R=${r} differs at tap ${t}`);
    out[`2d R=${r}`] = { count: g.count, sum: g.sum };
  }
  return out;
}

/** growth() of the 2D affinity shader, in exact integer JS. */
export function growthRef(u: number, mu: number, sigma: number): number {
  const diff = Math.abs(u - mu);
  const dd = diff * diff;
  const s9 = 9 * sigma * sigma;
  if (dd >= s9) return -256;
  const xx = Math.floor(((s9 - dd) * 256) / s9);
  const y = Math.floor((xx * xx) / 256);
  const z = Math.floor((y * y) / 256);
  return 2 * z - 256;
}

export interface Fill {
  B: Uint32Array; P: Uint32Array; linLo: Uint32Array; linHi: Uint32Array; param0: Uint32Array;
}

export function lowbias32(v: number): number {
  let x = v >>> 0;
  x ^= x >>> 16; x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15; x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
}

/** Seeded fill: B, P small; ~3/4 cells alive with varied mu/sigma, rest dead (default branch). */
export function makeFill(n: number, seed: number, allAlive = false): Fill {
  const f: Fill = { B: new Uint32Array(n), P: new Uint32Array(n), linLo: new Uint32Array(n), linHi: new Uint32Array(n), param0: new Uint32Array(n) };
  for (let i = 0; i < n; i++) {
    const h = lowbias32(i ^ lowbias32(seed));
    f.B[i] = h % 301;
    f.P[i] = (h >>> 9) % 61;
    if (allAlive || (h >>> 30) !== 0) {
      f.linLo[i] = (h & 0xff) + 1;
      const mu = 100 + ((h >>> 3) % 1500);
      const sigma = 20 + ((h >>> 14) % 300);
      f.param0[i] = (mu | (sigma << 16)) >>> 0;
    }
  }
  return f;
}

/** CPU reference of the 3D affinity pass: U[i] (i32) for a wrapped torus of sx*sy*sz cells. */
export function affinity3dRef(sx: number, sy: number, sz: number, k: Kernel3, fill: Fill, massUnit: number, defMu: number, defSigma: number): Int32Array {
  const n = sx * sy * sz;
  const m = new Uint32Array(n);
  for (let i = 0; i < n; i++) m[i] = Math.min(fill.B[i] + fill.P[i], 16383);
  const U = new Int32Array(n);
  for (let z = 0; z < sz; z++) for (let y = 0; y < sy; y++) for (let x = 0; x < sx; x++) {
    let conv = 0;
    for (let t = 0; t < k.count; t++) {
      const gx = (x + k.taps[t * 4] + sx) % sx, gy = (y + k.taps[t * 4 + 1] + sy) % sy, gz = (z + k.taps[t * 4 + 2] + sz) % sz;
      conv += k.taps[t * 4 + 3] * m[(gz * sy + gy) * sx + gx];
    }
    const i = (z * sy + y) * sx + x;
    const uq = Math.floor(conv / k.sum);
    const uu = Math.min(Math.floor((uq * 1024) / massUnit), 4095);
    let mu = defMu, sigma = defSigma;
    if ((fill.linHi[i] | fill.linLo[i]) !== 0) {
      mu = fill.param0[i] & 0xffff;
      sigma = fill.param0[i] >>> 16;
    }
    U[i] = growthRef(uu, Math.min(mu, 4095), Math.min(Math.max(sigma, 1), 1023));
  }
  return U;
}
