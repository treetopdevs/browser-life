// Owner-conduit readouts and sizing arithmetic (docs/mycelium-bootstrap-owner-2026-11-15/DESIGN.md sections 2 and 3), EXPLORATORY.
//
// Pure functions of a state: no Deno, no file system, no clock. ownerEdgeCensus(s, g, q) is the owner analogue of observe-conduit's conduitCensus:
// the extra rate of a directed edge k -> nb is eff = ownerRate(De, g, q, Z[k], Z[nb], Q[k], Q[nb]) - De, the rule's own arithmetic. For a world that
// has no ownerConduit the runner passes a HYPOTHETICAL g and q (what an owner conduit of that strength would offer on that world's own Z and Q).
import { NN_O } from "@bl/schema";
import { OUT, ownerRate, ownerTag, POS_SHIFT, probe, type MyceliumState } from "./world.ts";
import { occupancyRatio } from "./observe-r4.ts";
import { CPUB_GRID, roundDiv } from "./observe-bootstrap.ts";

/** Groups under this many particles give no import mean (the conduit census's rule). */
export const MIN_GROUP = 20;
/** Histogram length: x = min(a, b) clamped to 255 (exact for the rate because the cap q is at most 255). */
export const HIST_N = 256;

const pct = (sorted: ArrayLike<number>, p: number): number | null => (sorted.length === 0 ? null : sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]);

function nbrs(k: number, W: number, H: number): [number, number, number, number] {
  const cx = k % W, cy = (k / W) | 0;
  return [cy * W + ((cx + 1) % W), cy * W + ((cx + W - 1) % W), ((cy + 1) % H) * W + cx, ((cy + H - 1) % H) * W + cx];
}

/** The extra rate of an edge with strength x (already the min over both cells) at conduit strength g, cap 255: min(De + ((x * g) >> 4), 128) - De. */
export const effOf = (x: number, g: number, De: number): number => Math.min(De + ((Math.min(x, 255) * g) >> 4), 128) - De;

export interface EdgeHists {
  /** own[x]: directed edges whose two cells carry the same nonzero owner, by min(Q_k, Q_nb) clamped to 255. */
  own: number[];
  /** pub[x]: all directed edges, by min(P_k, P_nb) clamped to 255. */
  pub: number[];
  /** All directed edges, 4 * W * H. */
  edges: number;
}

/** The two edge histograms of a state with owner planes (sizing and the C-pub match are pure arithmetic on them for any g). */
export function edgeHists(s: MyceliumState): EdgeHists {
  if (!s.Z || !s.Q) throw new Error("the state has no owner planes");
  const c = s.config, W = c.width, H = c.height, N = W * H;
  const own = new Array<number>(HIST_N).fill(0), pub = new Array<number>(HIST_N).fill(0);
  for (let k = 0; k < N; k++) {
    const nb = nbrs(k, W, H);
    for (let d = 0; d < 4; d++) {
      const j = nb[d];
      pub[Math.min(s.P[k], s.P[j], 255)]++;
      if (s.Z[k] !== 0 && s.Z[k] === s.Z[j]) own[Math.min(s.Q[k], s.Q[j], 255)]++;
    }
  }
  return { own, pub, edges: 4 * N };
}

/** Sum of two histograms (pooling censuses). */
export const addHist = (a: readonly number[], b: readonly number[]): number[] => a.map((v, i) => v + b[i]);
/** Median of a histogram (the lower median: the smallest x with cumulative count above half); null when empty. */
export function histMedian(h: readonly number[]): number | null {
  const tot = h.reduce((t, v) => t + v, 0);
  if (tot === 0) return null;
  let cum = 0;
  for (let x = 0; x < h.length; x++) { cum += h[x]; if (2 * cum > tot) return x; }
  return h.length - 1;
}
/** Mean extra rate over `edges` directed edges of a conduit of strength g whose edge strengths are distributed as `h` (edges outside `h` conduct nothing extra). */
export function meanEffFromHist(h: readonly number[], edges: number, g: number, De: number): number {
  let t = 0;
  for (let x = 0; x < h.length; x++) if (h[x]) t += h[x] * effOf(x, g, De);
  return edges ? t / edges : 0;
}

export interface OwnerEdgeCensus {
  /** Over directed edges out of occupied cells: share at the 128 limit, share with a positive extra rate, and p10/p50/p90 of the extra rate. */
  csat: number | null; live: number | null; effP10: number | null; effP50: number | null; effP90: number | null;
  /** p10/p50/p90 of min(Q_k, Q_nb, q) over the same-owner edges out of occupied cells; and their share of those edges. */
  xP10: number | null; xP50: number | null; xP90: number | null; sameOcc: number | null;
  /** Mean net extra import per particle, I_k = sum_e eff_e * (A[nb] - A[k]) / 1024: layers (deposit request > 0) against non-layers, and OWN (standing on its own tag) against the rest. */
  impLayer: number | null; impNon: number | null; impOwn: number | null; impOther: number | null; impAll: number | null;
  nLayer: number; nNon: number; nOwn: number; nOther: number;
  /** Residence on the owner rate map (mean extra rate at the particles' cells over the mean over all cells), and with every particle displaced by half the torus. */
  occx: number; occxShift: number;
  /** Mean extra rate over ALL directed edges (the C-pub matching quantity). */
  meanEff: number;
}

export const OWNER_KEYS = [
  "csat", "live", "effP10", "effP50", "effP90", "xP10", "xP50", "xP90", "sameOcc", "impLayer", "impNon", "impOwn", "impOther", "impAll",
  "nLayer", "nNon", "nOwn", "nOther", "occx", "occxShift", "meanEff",
] as const satisfies readonly (keyof OwnerEdgeCensus)[];

export function ownerEdgeCensus(s: MyceliumState, g: number, q: number): OwnerEdgeCensus {
  if (!s.Z || !s.Q) throw new Error("the state has no owner planes");
  const c = s.config, W = c.width, H = c.height, N = W * H, De = c.diffA, Z = s.Z, Q = s.Q, A = s.A, n = s.n, mode = c.trailOwner!;
  const cnt = new Uint32Array(N), cellOf = new Uint32Array(n);
  for (let i = 0; i < n; i++) { const k = (s.y[i] >>> POS_SHIFT) * W + (s.x[i] >>> POS_SHIFT); cellOf[i] = k; cnt[k]++; }
  const Ek = new Float64Array(N), Ik = new Float64Array(N);
  const effs: number[] = [], xs: number[] = [];
  let satN = 0, liveN = 0, edges = 0, total = 0;
  for (let k = 0; k < N; k++) {
    const nb = nbrs(k, W, H);
    let esum = 0, imp = 0;
    for (let d = 0; d < 4; d++) {
      const j = nb[d];
      const dd = ownerRate(De, g, q, Z[k], Z[j], Q[k], Q[j]), eff = dd - De;
      esum += eff; total += eff; imp += (eff * (A[j] - A[k])) / 1024;
      if (cnt[k] > 0) {
        edges++; effs.push(eff);
        if (dd === 128) satN++;
        if (eff > 0) liveN++;
        if (Z[k] !== 0 && Z[k] === Z[j]) xs.push(Math.min(Q[k], Q[j], q));
      }
    }
    Ek[k] = esum / 4; Ik[k] = imp;
  }
  const srt = (a: number[]) => Float64Array.from(a).sort();
  const se = srt(effs), sx = srt(xs);
  const out = n > 0 ? probe(s) : new Int32Array(0);
  let sL = 0, nL = 0, sN = 0, nN = 0, sO = 0, nO = 0, sX = 0, nX = 0, sAll = 0;
  for (let i = 0; i < n; i++) {
    const v = Ik[cellOf[i]];
    sAll += v;
    if (((c.maxDeposit * Math.max(0, out[i * NN_O + OUT.DEPOSIT])) >>> 7) > 0) { sL += v; nL++; } else { sN += v; nN++; }
    if (Z[cellOf[i]] === ownerTag(mode === "id" ? s.id[i] : s.gid[i])) { sO += v; nO++; } else { sX += v; nX++; }
  }
  const grp = (sum: number, k: number) => (k >= MIN_GROUP ? sum / k : null);
  const shifted = new Uint32Array(n);
  for (let i = 0; i < n; i++) { const k = cellOf[i]; shifted[i] = ((((k / W) | 0) + (H >> 1)) % H) * W + ((k % W) + (W >> 1)) % W; }
  return {
    csat: edges ? satN / edges : null, live: edges ? liveN / edges : null, effP10: pct(se, 0.1), effP50: pct(se, 0.5), effP90: pct(se, 0.9),
    xP10: pct(sx, 0.1), xP50: pct(sx, 0.5), xP90: pct(sx, 0.9), sameOcc: edges ? xs.length / edges : null,
    impLayer: grp(sL, nL), impNon: grp(sN, nN), impOwn: grp(sO, nO), impOther: grp(sX, nX), impAll: n ? sAll / n : null,
    nLayer: nL, nNon: nN, nOwn: nO, nOther: nX,
    occx: occupancyRatio(Ek, cellOf, n, N), occxShift: occupancyRatio(Ek, shifted, n, N),
    meanEff: total / (4 * N),
  };
}

// ---- sizing rules O1 to O3 (pure arithmetic on pooled late histograms, one per run) -----------------------------------

const median = (a: readonly number[]): number | null => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };

/** O1 / O2: g = clamp(roundDiv(480, x), 1, 255) from the median over runs of each run's median same-owner x. No same-owner edge, or a median of 0: g 255, no bite likely. */
export function ownerGFromX(perRunMedianX: readonly (number | null)[]): { g: number; x: number | null; noBiteLikely: boolean } {
  const xs = perRunMedianX.filter((v): v is number => v !== null);
  const x = xs.length === perRunMedianX.length ? median(xs) : null;
  if (x === null || x <= 0) return { g: 255, x, noBiteLikely: true };
  // x can be a half-integer (an even number of runs): roundDiv on doubled integers keeps the arithmetic exact.
  return { g: Math.max(1, Math.min(255, roundDiv(960, Math.round(2 * x)))), x, noBiteLikely: false };
}

/**
 * O3: the public strength g' whose mean extra rate matches the owner conduit's at gOwner, on the same states. Per run: ratio(g') = pub(g') / own(gOwner),
 * both mean EXTRA rates (base diffA subtracted) over all directed edges; the chosen g' minimises |median over runs of ratio - 1|; void beyond 10 percent,
 * or when any run's owner mean is 0 (nothing to match).
 */
export function matchCpubFromHists(runs: readonly { own: readonly number[]; pub: readonly number[]; edges: number }[], gOwner: number, De: number): { g: number; ratio: number | null; void: boolean; perG: { g: number; ratio: number | null }[] } {
  const perG = CPUB_GRID.map((g) => {
    const rs = runs.map((r) => { const o = meanEffFromHist(r.own, r.edges, gOwner, De); return o > 0 ? meanEffFromHist(r.pub, r.edges, g, De) / o : null; });
    return { g, ratio: rs.length && rs.every((v) => v !== null) ? median(rs as number[]) : null };
  });
  let best = perG[0], bestErr = Infinity;
  for (const p of perG) { const err = p.ratio === null ? Infinity : Math.abs(p.ratio - 1); if (err < bestErr) { best = p; bestErr = err; } }
  return { g: best.g, ratio: best.ratio, void: !(bestErr <= 0.10), perG };
}

/** The realised C-pub ratio of one slot: mean public extra rate (the C-pub run's late window) over mean owner extra rate (the EC run's); null when either is missing or the owner mean is 0. */
export const realisedCpubRatio = (pubMeanEff: number | null | undefined, ownMeanEff: number | null | undefined): number | null =>
  pubMeanEff == null || ownMeanEff == null || !(ownMeanEff > 0) ? null : pubMeanEff / ownMeanEff;
/** The control is void when the median realised ratio is missing or outside 0.9 to 1.1. */
export const cpubRealisedVoid = (ratios: readonly (number | null)[]): boolean => {
  if (!ratios.length || ratios.some((r) => r === null)) return true;
  const m = median(ratios as number[])!;
  return !(m >= 0.9 && m <= 1.1);
};
