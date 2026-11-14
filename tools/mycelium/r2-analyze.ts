// Mycelium rung R2 analysis: pure functions of the series.json files that r2.ts wrote
// (docs/mycelium-r2-2026-11-13/PROTOCOL.md sections 6, 8 and 9). Re-running it gives the same output.
//
//   deno run -A --no-lock tools/mycelium/r2-analyze.ts theta     --pass1 runs/mycelium-r2/dev-pass1
//   deno run -A --no-lock tools/mycelium/r2-analyze.ts calibrate --pass1 runs/mycelium-r2/dev-pass1 --dev runs/mycelium-r2/dev [--out CALIBRATION.json]
//   deno run -A --no-lock tools/mycelium/r2-analyze.ts confirm   --dir runs/mycelium-r2/confirm
//
// theta: the 75th-percentile trail threshold from the five pass-1 inherit runs (printed, and written to
//   <pass1>/theta.json). Dev pass-2 runs take it as --theta.
// calibrate: noise floors, positive controls and the kept readouts from the dev runs; writes CALIBRATION.json
//   (default: docs/mycelium-r2-2026-11-13/CALIBRATION.json) and <dev>/report.md, and prints the numbers.
// confirm: the verdict (PASS, FAIL, NOT-SEPARATED-FROM-PHYSARUM, PARTIAL or MEASUREMENT-LIMITED) with the
//   numbers behind it; writes <dir>/verdict.json and <dir>/report.md. It always reads the CALIBRATION.json
//   that FROZEN hashes (there is no --calibration option).
// Provenance (PROTOCOL.md section 10): every command first verifies FROZEN (Freeze 1 for theta and calibrate,
// Freeze 2 for confirm), so the analysis code itself is hash-checked; every run file must carry FROZEN's code
// hash, and confirm also requires CALIBRATION.json to carry it. Each run file's readouts and guard are
// recomputed from its stored series and must equal the cached values (this checks the averaging, the
// oscillation and the guard; the per-census values themselves are as the observer wrote them).
// Only complete, protocol-length, non-smoke runs of the right phase are read; anything else is an error.
import { parseArgs } from "jsr:@std/cli@1/parse-args";
import { mergeHistograms, R2, READOUT_IDS, type R2Result, thetaFromHistogram } from "./observe.ts";
import { ARMS, type AnyArm, armConfig, type Calibration, calibrate, checkCalibrationForConfirm, checkCalibrationProvenance, checkProvenance, CONFIRM_ARMS, CONTROLS, DEV_SEEDS, decide, type Decision, FRESH_SEEDS, mean, parseFrozen, type Phase, type RunTable } from "./r2-protocol.ts";
import { CALIBRATION_PATH, readFrozen, verifyFrozen } from "./r2-freeze.ts";
import { verifyResult } from "./observe.ts";

interface RunFile {
  format: string; protocol: string; phase: string; smoke: boolean; arm: string; seed: number; steps: number;
  config: unknown; codeHash: string | null;
  theta: number | null; digest: string; ledgerChecks: number; ledgerResidual: number; result: R2Result;
}

/** Stop unless FROZEN holds the hashes this phase needs; returns FROZEN's code_hash. */
async function requireFrozen(phase: Phase): Promise<string> {
  const bad = await verifyFrozen(phase);
  if (bad.length) throw new Error(`refused: ${bad.join("; ")}`);
  return parseFrozen((await readFrozen())!).keys.code_hash;
}

async function loadRun(dir: string, arm: string, seed: number, phase: string): Promise<RunFile> {
  const path = `${dir}/${arm}/seed-${seed}/series.json`;
  let run: RunFile;
  try { run = JSON.parse(await Deno.readTextFile(path)); } catch (e) { throw new Error(`cannot read ${path}: ${(e as Error).message}`); }
  const bad: string[] = [];
  if (run.format !== "mycelium-r2-run-1" || run.protocol !== "mycelium-r2") bad.push("not an R2 run file");
  if (run.smoke) bad.push("a smoke run");
  if (run.phase !== phase) bad.push(`phase ${run.phase}, expected ${phase}`);
  if (run.arm !== arm || run.seed !== seed) bad.push("arm or seed does not match its directory");
  if (run.steps !== R2.STEPS) bad.push(`${run.steps} steps, expected ${R2.STEPS}`);
  if (run.ledgerChecks !== R2.STEPS || run.ledgerResidual !== 0) bad.push("ledger was not checked on every step at residual 0");
  if (JSON.stringify(run.config) !== JSON.stringify(armConfig(arm as AnyArm, seed))) bad.push("config is not the arm's config");
  bad.push(...verifyResult(run.result));
  if (bad.length) throw new Error(`${path}: ${bad.join("; ")}`);
  return run;
}

export async function loadTable(dir: string, arms: readonly string[], seeds: readonly number[], phase: string): Promise<{ table: RunTable; runs: Record<string, Record<number, RunFile>>; hashes: { path: string; codeHash: string | null }[] }> {
  const table: RunTable = {};
  const runs: Record<string, Record<number, RunFile>> = {};
  const hashes: { path: string; codeHash: string | null }[] = [];
  for (const arm of arms) {
    table[arm as AnyArm] = {}; runs[arm] = {};
    for (const seed of seeds) {
      const run = await loadRun(dir, arm, seed, phase);
      runs[arm][seed] = run;
      hashes.push({ path: `${dir}/${arm}/seed-${seed}`, codeHash: run.codeHash });
      table[arm as AnyArm]![seed] = { readouts: run.result.readouts, guardTripped: run.result.guard.tripped };
    }
  }
  return { table, runs, hashes };
}

export async function thetaFromPass1(dir: string): Promise<{ theta: number; hist: number[]; hashes: { path: string; codeHash: string | null }[] }> {
  const hs: number[][] = [];
  const hashes: { path: string; codeHash: string | null }[] = [];
  for (const seed of DEV_SEEDS) {
    const run = await loadRun(dir, "inherit", seed, "pass1");
    hs.push(run.result.pHist);
    hashes.push({ path: `${dir}/inherit/seed-${seed}`, codeHash: run.codeHash });
  }
  const hist = mergeHistograms(hs);
  return { theta: thetaFromHistogram(hist), hist, hashes };
}

const f = (v: number | null | undefined, d = 4): string => (v === null || v === undefined || !Number.isFinite(v) ? "-" : Math.abs(v) >= 1000 ? v.toFixed(0) : v.toFixed(d));

function descriptiveTable(runs: Record<string, Record<number, RunFile>>, arms: readonly string[], seeds: readonly number[]): string {
  const rows = ["| arm | seed | n at burn-in end | n at end | min n in W | refused in W | families | families/n | mean M | mean E | mean age | sum P | crowding | DEPOSIT>0 | EAT>0 | mean abs MX+MY | period | births |", "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|"];
  for (const arm of arms) {
    for (const seed of seeds) {
      const r = runs[arm][seed].result, d = r.descriptive;
      rows.push(`| ${arm} | ${seed} | ${d.nAtBurn} | ${d.nAtEnd} | ${r.guard.minN}${r.guard.tripped ? " TRIP" : ""} | ${d.refusedInW}${d.capTouchedInW ? " CAP" : ""} | ${f(d.families, 1)} | ${f(d.familiesPerN)} | ${f(d.meanM, 2)} | ${f(d.meanE, 1)} | ${f(d.meanAge, 1)} | ${f(d.sumP, 0)} | ${f(d.crowding, 3)} | ${f(d.depositFrac)} | ${f(d.eatFrac)} | ${f(d.moveMean, 2)} | ${d.period ?? "-"} | ${d.births} |`);
    }
  }
  return rows.join("\n");
}

/** Stationarity check (PROTOCOL.md section 4): relative drift of the W mean, second half against first. Reported, gates nothing. */
function driftTable(runs: Record<string, Record<number, RunFile>>, arms: readonly string[], seeds: readonly number[]): string {
  const rows = ["| arm | seed | n | sum P | R1 | R2 |", "|---|---|---|---|---|---|"];
  for (const arm of arms) for (const seed of seeds) {
    const d = runs[arm][seed].result.descriptive.drift;
    rows.push(`| ${arm} | ${seed} | ${f(d.n, 3)} | ${f(d.sumP, 3)} | ${f(d.R1, 3)} | ${f(d.R2, 3)} |`);
  }
  return rows.join("\n");
}

function valuesTable(runs: Record<string, Record<number, RunFile>>, arms: readonly string[], seeds: readonly number[]): string {
  const rows = ["| arm | seed | R1 connectivity | R2 patchiness | R3 oscillation | R4 turnover | n (mean over W) | sum P (mean over W) |", "|---|---|---|---|---|---|---|---|"];
  for (const arm of arms) for (const seed of seeds) {
    const run = runs[arm][seed].result, r = run.readouts;
    rows.push(`| ${arm} | ${seed} | ${f(r.R1)} | ${f(r.R2)} | ${f(r.R3)} | ${f(r.R4)} | ${f(run.descriptive.meanN, 0)} | ${f(run.descriptive.sumP, 0)} |`);
  }
  return rows.join("\n");
}

const DRIFT_NOTE = "Drift columns: (mean over the second half of W - mean over the first half) / mean over W. They show whether an arm was still moving; they gate nothing, and every readout is the mean over W, not a steady state.";

export function calibrationReport(cal: Calibration, runs: Record<string, Record<number, RunFile>>): string {
  const L: string[] = ["# Mycelium R2: calibration report (dev seeds 101-105)", ""];
  L.push(`theta ${cal.theta}. Calibration verdict: ${cal.verdict ?? "usable"}. Code hash ${cal.codeHash}.`, "");
  if (cal.reasons.length) L.push(...cal.reasons.map((r) => `- ${r}`), "");
  L.push("## Noise floors (per contrast: 2 x the larger SD of the two arms compared)", "", "| readout | SD inherit | SD blocked | SD physarum | NF vs blocked | NF vs physarum | dropped |", "|---|---|---|---|---|---|---|");
  for (const id of READOUT_IDS) {
    const s = cal.sd[id], n = cal.nf[id];
    if (s && n) L.push(`| ${id} | ${f(s.inherit)} | ${f(s.blocked)} | ${f(s.physarum)} | ${f(n.blocked)} | ${f(n.physarum)} | ${cal.dropReasons[id] ?? "no"}${cal.unreachableVsPhysarum.includes(id) ? " (physarum floor unreachable)" : ""} |`);
  }
  L.push("", "## Positive controls (paired difference control - inherit, per seed 101-105, against the blocked-contrast NF)", "", "| control | usable | readout | mean d | NF | signs | supporting seeds | sensitive |", "|---|---|---|---|---|---|---|---|");
  for (const c of CONTROLS) {
    for (const id of READOUT_IDS) {
      const e = cal.controls[c].effects[id];
      if (e) L.push(`| ${c} | ${cal.controls[c].usable} | ${id} | ${f(e.D)} | ${f(cal.nf[id]?.blocked)} | ${e.signs.join(" ")} | ${e.agree}/5 | ${e.separates ? "yes" : "no"} |`);
    }
    if (!cal.controls[c].usable) L.push(`| ${c} | false | - | - | - | - | - | - |`);
  }
  L.push("", `Kept readouts: ${cal.kept.join(", ") || "none"}. A kept readout is one that sees a gross physical change (light x2 or trail decay x4); it says nothing about a heredity-sized effect.`, "");
  L.push("## Dev contrasts (informational, changes no decision): the confirmation's test applied to the dev seeds", "", "Read this to see whether the physarum contrast can bind at all. A readout where physarum already differs from inherit by far more than the floor will separate from physarum by construction.", "", "| readout | contrast | mean d (inherit - other) | NF | signs | supporting seeds | separates |", "|---|---|---|---|---|---|---|");
  for (const id of READOUT_IDS) {
    const row = cal.devContrasts[id];
    if (row) for (const o of ["blocked", "physarum"] as const) L.push(`| ${id} | ${o} | ${f(row[o].D)} | ${f(cal.nf[id]![o])} | ${row[o].signs.join(" ")} | ${row[o].agree}/5 | ${row[o].separates ? "yes" : "no"} |`);
  }
  L.push("", "## Values per run", "", valuesTable(runs, [...ARMS, ...CONTROLS], DEV_SEEDS), "", "## Drift", "", DRIFT_NOTE, "", driftTable(runs, [...ARMS, ...CONTROLS], DEV_SEEDS), "", "## Descriptive (never in a decision)", "", descriptiveTable(runs, [...ARMS, ...CONTROLS], DEV_SEEDS), "");
  return L.join("\n");
}

/** Mean over seeds of a per-run descriptive value. */
const armMean = (runs: Record<string, Record<number, RunFile>>, arm: string, seeds: readonly number[], pick: (r: RunFile) => number | null): number | null => {
  const v = seeds.map((s) => pick(runs[arm][s]));
  return v.some((x) => x === null) ? null : mean(v as number[]);
};

export function confirmReport(d: Decision, cal: Calibration, runs: Record<string, Record<number, RunFile>>, table: RunTable): string {
  const L: string[] = ["# Mycelium R2: confirmation report (fresh seeds 9001-9005)", "", `**Verdict: ${d.label}**`, ""];
  if (d.reasons.length) L.push(...d.reasons.map((r) => `- ${r}`), "");
  L.push(`Calibration theta ${cal.theta}; kept readouts ${d.kept.join(", ") || "none"}.`, "");
  if (Object.keys(d.tests).length) {
    L.push("## Effect tests (D = mean over seeds of inherit - other; a seed supports if it has the sign of D and |d| > NF/2)", "", "| readout | contrast | D | NF | per-seed d | supporting seeds | separates |", "|---|---|---|---|---|---|---|");
    for (const id of d.kept) for (const other of ["blocked", "physarum"] as const) {
      const t = d.tests[id]![other];
      L.push(`| ${id} | ${other} | ${f(t.D)} | ${f(t.nf)} | ${t.d.map((v) => f(v, 3)).join(" ")} | ${t.agree}/5 | ${t.separates ? "yes" : "no"} |`);
    }
    L.push("", `Separates from blocked: ${d.sepBlocked.join(", ") || "none"}. From physarum: ${d.sepPhysarum.join(", ") || "none"}. From both: ${d.sepBoth.map((id) => `${id} (${d.ordering[id]})`).join(", ") || "none"}.`);
    L.push("", "Ordering: \"beyond\" means inherit lies on the same side of blocked and physarum, \"between\" means it lies between them. It changes no label. A PASS whose readouts are all \"between\" says inherit differs from both, not that it goes beyond either.", "");
  }
  const seeds = FRESH_SEEDS;
  L.push("## Abundance (read beside every separation)", "", "R1, R2 and R4 are not independent of population size or trail mass, so two separating readouts may be one abundance difference counted twice. Ratios are inherit / other, means over the five seeds.", "", "| other arm | n ratio | sum P ratio | crowding ratio | flag |", "|---|---|---|---|---|");
  for (const o of ["blocked", "physarum", "frozen"]) {
    const ratio = (pick: (r: RunFile) => number | null) => { const a = armMean(runs, "inherit", seeds, pick), b = armMean(runs, o, seeds, pick); return a === null || b === null || b === 0 ? null : a / b; };
    const rn = ratio((r) => r.result.descriptive.meanN), rp = ratio((r) => r.result.descriptive.sumP), rc = ratio((r) => r.result.descriptive.crowding);
    const far = (x: number | null) => x !== null && (x > 1.25 || x < 0.8);
    L.push(`| ${o} | ${f(rn, 3)} | ${f(rp, 3)} | ${f(rc, 3)} | ${far(rn) || far(rp) ? "n or sum P differs by more than 25%" : "within 25%"} |`);
  }
  L.push("", "## Frozen arm (reported only, changes no verdict): inherit - frozen against the blocked-contrast NF", "", "| readout | D | NF | exceeds NF |", "|---|---|---|---|");
  for (const id of d.kept) {
    const a = FRESH_SEEDS.map((s) => table.inherit![s].readouts[id]), b = FRESH_SEEDS.map((s) => table.frozen![s].readouts[id]);
    const nf = cal.nf[id]?.blocked;
    if ([...a, ...b].some((v) => v === null || !Number.isFinite(v))) { L.push(`| ${id} | - | ${f(nf)} | undefined (a frozen or inherit value is missing) |`); continue; }
    const D = mean(a.map((v, k) => (v as number) - (b[k] as number)));
    L.push(`| ${id} | ${f(D)} | ${f(nf)} | ${Math.abs(D) > nf! ? "yes" : "no"} |`);
  }
  L.push("", "## Values per run", "", valuesTable(runs, CONFIRM_ARMS, FRESH_SEEDS), "", "## Drift", "", DRIFT_NOTE, "", driftTable(runs, CONFIRM_ARMS, FRESH_SEEDS), "", "## Descriptive (never in a decision)", "", descriptiveTable(runs, CONFIRM_ARMS, FRESH_SEEDS), "");
  return L.join("\n");
}

async function main(): Promise<void> {
  const cmd = Deno.args[0];
  const a = parseArgs(Deno.args.slice(1), { string: ["pass1", "dev", "dir", "out"] });
  if (cmd === "theta") {
    if (!a.pass1) throw new Error("give --pass1 DIR");
    const code = await requireFrozen("pass1");
    const { theta, hist, hashes } = await thetaFromPass1(a.pass1);
    const prov = checkProvenance(code, undefined, hashes);
    if (prov.length) throw new Error(`refused: ${prov.join("; ")}`);
    await Deno.writeTextFile(`${a.pass1}/theta.json`, JSON.stringify({ theta, hist }, null, 1) + "\n");
    console.log(`theta ${theta}`);
  } else if (cmd === "calibrate") {
    if (!a.pass1 || !a.dev) throw new Error("give --pass1 DIR and --dev DIR");
    const code = await requireFrozen("dev");
    const frozen = parseFrozen((await readFrozen())!).keys;
    const out = a.out ?? CALIBRATION_PATH;
    if (out === CALIBRATION_PATH && frozen.calibration_sha256 !== undefined) throw new Error("refused: FROZEN already holds calibration_sha256 (Freeze 2 is recorded); CALIBRATION.json is never rewritten. A change is an amendment with a new FROZEN and a new calibration.");
    const { theta, hashes: h1 } = await thetaFromPass1(a.pass1);
    const { table, runs, hashes } = await loadTable(a.dev, [...ARMS, ...CONTROLS], DEV_SEEDS, "dev");
    const prov = checkProvenance(code, undefined, [...h1, ...hashes]);
    if (prov.length) throw new Error(`refused: ${prov.join("; ")}`);
    for (const arm of Object.keys(runs)) for (const seed of DEV_SEEDS) {
      if (runs[arm][seed].theta !== theta) throw new Error(`${arm} seed ${seed} ran with theta ${runs[arm][seed].theta}, calibration pass 1 gives ${theta}`);
    }
    const cal: Calibration = { ...calibrate(table, theta), codeHash: code, protocolSha256: frozen.protocol_sha256 };
    await Deno.writeTextFile(out, JSON.stringify(cal, null, 2) + "\n");
    await Deno.writeTextFile(`${a.dev}/report.md`, calibrationReport(cal, runs));
    console.log(`calibration ${cal.verdict ?? "usable"}; theta ${theta}; kept ${cal.kept.join(", ") || "none"}; dropped ${cal.dropped.join(", ") || "none"}`);
    for (const id of READOUT_IDS) if (cal.nf[id] !== undefined) console.log(`  ${id}: NF vs blocked ${f(cal.nf[id]!.blocked)}, vs physarum ${f(cal.nf[id]!.physarum)}${cal.dropReasons[id] ? ` (dropped: ${cal.dropReasons[id]})` : ""}`);
    for (const r of cal.reasons) console.log(`  ${r}`);
    console.log(`wrote ${out} and ${a.dev}/report.md`);
  } else if (cmd === "confirm") {
    if (!a.dir) throw new Error("give --dir DIR");
    const code = await requireFrozen("confirm"); // also proves CALIBRATION.json is the file FROZEN hashes
    const cal = JSON.parse(await Deno.readTextFile(CALIBRATION_PATH)) as Calibration;
    const { table, runs, hashes } = await loadTable(a.dir, CONFIRM_ARMS, FRESH_SEEDS, "confirm");
    const prov = [...checkCalibrationProvenance(cal, parseFrozen((await readFrozen())!).keys), ...checkProvenance(code, undefined, hashes)];
    if (prov.length) throw new Error(`refused: ${prov.join("; ")}`);
    const calBad = checkCalibrationForConfirm(cal);
    if (calBad.length) console.log(`note: ${calBad.join("; ")}`);
    for (const arm of CONFIRM_ARMS) for (const seed of FRESH_SEEDS) {
      if (runs[arm][seed].theta !== cal.theta) throw new Error(`${arm} seed ${seed} ran with theta ${runs[arm][seed].theta}, CALIBRATION.json has ${cal.theta}`);
    }
    const d = decide(table, cal);
    await Deno.writeTextFile(`${a.dir}/verdict.json`, JSON.stringify(d, null, 2) + "\n");
    await Deno.writeTextFile(`${a.dir}/report.md`, confirmReport(d, cal, runs, table));
    console.log(`verdict ${d.label}`);
    for (const r of d.reasons) console.log(`  ${r}`);
    for (const id of d.kept) for (const other of ["blocked", "physarum"] as const) {
      const t = d.tests[id]?.[other];
      if (t) console.log(`  ${id} vs ${other}: D ${f(t.D)}, NF ${f(t.nf)}, supporting seeds ${t.agree}/5, ${t.separates ? "separates" : "does not separate"}`);
    }
    console.log(`  separates from blocked: ${d.sepBlocked.join(", ") || "none"}; physarum: ${d.sepPhysarum.join(", ") || "none"}; both: ${d.sepBoth.map((id) => `${id} (${d.ordering[id]})`).join(", ") || "none"}`);
    console.log(`wrote ${a.dir}/verdict.json and ${a.dir}/report.md`);
  } else {
    throw new Error("usage: r2-analyze.ts theta|calibrate|confirm (see the header comment)");
  }
}

if (import.meta.main) {
  try { await main(); } catch (e) { console.error((e as Error).message); Deno.exit(1); }
}
