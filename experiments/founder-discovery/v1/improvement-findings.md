# Founder-discovery improvement study — findings, 2026-10-02

Status: complete. The frozen confirmatory repeatability criterion is met. In 8 of 8 matched evolution-seed blocks, mutation-enabled descendants beat their founder in head-to-head competition by a conservative margin above 0.10, against the mutation-disabled control. Evidence is technically complete with no missing values. The result is conditional on the four fixed founders and fixed environment and assay seeds. One of the four founders shows no improvement.

## Design, in brief

Four deliberately discovered founders (`discovery-cluster-33`, `-4`, `-16`, `-139`) each evolved alone in 8 paired evolution seeds, once with normal mutation and once with mutation disabled ("off"): 64 histories, RULE_VERSION 1. At 0, 100,000 and 1,000,000 steps, two descendant genomes were drawn per history. Each competed against its founder under 4 assay seeds × 4 position assignments, giving 32 scores in [-1, 1] per history and time (positive = descendant wins). The protocol is `improvement-execution-protocol.md`, the manifest `improvement-study/manifest.json`.

The confirmatory endpoint is 1,000,000 steps, 100,000 is descriptive and time 0 is calibration. A seed block is certified when the mean over the four founders of (normal lower bound − off upper bound) exceeds 0.10; the criterion needs at least 7 of 8 blocks.

## Primary endpoint (1,000,000 steps)

| Quantity | Value |
| --- | ---: |
| Certified seed blocks (lower bound > 0.10) | **8 / 8** |
| Repeatability criterion (≥ 7/8, technically complete) | **met** |
| Exact one-sided sign tail, independent blocks, p ≤ ½ | 9/256 = 0.035 |
| Mean normal − off effect (full bounds = point; no missingness) | 0.528 |
| Descriptive whole-block bootstrap 95% (seed 6450001, 10,000 resamples) | [0.413, 0.625] |
| Retention difference (normal − off) | 0 (100% retained in both arms; uninformative) |

Seed-block effects (founder mean of normal − off): 0.444, 0.474, 0.630, 0.538, 0.681, 0.578, 0.696 and **0.182** (seed 6410008, the weakest block, pulled down by a large loss for cluster-4).

## By founder

| Founder | Effect at 100k | Effect at 1M | 1M pair effects across the 8 seeds | Founder-lineage mass at 1M, normal vs off (median) | Distinct genomes at 1M, normal (median) |
| --- | ---: | ---: | --- | --- | ---: |
| cluster-33 | 0.309 | **0.991** | 0.98 to 1.00 in all 8 | 0.75M vs 0.64M | 68 |
| cluster-4 | 0.079 | **0.565** | 7 positive, one large loss (−0.74, seed 6410008) | 1.09M vs 0.94M | 208.5 |
| cluster-139 | 0.128 | **0.559** | 0.18 to 0.79, all 8 positive | 2.06M vs 1.63M | 449.5 |
| cluster-16 | 0.023 | **−0.003** | −0.23 to +0.13, 4 positive / 4 negative | 2.04M vs 2.02M | 385.5 |

At time 0 every effect is exactly 0, as the clone calibration requires. Founder-lineage ancestry was retained in 8/8 histories in both modes, for every founder and time. Within each founder, normal-arm founder-lineage mass at 1M was above the off-arm maximum in every seed. For cluster-16 the gap is under 1%. Abundance is descriptive and not part of the decision rule.

## Completion and missingness

All 6,144 requested competition observations were available: 384 descendant draws, 1,920 distinct competition configurations, every one `scored`. There were zero both-extinct, absent, unresolved or missing outcomes at any time. Conditional available-case estimates and full fixed-denominator bounds are therefore identical. The collection receipt (`distribution-v1/assay-collection-local-v1/import-receipt.json`) records both hosts committed and zero unavailable references.

## Interpretation

What this supports, in the protocol's terms: typical (majority) seed-block improvement in head-to-head competitive ability after one million steps of mutation, compared with an unmutated control. It is conditional on these four founders and these environment and assay seeds. The sign tail of 9/256 assumes independent, identically distributed seed blocks. The mean effect is positive, and no retention loss accompanied it, so the protocol's tradeoff caveat does not apply.

What it does not support:
- **Improvement for every founder.** cluster-16 evolved high genetic diversity but no measurable competitive gain over its founder (−0.003, split 4/4 across seeds). Three of four founders drive the result, and cluster-33's near-complete exclusion of its founder (0.991) contributes most.
- **A randomized founder-policy effect.** The four founders were deliberately discovered, not sampled, and founders are fixed rather than resampled in the bootstrap.
- **Every seed improving.** Seed 6410008 is certified (0.182) but contains cluster-4's large loss. A minority of large losses could outweigh typical gains in other founder sets.
- **Organism reproduction or a mechanism.** The score is final descendant-versus-founder mass after a 20,000-step competition. It shows that mutated descendants outcompete their ancestor in this assay, not why, and not that discrete organisms reproduce.

Further cautions, most of them from the independent review:
- **The off arm is an identity control.** Every off draw equals the founder genome, so each off competition is the founder against itself. Its 32 scores are antisymmetric under position swap (mean exactly 0) and are the same at every time. The normal − off contrast is therefore the normal arm's descendant-versus-founder score, compared with 0. No control mutates without selection, so the design cannot separate selection-driven adaptation from "any sufficiently diverged genome beats its founder in this assay".
- **"Bounds" are observed means here.** With no missingness, a block's conservative lower bound is just its observed mean, and "certified" means that mean exceeds 0.10. Each block rests on 2 draws per founder. Block 6410008 is about 1.2 standard errors above the threshold; that error estimate is the reviewer's, not part of the frozen analysis. The 9/256 figure is the size of the decision rule; under the same model, 8/8 corresponds to 1/256.
- **Sensitivity (not a frozen test).** Dropping one founder at a time leaves the criterion met in all four cases: 7/8 without cluster-33 or cluster-139, 8/8 without cluster-4 or cluster-16.
- **Technical replication is smaller than its count.** The four position assignments collapse to two physical outcomes per genome pair, because the lineage label does not change masses. Clone competitions show strong position bias (|score| up to 0.95 for cluster-33), which cancels only across positions.
- **Descendants have diverged.** At 1M the 64 normal-arm draws are distinct non-founder genomes, and the exact founder genome has zero mass in all 32 normal histories. At 100k, 4 of the drawn genomes still equal the founder.
- **Retention is uninformative here.** "Retained" means any founder-lineage mass, not survival of the founder genome. It is 100% in every cell, so the retention difference of 0 and its [0, 0] interval are degenerate, not precise. Eight blocks cannot establish the protocol's five-point retention safeguard.

The protocol makes the bootstrap descriptive. Time 0 and 100k cannot select the endpoint; at 100k, 5 of 8 block means exceed 0.10.

## Exploratory follow-up (post hoc)

`improvement-study/exploration-v1/` was added after this decision. It is not confirmatory and does not change anything above. It finds parallel sweeps in the two strongly improving founders: cluster-33 raised its photosynthesis output bias in 8/8 seeds between 100k and 200k steps, and cluster-139 raised `mu` in 7/8. cluster-16 has no comparable change and appears to sit at an abundance ceiling from the start. Divergence alone does not predict winning. These results shape the proposed divergence control: reconstruct the sweep allele alone, and compare against random mutants at matched distance.

## Resources

All compute ran on owned hardware; paid compute was $0. History execution closures record 22,942 s over 35 invocations locally and 31,704 s over 50 parent invocations on the work Mac. Competition assays used 12,247 s over 21 parent invocations locally and 10,860 s over 18 on the work Mac. CPU evidence operations 001–042 charged 7,844.75 s of the 13,600 s allowance. Operation 042, the analysis, used 667.37 s of its 1,800 s reservation.

## Provenance

- Analysis approval: `improvement-study/distribution-v1/analysis-v1/approval.json`, SHA-256 `0098c854435cb6b3828648374c0f9065ad0d3ad3f3d3925503917db35e37372c`. It pins the 54 frozen sources, both inputs, the manifest, release and candidate, both host import commits, both collection receipts and the exact 001–041 operation prefix.
- Wrapper: `analysis-preparation-v1/analyze.py`, SHA-256 `a982f7bd…78b6`. It ran the unchanged `tools/discovery_improvement.ts analyze` (`33ebec93…e268`) against physical checkpoint chains.
- Report: `analysis-v1/report.json`, SHA-256 `085d55cf1f7121ece85ff3a5dc9fa5f236c912531e480e3262db99ad205ec68a`. Receipt: `importer-operations/042-original-scientific-analysis.json` (settled).
- Raw evidence stays in the git-ignored `runs/founder-discovery-improvement-consolidated-v1`, with originals on both machines.

## Independent review

CONFIRMED with no discrepancy; see `improvement-study/distribution-v1/analysis-v1/review.json`. A fresh-context, read-only reviewer re-derived the report in Python from the 1,920 raw competition files, not the TypeScript code path. It recomputed every score from raw masses and every cache key, and it matched the observation mapping against the earlier frozen `reconciliation-v2/assay-roster.json`. It also checked all 3,883 published raw files against both host import commits and all 68 approval pins. Seed blocks, founder effects, the criterion and the sign tail all reproduce, and a reimplemented bootstrap gives an identical interval. Checkpoints were not re-decoded; physical-state correctness rests on the frozen pipeline and the earlier reconciliation.
