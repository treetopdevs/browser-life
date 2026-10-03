# Continuation after the first sweep — findings, 2026-10-03

Status: **complete and technically complete. None of the four frozen confirmatory tests is met.** That includes cluster-33, the founder the protocol designated to decide. Under the protocol's fixed M4 table, cluster-33's *not met* reads **inconclusive**:

- it is not evidence that adaptation stalled;
- it cannot support the physics-change (evolvability) pivot;
- the pivot question rests on the fresh M4 ensemble, which tests late-window activity directly.

An independent fresh-context re-derivation in exact arithmetic reproduced every number from the raw results and the roster. The largest difference was 2.2e-16. It also re-derived all 64 ancestors from the checkpoint chains and regenerated all 128 null genomes bit for bit. Verdict: **CONFIRMED-WITH-QUALIFICATIONS** (`continuation/analysis-v1/review.json`, script `review-rederive.py`). Its qualifications are folded in below.

All results are conditional on:
- the four deliberately discovered founders;
- single-founder chambers, not M4's 12-founder ecology;
- the gradient competition;
- the fixed assay seeds.

RULE_VERSION 1 is unchanged.

## Design, in brief

The protocol is `continuation-protocol.md` (frozen 2026-10-02, SHA-256 `c4dd6a0c…bfbd`). It asks whether each founder's 1M descendants beat their own 500k ancestors head-to-head, by more than random mutants of those ancestors carrying the same amount and kind of change. It is the divergence control moved forward in time, with the 500k ancestor in the founder's role.

- **L (late):** the improvement study's 64 normal-arm draws at 1M. These are the same genomes as the divergence control's E.
- **H (midpoint ancestor):** each L's own ancestor genome at 500k, traced on its mutation-parent path in the verified chain.
- **N (null):** two type-matched mutants of H per pair, 128 genomes. Each copies the H→L change in kind and size.
- **Competitions:** each L and each N played its H under the frozen gradient assay (4 assay seeds × 2 positions, 20,000 steps). That is 1,536 competitions.
- **Unit and test:** per founder × evolution seed, the unit contrast is L − N, certified when it exceeds 0.10. A founder meets the test with at least 7 of 8 certified seeds.
- **Progress:** the late-certified count is separate. It counts the seeds where L itself beats H by more than 0.10.

## Execution

- **Release and run.** The run was released after two independent reviews, the second CLEAR. It ran 2026-10-02 20:03Z → 2026-10-03 02:04Z under `caffeinate -i`:
  - 39 invocations;
  - 1,536 of 1,536 results, with no missing scores and no competition in which both genomes went extinct;
  - 8 of 8 replays matching their frozen originals;
  - 39 of 39 audits;
  - no mismatch, no unresolved reservation and no stop.
- **Budget.** 21,624 s were charged of the 30,000 s cap (forecast 19,600 s).
- **Analysis.** The frozen analyzer ran once (38 s) and wrote `continuation/analysis-v1/report.json`, SHA-256 `017d63dc206cefa42419369fac0b1243c04a7e3fca01e54bb4713efaf9f791cc`. Its embedded `reportSha256` (`085d55cf…`) is the frozen improvement report it reads.

## The continuation test

| Founder | Certified seeds | Late-certified seeds | L vs H | N vs H | L − N | Pre-registered reading |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| cluster-33 (decides) | 5 / 8 | 5 / 8 | 0.386 | −0.041 | 0.427 | not met |
| cluster-4 | 3 / 8 | 3 / 8 | −0.053 | −0.101 | 0.048 | not met |
| cluster-139 | 4 / 8 | 2 / 8 | 0.103 | −0.101 | 0.204 | not met |
| cluster-16 (no-adaptation reference) | 1 / 8 | 0 / 8 | −0.025 | −0.028 | 0.003 | not met |

Scores are (late − ancestor)/(late + ancestor) in [−1, 1]; the contrast lies in [−2, 2].

The tables below give each unit per evolution seed, 6410001 … 6410008. A ✓ marks a certified L − N contrast (above 0.10). A † marks a late-certified L vs H score (above 0.10).

**L − N contrast:**

| Founder | 001 | 002 | 003 | 004 | 005 | 006 | 007 | 008 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| cluster-33 | 0.07 | 0.56 ✓ | 0.19 ✓ | 0.88 ✓ | 0.69 ✓ | 0.01 | 0.04 | 0.97 ✓ |
| cluster-4 | −0.14 | −0.41 | 0.66 ✓ | −0.41 | −0.09 | 0.82 ✓ | 0.31 ✓ | −0.35 |
| cluster-139 | 0.13 ✓ | 0.49 ✓ | 0.05 | 0.01 | 0.07 | 0.01 | 0.54 ✓ | 0.34 ✓ |
| cluster-16 | 0.03 | 0.01 | 0.19 ✓ | 0.06 | −0.04 | −0.19 | 0.01 | −0.04 |

**L vs H:**

| Founder | 001 | 002 | 003 | 004 | 005 | 006 | 007 | 008 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| cluster-33 | 0.18 † | 0.59 † | 0.02 | 0.82 † | 0.70 † | −0.14 | 0.01 | 0.91 † |
| cluster-4 | −0.38 | −0.52 | 0.52 † | −0.32 | −0.11 | 0.37 † | 0.13 † | −0.12 |
| cluster-139 | 0.05 | −0.07 | 0.02 | 0.04 | 0.00 | 0.05 | 0.52 † | 0.22 † |
| cluster-16 | −0.01 | 0.01 | 0.07 | −0.03 | −0.05 | −0.18 | 0.00 | −0.02 |

### cluster-33

The founder-level contrast is large (0.43), but it rests on five seeds. Those five range from 0.19 to 0.97, while three seeds sit near zero: 0.07, 0.01 and 0.04. The per-seed rule exists so that a mean carried by some seeds does not read as progress, and five certified seeds is two short of the seven required.

The frozen reading is therefore *not met*. That label means the 7-of-8 rule failed. It does not mean there is no evidence, since five of eight units clear 0.10, and it is not evidence that adaptation stopped.

- **Where the gains fall.** The three uncertified seeds (6410001, 6410006 and 6410007) all have a midpoint ancestor that already carries the photosynthesis-bias sweep. Among the seven seeds whose first sweep was complete by 500k, four are certified and four late-certified (post hoc).

- **Seed 6410001.** L beats H (0.18, late-certified), but random mutants of H also beat H (0.12). The contrast is therefore only 0.07.
- **Seed 6410002.** This is the one seed that never swept the photosynthesis bias. It shows a certified gain (0.56).

### cluster-139

Four seeds are certified and two are late-certified. Both late-certified seeds are 6410007 and 6410008. The protocol's pre-run facts record that both pairs of seed 6410007 gained the `mu` sweep after 500k. Part of that gain is therefore the sweep itself, as the protocol anticipated.

### cluster-4

Late genomes lose to their own midpoint ancestors in five of eight seeds: L vs H is −0.38, −0.52, −0.32, −0.11 and −0.12. In the other three they win clearly. Its founder-lineage abundance rose over the same interval (mean mass 1.01M → 1.07M).

### cluster-16, the reference

cluster-16 never improved over its founder, and it shows nothing here: 1/8 certified, 0/8 late-certified, contrast 0.003. The protocol's caution clause is not triggered. That clause applies if cluster-16 reads *continued* or *partly divergence*, which would suggest the assay detects something other than adaptation.

### Random change

Random change of the same size is neutral to mildly harmful against the ancestor in every founder: N vs H is −0.03 to −0.10.

## What this means for M4

The frozen table applies cluster-33's reading: *not met* → **inconclusive.**

- **The protocol's power section anticipated this outcome.** It warned that the study "detects only large continued gains reliably". At a per-seed spread of 0.4, 80% power under the 7-of-8 rule needs a true contrast of about 0.6. cluster-33's observed spread across seeds is 0.40 and its mean contrast 0.43. The result is consistent with real but uneven post-sweep gains. It is also consistent with no general gain. The study cannot separate the two.
- **This study gives no support for the physics-change pivot,** and it gives no evidence against it.
- **The route forward is the one the protocol named:** a fresh M4 ensemble that tests continued activity directly. The protocol's wording, "under the amended endpoint 2", referred to the 2026-10-02 endpoint-2 draft, which was withdrawn later that day. The M4 route is now the 2026-09-29 growth contract (`docs/plan.md`, "2026-10-02 — M4 route"). Its endpoint 2 is the same kind of direct test: paired late-window excess new activity, 500k → 1M.

## Descriptive results

- **Pooled block rule** (mean contrast over the four founders per seed):
  - 7 of 8 blocks are certified: 0.022, 0.159, 0.272, 0.134, 0.159, 0.160, 0.224 and 0.232;
  - the mean is 0.170;
  - the whole-block bootstrap 95% interval is [0.119, 0.218] (seed 6490300, 10,000 resamples).
  
  In the divergence control the same rule gave 0.457 [0.274, 0.614]. The post-midpoint advantage over matched random change is about a third of the full-history advantage.
- **Roster facts, which held as recorded before the run:**
  - no pair had L = H;
  - median H→L slot change was 10, 7, 17 and 14 for clusters 33, 4, 16 and 139;
  - for cluster-33, H carries the photosynthesis-bias sweep in 14 of 16 pairs and none gained or lost it after 500k;
  - for cluster-139, H carries the `mu` sweep in 11 pairs and L in 13, with 2 gained after 500k.

## Qualifications

- **The 9/256 tail per test is optimistic.** Units share their founder and the four assay seeds, and in 10 of 32 units the two pairs share one H.
- **"Certified" means the observed mean exceeds 0.10** with nothing missing. The bounds carry no sampling uncertainty.
- **Seed-level patterns are descriptive.** This includes the split between seeds with large gains and seeds with none. The protocol fixed no test for them.
- **The power figure is post hoc and illustrative,** from the reviewer. Take Normal units at cluster-33's observed mean (0.43) and spread (0.40): the chance of meeting the 7-of-8 rule is about 0.49. At its observed certified fraction of 5/8, it is 0.135.
- **Noise in the threshold comparison.** A unit's N is the mean of four nulls, with a post hoc standard error of about 0.15–0.18, against the 0.10 threshold. The unit closest to the threshold is cluster-139 seed 6410001, at 0.126.
- **Certified is not progress.** N is on average a damaged H. Four units are certified but not late-certified. For example, in cluster-139 seed 6410002, L is −0.07 against an N of −0.56. The late-certified count guards against reading these as progress, and here both counts are below 7.
- **Replays cover only the frozen originals.** Replays and audits re-ran the 8 frozen founder-ancestor originals. None of the 1,536 new configurations was re-executed, so their determinism rests on the same pinned executor. The protocol discloses this.
- **The cluster-4 spread exceeds the power assumption.** Its spread across seeds is 0.49, above the 0.15–0.4 range the power section assumed.
