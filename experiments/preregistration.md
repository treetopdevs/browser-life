# Pre-registration (DRAFT — not yet frozen)

*Status: draft. Freeze before any M4+ ensemble by committing this file and recording its SHA-256 in `experiments/FROZEN`. After freezing, changes require a dated amendment section; the original text stays.*

## Question

In a world that is closed in matter and open in energy, with individuality, reproduction and heredity left to emerge from local integer rules, does organisation measured by held-out observables keep increasing above what neutral drift and ablated controls produce, over the observation window?

## System under test

- Rules: `RULE_VERSION` in `packages/schema/src/config.ts`, pinned by `packages/sim-ref/test/golden-hashes.test.ts`. The GPU kernels must pass the CPU golden test on every contributing device (`/selftest.html`, `deno task`/`tests/deno/gpu_golden.ts`).
- Presets: `spots` (uniform light) and `gradient` (light gradient). The bootstrap search is **off** for all ensemble runs; founders are the hand-built generalist genome.
- Runner: `tools/run.ts` (headless) or the browser worker, writing run bundles as documented in `packages/runner/src/runner.ts`.

## Conditions (randomised over seeds)

| id | removes |
|---|---|
| treatment | nothing |
| neutral | genotype → phenotype mapping (all cells express the reference phenotype; lineages drift) |
| no-mutation | heritable variation |
| uniform-light | spatial energy gradient (gradient preset only); light is set to the tile-mean intensity, rounded to the nearest integer |
| fixed-env | seasonal change (seasons preset only); the cycle-mean seasonal light, rounded to the nearest integer, is added to the base light |
| replenished | closure pressure (abiotic waste recycling at a high rate) |
| no-signal-motility | signalling and active motility |

## Ensemble

- Seeds: 1–20 per condition (primary preset `gradient`), 10 per condition for `spots`.
- Horizon: 10⁶ steps per history at 256² (≈15–20 min on an M1 Max; longer on mobile).
- Census every 100 steps; deep metrics every 10 censuses.
- A run counts if it completes with exact conservation (matter Δ = 0 and energy residual = 0 at every census). Extinct runs are kept and reported, not dropped.

## Primary endpoints

*The list below is generated from `experiments/endpoints.ts` by `tools/gen-prereg.ts`
(`deno task gen-prereg` / `pnpm gen:prereg`); `tests/deno/prereg-sync.ts` and
`experiments/test/prereg-sync.test.ts` fail if this section falls out of sync with that
module. Do not hand-edit the text between the markers.*

<!-- GENERATED:endpoints:start -->
1. **Adaptive activity.** Cumulative new evolutionary activity (Bedau–Packard) with the threshold fixed at the 95th percentile of lineage activity pooled over the neutral runs. Hypothesis: treatment > neutral and treatment > no-mutation (one-sided Mann–Whitney, α = 0.01 after Holm correction across the two comparisons).
2. **Unbounded-looking growth.** Within treatment runs, the cumulative new-activity curve is classified (`growthVsSaturation` in `packages/metrics/src/stats.ts`): "flat" if its linear change over the window is below 5% of its mean; otherwise "growing" if the linear model is preferred by ΔAIC ≥ 2 (ΔAIC = AIC_sat − AIC_lin) or the fitted saturation time constant lies beyond half the window; "saturating" if ΔAIC ≤ −2 with the time constant within half the window; otherwise "indeterminate". Hypothesis: a majority of treatment runs are "growing" while at most a minority of neutral runs are. A lineage counts as adaptively significant only when its activity is strictly above the neutral threshold.
3. **Ecological closure — recycling.** Biotic share of waste recycling (decomposition / (decomposition + abiotic)). Hypothesis: treatment > replenished (one-sided Mann–Whitney, α = 0.01).
4. **Ecological closure — coexistence.** Continuous coexistence of ≥2 trophic roles (each holding ≥5% of living cells) for ≥ 10⁵ steps, computed from the scheduled role observations in `series.jsonl`. `rolesPresent` is recorded only on deep censuses (every `deepEvery` censuses); the duration is measured across consecutive *deep* censuses only — a non-deep census carries no role information and neither continues nor breaks a coexistence run. Hypothesis: a majority of treatment runs reach a qualifying duration (≥3 roles sustained the same way is the M5 gate, reported alongside; it is not required for this endpoint).
<!-- GENERATED:endpoints:end -->

## Held-out observables (never used by any search, selection or environment generator)

Temporal mutual information of 2×2 occupancy patterns, pattern entropy, lineage-map compression ratio, internal differentiation, compartmentalised individuals, role count. Reported side by side (compressibility with predictability), never combined into one score. Hypothesis: treatment shows a positive trend in at least two of them where controls do not.

## Reproduction and heredity (descriptive)

Fission, budding (condensation within 24 cells of a living individual of the same lineage), fusion, births and deaths inferred by overlap tracking of connected bound-mass components (B+P ≥ 48, individuals ≥ 256 quanta). Heredity is estimated as the correlation of Lenia growth parameters between sibling pieces at fission.

## Known limitations declared in advance

- "Energy" is abstract resource accounting, not calibrated thermodynamics; entropy language refers to information or resource accounting only.
- Under matter closure Finn's cycling index is trivially 1; the biotic recycling share replaces it.
- Individuals and roles depend on the thresholds above; sensitivity analysis (×0.5, ×2) is reported for every endpoint.
- A finite window cannot establish open-endedness; results are "practical open-endedness over the observation window" at most.
- Moral status: nothing in this system is claimed to be sentient; the question is revisited if M7 succeeds.

## Analysis code

`tools/analyze.ts` at the frozen commit. It pools only runs forming one ensemble (same rule and schema versions, preset, horizon and observation schedule; configurations differing from the treatment exactly by their condition) and refuses anything else. Its "Primary endpoints" section implements the tests above; every other comparison it prints is labelled exploratory.
