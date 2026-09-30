// Lenia ring kernel as an exact integer table. Built with BigInt so every
// JS engine produces identical weights; the table is uploaded as data.

export interface KernelTable {
  radius: number;
  /** Flattened (dx, dy, w, 0) quadruples. */
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

/** Polynomial shell b(r) = (4 r (1 - r))^4 on r = |d| / R, scaled to 0..255. */
export function buildKernel(radius: number): KernelTable {
  const ONE = 1n << 16n;
  const R = BigInt(radius);
  const taps: number[] = [];
  let sum = 0;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const d2 = BigInt(dx * dx + dy * dy);
      if (d2 === 0n || d2 >= R * R) continue;
      const r = isqrt(d2 << 32n) / R; // r in 1/2^16
      const t = (4n * r * (ONE - r)) >> 16n; // 4r(1-r) in 1/2^16
      const t4 = (t * t * t * t) >> 48n; // in 1/2^16
      const w = Number((t4 * 255n + (ONE >> 1n)) >> 16n);
      if (w === 0) continue;
      taps.push(dx, dy, w, 0);
      sum += w;
    }
  }
  return { radius, taps: Int32Array.from(taps), count: taps.length / 4, sum };
}
