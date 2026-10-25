# Can one existing mutation improve recovery?

Date: 2026-10-24. Status: **proposed experiment; retrospective audit completed; no new simulation run or protocol freeze.**

## Recommendation and scope

Start by confirming one already-tested parent–mutant pair. Do not begin with another wound regime, a new founder search, or breeding generations. The smallest new scientific batch is **32 matched parent–mutant trials**. It can stop the investigation cheaply; it cannot establish that improvement is impossible. Only a promising first batch earns 96 additional pairs, for one final test at 128 pairs.

The exact question is: **does one mutation allowed by the existing rules cause a repeatable increase in the probability of the existing assay's tracked remnant regaining its mass?** A positive result supplies an accessible genetic improvement to investigate. It does not demonstrate that the mutation spreads naturally, that a tracked component is a reproducing individual, or that evolution is open-ended.

This narrows the earlier recommendation. Founders were already selected for regeneration, injury-based selection has already disappointed, and the breeder's demonstrated adaptation concerns pond establishment rather than preserved regeneration. The recent high-membrane wounded-pond lineage has not demonstrated improved recovery.

Planning baseline: Git `3f44c3197dd485d70998d5f1de63abd29f598eb0` in the main checkout. The recent shell finding is read from `2a2ced0aa7673b98f08be39936dbd9287e723da8` on `claude/game-angle-recovery-3fa72a`. This note adds no physics changes and does not amend any historical frozen result. The proposed diagnostic is distinct from the unresolved Gate A organism-identity question in [docs/plan.md](../plan.md#gate-a-operational-unit-evaluation--2026-09-29); it grants no permission to bypass that question for later autonomous-evolution claims.

## What we have already tried

See the source-by-source [prior-art audit](../recovery-improvement-prior-art-2026-10-24.md). The decisions it changes are:

| Previous work | Recorded finding | Consequence for this plan |
|---|---|---|
| M3 search and retest | Regeneration was part of the objective; selected founders are near the binary assay ceiling. | Do not re-demonstrate that a good recovering genome exists. |
| Foundations test 2 | 7,200 single mutants already evaluated; full raw records retain regeneration. | Re-read existing results before generating mutations. |
| Foundations test 5 and ownership controls | Evolved genomes retained survival/light dependence but generally lost regeneration. | Viability and recovery are separate traits; low-recovery descendants exist for a later bounded fallback. |
| Recurring wounds: light, heavy, coarse | None of nine worlds exceeded control regeneration by the required margin; some developed films. | Do not repeat "injure more and repair should evolve." |
| Ownership/shape/declared-cell screens | No Promising arm under those protocols. | No new parameter sweep in this first test. |
| Scaffold R4 | Pond selection did not preserve regeneration. | Mass or establishment scores cannot stand in for repair. |
| Gate A and ancestry reset | Evaluation depended on segmentation; component parenthood was not proof of causal copying. | Report operational remnant recovery, inspect continuity, and retain measurement-limited outcomes. |
| October 22–23 shell experiments | Matched-founder screen and breeder shell test failed their rules; membrane includes a scoring confound. | Do not select the new pair on membrane amount or assume the wounded-pond outlier repairs better. |

## Gate 0 — existing-record audit (completed, no GPU)

Reproduce from the repo root:

```sh
python3 docs/recovery-accessibility-2026-10-24/audit.py > /tmp/recovery-audit.json
cmp docs/recovery-accessibility-2026-10-24/audit.json /tmp/recovery-audit.json
```

The [audit output](audit.json) includes the hashes of every input file, the candidate identifiers and genome, and the ranking. It validates the complete 12 founders × 3 mutation scales × 200 mutants, the recorded confirmation candidate list, unique identities, and agreement between aggregate and per-trial regeneration/survival/light-dependence counts. It does not independently reconstruct the old physical executions or establish their executable provenance.

Findings from the existing records:

- 7,200 screen mutants; 2,400 each at mutation step 4, 8 and 24.
- 665 historical confirmation candidates. Of these, 129 have a positive observed regeneration difference; 16 have a viable difference of at least 10 percentage points; none reaches 20 points.
- 14 changed, viable candidates have a positive observed difference in both stages.
- These are post-hoc readings. Historical confirmation was selected for changes in six other traits or role; `regenerated` was not a selection trait. That subset cannot estimate the prevalence of recovery-improving mutations in the full panel. The `recovery` selection trait was whole-tile mass recovery, not tracked regeneration.

**Candidate fixed now, after that audit:** founder array index **0** (M3 cluster **0**) and test-2 mutant **m138**, mutation scale **24**, slot **12**, delta **−20**. The deterministic, post-hoc locator requires a changed genome, historical viability in both stages, and positive regeneration differences in both; orders by confirmation gain, screen gain, then ascending founder index and mutant number. No claim that this is an optimal locator.

Historical screen difference: **+1 of 4**. Historical confirmation: **28/32 mutant versus 23/32 parent**; seven discordant pairs favor mutant and two favor parent, nominal one-sided exact paired p = 0.08984375. These numbers do **not** establish improvement, particularly after inspecting many candidates. The tracked runner uses separate parent and mutant `evaluateBatch` calls with identical seeds and positions ([tools/assay.ts](../../tools/assay.ts), `mutants` and `confirm` dispatch); the p-value here remains descriptive because it is post-hoc and historical source provenance is incomplete.

Source files and SHA-256:

- `runs/found-t2/screen/f0-s24-b8.json`: `c8e6a02d76e38823bd40d2f50ebe2e8c4e446323716371dfb6effbca86d163ab`.
- `runs/found-t2/confirm/c22.json`: `ffd778716e45ffd939a7f3426db88d5d0955348de2991184a76d25cae1d74bcb`.

**Choice is closed for this experiment.** A fresh failure does not unlock the next of the 14 candidates. No old trial enters the new inferential denominator.

## Gate 1 — make the existing assay auditable

Reuse `evaluateBatch`, `DEFAULT_EVAL`, `mutateInPlace`, genome encoding, `census`, `Tracker`, and the exact integer lesion physics. Do not import `tools/assay.ts` as a library: it requests a GPU device and dispatches at module scope. Reproduce its short pure mutant recipe in the new diagnostic entrypoint using the existing exports, and assert equality with the archived mutant hex. Also revert the changed slot and assert exact equality with the parent genome. Record both genomes and their hashes in the frozen manifest.

The future implementation is a small diagnostic runner/reader under `experiments/recovery-accessibility/`, plus an opt-in observer in `packages/search/src/evaluate.ts` if needed. Keep default outputs and dynamics identical. Preserve the existing outcome alongside the extra observations; do not silently redefine historical `regenerated`.

### Assay fixed for this test

- `RULE_VERSION = 1`; `DEFAULT_EVAL` world at the pinned revision; no optional injuries, shells, pond cycle, background producer, genes, declared cells, or shape rules.
- Tile 64 × 64, **side 1, reps 1** per call; nutrient 32, founder biomass 64, founder radius `floor(64/6) = 10`, energy twice biomass, uniform light with the existing default parameters. Serialize the fully resolved config, not just overrides.
- 3,000 growth steps; 2,000 recovery steps; 2,000 dark and matched-light steps. `mutRate = 0` for all assays. A mutation is constructed once before planting; none occurs during testing.
- The historic whole-tile lesion arm is retained for comparability but is not the decision endpoint.
- Regeneration arm: the existing largest-component choice, threshold 48, minimum mass 128, existing edge-lesion algorithm, and overlap tracking every 50 steps. About 30% is a target **area**, not guaranteed mass removed. The old check requires the retained remnant to be no larger than 80% of pre-lesion mass and to end at least 90% of that mass.
- Each genotype is rebuilt from its genome in the same fresh-medium template. No evolved biomass, membrane, energy, spatial arrangement, or other genomes are carried in. Genotypes may develop different structures; record these rather than silently equalizing them later.
- One parent call and one mutant call per seed, at the **same tile position** in separate worlds. Never put `[parent, mutant]` into one batch and call the two different positions paired. Alternate which call runs first by seed index. Device timing never affects the outcome.

### Additional observations and conservative recovery score

Read the regeneration branch every 25 steps, with no feedback into physics. Downsample the identical snapshots to feed the original 50-step tracker. Record pre-lesion target cells, their B and P separately, target mass/area, exact lesion center/radius, actual mass removed from the original target cells, immediate remnants, all overlap edges, and outcome categories. Record target and remnant mass over time, matched-light and dark masses, and final hashes/ledgers. The outcome categories must distinguish: failure to establish, no eligible component, insufficient injury, no remnant, tracking loss, fusion/ambiguous overlap, retained but insufficient regrowth, and recovery.

Define `R` as the unchanged legacy `regenerated` bit. Define conservative `R_clean = 1` only when `R = 1` **and**:

1. Actual lesion destruction removes 20–50% of the original target's B+P; at least one original target cell remains in the watched remnant.
2. The watched 50-step continuation has no ambiguous incoming overlap from another eligible component and no fusion involving it. Check incoming overlap explicitly; a missing `fusion` event alone is insufficient.
3. The 25-step continuation from that same immediate remnant also remains identifiable and finishes at ≥90% of the same pre-lesion mass, with no incoming merge. Splits are recorded; continue only the original tracker's retained ID, never sum daughter masses or rescue a lost ID with a nearest neighbor.

All other **biological/measurement** outcomes score zero for `R_clean`, remain in the denominator, and keep their reasons. A crash, malformed record or missing snapshot is **technical incomplete**, never a biological zero. Even `R_clean` is an operational spatial-continuity measure, not molecular ancestry or proof of an organism. Material entering from diffuse surroundings is not ruled out; a later isolated-support test would be a different assay and must address Gate A's failed isolation/segmentation controls.

Use thresholds 32 and 64 with the same minimum mass, actual lesion, and snapshots as predeclared **observer sensitivity views**. Anchor their remnant by maximum overlap with the primary immediate remnant, ties by smallest component index; their denominator and reference mass remain the primary trial's. Track at 50 steps, report absence and ambiguity as zero. Do not reselect the wound or a favorable body. These are deliberately not independent experiments or alternative primary definitions.

### Engineering acceptance before scientific seeds

Use four separate engineering seeds (proposed 2,026,102,301–304; check collisions before freezing): M3 founder 0 and `generalistGenome(60,20)`. Historical records say the latter restores population mass but fails tracked regeneration. Require founder 0 legacy regeneration ≥3/4 and generalist ≤1/4; if this separation fails, stop as `ASSAY-CALIBRATION-FAILED`, investigate, and issue a new version before running any scientific seed. These small controls establish gross responsiveness, not a calibrated false-positive rate.

Replay two founder-0 cases identically as sham parent/parent pairs: no per-trial phenotype or state-hash discordance. Synthetic fixtures must show that dead targets, missed wounds, replacement by another component, and merge-assisted apparent recovery cannot produce `R_clean = 1`. Test both a clean regrowing continuation and an ambiguous one; a positive synthetic fixture tests the reader, not physical regeneration. Confirm 25-step readbacks leave the 50-step legacy bit and final physics state unchanged. Short CPU/GPU checks exercise lesion and mutation reconstruction using the existing golden machinery; avoid requiring an entire new infrastructure project.

If instrumentation cannot separate clean continuation from merging, label `MEASUREMENT-LIMITED`; do not start breeding or claim that recovery cannot improve. Gate A remains unresolved even if these engineering checks pass.

## Gate 2 — the smallest new scientific batch

**32 fresh independent seed pairs**, each two one-tile genotype assays. Proposed scientific seeds: 2,026,102,401–528, with the first 32 used here. These are proposed until checked against accessible experiment manifests and reserved in the new manifest; historical seeds around 4.1 million are excluded. No scientific seed may be used to debug or choose the parent, mutation, endpoint, observer threshold or stopping rule.

Before executing: hash the plan version, complete source tree/patch, parent and mutant genomes, full config, seed manifest, observer version and reader. Record the approved implementation revision and device. A physics or decision-code repair creates a new attempt/version, retains old records, and requires the complete paired data under one version; never silently combine attempts.

Read all 32 pairs once. Continue only if:

- mutant `R` successes exceed parent by **at least 2/32**;
- mutant `R_clean` successes also exceed parent by **at least 2/32**;
- each genotype survives growth and meets light-dependence in at least 29/32 trials, and mutant trails parent by no more than one trial on either measure;
- median mutant/parent pre-lesion target mass over pairs with both targets is at least 0.8. If fewer than 29 pairs have both targets, stop; do not select only the successful subset for recovery counts.

Otherwise report `NO-LEAD-IN-FIRST-32` (or a specific calibration/measurement/technical status). This is a **futility screen**, not a significance result and not proof that no accessible improvement exists. There is no early success declaration and no alternate candidate.

## Gate 3 — fresh confirmation if Gate 2 earns it

Run the remaining **96 seed pairs**. The final predeclared analysis uses all **128 new pairs**; nothing historical is pooled. Continuing only after a promising first 32 is a futility rule: the only success test is the fixed-N test at 128, so there is no repeated early-success testing.

For each of `R` and `R_clean`, let W be pairs where only mutant succeeds and L pairs where only parent succeeds. Ties stay in the effect-size denominator. Calculate:

- observed gain `(W − L) / 128`;
- one-sided exact paired test `p = sum(comb(W+L,k), k=W..W+L) / 2^(W+L)`; p = 1 if there are no discordant pairs;
- success counts/rates, discordant counts, paired difference uncertainty, and all failure categories. Specify the difference-interval method in the implementation manifest before launch; it is descriptive and never substitutes for the exact decision rule.

Declare `ACCESSIBLE-ASSAY-IMPROVEMENT` only if **both** outcomes have gain ≥0.05 (at least 7 net additional successes of 128) and exact p ≤0.05, and all guardrails hold:

- Each genotype's survival and light-dependence passes the existing one-sided 95% Clopper–Pearson lower-bound test against 0.8, now on 128 trials. Mutant is no more than six observed successes worse than parent on either. These are scope-specific engineering non-degradation checks; do not claim statistical non-inferiority.
- At least 116 pairs have two eligible pre-lesion targets, and median paired target-mass ratio is ≥0.8.
- The observed mutant-minus-parent direction is positive in both threshold sensitivity views. If the primary passes but a view ties/reverses or is unavailable, report `ASSAY-SENSITIVE`, not validated recovery improvement.
- Every accepted case has exact matter conservation and energy accounting, valid identity/config/observer bindings, and replay checks below. Per-genotype actual-damage distributions and all discarded clean-score reasons are published. A finding driven by differently inflicted lesions remains a limitation even within the 20–50% band.

A result demonstrates this one genotype change's effect under this assay. It does not establish population-wide evolvability, a new ability beyond the ancestral repertoire, or that the benefit outweighs costs in an evolving pond. All 128 pairs concern **one genetic contrast**, not 128 evolutionary histories.

If the fixed test fails, report `NOT-CONFIRMED` with uncertainty and ceiling headroom. No more seeds, relaxed injury band, higher mutation scale, longer recovery horizon, or next-ranked candidate under this protocol. A modest effect can be missed; 128 is a bounded diagnostic budget, not a claim of high power for every 5-point effect.

## Cost, outputs and implementation boundary

- The retrospective audit is complete and used no GPU or cloud resources. Inputs are gitignored existing records; preserve them or their verified copies for reproduction. The saved output records their hashes and candidate genome.
- Local-only proposed execution; cloud budget **$0**. One GPU lane. Controls first, then at most 128 pairs; no world evolution, 3D work, coordinator changes, or long-run ensembles.
- One complete existing assay call branches after 3,000 steps into four 2,000-step arms: **11,000 simulated one-tile steps**. The first 32 pairs cost 704,000 such steps. The full 128 pairs cost 2,816,000. Eight calibration calls plus two identical replays cost 110,000. Replay scientific pairs 1 and 32 (both genotypes) adds 44,000. Planned workload before technical retries is **2,970,000 one-tile steps**, excluding tiny engineering fixtures. A single retry of every planned call could double that to 5,940,000; the wall-clock/storage caps still apply, so retries can exhaust the budget and leave an incomplete result. Count branch steps rather than pretending a complete assay is just one 5,000-step trajectory.
- Measure end-to-end wall time and output bytes on engineering controls. Initial execution cap: **60 local wall-clock minutes and 2 GiB** including readbacks, validation and replays. If the measured upper per-case cost predicts that the cap is insufficient, stop before scientific seeds and revise the cap explicitly in the launch manifest; no unmeasured runtime promise. The cap does not reduce the required sample.
- Stream per-census observations. Save initial/grown/immediate-lesion/final checkpoints, compact overlap/decision records, full input identities and per-pair outcomes. Do not retain every dense census buffer. Cross-host replay is useful later, not a prerequisite that expands this first test.
- At most one technical retry per case, with old artifacts retained. An invariant failure stops execution for diagnosis rather than being retried until green. An interrupted/incomplete attempt never yields a scientific verdict.
- Deliverables on execution: `manifest.json`, genome inputs, `cases.jsonl`, per-case diagnostics/checkpoints, `summary.json`, `readout.md`, and review record under a new `runs/recovery-accessibility/<protocol-id>/`. Reader rejects missing/duplicate/wrong-seed/wrong-version cases and never treats a partial first stage as a final 128-pair result.

Implementation checks: focused observer/reader/manifest tests, unchanged default-evaluator regression, typecheck, and the existing relevant native GPU golden checks if evaluator or mutation/lesion plumbing changes. Run the repository-required **Sol 6.1 High read-only review** on the protocol and again on implementation before a freeze/commit. This planning task implements only the offline audit; it does not create or launch the new assay runner.

## What each outcome earns next

| Outcome | Next step; no automatic larger experiment |
|---|---|
| Calibration or observer fails | Resolve the specific measurement issue. No breeding and no claim of biological impossibility. |
| First 32 gives no lead, or 128 does not confirm | Close this candidate. If pursuing accessibility, separately freeze a small one-event mutation panel around a viable low-recovery descendant, rather than another near-ceiling founder. Existing test-5 subject `h1-r0-868568:62833` is a concrete option: historical survival/light 32/32, regeneration 5/32. Parent selection precedes new assay data. A negative panel would be local to that parent and panel. |
| Legacy score improves but clean/sensitivity checks fail | Study segmentation, lesion severity, fusion and background contribution. Do not optimize the breeder against this score yet. |
| One accessible improvement confirms | Repeat the contrast in a matched sham/damage challenge that measures propagation advantage, and establish a relevant physical recovery assay if required. If better recovery does not improve propagation, the bottleneck is selection coupling, not absence of that mutation. |
| Recovery advantage translates into propagation | Separately register the small breeding pilot: recovery-based versus random donor selection, each mutation on/off; independent source histories; mutation logs; genome-only tests of descendants on held-out damage patterns. Keep packet budgets equal and avoid rewarding membrane or raw mass directly. |
| Breeding reliably produces inherited recovery gains | Reduce imposed selection/bottlenecks in a separate withdrawal test. Claim autonomous adaptation only if the advantage persists under local competition; keep organism/reproduction claims behind the unresolved identity evidence. |

The immediate deliverable sought is a defensible **one-mutation improvement in an explicitly bounded recovery assay**. Each later question—selection, recurrent discovery, inheritance across evolving histories, and autonomy—has its own gate.

## Planning review

Sol 6.1 High independently reviewed this plan, prior-art note, audit script and saved output read-only. It reproduced the offline audit byte for byte and reported no scientific blockers; its one minor finding was that the step total excluded permitted retries. The workload paragraph now labels the base cost explicitly and includes the retry ceiling. See [review and disposition](REVIEW.md). This is review of a proposed experiment, not validation of an implemented assay or authorization inherited from an older campaign.
