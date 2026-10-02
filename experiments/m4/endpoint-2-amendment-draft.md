# Amendment draft: endpoint 2 and a fresh M4 ensemble

Status: **WITHDRAWN, 2026-10-02. Never frozen, never in force.** The user chose to adopt the earlier 2026-09-29 M4 growth contract (`experiments/amendments/2026-09-29-m4-growth.md`) instead. That contract was designed first, uses a paired test with a minimum effect size, and already has calibration evidence; this draft duplicated its purpose with a weaker unpaired test. The draft's code changes were reverted and are kept only as a record in `endpoint-2-amendment-withdrawn.patch`; `experiments/preregistration.md` is back to its frozen hash. The review of this draft is kept in `endpoint-2-amendment-review.json`. Nothing below is in force.

Original status line: **DRAFT, 2026-10-02. Not frozen, not in force.** Decisions made; code in progress. This was written after seeing the 2026-09-28 M4 results. Once the open decisions below are made and the draft has been reviewed, it is appended verbatim to `experiments/preregistration.md` as a dated amendment, and the amended file's hash is added to `experiments/FROZEN`. The original text, including endpoint 2, stays unchanged.

## Why endpoint 2 needs amending

M4 failed on 2026-09-28 mainly on endpoint 2. On both presets, treatment runs were "growing" (20/20 and 8/10), but so were all neutral runs (20/20 and 10/10). The endpoint requires at most a minority of neutral runs to be growing.

This failure is structural, not evidence about the treatment. The reasoning below is exploratory and comes from `docs/plan.md`.

- Neutral runs express the reference phenotype, but mutation still mints new lineage labels at a steady rate.
- The frozen threshold is the neutral pilot's 95th percentile of lineage activity. By construction, about 5% of neutral lineages exceed it.
- A steady inflow of lineages, a steady fraction of which cross the threshold, makes cumulative new activity in neutral runs rise almost linearly. The classifier calls that "growing".
- "At most a minority of neutral runs growing" can therefore essentially never hold, whatever treatment does.

The endpoint's purpose is to show growth that does not saturate, beyond what neutral drift produces. The amendment keeps that purpose and measures growth against neutral instead of in absolute terms.

## Amended endpoint 2: late-window excess activity

- **Per-run statistic.** The rate of new evolutionary activity in the second half of the window: cumulative new activity at the final census, minus its value at the last census at or before step 500,000, per 10⁵ steps. Activity uses the frozen per-preset threshold of endpoint 1, unchanged.
- **Hypothesis.** Treatment > neutral, by a one-sided exact Mann–Whitney test at α = 0.01.
- **Reading.** Treatment is still producing adaptively significant lineages faster than the neutral shadow in the second half of the window. A treatment whose new activity falls back to neutral's rate fails, as does one that saturates below it. As already declared, a finite window shows "practical open-endedness over the observation window" at most.
- **The original endpoint 2** is still computed and reported, labelled "original; superseded for the M4 gate by the 2026-10-02 amendment".

*Alternative under decision (D1):* additionally require that the treatment's excess does not shrink. In a majority of treatment runs, the late-window excess over the neutral median rate would have to be at least half the early-window excess. This is stricter, has less power, and has no calibration history.

## M4 gate (amended)

M4 is met when endpoint 1 and amended endpoint 2 both hold in the fresh ensemble, on both `gradient-m3` and `spots-m3`. The 2026-09-28 verdict stands for that ensemble.

## Fresh ensemble

- **Same system.** Presets `gradient-m3` and `spots-m3`, the 12-genome M3 founder set and RULE_VERSION 1. Each run is 10⁶ steps with a census every 100 steps and a deep census every 10, using the frozen activity thresholds. Presets are unchanged, so the frozen thresholds apply; `tools/analyze.ts` refuses them if any identity differs.
- **Seeds:** 21–40 per condition on both presets. These are disjoint from the M4 ensemble (1–20), the calibration pilot (1001–1020) and the registered extension (101–105, 1101–1110).
- **Conditions:** treatment, neutral and no-mutation, giving 120 runs.
- **No re-reading.** The 2026-09-28 ensemble is not re-read under the amended endpoint, and no candidate statistic is tried on it. Only the fresh ensemble can test the amendment.
- **Other endpoints are descriptive here.** Endpoint 3 cannot be tested, since it needs the replenished control. Endpoint 4 needs only treatment runs, so it is reported, together with whichever held-out comparisons the three conditions allow. None of these is confirmatory here, and their 2026-09-28 results stand.

## Validation before freezing

- **Null calibration.** `tools/nullcal.ts` reports the amended endpoint's pass rate on the four exchangeable nulls (32 replicates at 10⁶) and, separately, on the bounded-treatment scenario. The numbers go in the amendment.
- **Regression.** The original four endpoints and the held-out section give byte-identical results under the amended analysis code, on the existing fixtures.
- **Independent review** of the amendment text and code.
- **Freeze.** After review, the amended pre-registration's hash is appended to `experiments/FROZEN`, and the analysis-code commit is recorded.

## Budget and placement

The registered estimate is 15–20 minutes per run on an M1 Max, at $0 on owned hardware; two owned Macs halve wall time. Run counts by option:

| Conditions (D3) | `spots-m3` seeds (D2) | Runs | GPU-hours (≈ 17.5 min/run) |
| --- | ---: | ---: | ---: |
| treatment, neutral, no-mutation | 20 | 120 | ≈ 35 |
| treatment, neutral, no-mutation | 10 | 90 | ≈ 26 |
| all registered (6 and 5 conditions) | 20 | 220 | ≈ 64 |
| all registered (6 and 5 conditions) | 10 | 170 | ≈ 50 |

Before launch, a separate release fixes the run manifest, the budget cap and the placement, as for the founder-discovery studies.

## Decisions (user, 2026-10-02)

- **D1, statistic:** the late-window rate against neutral. The no-shrinking condition is not adopted.
- **D2, presets:** both presets must pass, with `spots-m3` raised to 20 seeds (21–40), fixed before any new data.
- **D3, conditions:** treatment, neutral and no-mutation: 120 runs, about 35 GPU-hours.
- **D4, sequencing:** freeze the amendment now. Whether to launch the fresh ensemble is decided after the continuation study reports.
