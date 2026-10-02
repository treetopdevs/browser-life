// Precision extension of the 2026-09-29 M4 growth calibration (CPU only).
//   plan   --parent <2026-09-29 validation manifest> --out <manifest> --phase precision-extension|precision-engineering
//          --shards <k> --cap <seconds per shard> --forecast <seconds per shard> [--trials <n>, engineering only]
//   run    --manifest <frozen manifest> --out <dir> --shard <i> [--resume] [--max-trials <n>]
//   report --manifest <frozen manifest> --out <dir>
// Each shard is a contiguous block of the frozen schedule with its own append-only
// log and terminal receipts; `report` admits only complete, authenticated shards.
import { parseArgs } from "jsr:@std/cli@1/parse-args";
import { validateResumeReport } from "./lib/m4-calibration-checkpoint.ts";
import {
  checkManifest, decide, ENGINEERING_PHASE, FIXED_SOURCES, MANIFEST_FORMAT, type PrecisionManifest, REPORT_FORMAT,
  runTrial, schedule, shardOf, SOURCE_DIRS, validateShardRows,
} from "./lib/m4-growth-precision.ts";
import { M4_GROWTH_PRECISION_V1 as P } from "../experiments/amendments/m4-growth-precision-v1.ts";

const sha = async (bytes: Uint8Array) =>
  Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource)), (x) => x.toString(16).padStart(2, "0")).join("");
const shaText = (text: string) => sha(new TextEncoder().encode(text));

async function sourceList(): Promise<string[]> {
  const list = [...FIXED_SOURCES];
  for (const dir of SOURCE_DIRS) {
    const names: string[] = [];
    for await (const entry of Deno.readDir(dir)) if (entry.isFile && entry.name.endsWith(".ts")) names.push(`${dir}/${entry.name}`);
    list.push(...names.sort());
  }
  return list;
}
async function verifySources(hashes: Record<string, string>) {
  const required = await sourceList();
  if (required.some((p) => !(p in hashes))) throw new Error("manifest does not bind every current source");
  for (const [path, expected] of Object.entries(hashes)) if (await sha(await Deno.readFile(path)) !== expected) throw new Error(`source drift: ${path}`);
}

export async function plan(o: { parent: string; out: string; phase: string; shards: number; cap: number; forecast: number; trials?: number }) {
  const parentText = await Deno.readTextFile(o.parent);
  const parentSha = await shaText(parentText);
  if (parentSha !== P.parentValidation.manifestSha256) throw new Error("parent validation manifest hash drift");
  const parent = JSON.parse(parentText);
  let identical = true;
  for (const [path, expected] of Object.entries(parent.sourceHashes as Record<string, string>)) {
    if (await sha(await Deno.readFile(path)) !== expected) identical = false;
  }
  const sourceHashes: Record<string, string> = {};
  for (const path of await sourceList()) sourceHashes[path] = await sha(await Deno.readFile(path));
  if (Object.keys(parent.sourceHashes).some((p) => !(p in sourceHashes))) throw new Error("parent source set is not covered");
  const scientific = o.phase === P.phase;
  const m: PrecisionManifest = {
    format: MANIFEST_FORMAT, contract: P.id, phase: o.phase,
    masterSeed: scientific ? P.masterSeed : P.engineeringMaster,
    trials: scientific ? P.trials : (o.trials ?? 2),
    pairs: P.pairs, strata: P.strata.map((s) => ({ ...s })), acceptance: { ...P.acceptance },
    shards: o.shards, capSecondsPerShard: o.cap, forecastSecondsPerShard: o.forecast,
    parentParity: { manifestSha256: parentSha, sources: Object.keys(parent.sourceHashes).length, identical },
    sourceHashes,
  };
  checkManifest(m);
  await Deno.writeTextFile(o.out, JSON.stringify(m, null, 2) + "\n", { createNew: true });
  return m;
}

const shardDir = (out: string, i: number) => `${out}/shard-${i}`;
async function attempts(dir: string): Promise<number[]> {
  const n: number[] = [];
  for await (const entry of Deno.readDir(dir)) {
    const match = /^attempt-(\d+)\.json$/.exec(entry.name);
    if (match) n.push(Number(match[1]));
  }
  n.sort((a, b) => a - b);
  if (n.some((x, i) => x !== i + 1)) throw new Error("attempt receipts are not contiguous");
  return n;
}
const readRows = (log: string) => log.split("\n").filter(Boolean).map((line) => JSON.parse(line));

export async function run(o: { manifest: string; out: string; shard: number; resume?: boolean; maxTrials?: number; log?: (s: string) => void }) {
  const manifestText = await Deno.readTextFile(o.manifest);
  const m: PrecisionManifest = JSON.parse(manifestText);
  checkManifest(m);
  await verifySources(m.sourceHashes);
  const manifestHash = await shaText(manifestText);
  const block = shardOf(schedule(m), m.shards, o.shard);
  const dir = shardDir(o.out, o.shard), logPath = `${dir}/trials.jsonl`;
  const maxTrials = o.maxTrials ?? Infinity;
  let attempt = 1, priorWallSeconds = 0;
  // deno-lint-ignore no-explicit-any
  let rows: any[] = [];
  if (o.resume) {
    if (await Deno.readTextFile(`${dir}/manifest.json`) !== manifestText) throw new Error("resume manifest bytes changed");
    const done = await attempts(dir);
    if (!done.length) throw new Error("resume requires a terminal attempt receipt");
    const log = await Deno.readTextFile(logPath);
    if (log && !log.endsWith("\n")) throw new Error("partial trial log; refuse unauthenticated recovery");
    const previous = JSON.parse(await Deno.readTextFile(`${dir}/attempt-${done.at(-1)}.json`));
    if (previous.attempt !== done.length || previous.shard !== o.shard) throw new Error("attempt identity mismatch");
    priorWallSeconds = validateResumeReport(previous, manifestHash, await shaText(log), m.capSecondsPerShard);
    rows = readRows(log);
    attempt = done.length + 1;
  } else {
    await Deno.mkdir(o.out, { recursive: true });
    await Deno.mkdir(dir);
    await Deno.writeTextFile(`${dir}/manifest.json`, manifestText, { createNew: true });
    await Deno.writeTextFile(logPath, "", { createNew: true });
  }
  validateShardRows(rows, block, m, manifestHash);
  const lockPath = `${dir}/writer.lock`;
  await Deno.writeTextFile(lockPath, JSON.stringify({ pid: Deno.pid, attempt, manifestHash }), { createNew: true });
  await Deno.writeTextFile(`${dir}/runtime-${attempt}.json`, JSON.stringify({ deno: Deno.version, build: Deno.build, startedAt: new Date().toISOString(), attempt, shard: o.shard, priorWallSeconds }, null, 2) + "\n", { createNew: true });
  const start = performance.now();
  const elapsed = () => priorWallSeconds + (performance.now() - start) / 1000;
  const retained = rows.length;
  let newTrials = 0, stopped = false, failure: string | null = null;
  try {
    for (let i = rows.length; i < block.length; i++) {
      if (elapsed() >= m.capSecondsPerShard || newTrials >= maxTrials) { stopped = true; break; }
      await verifySources(m.sourceHashes);
      const begun = performance.now();
      const r = block[i];
      const result = await runTrial(m.phase, m.masterSeed, m.pairs, r, () => {
        if (elapsed() >= m.capSecondsPerShard) throw new Error("CPU budget exhausted inside trial; preserve manifest and partial outputs");
      });
      await verifySources(m.sourceHashes);
      const row = { scenario: r.scenario, preset: r.preset, trial: r.trial, shard: o.shard, manifestHash, ...result, wallSeconds: (performance.now() - begun) / 1000 };
      await Deno.writeTextFile(logPath, JSON.stringify(row) + "\n", { append: true });
      rows.push(row);
      newTrials++;
      if (newTrials % 250 === 0) o.log?.(JSON.stringify({ shard: o.shard, done: rows.length, of: block.length, elapsed: Math.round(elapsed()) }));
    }
  } catch (error) {
    stopped = true;
    failure = String(error);
  }
  if (elapsed() > m.capSecondsPerShard) { stopped = true; failure ??= "CPU wall-time cap exceeded"; }
  const receipt = {
    format: "m4-growth-precision-attempt/v1", phase: m.phase, shard: o.shard, attempt, terminal: true, newTrials,
    retainedTrials: retained, trialLogSha256: await sha(await Deno.readFile(logPath)), manifestHash,
    wallSeconds: (performance.now() - start) / 1000, cumulativeWallSeconds: elapsed(), stopped, failure,
    complete: !failure && rows.length === block.length, blockTrials: block.length,
    finishedAt: new Date().toISOString(),
  };
  await Deno.writeTextFile(`${dir}/attempt-${attempt}.json`, JSON.stringify(receipt, null, 2) + "\n", { createNew: true });
  await Deno.remove(lockPath);
  return receipt;
}

export async function report(o: { manifest: string; out: string }) {
  const manifestText = await Deno.readTextFile(o.manifest);
  const m: PrecisionManifest = JSON.parse(manifestText);
  checkManifest(m);
  await verifySources(m.sourceHashes);
  const manifestHash = await shaText(manifestText);
  const all = schedule(m);
  // deno-lint-ignore no-explicit-any
  const rows: any[] = [];
  const shards = [];
  for (let i = 0; i < m.shards; i++) {
    const dir = shardDir(o.out, i);
    if (await Deno.readTextFile(`${dir}/manifest.json`) !== manifestText) throw new Error(`shard ${i} manifest bytes differ`);
    try {
      await Deno.stat(`${dir}/writer.lock`);
      throw new Error(`shard ${i} has a writer lock`);
    } catch (e) {
      if (!(e instanceof Deno.errors.NotFound)) throw e;
    }
    const done = await attempts(dir);
    if (!done.length) throw new Error(`shard ${i} has no terminal receipt`);
    const last = JSON.parse(await Deno.readTextFile(`${dir}/attempt-${done.at(-1)}.json`));
    const log = await Deno.readTextFile(`${dir}/trials.jsonl`);
    const block = shardOf(all, m.shards, i);
    if (last.terminal !== true || last.complete !== true || last.shard !== i || last.manifestHash !== manifestHash ||
      last.trialLogSha256 !== await shaText(log)) throw new Error(`shard ${i} is not complete and authenticated`);
    const mine = readRows(log);
    validateShardRows(mine, block, m, manifestHash);
    if (mine.length !== block.length) throw new Error(`shard ${i} is incomplete`);
    rows.push(...mine);
    shards.push({ shard: i, attempts: done.length, trials: mine.length, trialLogSha256: last.trialLogSha256, cumulativeWallSeconds: last.cumulativeWallSeconds });
  }
  if (rows.length !== all.length) throw new Error("schedule not covered exactly");
  const decision = decide(m, rows);
  const out = {
    format: REPORT_FORMAT, contract: P.id, phase: m.phase, manifestHash, masterSeed: m.masterSeed, trials: m.trials,
    acceptance: m.acceptance, shards, ...decision,
    scope: "Original endpoint 1 and candidate endpoint 2 on the declared paired endpoint-1 stress null through the production activity path; synthetic calibration, not milestone confirmation. Never concatenated with the 2026-09-29 trials.",
  };
  await Deno.writeTextFile(`${o.out}/report.json`, JSON.stringify(out, null, 2) + "\n", { createNew: true });
  return out;
}

if (import.meta.main) {
  const [command] = Deno.args;
  const a = parseArgs(Deno.args.slice(1), { string: ["parent", "out", "phase", "shards", "cap", "forecast", "trials", "manifest", "shard", "max-trials"], boolean: ["resume"] });
  const int = (v: string | undefined, name: string) => {
    const n = Number(v);
    if (v === undefined || !Number.isSafeInteger(n)) throw new Error(`--${name} must be an integer`);
    return n;
  };
  if (command === "plan") {
    if (!a.parent || !a.out || !a.phase) throw new Error("--parent, --out and --phase required");
    if (a.phase !== P.phase && a.phase !== ENGINEERING_PHASE) throw new Error("unknown phase");
    const m = await plan({ parent: a.parent, out: a.out, phase: a.phase, shards: int(a.shards, "shards"), cap: int(a.cap, "cap"), forecast: int(a.forecast, "forecast"), trials: a.trials === undefined ? undefined : int(a.trials, "trials") });
    console.log(JSON.stringify({ phase: m.phase, trials: m.trials, shards: m.shards, parentParity: m.parentParity, sources: Object.keys(m.sourceHashes).length }));
  } else if (command === "run") {
    if (!a.manifest || !a.out) throw new Error("--manifest and --out required");
    const receipt = await run({ manifest: a.manifest, out: a.out, shard: int(a.shard, "shard"), resume: a.resume, maxTrials: a["max-trials"] === undefined ? undefined : int(a["max-trials"], "max-trials"), log: console.log });
    console.log(JSON.stringify(receipt));
    if (receipt.failure) Deno.exitCode = 1;
  } else if (command === "report") {
    if (!a.manifest || !a.out) throw new Error("--manifest and --out required");
    const r = await report({ manifest: a.manifest, out: a.out });
    console.log(JSON.stringify({ complete: r.complete, precisionPass: r.precisionPass, results: r.results.map(({ preset, n, endpoint1Supported, endpoint1Upper95, endpoint2Supported, endpoint2Upper95, acceptancePass }) => ({ preset, n, endpoint1Supported, endpoint1Upper95, endpoint2Supported, endpoint2Upper95, acceptancePass })) }));
  } else throw new Error("usage: plan | run | report");
}
