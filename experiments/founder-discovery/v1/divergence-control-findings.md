# Founder-discovery divergence control — findings, 2026-10-02

Status: complete and technically complete. Four of the six frozen confirmatory tests are met.

- **Test A** (evolved descendants beat their founder by more than random mutants of the same size and kind):
  - met for cluster-33, robustly (8/8 seeds, smallest margin 0.54);
  - met for cluster-4 by the fixed rule but with no margin (7/8);
  - both carry the pre-registered reading *beyond divergence*;
  - not met for cluster-139 (6/8) or cluster-16 (2/8).
- **Test B** (the single swept change alone beats the founder): met for both founders, cluster-33's photosynthesis output bias and cluster-139's `mu`, each in 8/8 seeds and not marginally. In the founder's background, each change alone recovers most of the evolved advantage. It is not necessary: some evolved descendants without it win as well.

An independent re-derivation confirmed every number, with qualifications that are folded in below. All results are conditional on the four deliberately discovered founders, the gradient environment and the fixed assay seeds. RULE_VERSION 1 is unchanged.

## Design, in brief

The improvement study (`improvement-findings.md`) found that descendants beat their founder after 1,000,000 steps of mutation. Its disabled arm was an identity control, so it could not separate selection from "any genome that has changed this much beats its founder". This study adds the missing controls without re-running evolution. The protocol is `divergence-control-protocol.md` (frozen 2026-10-02, SHA-256 `78301504…d4c8`).

- **E (evolved):** the frozen study's 64 normal-arm draws at 1M, reused, 8 competitions each.
- **M (random mutants):** two per E draw, 128 genomes. Each copies its draw's change exactly in kind and size: the same weight-change magnitudes on uniformly drawn weight slots, and the same parameters changed by the same amounts. Only weight locations and all signs are random.
- **R (reconstruction):** the founder with only the swept slot set to the value that evolved in each seed. That is `b2[PHOTO]` for cluster-33 and `mu` (the Lenia growth-field centre) for cluster-139. The sweeps were found post hoc (`improvement-study/exploration-v1/`), but every R competition is new.
- **C (specificity, descriptive):** for cluster-33 only, the founder with a single change of the same magnitude on a random other weight.

Every new genome competed against its founder under the frozen assay: 4 assay seeds × 2 position assignments, 20,000 steps, score = (descendant − founder)/(descendant + founder) in [−1, 1]. Per founder and evolution seed, test A takes the E − M contrast, and test B takes the R score. A seed is certified when its conservative lower bound exceeds 0.10. A test is met with at least 7 of 8 certified seeds and technical completeness. Each test's exact one-sided tail is 9/256 under independent seeds; the six tests are reported separately, with no family-wise claim.

## Test A: selection over divergence

| Founder | Certified seeds | Criterion | E (evolved) | M (random, matched) | E − M | Pre-registered reading |
| --- | ---: | --- | ---: | ---: | ---: | --- |
| cluster-33 | 8 / 8 | **met** | 0.991 | 0.022 | 0.969 | beyond divergence |
| cluster-4 | 7 / 8 | **met** | 0.565 | 0.091 | 0.473 | beyond divergence |
| cluster-139 | 6 / 8 | not met | 0.559 | 0.190 | 0.369 | not met |
| cluster-16 | 2 / 8 | not met | −0.003 | −0.018 | 0.015 | not met |

E − M per evolution seed, 6410001 … 6410008 (✓ = certified, above 0.10). The contrast lies in [−2, 2].

| Founder | 001 | 002 | 003 | 004 | 005 | 006 | 007 | 008 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| cluster-33 | 1.18 ✓ | 0.54 ✓ | 0.89 ✓ | 0.84 ✓ | 1.56 ✓ | 1.02 ✓ | 0.93 ✓ | 0.80 ✓ |
| cluster-4 | 0.11 ✓ | 0.45 ✓ | 1.22 ✓ | 0.39 ✓ | 0.56 ✓ | 0.64 ✓ | 1.39 ✓ | −0.97 |
| cluster-139 | −0.10 | 0.72 ✓ | 0.21 ✓ | 0.17 ✓ | 0.26 ✓ | 0.83 ✓ | 0.84 ✓ | 0.02 |
| cluster-16 | 0.13 ✓ | 0.00 | −0.02 | −0.02 | −0.04 | 0.02 | 0.11 ✓ | −0.06 |

- **cluster-33.** Random change of the same size does nothing on average (0.022), while evolved change wins almost completely. Every seed is certified by a wide margin, the smallest 0.54.
- **cluster-4.** Random change is roughly neutral (0.091), and evolved change wins in 7 seeds. Seed 6410008 fails because its evolved draws lose to the founder (E = −0.74), which is the same large loss the improvement study reported. The pass is met by the fixed rule with no margin:
  - seed 6410001 is certified at 0.108, just over the 0.10 threshold, and is the only difference between 7/8 and 6/8;
  - the reading *beyond divergence* rather than *partly divergence* rests on M (0.091) being at or below 0.10;
  - in a descriptive check by the reviewer, not part of the protocol, dropping assay seed 6430003 gives 6/8.
- **cluster-139.** Evolved change beats random change on average (0.369) and in 6 seeds. It falls one seed short of the count, but the two failures are not close: in seed 6410001, E is below M (−0.10), and seed 6410008 is 0.08 under the threshold. Random mutants clearly help here by the protocol's rule (M = 0.190). The protocol anticipated part of the reason: the type-matched null keeps each parameter change on its own slot with a random sign. 26 of 32 mutants change `mu`, and 19 of those go up, the same direction as the sweep. About 16 would be expected from mu's lower bound of 16, which forces large downward changes upward; the remaining excess is chance. The protocol called A conservative for this founder for that reason. Under the frozen reading this is *not met*: no evidence that evolved change beats random change of the same size. That is not evidence that selection was absent.
- **cluster-16.** Neither evolved nor random change moves competitive ability (−0.003 and −0.018). There is no advantage to explain, as in the improvement study.

## Test B: reconstruction of the swept change

| Founder | Change (founder → evolved values) | Distinct genomes | Certified seeds | Criterion | Mean R | Share of E recovered |
| --- | --- | ---: | ---: | --- | ---: | ---: |
| cluster-33 | `b2[PHOTO]` 62 → 72–100 | 8 | 8 / 8 | **met** | 0.949 | 96% |
| cluster-139 | `mu` 33 → 46–57 | 6 | 8 / 8 | **met** | 0.477 | 85% |

Per seed, R was 0.82–1.00 for cluster-33 (in seeds 6410001 and 6410006 the founder ended every competition with zero mass) and 0.40–0.57 for cluster-139. Every seed is far above 0.10, and for cluster-139 all 48 competitions of distinct genomes are positive (minimum 0.28). The cluster-139 seeds share genomes where they share values (49 twice, 47 twice), so its 8 seeds rest on 6 distinct genomes. The 9/256 tail therefore does not apply to it: the reviewer puts its false-pass probability at 0.078 if each genome passes with probability ½, and 0.029 at 0.4.

B shows sufficiency in the founder's background only: one evolved change, alone, gives the founder most of its evolved advantage in this assay. Three caveats limit what that means:

- **The shares are averages near a ceiling.** cluster-33's E sits 0.009 below the maximum score, so "96%" compresses real gaps: R is 0.12–0.15 below E in seeds 6410002 and 6410004. cluster-139's R − E per seed ranges from −0.38 to +0.39.
- **The change is not necessary.** Both cluster-33 draws in seed 6410002 lack the photosynthesis-bias change yet score 0.998. Three cluster-139 draws lack the `mu` change yet score 0.47–0.63. One cluster-139 draw carries `mu` +16 and still loses (−0.19).
- **The values were chosen after seeing the data**, from the same evolved populations, as the protocol says. Only the competitions are new.

**Specificity for cluster-33 (descriptive).** The photosynthesis-bias change beat its matched single-weight control in all 8 seeds, by a mean of 0.855. The controls split two ways:

- five were exactly neutral, scoring exactly 0 in every assay seed (weight slots 135, 127, 53, 30 and 70). Such a change has no behavioural effect in this assay, so position effects cancel as they do for clones;
- three scored positive (slot 19 at 0.047, slot 80 at 0.511, slot 75 at 0.198), and none scored negative.

R − C therefore mostly compares R with no change at all, and two other single weights also helped noticeably. The controls are random weight slots, not output biases like `b2[PHOTO]`. The photosynthesis bias is unusually effective, not shown to be uniquely so.

## Descriptive results

- **Pooled block rule (the frozen study's rule, mean contrast over the four founders per seed).** 7 of 8 blocks are certified: 0.329, 0.430, 0.573, 0.342, 0.587, 0.626, 0.820, and −0.053 for seed 6410008, which cluster-4's loss pulls down. The mean is 0.457, with whole-block bootstrap 95% [0.274, 0.614] (seed 6480300, 10,000 resamples). For comparison, the improvement study's normal − off effect was 0.528 [0.413, 0.625].
- **E reproduces.** The founder-level E values (0.991, 0.565, −0.003, 0.559) equal the improvement study's founder effects, as the assignment-pair identity requires.

## Post hoc (written after seeing the analysis; not confirmatory)

`divergence-control/analysis-v1/post-hoc.ts` splits each founder's random mutants by whether they happen to carry the swept change in the evolved direction. It reads the roster and report only and runs no competitions; output is in `post-hoc.json`.

| Founder | Mutants carrying the swept direction | Their mean score | Other mutants | Their mean score |
| --- | ---: | ---: | ---: | ---: |
| cluster-139 (`mu` up) | 19 / 32 | 0.326 | 13 | −0.008 |
| cluster-33 (`b2[PHOTO]` up, by chance) | 4 / 32 | 0.562 | 28 | −0.055 |

In both founders, random mutants that happen to carry the swept direction get much of the advantage. This agrees with test B and makes A slightly conservative for both founders, not only for cluster-139. For cluster-139, the "other" group mixes 7 mutants with a `mu` decrease (mean −0.126) and 6 with no `mu` change (+0.131). The reviewer's arithmetic puts M at about 0.11 if upward and downward changes were equally represented, still near the 0.10 line. Excluding the `mu`-up mutants would rescue seed 6410001 but not 6410008, and seeds 6410004 and 6410005 have no other mutants to evaluate. So the bias does not imply that A would have passed. The split was chosen after the result, groups are small, and the mutants are not otherwise matched. It is a description, not a test.

## Interpretation

What this supports, in the protocol's terms:

- **Selection, not divergence alone: clearly for cluster-33, and by the fixed rule with no margin for cluster-4.** For these founders, random genomes changed by the same amount and kind do not beat the founder on average, while evolved genomes do. This rules out "any genome that has changed this much beats its founder" as the explanation for cluster-33 in this assay, and the rule says the same for cluster-4.
- **In the founder's background, a single swept change is sufficient for most of the advantage in cluster-33 and cluster-139.** The photosynthesis output bias alone recovers about 96% of cluster-33's evolved advantage, and `mu` alone about 85% of cluster-139's, both on average. Together with the parallel sweeps found post hoc in 8/8 and 7/8 seeds, this is direct evidence that a repeatedly selected change carries much of the competitive gain. It is not the only route: some descendants without it win too.

What it does not support:

- **Selection over divergence for cluster-139.** Test A is not met (6/8). The reconstruction and post hoc split suggest why, since much of the random arm carries the selected `mu` direction. That is a reason the test was weak, not a pass.
- **Anything about cluster-16.** It showed no advantage to explain.
- **A claim across founders.** The six tests are separate, with no family-wise claim. Two of four founders show selection over divergence; this says nothing about how often a founder would.
- **Necessity or mechanism.** B shows sufficiency of one change in this assay. Why a higher photosynthesis bias or a higher growth-field centre wins in the gradient chamber is not tested.
- **Generality.** The four founders were deliberately discovered, not sampled. The environment and assay seeds are fixed, and the slots tested in B were chosen after seeing the data.

Cautions:

- **Bounds are observed means, with no sampling uncertainty.** All 1,200 new competitions and all reused E observations were scored, with no both-extinct or missing outcomes and zero unassociated mass. Conservative bounds therefore collapse to observed values, and "certified" means the observed mean exceeds 0.10. A seed just above the threshold is not distinguishable from one just below it.
- **Units are small.** Each A unit rests on 2 evolved draws and 4 mutants; each B seed on one genome. A unit's M has an approximate standard error of 0.09–0.33. The two evolved draws in a unit can be near-clones: cluster-33's seed-6410001 draws differ at 1 of 163 slots. The reviewer's descriptive unit bootstrap gives founder-level E − M intervals of [−0.02, 0.91] for cluster-4 and [0.13, 0.62] for cluster-139.
- **Seeds are not fully independent.** A founder's units share the founder and the four assay seeds; cluster-139's B shares genomes. The 9/256 tail assumes independent, identically distributed seeds.
- **Six tests, no family-wise claim.** As a rough reference, six independent tests at a 9/256 tail would give at least one false pass with probability 0.19. A4 and B139 are where independence and margins are weakest.
- **Single competitions are dominated by position-by-seed luck.** Competing identical cluster-33 genomes gives scores averaging 0.69 in magnitude (up to 0.95), exactly antisymmetric across positions 0 and 1. Averaging both positions cancels this exactly only for phenotypically identical genomes. No left/right bias remains in the arm means.
- **Technical replication is two physical outcomes per assay seed.** Positions 0 and 1 differ physically; the frozen study's positions 2 and 3 were exact label swaps and were dropped.

## Completion and resources

The run was released on 2026-10-02 (`divergence-control/release.json`). It ran locally from 13:34:55Z to 17:50:34Z under one supervisor:

- 28 invocations of at most 600 s;
- 1,200 new competitions and 8 replays;
- 15,307 s charged of the 25,000 s cap (forecast: 15,593 s).

Every replay matched its frozen original in every outcome field, and every invocation has a matching audit (28 of 28). No mismatch was recorded and no reservation was left unresolved. The analyzer then ran once, in 19 s. All compute was on owned hardware; paid compute was $0.

## Provenance

- Protocol: `divergence-control-protocol.md`, SHA-256 `783015041a0fd30feb4b5f37b42dd2d8e8aaf7b6a1eeff783e7607902aa6d4c8`.
- Roster: `divergence-control/roster.json`, `21ff8f99…602a`.
- Candidate: `divergence-control/candidate.json`, `e125585a…77e4`.
- Release: `divergence-control/release.json`, `0e822781…83ae`.
- Study identity: `feec9045…97fb`. The frozen improvement report is `085d55cf…c68a`.
- Analysis: `divergence-control/analysis-v1/report.json`, SHA-256 `e72d47922ca0f95b221d78174fab537b69ef0a9d892c2f44773217d80b78638e`, produced by `tools/discovery_divergence_control_analyze.ts analyze`. Console output is in `analysis-v1/console.log`.
- Raw evidence: git-ignored `runs/founder-discovery-divergence-control-v1/`, holding assays, provenance, replays, audits and invocation records.

## Independent review

CONFIRMED-WITH-QUALIFICATIONS, with no numerical discrepancy; see `divergence-control/analysis-v1/review.json`, with the reviewer's script in `review-rederive.py`.

A fresh-context, read-only reviewer re-derived the analysis in Python, not through the TypeScript analyzer, using exact rational arithmetic. Its checks, 59 in all:

- it recomputed all 1,200 cache keys from file contents and mapped every roster configuration to exactly one result;
- it recomputed every score from raw masses;
- it regenerated all 128 mutants, 14 reconstructions and 8 controls bit for bit with its own Mulberry32 port;
- it re-read the 512 evolved observations from the frozen raw files;
- it reproduced every unit, draw and founder value, every certification and reading, test B and specificity, the bootstrap interval exactly, and `post-hoc.json`, with a maximum difference of 2.2e-16;
- it verified all 8 replays (originals from both hosts, all reproduced locally), the 28 audits and the 15,307.34 s charge.

Its qualifications, all about wording, are incorporated above:

- cluster-4's pass has no margin;
- the cluster-139 failure is not close, and its `mu` bias is half clamp, half chance;
- B shows sufficiency only in the founder background, its shares compress gaps near the ceiling, and the change is not necessary;
- five of eight specificity controls are exactly neutral;
- the units carry no sampling uncertainty and are not independent;
- cluster-33's null is contaminated by chance as well.

It did not re-run simulations, re-verify the 54 pinned source hashes, or re-derive the frozen genome-abundance table from checkpoints. R values and C genomes depend on that table.

Counting clarification: the protocol's "all 480 frozen groups" counts distinct (genome pair, assay seed) configurations, 1,920 ÷ 4. The reviewer counted 1,536 (draw, assay seed) observation groups. All are invariant under the label swap either way, so nothing changes.
