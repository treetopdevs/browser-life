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
| no-signal-motility | adhesion, signalling and active motility |

Caveat on `no-signal-motility`: the adhesion actuator it removes is a tested single-step attraction toward local polymer, but its effect on cohesion — holding a moving, growing colony together — is not demonstrated, even at its maximum gain (see `WorldConfig.adhesion` in `packages/schema/src/config.ts`).

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

Temporal mutual information of 2×2 occupancy patterns, pattern entropy, lineage-map compression ratio, internal differentiation, compartmentalised individuals, role count. Reported side by side (compressibility with predictability), never combined into one score.

*The numbered list below is generated from `experiments/endpoints.ts`'s `HELD_OUT_SPECS` by the
same `tools/gen-prereg.ts` that renders "## Primary endpoints" above; `tests/deno/prereg-sync.ts` and
`experiments/test/prereg-sync.test.ts` check both sections for staleness. Do not hand-edit the text
between the markers.*

<!-- GENERATED:held-out:start -->
1. **Temporal mutual information.** Predictive-information proxy: mutual information (bits/block) between the 2×2 occupancy pattern at census t and at t + Δ, at the same location (`temporalMI` in `packages/metrics/src/complexity.ts`), scheduled every census. Hypothesis (both must hold): (a) treatment's own per-run trend slopes are greater than zero (one-sided, exact Wilcoxon signed-rank test on the per-run slopes -- `wilcoxonSignedRank` in `packages/metrics/src/stats.ts`, chosen over the sign test because it weighs slope magnitude, not only sign; the endpoint refuses this test rather than approximate it if the sample size exceeds what the exact method can compute); and (b) treatment's trend exceeds every declared control's trend (one-sided Mann–Whitney per control; declared controls: gradient — neutral, no-mutation, uniform-light, replenished, no-signal-motility; spots — neutral, no-mutation, replenished, no-signal-motility (`fixed-env` is the seasons-preset-only control, declared for neither registered preset)). A missing declared control, or fewer than 2 runs for one, makes this endpoint unavailable, never a silently smaller family. Every test -- (a) plus one (b) per declared control -- of every directional held-out observable occupies a fixed slot (24 tests for gradient, 20 for spots) in ONE shared Holm family at α = 0.01, whether or not that slot has data (an unavailable slot contributes p = 1, the most conservative value, so it can never itself pass and never loosens correction for the rest, but it also never shrinks the family the way dropping it would). This observable counts toward the "at least 2 of 4" claim below only when available and both (a) and (b) -- every declared control -- clear the shared Holm-adjusted α.
2. **Pattern entropy.** Shannon entropy (bits/block) of the 2×2 occupancy-symbol distribution (`entropy`/`patternEntropy` in `packages/metrics/src/complexity.ts`), scheduled every census. Descriptive only (2026-09-26 amendment): higher pattern entropy can reflect more disorder as readily as more structure, so "up" is not an uncontested organisation claim here. Reported as a per-run trend slope and as one-sided Mann–Whitney comparisons (treatment vs. each declared control: gradient — neutral, no-mutation, uniform-light, replenished, no-signal-motility; spots — neutral, no-mutation, replenished, no-signal-motility (`fixed-env` is the seasons-preset-only control, declared for neither registered preset)), unadjusted and outside the directional observables' shared Holm family; never counted toward the "at least 2 of 4" claim.
3. **Lineage-map compression ratio.** Deflate compression ratio of the per-cell lineage-hash map (`lineageBytes`/`compressionRatio` in `packages/metrics/src/complexity.ts`), scheduled only on deep censuses (every `deepEvery` censuses). Descriptive only (2026-09-26 amendment): this is compressed/raw bytes, so a rising ratio means *less* compressible, not more organised, and an empty, homogeneous world also compresses very well -- "up" has no uncontested organisation reading either direction. Reported as a per-run trend slope and as one-sided Mann–Whitney comparisons (treatment vs. each declared control: gradient — neutral, no-mutation, uniform-light, replenished, no-signal-motility; spots — neutral, no-mutation, replenished, no-signal-motility (`fixed-env` is the seasons-preset-only control, declared for neither registered preset)), unadjusted and outside the directional observables' shared Holm family; never counted toward the "at least 2 of 4" claim. Since metrics version 2 the ratio is computed with a bundled deterministic deflate (fflate) rather than the runtime's `CompressionStream`, whose output size differed between Chrome and Deno; analysis pools only runs with the current metrics version, so earlier data is not comparable. See docs/refactor-v3-workflow.md.
4. **Internal differentiation.** Mean within-individual standard deviation of cell membrane fraction (`morphology().differentiation` in `packages/metrics/src/complexity.ts`), scheduled only on deep censuses. Hypothesis (both must hold): (a) treatment's own per-run trend slopes are greater than zero (one-sided, exact Wilcoxon signed-rank test on the per-run slopes -- `wilcoxonSignedRank` in `packages/metrics/src/stats.ts`, chosen over the sign test because it weighs slope magnitude, not only sign; the endpoint refuses this test rather than approximate it if the sample size exceeds what the exact method can compute); and (b) treatment's trend exceeds every declared control's trend (one-sided Mann–Whitney per control; declared controls: gradient — neutral, no-mutation, uniform-light, replenished, no-signal-motility; spots — neutral, no-mutation, replenished, no-signal-motility (`fixed-env` is the seasons-preset-only control, declared for neither registered preset)). A missing declared control, or fewer than 2 runs for one, makes this endpoint unavailable, never a silently smaller family. Every test -- (a) plus one (b) per declared control -- of every directional held-out observable occupies a fixed slot (24 tests for gradient, 20 for spots) in ONE shared Holm family at α = 0.01, whether or not that slot has data (an unavailable slot contributes p = 1, the most conservative value, so it can never itself pass and never loosens correction for the rest, but it also never shrinks the family the way dropping it would). This observable counts toward the "at least 2 of 4" claim below only when available and both (a) and (b) -- every declared control -- clear the shared Holm-adjusted α.
5. **Compartmentalised individuals.** Count of individuals with a membrane-rich rim and a biomass-rich core (`morphology().compartmentalised` in `packages/metrics/src/complexity.ts`), scheduled only on deep censuses. Hypothesis (both must hold): (a) treatment's own per-run trend slopes are greater than zero (one-sided, exact Wilcoxon signed-rank test on the per-run slopes -- `wilcoxonSignedRank` in `packages/metrics/src/stats.ts`, chosen over the sign test because it weighs slope magnitude, not only sign; the endpoint refuses this test rather than approximate it if the sample size exceeds what the exact method can compute); and (b) treatment's trend exceeds every declared control's trend (one-sided Mann–Whitney per control; declared controls: gradient — neutral, no-mutation, uniform-light, replenished, no-signal-motility; spots — neutral, no-mutation, replenished, no-signal-motility (`fixed-env` is the seasons-preset-only control, declared for neither registered preset)). A missing declared control, or fewer than 2 runs for one, makes this endpoint unavailable, never a silently smaller family. Every test -- (a) plus one (b) per declared control -- of every directional held-out observable occupies a fixed slot (24 tests for gradient, 20 for spots) in ONE shared Holm family at α = 0.01, whether or not that slot has data (an unavailable slot contributes p = 1, the most conservative value, so it can never itself pass and never loosens correction for the rest, but it also never shrinks the family the way dropping it would). This observable counts toward the "at least 2 of 4" claim below only when available and both (a) and (b) -- every declared control -- clear the shared Holm-adjusted α.
6. **Role count.** Number of distinct trophic roles present (`rolesPresent.length`, scheduled only on deep censuses). Hypothesis (both must hold): (a) treatment's own per-run trend slopes are greater than zero (one-sided, exact Wilcoxon signed-rank test on the per-run slopes -- `wilcoxonSignedRank` in `packages/metrics/src/stats.ts`, chosen over the sign test because it weighs slope magnitude, not only sign; the endpoint refuses this test rather than approximate it if the sample size exceeds what the exact method can compute); and (b) treatment's trend exceeds every declared control's trend (one-sided Mann–Whitney per control; declared controls: gradient — neutral, no-mutation, uniform-light, replenished, no-signal-motility; spots — neutral, no-mutation, replenished, no-signal-motility (`fixed-env` is the seasons-preset-only control, declared for neither registered preset)). A missing declared control, or fewer than 2 runs for one, makes this endpoint unavailable, never a silently smaller family. Every test -- (a) plus one (b) per declared control -- of every directional held-out observable occupies a fixed slot (24 tests for gradient, 20 for spots) in ONE shared Holm family at α = 0.01, whether or not that slot has data (an unavailable slot contributes p = 1, the most conservative value, so it can never itself pass and never loosens correction for the rest, but it also never shrinks the family the way dropping it would). This observable counts toward the "at least 2 of 4" claim below only when available and both (a) and (b) -- every declared control -- clear the shared Holm-adjusted α.

Hypothesis: supported once at least 2 of the 4 directional observables above (temporal mutual information, internal differentiation, compartmentalised individuals, role count) are established (meet both criteria in their hypothesis). The overall outcome is three-valued, not a plain yes/no (2026-09-26 amendment, round-3/4 corrected): not-supported only when a whole-family recomputation of the shared Holm correction -- every currently unavailable *test slot* (not observable) substituted with the most favorable possible value, p = 0, holding every currently available raw p-value fixed -- still yields fewer than 2 established observables; otherwise, short of 2 established observables, the result is reported as unavailable rather than a negative, since that recomputation shows two could still become established once the missing data arrives. Not-supported means only that this ensemble's *currently available* measurements cannot meet the registered criterion no matter how the missing slots resolve -- not that additional seeds, recovered/excluded measurements, or anything else that would recompute an already-available raw p-value couldn't. Pattern entropy and lineage-map compression ratio are descriptive only and are never counted.
<!-- GENERATED:held-out:end -->

### Amendment, 2026-09-26

The pre-registration is still an unfrozen draft, so this note is not the "dated amendment after a
freeze" the doc's freeze policy describes -- it records, for traceability, that the numbered list
above refines a first cut of the held-out endpoints that a review found under-specified the original
prose's claim. **This amendment does change the original text's substance, not merely operationalise
it as written:** the original wording above this note ("a positive trend in at least two of them where
controls do not") is replaced by the criterion below -- an absolute half (treatment's own slopes are
greater than zero) plus a relative half (treatment's trend exceeds each declared control's). In
particular, a declared control is now explicitly permitted to *also* show a positive trend, as long as
treatment's exceeds it -- "controls do not [show a positive trend]" is no longer the operative
criterion at all, only "controls are exceeded by treatment" is:

1. **Absolute + relative.** The original operationalisation checked only that treatment's trend beat
   its controls' (relative). That is not the same claim as "treatment increases" -- a run that
   *declines slower than its controls* used to pass. Each directional observable's hypothesis now
   requires an absolute test as well: treatment's own per-run slopes must be positive (one-sided,
   exact Wilcoxon signed-rank on the per-run slopes), in addition to exceeding every declared control
   (which may itself be rising, falling, or flat -- only the comparison to treatment matters for the
   relative half).
2. **Controls declared per preset.** Controls are now fixed per registered preset in
   `experiments/endpoints.ts` (`HELD_OUT_PRESET_CONTROLS`), not "whatever condition happens to have
   runs in this ensemble": every registered preset permanently lacks some ablation (`spots` has no
   light gradient to flatten; `fixed-env` belongs to the unregistered seasons preset), so the earlier
   "require every present control" reading was either vacuous or under-constrained depending on how it
   was read. A missing declared control, or fewer than 2 runs for one, now makes that endpoint
   unavailable -- reported as such, never silently evaluated over a smaller family.
3. **Direction restricted to four of six.** "A positive trend" is not an uncontested organisation claim
   for every observable: a rising lineage-map compression *ratio* means less compressible (and an
   empty, homogeneous world compresses well too), and rising pattern entropy can mean more disorder as
   readily as more structure. Only temporal mutual information, internal differentiation,
   compartmentalised individuals and role count are claimed directional; pattern entropy and
   lineage-map compression ratio are reported descriptively (slope and between-group comparisons)
   and never counted. This changes "at least two of them [six]" to "at least two of these four".
4. **One shared, fixed-size Holm family.** The first cut Holm-corrected each observable's comparisons
   separately, which does not bound the error rate of the resulting "at least 2 of N" count
   (independent nulls each passing at 1% by chance give a compounding chance that at least one does
   across several observables). Every test -- the one absolute test plus the relative tests against
   every declared control -- of every *directional* observable is now Holm-corrected together as one
   family at α = 0.01, so the "at least 2 of 4" claim inherits family-wise error control. This family
   is a FIXED size (24 tests for `gradient`, 20 for `spots`): every directional observable's absolute
   test and every one of its declared-control comparisons always occupies a slot, whether or not that
   *particular test* has data. Each such slot is judged individually: a test that lacks data
   contributes the most conservative possible value (p = 1) for itself only, never for an observable's
   *other* tests that do have data -- an observable missing just one declared control still uses its
   real p for the absolute test and every other control's comparison, and only the missing
   comparison's own slot is substituted. An earlier draft of this point instead excluded whole
   observables lacking full data from the family, which shrank it and could manufacture support purely
   by losing data; fixing the slot count (not merely reporting missing observables as unavailable
   while still dropping their slots) is the correction.

Because a preset-declared control (point 2) or an oversized sample for the exact method (point 1) can
make an observable's data insufficient without making the underlying question answerable either way,
the overall outcome is three-valued, not a plain yes/no. Completing a missing test does not only affect
its own observable: because the family's size is fixed but its *composition* changes as real data
replaces a p = 1 placeholder, every other test's rank -- and so its Holm-adjusted p -- can shift too (an
already-available observable's own adjusted p measurably improved, in one reviewed reproduction, purely
because an unrelated observable's missing data was completed, with neither observable's raw numbers
touched). So "not supported" cannot simply credit each currently-unavailable *observable* with a
hypothetical pass and check whether that reaches 2: it requires an optimistic recomputation of the
*whole* shared family, substituting the most favorable possible value (p = 0) for every missing slot
instead of the actual p = 1, and counting how many directional observables would pass under that
recomputation. **Supported** once at least 2 of the 4 directional observables are established (under
the real, conservative family); **not supported** only when even that optimistic recomputation reaches
fewer than 2; otherwise **unavailable** (enough evidence is still missing that the true answer could go
either way).

**What "not supported" does and does not guarantee.** The optimistic recomputation holds every
currently *available* raw p-value fixed and only asks what happens if every currently *unavailable*
test slot were assigned its best possible value. So: holding every currently available raw p-value
fixed, no assignment of p-values to currently unavailable test slots can establish two directional
observables. This explicitly does **not** cover additional seeds beyond what this ensemble currently
has, recovered or excluded measurements, or any other change that would recompute an already-available
raw p-value (a currently-available test can still be missing registered seeds -- availability requires
only 2 finite runs, not the full registered sample). "Not supported" is a statement that this ensemble's
current measurements fail to meet the registered criterion, not a biological refutation of the
underlying hypothesis.

Also found during this work and fixed in a separate change (metrics version 2, not part of this
amendment): `lineageCompression`'s former `CompressionStream`-based ratio was not engine-deterministic
(Chrome vs. Deno differed by a few percent on byte-identical input); it now uses a bundled
deterministic deflate, and analysis refuses to pool runs with different metrics versions. See the
"Lineage-map compression ratio" entry above and `docs/refactor-v3-workflow.md`.

## Reproduction and heredity (descriptive)

Fission, budding (condensation within 24 cells of a living individual of the same lineage), fusion, births and deaths inferred by overlap tracking of connected bound-mass components (B+P ≥ 48, individuals ≥ 256 quanta). Heredity is estimated as the correlation of Lenia growth parameters between sibling pieces at fission.

## Known limitations declared in advance

- "Energy" is abstract resource accounting, not calibrated thermodynamics; entropy language refers to information or resource accounting only.
- Under matter closure Finn's cycling index is trivially 1; the biotic recycling share replaces it.
- Individuals and roles depend on the thresholds above; sensitivity analysis (×0.5, ×2) is reported for every endpoint.
- A finite window cannot establish open-endedness; results are "practical open-endedness over the observation window" at most.
- Moral status: nothing in this system is claimed to be sentient; the question is revisited if M7 succeeds.

## Per-seed probability thresholds

Any threshold on a per-seed probability (for example "recovers from a 30% lesion with p > 0.8") is tested on 32 replicates on fresh seeds and passes when the one-sided 95% Clopper–Pearson lower bound exceeds the threshold; for p > 0.8, at least 30 of 32 (`passesProbabilityGate` in `packages/metrics/src/stats.ts`). Decided 2026-09-27 before freezing. The M3 bootstrap gate predates this rule and used the observed rate over 16 replicates; its result and the stricter robustness figure are recorded in `docs/plan.md`.

## Analysis code

`tools/analyze.ts` at the frozen commit. It pools only runs forming one ensemble (same rule and schema versions, preset, horizon and observation schedule; configurations differing from the treatment exactly by their condition) and refuses anything else. Its "Primary endpoints" section implements the tests above; its "Held-out observables" section implements the held-out hypothesis above (confirmatory, not exploratory, per the 2026-09-26 amendment); every comparison outside those two sections is labelled exploratory.
