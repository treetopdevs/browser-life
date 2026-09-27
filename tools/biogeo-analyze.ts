// Post-processes a tools/biogeo-sweep.ts experiment directory, offline, no
// GPU: species-area fit, isolation effect and founder-persistence turnover,
// from experiment.json and each run's species.tsv. See
// experiments/biogeography-island.md for the hypothesis and design, and
// packages/metrics/src/biogeography.ts for the estimand definitions
// (founderPersistence vs. geneticRichness) this tool builds on.
//
//   deno run -A tools/biogeo-analyze.ts runs/<experiment> [--out report] [--prune]
//
// Reads ONLY experiment.json and the run directories it lists -- no
// directory walking, no path parsing, no cross-invocation dedup: one
// manifest per experiment makes all of that structurally unnecessary (see
// tools/biogeo-sweep.ts's own doc). The pure functions below are exported and
// exercised directly by tools/biogeo-smoke.ts. Only the `import.meta.main`
// CLI block reads the filesystem end to end and writes a report.
import { archipelagoFounderLayout, M3_FOUNDERS, M3_FOUNDER_SET, METRICS_VERSION, RULE_VERSION, SCHEMA_VERSION, type WorldConfig } from "@bl/schema";
import { sameConfig, type RunSpec } from "@bl/runner";
import { isolationEffect, mean, speciesAreaFit, turnoverEquilibrium, turnoverSeries, type TurnoverEquilibrium, type TurnoverRow } from "@bl/metrics";
// Type-only: no runtime coupling to tools/biogeo-sweep.ts at all -- experiment.json (this file's
// only input, besides each run's own manifest.json/species.tsv/migrations.tsv) already carries
// everything a run needs (config, condition, seed, arms, area, migrationRate).
import type { ExperimentManifest, ExperimentRun } from "./biogeo-sweep.ts";

export async function loadExperimentManifest(root: string): Promise<ExperimentManifest> {
  let text: string;
  try {
    text = await Deno.readTextFile(`${root}/experiment.json`);
  } catch (e) {
    throw new Error(`could not read ${root}/experiment.json (run tools/biogeo-sweep.ts first, pointing --out/--experiment at this root): ${(e as Error).message}`);
  }
  const manifest = JSON.parse(text) as ExperimentManifest;
  // Every run's species.tsv founder-presence mask is decoded against *this process's* current
  // M3_FOUNDERS (parseSpeciesTsv, below): if the founder set has changed since this experiment.json
  // was written (a founder dropped or added -- packages/schema/src/founders.ts), decoding the old
  // mask width against the new M3_FOUNDERS silently drops or misreads bits instead of erroring, so
  // this is checked once, up front, against the recorded digest rather than left to be discovered
  // as a quietly-wrong founderSet downstream. tools/biogeo-sweep.ts's own resolveExperimentDir
  // refuses this same mismatch at resume time (buildExperimentManifest's founderSetId is part of
  // its full-manifest comparison) -- this is the same check for an experiment.json read standalone,
  // e.g. re-analyzing an already-complete experiment with newer analysis code.
  if (manifest.founderSetId !== M3_FOUNDER_SET)
    throw new Error(
      `${root}/experiment.json was generated from founder set ${JSON.stringify(manifest.founderSetId)}, but this code's M3_FOUNDERS is ${M3_FOUNDER_SET} -- ` +
        `species.tsv founder-presence masks from a different founder set cannot be decoded correctly; re-run tools/biogeo-sweep.ts under this code to regenerate, or analyze with the matching code revision`,
    );
  return manifest;
}

export interface SpeciesRow { step: number; tile: number; geneticRichness: number; livingCells: number; founderSet: Set<number>; }

/** Decodes one species.tsv (runner's `speciesTsvRows`/`tileSpeciesCensus` output): `step\ttile\tgeneticRichness\tlivingCells\tfounderPresenceMask\n`, `founderPresenceMask`'s set bits becoming `founderSet`. */
export function parseSpeciesTsv(text: string): SpeciesRow[] {
  const lines = text.trim().split("\n");
  const rows: SpeciesRow[] = [];
  for (const line of lines.slice(1)) {
    if (!line) continue;
    const [step, tile, geneticRichness, livingCells, mask] = line.split("\t").map(Number);
    const founderSet = new Set<number>();
    for (let k = 0; k < M3_FOUNDERS.length; k++) if ((mask >>> k) & 1) founderSet.add(k);
    rows.push({ step, tile, geneticRichness, livingCells, founderSet });
  }
  return rows;
}

export interface Eligibility { eligible: boolean; problems: string[]; }

/**
 * Every check run before a run's species.tsv enters inference: completeness,
 * versions, that this run's own manifest.json actually matches the
 * experiment.json entry it's filed under, and that the species census
 * actually reached the run's intended horizon for every tile. No path
 * parsing, no directory listing, no cadence/horizon cross-checks -- one
 * manifest.json per experiment makes "two different cadences/horizons in one
 * analysis" structurally impossible, not just checked-for.
 */
export function checkEligibility(run: ExperimentRun, manifest: Record<string, unknown>, speciesRows: SpeciesRow[] | null, expectedSteps: number): Eligibility {
  const problems: string[] = [];
  const summary = manifest.summary as Record<string, unknown> | null | undefined;
  if (!summary) return { eligible: false, problems: ["no manifest.summary (incomplete run)"] };
  if (summary.conservationOk !== true) problems.push(`conservationOk is ${JSON.stringify(summary.conservationOk)}, not true`);
  if (manifest.ruleVersion !== RULE_VERSION) problems.push(`ruleVersion ${manifest.ruleVersion} != ${RULE_VERSION}`);
  if (manifest.schemaVersion !== SCHEMA_VERSION) problems.push(`schemaVersion ${manifest.schemaVersion} != ${SCHEMA_VERSION}`);
  if (((manifest.metricsVersion as number | undefined) ?? 1) !== METRICS_VERSION) problems.push(`metricsVersion ${manifest.metricsVersion ?? 1} != ${METRICS_VERSION}`);

  const spec = manifest.spec as RunSpec | undefined;
  if (!spec) {
    problems.push("manifest.spec is missing");
  } else {
    // runId is this run's sole identity (tools/biogeo-sweep.ts threads experiment.json's own
    // runId into the spec it runs) -- compared directly rather than reconstructed from
    // condition+seed, which the manifest's own top-level runId already encodes exactly.
    if (manifest.runId !== run.runId) problems.push(`manifest.runId (${manifest.runId}) does not match experiment.json's recorded runId (${run.runId}) for condition ${run.condition}/seed-${run.seed}`);
    if (!sameConfig(manifest.cfg as WorldConfig, run.config)) problems.push("manifest.cfg does not match experiment.json's recorded config for this runId");
    if (summary.steps !== expectedSteps) problems.push(`summary.steps (${summary.steps}) != this experiment's steps (${expectedSteps}) -- run did not cover its intended horizon`);
  }
  if (((manifest.startStep as number | undefined) ?? 0) !== 0) problems.push(`startStep is ${manifest.startStep}, expected 0 (this sweep never segments/resumes a run)`);

  if (speciesRows === null) {
    problems.push("species.tsv is missing or unparsable");
  } else {
    const tiles = run.config.tilesX * run.config.tilesY;
    for (let tile = 0; tile < tiles; tile++) {
      if (!speciesRows.some((r) => r.tile === tile && r.step === expectedSteps))
        problems.push(`species.tsv has no row for tile ${tile} at step ${expectedSteps} -- this run's species census did not reach the experiment's horizon`);
    }
  }
  return { eligible: problems.length === 0, problems };
}

/**
 * Archipelago-mean, late-run geneticRichness -- one number per run, the independent unit
 * species-area/isolation inference pools over. "Late-run" means rows at or after
 * `horizonSteps`'s own midpoint, not "the second half of however many census rows happen to
 * exist" -- `horizonSteps` must be the run's own intended steps, passed explicitly, never
 * inferred from the rows actually observed.
 */
export function runLevelRichness(rowsByTile: Map<number, SpeciesRow[]>, horizonSteps: number): number {
  const midpoint = horizonSteps / 2;
  const perTile = [...rowsByTile.values()].map((rows) => {
    const late = rows.filter((r) => r.step >= midpoint);
    if (late.length === 0) throw new Error(`no species.tsv row at or after the intended horizon's midpoint (${midpoint}) among observed steps [${rows.map((r) => r.step).join(",")}]`);
    return mean(late.map((r) => r.geneticRichness));
  });
  return mean(perTile);
}

export interface NormalizedTurnoverRow {
  step: number;
  /** null for the initial row (elapsedSteps=0, nothing has elapsed yet) -- never divided by zero. */
  colonizationRate: number | null;
  extinctionRate: number | null;
}

/** See turnoverSeries's own doc: raw per-row counts aren't comparable across differing census cadences -- this reports the elapsed-step-normalized rate instead. */
export function normalizedTurnoverRates(rows: TurnoverRow[]): NormalizedTurnoverRow[] {
  return rows.map((r) => ({
    step: r.step,
    colonizationRate: r.elapsedSteps > 0 ? r.colonizations / r.elapsedSteps : null,
    extinctionRate: r.elapsedSteps > 0 ? r.extinctions / r.elapsedSteps : null,
  }));
}

/**
 * Per-tile turnover history and its equilibrium, sourced from species.tsv's own rows (no
 * checkpoint decoding, no synthesized baseline -- species.tsv's first row, written by the
 * runner from the real initial state, already IS the true step-0 baseline).
 */
export function runTurnoverFromSpecies(rowsByTile: Map<number, SpeciesRow[]>): { tile: number; rows: TurnoverRow[]; rates: NormalizedTurnoverRow[]; equilibrium: TurnoverEquilibrium }[] {
  return [...rowsByTile.entries()].sort((a, b) => a[0] - b[0]).map(([tile, rows]) => {
    const history = [...rows].sort((a, b) => a.step - b.step).map((r) => ({ step: r.step, species: r.founderSet }));
    const turnoverRows = turnoverSeries(history);
    return { tile, rows: turnoverRows, rates: normalizedTurnoverRates(turnoverRows), equilibrium: turnoverEquilibrium(turnoverRows) };
  });
}

/** Realized living-transfer fraction from a run's migrations.tsv (unchanged file, untouched by this rewrite): the fraction of transferred packets that carried a living lineage (lineageHi|lineageLo both 0 means the transferred cell was dead), before a richness change is attributed to organism movement rather than substrate-only packet transfer. */
export async function livingTransferFraction(dir: string): Promise<number | null> {
  let text: string;
  try {
    text = await Deno.readTextFile(`${dir}/migrations.tsv`);
  } catch {
    return null; // no migration configured for this run (no-migration condition)
  }
  const rows = text.trim().split("\n").slice(1).filter(Boolean);
  if (rows.length === 0) return null;
  let living = 0;
  for (const row of rows) {
    const cols = row.split("\t");
    if ((Number(cols[7]) | Number(cols[8])) !== 0) living++;
  }
  return living / rows.length;
}

if (import.meta.main) {
  const { parseArgs } = await import("jsr:@std/cli@1/parse-args");
  const a = parseArgs(Deno.args, { string: ["out"], boolean: ["prune"] });
  const root = String(a._[0] ?? "");
  if (!root) throw new Error("usage: biogeo-analyze.ts runs/<experiment> [--out report] [--prune]");
  const outDir = a.out ?? `${root}/biogeo-report`;

  const manifest = await loadExperimentManifest(root);

  interface Loaded { run: ExperimentRun; dir: string; rowsByTile: Map<number, SpeciesRow[]> }
  const loaded: Loaded[] = [];
  const rejected: { runId: string; problems: string[] }[] = [];

  for (const run of manifest.runs) {
    // Flat layout (tools/biogeo-sweep.ts's own runDir): `<root>/<runId>/` -- no path parsing needed.
    const dir = `${root}/${run.runId}`;
    let runManifest: Record<string, unknown> = {};
    try {
      runManifest = JSON.parse(await Deno.readTextFile(`${dir}/manifest.json`));
    } catch {
      rejected.push({ runId: run.runId, problems: ["manifest.json missing or unreadable (incomplete run)"] });
      continue;
    }
    let speciesRows: SpeciesRow[] | null = null;
    try {
      speciesRows = parseSpeciesTsv(await Deno.readTextFile(`${dir}/species.tsv`));
    } catch {
      speciesRows = null;
    }
    const elig = checkEligibility(run, runManifest, speciesRows, manifest.steps);
    if (!elig.eligible) {
      rejected.push({ runId: run.runId, problems: elig.problems });
      continue;
    }
    const rowsByTile = new Map<number, SpeciesRow[]>();
    for (const r of speciesRows!) rowsByTile.set(r.tile, [...(rowsByTile.get(r.tile) ?? []), r]);
    loaded.push({ run, dir, rowsByTile });
  }

  if (!loaded.length) {
    console.error(`no eligible runs under ${root} (${rejected.length} rejected)`);
    for (const r of rejected) console.error(`  ${r.runId}: ${r.problems.join("; ")}`);
    Deno.exit(1);
  }

  const perRun = loaded.map(({ run, dir, rowsByTile }) => ({
    run,
    dir,
    richness: runLevelRichness(rowsByTile, manifest.steps),
    turnover: runTurnoverFromSpecies(rowsByTile),
  }));

  // Species-area fit, per condition, over the AREA arm's own runs -- one point per run
  // (archipelago-mean richness), never per tile.
  const areaRuns = perRun.filter((r) => r.run.arms.includes("area"));
  const areaFits: Record<string, ReturnType<typeof speciesAreaFit> | { error: string }> = {};
  for (const condition of ["treatment", "no-migration"] as const) {
    const rows = areaRuns.filter((r) => r.run.condition === condition);
    try {
      areaFits[condition] = speciesAreaFit(rows.map((r) => r.run.area), rows.map((r) => r.richness), rows.map((r) => r.run.seed), 1);
    } catch (e) {
      areaFits[condition] = { error: (e as Error).message };
    }
  }

  // Migrants-per-island-per-step, matching isolationEffect's own documented "rate" contract.
  const packetRate = (migrationRate: number) => migrationRate / manifest.migrationPeriod;

  const isolationRuns = perRun.filter((r) => r.run.arms.includes("isolation"));
  let isolation: ReturnType<typeof isolationEffect> | { error: string } | null = null;
  if (isolationRuns.length) {
    const byRate = new Map<number, { seed: number; richness: number }[]>();
    for (const r of isolationRuns) {
      const rate = r.run.condition === "no-migration" ? 0 : packetRate(r.run.migrationRate);
      byRate.set(rate, [...(byRate.get(rate) ?? []), { seed: r.run.seed, richness: r.richness }]);
    }
    try {
      isolation = isolationEffect(byRate);
    } catch (e) {
      isolation = { error: (e as Error).message };
    }
  }

  const turnoverSummary = perRun.flatMap((r) => r.turnover.map((t) => ({ run: r.run.runId, tile: t.tile, ...t.equilibrium })));

  const perAreaExtinction = (["treatment", "no-migration"] as const).flatMap((condition) => {
    const byArea = new Map<number, { n: number; extinct: number }>();
    for (const r of areaRuns.filter((r) => r.run.condition === condition)) {
      const cur = byArea.get(r.run.area) ?? { n: 0, extinct: 0 };
      cur.n++;
      if (r.richness === 0) cur.extinct++;
      byArea.set(r.run.area, cur);
    }
    return [...byArea.entries()].sort((x, y) => x[0] - y[0]).map(([area, { n, extinct }]) => ({ condition, area, n, extinct, extinctionRate: n ? extinct / n : 0 }));
  });

  // Recomputed directly from each area's own config (never a stored/trusted sidecar) -- always in
  // sync with the actual founder set/layout function.
  const foundingDensityByArea = [...new Map(areaRuns.map((r) => {
    const layout = archipelagoFounderLayout(r.run.config.tileW, r.run.config.tileH, M3_FOUNDERS.length);
    const founderCellsPerTileEstimate = M3_FOUNDERS.length * Math.PI * layout.radius * layout.radius;
    const occupiedFraction = founderCellsPerTileEstimate / (r.run.config.tileW * r.run.config.tileH);
    return [r.run.area, { area: r.run.area, occupiedFraction, founderCellsPerTileEstimate }];
  })).values()].sort((x, y) => x.area - y.area);

  const transferByRun = await Promise.all(
    isolationRuns.filter((r) => r.run.condition === "treatment").map(async (r) => ({ rate: packetRate(r.run.migrationRate), frac: await livingTransferFraction(r.dir) })),
  );
  const livingTransferByRate = [...new Set(transferByRun.map((t) => t.rate))].sort((x, y) => x - y).map((rate) => {
    const fracs = transferByRun.filter((t) => t.rate === rate && t.frac !== null).map((t) => t.frac!);
    return { rate, n: fracs.length, meanLivingTransferFraction: fracs.length ? mean(fracs) : null };
  });

  const perRunHistories = perRun.map((r) => ({ runId: r.run.runId, arms: r.run.arms, condition: r.run.condition, seed: r.run.seed, area: r.run.area, richness: r.richness, turnover: r.turnover }));

  const report = {
    root,
    experiment: manifest.experiment,
    eligibleRuns: perRun.length,
    rejectedRuns: rejected,
    areaFits,
    isolation,
    turnoverSummary,
    diagnostics: { perAreaExtinction, foundingDensityByArea, livingTransferByRate },
    perRunHistories,
  };
  await Deno.mkdir(outDir, { recursive: true });
  await Deno.writeTextFile(`${outDir}/report.json`, JSON.stringify(report, null, 2));
  const md = [
    `# Island-biogeography report: ${manifest.experiment}`,
    ``,
    `${perRun.length} eligible runs, ${rejected.length} rejected.`,
    ...rejected.map((r) => `- REJECTED ${r.runId}: ${r.problems.join("; ")}`),
    ``,
    `## Species-area fit`,
    ...Object.entries(areaFits).map(([c, f]) =>
      `- ${c}: ${"error" in f ? f.error : `z=${f.z.toFixed(3)} ${f.ci ? `ci=[${f.ci[0].toFixed(3)}, ${f.ci[1].toFixed(3)}]` : "ci=n/a (fewer than 2 independent seeds)"} n=${f.n} excludedZeros=${f.excludedZeros}`}`,
    ),
    ``,
    `## Isolation effect`,
    !isolation
      ? "(no isolation-arm runs)"
      : "error" in isolation
      ? `ERROR: ${isolation.error}`
      : [
        `trendCorrelation=${isolation.trendCorrelation.toFixed(3)} (seed-blocked/demeaned, n=${isolation.trendN}${isolation.trendCI ? `, 95% ci=[${isolation.trendCI[0].toFixed(3)}, ${isolation.trendCI[1].toFixed(3)}]` : Number.isFinite(isolation.trendCorrelation) ? ", ci=n/a (fewer than 2 seeds observed at more than one rate)" : ", ci=n/a (correlation undefined: richness never varies within a seed)"})`,
        `bestRateVsNoMigration (exploratory): rate=${isolation.bestRateVsNoMigration.rate ?? "none"} p=${isolation.bestRateVsNoMigration.p.toFixed(4)} holmAdjustedP=${isolation.bestRateVsNoMigration.holmAdjustedP.toFixed(4)} effect=${isolation.bestRateVsNoMigration.effect.toFixed(3)}`,
      ].join("\n"),
    ``,
    `## Turnover`,
    `(crossingStep/equilibriumRichness come from turnoverEquilibrium's smoothed, cadence-aware criterion; perRunHistories carries the elapsed-step-normalized colonizationRate/extinctionRate for cross-run comparison.)`,
    ...turnoverSummary.map((t) => `- ${t.run} tile ${t.tile}: crossingStep=${t.crossingStep} equilibriumRichness=${t.equilibriumRichness}`),
    ``,
    `## Diagnostics`,
    `### Per-area extinction rate (AREA arm)`,
    ...perAreaExtinction.map((d) => `- ${d.condition} area=${d.area}: ${d.extinct}/${d.n} extinct (${(d.extinctionRate * 100).toFixed(1)}%)`),
    `### Founding density by area`,
    ...foundingDensityByArea.map((d) => `- area=${d.area}: occupiedFraction=${d.occupiedFraction.toFixed(3)} founderCellsPerTileEstimate=${d.founderCellsPerTileEstimate.toFixed(0)}`),
    `### Realized living-transfer fraction (ISOLATION arm, treatment, from migrations.tsv)`,
    ...livingTransferByRate.map((d) => `- rate=${d.rate}: n=${d.n} meanLivingTransferFraction=${d.meanLivingTransferFraction === null ? "n/a" : d.meanLivingTransferFraction.toFixed(3)}`),
  ].join("\n");
  await Deno.writeTextFile(`${outDir}/report.md`, md);
  console.log(`wrote ${outDir}/report.json and ${outDir}/report.md (${perRun.length} eligible, ${rejected.length} rejected)`);

  if (a.prune) {
    if (rejected.length > 0) {
      console.error("refusing --prune: the report just written has rejected runs; fix or exclude them first");
      Deno.exit(1);
    }
    for (const r of loaded) {
      try {
        await Deno.remove(`${r.dir}/checkpoints`, { recursive: true });
      } catch {
        // already gone
      }
    }
    console.log(`pruned checkpoints for ${loaded.length} runs (their extracted histories are in ${outDir}/report.json's perRunHistories)`);
  }
}
