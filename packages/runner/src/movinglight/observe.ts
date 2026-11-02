// Read-only observer (movinglight-metrics-v1). It reads cell arrays, the ledger and RefSim.light at census steps and never touches physics.
// Everything is an integer or an integer-scaled rational: positions in 1/Q cell, errors and variances x1000, ratios in ppm.
import { CH, G, cellCount, ledgerResidual, packLineageLo, stateHash, totalsOf, FLUX_NAMES, type WorldState } from "@bl/schema";
import { RefSim } from "@bl/sim-ref";
import type { Arm } from "./arms.ts";
import { PROTOCOL, type Protocol } from "./protocol.ts";
import { circ, meridianPath, scoredFrom } from "./schedule.ts";

export const METRICS_VERSION = "movinglight-metrics-v1";

/** One census of an arm, enough to compute every readout over any window. */
export interface Census {
  t: number;
  lightIn: bigint;
  emit: bigint;
  photo: bigint;
  B: number;
  /** Sum over occupied cells of B * signed circular distance to the meridian, and of B * |distance|. */
  sumBd: number;
  sumBabs: number;
  /** Biomass-weighted light at the occupied cells, summed (B * L). */
  sumBL: number;
  /** Cohesion of the lineage centroids about their unwrapped centre: variance (cells^2 x1000), biomass fraction within the radius (ppm); null when they span over W/2. */
  cohVar1000: number | null;
  cohFracPpm: number | null;
  /** Temporal response lag: steps since the meridian last stood at the centroid cell; null when it never did. */
  lag: number | null;
  /** Per body k = 1..n: centroid x in 1/Q cell (mod W*Q) and its biomass, or null when extinct. */
  bodies: ({ q: number; B: number } | null)[];
  residual: bigint;
}

export interface Series {
  strategy: Arm["strategy"];
  placement: Arm["placement"];
  schedule: Arm["schedule"];
  seed: number;
  inputB: number;
  inputE: number;
  inputEnergy: number;
  censuses: Census[];
  hashes: string[];
  endHash: string;
}

const modQ = (v: number, WQ: number) => ((v % WQ) + WQ) % WQ;
/** Signed circular difference of two positions in 1/Q cell, in (-WQ/2, WQ/2]. */
export const circQ = (a: number, b: number, WQ: number): number => {
  let d = modQ(a - b, WQ);
  if (d > WQ >> 1) d -= WQ;
  return d;
};

/** Biomass-weighted unwrapped centroid of a set of cells: anchor = heaviest cell's x, then the mean signed offset. */
function centroidQ(cells: { x: number; B: number }[], W: number, Q: number): number | null {
  if (cells.length === 0) return null;
  let anchor = cells[0];
  for (const c of cells) if (c.B > anchor.B) anchor = c;
  let sb = 0, sbu = 0;
  for (const c of cells) {
    sb += c.B;
    sbu += c.B * circ(c.x, anchor.x, W);
  }
  return modQ(anchor.x * Q + Math.floor((Q * sbu) / sb), W * Q);
}

export function takeCensus(sim: RefSim, t: number, path: readonly number[], p: Protocol, start: WorldState, totalsStart: { energy: bigint }): Census {
  const s = sim.state;
  const cfg = s.cfg;
  const n = cellCount(cfg), W = p.W, Q = p.Q;
  const m = path[t];
  const byBody: { x: number; B: number }[][] = Array.from({ length: p.n }, () => []);
  let B = 0, sumBd = 0, sumBabs = 0, sumBL = 0;
  const los = Array.from({ length: p.n }, (_, k) => packLineageLo(cfg, k + 1));
  for (let i = 0; i < n; i++) {
    const b = s.cells[CH.B * n + i];
    if (b === 0) continue;
    const x = i % W, y = Math.floor(i / W);
    const d = circ(x, m, W);
    B += b;
    sumBd += b * d;
    sumBabs += b * Math.abs(d);
    sumBL += b * sim.light(x, y, t);
    if (s.genome[G.LIN_HI * n + i] === 0) {
      const k = los.indexOf(s.genome[G.LIN_LO * n + i]);
      if (k >= 0) byBody[k].push({ x, B: b });
    }
  }
  const bodies = byBody.map((cells) => {
    const q = centroidQ(cells, W, Q);
    return q === null ? null : { q, B: cells.reduce((x, c) => x + c.B, 0) };
  });
  // Cohesion of the lineage centroids about an unwrapped centre (anchor = heaviest body); null when they span over W/2.
  let cohVar1000: number | null = null, cohFracPpm: number | null = null, lag: number | null = null;
  const alive = bodies.filter((x): x is { q: number; B: number } => x !== null);
  if (alive.length) {
    let anchor = alive[0];
    for (const b of alive) if (b.B > anchor.B) anchor = b;
    const WQ = W * Q;
    const us = alive.map((b) => ({ u: circQ(b.q, anchor.q, WQ), B: b.B }));
    const lo = Math.min(...us.map((x) => x.u)), hi = Math.max(...us.map((x) => x.u));
    const nbody = us.reduce((a, x) => a + x.B, 0);
    const cQ = Math.floor(us.reduce((a, x) => a + x.B * x.u, 0) / nbody);
    if (hi - lo <= WQ >> 1) {
      let v = 0, within = 0;
      for (const x of us) {
        v += x.B * (x.u - cQ) * (x.u - cQ);
        if (Math.abs(x.u - cQ) <= p.cohesionRadius * Q) within += x.B;
      }
      cohVar1000 = Math.floor((1000 * v) / (nbody * Q * Q));
      cohFracPpm = Math.floor((p.PPM * within) / nbody);
    }
    const cx = modQ(Math.round((anchor.q + cQ) / Q), W);
    for (let u = t; u >= 0; u--)
      if (path[u] === cx) {
        lag = t - u;
        break;
      }
  }
  void start;
  return {
    t,
    lightIn: s.lightIn,
    emit: s.flux[FLUX_NAMES.indexOf("emit")],
    photo: s.flux[FLUX_NAMES.indexOf("photo")],
    B,
    sumBd,
    sumBabs,
    sumBL,
    cohVar1000,
    cohFracPpm,
    lag,
    bodies,
    residual: ledgerResidual(totalsStart, s),
  };
}

export interface RunOptions {
  /** Instrument the run. false gives the plain twin (state hashes only). */
  observe?: boolean;
  p?: Protocol;
  steps?: number;
}

/** Run an arm for the horizon, taking a census every p.census steps (and at 0). Conservation must be exactly zero at every census. */
export function runArm(arm: Arm, opts: RunOptions = {}): Series {
  const p = opts.p ?? PROTOCOL;
  const observe = opts.observe ?? true;
  const steps = opts.steps ?? p.T;
  const path = meridianPath(arm.schedule, p);
  // The reversed schedule is scored from its realised turn: take one extra census exactly there.
  const turn = arm.schedule === "reversed" ? scoredFrom("reversed", path, p) : -1;
  const sim = new RefSim(arm.state);
  const totalsStart = { energy: totalsOf(arm.state.cfg, arm.state.cells).energy };
  const censuses: Census[] = [];
  const hashes: string[] = [];
  const start = arm.state;
  if (observe) censuses.push(takeCensus(sim, 0, path, p, start, totalsStart));
  hashes.push(stateHash(sim.state));
  for (let t = 1; t <= steps; t++) {
    sim.step();
    if (t % p.census === 0 || t === turn) {
      hashes.push(stateHash(sim.state));
      if (observe) {
        const c = takeCensus(sim, t, path, p, start, totalsStart);
        if (c.residual !== 0n) throw new Error(`conservation residual ${c.residual} at step ${t}`);
        censuses.push(c);
      }
    }
  }
  return { strategy: arm.strategy, placement: arm.placement, schedule: arm.schedule, seed: arm.seed, inputB: arm.inputB, inputE: arm.inputE, inputEnergy: arm.inputEnergy, censuses, hashes, endHash: stateHash(sim.state) };
}

const avg = (xs: number[]): number | null => (xs.length ? Math.floor(xs.reduce((a, b) => a + b, 0) / xs.length) : null);

export interface Window {
  from: number;
  to: number;
}
export const windowOf = (schedule: Arm["schedule"], p: Protocol = PROTOCOL): Window => ({ from: scoredFrom(schedule, meridianPath(schedule, p), p), to: p.T });

export interface Readouts {
  window: Window;
  /** Primary capture: lightIn increment over the window per audited inoculum input energy, ppm. */
  capturePpm: number;
  /** Covariates, never primary. */
  exposure1000: number | null;
  emitInc: string;
  photoInc: string;
  /** Tracking: signed bias, absolute circular error (primary), temporal lag; x1000 cells / steps x1000. */
  biasQ1000: number | null;
  absErr1000: number | null;
  lag1000: number | null;
  lagN: number;
  cohVar1000: number | null;
  cohFracPpm: number | null;
  cohN: number;
  /** Survival over the whole run: terminal biomass over the inoculum, ppm; extinct arms keep their terminal outcome. */
  survivalPpm: number;
  extinct: boolean;
  trackedCensuses: number;
}

export function readouts(r: Series, w: Window, p: Protocol = PROTOCOL): Readouts {
  const at = (t: number) => {
    const c = r.censuses.find((x) => x.t === t);
    if (!c) throw new Error(`no census at ${t}`);
    return c;
  };
  const a = at(w.from), z = at(w.to);
  const inW = r.censuses.filter((c) => c.t > w.from && c.t <= w.to);
  const live = inW.filter((c) => c.B > 0);
  const capturePpm = Number((BigInt(p.PPM) * (z.lightIn - a.lightIn)) / BigInt(r.inputEnergy));
  const lag = live.filter((c) => c.lag !== null).map((c) => c.lag! * 1000);
  const coh = live.filter((c) => c.cohVar1000 !== null);
  const last = r.censuses[r.censuses.length - 1];
  return {
    window: w,
    capturePpm,
    exposure1000: avg(live.map((c) => Math.floor((1000 * c.sumBL) / c.B))),
    emitInc: `${z.emit - a.emit}`,
    photoInc: `${z.photo - a.photo}`,
    biasQ1000: avg(live.map((c) => Math.floor((1000 * c.sumBd) / c.B))),
    absErr1000: avg(live.map((c) => Math.floor((1000 * c.sumBabs) / c.B))),
    lag1000: avg(lag),
    lagN: lag.length,
    cohVar1000: avg(coh.map((c) => c.cohVar1000!)),
    cohFracPpm: avg(coh.map((c) => c.cohFracPpm!)),
    cohN: coh.length,
    survivalPpm: Math.floor((p.PPM * last.B) / r.inputB),
    extinct: last.B === 0,
    trackedCensuses: live.length,
  };
}
