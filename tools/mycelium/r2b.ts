// Mycelium rung R2b runner: GPU runs of one (arm, seed) with a ledger check at every census, the seed log, the freeze gates, the
// matching rounds and the CPU cross-check (docs/mycelium-r2b-2026-11-13/PROTOCOL.md). Native WebGPU under Deno.
//
//   deno run -A --no-lock tools/mycelium/r2b.ts smoke   --arm inherit --seed 77 --steps 3000 --out <root> [--v 256] [--cpu-check]
//   deno run -A --no-lock tools/mycelium/r2b.ts timing  --out <root> [--jobs 8]          # the timing gate: 8 concurrent smoke runs, prints steps per second
//   deno run -A --no-lock tools/mycelium/r2b.ts dev     (--arm A --seed N | --all [--arms a,b,...]) --out <root> [--jobs N]
//   deno run -A --no-lock tools/mycelium/r2b.ts match   --out <root> [--jobs N]          # needs <root>/stage-a.json from r2b-analyze.ts stage-a
//   deno run -A --no-lock tools/mycelium/r2b.ts confirm --all --out <root> [--jobs N]     # batch only, silent, resumable
//   deno run -A --no-lock tools/mycelium/r2b.ts cpu-check --arm A --seed N --out <root>   # CPU re-run of a finished dev or confirmation run, digest comparison
//
// <root> is runs/mycelium-r2b: runs go to <root>/{smoke,dev,confirm}/<arm>/seed-<n>/series.json and matching rounds to
// <root>/match/round-<k>/physarum/seed-<n>/. dev and match need Freeze 1 in FROZEN, confirm needs Freeze 2 as well (r2b-freeze.ts);
// smoke needs neither, never touches the seed log or docs/, and takes seeds 1-100 and 106-1999 only. Seeds 101-105 and 9001-9005
// are refused outright. Every dev, match, confirm and cpu-check run is appended to docs/mycelium-r2b-2026-11-13/seed-log.jsonl
// (started, then finished or invalid). A nonzero ledger residual, or a GPU state that differs from the CPU's, logs an invalid entry,
// exits 1, writes no series.json and stops the protocol (the log then refuses every later logged run). Concurrency (--jobs, default
// 4) is inside one process, so log appends are ordered; "fixed order" means runs start in the fixed order (arm major, slot ascending).
// --seed is the registered SLOT (dev 2001-2020, confirmation 5001-5016); the world seed in the config is slot + the arm's offset
// (r2b-seeds.ts), so no two arms share founders. Every logged run records the plan FROZEN names, and its finished entry records the
// SHA-256 of the exact series.json bytes, which the analysis checks.
import { parseArgs } from "jsr:@std/cli@1/parse-args";
import { createWorld, energyTotal, matterTotal, type MyceliumConfig, RULE_ID, stateDigest, step, validateState } from "./world.ts";
import { GpuMycelium, myceliumDevice } from "./gpu.ts";
import { R2bObserver, type R2bSeries, runValues, seriesProblems } from "./observe-r2b.ts";
import {
  type AnyArm, armConfig, checkCalibrationForConfirm, gateRun, isArm, MATCH_SEEDS, type Phase, type PlanName, PLANS, PROTOCOL_ID, parseFrozen, parseFrozenExtras,
  pendingConfirm, planForTiming, R2B, type SeedLogEntry,
} from "./r2b-protocol.ts";
import { matchStep, type MatchingRecord, startingDeposit } from "./r2b-decide.ts";
import { median } from "./r2b-stats.ts";
import { CALIBRATION_PATH, codeHash, readFrozen, SEED_LOG_PATH, sha256Hex, verifyFrozen } from "./r2b-freeze.ts";

// ---- seed log -------------------------------------------------------------------------------------------

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

// ---- one run --------------------------------------------------------------------------------------------

export class InvalidRun extends Error {}

export interface RunSpec {
  phase: Phase;
  arm: AnyArm;
  seed: number;
  steps: number;
  /** physarumDeposit, for the physarum arm. */
  v?: number;
  dir: string;
  logged: boolean;
  round?: number;
  /** Step the CPU reference in lockstep and compare the digest at every census (smoke only: it costs 4 ms a step). */
  cpuCheck?: boolean;
  quiet?: boolean;
  /** Print the head line only, no readout values (the timing gate reads timing only). */
  terse?: boolean;
  /** The plan FROZEN names (logged phases): written into every log entry, so a later change of plan is caught (logProblems). */
  plan?: PlanName;
}

/** The window of a run: (50k, 100k] for a protocol run, (10k, 30k] for a matching run, (steps/2, steps] for a smoke run. */
export const windowOf = (phase: Phase, steps: number): { lo: number; hi: number } => (phase === "match" ? { lo: R2B.MATCH_LO, hi: steps } : phase === "smoke" ? { lo: steps / 2, hi: steps } : { lo: R2B.LO, hi: steps });

export interface RunFile {
  format: "mycelium-r2b-run-1";
  protocol: typeof PROTOCOL_ID;
  ruleId: string;
  phase: Phase;
  arm: AnyArm;
  seed: number;
  steps: number;
  round?: number;
  v: number | null;
  config: MyceliumConfig;
  engine: "gpu";
  digest: string;
  ledgerChecks: number;
  ledgerResidual: 0;
  cpuLockstep: boolean;
  codeHash: string;
  cached: { lo: number; hi: number; values: ReturnType<typeof runValues> };
  series: R2bSeries;
}

async function exists(path: string): Promise<boolean> {
  try { await Deno.stat(path); return true; } catch (e) { if (e instanceof Deno.errors.NotFound) return false; throw e; }
}

export const runDir = (spec: Pick<RunSpec, "dir" | "arm" | "seed">) => `${spec.dir}/${spec.arm}/seed-${spec.seed}`;

/** Runs one (arm, seed) on the GPU, checking both ledgers at every 100-step census, and writes series.json. */
export async function runOne(device: GPUDevice, spec: RunSpec): Promise<RunFile> {
  const { phase, arm, seed, steps } = spec;
  const config = armConfig(arm, seed, spec.v);
  const dir = runDir(spec);
  const code = await codeHash();
  const logPlan = spec.logged && spec.plan ? { plan: spec.plan } : {};
  if (spec.logged) await appendLog({ phase, arm, seed, steps, round: spec.round, state: "started", ...logPlan });
  const t0 = performance.now();
  const gpu = await GpuMycelium.create(device, createWorld(config));
  const cpu = spec.cpuCheck ? createWorld(config) : null;
  const obs = new R2bObserver(arm !== "physarum");
  let checks = 0;
  let last = null as ReturnType<typeof createWorld> | null;
  const invalid = async (why: string, extra: Record<string, unknown>) => {
    console.error(`INVALID ${phase} ${arm} ${seed}: ${why}. The run is invalid; the protocol stops here.`);
    if (spec.logged) await appendLog({ phase, arm, seed, steps, round: spec.round, state: "invalid", why, ...logPlan, ...extra });
    gpu.destroy();
    throw new InvalidRun(why);
  };
  for (let t = R2B.SCALAR_EVERY; t <= steps; t += R2B.SCALAR_EVERY) {
    gpu.step(R2B.SCALAR_EVERY);
    const s = await gpu.read();
    last = s;
    checks++;
    const dm = matterTotal(s) - s.matter0;
    const de = energyTotal(s) - (s.energy0 + s.totals.lightIn - s.totals.heat);
    const bad = validateState(s);
    if (dm !== 0 || de !== 0 || bad.length) await invalid(`ledger residual at step ${s.step}: matter ${dm}, energy ${de}${bad.length ? `; ${bad[0]}` : ""}`, { step: s.step, matter: dm, energy: de });
    if (cpu) {
      for (let j = 0; j < R2B.SCALAR_EVERY; j++) step(cpu);
      if (stateDigest(cpu) !== stateDigest(s)) await invalid(`the GPU state differs from the CPU reference at step ${s.step}`, { step: s.step });
    }
    obs.scalar(s);
    if (t % R2B.HEAVY_EVERY === 0) obs.heavy(s);
    // Confirm shows progress only, never a population value (PROTOCOL.md sections 5 and 10).
    if (!spec.quiet && t % 10_000 === 0) console.error(`${phase} ${arm} ${seed}: step ${t}/${steps}${phase === "confirm" ? "" : ` n=${s.n}`}`);
  }
  gpu.destroy();
  const series = obs.series();
  const prob = seriesProblems(series, steps);
  if (prob.length) throw new Error(`series incomplete: ${prob.join("; ")}`);
  const { lo, hi } = windowOf(phase, steps);
  const run: RunFile = {
    format: "mycelium-r2b-run-1", protocol: PROTOCOL_ID, ruleId: RULE_ID, phase, arm, seed, steps, ...(spec.round !== undefined ? { round: spec.round } : {}), v: spec.v ?? null,
    config: last!.config, engine: "gpu", digest: stateDigest(last!), ledgerChecks: checks, ledgerResidual: 0, cpuLockstep: cpu !== null, codeHash: code,
    cached: { lo, hi, values: runValues(series, lo, hi, null) }, series,
  };
  await Deno.mkdir(dir, { recursive: true });
  const text = JSON.stringify(run);
  await Deno.writeTextFile(`${dir}/series.json.tmp`, text);
  await Deno.rename(`${dir}/series.json.tmp`, `${dir}/series.json`);
  const wallMs = Math.round(performance.now() - t0);
  // The SHA-256 of the exact bytes is logged, so the analysis can refuse a series.json that was edited after the run.
  if (spec.logged) await appendLog({ phase, arm, seed, steps, round: spec.round, state: "finished", digest: run.digest, fileSha256: await sha256Hex(new TextEncoder().encode(text)), wallMs, ...logPlan });
  const r = run.cached.values;
  const head = `${phase} ${arm} seed ${seed}: ${steps} steps, ${checks} ledger checks at residual 0, digest ${run.digest}, ${wallMs} ms`;
  // A confirmation result is not shown before the batch is in: confirm prints digests only.
  console.log(phase === "confirm" || spec.terse ? head : `${head}, n(end) ${series.scalar.n.at(-1)}, guard ${r.guardTripped ? "TRIPPED" : "ok"} (min n ${r.minN}), TM ${fmt(r.TM)} MI ${fmt(r.MI)} AGE ${fmt(r.AGE)} TURN ${fmt(r.TURN)} SIG ${fmt(r.SIG)} d ${fmt(r.d)}`);
  return run;
}

const fmt = (v: number | null) => (v === null ? "-" : Math.abs(v) >= 100 ? v.toFixed(0) : v.toPrecision(4));

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

// ---- gates and files ---------------------------------------------------------------------------------------

async function planFromFrozen(): Promise<PlanName | null> {
  const t = await readFrozen();
  return t === null ? null : parseFrozenExtras(t).plan;
}

/** Everything that must hold before a logged run starts; throws "refused: ..." otherwise. */
async function gate(phase: Phase, arm: string, seed: number, steps: number, dir: string): Promise<void> {
  const seriesExists = await exists(`${dir}/${arm}/seed-${seed}/series.json`);
  const problems = gateRun({ phase, arm, seed, steps, plan: await planFromFrozen(), seriesExists }, await readLog());
  if (problems.length) throw new Error(`refused: ${problems.join("; ")}`);
  const frozen = await verifyFrozen(phase === "cpu-check" ? (seed >= 5001 ? "confirm" : "dev") : phase);
  if (frozen.length) throw new Error(`refused: ${frozen.join("; ")}`);
  if (phase === "confirm") {
    const text = (await readFrozen()) ?? "";
    let cal: Record<string, unknown>;
    try { cal = JSON.parse(await Deno.readTextFile(CALIBRATION_PATH)); } catch { throw new Error("refused: CALIBRATION.json cannot be read"); }
    const bad = checkCalibrationForConfirm(cal as Parameters<typeof checkCalibrationForConfirm>[0], parseFrozen(text).keys, parseFrozenExtras(text).plan);
    if (bad.length) throw new Error(`refused: ${bad.join("; ")}`);
  }
}

async function readJson<T>(path: string): Promise<T | null> {
  try { return JSON.parse(await Deno.readTextFile(path)) as T; } catch (e) { if (e instanceof Deno.errors.NotFound) return null; throw e; }
}

/** The matched deposit v: from CALIBRATION.json in confirm, from the final matching.json in dev. */
async function depositFor(phase: Phase, root: string): Promise<number> {
  if (phase === "confirm") {
    const cal = await readJson<{ physarum?: { v?: number } }>(CALIBRATION_PATH);
    if (!Number.isInteger(cal?.physarum?.v)) throw new Error("refused: CALIBRATION.json has no matched v");
    return cal!.physarum!.v!;
  }
  const m = await readJson<MatchingRecord & { final?: boolean }>(`${root}/matching.json`);
  if (!m || !m.final || m.limited || !Number.isInteger(m.v)) throw new Error("refused: the physarum arm needs a final matching.json (run `match` first)");
  return m.v!;
}

// ---- subcommands --------------------------------------------------------------------------------------------

async function doBatch(device: GPUDevice, phase: "dev" | "confirm", root: string, arms: readonly AnyArm[], only: { arm: string; seed: number } | null, jobs: number): Promise<void> {
  const dir = `${root}/${phase}`;
  const plan = await planFromFrozen();
  if (plan === null) throw new Error("refused: FROZEN does not record the plan");
  const log = await readLog();
  let todo: { arm: AnyArm; seed: number }[];
  if (phase === "confirm") todo = pendingConfirm(log, plan);
  else todo = only ? [{ arm: only.arm as AnyArm, seed: only.seed }] : arms.flatMap((arm) => PLANS[plan].dev.map((seed) => ({ arm, seed })));
  if (phase === "dev") todo = (await Promise.all(todo.map(async (p) => ((await exists(`${dir}/${p.arm}/seed-${p.seed}/series.json`)) ? null : p)))).filter((p): p is { arm: AnyArm; seed: number } => p !== null);
  if (todo.length === 0) { console.log(`${phase}: nothing to run (every run is finished)`); return; }
  // Gate the whole batch before the first run starts, so a refusal never leaves a half-started batch.
  for (const p of todo) await gate(phase, p.arm, p.seed, R2B.STEPS, dir);
  const vPhys = todo.some((p) => p.arm === "physarum") ? await depositFor(phase, root) : undefined;
  await pool(todo, jobs, async (p) => {
    await gate(phase, p.arm, p.seed, R2B.STEPS, dir);
    await runOne(device, { phase, arm: p.arm, seed: p.seed, steps: R2B.STEPS, v: p.arm === "physarum" ? vPhys : undefined, dir, logged: true, quiet: phase === "confirm", plan });
  });
}

async function doMatch(device: GPUDevice, root: string, jobs: number): Promise<void> {
  const plan = await planFromFrozen();
  if (plan === null) throw new Error("refused: FROZEN does not record the plan");
  const stage = await readJson<{ T: number | null; source: string; limited: boolean; reason: string | null }>(`${root}/stage-a.json`);
  if (!stage) throw new Error("refused: <root>/stage-a.json is missing (run `r2b-analyze.ts stage-a` on the dev inherit runs first)");
  const file = `${root}/matching.json`;
  const prior = await readJson<MatchingRecord & { final?: boolean }>(file);
  if (prior?.final) throw new Error("refused: matching.json is already final; matching is not run again");
  if (stage.limited || stage.T === null) {
    const rec = { T: 0, source: stage.source, v0: 0, rounds: [], v: null, converged: false, ratio: null, limited: true, reason: stage.reason, final: true };
    await Deno.writeTextFile(file, JSON.stringify(rec, null, 2) + "\n");
    console.log(`matching: the null cannot be matched (${stage.reason}); MEASUREMENT-LIMITED`);
    return;
  }
  const T = stage.T;
  const rec: MatchingRecord & { final?: boolean } = prior ?? { T, source: stage.source, v0: startingDeposit(T), rounds: [], v: null, converged: false, ratio: null, limited: false, reason: null, final: false };
  if (rec.T !== T) throw new Error("refused: matching.json was started under a different T");
  // A resume continues with the deposit the last finished round asked for (its update), not with that round's own v.
  let v = rec.v0;
  if (rec.rounds.length) {
    const last = rec.rounds.at(-1)!;
    const st = matchStep(last.round, last.v, T, last.dPhys ?? 0);
    if (st.action !== "next") throw new Error(`refused: matching.json holds round ${last.round} (${st.action}) but is not final; inspect it by hand`);
    v = st.nextV!;
  }
  for (let round = rec.rounds.length + 1; round <= R2B.MATCH_ROUNDS; round++) {
    const dir = `${root}/match/round-${round}`;
    const digests: Record<number, string> = {};
    const per: Record<number, number | null> = {};
    await pool(MATCH_SEEDS, jobs, async (seed) => {
      // A round interrupted part way resumes: a finished run (series.json present) is read, not run again.
      const done = await readJson<RunFile>(`${dir}/physarum/seed-${seed}/series.json`);
      if (done) {
        if (done.v !== v || done.round !== round) throw new Error(`refused: ${dir}/physarum/seed-${seed} was run with v ${done.v}, round ${done.round}; expected v ${v}, round ${round}`);
        digests[seed] = done.digest; per[seed] = done.cached.values.d;
        return;
      }
      await gate("match", "physarum", seed, R2B.MATCH_STEPS, dir);
      const run = await runOne(device, { phase: "match", arm: "physarum", seed, steps: R2B.MATCH_STEPS, v, dir, logged: true, round, plan });
      digests[seed] = run.digest;
      per[seed] = run.cached.values.d;
    });
    const perSeed = MATCH_SEEDS.map((s) => per[s]);
    const dPhys = perSeed.some((x) => x === null) ? null : median(perSeed as number[]);
    const step_ = matchStep(round, v, T, dPhys ?? 0);
    rec.rounds.push({ round, v, dPhys, perSeed, digests: MATCH_SEEDS.map((s) => digests[s]) });
    console.log(`matching round ${round}: v ${v}, d_phys ${dPhys}, T ${T}, ratio ${step_.ratio}, ${step_.action}`);
    if (step_.action === "next") { v = step_.nextV!; await Deno.writeTextFile(file, JSON.stringify(rec, null, 2) + "\n"); continue; }
    rec.v = step_.action === "limited" ? null : v;
    rec.converged = step_.converged; rec.ratio = step_.ratio; rec.limited = step_.action === "limited"; rec.reason = step_.reason; rec.final = true;
    await Deno.writeTextFile(file, JSON.stringify(rec, null, 2) + "\n");
    return;
  }
}

/** CPU re-run of a finished dev or confirmation run: the final digest must equal the stored one (a mismatch is INVALID). */
async function doCpuCheck(root: string, arm: string, seed: number): Promise<void> {
  if (!isArm(arm)) throw new Error(`unknown arm ${arm}`);
  const phase: "dev" | "confirm" = seed >= 5001 ? "confirm" : "dev";
  const dir = `${root}/${phase}/${arm}/seed-${seed}`;
  const run = await readJson<RunFile>(`${dir}/series.json`);
  if (!run) throw new Error(`refused: ${dir}/series.json does not exist; cpu-check re-runs a finished run`);
  await gate("cpu-check", arm, seed, run.steps, `${root}/${phase}`);
  if (await exists(`${dir}/cpu-check.json`)) throw new Error(`refused: ${dir}/cpu-check.json exists; the cross-check is done once`);
  const plan = (await planFromFrozen()) ?? undefined;
  await appendLog({ phase: "cpu-check", arm, seed, steps: run.steps, state: "started", ...(plan ? { plan } : {}) });
  const t0 = performance.now();
  const s = createWorld(run.config);
  for (let t = 1; t <= run.steps; t++) {
    step(s);
    if (t % 10_000 === 0) console.error(`cpu-check ${arm} ${seed}: step ${t}/${run.steps}`);
  }
  const cpuDigest = stateDigest(s);
  const equal = cpuDigest === run.digest;
  await Deno.writeTextFile(`${dir}/cpu-check.json`, JSON.stringify({ arm, seed, steps: run.steps, cpuDigest, gpuDigest: run.digest, equal, codeHash: await codeHash() }, null, 2) + "\n");
  if (!equal) {
    await appendLog({ phase: "cpu-check", arm, seed, steps: run.steps, state: "invalid", cpuDigest, gpuDigest: run.digest, ...(plan ? { plan } : {}) });
    console.error(`INVALID cpu-check ${arm} ${seed}: CPU digest ${cpuDigest} != GPU digest ${run.digest}`);
    throw new InvalidRun("digest mismatch");
  }
  await appendLog({ phase: "cpu-check", arm, seed, steps: run.steps, state: "finished", digest: cpuDigest, wallMs: Math.round(performance.now() - t0), ...(plan ? { plan } : {}) });
  console.log(`cpu-check ${arm} seed ${seed}: ${run.steps} steps, CPU digest equals GPU digest ${cpuDigest}`);
}

/** The timing gate (section 3): 8 concurrent smoke runs of 3,000 steps, seeds below 2001, mixed arms; prints the aggregate steps per second and the plan it implies. */
async function doTiming(device: GPUDevice, root: string, jobs: number): Promise<void> {
  const arms: AnyArm[] = ["inherit", "blocked", "physarum", "inherit", "pc-light", "pc-upkeep", "pc-blind", "physarum"];
  const specs: RunSpec[] = arms.map((arm, k) => ({ phase: "smoke", arm, seed: 1 + k, steps: 3000, v: arm === "physarum" ? 256 : undefined, dir: `${root}/smoke-timing`, logged: false, quiet: true, terse: true }));
  const t0 = performance.now();
  await pool(specs, Math.max(jobs, specs.length), async (sp) => { await runOne(device, sp); });
  const sec = (performance.now() - t0) / 1000;
  const rate = (specs.length * 3000) / sec;
  const plan = planForTiming(rate) ?? "NONE (below 1,200: the protocol is not started and is redrafted)";
  console.log(`timing gate: ${specs.length} concurrent smoke runs x 3000 steps in ${sec.toFixed(1)} s = ${rate.toFixed(0)} aggregate steps per second; plan ${plan}`);
}

if (import.meta.main) {
  const a = parseArgs(Deno.args, { string: ["arm", "arms", "seed", "out", "steps", "v", "jobs"], boolean: ["all", "cpu-check"] });
  const [cmd] = a._ as string[];
  const usage = () => { console.error("usage: r2b.ts smoke|timing|dev|match|confirm|cpu-check ... --out <root> (see the header of this file)"); Deno.exit(2); };
  if (!cmd || !a.out) usage();
  const root = a.out as string;
  const jobs = Number(a.jobs ?? 4);
  try {
    if (cmd === "cpu-check") {
      if (!a.arm || a.seed === undefined) usage();
      await doCpuCheck(root, a.arm as string, Number(a.seed));
    } else {
      const device = await myceliumDevice();
      if (cmd === "smoke") {
        if (!a.arm || a.seed === undefined || !isArm(a.arm)) usage();
        const steps = Number(a.steps ?? 3000);
        const problems = gateRun({ phase: "smoke", arm: a.arm as string, seed: Number(a.seed), steps, plan: null }, []);
        if (problems.length) throw new Error(`refused: ${problems.join("; ")}`);
        const v = a.arm === "physarum" ? Number(a.v ?? 256) : undefined;
        await runOne(device, { phase: "smoke", arm: a.arm as AnyArm, seed: Number(a.seed), steps, v, dir: `${root}/smoke`, logged: false, cpuCheck: a["cpu-check"] === true });
      } else if (cmd === "timing") {
        await doTiming(device, root, jobs);
      } else if (cmd === "dev") {
        const arms = a.arms ? (a.arms as string).split(",") : ["inherit", "blocked", "pc-light", "pc-upkeep", "pc-blind"];
        if (!arms.every(isArm)) throw new Error(`unknown arm in ${a.arms}`);
        if (!a.all && (!a.arm || a.seed === undefined)) usage();
        await doBatch(device, "dev", root, arms as AnyArm[], a.all ? null : { arm: a.arm as string, seed: Number(a.seed) }, jobs);
      } else if (cmd === "match") {
        await doMatch(device, root, jobs);
      } else if (cmd === "confirm") {
        if (!a.all) throw new Error("confirm is batch-only: use --all (single confirmation runs are not offered)");
        if (a.arm !== undefined || a.seed !== undefined) throw new Error("--arm and --seed are refused in confirm");
        await doBatch(device, "confirm", root, [], null, jobs);
      } else usage();
    }
  } catch (e) {
    console.error((e as Error).message);
    Deno.exit(1);
  }
}
