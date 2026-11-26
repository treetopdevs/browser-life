// Behaviour atlas (idea I01; docs/behaviour-atlas-2026-11-01/PLAN.md and PLAN-2.md).
//
//   deno run -A tools/atlas.ts calibrate --out runs/atlas/calib [--mutants 3]
//   deno run -A tools/atlas.ts compare --out runs/atlas/cmp --histories 1,2 --budget 64
//     [--batch 16] [--random 0.25] [--coverage-seed 1]
//   deno run -A tools/atlas.ts score --out runs/atlas/cmp [--coverage-seed 1]
//
// calibrate evaluates the M3 founder set and --mutants mutants of each under the screening protocol
// with the atlas observer, on the reserved calibration history's seeds, and writes the distribution
// of the two physical descriptors (calibration.json). It informs the atlas bin ranges; it selects
// nothing.
//
// compare runs every implemented arm (random-viable, mass-speed, physical) on each history with the
// M3 founder set as the shared starting pool and --budget screening evaluations per arm, then
// evaluates every selected genome once per held-out assay on held-out seeds, and scores panel v1
// coverage at a matched selection size. Writes manifest.json (versions, settings, seeds, timings),
// histories.json (selections with genomes), ledger-h<history>.jsonl (the physical arm's proposal
// ledger), heldout.jsonl and coverage.json. The embedding arm is recorded as unimplemented. The
// whole schedule is checked against the seed scheme before any evaluation runs.
//
// score re-reads histories.json and heldout.jsonl in --out and rewrites coverage.json under the
// current panel, without a GPU (each history is scored on its own held-out evaluations).
//
// Everything runs on the local WebGPU device; no network, no model calls.
import { parseArgs } from "jsr:@std/cli@1/parse-args";
import { METRICS_VERSION, M3_FOUNDERS, M3_FOUNDER_SET, RULE_VERSION, SCHEMA_VERSION, founderGenome, ringsOf, type Genome } from "@bl/schema";
import { requestDevice } from "@bl/sim-gpu";
import {
  ATLAS_DESCRIPTORS,
  CALIBRATION_HISTORY,
  DEFAULT_ARCHIVE,
  DEFAULT_ATLAS,
  DEFAULT_EVAL,
  PANEL_ASSAYS,
  PANEL_V1,
  PANEL_VERSION,
  SELECTOR_READS,
  atlasGenomeKey,
  atlasObserver,
  checkSchedule,
  compareArms,
  evaluateBatch,
  heldOutEvaluations,
  matchedCoverage,
  mutateGenome,
  panelAssays,
  perBatch,
  screenEvaluator,
  screenSeed,
  summarizeCoverage,
  type ArmHistory,
  type ArmName,
  type BatchFn,
  type Evaluation,
  type GenomeDescriptors,
} from "@bl/search";

const args = parseArgs(Deno.args, { string: ["out", "histories", "budget", "batch", "random", "mutants", "coverage-seed"] });
const cmd = String(args._[0] ?? "");
if (cmd !== "calibrate" && cmd !== "compare" && cmd !== "score") {
  console.error("usage: tools/atlas.ts calibrate|compare|score --out DIR ... (see the header comment)");
  Deno.exit(2);
}
const out = args.out;
if (!out) throw new Error("--out is required");
function int(flag: string, raw: string | undefined, dflt: number): number {
  const v = raw === undefined ? dflt : Number(raw);
  if (!Number.isSafeInteger(v) || v < 0) throw new Error(`--${flag} must be a non-negative integer, not ${raw}`);
  return v;
}
if (cmd === "score") {
  await score();
  Deno.exit(0);
}
await Deno.mkdir(out, { recursive: true });
for (const f of ["calibration.json", "manifest.json"])
  if (await exists(`${out}/${f}`)) throw new Error(`${out}/${f} exists; use another --out`);

const mutantsFlag = cmd === "calibrate" ? int("mutants", args.mutants, 3) : 0;
const spec = cmd === "compare" ? compareSpec() : undefined;
const device = await requestDevice(navigator.gpu);
const batch: BatchFn = (gs, ec, observer) => evaluateBatch(device, gs, ec, observer);
const pool = M3_FOUNDERS.map(founderGenome);
const versions = { schemaVersion: SCHEMA_VERSION, ruleVersion: RULE_VERSION, metricsVersion: METRICS_VERSION, descriptors: ATLAS_DESCRIPTORS, founderSet: M3_FOUNDER_SET };
const t0 = performance.now();

try {
  if (cmd === "calibrate") await calibrate();
  else await compare(spec!);
} finally {
  device.destroy();
}

async function calibrate() {
  const mutants = mutantsFlag;
  const genomes: { genome: Genome; source: string }[] = [];
  pool.forEach((g, i) => {
    genomes.push({ genome: g, source: `founder-${i}` });
    for (let m = 1; m <= mutants; m++) genomes.push({ genome: mutateGenome(g, 1000 * i + m), source: `founder-${i}-mutant-${m}` });
  });
  const per = perBatch(DEFAULT_EVAL);
  const rows: ({ source: string; key: string; genome: ReturnType<typeof genomeJSON>; eval: Evaluation } & GenomeDescriptors)[] = [];
  const seeds: number[] = [];
  for (let c = 0; c * per < genomes.length; c++) {
    const part = genomes.slice(c * per, (c + 1) * per);
    const seed = screenSeed(CALIBRATION_HISTORY, "pool", 0, c);
    seeds.push(seed);
    const ec = { ...DEFAULT_EVAL, seed };
    const obs = atlasObserver(ec, part.length);
    const t = performance.now();
    const evals = await batch(part.map((p) => p.genome), ec, obs.observer);
    const ds = obs.results();
    console.error(`calibrate: batch ${c} (${part.length} genomes, seed ${seed}) in ${((performance.now() - t) / 1000).toFixed(1)} s`);
    part.forEach((p, k) => rows.push({ source: p.source, key: atlasGenomeKey(p.genome), genome: genomeJSON(p.genome), eval: evals[k], ...ds[k] }));
  }
  const live = rows.filter((r) => r.descriptors && r.eval.survived > 0);
  const summary = Object.fromEntries((["displacement", "persistence"] as const).map((d) => [d, quantiles(live.map((r) => r.descriptors![d]))]));
  const record = { tool: "atlas calibrate", versions, eval: DEFAULT_EVAL, mutants, seeds, genomes: rows.length, live: live.length, summary, seconds: (performance.now() - t0) / 1000, rows };
  await Deno.writeTextFile(`${out}/calibration.json`, JSON.stringify(record, null, 1));
  console.log(JSON.stringify({ genomes: rows.length, live: live.length, summary, seconds: record.seconds }, null, 1));
}

async function compare({ histories, budget, batchSize, randomFraction, coverageSeed, arms }: ReturnType<typeof compareSpec>) {
  const calls: { split: string; seed: number; n: number; assay?: string }[] = [];
  const evaluate = screenEvaluator(batch, DEFAULT_EVAL, (seed, n) => {
    calls.push({ split: "screen", seed, n });
    console.error(`compare: screen seed ${seed} (${n} genomes) at ${((performance.now() - t0) / 1000).toFixed(0)} s`);
  });
  const hs = await compareArms({ arms, histories, pool, budget, batchSize, randomFraction }, evaluate);
  const searchSeconds = (performance.now() - t0) / 1000;
  for (const h of hs) if (h.ledger) await Deno.writeTextFile(`${out}/ledger-h${h.history}.jsonl`, h.ledger.map((e) => JSON.stringify({ ...e, genome: genomeJSON(e.genome) })).join("\n") + "\n");
  await Deno.writeTextFile(`${out}/histories.json`, JSON.stringify(hs.map((h) => ({ arm: h.arm, history: h.history, status: h.status, evaluations: h.evaluations, selection: h.selection, genomes: Object.fromEntries(Object.entries(h.genomes).map(([k, g]) => [k, genomeJSON(g)])) })), null, 1));

  const heldOut = new Map<number, Map<string, Record<string, Evaluation>>>();
  const heldLines: string[] = [];
  for (const history of histories) {
    const m = await heldOutEvaluations(batch, history, hs, PANEL_V1, (assay, seed, n) => {
      calls.push({ split: "held-out", seed, n, assay });
      console.error(`compare: held-out ${assay} seed ${seed} (${n} genomes) at ${((performance.now() - t0) / 1000).toFixed(0)} s`);
    });
    heldOut.set(history, m);
    for (const [k, v] of m) heldLines.push(JSON.stringify({ history, key: k, evals: v }));
  }
  await Deno.writeTextFile(`${out}/heldout.jsonl`, heldLines.join("\n") + "\n");
  const rows = matchedCoverage(hs, heldOut, PANEL_V1, coverageSeed);
  const summary = { physicalVsMassSpeed: summarizeCoverage(rows, "physical", "mass-speed"), physicalVsRandom: summarizeCoverage(rows, "physical", "random-viable") };
  await Deno.writeTextFile(`${out}/coverage.json`, JSON.stringify({ panel: PANEL_VERSION, tests: PANEL_V1.map((t) => t.id), coverageSeed, rows, summary }, null, 1));
  const manifest = {
    tool: "atlas compare",
    command: ["deno", "run", "-A", "tools/atlas.ts", ...Deno.args],
    gitHead: await gitHead(),
    gitDirty: await gitDirty(),
    versions,
    eval: DEFAULT_EVAL,
    atlasSpec: DEFAULT_ATLAS,
    massSpeedSpec: DEFAULT_ARCHIVE,
    selectorReads: SELECTOR_READS,
    panel: { version: PANEL_VERSION, tests: PANEL_V1.map((t) => ({ id: t.id, version: t.version, reads: t.reads })), assays: Object.fromEntries(panelAssays(PANEL_V1).map((a) => [a, { ...PANEL_ASSAYS[a](0), seed: null }])) },
    spec: { arms, histories, budget, batchSize, randomFraction, pool: "M3 founder set", coverageSeed },
    unimplemented: hs.filter((h) => h.status === "unimplemented").map((h) => ({ arm: h.arm, history: h.history })),
    calls,
    seconds: { search: searchSeconds, total: (performance.now() - t0) / 1000 },
  };
  await Deno.writeTextFile(`${out}/manifest.json`, JSON.stringify(manifest, null, 1));
  console.log(JSON.stringify({ rows: rows.map((r) => ({ history: r.history, arm: r.arm, size: r.size, k: r.k, covered: r.covered, fullRate: r.fullRate })), summary, seconds: manifest.seconds }, null, 1));
}

async function score() {
  const coverageSeed = int("coverage-seed", args["coverage-seed"], 1);
  const raw = JSON.parse(await Deno.readTextFile(`${out}/histories.json`)) as (Omit<ArmHistory, "genomes"> & { genomes: Record<string, ReturnType<typeof genomeJSON>> })[];
  const hs: ArmHistory[] = raw.map((h) => ({ ...h, genomes: Object.fromEntries(Object.entries(h.genomes).map(([k, g]) => [k, { ...g, weights: Int8Array.from(g.weights) }])) }));
  // Every history gets a map, so a history whose arms all selected nothing (no held-out records) still scores as zero.
  const heldOut = new Map<number, Map<string, Record<string, Evaluation>>>(hs.map((h) => [h.history, new Map()]));
  for (const line of (await Deno.readTextFile(`${out}/heldout.jsonl`)).split("\n")) {
    if (!line.trim()) continue;
    const r = JSON.parse(line) as { history: number; key: string; evals: Record<string, Evaluation> };
    const m = heldOut.get(r.history) ?? new Map();
    if (m.has(r.key)) throw new Error(`heldout.jsonl repeats ${r.key} in history ${r.history}`);
    m.set(r.key, r.evals);
    heldOut.set(r.history, m);
  }
  const rows = matchedCoverage(hs, heldOut, PANEL_V1, coverageSeed);
  const summary = { physicalVsMassSpeed: summarizeCoverage(rows, "physical", "mass-speed"), physicalVsRandom: summarizeCoverage(rows, "physical", "random-viable") };
  await Deno.writeTextFile(`${out}/coverage.json`, JSON.stringify({ panel: PANEL_VERSION, tests: PANEL_V1.map((t) => t.id), coverageSeed, rescoredBy: "atlas score", rows, summary }, null, 1));
  console.log(JSON.stringify({ rows: rows.map((r) => ({ history: r.history, arm: r.arm, size: r.size, k: r.k, covered: r.covered, fullRate: r.fullRate })), summary }, null, 1));
}

/** Every compare argument, validated (seed scheme included) before the GPU is requested. */
function compareSpec() {
  const histories = String(args.histories ?? "1").split(",").map((h) => int("histories", h, 1));
  if (histories.includes(CALIBRATION_HISTORY)) throw new Error(`history ${CALIBRATION_HISTORY} is reserved for calibration`);
  if (new Set(histories).size !== histories.length) throw new Error(`--histories repeats a history: ${histories.join(",")}`);
  for (const h of histories) screenSeed(h, "pool", 0, 0); // throws for a history outside the seed scheme
  const budget = int("budget", args.budget, 64);
  const batchSize = int("batch", args.batch, 16);
  const randomFraction = args.random === undefined ? 0.25 : Number(args.random);
  if (!(randomFraction >= 0 && randomFraction <= 1)) throw new Error(`--random must be in [0, 1]`);
  const coverageSeed = int("coverage-seed", args["coverage-seed"], 1);
  const arms: ArmName[] = ["random-viable", "mass-speed", "physical", "embedding"];
  checkSchedule({ pool: M3_FOUNDERS, budget, batchSize, arms: arms.filter((a) => a !== "embedding") });
  return { histories, budget, batchSize, randomFraction, coverageSeed, arms };
}

function genomeJSON(g: Genome) {
  return { mu: g.mu, sigma: g.sigma, motGain: g.motGain, weights: Array.from(g.weights), ...(ringsOf(g) ? { rings: ringsOf(g) } : {}), ...(g.genes ? { genes: g.genes } : {}) };
}

function quantiles(xs: number[]) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: s.length, min: s[0], q05: q(0.05), q25: q(0.25), q50: q(0.5), q75: q(0.75), q95: q(0.95), max: s[s.length - 1] };
}

async function gitHead(): Promise<string | null> {
  try {
    const o = await new Deno.Command("git", { args: ["rev-parse", "HEAD"], stdout: "piped", stderr: "null" }).output();
    return o.success ? new TextDecoder().decode(o.stdout).trim() : null;
  } catch {
    return null;
  }
}

/** True when the checkout has uncommitted changes, so `gitHead` alone does not identify the code that ran. */
async function gitDirty(): Promise<boolean | null> {
  try {
    const o = await new Deno.Command("git", { args: ["status", "--porcelain", "--untracked-files=no"], stdout: "piped", stderr: "null" }).output();
    return o.success ? new TextDecoder().decode(o.stdout).trim().length > 0 : null;
  } catch {
    return null;
  }
}

async function exists(p: string): Promise<boolean> {
  try {
    await Deno.stat(p);
    return true;
  } catch {
    return false;
  }
}
