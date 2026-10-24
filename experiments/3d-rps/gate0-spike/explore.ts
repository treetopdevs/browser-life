// The exploration of Amendment 1 (experiments/3d-rps/RULES.md, 2026-10-24, after GATE-0-STOP) on the driver's loop: the planner that
// turns the exploration readout's evaluation into the next jobs, the V check as the loop sees it, and the disk half of its DriverIo.
// Rung S0 (removal) and rung V on S0 (vacancy kill) side by side, both in full (A1.1); S0's G0.2 and the three rate-0 seed-401 cells of
// the table are the registered pilot's jobs, read from --registered and never written (A1.2). Pure apart from the loader.
import * as fs from "node:fs";
import * as path from "node:path";
import { Problems } from "../readout-jobs.ts";
import { evaluateExploration, type ExplorationResult } from "../readout-exploration.ts";
import { dirsOverlap, loadJobs, nodeIo, realPathOf } from "../readout.ts";
import { diskIo, type DriveHooks, type DriverIoOf } from "./driver.ts";
import { confirmDefs, horizonDefs, tableDefs, vTableDefs, vcheckDefs, type JobDef, type Plan } from "./plan.ts";

/**
 * Why --out and --registered cannot be used together, or null: they must be two directories, neither inside the other, after symlinks
 * are resolved (an --out that does not exist yet is placed under the real path of its nearest existing ancestor): readout.ts's check.
 */
export function explorationDirsRefusal(out: string, registered: string): string | null {
  const o = realPathOf(out);
  const r = realPathOf(registered);
  if (dirsOverlap(o, r)) return `--out (${o}) and --registered (${r}) must be two directories, neither inside the other: the registered pilot's job directory is read and never written`;
  return null;
}

/** The vacancy build of the V check (G0.1, A1.2); its removal build is the registered scan job at `v_mid`, seed 401. */
export const explorationVcheckDef = (vMid: number): JobDef => vcheckDefs("S0", vMid).find((d) => d.kill === "vacancy")!;

/**
 * The exploration's jobs that can start now (A1.2), in queue order: the V check first (V's own jobs run only behind an identical one),
 * then S0's G0.3 (42: the rate-0 seed-401 cells are the registered scan jobs) and V's (36), then G0.4 once, shared, when either rung
 * passed row 2 (a void V does not count), then G0.5 for each rung that passed rows 1 to 3. G0.6 is not run.
 */
export function planExploration(r: ExplorationResult, exists: (id: string) => boolean): Plan {
  const defs: JobDef[] = [];
  const notes: string[] = [];
  const seen = new Set<string>();
  const push = (ds: readonly JobDef[]) => {
    for (const d of ds) {
      if (seen.has(d.id) || exists(d.id)) continue;
      seen.add(d.id);
      defs.push(d);
    }
  };
  if (r.spreads === null) {
    notes.push("nothing planned: the registered G0.2 of S0 is not usable (see the readout's problems)");
    return { defs, notes };
  }
  const spreads = r.spreads;
  const vMid = spreads[1];
  const s0 = r.rungs.find((e) => e.rung === "S0")!;
  const v = r.rungs.find((e) => e.rung === "V")!;
  if (!v.voided) push([explorationVcheckDef(vMid)]);
  push(tableDefs("S0", spreads));
  if (v.voided) notes.push("V: void (the V check), so none of its jobs is planned (G0.1)");
  else push(vTableDefs("S0", spreads));
  if (r.horizonNeeded) push(horizonDefs("S0", vMid));
  for (const e of [s0, v]) {
    if (e.voided || e.kappaW === null || e.vCal === null || e.horizon === null || e.horizon.h0 === null) continue;
    push(confirmDefs(e.rung, "S0", e.vCal, e.kappaW, e.horizon.h0));
  }
  return { defs, notes };
}

/** The V check as the loop sees it: identical, different, or not yet on disk. */
export const explorationVcheck = (r: ExplorationResult): ReturnType<DriveHooks<ExplorationResult>["vcheck"]> =>
  r.vcheck.state === "identical" ? { state: "identical" } : r.vcheck.state === "different" ? { state: "different", detail: r.vcheck.detail } : { state: "incomplete" };

/**
 * The loop's hooks for the exploration. A failed V check voids V and only V (G0.1, A1.4): V's jobs are skipped and S0 runs on to its
 * label (A1.1), the final exit staying 3; every other exit-2 or exit-3 problem (conservation, invariants, unusable input) stops the stage.
 */
export const explorationHooks: DriveHooks<ExplorationResult> = {
  plan: planExploration,
  vcheck: explorationVcheck,
  stops: (r) => r.problems.list.filter((p) => (p.code === 2 || p.code === 3) && !r.voidMessages.includes(p.message)),
  onVcheckFailure: "skip",
};

/**
 * The disk half of the exploration's DriverIo: jobs, summaries and census files of `out`; the evaluation reads `registered` too, never
 * writing it. The registered directory must load cleanly; an `out` with no job in it yet is the start of the run.
 */
export function explorationDiskIo(out: string, registered: string, root: string): Pick<DriverIoOf<ExplorationResult>, "jobExists" | "evaluate" | "rawSummaries" | "readCensus"> {
  const base = diskIo(out, root);
  return {
    jobExists: base.jobExists,
    rawSummaries: base.rawSummaries,
    readCensus: base.readCensus,
    evaluate: () => {
      const io = nodeIo(root);
      const regLoaded = new Problems();
      const regJobs = loadJobs(io, registered, regLoaded);
      const expLoaded = new Problems();
      const expJobs = loadJobs(io, out, expLoaded);
      const res = evaluateExploration({ registered: regJobs, exploration: expJobs, registeredCensus: (j) => (j.dir === null ? null : io.readText(path.join(j.dir, "census.tsv"))) });
      for (const p of regLoaded.list) res.problems.add(p.code, `registered directory: ${p.message}`);
      const started = fs.existsSync(out) && fs.readdirSync(out, { withFileTypes: true }).some((e) => e.isDirectory() && !e.name.startsWith(".") && fs.existsSync(path.join(out, e.name, "summary.json")));
      if (started) for (const p of expLoaded.list) res.problems.add(p.code, p.message);
      return res;
    },
  };
}
