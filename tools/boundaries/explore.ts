/** Fixed descriptive boundary-field pilot. Requires Node 24.2.0. */
import { createHash } from 'node:crypto';
import { deepStrictEqual } from 'node:assert';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BOUNDARY_MODES, BOUNDARY_RULES, BoundaryWorld, type BoundaryAccounting, type BoundaryCensus, type BoundaryMode } from '../../apps/lab/src/boundaries/model.ts';

const seeds = [1201, 1202, 1203, 1204, 1205, 1206] as const;
const modes = [...BOUNDARY_MODES] as BoundaryMode[];
const duration = 3000;
const sampleEvery = 100;
const modelPath = 'apps/lab/src/boundaries/model.ts';
const runnerPath = 'tools/boundaries/explore.ts';
const jsonPath = new URL('../../docs/creative-prototypes/boundaries-pilot.json', import.meta.url);
const markdownPath = new URL('../../docs/creative-prototypes/boundaries-pilot.md', import.meta.url);
const settings = { seeds, modes, duration, sampleEvery, lateWindow: { fromTick: 2000, toTick: 3000, intervals: 10 } };
const definitions = {
  components: 'Four-connected periodic regions of cells with density >= 0.35 and size >= 4. Tiny regions are counted separately; regions are not organisms.',
  neighborContrast: 'Mean absolute density difference over the 8192 unique periodic east/south edges.',
  blockedEdgeFraction: 'Fraction of the same 8192 edges blocked for biomass transport by current wall values; nutrient transport is never blocked.',
  sampledChange: 'Mean absolute density change and active-mask flip fraction from the previous census. Extinction can close an interval shorter than 100 ticks.',
  comparisonTick: 'Shared scheduled age for the experiment. It advances after extinction while physical fieldTick and all fields remain frozen.',
  accounting: 'Open density balance: expected = initial + reaction + diffusion residual + signed clamp adjustment - floor loss. This verifies bookkeeping, not reaction correctness or conservation of the open system.',
  interpretation: 'Density and nutrient are proxies in an engineered open-energy field toy. Walls are supplied reinforcement; this is not evidence of organisms, heredity, adaptation, or evolution.',
};

const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && !['--check', '--replay-check'].includes(args[0]))) {
  throw new Error('Usage: node tools/boundaries/explore.ts [--check|--replay-check]');
}
if (process.version !== 'v24.2.0') throw new Error(`Boundary evidence requires Node v24.2.0; got ${process.version}`);

const hash = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');
const sourceHashes = Object.fromEntries([modelPath, runnerPath].map(path => [path, hash(readFileSync(new URL(`../../${path}`, import.meta.url)))]));
const rulesDigest = hash(JSON.stringify(BOUNDARY_RULES));

interface PilotRow {
  comparisonTick: number;
  fieldTick: number;
  extinct: boolean;
  census: BoundaryCensus;
}
interface RunResult {
  mode: BoundaryMode;
  seed: number;
  ticksCompleted: number;
  extinctionTick: number | null;
  history: PilotRow[];
  final: BoundaryCensus;
  accounting: BoundaryAccounting;
  maximumAbsoluteTickDensityDiffusionResidual: number;
  maximumAbsoluteTickNutrientDiffusionResidual: number;
  maximumAbsoluteTickClampAdjustment: number;
  maximumAbsoluteDensityBalanceResidual: number;
  lateChange: { status: 'live'; intervalMeans: number[]; mean: number; intervalMaskFlipFractions: number[]; meanMaskFlipFraction: number } | { status: 'extinct'; extinctionTick: number };
}

function assertTick(world: BoundaryWorld, priorTick: number, comparisonTick: number, wasLiving: boolean): { densityDiffusion: number; nutrientDiffusion: number; clamp: number; balance: number } {
  if (world.tick !== priorTick + (wasLiving ? 1 : 0)) {
    throw new Error(`Physical tick did not advance exactly once at comparison tick ${comparisonTick} for ${world.mode}/${world.seed}`);
  }
  const density = world.density, nutrient = world.nutrient, wall = world.wall;
  if (density.length !== BOUNDARY_RULES.cells || nutrient.length !== BOUNDARY_RULES.cells || wall.length !== BOUNDARY_RULES.cells) {
    throw new Error(`Field length invariant failed at comparison tick ${comparisonTick} for ${world.mode}/${world.seed}`);
  }
  for (let i = 0; i < density.length; i++) {
    for (const [name, value] of [['density', density[i]], ['nutrient', nutrient[i]], ['wall', wall[i]]] as const) {
      if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${name} range/finite invariant failed at comparison tick ${comparisonTick}, cell ${i}, ${world.mode}/${world.seed}`);
    }
    if ((world.mode === 'smooth' || world.mode === 'threshold') && wall[i] !== 0) {
      throw new Error(`Wall-disabled mode created wall strength at comparison tick ${comparisonTick}, cell ${i}, ${world.mode}/${world.seed}`);
    }
  }
  const ledger = world.accounting;
  const ledgerValues = Object.values(ledger);
  if (!ledgerValues.every(Number.isFinite)) throw new Error(`Nonfinite accounting ledger at comparison tick ${comparisonTick}, ${world.mode}/${world.seed}`);
  const densityDiffusion = ledger.maxAbsDensityDiffusionResidual;
  const nutrientDiffusion = ledger.maxAbsNutrientDiffusionResidual;
  const clamp = ledger.maxAbsClampAdjustment;
  const balance = Math.abs(ledger.residual);
  if (densityDiffusion > BOUNDARY_RULES.diffusionResidualMax) throw new Error(`Density diffusion residual ${densityDiffusion} exceeds ${BOUNDARY_RULES.diffusionResidualMax} at comparison tick ${comparisonTick}, ${world.mode}/${world.seed}`);
  if (nutrientDiffusion > BOUNDARY_RULES.diffusionResidualMax) throw new Error(`Nutrient diffusion residual ${nutrientDiffusion} exceeds ${BOUNDARY_RULES.diffusionResidualMax} at comparison tick ${comparisonTick}, ${world.mode}/${world.seed}`);
  if (clamp > BOUNDARY_RULES.clampAdjustmentMax) throw new Error(`Clamp adjustment ${clamp} exceeds ${BOUNDARY_RULES.clampAdjustmentMax} at comparison tick ${comparisonTick}, ${world.mode}/${world.seed}`);
  if (balance > BOUNDARY_RULES.cumulativeBalanceMax) throw new Error(`Density ledger residual ${balance} exceeds ${BOUNDARY_RULES.cumulativeBalanceMax} at comparison tick ${comparisonTick}, ${world.mode}/${world.seed}`);
  if (world.extinctionTick !== null && density.some(value => value !== 0)) throw new Error(`Extinct world acquired nonzero density at comparison tick ${comparisonTick}, ${world.mode}/${world.seed}`);
  return { densityDiffusion, nutrientDiffusion, clamp, balance };
}

function row(world: BoundaryWorld, comparisonTick: number): PilotRow {
  return { comparisonTick, fieldTick: world.tick, extinct: world.extinctionTick !== null, census: world.census() };
}

function generateResults(): RunResult[] {
  const initialBySeed = new Map<number, { density: Float64Array; nutrient: Float64Array; wall: Float64Array }>();
  for (const seed of seeds) {
    const first = new BoundaryWorld(seed, modes[0]);
    initialBySeed.set(seed, { density: first.density, nutrient: first.nutrient, wall: first.wall });
    for (const mode of modes.slice(1)) {
      const candidate = new BoundaryWorld(seed, mode);
      const expected = initialBySeed.get(seed)!;
      deepStrictEqual(candidate.density, expected.density, `Initial density differs for seed ${seed}/${mode}`);
      deepStrictEqual(candidate.nutrient, expected.nutrient, `Initial nutrient differs for seed ${seed}/${mode}`);
      deepStrictEqual(candidate.wall, expected.wall, `Initial wall differs for seed ${seed}/${mode}`);
    }
  }

  const results: RunResult[] = [];
  for (const mode of modes) for (const seed of seeds) {
    const world = new BoundaryWorld(seed, mode);
    const history: PilotRow[] = [row(world, 0)];
    let maxDensityDiffusion = 0, maxNutrientDiffusion = 0, maxClamp = 0, maxBalance = 0;
    let scheduledTick = 0;
    let exactExtinctionRecorded = false;
    let extinctionFields: { density: Float64Array; nutrient: Float64Array; wall: Float64Array } | null = null;
    for (let comparisonTick = 1; comparisonTick <= duration; comparisonTick++) {
      const priorTick = world.tick;
      const wasLiving = world.extinctionTick === null;
      if (wasLiving) world.step(1);
      const maxima = assertTick(world, priorTick, comparisonTick, wasLiving);
      maxDensityDiffusion = Math.max(maxDensityDiffusion, maxima.densityDiffusion);
      maxNutrientDiffusion = Math.max(maxNutrientDiffusion, maxima.nutrientDiffusion);
      maxClamp = Math.max(maxClamp, maxima.clamp);
      maxBalance = Math.max(maxBalance, maxima.balance);
      if (world.extinctionTick !== null && !exactExtinctionRecorded) {
        if (world.extinctionTick !== world.tick) throw new Error(`Extinction tick disagrees with physical tick for ${mode}/${seed}`);
        extinctionFields = { density: world.density, nutrient: world.nutrient, wall: world.wall };
        if (history.at(-1)?.comparisonTick !== comparisonTick) history.push(row(world, comparisonTick));
        exactExtinctionRecorded = true;
      }
      if (extinctionFields) {
        deepStrictEqual(world.density, extinctionFields.density, `Post-extinction density changed for ${mode}/${seed}/${comparisonTick}`);
        deepStrictEqual(world.nutrient, extinctionFields.nutrient, `Post-extinction nutrient changed for ${mode}/${seed}/${comparisonTick}`);
        deepStrictEqual(world.wall, extinctionFields.wall, `Post-extinction wall changed for ${mode}/${seed}/${comparisonTick}`);
      }
      if (comparisonTick % sampleEvery === 0) {
        if (scheduledTick === comparisonTick) throw new Error(`Duplicate scheduled row for ${mode}/${seed} at ${comparisonTick}`);
        if (history.at(-1)?.comparisonTick !== comparisonTick) history.push(row(world, comparisonTick));
        scheduledTick = comparisonTick;
      }
      if (world.extinctionTick !== null && !exactExtinctionRecorded) throw new Error(`Exact extinction row missing for ${mode}/${seed}`);
    }
    const scheduledRows = history.filter(item => item.comparisonTick % sampleEvery === 0);
    if (scheduledRows.length !== duration / sampleEvery + 1) throw new Error(`Expected ${duration / sampleEvery + 1} scheduled rows for ${mode}/${seed}; got ${scheduledRows.length}`);
    if (new Set(history.map(item => item.comparisonTick)).size !== history.length) throw new Error(`Duplicate history comparison tick for ${mode}/${seed}`);
    if (world.extinctionTick !== null) {
      const extinctionRows = history.filter(item => item.comparisonTick === world.extinctionTick && item.fieldTick === world.extinctionTick && item.extinct);
      if (extinctionRows.length !== 1) throw new Error(`Expected one exact extinction record for ${mode}/${seed}; got ${extinctionRows.length}`);
      for (const item of history.filter(item => item.comparisonTick > world.extinctionTick!)) {
        if (item.fieldTick !== world.extinctionTick || !item.extinct || item.census.densityTotal !== 0) throw new Error(`Post-extinction history was not frozen at ${mode}/${seed}/${item.comparisonTick}`);
      }
    }
    const lateRows = Array.from({ length: 10 }, (_, index) => history.find(item => item.comparisonTick === 2100 + index * 100)!);
    let lateChange: RunResult['lateChange'];
    if (world.extinctionTick !== null && world.extinctionTick <= 3000) {
      lateChange = { status: 'extinct', extinctionTick: world.extinctionTick };
    } else {
      const intervalMeans = lateRows.map(item => {
        const change = item.census.sampledChange;
        if (!change || change.fromTick !== item.comparisonTick - sampleEvery || change.toTick !== item.comparisonTick) {
          throw new Error(`Missing exact 100-tick sampled change ending ${item.comparisonTick} for ${mode}/${seed}`);
        }
        return change.meanAbsDelta;
      });
      const intervalMaskFlipFractions = lateRows.map(item => item.census.sampledChange!.maskFlipFraction);
      lateChange = { status: 'live', intervalMeans, mean: intervalMeans.reduce((a, b) => a + b, 0) / intervalMeans.length,
        intervalMaskFlipFractions, meanMaskFlipFraction: intervalMaskFlipFractions.reduce((a, b) => a + b, 0) / intervalMaskFlipFractions.length };
    }
    results.push({ mode, seed, ticksCompleted: world.tick, extinctionTick: world.extinctionTick, history,
      final: world.census(), accounting: world.accounting, maximumAbsoluteTickDensityDiffusionResidual: maxDensityDiffusion,
      maximumAbsoluteTickNutrientDiffusionResidual: maxNutrientDiffusion,
      maximumAbsoluteTickClampAdjustment: maxClamp, maximumAbsoluteDensityBalanceResidual: maxBalance, lateChange });
    const final = world.census();
    console.log(`${mode} ${seed}: fieldTick=${world.tick}, extinct=${world.extinctionTick ?? 'no'}, density=${final.densityTotal.toFixed(6)}, components=${final.components}, tiny=${final.tinyComponents}, contrast=${final.neighborContrast.toFixed(6)}, blocked=${final.blockedEdgeFraction.toFixed(4)}`);
  }
  return results;
}

function makeArtifact(results: RunResult[]) {
  return { kind: 'sharp-boundary-field-pilot', runtime: process.version, rules: BOUNDARY_RULES, rulesDigest, sourceHashes, settings, definitions, results };
}

function renderReport(artifact: ReturnType<typeof makeArtifact>): string {
  const { results } = artifact;
  const rows = results.map(r => `| ${r.mode} | ${r.seed} | ${r.ticksCompleted} | ${r.extinctionTick ?? '—'} | ${r.final.densityTotal.toFixed(3)} | ${r.final.nutrientMean.toFixed(3)} | ${r.final.activeCellFraction.toFixed(4)} | ${r.final.components} | ${r.final.tinyComponents} | ${r.final.largestComponent} | ${r.final.neighborContrast.toFixed(5)} | ${r.final.blockedEdgeFraction.toFixed(4)} | ${r.lateChange.status === 'live' ? r.lateChange.mean.toExponential(3) : `extinct at ${r.lateChange.extinctionTick}`} | ${r.lateChange.status === 'live' ? r.lateChange.meanMaskFlipFraction.toFixed(5) : 'extinct'} |`).join('\n');
  const modeSummary = modes.map(mode => {
    const group = results.filter(r => r.mode === mode);
    const live = group.filter(r => r.lateChange.status === 'live');
    const average = (key: (result: RunResult) => number) => group.reduce((total, r) => total + key(r), 0) / group.length;
    const lateText = live.length ? `mean late density change ${(live.reduce((s, r) => s + (r.lateChange.status === 'live' ? r.lateChange.mean : 0), 0) / live.length).toExponential(3)} and mean active-mask flip fraction ${(live.reduce((s, r) => s + (r.lateChange.status === 'live' ? r.lateChange.meanMaskFlipFraction : 0), 0) / live.length).toFixed(5)} over ${live.length} live runs` : 'no live late-change estimates';
    return `- **${mode}:** final density mean ${average(r => r.final.densityTotal).toFixed(3)}, final active-cell fraction mean ${average(r => r.final.activeCellFraction).toFixed(4)}, final qualifying components mean ${average(r => r.final.components).toFixed(2)}; ${lateText}; extinction seeds ${group.filter(r => r.extinctionTick !== null).map(r => r.seed).join(', ') || 'none'}.`;
  }).join('\n');
  const bothEarly = results.filter(r => r.mode === 'both' && r.extinctionTick !== null && r.extinctionTick < 500).length;
  const earlyOutcome = bothEarly === seeds.length
    ? 'All six both-mode runs went extinct before tick 500. Retain these outcomes and stop tuning or extending this slice.'
    : `The six both-mode runs had ${bothEarly} extinctions before tick 500; all scheduled rows and seeds remain included.`;
  const both = results.filter(r => r.mode === 'both');
  const bothLateMaximum = Math.max(...both.map(r => r.lateChange.status === 'live' ? r.lateChange.mean : 0));
  const walls = results.filter(r => r.mode === 'walls');
  const wallsBlockedMean = walls.reduce((s, r) => s + r.final.blockedEdgeFraction, 0) / walls.length;
  const thresholdMaskChanges = results.filter(r => r.mode === 'threshold').flatMap(r => r.lateChange.status === 'live' ? r.lateChange.intervalMaskFlipFractions : []);
  const thresholdChangedIntervals = thresholdMaskChanges.filter(value => value > 0).length;
  const narrative = `## Outcome: negative / illustrative\n\nThis batch falls in the plan's negative/illustrative category. Both mode retained 3–6 qualifying regions in every seed, but the largest per-run mean late density change across the ten intervals was only ${bothLateMaximum.toExponential(2)}, and its late active-mask flip fractions were zero: this is shape preservation without sustained shape activity. Walls alone still ended as one broad connected field in all six seeds despite a mean biomass-blocked edge fraction of ${wallsBlockedMean.toFixed(3)}. Smooth and threshold-only fields ended as one connected region in every seed; threshold-only continued changing density, with active-mask changes in ${thresholdChangedIntervals} of 60 late intervals. This is a negative result for sustained shape activity under the tested recipes, retained as an illustrative prototype rather than an evolution result.`;
  return `# Sharp-boundary field pilot\n\nFour fixed modes × seeds 1201–1206 × 3,000 comparison ticks. Runtime ${artifact.runtime}; rule version ${BOUNDARY_RULES.version}; rules SHA-256 \`${artifact.rulesDigest}\`. No tuning, reseeding, mutation, disturbance, or rescue.\n\n| Mode | Seed | Physical ticks | Extinction tick | Final density total | Mean nutrient | Active fraction | Components ≥4 | Tiny regions | Largest region | Neighbor contrast | Blocked edge fraction | Late density change (2000–3000) | Late mask flips |\n|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|\n${rows}\n\n## Across-seed summaries\n\n${modeSummary}\n\n${earlyOutcome}\n\n${narrative}\n\n## Reading these observations\n\n${definitions.interpretation} Increasing component count does not mean division. Component counts use periodic four-neighbor connectivity and density ≥0.35; only regions of four or more cells enter the main count. Tiny regions are retained separately. Late-change means average the ten intervals ending at ticks 2100 through 3000 for runs that remained live; an extinct run is labeled with its extinction tick and is never entered as zero activity. Late mask flips are the mean fraction of cells crossing the 0.35 threshold per interval, averaged over those same ten intervals.\n\nThe JSON keeps the full scheduled history for every seed, exact extinction rows, and frozen scheduled rows after extinction. Every tick checked finite [0,1] field values, wall-disabled invariants, both per-tick diffusion residual bounds, clamp bounds, cumulative density accounting, and no density revival after extinction. Maximum absolute density diffusion residual: ${Math.max(...results.map(r => r.maximumAbsoluteTickDensityDiffusionResidual)).toExponential(3)}; maximum absolute nutrient diffusion residual: ${Math.max(...results.map(r => r.maximumAbsoluteTickNutrientDiffusionResidual)).toExponential(3)}; maximum clamp adjustment: ${Math.max(...results.map(r => r.maximumAbsoluteTickClampAdjustment)).toExponential(3)}; maximum cumulative density balance residual: ${Math.max(...results.map(r => r.maximumAbsoluteDensityBalanceResidual)).toExponential(3)}.\n\nThis is a same-runtime descriptive comparison, not a cross-engine identity claim. The model SHA-256 and runner SHA-256 are recorded in [boundaries-pilot.json](boundaries-pilot.json). Check source and rule freshness without simulation or writes: \`node tools/boundaries/explore.ts --check\`. Regenerate the full deterministic batch in Node 24.2.0 with \`node tools/boundaries/explore.ts\`; compare a full regeneration without writing with \`node tools/boundaries/explore.ts --replay-check\`.\n`;
}

if (args[0] === '--check') {
  const saved = JSON.parse(readFileSync(jsonPath, 'utf8'));
  if (saved.runtime !== process.version) throw new Error(`Boundary evidence runtime is stale: ${saved.runtime} != ${process.version}`);
  deepStrictEqual(saved.sourceHashes, sourceHashes, 'Boundary evidence is stale: model or runner source changed');
  deepStrictEqual(saved.rules, BOUNDARY_RULES, 'Boundary evidence is stale: model rules changed');
  if (saved.rulesDigest !== rulesDigest) throw new Error('Boundary evidence rule digest is stale');
  deepStrictEqual(saved.settings, settings, 'Boundary evidence settings changed');
  const matrix = saved.results?.map((r: RunResult) => `${r.mode}/${r.seed}`).sort();
  deepStrictEqual(matrix, modes.flatMap(mode => seeds.map(seed => `${mode}/${seed}`)).sort(), 'Boundary evidence must contain each mode/seed pair exactly once');
  if (new Set(matrix).size !== modes.length * seeds.length) throw new Error('Boundary evidence contains duplicate mode/seed pairs');
  deepStrictEqual(readFileSync(markdownPath, 'utf8'), renderReport(saved), 'Boundary Markdown report is stale: rerun tools/boundaries/explore.ts');
  console.log(`Boundary evidence source/rules hashes, runtime, settings, exact ${modes.length}×${seeds.length} matrix, and Markdown report match. No simulation or writes.`);
} else if (args[0] === '--replay-check') {
  const saved = JSON.parse(readFileSync(jsonPath, 'utf8'));
  deepStrictEqual(saved, makeArtifact(generateResults()), 'Boundary evidence differs from deterministic full replay');
  console.log('Full deterministic boundary evidence replay matches saved artifact. No files written.');
} else {
  const artifact = makeArtifact(generateResults());
  writeFileSync(jsonPath, JSON.stringify(artifact, null, 2) + '\n');
  writeFileSync(markdownPath, renderReport(artifact));
  console.log(`Saved ${fileURLToPath(jsonPath)} and ${fileURLToPath(markdownPath)}`);
}
