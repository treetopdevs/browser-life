// Mycelium rung R2b analysis (docs/mycelium-r2b-2026-11-13/PROTOCOL.md sections 6, 8, 9). A pure function of the run files under <root>,
// FROZEN and CALIBRATION.json: every run's readouts are recomputed from its stored series and a file whose cached values differ is refused.
//
//   deno run -A --no-lock tools/mycelium/r2b-analyze.ts stage-a   --out <root>   # dev inherit runs -> <root>/stage-a.json (tau, deposit target T), prints
//   deno run -A --no-lock tools/mycelium/r2b-analyze.ts calibrate --out <root> [--dry-run]   # all dev runs + <root>/matching.json -> CALIBRATION.json, prints
//   deno run -A --no-lock tools/mycelium/r2b-analyze.ts confirm   --out <root> [--dry-run]   # confirmation runs + CALIBRATION.json -> PROVISIONAL label, <root>/confirm-provisional.json, report
//   deno run -A --no-lock tools/mycelium/r2b-analyze.ts agree     --out <root> --other <summary.json>   # compares an independent analysis; only on agreement writes confirm-result.json
//
// Calibration order (PROTOCOL.md 6): r2b.ts dev (inherit, blocked, controls) -> stage-a -> r2b.ts match -> r2b.ts dev --arms physarum ->
// r2b.ts cpu-check (inherit and physarum, seed 2001) -> calibrate -> Freeze 2 (r2b-freeze.ts --freeze2). calibrate refuses to rewrite
// CALIBRATION.json once FROZEN holds calibration_sha256. confirm needs the CPU cross-check files of inherit and physarum seed 5001, except
// when the result is already INVALID or MEASUREMENT-LIMITED (an unfinished batch or a known breach is reported, not refused). Every run
// file is checked against the SHA-256 the seed log recorded when the run finished. The label from `confirm` is PROVISIONAL: section 9
// needs a second, independent analysis (another language) whose summary `agree` compares under the tolerance in r2b-decide.ts
// (agreementProblems); that second analysis is NOT built in this repo, confirm-provisional.json holds what it must reproduce.
import { parseArgs } from "jsr:@std/cli@1/parse-args";
import { type AnyArm, ALL_ARMS, armConfig, CONFIRM_ARMS, fileHashProblem, MATCH_SEEDS, type PlanName, PLANS, logProblems, parseFrozen, parseFrozenExtras, R2B, type SeedLogEntry } from "./r2b-protocol.ts";
import { agreementProblems, type Calibration, calibrate, type DecisionSummary, type MatchingRecord, matchingProblems, type RunSet, decide, depositTarget, regimeClassifier, startingDeposit, summaryOf, trailOn } from "./r2b-decide.ts";
import { median } from "./r2b-stats.ts";
import { type R2bSeries, runFileProblems, type RunFileLike, runValues } from "./observe-r2b.ts";
import { calibrationReport, confirmReport } from "./r2b-report.ts";
import { CALIBRATION_PATH, readFrozen, SEED_LOG_PATH, sha256Hex, verifyFrozen, actualHashes } from "./r2b-freeze.ts";

async function readJson<T>(path: string): Promise<T | null> {
  try { return JSON.parse(await Deno.readTextFile(path)) as T; } catch (e) { if (e instanceof Deno.errors.NotFound) return null; throw e; }
}

async function readLog(): Promise<SeedLogEntry[]> {
  try {
    return (await Deno.readTextFile(SEED_LOG_PATH)).split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as SeedLogEntry);
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return [];
    throw e;
  }
}

interface Loaded { runs: RunSet; problems: string[]; missing: string[]; digests: Record<string, string>; fileSha256: Record<string, string> }

/**
 * Reads <dir>/<arm>/seed-<n>/series.json for every (arm, seed), checking each file against what the protocol says it must be, and against
 * the SHA-256 of its bytes that the seed log recorded when the run finished (the census series are otherwise only as trustworthy as the file).
 */
async function loadRuns(dir: string, phase: "dev" | "confirm" | "match", arms: readonly AnyArm[], seeds: readonly number[], vFor: (arm: AnyArm) => number | null, codeHash: string | null, log: readonly SeedLogEntry[], steps: number = R2B.STEPS, round?: number): Promise<Loaded> {
  const out: Loaded = { runs: {}, problems: [], missing: [], digests: {}, fileSha256: {} };
  for (const arm of arms) {
    out.runs[arm] = {};
    for (const seed of seeds) {
      const path = `${dir}/${arm}/seed-${seed}/series.json`;
      let bytes: Uint8Array;
      try { bytes = await Deno.readFile(path); } catch (e) { if (e instanceof Deno.errors.NotFound) { out.missing.push(`${arm} ${seed}`); continue; } throw e; }
      const file = JSON.parse(new TextDecoder().decode(bytes)) as RunFileLike;
      const sha = await sha256Hex(bytes);
      const hashBad = fileHashProblem(log, phase, arm, seed, sha, round);
      if (hashBad) out.problems.push(hashBad);
      const v = vFor(arm);
      out.problems.push(...runFileProblems(file, { phase, arm, seed, steps, config: armConfig(arm, seed, v ?? undefined), codeHash, v, ...(round !== undefined ? { round } : {}) }));
      out.runs[arm]![seed] = file.series as R2bSeries;
      out.digests[`${arm}/${seed}`] = file.digest;
      out.fileSha256[`${phase}${round !== undefined ? `/round-${round}` : ""}/${arm}/seed-${seed}`] = sha;
    }
  }
  return out;
}

async function planOf(): Promise<PlanName> {
  const t = await readFrozen();
  const p = t === null ? null : parseFrozenExtras(t).plan;
  if (p === null) throw new Error("FROZEN does not record the plan");
  return p;
}

async function frozenKeys(): Promise<Record<string, string>> {
  return parseFrozen((await readFrozen()) ?? "").keys;
}

async function stageA(root: string): Promise<void> {
  const frozen = await verifyFrozen("dev");
  if (frozen.length) throw new Error(`refused: ${frozen.join("; ")}`);
  const plan = await planOf();
  const seeds = PLANS[plan].dev;
  const keys = await frozenKeys();
  const l = await loadRuns(`${root}/dev`, "dev", ["inherit"], seeds, () => null, keys.code_hash, await readLog());
  if (l.missing.length || l.problems.length) throw new Error(`refused: ${[...l.missing.map((m) => `missing ${m}`), ...l.problems].join("; ")}`);
  const vals = seeds.map((s) => runValues(l.runs.inherit![s], R2B.LO, R2B.STEPS, null));
  const cl = regimeClassifier(vals.map((v) => v.medianTM ?? 0));
  const target = depositTarget(vals.map((v) => v.d ?? 0), trailOn(cl));
  const rec = {
    plan, devSeeds: seeds, classifier: cl, tau: cl.adequate ? cl.tau : null, T: target.T, source: target.source, limited: target.limited, reason: target.reason,
    medianAll: target.medianAll, v0: target.T === null ? null : startingDeposit(target.T), d: vals.map((v) => v.d), medianTM: vals.map((v) => v.medianTM),
  };
  await Deno.writeTextFile(`${root}/stage-a.json`, JSON.stringify(rec, null, 2) + "\n");
  console.log(`stage A: ${seeds.length} inherit dev seeds, classifier cut ${cl.cut}, tau ${rec.tau}, classes ${cl.nLow}/${cl.nHigh}, share ${cl.share.toFixed(3)}, gap ${cl.gap} vs within-class SD ${cl.withinSd}, ${cl.adequate ? "adequate" : "REG dropped, trail-on fallback not used"}`);
  console.log(`  d per seed ${vals.map((v) => v.d?.toPrecision(4)).join(" ")}`);
  console.log(`  target T ${target.T} (${target.source}), v0 ${rec.v0}${target.reason ? `; ${target.reason}` : ""}`);
}

interface CpuCheck { arm: string; seed: number; equal: boolean; cpuDigest: string; gpuDigest: string; codeHash?: string }

async function cpuChecks(root: string, phase: "dev" | "confirm", seed: number, digests: Record<string, string>, frozenCode?: string): Promise<{ missing: string[]; mismatch: string[] }> {
  const missing: string[] = [], mismatch: string[] = [];
  for (const arm of ["inherit", "physarum"]) {
    const c = await readJson<CpuCheck>(`${root}/${phase}/${arm}/seed-${seed}/cpu-check.json`);
    if (!c) { missing.push(`${arm} ${seed} (run: r2b.ts cpu-check --arm ${arm} --seed ${seed} --out ${root})`); continue; }
    if (!c.equal || c.gpuDigest !== digests[`${arm}/${seed}`]) mismatch.push(`${arm} ${seed}: CPU ${c.cpuDigest} vs GPU ${c.gpuDigest}${c.gpuDigest !== digests[`${arm}/${seed}`] ? " (the stored run's digest is " + digests[`${arm}/${seed}`] + ")" : ""}`);
    if (frozenCode !== undefined && c.codeHash !== frozenCode) mismatch.push(`${arm} ${seed}: the CPU check ran under code ${c.codeHash ?? "(none recorded)"}, FROZEN has ${frozenCode}`);
  }
  return { missing, mismatch };
}

/**
 * Nothing in matching.json is taken on trust: every round's eight series files are loaded and checked like any run file (phase match,
 * the round's v), each seed's d and the median are recomputed from them and must equal the record, the digests must equal the record's,
 * and the record is replayed against the protocol (matchingProblems) with the target T recomputed from the dev inherit runs.
 */
async function verifyMatching(root: string, m: MatchingRecord, T: number | null, codeHash: string | null, log: readonly SeedLogEntry[], fileSha256: Record<string, string>): Promise<string[]> {
  const bad: string[] = [];
  for (const r of m.rounds) {
    const l = await loadRuns(`${root}/match/round-${r.round}`, "match", ["physarum"], MATCH_SEEDS, () => r.v, codeHash, log, R2B.MATCH_STEPS, r.round);
    if (l.missing.length) { bad.push(`round ${r.round}: missing runs ${l.missing.join(", ")}`); continue; }
    Object.assign(fileSha256, l.fileSha256);
    bad.push(...l.problems);
    const d = MATCH_SEEDS.map((s) => runValues(l.runs.physarum![s], R2B.MATCH_LO, R2B.MATCH_STEPS, null).d);
    if (d.some((x) => x === null)) { bad.push(`round ${r.round}: a run has no deposit measure`); continue; }
    if (JSON.stringify(d) !== JSON.stringify(r.perSeed)) bad.push(`round ${r.round}: the per-seed d in matching.json differs from the stored runs`);
    if (median(d as number[]) !== r.dPhys) bad.push(`round ${r.round}: d_phys ${r.dPhys} is not the median of the stored runs (${median(d as number[])})`);
    if (JSON.stringify(MATCH_SEEDS.map((s) => l.digests[`physarum/${s}`])) !== JSON.stringify(r.digests)) bad.push(`round ${r.round}: the run digests differ from matching.json`);
  }
  bad.push(...matchingProblems(m, T));
  return bad;
}

async function calibrateCmd(root: string, dry: boolean): Promise<void> {
  const frozen = await verifyFrozen("dev");
  if (frozen.length) throw new Error(`refused: ${frozen.join("; ")}`);
  const keys = await frozenKeys();
  if (keys.calibration_sha256 !== undefined && !dry) throw new Error("refused: FROZEN already holds calibration_sha256; CALIBRATION.json is not rewritten");
  const plan = await planOf();
  const seeds = PLANS[plan].dev;
  const log = await readLog();
  const logBad = logProblems(log, plan);
  if (logBad.length) throw new Error(`INVALID: ${logBad.join("; ")}`);
  const matching = await readJson<MatchingRecord & { final?: boolean }>(`${root}/matching.json`);
  if (!matching?.final) throw new Error("refused: matching.json is missing or not final (run `r2b.ts match`)");
  const stage = await readJson<{ tau: number | null; T: number | null }>(`${root}/stage-a.json`);
  if (!stage) throw new Error("refused: stage-a.json is missing");
  const v = matching.limited ? null : matching.v;
  const arms = ALL_ARMS.filter((a) => a !== "physarum" || v !== null);
  const l = await loadRuns(`${root}/dev`, "dev", arms, seeds, (arm) => (arm === "physarum" ? v : null), keys.code_hash, log);
  if (l.missing.length) throw new Error(`refused: missing dev runs: ${l.missing.join(", ")}`);
  if (l.problems.length) throw new Error(`refused: ${l.problems.join("; ")}`);
  const cc = await cpuChecks(root, "dev", 2001, l.digests, keys.code_hash);
  if (v !== null && cc.missing.length) throw new Error(`refused: the CPU cross-check of the dev pair is missing: ${cc.missing.join("; ")}`);
  if (cc.mismatch.length) throw new Error(`INVALID: CPU and GPU digests differ: ${cc.mismatch.join("; ")}`);
  const inh = seeds.map((s) => runValues(l.runs.inherit![s], R2B.LO, R2B.STEPS, null));
  const cl = regimeClassifier(inh.map((x) => x.medianTM ?? 0));
  const target = depositTarget(inh.map((x) => x.d ?? 0), trailOn(cl));
  const matchFiles: Record<string, string> = {};
  const mp = await verifyMatching(root, matching, target.T, keys.code_hash, log, matchFiles);
  if (mp.length) throw new Error(`refused: matching.json does not match the stored matching runs: ${mp.join("; ")}`);
  const cal = calibrate({ plan, devSeeds: seeds, runs: l.runs, matching });
  const h = await actualHashes();
  const doc = {
    format: "mycelium-r2b-calibration-2", plan, codeHash: h.code, protocolSha256: h.protocol, devSeeds: seeds, tau: cal.regime.regDropped ? null : cal.regime.classifier.tau,
    regime: cal.regime, T: cal.target.T, target: cal.target, physarum: cal.physarum,
    matching, kept: cal.kept, dropped: cal.dropped, controls: cal.controls, devContrasts: cal.devContrasts, halfAgreement: cal.halfAgreement, halfValues: cal.halfValues, drift: cal.drift,
    miInvalidMedian: cal.miInvalidMedian, guardTrips: cal.guardTrips, verdict: cal.verdict, reasons: cal.reasons, runDigests: l.digests,
    // The SHA-256 of every dev and matching series.json this calibration read, so Freeze 2 binds the dev data too.
    runFileSha256: { ...l.fileSha256, ...matchFiles }, values: cal.values,
  };
  const report = calibrationReport(cal as Calibration, matching);
  console.log(report);
  if (dry) { console.log("dry run: CALIBRATION.json not written"); return; }
  await Deno.writeTextFile(`${root}/calibration-report.txt`, report);
  await Deno.writeTextFile(CALIBRATION_PATH, JSON.stringify(doc, null, 2) + "\n");
  console.log(`wrote ${CALIBRATION_PATH}; next: r2b-freeze.ts --freeze2 appends calibration_sha256 to FROZEN`);
}

/** The whole confirmation analysis: freezes, provenance, run files and their hashes, CPU cross-check, decision. Used by `confirm` and again by `agree`. */
async function analyzeConfirm(root: string): Promise<{ d: ReturnType<typeof decide>; report: string; l: Loaded; plan: PlanName; seeds: readonly number[]; cpuMissing: string[] }> {
  const invalid: string[] = [];
  const hashes = await verifyFrozen("confirm");
  invalid.push(...hashes);
  const keys = await frozenKeys();
  const plan = await planOf();
  const seeds = PLANS[plan].confirm;
  const cal = await readJson<{ codeHash?: string; protocolSha256?: string; plan?: string; tau: number | null; kept: string[]; verdict: string; reasons: string[]; physarum: { v: number | null }; T: number | null; target?: { source?: string } }>(CALIBRATION_PATH);
  if (!cal) throw new Error("refused: CALIBRATION.json does not exist");
  if (cal.codeHash !== keys.code_hash) invalid.push(`CALIBRATION.json was made under code ${cal.codeHash}, FROZEN has ${keys.code_hash}`);
  if (cal.protocolSha256 !== keys.protocol_sha256) invalid.push(`CALIBRATION.json was made under protocol ${cal.protocolSha256}, FROZEN has ${keys.protocol_sha256}`);
  if (cal.plan !== plan) invalid.push(`CALIBRATION.json was made under the ${cal.plan} plan, FROZEN has ${plan}`);
  const log = await readLog();
  invalid.push(...logProblems(log, plan));
  const v = cal.physarum.v;
  const l = await loadRuns(`${root}/confirm`, "confirm", CONFIRM_ARMS, seeds, (arm) => (arm === "physarum" ? v : null), keys.code_hash, log);
  invalid.push(...l.problems);
  const finished = new Set(log.filter((e) => e.phase === "confirm" && e.state === "finished").map((e) => `${e.arm}/${e.seed}`));
  for (const k of Object.keys(l.digests)) if (!finished.has(k)) invalid.push(`${k} has a series.json but no finished entry in the seed log`);
  const cc = await cpuChecks(root, "confirm", seeds[0], l.digests, keys.code_hash);
  invalid.push(...cc.mismatch.map((m) => `GPU-vs-CPU digest mismatch: ${m}`));
  const d = decide({
    seeds, runs: l.runs, kept: cal.kept as never, tau: cal.tau, calibrationVerdict: cal.verdict, calibrationReasons: cal.reasons, invalid, T: cal.T, fallback: cal.target?.source === "trail-on",
  });
  // An unfinished batch (MEASUREMENT-LIMITED) or a known breach (INVALID) is a label, not a refusal; the CPU cross-check is required only
  // before one of the three substantive labels, since only those rest on the runs being what the GPU says they are.
  if (cc.missing.length && d.label !== "INVALID" && d.label !== "MEASUREMENT-LIMITED") throw new Error(`refused: the CPU cross-check is missing (it precedes the analysis of a complete batch): ${cc.missing.join("; ")}`);
  return { d, report: confirmReport(d, { plan, tau: cal.tau, v }, seeds), l, plan, seeds, cpuMissing: cc.missing };
}

async function removeIfExists(path: string): Promise<void> {
  try { await Deno.remove(path); } catch (e) { if (!(e instanceof Deno.errors.NotFound)) throw e; }
}

async function confirmCmd(root: string, dry: boolean): Promise<void> {
  // Whatever happens next (a refusal, a malformed file), an earlier agreement and final result are stale the moment confirm runs again: removed first.
  if (!dry) { await removeIfExists(`${root}/confirm-result.json`); await removeIfExists(`${root}/confirm-agreement.json`); }
  const { d, report, l } = await analyzeConfirm(root);
  console.log(report);
  console.log(`PROVISIONAL: section 9 needs an independent analysis; compare it with \`r2b-analyze.ts agree\` before this label is written to confirm-result.json`);
  if (dry) { console.log("dry run: nothing written"); return; }
  await Deno.writeTextFile(`${root}/confirm-provisional.json`, JSON.stringify({ provisional: true, summary: summaryOf(d), subcases: d.subcases, reasons: d.reasons, decision: d, digests: l.digests, fileSha256: l.fileSha256, missing: l.missing }, null, 2) + "\n");
  await Deno.writeTextFile(`${root}/confirm-report.txt`, report);
  console.log(`wrote ${root}/confirm-provisional.json and confirm-report.txt`);
}

/**
 * Compares the independent analysis's summary with a FRESH analysis of the files as they are now (not the stored provisional file alone: runs,
 * log, freezes and CPU receipts may have changed since `confirm`), which must equal the stored provisional summary. Writes the agreement receipt, and
 * confirm-result.json only on agreement; on disagreement or a stale provisional result an earlier confirm-result.json is removed.
 */
async function agreeCmd(root: string, otherPath: string): Promise<void> {
  await removeIfExists(`${root}/confirm-result.json`); // first: any failure below must not leave an earlier final result looking current
  const provPath = `${root}/confirm-provisional.json`;
  let provBytes: Uint8Array, otherBytes: Uint8Array;
  try { provBytes = await Deno.readFile(provPath); } catch { throw new Error("refused: confirm-provisional.json does not exist (run `confirm` first)"); }
  try { otherBytes = await Deno.readFile(otherPath); } catch { throw new Error(`refused: ${otherPath} does not exist`); }
  const prov = JSON.parse(new TextDecoder().decode(provBytes)) as { summary: DecisionSummary; subcases: string[]; reasons: string[]; digests: Record<string, string> };
  const other = JSON.parse(new TextDecoder().decode(otherBytes)) as DecisionSummary;
  const fresh = await analyzeConfirm(root);
  const stale = JSON.stringify(summaryOf(fresh.d)) !== JSON.stringify(prov.summary) || JSON.stringify(fresh.l.digests) !== JSON.stringify(prov.digests);
  const problems = stale ? ["the provisional result is stale: a fresh analysis of the files now gives a different summary or run digests (run `confirm` again)"] : agreementProblems(prov.summary, other);
  const receipt = { format: "mycelium-r2b-agreement-1", agreed: problems.length === 0, problems, label: prov.summary.label, provisionalSha256: await sha256Hex(provBytes), otherSha256: await sha256Hex(otherBytes), otherPath };
  await Deno.writeTextFile(`${root}/confirm-agreement.json`, JSON.stringify(receipt, null, 2) + "\n");
  if (problems.length) { console.error(`no label is written: ${problems.join("; ")}\nSettle the difference (the more conservative label stands until then).`); Deno.exit(1); }
  await Deno.writeTextFile(`${root}/confirm-result.json`, JSON.stringify({ label: prov.summary.label, subcases: prov.subcases, reasons: prov.reasons, summary: prov.summary, agreement: receipt, digests: prov.digests }, null, 2) + "\n");
  console.log(`the two analyses agree; LABEL ${prov.summary.label}${prov.subcases.length ? ` (sub-case ${prov.subcases.join(", ")})` : ""} written to ${root}/confirm-result.json`);
}

if (import.meta.main) {
  const a = parseArgs(Deno.args, { string: ["out", "other"], boolean: ["dry-run"] });
  const [cmd] = a._ as string[];
  if (!cmd || !a.out || !["stage-a", "calibrate", "confirm", "agree"].includes(cmd) || (cmd === "agree" && !a.other)) { console.error("usage: r2b-analyze.ts stage-a|calibrate|confirm --out <root> [--dry-run] | agree --out <root> --other <summary.json>"); Deno.exit(2); }
  try {
    if (cmd === "stage-a") await stageA(a.out);
    else if (cmd === "calibrate") await calibrateCmd(a.out, a["dry-run"] === true);
    else if (cmd === "confirm") await confirmCmd(a.out, a["dry-run"] === true);
    else await agreeCmd(a.out, a.other as string);
  } catch (e) {
    console.error((e as Error).message);
    Deno.exit(1);
  }
}
