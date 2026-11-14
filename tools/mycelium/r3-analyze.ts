// Mycelium rung R3 analysis: calibration (integrity and attainability on dev data) and the confirmation decision
// (docs/mycelium-r3-2026-11-13/PROTOCOL.md sections 6-8).
//
//   deno run -A --no-lock tools/mycelium/r3-analyze.ts calibrate --root runs/mycelium-r3 [--dry-run]   # writes CALIBRATION.json (once) and CALIBRATION.md text on stdout
//   deno run -A --no-lock tools/mycelium/r3-analyze.ts confirm   --root runs/mycelium-r3 [--dry-run]   # needs Freeze 2 and a READY calibration; writes RESULT.json
//
// The dev data are R2b's inherit and blocked series on slots 2001-2020 (read only, by their R2b file hashes) and R3's own dev runs of the five
// new arms on slots 2001-2010. Nothing here calls r2b-decide.ts.
import { parseArgs } from "jsr:@std/cli@1/parse-args";
import { seriesProblems } from "./observe-r2b.ts";
import { armConfig as r2bArmConfig, fileHashProblem as r2bFileHashProblem, type SeedLogEntry as R2bLogEntry } from "./r2b-protocol.ts";
import { median } from "./r2b-stats.ts";
import {
  decide, type Decision, flipLabels, planted, type R3RunFile, r3RunFileProblems, readoutsOfWindows, type RunReadout, shuffleLabels, type TestResult,
} from "./r3-decide.ts";
import { checkCalibrationForConfirm, cpuCheckProblems, fileHashProblem, logProblems, parseFrozen, R3, type R3Arm, type SeedLogEntry } from "./r3-protocol.ts";
import { R2B_REUSED_SLOTS, R3_CONFIRM_ARMS, R3_CONFIRM_SLOTS, R3_DEV_ARMS, R3_DEV_SLOTS } from "./r3-seeds.ts";
import { CALIBRATION_PATH, codeHash, PROTOCOL_PATH, R3_DOC_DIR, readFrozen, REPO, SEED_LOG_PATH, sha256Hex, verifyFrozen } from "./r3-freeze.ts";

const R2B_DIR = `${REPO}/docs/mycelium-r2b-2026-11-13`;
const RESULT_JSON = `${R3_DOC_DIR}/RESULT.json`;

async function readJson<T>(path: string): Promise<T | null> {
  try { return JSON.parse(await Deno.readTextFile(path)) as T; } catch (e) { if (e instanceof Deno.errors.NotFound) return null; throw e; }
}
async function readLines<T>(path: string): Promise<T[]> {
  try { return (await Deno.readTextFile(path)).split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as T); } catch (e) { if (e instanceof Deno.errors.NotFound) return []; throw e; }
}

const fixed = (x: number | null, k = 4) => (x === null ? "-" : Math.abs(x) >= 1e4 ? x.toFixed(0) : x === 0 ? "0" : Math.abs(x) < 1e-3 ? x.toExponential(2) : x.toFixed(k));

// ---- loading ----------------------------------------------------------------------------------------------------

interface Loaded { runs: RunReadout[]; problems: string[]; fileShas: Record<string, string>; digests: Record<string, string> }

/** R2b's dev inherit and blocked series (slots 2001-2020), checked against R2b's own seed log and FROZEN, read-only. */
async function loadR2bDev(): Promise<Loaded> {
  const out: Loaded = { runs: [], problems: [], fileShas: {}, digests: {} };
  const log = await readLines<R2bLogEntry>(`${R2B_DIR}/seed-log.jsonl`);
  const frozen = parseFrozen((await Deno.readTextFile(`${R2B_DIR}/FROZEN`)));
  for (const arm of ["inherit", "blocked"] as const) {
    for (const slot of R2B_REUSED_SLOTS) {
      const path = `${REPO}/runs/mycelium-r2b/dev/${arm}/seed-${slot}/series.json`;
      let bytes: Uint8Array;
      try { bytes = await Deno.readFile(path); } catch { out.problems.push(`R2b dev ${arm} ${slot}: ${path} is missing`); continue; }
      const sha = await sha256Hex(bytes);
      const hp = r2bFileHashProblem(log, "dev", arm, slot, sha);
      if (hp) { out.problems.push(`R2b ${hp}`); continue; }
      const f = JSON.parse(new TextDecoder().decode(bytes));
      const at = `R2b dev ${arm} ${slot}`;
      if (f.format !== "mycelium-r2b-run-1" || f.phase !== "dev" || f.arm !== arm || f.seed !== slot || f.steps !== R3.STEPS) out.problems.push(`${at}: identity`);
      if (f.engine !== "gpu" || f.ledgerResidual !== 0 || f.ledgerChecks !== 1000) out.problems.push(`${at}: engine or ledger`);
      if (JSON.stringify(f.config) !== JSON.stringify(r2bArmConfig(arm, slot))) out.problems.push(`${at}: config is not R2b's arm config`);
      if (f.codeHash !== frozen.keys.code_hash) out.problems.push(`${at}: run under code ${f.codeHash}, R2b FROZEN has ${frozen.keys.code_hash}`);
      const sp = seriesProblems(f.series, R3.STEPS);
      if (sp.length) out.problems.push(`${at}: ${sp[0]}`);
      out.fileShas[`r2b/${arm}/${slot}`] = sha; out.digests[`r2b/${arm}/${slot}`] = f.digest;
      out.runs.push(readoutsOfWindows(arm, slot, f.series, R3.E_LO, R3.E_HI, R3.L_LO, R3.STEPS));
    }
  }
  // The kernel is byte-identical to R2b's: world.ts and gpu.ts hash to the lines of R2b's FROZEN.
  for (const p of ["tools/mycelium/world.ts", "tools/mycelium/gpu.ts"]) {
    const h = await sha256Hex(await Deno.readFile(`${REPO}/${p}`));
    if (frozen.files[p] !== h) out.problems.push(`${p} differs from R2b's FROZEN (${frozen.files[p]} there, ${h} here): R3 must run on the R2b kernel`);
  }
  return out;
}

/** R3's own runs of a phase (dev or confirm): file hashes against the R3 seed log, run-file checks, code hash against the frozen one. */
async function loadR3(root: string, phase: "dev" | "confirm", arms: readonly R3Arm[], slots: readonly number[], code: string, log: SeedLogEntry[]): Promise<Loaded & { files: R3RunFile[] }> {
  const out: Loaded & { files: R3RunFile[] } = { runs: [], problems: [], fileShas: {}, digests: {}, files: [] };
  for (const arm of arms) {
    for (const slot of slots) {
      const path = `${root}/${phase}/${arm}/seed-${slot}/series.json`;
      let bytes: Uint8Array;
      try { bytes = await Deno.readFile(path); } catch { out.problems.push(`${phase} ${arm} ${slot}: series.json is missing`); continue; }
      const sha = await sha256Hex(bytes);
      const hp = fileHashProblem(log, phase, arm, slot, sha);
      if (hp) { out.problems.push(hp); continue; }
      const f = JSON.parse(new TextDecoder().decode(bytes)) as R3RunFile;
      out.problems.push(...r3RunFileProblems(f, { phase, arm, seed: slot, codeHash: code }));
      out.fileShas[`${phase}/${arm}/${slot}`] = sha; out.digests[`${phase}/${arm}/${slot}`] = f.digest;
      out.files.push(f);
      out.runs.push(f.readout);
    }
  }
  return out;
}

/** The cpu-check.json files of finished cpu-checks of a phase, with the run file's digest, for cpuCheckProblems. */
async function cpuChecks(root: string, phase: "dev" | "confirm", log: readonly SeedLogEntry[]): Promise<Record<string, { equal?: boolean; gpuDigest?: string; codeHash?: string; runDigest?: string } | null>> {
  const out: Record<string, { equal?: boolean; gpuDigest?: string; codeHash?: string; runDigest?: string } | null> = {};
  for (const e of log.filter((x) => x.phase === "cpu-check" && x.state === "finished")) {
    const dir = `${root}/${phase}/${e.arm}/seed-${e.seed}`;
    const c = await readJson<{ equal?: boolean; gpuDigest?: string; codeHash?: string }>(`${dir}/cpu-check.json`);
    const run = await readJson<{ digest?: string }>(`${dir}/series.json`);
    out[`${e.arm}/${e.seed}`] = c ? { ...c, runDigest: run?.digest } : null;
  }
  return out;
}

// ---- reports ---------------------------------------------------------------------------------------------------

function armTable(runs: readonly RunReadout[]): string[] {
  const lines = ["arm            n    median dE   median dL   median tmE  median tmL  guard"];
  for (const arm of R3_CONFIRM_ARMS) {
    const r = runs.filter((x) => x.arm === arm);
    if (!r.length) continue;
    lines.push(`${arm.padEnd(14)} ${String(r.length).padStart(2)}   ${fixed(median(r.map((x) => x.dE))).padStart(10)}  ${fixed(median(r.map((x) => x.dL))).padStart(10)}  ${fixed(median(r.map((x) => x.tmE))).padStart(10)}  ${fixed(median(r.map((x) => x.tmL))).padStart(10)}  ${r.filter((x) => x.guard).length}`);
  }
  return lines;
}

function testLines(tests: readonly TestResult[]): string[] {
  return tests.map((t) => `${t.id}  n ${t.n.join("/")}  effect ${t.effect >= 0 ? "+" : ""}${t.effect.toFixed(3)} (floor ${t.floor})  p ${fixed(t.p, 6)}  Holm ${fixed(t.adjusted, 6)}  ${t.reject ? "rejects" : "keeps"}  ${t.verdict}  ${t.what}${t.note ? `  [${t.note}]` : ""}`);
}

function decisionLines(d: Decision): string[] {
  const f = d.frozen;
  return [
    ...testLines(d.tests),
    `C1 trail-mass concordance: Cliff's delta tmL inherit vs blocked ${d.tmConcordance.delta === null ? "-" : d.tmConcordance.delta.toFixed(3)} (needs <= -${R3.TM_CONCORD}): ${d.tmConcordance.ok ? "met" : "not met"}`,
    `D4 frozen (descriptive, not in the label): delta(frozen vs blocked, dL) ${f.deltaVsBlocked === null ? "-" : f.deltaVsBlocked.toFixed(3)} p ${f.pVsBlocked === null ? "-" : fixed(f.pVsBlocked, 6)} -> ${f.reading ?? "no frozen arm"}; delta(inherit vs frozen) ${f.deltaInheritVsFrozen === null ? "-" : f.deltaInheritVsFrozen.toFixed(3)} p ${f.pInheritVsFrozen === null ? "-" : fixed(f.pInheritVsFrozen, 6)}, inherit below frozen: ${f.inheritBelowFrozen}, inherit vs blocked delta ${f.deltaInheritVsBlocked === null ? "-" : f.deltaInheritVsBlocked.toFixed(3)} p ${f.pInheritVsBlocked === null ? "-" : fixed(f.pInheritVsBlocked, 6)}; READING ${f.interpretation ?? "-"}`,
    `guard: ${d.guard.tripped.length} tripped run(s)${d.guard.tripped.length ? `, label without them ${d.guard.labelWithout}` : ""}`,
    `LABEL ${d.label}  (${d.reasons.join("; ")})`,
  ];
}

// ---- calibrate -------------------------------------------------------------------------------------------------

interface Rates { PASS: number; FAIL: number; INCONCLUSIVE: number }
const rates = (labels: string[]): Rates => ({ PASS: labels.filter((l) => l === "PASS").length / labels.length, FAIL: labels.filter((l) => l === "FAIL").length / labels.length, INCONCLUSIVE: labels.filter((l) => l === "INCONCLUSIVE").length / labels.length });

/** The folds of inherit's early deposit per doubling of the cost that the planted datasets use (cost 1 times fold, cost 4 divided by fold), blocked drifting mechanically. */
export const PLANT_FOLDS = [1.5, 2, 3, 4] as const;
export const PLANT_REPS = 100;
/** READY needs this PASS rate at the planted fold below (section 8). */
export const PLANT_FOLD_REQUIRED = 4;
export const PLANT_RATE_REQUIRED = 0.8;
/** The nominal FAIL rate under the null is at most 0.05 (Holm, alpha 0.05); with 100 deals a limit of 0.12 keeps an accidental stop below about 1%. */
export const NULL_FAIL_MAX = 0.12;

async function calibrate(root: string, dry: boolean): Promise<void> {
  const problems: string[] = [];
  const frozenProblems = await verifyFrozen("dev");
  if (frozenProblems.length) problems.push(...frozenProblems.map((p) => `freeze: ${p}`));
  const code = await codeHash();
  const log = await readLines<SeedLogEntry>(SEED_LOG_PATH);
  problems.push(...logProblems(log));
  const r2b = await loadR2bDev();
  const r3 = await loadR3(root, "dev", R3_DEV_ARMS, R3_DEV_SLOTS, code, log);
  problems.push(...r2b.problems, ...r3.problems);
  for (const arm of R3_DEV_ARMS) for (const slot of R3_DEV_SLOTS) if (!log.some((e) => e.phase === "dev" && e.arm === arm && e.seed === slot && e.state === "finished")) problems.push(`dev ${arm} ${slot}: no finished entry in the seed log`);
  if (log.some((e) => e.phase === "confirm")) problems.push("the seed log holds a confirmation entry before calibration");
  problems.push(...cpuCheckProblems("dev", log, code, await cpuChecks(root, "dev", log)));
  const dev = [...r2b.runs, ...r3.runs];
  const guardTrips = dev.filter((r) => r.guard).map((r) => `${r.arm} ${r.slot}`);

  const opt = { perms: 20_000, trendPerms: 20_000 };
  const lines: string[] = [];
  lines.push("R3 calibration (dev data only)", "", ...armTable(dev), "");
  // (a) the rules applied to the dev data as they are (not gated): inherit and blocked at the default cost on slots 2001-2020, the cost arms on 2001-2010.
  const real = decide(dev, { perms: 200_000, trendPerms: 200_000 });
  lines.push("Rules on the real dev data (reported, not a gate; dev sample sizes, 20 + 20 at the default cost and 10 per other arm):", ...decisionLines(real), "");

  // (b) attainability of PASS: planted datasets at n = 16 per arm from the dev pools.
  const inhPool = r2b.runs.filter((r) => r.arm === "inherit"), blkPool = r2b.runs.filter((r) => r.arm === "blocked");
  const plantRates: Record<string, Rates> = {};
  for (const fold of PLANT_FOLDS) {
    const labels: string[] = [];
    for (let rep = 0; rep < PLANT_REPS; rep++) {
      // inherit's early deposit is `fold` times higher at cost 1 and `fold` times lower at cost 4 (a dose response); the blocked arm drifts mechanically with cost in the opposite sense.
      const data = planted(inhPool, blkPool, 16, 0x72330000 + rep, { "inherit-c1": fold, "inherit-c4": 1 / fold, "blocked-c1": 1.2, "blocked-c4": 0.7 });
      labels.push(decide(data, opt).label);
    }
    plantRates[String(fold)] = rates(labels);
  }
  lines.push(`Attainability of PASS (planted dose response, n = 16 per arm resampled from R2b's dev pools, ${PLANT_REPS} replicates, 20,000 permutations):`);
  for (const fold of PLANT_FOLDS) lines.push(`  ${fold}-fold per cost doubling: PASS ${plantRates[String(fold)].PASS.toFixed(2)}, FAIL ${plantRates[String(fold)].FAIL.toFixed(2)}, INCONCLUSIVE ${plantRates[String(fold)].INCONCLUSIVE.toFixed(2)}`);
  // (c) attainability of FAIL: the dev data with the heredity labels swapped.
  const flipped = decide(flipLabels(dev), { perms: 200_000, trendPerms: 200_000 });
  lines.push("", "Attainability of FAIL (dev data with inherit and blocked swapped at every cost):", ...decisionLines(flipped), "");
  // (d) the null: labels dealt at random.
  const nullLabels: string[] = [];
  for (let rep = 0; rep < PLANT_REPS; rep++) nullLabels.push(decide(shuffleLabels(dev, 0x72336e00 + rep), opt).label);
  const nullRates = rates(nullLabels);
  lines.push(`Null (inherit and blocked readouts pooled and dealt back at random at each cost, ${PLANT_REPS} deals): PASS ${nullRates.PASS.toFixed(2)}, FAIL ${nullRates.FAIL.toFixed(2)}, INCONCLUSIVE ${nullRates.INCONCLUSIVE.toFixed(2)}`);

  const reasons: string[] = [];
  if (problems.length) reasons.push(`integrity: ${problems.length} problem(s), first: ${problems[0]}`);
  if (plantRates[String(PLANT_FOLD_REQUIRED)].PASS < PLANT_RATE_REQUIRED) reasons.push(`PASS is not attainable: ${plantRates[String(PLANT_FOLD_REQUIRED)].PASS.toFixed(2)} of planted ${PLANT_FOLD_REQUIRED}-fold datasets pass, ${PLANT_RATE_REQUIRED} required`);
  if (flipped.label !== "FAIL") reasons.push(`FAIL is not attainable: the flipped dev data gives ${flipped.label}`);
  if (nullRates.PASS > 0.05 || nullRates.FAIL > NULL_FAIL_MAX) reasons.push(`the null gives PASS ${nullRates.PASS.toFixed(2)} and FAIL ${nullRates.FAIL.toFixed(2)} (limits 0.05 and ${NULL_FAIL_MAX})`);
  const verdict = reasons.length ? "MEASUREMENT-LIMITED" : "READY";
  lines.push("", `integrity problems: ${problems.length}${problems.length ? "\n  " + problems.slice(0, 20).join("\n  ") : ""}`, `guard trips among dev runs: ${guardTrips.length ? guardTrips.join(", ") : "none"}`, `VERDICT ${verdict}${reasons.length ? ` (${reasons.join("; ")})` : ""}`);
  console.log(lines.join("\n"));
  const cal = {
    verdict, reasons, codeHash: code, protocolSha256: await sha256Hex(await Deno.readFile(PROTOCOL_PATH)), problems, guardTrips,
    realDev: { label: real.label, tests: real.tests, tmConcordance: real.tmConcordance, frozen: real.frozen },
    attainability: { plantFolds: PLANT_FOLDS, reps: PLANT_REPS, requiredFold: PLANT_FOLD_REQUIRED, requiredRate: PLANT_RATE_REQUIRED, planted: plantRates, flipped: { label: flipped.label, tests: flipped.tests }, null: nullRates },
    runs: dev, fileShas: { ...r2b.fileShas, ...r3.fileShas }, digests: { ...r2b.digests, ...r3.digests },
  };
  if (dry) { console.log("(dry run: CALIBRATION.json not written)"); return; }
  if (await readFrozen().then((t) => t !== null && /calibration_sha256/.test(t))) throw new Error("refused: FROZEN already holds calibration_sha256; CALIBRATION.json is not rewritten");
  await Deno.writeTextFile(CALIBRATION_PATH, JSON.stringify(cal, null, 2) + "\n");
  console.log(`wrote ${CALIBRATION_PATH}`);
}

// ---- confirm ---------------------------------------------------------------------------------------------------

async function confirm(root: string, dry: boolean): Promise<void> {
  const problems = await verifyFrozen("confirm");
  const code = await codeHash();
  const log = await readLines<SeedLogEntry>(SEED_LOG_PATH);
  problems.push(...logProblems(log));
  const cal = await readJson<{ verdict?: string; codeHash?: string; protocolSha256?: string; reasons?: string[] }>(CALIBRATION_PATH);
  if (!cal) problems.push("CALIBRATION.json cannot be read");
  else problems.push(...checkCalibrationForConfirm(cal, parseFrozen((await readFrozen()) ?? "").keys));
  const r3 = await loadR3(root, "confirm", R3_CONFIRM_ARMS, R3_CONFIRM_SLOTS, code, log);
  problems.push(...r3.problems);
  problems.push(...cpuCheckProblems("confirm", log, code, await cpuChecks(root, "confirm", log)));
  const notFinished = R3_CONFIRM_ARMS.flatMap((a) => R3_CONFIRM_SLOTS.map((s) => ({ a, s }))).filter(({ a, s }) => !log.some((e) => e.phase === "confirm" && e.arm === a && e.seed === s && e.state === "finished"));
  if (notFinished.length) problems.push(`${notFinished.length} confirmation run(s) have no finished entry in the seed log`);
  const lines: string[] = ["R3 confirmation", ""];
  if (problems.length) {
    lines.push(`INVALID: ${problems.length} problem(s):`, ...problems.slice(0, 30).map((p) => `  ${p}`), "LABEL INVALID");
    console.log(lines.join("\n"));
    if (!dry) await Deno.writeTextFile(RESULT_JSON, JSON.stringify({ label: "INVALID", problems }, null, 2) + "\n");
    Deno.exit(1);
  }
  const d = decide(r3.runs);
  lines.push(...armTable(r3.runs), "", ...decisionLines(d));
  console.log(lines.join("\n"));
  if (dry) { console.log("(dry run: RESULT.json not written)"); return; }
  await Deno.writeTextFile(RESULT_JSON, JSON.stringify({ label: d.label, decision: d, runs: r3.runs, fileShas: r3.fileShas, digests: r3.digests, codeHash: code }, null, 2) + "\n");
  console.log(`wrote ${RESULT_JSON}`);
}

if (import.meta.main) {
  const a = parseArgs(Deno.args, { string: ["root"], boolean: ["dry-run"] });
  const [cmd] = a._ as string[];
  if (!cmd || !a.root) { console.error("usage: r3-analyze.ts calibrate|confirm --root <runs/mycelium-r3> [--dry-run]"); Deno.exit(2); }
  try {
    if (cmd === "calibrate") await calibrate(a.root, a["dry-run"] === true);
    else if (cmd === "confirm") await confirm(a.root, a["dry-run"] === true);
    else { console.error(`unknown command ${cmd}`); Deno.exit(2); }
  } catch (e) {
    console.error((e as Error).message);
    Deno.exit(1);
  }
}
