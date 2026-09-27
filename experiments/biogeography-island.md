# Island biogeography over the archipelago (DRAFT — not yet frozen)

*A standalone experiment note, not an amendment to `experiments/preregistration.md` (frozen) or
`docs/plan.md` (edited elsewhere). See `tools/biogeo-sweep.ts`, `tools/biogeo-analyze.ts`,
`packages/schema/src/world.ts`, `packages/runner/src/runner.ts`, `packages/metrics/src/biogeography.ts`.*

## Question

Do the genetic clusters M3 confirms (`geneticClusters`/`CLUSTER_DISTANCE`) behave like ecological
species under MacArthur–Wilson island biogeography: a species–area curve `S = c·A^z`, lower
diversity with isolation, and a colonisation/extinction turnover equilibrium?

## Design

Each tile of an archipelago run is one "island" (one tile is an independent torus).
`archipelagoWorld` stocks **every** tile with one founder per genome from the M3-confirmed
clusters (`M3_FOUNDERS`, currently 12), so every island starts from an identical species pool regardless of tile
size; grid-slot assignment is a seeded permutation of `cfg.seed` so a founder's identity is never
confounded with its light-gradient position.

Two axes, plus the no-migration control: **AREA** (`tileW = tileH ∈ {24, 32, 48, 64, 96, 128}`,
`tilesX = tilesY = 2`, the `treatment` migration rate `migrantCount = 2` at `migrationPeriod = 200`
held fixed), **ISOLATION** (`migrantCount ∈ {1, 2, 4, 8, 16}` at a fixed `tileW = tileH = 64`,
`migrationPeriod = 200` — rate is the isolation axis, not ring degree/topology), and
**no-migration** (`migrantCount = migrationPeriod = 0`, one point per level, the same seed reused
across every rate: paired, not pooled). `tools/biogeo-sweep.ts` builds one deduplicated point
matrix keyed by `(tileW,tileH,tilesX,tilesY,migrationPeriod,migrantCount,condition,seed)` and
writes it once, up front, as an immutable `experiment.json` naming every run by a content-hashed
`runId` (never a path encoding arm/area/condition); a point satisfying both arms' rules runs once,
tagged with both. At the defaults this is **80 unique runs** (`--dry-run`'s own count, below).

## Estimands

Two species definitions, both computed by the runner at census time into each run's `species.tsv`
(`RunSpec.speciesCensus`, `tileSpeciesCensus`): **`geneticRichness`** — single-linkage
`geneticClusters` over each tile's distinct living genomes (unbounded, no fixed anchor; the actual
M3 species definition), backing the species–area fit and isolation effect — and
**`founderPersistence`** — nearest-anchor classification against the fixed `M3_FOUNDERS`
(`founderPresenceMask`, stable identity across time), backing turnover of *founder-like genetic
classes*. This is genetic similarity, not ancestry: a founder's descendants that drift beyond
`CLUSTER_DISTANCE` of its anchor register as an extinction, and a lineage drifting back toward an
anchor registers as a colonisation without any immigration, so turnover here is not turnover of
original founder lineages. They can disagree on the same data (a mutant chain can
bridge two founder-anchored clusters into one under single linkage while nearest-anchor still
counts two, or vice versa; see `packages/metrics/test/biogeography.test.ts`'s chain/bridge cases).

A migration "packet" moves a whole cell — species channels, energy, signal, motility *and* the
complete genome — so `migrantCount/migrationPeriod` is a packet-transfer rate, not an observed
immigration rate; the report states, per rate, the fraction of `migrations.tsv` transfers that
carried a living lineage. **Framing**: a closed metacommunity — every island starts with the full
founder pool, migration only redistributes existing material, and there is no external source to
reintroduce a lost lineage; results are persistence/redistribution, not mainland rescue.

## Analysis

`tools/biogeo-analyze.ts` reads only `experiment.json` and the run directories it lists — no
directory walking, path parsing, or cross-invocation dedup (the manifest makes duplicate/mixed runs
structurally impossible). For each run it loads `species.tsv`, checks eligibility (complete,
correct versions, config matches its manifest entry, census reached the horizon on every tile), and
computes archipelago-mean late-run `geneticRichness` (one point per run, never per tile —
`applyMigration` couples every tile of a `treatment` run into one ring) plus per-tile turnover
straight from `species.tsv`'s own rows (its first row is already the true step-0 baseline — no
reconstruction needed). Species–area fit (bootstrap CI on `z`) runs per condition over the AREA
arm; isolation effect (seed-paired trend + Holm-corrected best-rate) over the ISOLATION arm.

## Predicted outcomes

1. **Species–area**: a positive, sub-linear `z` (classical range ~0.2–0.35) for both `treatment`
   and `no-migration`, fit on `geneticRichness` against area (`tileW*tileH`, never side length).
2. **Isolation/rescue**: `geneticRichness` rises with migration rate (a seed-blocked, demeaned
   Pearson trend with a bootstrap 95% CI, plus an exploratory Holm-corrected best-rate comparison);
   `no-migration` should show a lower, more area-sensitive equilibrium (steeper `z`) at the run level.
3. **Turnover**: every island is stocked with all `M3_FOUNDERS.length` founder-like classes at step 0 (stocking, not
   colonisation; the baseline row carries no rate). Early intervals should show losses with few or
   no reappearances; with migration, lost classes should then reappear until per-step extinction
   and reappearance rates balance at a stable richness below the full founder count (a flat,
   non-drifting tail, minimum span). A run that never balances is a real "not yet at equilibrium"
   result, not a detection failure; `no-migration` islands can only lose classes or regain them by
   genetic drift back toward an anchor.

## Known confounds (measured and reported, not hidden)

- **Founding density scales with area** (recomputed per area from `archipelagoFounderLayout`, never
  a sidecar), and `treatment`'s fixed `migrantCount = 2` spans a ~28× cell-count range, so
  `z_treatment` isn't a pure area effect at constant connectivity.
- **Zero-richness (extinct) observations** are excluded from the log-log fit (`log(0)` undefined,
  excluded count and rate by area always reported); migration moves matter and residents together,
  so check the living-transfer fraction before crediting richness change to organism movement.

## What a failure would mean

If `z`'s bootstrap CI does not exclude 0 (or is negative), that is inconclusive on whether area
limits diversity, not a positive finding that it doesn't — too little precision (few seeds, short
run) and a genuinely flat relationship both produce it. `z` can also come back with no CI at all
(`ci: null`, fewer than 2 distinct seeds survived) — report that as unavailable, never as a narrow
interval. If colonisation/extinction never cross, the equilibrium criterion is simply unmet: that
can mean richness is transient, but a run already at a stable, turnover-free state also shows no
crossing, so "no crossing" alone doesn't distinguish the two — a real, reportable result either way,
not evidence against the hypothesis.

## Cost and how to run

```
cd /Users/nicholas/develop/browser-life-biogeo
deno run -A tools/biogeo-sweep.ts --experiment biogeo-1 \
  --areas 24,32,48,64,96,128 --iso-tile 64 --iso-rates 1,2,4,8,16 \
  --migration-period 200 --seeds 1-5 --steps 20000 --census 100 \
  --dry-run    # drop --dry-run to actually run it
```

At the defaults (`--checkpoint 0`: `species.tsv`, not checkpoints, is the analysis input now) this
reports **80 unique runs, ~3.3×10¹⁰ total cell-steps, ~1.7 MB of species.tsv** — reproducible from
the command above. Then `deno run -A tools/biogeo-analyze.ts runs/biogeo-1`; the expected
bottleneck is per-census WebGPU readback latency, not compute or `species.tsv` size.

`tools/biogeo-smoke.ts` proves the pipeline end to end, unconditionally: in-memory `RefSim` checks,
`resolveExperimentDir`'s fresh/resume/mismatch-throws rules, then a small real multi-area/isolation
experiment (3 areas, a paired rate, 2 seeds) through `tools/biogeo-sweep.ts`'s own run loop
(`runExperiment`/`fsSink`, a real WebGPU device required), analyzed by the real
`tools/biogeo-analyze.ts` CLI — 12 runs, none rejected, species-area `z(treatment)=0.000`,
`z(no-migration)=0.000`, isolation rates `[0, 0.05]` (real, not ecologically meaningful at this
scale). `tests/deno/species-census.ts` (WebGPU) proves `speciesCensus` is byte-identical-when-absent
(and when explicitly `false`) against a pinned digest, and matches `tileSpeciesCensus` at step 0.
`pnpm typecheck`, `pnpm vitest run`, `deno check`, and both above pass; no real `biogeo-1` sweep has
run yet.
