// Fixtures, built before any search or fresh run. Each is a case where the naive metric ("bodies move together and stay near the sun":
// pairwise sign agreement of raw displacement, group tracking lag) reads collective motion while the residual-coordination control and
// the complete decision function must reject it. Synthetic fixtures generate tracks directly (integer noise from lowbias32); physical
// fixtures run sim-ref worlds. Pure and deterministic.
import { lowbias32 } from "@bl/schema";
import { runBlock } from "./assay.ts";
import { coordination, type Coordination, type Track } from "./coordination.ts";
import { decideSchedule, medianTimes2, verdictOf, type BlockNumbers, type Floors, type Verdict } from "./decision.ts";
import { PROTOCOL, type Protocol, type ScheduleId } from "./protocol.ts";
import { meridianPath, sunDelta } from "./schedule.ts";

export const NAIVE_SIGN_PPM = 800_000;
const rnd = (seed: number, a: number, b: number, span: number): number => (lowbias32(Math.imul(seed, 0x9e3779b1) ^ Math.imul(a, 7919) ^ Math.imul(b, 104729)) % (2 * span + 1)) - span;

export type SyntheticKind = "common-forcing" | "coupled-synthetic" | "label-takeover" | "static-sun" | "null-world";

export interface SyntheticOpts {
  noiseQ: number;
  /** Amplitude (1/Q cell per interval) of the shared group fluctuation in the coupled case. */
  couplingQ: number;
}
export const SYNTH: SyntheticOpts = { noiseQ: 24, couplingQ: 60 };

/** Synthetic tracks of the n bodies over the censuses [T0, T]: positions in 1/Q cell mod W*Q. */
export function syntheticTracks(kind: SyntheticKind, placement: "grouped" | "dispersed", seed: number, schedule: ScheduleId, p: Protocol = PROTOCOL, o: SyntheticOpts = SYNTH): Track {
  const WQ = p.W * p.Q;
  const path = meridianPath(kind === "static-sun" ? "paused" : schedule, p);
  const ts: number[] = [];
  for (let t = p.T0; t <= p.T; t += p.census) ts.push(t);
  const spread = placement === "grouped" ? 3 : 12;
  const q: (number | null)[][] = [];
  for (let i = 0; i < p.n; i++) {
    const row: number[] = [];
    let pos = (((p.W - p.placement.offset) % p.W) + i * spread) * p.Q;
    for (let k = 0; k < ts.length; k++) {
      if (k > 0) {
        const dm = sunDelta(path, ts[k - 1], ts[k], p.W) * p.Q;
        const own = rnd(seed, i + 1, k, o.noiseQ);
        const group = kind === "coupled-synthetic" && placement === "grouped" ? rnd(seed, 99, k, o.couplingQ) : 0;
        if (kind === "static-sun") pos += 0;
        else if (kind === "null-world") pos += dm;
        else if (kind === "label-takeover") {
          // Material follows the sun; at every fourth interval the tags of two bodies swap hands (a jump with no material displacement).
          pos += dm + own + (k % 4 === 0 ? ((i % 2 ? -1 : 1) * 3 * p.W * p.Q) / 4 : 0);
        } else pos += dm + own + group;
      }
      row.push(((pos % WQ) + WQ) % WQ);
    }
    q.push(row);
  }
  return { t: ts, q };
}

export interface CoordFixture {
  id: string;
  schedule: ScheduleId;
  seeds: number[];
  /** Naive reading in the grouped arm: pairwise sign agreement (ppm) per seed, and whether it reads "collective motion". */
  naiveGroupedPpm: (number | null)[];
  naiveReads: boolean;
  /** Residual coordination (grouped minus dispersed, milli-Q^2) per seed, null when unavailable. */
  residual: (number | null)[];
  excluded: number;
  floor: number;
  /** 'coordination-detected' (a readout label) or 'unsupported-within-tested-domain'. */
  label: "coordination-detected" | "unsupported-within-tested-domain" | "unavailable";
  rejected: boolean;
}

/** The synthetic floor: the largest |grouped - dispersed| of the uncoupled common-forcing fixture on the replicate-noise seeds. */
export function syntheticFloor(schedule: ScheduleId, p: Protocol = PROTOCOL): number {
  const path = meridianPath(schedule, p);
  let f = 0;
  for (const s of p.noiseSeeds) {
    const g = coordination(syntheticTracks("common-forcing", "grouped", s, schedule, p), path, p).covMilliQ2;
    const d = coordination(syntheticTracks("common-forcing", "dispersed", s, schedule, p), path, p).covMilliQ2;
    f = Math.max(f, Math.abs((g ?? 0) - (d ?? 0)));
  }
  return f;
}

export function coordFixture(kind: SyntheticKind, schedule: ScheduleId, floor: number, p: Protocol = PROTOCOL): CoordFixture {
  const path = meridianPath(kind === "static-sun" ? "paused" : schedule, p);
  const seeds = [...p.fixtureSeeds];
  const g: Coordination[] = [], d: Coordination[] = [];
  for (const s of seeds) {
    g.push(coordination(syntheticTracks(kind, "grouped", s, schedule, p), path, p));
    d.push(coordination(syntheticTracks(kind, "dispersed", s, schedule, p), path, p));
  }
  const residual = g.map((c, i) => (c.covMilliQ2 === null || d[i].covMilliQ2 === null ? null : c.covMilliQ2 - d[i].covMilliQ2!));
  const avail = residual.filter((x): x is number => x !== null);
  const above = avail.filter((x) => x > floor).length;
  const naive = g.map((c) => c.signAgreementPpm);
  const naiveReads = naive.filter((x) => x !== null && x >= NAIVE_SIGN_PPM).length >= p.rule.residualMin;
  const label = avail.length === 0 ? "unavailable" : above >= p.rule.residualMin ? "coordination-detected" : "unsupported-within-tested-domain";
  return { id: kind, schedule, seeds, naiveGroupedPpm: naive, naiveReads, residual, excluded: g.reduce((a, c) => a + c.excluded, 0), floor, label, rejected: label !== "coordination-detected" };
}

/** A synthetic block table for the complete decision function: a planted positive B (sense benefits grouped, others do not). */
export function plantedTable(planted: { fixed: number; paused: number; reversed: number; wandering: number }, seed: number): Record<string, BlockNumbers[]> {
  const out: Record<string, BlockNumbers[]> = {};
  for (const sc of ["fixed", "paused", "reversed", "wandering"] as const) {
    out[sc] = [];
    for (let b = 0; b < 8; b++) {
      const noise = (k: number) => rnd(seed, b * 8 + k, sc.length, 4000);
      const cn = (k: number) => rnd(seed, b * 8 + k, sc.length + 17, 400);
      const arm = (g: number, dsp: number, covG: number, covD: number) => ({ grouped: { capturePpm: 300_000 + g, survivalPpm: 600_000, cov: covG }, dispersed: { capturePpm: 300_000 + dsp, survivalPpm: 600_000, cov: covD } });
      out[sc].push({
        sense: arm(planted[sc] + noise(1), noise(2), 6000 + cn(3), cn(4)),
        "sense-nosig": arm(noise(5), noise(6), cn(7), cn(8)),
        "sense-nomot": arm(noise(9), noise(10), cn(11), cn(12)),
        drift: arm(noise(13), noise(14), cn(15), cn(16)),
        still: arm(noise(17), noise(18), cn(19), cn(20)),
      });
    }
  }
  return out;
}
export const PLANTED_FLOORS: Floors = { cap: 20_000, res: 2_000 };

export interface PlantedReport {
  id: string;
  verdict: Verdict;
}
export function plantedReport(id: string, planted: { fixed: number; paused: number; reversed: number; wandering: number }, p: Protocol = PROTOCOL): PlantedReport {
  const t = plantedTable(planted, 8_700_900);
  const dec = (sc: string, full: boolean) => decideSchedule(t[sc], PLANTED_FLOORS, full, p);
  return { id, verdict: verdictOf({ fixed: dec("fixed", true), paused: dec("paused", false), reversed: dec("reversed", false), wandering: dec("wandering", false), floors: { fixed: PLANTED_FLOORS, paused: PLANTED_FLOORS, reversed: PLANTED_FLOORS, wandering: PLANTED_FLOORS }, insensitive: false, invalidBlocks: 0, blocks: 8 }) };
}

export interface PhysicalFixture {
  id: string;
  /** Naive reading: the candidate strategy grouped vs dispersed reads as group-level (sign agreement and the grouped-minus-dispersed capture difference). */
  naiveSignAgreementPpm: (number | null)[];
  naiveGroupVsDispersedPositive: number;
  /** The candidate's capture contrast S' and the difference-in-differences against the information-free arm, per fixture seed. */
  S: number[];
  B: number[];
  residual: (number | null)[];
  verdict: Verdict["label"] | "residual-within-floor" | "residual-above-floor";
  residualWithinFloor: boolean;
  /** Rejected by the decision's contrast rule (B not clearing the floor with enough positive blocks); stationary-growth must also keep its residual within the floor. */
  rejected: boolean;
  note: string;
}

export const PHYS_STRATEGIES = ["drift", "sense-nosig", "still"] as const;

/** Physical fixtures from sim-ref worlds on the fixture seeds (fixed schedule): blind drifters, crowding, stationary growth. */
export function physicalFixtures(floors: Floors, p: Protocol = PROTOCOL, blocks = PROTOCOL.fixtureSeeds.map((seed) => runBlock({ seed, schedules: ["fixed"], strategies: PHYS_STRATEGIES }, p))): PhysicalFixture[] {
  const sc = "fixed";
  const num = (b: (typeof blocks)[number], st: string, pl: "grouped" | "dispersed") => b.runs[sc][`${st}/${pl}`];
  const contrast = (st: string) => blocks.map((b) => num(b, st, "grouped").readouts.capturePpm - num(b, st, "dispersed").readouts.capturePpm);
  const cov = (st: string) => blocks.map((b) => { const g = num(b, st, "grouped").coordination.covMilliQ2, d = num(b, st, "dispersed").coordination.covMilliQ2; return g === null || d === null ? null : g - d; });
  const sign = (st: string) => blocks.map((b) => num(b, st, "grouped").coordination.signAgreementPpm);
  const Sn = contrast("sense-nosig");
  const mk = (id: string, cand: string, comparator: string, note: string): PhysicalFixture => {
    const S = contrast(cand), C = contrast(comparator);
    const B = S.map((x, i) => x - C[i]);
    const residual = cov(cand);
    const aboveFloor = residual.filter((x) => x !== null && x > floors.res).length;
    const m = medianTimes2(B);
    const decided = !(m !== null && m > 2 * floors.cap && B.filter((x) => x > 0).length >= p.rule.minPositive);
    return { id, naiveSignAgreementPpm: sign(cand), naiveGroupVsDispersedPositive: S.filter((x) => x > 0).length, S, B, residual, verdict: aboveFloor >= p.rule.residualMin ? "residual-above-floor" : "residual-within-floor", residualWithinFloor: aboveFloor < p.rule.residualMin, rejected: decided && (id !== "stationary-growth" || aboveFloor < p.rule.residualMin), note };
  };
  void Sn;
  return [
    mk("blind-drifters-physical", "drift", "drift", "the hard-coded heading is its own comparator, so B is zero by identity (a rejection by construction, not a discovery); any grouped-versus-dispersed difference is crowding"),
    mk("crowding-physical", "still", "sense-nosig", "no useful signalling and no movement: grouped and dispersed still differ (crowding, shared field); the comparator sense-nosig is dynamically the same arm (REVIEW.md), so B is zero by identity, not by rejection"),
    mk("stationary-growth", "still", "sense-nosig", "no active motility: lineage centroids move by growth and transport only, residual coordination should stay within the floor"),
  ];
}
