// Island-biogeography sweep: AREA (tile size) x ISOLATION (migration rate)
// over the archipelago preset, plus the no-migration control, founded from
// the M3-confirmed ensemble (packages/schema/src/founders.ts) via
// archipelagoWorld (every tile gets the same founder pool, currently 12). See
// experiments/biogeography-island.md for the hypothesis and design.
//
//   deno run -A tools/biogeo-sweep.ts --experiment biogeo-1 \
//     --areas 24,32,48,64,96,128 --iso-tile 64 --iso-rates 1,2,4,8,16 \
//     --migration-period 200 --seeds 1-5 --steps 20000 --census 100 \
//     --dry-run    # drop --dry-run to actually run it
//
// Every run is named by an experiment-wide manifest (experiment.json, written
// once, up front) rather than by a path encoding its own arm/area/condition:
// see buildExperimentManifest/resolveExperimentDir below and
// tools/biogeo-analyze.ts, which reads only this manifest and the run
// directories it names -- no directory walking, no path parsing.
//
// The pure point-generation/manifest/cost functions below have no Deno/GPU
// dependency -- reused as-is by tools/biogeo-smoke.ts's real end-to-end run,
// which also reuses `fsSink` (the one filesystem-touching helper exported
// outside the CLI block below) to drive the real runExperiment the same way
// this file's own `import.meta.main` block does.
import { CELL_CHANNELS, GENOME_CHANNELS, M3_FOUNDERS, M3_FOUNDER_SET, archipelagoWorld, cellCount, founderGenome, type WorldConfig } from "@bl/schema";
import { sameCompletedRun, specConfig, validateSpec, type RunSpec, type Sink } from "@bl/runner";

export type SweepArm = "area" | "isolation";
export type SweepCondition = "treatment" | "no-migration";

/** A migrant packet count fixed for the AREA arm's `treatment` condition, held constant across every tile size (see experiments/biogeography-island.md's per-capita-immigration caveat). */
export const AREA_TREATMENT_MIGRANT_COUNT = 2;

export interface SweepPoint {
  /** Every arm whose generation rule this exact (config, seed) point satisfies -- a point in both is executed once, tagged with both. */
  arms: SweepArm[];
  tileW: number;
  tileH: number;
  tilesX: number;
  tilesY: number;
  migrationPeriod: number;
  migrantCount: number;
  condition: SweepCondition;
  seed: number;
}

export interface SweepOptions {
  areas: number[];
  isoTile: number;
  isoRates: number[];
  migrationPeriod: number;
  seeds: number[];
  /** Default AREA_TREATMENT_MIGRANT_COUNT; overridable for tests. */
  areaTreatmentMigrantCount?: number;
}

function pointKey(p: Omit<SweepPoint, "arms">): string {
  return [p.tileW, p.tileH, p.tilesX, p.tilesY, p.migrationPeriod, p.migrantCount, p.condition, p.seed].join("|");
}

/**
 * The full deduplicated point matrix: a canonical point keyed by
 * (tileW,tileH,tilesX,tilesY,migrationPeriod,migrantCount,condition,seed) is
 * generated once even when both the AREA and ISOLATION arms' own rules
 * produce the same config+seed (e.g. AREA's tileW=64,treatment and
 * ISOLATION's iso-tile=64,rate=2 under the defaults) -- see
 * experiments/biogeography-island.md. Order is stable (AREA arm's own
 * generation order, then ISOLATION's points not already covered), and this
 * order is what `buildExperimentManifest` assigns run identity from.
 */
export function buildSweepPoints(opts: SweepOptions): SweepPoint[] {
  const treatmentMigrantCount = opts.areaTreatmentMigrantCount ?? AREA_TREATMENT_MIGRANT_COUNT;
  const raw: (Omit<SweepPoint, "arms"> & { arm: SweepArm })[] = [];
  for (const tileW of opts.areas)
    for (const condition of ["treatment", "no-migration"] as const)
      for (const seed of opts.seeds)
        raw.push({
          arm: "area",
          tileW,
          tileH: tileW,
          tilesX: 2,
          tilesY: 2,
          migrationPeriod: condition === "treatment" ? opts.migrationPeriod : 0,
          migrantCount: condition === "treatment" ? treatmentMigrantCount : 0,
          condition,
          seed,
        });
  for (const rate of opts.isoRates)
    for (const seed of opts.seeds)
      raw.push({ arm: "isolation", tileW: opts.isoTile, tileH: opts.isoTile, tilesX: 2, tilesY: 2, migrationPeriod: opts.migrationPeriod, migrantCount: rate, condition: "treatment", seed });
  // Isolation's own rate-0 (no-migration) control at iso-tile -- generated
  // unconditionally; the key-merge below collapses it with the AREA arm's
  // own no-migration@iso-tile point when iso-tile is one of --areas (both
  // resolve to migrationPeriod=0, migrantCount=0 at the same tile size), and
  // otherwise it survives as its own point, so a rate-0 control always
  // exists regardless of --iso-tile/--areas overlap.
  for (const seed of opts.seeds)
    raw.push({ arm: "isolation", tileW: opts.isoTile, tileH: opts.isoTile, tilesX: 2, tilesY: 2, migrationPeriod: 0, migrantCount: 0, condition: "no-migration", seed });

  const byKey = new Map<string, SweepPoint>();
  for (const { arm, ...p } of raw) {
    const k = pointKey(p);
    const existing = byKey.get(k);
    if (existing) {
      if (!existing.arms.includes(arm)) existing.arms.push(arm);
    } else {
      byKey.set(k, { ...p, arms: [arm] });
    }
  }
  return [...byKey.values()];
}

/**
 * Identity key for a `WorldConfig`, independent of field order -- the hash
 * input `computeRunId` builds a run's directory name from. Private: nothing
 * outside this file needs "the same physical simulation" identity any more
 * (tools/biogeo-analyze.ts reads run identity from experiment.json instead).
 */
function cfgKey(cfg: WorldConfig): string {
  return JSON.stringify(Object.keys(cfg).sort().map((k) => [k, (cfg as unknown as Record<string, unknown>)[k]]));
}

export function pointOverrides(p: SweepPoint): Partial<WorldConfig> {
  return {
    tileW: p.tileW,
    tileH: p.tileH,
    tilesX: p.tilesX,
    tilesY: p.tilesY,
    ...(p.condition === "treatment" ? { migrationPeriod: p.migrationPeriod, migrantCount: p.migrantCount } : {}),
  };
}

export function specForPoint(experiment: string, p: SweepPoint, steps: number, censusEvery: number, checkpointEvery: number, deepEvery = 10): RunSpec {
  return {
    experiment,
    presetId: "archipelago",
    condition: p.condition,
    seed: p.seed,
    steps,
    censusEvery,
    deepEvery,
    checkpointEvery,
    overrides: pointOverrides(p),
  };
}

/** The M3-founder genomes archipelagoWorld seeds every tile with -- the fixed founder pool held constant across every AREA/ISOLATION point. */
export function m3FounderGenomes() {
  return M3_FOUNDERS.map(founderGenome);
}

/** FNV-1a-style content hash over a run's identity string -- deterministic, no crypto.subtle/async needed. Two independent 32-bit FNV variants concatenated for 16 hex chars, well beyond collision risk for a sweep's own run count. */
function shortHash(input: string): string {
  let h1 = 0x811c9dc5, h2 = 0xcbf29ce4;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x85ebca6b) >>> 0;
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}

/** A run's directory name: a short hash of its canonical (config, steps, cadences) -- config already carries the seed, so this alone fully identifies "the same physical simulation" without any path parsing downstream. Every cadence the manifest records (censusEvery, checkpointEvery, deepEvery) is hashed: two runs differing only in deepEvery still produce different observations (deep role/complexity metrics at a different census cadence), so they must not collide on runId. */
export function computeRunId(cfg: WorldConfig, steps: number, censusEvery: number, checkpointEvery: number, deepEvery: number): string {
  return shortHash(`${cfgKey(cfg)}|${steps}|${censusEvery}|${checkpointEvery}|${deepEvery}`);
}

export function runDir(experiment: string, runId: string): string {
  return `${experiment}/${runId}`;
}

export interface ExperimentRun {
  runId: string;
  arms: SweepArm[];
  condition: SweepCondition;
  seed: number;
  area: number;
  /** Migrant packet count (0 for "no-migration") -- see experiments/biogeography-island.md's packet-transfer-rate note for why this is not yet a rate. */
  migrationRate: number;
  config: WorldConfig;
}

export interface ExperimentManifest {
  experiment: string;
  generatedAt: string;
  presetId: "archipelago";
  /**
   * Content digest of the founder set every run's `archipelagoWorld` was seeded from
   * (`M3_FOUNDER_SET`, packages/schema/src/founders.ts) -- recorded so `resolveExperimentDir`'s
   * full-manifest comparison (below) refuses to resume a sweep whose already-written
   * experiment.json was generated from a *different* founder set than the code running now
   * (e.g. a founder dropped/added since). `run.config`/cadences alone don't carry this: the
   * "archipelago" preset's own `cfg`/`init` never change when M3_FOUNDERS does (this sweep seeds
   * from `m3FounderGenomes()` directly, bypassing the preset's own `init.kind`), so without this
   * field two founder-set eras could otherwise share a runId/config and be silently conflated.
   */
  founderSetId: string;
  steps: number;
  censusEvery: number;
  checkpointEvery: number;
  deepEvery: number;
  migrationPeriod: number;
  areas: number[];
  isoTile: number;
  isoRates: number[];
  seeds: number[];
  /** One entry per buildSweepPoints() point, stable order -- never filesystem/directory-listing order. */
  runs: ExperimentRun[];
}

/** Pure: builds the whole manifest object from buildSweepPoints()'s own point list. No filesystem. */
export function buildExperimentManifest(experiment: string, opts: SweepOptions, steps: number, censusEvery: number, checkpointEvery: number, deepEvery = 10): ExperimentManifest {
  const points = buildSweepPoints(opts);
  const runs: ExperimentRun[] = points.map((p) => {
    const config = specConfig(specForPoint(experiment, p, steps, censusEvery, checkpointEvery, deepEvery));
    return {
      runId: computeRunId(config, steps, censusEvery, checkpointEvery, deepEvery),
      arms: p.arms,
      condition: p.condition,
      seed: p.seed,
      area: p.tileW * p.tileH,
      migrationRate: p.migrantCount,
      config,
    };
  });
  return {
    experiment,
    generatedAt: new Date().toISOString(),
    presetId: "archipelago",
    founderSetId: M3_FOUNDER_SET,
    steps,
    censusEvery,
    checkpointEvery,
    deepEvery,
    migrationPeriod: opts.migrationPeriod,
    areas: opts.areas,
    isoTile: opts.isoTile,
    isoRates: opts.isoRates,
    seeds: opts.seeds,
    runs,
  };
}

/**
 * Decides whether `<out>/<experiment>` is a fresh start or a same-manifest
 * resume, or throws -- the one place this pipeline decides "is this the same
 * experiment". Filesystem-only, GPU-free (so tools/biogeo-smoke.ts can
 * exercise this without a device):
 *   - directory absent or empty -> writes experiment.json, returns "fresh"
 *   - experiment.json present, equal to `manifest` except `generatedAt` ->
 *     returns "resume" (does NOT rewrite the file -- immutable once written)
 *   - experiment.json present and different, or a non-empty directory with
 *     no experiment.json -> throws (name a new --experiment instead)
 */
export async function resolveExperimentDir(out: string, manifest: ExperimentManifest): Promise<"fresh" | "resume"> {
  const dir = `${out}/${manifest.experiment}`;
  const manifestPath = `${dir}/experiment.json`;
  let existingText: string | null = null;
  try {
    existingText = await Deno.readTextFile(manifestPath);
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) throw e;
  }
  if (existingText === null) {
    let entries: Deno.DirEntry[] = [];
    try {
      entries = [...Deno.readDirSync(dir)];
    } catch (e) {
      if (!(e instanceof Deno.errors.NotFound)) throw e;
    }
    if (entries.length > 0) throw new Error(`${dir} is non-empty but has no experiment.json -- name a new --experiment instead of reusing this directory`);
    await Deno.mkdir(dir, { recursive: true });
    await Deno.writeTextFile(manifestPath, JSON.stringify(manifest, null, 2));
    return "fresh";
  }
  const existing = JSON.parse(existingText) as ExperimentManifest;
  const { generatedAt: _existingGeneratedAt, ...existingRest } = existing;
  const { generatedAt: _manifestGeneratedAt, ...manifestRest } = manifest;
  if (JSON.stringify(existingRest) !== JSON.stringify(manifestRest))
    throw new Error(`${manifestPath} already describes a different experiment (its config/points don't match this invocation's) -- name a new --experiment to extend rather than overwrite it`);
  return "resume";
}

/** Bytes per checkpoint (full physics state: CELL_CHANNELS+GENOME_CHANNELS words/cell, 4 bytes each) -- only relevant for the rare manual `--checkpoint > 0` debugging case; species.tsv (below) is the normal analysis input now. */
export function checkpointBytes(cfg: Pick<WorldConfig, "tileW" | "tileH" | "tilesX" | "tilesY">): number {
  return cellCount(cfg as WorldConfig) * (CELL_CHANNELS + GENOME_CHANNELS) * 4;
}

/** Rough per-row size of a species.tsv line ("12345\t3\t7\t142\t8191\n") -- a --dry-run estimate only, not exact. */
const SPECIES_ROW_BYTES_ESTIMATE = 26;

export interface SweepCostEstimate {
  uniqueRuns: number;
  totalCellSteps: number;
  totalCheckpointBytes: number;
  totalSpeciesTsvBytesEstimate: number;
}

export function estimateCost(points: SweepPoint[], steps: number, checkpointEvery: number, censusEvery: number): SweepCostEstimate {
  let totalCellSteps = 0;
  let totalCheckpointBytes = 0;
  let totalSpeciesTsvBytesEstimate = 0;
  for (const p of points) {
    const n = p.tileW * p.tilesX * (p.tileH * p.tilesY);
    totalCellSteps += n * steps;
    const checkpoints = checkpointEvery > 0 ? Math.floor(steps / checkpointEvery) : 0;
    totalCheckpointBytes += checkpoints * checkpointBytes(p);
    const censusPoints = 1 + Math.floor(steps / censusEvery); // baseline (step 0) + one per census, the runner's own species.tsv cadence
    totalSpeciesTsvBytesEstimate += censusPoints * (p.tilesX * p.tilesY) * SPECIES_ROW_BYTES_ESTIMATE;
  }
  return { uniqueRuns: points.length, totalCellSteps, totalCheckpointBytes, totalSpeciesTsvBytesEstimate };
}

/** A `Sink` writing to `dir` on the local filesystem -- the one piece of filesystem access this module exports outside its own CLI block, so tools/biogeo-smoke.ts's real end-to-end run can drive `runExperiment` the same way this file's own `import.meta.main` loop does. */
export function fsSink(dir: string): Sink {
  const p = (f: string) => `${dir}/${f}`;
  return {
    async writeText(f, t) {
      await Deno.mkdir(p(f).replace(/\/[^/]+$/, ""), { recursive: true });
      await Deno.writeTextFile(p(f), t);
    },
    async appendText(f, t) {
      await Deno.writeTextFile(p(f), t, { append: true });
    },
    async writeBytes(f, b) {
      await Deno.mkdir(p(f).replace(/\/[^/]+$/, ""), { recursive: true });
      await Deno.writeFile(p(f), b);
    },
  };
}

function parseSeeds(s: string): number[] {
  return s.split(",").flatMap((part) => {
    const [lo, hi] = part.split("-").map(Number);
    return hi === undefined ? [lo] : Array.from({ length: hi - lo + 1 }, (_, k) => lo + k);
  });
}

function parseInts(s: string): number[] {
  return s.split(",").map(Number);
}

if (import.meta.main) {
  const { parseArgs } = await import("jsr:@std/cli@1/parse-args");
  const { requestDevice } = await import("@bl/sim-gpu");
  const { runExperiment } = await import("@bl/runner");

  const a = parseArgs(Deno.args, {
    string: ["experiment", "out", "areas", "iso-tile", "iso-rates", "migration-period", "seeds", "steps", "census", "checkpoint"],
    boolean: ["dry-run"],
    default: {
      experiment: "biogeo",
      out: "runs",
      areas: "24,32,48,64,96,128",
      "iso-tile": "64",
      "iso-rates": "1,2,4,8,16",
      "migration-period": "200",
      seeds: "1-5",
      steps: "20000",
      census: "100",
      checkpoint: "0",
    },
  });

  const opts: SweepOptions = {
    areas: parseInts(a.areas),
    isoTile: Number(a["iso-tile"]),
    isoRates: parseInts(a["iso-rates"]),
    migrationPeriod: Number(a["migration-period"]),
    seeds: parseSeeds(a.seeds),
  };
  const steps = Number(a.steps);
  const censusEvery = Number(a.census);
  const checkpointEvery = Number(a.checkpoint);
  const points = buildSweepPoints(opts);
  const manifest = buildExperimentManifest(a.experiment, opts, steps, censusEvery, checkpointEvery);

  if (a["dry-run"]) {
    for (const run of manifest.runs) console.log(`${run.runId}  area=${run.area}  arms=${run.arms.join("+")}  condition=${run.condition}  seed=${run.seed}`);
    const cost = estimateCost(points, steps, checkpointEvery, censusEvery);
    console.log(
      `\n${cost.uniqueRuns} unique runs, ${cost.totalCellSteps.toExponential(2)} total cell-steps, ~${(cost.totalSpeciesTsvBytesEstimate / 1e6).toFixed(1)} MB of species.tsv` +
        (checkpointEvery > 0 ? `, ~${(cost.totalCheckpointBytes / 1e9).toFixed(2)} GB of checkpoints` : ""),
    );
    Deno.exit(0);
  }

  for (const p of points) {
    const spec = specForPoint(a.experiment, p, steps, censusEvery, checkpointEvery);
    const errs = validateSpec(spec);
    if (errs.length) throw new Error(`invalid spec for area=${p.tileW * p.tileH} arms=${p.arms.join("+")} seed=${p.seed}: ${errs.join("; ")}`);
    specConfig(spec); // throws for unsupported preset/condition combinations
  }

  await resolveExperimentDir(a.out, manifest);

  const first = specForPoint(a.experiment, points[0], steps, censusEvery, checkpointEvery);
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
  const info = adapter?.info;
  const adapterDesc = [info?.vendor, info?.architecture, info?.description].filter(Boolean).join(" ") || "unknown";
  const device = await requestDevice(navigator.gpu, specConfig(first));
  const host = { host: `deno ${Deno.version.deno} ${Deno.build.os}-${Deno.build.arch}`, adapter: adapterDesc };

  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const run = manifest.runs[i];
    const dir = `${a.out}/${runDir(a.experiment, run.runId)}`;
    // runId is the run's sole identity (experiment.json's own manifest.runs entry), threaded into
    // the spec so manifest.json's own runId matches it exactly rather than a coarser
    // condition+seed-derived one -- resume/analysis both compare on this runId directly.
    const spec: RunSpec = { ...specForPoint(a.experiment, p, steps, censusEvery, checkpointEvery), speciesCensus: true, runId: run.runId };
    let dirExists = true;
    try {
      await Deno.stat(dir);
    } catch (e) {
      if (!(e instanceof Deno.errors.NotFound)) throw e;
      dirExists = false;
    }
    if (dirExists) {
      let done: Record<string, unknown> | null = null;
      try {
        done = JSON.parse(await Deno.readTextFile(`${dir}/manifest.json`));
      } catch (e) {
        if (!(e instanceof Deno.errors.NotFound)) throw e;
      }
      if (done && done.runId === run.runId && done.summary && sameCompletedRun(done, spec)) {
        console.log(`skip ${run.runId} (complete, identical spec)`);
        continue;
      }
      // Never repaired or rewritten: a directory that already exists for this runId but isn't a
      // completed manifest for it (a crash mid-run, or a hand-edited/stale one) is refused rather
      // than silently wiped and rerun -- remove it by hand first if that's really what's wanted.
      throw new Error(`${dir} already exists but is not a completed run for ${run.runId} -- remove it manually before resuming (this pipeline never repairs a run directory in place)`);
    }
    console.log(`run ${run.runId} (area=${run.area} arms=${run.arms.join("+")}, ${spec.steps} steps)`);
    const start = archipelagoWorld(run.config, m3FounderGenomes());
    const sink = fsSink(dir);
    const { summary } = await runExperiment(device, spec, sink, host, (m) => console.log(`  ${m}`), { start });
    console.log(`  done: ${summary.stepsPerSecond.toFixed(0)} st/s, conservation ${summary.conservationOk ? "exact" : "VIOLATED"}`);
  }
}
