// Conduit-screen readouts (docs/mycelium-conduit-2026-11-14/DESIGN.md section 6, readouts 1-6), EXPLORATORY.
//
// Pure functions of a state, no Deno, no file system, no clock. conduitCensus(s, g, q) takes the conduit strength and cap explicitly: for a run
// that has the conduit they are the config's own; for a keyless or toll reference run the runner passes a HYPOTHETICAL g and q (the readouts
// then say what a conduit of that strength would offer on that world's own trail and nutrient, they do not describe anything the world did).
// Effective conductance of a directed edge k -> nb is eff = conduitRate(De, g, q, P[k], P[nb]) - De, the rule's own arithmetic.
import { NN_O } from "@bl/schema";
import { conduitRate, OUT, POS_SHIFT, probe, probeLesion, type MyceliumState } from "./world.ts";
import { occupancyRatio } from "./observe-r4.ts";

/** Per-census conduit values. null = undefined for this census (no occupied cell, a group under MIN_GROUP particles, ...). */
export interface ConduitCensus {
  /** Share of directed edges out of occupied cells whose rate is at the 128 limit; and share at the configured cap (x = q, or the 128 limit). */
  csat: number | null; csatCap: number | null;
  /** p10, p50, p90 of eff over those edges. */
  effP10: number | null; effP50: number | null; effP90: number | null;
  /** The same edge-level eff as a share of the headroom 128 - De at p50 (the sizing criterion: 10 to 60 percent). */
  effP50Share: number | null;
  /** p10, p50, p90 of P over occupied cells, and of x_e = min(P[k], P[nb], q) over the same edges. */
  pcP10: number | null; pcP50: number | null; pcP90: number | null;
  xP10: number | null; xP50: number | null; xP90: number | null;
  /** Mean net extra import per particle, I_k = sum_e eff_e * (A[nb] - A[k]) / 1024, layers (deposit request > 0) and non-layers, and by xcell >= 32. */
  impLayer: number | null; impNon: number | null; impHi: number | null; impLo: number | null;
  nLayer: number; nNon: number; nHi: number; nLo: number;
  /** Mean I_k over all particles. */
  impAll: number | null;
  /** Share of cells with P >= CONN_MIN that have a 4-neighbour with P >= CONN_MIN, the largest such component (cells), and the node count. */
  connShare: number | null; connLargest: number; connNodes: number;
  /** Residence: (mean E_k at the particles' cells) / (mean E_k over all cells), and the same with every particle displaced by half the torus. 1 when undefined. */
  occx: number; occxShift: number;
  /** Lesions: mean over particles of the summed |change| of the five used outputs / (5 * 254), when input 2 (level) or inputs 5 and 6 (nutrient) are zeroed. */
  sensLevel: number | null; sensNut: number | null;
}

export const CONDUIT_KEYS = [
  "csat", "csatCap", "effP10", "effP50", "effP90", "effP50Share", "pcP10", "pcP50", "pcP90", "xP10", "xP50", "xP90", "impLayer", "impNon", "impHi", "impLo",
  "nLayer", "nNon", "nHi", "nLo", "impAll", "connShare", "connLargest", "connNodes", "occx", "occxShift", "sensLevel", "sensNut",
] as const satisfies readonly (keyof ConduitCensus)[];

export const MIN_GROUP = 20;
export const CONN_MIN = 16;
export const XCELL_HI = 32;

const pct = (sorted: ArrayLike<number>, p: number): number | null => (sorted.length === 0 ? null : sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]);

/** The four neighbour indices of cell k, in the rule's direction order (east, west, south, north). */
function nbrs(k: number, W: number, H: number): [number, number, number, number] {
  const cx = k % W, cy = (k / W) | 0;
  return [cy * W + ((cx + 1) % W), cy * W + ((cx + W - 1) % W), ((cy + 1) % H) * W + cx, ((cy + H - 1) % H) * W + cx];
}

export function conduitCensus(s: MyceliumState, g: number, q: number): ConduitCensus {
  const c = s.config, W = c.width, H = c.height, N = W * H, De = c.diffA, P = s.P, A = s.A, n = s.n;
  const cnt = new Uint32Array(N);
  const cellOf = new Uint32Array(n);
  for (let i = 0; i < n; i++) { const k = (s.y[i] >>> POS_SHIFT) * W + (s.x[i] >>> POS_SHIFT); cellOf[i] = k; cnt[k]++; }
  const Ek = new Float64Array(N), Ik = new Float64Array(N), xcell = new Uint32Array(N);
  const effs: number[] = [], xs: number[] = [], pcs: number[] = [];
  let satN = 0, capN = 0, edges = 0;
  for (let k = 0; k < N; k++) {
    const nb = nbrs(k, W, H);
    let esum = 0, imp = 0, xm = 0;
    for (let d = 0; d < 4; d++) {
      const x = Math.min(P[k], P[nb[d]], q);
      const dd = conduitRate(De, g, q, P[k], P[nb[d]]);
      const eff = dd - De;
      esum += eff; imp += (eff * (A[nb[d]] - A[k])) / 1024; if (x > xm) xm = x;
      if (cnt[k] > 0) {
        edges++; effs.push(eff); xs.push(x);
        if (dd === 128) satN++;
        if (dd === 128 || x === q) capN++;
      }
    }
    Ek[k] = esum / 4; Ik[k] = imp; xcell[k] = xm;
    if (cnt[k] > 0) pcs.push(P[k]);
  }
  const srt = (a: number[]) => Float64Array.from(a).sort();
  const se = srt(effs), sx = srt(xs), sp = srt(pcs);
  const head = 128 - De;
  const eff50 = pct(se, 0.5);

  // Layers and non-layers come from the controllers' own deposit request (maxDeposit * relu(DEPOSIT) >> 7 > 0), as R4's req0.
  const out = n > 0 ? probe(s) : new Int32Array(0);
  let sL = 0, nL = 0, sN = 0, nN = 0, sH = 0, nH = 0, sLo = 0, nLo = 0, sAll = 0;
  for (let i = 0; i < n; i++) {
    const v = Ik[cellOf[i]];
    sAll += v;
    if (((c.maxDeposit * Math.max(0, out[i * NN_O + OUT.DEPOSIT])) >>> 7) > 0) { sL += v; nL++; } else { sN += v; nN++; }
    if (xcell[cellOf[i]] >= XCELL_HI) { sH += v; nH++; } else { sLo += v; nLo++; }
  }
  const grp = (sum: number, cntg: number) => (cntg >= MIN_GROUP ? sum / cntg : null);

  // Connectivity of the trail network (nodes: P >= CONN_MIN, edges: 4-neighbours).
  const node = new Uint8Array(N);
  let nodes = 0;
  for (let k = 0; k < N; k++) if (P[k] >= CONN_MIN) { node[k] = 1; nodes++; }
  let linked = 0, largest = 0;
  const seen = new Uint8Array(N), stack: number[] = [];
  for (let k = 0; k < N; k++) {
    if (!node[k]) continue;
    const nb = nbrs(k, W, H);
    if (node[nb[0]] || node[nb[1]] || node[nb[2]] || node[nb[3]]) linked++;
    if (seen[k]) continue;
    let size = 0; seen[k] = 1; stack.push(k);
    while (stack.length) {
      const u = stack.pop()!; size++;
      for (const v of nbrs(u, W, H)) if (node[v] && !seen[v]) { seen[v] = 1; stack.push(v); }
    }
    if (size > largest) largest = size;
  }

  // Residence.
  const shifted = new Uint32Array(n);
  for (let i = 0; i < n; i++) { const k = cellOf[i]; shifted[i] = ((((k / W) | 0) + (H >> 1)) % H) * W + ((k % W) + (W >> 1)) % W; }

  // Lesions, in situ (observer-only, same code path as probe).
  const sens = (zero: number[]) => {
    if (n === 0) return null;
    const o2 = probeLesion(s, zero);
    let t = 0;
    for (let i = 0; i < n; i++) for (const k of [OUT.MX, OUT.MY, OUT.EAT, OUT.DEPOSIT, OUT.SPLIT]) t += Math.abs(out[i * NN_O + k] - o2[i * NN_O + k]);
    return t / n / (5 * 254);
  };

  return {
    csat: edges ? satN / edges : null, csatCap: edges ? capN / edges : null,
    effP10: pct(se, 0.1), effP50: eff50, effP90: pct(se, 0.9), effP50Share: eff50 === null || head <= 0 ? null : eff50 / head,
    pcP10: pct(sp, 0.1), pcP50: pct(sp, 0.5), pcP90: pct(sp, 0.9), xP10: pct(sx, 0.1), xP50: pct(sx, 0.5), xP90: pct(sx, 0.9),
    impLayer: grp(sL, nL), impNon: grp(sN, nN), impHi: grp(sH, nH), impLo: grp(sLo, nLo),
    nLayer: nL, nNon: nN, nHi: nH, nLo: nLo, impAll: n ? sAll / n : null,
    connShare: nodes ? linked / nodes : null, connLargest: largest, connNodes: nodes,
    occx: occupancyRatio(Ek, cellOf, n, N), occxShift: occupancyRatio(Ek, shifted, n, N),
    sensLevel: sens([2]), sensNut: sens([5, 6]),
  };
}

// ---- the stored series --------------------------------------------------------------------------------------

export interface ConduitSeries { step: number[]; cols: Record<(typeof CONDUIT_KEYS)[number], (number | null)[]> }
export const emptyConduit = (): ConduitSeries => ({ step: [], cols: Object.fromEntries(CONDUIT_KEYS.map((k) => [k, [] as (number | null)[]])) as ConduitSeries["cols"] });
export function pushConduit(ser: ConduitSeries, step: number, c: ConduitCensus): void {
  ser.step.push(step);
  for (const k of CONDUIT_KEYS) ser.cols[k].push(c[k]);
}
/** Mean over the non-null entries of each column over the censuses with step in (lo, hi]; a column with none is null. */
export function conduitWindow(ser: ConduitSeries, lo: number, hi: number): Record<(typeof CONDUIT_KEYS)[number], number | null> {
  const out = {} as Record<(typeof CONDUIT_KEYS)[number], number | null>;
  for (const key of CONDUIT_KEYS) {
    let t = 0, m = 0;
    for (let i = 0; i < ser.step.length; i++) if (ser.step[i] > lo && ser.step[i] <= hi && ser.cols[key][i] !== null) { t += ser.cols[key][i] as number; m++; }
    out[key] = m ? t / m : null;
  }
  return out;
}
