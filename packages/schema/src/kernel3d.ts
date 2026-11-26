// The 3D extension of buildKernel's exact integer rule (rung 1b; moved from experiments/3d-bench).
// Pure BigInt, no dependency on the simulators.

export interface Kernel3 {
  radius: number;
  /** Flattened (dx, dy, dz, w) quadruples, z outermost, then y, then x. */
  taps: Int32Array;
  count: number;
  sum: number;
}

export function isqrt(n: bigint): bigint {
  if (n < 2n) return n;
  let x = n;
  let y = (x + 1n) >> 1n;
  while (y < x) {
    x = y;
    y = (x + n / x) >> 1n;
  }
  return x;
}

/** Same rule as kernel.ts buildKernel with dz added (d2 includes dz^2). `flat` forces dz = 0. */
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
