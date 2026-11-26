/**
 * Historical-opponents assay, first rung (assay sensitivity). CPU only (sim-ref). Run with Node 24 (relative imports only;
 * @bl/* is resolved by the hook in boot.ts, which each worker also registers):
 *   node tools/opponents/assay.ts --write [--jobs N]      write evidence.json and manifest.json (once, deliberately; --force rewrites)
 *   node tools/opponents/assay.ts --check                 validate the saved artifacts and recompute every summary and gate, no simulation
 *   node tools/opponents/assay.ts --replay-check [--jobs N]   regenerate the payload and require byte equality
 *   node tools/opponents/assay.ts --calibrate [--out DIR] [--jobs N]   bounded predeclared grid on seeds 1..3 (scratch dir only)
 *   node tools/opponents/assay.ts --mini --print          tiny config to stdout (tests)
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir, arch, platform } from "node:os";
import { Worker } from "node:worker_threads";
import { fileURLToPath, pathToFileURL } from "node:url";
import { registerAliases, REPO } from "./boot.ts";
import {
  buildPayload, canonical, expectedMeta, recompute, LIMITS, SALT_NOTE, schedule, sealPayload, sha256, verifySeal, twinOf, STATEMENTS,
  type AssayConfig, type JobSpec, type Payload, type RunRec,
} from "../../packages/metrics/src/opponents/evidence.ts";
import type { ArenaParams, Job, JobResult } from "../../packages/metrics/src/opponents/arena.ts";

export { REPO };
export const OUT_DIR = `${REPO}docs/historical-opponents-2026-11-01/`;
export const EVIDENCE = `${OUT_DIR}evidence.json`;
export const MANIFEST = `${OUT_DIR}manifest.json`;
export const CALIBRATION = `${OUT_DIR}calibration.json`;
export const BASE_COMMIT = "67fdd025";

/** Frozen by calibration.json before the first evidence run. Changing any value invalidates the evidence (check compares it). */
export const CONFIG: AssayConfig = JSON.parse(readFileSync(`${REPO}tools/opponents/config.json`, "utf8"));
/** Tiny configuration for tests: two genotypes, two seeds, short. */
export const MINI: AssayConfig = {
  arena: { tile: 32, radius: 3, steps: 60 }, depletion: null, weakenPercent: 50, ids: ["G", "W"], seeds: [101, 102], rareSeeds: [101, 102], rarePositions: 1, twinG: true, effectTarget: 0.1,
};

registerAliases();

// Frozen inputs the saved evidence is checked against: rebuilt here from current sources, never trusted from the file.
const { buildPanel } = await import("../../packages/metrics/src/opponents/panel.ts");
const { checkpointSteps, PLANT, FLOOR_DIV: ARENA_FLOOR_DIV, buildContestWorld, stepZero } = await import("../../packages/metrics/src/opponents/arena.ts");
const { RULE_VERSION } = await import("../../packages/schema/src/config.ts");
const { FLOOR_DIV: PAYOFF_FLOOR_DIV } = await import("../../packages/metrics/src/opponents/payoff.ts");

/** The panel block and metadata the evidence must carry for `cfg`, from current sources. */
export function expectedFrozen(cfg: AssayConfig) {
  const P = buildPanel(cfg.weakenPercent);
  const panel = { founderSet: P.founderSet, founderIndices: P.founderIndices, hex: { ...P.hex, [twinOf("G")]: P.hex.G } as Record<string, string>, distances: P.distances, weakenPercent: P.weakenPercent };
  return { panel, ...expectedMeta(cfg, checkpointSteps(cfg.arena.steps), { ...PLANT }, RULE_VERSION) };
}

function paramsOf(cfg: AssayConfig, depletion: boolean): ArenaParams {
  return { ...cfg.arena, override: depletion && cfg.depletion ? (cfg.depletion.override as ArenaParams["override"]) : undefined };
}

async function panelFor(cfg: AssayConfig) {
  return buildPanel(cfg.weakenPercent);
}

/** Runs jobs on `nWorkers` worker threads (0 or 1 = in this thread). Output order is the job order, independent of worker count. */
export async function runJobs(cfg: AssayConfig, jobs: JobSpec[], hex: Record<string, string>, nWorkers: number): Promise<RunRec[]> {
  const toJob = (j: JobSpec): Job => ({ key: j.key, seed: j.seed, hexA: hex[j.a.replace(/'$/, "")], hexB: j.b === null ? null : hex[j.b.replace(/'$/, "")], slotsA: j.slotsA, slotsB: j.slotsB });
  const rec = (r: JobResult): RunRec => ({ key: r.key, b0: [r.b0A, r.b0B], e0: [r.e0A, r.e0B], cp: r.cp.map((c) => [c.bA, c.bB, c.cellsA, c.cellsB]) });
  if (nWorkers <= 1) {
    const { runJob } = await import("../../packages/metrics/src/opponents/arena.ts");
    return jobs.map((j) => rec(runJob(toJob(j), paramsOf(cfg, j.depletion))));
  }
  const out: RunRec[] = new Array(jobs.length);
  let next = 0, done = 0;
  await new Promise<void>((resolve, reject) => {
    const workers: Worker[] = [];
    const finish = (err?: Error) => { for (const w of workers) void w.terminate(); err ? reject(err) : resolve(); };
    const feed = (w: Worker) => {
      if (next >= jobs.length) return;
      const id = next++;
      w.postMessage({ id, job: toJob(jobs[id]), params: paramsOf(cfg, jobs[id].depletion) });
    };
    for (let k = 0; k < Math.min(nWorkers, jobs.length); k++) {
      const w = new Worker(new URL("./worker.ts", import.meta.url));
      workers.push(w);
      w.on("error", finish);
      w.on("message", (m: { ready?: boolean; id?: number; result?: JobResult; error?: string }) => {
        if (m.ready) return feed(w);
        if (m.error) return finish(new Error(m.error));
        out[m.id!] = rec(m.result!);
        if (++done === jobs.length) return finish();
        feed(w);
      });
    }
  });
  return out;
}

export async function generate(cfg: AssayConfig = CONFIG, nWorkers = 4): Promise<Payload> {
  const P = await panelFor(cfg);
  const jobs = schedule(cfg);
  const runs = await runJobs(cfg, jobs, P.hex, nWorkers);
  const panel = { founderSet: P.founderSet, founderIndices: P.founderIndices, hex: { ...P.hex, [twinOf("G")]: P.hex.G } as Record<string, string>, distances: P.distances, weakenPercent: P.weakenPercent };
  return sealPayload(buildPayload(cfg, runs, panel, checkpointSteps(cfg.arena.steps), { ...PLANT }, RULE_VERSION));
}

export const serialize = (p: unknown): string => `${JSON.stringify(p, null, 1)}\n`;

const SOURCE_DIRS = ["packages/metrics/src/opponents/", "packages/schema/src/", "packages/sim-ref/src/"];
const EXTRA_SOURCES = ["packages/metrics/src/stats.ts", "tools/opponents/assay.ts", "tools/opponents/worker.ts", "tools/opponents/boot.ts", "tools/opponents/calibrate.ts", "tools/opponents/config.json"];
export function sourceFiles(root = REPO): string[] {
  const dirs = SOURCE_DIRS.flatMap((d) => (existsSync(root + d) ? readdirSync(root + d).filter((f) => f.endsWith(".ts")).sort().map((f) => d + f) : []));
  return [...dirs, ...EXTRA_SOURCES];
}
const sourceHashes = (): Record<string, string> => Object.fromEntries(sourceFiles().map((f) => [f, sha256(readFileSync(REPO + f))]));

export function makeManifest(payload: Payload, evidenceText: string, wallSeconds?: number): Record<string, unknown> {
  return {
    kind: "historical-opponents-assay-manifest",
    payloadFileSha256: sha256(evidenceText),
    integritySha256: payload.integritySha256,
    config: payload.config,
    constants: payload.constants,
    schedule: payload.schedule,
    verdict: payload.verdict,
    calibrationSha256: existsSync(CALIBRATION) ? sha256(readFileSync(CALIBRATION)) : null,
    sources: sourceHashes(),
    provenance: { note: "not replayed; excluded from the deterministic payload", baseCommit: BASE_COMMIT, node: process.version, platform: `${platform()}-${arch()}`, generatedAt: new Date().toISOString(), wallSeconds: wallSeconds ?? null },
  };
}

/** Validate saved artifacts without simulating. Returns problems (empty when sound). */
export function checkSaved(evidencePath = EVIDENCE, manifestPath = MANIFEST, root = REPO, calibrationPath = CALIBRATION): string[] {
  const problems: string[] = [];
  if (!existsSync(evidencePath) || !existsSync(manifestPath)) return ["evidence.json or manifest.json is missing"];
  const text = readFileSync(evidencePath, "utf8");
  const payload = JSON.parse(text) as Payload;
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (!verifySeal(payload)) problems.push("integritySha256 does not match the payload");
  if (manifest.payloadFileSha256 !== sha256(text)) problems.push("manifest payloadFileSha256 does not match evidence.json");
  if (manifest.integritySha256 !== payload.integritySha256) problems.push("manifest seal differs from the payload seal");
  if (canonical(manifest.config) !== canonical(payload.config)) problems.push("manifest config differs from the payload");
  if (manifest.verdict !== payload.verdict) problems.push("manifest verdict differs from the payload");
  if (canonical(payload.config) !== canonical(CONFIG)) problems.push("payload config differs from the frozen config in tools/opponents/config.json");
  if (JSON.stringify(payload.statements) !== JSON.stringify(STATEMENTS)) problems.push("statements differ");
  if (!existsSync(calibrationPath)) problems.push("calibration.json is missing");
  else if (manifest.calibrationSha256 !== sha256(readFileSync(calibrationPath))) problems.push("calibration.json changed since the evidence was written");
  const listed = Object.keys(manifest.sources as Record<string, string>);
  for (const f of sourceFiles(root)) if (!listed.includes(f)) problems.push(`source ${f} is not in the manifest (added since the evidence was written)`);
  for (const [file, hash] of Object.entries(manifest.sources as Record<string, string>)) {
    if (!existsSync(root + file)) problems.push(`source ${file} is missing`);
    else if (sha256(readFileSync(root + file)) !== hash) problems.push(`source ${file} changed since the evidence was written`);
  }
  // metadata reconstructed from the frozen config and current sources, compared with both artifacts
  if (ARENA_FLOOR_DIV !== PAYOFF_FLOOR_DIV) problems.push("arena and payoff extinction-floor constants disagree");
  const fz = expectedFrozen(CONFIG);
  const cmp = (name: string, want: unknown, got: unknown) => { if (canonical(want) !== canonical(got ?? null)) problems.push(`${name} differs from the value reconstructed from the frozen inputs`); };
  cmp("payload panel (genomes, indices, distances)", fz.panel, payload.panel);
  cmp("payload constants (checkpoints, thresholds, plant, rule version)", fz.constants, payload.constants);
  cmp("payload schedule counts", fz.schedule, payload.schedule);
  cmp("manifest constants", fz.constants, manifest.constants);
  cmp("manifest schedule", fz.schedule, manifest.schedule);
  if (payload.kind !== "historical-opponents-assay-evidence" || payload.version !== 1) problems.push("payload kind or version differs");
  if (payload.note !== SALT_NOTE) problems.push("payload note differs");
  if (canonical(payload.limits) !== canonical(LIMITS)) problems.push("payload limits differ");
  problems.push(...recompute(payload));
  problems.push(...checkStepZero(payload, fz.panel.hex));
  return problems;
}

/** Rebuild every run's step-zero world (no simulation step) and compare the stored inventories b0 and e0 with it. */
export function checkStepZero(payload: Payload, hex: Record<string, string>): string[] {
  const out: string[] = [];
  const stored = new Map(payload.runs.map((r) => [r.key, r]));
  for (const j of schedule(payload.config)) {
    const r = stored.get(j.key);
    if (!r || !Array.isArray(r.b0) || !Array.isArray(r.e0)) continue;
    const job: Job = { key: j.key, seed: j.seed, hexA: hex[j.a.replace(/'$/, "")], hexB: j.b === null ? null : hex[j.b.replace(/'$/, "")], slotsA: j.slotsA, slotsB: j.slotsB };
    const p = paramsOf(payload.config, j.depletion);
    const z = stepZero(buildContestWorld(job, p), job, p);
    if (r.b0[0] !== z.b0A || r.b0[1] !== z.b0B || r.e0[0] !== z.e0A || r.e0[1] !== z.e0B) {
      out.push(`${j.key}: stored step-zero inventories differ from the rebuilt world`);
      if (out.length >= 10) break;
    }
  }
  return out;
}

export async function replayCheck(evidencePath = EVIDENCE, nWorkers = 4): Promise<string[]> {
  const fresh = serialize(await generate(CONFIG, nWorkers));
  return fresh === readFileSync(evidencePath, "utf8") ? [] : ["regenerated payload differs from evidence.json"];
}

const arg = (name: string, dflt: string): string => { const i = process.argv.indexOf(name); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt; };

async function main(): Promise<void> {
  const mode = process.argv[2];
  const nWorkers = Number(arg("--jobs", "4"));
  if (mode === "--write") {
    if (existsSync(EVIDENCE) && !process.argv.includes("--force")) throw new Error("evidence.json exists; files are written once. Pass --force to rewrite deliberately.");
    const t0 = Date.now();
    const payload = await generate(CONFIG, nWorkers);
    const text = serialize(payload);
    const manifestText = serialize(makeManifest(payload, text, Math.round((Date.now() - t0) / 1000)));
    writeFileSync(`${EVIDENCE}.tmp`, text);
    writeFileSync(`${MANIFEST}.tmp`, manifestText);
    renameSync(`${EVIDENCE}.tmp`, EVIDENCE);
    renameSync(`${MANIFEST}.tmp`, MANIFEST);
    console.log(`wrote evidence.json (${text.length} bytes) verdict ${payload.verdict} seal ${payload.integritySha256} in ${Math.round((Date.now() - t0) / 1000)} s`);
  } else if (mode === "--check") {
    const problems = checkSaved();
    if (problems.length) { console.error(problems.join("\n")); process.exit(1); }
    console.log("--check ok");
  } else if (mode === "--replay-check") {
    const problems = await replayCheck(EVIDENCE, nWorkers);
    if (problems.length) { console.error(problems.join("\n")); process.exit(1); }
    console.log("--replay-check ok");
  } else if (mode === "--mini" && process.argv.includes("--print")) {
    process.stdout.write(serialize(await generate(MINI, nWorkers)));
  } else if (mode === "--calibrate") {
    const { calibrate } = await import("./calibrate.ts");
    const dir = arg("--out", `${tmpdir()}/opponents-calibration`);
    mkdirSync(dir, { recursive: true });
    await calibrate(dir, nWorkers, runJobs);
  } else {
    console.error("usage: node tools/opponents/assay.ts --write | --check | --replay-check | --calibrate | --mini --print");
    process.exit(2);
  }
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
