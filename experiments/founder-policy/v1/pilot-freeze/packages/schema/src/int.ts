// Exact u32/i32 arithmetic with WGSL semantics (wrapping multiply/add,
// truncating division, x/0 === x). Every rule in the CPU reference goes
// through these helpers so it matches the GPU kernels bit for bit.

export const U32_MAX = 0xffffffff;

export const u32 = (x: number): number => x >>> 0;
export const i32 = (x: number): number => x | 0;
export const addu = (a: number, b: number): number => (a + b) >>> 0;
export const subu = (a: number, b: number): number => (a - b) >>> 0;
export const mulu = (a: number, b: number): number => Math.imul(a, b) >>> 0;
export const muli = (a: number, b: number): number => Math.imul(a, b);
export const divu = (a: number, b: number): number => {
  a >>>= 0;
  b >>>= 0;
  return b === 0 ? a : Math.floor(a / b) >>> 0;
};
export const divi = (a: number, b: number): number => {
  a |= 0;
  b |= 0;
  return b === 0 ? a : (a / b) | 0;
};
export const minu = (a: number, b: number): number => (a < b ? a : b);
export const maxu = (a: number, b: number): number => (a > b ? a : b);
export const clampi = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);

export function lowbias32(x: number): number {
  x = x >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d) >>> 0;
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b) >>> 0;
  x ^= x >>> 16;
  return x >>> 0;
}

export const GOLDEN = 0x9e3779b9;

/** Per-(seed, step, cell) random base. Draws derive from it with `draw`. */
export function cellBase(seed: number, step: number, cell: number): number {
  return lowbias32((cell ^ lowbias32((step ^ lowbias32(seed)) >>> 0)) >>> 0);
}

export function draw(base: number, k: number): number {
  return lowbias32((base ^ mulu(k + 1, GOLDEN)) >>> 0);
}

/**
 * Stochastically rounded q*k/2^s. Requires s <= 16 and k < 2^(32-s).
 * Expected value is exact; both sides of a transfer can recompute it.
 */
export function mulFrac(q: number, k: number, s: number, rnd: number): number {
  const mask = ((1 << s) - 1) >>> 0;
  const hi = mulu(q >>> s, k);
  const lo = mulu(q & mask, k);
  let r = addu(hi, lo >>> s);
  if ((lo & mask) >>> 0 > (rnd & mask) >>> 0) r = addu(r, 1);
  return r;
}

/** Exact floor(a * b / 2^s) for b < 2^(32 - s) and (a >> s) * b < 2^32. */
export function mulShr(a: number, b: number, s: number): number {
  const mask = ((1 << s) - 1) >>> 0;
  return addu(mulu(a >>> s, b), mulu(a & mask, b) >>> s);
}
