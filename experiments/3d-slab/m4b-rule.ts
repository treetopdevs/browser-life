// The M4b calibration rule (docs/3d-rung1b-plan-2026-10-23.md, "Amendment 2026-10-24: re-rule M4 with nutrient per
// cell as the knob"), as pure code: the grid, the job ids, what a result must record, the qualifying conditions, the
// pick and its tie order, and the neutral stage. No Deno, no GPU: m4b-pick.ts reads the files and calls `decide`, and
// experiments/test/m4b-rule.test.ts tests it on synthetic results. Every threshold is compared in integers.
import { presetById, presetConfig, type InitParams, type WorldConfig } from "@bl/schema";

export const NUTRIENTS = [8, 12, 16, 20, 24] as const;
export const MUS = [30, 40, 50, 60] as const;
export const SIGMAS = [8, 16] as const;
export const LIGHT_KS = [64, 256] as const;
export const SEEDS = [101, 102, 103] as const;
export const STEPS = 50_000;
export const RULE_VERSION = 1;
export const PRESET_ID = "slab-spots";
/** The slab: 256 x 256 x 8, so a layer has 65,536 cells and a two-layer group 131,072. */
export const W = 256, H = 256, D = 8, PLANE = W * H, CELLS = PLANE * D;
/** Living fractions every 5,000 steps: index 7 is step 40,000, 8 is 45,000, 9 is 50,000. */
export const AT_40K = 7, AT_45K = 8, AT_50K = 9;
/** At most this many qualifying settings go to the neutral stage, in pick order. */
export const NEUTRAL_CANDIDATES = 3;

export type Condition = "treatment" | "neutral";
export interface Setting { nutrient: number; mu: number; sigma: number; lightK: number }
export interface Job extends Setting { id: string; condition: Condition; seed: number }

export const settingKey = (s: Setting) => `n${s.nutrient}-mu${s.mu}-s${s.sigma}-k${s.lightK}`;
export const jobId = (condition: Condition, s: Setting, seed: number) => `${condition}-${settingKey(s)}-seed${seed}`;

/** The 80 settings in the order the queue walks them (lightK, sigma, mu, nutrient outer to inner). */
export function gridSettings(): Setting[] {
  const out: Setting[] = [];
  for (const lightK of LIGHT_KS) for (const sigma of SIGMAS) for (const mu of MUS) for (const nutrient of NUTRIENTS) out.push({ nutrient, mu, sigma, lightK });
  return out;
}

/** The exact config and init a job must run with: slab-spots, the setting as overrides, nutrient in the init. */
export function expectedConfig(job: Job): WorldConfig {
  const preset = presetById(PRESET_ID);
  if (!preset || preset.init.kind !== "slab-spots") throw new Error(`preset ${PRESET_ID} is missing or changed`);
  return presetConfig(preset, job.seed, { defaultMu: job.mu, defaultSigma: job.sigma, lightK: job.lightK, ...(job.condition === "neutral" ? { neutral: true } : {}) });
}
export function expectedInit(job: Job): InitParams {
  const preset = presetById(PRESET_ID)!;
  return { ...preset.init, nutrient: job.nutrient };
}
/** JSON with object keys sorted at every level, so two configs compare by content. */
export function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v as object).sort().filter((k) => (v as Record<string, unknown>)[k] !== undefined).map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(v);
}

export function jobsFor(condition: Condition, settings: readonly Setting[]): Job[] {
  const out: Job[] = [];
  for (const s of settings) for (const seed of SEEDS) out.push({ ...s, id: jobId(condition, s, seed), condition, seed });
  return out;
}

/** What one result file must hold (written by m4-calibrate.ts --grid=m4b). Counts are integers; light sums are integers. */
export interface Result {
  id: string;
  condition: Condition;
  neutral: boolean;
  presetId: string;
  init: { kind: string; founders: number; nutrient: number; biomass: number };
  cfg: Record<string, unknown>;
  ruleVersion: number;
  nutrient: number; mu: number; sigma: number; lightK: number; seed: number;
  requestedSteps: number;
  step: number;
  extinctAt: number | null;
  living: number;
  /** Living cells every 5,000 steps up to the last full 5,000 reached. */
  livingTrace5k: number[];
  denseTrace5k: number[];
  /** Sum of light over each layer at the end (integers; mean = sum / PLANE). */
  lightLayerSum: number[];
  livingByLayer: number[];
  massByLayer: number[];
  activityByLayer: number[];
  matterOk: boolean;
  energyResidual: string;
}

const isInt = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const intArray = (v: unknown, len: number | null): v is number[] => Array.isArray(v) && (len === null || v.length === len) && v.every(isInt);

/** Every way a result can fail to be a result of `job`: an empty list means it is one. */
export function validate(r: unknown, job: Job, steps = STEPS): string[] {
  const e: string[] = [];
  if (typeof r !== "object" || r === null) return [`${job.id}: not an object`];
  const x = r as Record<string, unknown>;
  const want: [string, unknown][] = [
    ["id", job.id], ["condition", job.condition], ["neutral", job.condition === "neutral"], ["presetId", PRESET_ID], ["ruleVersion", RULE_VERSION],
    ["nutrient", job.nutrient], ["mu", job.mu], ["sigma", job.sigma], ["lightK", job.lightK], ["seed", job.seed], ["requestedSteps", steps],
    ["matterOk", true], ["energyResidual", "0"],
  ];
  for (const [k, v] of want) if (x[k] !== v) e.push(`${job.id}: ${k} is ${JSON.stringify(x[k])}, expected ${JSON.stringify(v)}`);
  if (stable(x.init) !== stable(expectedInit(job))) e.push(`${job.id}: init is ${stable(x.init)}, expected ${stable(expectedInit(job))}`);
  const cfg = x.cfg as Record<string, unknown> | undefined;
  const cfgWant: [string, unknown][] = [["tileW", W], ["tileH", H], ["tileD", D], ["tilesX", 1], ["tilesY", 1], ["kernelRadius", 3], ["seed", job.seed],
    ["defaultMu", job.mu], ["defaultSigma", job.sigma], ["lightK", job.lightK], ["lightMode", "uniform"], ["lightBase", 40], ["lightAmp", 200]];
  if (!cfg) e.push(`${job.id}: no cfg`);
  else {
    // The named keys first, for readable messages; then the whole config, so no other key can differ unseen.
    for (const [k, v] of cfgWant) if (cfg[k] !== v) e.push(`${job.id}: cfg.${k} is ${JSON.stringify(cfg[k])}, expected ${JSON.stringify(v)}`);
    if ((cfg.neutral === true) !== (job.condition === "neutral")) e.push(`${job.id}: cfg.neutral is ${JSON.stringify(cfg.neutral)} for condition ${job.condition}`);
    if (stable(cfg) !== stable(expectedConfig(job))) e.push(`${job.id}: cfg differs from the job's expected config`);
  }
  const extinct = x.extinctAt;
  if (!(extinct === null || isInt(extinct))) e.push(`${job.id}: extinctAt is ${JSON.stringify(extinct)}`);
  if (!isInt(x.step) || !isInt(x.living)) e.push(`${job.id}: step or living is not a count`);
  else if (extinct === null) {
    if (x.step !== steps) e.push(`${job.id}: ran ${x.step} of ${steps} steps without going extinct`);
  } else if (x.step !== extinct || x.living !== 0 || (extinct as number) > steps) e.push(`${job.id}: extinct at ${extinct} but step ${x.step}, living ${x.living}`);
  const step = isInt(x.step) ? x.step : 0;
  if (extinct !== null && isInt(extinct) && extinct % 1000 !== 0) e.push(`${job.id}: extinctAt ${extinct} is not a census step`);
  const traceLen = Math.floor(step / 5000);
  for (const k of ["livingTrace5k", "denseTrace5k"]) {
    if (!intArray(x[k], traceLen)) e.push(`${job.id}: ${k} is not ${traceLen} counts`);
    else if ((x[k] as number[]).some((v) => v > CELLS)) e.push(`${job.id}: ${k} has a count above ${CELLS}`);
  }
  const caps: [string, number][] = [["lightLayerSum", 255 * PLANE], ["livingByLayer", PLANE], ["massByLayer", Number.MAX_SAFE_INTEGER], ["activityByLayer", 4 * 65535 * PLANE]];
  for (const [k, cap] of caps) {
    if (!intArray(x[k], D)) e.push(`${job.id}: ${k} is not ${D} counts`);
    else if ((x[k] as number[]).some((v) => v > cap)) e.push(`${job.id}: ${k} has a value above ${cap}`);
  }
  if (e.length) return e;
  const t = x.livingTrace5k as number[];
  const sumLiving = (x.livingByLayer as number[]).reduce((a, b) => a + b, 0);
  if (sumLiving !== x.living) e.push(`${job.id}: livingByLayer sums to ${sumLiving}, living is ${x.living}`);
  if (x.living as number > CELLS) e.push(`${job.id}: living above ${CELLS}`);
  // A run stops at the first census with no living cell, so every trace point before the end is alive.
  const lastIsEnd = step % 5000 === 0;
  for (let i = 0; i < t.length; i++) {
    const atEnd = lastIsEnd && i === t.length - 1;
    if (atEnd ? t[i] !== x.living : t[i] === 0) e.push(`${job.id}: livingTrace5k[${i}] = ${t[i]} is inconsistent with the run's end`);
  }
  if (extinct === null && step % 5000 === 0 && t.length !== Math.floor(steps / 5000)) e.push(`${job.id}: trace length`);
  return e;
}

// ------------------------------------------------------------------------------------------ the conditions
/** 1 % <= living / cells <= 50 %, in integers. */
export const inLivingWindow = (living: number, cells = CELLS) => 100 * living >= cells && 2 * living <= cells;
/** 5 % <= light(layer 7) / light(layer 0) <= 80 %, on the layer sums (same plane, so the ratio of means). */
export const inLightWindow = (s0: number, s7: number) => s0 > 0 && 20 * s7 >= s0 && 5 * s7 <= 4 * s0;

export interface SeedVerdict { window: boolean; settled: boolean; ends: boolean; ok: boolean }

/** Condition 3 for one result: in each two-layer group at least 1 % of cells living and some last-step activity. */
export function bothEnds(r: Result): boolean {
  const group = (a: number[], z0: number) => a[z0] + a[z0 + 1];
  const g = 2 * PLANE;
  return 100 * group(r.livingByLayer, 0) >= g && 100 * group(r.livingByLayer, D - 2) >= g &&
    group(r.activityByLayer, 0) > 0 && group(r.activityByLayer, D - 2) > 0;
}

/** The three conditions for one evolving result. */
export function seedVerdict(r: Result): SeedVerdict {
  const t = r.livingTrace5k;
  const alive = r.extinctAt === null && t.length === AT_50K + 1;
  const window = alive && inLivingWindow(r.living) && inLightWindow(r.lightLayerSum[0], r.lightLayerSum[D - 1]);
  let settled = false;
  if (alive) {
    const [l40, l45, l50] = [t[AT_40K], t[AT_45K], t[AT_50K]];
    settled = inLivingWindow(l40) && inLivingWindow(l45) && 20 * Math.abs(l50 - l40) <= CELLS && 5 * l50 >= 4 * l40 && 4 * l50 <= 5 * l40;
  }
  const ends = alive && bothEnds(r);
  return { window, settled, ends, ok: window && settled && ends };
}

/** The neutral stage's test for one neutral result: at least 1 % living at 50,000 and condition 3. */
export const neutralPasses = (r: Result) => r.extinctAt === null && 100 * r.living >= CELLS && bothEnds(r);

// ------------------------------------------------------------------------------------------ the decision
export interface Row extends Setting { seeds: Result[]; verdicts: SeedVerdict[]; qualifies: boolean; medianLiving: number }

/** Pick order among qualifying settings: median living desc, then lightK desc, sigma desc, mu asc, nutrient desc. */
export const pickOrder = (a: Row, b: Row) =>
  b.medianLiving - a.medianLiving || b.lightK - a.lightK || b.sigma - a.sigma || a.mu - b.mu || b.nutrient - a.nutrient;

export type Decision =
  | { status: "blocked"; errors: string[] }
  | { status: "incomplete"; missing: string[] }
  | { status: "needs-neutral"; candidate: Setting; jobs: string[] }
  | { status: "pick"; pick: Setting; tried: Setting[] }
  | { status: "none-qualifies" }
  | { status: "neutral-failed"; tried: Setting[] };

export interface Decided { decision: Decision; rows: Row[]; qualifying: Row[] }

/**
 * Applies the whole rule to the files found (`files`: id -> parsed JSON). Any file that is not a grid job, or a grid
 * job whose result fails `validate`, blocks the decision; a missing evolving result leaves it incomplete; then the
 * qualifying settings, the pick order, and the neutral stage in that order, which may ask for neutral runs.
 */
export function decide(files: ReadonlyMap<string, unknown>, steps = STEPS): Decided {
  const settings = gridSettings();
  const treat = jobsFor("treatment", settings), neut = jobsFor("neutral", settings);
  const known = new Map([...treat, ...neut].map((j) => [j.id, j]));
  const errors: string[] = [];
  for (const id of files.keys()) if (!known.has(id)) errors.push(`${id}: not a job of the M4b grid`);
  for (const [id, r] of files) { const j = known.get(id); if (j) errors.push(...validate(r, j, steps)); }
  if (errors.length) return { decision: { status: "blocked", errors }, rows: [], qualifying: [] };
  const missing = treat.filter((j) => !files.has(j.id)).map((j) => j.id);
  const rows: Row[] = [];
  for (const s of settings) {
    const seeds = SEEDS.map((seed) => files.get(jobId("treatment", s, seed)) as Result | undefined).filter((r): r is Result => !!r);
    if (seeds.length !== SEEDS.length) continue;
    const verdicts = seeds.map(seedVerdict);
    const liv = seeds.map((r) => r.living).sort((a, b) => a - b);
    rows.push({ ...s, seeds, verdicts, qualifies: verdicts.every((v) => v.ok), medianLiving: liv[1] });
  }
  if (missing.length) return { decision: { status: "incomplete", missing }, rows, qualifying: [] };
  const qualifying = rows.filter((r) => r.qualifies).sort(pickOrder);
  if (!qualifying.length) return { decision: { status: "none-qualifies" }, rows, qualifying };
  const tried: Setting[] = [];
  for (const row of qualifying.slice(0, NEUTRAL_CANDIDATES)) {
    const s: Setting = { nutrient: row.nutrient, mu: row.mu, sigma: row.sigma, lightK: row.lightK };
    const ids = SEEDS.map((seed) => jobId("neutral", s, seed));
    if (ids.some((id) => !files.has(id))) return { decision: { status: "needs-neutral", candidate: s, jobs: ids.filter((id) => !files.has(id)) }, rows, qualifying };
    tried.push(s);
    if (ids.every((id) => neutralPasses(files.get(id) as Result))) return { decision: { status: "pick", pick: s, tried }, rows, qualifying };
  }
  return { decision: { status: "neutral-failed", tried }, rows, qualifying };
}
