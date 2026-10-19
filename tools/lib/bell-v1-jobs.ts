// The anomaly bell v1's GPU corpus (docs/naturalist-bell-v1-plan-2026-10-17.md, "Fixed before running", parts A and B):
// the 70 fresh neutral nulls and the 50 treatment twins, as tools/run.ts invocations, plus the nudge-centre rule. Pure; no
// Deno or filesystem access, so vitest can load it. The launcher is tools/bell-v1-launch.ts.

export const S = 200_000;
export const STEPS = 300_000;
export const NULL_SEEDS: readonly [number, number] = [2002, 2071];
export const BASE_SEEDS: readonly [number, number] = [1, 10];
export const NULL_EXPERIMENT = "bell-v1-null";
export const TWIN_EXPERIMENT_PREFIX = "bell-v1-twins-";
/** Where a nudge looks for biomass, per nudge arm. */
export const NUDGE_TARGETS: Readonly<Record<"nudge" | "nudge2", readonly [number, number]>> = { nudge: [128, 128], nudge2: [64, 64] };
export const BIG_CENTRE: readonly [number, number] = [128, 128];

export type Arm = "nudge" | "nudge2" | "l64" | "l96" | "f";
export const ARMS: readonly Arm[] = ["nudge", "nudge2", "l64", "l96", "f"];

const range = ([a, b]: readonly [number, number]) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

/**
 * The cell with B > 0 nearest (cx, cy) on a W x H torus, by squared Euclidean distance with each axis wrapped (the lesion's own
 * neighbourhood, `sim.nb`); ties go to the smaller y, then the smaller x. `biomass` is the B channel, row-major (index y * W + x).
 * Null when no cell has biomass.
 */
export function nearestBiomass(biomass: ArrayLike<number>, W: number, H: number, cx: number, cy: number): { x: number; y: number; d2: number } | null {
  if (biomass.length !== W * H) throw new Error(`nearestBiomass: ${biomass.length} cells for a ${W}x${H} world`);
  let best: { x: number; y: number; d2: number } | null = null;
  for (let y = 0; y < H; y++) {
    const ay = Math.abs(y - cy), dy = Math.min(ay, H - ay);
    for (let x = 0; x < W; x++) {
      if (!(biomass[y * W + x] > 0)) continue;
      const ax = Math.abs(x - cx), dx = Math.min(ax, W - ax);
      const d2 = dx * dx + dy * dy;
      // Scanning y then x ascending, a strictly smaller distance is the only way to replace: equal ones keep the earlier (smaller y, then x).
      if (!best || d2 < best.d2) best = { x, y, d2 };
    }
  }
  return best;
}

export interface Job {
  /** Unique label, also the log file name. */
  id: string;
  part: "A" | "B";
  arm: Arm | "null";
  seed: number;
  experiment: string;
  condition: "neutral" | "treatment";
  /** The run's bundle directory, relative to the runs root. */
  rel: string;
  /** The intervention flag pair for tools/run.ts ([] for a null). */
  intervention: string[];
  /** The scheduled entry the bundle's interventions.jsonl must hold (null for a null run). */
  expected: { step: number; kind: "lesion" | "feed"; x: number; y: number; r: number; amount?: number } | null;
}

/** Nudge centres per base seed and nudge arm, from the S checkpoints. */
export type NudgeCentres = Record<number, Record<"nudge" | "nudge2", { x: number; y: number }>>;

/** All 120 jobs, nulls first (seed order), then twins (seed, then arm order). */
export function planJobs(nudges: NudgeCentres): Job[] {
  const jobs: Job[] = [];
  for (const seed of range(NULL_SEEDS)) {
    jobs.push({ id: `null-${seed}`, part: "A", arm: "null", seed, experiment: NULL_EXPERIMENT, condition: "neutral", rel: `${NULL_EXPERIMENT}/gradient-m3/neutral/seed-${seed}`, intervention: [], expected: null });
  }
  for (const seed of range(BASE_SEEDS)) {
    for (const arm of ARMS) {
      const experiment = `${TWIN_EXPERIMENT_PREFIX}${arm}`;
      let expected: Job["expected"];
      if (arm === "nudge" || arm === "nudge2") {
        const c = nudges[seed]?.[arm];
        if (!c) throw new Error(`no ${arm} centre for seed ${seed}`);
        expected = { step: S, kind: "lesion", x: c.x, y: c.y, r: 1 };
      } else if (arm === "l64" || arm === "l96") {
        expected = { step: S, kind: "lesion", x: BIG_CENTRE[0], y: BIG_CENTRE[1], r: arm === "l64" ? 64 : 96 };
      } else {
        expected = { step: S, kind: "feed", x: BIG_CENTRE[0], y: BIG_CENTRE[1], r: 32, amount: 64 };
      }
      const intervention = expected.kind === "lesion" ? ["--lesion", `${S}:${expected.x},${expected.y},${expected.r}`] : ["--feed", `${S}:${expected.x},${expected.y},${expected.r},${expected.amount}`];
      jobs.push({ id: `twin-${arm}-${seed}`, part: "B", arm, seed, experiment, condition: "treatment", rel: `${experiment}/gradient-m3/treatment/seed-${seed}`, intervention, expected });
    }
  }
  return jobs;
}

/** The tools/run.ts arguments of a job (after `deno run -A tools/run.ts`). */
export function runArgs(job: Job, outRoot: string): string[] {
  return [
    "--experiment", job.experiment, "--preset", "gradient-m3", "--conditions", job.condition, "--seeds", String(job.seed),
    "--steps", String(STEPS), "--census", "100", "--deep", "10", "--lineage-obs", ...job.intervention, "--out", outRoot,
  ];
}

/** Problems with a job list: duplicate ids or destinations, experiment names validateSpec would refuse. Empty when fine. */
export function jobProblems(jobs: readonly Job[]): string[] {
  const out: string[] = [];
  const seen = new Map<string, string>();
  const ids = new Set<string>();
  for (const j of jobs) {
    if (ids.has(j.id)) out.push(`duplicate job id ${j.id}`);
    ids.add(j.id);
    if (seen.has(j.rel)) out.push(`${j.id} and ${seen.get(j.rel)} share ${j.rel}`);
    seen.set(j.rel, j.id);
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(j.experiment)) out.push(`${j.id}: experiment ${j.experiment} fails validateSpec`);
  }
  return out;
}

/** Whether an applied interventions.jsonl (its parsed lines) holds exactly the job's one scheduled entry. */
export function interventionsMatch(job: Job, applied: readonly Record<string, unknown>[]): boolean {
  if (job.expected === null) return applied.length === 0;
  if (applied.length !== 1) return false;
  const a = applied[0], e = job.expected;
  if (a.step !== e.step || a.kind !== e.kind || a.x !== e.x || a.y !== e.y || a.r !== e.r) return false;
  return e.kind !== "feed" || a.amount === e.amount;
}
