// M3 bootstrap: MAP-Elites search for viable, self-maintaining founders, then
// the M3 gate.
//
//   deno run -A tools/bootstrap.ts --batches 20 [--out runs/bootstrap] [--seed 1]
//     [--confirm-reps 16] [--confirm-seed 1000001] [--confirm-only]
//     [--select lineages|cells] [--pass-bias 0.5] [--random 0.25] [--resume]
//     [--medium waste:A:C | background:HEX[:biomass]] [--score quality|maintenance]
//     [--gate m3|maintenance] [--roles] [--dep-order shuffled|discovery]
//
// Parents are chosen by genetic lineage (Archive.pickParent) so that one
// lineage holding many behaviour cells does not crowd out other founders;
// --select cells restores uniform choice over cell elites. --random is the
// fraction of fresh candidates (random genomes and generalist mutants).
//
// --medium runs a conditioned-medium screen (waste nutrient split, or a fixed
// producer background under every candidate). --score maintenance selects
// qualityMaintenance for the archive (regen reported, not scored). After
// confirmation, every confirmed passer is re-evaluated under DEFAULT_EVAL; a
// passer that dies there is an obligate consumer/decomposer (dependence
// re-screen, only when --medium was set). The re-screen evaluates the passers
// in a seeded shuffle (--dep-order shuffled, the default) so that a partial
// reading is not biased by discovery order; --dep-order discovery keeps the
// confirm.json row order. Rows are matched by genome, never by position.
//
// --gate sets the screening and confirmation gate: m3 (the default: regeneration
// above 0.8, alive and light-dependent in every replicate) or maintenance (alive
// and light-dependent in every replicate; regeneration reported, not required).
// A screen meant to be neutral on regeneration also wants --score maintenance and
// --pass-bias 0 (the --pass-bias share of parent picks goes to lineages holding a
// gate passer, so the m3 gate would still steer reproduction toward regenerators).
// --roles records each evaluation's role (an observer: never part of a score or gate).
// archive.json and confirm.json carry a `provenance` block with the settings the
// run used; confirm.json's gate lists the dependence seeds (dependenceSeeds), and
// a re-run dependence screen keeps its predecessor's summary in dependenceHistory.
//
// Writes archive.json (elites with genomes and evaluations) and gate.json
// (screening passers: elites that recovered from a 30% lesion with p > 0.8 and
// died without light, over DEFAULT_EVAL.reps replicates). It then re-evaluates
// every screening passer on fresh seeds with --confirm-reps replicates and
// writes confirm.json with the M3 gate (m3Gate: genetic clusters of confirmed
// passers). --confirm-only skips the search and confirms an existing gate.json
// in --out under the score and gate the archive was searched with (warning
// about a --score or --gate that differs); --confirm-reps 0 skips
// confirmation. --confirm-only refuses to overwrite an existing confirm.json
// (pass --resume to add to it, or use another --out).
//
// --resume continues the search in --out up to --batches in total, then
// confirms only screening passers not already in confirm.json, on fresh seeds
// above every seed confirm.json records (its dependence re-screens' included),
// and gates the merged confirmations. viable.jsonl logs every viable offer, so
// a resumed search continues exactly as one long run would; archives from
// before the log existed are reseeded from their elites and passers instead
// (lineages approximate, recorded as exact: false).
// Checkpoints are replaced atomically and archive.json is written last, so a
// run stopped at any point resumes from its last completed batch.
import { parseArgs } from "jsr:@std/cli@1/parse-args";
import { CLUSTER_DISTANCE, METRICS_VERSION, SCHEMA_VERSION, genomeFromHex, generalistGenome, randomGenome, ringsOf, type Genome } from "@bl/schema";
import { requestDevice } from "@bl/sim-gpu";
import { binomialLowerBound } from "@bl/metrics";
import {
  Archive,
  CONFIRM_REPS,
  DEFAULT_ARCHIVE,
  DEFAULT_EVAL,
  GATES,
  M3_MIN_CLUSTERS,
  evaluateBatch,
  geneticClusters,
  confirmsGate,
  genomeKey,
  m3Gate,
  mutateGenome,
  parseProbability,
  pick,
  shuffledOrder,
  BACKGROUND_ENCODING,
  checkConfirmResumable,
  reviveEvalConfig,
  SCORES,
  nextConfirmSeed,
  recordedSeeds,
  searchedWith,
  type Evaluation,
  type EvalConfig,
  type GateName,
} from "@bl/search";

const a = parseArgs(Deno.args, {
  string: ["batches", "out", "seed", "random", "confirm-reps", "confirm-seed", "select", "pass-bias", "medium", "score", "gate", "dep-order"],
  boolean: ["confirm-only", "resume", "roles"],
  default: { batches: "10", out: "runs/bootstrap", seed: "1", random: "0.25", "confirm-reps": String(CONFIRM_REPS), "confirm-seed": "1000001", select: "lineages", "pass-bias": "0.5", score: "quality", gate: "m3", "dep-order": "shuffled" },
});
const int = (flag: "batches" | "seed" | "confirm-reps" | "confirm-seed") => {
  const raw = a[flag];
  const v = /^\s*\d+\s*$/.test(raw ?? "") ? Number(raw) : NaN;
  if (!Number.isSafeInteger(v)) throw new Error(`--${flag} must be a nonnegative integer, not ${JSON.stringify(raw ?? null)}`);
  return v;
};
const batches = int("batches"), reps = int("confirm-reps"), confirmSeedFlag = int("confirm-seed");

function parseMedium(raw: string): Partial<Pick<EvalConfig, "nutrient" | "medium" | "darkSteps">> {
  if (raw.startsWith("waste:")) {
    const parts = raw.slice("waste:".length).split(":");
    if (parts.length !== 2) throw new Error(`--medium waste:A:C needs two integers, not ${JSON.stringify(raw)}`);
    const nutrient = Number(parts[0]), waste = Number(parts[1]);
    if (![nutrient, waste].every((n) => Number.isSafeInteger(n) && n >= 0)) throw new Error(`--medium waste:A:C needs nonnegative integers, not ${JSON.stringify(raw)}`);
    return { nutrient, medium: { waste } };
  }
  if (raw.startsWith("background:")) {
    const rest = raw.slice("background:".length);
    const colon = rest.indexOf(":");
    const hex = colon < 0 ? rest : rest.slice(0, colon);
    const bioRaw = colon < 0 ? undefined : rest.slice(colon + 1);
    const background = genomeFromHex(hex);
    const medium: NonNullable<EvalConfig["medium"]> = { background };
    if (bioRaw !== undefined) {
      const backgroundBiomass = /^\s*\d+\s*$/.test(bioRaw) ? Number(bioRaw) : NaN;
      if (!Number.isSafeInteger(backgroundBiomass) || backgroundBiomass < 1) throw new Error(`--medium background biomass must be a positive integer, not ${JSON.stringify(bioRaw)}`);
      medium.backgroundBiomass = backgroundBiomass;
    }
    // Producer must die before a light-dependent consumer reads as dark-dead; pilot can override by editing archive eval.
    return { medium, darkSteps: 4000 };
  }
  throw new Error(`--medium must be waste:A:C or background:HEX[:biomass], not ${JSON.stringify(raw)}`);
}

const scoreName = a.score ?? "quality";
if (scoreName !== "quality" && scoreName !== "maintenance") throw new Error(`--score must be quality or maintenance, not ${JSON.stringify(scoreName)}`);
const gateFlag = a.gate ?? "m3";
if (gateFlag !== "m3" && gateFlag !== "maintenance") throw new Error(`--gate must be m3 or maintenance, not ${JSON.stringify(gateFlag)}`);
const gateName: GateName = gateFlag;
const depOrder = a["dep-order"] ?? "shuffled";
if (depOrder !== "shuffled" && depOrder !== "discovery") throw new Error(`--dep-order must be shuffled or discovery, not ${JSON.stringify(depOrder)}`);
const mediumPatch = a.medium ? parseMedium(a.medium) : {};
// `roles` is an observer (each evaluation also records its role, never scored or gated); it is part of
// the evaluation config, so a search started without it cannot be resumed with it.
const ec: EvalConfig = { ...DEFAULT_EVAL, ...mediumPatch, seed: int("seed"), ...(a.roles ? { roles: true } : {}) };
if (a.select !== "lineages" && a.select !== "cells") throw new Error(`--select must be lineages or cells, not ${a.select}`);
// `score` and `gate` are recorded only when non-default so resumes of pre-score and pre-gate archives still match.
const search = {
  select: a.select,
  passBias: parseProbability("--pass-bias", a["pass-bias"]),
  random: parseProbability("--random", a.random),
  ...(scoreName !== "quality" ? { score: scoreName as "maintenance" } : {}),
  ...(gateName !== "m3" ? { gate: gateName as "maintenance" } : {}),
};
const perBatch = Math.floor((ec.side * ec.side) / ec.reps);
type EncGenome = { mu: number; sigma: number; motGain: number; weights: number[]; rings?: number[] };
const enc = (g: Genome): EncGenome => ({ mu: g.mu, sigma: g.sigma, motGain: g.motGain, weights: Array.from(g.weights), ...(ringsOf(g) ? { rings: ringsOf(g) } : {}) });
const dec = (g: EncGenome): Genome => ({ mu: g.mu, sigma: g.sigma, motGain: g.motGain, weights: Int8Array.from(g.weights), ...(ringsOf(g) ? { rings: ringsOf(g) } : {}) });
type SavedArchive = {
  evaluated: number;
  eval: typeof ec;
  search?: typeof search;
  searchSeeds?: [number, number];
  batches?: number;
  viableCount?: number;
  resumes?: { from: number; exact: boolean }[];
  elites: { born: number; eval: Evaluation; genome: EncGenome }[];
};
type SavedRow = { screenCell: [number, number]; cell: [number, number]; eval: Evaluation; genome: EncGenome };
type DependenceSummary = { seed: number; seeds: [number, number]; obligate: number; n: number; order?: string };
type SavedConfirm = {
  gate: { confirmSeed: number; confirmSeeds?: [number, number][]; dependenceSeeds?: [number, number][]; batchSize: number };
  eval: typeof ec;
  backgroundEncoding?: string;
  dependence?: { seed: number; seeds: [number, number]; obligate: number; order?: string; rows: unknown[] };
  dependenceHistory?: DependenceSummary[];
  rows: SavedRow[];
};
const archivePath = `${a.out}/archive.json`, gatePath = `${a.out}/gate.json`, confirmPath = `${a.out}/confirm.json`, logPath = `${a.out}/viable.jsonl`;

async function readJson<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await Deno.readTextFile(path));
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return undefined;
    throw e;
  }
}
async function sync(path: string) {
  const f = await Deno.open(path, { read: true });
  try {
    await f.syncData();
  } finally {
    f.close();
  }
}
// Checkpoints are replaced whole (write, sync, rename), so a stopped run
// leaves either the old file or the new one, never a torn one.
async function writeAtomic(path: string, text: string) {
  await Deno.writeTextFile(`${path}.tmp`, text);
  await sync(`${path}.tmp`);
  await Deno.rename(`${path}.tmp`, path);
}
const logLines = (es: { born: number; eval: Evaluation; genome: Genome }[]) => es.map((e) => JSON.stringify({ born: e.born, eval: e.eval, genome: enc(e.genome) }) + "\n").join("");
const gateJson = (arch: Archive) => JSON.stringify(arch.gatePassing().map((e) => ({ cell: e.cell, quality: scoreFn(e.eval), eval: e.eval, genome: enc(e.genome) })), null, 1);
const archiveJson = (arch: Archive, batchesDone: number, resumes: { from: number; exact: boolean }[]) => {
  const lineages = arch.lineages();
  const elites = arch.elites().map((e) => ({ cell: e.cell, quality: e.quality, born: e.born, eval: e.eval, genome: enc(e.genome) }));
  return JSON.stringify({ evaluated: arch.evaluated, eval: ec, search, provenance, searchSeeds: [ec.seed, ec.seed + batchesDone - 1], batches: batchesDone, viableCount: arch.viableLog().length, resumes, lineages: lineages.map((l) => ({ size: l.size, passers: l.passers, best: l.best.length, bestCell: l.best[0].cell, bestQuality: l.best[0].quality })), elites }, null, 1);
};
const searchSeedsOf = (s: SavedArchive): [number, number] =>
  s.searchSeeds ?? [s.eval.seed, s.eval.seed + Math.ceil(s.evaluated / Math.floor((s.eval.side * s.eval.side) / s.eval.reps)) - 1];

await Deno.mkdir(a.out, { recursive: true });

// A resumed search restores the archive and the candidate stream (rng advances
// once per candidate) as they stood after the last completed batch, whose
// archive.json write is the commit point: log lines past its viableCount
// belong to a batch that never committed.
const saved = a.resume || a["confirm-only"] ? await readJson<SavedArchive>(archivePath) : undefined;
if ((a.resume || a["confirm-only"]) && !saved) throw new Error(`${a.resume ? "--resume" : "--confirm-only"}: no ${archivePath}`);
if (!a.resume && !a["confirm-only"]) {
  // A new search truncates viable.jsonl, which would orphan an existing archive.
  if (batches < 1) throw new Error(`--batches must be at least 1 for a new search`);
  if (await readJson(archivePath)) throw new Error(`${archivePath} exists: pass --resume to continue that search, or another --out`);
}
// --confirm-only without --resume would write a fresh confirm.json over an existing one, dropping its
// confirmations and dependence screen (with --resume it adds to them).
if (a["confirm-only"] && !a.resume && reps > 0 && (await readJson(confirmPath))) throw new Error(`${confirmPath} exists: pass --resume to add confirmations, or use another --out`);
// The settings of record: --confirm-only takes the score and the gate from the archive it confirms (one
// without them was searched with quality and m3), whatever the flags say, and warns about a flag passed
// against them; a resumed search is checked against them below.
const passed = (flag: string) => Deno.args.some((x) => x === `--${flag}` || x.startsWith(`--${flag}=`));
const recorded = a["confirm-only"] ? searchedWith(saved!.search, { ...(passed("score") ? { score: scoreName } : {}), ...(passed("gate") ? { gate: gateName } : {}) }) : undefined;
if (recorded?.ignored.length) console.warn(`--confirm-only confirms under the settings ${archivePath} was searched with, ignoring ${recorded.ignored.join(", ")}`);
const effGate: GateName = recorded?.gate ?? gateName;
const effScore = recorded?.score ?? scoreName;
const scoreFn = SCORES[effScore];
const gateFn = GATES[effGate];
const evalRef = a["confirm-only"] ? reviveEvalConfig(saved!.eval) : ec;
const searchOfRecord = a["confirm-only"] ? saved!.search : search;
// Written into archive.json and confirm.json: what produced them (a --resume or --confirm-only run records
// the archive's own settings, not its flags). No regeneration threshold applies to the maintenance gate.
const provenance = {
  schemaVersion: SCHEMA_VERSION,
  ruleVersion: evalRef.world.ruleVersion ?? 1,
  metricsVersion: METRICS_VERSION,
  archiveSpec: DEFAULT_ARCHIVE,
  clusterDistance: CLUSTER_DISTANCE,
  gate: effGate,
  gateMinRecovery: effGate === "m3" ? 0.8 : null,
  m3MinClusters: M3_MIN_CLUSTERS,
  confirmReps: reps,
  passBias: searchOfRecord?.passBias ?? null,
  select: searchOfRecord?.select ?? null,
  random: searchOfRecord?.random ?? null,
  score: effScore,
  roles: !!evalRef.roles,
  depOrder,
};
let archive = new Archive(DEFAULT_ARCHIVE, scoreFn, gateFn);
let done = 0;
let resumes: { from: number; exact: boolean }[] = [];
// --confirm-only restores a logged archive too, so it confirms only committed
// passers even if a search stopped after rewriting gate.json.
const restore = a.resume || (a["confirm-only"] && saved?.viableCount !== undefined);
if (restore) {
  const prev = saved!;
  if (!a["confirm-only"]) {
    if (JSON.stringify(prev.eval) !== JSON.stringify(ec)) throw new Error(`--resume: ${archivePath} was searched with another evaluation config or --seed`);
    if (prev.search && JSON.stringify(prev.search) !== JSON.stringify(search)) throw new Error(`--resume: ${archivePath} was searched with ${JSON.stringify(prev.search)}, not ${JSON.stringify(search)}`);
    // An archive without a search block (or without a recorded gate) was screened with the m3 gate.
    if ((prev.search?.gate ?? "m3") !== gateName) throw new Error(`--resume: ${archivePath} was searched with --gate ${prev.search?.gate ?? "m3"}, not ${gateName}`);
  }
  done = prev.batches ?? (prev.searchSeeds ? prev.searchSeeds[1] - prev.searchSeeds[0] + 1 : NaN);
  if (!Number.isInteger(done)) throw new Error(`--resume: ${archivePath} records neither batches nor searchSeeds`);
  const exact = prev.viableCount !== undefined;
  let log: { genome: Genome; eval: Evaluation; born: number }[];
  let tail = false;
  if (exact) {
    const lines = (await Deno.readTextFile(logPath)).split("\n").filter(Boolean);
    if (lines.length < prev.viableCount!) throw new Error(`--resume: ${logPath} has ${lines.length} viable offers, archive.json expects ${prev.viableCount}`);
    tail = lines.length > prev.viableCount!;
    log = lines.slice(0, prev.viableCount).map((l) => {
      const r = JSON.parse(l);
      return { genome: dec(r.genome), eval: r.eval, born: r.born };
    });
  } else {
    // Legacy archive: only cell elites and screening passers survive. A genome
    // may appear as a non-passing elite and as a passer displaced from another
    // cell, and both evaluations are real, so only identical records are merged.
    const passers = (await readJson<{ eval: Evaluation; genome: EncGenome }[]>(gatePath)) ?? [];
    const seen = new Set<string>();
    log = [...prev.elites, ...passers.map((p) => ({ ...p, born: done - 1 }))]
      .map((r) => ({ genome: dec(r.genome), eval: r.eval, born: r.born }))
      .filter((r) => {
        const k = genomeKey(r.genome) + JSON.stringify(r.eval);
        return !seen.has(k) && !!seen.add(k);
      })
      .sort((x, y) => x.born - y.born);
  }
  archive = Archive.replay(log, prev.evaluated, DEFAULT_ARCHIVE, scoreFn, gateFn);
  resumes = [...(prev.resumes ?? []), { from: done, exact }];
  if (!a["confirm-only"] && (tail || !exact)) await writeAtomic(logPath, logLines(archive.viableLog()));
  // gate.json may lag the committed archive if a run stopped between the two writes.
  await writeAtomic(gatePath, gateJson(archive));
  // A reseeded legacy archive is committed with its new log before any batch,
  // so a later stop resumes from it exactly rather than reseeding again.
  if (!a["confirm-only"] && !exact) await writeAtomic(archivePath, archiveJson(archive, done, resumes));
  console.log(`${a.resume ? "resuming" : "restored"} after batch ${done - 1}${exact ? "" : " (legacy archive: reseeded from elites and passers, lineages approximate)"}: ${archive.gatePassing().length} gate-passing, ${archive.lineages().length} lineages`);
}

// Everything the confirmation will need is checked before any GPU work, so a
// conflict cannot surface after the search has spent seeds or written files.
const [s0, s1]: [number, number] = a["confirm-only"] ? searchSeedsOf(saved!) : [ec.seed, ec.seed + Math.max(done, batches) - 1];
const prevConfirm = a.resume ? await readJson<SavedConfirm>(confirmPath) : undefined;
checkConfirmResumable(prevConfirm, confirmPath);
const confirmPer = reps > 0 ? Math.floor((evalRef.side * evalRef.side) / reps) : 0;
if (reps > 0 && confirmPer < 1) throw new Error(`--confirm-reps ${reps} exceeds the ${evalRef.side * evalRef.side} tiles of a batch`);
const prevSeeds = recordedSeeds(prevConfirm, confirmPath);
const prevRanges = prevSeeds.confirm;
const overlapsSearch = ([c0, c1]: [number, number]) => c1 >= c0 && s1 >= s0 && c0 <= s1 && c1 >= s0;
for (const r of prevRanges) if (overlapsSearch(r)) throw new Error(`earlier confirmation seeds ${r[0]}..${r[1]} in ${confirmPath} overlap search seeds ${s0}..${s1}`);
for (const r of prevSeeds.dependence) if (overlapsSearch(r)) throw new Error(`earlier dependence seeds ${r[0]}..${r[1]} in ${confirmPath} overlap search seeds ${s0}..${s1}`);
// Above every seed the earlier confirmation spent, its dependence re-screens' included.
const confirmSeed = nextConfirmSeed(prevSeeds, confirmSeedFlag);
if (reps > 0) {
  if (prevConfirm) {
    if (JSON.stringify({ ...prevConfirm.eval, seed: 0 }) !== JSON.stringify({ ...evalRef, reps, seed: 0 })) throw new Error(`--resume: ${confirmPath} used another evaluation config or --confirm-reps`);
    if (prevConfirm.gate.batchSize !== confirmPer) throw new Error(`--resume: ${confirmPath} used batches of ${prevConfirm.gate.batchSize}, not ${confirmPer}`);
  }
  // How many passers a search will add is unknown, so confirmation must start
  // above its seeds; without a search the pending range is known exactly.
  if (!a["confirm-only"] && s1 >= s0 && confirmSeed <= s1) throw new Error(`confirmation seeds must start above search seeds ${s0}..${s1}, not at ${confirmSeed}; pass another --confirm-seed`);
  if (a["confirm-only"]) {
    const already = new Set(prevConfirm?.rows.map((r) => genomeKey(dec(r.genome))));
    const pending = (restore ? archive.gatePassing().map((e) => e.genome) : ((await readJson<{ genome: EncGenome }[]>(gatePath)) ?? []).map((g) => dec(g.genome))).filter((g) => !already.has(genomeKey(g))).length;
    const range: [number, number] = [confirmSeed, confirmSeed + Math.ceil(pending / confirmPer) - 1];
    if (overlapsSearch(range)) throw new Error(`confirmation seeds ${range[0]}..${range[1]} overlap search seeds ${s0}..${s1}; pass another --confirm-seed`);
  }
}

let device: GPUDevice | undefined;
const gpu = async () => (device ??= await requestDevice(navigator.gpu));
const mu = ec.world.defaultMu!, sigma = ec.world.defaultSigma!;
let rng = ec.seed * 7919 + done * perBatch;

if (!a["confirm-only"]) {
  if (!a.resume) await writeAtomic(logPath, "");
  for (let b = done; b < batches; b++) {
    const cands: Genome[] = [];
    for (let k = 0; k < perBatch; k++) {
      rng++;
      const el = archive.elites();
      if (b === 0 && k === 0) cands.push(generalistGenome(mu, sigma));
      else if (!el.length || (rng * 2654435761 >>> 0) / 2 ** 32 < search.random) cands.push(k % 2 ? randomGenome(rng, mu, sigma) : mutateGenome(generalistGenome(mu, sigma), rng, 6));
      else cands.push(mutateGenome(search.select === "cells" ? pick(el, rng).genome : archive.pickParent(rng, search.passBias)!.genome, rng, 1 + (rng % 4)));
    }
    const t0 = performance.now();
    const evals = await evaluateBatch(await gpu(), cands, { ...ec, seed: ec.seed + b });
    let inserted = 0;
    const logged = archive.viableLog().length;
    cands.forEach((g, k) => archive.offer(g, evals[k], b) && inserted++);
    // Order matters for recovery: the log, then gate.json, then archive.json (the commit point).
    await Deno.writeTextFile(logPath, logLines(archive.viableLog(logged)), { append: true });
    await sync(logPath);
    const best = archive.elites().reduce((m, e) => Math.max(m, e.quality), 0);
    const lineages = archive.lineages();
    console.log(
      `batch ${b}: ${inserted}/${cands.length} inserted, coverage ${(archive.coverage() * 100).toFixed(0)}%, best q ${best.toFixed(3)}, gate-passing ${archive.gatePassing().length}, lineages ${lineages.length} (${lineages.filter((l) => l.passers > 0).length} with passers) (${((performance.now() - t0) / 1000).toFixed(1)}s)`,
    );
    await writeAtomic(gatePath, gateJson(archive));
    await writeAtomic(archivePath, archiveJson(archive, b + 1, resumes));
  }
}

// Confirmation on fresh seeds: screening passes over a few replicates include
// candidates that passed by chance among the thousands screened. With
// --resume, earlier confirmations stand: only new screening passers are
// evaluated, on the confirmation seeds after the ones already used.
if (reps > 0) {
  const allScreened: { cell: [number, number]; genome: EncGenome }[] = JSON.parse(await Deno.readTextFile(gatePath));
  const arch: SavedArchive = JSON.parse(await Deno.readTextFile(archivePath));
  const cec = { ...reviveEvalConfig(arch.eval), reps, seed: confirmSeed };
  const confirmed = new Set(prevConfirm?.rows.map((r) => genomeKey(dec(r.genome))));
  const screened = allScreened.filter((s) => !confirmed.has(genomeKey(dec(s.genome))));
  const confirmBatches = Math.ceil(screened.length / confirmPer);
  const newRange: [number, number] = [confirmSeed, confirmSeed + confirmBatches - 1];
  if (overlapsSearch(newRange)) throw new Error(`confirmation seeds ${newRange[0]}..${newRange[1]} overlap search seeds ${s0}..${s1}; pass another --confirm-seed`);
  if (reps < CONFIRM_REPS) console.warn(`--confirm-reps ${reps} < ${CONFIRM_REPS}: exploratory only, confirmations cannot meet the M3 gate`);
  const rows: { screenCell: [number, number]; cell: [number, number]; genome: Genome; eval: Evaluation }[] = (prevConfirm?.rows ?? []).map((r) => ({ screenCell: r.screenCell, cell: r.cell, eval: r.eval, genome: dec(r.genome) }));
  const before = rows.length;
  if (prevConfirm) console.log(`${before} earlier confirmations kept; confirming ${screened.length} new screening passers from seed ${confirmSeed}`);
  for (let i = 0; i < screened.length; i += confirmPer) {
    const chunk = screened.slice(i, i + confirmPer);
    const t0 = performance.now();
    const evals = await evaluateBatch(await gpu(), chunk.map((s) => dec(s.genome)), { ...cec, seed: confirmSeed + i / confirmPer });  // batch i / per holds entries i..i + per - 1
    chunk.forEach((s, k) => rows.push({ screenCell: s.cell, cell: archive.cellOf(evals[k]), genome: dec(s.genome), eval: evals[k] }));
    console.log(`confirm ${rows.length - before}/${screened.length}: ${rows.filter((r) => confirmsGate(r.eval, undefined, gateFn)).length} passing (${((performance.now() - t0) / 1000).toFixed(1)}s)`);
  }
  const gate = m3Gate(rows, undefined, undefined, gateFn);
  const passing = rows.filter((r) => confirmsGate(r.eval, undefined, gateFn));
  const cluster = geneticClusters(passing.map((r) => r.genome));
  const strict = passing.filter((r) => binomialLowerBound(r.eval.regenerated, r.eval.reps) > 0.8);
  const confirmSeeds = [...prevRanges, ...(confirmBatches ? [newRange] : [])];
  const detail = {
    ...gate,
    reps,
    confirmSeed: confirmSeeds.length ? confirmSeeds[0][0] : confirmSeed,
    confirmSeeds,
    batchSize: confirmPer,
    searchSeeds: searchSeedsOf(arch),
    /** Confirmed passers whose regeneration rate has a 95% lower bound above 0.8 (informational). */
    lowerBoundAbove08: strict.length,
    /** Robustness figure: genetic clusters among those passers. */
    lowerBoundClusters: new Set(geneticClusters(strict.map((r) => r.genome))).size,
    distinctCells: new Set(passing.map((r) => r.cell.join(","))).size,
  };
  console.log(`M3 gate ${gate.met ? "MET" : "NOT MET"}: ${JSON.stringify(detail)}`);

  // Dependence re-screen: confirmed passers under the medium that die on DEFAULT_EVAL are obligate.
  let dependence: { seed: number; seeds: [number, number]; obligate: number; order: string; orderSeed: number | null; rows: { genome: EncGenome; survived: number; obligate: boolean; eval: Evaluation }[] } | undefined;
  // A re-screen run again (--resume) replaces the block, so the earlier one's summary is kept alongside.
  const depHistory: DependenceSummary[] = [
    ...(prevConfirm?.dependenceHistory ?? []),
    ...(prevConfirm?.dependence ? [{ seed: prevConfirm.dependence.seed, seeds: prevConfirm.dependence.seeds, obligate: prevConfirm.dependence.obligate, n: prevConfirm.dependence.rows.length, order: prevConfirm.dependence.order ?? "discovery" }] : []),
  ];
  if (evalRef.medium && passing.length) {
    const depPer = Math.floor((DEFAULT_EVAL.side * DEFAULT_EVAL.side) / reps);
    if (depPer < 1) throw new Error(`--confirm-reps ${reps} exceeds the ${DEFAULT_EVAL.side * DEFAULT_EVAL.side} tiles of a DEFAULT_EVAL batch`);
    // Right after this run's confirmation batches, so above every recorded seed too: a re-screen run again with
    // no new passers does not repeat its predecessor's seeds.
    const depSeed = confirmSeed + confirmBatches;
    const depBatches = Math.ceil(passing.length / depPer);
    const depRange: [number, number] = [depSeed, depSeed + depBatches - 1];
    if (overlapsSearch(depRange)) throw new Error(`dependence seeds ${depRange[0]}..${depRange[1]} overlap search seeds ${s0}..${s1}; pass another --confirm-seed`);
    const depRows: { genome: EncGenome; survived: number; obligate: boolean; eval: Evaluation }[] = [];
    // Discovery order makes a partial reading biased (obligates turned up late in the list), so by default the
    // passers are evaluated in a shuffle seeded by the first dependence seed. Rows keep their genomes; every
    // reader matches them by genome, never by position.
    const depItems = depOrder === "shuffled" ? shuffledOrder(passing.length, depSeed).map((i) => passing[i]) : passing;
    for (let i = 0; i < depItems.length; i += depPer) {
      const chunk = depItems.slice(i, i + depPer);
      const t0 = performance.now();
      const evals = await evaluateBatch(await gpu(), chunk.map((r) => r.genome), { ...DEFAULT_EVAL, reps, seed: depSeed + i / depPer });
      chunk.forEach((r, k) => depRows.push({ genome: enc(r.genome), survived: evals[k].survived, obligate: evals[k].survived === 0, eval: evals[k] }));
      console.log(`dependence ${depRows.length}/${passing.length}: ${depRows.filter((d) => d.obligate).length} obligate (${((performance.now() - t0) / 1000).toFixed(1)}s)`);
    }
    dependence = { seed: depSeed, seeds: depRange, order: depOrder, orderSeed: depOrder === "shuffled" ? depSeed : null, obligate: depRows.filter((d) => d.obligate).length, rows: depRows };
    console.log(`dependence re-screen: ${dependence.obligate}/${passing.length} obligate under DEFAULT_EVAL`);
  }

  const out = rows.map((r) => {
    const p = passing.indexOf(r);
    return { screenCell: r.screenCell, cell: r.cell, pass: p >= 0, cluster: p >= 0 ? cluster[p] : null, regenLowerBound: binomialLowerBound(r.eval.regenerated, r.eval.reps), eval: r.eval, genome: enc(r.genome) };
  });
  // Every dependence re-screen's seeds (this one's and its predecessors'), for usedSeeds in packages/search/src/retest.ts.
  // A range the earlier record lists only in dependenceSeeds is kept ahead of them, so no later run reuses it.
  const screens = [...depHistory.map((h) => h.seeds), ...(dependence ? [dependence.seeds] : [])];
  const dependenceSeeds = [...prevSeeds.dependence.filter(([d0, d1]) => !screens.some(([e0, e1]) => d0 === e0 && d1 === e1)), ...screens];
  await writeAtomic(
    confirmPath,
    JSON.stringify(
      {
        gate: { ...detail, ...(dependenceSeeds.length ? { dependenceSeeds } : {}) },
        eval: cec,
        provenance,
        ...(cec.medium?.background ? { backgroundEncoding: BACKGROUND_ENCODING } : {}),
        ...(dependence ? { dependence } : {}),
        ...(depHistory.length ? { dependenceHistory: depHistory } : {}),
        rows: out,
      },
      null,
      1,
    ),
  );
}
