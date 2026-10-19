// The anomaly bell, v2: the eleven-signal twin bell on fresh twins (docs/naturalist-bell-v2-2026-10-18.md, section "Fixed before
// running"; that section is the rule set and this file implements it, it does not amend it). Pure functions over manifests, logs
// and census streams; no Deno or filesystem access, so vitest can load it. The launcher is tools/bell2-launch.ts and the scorer
// tools/bell2.ts.
//
// v1's part B is reused, not copied: the pair score is v1's PairScorer (tools/lib/bell1.ts) read through its one additive option,
// results(keep), with keep = v1's eleven signals; the threshold, hits, criteria, effects and first windows are v1's summarizeTwins
// run on those eleven-signal results; the nudge rule is v1's nearestBiomass. What is new here is what v2 changes: fresh seeds,
// twins forked from the base's checkpoint at C = 190,000 (so a twin's censuses at steps <= C are its base's), the sham fork (the
// replay check R), the fixed threshold Z1 reported beside Z*2, and the cap and scale-down.
import {
  B2_MIN_HITS,
  B3_MAX_HITS,
  CADENCE,
  EARLY_FROM,
  EARLY_TO,
  PER_ARM,
  W_PAIR,
  isV1Signal,
  summarizeTwins,
  type Census,
  type Criterion,
  type PairResult,
  type TwinInput,
  type TwinOutcome,
  type TwinSummary,
} from "./bell1.ts";
import { BIG_CENTRE, NUDGE_TARGETS, interventionsMatch, type Arm, type Job } from "./bell-v1-jobs.ts";
import { binomialLowerBound } from "@bl/metrics";
import { binomialUpperBound } from "./bell.ts";
import { reducePsLine } from "./horizon.ts";

export const BELL2_VERSION = 2;
export const NOTE2_PATH = "docs/naturalist-bell-v2-2026-10-18.md";

// ---------------------------------------------------------------------------------------------
// Fixed parameters (the note).

/** The intervention step, the fork step, a base's length and a fork's length. */
export const S = 200_000;
export const C = 190_000;
export const BASE_STEPS = 206_000;
export const FORK_STEPS = 16_000;
export const BASE_CENSUSES = BASE_STEPS / CADENCE;
export const FORK_CENSUSES = FORK_STEPS / CADENCE;
/** The sham's checkpoint cadence, counted from the fork's start: it writes the state at S (and nothing else within 16,000 steps). */
export const SHAM_CHECKPOINT_EVERY = S - C;
export const PRESET = "gradient-m3";
export const CONDITION = "treatment";
/** The ten base seeds, the pilot seed (timing and mechanics only) and the first replacement seed. */
export const SEEDS: readonly [number, number] = [3901, 3910];
export const PILOT_SEED = 3900;
export const REPLACEMENT_FROM = 3911;
/** Replacement seeds the plan allows (3911..3920; a vitest pins them fresh). */
export const MAX_REPLACEMENTS = 10;
export const N_BASES = SEEDS[1] - SEEDS[0] + 1;
export type Arm2 = "sham" | Arm;
export const ARMS2: readonly Arm2[] = ["sham", "nudge", "nudge2", "l64", "l96", "f"];
export const BASE_EXPERIMENT = "bell-v2-base";
export const TWIN_PREFIX = "bell-v2-twins-";
/** v1's post-hoc threshold, carried over unchanged (reported, not deciding). */
export const Z1 = 2.580695652173913;
export const CAP_HOURS = 5;
/** The pilot's own hard cap (it has no projection yet); its wall time is the first part of the one 5 h budget. */
export const PILOT_CAP_HOURS = 1;
export const MIN_FREE_BYTES = 2e9;
/** The signal filter of the pair rule: v1's eleven (v0's thirteen without maxGeneration and dominantShare). */
export const KEEP = isV1Signal;
/** The projection's safety factor. */
export const PROJECTION_FACTOR = 1.25;

export const seedRange = ([a, b]: readonly [number, number]): number[] => Array.from({ length: b - a + 1 }, (_, i) => a + i);
export const baseSeeds = (): number[] => seedRange(SEEDS);
export const replacementSeeds = (): number[] => seedRange([REPLACEMENT_FROM, REPLACEMENT_FROM + MAX_REPLACEMENTS - 1]);

// ---------------------------------------------------------------------------------------------
// Jobs.

export interface Expected2 {
  step: number;
  kind: "lesion" | "feed";
  x: number;
  y: number;
  r: number;
  amount?: number;
}
export interface Job2 {
  /** base-<seed> or twin-<arm>-<seed>: the launch log's key. */
  id: string;
  kind: "base" | "fork";
  arm: Arm2 | "base";
  seed: number;
  experiment: string;
  /** The bundle directory, relative to the runs root. */
  rel: string;
  /** tools/run.ts --lesion / --feed flag pair ([] for a base and a sham). */
  intervention: string[];
  /** The one entry interventions.jsonl must hold (null: none, and no file). */
  expected: Expected2 | null;
  /** --checkpoint: C for a base, the sham's 10,000, else 0. */
  checkpointEvery: number;
  /** Total steps of the run (spec.steps): 206,000 for a base, 16,000 for a fork. */
  steps: number;
}
/** Nudge centres per base seed and nudge arm, from the sham's checkpoint at S. */
export type NudgeCentres2 = Record<number, Partial<Record<"nudge" | "nudge2", { x: number; y: number }>>>;

export const relOf = (experiment: string, seed: number): string => `${experiment}/${PRESET}/${CONDITION}/seed-${seed}`;

export function planBases(seeds: readonly number[]): Job2[] {
  return seeds.map((seed) => ({ id: `base-${seed}`, kind: "base", arm: "base", seed, experiment: BASE_EXPERIMENT, rel: relOf(BASE_EXPERIMENT, seed), intervention: [], expected: null, checkpointEvery: C, steps: BASE_STEPS }));
}
/** One fork job: its id, experiment, destination, intervention flags and checkpoint cadence. */
export function forkJob(arm: Arm2, seed: number, expected: Expected2 | null): Job2 {
  const experiment = `${TWIN_PREFIX}${arm}`;
  const intervention = expected === null ? [] : expected.kind === "lesion" ? ["--lesion", `${expected.step}:${expected.x},${expected.y},${expected.r}`] : ["--feed", `${expected.step}:${expected.x},${expected.y},${expected.r},${expected.amount}`];
  return { id: `twin-${arm}-${seed}`, kind: "fork", arm, seed, experiment, rel: relOf(experiment, seed), intervention, expected, checkpointEvery: arm === "sham" ? SHAM_CHECKPOINT_EVERY : 0, steps: FORK_STEPS };
}
export function planShams(seeds: readonly number[]): Job2[] {
  return seeds.map((seed) => forkJob("sham", seed, null));
}
/** The arms that need no nudge centre: L64, L96 and F, v1's radii, centre and amount, at S. */
export function planBigTwins(seeds: readonly number[]): Job2[] {
  const out: Job2[] = [];
  for (const seed of seeds) {
    for (const arm of ["l64", "l96"] as const) out.push(forkJob(arm, seed, { step: S, kind: "lesion", x: BIG_CENTRE[0], y: BIG_CENTRE[1], r: arm === "l64" ? 64 : 96 }));
    out.push(forkJob("f", seed, { step: S, kind: "feed", x: BIG_CENTRE[0], y: BIG_CENTRE[1], r: 32, amount: 64 }));
  }
  return out;
}
/** The nudge twins (r = 1 at the centre computed from the state at S). A seed without a centre throws, naming it. */
export function planNudgeTwins(seeds: readonly number[], nudges: NudgeCentres2): Job2[] {
  const out: Job2[] = [];
  for (const seed of seeds) {
    for (const arm of ["nudge", "nudge2"] as const) {
      const c = nudges[seed]?.[arm];
      if (!c) throw new Error(`no ${arm} centre for seed ${seed}`);
      out.push(forkJob(arm, seed, { step: S, kind: "lesion", x: c.x, y: c.y, r: 1 }));
    }
  }
  return out;
}
/** All 60 twins of the given seeds (the nudge arms need every centre). */
export function planTwins(seeds: readonly number[], nudges: NudgeCentres2): Job2[] {
  return [...planShams(seeds), ...planBigTwins(seeds), ...planNudgeTwins(seeds, nudges)];
}

/** The launch order after the bases and the shams (each arm in seed order): the launcher's loop runs exactly this list. L64 is last. */
export const TWIN_ORDER: readonly Arm[] = ["l96", "f", "nudge", "nudge2", "l64"];

/** tools/run.ts arguments of a base (after `deno run ... tools/run.ts`): no interventions, one checkpoint at C, no --lineage-obs. */
export function baseArgs(job: Job2, outRoot: string): string[] {
  if (job.kind !== "base") throw new Error(`${job.id} is not a base`);
  return ["--experiment", job.experiment, "--preset", PRESET, "--conditions", CONDITION, "--seeds", String(job.seed), "--steps", String(BASE_STEPS), "--census", "100", "--deep", "10", "--checkpoint", String(C), "--out", outRoot];
}
/** tools/run.ts arguments of a fork from its base's checkpoint at C (`baseDir`: the base bundle). */
export function forkArgs(job: Job2, outRoot: string, baseDir: string): string[] {
  if (job.kind !== "fork") throw new Error(`${job.id} is not a fork`);
  return [
    "--experiment", job.experiment, "--preset", PRESET, "--conditions", CONDITION, "--seeds", String(job.seed), "--steps", String(FORK_STEPS), "--census", "100", "--deep", "10",
    "--checkpoint", String(job.checkpointEvery), ...job.intervention, "--start-from", baseDir, "--start-step", String(C), "--out", outRoot,
  ];
}

// ---------------------------------------------------------------------------------------------
// The pilot (timing and fork mechanics only; its outputs are never scored).

/**
 * A base of 16,000 steps with a checkpoint at 10,000; a sham fork from 10,000 for 6,000 steps (checkpoint at 15,000); an L96 fork and
 * an F fork at 15,000; and a nudge fork at 15,000 (r = 1 at the centre read from the sham's checkpoint, `pilotNudge`). Every fork
 * flag the main run uses is exercised once.
 */
export const PILOT = { seed: PILOT_SEED, C: 10_000, S: 15_000, baseSteps: 16_000, forkSteps: 6_000 } as const;
const pilotFork = (arm: Arm2, e: Expected2 | null): Job2 => ({ ...forkJob(arm, PILOT.seed, e), checkpointEvery: arm === "sham" ? PILOT.S - PILOT.C : 0, steps: PILOT.forkSteps });
export function pilotJobs(): { base: Job2; sham: Job2; l96: Job2; f: Job2 } {
  const base: Job2 = { ...planBases([PILOT.seed])[0], checkpointEvery: PILOT.C, steps: PILOT.baseSteps };
  const sham = pilotFork("sham", null);
  const l96 = pilotFork("l96", { step: PILOT.S, kind: "lesion", x: BIG_CENTRE[0], y: BIG_CENTRE[1], r: 96 });
  const f = pilotFork("f", { step: PILOT.S, kind: "feed", x: BIG_CENTRE[0], y: BIG_CENTRE[1], r: 32, amount: 64 });
  return { base, sham, l96, f };
}
/** The pilot's nudge fork, r = 1 at the centre found in the sham's checkpoint at 15,000. */
export const pilotNudge = (c: { x: number; y: number }): Job2 => pilotFork("nudge", { step: PILOT.S, kind: "lesion", x: c.x, y: c.y, r: 1 });
/** tools/run.ts arguments of a pilot job (the main run's flags with the pilot's lengths and steps). */
export function pilotArgs(job: Job2, outRoot: string, baseDir?: string): string[] {
  const common = ["--experiment", job.experiment, "--preset", PRESET, "--conditions", CONDITION, "--seeds", String(job.seed), "--steps", String(job.steps), "--census", "100", "--deep", "10", "--checkpoint", String(job.checkpointEvery)];
  if (job.kind === "base") return [...common, "--out", outRoot];
  if (!baseDir) throw new Error(`${job.id}: a fork needs its base directory`);
  return [...common, ...job.intervention, "--start-from", baseDir, "--start-step", String(PILOT.C), "--out", outRoot];
}

/**
 * Lineage rows of a fork against its source over (from, to]: every lineages.tsv data line of the fork at a step in (from, to]
 * equals the source's, in order, and the fork has no line at or before `from`. Streams both (header lines skipped).
 */
export async function lineageRowsCheck(source: AsyncIterable<string>, forkLines: AsyncIterable<string>, from: number, to: number): Promise<{ ok: boolean; compared: number; detail?: string }> {
  async function* inRange(it: AsyncIterable<string>, who: string, forkSide: boolean): AsyncGenerator<string> {
    let header = true;
    for await (const l of it) {
      if (header) { header = false; continue; }
      if (!l) continue;
      const step = Number(l.slice(0, l.indexOf("\t")));
      if (!Number.isFinite(step)) throw new Error(`${who} lineages.tsv: a line without a step`);
      if (forkSide && step <= from) throw new Error(`the fork has a lineage row at step ${step}, at or before its fork step ${from}`);
      if (step > to) return;
      if (step > from) yield l;
    }
  }
  const a = inRange(source, "source", false)[Symbol.asyncIterator](), b = inRange(forkLines, "fork", true)[Symbol.asyncIterator]();
  let compared = 0;
  try {
    for (;;) {
      const [x, y] = await Promise.all([a.next(), b.next()]);
      if (x.done && y.done) return { ok: true, compared };
      if (x.done || y.done) return { ok: false, compared, detail: `${x.done ? "the source" : "the fork"} has fewer lineage rows in (${from}, ${to}]` };
      if (x.value !== y.value) return { ok: false, compared, detail: `lineage row ${compared + 1} in (${from}, ${to}] differs: ${JSON.stringify(x.value)} vs ${JSON.stringify(y.value)}` };
      compared++;
    }
  } catch (e) {
    return { ok: false, compared, detail: (e as Error).message };
  } finally {
    await a.return?.(undefined);
    await b.return?.(undefined);
  }
}

/** Duplicate ids or destinations, and experiment names validateSpec would refuse. Empty when fine. */
export function jobProblems2(jobs: readonly Job2[]): string[] {
  const out: string[] = [];
  const ids = new Set<string>();
  const rels = new Map<string, string>();
  for (const j of jobs) {
    if (ids.has(j.id)) out.push(`duplicate job id ${j.id}`);
    ids.add(j.id);
    if (rels.has(j.rel)) out.push(`${j.id} and ${rels.get(j.rel)} share ${j.rel}`);
    rels.set(j.rel, j.id);
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(j.experiment)) out.push(`${j.id}: experiment ${j.experiment} fails validateSpec`);
  }
  return out;
}
/** v1's interventionsMatch (it reads only `expected`). */
export const interventionsMatch2 = (job: Pick<Job2, "expected">, applied: readonly Record<string, unknown>[]): boolean => interventionsMatch({ expected: job.expected } as Job, applied);
/** Null when interventions.jsonl (its text, null when absent) holds exactly the job's scheduled entry, else the reason. */
export function interventionProblem2(job: Pick<Job2, "expected">, text: string | null): string | null {
  const applied: Record<string, unknown>[] = [];
  const lines = (text ?? "").split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    let o: unknown;
    try {
      o = JSON.parse(lines[i]);
    } catch (e) {
      return `interventions.jsonl line ${i + 1} is not JSON (${(e as Error).message})`;
    }
    if (o === null || typeof o !== "object" || Array.isArray(o)) return `interventions.jsonl line ${i + 1} is not a JSON object`;
    applied.push(o as Record<string, unknown>);
  }
  if (job.expected === null && text !== null) return applied.length ? `interventions.jsonl holds ${applied.length} entr${applied.length === 1 ? "y" : "ies"}; this run must have none` : "interventions.jsonl exists; this run must have none";
  if (interventionsMatch2(job, applied)) return null;
  const e = job.expected;
  return `interventions.jsonl holds ${applied.length} entr${applied.length === 1 ? "y" : "ies"}, not exactly the scheduled ${e ? `${e.kind} ${e.x},${e.y},${e.r}${e.amount !== undefined ? `,${e.amount}` : ""} at ${e.step}` : "nothing"}`;
}

// ---------------------------------------------------------------------------------------------
// Manifests.

interface ManifestLike {
  spec?: Record<string, unknown>;
  presetIdentity?: unknown;
  startStep?: unknown;
  initHash?: unknown;
  checkpoints?: unknown;
  summary?: { steps?: unknown } | null;
}
function parse(text: string): ManifestLike | string {
  let m: unknown;
  try {
    m = JSON.parse(text);
  } catch (e) {
    return `manifest.json is not JSON (${(e as Error).message})`;
  }
  if (m === null || typeof m !== "object" || (m as ManifestLike).spec === null || typeof (m as ManifestLike).spec !== "object") return "manifest.json has no spec object";
  return m as ManifestLike;
}
const checkpointsOf = (m: ManifestLike): { step: number; file: string; hash: string }[] =>
  (Array.isArray(m.checkpoints) ? m.checkpoints : []).filter((c): c is { step: number; file: string; hash: string } => !!c && typeof c.step === "number" && typeof c.file === "string" && typeof c.hash === "string");

/** The spec fields every v2 bundle must state, for a job (and, for the pilot, other lengths). */
function specProblem(job: Pick<Job2, "experiment" | "seed">, s: Record<string, unknown>, steps: number): string | null {
  if (s.experiment !== job.experiment || s.presetId !== PRESET || s.condition !== CONDITION || s.seed !== job.seed) return `manifest says ${s.experiment}/${s.presetId}/${s.condition}/seed-${s.seed}, expected ${job.experiment}/${PRESET}/${CONDITION}/seed-${job.seed}`;
  if (s.steps !== steps) return `spec.steps ${s.steps}, expected ${steps}`;
  if (s.censusEvery !== CADENCE) return `spec.censusEvery ${s.censusEvery}, expected ${CADENCE}`;
  if (s.deepEvery !== 10) return `spec.deepEvery ${s.deepEvery}, expected 10`;
  if (s.lineageObs !== undefined) return `spec.lineageObs is ${JSON.stringify(s.lineageObs)}; v2 runs without --lineage-obs`;
  return null;
}

export interface ManifestOpts {
  /** For a base: its length. For a fork: the fork step, its length and the step of the sham's checkpoint. Defaults: the main run's. */
  steps?: number;
  C?: number;
  shamCheckpointStep?: number;
}
/**
 * A base's manifest problem, or null: its spec (experiment bell-v2-base, gradient-m3, treatment, the seed, 206,000 steps, census 100,
 * deep 10, no lineageObs, no interventions), a start at step 0 with an initHash, a summary at the last step, a presetIdentity, and the
 * checkpoint at C listed (its file's hash is the CLI's check). Returns the checkpoint entry with the presetIdentity when it passes.
 */
export function baseManifestProblem(job: Pick<Job2, "experiment" | "seed">, text: string, opts: ManifestOpts = {}): { problem: string } | { presetIdentity: string; checkpoint: { step: number; file: string; hash: string } } {
  const steps = opts.steps ?? BASE_STEPS, at = opts.C ?? C;
  const m = parse(text);
  if (typeof m === "string") return { problem: m };
  const sp = specProblem(job, m.spec!, steps);
  if (sp) return { problem: sp };
  if (m.spec!.interventions !== undefined) return { problem: "spec.interventions is set; a base has none" };
  if (m.startStep !== 0) return { problem: `startStep ${JSON.stringify(m.startStep)}, a base starts at 0` };
  if (typeof m.initHash !== "string") return { problem: "no initHash (a base is built from its preset at step 0)" };
  if (!m.summary) return { problem: "manifest has no summary (unfinished run)" };
  if (m.summary.steps !== steps) return { problem: `summary.steps ${m.summary.steps}, expected ${steps}` };
  if (typeof m.presetIdentity !== "string" || !m.presetIdentity) return { problem: "manifest has no presetIdentity" };
  const ck = checkpointsOf(m).filter((c) => c.step === at);
  if (ck.length !== 1) return { problem: `${ck.length} checkpoint entries at step ${at}, expected exactly 1` };
  return { presetIdentity: m.presetIdentity, checkpoint: ck[0] };
}
/**
 * A fork's manifest problem, or null: its spec (the arm's experiment, gradient-m3, treatment, the seed, 16,000 steps, census 100, deep
 * 10, no lineageObs), startStep C and no initHash (a fork continues a checkpoint), a summary at C + 16,000, its base's presetIdentity,
 * and its checkpoints: the sham's one at S, none for any other arm. checkpointEvery is not compared (the runner's continuation ignores it).
 */
export function forkManifestProblem(job: Pick<Job2, "experiment" | "seed" | "arm">, text: string, baseIdentity: string, opts: ManifestOpts = {}): string | null {
  const steps = opts.steps ?? FORK_STEPS, at = opts.C ?? C, shamAt = opts.shamCheckpointStep ?? S;
  const m = parse(text);
  if (typeof m === "string") return m;
  const sp = specProblem(job, m.spec!, steps);
  if (sp) return sp;
  if (m.startStep !== at) return `startStep ${JSON.stringify(m.startStep)}, not the fork step ${at} (a reused or foreign bundle)`;
  if (m.initHash !== undefined) return "the manifest has an initHash: this run was built at step 0, not forked";
  if (!m.summary) return "manifest has no summary (unfinished run)";
  if (m.summary.steps !== at + steps) return `summary.steps ${m.summary.steps}, expected ${at + steps}`;
  if (m.presetIdentity !== baseIdentity) return `presetIdentity ${m.presetIdentity} differs from its base's ${baseIdentity}`;
  const cks = checkpointsOf(m).map((c) => c.step);
  const raw = Array.isArray(m.checkpoints) ? m.checkpoints.length : 0;
  if (raw !== cks.length) return "a checkpoint entry has no step, file or hash";
  if (job.arm === "sham") {
    if (cks.length !== 1 || cks[0] !== shamAt) return `checkpoints at [${cks.join(", ")}], a sham writes exactly one, at ${shamAt}`;
  } else if (cks.length) return `checkpoints at [${cks.join(", ")}], a ${job.arm} twin writes none`;
  return null;
}
/** A sham manifest's checkpoint entry at S (forkManifestProblem has passed). */
export function shamCheckpoint(text: string, at = S): { step: number; file: string; hash: string } | null {
  const m = parse(text);
  if (typeof m === "string") return null;
  return checkpointsOf(m).find((c) => c.step === at) ?? null;
}

/** The dead-base rule: replaced iff the census at S has livingCells exactly 0. A small base stays; an unreadable one is not dead (it fails instead). */
export const replacementNeeded = (livingCellsAtS: unknown): boolean => livingCellsAtS === 0;

/**
 * The base seeds in use, slot by slot: 3901..3910, each base whose census at S is dead replaced by the next unused replacement seed,
 * in order. `livingAtS(seed)` reads that base's livingCells at S (undefined: the base has not run yet, so the walk stops there; null:
 * no readable census, the base stays and fails its own checks). Returns the seeds decided so far, the replacements, and whether the
 * walk is complete; throws ReplacementsExhausted when the replacement seeds run out (the note: the launch stops, nothing is called).
 */
export class ReplacementsExhausted extends Error {}
export async function pickSeeds(livingAtS: (seed: number) => Promise<number | null | undefined> | number | null | undefined): Promise<{
  seeds: number[];
  replacements: { slot: number; seed: number; livingCellsAtS: number; replacedBy: number }[];
  pending: number | null;
}> {
  const reps = replacementSeeds();
  let nextRep = 0;
  const seeds: number[] = [];
  const replacements: { slot: number; seed: number; livingCellsAtS: number; replacedBy: number }[] = [];
  for (const [slot, first] of baseSeeds().entries()) {
    let seed = first;
    for (;;) {
      const lc = await livingAtS(seed);
      if (lc === undefined) return { seeds, replacements, pending: seed };
      if (!replacementNeeded(lc)) break;
      if (nextRep >= reps.length) throw new ReplacementsExhausted(`seed ${seed} is dead at S and the ${reps.length} replacement seeds are used up`);
      const by = reps[nextRep++];
      replacements.push({ slot, seed, livingCellsAtS: lc as number, replacedBy: by });
      seed = by;
    }
    seeds.push(seed);
  }
  return { seeds, replacements, pending: null };
}

// ---------------------------------------------------------------------------------------------
// The nudge file.

export interface NudgeEntry2 {
  seed: number;
  arm: "nudge" | "nudge2";
  target: readonly [number, number];
  x: number;
  y: number;
  d2: number;
  B: number;
  checkpoint: string;
  manifestHash: string;
  fileSha256: string;
}
export interface NudgeFile2 {
  rule: string;
  note: string;
  S: number;
  C: number;
  seeds: number[];
  replacements: { slot: number; seed: number; livingCellsAtS: number; replacedBy: number }[];
  centres: NudgeEntry2[];
  /** Seeds whose sham failed (no centre): their nudge twins are not run and are void. */
  failed: { seed: number; reason: string }[];
}
export function nudgeFileText(f: Omit<NudgeFile2, "rule" | "note" | "S" | "C">): string {
  const body: NudgeFile2 = { rule: "anomaly-bell-v2 nudge centres", note: NOTE2_PATH, S, C, ...f };
  return JSON.stringify(body, null, 1) + "\n";
}
/** The nudge file to its seeds and centres. A seed of the file's list without both centres must be listed as failed. */
export function parseNudgeFile2(text: string): { seeds: number[]; replacements: NudgeFile2["replacements"]; centres: NudgeCentres2; failed: NudgeFile2["failed"] } {
  let o: Partial<NudgeFile2>;
  try {
    o = JSON.parse(text);
  } catch (e) {
    throw new Error(`nudges file is not JSON (${(e as Error).message})`);
  }
  if (!o || !Array.isArray(o.seeds) || !Array.isArray(o.centres) || !Array.isArray(o.replacements) || !Array.isArray(o.failed)) throw new Error("nudges file needs seeds, replacements, centres and failed arrays");
  if (o.S !== S || o.C !== C) throw new Error(`nudges file is for S ${o.S}, C ${o.C}; v2 has S ${S}, C ${C}`);
  if (o.seeds.length !== N_BASES || new Set(o.seeds).size !== N_BASES) throw new Error(`nudges file lists ${o.seeds.length} seeds, expected ${N_BASES} distinct`);
  const centres: NudgeCentres2 = {};
  for (const c of o.centres) {
    if (typeof c?.seed !== "number" || (c.arm !== "nudge" && c.arm !== "nudge2") || !Number.isInteger(c.x) || !Number.isInteger(c.y)) throw new Error(`nudges file: bad centre ${JSON.stringify(c)}`);
    if (!o.seeds.includes(c.seed)) throw new Error(`nudges file: centre for seed ${c.seed}, which is not in its seeds`);
    centres[c.seed] ??= {};
    if (centres[c.seed][c.arm]) throw new Error(`nudges file: duplicate centre for seed ${c.seed} ${c.arm}`);
    centres[c.seed][c.arm] = { x: c.x, y: c.y };
  }
  const failed = new Set(o.failed.map((f) => f.seed));
  for (const seed of o.seeds) {
    const both = !!centres[seed]?.nudge && !!centres[seed]?.nudge2;
    if (both === failed.has(seed)) throw new Error(`nudges file: seed ${seed} ${both ? "has centres and is listed as failed" : "has no centres and is not listed as failed"}`);
  }
  return { seeds: o.seeds, replacements: o.replacements, centres, failed: o.failed };
}

// ---------------------------------------------------------------------------------------------
// Stitching: a fork's input to the pair scorer.

/**
 * One twin's input stream for v1's PairScorer: at steps <= C, its base's own census (the fork has none there, and is not read); from
 * C + 100 on, the fork's censuses, the first of which must be at C + 100 and each at the cadence. `finish` checks the fork's stream is
 * exhausted after the last census (exactly FORK_CENSUSES). A failure is sticky and named. The fork iterator is closed on failure.
 */
export class Stitch {
  private dead: string | null;
  private n = 0;
  constructor(private readonly gen: AsyncIterator<Census> | null, readonly C0: number = C, readonly cadence: number = CADENCE, deadReason: string | null = null) {
    this.dead = gen === null ? (deadReason ?? "no stream") : deadReason;
  }
  /** Fork censuses read so far. */
  get forkCensuses(): number {
    return this.n;
  }
  get failure(): string | null {
    return this.dead;
  }
  async next(step: number, base: Census): Promise<TwinInput> {
    if (this.dead !== null) return { fail: this.dead };
    if (step <= this.C0) return base;
    try {
      const r = await this.gen!.next();
      if (r.done) return this.kill(`the fork ended after ${this.n} censuses, expected ${FORK_CENSUSES}`);
      const want = this.C0 + (this.n + 1) * this.cadence;
      if (r.value.rec.step !== want) return this.kill(this.n === 0 ? `the fork's first census is at step ${r.value.rec.step}, expected ${this.C0 + this.cadence}` : `the fork's census ${this.n + 1} is at step ${r.value.rec.step}, expected ${want}`);
      this.n++;
      return r.value;
    } catch (e) {
      return this.kill(e instanceof Error ? e.message : String(e));
    }
  }
  /** After the last push: one more read must find the fork finished. Null when it does, else the failure. */
  async finish(expected = FORK_CENSUSES): Promise<string | null> {
    if (this.dead !== null) return this.dead;
    if (this.n !== expected) return (await this.kill(`the fork has ${this.n} censuses, expected ${expected}`)).fail;
    try {
      const r = await this.gen!.next();
      if (!r.done) return (await this.kill(`the fork has more than ${expected} censuses (the next is at step ${r.value.rec.step})`)).fail;
    } catch (e) {
      return (await this.kill(e instanceof Error ? e.message : String(e))).fail;
    }
    return null;
  }
  async close(): Promise<void> {
    try {
      await this.gen?.return?.(undefined);
    } catch {
      /* closing a failed stream */
    }
  }
  private async kill(reason: string): Promise<{ fail: string }> {
    this.dead = reason;
    await this.close();
    return { fail: reason };
  }
}

// ---------------------------------------------------------------------------------------------
// Validity.

export interface Pre2 {
  /** No bundle and none was expected to be missing: the run is incomplete. */
  missing?: boolean;
  /** No bundle, as the launch planned (an arm the scale-down dropped, or a job after a final stop): why. Void, but not "missing". */
  notRun?: string;
  /** The base is void (its reason): its twins are void. */
  base?: string | null;
  manifest?: string | null;
  launch?: string | null;
  interventions?: string | null;
  /** The byte-level replay check (series lines and lineage rows) against the base, over (C, S] (a sham: over (C, 206,000]); its failure. */
  replay?: string | null;
}
/**
 * The reasons a twin is void (empty: valid). A sham must equal its base at every census (a difference anywhere is the replay failing,
 * R); any other twin must equal its base at or before S and differ after it. A stream failure covers the census count.
 */
export function voidReasons2(r: PairResult, arm: Arm2, pre: Pre2, S0 = S): string[] {
  const out: string[] = [];
  if (pre.missing) out.push("bundle missing");
  if (pre.notRun) out.push(pre.notRun);
  if (pre.base) out.push(`its base is void: ${pre.base}`);
  if (pre.manifest) out.push(pre.manifest);
  if (pre.launch) out.push(pre.launch);
  if (pre.interventions) out.push(pre.interventions);
  if (r.failed) {
    out.push(`stream: ${r.failed}`);
    return out;
  }
  if (arm === "sham") {
    const at = r.diffAtOrBeforeS ?? r.firstDiffStep;
    if (at !== null) out.push(`replay: the sham differs from its base at step ${at}`);
    if (pre.replay) out.push(`replay: ${pre.replay}`);
    return out;
  }
  if (pre.replay) out.push(`not its base's history up to S: ${pre.replay}`);
  if (r.diffAtOrBeforeS !== null) out.push(`differs from its base at step ${r.diffAtOrBeforeS}, at or before S = ${S0}`);
  if (r.firstDiffStep === null) out.push(`no difference from its base after S = ${S0}`);
  return out;
}
/** A sham's void reasons that are not the replay itself (missing, manifest, launch, interventions, stream, base): R is then not called. */
export const isReplayReason = (reason: string): boolean => reason.startsWith("replay: ");
export const judge2 = (r: PairResult, arm: Arm2, pre: Pre2, interventionMatter: number | null, S0 = S): TwinOutcome => {
  const reasons = voidReasons2(r, arm, pre, S0);
  return { ...r, valid: reasons.length === 0, voidReasons: reasons, interventionMatter };
};

// ---------------------------------------------------------------------------------------------
// Summary and readings.

export type Reading2 =
  | "not called: a fork is not its base's history"
  | "hears events (exploratory): the post-hoc rule holds on fresh twins"
  | "hears some events"
  | "its threshold does not hold out"
  | "the post-hoc rule did not replicate"
  | "not called"
  | "not called (incomplete)";

export interface ReplayCriterion {
  called: boolean;
  met: boolean | null;
  /** Shams that count (checks other than the replay pass), of 10. */
  n: number;
  /** Shams that differ from their base, with the first step. */
  differ: { seed: number; step: number | null }[];
  reason?: string;
}
export interface ThresholdReading {
  /** The threshold, or null when it is not called. */
  value: number | null;
  B2: { l96: Criterion; f: Criterion };
  B2_l64: Criterion;
  /** Held-out arms (B3): nudge2 at Z*2; nudge and nudge2 at Z1. */
  B3: Record<string, Criterion>;
  reading: Reading2;
  armsMet: string[];
}
export interface TwinSummary2 {
  complete: boolean;
  R: ReplayCriterion;
  /** The primary: v1's summarizeTwins on the eleven-signal D (Z*2 = the largest nudge D11), with v2's reading. */
  primary: Omit<TwinSummary, "twins" | "reading"> & { reading: Reading2; v1Reading: TwinSummary["reading"] };
  /** Reported, not deciding: the fixed Z1 with both nudge arms held out. */
  atZ1: ThresholdReading;
  /** Reported: v1's own thirteen-signal rule on the v2 twins (Z*13 from the fresh nudges), v1's reading. */
  v1Rule13: Omit<TwinSummary, "twins"> & { gated: string | null };
  twins: (TwinSummary["twins"][number] & { D13: number | null; signal13: string | null; side13: string | null; hitZ1: boolean | null })[];
}
/** Whether any decision is called. */
export const twins2Called = (s: TwinSummary2): boolean => s.R.met === true && (s.primary.B2.l96.called || s.primary.B2.f.called || s.primary.B3.called);

const gate = (c: Criterion, reason: string): Criterion => ({ ...c, called: false, met: null, reason, bound95: null });

/** R: all 10 shams count and none differs. Called only when all 10 count (their non-replay checks pass). */
export function replayCriterion(shams: readonly TwinOutcome[]): ReplayCriterion {
  const counted = shams.filter((o) => o.voidReasons.every(isReplayReason));
  const differ = counted.filter((o) => !o.valid).map((o) => ({ seed: o.seed, step: o.diffAtOrBeforeS ?? o.firstDiffStep })).sort((a, b) => a.seed - b.seed);
  const called = shams.length === PER_ARM && counted.length === PER_ARM;
  return {
    called,
    met: called ? differ.length === 0 : null,
    n: counted.length,
    differ,
    ...(called ? {} : { reason: `${counted.length} of ${PER_ARM} shams count (${shams.length} scored); R needs all of them` }),
  };
}

/** The reading table of the note, for one threshold. `b3` lists the held-out criteria (all must be called). */
function readingOf(R: ReplayCriterion, b3: Criterion[], b2: { l96: Criterion; f: Criterion }, complete: boolean): { reading: Reading2; armsMet: string[] } {
  const armsMet = (["l96", "f"] as const).filter((a) => b2[a].called && b2[a].met === true).map((a) => (a === "l96" ? "L96" : "F"));
  const nc: Reading2 = complete ? "not called" : "not called (incomplete)";
  if (R.called && R.met === false) return { reading: "not called: a fork is not its base's history", armsMet: [] };
  if (!R.called) return { reading: nc, armsMet: [] };
  if (b3.some((c) => !c.called)) return { reading: nc, armsMet };
  if (b3.some((c) => c.met === false)) return { reading: "its threshold does not hold out", armsMet };
  if (!b2.l96.called || !b2.f.called) return { reading: nc, armsMet };
  if (armsMet.length === 2) return { reading: "hears events (exploratory): the post-hoc rule holds on fresh twins", armsMet };
  if (armsMet.length === 1) return { reading: "hears some events", armsMet };
  return { reading: "the post-hoc rule did not replicate", armsMet };
}

/**
 * Hits at a fixed threshold: B2 for an arm (>= 8 of 10) or B3 for a held-out arm (<= 2 of 10), called when all 10 of the arm and all
 * 10 nudge twins are valid (the note: a criterion at Z1 needs the nudges as one at Z*2 does).
 */
function fixedCriterion(outcomes: readonly TwinOutcome[], arm: Arm, z: number, kind: "B2" | "B3"): Criterion {
  const all = outcomes.filter((o) => o.arm === arm), v = all.filter((o) => o.valid);
  const nNudge = outcomes.filter((o) => o.arm === "nudge" && o.valid).length;
  const k = v.filter((o) => o.D > z).length;
  const called = v.length === PER_ARM && nNudge === PER_ARM;
  return {
    called,
    met: called ? (kind === "B2" ? k >= B2_MIN_HITS : k <= B3_MAX_HITS) : null,
    k,
    n: PER_ARM,
    ...(called ? {} : { reason: `${v.length} of ${PER_ARM} ${arm} twins and ${nNudge} of ${PER_ARM} nudge twins are valid; a call needs all of them` }),
    bound95: called ? (kind === "B2" ? binomialLowerBound(k, PER_ARM) : binomialUpperBound(k, PER_ARM)) : null,
  };
}

/**
 * The v2 readout. `o11`: every twin judged on its eleven-signal result (results(KEEP)); `o13`: the same twins on all thirteen
 * (results()), for v1's own rule. Shams decide R only; the primary and both reported readings are over the five other arms.
 */
export function summarizeTwins2(o11: readonly TwinOutcome[], o13: readonly TwinOutcome[], opts: { S?: number; complete: boolean; dropped?: Readonly<Record<string, string>>; stopped?: string | null }): TwinSummary2 {
  const S0 = opts.S ?? S;
  // A final stop that was not "finished" (the cap before L64's phase, or a failed base or sham): the note's readout is "not called
  // (incomplete)" whatever the twins that ran show, so every criterion is gated, not only those whose twins are void.
  const stopGate = opts.stopped ? `the run stopped before it finished (${opts.stopped}): not called (incomplete)` : null;
  const complete = opts.complete && !stopGate;
  // L64 is the only arm a scale-down drops; its criterion (reported, never deciding) then says so instead of counting void twins.
  const l64Why = opts.dropped?.l64;
  const dropL64 = (c: Criterion): Criterion => (l64Why !== undefined && !c.called ? { ...c, reason: `L64 dropped by the pre-stated scale-down (${l64Why}); ${c.reason ?? ""}`.replace(/; $/, "") } : c);
  const shams = o11.filter((o) => o.arm === "sham");
  const R = replayCriterion(shams);
  // The gate on every decision: R first (missed, or not called), then a final stop that was not "finished".
  const rGate = (R.called && R.met === true ? null : R.called ? "R missed: a sham differs from its base, so nothing is called" : `R not called (${R.reason})`) ?? stopGate;

  const rest11 = o11.filter((o) => o.arm !== "sham"), rest13 = o13.filter((o) => o.arm !== "sham");
  const p = summarizeTwins(rest11, { S: S0, complete });
  const { twins: rep11, reading: v1Reading, ...pRest } = p;
  const pB2 = rGate ? { l96: gate(p.B2.l96, rGate), f: gate(p.B2.f, rGate) } : p.B2;
  const pB3 = rGate ? gate(p.B3, rGate) : p.B3;
  const pL64 = dropL64(rGate ? gate(p.B2_l64, rGate) : p.B2_l64);
  const pr = readingOf(R, [pB3], pB2, complete);

  // Z1, fixed: nudge and nudge2 held out.
  const z1b2 = { l96: fixedCriterion(rest11, "l96", Z1, "B2"), f: fixedCriterion(rest11, "f", Z1, "B2") };
  const z1b3 = { nudge: fixedCriterion(rest11, "nudge", Z1, "B3"), nudge2: fixedCriterion(rest11, "nudge2", Z1, "B3") };
  const z1l64 = fixedCriterion(rest11, "l64", Z1, "B2");
  const g = (c: Criterion) => (rGate ? gate(c, rGate) : c);
  const z1B2 = { l96: g(z1b2.l96), f: g(z1b2.f) }, z1B3 = { nudge: g(z1b3.nudge), nudge2: g(z1b3.nudge2) };
  const z1r = readingOf(R, [z1B3.nudge, z1B3.nudge2], z1B2, complete);

  const v13 = summarizeTwins(rest13, { S: S0, complete });
  const { twins: rep13, ...v13Raw } = v13;
  const v13Rest = rGate
    ? { ...v13Raw, B2: { l96: gate(v13Raw.B2.l96, rGate), f: gate(v13Raw.B2.f, rGate) }, B2_l64: gate(v13Raw.B2_l64, rGate), B3: gate(v13Raw.B3, rGate), reading: "not called" as const, armsMet: [] }
    : v13Raw;

  const by13 = new Map<string, { D: number | null; signal: string | null; side: string | null }>([...o13.filter((o) => o.arm === "sham").map((o) => [o.id, { D: o.failed ? null : o.D, signal: o.signal, side: o.side }] as const), ...rep13.map((t) => [t.id, t] as const)]);
  const o11ById = new Map(o11.map((o) => [o.id, o]));
  const shamReports = summarizeTwinsShamReports(shams);
  const twins = [...shamReports, ...rep11].map((t) => {
    const t13 = by13.get(t.id);
    const o = o11ById.get(t.id)!;
    // With R not met (or the run stopped unfinished), no hit is marked from either threshold (the counts stay in the gated criteria, which call nothing).
    return { ...t, hit: rGate ? null : t.hit, firstWindowAboveZ: rGate ? null : t.firstWindowAboveZ, D13: t13?.D ?? null, signal13: t13?.signal ?? null, side13: t13?.side ?? null, hitZ1: rGate || t.arm === "sham" || !o.valid ? null : o.D > Z1 };
  });

  return {
    complete,
    R,
    primary: { ...pRest, B2: pB2, B3: pB3, B2_l64: pL64, reading: pr.reading, armsMet: pr.armsMet, v1Reading },
    atZ1: { value: Z1, B2: z1B2, B2_l64: dropL64(g(z1l64)), B3: z1B3, reading: z1r.reading, armsMet: z1r.armsMet },
    v1Rule13: { ...v13Rest, B2_l64: dropL64(v13Rest.B2_l64), gated: rGate },
    twins,
  };
}
/** The shams' per-twin reports (no threshold applies to them). */
function summarizeTwinsShamReports(shams: readonly TwinOutcome[]): TwinSummary["twins"] {
  return shams.map((o) => ({
    id: o.id,
    arm: o.arm,
    seed: o.seed,
    valid: o.valid,
    voidReasons: o.voidReasons,
    D: o.failed ? null : o.D,
    signal: o.signal,
    side: o.side,
    hit: null,
    firstWindowAboveZ: null,
    firstDiffStep: o.diffAtOrBeforeS ?? o.firstDiffStep,
    firstSignalDiffStep: o.firstSignalDiffStep,
    dose: { ...o.dose, interventionMatter: o.interventionMatter },
    dBySignal: o.dBySignal.filter((d) => d.D > 0).sort((a, b) => b.D - a.D),
  }));
}

// ---------------------------------------------------------------------------------------------
// v1's post-hoc reading, from the committed record.

export interface PosthocV1 {
  zStar: number;
  /** The nudge seed that set it. */
  zStarSeed: number;
  zStarSignal: string;
  hits: Record<Arm, number>;
  of: Record<Arm, number>;
  /** v1's own record numbers, read back (13 signals). */
  record13: { zStar: number | null; l96: number | null; f: number | null; l64: number | null; nudge2: number | null };
}
/** D11 of a v1 record twin: the largest D among its dBySignal entries on the eleven signals (the record keeps only D > 0), else 0. */
export function recordD11(t: { dBySignal: readonly { signal: string; D: number }[] }): { D: number; signal: string | null } {
  let D = 0, signal: string | null = null;
  for (const d of t.dBySignal) if (KEEP(d.signal) && d.D > D) { D = d.D; signal = d.signal; }
  return { D, signal };
}
/** v1's post-hoc reading: Z*11 = the largest D11 among the valid nudge twins, hits per arm by D11 > Z*11 (strict). */
export function posthocV1(record: { twins: { arm: string; seed: number; valid: boolean; dBySignal: { signal: string; D: number }[] }[]; summary: { zStarPair: { value: number | null }; arms: Record<string, { hits: { k: number } | null }> } }): PosthocV1 {
  const valid = record.twins.filter((t) => t.valid);
  const nudges = valid.filter((t) => t.arm === "nudge");
  if (nudges.length !== PER_ARM) throw new Error(`v1 record: ${nudges.length} valid nudge twins, expected ${PER_ARM}`);
  let zStar = -Infinity, zStarSeed = -1, zStarSignal = "";
  for (const t of nudges) {
    const d = recordD11(t);
    if (d.D > zStar) { zStar = d.D; zStarSeed = t.seed; zStarSignal = d.signal ?? ""; }
  }
  const arms: Arm[] = ["nudge", "nudge2", "l64", "l96", "f"];
  const hits = Object.fromEntries(arms.map((a) => [a, valid.filter((t) => t.arm === a && recordD11(t).D > zStar).length])) as Record<Arm, number>;
  const of = Object.fromEntries(arms.map((a) => [a, valid.filter((t) => t.arm === a).length])) as Record<Arm, number>;
  const k = (a: string) => record.summary.arms[a]?.hits?.k ?? null;
  return { zStar, zStarSeed, zStarSignal, hits, of, record13: { zStar: record.summary.zStarPair.value, l96: k("l96"), f: k("f"), l64: k("l64"), nudge2: k("nudge2") } };
}

// ---------------------------------------------------------------------------------------------
// The cap: projection and scale-down.

export interface PilotRates {
  /** Steps per second of a base and of a fork (the runner's own stepsPerSecond). */
  rBase: number;
  rFork: number;
  /** Fixed cost per job, seconds (wall time minus steps / rate). */
  o: number;
}
export interface PlanSize {
  bases: number;
  forks: number;
  baseSteps?: number;
  forkSteps?: number;
}
/** The note's projection, hours: 1.25 x (bases x 206,000 / r_base + forks x (16,000 / r_fork + o)). */
export function project(p: PilotRates, plan: PlanSize): number {
  const bs = plan.baseSteps ?? BASE_STEPS, fs = plan.forkSteps ?? FORK_STEPS;
  return (PROJECTION_FACTOR * (plan.bases * (bs / p.rBase) + plan.forks * (fs / p.rFork + p.o))) / 3600;
}
/**
 * Projected seconds of one job: the pilot's terms with the factor, or, once a job of that kind has finished in the main run, the larger
 * of that and the factor times the slowest one observed (`observedMax`). The pilot's world is young: in v1's twin logs the runner's
 * mean rate at step 200,000 was 0.75 to 1.08 of its rate at step 16,000, so a fork of a mature world can be slower than the pilot says.
 */
export function jobSeconds(p: PilotRates, kind: "base" | "fork", observedMax: number | null = null): number {
  const pilot = PROJECTION_FACTOR * (kind === "base" ? BASE_STEPS / p.rBase : FORK_STEPS / p.rFork + p.o);
  return observedMax !== null && observedMax > 0 ? Math.max(pilot, PROJECTION_FACTOR * observedMax) : pilot;
}
export type ScaleMode = "full" | "drop-l64" | "stop-at-cap";
/** The scale-down ladder: full if the 70 jobs fit; else drop L64 (60 jobs); else run in order and start nothing past the cap. */
export function scaleDown(p: PilotRates, capHours = CAP_HOURS, usedSeconds = 0): { mode: ScaleMode; drop: Arm2[]; hours: { full: number; dropL64: number; used: number }; capHours: number } {
  const used = usedSeconds / 3600;
  const full = used + project(p, { bases: N_BASES, forks: N_BASES * ARMS2.length });
  const dropL64 = used + project(p, { bases: N_BASES, forks: N_BASES * (ARMS2.length - 1) });
  const mode: ScaleMode = full <= capHours ? "full" : dropL64 <= capHours ? "drop-l64" : "stop-at-cap";
  return { mode, drop: mode === "full" ? [] : ["l64"], hours: { full, dropL64, used }, capHours };
}
/** Whether a job may start: its projected end (elapsed + its projected seconds, `jobSeconds`) is within the cap. */
export const mayStart = (elapsedSeconds: number, p: PilotRates, kind: "base" | "fork", capHours = CAP_HOURS, observedMax: number | null = null): boolean =>
  elapsedSeconds + jobSeconds(p, kind, observedMax) <= capHours * 3600;

// ---------------------------------------------------------------------------------------------
// The launch log (<root>/bell-v2-launch/launch.jsonl): one cumulative budget, attempts, and whether the main run is over.

/** One launch.jsonl line. Every line carries the launch's id and mode and the cumulative elapsed seconds of the budget. */
export interface LaunchEvent {
  event: string;
  at?: string;
  elapsed?: number;
  mode?: string;
  launch?: string;
  [k: string]: unknown;
}
/** A launch writes a heartbeat this often: a launch killed without a closing event is undercounted by at most this. */
export const HEARTBEAT_SECONDS = 60;
/** The events that close a launch. "stop" with final: true closes the main run for good. */
export const CLOSING_EVENTS: readonly string[] = ["stop", "error", "interrupted"];
export function parseLaunchEvents(text: string): LaunchEvent[] {
  const out: LaunchEvent[] = [];
  text.split("\n").forEach((l, i) => {
    if (!l.trim()) return;
    let o: unknown;
    try {
      o = JSON.parse(l);
    } catch (e) {
      throw new Error(`launch.jsonl line ${i + 1} is not JSON (${(e as Error).message})`);
    }
    if (o === null || typeof o !== "object" || typeof (o as LaunchEvent).event !== "string") throw new Error(`launch.jsonl line ${i + 1} has no event`);
    out.push(o as LaunchEvent);
  });
  return out;
}
/**
 * The launches of one mode (the main run's by default), in order: id, the largest elapsed logged, its start event and its closing
 * event (null: killed without one).
 */
export function runLaunches(events: readonly LaunchEvent[], mode: "run" | "pilot" = "run"): { launch: string; maxElapsed: number; start: LaunchEvent | null; close: LaunchEvent | null; events: number }[] {
  const by = new Map<string, { launch: string; maxElapsed: number; start: LaunchEvent | null; close: LaunchEvent | null; events: number }>();
  for (const e of events) {
    if (e.mode !== mode || typeof e.launch !== "string") continue;
    const r = by.get(e.launch) ?? { launch: e.launch, maxElapsed: 0, start: null, close: null, events: 0 };
    r.events++;
    if (typeof e.elapsed === "number" && e.elapsed > r.maxElapsed) r.maxElapsed = e.elapsed;
    if (e.event === "start" && r.start === null) r.start = e;
    if (CLOSING_EVENTS.includes(e.event)) r.close = e;
    by.set(e.launch, r);
  }
  return [...by.values()];
}
/**
 * The last launch of a mode when it ended without a closing event (killed), with the job id of its last attempt-start, or null. Its
 * child may have outlived it (orphanAttempt, orphanEndElapsed).
 */
export function lastUnclosed(events: readonly LaunchEvent[], mode: "run" | "pilot" = "run"): { launch: string; attemptId: string | null; attempt: number | null } | null {
  const ls = runLaunches(events, mode);
  const last = ls[ls.length - 1];
  if (!last || last.close !== null) return null;
  let attemptId: string | null = null, attempt: number | null = null;
  for (const e of events) {
    if (e.mode === mode && e.launch === last.launch && e.event === "attempt-start" && typeof e.id === "string") {
      attemptId = e.id;
      attempt = typeof e.attempt === "number" ? e.attempt : null;
    }
  }
  return { launch: last.launch, attemptId, attempt };
}
/**
 * The attempt a killed launch left running, if any: its last attempt-start, unless jobs.jsonl holds that very attempt's line (same
 * launch, id and attempt number; a line without them never matches, so the attempt stays unfinished, which charges more, not less).
 * Matched per attempt, not per job: an earlier interrupted attempt of the same job does not make a later finished one an orphan.
 */
export function orphanAttempt(events: readonly LaunchEvent[], jobLines: readonly JobLine[], mode: "run" | "pilot" = "run"): { launch: string; id: string; attempt: number | null } | null {
  const dead = lastUnclosed(events, mode);
  if (!dead || dead.attemptId === null) return null;
  const done = jobLines.some((l) => l.id === dead.attemptId && l.launch === dead.launch && l.attempt === dead.attempt);
  return done ? null : { launch: dead.launch, id: dead.attemptId, attempt: dead.attempt };
}
/**
 * Seconds of the one budget already used when a launch of `mode` starts. Every launch's clock starts where the budget stood, so the
 * largest cumulative elapsed any launch logged already holds everything before it, a predecessor's allowance included; pilot launches
 * count toward the pilot's own cap the same way. The main run starts from at least the pilot's recorded wall time (cumulative over
 * the pilot's launches). Only the last launch, when it has no closing event, adds anything: HEARTBEAT_SECONDS (what a killed launch
 * leaves unlogged), or, when it was killed while a child ran, `orphanEndElapsed` (the budget second that child's alarm fires at),
 * whichever is larger. No wall clock enters: only the launches' own cumulative seconds and the logged alarm.
 */
export function budgetUsed(events: readonly LaunchEvent[], pilotWallSeconds: number, mode: "run" | "pilot" = "run", orphanEndElapsed: number | null = null): number {
  const ls = runLaunches(events, mode);
  let used = Math.max(mode === "run" ? pilotWallSeconds : 0, ...ls.map((l) => l.maxElapsed));
  const last = ls[ls.length - 1];
  if (last && last.close === null) {
    used = Math.max(used, last.maxElapsed + HEARTBEAT_SECONDS, orphanEndElapsed ?? 0);
  }
  return used;
}
/**
 * The budget second (cumulative elapsed) up to which a killed launch's orphaned attempt is charged: its attempt-start's elapsed plus
 * its `alarmSeconds`, the moment perl's alarm kills it at the latest. Nothing records when the child really ended (a stalled one can
 * stop writing long before it dies) and no clock survives the launcher that a stepped wall clock cannot move, so the whole alarm is
 * charged: the alarm runs to the cap plus 90 s, so a launcher killed outright mid-job spends the budget. Null when that attempt-start
 * (or its elapsed or alarm) is not in the log; the launcher then stops rather than guess.
 */
export function orphanEndElapsed(events: readonly LaunchEvent[], launch: string, attemptId: string, attempt: number | null): number | null {
  let start: LaunchEvent | null = null;
  for (const e of events) if (e.launch === launch && e.event === "attempt-start" && e.id === attemptId && (attempt === null || e.attempt === attempt)) start = e;
  if (start === null || typeof start.elapsed !== "number" || typeof start.alarmSeconds !== "number" || !Number.isFinite(start.alarmSeconds)) return null;
  return start.elapsed + start.alarmSeconds;
}
/**
 * The pilot ledger behind a pilot record: the pilot's cumulative time over every pilot launch in its launch.jsonl (the record's own
 * wall time at least), and why the record does not close that ledger (null when it does): the record must come from the ledger's last
 * pilot launch. A later pilot launch, interrupted or with another --record, would
 * otherwise leave its time out of the main run's budget.
 */
export function pilotLedger(events: readonly LaunchEvent[], recordLaunch: unknown, recordWallSeconds: number): { used: number; problem: string | null } {
  const ls = runLaunches(events, "pilot");
  const used = Math.max(recordWallSeconds, budgetUsed(events, 0, "pilot"));
  const last = ls[ls.length - 1];
  if (!last) return { used, problem: "its launch.jsonl holds no pilot launch" };
  if (last.launch !== recordLaunch) return { used, problem: `the record is from launch ${String(recordLaunch)}, but the last pilot launch in the ledger is ${last.launch}` };
  // Its closing stop is written after the record: a pilot killed in between left no job running, and `used` already holds the
  // heartbeat budgetUsed charges an unclosed launch.
  return { used, problem: null };
}
/**
 * The experiment, seed and bundle directory (relative to the root) of a job id, base-<seed> or twin-<arm>-<seed>, or null (a nudge's
 * destination does not depend on its centre).
 */
export function jobOfId(id: string): Pick<Job2, "experiment" | "seed" | "rel"> | null {
  let m = /^base-(\d+)$/.exec(id);
  if (m) return { experiment: BASE_EXPERIMENT, seed: Number(m[1]), rel: relOf(BASE_EXPERIMENT, Number(m[1])) };
  m = /^twin-([a-z0-9]+)-(\d+)$/.exec(id);
  if (m && (ARMS2 as readonly string[]).includes(m[1])) {
    const j = forkJob(m[1] as Arm2, Number(m[2]), null);
    return { experiment: j.experiment, seed: j.seed, rel: j.rel };
  }
  return null;
}
/**
 * Why a job's bundle is absent, when the launch accounts for it (null: it is missing, unexpectedly). Decided per job from its own
 * jobs.jsonl history (`last`: its last line), then the run's drops and stop: a job whose last line is a clean exit 0 should have its
 * bundle, so its absence is "missing" whatever else happened; a dropped arm's job is dropped; a job killed at the cap, or that
 * exited nonzero on its last attempt, was moved aside; any other absent job after a final stop that was not "finished" was not run.
 */
export function absenceOf(
  arm: string,
  last: { exit: number; timeout?: boolean } | undefined,
  run: { droppedWhy: Record<string, string>; finished: boolean; stopReason: string | null },
): string | null {
  if (cleanExit(last)) return null;
  if (run.droppedWhy[arm] !== undefined) return `dropped by ${run.droppedWhy[arm]}`;
  if (last && last.timeout === true) return "killed at the cap (moved aside)";
  if (last) return `exited ${last.exit} on its last attempt (moved aside)`;
  if (!run.finished) return `not run: the launch stopped (${String(run.stopReason)})`;
  return null;
}
export interface JobLine {
  id: string;
  exit: number;
  seconds?: number;
  timeout?: boolean;
  /** The launch and attempt number that wrote the line (orphanAttempt). */
  launch?: string;
  attempt?: number;
}
/** A job's line says it finished on its own: exit 0, and not killed at the cap (a child the cap's SIGTERM caught can still exit 0). */
export const cleanExit = (l: { exit: number; timeout?: boolean } | undefined): boolean => !!l && l.exit === 0 && l.timeout !== true;
/**
 * Attempts per job id, counted across launches: every attempt-start event, less the attempts the cap ended (jobs.jsonl lines with
 * timeout: true; the cap, not the job, stopped them). An attempt that started and never wrote its line (the launcher was killed) counts.
 */
export function attemptsOf(events: readonly LaunchEvent[], jobLines: readonly JobLine[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of events) if (e.event === "attempt-start" && typeof e.id === "string") out.set(e.id, (out.get(e.id) ?? 0) + 1);
  for (const l of jobLines) if (l.timeout === true && out.has(l.id)) out.set(l.id, Math.max(0, out.get(l.id)! - 1));
  return out;
}
/** Started attempts with no jobs.jsonl line (an interrupted launch), per id. */
export function unfinishedAttempts(events: readonly LaunchEvent[], jobLines: readonly JobLine[]): Map<string, number> {
  const started = new Map<string, number>(), ended = new Map<string, number>();
  for (const e of events) if (e.event === "attempt-start" && typeof e.id === "string") started.set(e.id, (started.get(e.id) ?? 0) + 1);
  for (const l of jobLines) ended.set(l.id, (ended.get(l.id) ?? 0) + 1);
  const out = new Map<string, number>();
  for (const [id, n] of started) if (n > (ended.get(id) ?? 0)) out.set(id, n - (ended.get(id) ?? 0));
  return out;
}
/**
 * Whether the main run is over: its last launch closed with a final stop (finished, void, or the cap reached; the budget is one, so
 * nothing resumes after it). `finished`: every job of the plan ran (L64 may be dropped). `dropped`: the arms the scale-down dropped,
 * from the launches' "dropped" events.
 */
export function launchState(events: readonly LaunchEvent[]): { over: boolean; finished: boolean; stop: LaunchEvent | null; dropped: Arm2[]; droppedWhy: Record<string, string> } {
  const ls = runLaunches(events);
  const last = ls[ls.length - 1];
  const stop = last?.close && last.close.event === "stop" && last.close.final === true ? last.close : null;
  const droppedWhy: Record<string, string> = {};
  for (const e of events) if (e.mode === "run" && e.event === "dropped" && typeof e.arm === "string") droppedWhy[e.arm] = String(e.why ?? e.mode);
  return { over: stop !== null, finished: stop?.reason === "finished", stop, dropped: Object.keys(droppedWhy) as Arm2[], droppedWhy };
}

// ---------------------------------------------------------------------------------------------
// Other GPU users.

/**
 * The repo's deno entry points that open a WebGPU device (tools/*.ts that call requestDevice or runExperiment; a vitest keeps this list
 * equal to the files that do), plus tools/calibrate.ts, which the note names. Every tests/deno script counts too.
 */
export const GPU_TOOLS: readonly string[] = [
  "assay", "biogeo-smoke", "biogeo-sweep", "bootstrap", "breed", "calibrate", "horizon", "island", "obligates-x", "retest", "run", "scaffold", "scaffold-assays",
];
const GPU_TOOL_NAMES = GPU_TOOLS.map((t) => t.replace(/-/g, "\\-")).join("|");
/**
 * A GPU entry point by its script argument: tools/<name>.ts under any directory, a tests/deno script, or <name>.ts with no directory
 * (or ./), which is a script run from inside tools/ (cwd-relative). A bare name in another directory (other/run.ts) is not matched.
 */
const GPU_TOOL_RE = new RegExp(`(^|/)(tools/(${GPU_TOOL_NAMES})\\.ts|tests/deno/[^\\s/]+\\.ts)$|^(\\./)?(${GPU_TOOL_NAMES})\\.ts$`);
/** The argv tokens of a ps command line (split on spaces; the program path may hold spaces only for an app bundle, which deno is not). */
const argvOf = (cmd: string): string[] => cmd.trim().split(/\s+/);
/** Whether a ps command line is a deno process itself (its program's basename is deno), not a shell or wrapper whose text mentions deno. */
export const isDenoProcess = (cmd: string): boolean => /(^|\/)deno$/.test(argvOf(cmd)[0] ?? "");
/** The script a deno process runs (`deno run [flags] x.ts`, or deno 2's `deno [flags] x.ts`): its first argument ending in .ts that is not a flag. */
export function denoScript(cmd: string): string | null {
  if (!isDenoProcess(cmd)) return null;
  return argvOf(cmd).slice(1).find((x) => !x.startsWith("-") && x.endsWith(".ts")) ?? null;
}
/**
 * The processes in `ps -axo pid=,command=` output that use the GPU (the note's list): a deno process (its program is deno; a wrapper
 * shell is not) running one of GPU_TOOLS or a tests/deno script, or a Chrome started by Playwright or gen:cards. `ignore`: pids to skip.
 */
export function gpuUsers(psText: string, ignore: readonly number[] = []): { pid: number; command: string }[] {
  const out: { pid: number; command: string }[] = [];
  for (const line of psText.split("\n")) {
    const m = /^\s*(\d+)\s+(.*)$/.exec(line);
    if (!m) continue;
    const pid = Number(m[1]), cmd = m[2];
    if (ignore.includes(pid)) continue;
    const script = denoScript(cmd);
    const denoGpu = script !== null && GPU_TOOL_RE.test(script);
    // The executable is the command up to its first flag (Chrome's path can hold spaces): a Chrome binary, started by Playwright
    // (its ms-playwright install or a playwright profile) or with WebGPU forced on, and not one of its helper processes.
    const exe = cmd.split(" --")[0].trim();
    const chromeExe = /(Google Chrome( for Testing)?|Chromium|chrome-headless-shell|\/chrome)$/i.test(exe);
    const chrome = chromeExe && /(ms-playwright|playwright_chrom|--enable-unsafe-webgpu)/i.test(cmd) && !/--type=(renderer|utility|zygote|crashpad-handler)/.test(cmd);
    const cards = script !== null && /apps\/lab\/scripts\/social-cards\.ts$/.test(script);
    if (denoGpu || chrome || cards) out.push({ pid, command: cmd.slice(0, 200) });
  }
  return out;
}
/**
 * A ps command line reduced to its program and script basename (tools/lib/horizon.ts reducePsLine, the slice-34 scrub): no
 * argument and no path, so a launch event can go into a committed record. "unknown" when it is not one.
 */
export function reducedCommand(command: string): string {
  return reducePsLine(`0 0 0 ${command}`)?.replace(/^0 0 0 /, "") ?? "unknown";
}
/**
 * A launch event as a committed record carries it: a gpu-wait's users with their commands reduced (reducedCommand), and in every
 * string field any /Users/... or /private/... path replaced by "[redacted]", except a field that is itself one path under `root`
 * (the output root, which the tools read back, such as a moved-aside directory). Idempotent; the launch log is left as written.
 */
export function scrubLaunchEvent(e: LaunchEvent, root: string): LaunchEvent {
  const redact = (v: unknown): unknown =>
    typeof v === "string"
      ? root !== "" && (v === root || v.startsWith(`${root}/`)) && !/\s/.test(v)
        ? v
        : v.replace(/\/(?:Users|private)\/[^\s"',)]*/g, "[redacted]")
      : Array.isArray(v)
        ? v.map(redact)
        : v !== null && typeof v === "object"
          ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, redact(x)]))
          : v;
  // The commands are reduced first (the reduction reads the script's path), then every string is redacted.
  const reduced: LaunchEvent = e.event === "gpu-wait" && Array.isArray(e.users)
    ? { ...e, users: (e.users as { pid?: unknown; command?: unknown }[]).map((u) => ({ pid: u.pid, command: typeof u.command === "string" ? reducedCommand(u.command) : "unknown" })) }
    : e;
  return redact(reduced) as LaunchEvent;
}
/** Other bell v2 launchers in ps output: deno processes running tools/bell2-launch.ts (not a dry run), other than `self`. */
export function otherLaunchers(psText: string, self: number): number[] {
  const out: number[] = [];
  for (const line of psText.split("\n")) {
    const m = /^\s*(\d+)\s+(.*)$/.exec(line);
    if (!m || Number(m[1]) === self) continue;
    const script = denoScript(m[2]);
    if (script !== null && /(^|\/)tools\/bell2-launch\.ts$/.test(script) && !/\s--dry-run(\s|$)/.test(m[2])) out.push(Number(m[1]));
  }
  return out;
}
/** A live tools/run.ts process writing this job's bundle (an attempt an interrupted launch left behind), by its --experiment and --seeds. */
export function liveRunOf(psText: string, job: Pick<Job2, "experiment" | "seed">): number[] {
  const out: number[] = [];
  for (const line of psText.split("\n")) {
    const m = /^\s*(\d+)\s+(.*)$/.exec(line);
    if (!m) continue;
    const script = denoScript(m[2]);
    if (script === null || !/(^|\/)tools\/run\.ts$/.test(script)) continue;
    const argv = argvOf(m[2]);
    const val = (f: string) => argv[argv.indexOf(f) + 1];
    if (argv.includes("--experiment") && val("--experiment") === job.experiment && val("--seeds") === String(job.seed)) out.push(Number(m[1]));
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Records.

/** The default record path: the official one when the record is complete or called something, else ".incomplete". */
export function defaultRecord2(official: boolean): string {
  return `experiments/naturalist/bell-v2-twins${official ? "" : ".incomplete"}.json`;
}
/** The window rule's span, for the record. */
export const windowSpan = { W_pair: W_PAIR, firstCensus: [S + EARLY_FROM, S + EARLY_TO], lastCensusRead: S + EARLY_TO + (W_PAIR - 1) * CADENCE } as const;
export { NUDGE_TARGETS };
