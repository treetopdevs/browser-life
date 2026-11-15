// ASAL's open-endedness scores on frame embeddings (Kumar et al., arXiv 2412.17799):
// historical nearest-neighbour similarity. Embeddings are L2-normalised.

export function cosine(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/** For each frame t >= 1, the largest cosine similarity to any earlier frame (null for t = 0). */
export function historicalMax(es: number[][]): (number | null)[] {
  return es.map((e, t) => {
    if (t === 0) return null;
    let m = -Infinity;
    for (let s = 0; s < t; s++) m = Math.max(m, cosine(e, es[s]));
    return m;
  });
}

/** Novelty n_t = 1 - max_{s<t} cos(e_t, e_s) (null for the first frame). */
export function novelty(es: number[][]): (number | null)[] {
  return historicalMax(es).map((m) => (m === null ? null : 1 - m));
}

/** ASAL open-endedness score: mean of max_{s<t} cos over the frames in `keep` (indices); lower = more open-ended. */
export function oeScore(es: number[][], keep: (t: number) => boolean): number {
  const hm = historicalMax(es);
  const xs = hm.filter((m, t): m is number => m !== null && keep(t));
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** Pearson correlation. */
export function pearson(xs: number[], ys: number[]): number {
  const n = xs.length, mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); dx += (xs[i] - mx) ** 2; dy += (ys[i] - my) ** 2; }
  return num / Math.sqrt(dx * dy);
}

/** Linear-interpolated quantile. */
export function quantile(xs: number[], q: number): number {
  const s = xs.slice().sort((a, b) => a - b), i = (s.length - 1) * q, lo = Math.floor(i);
  return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (i - lo);
}
