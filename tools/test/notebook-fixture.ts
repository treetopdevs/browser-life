// Synthetic lockstep data for the notebook tests: the bell (BellScorer) and the notebook's own trace (ZTrace) fed the same signal
// vectors, as tools/notebook.ts feeds them, without any file.
import { readFileSync } from "node:fs";
import { BellScorer, SIGNALS, corpusRuns, type ScoringResult } from "../lib/bell.ts";
import { NOTEBOOK_W, ZTrace, buildNotebook, crossCheck, nextUp, parseBellRecord, planNotebook, type BellRecord, type NotebookMeta, type NotebookModel, type NotebookPlan, type PlannedSubject, type SubjectManifest } from "../lib/notebook.ts";

export const NS = SIGNALS.length;
export const IDX = Object.fromEntries(SIGNALS.map((s, i) => [s.name, i])) as Record<string, number>;
export const RECORD_TEXT = readFileSync(new URL("../../experiments/naturalist/bell-v0.json", import.meta.url), "utf8");
export const record = (): BellRecord => parseBellRecord(RECORD_TEXT);

export function prng(seed: number) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export type ValueFn = (run: number, i: number, s: number) => number | null;
/**
 * Runs 0..nEnv-1 are the envelope. The subject is run `member` (leave-one-out) when given, else run nEnv (not a member).
 * Census i is at step (i + 1) * cadence.
 */
export function harness(o: { nEnv: number; censuses: number; zStar: number; value: ValueFn; member?: number; cadence?: number; burnIn?: number; recordD?: number | null }) {
  const cadence = o.cadence ?? 100, burnIn = o.burnIn ?? 1000;
  const nRuns = o.nEnv + (o.member === undefined ? 1 : 0);
  const subject = o.member ?? o.nEnv;
  const envelope = Array.from({ length: o.nEnv }, (_, i) => i);
  const zRing = nextUp(o.zStar);
  const scorer = new BellScorer(Array.from({ length: nRuns }, (_, i) => `run-${i}`), [{ id: "all-neutral", members: envelope }], [{ id: "subject", run: subject, envelope: "all-neutral" }], { Z: [zRing], W: [NOTEBOOK_W], cadence, burnIn });
  const trace = new ZTrace(o.censuses, envelope, subject, burnIn);
  for (let i = 0; i < o.censuses; i++) {
    const step = (i + 1) * cadence;
    const vectors = Array.from({ length: nRuns }, (_, r) => Array.from({ length: NS }, (_, s) => o.value(r, i, s)));
    scorer.push(vectors.map((values) => ({ step, values })));
    trace.push(step, vectors);
  }
  const result: ScoringResult = scorer.results()[0];
  return { result, trace, zRing, subject, cadence, burnIn };
}

/** A window [from, to] of censuses on (signal) at `level`, else `base`. */
export const excursions = (base: number, spans: { s: number; from: number; to: number; level: number }[]) => (i: number, s: number) => {
  for (const sp of spans) if (sp.s === s && i >= sp.from && i <= sp.to) return sp.level;
  return base;
};

export const IDENTITY = "e1c93a9384b5d921";
export function manifestFor(id: string, censuses: number, cadence = 100): SubjectManifest {
  const [experiment, presetId, condition, seed] = id.split("/");
  return { spec: { experiment, presetId, condition, seed: Number(seed.replace("seed-", "")), steps: censuses * cadence, censusEvery: cadence }, cfg: { neutral: condition === "neutral" }, presetIdentity: IDENTITY };
}
export const gradientCorpus = () => corpusRuns().filter((r) => r.preset === "gradient-m3").map((run) => ({ run, real: `/base/${run.rel}` }));

const META = (subjectDir: string, envelopeIds: readonly string[]): NotebookMeta => ({
  generated: "2026-10-17",
  recordPath: "experiments/naturalist/bell-v0.json",
  recordSha256: "0".repeat(64),
  base: "runs",
  envelopeSources: envelopeIds.flatMap((id) => ["manifest.json", "series.jsonl", "lineages.tsv"].map((f, j) => ({ path: `runs/${id}/${f}`, bytes: 1000 * (j + 1) }))),
  sources: [{ path: `${subjectDir}/manifest.json`, bytes: 1991 }, { path: `${subjectDir}/series.jsonl`, bytes: 123456 }, { path: `${subjectDir}/lineages.tsv`, bytes: 20861806 }],
});

/**
 * A notebook model over the 40-run gradient-m3 envelope (synthetic values, the real record's Z*). kind "rings": a bundle outside
 * the corpus with livingCells and individuals high from census 150 to 260 and meanMass low from 300 to the end; "quiet": the same
 * bundle at baseline; "calibration": the replay-calib neutral seed-1001 directory, at baseline; "held-out": the rings values on
 * the corpus directory of replay-m4 neutral seed-15 (an envelope member, scored leave-one-out).
 */
export function sampleModel(kind: "rings" | "quiet" | "calibration" | "held-out", opts: { id?: string } = {}): NotebookModel {
  const rec = record();
  const censuses = 400, cadence = 100;
  const rnd = prng(7);
  const env: number[][][] = Array.from({ length: 40 }, () => Array.from({ length: censuses }, () => Array.from({ length: NS }, () => 1000 + Math.round((rnd() - 0.5) * 100))));
  const sid = opts.id ?? "sandbox/gradient-m3/treatment/seed-7";
  const calib = kind === "calibration", held = kind === "held-out";
  const subjectId = calib ? "replay-calib/gradient-m3/neutral/seed-1001" : held ? "replay-m4/gradient-m3/neutral/seed-15" : sid;
  const subjectDir = calib || held ? `/base/${subjectId}` : `/elsewhere/${sid}`;
  const plan = planNotebook({ preset: "gradient-m3", record: rec, subjects: [{ dir: subjectDir, real: subjectDir, manifest: manifestFor(subjectId, censuses, cadence) }], corpus: gradientCorpus() });
  const subject = { ...plan.subjects[0], recordD: null };
  const ex = kind === "rings" || held
    ? excursions(1000, [
      { s: IDX.livingCells, from: 150, to: 260, level: 3000 },
      { s: IDX.individuals, from: 150, to: 260, level: 4000 },
      { s: IDX.meanMass, from: 300, to: censuses - 1, level: 50 },
    ])
    : () => 1000;
  const value: ValueFn = (r, i, s) => {
    if (SIGNALS[s].kind === "rate" && i < 10) return null;
    return r === subject.run && !calib ? ex(i, s) : r === subject.run ? 1000 : env[r][i][s];
  };
  const h = harness({ nEnv: 40, censuses, zStar: plan.zStar, value, member: calib || held ? subject.run : undefined, cadence, burnIn: 10_000 });
  const rings = crossCheck(h.result, h.trace, { id: subject.id, zStar: plan.zStar, zRing: plan.zRing, recordD: null });
  return buildNotebook({ plan, subject, result: h.result, trace: h.trace, rings, record: rec, meta: META(subjectDir, plan.envelopeIds) });
}

/**
 * A model straight from a small harness run (zStar fixed by the caller, not the record's), for checking the wiring from trace to page:
 * a hand-built plan and subject, the real record for the first page. The subject is outside the corpus, condition as given.
 */
export function harnessModel(h: ReturnType<typeof harness>, o: { zStar: number; nEnv: number; censuses: number; condition?: string }): NotebookModel {
  const rec = record();
  const rings = crossCheck(h.result, h.trace, { id: "subject", zStar: o.zStar, zRing: h.zRing, recordD: null });
  const id = `sandbox/gradient-m3/${o.condition ?? "treatment"}/seed-1`;
  const envelopeIds = Array.from({ length: o.nEnv }, (_, i) => `run-${i}`);
  const plan = { preset: "gradient-m3", zStar: o.zStar, zRing: h.zRing, runs: [], envelope: envelopeIds.map((_, i) => i), envelopeIds, subjects: [], presetIdentity: IDENTITY } as unknown as NotebookPlan;
  const subject = { dir: "/elsewhere/s", real: "/elsewhere/s", manifest: manifestFor(id, o.censuses, h.cadence), id, corpusRun: null, run: o.nEnv, member: false, calibration: false, recordD: null, outName: "s" } as PlannedSubject;
  return buildNotebook({ plan, subject, result: h.result, trace: h.trace, rings, record: rec, meta: META("/elsewhere/s", envelopeIds) });
}
