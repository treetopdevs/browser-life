// Mycelium rung R4 runner: GPU runs of one (arm, slot) with a ledger check at every census, the seed log, the freeze gates and the CPU cross-check
// (docs/mycelium-r4-2026-11-14/PROTOCOL.md). Native WebGPU under Deno. Adapted from r3.ts.
//
//   deno run -A --no-lock tools/mycelium/r4.ts smoke     --arm inherit-c4 --seed 7 --steps 3000 --out <root> [--cpu-check]
//   deno run -A --no-lock tools/mycelium/r4.ts dev       (--all | --arm A --seed N) --out <root> [--jobs N]   # five arms on slots 8001-8020
//   deno run -A --no-lock tools/mycelium/r4.ts confirm   --all --out <root> [--jobs N]                        # five arms on slots 7001-7016, batch only, silent, resumable
//   deno run -A --no-lock tools/mycelium/r4.ts cpu-check --arm A --seed N --out <root>                        # CPU re-run of a finished run, digest comparison
//
// <root> is runs/mycelium-r4: runs go to <root>/{smoke,dev,confirm}/<arm>/seed-<slot>/series.json. dev needs Freeze 1, confirm needs Freeze 2 too
// (r4-freeze.ts) and a READY calibration. smoke needs neither, never touches the seed log, takes slots 1-100 only. Every dev, confirm and cpu-check
// run is appended to docs/mycelium-r4-2026-11-14/seed-log.jsonl (started, then finished or invalid). A nonzero ledger residual, or a GPU state that
// differs from the CPU's, logs an invalid entry, exits 1, writes no series.json and stops the protocol. --seed is the registered SLOT; the world seed
// in the config is slot + the arm's offset (r4-seeds.ts). A finished entry records the SHA-256 of the exact series.json bytes, which the analysis checks.
import { parseArgs } from "jsr:@std/cli@1/parse-args";
import { createWorld, energyTotal, matterTotal, RULE_ID, stateDigest, step, validateState } from "./world.ts";
import { GpuMycelium, myceliumDevice } from "./gpu.ts";
import { R4Observer, r4SeriesProblems } from "./observe-r4.ts";
import { armConfig, calibrationProblems, fileHashProblem, gateRun, isR4Arm, logProblems, type Phase, PROTOCOL_ID, parseFrozen, R4, type R4Arm, type SeedLogEntry } from "./r4-protocol.ts";
import { R4_ARMS, R4_CONFIRM_SLOTS, R4_DEV_SLOTS } from "./r4-seeds.ts";
import { type R4RunFile, r4RunFileProblems, readoutsOf, readoutsOfWindows } from "./r4-decide.ts";
import { CALIBRATION_PATH, codeHash, readFrozen, SEED_LOG_PATH, sha256Hex, verifyFrozen } from "./r4-freeze.ts";
import { seriesProblems } from "./observe-r2b.ts";

export async function readLog(): Promise<SeedLogEntry[]> {
  try {
    return (await Deno.readTextFile(SEED_LOG_PATH)).split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as SeedLogEntry);
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return [];
    throw e;
  }
}

let logChain: Promise<void> = Promise.resolve();
function appendLog(e: SeedLogEntry & Record<string, unknown>): Promise<void> {
  logChain = logChain.then(async () => {
    await Deno.mkdir(SEED_LOG_PATH.replace(/\/[^/]+$/, ""), { recursive: true });
    await Deno.writeTextFile(SEED_LOG_PATH, JSON.stringify({ ...e, time: new Date().toISOString() }) + "\n", { append: true });
  });
  return logChain;
}

export class InvalidRun extends Error {}

export interface RunSpec { phase: "smoke" | "dev" | "confirm"; arm: R4Arm; seed: number; steps: number; dir: string; logged: boolean; cpuCheck?: boolean; quiet?: boolean }

export const runDir = (spec: Pick<RunSpec, "dir" | "arm" | "seed">) => `${spec.dir}/${spec.arm}/seed-${spec.seed}`;

async function exists(path: string): Promise<boolean> {
  try { await Deno.stat(path); return true; } catch (e) { if (e instanceof Deno.errors.NotFound) return false; throw e; }
}

/** Runs one (arm, slot) on the GPU, checking both ledgers at every 100-step census, and writes series.json. */
export async function runOne(device: GPUDevice, spec: RunSpec): Promise<R4RunFile> {
  const { phase, arm, seed, steps } = spec;
  const config = armConfig(arm, seed);
  const dir = runDir(spec);
  const code = await codeHash();
  if (spec.logged) await appendLog({ phase, arm, seed, steps, state: "started" });
  const t0 = performance.now();
  const gpu = await GpuMycelium.create(device, createWorld(config));
  const cpu = spec.cpuCheck ? createWorld(config) : null;
  const obs = new R4Observer();
  let checks = 0;
  let last = null as ReturnType<typeof createWorld> | null;
  const invalid = async (why: string, extra: Record<string, unknown>) => {
    console.error(`INVALID ${phase} ${arm} ${seed}: ${why}. The run is invalid; the protocol stops here.`);
    if (spec.logged) await appendLog({ phase, arm, seed, steps, state: "invalid", why, ...extra });
    gpu.destroy();
    throw new InvalidRun(why);
  };
  for (let t = R4.SCALAR_EVERY; t <= steps; t += R4.SCALAR_EVERY) {
    gpu.step(R4.SCALAR_EVERY);
    const s = await gpu.read();
    last = s;
    checks++;
    const dm = matterTotal(s) - s.matter0;
    const de = energyTotal(s) - (s.energy0 + s.totals.lightIn - s.totals.heat);
    const bad = validateState(s);
    if (dm !== 0 || de !== 0 || bad.length) await invalid(`ledger residual at step ${s.step}: matter ${dm}, energy ${de}${bad.length ? `; ${bad[0]}` : ""}`, { step: s.step, matter: dm, energy: de });
    if (cpu) {
      for (let j = 0; j < R4.SCALAR_EVERY; j++) step(cpu);
      if (stateDigest(cpu) !== stateDigest(s)) await invalid(`the GPU state differs from the CPU reference at step ${s.step}`, { step: s.step });
    }
    obs.scalar(s);
    if (t % R4.HEAVY_EVERY === 0) obs.heavy(s);
    // Confirm shows progress only, never a population or trail value.
    if (!spec.quiet && t % 10_000 === 0) console.error(`${phase} ${arm} ${seed}: step ${t}/${steps}${phase === "confirm" ? "" : ` n=${s.n}`}`);
  }
  gpu.destroy();
  const series = obs.series();
  const prob = [...seriesProblems(series, steps), ...r4SeriesProblems(series)];
  if (prob.length) throw new Error(`series incomplete: ${prob.join("; ")}`);
  // A smoke run is shorter than the protocol windows: its late window is the second half, its mid window the second quarter. Never analysed.
  const readout = steps === R4.STEPS ? readoutsOf(arm, seed, series) : readoutsOfWindows(arm, seed, series, steps / 2, steps, steps / 4, steps / 2);
  const run: R4RunFile = {
    format: "mycelium-r4-run-1", protocol: PROTOCOL_ID, ruleId: RULE_ID, phase, arm, seed, steps, config: last!.config, engine: "gpu", digest: stateDigest(last!),
    ledgerChecks: checks, ledgerResidual: 0, cpuLockstep: cpu !== null, codeHash: code, readout, series,
  };
  await Deno.mkdir(dir, { recursive: true });
  const text = JSON.stringify(run);
  await Deno.writeTextFile(`${dir}/series.json.tmp`, text);
  await Deno.rename(`${dir}/series.json.tmp`, `${dir}/series.json`);
  const wallMs = Math.round(performance.now() - t0);
  if (spec.logged) await appendLog({ phase, arm, seed, steps, state: "finished", digest: run.digest, fileSha256: await sha256Hex(new TextEncoder().encode(text)), wallMs });
  const head = `${phase} ${arm} seed ${seed}: ${steps} steps, ${checks} ledger checks at residual 0, digest ${run.digest}, ${wallMs} ms`;
  console.log(phase === "confirm" ? head : `${head}, n(end) ${series.scalar.n.at(-1)}, tmL ${fmt(readout.tmL)} align ${fmt(readout.align)} acute ${fmt(readout.acute)} occ ${fmt(readout.occ)} guard ${readout.guard ? "TRIPPED" : "ok"}`);
  return run;
}

const fmt = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toPrecision(4));

/** Runs the items with at most `jobs` in flight, starting them in order; stops starting new ones after a failure and rethrows it. */
export async function pool<T>(items: readonly T[], jobs: number, fn: (x: T) => Promise<void>): Promise<void> {
  let next = 0, failure: unknown = null;
  const worker = async () => {
    while (failure === null && next < items.length) {
      const item = items[next++];
      try { await fn(item); } catch (e) { failure ??= e; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(jobs, items.length) }, worker));
  if (failure !== null) throw failure;
}

/** Everything that must hold before a logged run starts; throws "refused: ..." otherwise. */
async function gate(phase: Phase, arm: string, seed: number, steps: number, dir: string): Promise<void> {
  const seriesExists = await exists(`${dir}/${arm}/seed-${seed}/series.json`);
  const problems = gateRun({ phase, arm, seed, steps, seriesExists }, await readLog());
  if (problems.length) throw new Error(`refused: ${problems.join("; ")}`);
  const frozen = await verifyFrozen(phase === "cpu-check" ? (R4_CONFIRM_SLOTS.includes(seed) ? "confirm" : "dev") : phase);
  if (frozen.length) throw new Error(`refused: ${frozen.join("; ")}`);
  if (phase === "confirm") {
    const bad = await calibrationReadProblems();
    if (bad.length) throw new Error(`refused: ${bad.join("; ")}`);
  }
}

/** READY, provenance and margins of CALIBRATION.json against FROZEN (shared by every confirmation gate and the batch preflight). */
async function calibrationReadProblems(): Promise<string[]> {
  let cal: Parameters<typeof calibrationProblems>[0];
  try { cal = JSON.parse(await Deno.readTextFile(CALIBRATION_PATH)); } catch { return ["CALIBRATION.json cannot be read"]; }
  return calibrationProblems(cal, parseFrozen((await readFrozen()) ?? "").keys);
}

/**
 * One writer at a time on the protocol: an exclusive lock file beside the canonical seed log (created with createNew, so a second batch or cpu-check
 * fails to start whatever its --out root). A crash leaves the lock; delete it by hand once you have checked that no r4.ts process is running. The seed log
 * also refuses a second finished entry for any run (logProblems).
 */
async function withLock<T>(fn: () => Promise<T>): Promise<T> {
  await Deno.mkdir(SEED_LOG_PATH.replace(/\/[^/]+$/, ""), { recursive: true });
  const path = `${SEED_LOG_PATH}.lock`;
  let f: Deno.FsFile;
  try { f = await Deno.open(path, { write: true, createNew: true }); } catch (e) {
    if (e instanceof Deno.errors.AlreadyExists) throw new Error(`refused: ${path} exists; another R4 batch or cpu-check holds the lock (or crashed: check that no r4.ts is running, then delete it)`);
    throw e;
  }
  try { await f.write(new TextEncoder().encode(`${Deno.pid} ${new Date().toISOString()}\n`)); f.close(); return await fn(); } finally { await Deno.remove(path).catch(() => {}); }
}

async function doBatch(device: GPUDevice, phase: "dev" | "confirm", root: string, only: { arm: string; seed: number } | null, jobs: number): Promise<void> {
  return await withLock(() => doBatchLocked(device, phase, root, only, jobs));
}

async function doBatchLocked(device: GPUDevice, phase: "dev" | "confirm", root: string, only: { arm: string; seed: number } | null, jobs: number): Promise<void> {
  const dir = `${root}/${phase}`;
  // Integrity first, whether or not anything is left to run: the log, the freezes (and for confirm the calibration) must hold.
  const log = await readLog();
  const lp = logProblems(log);
  if (lp.length) throw new Error(`refused: ${lp.join("; ")}`);
  const fr = await verifyFrozen(phase);
  if (fr.length) throw new Error(`refused: ${fr.join("; ")}`);
  if (phase === "confirm") {
    const cb = await calibrationReadProblems();
    if (cb.length) throw new Error(`refused: ${cb.join("; ")}`);
  }
  const all: { arm: R4Arm; seed: number }[] = phase === "confirm"
    ? R4_ARMS.flatMap((arm) => R4_CONFIRM_SLOTS.map((seed) => ({ arm, seed })))
    : only ? [{ arm: only.arm as R4Arm, seed: only.seed }] : R4_ARMS.flatMap((arm) => R4_DEV_SLOTS.map((seed) => ({ arm, seed })));
  // Reconcile the log with the files before anything starts. A run the log calls finished is never repeated, and its file must exist and be the one the log hashed;
  // a run with a file but no finished entry is refused by gateRun (inspect it by hand).
  const todo: { arm: R4Arm; seed: number }[] = [];
  for (const p of all) {
    const fin = log.find((e) => e.phase === phase && e.arm === p.arm && e.seed === p.seed && e.state === "finished");
    const path = `${dir}/${p.arm}/seed-${p.seed}/series.json`;
    if (!fin) { todo.push(p); continue; }
    let bytes: Uint8Array;
    try { bytes = await Deno.readFile(path); } catch { throw new Error(`refused: the log says ${phase} ${p.arm} ${p.seed} is finished but ${path} is missing; a finished run is never repeated`); }
    const hp = fileHashProblem(log, phase, p.arm, p.seed, await sha256Hex(bytes));
    if (hp) throw new Error(`refused: ${hp}`);
  }
  if (todo.length === 0) { console.log(`${phase}: nothing to run (every run is finished and its file matches the log)`); return; }
  for (const p of todo) await gate(phase, p.arm, p.seed, R4.STEPS, dir);
  await pool(todo, jobs, async (p) => {
    await gate(phase, p.arm, p.seed, R4.STEPS, dir);
    await runOne(device, { phase, arm: p.arm, seed: p.seed, steps: R4.STEPS, dir, logged: true, quiet: phase === "confirm" });
  });
}

async function readJson<T>(path: string): Promise<T | null> {
  try { return JSON.parse(await Deno.readTextFile(path)) as T; } catch (e) { if (e instanceof Deno.errors.NotFound) return null; throw e; }
}

/** CPU re-run of a finished dev or confirmation run: the final digest must equal the stored one (a mismatch is INVALID). */
async function doCpuCheck(root: string, arm: string, seed: number): Promise<void> {
  if (!isR4Arm(arm)) throw new Error(`unknown arm ${arm}`);
  const phase: "dev" | "confirm" = R4_CONFIRM_SLOTS.includes(seed) ? "confirm" : "dev";
  const dir = `${root}/${phase}/${arm}/seed-${seed}`;
  let bytes: Uint8Array;
  try { bytes = await Deno.readFile(`${dir}/series.json`); } catch { throw new Error(`refused: ${dir}/series.json does not exist; cpu-check re-runs a finished run`); }
  const hp = fileHashProblem(await readLog(), phase, arm, seed, await sha256Hex(bytes));
  if (hp) throw new Error(`refused: ${hp}`);
  const run = JSON.parse(new TextDecoder().decode(bytes)) as R4RunFile;
  const idp = r4RunFileProblems(run, { phase, arm, seed, codeHash: null });
  if (idp.length) throw new Error(`refused: ${idp[0]}`);
  await gate("cpu-check", arm, seed, run.steps, `${root}/${phase}`);
  if (await exists(`${dir}/cpu-check.json`)) throw new Error(`refused: ${dir}/cpu-check.json exists; the cross-check is done once`);
  await appendLog({ phase: "cpu-check", arm, seed, steps: run.steps, state: "started" });
  const t0 = performance.now();
  const s = createWorld(run.config as ReturnType<typeof armConfig>);
  for (let t = 1; t <= run.steps; t++) {
    step(s);
    if (t % 10_000 === 0) console.error(`cpu-check ${arm} ${seed}: step ${t}/${run.steps}`);
  }
  const cpuDigest = stateDigest(s);
  const equal = cpuDigest === run.digest;
  await Deno.writeTextFile(`${dir}/cpu-check.json`, JSON.stringify({ arm, seed, steps: run.steps, cpuDigest, gpuDigest: run.digest, equal, codeHash: await codeHash() }, null, 2) + "\n");
  if (!equal) {
    await appendLog({ phase: "cpu-check", arm, seed, steps: run.steps, state: "invalid", cpuDigest, gpuDigest: run.digest });
    console.error(`INVALID cpu-check ${arm} ${seed}: CPU digest ${cpuDigest} != GPU digest ${run.digest}`);
    throw new InvalidRun("digest mismatch");
  }
  await appendLog({ phase: "cpu-check", arm, seed, steps: run.steps, state: "finished", digest: cpuDigest, wallMs: Math.round(performance.now() - t0) });
  console.log(`cpu-check ${arm} seed ${seed}: ${run.steps} steps, CPU digest equals GPU digest ${cpuDigest}`);
}

if (import.meta.main) {
  const a = parseArgs(Deno.args, { string: ["arm", "seed", "out", "steps", "jobs"], boolean: ["all", "cpu-check"] });
  const [cmd] = a._ as string[];
  const usage = () => { console.error("usage: r4.ts smoke|dev|confirm|cpu-check ... --out <root> (see the header of this file)"); Deno.exit(2); };
  if (!cmd || !a.out) usage();
  const root = a.out as string;
  const jobs = Number(a.jobs ?? 4);
  if (!Number.isInteger(jobs) || jobs < 1) { console.error("--jobs must be a positive integer"); Deno.exit(2); }
  try {
    if (cmd === "cpu-check") {
      if (!a.arm || a.seed === undefined) usage();
      await withLock(() => doCpuCheck(root, a.arm as string, Number(a.seed)));
    } else {
      const device = await myceliumDevice();
      if (cmd === "smoke") {
        if (!a.arm || a.seed === undefined || !isR4Arm(a.arm)) usage();
        const steps = Number(a.steps ?? 3000);
        const problems = gateRun({ phase: "smoke", arm: a.arm as string, seed: Number(a.seed), steps }, []);
        if (problems.length) throw new Error(`refused: ${problems.join("; ")}`);
        await runOne(device, { phase: "smoke", arm: a.arm as R4Arm, seed: Number(a.seed), steps, dir: `${root}/smoke`, logged: false, cpuCheck: a["cpu-check"] === true });
      } else if (cmd === "dev") {
        if (!a.all && (!a.arm || a.seed === undefined)) usage();
        await doBatch(device, "dev", root, a.all ? null : { arm: a.arm as string, seed: Number(a.seed) }, jobs);
      } else if (cmd === "confirm") {
        if (!a.all) throw new Error("confirm is batch-only: use --all (single confirmation runs are not offered)");
        if (a.arm !== undefined || a.seed !== undefined) throw new Error("--arm and --seed are refused in confirm");
        await doBatch(device, "confirm", root, null, jobs);
      } else usage();
    }
  } catch (e) {
    console.error((e as Error).message);
    Deno.exit(1);
  }
}
