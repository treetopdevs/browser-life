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

/** Neutral weight of the two rings that partition the RULE_VERSION 1 kernel (see `buildShapeKernel`). */
export const SHAPE_BASE = 64;
/** Largest reach of the far ring (the same bound as kernelRadius). */
export const SHAPE_MAX_REACH = 16;

export interface ShapeKernel extends KernelTable {
  reach: number;
  /** 2 without a far ring (reach == radius), else 3. */
  rings: number;
  /** Sum of tap weights per ring; ringSum[0] + ringSum[1] is the RULE_VERSION 1 kernel sum. */
  ringSum: [number, number, number];
}

/**
 * Heritable-shape kernel (WorldConfig.shapeReach, cells sandbox). The taps of
 * `buildKernel(radius)`, in the same order, tagged in their fourth component
 * with a ring: 0 for |d| < radius/2 and 1 for the rest. Ring 2, appended, is a
 * far shell radius < |d| < reach with the same polynomial profile across its
 * own width, (4 t (1 - t))^4 on t = (|d| - radius) / (reach - radius). A genome
 * weights the three ring means (see `shapeDensity` in @bl/sim-ref); with the
 * neutral weights (SHAPE_BASE, SHAPE_BASE, 0) the density is RULE_VERSION 1's.
 */
export function buildShapeKernel(radius: number, reach: number): ShapeKernel {
  const base = buildKernel(radius);
  const taps: number[] = [];
  const ringSum: [number, number, number] = [0, 0, 0];
  for (let k = 0; k < base.count; k++) {
    const dx = base.taps[k * 4], dy = base.taps[k * 4 + 1], w = base.taps[k * 4 + 2];
    const ring = 4 * (dx * dx + dy * dy) < radius * radius ? 0 : 1;
    taps.push(dx, dy, w, ring);
    ringSum[ring] += w;
  }
  if (reach > radius) {
    const ONE = 1n << 16n;
    const R = BigInt(radius), span = BigInt(reach - radius);
    for (let dy = -reach; dy <= reach; dy++) {
      for (let dx = -reach; dx <= reach; dx++) {
        const d2 = BigInt(dx * dx + dy * dy);
        if (d2 <= R * R || d2 >= BigInt(reach * reach)) continue;
        const t0 = (isqrt(d2 << 32n) - (R << 16n)) / span; // t in 1/2^16
        const t = (4n * t0 * (ONE - t0)) >> 16n;
        const t4 = (t * t * t * t) >> 48n;
        const w = Number((t4 * 255n + (ONE >> 1n)) >> 16n);
        if (w === 0) continue;
        taps.push(dx, dy, w, 2);
        ringSum[2] += w;
      }
    }
  }
  return { radius, reach, rings: reach > radius ? 3 : 2, taps: Int32Array.from(taps), count: taps.length / 4, sum: ringSum[0] + ringSum[1], ringSum };
}
