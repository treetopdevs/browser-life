// Launches the anomaly bell v1's GPU corpus (docs/naturalist-bell-v1-plan-2026-10-17.md, "Fixed before running", parts A and
// B): 70 fresh gradient-m3 neutral nulls (seeds 2002-2071) and 50 treatment twins (5 arms x seeds 1-10), each 300,000 steps,
// through tools/run.ts, a few at a time. Job list and nudge rule in tools/lib/bell-v1-jobs.ts.
//
//   deno run -A tools/bell-v1-launch.ts --runs <abs runs root> [--base <runs root holding replay-m4>] [--parallel 3]
//       [--nudges experiments/naturalist/bell-v1-nudges.json] [--dry-run] [--resume] [--only A|B]
//
// First it finds each nudge centre from the base's checkpoint at S (checkpoints/t000200000.blck, its hash checked against the
// base manifest) and writes them to --nudges; an existing file that disagrees stops the launch. Then it checks that all 120
// destinations <runs>/<experiment>/gradient-m3/<condition>/seed-<n> are distinct and absent. With --resume a destination is
// skipped as done only if jobs.jsonl records exit 0 for it and its manifest has this job's spec, a summary of 300,000 steps and
// exactly the scheduled intervention; any other existing destination stops the launch (remove it by hand). A lock file
// <runs>/bell-v1-launch/lock, taken before those checks and removed at exit, keeps two launches off one runs root.
// The checkpoints' state hashes must match their manifests.
// Each job's stdout goes to <runs>/bell-v1-launch/<job>.log (stderr to <job>.err) and one JSON line per finished job to
// <runs>/bell-v1-launch/jobs.jsonl ({id, exit, seconds}). A failed job does not stop the others.
//   --dry-run   print the commands and the nudge centres; run nothing, write nothing
//   --only      just part A (nulls) or part B (twins)
import { parseArgs } from "jsr:@std/cli@1/parse-args";
import { CH, decodeCheckpoint, stateHash } from "@bl/schema";
import { BASE_SEEDS, NUDGE_TARGETS, S, STEPS, interventionsMatch, jobProblems, nearestBiomass, planJobs, runArgs, type Job, type NudgeCentres } from "./lib/bell-v1-jobs.ts";

const a = parseArgs(Deno.args, {
  string: ["runs", "base", "parallel", "nudges", "only"],
  boolean: ["dry-run", "resume"],
  default: { parallel: "3", nudges: "experiments/naturalist/bell-v1-nudges.json" },
  unknown: (arg) => {
    if (arg.startsWith("-")) throw new Error(`unknown flag ${arg}`);
    return true;
  },
});
if (a._.length) throw new Error(`unexpected arguments ${a._.join(" ")}`);
if (!a.runs || !a.runs.startsWith("/")) throw new Error("--runs must be an absolute path (the runs root the bundles go under)");
const runsRoot = a.runs.replace(/\/+$/, "");
const baseRoot = (a.base ?? runsRoot).replace(/\/+$/, "");
const parallel = Number(a.parallel);
if (!Number.isInteger(parallel) || parallel < 1 || parallel > 8) throw new Error(`--parallel ${a.parallel} must be 1..8`);
if (a.only !== undefined && a.only !== "A" && a.only !== "B") throw new Error(`--only ${a.only} must be A or B`);
const dry = !!a["dry-run"];

const exists = async (p: string) => {
  try {
    await Deno.stat(p);
    return true;
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return false;
    throw e;
  }
};
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

// ---------------------------------------------------------------------------------------------
// Nudge centres, from the S checkpoints.

const nudges: NudgeCentres = {};
const nudgeRecord: Record<string, unknown>[] = [];
for (let seed = BASE_SEEDS[0]; seed <= BASE_SEEDS[1]; seed++) {
  const dir = `${baseRoot}/replay-m4/gradient-m3/treatment/seed-${seed}`;
  const manifest = JSON.parse(await Deno.readTextFile(`${dir}/manifest.json`));
  const entry = (manifest.checkpoints ?? []).find((c: { step: number }) => c.step === S);
  if (!entry) throw new Error(`${dir}: manifest lists no checkpoint at step ${S}`);
  const bytes = await Deno.readFile(`${dir}/${entry.file}`);
  const { state } = decodeCheckpoint(bytes);
  if (state.step !== S) throw new Error(`${dir}/${entry.file}: state at step ${state.step}, expected ${S}`);
  if (stateHash(state) !== entry.hash) throw new Error(`${dir}/${entry.file}: state hash ${stateHash(state)}, the manifest says ${entry.hash}`);
  if (manifest.spec?.seed !== seed || manifest.spec?.condition !== "treatment" || state.cfg.seed !== seed) throw new Error(`${dir}: not treatment seed ${seed}`);
  const W = state.cfg.tileW * state.cfg.tilesX, H = state.cfg.tileH * state.cfg.tilesY, n = W * H;
  const B = state.cells.subarray(CH.B * n, (CH.B + 1) * n);
  nudges[seed] = {} as NudgeCentres[number];
  for (const arm of ["nudge", "nudge2"] as const) {
    const [cx, cy] = NUDGE_TARGETS[arm];
    const c = nearestBiomass(B, W, H, cx, cy);
    if (!c) throw new Error(`seed ${seed}: no biomass anywhere at step ${S}`);
    nudges[seed][arm] = { x: c.x, y: c.y };
    nudgeRecord.push({ seed, arm, target: [cx, cy], x: c.x, y: c.y, d2: c.d2, B: B[c.y * W + c.x], checkpoint: entry.file, manifestHash: entry.hash, fileSha256: hex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))) });
  }
}
const nudgeText = JSON.stringify({ rule: "anomaly-bell-v1 nudge centres", note: "docs/naturalist-bell-v1-plan-2026-10-17.md", S, centres: nudgeRecord }, null, 1) + "\n";
console.log(nudgeRecord.map((r) => `seed ${r.seed} ${r.arm}: (${r.x}, ${r.y}) d2=${r.d2} B=${r.B}`).join("\n"));
if (!dry) {
  const old = await Deno.readTextFile(a.nudges).catch(() => null);
  if (old !== null && old !== nudgeText) throw new Error(`STOP: ${a.nudges} exists and disagrees with the centres computed now`);
  if (old === null) {
    await Deno.mkdir(a.nudges.slice(0, a.nudges.lastIndexOf("/")) || ".", { recursive: true });
    await Deno.writeTextFile(a.nudges, nudgeText);
  }
}

// ---------------------------------------------------------------------------------------------
// Jobs and destinations.

// One launch at a time per runs root: an exclusive lock file, taken before the destinations are checked and held to the end.
const logDir = `${runsRoot}/bell-v1-launch`;
const lockPath = `${logDir}/lock`;
if (!dry) {
  await Deno.mkdir(logDir, { recursive: true });
  try {
    await Deno.writeTextFile(lockPath, JSON.stringify({ pid: Deno.pid, started: new Date().toISOString() }) + "\n", { createNew: true });
  } catch (e) {
    if (e instanceof Deno.errors.AlreadyExists) throw new Error(`STOP: ${lockPath} exists: another launch holds this runs root (remove it by hand if that launch is dead)`);
    throw e;
  }
  globalThis.addEventListener("unload", () => {
    try {
      Deno.removeSync(lockPath);
    } catch { /* already gone */ }
  });
}

/** Exit codes recorded by earlier launches, last one per job. */
const recorded = new Map<string, number>();
for (const line of (await Deno.readTextFile(`${logDir}/jobs.jsonl`).catch(() => "")).split("\n")) {
  if (!line.trim()) continue;
  const r = JSON.parse(line);
  recorded.set(r.id, r.exit);
}
/** Why an existing destination is not this job's finished run, or null when it is. */
async function notDone(j: Job, dest: string): Promise<string | null> {
  if (recorded.get(j.id) !== 0) return "no exit-0 record in jobs.jsonl";
  const m = await Deno.readTextFile(`${dest}/manifest.json`).then(JSON.parse).catch(() => null);
  if (!m?.summary) return "no manifest summary";
  const sp = m.spec ?? {};
  if (sp.experiment !== j.experiment || sp.presetId !== "gradient-m3" || sp.condition !== j.condition || sp.seed !== j.seed || sp.steps !== STEPS || sp.censusEvery !== 100 || sp.deepEvery !== 10 || sp.lineageObs !== true)
    return `manifest spec ${JSON.stringify({ experiment: sp.experiment, condition: sp.condition, seed: sp.seed, steps: sp.steps })} is not this job's`;
  if (m.summary.steps !== STEPS) return `summary has ${m.summary.steps} steps`;
  const applied = j.expected === null ? [] : (await Deno.readTextFile(`${dest}/interventions.jsonl`).catch(() => "")).split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
  if (!interventionsMatch(j, applied)) return "interventions.jsonl does not hold exactly the scheduled entry";
  return null;
}

let jobs = planJobs(nudges);
const problems = jobProblems(jobs);
if (problems.length) throw new Error(`STOP: ${problems.join("; ")}`);
if (jobs.length !== 120) throw new Error(`STOP: ${jobs.length} jobs, the plan has 120`);
if (a.only) jobs = jobs.filter((j) => j.part === a.only);
const todo: typeof jobs = [];
for (const j of jobs) {
  const dest = `${runsRoot}/${j.rel}`;
  if (!(await exists(dest))) {
    todo.push(j);
    continue;
  }
  const why = await notDone(j, dest);
  if (a.resume && why === null) continue;
  throw new Error(`STOP: ${dest} already exists${why === null ? " (finished; pass --resume to skip it)" : ` and is not this job's finished run (${why}); remove it by hand`}`);
}
console.log(`${todo.length} of ${jobs.length} jobs to run, ${parallel} at a time, into ${runsRoot}`);
if (dry) {
  for (const j of todo) console.log(["deno", "run", "-A", "--no-lock", "tools/run.ts", ...runArgs(j, runsRoot)].join(" "));
  Deno.exit(0);
}

// ---------------------------------------------------------------------------------------------
// Run, a few at a time.

let next = 0, failed = 0;
async function worker() {
  while (next < todo.length) {
    const j = todo[next++];
    const t0 = performance.now();
    const out = await Deno.open(`${logDir}/${j.id}.log`, { write: true, create: true, truncate: true });
    const err = await Deno.open(`${logDir}/${j.id}.err`, { write: true, create: true, truncate: true });
    const child = new Deno.Command("deno", { args: ["run", "-A", "--no-lock", "tools/run.ts", ...runArgs(j, runsRoot)], stdout: "piped", stderr: "piped" }).spawn();
    // Each pipe closes its file when the stream ends.
    await Promise.all([child.stdout.pipeTo(out.writable), child.stderr.pipeTo(err.writable)]);
    const { code } = await child.status;
    const seconds = Math.round((performance.now() - t0) / 1000);
    if (code !== 0) failed++;
    await Deno.writeTextFile(`${logDir}/jobs.jsonl`, JSON.stringify({ id: j.id, exit: code, seconds }) + "\n", { append: true });
    console.log(`${j.id}: exit ${code} in ${seconds}s (${next}/${todo.length} started)`);
  }
}
await Promise.all(Array.from({ length: Math.min(parallel, todo.length) }, worker));
console.log(`done: ${todo.length - failed} ok, ${failed} failed`);
if (failed) Deno.exit(1);
