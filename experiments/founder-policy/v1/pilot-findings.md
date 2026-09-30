# Founder-policy pilot: stop at the assay gate

2026-09-30 UTC (2026-09-29 local). **All 256 scheduled competitions and the deterministic replay completed. The pilot failed. The 72-history founder-policy comparison was not launched. Paid spending: $0.**

## What failed

- Only **1 of 8** identical-genome controls retained both competitor lineages in all 16 technical replicates; the frozen requirement was at least 7 of 8.
- **168 of 256** competitions ended with both competitors extinct: 80 identical controls and 88 original-versus-zero-controller controls. Here “both extinct” means both supplied copy lineages had zero associated B/P mass. These are uninformative competitions, not ties, and none was omitted.
- The two genotype groups with complete identical-genome scores had mean absolute scores **0.365** and **0.836**, exceeding the frozen 0.15 tolerance. This is excessive within-genotype competitor imbalance; it is not a claim that the overall signed mean is biased. The overall identical-genome mean is unavailable because some competitions have no competitor mass.
- Only **2 of 8** original-versus-zero-controller contrasts had complete, informative scores across all 16 replicates. Both had mean score **+1.000**, exceeding 0.20. The requirement of seven passing contrasts was therefore not met. This does not show that zeroed controllers were equally competent.

| Frozen genotype | Identical: both positive | Identical: both extinct | Identical mean absolute score | Disabled contrast: both extinct | Original minus disabled mean |
| --- | ---: | ---: | ---: | ---: | ---: |
| G0 — historical index 0 | 0/16 | 16/16 | unavailable | 16/16 | unavailable |
| G1 — historical index 2 | 16/16 | 0/16 | 0.365 | 0/16 | 1.000 |
| G2 — historical index 5 | 0/16 | 12/16 | unavailable | 16/16 | unavailable |
| G3 — historical index 9 | 4/16 | 4/16 | unavailable | 8/16 | unavailable |
| G4 — archive viable line 1919 | 0/16 | 16/16 | unavailable | 16/16 | unavailable |
| G5 — archive viable line 1010 | 0/16 | 16/16 | unavailable | 16/16 | unavailable |
| G6 — archive viable line 1422 | 8/16 | 0/16 | 0.836 | 0/16 | 1.000 |
| G7 — archive viable line 1873 | 0/16 | 16/16 | unavailable | 16/16 | unavailable |

Historical founder indices are zero-based; archive references are one-based lines in the committed viable-log prefix. “Unavailable” preserves the full scheduled denominator. It is not an available-case mean or an imputed zero.

## Technical verification

The full eight-genotype × two-control-kind × four-seed × four-assignment roster is present, with no missing or duplicate units. Complete genomes match the frozen roster. Disabled controls preserve both scalar genome words and zero all 160 neural weights. Configurations, source hashes, endpoint mass-to-score calculations and deterministic replay were verified. The replay matched the original final state hash and endpoint masses. It establishes repeatability of one both-extinct control, not general assay validity. All 51 executed source/configuration hashes remain unchanged.

The ten-minute first invocation stopped at its execution limit after 86 completed units. A second invocation resumed the same manifest, reused those exact receipts, completed the remaining 170 units and performed replay. This was a continuation, not a repair or a changed experiment.

The standalone `plan`, `pilot`, `run` and `analyze` implementation passed independent review and 20 focused CPU tests. A synthetic 82,944-request analysis with all technical results missing completed in about 17 seconds and remained inconclusive. Full-study checkpoint/ancestry handling, cache references, crossed-bootstrap analysis, cost reconciliation and locking were reviewed; **the full evolutionary comparison itself has not been physically validated or executed**.

## Decision and limits

**Stop under the prespecified assay-blocker rule.** This 128×128 gradient chamber, initialization and 20,000-step endpoint did not provide usable survival and identical-competitor balance for the frozen controls. No technical defect has been identified that justifies the one permitted repair. The repair allowance remains unused; changing genotypes, the environment, horizon or thresholds to obtain a pass is not authorized by that allowance.

No founder-policy effect, mutation-dependent improvement or general inability to evolve can be inferred. The cohorts remain a preparation for an unexecuted comparison. Organism reproduction, material ancestry and body definitions remain unresolved. RULE_VERSION 1, historical presets and the separate ecology-first workspace are unchanged. The historical Variation verdict is preserved and does not choose a mechanism.

The operational prerequisite for any future founder comparison is a separately justified assay redesign addressing the observed extinction and identical-competitor imbalance. This result does not authorize physics changes, a founder-policy change, surrogate training, or another general foundations review.

## Evidence and cost

- Frozen manifest SHA-256: `d197573ebbe35d5ff2134ae8e16a84f54aea6a9c4595db64f5618aed8395c05f`.
- [Frozen manifest](pilot-freeze/experiments/founder-policy/v1/pilot-design.json), [gate](pilot-freeze/experiments/founder-policy/v1/pilot-results/gate.json), [replay](pilot-freeze/experiments/founder-policy/v1/pilot-results/replay.json).
- [Independent calculation](pilot-independent-calculation.json), [implementation review](implementation-review.json), [protocol review](protocol-review.md).
- [Recorded founder traits](cohort-recorded-traits.json): regeneration recorded without selection or ranking. The historical cohort occupies 9 recalculated archive clusters; each drawn cohort occupies 12. This descriptive difference does not establish a policy effect.
- [Spend ledger](spend.json): local GPU only, **$0 paid**, no study cloud resources created and no cloud teardown required. The entire $50 allowance remains unspent.
