// Planning power for the transition hunt's two primary contrasts (docs/scaffold-transition-hunt-v1.md,
// "Sample size"), for generic effect sizes: no effect size is taken from earlier data.
//   Contrast A: exact one-sided Mann–Whitney, n v n independent histories; effect = P(X > Y) under a
//               normal location shift.
//   Contrast S: exact one-sided Wilcoxon signed-rank over n paired differences; effect = P(d > 0) for
//               normal differences.
//   For comparison, the exact sign test on the same pairs (zero power when no count can reject).
// Zero-inflated scenario (--zero z): with probability z a history's export is extinct (W = 0), modelled as
// a value tied below every other. In A each of the 2n values is replaced independently; in S both members
// of a pair are, so the pair's difference is 0 and the signed-rank test drops it.
// Power is per contrast at the given alpha, with Monte Carlo standard error sqrt(p(1 - p) / reps).
// A planning estimate only, never a decision input; not the probability of finding any seed.
//
//   deno run -A tools/hunt-power.ts [--n 24] [--reps 2000] [--seed 20261002] [--alpha 0.025,0.05] [--zero 0,0.25] [--out power.json]
import { parseArgs } from "jsr:@std/cli@1/parse-args";
import { mannWhitney, wilcoxonSignedRank } from "@bl/metrics";

const a = parseArgs(Deno.args, {
  string: ["n", "reps", "seed", "alpha", "zero", "out"],
  default: { n: "24", reps: "2000", seed: "20261002", alpha: "0.025,0.05", zero: "0,0.25" },
});
const n = Number(a.n), reps = Number(a.reps), seed = Number(a.seed);
const alphas = a.alpha.split(",").map(Number);
const zeros = a.zero.split(",").map(Number);
if (!Number.isInteger(n) || n < 1) throw new Error(`--n must be a positive integer, got ${a.n}`);
if (!Number.isInteger(reps) || reps < 1) throw new Error(`--reps must be a positive integer, got ${a.reps}`);
if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error(`--seed must be an integer in 0..2^32-1, got ${a.seed}`);
for (const x of alphas) if (!(x > 0 && x < 1)) throw new Error(`--alpha values must lie in (0, 1), got ${x}`);
for (const x of zeros) if (!(x >= 0 && x < 1)) throw new Error(`--zero values must lie in [0, 1), got ${x}`);
const EFFECTS = [0.65, 0.7, 0.75, 0.8];
/** Stands for an extinct export: below every simulated normal value, and tied with itself. */
const EXTINCT = -1e9;

// mulberry32: a small seeded PRNG, so the estimates are reproducible.
let s = seed >>> 0;
const rnd = () => {
  s = (s + 0x6d2b79f5) >>> 0;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const norm = () => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());
// Abramowitz–Stegun 7.1.26; ample for locating planning quantiles.
const erf = (x: number) => {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return x >= 0 ? y : -y;
};
const phi = (x: number) => 0.5 * (1 + erf(x / Math.SQRT2));
/** z with phi(z) = p, by bisection. */
const quantile = (p: number) => {
  let lo = -8, hi = 8;
  for (let i = 0; i < 80; i++) {
    const m = (lo + hi) / 2;
    if (phi(m) < p) lo = m;
    else hi = m;
  }
  return (lo + hi) / 2;
};
/** Exact one-sided sign-test p: P(X ≥ k) for X ~ Binomial(m, 1/2). */
function signP(k: number, m: number): number {
  let c = 1, tail = 0;
  for (let j = 0; j <= m; j++) {
    if (j >= k) tail += c;
    c = (c * (m - j)) / (j + 1);
  }
  return tail / 2 ** m;
}
const binomTail = (k: number, m: number, p: number) => {
  let tot = 0;
  for (let j = k; j <= m; j++) {
    let c = 1;
    for (let i = 0; i < j; i++) c = (c * (m - i)) / (i + 1);
    tot += c * p ** j * (1 - p) ** (m - j);
  }
  return tot;
};
const se = (p: number) => Math.sqrt((p * (1 - p)) / reps);
const r2 = (x: number) => Math.round(100 * x) / 100;

const out: Record<string, unknown>[] = [];
for (const alpha of alphas) {
  // The smallest count of positive signs that rejects; null when even n of n cannot.
  let kmin: number | null = null;
  for (let k = n; k >= 0 && signP(k, n) <= alpha; k--) kmin = k;
  for (const z of zeros) {
    for (const e of EFFECTS) {
      const shift = quantile(e) * Math.SQRT2; // P(X > Y) = phi(shift / sqrt 2)
      const mu = quantile(e); // P(d > 0) = phi(mu)
      let mw = 0, wx = 0;
      for (let r = 0; r < reps; r++) {
        const x = Array.from({ length: n }, () => (rnd() < z ? EXTINCT : norm() + shift));
        const y = Array.from({ length: n }, () => (rnd() < z ? EXTINCT : norm()));
        if (mannWhitney(x, y, "exact").pGreater <= alpha) mw++;
        const d = Array.from({ length: n }, () => (rnd() < z ? 0 : norm() + mu));
        if (wilcoxonSignedRank(d, "exact").pGreater <= alpha) wx++;
      }
      // The sign test is reported without zero inflation, for comparison with the uninflated rows only.
      const sign = kmin === null ? 0 : binomTail(kmin, n, e);
      const row = { alpha, zero: z, effect: e, mannWhitney: mw / reps, mannWhitneySE: se(mw / reps), signedRank: wx / reps, signedRankSE: se(wx / reps), sign: z === 0 ? sign : null, signNeeds: kmin };
      out.push(row);
      console.log(
        `alpha ${alpha}  zero ${z}  effect ${e}  Mann-Whitney ${r2(row.mannWhitney).toFixed(2)} ± ${row.mannWhitneySE.toFixed(3)}  signed-rank ${r2(row.signedRank).toFixed(2)} ± ${row.signedRankSE.toFixed(3)}` +
          (z === 0 ? `  sign (${kmin === null ? "cannot reject" : `needs ${kmin}/${n}`}) ${sign.toFixed(2)}` : ""),
      );
    }
  }
}
if (a.out) Deno.writeTextFileSync(a.out, JSON.stringify({ n, reps, seed, rows: out }, null, 1) + "\n");
