// The Gate-0 driver (rule draft 3.0, G0.1 to G0.6; plan 8, Part A): runs the pilot's job list on the spike, through the kernel-job
// harness, one directory per job under --out, and prints the Gate-0 table through the readout. Staged: the next jobs are read off the
// readout's evaluation of what is already on disk (plan.ts), so it resumes after any interruption, and two machines can share one queue.
//
//   deno run -A --no-lock experiments/3d-rps/gate0-spike/gate0.ts <mode> [options]
//
//   modes (exactly one)
//     --gate0       run the staged job list into --out (required; there is no default output directory). A registered run: it refuses
//                   unless experiments/3d-rps/RULES.md exists and has its SHA-256 in experiments/3d-rps/FROZEN (RULES.md is frozen before
//                   Gate 0, rule draft header), except with --dry-run. The table printed at the end is the readout's, on the frozen rules.
//     --rehearsal   plumbing at seeds 900 and up (a few thousand steps), into --out (default runs/rps/gate0-rehearsal); not a result
//     --table       print the Gate-0 table of --out through the readout, no GPU; on the frozen rules, or with --draft on
//                   runs/rps/rule-draft.md with every output labelled DRAFT
//     --hash        print the spike's SHA-256 (the recipe of rule draft 3.0, on the working tree) and compare it with
//                   experiments/3d-rps/gate0-spike.sha256; --write records it there, with the listing of the files it covers
//     --exploration Amendment 1 of RULES.md (after GATE-0-STOP): run, in waves, the jobs A1.2 needs that the registered pilot does not
//                   hold, into --out, with --registered=<the registered pilot's job directory> (read, never written): the V check
//                   (the vacancy build; its removal build is the registered scan job at v_mid, seed 401), G0.3 of S0 and of V on S0,
//                   G0.4 once if either passes row 2, G0.5 per rung that passes rows 1 to 3; S0 and V side by side, both in full
//                   (explore.ts). Refuses, --dry-run included, unless RULES.md is frozen and contains the Amendment 1 heading. Ends
//                   with the exploration table (readout.ts gate0-exploration), which starts "EXPLORATION (Amendment 1): ..."
//                   and never gives a Gate-0 verdict. --machine-share, --reverse, --only, --max-jobs and --dry-run work as with --gate0
//     --exploration-2 Amendment 2 of RULES.md (after Amendment 1 read EXPLORATION-NO-HORIZON): persistence at 256 x 256 x 4, into its own
//                   --out (no --registered): the A2.2 horizon (S0, spread 8, rate 0, seeds 401 to 403, 200,000 run steps), then, once
//                   T_ctl and h0 are known (G0.4's own reading), the A2.3 confirmations of the removal and the vacancy kill at rate 64,
//                   spread 8, h0 run steps (explore.ts; job ids start with "g2-"). Refuses, --dry-run included, unless RULES.md is frozen
//                   and contains the Amendment 2 heading. Ends with readout.ts gate0-exploration-2, which starts "EXPLORATION (Amendment
//                   2): ..." and never gives a Gate-0 verdict. --machine-share, --reverse, --only, --max-jobs and --dry-run as with --gate0
//   options
//     --out=<dir>             the job directory (<dir>/<id>/census.tsv, summary.json); safe to rsync between machines (the readout and
//                             the driver skip the hidden .tmp-* directories a job is assembled in, so a copy that caught one does no
//                             harm; rsync --exclude='.tmp-*' keeps them out anyway)
//     --rung=S0,S1,S2,V|all   the rungs this process handles (default all). S2 is planned only after S0 and S1 both end NO-GO: LEVELS,
//                             V only once a substrate rung has passed row 1; shared jobs (G0.4 horizon) belong to the substrate rung
//                             Rule draft 3.0 takes the rungs in the order S0, S1, S2, V and stops at the first GO: a wave is planned for
//                             the first rung of the order, among those handled, that is not yet excluded (S1 waits for S0's verdict, V's
//                             rows for S0's and S1's), and nothing is planned for a rung behind a GO. A process given --rung=S1 alone
//                             works on S1 at once (side by side with S0 on another machine, D2)
//     --plan-all              plan every handled rung at once, whatever the others' state (S0 and S1 side by side with one command, V's
//                             rows beside S1's, rungs after a GO): it costs the lower rungs' jobs whenever a higher rung gives GO
//     --draft                 with --table only: read runs/rps/rule-draft.md and label the output DRAFT
//     --machine-share=i/n     of the jobs the planner lists, run those machine i of n owns (an id hash, so a job's owner does not
//                             depend on what else is on disk). The other share is waited for (exit 4): rsync the other machine's
//                             job directories in and run again; a machine that is done early can run the whole list with --reverse
//     --reverse               walk this process's list from the other end
//     --dense                 plan the G0.6 dense-rate job once Gate 0 is GO (run it on the idle M3 Pro)
//     --dry-run               print the wave the planner lists and what this process would run, run nothing
//     --only=<text>           run only the jobs whose id contains text
//     --max-jobs=N            stop after N jobs
// A job whose directory exists is skipped. A crash or a failed matter/energy check is rerun once from step 0; a second failure writes a
// MISSING marker, and a conservation or invariant failure also stops the stage (exit 3): the driver then refuses to run until the
// offending job directory has been dealt with by hand (rule draft 1.3, 8.1: no job is rerun or dropped otherwise).
// Exit codes: 0 nothing left to do for this process, 2 usage, 3 stage stopped or a bug indicator in the readout, 4 jobs outstanding
// (another machine's share, or inputs missing).
import { requestDevice3 } from "../../../packages/sim-gpu/src/gpu-sim3.ts";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { cleanStaleTmp, executeKernelJob, type KernelJobDeps, type KernelJobResult, type SimContext } from "../lib/kernel-job.ts";
import { Problems, prepareRows } from "../readout-jobs.ts";
import { loadJobs, nodeIo, run as readoutRun } from "../readout.ts";
import { gpuFactory } from "./adapter.ts";
import { UsageError, parseCommandLine, readSpikeFiles, sidecarText, spikeHash, spikeListing, type Args } from "./cli.ts";
import { exploration2Refusal, explorationRefusal, gate0Refusal } from "../frozen.ts";
import { exploration2DiskIo, exploration2Hooks, explorationDirsRefusal, explorationDiskIo, explorationHooks } from "./explore.ts";
import { runMeterJob, runSpecOf } from "./jobs.ts";
import { diskIo, drive, driveWith, type DriverIo, type DriverIoOf } from "./driver.ts";
import type { ExplorationResult } from "../readout-exploration.ts";
import type { Exploration2Result } from "../readout-exploration-2.ts";
import type { JobDef } from "./plan.ts";
import { plumbingOk, rehearse } from "./rehearsal.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..", "..");
const SHA_FILE = path.join(HERE, "..", "gate0-spike.sha256");
const DEFAULT_REHEARSAL_OUT = path.join(ROOT, "runs", "rps", "gate0-rehearsal");

const say = (s: string) => console.log(s);

// ---- the device ----

async function makeDeps(): Promise<{ deps: KernelJobDeps; close: () => void }> {
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
  const info = (adapter as unknown as { info?: { description?: string } } | null)?.info;
  const description = info?.description ?? "unknown";
  let device: GPUDevice | null = null;
  let lost = false;
  let freshFor = "";
  const getDevice = async (ctx: SimContext): Promise<GPUDevice> => {
    // a rerun is given a fresh device, and so is a job after the device was lost
    const key = `${ctx.jobId}:${ctx.attempt}`;
    if (device !== null && (lost || (ctx.attempt > 1 && freshFor !== key))) {
      try {
        device.destroy();
      } catch {
        // already gone
      }
      device = null;
    }
    if (device === null) {
      const d = await requestDevice3(navigator.gpu, ctx.cfg);
      device = d;
      lost = false;
      freshFor = key;
      d.lost.then(() => {
        if (device === d) lost = true;
      });
    }
    return device;
  };
  const deps: KernelJobDeps = {
    makeSim: gpuFactory(getDevice),
    host: Deno.hostname(),
    device: description,
    log: (l) => say(`  ${l}`),
    logEvery: 25,
  };
  return { deps, close: () => device?.destroy() };
}

// ---- the driver ----

async function runDef(d: JobDef, deps: KernelJobDeps, out: string, mode: "gate0" | "exploration" | "exploration-2" = "gate0"): Promise<KernelJobResult> {
  const loadavg = Deno.loadavg().map((x: number) => Math.round(x * 100) / 100);
  // an exploration job says so in its summary.json (mode "exploration", amendment 1)
  // (runSpecOf records the shape of every job in summary.json)
  const extra = mode === "exploration" ? { loadavg, amendment: 1 } : mode === "exploration-2" ? { loadavg, amendment: 2 } : { loadavg };
  if (d.kind === "meter") return await runMeterJob(d, deps, out, mode, extra);
  return await executeKernelJob(runSpecOf(d, mode, extra), deps, out);
}

/** RULES.md and FROZEN as the registered run sees them (null when absent). */
function readFrozenFiles(): { rules: Uint8Array | null; frozen: string | null } {
  const read = (name: string): Uint8Array | null => {
    const p = path.join(ROOT, "experiments", "3d-rps", name);
    return fs.existsSync(p) ? new Uint8Array(fs.readFileSync(p)) : null;
  };
  const frozen = read("FROZEN");
  return { rules: read("RULES.md"), frozen: frozen === null ? null : new TextDecoder().decode(frozen) };
}

async function gate0(a: Args): Promise<number> {
  // RULES.md is frozen before Gate 0 (rule draft header and 3.0); a dry run only prints the wave and needs no freeze
  if (!a.dryRun) {
    const { rules, frozen } = readFrozenFiles();
    const refusal = gate0Refusal(rules, frozen);
    if (refusal !== null) throw new UsageError(refusal);
  }
  const out = path.resolve(a.out!);
  fs.mkdirSync(out, { recursive: true });
  cleanStaleTmp(out);
  let boot: Awaited<ReturnType<typeof makeDeps>> | null = null;
  const io: DriverIo = {
    ...diskIo(out, ROOT),
    run: async (d) => {
      boot ??= await makeDeps();
      return await runDef(d, boot.deps, out);
    },
    log: say,
  };
  let r;
  try {
    r = await drive(a, io);
  } finally {
    (boot as Awaited<ReturnType<typeof makeDeps>> | null)?.close();
  }
  if (a.dryRun) return r.code;
  // the table on the frozen rules (the run started only after the freeze). The Gate-0 table needs RULES.md only: a Gate-0 record that is
  // written but not yet hashed is provisional, completed with the dense rate of this very run (G0.6) and hashed afterwards (rule draft 8.5)
  const table = readoutRun(["gate0", "--jobs", out], nodeIo(ROOT));
  say("");
  say(table.out);
  if (r.code === 3 || table.code === 2 || table.code === 3) return table.code === 2 ? 2 : 3;
  return r.code === 4 || table.code === 4 ? 4 : 0;
}

// ---- the exploration (Amendment 1) ----

async function exploration(a: Args): Promise<number> {
  // the header (Amendment 1) is already printed: parseCommandLine prints it before anything is parsed
  // the exploration exists only by Amendment 1 of the frozen rules: no dry-run exemption
  const { rules, frozen } = readFrozenFiles();
  const refusal = explorationRefusal(rules, frozen);
  if (refusal !== null) throw new UsageError(refusal);
  const out = path.resolve(a.out!);
  const registered = path.resolve(a.registered!);
  const dirs = explorationDirsRefusal(out, registered);
  if (dirs !== null) throw new UsageError(dirs);
  if (!fs.existsSync(registered)) throw new UsageError(`--registered: ${registered} does not exist`);
  if (!a.dryRun) {
    fs.mkdirSync(out, { recursive: true });
    cleanStaleTmp(out);
  }
  let boot: Awaited<ReturnType<typeof makeDeps>> | null = null;
  const io: DriverIoOf<ExplorationResult> = {
    ...explorationDiskIo(out, registered, ROOT),
    run: async (d) => {
      boot ??= await makeDeps();
      return await runDef(d, boot.deps, out, "exploration");
    },
    log: say,
  };
  let r;
  try {
    r = await driveWith(a, io, explorationHooks);
  } finally {
    (boot as Awaited<ReturnType<typeof makeDeps>> | null)?.close();
  }
  if (a.dryRun) return r.code;
  // the readout's table starts with the header again
  const table = readoutRun(["gate0-exploration", "--jobs", out, "--registered", registered], nodeIo(ROOT));
  say("");
  say(table.out);
  if (r.code === 3 || table.code === 2 || table.code === 3) return table.code === 2 ? 2 : 3;
  return r.code === 4 || table.code === 4 ? 4 : 0;
}

// ---- the exploration of Amendment 2 ----

async function exploration2(a: Args): Promise<number> {
  // the header (Amendment 2) is already printed: parseCommandLine prints it before anything is parsed; no dry-run exemption
  const { rules, frozen } = readFrozenFiles();
  const refusal = exploration2Refusal(rules, frozen);
  if (refusal !== null) throw new UsageError(refusal);
  const out = path.resolve(a.out!);
  if (!a.dryRun) {
    fs.mkdirSync(out, { recursive: true });
    cleanStaleTmp(out);
  }
  let boot: Awaited<ReturnType<typeof makeDeps>> | null = null;
  const io: DriverIoOf<Exploration2Result> = {
    ...exploration2DiskIo(out, ROOT),
    run: async (d) => {
      boot ??= await makeDeps();
      return await runDef(d, boot.deps, out, "exploration-2");
    },
    log: say,
  };
  let r;
  try {
    r = await driveWith(a, io, exploration2Hooks);
  } finally {
    (boot as Awaited<ReturnType<typeof makeDeps>> | null)?.close();
  }
  if (a.dryRun) return r.code;
  // the readout's table starts with the header again
  const table = readoutRun(["gate0-exploration-2", "--jobs", out], nodeIo(ROOT));
  say("");
  say(table.out);
  if (r.code === 3 || table.code === 2 || table.code === 3) return table.code === 2 ? 2 : 3;
  return r.code === 4 || table.code === 4 ? 4 : 0;
}

// ---- the rehearsal ----

async function rehearsal(a: Args): Promise<number> {
  const out = path.resolve(a.out ?? DEFAULT_REHEARSAL_OUT);
  if (fs.existsSync(out) && fs.readdirSync(out).length > 0) {
    say(`${out} is not empty: a rehearsal writes into a fresh directory (remove it first)`);
    return 2;
  }
  const boot = await makeDeps();
  try {
    const t0 = performance.now();
    const rep = await rehearse({ out, root: ROOT, makeSim: boot.deps.makeSim, host: boot.deps.host, device: boot.deps.device, log: (l) => say(`  ${l}`) });
    // the files must be readable by the readout
    const pr = new Problems();
    const jobs = loadJobs(nodeIo(ROOT), out, pr);
    for (const j of jobs.filter((x) => x.rows !== null)) {
      const problem = pr.guard(() => prepareRows(j, 3));
      if (problem === null) pr.add(2, `${j.s.id}: its census.tsv does not satisfy the readout`);
    }
    rep.readout = { loaded: jobs.length, problems: pr.list.map((p) => `exit ${p.code}: ${p.message}`) };
    fs.writeFileSync(path.join(out, "rehearsal.json"), `${JSON.stringify(rep, null, 2)}\n`);
    say("");
    say(`REHEARSAL (plumbing, seed ${rep.seed}; not a result) ${((performance.now() - t0) / 1000).toFixed(0)} s`);
    for (const j of rep.jobs) say(`  ${j.id}: ${j.status}, ${j.steps} steps, stop ${j.stop}, ${j.stepsPerSec} steps/s, matterOk ${j.matterOk}, residual ${j.residual}, living ${j.living.join(" ")}`);
    for (const j of rep.jobs) say(`    ${j.id}: ndom ${j.changes.ndom} nanti ${j.changes.nanti} chi ${j.changes.chi.toFixed(3)} over the run censuses`);
    say(`  burn-in hash equal across the four jobs: ${rep.burnHashesEqual}`);
    say(`  V check (rate 0, removal build vs vacancy build): census.tsv ${rep.vcheck.identical ? "IDENTICAL" : "DIFFERENT"} (${rep.vcheck.bytes} bytes), burnHash equal ${rep.vcheck.burnHashEqual}, endHash equal ${rep.vcheck.endHashEqual}`);
    say(`  hand-over: two-phase job ${rep.handOver.jobHash} vs continuous run ${rep.handOver.continuousHash} over ${rep.handOver.steps} steps: ${rep.handOver.equal ? "equal" : "DIFFERENT"}`);
    const au = rep.audit;
    say(`  audit (${au.shape.join("x")}, one step at step ${au.step}, vacancy rate ${au.rate}): ${au.living} living, ${au.withDominant} with a dominant face; host model predicts ${au.predictedKilled} emptied, observed ${au.observedChanged} changed vs the rate-0 build (${au.indistinguishable} predicted cells were dying anyway), ${au.mismatches} mismatches, ${au.emptyViolations} not left as the lesion leaves a cell; matter ${au.matterOk ? "exact" : "CHANGED"}, residual ${au.residual}`);
    for (const m of rep.meter) say(`  meter (inert stripes, B 28, 5,000 steps, seed 905), spread ${m.spread}: W_x ${m.W.x?.toFixed(3)} W_y ${m.W.y?.toFixed(3)} D_x ${m.Dx?.toFixed(4)} D_y ${m.Dy?.toFixed(4)} D_lab ${m.Dlab?.toFixed(4)}, ${m.stepsPerSec} steps/s`);
    say(`  readout loader: ${rep.readout.loaded} jobs loaded, ${rep.readout.problems.length === 0 ? "no problems" : rep.readout.problems.join("; ")}`);
    const ok = plumbingOk(rep);
    say(ok ? "  all plumbing checks passed" : "  A PLUMBING CHECK FAILED");
    return ok ? 0 : 3;
  } finally {
    boot.close();
  }
}

// ---- the table and the hash ----

function table(a: Args): number {
  const res = readoutRun(["gate0", "--jobs", path.resolve(a.out!), ...(a.draft ? ["--draft"] : [])], nodeIo(ROOT));
  say(res.out);
  if (a.draft && !fs.existsSync(path.join(ROOT, "runs", "rps", "rule-draft.md"))) say("(--draft needs runs/rps/rule-draft.md under the repository root; this checkout has none)");
  return res.code;
}

async function listSpikeFiles(): Promise<string[]> {
  const p = await new Deno.Command("git", { args: ["ls-files", "-co", "--exclude-standard"], cwd: HERE, stdout: "piped", stderr: "piped" }).output();
  if (!p.success) throw new Error(`git ls-files failed: ${new TextDecoder().decode(p.stderr)}`);
  return new TextDecoder().decode(p.stdout).split("\n").filter((l) => l !== "");
}

async function hash(a: Args): Promise<number> {
  const files = readSpikeFiles(HERE, await listSpikeFiles());
  const h = spikeHash(files);
  say(`${h}  gate0-spike (${files.length} files)`);
  if (a.write) {
    fs.writeFileSync(SHA_FILE, sidecarText(files));
    say(`wrote ${path.relative(ROOT, SHA_FILE)}`);
    return 0;
  }
  if (fs.existsSync(SHA_FILE)) {
    const recorded = fs.readFileSync(SHA_FILE, "utf8").split("\n")[0].trim();
    say(recorded === h ? "matches the recorded value" : `DIFFERS from the recorded value ${recorded}`);
    return recorded === h ? 0 : 1;
  }
  say("no recorded value (use --write)");
  return 0;
}

// ---- main ----

if ((import.meta as { main?: boolean }).main === true) {
  let code: number;
  try {
    const a = parseCommandLine(Deno.args, say);
    code = a.mode === "gate0" ? await gate0(a) : a.mode === "exploration" ? await exploration(a) : a.mode === "exploration-2" ? await exploration2(a) : a.mode === "rehearsal" ? await rehearsal(a) : a.mode === "table" ? table(a) : await hash(a);
  } catch (e) {
    if (e instanceof UsageError) {
      console.error(`gate0: ${e.message}`);
      code = 2;
    } else throw e;
  }
  Deno.exit(code);
}

export { spikeListing };
