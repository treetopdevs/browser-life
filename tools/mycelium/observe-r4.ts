// Mycelium rung R4 readouts: trail USE under the toll rule (docs/mycelium-r4-2026-11-14/PROTOCOL.md section 4).
//
// Pure functions of a state, computed at the heavy census (every 500 steps) from the live particles and the field, with the kernel untouched: the
// controllers' next-step outputs come from world.ts probe(), the "blind" outputs from probe() on a copy of the state whose config has
// blindTrailGradient true. Every readout is defined at zero trail and with no particles. A run stores the per-census values (R4Heavy), and every
// window readout is a deterministic function of the stored series (r4Values), as in R2b/R3. No Deno, no file system, no clock.
import { NN_O } from "@bl/schema";
import { OUT, POS_SHIFT, probe, type MyceliumState } from "./world.ts";
import { type R2bSeries, R2bObserver } from "./observe-r2b.ts";

const sat = (v: number) => (v > 127 ? 127 : v);
const clamp127 = (v: number) => (v < -127 ? -127 : v > 127 ? 127 : v);

/** Per-census values of the trail-use readouts (all numbers; see r4Census for the definitions). */
export interface R4Census {
  /** Mean cosine between a particle's intended movement (MX, MY) and the local trail gradient (gx, gy); 0 when no particle has both. */
  align: number;
  /** The same cosine for the outputs the controllers give with the two gradient inputs zeroed (the acute lesion); equals align in a blind arm. */
  alignBlind: number;
  /** The acute lesion effect: the mean over particles with a nonzero gradient of cos(out) - cos(blind out), a zero movement counting cosine 0; 0 with no such particle. */
  acute: number;
  /** Mean (|MX| + |MY|) / 254 of the intended movement, with the gradient inputs present and zeroed. */
  speed: number;
  speedBlind: number;
  /** Fraction of particles with a nonzero trail gradient, and with both a nonzero gradient and a nonzero movement. */
  gradFrac: number;
  qualFrac: number;
  /** Occupancy ratio: (mean trail in the particles' cells) / (mean trail over the field); 1 when there is no trail or no particle. */
  occ: number;
  /** The same ratio with every particle's cell displaced by half the torus in both axes (descriptive: what a trail unrelated to position would give). */
  occShift: number;
  /** Fractions of particles whose deposit request (maxDeposit * relu(DEPOSIT) >> 7) is 0, exactly 1, and 2 or more. */
  req0: number;
  req1: number;
  req2p: number;
  /** Fraction of particles standing where the discount is complete (min(P, 256) * td >= 256); 0 without trailMoveDiscount. */
  sat: number;
  /** Gradient sensitivity: the fraction of particles whose deposit request changes, and the mean |dMX| + |dMY| / 254, when the two gradient inputs are zeroed. */
  sensDep: number;
  sensMove: number;
  /** General dependence: the mean over particles of the summed |change| of the five used outputs (MX, MY, EAT, DEPOSIT, SPLIT) when the gradient inputs are zeroed, divided by 5 * 254. */
  sensAll: number;
}

export const R4_CENSUS_KEYS = ["align", "alignBlind", "acute", "speed", "speedBlind", "gradFrac", "qualFrac", "occ", "occShift", "req0", "req1", "req2p", "sat", "sensDep", "sensMove", "sensAll"] as const satisfies readonly (keyof R4Census)[];

/** The cell index of every live particle. */
function cellsOf(s: MyceliumState): Uint32Array {
  const W = s.config.width;
  const cell = new Uint32Array(s.n);
  for (let i = 0; i < s.n; i++) cell[i] = (s.y[i] >>> POS_SHIFT) * W + (s.x[i] >>> POS_SHIFT);
  return cell;
}

/** Mean of P over the cells in `cell`, divided by the mean of P over the field; 1 when either is empty or the field has no trail. */
export function occupancyRatio(P: ArrayLike<number>, cell: ArrayLike<number>, n: number, nCells: number): number {
  let total = 0, here = 0;
  for (let k = 0; k < nCells; k++) total += P[k];
  for (let i = 0; i < n; i++) here += P[cell[i]];
  return n === 0 || total === 0 ? 1 : (here / n) / (total / nCells);
}

/**
 * The census values of a state (PROTOCOL.md section 4). gx, gy are the two trail-gradient inputs exactly as the sense phase builds them (each
 * neighbour saturated at 127 after the sensor shift, then subtracted and clamped), taken from the state's own field.
 */
export function r4Census(s: MyceliumState): R4Census {
  const c = s.config, W = c.width, H = c.height, n = s.n, P = s.P, sh = c.sensorShift;
  const zero: R4Census = { align: 0, alignBlind: 0, acute: 0, speed: 0, speedBlind: 0, gradFrac: 0, qualFrac: 0, occ: 1, occShift: 1, req0: 0, req1: 0, req2p: 0, sat: 0, sensDep: 0, sensMove: 0, sensAll: 0 };
  if (n === 0) return zero;
  const cell = cellsOf(s);
  const out = probe(s);
  const blindOut = c.blindTrailGradient === true ? out : probe({ ...s, config: { ...c, blindTrailGradient: true } });
  let sensSum = 0, cosSum = 0, cosBlind = 0, acuteSum = 0, qualB = 0, spd = 0, spdB = 0, grad = 0, qual = 0, r0 = 0, r1 = 0, r2 = 0, satN = 0, dDep = 0, dMove = 0;
  const td = c.trailMoveDiscount;
  for (let i = 0; i < n; i++) {
    const ci = cell[i], cx = ci % W, cy = (ci / W) | 0;
    const e = cy * W + ((cx + 1) % W), w = cy * W + ((cx + W - 1) % W);
    const so = ((cy + 1) % H) * W + cx, no = ((cy + H - 1) % H) * W + cx;
    const gx = clamp127(sat(P[e] >>> sh) - sat(P[w] >>> sh)), gy = clamp127(sat(P[so] >>> sh) - sat(P[no] >>> sh));
    const o = i * NN_O, mx = out[o + OUT.MX], my = out[o + OUT.MY];
    if (gx !== 0 || gy !== 0) {
      grad++;
      const gn = Math.sqrt(gx * gx + gy * gy);
      const bx = blindOut[o + OUT.MX], by = blindOut[o + OUT.MY];
      let cs = 0, cb = 0;
      if (mx !== 0 || my !== 0) { qual++; cs = (mx * gx + my * gy) / (Math.sqrt(mx * mx + my * my) * gn); cosSum += cs; }
      if (bx !== 0 || by !== 0) { qualB++; cb = (bx * gx + by * gy) / (Math.sqrt(bx * bx + by * by) * gn); cosBlind += cb; }
      acuteSum += cs - cb;
    }
    spd += (Math.abs(mx) + Math.abs(my)) / 254;
    spdB += (Math.abs(blindOut[o + OUT.MX]) + Math.abs(blindOut[o + OUT.MY])) / 254;
    const req = (c.maxDeposit * Math.max(0, out[o + OUT.DEPOSIT])) >>> 7;
    if (req === 0) r0++; else if (req === 1) r1++; else r2++;
    if (td !== undefined && Math.min(P[ci], 256) * td >= 256) satN++;
    const reqB = (c.maxDeposit * Math.max(0, blindOut[o + OUT.DEPOSIT])) >>> 7;
    if (reqB !== req) dDep++;
    dMove += (Math.abs(mx - blindOut[o + OUT.MX]) + Math.abs(my - blindOut[o + OUT.MY])) / 254;
    for (const k of [OUT.MX, OUT.MY, OUT.EAT, OUT.DEPOSIT, OUT.SPLIT]) sensSum += Math.abs(out[o + k] - blindOut[o + k]);
  }
  const shifted = new Uint32Array(n);
  const hx = W >> 1, hy = H >> 1;
  for (let i = 0; i < n; i++) { const ci = cell[i]; shifted[i] = ((((ci / W) | 0) + hy) % H) * W + ((ci % W) + hx) % W; }
  return {
    align: qual === 0 ? 0 : cosSum / qual, alignBlind: qualB === 0 ? 0 : cosBlind / qualB, acute: grad === 0 ? 0 : acuteSum / grad, speed: spd / n, speedBlind: spdB / n, gradFrac: grad / n, qualFrac: qual / n,
    occ: occupancyRatio(P, cell, n, W * H), occShift: occupancyRatio(P, shifted, n, W * H),
    req0: r0 / n, req1: r1 / n, req2p: r2 / n, sat: satN / n, sensDep: dDep / n, sensMove: dMove / n, sensAll: sensSum / n / (5 * 254),
  };
}

// ---- the stored series --------------------------------------------------------------------------------------

/** The heavy-census columns R4 adds to R2b's series, one value per heavy census. */
export type R4Heavy = Record<(typeof R4_CENSUS_KEYS)[number], number[]>;
export interface R4Series extends R2bSeries { r4: R4Heavy & { step: number[] } }

export const emptyR4 = (): R4Series["r4"] => ({ step: [], ...(Object.fromEntries(R4_CENSUS_KEYS.map((k) => [k, [] as number[]])) as R4Heavy) });

/** R2b's observer plus the R4 columns at each heavy census. withSig is false in R4 (the signature is not an R4 readout). */
export class R4Observer {
  private readonly inner = new R2bObserver(false);
  private readonly extra = emptyR4();
  scalar(s: MyceliumState): void { this.inner.scalar(s); }
  heavy(s: MyceliumState): void {
    this.inner.heavy(s);
    const c = r4Census(s);
    this.extra.step.push(s.step);
    for (const k of R4_CENSUS_KEYS) this.extra[k].push(c[k]);
  }
  series(): R4Series { return { ...this.inner.series(), r4: this.extra }; }
}

/** The R4 columns must have one entry per heavy census, at the same steps as R2b's heavy series. */
export function r4SeriesProblems(ser: R4Series): string[] {
  const bad: string[] = [];
  if (!ser.r4) return ["the series has no r4 block"];
  if (JSON.stringify(ser.r4.step) !== JSON.stringify(ser.heavy.step)) bad.push("the r4 census steps differ from the heavy census steps");
  for (const k of R4_CENSUS_KEYS) {
    const col = ser.r4[k];
    if (!Array.isArray(col) || col.length !== ser.heavy.step.length) bad.push(`r4 column ${k} has the wrong length`);
    else if (col.some((v) => !Number.isFinite(v))) bad.push(`r4 column ${k} holds a non-finite value`);
  }
  return bad;
}

/** Mean over the heavy censuses whose step is in (lo, hi] of each R4 column; null when the window has no census. */
export function r4WindowMeans(ser: R4Series, lo: number, hi: number): Record<(typeof R4_CENSUS_KEYS)[number], number> | null {
  const idx: number[] = [];
  for (let k = 0; k < ser.r4.step.length; k++) if (ser.r4.step[k] > lo && ser.r4.step[k] <= hi) idx.push(k);
  if (idx.length === 0) return null;
  const out = {} as Record<(typeof R4_CENSUS_KEYS)[number], number>;
  for (const key of R4_CENSUS_KEYS) { let t = 0; for (const k of idx) t += ser.r4[key][k]; out[key] = t / idx.length; }
  return out;
}
