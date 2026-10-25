# Recovery severity diagnostic — proposed, not launched

## Decision

First do a zero-step feasibility check on saved checkpoints. If that passes, run **8 fresh matched parent–mutant pairs**, growing each genotype once and forking it into **legacy wound, mass-targeted wound, and sham**. This is 16 growth runs and 48 recovery branches, not another evolution run or mutation search. Stop after this diagnostic; a larger confirmation requires a new frozen protocol.

Question: does the same mutation show faster or more reliable tracked recovery when the actual initial damage is held near 40%, and does the old wound conceal that contrast? Equalizing mass loss changes placement as well as dose, so this experiment can identify a standardized-assay lead and evidence consistent with masking, not prove that severity alone caused the difference.

Keep founder 0 and mutant 138 from v1. A null result applies to this pair, not all possible genomes. Do not reopen the stopped v1 campaign or pool its outcomes into fresh evidence.

## What was already tried

- [V1 first-32 result](../recovery-accessibility-2026-10-24/RESULTS.md): both genotypes 28/32 clean recoveries; four wins and four losses; no extension. The 56 successes lost 25.64–43.97% target mass; the eight failures lost 55.20–59.20% and lost their tracked remnant. This gap is observational and selected the present question.
- [Recurring injury screen](../sandbox-ownership.md), “Injury result”: light/heavy/coarse means 0.161/0.089/0.125 versus control 0.182; zero of nine worlds met the improvement bar. Repeating wound rates or starting another breeder is not the next diagnostic.
- [Wall/wound comparisons](../sandbox-cells.md), “Wounds present and absent”: wound effects differed across seeds and founder winners; extra turnover did not establish better recovery.
- [Naturalist bench amendment](../naturalist-bench-v0-2026-10-18.md), “What the dose role matches”: equal radius/footprint did not equal actual delivered dose. Do not make that mistake here.
- [Prior-work audit](../recovery-improvement-prior-art-2026-10-24.md): 7,200 mutations already screened; 665 confirmations; founders selected for strong regeneration. Another mutation screen and a binary endpoint alone would repeat prior work and retain the ceiling problem.

The current evaluator targets about 30% of *cells*, not 30% of mass (`packages/search/src/evaluate.ts`). Its `lesionFrac` config controls the separate whole-tile lesion, not this tracked-component wound. Changing that parameter would not solve this question.

A new [reproducible geometric audit](audit.py), with [results](audit.json), finds that only **9/64** saved bodies can receive 40% ±2.5 percentage points by changing radius at the old center. Allowing a target-cell center makes that geometrically possible in **64/64**. This is not yet proof of valid remnant topology, low collateral damage, or pairwise matching. No GPU simulations were run for this plan. The searched local records contain no verified direct mass-targeted parent–mutant recovery comparison; this is a scoped finding, not a claim that no inaccessible experiment exists.

## Stage 0: feasibility and engineering, before fresh outcomes

Use all 64 old grown checkpoints as engineering data. Verify their hashes from v1 first. They may design/validate the intervention; they cannot supply new confirmatory evidence.

For each body, enumerate existing circular lesions with integer radius 1–31 and center at a cell of the original target. Predict/apply each lesion on a clone with the existing CPU lesion operator; do not advance time. Define dose as destroyed original-target B+P divided by original target B+P. Do not substitute area, total world mass, or largest-remnant mass.

A candidate must satisfy all of:

1. Actual target mass loss 37.5–42.5%, using integer cross-products.
2. At least one original target cell belongs to an eligible post-lesion remnant under the existing 48 threshold/minMass128 definition.
3. The overlap-selected remnant contains at least 80% of the target's surviving B+P; this avoids using a heavily fragmented remainder as a nominal equal dose. This is measured immediately, never after recovery.
4. Destroyed B+P outside the target is at most 5% of original target mass. Record it separately; lesion preserves total matter by converting bound material, not deleting it.

Select a parent–mutant lesion pair jointly from eligible candidates, requiring dose difference ≤2.5 percentage points. Choose by a fixed lexicographic objective: smallest maximum error from 40%; smallest pairwise dose difference; smallest sum of outside-target damage fractions; smallest sum of radii; then parent center index, mutant center index, parent radius, mutant radius. Use exact rational comparisons, not floating-point ties. No outcomes, genotype labels of winners, or later growth enter this choice.

**Feasibility stop:** require at least 30/32 old pairs to admit this exact joint prescription. Otherwise `DOSE-CONTROL-NOT-READY`: stop before fresh seeds. Do not widen tolerances or add a new lesion operator within this version. Report failure categories and propose a separately versioned design if needed.

If feasible, validate CPU/GPU equality for the chosen intervention on the first two engineering pairs in seed order, unchanged golden cases, zero conservation residual, sham identity, and identical physical states at shared 25/50-step readbacks (including the final state), with equal tracked components at shared observations. Do not demand numerically identical return times from different time grids. Synthetic fixtures must distinguish direct destruction, fragmentation, fusion, lost continuity, and time-to-recovery calculation. Replay both genotypes and all three branches of the first engineering pair for exact hashes and outcomes. Engineering growth checkpoints are reused; no fresh scientific seeds enter debugging. Engineering costs count toward the cap below.

## Stage 1: eight new paired worlds

Proposed seeds **2026102601–2026102608**. A local inventory check found no collisions on 2026-10-24; rerun the check and reserve them before launch. These lie outside v1's entire reserved range, including its unused extension seeds. Search accessible run manifests/worktrees; freeze genome bytes, source, operator, tie rules, seeds, caps, endpoint definitions and gates in a new manifest before looking at any fresh recovery.

Same v1 inoculum, 64×64 one-tile world, 3,000-step growth, mutation disabled, then 2,000-step recovery. Run parent and mutant separately in the same tile coordinates with identical seed and settings. Each genotype's three arms begin from exactly the same grown checkpoint:

| Arm | Intervention | Purpose |
|---|---|---|
| Legacy | Original target/center/radius algorithm unchanged | Reproduce old exposure on these fresh bodies |
| Mass-targeted | Jointly selected 40% prescription above | Compare recovery at similar measured damage |
| Sham | No lesion call; same observation/checkpoint schedule | Detect baseline instability and generic growth differences |

Keep the target chosen before wounding fixed for every arm. Never select a new target because the original fails. Alternate genotype execution order by seed and rotate arm order deterministically. Counter-based RNG remains keyed to the original seed/step/cell, not arm execution order. No new dark/tile-lesion arms: v1 established viability/light dependence; sham is the relevant local control here.

**Fresh feasibility stop:** every one of the eight pairs must admit the prescription. A missing target or unmatchable dose stops as `DOSE-CONTROL-NOT-READY`; retain evidence, do not replace the seed, and do not compute a scientific verdict from a selected subset. Stage 0's 30/32 threshold is only an engineering screen, not permission to drop fresh failures.

## Endpoints fixed before launch

Record at 25-step cadence with the existing 50-step retained-continuation view and 32/64 segmentation sensitivity views. Never sum split daughters or replace a lost tracked ID. Any incoming merge/fusion or loss invalidates clean recovery. Preserve the exact injury operator, physics, default configuration, rule version and golden hashes.

**Primary: sustained return time T**, on the mass-targeted arm. Earliest observed offset in {0,25,...,1800} from which the same retained remnant stays at ≥90% of its original pre-injury target mass at every observation through step 2000, with no continuity loss or fusion throughout the recovery interval, and with at least 200 steps of sustained observation. Require the 25-step and 50-step trackers to identify the same retained component label at every shared observation, including initialization. Matching final recovery booleans is insufficient: a split can leave them following different daughters. Any shared-observation identity disagreement disqualifies clean recovery and assigns T=2025; record it as cadence disagreement. A lost track also fails even if both labels are null. If no qualifying return, set T=2025 (a prespecified failure penalty, not an observed recovery time). Missing observations are a technical stop, never T=2025.

Also record clean success at step2000 with v1 criteria, full mass curves, actual destruction, immediate remnant fraction, damage outside the target, and sham target growth/continuity. T at low/high segmentation thresholds uses the same original target mass and lesion and the existing 50-step cadence; no new wound is chosen for sensitivities.

For each seed, Δ40 = T_parent,40 − T_mutant,40 (positive favors mutant). Compute the analogous Δlegacy descriptively. For legacy wounds outside 20–50%, report physical tracked-return time separately from v1 R_clean: do not force T to failure merely because a legacy wound was severe, and do not relabel it a valid clean lesion. This distinction prevents creating a dose effect solely through the eligibility cutoff.

## Stop rules and permitted conclusions

All are screening decisions, with no significance/equivalence claim from eight pairs and no dose/genome search.

1. **Any invariant, checkpoint, source, determinism or observer failure:** `TECHNICAL-STOP`. Retain artifacts. No silent retries; a repair requires a new version, with old attempts retained and total resource limits respected.
2. **Poor sham behavior:** define sham success separately as a retained original-target continuation at ≥90% original target mass at step2000, with no incoming fusion or loss and equal retained labels at shared 25/50-step observations. There is no injury/lesion requirement for sham. Fewer than 7/8 sham successes in either genotype, or mutant having fewer sham successes than parent: `BASELINE-UNSTABLE`. Stop; do not call it a recovery advantage.
3. **Standardized recovery lead:** only if all eight matched pairs are complete, mutant has no fewer mass-targeted clean successes than parent, at least 6/8 seeds have Δ40 ≥250 steps, and median Δ40 ≥250. Both low/high threshold median differences must also favor mutant (>0). Otherwise `NO-STANDARDIZED-LEAD`; stop this candidate under this protocol. A reverse advantage is reported descriptively and cannot trigger a switched-direction test.
4. **If the lead passes:** `STANDARDIZED-RECOVERY-LEAD`, not “improvement confirmed.” Stop this diagnostic and propose a separately frozen, fresh-seed confirmation of this one dose, pair and endpoint. Do not automatically extend, add intermediate doses, or pool old data. Report whether sham growth suggests a generic growth advantage; this experiment cannot prove a dedicated repair mechanism.
5. **Did severe wounds matter?** Let D be all genotype-by-seed cases whose legacy wound loses >50% target mass and fails physical tracked return. Let A be the subset of D whose mass-targeted arm achieves clean success and qualifying sustained return. Require at least two eligible cases (D≥2), at least two rescues (A≥2), and 3A≥2D to label `SEVERITY/PLACEMENT-CONSISTENT-RESCUE`; otherwise no supported rescue pattern (or insufficient severe cases). Keep all eight seed pairs in the genotype comparison. This descriptive, outcome-defined subset is not an independent test or an expansion trigger.

Only a standardized lead **plus** rescue evidence and a larger mutant advantage in the controlled arm (median Δ40−Δlegacy ≥250) is described as *consistent with the old wound masking this mutation's recovery advantage*. Even then, different lesion locations/topologies and eight seeds prevent a causal severity-only claim. A later orthogonal placement test would be needed. If both genotypes recover faster equally, severity affected the assay but no hidden genotype advantage was demonstrated. If all recover and timing remains tied, report a ceiling/no lead; do not increase damage after seeing this.

## Budget and implementation boundary

New science: 16×3000 growth steps +48×2000 recovery steps = **144,000 one-tile steps**, about one-fifth of v1's first32 workload before replays. Exact runtime is unmeasured; the old 10-second full assay is not a promise for this new runner. Replay all three arms/both genotypes of the first fresh pair (12,000 extra steps), retaining the original grown states. Engineering replay workload is measured and logged separately within the same cap.

Proposed total cap: **20 local execution minutes, 512 MiB, $0 cloud**, one GPU lane. Measure end-to-end cost/bytes on engineering cases; stop before science if a conservative projection including checkpoints, readbacks and replays exceeds either cap. Stop incomplete if a cap is reached; do not reduce n. Store grown/post-lesion/final checkpoints, source/manifest hashes, all branch traces and decision arithmetic; independently reread before reporting. A fully consumed cap is not authorization to enlarge it.

Implementation would add a new branch runner and pure lesion selector, reusing existing physics/observer mechanisms; do not change the frozen v1 decision code. New runtime files can change v1's source-fingerprint check, so reread v1 from its recorded implementation checkout rather than weakening that check. Required read-only Sol6.1 High review and engineering gates precede launch. This document authorizes no simulations or deployment; it is the requested proposal.
