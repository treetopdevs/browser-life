// Mycelium rung R4 analysis: calibration (integrity and attainability on dev data) and the confirmation decision
// (docs/mycelium-r4-2026-11-14/PROTOCOL.md sections 6-8).
//
//   deno run -A --no-lock tools/mycelium/r4-analyze.ts calibrate --root runs/mycelium-r4 [--dry-run]   # writes CALIBRATION.json (once); the report goes to stdout
//   deno run -A --no-lock tools/mycelium/r4-analyze.ts confirm   --root runs/mycelium-r4 [--dry-run]   # needs Freeze 2 and a READY calibration; writes RESULT.json
//
// Adapted from r3-analyze.ts. Nothing here calls r2b-decide.ts.
import { parseArgs } from "jsr:@std/cli@1/parse-args";
import { median } from "./r2b-stats.ts";
import {
  dealt, decide, type Decision, type Label, type Margins, marginsOf, planted, type R4RunFile, r4RunFileProblems, type RunReadout,
} from "./r4-decide.ts";
import { calibrationProblems, type CpuCheckFile, cpuCheckProblems, fileHashProblem, logProblems, parseFrozen, R4, type R4Arm, type SeedLogEntry } from "./r4-protocol.ts";
import { R4_ARMS, R4_CONFIRM_SLOTS, R4_DEV_SLOTS } from "./r4-seeds.ts";
import { CALIBRATION_PATH, codeHash, PROTOCOL_PATH, R4_DOC_DIR, readFrozen, SEED_LOG_PATH, sha256Hex, verifyFrozen } from "./r4-freeze.ts";

const RESULT_JSON = `${R4_DOC_DIR}/RESULT.json`;

async function readJson<T>(path: string): Promise<T | null> {
  try { return JSON.parse(await Deno.readTextFile(path)) as T; } catch (e) { if (e instanceof Deno.errors.NotFound) return null; throw e; }
}
async function readLines<T>(path: string): Promise<T[]> {
  try { return (await Deno.readTextFile(path)).split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as T); } catch (e) { if (e instanceof Deno.errors.NotFound) return []; throw e; }
}

const fixed = (x: number | null, k = 4) => (x === null ? "-" : Math.abs(x) >= 1e4 ? x.toFixed(0) : x === 0 ? "0" : Math.abs(x) < 1e-3 ? x.toExponential(2) : x.toFixed(k));

// ---- loading ----------------------------------------------------------------------------------------------------

interface Loaded { runs: RunReadout[]; problems: string[]; fileShas: Record<string, string>; digests: Record<string, string>; files: R4RunFile[] }

/** R4's own runs of a phase (dev or confirm): file hashes against the seed log, run-file checks, code hash against the frozen one. */
async function loadR4(root: string, phase: "dev" | "confirm", slots: readonly number[], code: string, log: SeedLogEntry[]): Promise<Loaded> {
  const out: Loaded = { runs: [], problems: [], fileShas: {}, digests: {}, files: [] };
  for (const arm of R4_ARMS) {
    for (const slot of slots) {
      const path = `${root}/${phase}/${arm}/seed-${slot}/series.json`;
      let bytes: Uint8Array;
      try { bytes = await Deno.readFile(path); } catch { out.problems.push(`${phase} ${arm} ${slot}: series.json is missing`); continue; }
      const sha = await sha256Hex(bytes);
      const hp = fileHashProblem(log, phase, arm, slot, sha);
      if (hp) { out.problems.push(hp); continue; }
      const f = JSON.parse(new TextDecoder().decode(bytes)) as R4RunFile;
      out.problems.push(...r4RunFileProblems(f, { phase, arm, seed: slot, codeHash: code }));
      out.fileShas[`${phase}/${arm}/${slot}`] = sha; out.digests[`${phase}/${arm}/${slot}`] = f.digest;
      out.files.push(f);
      out.runs.push(f.readout);
    }
  }
  return out;
}

/** The cpu-check.json files of finished cpu-checks of a phase, with the run file's digest, for cpuCheckProblems. */
async function cpuChecks(root: string, phase: "dev" | "confirm", log: readonly SeedLogEntry[]): Promise<Record<string, CpuCheckFile | null>> {
  const out: Record<string, CpuCheckFile | null> = {};
  for (const e of log.filter((x) => x.phase === "cpu-check" && x.state === "finished")) {
    const dir = `${root}/${phase}/${e.arm}/seed-${e.seed}`;
    const c = await readJson<CpuCheckFile>(`${dir}/cpu-check.json`);
    const run = await readJson<{ digest?: string }>(`${dir}/series.json`);
    out[`${e.arm}/${e.seed}`] = c ? { ...c, runDigest: run?.digest } : null;
  }
  return out;
}

// ---- reports ---------------------------------------------------------------------------------------------------

function armTable(runs: readonly RunReadout[]): string[] {
  const lines = ["arm        n  kept  med tmL   med n  med d    med ALIGN  med ACUTE  med OCC   med req1  med sat   guard"];
  for (const arm of R4_ARMS) {
    const all = runs.filter((x) => x.arm === arm);
    if (!all.length) continue;
    const k = all.filter((x) => x.tmL >= 10);
    const m = (key: keyof RunReadout, rs: readonly RunReadout[] = k) => (rs.length ? fixed(median(rs.map((x) => x[key] as number)), 3) : "-");
    lines.push(`${arm.padEnd(10)} ${String(all.length).padStart(2)}  ${String(k.length).padStart(3)}  ${fixed(median(all.map((x) => x.tmL)), 2).padStart(8)}  ${m("n", all).padStart(6)}  ${m("d").padStart(6)}  ${m("align").padStart(9)}  ${m("acute").padStart(9)}  ${m("occ").padStart(8)}  ${m("req1").padStart(8)}  ${m("sat").padStart(7)}   ${all.filter((x) => x.guard).length}`);
  }
  return lines;
}

function decisionLines(d: Decision): string[] {
  const L: string[] = [];
  L.push(`runs in the toll state (late trail per particle >= 10): ${R4_ARMS.map((a) => `${a} ${d.counts[a].kept}/${d.counts[a].n}`).join(", ")}`);
  L.push(`gate S (at least 8 in-state runs in inherit, blind, physarum): ${d.gates.S.ok ? "met" : "NOT met: " + d.gates.S.why.join("; ")}`);
  L.push(`fixed margins (0.15 x dev anchor): ALIGN ${fixed(d.margins.align, 4)}, OCC ${fixed(d.margins.occ, 4)}, ACUTE ${fixed(d.margins.acute, 4)}, SENS ${fixed(d.margins.sens, 5)}`);
  if (d.anchor.spanAlign !== null) L.push(`anchor of this dataset (physarum minus blind, in-state): ALIGN span ${fixed(d.anchor.spanAlign, 3)} (delta ${fixed(d.anchor.deltaAlign, 3)}), OCC span ${fixed(d.anchor.spanOcc, 3)} (delta ${fixed(d.anchor.deltaOcc, 3)}), physarum acute effect ${fixed(d.anchor.acute, 3)}, SENS ${fixed(d.anchor.sens, 4)}; gate G: ${d.gates.G.ok ? "met" : "NOT met: " + d.gates.G.why.join("; ")}`);
  for (const e of d.endpoints) L.push(`${e.id.padEnd(5)} shift ${fixed(e.shift, 4)}  95% CI [${fixed(e.ci[0], 4)}, ${fixed(e.ci[1], 4)}]  margin ${fixed(e.margin, 4)}  ${e.delta === null ? "" : `delta ${e.delta >= 0 ? "+" : ""}${e.delta.toFixed(3)}  p ${fixed(e.p, 6)}  Holm ${fixed(e.adjusted, 6)}  ${e.reject ? "rejects" : "keeps"}  `}${e.status}`);
  if (d.endpoints.length) L.push(`floor (inherit in-state medians): req1 ${fixed(d.floor.req1, 3)} (>= 0.8), req2p ${fixed(d.floor.req2p, 3)} (<= 0.1), sat ${fixed(d.floor.sat, 3)} (>= 0.9): ${d.floor.ok ? "met" : "not met"}`);
  L.push(`retention: inherit ${d.retention.inherit}, blind ${d.retention.blind}, Fisher p ${fixed(d.retention.fisherP, 4)}${d.retention.differs ? " (differs)" : ""}`);
  L.push(`match: inherit median d ${fixed(d.match.inheritD, 4)}, physarum ${fixed(d.match.physarumD, 4)}, ratio ${fixed(d.match.ratio, 4)}, within ${R4.MATCH_BAND * 100}%: ${d.match.inBand}`);
  if (d.secondary.length) L.push("secondary lesion contrasts, inherit against blind among in-state runs (descriptive, not in the label): " + d.secondary.map((s) => `${s.id} delta ${fixed(s.deltaVsBlind, 3)} p ${fixed(s.p, 4)}`).join("; "));
  L.push(`guard: ${d.guard.tripped.length} tripped run(s)${d.guard.tripped.length ? `, label without them ${d.guard.labelWithout}` : ""}`);
  L.push(`LABEL ${d.label}  (${d.reasons.join("; ")})`);
  return L;
}

// ---- calibrate -------------------------------------------------------------------------------------------------

const LABELS: Label[] = ["FUNCTIONAL", "TOLL-ONLY", "MINOR-USE", "INCONCLUSIVE"];
type Rates = Record<Label, number>;
const rates = (labels: Label[]): Rates => Object.fromEntries(LABELS.map((l) => [l, labels.filter((x) => x === l).length / labels.length])) as Rates;
const rateLine = (r: Rates) => LABELS.map((l) => `${l} ${r[l].toFixed(2)}`).join(", ");

/** Replicates per scenario, the confirmation sample size and the planted fractions of the anchor's use (section 8). */
export const CAL_REPS = 100;
export const CAL_N = 16;
export const PLANT_LAMBDAS = [0, 0.05, 0.075, 0.1, 0.2, 0.3, 0.5] as const;
/** Calibration runs at the confirmation's bootstrap count and a 100,000-permutation Mann-Whitney Monte Carlo (the synthetic samples have ties; the confirmation's real data do not). */
export const CAL_OPT = { boots: R4.BOOTS, perms: 100_000 };
/** READY thresholds (section 8). */
export const READY = {
  /** FUNCTIONAL rate at lambda 0.5. */
  functionalAtHalf: 0.8,
  /** TOLL-ONLY rate at lambda 0, the explicit joint no-use null. */
  tollOnlyAtZero: 0.8,
  /** FUNCTIONAL rate at lambda 0, and under label permutation. */
  falseFunctionalMax: 0.05,
  /** MINOR-USE rate at the best of lambda 0.05, 0.075, 0.1. */
  minorUseBest: 0.5,
  /** With every endpoint's true value exactly at its own margin: the rate at which an endpoint is called above the margin (USE) or provably below it (EQUIV or SMALL), and the rate of each label. */
  boundaryMax: 0.10,
} as const;
/** Small-sample scenarios (reported, not gated): exactly 8 runs in the toll state in each of inherit, blind and physarum, the boundary of gate S. */
export const SMALL_KEPT = 8;

async function calibrate(root: string, dry: boolean): Promise<void> {
  const problems: string[] = [];
  const frozenProblems = await verifyFrozen("dev");
  if (frozenProblems.length) problems.push(...frozenProblems.map((p) => `freeze: ${p}`));
  const code = await codeHash();
  const log = await readLines<SeedLogEntry>(SEED_LOG_PATH);
  problems.push(...logProblems(log));
  const r4 = await loadR4(root, "dev", R4_DEV_SLOTS, code, log);
  problems.push(...r4.problems);
  for (const arm of R4_ARMS) for (const slot of R4_DEV_SLOTS) if (!log.some((e) => e.phase === "dev" && e.arm === arm && e.seed === slot && e.state === "finished")) problems.push(`dev ${arm} ${slot}: no finished entry in the seed log`);
  if (log.some((e) => e.phase === "confirm")) problems.push("the seed log holds a confirmation entry before calibration");
  problems.push(...cpuCheckProblems("dev", log, code, await cpuChecks(root, "dev", log)));
  const dev = r4.runs;
  const guardTrips = dev.filter((r) => r.guard).map((r) => `${r.arm} ${r.slot}`);
  const lines: string[] = ["R4 calibration (dev data only)", "", ...armTable(dev), ""];

  // The fixed margins: 0.15 times the dev anchor (physarum minus blind, runs in the toll state). They are stored here and read by the confirmation.
  let margins: Margins;
  try { margins = marginsOf(dev); } catch (e) { console.log(lines.join("\n")); throw new Error(`refused: ${(e as Error).message}`); }
  lines.push(`Fixed margins: ALIGN ${fixed(margins.align, 4)}, OCC ${fixed(margins.occ, 4)}, ACUTE ${fixed(margins.acute, 4)}, SENS ${fixed(margins.sens, 5)}`, "");

  // (a) the rules on the real dev data as they are (20 per arm): reported; gates S, G, MATCH and the floor are required for READY (properties of the arms, not of n).
  const real = decide(dev, margins, { boots: R4.BOOTS });
  lines.push("Rules on the real dev data (20 runs per arm; reported; gates S, G, MATCH and the floor are required for READY, the label is not gated):", ...decisionLines(real), "");

  // (b) pools for the synthetic scenarios, resampled at the confirmation size.
  const pool = Object.fromEntries(R4_ARMS.map((a) => [a, dev.filter((r) => r.arm === a)])) as Record<R4Arm, RunReadout[]>;
  // (b1) FUNCTIONAL on real data: the in-state physarum runs also entered as the inherit arm.
  const asInherit = decide([...dev.filter((r) => r.arm !== "inherit"), ...dev.filter((r) => r.arm === "physarum").map((r) => ({ ...r, arm: "inherit" as R4Arm }))], margins, { boots: R4.BOOTS });
  lines.push("Attainability of FUNCTIONAL on real data (the physarum runs also entered as the inherit arm):", ...decisionLines(asInherit), "");

  // (b2) graded planting: inherit = (real inherit retention, floor, life history) with ALIGN, OCC = blind + lambda (physarum - blind) and ACUTE, SENS = a blocked run's value + lambda physarum's. lambda 0 is the joint no-use null.
  const plantRates: Record<string, Rates> = {}, smallRates: Record<string, Rates> = {};
  lines.push(`Planted use (n = ${CAL_N} per arm resampled from the dev pools, ${CAL_REPS} replicates, ${CAL_OPT.boots} bootstraps, ${CAL_OPT.perms} permutations), fixed margins`);
  for (const lambda of PLANT_LAMBDAS) {
    const labels: Label[] = [];
    for (let rep = 0; rep < CAL_REPS; rep++) labels.push(decide(planted(pool, CAL_N, 0x72340000 + rep, { lambda }), margins, CAL_OPT).label);
    plantRates[String(lambda)] = rates(labels);
    lines.push(`  lambda ${lambda}: ${rateLine(plantRates[String(lambda)])}`);
  }
  // (b3) the boundary: every endpoint's true value exactly at its own fixed margin (f = 1), plus f = 0.5 and 2 for the shape. Per-endpoint status rates and the label rates.
  const IDS = ["ALIGN", "OCC", "ACUTE", "SENS"] as const;
  const boundary: Record<string, { labels: Rates; above: Record<string, number>; below: Record<string, number> }> = {};
  lines.push("Endpoints with their true value at f x their own margin (every endpoint at once; 'above' = the interval is above the margin, 'below' = provably inside it):");
  for (const f of [0, 0.5, 1, 2]) {
    const labels: Label[] = [], above = { ALIGN: 0, OCC: 0, ACUTE: 0, SENS: 0 }, below = { ALIGN: 0, OCC: 0, ACUTE: 0, SENS: 0 };
    for (let rep = 0; rep < CAL_REPS; rep++) {
      const d = decide(planted(pool, CAL_N, 0x72360000 + rep, { atMargin: f, margins }), margins, CAL_OPT);
      labels.push(d.label);
      for (const e of d.endpoints) { if (e.status === "USE") above[e.id]++; if (e.status === "EQUIV" || e.status === "SMALL") below[e.id]++; }
    }
    const frac = (o: Record<string, number>) => Object.fromEntries(IDS.map((id) => [id, o[id] / CAL_REPS]));
    boundary[String(f)] = { labels: rates(labels), above: frac(above), below: frac(below) };
    lines.push(`  f ${f}: ${rateLine(boundary[String(f)].labels)}; above ${IDS.map((id) => `${id} ${boundary[String(f)].above[id].toFixed(2)}`).join(", ")}; below ${IDS.map((id) => `${id} ${boundary[String(f)].below[id].toFixed(2)}`).join(", ")}`);
  }
  lines.push(`Small sample (exactly ${SMALL_KEPT} runs in the toll state in each of inherit, blind and physarum by construction; reported, not gated):`);
  for (const lambda of [0, 0.5]) {
    const labels: Label[] = [];
    for (let rep = 0; rep < CAL_REPS; rep++) labels.push(decide(planted(pool, CAL_N, 0x72350000 + rep, { lambda }, { keptCount: SMALL_KEPT }), margins, CAL_OPT).label);
    smallRates[`lambda ${lambda}`] = rates(labels);
    lines.push(`  lambda ${lambda}: ${rateLine(smallRates[`lambda ${lambda}`])}`);
  }
  const smallBoundary: Record<string, unknown> = {};
  for (const f of [1]) {
    const labels: Label[] = [], above = { ALIGN: 0, OCC: 0, ACUTE: 0, SENS: 0 }, below = { ALIGN: 0, OCC: 0, ACUTE: 0, SENS: 0 };
    for (let rep = 0; rep < CAL_REPS; rep++) {
      const d = decide(planted(pool, CAL_N, 0x72370000 + rep, { atMargin: f, margins }, { keptCount: SMALL_KEPT }), margins, CAL_OPT);
      labels.push(d.label);
      for (const e of d.endpoints) { if (e.status === "USE") above[e.id]++; if (e.status === "EQUIV" || e.status === "SMALL") below[e.id]++; }
    }
    smallRates[`f ${f}`] = rates(labels);
    smallBoundary[`f ${f}`] = { above: Object.fromEntries(IDS.map((id) => [id, above[id] / CAL_REPS])), below: Object.fromEntries(IDS.map((id) => [id, below[id] / CAL_REPS])) };
    lines.push(`  every endpoint at the margin (f ${f}): ${rateLine(smallRates[`f ${f}`])}; above ${IDS.map((id) => `${id} ${(above[id] / CAL_REPS).toFixed(2)}`).join(", ")}; below ${IDS.map((id) => `${id} ${(below[id] / CAL_REPS).toFixed(2)}`).join(", ")}`);
  }
  // (b4) label permutation: U1 and U2 only (inherit's own ACUTE and SENS travel with the runs, so this is not a joint null).
  const permLabels: Label[] = [];
  for (let rep = 0; rep < CAL_REPS; rep++) permLabels.push(decide(dealt(pool, CAL_N, 0x72346e00 + rep), margins, CAL_OPT).label);
  const permRates = rates(permLabels);
  lines.push("", `Label permutation (inherit and blind dev readouts pooled and dealt at random, n = ${CAL_N}, ${CAL_REPS} deals; checks U1 and U2 only): ${rateLine(permRates)}`);

  const reasons: string[] = [];
  if (problems.length) reasons.push(`integrity: ${problems.length} problem(s), first: ${problems[0]}`);
  if (!real.gates.S.ok) reasons.push(`gate S fails on the dev data: ${real.gates.S.why.join("; ")}`);
  else if (!real.gates.G.ok) reasons.push(`gate G fails on the dev data: ${real.gates.G.why.join("; ")}`);
  if (real.match.inBand !== true) reasons.push(`MATCH fails on the dev data: the physarum null's realised late d is ${real.match.physarumD} against inherit's ${real.match.inheritD} (band +-${R4.MATCH_BAND * 100}%)`);
  if (real.endpoints.length && !real.floor.ok) reasons.push(`the floor does not hold on the dev inherit runs (req1 ${real.floor.req1}, req2p ${real.floor.req2p}, sat ${real.floor.sat}): TOLL-ONLY and MINOR-USE are unreachable`);
  if (asInherit.label !== "FUNCTIONAL") reasons.push(`FUNCTIONAL is not attainable on real data: physarum entered as inherit gives ${asInherit.label}`);
  const pr = (l: number, k: Label) => plantRates[String(l)][k];
  if (pr(0.5, "FUNCTIONAL") < READY.functionalAtHalf) reasons.push(`FUNCTIONAL is not attainable at lambda 0.5: ${pr(0.5, "FUNCTIONAL").toFixed(2)} (needs ${READY.functionalAtHalf})`);
  if (pr(0, "TOLL-ONLY") < READY.tollOnlyAtZero) reasons.push(`TOLL-ONLY is not attainable under the joint no-use null (lambda 0): ${pr(0, "TOLL-ONLY").toFixed(2)} (needs ${READY.tollOnlyAtZero})`);
  if (pr(0, "FUNCTIONAL") > READY.falseFunctionalMax) reasons.push(`the joint no-use null gives FUNCTIONAL ${pr(0, "FUNCTIONAL").toFixed(2)} (limit ${READY.falseFunctionalMax})`);
  const bestMinor = Math.max(...[0.05, 0.075, 0.1].map((l) => pr(l, "MINOR-USE")));
  if (bestMinor < READY.minorUseBest) reasons.push(`MINOR-USE is not attainable: best rate over lambda 0.05, 0.075, 0.1 is ${bestMinor.toFixed(2)} (needs ${READY.minorUseBest})`);
  const at1 = boundary["1"];
  for (const id of IDS) {
    if (at1.above[id] > READY.boundaryMax) reasons.push(`false use at the margin: ${id} is called above its margin in ${at1.above[id].toFixed(2)} of the datasets with its true value exactly at the margin (limit ${READY.boundaryMax})`);
    if (at1.below[id] > READY.boundaryMax) reasons.push(`false equivalence at the margin: ${id} is called provably inside its margin in ${at1.below[id].toFixed(2)} of the datasets with its true value exactly at the margin (limit ${READY.boundaryMax})`);
  }
  for (const l of ["FUNCTIONAL", "TOLL-ONLY", "MINOR-USE"] as Label[]) if (at1.labels[l] > READY.boundaryMax) reasons.push(`${l} in ${at1.labels[l].toFixed(2)} of the datasets with every endpoint exactly at its margin (limit ${READY.boundaryMax})`);
  if (permRates.FUNCTIONAL > READY.falseFunctionalMax) reasons.push(`label permutation gives FUNCTIONAL ${permRates.FUNCTIONAL.toFixed(2)} (limit ${READY.falseFunctionalMax})`);
  const verdict = reasons.length ? "MEASUREMENT-LIMITED" : "READY";
  lines.push("", `integrity problems: ${problems.length}${problems.length ? "\n  " + problems.slice(0, 20).join("\n  ") : ""}`, `guard trips among dev runs: ${guardTrips.length ? guardTrips.join(", ") : "none"}`, `VERDICT ${verdict}${reasons.length ? ` (${reasons.join("; ")})` : ""}`);
  console.log(lines.join("\n"));
  const cal = {
    verdict, reasons, codeHash: code, protocolSha256: await sha256Hex(await Deno.readFile(PROTOCOL_PATH)), problems, guardTrips, margins,
    realDev: real, physarumAsInherit: { label: asInherit.label, endpoints: asInherit.endpoints },
    attainability: { reps: CAL_REPS, n: CAL_N, lambdas: PLANT_LAMBDAS, options: CAL_OPT, planted: plantRates, boundary, smallSample: { kept: SMALL_KEPT, rates: smallRates, boundary: smallBoundary }, labelPermutation: permRates, required: READY },
    runs: dev, fileShas: r4.fileShas, digests: r4.digests,
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
  const cal = await readJson<{ verdict?: string; codeHash?: string; protocolSha256?: string; reasons?: string[]; margins?: Margins }>(CALIBRATION_PATH);
  if (!cal) problems.push("CALIBRATION.json cannot be read");
  else problems.push(...calibrationProblems(cal, parseFrozen((await readFrozen()) ?? "").keys));
  const r4 = await loadR4(root, "confirm", R4_CONFIRM_SLOTS, code, log);
  problems.push(...r4.problems);
  problems.push(...cpuCheckProblems("confirm", log, code, await cpuChecks(root, "confirm", log)));
  const notFinished = R4_ARMS.flatMap((a) => R4_CONFIRM_SLOTS.map((s) => ({ a, s }))).filter(({ a, s }) => !log.some((e) => e.phase === "confirm" && e.arm === a && e.seed === s && e.state === "finished"));
  if (notFinished.length) problems.push(`${notFinished.length} confirmation run(s) have no finished entry in the seed log`);
  const lines: string[] = ["R4 confirmation", ""];
  if (problems.length) {
    lines.push(`INVALID: ${problems.length} problem(s):`, ...problems.slice(0, 30).map((p) => `  ${p}`), "LABEL INVALID");
    console.log(lines.join("\n"));
    if (!dry) await Deno.writeTextFile(RESULT_JSON, JSON.stringify({ label: "INVALID", problems }, null, 2) + "\n");
    Deno.exit(1);
  }
  const d = decide(r4.runs, cal!.margins!);
  lines.push(...armTable(r4.runs), "", ...decisionLines(d));
  console.log(lines.join("\n"));
  if (dry) { console.log("(dry run: RESULT.json not written)"); return; }
  await Deno.writeTextFile(RESULT_JSON, JSON.stringify({ label: d.label, decision: d, runs: r4.runs, fileShas: r4.fileShas, digests: r4.digests, codeHash: code }, null, 2) + "\n");
  console.log(`wrote ${RESULT_JSON}`);
}

if (import.meta.main) {
  const a = parseArgs(Deno.args, { string: ["root"], boolean: ["dry-run"] });
  const [cmd] = a._ as string[];
  if (!cmd || !a.root) { console.error("usage: r4-analyze.ts calibrate|confirm --root <runs/mycelium-r4> [--dry-run]"); Deno.exit(2); }
  try {
    if (cmd === "calibrate") await calibrate(a.root, a["dry-run"] === true);
    else if (cmd === "confirm") await confirm(a.root, a["dry-run"] === true);
    else { console.error(`unknown command ${cmd}`); Deno.exit(2); }
  } catch (e) {
    console.error((e as Error).message);
    Deno.exit(1);
  }
}
