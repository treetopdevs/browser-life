# Foundations investigation: results and decision record

Completed 2026-09-29, following work begun 2026-09-28. This is an exploratory report in the isolated `evolution-foundations` jj workspace. All fixed screens, fresh-seed validation and bounded feasibility streams are complete. The decision is to retain the current substrate and improve the transmission assay; inherited functional organization remains inconclusive. The original M4 result remains **not met**. Neither a fresh amended M4 ensemble nor the registered long extension has run here.

## What the evidence already changes

The current substrate can support transferable growth, and sampled later genotypes can outperform earlier genotypes under identical physical starting conditions. Those findings weaken the claim that lineage turnover is accompanied by no functional change. They do not establish an expanding repertoire, organizational heredity, or historical causation by selection. A competition reversal in one source also rules out treating a later genotype's advantage as independent of its surroundings.

The most useful next distinction is between **growth of a genotype, transmission through a fragment, and reconstruction of a measured organization**. Each requires its own evidence. Missing duplication and silent-slot operators are real implementation gaps relative to the original plan, but are not yet an identified cause of the held-out M4 failure. Adding them before locating the failed link would change several scientific assumptions at once.

## Authenticated histories and comparison design

All five prespecified `gradient-m3` treatment histories, seeds 1–5, replayed through one million steps. Every terminal combined artifact digest and all six saved observation files match its original bundle; separate physics hashes and readback verification also pass. Checkpoints at 100k, 500k and 900k are authenticated reconstructions of old histories, not fresh evolutionary replicates. The five reconstructions took 5,703.69 seconds on this host.

The fixed extraction rule retains every component and selects structurally pure candidates by abundance stratum and hash. Source 5 has only three available early candidates; all other sampled times have six. There was no replacement based on assay performance. A second fixed hash rank selected one early and one late genotype from each available catalog for competition. Source 3's selected early and late genotypes have different founder origins; the other four pairs have the same founder origin.

The competition plan contains 20 solo gardens and 50 reciprocal competition arms, all completed with conservation, mutation-off checks and post-execution source verification. Genotypes use an identical physical inoculum; solo runs start with B=20,699. Historical environments retain conditioned chemical pools after removing residents. They reset light and clock, and are not complete recreations of the native ecosystem. Foreign gardens follow a five-source cycle, making their contrasts dependent. Each source has one fixed assay seed per environment, with reciprocal placements as a paired technical contrast.

Evidence: [fixed plan](../runs/foundations/competition-plan-gradient-1-5-v1/manifest.json), [authenticated aggregate](../runs/foundations/competition-analysis-gradient-1-5-v1/analysis.json), [protocol](foundations-competition.md).

Recorded plan SHA-256: `c73c30211a0cc240c6217b027b078d8cb274b9c05726b7903da992b9d9399dc7`.

## Mutation distribution: a confound to preserve

The scales 1, 4 and 24 are not a comparison of amplitude alone. The implemented operator replaces a zero delta with +1, and sigma uses a signed right shift with a unit fallback. Enumerating equally weighted raw residue classes before clamping gives:

| Scale | Mean non-sigma delta | Mean sigma delta |
|---|---:|---:|
| 1 | +1/3 | +1/3 |
| 4 | +1/9 | +1/9 |
| 24 | +1/49 | −2/7 |

This [algebraic diagnostic](../runs/foundations/mutation-operator-residues-v1.json) is not an estimate of natural mutation outcomes: actual seeded draws, small u32 modulo imbalance and founder-specific clamping remain in the screen records. It shows why a difference between scales cannot be attributed purely to mutation severity. The unchanged rule-faithful screen is still informative about its actual proposed distributions. An explicitly symmetric operator would be a separate intervention and cohort.

The frozen proposal set contains 200 draws per founder and scale: 7,200 total, of which 25 leave the genome unchanged after clamping and 1,371 are duplicate results under the recorded within-founder history (including parent-equivalent results). Distinct loci sampled per founder range from 108–120 at scale 1, 107–123 at scale 4 and 105–121 at scale 24, out of 163 possible loci. Sigma has only 11/15/17 proposals across all twelve founders at those scales, respectively; its algebraic bias should not be mistaken for a well-powered empirical sigma comparison. These are sampled neighborhoods, not exhaustive landscapes.

Existing founders are separate backgrounds, not a matched equal-viability sample; repeated identical-parent controls establish determinism, while fresh validation seeds address variation across assay conditions.

An unresponsive changed genotype is also conditional evidence. Identical observations in these gardens cannot distinguish unused weights, integer thresholds, effects expressed in another environment, or interactions with a later mutation. Such a result is compatible with latent variation in the existing representation; it does not establish universal neutrality, explicit silent-slot machinery or unlimited evolvability.

## Complete mutation screen

All 113 planned batches and 7,200 proposal assays completed, with all exact-parent repeats matching and post-execution checks passing. The [complete screen summary](../runs/foundations/screen-analysis-7200-v1.json) contains 5,836 distinct resulting genomes, including seven parent-equivalent genomes, and 5,829 distinct effective mutants. These are exposure counts, not independent evolutionary trials. Overall, 3,610 proposal assays change at least one Evaluation field, 3,601 change a saved trace summary, and 973 have at least one paired fixed-role share change. Categories overlap; their counts must not be added.

Each scale has 2,400 proposal assays:

| Scale | Parent survives | Mutant survives | Paired survival losses / gains | Paired regeneration losses / gains | Assays with fixed-role changes |
|---|---:|---:|---:|---:|---:|
| 1 | 2,390 | 2,394 | 0 / 4 | 47 / 61 | 315 |
| 4 | 2,388 | 2,388 | 1 / 1 | 67 / 51 | 318 |
| 24 | 2,392 | 2,368 | 24 / 0 | 190 / 48 | 340 |

The scale-24 proposals show more observed regeneration losses than the smaller-scale proposals in this screen. This is a descriptive distribution comparison, with founder, seed, tile, duplicate-genotype and operator-direction differences retained. It is not a validated causal estimate of mutation amplitude or a natural mutation-benefit frequency. Most mutants retain the survival outcome, which is weaker than preserving all relevant function.

The frozen nomination rule yields **28 nominees**: four `changed-preserved` genomes (founders 0, 5, 9 and 11), twelve `observed-loss`, and twelve `observed-unresponsive`, plus twelve identity controls. No `role-shift-preserved` nominee qualifies. The [validation plan](../runs/foundations/validation-plan-v1.json), SHA-256 `914b4b63c6cd4d6aba1116e5ce839d77abb427654b912d94cdc282e0f4e460d8`, is fixed from all 7,200 observations before validation outcomes and uses seeds 620050001–620050032.

The empty role-preservation class has a concrete assay explanation. Our nomination rule requires both parent and mutant to pass **four** screen outcomes. `recovered` measures tile/population mass recovery after a fixed-centre lesion; `regenerated` uses a separate lesion targeted at the largest detected individual. These are different interventions, not interchangeable measures of the same recovery event. The original M3 probability gate and this validation's absolute gates use survival, individual regeneration and light dependence. In the complete screen, parents pass population recovery in only 1,627/7,200 assays, versus individual regeneration in 6,747/7,200.

Of the 973 role-changing proposal assays, **866 preserve all three M3 outcomes in both arms**, representing 728 distinct founder–mutant genotypes across seven founders. None preserves population recovery in both arms. The four-outcome filter therefore excludes an observed set of three-outcome-preserving role changes; zero nominations cannot establish that these variants are absent. This [post-screen selection-sensitivity diagnosis](../runs/foundations/role-nomination-diagnostic-v1.json) reproduces the frozen nomination exactly; it is not fresh confirmation or a revised nomination. Three selected loss-class genotypes did show role changes in the screen, but none belongs to that three-outcome-preserved subset. All original nominations and the running validation cohort remain unchanged. Any broader validation must freeze a separate cohort before its fresh outcomes.

## Fresh-seed mutation validation

All 32 reserved seeds completed: **1,280 matched candidate/control pairs**, with all 384 identity-control pairs exact and all four full-parent repeats matching both evaluations and complete growth traces. Every chunk passed its source checks and completed below its 600-second cap; the four chunks took 1,185.04 seconds in total. The [complete validation analysis](../runs/foundations/validation-analysis-v1.json) has SHA-256 `88a785829aa2239901f3dee39802612a3c62f877c8abbb55157678bc06f78584`.

Both parent and mutant must pass the survival, individual-regeneration and light-dependence probability gates: six checks per nominee, each with a one-sided 95% lower bound above 0.8 (at least 30/32 successes here).

| Frozen screen class | Nominees | All six gates pass | Passing nominees with any fresh fixed-role change |
|---|---:|---:|---:|
| Changed-preserved | 4 | 1 | 0 |
| Observed-loss | 12 | 1 | 0 |
| Observed-unresponsive | 12 | 5 | 0 |
| Identity controls | 12 | 6 | 0 |

Seven of 28 changed-genome nominees pass all six gates. Of the other 21, fifteen have at least one failed gate in both arms, two fail only in the parent, and four only in the mutant. Regeneration is a limiting endpoint throughout those failures; the loss nominee from founder 7 also fails mutant survival/light gates, and the loss nominee from founder 10 fails those parent gates. Six identity controls miss biological probability gates while still matching their identical parent exactly. Thus a failed biological gate is not an engineering-control failure or, by itself, evidence of mutation-caused damage.

Two passing nominees show differences on multiple fresh seeds. `f9-changed-preserved` changes Evaluation fields on 13/32 seeds and full growth traces on 11/32; both arms survive and are light-dependent on 32/32 and regenerate on 31/32, with zero paired harmful outcomes for those three endpoints. `f4-observed-loss` changes evaluations and traces on 32/32, also has 32/32 survival/light dependence and 31/32 regeneration in both arms, but has one paired regeneration loss and one gain. Its screen label therefore does not describe a stable loss class. These outcomes support accessible phenotypic variation compatible with the stated gates, not new function or an improvement in every trait.

All seven passing nominees have zero paired survival losses, giving a per-nominee one-sided 95% upper bound of 8.94%, below the frozen 10-percentage-point prioritization margin. This survival result must not be generalized to every function: for `f4-observed-loss`, the regeneration-harm upper bound is 13.98%. Bounds are separate for each nominee and endpoint, with no simultaneous family-wide confidence guarantee or mutation-population frequency interpretation.

Eleven of twelve screen-unresponsive mutants retain identical evaluations and full growth traces on all 32 fresh seeds. The remaining one, `f7-observed-unresponsive`, differs on one seed, without a fixed-role or binary-gate difference. This makes its original unresponsive label explicitly assay-conditional; it does not prove universal neutrality for the other eleven.

Seven nominees show a fixed-role change on at least one fresh seed, but none passes all six absolute gates. That is not evidence that role-changing viable mutants are absent. In particular, `f2-observed-loss` changes roles on all 32 seeds and has 32/32 survival/light dependence in both arms; its parent regenerates on 29/32 and mutant on 31/32, with zero paired regeneration losses. It misses the joint gate because of the parent baseline. More fundamentally, the four-outcome nomination filter excluded the entire screen subset of three-outcome-preserved role changes. A future cohort can investigate those candidates under a separately frozen eligibility rule.

Each nominee and its matched parent occupy a fixed tile position across the fresh seeds. The bounds concern that conditional assay; differences between separate nominee slots are not a position-matched founder comparison. Fresh-seed replication is also not replication of independent evolutionary histories. These results establish neither organizational heredity nor expansion of the functional repertoire.

## Growth and competition

Final solo biomass under the same standardized physical starting conditions:

| Source | Early genotype | Early genotype's founder | Late genotype | Late genotype's founder |
|---|---:|---:|---:|---:|
| 1 | 607,346 | 81,054 | 1,261,521 | 81,054 |
| 2 | 35,904 | 87,911 | 403,829 | 87,911 |
| 3 | 537,799 | 91,164 | 1,149,111 | 87,854 |
| 4 | 693,777 | 88,843 | 740,379 | 88,843 |
| 5 | 106,829 | 125,241 | 266,660 | 125,241 |

All twenty solo arms retain biomass and grow. Each selected late genotype exceeds its earlier comparator and its own founder in this garden. Repeated identical founder controls in sources 1, 2, 4 and 5 match exactly, including physical and observer trajectories; they are technical repeats. This contrast identifies an effect of genotype under the stated assay, not a selection-versus-drift effect in the historical evolution.

The following values are the geometric mean of the late-to-early biomass growth ratios across the two reciprocal placements. Both start with equal biomass. An early extinction is reported separately and is not replaced with a pseudocount or a finite ratio.

| Source | Own early chemistry | Own late chemistry | Foreign early chemistry | Foreign late chemistry | Standard garden |
|---|---:|---:|---:|---:|---:|
| 1 | 1.62 | 1.66 | 1.72 | 1.75 | 2.61 |
| 2 | 1.71 | 1.39 | 1.52 | 1.59 | 6.09 |
| 3 | 2.21 | 2.17 | 2.01 | 2.81 | 2.75 |
| 4 | **0.50** | **0.52** | 1.57 | **0.51** | 1.09 |
| 5 | 7.51 | Early extinct in one placement | Early extinct in one placement | Early extinct in one placement | 3.17 |

Both competitors survive in 47 of 50 arms; the remaining three are late-only survival. Sampled encounter checks show overlap in every arm. Four source histories favor late across all five tested environments, with the source-5 extinction outcomes kept categorical. In source 4, early wins in both of its historical chemical environments despite late's small solo-garden advantage. This is context-dependent performance; it is not the pattern "each wins at home," and does not establish Red Queen coevolution. All five standard-garden point ratios exceed one, but source 4 falls below the provisional 1.10 prioritization margin.

These ratios have no validated between-assay confidence intervals: there is one paired placement contrast per source and environment. Five selected source histories do not justify pooling censuses or placements to manufacture precision. No equivalence/absence claim, universal ranking, new-function claim or confirmatory probability is made. A future selection-versus-drift control would assay evolved neutral-source genotypes under the same active-controller conditions; that is a separately designed follow-up.

## Observer and life-cycle evidence

Constructed worlds pass their intended positive and negative detector cases. On source 1's three 2,000-step natural continuations, changing census cadence from 25 to 100 to 200 changes detected fissions from 4/2/2, 423/192/93 and 25/14/8, respectively. Terminal physics remains identical. All 27 tested observer settings at each time find zero compartments. This establishes sensitivity to observation cadence and bounded robustness of non-detection, not biological impossibility.

The first intact transfer pilot retains biomass and grows for 16 of 18 selected source-1 components; two middle-time extinctions remain in the denominator. All three extraction/restoration shams match. The founder comparator grows while its physically matched zero-controller counterpart ends with no biomass. These observations establish transferable growth for some sampled material. They do not establish repeated reproduction or organizational heredity.

Common-garden late-genotype traceability has the following all-chain denominators. Families overlap, and tracker IDs are asymmetric observer identities rather than certified organism generations.

| Source | Raw three-ID chains | Topology-clean chains | Youngest identity observed at age 200 | Youngest identity later fissions |
|---|---:|---:|---:|---:|
| 1 | 2 | 2 | 1 | 0 |
| 2 | 16 | 8 | 4 | 1 |
| 3 | 272 | 25 | 9 | 3 |
| 4 | 0 | 0 | 0 | 0 |
| 5 | 0 | 0 | 0 | 0 |

The observer's largest-overlap fragment keeps the parent ID and age. Independent overlap checks also expose material mixing that need not emit a fusion event. Consequently neither these raw chain counts nor a parent–child mass correlation can establish transmission. The [descriptive trait report](../runs/foundations/competition-solo-lifecycle-descriptive-v2.json) retains all-chain denominators, selected age-matched pairs, repeated-link deduplication and unavailable nonlinked/reassigned controls. Only three source histories supply clean chains, all in their late-genotype gardens. Source 3 has 25 clean chains, with 16 followed for traits under the fixed sampling rule. Within-garden mass associations are descriptive, with shared families and no independent-world interpretation; combining parent–child and child–grandchild links can also confound generation differences with resemblance.

Separating generations makes the limited information clearer. At matched age 200, source 2's parent–child mass correlation is +0.55 on six unique links, while child–grandchild is −0.38 on four. Source 3's child–grandchild correlation is +0.68 at age 100 (ten links) and −0.56 at age 200 (eight links); these need not involve identical eligible pairs. Source 1 has fewer than three links in every generation/age stratum. These associations have varying signs and sample composition within selected, overlapping families; they do not establish either the presence or absence of heritability. Nonlinked control availability is 2/8, 0/32 and 40/64 slots in the three gardens; matched reassignment is available for 0/4, 0/16 and 10/32 groups. No calibrated null comparison follows.

Membrane associations lack parent variation in the otherwise eligible sets; that is not zero heritability, and one child set does have a small nonzero value. The controls do not support a calibrated transmitted-organization effect.

## Serial transfer: growth observed, linked transmission unresolved

The fixed source-1 late donor starts with 20 cells, B=4,493, P=0 and total inoculum matter 4,508. Stage 0 completed three gardens with the fixed seed 640010001 and 3,000-step horizon. Every mechanical restoration sham and unsampled reference matches; all 120 original censuses per garden pass conservation and mutation-off checks. Initial/final channel inventories are retained and agree with the last census. See [stage 0](../runs/foundations/serial-transfer-stage-0-v1/manifest.json) and the [fixed protocol](foundations-serial-transfer.md).

| Arm | Final B | Final P | Minimum fresh-garden matter incorporated into bound structure | Recruitment outcome |
|---|---:|---:|---:|---|
| Evolved donor | 970,181 | 0 | 965,673 | One initial eligible root; no eligible direct-root child |
| Founder 9 | 89,384 | 0 | 58,078 | Two initial eligible components; single-root test unavailable |
| Matched zero-controller | 3 | 0 | 0 | Two initial eligible components; single-root test unavailable |

The incorporation lower bound is `max(0, final(B+P) − entire initial inoculum matter)`, under a checked garden containing only ambient A outside the inoculum. It rules out explaining the donor's bound-mass increase solely by repartitioning the original packet. It does not identify individual material ancestry or establish organizational reconstruction. Donor and founder inocula differ in shape and inventory, so their totals are descriptive rather than a matched fitness contrast. Founder and zero-controller share physical starting conditions; their contrast is limited to that intervention and seed.

The donor garden has 260 candidate child identities from 243 recorded fission events, including 34 child identities within the fixed 25–1,000-step recruitment window. **None is a direct child of the imported root ID.** All remain in the output, including mixed/fused and late events. At step 175, six new identities are recorded as births; their group subsequently fuses and splits while the original root remains separate. The imported root is observed alive through the horizon. This pattern leaves a specific ambiguity: connected-component overlap may fail to represent how the expanding material gives rise to new reproducing regions. It does not establish that the donor makes no viable progeny. The founder's two-component initialization is a further assay limitation, detectable with a pure step-0 preparation check, that a future protocol must resolve before using it as a serial-transfer comparator.

No selected packet exists in either arm. [Stage 1](../runs/foundations/serial-transfer-stage-1-v1/manifest.json) and [stage 2](../runs/foundations/serial-transfer-stage-2-v1/manifest.json) consequently retain both arms as `not-run-unavailable`; they launch no GPU simulations. This stream is complete as a bounded feasibility record, but repeated fresh-pool transmission and organization reconstruction remain **unestablished**. No replacement donor, recruitment-window change or retrospective reparenting was used to obtain a positive outcome.

A prospective follow-up can separate two questions: a fixed-rule transfer of a newly detected same-genotype component tests whether that packet persists in fresh resources; an independently validated material/identity trace tests whether the claimed parent–offspring link is correct. Include a preflighted control geometry and an empty-garden control, and select before future survival outcomes. This would not automatically establish biological heredity or spontaneous reproduction. It is a more targeted next intervention than immediately changing the genome representation, and is not part of the completed stream.

## Decision and next experiments

The completed growth and transfer results warrant retaining the current substrate as the working baseline. They do not identify missing duplication as the cause of the M4 result. The broader question of inherited functional organization remains inconclusive because the present observer and recruitment rules do not supply a calibrated repeated-transmission endpoint. Fresh-seed mutation validation strengthens the accessible-variation result, but cannot resolve that missing life-cycle link.

The next work should answer three separate questions, with separate cohorts and claims:

1. **Can a measured unit transmit and reconstruct itself?** Preflight the initial component geometry and positive/negative controls, validate material ancestry independently of overlap IDs, and freeze recruitment before future outcomes. A same-genotype fragment that grows and a correctly linked offspring that repeats the cycle are different evidence. Start with the smallest successful individual-level case before a collective search.
2. **Which changes preserve the intended function?** Align nomination with the stated scientific question. If the question is preservation of M3's three outcomes, use a new, explicitly three-outcome cohort; if both lesion interventions matter, retain both and say why. Freeze that choice and genotypes before new validation. Do not relabel this completed cohort or substitute its empty role-preserved class for a negative result.
3. **Does treatment exceed neutral growth over the amended M4 window?** With physics retained, calibrate and date the endpoint, declare the preset family and all required gates, and use a fresh ensemble. Companion opportunity/biomass diagnostics should help interpret activity without silently redefining the primary outcome. This can proceed alongside transmission work; solving M7 is not an added M4 prerequisite.

If transmission becomes feasible but rare or unrewarded, compare the relevant ecological incentive or variation mechanism one change at a time. For M5, partner/product removal and rescue can test an ecological dependency. For M6, distinguish independent histories and unit capability from additional copies in larger worlds. For M7, require a viable propagule to reconstruct a collective and reproduce again. A new representation or substrate becomes a targeted comparator if this sequence identifies a specific limitation, rather than the default response to a bounded metric or an unavailable assay.

## Completion and unresolved scientific questions

The bounded investigation is complete with a deliberately limited conclusion: genotype-dependent growth and accessible phenotypic variation are observed; repeated organizational transmission and expanding function are unestablished. The missing evidence is a calibrated reproducing-unit/ancestry measure, a viable repeated-transfer sequence, and a functional outcome beyond the present role labels and growth proxies. The serial stages that lacked eligible packets are completed unavailability records, not missing simulations to replace until a positive result appears.

The next experiments above, including broader role-preserving mutation validation, neutral-genotype controls and ecological interventions, are prospective. They are not unfinished members of the fixed matrices. The original M4 result remains negative, and its dated amendment and fresh confirmatory ensemble remain separate future work.

## Reproducibility and retention

All work is isolated in `/Users/nicholas/develop/browser-life-foundations`, native jj workspace `evolution-foundations`, bookmark `codex/evolution-foundations`. The original checkout's concurrent changes are outside this work. Protocols, tools, tests and this report are in the jj change. The approximately 1 GB of local assay evidence is retained under `runs/foundations/`, which is ignored by version control; the bookmark alone does not include those artifacts. Preserve that directory with the report for a complete handoff.

The frozen preregistration SHA-256 remains `5e08b51d7b58d00ad11b192eca3195343f1fc96747a5b7972e847b1d73879b4d`. CPU/GPU physics, schema and the original ecology/tracker sources remain unchanged. The evaluator's optional observer passed an ordinary-score parity check on twelve founders; physical replay/continuation parity is established separately by the authenticated history and assay checks described above.

The full CPU suite passed 64 files / 773 tests before the last serial-accounting hardening. After that change, the eleven focused serial tests, relevant Deno checks and TypeScript typecheck passed. These checks establish the tested implementation behavior; the scientific claims remain limited by the sampling and observer issues in this report.

## Keep the milestone contracts separate

The formal M4 gate in the frozen plan requires endpoints 1 and 2. The fully evaluated 0-of-4 held-out organization result is a separate, broader negative; it must remain visible, but a new life-cycle requirement must not be retroactively added to M4. In the original data, endpoint 1 passes for gradient-m3 and fails for spots-m3; endpoint 2 fails for both. A future endpoint-2 amendment must declare its presets and analysis family and rerun the required gate on fresh data, rather than carrying an old positive endpoint forward as if it were fresh confirmation.

Holding the fresh ensemble is an opportunity-cost decision while choosing rules and calibrating the amended measurement. It should not become an indefinite requirement to solve M7 first. If the final foundations decision retains current physics, M4 amendment design can proceed alongside the separate transmission work. A finite-window excess-activity finding would remain a narrower claim than open-ended functional innovation or collective individuality. No amended endpoint, threshold, fresh confirmation or changed milestone gate is adopted in this report.
