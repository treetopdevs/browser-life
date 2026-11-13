// Mycelium rung R2 runner: one (arm, seed) on the CPU reference, 20,000 steps, ledgers checked after every step
// (docs/mycelium-r2-2026-11-13/PROTOCOL.md). Writes <out>/<arm>/seed-<n>/series.json.
//
//   deno run -A --no-lock tools/mycelium/r2.ts --phase smoke   --arm inherit --seed 101 --out <scratch dir> [--steps 1000] [--theta 4]
//   deno run -A --no-lock tools/mycelium/r2.ts --phase pass1   --arm inherit --seed 101 --out runs/mycelium-r2/dev-pass1
//   deno run -A --no-lock tools/mycelium/r2.ts --phase dev     --arm physarum --seed 103 --out runs/mycelium-r2/dev --theta <N>
//   deno run -A --no-lock tools/mycelium/r2.ts --phase confirm --all --out runs/mycelium-r2/confirm
//   ... pass1 and dev also take --all (instead of --arm and --seed) to run the whole phase in order, one run at a time.
//   confirm is batch-only: --arm and --seed are refused, nothing about a result is printed, and a crashed batch is
//   resumed by running the same command again (finished pairs are skipped, see PROTOCOL.md section 10).
//
// Phases: smoke (short, any dev-range seed, no freeze needed, never analysed), pass1 (calibration pass 1: the
// five inherit dev runs, which feed theta), dev (calibration pass 2: the four arms and two positive controls on
// seeds 101-105, with --theta from pass 1) and confirm (the four arms on seeds 9001-9005; theta comes from
// CALIBRATION.json, so --theta is refused). pass1, dev and confirm refuse to start unless FROZEN holds the
// hashes of PROTOCOL.md and of every file the code hash covers (r2-freeze.ts; confirm also CALIBRATION.json).
// Seeds of 9001 and above run only in confirm, and every pass1, dev and confirm run is appended to
// docs/mycelium-r2-2026-11-13/seed-log.jsonl. A nonzero ledger residual logs an invalid entry, exits 1, writes
// no series.json, and stops the protocol (the log then refuses every later pass1, dev and confirm run).
import { parseArgs } from "jsr:@std/cli@1/parse-args";
import { createWorld, energyTotal, matterTotal, RULE_ID, stateDigest, step } from "./world.ts";
import { PROTOCOL_WINDOW, R2Observer, smokeWindow } from "./observe.ts";
import { ARMS, armConfig, parseFrozen, checkCalibrationForConfirm, checkCalibrationProvenance, CONTROLS, DEV_SEEDS, gateConfirmBatch, gateRun, isArm, pendingConfirm, type Phase, type SeedLogEntry } from "./r2-protocol.ts";
import { CALIBRATION_PATH, codeHash, readFrozen, SEED_LOG_PATH, verifyFrozen } from "./r2-freeze.ts";

const LOG_PATH = SEED_LOG_PATH;

async function readLog(): Promise<SeedLogEntry[]> {
  try {
    return (await Deno.readTextFile(LOG_PATH)).split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as SeedLogEntry);
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return [];
    throw e;
  }
}

async function appendLog(e: SeedLogEntry & Record<string, unknown>): Promise<void> {
  await Deno.mkdir(LOG_PATH.replace(/\/[^/]+$/, ""), { recursive: true });
  await Deno.writeTextFile(LOG_PATH, JSON.stringify({ ...e, time: new Date().toISOString() }) + "\n", { append: true });
}

/** The arm-seed pairs of a phase, in a fixed order (confirm: only those without a finished entry, so a crashed batch resumes). */
function plan(phase: Phase, log: readonly SeedLogEntry[]): { arm: string; seed: number }[] {
  if (phase === "confirm") return pendingConfirm(log);
  const arms: string[] = phase === "pass1" ? ["inherit"] : [...ARMS, ...CONTROLS];
  const seeds: readonly number[] = DEV_SEEDS;
  return arms.flatMap((arm) => seeds.map((seed) => ({ arm, seed })));
}

async function thetaFromCalibration(): Promise<number> {
  const cal = JSON.parse(await Deno.readTextFile(CALIBRATION_PATH));
  const bad = [...checkCalibrationForConfirm(cal), ...checkCalibrationProvenance(cal, parseFrozen((await readFrozen()) ?? "").keys)];
  if (bad.length) throw new Error(`refused: ${bad.join("; ")}`);
  return cal.theta;
}

async function runOne(phase: Phase, arm: string, seed: number, steps: number, out: string, thetaArg: number | null): Promise<void> {
  if (!isArm(arm)) throw new Error(`unknown arm ${arm}`);
  let seriesExists = false;
  try { await Deno.stat(`${out}/${arm}/seed-${seed}/series.json`); seriesExists = true; } catch (e) { if (!(e instanceof Deno.errors.NotFound)) throw e; }
  const problems = gateRun({ phase, arm, seed, steps, seriesExists }, await readLog());
  if (problems.length) throw new Error(`refused: ${problems.join("; ")}`);
  const frozen = await verifyFrozen(phase);
  if (frozen.length) throw new Error(`refused: ${frozen.join("; ")}`);
  let theta: number | null = thetaArg;
  if (phase === "confirm") theta = await thetaFromCalibration();
  if (phase === "pass1") theta = null;
  if (phase === "dev" && theta === null) throw new Error("refused: dev runs need --theta from calibration pass 1");
  const window = phase === "smoke" ? smokeWindow(steps) : PROTOCOL_WINDOW;

  const logged = phase !== "smoke";
  const code = logged ? await codeHash() : null;
  if (logged) await appendLog({ phase, arm, seed, steps, state: "started" });
  const t0 = performance.now();
  const config = armConfig(arm, seed);
  const s = createWorld(config);
  const obs = new R2Observer(window, theta);
  let checks = 0;
  for (let t = 1; t <= steps; t++) {
    step(s);
    const dm = matterTotal(s) - s.matter0;
    const de = energyTotal(s) - (s.energy0 + s.totals.lightIn - s.totals.heat);
    checks++;
    if (dm !== 0 || de !== 0) {
      console.error(`ledger residual at step ${s.step} (${arm} ${seed}): matter ${dm}, energy ${de}. The run is invalid; the protocol stops here.`);
      if (logged) await appendLog({ phase, arm, seed, steps, state: "invalid", step: s.step, matter: dm, energy: de });
      Deno.exit(1);
    }
    obs.observe(s);
    // Confirm shows progress only, never a population value (PROTOCOL.md section 10).
    if (t % 2000 === 0) console.error(`${phase} ${arm} ${seed}: step ${t}/${steps}${phase === "confirm" ? "" : ` n=${s.n}`}`);
  }
  const result = obs.finish();
  const run = {
    format: "mycelium-r2-run-1", protocol: "mycelium-r2", ruleId: RULE_ID, phase, smoke: phase === "smoke", arm, seed, steps,
    config: s.config, theta, digest: stateDigest(s), ledgerChecks: checks, ledgerResidual: 0, codeHash: code, result,
  };
  const dir = `${out}/${arm}/seed-${seed}`;
  await Deno.mkdir(dir, { recursive: true });
  await Deno.writeTextFile(`${dir}/series.json.tmp`, JSON.stringify(run));
  await Deno.rename(`${dir}/series.json.tmp`, `${dir}/series.json`);
  const wallMs = Math.round(performance.now() - t0);
  if (logged) await appendLog({ phase, arm, seed, steps, state: "finished", digest: run.digest, wallMs });
  const r = result.readouts;
  const head = `${phase} ${arm} seed ${seed}: ${steps} steps, ${checks} ledger checks at residual 0, digest ${run.digest}, ${wallMs} ms`;
  // A fresh-seed result is not shown before the whole batch is in: confirm prints no population or readout values.
  if (phase === "confirm") console.log(head);
  else console.log(`${head}, n(end) ${result.descriptive.nAtEnd}, guard ${result.guard.tripped ? "TRIPPED" : "ok"} (min n ${result.guard.minN}), R1 ${r.R1} R2 ${r.R2} R3 ${r.R3} R4 ${r.R4}`);
}

if (import.meta.main) {
  const a = parseArgs(Deno.args, { string: ["phase", "arm", "seed", "out", "steps", "theta"], boolean: ["all"] });
  const phase = a.phase as Phase | undefined;
  if (!phase || !["smoke", "pass1", "dev", "confirm"].includes(phase) || !a.out) {
    console.error("usage: r2.ts --phase smoke|pass1|dev (--arm A --seed N | --all) --out DIR | --phase confirm --all --out DIR [--steps N (smoke)] [--theta N (smoke, dev)]");
    Deno.exit(2);
  }
  if (a.steps !== undefined && phase !== "smoke") { console.error("--steps is for smoke runs only; the protocol length is fixed"); Deno.exit(2); }
  if (a.theta !== undefined && (phase === "confirm" || phase === "pass1")) { console.error(`--theta is refused in ${phase}`); Deno.exit(2); }
  if (phase === "smoke" && a.all) { console.error("--all is not available for smoke"); Deno.exit(2); }
  if (phase === "confirm" && !a.all) { console.error("confirm is batch-only: use --all (single fresh-seed runs are not offered)"); Deno.exit(2); }
  if (phase === "confirm" && (a.arm !== undefined || a.seed !== undefined)) { console.error("--arm and --seed are refused in confirm"); Deno.exit(2); }
  const steps = phase === "smoke" ? Number(a.steps ?? 1000) : PROTOCOL_WINDOW.steps;
  const theta = a.theta === undefined ? null : Number(a.theta);
  try {
    if (a.all) {
      const log = await readLog();
      if (phase === "confirm") {
        const bad = gateConfirmBatch(log);
        if (bad.length) throw new Error(`refused: ${bad.join("; ")}`);
      }
      const todo = plan(phase, log);
      if (todo.length === 0) console.log(`${phase}: every run in the seed log is already finished`);
      for (const p of todo) await runOne(phase, p.arm, p.seed, steps, a.out, theta);
    } else {
      if (!a.arm || a.seed === undefined) throw new Error("give --arm and --seed, or --all");
      await runOne(phase, a.arm, Number(a.seed), steps, a.out, theta);
    }
  } catch (e) {
    console.error((e as Error).message);
    Deno.exit(1);
  }
}
