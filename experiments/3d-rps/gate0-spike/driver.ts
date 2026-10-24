// The loop of the Gate-0 driver, apart from the GPU and the file system: plan the next wave from what the readout makes of the jobs on
// disk, run this process's share of it, plan again. Pure (everything it touches comes in through DriverIo), so the staged, resumable,
// two-machine behaviour is tested with a fake job runner; gate0.ts supplies the real one.
import * as fs from "node:fs";
import * as path from "node:path";
import { StageStop, jobExists, type KernelJobResult } from "../lib/kernel-job.ts";
import { evaluateGate0, type Gate0Result } from "../readout-gate0.ts";
import { LOST_RACE_PREFIX, Problems } from "../readout-jobs.ts";
import { loadJobs, nodeIo } from "../readout.ts";
import type { Args } from "./cli.ts";
import { planNext, shareOf, vcheckDefs, type JobDef } from "./plan.ts";

export interface RawSummary {
  dir: string;
  s: Record<string, unknown>;
}

export interface DriverIo {
  jobExists(id: string): boolean;
  /** Loads every job on disk and evaluates Gate 0 (the readout's own code). */
  evaluate(): Gate0Result;
  /**
   * The summary.json of every job directory on disk, and the hidden `.retried-*.json` files in which the harness keeps the failures of
   * a rerun that passed but lost the publish race (their `dir` is the file name and their `s` carries `lostRace: true` and `retried`).
   */
  rawSummaries(): RawSummary[];
  /** The census.tsv of a job, or null. */
  readCensus(id: string): string | null;
  /** Runs one job into its directory. May throw StageStop. */
  run(d: JobDef): Promise<KernelJobResult>;
  log(line: string): void;
}

/** The file-system half of DriverIo, over a job directory: `root` is the repository root the readout's loader is given. */
export function diskIo(out: string, root: string): Pick<DriverIo, "jobExists" | "evaluate" | "rawSummaries" | "readCensus"> {
  return {
    jobExists: (id) => jobExists(out, id),
    evaluate: () => {
      const loaded = new Problems();
      const res = evaluateGate0(loadJobs(nodeIo(root), out, loaded));
      // the loader's own findings (an unreadable summary.json or census.tsv) belong with the evaluation's; a directory with no job in it
      // yet (nothing but hidden entries, a notes file, an empty directory) is the start of a run, not a problem
      const started = fs.existsSync(out) && fs.readdirSync(out, { withFileTypes: true }).some((e) => e.isDirectory() && !e.name.startsWith(".") && fs.existsSync(path.join(out, e.name, "summary.json")));
      if (started) for (const p of loaded.list) res.problems.add(p.code, p.message);
      return res;
    },
    rawSummaries: () => {
      if (!fs.existsSync(out)) return [];
      const res: RawSummary[] = [];
      for (const e of fs.readdirSync(out, { withFileTypes: true })) {
        if (e.isFile() && e.name.startsWith(LOST_RACE_PREFIX) && e.name.endsWith(".json")) {
          // a rerun that passed lost the publish race with a failure behind it (1.3, D22): the stage stays stopped until it is dealt with
          let trace: Record<string, unknown>;
          try {
            trace = JSON.parse(fs.readFileSync(path.join(out, e.name), "utf8")) as Record<string, unknown>;
          } catch {
            trace = { retried: [{ kind: "invariant", message: "unreadable" }] };
          }
          res.push({ dir: e.name, s: { ...trace, lostRace: true } });
          continue;
        }
        if (!e.isDirectory() || e.name.startsWith(".")) continue;
        const p = path.join(out, e.name, "summary.json");
        if (!fs.existsSync(p)) continue;
        try {
          res.push({ dir: e.name, s: JSON.parse(fs.readFileSync(p, "utf8")) as Record<string, unknown> });
        } catch {
          // the readout reports an unreadable summary as unusable input
        }
      }
      return res;
    },
    readCensus: (id) => {
      const p = path.join(out, id, "census.tsv");
      return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null;
    },
  };
}

/**
 * Jobs that stop the stage (1.3): a nonzero residual, a matter change, or a conservation/invariant failure behind a MISSING marker or
 * in an earlier attempt of a job that passed on the rerun (`retried`): the simulator is deterministic, so a failure that does not come
 * back is a bug too.
 */
export function stageStops(sums: readonly RawSummary[]): string[] {
  const out: string[] = [];
  const bad = (list: unknown): { kind?: string }[] => (Array.isArray(list) ? (list as { kind?: string }[]).filter((f) => f.kind !== undefined && f.kind !== "crash") : []);
  for (const { dir, s } of sums) {
    const failures = bad(s.failures);
    const retried = bad(s.retried);
    if (s.matterOk === false) out.push(`${dir}: matter changed`);
    else if (typeof s.residual === "string" && s.residual !== "0" && s.missing !== true) out.push(`${dir}: nonzero energy residual ${s.residual}`);
    else if (failures.length > 0) out.push(`${dir}: ${failures.map((f) => f.kind).join(", ")} failure`);
    else if (retried.length > 0) {
      const kinds = retried.map((f) => f.kind).join(", ");
      out.push(s.lostRace === true ? `${dir}: an earlier attempt failed a ${kinds} check, and the rerun that passed lost the publish race to another process` : `${dir}: an earlier attempt failed a ${kinds} check (the rerun passed)`);
    }
  }
  return out;
}

export type VCheck = { state: "identical" } | { state: "different"; detail: string } | { state: "incomplete" };

/** The V check of G0.1 as the driver sees it: both builds' census.tsv on disk, compared byte for byte. */
export function vcheckState(io: Pick<DriverIo, "readCensus">, r: Gate0Result): VCheck {
  const v = r.rungs.find((e) => e.rung === "V");
  const host = v?.substrate ? r.rungs.find((e) => e.rung === v.substrate) : undefined;
  if (!v || !host?.table) return { state: "incomplete" };
  const defs = vcheckDefs(v.substrate!, host.table.spreads[1]);
  const [a, b] = defs.map((d) => io.readCensus(d.id));
  if (a === null || b === null) return { state: "incomplete" };
  return a === b ? { state: "identical" } : { state: "different", detail: `${defs[0].id} and ${defs[1].id} differ` };
}

export function describeWave(defs: readonly JobDef[]): string {
  const by = new Map<string, number>();
  for (const d of defs) by.set(`${d.rung} ${d.stage}`, (by.get(`${d.rung} ${d.stage}`) ?? 0) + 1);
  return [...by].map(([k, n]) => `${k} x${n}`).join(", ") || "nothing";
}

export interface DriveResult {
  /** 0 nothing left for this process; 3 stage stopped or V check failed; 4 jobs outstanding. */
  code: 0 | 3 | 4;
  /** The ids of the jobs this call ran, in order. */
  ran: string[];
  /** Jobs listed but not run by this process (another share, or waiting for the V check). */
  waiting: number;
}

/**
 * The staged loop. Each pass plans the wave of jobs that can start now (plan.ts: by default the next stage of the first rung of the
 * order S0, S1, S2, V that is not yet excluded, and nothing once a rung gives GO; with `planAll` of every handled rung) and runs this
 * process's share of it in queue order; a pass that runs nothing ends the loop. `--dry-run` prints the wave and runs nothing.
 */
export async function drive(a: Pick<Args, "rungs" | "planAll" | "share" | "reverse" | "dense" | "dryRun" | "only" | "maxJobs">, io: DriverIo): Promise<DriveResult> {
  const ran: string[] = [];
  const stops = stageStops(io.rawSummaries());
  if (stops.length > 0) {
    io.log(`STAGE STOPPED (rule draft 1.3): ${stops.join("; ")}`);
    io.log("A nonzero residual or a matter change is a bug, not a result. Nothing runs until the job directory is dealt with by hand.");
    return { code: 3, ran, waiting: 0 };
  }
  let waiting = 0;
  for (;;) {
    const res = io.evaluate();
    // a bug indicator or unusable input already on disk (a burnHash that differs within a burn-in group, a failed V check, a control
    // with a chirality it cannot have, an unreadable file) stops the stage before more jobs are planned (1.3, 8.4); exit 4, jobs still
    // to run, is the normal state of a staged run
    const bad = res.problems.list.filter((p) => p.code === 2 || p.code === 3);
    if (bad.length > 0) {
      io.log(`STAGE STOPPED (rule draft 1.3, 8.4): the readout finds ${bad.length === 1 ? "a problem" : `${bad.length} problems`} in the jobs on disk:`);
      for (const p of bad) io.log(`  exit ${p.code}: ${p.message}`);
      io.log("Nothing runs until the job directory is dealt with by hand.");
      return { code: 3, ran, waiting };
    }
    const plan = planNext(res, (id) => io.jobExists(id), { rungs: a.rungs, dense: a.dense, planAll: a.planAll });
    for (const n of plan.notes) io.log(`note: ${n}`);
    let mine = a.share ? shareOf(plan.defs, a.share.i, a.share.n) : [...plan.defs];
    if (a.only !== null) mine = mine.filter((d) => d.id.includes(a.only!));
    if (a.reverse) mine.reverse();
    io.log(`wave: ${plan.defs.length} jobs listed (${describeWave(plan.defs)}); this process: ${mine.length}`);
    if (a.dryRun) {
      for (const d of mine) io.log(`  would run ${d.id}  (${d.stage}, rung ${d.rung}/${d.kill}, spread ${d.spread}, rate ${d.rate}, seed ${d.seed}, ${d.runSteps} steps, ${d.shape.join("x")})`);
      return { code: plan.defs.length === 0 ? 0 : 4, ran, waiting: plan.defs.length - mine.length };
    }
    waiting = plan.defs.length - mine.length;
    if (mine.length === 0) break;
    let progressed = false;
    let vc: VCheck | null = null;
    for (const d of mine) {
      if (a.maxJobs !== null && ran.length >= a.maxJobs) {
        io.log(`--max-jobs ${a.maxJobs} reached`);
        return { code: 4, ran, waiting: waiting + 1 };
      }
      if (io.jobExists(d.id)) continue;
      if (d.rung === "V" && d.stage !== "g0.vcheck") {
        // a bug in the V switch invalidates every V job: they run only behind an identical V check
        vc ??= vcheckState(io, io.evaluate());
        if (vc.state === "different") {
          io.log(`V CHECK FAILED: ${vc.detail}: the vacancy build is not the removal build at rate 0, so no V job counts (rule draft G0.1, 8.4)`);
          return { code: 3, ran, waiting };
        }
        if (vc.state === "incomplete") {
          io.log(`  waiting: ${d.id} needs the V check (both builds) on disk first`);
          waiting++;
          continue;
        }
      }
      io.log(`run ${d.id}`);
      let r: KernelJobResult;
      try {
        r = await io.run(d);
      } catch (e) {
        if (e instanceof StageStop) {
          ran.push(d.id);
          io.log(`STAGE STOPPED (rule draft 1.3): ${e.message}`);
          io.log(
            e.lostRace
              ? "Another process published the job; the failures of this process's earlier attempt are in the hidden .retried-*.json file beside the jobs. A nonzero residual or a matter change is a bug, not a result: the whole stage stops and is reported."
              : e.markerFile !== null
                ? `Another process published the job; this process's MISSING marker, with its failures, is in the hidden ${e.markerFile} beside the jobs. A nonzero residual or a matter change is a bug, not a result: the whole stage stops and is reported.`
                : "The failed job's MISSING marker and partial census are in its directory. A nonzero residual or a matter change is a bug, not a result: the whole stage stops and is reported.",
          );
          return { code: 3, ran, waiting };
        }
        throw e;
      }
      ran.push(d.id);
      progressed = true;
      if (d.stage === "g0.vcheck") vc = null;
      if (r.status === "done") io.log(`  done ${d.id}: ${r.summary.steps} steps, stop ${r.summary.stop}, ${r.summary.stepsPerSec} steps/s${r.summary.attempts === 2 ? " (second attempt)" : ""}`);
      else if (r.status === "missing") io.log(`  MISSING ${d.id}: failed twice (${r.failures.map((f) => `${f.kind}: ${f.message}`).join("; ")})`);
      else io.log(`  exists ${d.id}`);
      const st = stageStops(io.rawSummaries().filter((x) => x.dir === d.id));
      if (st.length > 0) {
        io.log(`STAGE STOPPED: ${st.join("; ")}`);
        return { code: 3, ran, waiting };
      }
    }
    if (!progressed) break;
  }
  return { code: waiting > 0 ? 4 : 0, ran, waiting };
}
