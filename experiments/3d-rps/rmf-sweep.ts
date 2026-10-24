// Sweep driver for the RMF lattice reference: rule draft 2.2 (grid), 2.7 (contingency), 2.9 (rehearsal), Appendix A (seeds) and B.4
// (one JSON per cell); plan 6 and plan 8 (M3a). Cells are scheduled as chunks of realizations over a pool of Deno workers, the most
// expensive first; a chunk result is written as soon as it arrives, a cell result when its last chunk has, so the script resumes after
// an interruption: a cell whose JSON exists is skipped, a chunk whose file exists is not run again.
//
//   REGISTERED SWEEP (not to be started until the rules are frozen: it refuses unless experiments/3d-rps/RULES.md has its SHA-256
//   recorded in experiments/3d-rps/FROZEN; --dry-run needs no freeze):
//     deno run -A --no-lock experiments/3d-rps/rmf-sweep.ts --sweep --out=<dir> [--contingency] [--sizes=20,30,40,60] [--only=L60-iM4,...]
//         [--workers=8] [--chunk=50] [--reverse] [--dry-run]
//     --sweep is required and so is --out (nothing here has a default output directory); seeds are Appendix A's, R is 600 (300 for
//     --contingency, which is L = 100 at iM 3 to 8); --R, --iM and --seed-base are refused.
//   REHEARSAL (rule draft 2.9; plumbing, not a result; seeds 900 and up):
//     deno run -A --no-lock experiments/3d-rps/rmf-sweep.ts --rehearsal [--out=runs/rps/rehearsal] [--sizes=20] [--iM=10] [--R=50]
//         [--seed-base=900] [--chunk=10] [--workers=4] [--only=...] [--dry-run]
//     defaults are 2.9's rehearsal: L = 20, M = 2e-3 (iM 10), 50 realizations, seeds 900 to 949; --seed-base is 900 to 999,000.
//   --dry-run prints the plan (cells, chunks, seeds, events upper bound) and runs nothing. --reverse walks the queue from the cheap end.
// Output under --out: <id>.json per cell (id = L<L>-iM<iM>) and chunks/<id>-r<start>-<end>.json per chunk. Exit codes: 0 done,
// 1 failure, 2 usage.
import {
  CONTINGENCY_IM,
  CONTINGENCY_L,
  CONTINGENCY_R,
  LATTICE_SIZES,
  MAIN_R,
  MAIN_SIZES,
  M_GRID,
  estimatedEvents,
  finalizeCell,
  seedOfRealization,
  type CellRecord,
  type ChunkJob,
  type ChunkResult,
  type CellJob,
} from "./rmf-lattice.ts";
import { freezeRefusal } from "./frozen.ts";

// ---------------------------------------------------------------------------------------------------------------------
// Plans (pure)
// ---------------------------------------------------------------------------------------------------------------------

export interface PlanCell extends CellJob {
  id: string;
  R: number;
}

export function cellId(L: number, iM: number): string {
  return `L${L}-iM${iM}`;
}

function planCell(L: number, iM: number, R: number, seedBase: number | null): PlanCell {
  return { id: cellId(L, iM), L, M: M_GRID[iM], K: 3, iL: LATTICE_SIZES.indexOf(L), iM, seedBase, R };
}

/** Rule draft 2.2: four sizes times eleven values of M, R = 600, Appendix A seeds. */
export function mainPlan(): PlanCell[] {
  return MAIN_SIZES.flatMap((L) => M_GRID.map((_, iM) => planCell(L, iM, MAIN_R, null)));
}

/** Rule draft 2.7: L = 100, R = 300, M in {2e-4, 3e-4, 4e-4, 5e-4, 6e-4, 8e-4}. */
export function contingencyPlan(): PlanCell[] {
  return CONTINGENCY_IM.map((iM) => planCell(CONTINGENCY_L, iM, CONTINGENCY_R, null));
}

/** Rule draft 2.9's rehearsal and its variants: seeds `seedBase + r`. */
export function rehearsalPlan(o: { sizes: number[]; iMs: number[]; R: number; seedBase: number }): PlanCell[] {
  return o.sizes.flatMap((L) => o.iMs.map((iM) => planCell(L, iM, o.R, o.seedBase)));
}

/** Cells in scheduling order: most expensive first (events upper bound), or the cheap end first with `reverse`. */
export function queueOrder(plan: PlanCell[], reverse: boolean): PlanCell[] {
  const sorted = [...plan].sort((a, b) => estimatedEvents(b.L, b.M, b.R) - estimatedEvents(a.L, a.M, a.R));
  return reverse ? sorted.reverse() : sorted;
}

export function planChunks(cell: PlanCell, chunkSize: number): ChunkJob[] {
  const jobs: ChunkJob[] = [];
  for (let rStart = 0; rStart < cell.R; rStart += chunkSize) {
    jobs.push({ L: cell.L, M: cell.M, K: cell.K, iL: cell.iL, iM: cell.iM, seedBase: cell.seedBase, rStart, rEnd: Math.min(cell.R, rStart + chunkSize) });
  }
  return jobs;
}

export function chunkFileName(job: ChunkJob): string {
  const p = (n: number) => String(n).padStart(4, "0");
  return `${cellId(job.L, job.iM)}-r${p(job.rStart)}-${p(job.rEnd)}.json`;
}

/** Upper bound on the events of a plan (absorbed runs stop early): plan 6's 1.55e11 for the main grid, 3.9e11 for the contingency. */
export function planEvents(plan: PlanCell[]): number {
  return plan.reduce((s, c) => s + estimatedEvents(c.L, c.M, c.R), 0);
}

// ---------------------------------------------------------------------------------------------------------------------
// Arguments (pure)
// ---------------------------------------------------------------------------------------------------------------------

export class UsageError extends Error {}

/** Rehearsal seeds (Appendix A): from 900; with R at most 1,000 realizations the last seed stays below 1,000,000. */
export const REHEARSAL_SEED_MIN = 900;
export const REHEARSAL_SEED_BASE_MAX = 999_000;

/**
 * Why a registered sweep may not start, or null: it starts only after the freeze (rule draft header), that is, when
 * `experiments/3d-rps/RULES.md` exists and its SHA-256 is recorded in `experiments/3d-rps/FROZEN` (the check the readout makes).
 * `--dry-run` and the rehearsal need no freeze.
 */
export function sweepRefusal(rules: Uint8Array | null, frozen: string | null): string | null {
  return freezeRefusal("a registered sweep", "use --rehearsal for plumbing", rules, frozen);
}

export interface SweepConfig {
  mode: "sweep" | "rehearsal";
  out: string;
  workers: number;
  chunk: number;
  reverse: boolean;
  dryRun: boolean;
  plan: PlanCell[];
}

const BOOLEAN_FLAGS = new Set(["sweep", "rehearsal", "contingency", "reverse", "dry-run"]);
const VALUE_FLAGS = new Set(["out", "workers", "chunk", "sizes", "only", "iM", "R", "seed-base"]);

function intList(name: string, text: string): number[] {
  const out = text.split(",").map((s) => (s.trim() === "" ? NaN : Number(s)));
  if (out.length === 0 || out.some((v) => !Number.isInteger(v))) throw new UsageError(`--${name} must be a comma-separated list of integers, got "${text}"`);
  return out;
}

function intIn(name: string, text: string, lo: number, hi: number): number {
  const v = Number(text);
  if (text.trim() === "" || !Number.isInteger(v) || v < lo || v > hi) throw new UsageError(`--${name} must be an integer in [${lo}, ${hi}], got "${text}"`);
  return v;
}

export function parseSweepArgs(argv: string[]): SweepConfig {
  const bools = new Set<string>();
  const kv = new Map<string, string>();
  for (const a of argv) {
    const m = /^--([A-Za-z][\w-]*)(?:=(.*))?$/.exec(a);
    if (!m) throw new UsageError(`unrecognized argument ${a}`);
    const [, key, value] = m;
    if (BOOLEAN_FLAGS.has(key)) {
      if (value !== undefined) throw new UsageError(`--${key} takes no value`);
      bools.add(key);
    } else if (VALUE_FLAGS.has(key)) {
      if (value === undefined) throw new UsageError(`--${key} needs a value (--${key}=...)`);
      kv.set(key, value);
    } else throw new UsageError(`unknown flag --${key}`);
  }
  const sweep = bools.has("sweep");
  const rehearsal = bools.has("rehearsal");
  if (sweep === rehearsal) throw new UsageError("give exactly one of --sweep (the registered grid) or --rehearsal (rule draft 2.9)");
  const reject = (...names: string[]) => {
    for (const n of names) if (kv.has(n) || bools.has(n)) throw new UsageError(`--${n} is not allowed with --${sweep ? "sweep" : "rehearsal"}`);
  };
  const workers = kv.has("workers") ? intIn("workers", kv.get("workers")!, 1, 64) : sweep ? 8 : 4;
  const chunk = kv.has("chunk") ? intIn("chunk", kv.get("chunk")!, 1, 1000) : sweep ? 50 : 10;
  let plan: PlanCell[];
  let out: string;
  if (sweep) {
    reject("R", "iM", "seed-base");
    if (!kv.has("out")) throw new UsageError("--sweep needs --out=<dir>: a registered sweep has no default output directory");
    out = kv.get("out")!;
    if (bools.has("contingency")) {
      reject("sizes");
      plan = contingencyPlan();
    } else {
      plan = mainPlan();
      if (kv.has("sizes")) {
        const sizes = intList("sizes", kv.get("sizes")!);
        for (const L of sizes) if (!MAIN_SIZES.includes(L)) throw new UsageError(`--sizes: ${L} is not in the main grid ${MAIN_SIZES.join(",")}`);
        plan = plan.filter((c) => sizes.includes(c.L));
      }
    }
  } else {
    reject("contingency");
    out = kv.get("out") ?? "runs/rps/rehearsal";
    const sizes = kv.has("sizes") ? intList("sizes", kv.get("sizes")!) : [20];
    for (const L of sizes) if (!LATTICE_SIZES.includes(L)) throw new UsageError(`--sizes: ${L} is not one of ${LATTICE_SIZES.join(",")}`);
    const iMs = kv.has("iM") ? intList("iM", kv.get("iM")!) : [10];
    for (const i of iMs) if (i < 0 || i >= M_GRID.length) throw new UsageError(`--iM: ${i} is outside 0..${M_GRID.length - 1}`);
    const R = kv.has("R") ? intIn("R", kv.get("R")!, 1, 1000) : 50;
    // Appendix A: rehearsals use seeds 900 and up and never a block that a result or a review's scratch run uses (2,000,000 and up)
    const seedBase = kv.has("seed-base") ? intIn("seed-base", kv.get("seed-base")!, REHEARSAL_SEED_MIN, REHEARSAL_SEED_BASE_MAX) : REHEARSAL_SEED_MIN;
    plan = rehearsalPlan({ sizes, iMs, R, seedBase });
  }
  if (kv.has("only")) {
    const ids = kv.get("only")!.split(",");
    for (const id of ids) if (!plan.some((c) => c.id === id)) throw new UsageError(`--only: ${id} is not a cell of this plan`);
    plan = plan.filter((c) => ids.includes(c.id));
  }
  return { mode: sweep ? "sweep" : "rehearsal", out: out.replace(/\/+$/, "") || "/", workers, chunk, reverse: bools.has("reverse"), dryRun: bools.has("dry-run"), plan };
}

const USAGE = `usage:
  deno run -A --no-lock experiments/3d-rps/rmf-sweep.ts --sweep --out=<dir> [--contingency] [--sizes=..] [--only=..] [--workers=8] [--chunk=50] [--reverse] [--dry-run]
  deno run -A --no-lock experiments/3d-rps/rmf-sweep.ts --rehearsal [--out=runs/rps/rehearsal] [--sizes=20] [--iM=10] [--R=50] [--seed-base=900] [--chunk=10] [--workers=4] [--dry-run]`;

/** The lines --dry-run prints. */
export function describePlan(cfg: SweepConfig): string[] {
  const lines = [`mode ${cfg.mode}, out ${cfg.out}, ${cfg.workers} workers, chunk ${cfg.chunk}, ${cfg.plan.length} cells`];
  for (const c of queueOrder(cfg.plan, cfg.reverse)) {
    const n = planChunks(c, cfg.chunk).length;
    lines.push(
      `${c.id.padEnd(10)} L ${String(c.L).padStart(3)}  M ${c.M.toExponential(0).padStart(6)}  R ${String(c.R).padStart(3)}  ${String(n).padStart(2)} chunks  seeds ${seedOfRealization(c, 0)}..${seedOfRealization(c, c.R - 1)}  <= ${estimatedEvents(c.L, c.M, c.R).toExponential(2)} events`,
    );
  }
  lines.push(`events upper bound ${planEvents(cfg.plan).toExponential(3)}`);
  return lines;
}

// ---------------------------------------------------------------------------------------------------------------------
// Running (Deno)
// ---------------------------------------------------------------------------------------------------------------------

type Reply = { ok: true; result: ChunkResult } | { ok: false; error: string };

/** A chunk result as written to <out>/chunks: resuming reuses it only for the same job and the same rmf-lattice.ts. */
export interface ChunkFile extends ChunkResult {
  latticeSha256: string;
}

/** What the sweep adds to a CellRecord before writing it. */
export interface CellFile extends CellRecord {
  mode: "sweep" | "rehearsal";
  note: string;
  chunkSize: number;
  host: string;
  runtime: string;
  workers: number;
  /** Deno.loadavg() when the cell finished. */
  loadavg: number[];
  latticeSha256: string;
  finishedAt: string;
}

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  const tmp = `${path}.tmp`;
  await Deno.writeTextFile(tmp, JSON.stringify(value, null, 2) + "\n");
  await Deno.rename(tmp, path);
}

function sameJob(a: ChunkJob, b: ChunkJob): boolean {
  return a.L === b.L && a.M === b.M && a.K === b.K && a.iL === b.iL && a.iM === b.iM && a.seedBase === b.seedBase && a.rStart === b.rStart && a.rEnd === b.rEnd;
}

function runPool(jobs: ChunkJob[], nWorkers: number, onResult: (r: ChunkResult) => Promise<void>): Promise<void> {
  const url = new URL("./rmf-worker.ts", import.meta.url).href;
  return new Promise((resolve, reject) => {
    if (jobs.length === 0) return resolve();
    const pool: Worker[] = [];
    let next = 0;
    let finished = 0;
    let failed = false;
    const fail = (err: Error) => {
      if (failed) return;
      failed = true;
      for (const w of pool) w.terminate();
      reject(err);
    };
    const feed = (w: Worker) => {
      if (next < jobs.length) w.postMessage(jobs[next++]);
      else w.terminate();
    };
    for (let i = 0; i < Math.min(nWorkers, jobs.length); i++) {
      const w = new Worker(url, { type: "module" });
      w.onmessage = (ev: MessageEvent<Reply>) => {
        if (failed) return;
        const d = ev.data;
        if (!d.ok) return fail(new Error(d.error));
        onResult(d.result).then(
          () => {
            finished++;
            if (finished === jobs.length) {
              for (const x of pool) x.terminate();
              resolve();
            } else feed(w);
          },
          (e) => fail(e as Error),
        );
      };
      w.onerror = (e) => {
        e.preventDefault();
        fail(new Error(e.message));
      };
      pool.push(w);
      feed(w);
    }
  });
}

async function sha256Hex(path: URL): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await Deno.readFile(path));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function runSweep(cfg: SweepConfig): Promise<number> {
  const t0 = performance.now();
  const latticeSha256 = await sha256Hex(new URL("./rmf-lattice.ts", import.meta.url));
  await Deno.mkdir(`${cfg.out}/chunks`, { recursive: true });
  const queue = queueOrder(cfg.plan, cfg.reverse);
  const open = new Map<string, { cell: PlanCell; total: number; parts: ChunkResult[] }>();
  const jobs: ChunkJob[] = [];
  let skipped = 0;
  let resumedChunks = 0;
  for (const cell of queue) {
    const cellPath = `${cfg.out}/${cell.id}.json`;
    if (await exists(cellPath)) {
      const rec = JSON.parse(await Deno.readTextFile(cellPath)) as CellFile;
      const wanted = [seedOfRealization(cell, 0), seedOfRealization(cell, cell.R - 1)];
      if (rec.mode !== cfg.mode || rec.R !== cell.R || rec.K !== cell.K || rec.seeds[0] !== wanted[0] || rec.seeds[1] !== wanted[1]) {
        console.error(`${cellPath} exists but was written under other settings (mode ${rec.mode}, R ${rec.R}, seeds ${rec.seeds.join("..")}); delete it or use another --out`);
        return 1;
      }
      if (rec.latticeSha256 !== latticeSha256) {
        console.error(`${cellPath} was written by another version of rmf-lattice.ts (sha256 ${String(rec.latticeSha256).slice(0, 12)}, this one ${latticeSha256.slice(0, 12)}); delete it or use another --out`);
        return 1;
      }
      skipped++;
      continue;
    }
    const all = planChunks(cell, cfg.chunk);
    const entry = { cell, total: all.length, parts: [] as ChunkResult[] };
    for (const job of all) {
      const p = `${cfg.out}/chunks/${chunkFileName(job)}`;
      if (await exists(p)) {
        const prev = JSON.parse(await Deno.readTextFile(p)) as ChunkFile;
        if (!sameJob(prev, job)) {
          console.error(`${p} does not match the plan; delete it or use another --out`);
          return 1;
        }
        if (prev.latticeSha256 !== latticeSha256) {
          console.error(`${p} was written by another version of rmf-lattice.ts (sha256 ${String(prev.latticeSha256).slice(0, 12)}, this one ${latticeSha256.slice(0, 12)}); delete it or use another --out`);
          return 1;
        }
        entry.parts.push(prev);
        resumedChunks++;
      } else jobs.push(job);
    }
    open.set(cell.id, entry);
  }
  console.log(
    `${cfg.mode}: ${cfg.plan.length} cells, ${skipped} already done, ${jobs.length} chunks to run (${resumedChunks} chunk files reused), ${cfg.workers} workers, ` +
      `rmf-lattice.ts sha256 ${latticeSha256.slice(0, 12)}`,
  );

  let cellsDone = skipped;
  let events = 0;
  let coreSeconds = 0;
  const finish = async (id: string) => {
    const e = open.get(id)!;
    const rec = finalizeCell(e.parts);
    events += rec.events;
    coreSeconds += rec.seconds;
    const file: CellFile = {
      ...rec,
      mode: cfg.mode,
      note: cfg.mode === "rehearsal" ? "rehearsal: plumbing and timing, not a result" : "registered sweep cell",
      chunkSize: cfg.chunk,
      host: Deno.hostname(),
      runtime: `deno ${Deno.version.deno} (v8 ${Deno.version.v8})`,
      workers: cfg.workers,
      loadavg: Deno.loadavg(),
      latticeSha256,
      finishedAt: new Date().toISOString(),
    };
    await writeJsonAtomic(`${cfg.out}/${id}.json`, file);
    open.delete(id);
    cellsDone++;
    console.log(
      `[${cellsDone}/${cfg.plan.length}] ${id.padEnd(10)} M ${e.cell.M.toExponential(0)}  k ${rec.k}/${rec.R}  pExt ${rec.pExt.toFixed(3)} (se ${rec.se.toFixed(3)})  ` +
        `${rec.eventsPerSecond === null ? "n/a" : (rec.eventsPerSecond / 1e6).toFixed(1)} Mevents/s per core  ${rec.seconds.toFixed(1)} core-s`,
    );
  };
  for (const [id, e] of [...open]) if (e.parts.length === e.total) await finish(id);
  await runPool(jobs, cfg.workers, async (r) => {
    const chunkFile: ChunkFile = { ...r, latticeSha256 };
    await writeJsonAtomic(`${cfg.out}/chunks/${chunkFileName(r)}`, chunkFile);
    const e = open.get(cellId(r.L, r.iM))!;
    e.parts.push(r);
    if (e.parts.length === e.total) await finish(cellId(r.L, r.iM));
  });
  if (open.size > 0) {
    console.error(`internal error: cells without all their chunks: ${[...open.keys()].join(", ")}`);
    return 1;
  }
  console.log(
    `done in ${((performance.now() - t0) / 1000).toFixed(1)} s wall: ${events.toExponential(3)} events in ${coreSeconds.toFixed(1)} core-s` +
      (coreSeconds > 0 ? ` (${(events / coreSeconds / 1e6).toFixed(1)} Mevents/s per core)` : ""),
  );
  return 0;
}

if (typeof Deno !== "undefined" && import.meta.main) {
  let code = 1;
  try {
    const cfg = parseSweepArgs(Deno.args);
    if (cfg.dryRun) {
      console.log(describePlan(cfg).join("\n"));
      code = 0;
    } else {
      if (cfg.mode === "sweep") {
        const dir = new URL(".", import.meta.url);
        const read = (name: string): Uint8Array | null => {
          try {
            return Deno.readFileSync(new URL(name, dir));
          } catch {
            return null;
          }
        };
        const frozen = read("FROZEN");
        const refusal = sweepRefusal(read("RULES.md"), frozen === null ? null : new TextDecoder().decode(frozen));
        if (refusal !== null) throw new UsageError(refusal);
      }
      code = await runSweep(cfg);
    }
  } catch (e) {
    if (e instanceof UsageError) {
      console.error(`${e.message}\n${USAGE}`);
      code = 2;
    } else {
      console.error(e);
      code = 1;
    }
  }
  Deno.exit(code);
}
