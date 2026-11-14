// The Gate-0 job list (rule draft 3.0, G0.1 to G0.6) and the planner that turns the readout's evaluation into the next jobs to run.
// Pure: no GPU, no file system (the driver passes in what exists), so it is tested without the spike.
//
// Gate 0 is staged: the table needs `G_spread` (the scan and the meters), the horizon needs the table's `kappa_w`, the confirmation
// needs `h0`, rung V needs the substrate rung's `G_spread`. The readout (`evaluateGate0`) already knows all of that, so the planner
// reads the structured fields of its result (`gSpread`, `table.spreads`, `kappaW`, `vCal`, `horizon.h0`, `bMeter`, the carpet flags)
// and never re-derives a rule. What a job's directory is called, and what its summary says, is fixed here and in `specOf`.
import { lowbias32 } from "@bl/schema";
import type { Gate0Result, RungEval } from "../readout-gate0.ts";
import {
  CANDIDATE_SPREADS,
  DENSE_SEED,
  HORIZON_STEPS,
  LEVELS_MIN,
  METER_SEED_GATE0,
  RATES_REMOVAL,
  RATES_VACANCY,
  RUNG_ORDER,
  SCAN_SEED,
  TABLE_SEEDS,
} from "../readout-gate0.ts";
import type { Kill, Rung, Stage, SubstrateRung } from "../readout-jobs.ts";
import { HORIZON_RUNG_SHAPE, METER_STEPS, SHAPE, type Shape } from "./rungs.ts";

/** Run steps of a scan, table and dense job: 20,000 after the burn-in. */
export const SHORT_STEPS = 20_000;

export type JobKind = "run" | "meter";

export interface JobDef {
  /** The directory name. */
  id: string;
  stage: Stage;
  kind: JobKind;
  /** The rung label the job carries (rung V's own jobs: "V"; shared jobs carry the substrate rung). */
  rung: Rung;
  /** The kill build. */
  kill: Kill;
  /** The substrate the job runs on (the rung itself for S0 to S2). */
  substrate: SubstrateRung;
  spread: number;
  /** `rpsRate` of the run phase. */
  rate: number;
  seed: number;
  /** Run steps after the burn-in (a meter job: the stripes' steps, no burn-in). */
  runSteps: number;
  shape: Shape;
  /** Meter jobs: the stripe axis and `B_meter`. */
  axis?: "x" | "y";
  bMeter?: number;
}

const short = (stage: Stage): string => stage.replace(/^g0\./, "g0-");

/** The directory name of a job: stage, rung, spread, rate and seed (and the axis of a meter job, the kill of a V-check job). */
export function jobId(d: Pick<JobDef, "stage" | "rung" | "kill" | "substrate" | "spread" | "rate" | "seed" | "axis">): string {
  const core = `sp${d.spread}-r${d.rate}-s${d.seed}`;
  if (d.stage === "g0.vcheck") return `g0-vcheck-${d.kill}-${d.substrate}-${core}`;
  return `${short(d.stage)}-${d.rung}-${core}${d.axis ? `-${d.axis}` : ""}`;
}

export function mkJobDef(o: Omit<JobDef, "id" | "kind" | "shape" | "kill" | "substrate"> & Partial<Pick<JobDef, "kind" | "shape" | "kill" | "substrate">>): JobDef {
  const rung = o.rung;
  const substrate = o.substrate ?? (rung === "V" ? "S0" : rung);
  const kill = o.kill ?? (rung === "V" ? "vacancy" : "removal");
  const d = { ...o, kind: o.kind ?? "run", shape: o.shape ?? SHAPE, kill, substrate } as Omit<JobDef, "id">;
  return { ...d, id: jobId(d) };
}

// ---- the job tables ----

/** G0.2: one rate-0 job per candidate spread, seed 401, 20,000 steps after the burn-in. */
export const scanDefs = (r: SubstrateRung): JobDef[] => CANDIDATE_SPREADS.map((v) => mkJobDef({ stage: "g0.scan", rung: r, spread: v, rate: 0, seed: SCAN_SEED, runSteps: SHORT_STEPS }));

/** G0.2: the meter of a spread, x- and y-stripes, seed 405, 5,000 steps, `B_meter` from the scan. */
export const meterDefs = (r: SubstrateRung, spreads: readonly number[], bMeter: number): JobDef[] =>
  spreads.flatMap((v) => (["x", "y"] as const).map((axis) => mkJobDef({ stage: "g0.meter", kind: "meter", rung: r, spread: v, rate: 0, seed: METER_SEED_GATE0, runSteps: METER_STEPS, axis, bMeter })));

/**
 * G0.3 for a substrate rung: `v_lo`, `v_mid`, `v_hi` times the rates {0, 8, 16, 32, 64} times seeds 401 to 403, 20,000 steps. The three
 * rate-0 seed-401 cells are the scan jobs of the same spreads (identical runs; the readout reads them from the scan), so they are not
 * run twice.
 */
export const tableDefs = (r: SubstrateRung, spreads: readonly number[]): JobDef[] =>
  spreads.flatMap((v) =>
    RATES_REMOVAL.flatMap((rate) => TABLE_SEEDS.filter((sd) => !(rate === 0 && sd === SCAN_SEED)).map((sd) => mkJobDef({ stage: "g0.table", rung: r, spread: v, rate, seed: sd, runSteps: SHORT_STEPS }))),
  );

/** G0.3 for rung V: its own rows at the four nonzero rates {64, 256, 1024, 4096} (its rate-0 rows are the substrate's), 36 jobs. */
export const vTableDefs = (host: SubstrateRung, spreads: readonly number[]): JobDef[] =>
  spreads.flatMap((v) =>
    RATES_VACANCY.filter((q) => q > 0).flatMap((rate) => TABLE_SEEDS.map((sd) => mkJobDef({ stage: "g0.table", rung: "V", substrate: host, spread: v, rate, seed: sd, runSteps: SHORT_STEPS }))),
  );

/** The V check of G0.1: the table's rate-0 job at `v_mid`, seed 401, run with the removal build and with the vacancy build. */
export const vcheckDefs = (host: SubstrateRung, vMid: number): JobDef[] => [
  mkJobDef({ stage: "g0.vcheck", rung: host, kill: "removal", substrate: host, spread: vMid, rate: 0, seed: SCAN_SEED, runSteps: SHORT_STEPS }),
  mkJobDef({ stage: "g0.vcheck", rung: "V", kill: "vacancy", substrate: host, spread: vMid, rate: 0, seed: SCAN_SEED, runSteps: SHORT_STEPS }),
];

/** G0.4: `v_mid`, rate 0, seeds 401 to 403, 200,000 steps. Shared by a substrate rung and V (rate 0 is the same under both kills), so they carry the substrate rung. */
export const horizonDefs = (r: SubstrateRung, vMid: number): JobDef[] => TABLE_SEEDS.map((sd) => mkJobDef({ stage: "g0.horizon", rung: r, spread: vMid, rate: 0, seed: sd, runSteps: HORIZON_STEPS }));

/** G0.5: `v_cal` at `kappa_w`, seeds 401 to 403, `h0` steps. A rung V confirmation carries rung V. */
export const confirmDefs = (rung: Rung, substrate: SubstrateRung, vCal: number, kappaW: number, h0: number): JobDef[] =>
  TABLE_SEEDS.map((sd) => mkJobDef({ stage: "g0.confirm", rung, substrate, spread: vCal, rate: kappaW, seed: sd, runSteps: h0 }));

/** G0.6: one rate-0 job at `v_mid` of the rung used, seed 404, 20,000 steps, on the idle M3 Pro. */
export const denseDef = (rung: Rung, substrate: SubstrateRung, vMid: number): JobDef => mkJobDef({ stage: "g0.dense", rung, substrate, spread: vMid, rate: 0, seed: DENSE_SEED, runSteps: SHORT_STEPS });

/**
 * The horizon rung of 3.0 (D4): G0.4 alone at 256 x 256 x 4, after a stop whose only failures were HORIZON. Carries the substrate rung.
 * A diagnostic, and not for S2: at 256 x 256 x 4 its founding is over the kernel's matter bound for seeds 401 and 403, so the planner never
 * asks for it there (and the harness would stop the stage at the founding if it were asked).
 */
export const horizonRungDefs = (substrate: SubstrateRung, vMid: number): JobDef[] =>
  TABLE_SEEDS.map((sd) => mkJobDef({ stage: "g0.horizon-rung", rung: substrate, spread: vMid, rate: 0, seed: sd, runSteps: HORIZON_STEPS, shape: HORIZON_RUNG_SHAPE }));

// ---- the planner ----

export interface PlanOptions {
  /** The rungs this process handles (`--rung`). Shared jobs belong to the substrate rung, so V's own jobs need "V". */
  rungs: readonly Rung[];
  /** Plan the G0.6 dense-rate job once Gate 0 is GO (`--dense`; it is run on the idle M3 Pro, so it is never planned by default). */
  dense: boolean;
  /**
   * `--plan-all`: plan every rung this process handles at once, whatever the state of the others (S0 and S1 side by side on two
   * machines, V's rows beside S1's, a later rung after an earlier GO). It costs the jobs of the lower rungs whenever a higher one gives
   * GO. Off by default: rule draft 3.0 takes the rungs in the order S0, S1, S2, V (decision O-8), so a wave is planned for the first
   * rung of that order, among those this process handles, that is evaluated, pending and not behind a GO, and for no other.
   */
  planAll: boolean;
}

export interface Plan {
  /** Jobs that can start now and have no directory yet, in queue order. */
  defs: JobDef[];
  /** Why nothing is planned for a rung, and other remarks. */
  notes: string[];
}

const SUBSTRATES: readonly SubstrateRung[] = ["S0", "S1", "S2"];

/**
 * The jobs of Gate 0 that can start now. `exists(id)` says whether a job directory (a finished job or a MISSING marker) is there.
 * The order is the queue: rungs in the order S0, S1, S2, V; within a rung the stages in the order of the rule draft; within a stage
 * by spread, rate, seed. A stage appears only when its inputs are known, so a wave is never wasted.
 *
 * Which rungs get a wave (3.0, decision O-8). The rungs are taken in the order S0, S1, S2, V and the rungs after the first GO are
 * not run: a rung after a GO can never be the answer. By default only one rung is worked on at a time, the first of the order, among
 * those this process handles, that is evaluated, pending and not behind a GO (`frontier`): S1 waits until S0 is excluded, and V's own
 * rows until S0, S1 (and S2, when it runs) are. The jobs V shares with its host (the G0.4 horizon) carry the host's rung and are
 * planned when V is the frontier. A rung that ended NO-GO is excluded and has nothing to plan. `planAll` plans every handled rung.
 */
export function planNext(r: Gate0Result, exists: (id: string) => boolean, opts: PlanOptions): Plan {
  const defs: JobDef[] = [];
  const notes: string[] = [];
  const seen = new Set<string>();
  const handled = (x: Rung) => opts.rungs.includes(x);
  const push = (ds: readonly JobDef[]) => {
    for (const d of ds) {
      if (seen.has(d.id) || exists(d.id)) continue;
      seen.add(d.id);
      defs.push(d);
    }
  };
  const evOf = (x: Rung): RungEval | undefined => r.rungs.find((e) => e.rung === x);
  const vEv = evOf("V");
  /** The first rung of the order with a GO that counts (a void V never does): the rungs after it are not run. */
  const decided: Rung | null = RUNG_ORDER.find((x) => {
    const e = evOf(x);
    return e !== undefined && e.state === "done" && e.verdict === "GO" && !e.voided;
  }) ?? null;
  const behindGo = (x: Rung): boolean => decided !== null && RUNG_ORDER.indexOf(x) > RUNG_ORDER.indexOf(decided);
  /** The rung this process works on now (null with `planAll`, which works on every handled rung). */
  const frontier: Rung | null = opts.planAll ? null : (RUNG_ORDER.find((x) => handled(x) && evOf(x)?.state === "pending" && !behindGo(x)) ?? null);
  const planned = (x: Rung): boolean => opts.planAll || x === frontier;
  /** Why nothing is planned for a handled rung, when there is something to say. */
  const whyNot = (x: Rung, ev: RungEval): void => {
    if (!handled(x) || ev.state === "done") return;
    if (behindGo(x)) notes.push(`${x}: not planned, ${decided} already gives GO and the rungs after the first GO of the order S0, S1, S2, V are not run (3.0; --plan-all plans every rung)`);
    else notes.push(`${x}: not planned yet, ${frontier ?? "an earlier rung"} comes first in the order S0, S1, S2, V and is not yet excluded (3.0; --plan-all plans every rung at once)`);
  };

  const planSubstrate = (R: SubstrateRung, ev: RungEval): void => {
    // G0.2 scan
    const scans = scanDefs(R);
    push(scans);
    if (!scans.every((d) => exists(d.id))) return;
    // G0.2 meter, for every candidate spread (the rule draft's wording; the readout's grid rule looks at the carpet spreads only)
    if (ev.bMeter === null) {
      notes.push(`${R}: no carpet spread in the scan (or its jobs are unusable), so no meter and no G_spread (NO-GO: LEVELS)`);
      return;
    }
    push(meterDefs(R, CANDIDATE_SPREADS, ev.bMeter));
    if (ev.levels === null) return; // meters still to run
    if (ev.levels < LEVELS_MIN || ev.table === null) return; // NO-GO: LEVELS
    const spreads = ev.table.spreads;
    // G0.3 table
    push(tableDefs(R, spreads));
    // G0.4 horizon: once either the substrate or V has passed rows 1 and 2; its jobs serve both
    const vHere = vEv !== undefined && vEv.substrate === R;
    if (ev.kappaW !== null || (vHere && vEv.kappaW !== null)) push(horizonDefs(R, spreads[1]));
    // G0.5 confirmation of the substrate rung (removal)
    if (ev.kappaW !== null && ev.vCal !== null && ev.horizon !== null && ev.horizon.h0 !== null) push(confirmDefs(R, R, ev.vCal, ev.kappaW, ev.horizon.h0));
  };

  // the substrate rungs, then V: the queue order
  for (const R of SUBSTRATES) {
    const ev = evOf(R);
    if (ev === undefined) {
      if (handled(R)) notes.push(`${R}: not run (S2 only after S0 and S1 both end NO-GO: LEVELS)`);
      continue;
    }
    // the host of V, when V is the rung being worked on, still owes the jobs the two share (they carry the host's rung)
    const sharedForV = !opts.planAll && frontier === "V" && vEv !== undefined && vEv.substrate === R;
    if (!handled(R)) continue;
    if (planned(R) || sharedForV) planSubstrate(R, ev);
    else whyNot(R, ev);
  }

  // rung V: the V check first (a bug in the switch invalidates every V job), then its own table and confirmation
  if (vEv !== undefined && handled("V") && vEv.substrate !== null) {
    if (planned("V")) {
      const host = vEv.substrate;
      const hostEv = evOf(host);
      if (hostEv !== undefined && hostEv.table !== null) {
        const spreads = hostEv.table.spreads;
        push(vcheckDefs(host, spreads[1]));
        push(vTableDefs(host, spreads));
        if (vEv.kappaW !== null && vEv.vCal !== null && vEv.horizon !== null && vEv.horizon.h0 !== null) push(confirmDefs("V", host, vEv.vCal, vEv.kappaW, vEv.horizon.h0));
      }
    } else whyNot("V", vEv);
  } else if (handled("V") && vEv === undefined) {
    notes.push("V: not run (it needs a substrate rung that passed row 1 and has its G_spread)");
  }

  // G0.6: after GO, on the idle M3 Pro
  if (opts.dense) {
    if (r.overall.status === "go") {
      const used = evOf(r.overall.used)!;
      if (used.table !== null && used.substrate !== null) push([denseDef(used.rung, used.substrate, used.table.spreads[1])]);
    } else notes.push("--dense: Gate 0 is not GO yet, so the dense-rate job is not planned");
  }

  // the horizon rung, after a stop whose only failures were HORIZON (D4): a diagnostic (Gate 0 stays GATE-0-STOP whatever it says), and not
  // on S2, whose founding at 256 x 256 x 4 exceeds the kernel's matter bound: the readout then gives it no horizon rung to plan
  if (r.overall.status === "stop" && r.overall.onlyHorizon && r.overall.horizonRung !== null && r.overall.horizonRung.state === "pending") {
    const hr = r.overall.horizonRung;
    const sub = hr.rung === "V" ? evOf("V")?.substrate ?? null : (hr.rung as SubstrateRung);
    const subEv = sub === null ? undefined : evOf(sub);
    if (sub !== null && subEv?.table && (handled(sub) || handled(hr.rung))) push(horizonRungDefs(sub, subEv.table.spreads[1]));
  }
  return { defs, notes };
}

/** FNV-1a of the id, mixed by `lowbias32` (FNV's low bits alone follow the parity of the characters). */
function idHash(id: string): number {
  let h = 0x811c9dc5;
  for (let k = 0; k < id.length; k++) h = Math.imul(h ^ id.charCodeAt(k), 0x01000193) >>> 0;
  return lowbias32(h);
}

/** Which of `n` machines owns a job: a function of its id alone, so it does not change as the other jobs on disk change. */
export const ownerOf = (id: string, n: number): number => idHash(id) % n;

/**
 * `--machine-share=i/n`: the jobs machine `i` of `n` owns (those with `ownerOf(id, n) = i - 1`). A job has one owner whatever else is
 * on disk, so two machines that plan from different amounts of synced results still never take the same job, and never both leave one.
 */
export function shareOf<T extends { id: string }>(items: readonly T[], i: number, n: number): T[] {
  if (!(Number.isInteger(n) && n >= 1 && Number.isInteger(i) && i >= 1 && i <= n)) throw new Error(`machine share ${i}/${n} is not valid (1 <= i <= n)`);
  return items.filter((d) => ownerOf(d.id, n) === i - 1);
}
