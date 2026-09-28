# Foundational reset: reproducing entities, inheritance rules and founder diversity

Date: 2026-09-29. Status: planning only; implementation and scientific execution have not started. This is a new prospective workflow, not a revision of completed results. Work belongs in `/Users/nicholas/develop/browser-life-foundations`, native jj workspace `evolution-foundations`, bookmark `codex/evolution-foundations`. Preserve the original checkout and all earlier evidence.

## Goal and completion contract

Determine whether the current local rules support identifiable, repeatedly reproducing entities whose heritable functional differences affect descendant success; then establish whether a broader founder search can reliably discover diverse examples. If a link fails, identify the narrowest supported intervention rather than automatically enlarging the genome or replacing the substrate.

Success of this workflow means a defensible decision, not necessarily successful organisms. The final package must distinguish measurement failure, demonstrated feasibility, observed counterexamples, limited search failure and statistical uncertainty. It must include executable assays, authenticated results, a founder archive where warranted, and a decision on retaining or experimentally changing the rules.

Suggested future execution goal:

> Implement, independently review, test and execute the bounded phases of `docs/foundational-reset-plan.md` in the foundations jj workspace. Preserve completed evidence and frozen M4 claims. Define observational criteria for a reproducing entity, calibrate those observations, test inheritance and reproductive success under current rules, and conditionally search and validate diverse founders. Stop dependent phases at declared gates, preserve all failures, and produce a source-bound decision report. Do not require a positive result to close the investigation; do not claim incomplete scientific phases were executed. Rule-changing comparisons, paid compute and milestone confirmation require their own scoped execution plan.

This document is not an instruction to launch that goal during the planning turn.

## Scientific scope

The original north star in `docs/plan.md` includes emergent individuality: no simulator `Organism` class or explicit `reproduce()` action. Preserve that commitment. An assay may identify candidate entities and experimentally transfer material, but must not feed observer identities, rewards or parent labels into the dynamics. A found or constructed reproducer is a feasibility control, not evidence of spontaneous origin. Artificial serial passage tests transmission under intervention; natural reproduction in an uninterrupted world is a separate outcome.

Model realism here means that the stated abstraction faithfully connects resource use, maintenance, inheritance, variation and differential reproductive success. It does not require molecular detail, unlimited growth, ever-increasing complexity, or a membrane merely because cells have membranes. Do not call all evolutionary dynamics organismal evolution: genome spread through mixed material may be a different valid process.

Keep these claims separate:

1. A spatial pattern or connected component persists.
2. A genome spreads or newly synthesized bound matter increases.
3. A parent-linked entity produces a separately viable descendant.
4. Descendants reconstruct an informative functional organization and repeat the cycle.
5. Heritable differences causally change descendant contribution under competition.
6. New ecological functions or higher-level reproducing collectives evolve.

This workflow targets 3–5 while measuring 1–2; it does not certify 6 or complete M4–M7.

## Evidence to carry forward

- `docs/foundations-next-results.md`: six mutation nominees preserve the tested M3 outcomes in both positions; four founder-2/7 nominees frequently change measured role shares. These are variation examples, not new functions.
- The transfer pilot incorporates substantial new bound matter, but its separation certificate rejects many multi-component scenes. Transmission remains unresolved, not demonstrated absent.
- Genome-copy ancestry, material transport and tracker identity can disagree. Current transport selects one incoming source genome by a bound-mass-weighted lottery; polymer permeability does not directly bar bound-mass transport or genome replacement. This motivates a causal test, not a declaration that the rule is defective.
- The old bootstrap uses size/speed as diversity descriptors and recovery/light dependence as quality criteria; it did not directly select repeated reproductive life cycles.
- The dated M4 amendment candidate remains unregistered after failed calibration precision. This is not a biological substrate verdict. The original M4 result and all completed reports remain unchanged.
- Earlier late controls and post-hoc morphology joins remain development evidence. They cannot become prospective validation by relabeling them.

## Team and model allocation

Use at most four active agents including the primary agent. Two Sol implementers and one Luna evidence worker are the default maximum; leave slots idle when dependencies prevent useful work. No agent recursively delegates.

| Owner | Work | Explicit boundary |
|---|---|---|
| Primary, strongest available model | Biological abstraction, causal/statistical design, thresholds, conflicting findings, rule-change decisions, final integration and scientific sign-off | Never outsource final validity judgments to a checklist or cheaper model |
| Sol A, high reasoning for design; medium/high for implementation | Observation and ancestry modules, lifecycle assays, constructed physical controls | Bounded interfaces and owned files; no scientific threshold changes |
| Sol B, medium/high | Search/archive adapters, fixed manifests, competition runner and meaningful failure tests | Starts independent tooling after interfaces freeze; search execution waits for gates |
| Luna, medium | Locate/reconcile files, hashes, seed and row coverage, attempt accounting, document cross-references, reproduce prespecified arithmetic | Flags discrepancies; does not approve causal claims, statistical methods or rule changes |
| Fresh strongest-model review, replacing a finished worker when needed | Adversarial review of high-impact ancestry, inference and any proposed rule variant | Independent of implementation; bounded source slice and protocol, then primary adjudication |

Model names for execution are explicit: `gpt-6-sol`, `gpt-6-luna`; high-impact independent reviews use the primary model, rather than routing scientific judgment to Luna. Use short self-contained task briefs, not full-history forks. Each brief states exact workspace/revision, question, owned paths, dependencies, tests, stop conditions and a compact evidence format. Reports contain verdict, evidence paths, tests, unresolved risks and resource use; bulky logs stay in files.

Only the primary edits shared protocol/threshold/statistical definitions. If two code tasks need the same file, serialize those edits or isolate their jj workspaces with a pinned shared base. Never run multiple local GPU workers. CPU implementation and review may overlap the one scientific worker.

Escalate Luna immediately for scientific ambiguity, a provenance contradiction, or one unsuccessful substantive repair. Escalate Sol after two unsuccessful repair cycles or any question that changes the estimand, identity semantics or physics. Do not pay for repeated cheap guesses. Record dispatch model, purpose, elapsed time, retry count and available usage data; unavailable token/cost telemetry stays unavailable. Do not claim measured savings without a comparable baseline.

## Phase 0 — preserve evidence and define the abstraction

Owners: primary plus Luna inventory; Sol A provides an implementation map. CPU only.

1. Pin the prior completed revision `062bba36758509e50f891c14542bb13726fdeb48` and authenticate its evidence/source indexes. Record the new execution revision, rule/schema/metrics/config identities and runtime/device. Do not rewrite the old final snapshot when new files are added.
2. Audit relevant local seed ledgers and accessible coordinator allocations. Reserve new development, calibration-validation, search and founder-validation namespaces, disjoint from each other and future M4 confirmation. Do not invent ranges before auditing. If coordinator access is absent, label clearance local rather than global.
3. Build a claim-to-code map for transport, genome copying, mutation, synthesis/decay, permeability, controller actions, observer identity and founder selection. Reuse earlier verified work, checking current hashes; do not redo every historical experiment.
4. Write an entity contract: physical support, observational boundary, identity through motion and contact, birth event, death, fusion, viability, developmental age, generation and descendant contribution. State what cannot be identified under aggregated material accounting.
5. Name competing explanations before new outcomes: observer limitation; founding bias; inheritance/mixing mismatch; ecological incentives; inaccessible heritable variation. Specify which comparisons discriminate them and which leave them confounded.
6. Check the abstraction against a small primary-literature set on replicator versus reproducer, individuality, life-cycle bottlenecks and experimental evolution. Record supported design choices and discrepancies; this is a focused review, not an indefinite survey.

Deliverables: `docs/reset-entity-contract.md`, `docs/reset-protocol.md`, and a new immutable input manifest under `runs/foundational-reset/` (proposed paths).

**Gate G0:** primary approves a coherent operational model and source map; unresolved definitions become explicit unavailable outcomes. No natural-history endpoint is based only on tracker IDs, shared genotype, growth or role labels.

## Phase 1 — make reproduction observable without programming it

Owner: Sol A; primary reviews semantics; Luna audits fixtures and receipts.

Separate event detection from offspring outcomes. A candidate birth is detected from continuous causal ancestry and a predeclared separation criterion; only afterward test survival, reconstruction and further reproduction. Failed offspring remain in the denominator. Do not define birth by looking ahead to successful regrowth.

The entity contract must handle budding as well as symmetric fission, movement across the torus, pre-existing neighboring components, temporary contact, fusion, disappearance/reappearance across a mass threshold, unrelated identical genotypes and a minority-material genome winner. Ambiguity is a valid classification. A spatial component can be an observational support without being assumed to be an organism.

Implement conservative continuous traces or justified bounds for genome-copy descent and material flows. Sparse snapshots alone cannot certify exact parenthood. Keep raw coordinates/membership, local event evidence and reasons for ambiguity so an event is reviewable. Preserve old observer outputs for comparison. Instrumentation must use no additional physical random draws and must retain bitwise physical parity.

Use three distinct control layers:

| Layer | Positive/negative cases | Establishes |
|---|---|---|
| Scripted event records | Known splits, motion, fusion, threshold flicker, missing observations | Detector logic only |
| Executed reference-physics worlds | Known transport winners, mixing, growth, torus crossing, clonal contact, empty and zero-controller cases | Observations track actual implemented processes |
| Natural development and unseen validation worlds | Existing selected replay for debugging; separately reserved inputs for validation | Applicability beyond constructed fixtures, with uncertainty |

A scripted positive is not a physically feasible reproducer. If no physical positive life cycle is known, state that explicitly; proceed only to the bounded feasibility discovery allowance, not to claimed biological validation.

Freeze thresholds for separation duration, observation cadence, minimum viable support, generation horizon and informative traits using development inputs. Validate cadence/threshold sensitivity without choosing settings that make a desired old event pass. Exact fixture assertions must all pass. Quantitative detector error rates require a sample-size/precision calculation and independent validation; a small zero-error fixture set does not establish a rare-error bound.

**Gate G1:** observation semantics and all declared deterministic cases pass; technical parity holds; ambiguous natural events are retained. If detector validity is unresolved, stop dependent claims and return a measurement diagnosis. Search orchestration can be developed but scientific search remains gated.

## Phase 2 — test what the current rules preserve and select

Owners: Sol A assays, Sol B manifest/competition support, primary inference. Current rules only.

Start with the original twelve founders, the four repeatable founder-2/7 variation nominees as diagnostic anchors, and any authenticated historical donor. Do not pool handpicked anchors with randomly sampled founders to estimate prevalence. Preserve exact starting material, geometry, energy and environment for causal genotype comparisons; account explicitly for interventions that intentionally alter them.

| Question | Comparison | Primary readout | Interpretation limit |
|---|---|---|---|
| Does identity survive motion/contact? | Matched same-genotype labelled controls; different-genotype contact versus sham/separation | Copy ancestry, support continuity, genome takeover and ambiguity | Same-genotype colors need physical-parity proof; contact effects need matched geometry controls |
| Does acquired material enter newly built descendant structure? | Fixed starting inventories, resolved descendant-local material accounting, matched genotype substitutions as a separate contrast | Conservative new-bound-matter bounds inside identified descendants | Garden-wide growth cannot answer this; genotype substitution identifies genotype effects, not the causal effect of resource acquisition |
| Does a life cycle repeat? | Uninterrupted world plus separately declared serial-transfer assay | Natural linked births; survival and three consecutive transmission cycles | Transfers are intervention evidence; three cycles are a finite feasibility test |
| Is organization reconstructed? | Development from a source-produced propagule, common-garden genotype substitutions and appropriate nonfunctional/sham controls | At least one informative non-mass structural or functional trait, fixed developmental age, evidence of newly built structure | Pre-existing structure carried over is not reconstruction; no informative trait means unavailable |
| Do inherited differences affect success? | Matched focal/competitor genotypes, reciprocal labels and positions, solo controls, predeclared starting frequencies | Descendant number/contribution at fixed horizon; genome share and biomass separately | Genome takeover is not automatically organism fitness; frequency dependence can prevent a total ranking |

Choose viable descendant contribution as the primary fitness quantity only after G1 supplies interpretable descendants. Freeze how budding, parent persistence and fusion are counted; report generation time and censored histories. Extinction counts as failure/zero where the estimand calls for it; technical missingness and unresolved identity remain distinct. Use a prespecified worst-case bound or declare inference unavailable rather than dropping ambiguous cases.

For serial transfer, freeze the first-eligible packet rule, tie break, transfer fraction/inventory treatment and observation window before execution. Do not inspect later success to select a child, switch to a later packet after failure, or replace an extinct branch. A missing birth before the fixed horizon, an ambiguous birth and a technically incomplete observation are different outcomes. Define the fresh-garden supply as an experimental intervention: account for every transferred/removed unit of matter and energy rather than presenting serial passage as one closed uninterrupted world.

Heritability work must distinguish genotype effects, inherited physical state, common environment and lineage relatedness. A parent–offspring regression alone is insufficient. Use matched common-garden interventions where feasible, multiple independently founded histories, and a frozen reconstruction tolerance/contrast. Neutral-origin genotypes, if compared, must be expressed under the same active-controller assay as treatment-origin genotypes. No automatic reuse of the neutral simulation mode as a biological fitness control.

Start ancestry debugging with mutation disabled, then require a separately frozen mutation-enabled probe before extending conclusions to evolving populations. Trace actual genotype changes, including clamped/no-change mutation proposals, and distinguish copy origin from immediate parentage after mutation. For at least one interpretable parent–mutant contrast, test whether the changed trait survives transmission and changes descendant success under the same assay. Record realized mutation exposure per birth/generation once generations are measurable; a per-quantum mutation probability is not a per-organism mutation rate. A mutation-off positive establishes transmission feasibility only. If mutation-enabled identity or reproduction fails, diagnose that link before a large evolving-population run.

**Gate G2 has two exits:** (a) a repeatable current-rule life cycle and interpretable fitness assay permit the full search; or (b) no positive is known but measurement is trustworthy, permitting only the capped feasibility search in Phase 3. A demonstrated mechanism limitation yields a rule-comparison proposal; it is not proof of impossibility. Assay failure cannot justify a rule change.

## Phase 3 — search new founders without repeating the original bias

Owner: Sol B; primary freezes objectives; Luna tracks every proposal and failure.

Retain the original twelve as a baseline. Search three separately reported cohorts:

| Cohort | Admission/search objective | Why it exists |
|---|---|---|
| Broad viable | Minimal active maintenance; archive diverse behavior without a lesion-recovery requirement | Tests whether the old bootstrap narrowed opportunities |
| Repeated-life-cycle | Measured natural reproduction and repeatable transmission/reconstruction where available | Finds feasible reproductive entities under current rules |
| Partner-dependent | Defined pair/community viability and interaction, with solo outcomes retained | Avoids excluding specialists that require a partner; community is the assay unit |

Use the existing MAP-Elites infrastructure where it fits. Archive continuous behavior/function descriptors, not only four fixed role categories or genetic distance. Candidate descriptors include generation time, propagule fraction, transport strategy, resource-response profile and contact tolerance; only calibrated, available descriptors can become selection dimensions. Keep genotype diversity and behavioral diversity separate.

Initial bounded design: three independent search starts per cohort, up to 256 evaluated proposal slots per start (2,304 total). This is an exploratory budget, not a power claim or 2,304 independent discoveries. Each cohort gets both a proposal ceiling and a measured compute ceiling; report both because expensive life-cycle objectives otherwise receive unfair effort. Freeze initialization distributions, random/descendant proposal mix, archive bins, tie breaks and budgets before launch. Do not silently give a losing cohort more optimization.

If G2 has no physical positive, spend at most one quarter of the search allocation on feasibility across the same predeclared starts; the quota counts toward, not in addition to, total search effort. Any discovered positive returns to Phase 2 for the complete G2(a) checks, including interpretable fitness and mutation-enabled ancestry, before unlocking the remaining search allocation. Charge that return to the existing Phase 2 cap, with headroom reserved prospectively; if it does not fit, stop with the candidate and a costed proposal. Stop full search if feasibility discovery finds no interpretable reproducer or the returned candidate fails G2(a). Preserve nonreproducing but informative candidates in the archive without calling them successful founders.

Freeze at most six nominees for independent validation, at most two from each cohort, using a deterministic diversity/quality selection rule defined before search outcomes. Underfilled categories remain underfilled. Save all attempted candidates, parentage, duplicate genomes, search failures, objective vectors and costs. No nominee replacement after validation outcomes. A selected founder collection is a designed population, not evidence of spontaneous origin or an unbiased frequency estimate.

**Gate G3:** frozen archive and nominees with interpretable discovery assays. If none qualify, close as bounded search failure and route to the decision table; do not launch validation of arbitrarily weaker candidates.

## Phase 4 — validate on unseen histories and environments

Primary owns inference; Sol implements the frozen analysis; Luna verifies complete rows and reproduction of arithmetic.

Planning target: 64 independent histories per candidate per declared environment, at most six new candidates plus the twelve original founders, in two prespecified environments. That is at most 2,304 candidate-environment histories before additional matched controls, each with up to three cycles. Benchmark the actual multicycle assay before adopting this matrix. This count is not a cost forecast or guaranteed sufficient power.

Use development data to choose sample size, effect floors, acceptable failure rates, the independent unit, multiplicity family and missingness sensitivity before opening validation. A proposed practical reliability target is a lower confidence bound above 0.8 for completing the declared three-cycle assay, separately from an informative reconstruction endpoint. Primary review must justify that target against the scientific claim; do not inherit M3 thresholds by habit. If making simultaneous candidate claims, account for the full declared family rather than reporting unadjusted nominee bounds. Statistical validation must exercise the actual analysis, including paired histories, ties, extinction, ambiguous events and technical missingness.

The same seed used for multiple candidates produces matched comparisons, not new independent environments. Multiple offspring, censuses and cycles are nested within a founding history. Shared search ancestry requires search-start-level interpretation for claims about the search algorithm. Three search starts do not support a broad algorithm-superiority claim. Partner assays use the pair/community as the replicate, with composition fixed before validation.

Freeze separate reliability endpoints for natural reproduction in uninterrupted worlds and for assisted serial transfer. Three successful assisted passages cannot satisfy the natural-reproduction endpoint. Parent–mutant effects on inherited traits and descendant fitness are also reported separately; reliable reproduction does not itself establish adaptive evolution.

Hold out both random histories and specified environmental configurations. The latter demonstrate transfer to those environments only. Do not select a new winning nominee using validation and reuse its results as independent confirmation. If the full powered design cannot fit the budget, freeze a smaller explicitly exploratory matrix before its outcomes or stop with a costed validation proposal. No lowering thresholds or selective truncation after results.

**Gate G4:** completed planned matrix, valid controls, interpretable uncertainty and immutable evidence; otherwise report the exact shortfall. A founder is validated only for the specific lifecycle/function/environment claims it passed.

## Phase 5 — decide whether to keep or change the rules

| Evidence | Decision |
|---|---|
| Detector fails, ancestry unresolved or trait uninformative | Repair measurement; do not infer absence of reproduction or expand search |
| Existing founders pass life-cycle and fitness probes | Retain rules; broaden ecological tests and founder diversity where useful |
| New founders pass where old ones fail under matched assays | Founder selection is a supported contributor; retain rules and freeze a new founder set for subsequent experiments |
| Genome spread succeeds while entity transmission repeatedly fails under resolved contact assays | Test a narrowly specified inheritance/compartment alternative; do not equate replication and organism fitness |
| Reproduction is feasible but selected against in the target ecology | Test a specific ecological incentive/tradeoff before adding genome capacity |
| Reliable transmission exists but useful variation is poorly accessible | Compare mutation scale/regulation/duplication only with a clear causal hypothesis and matched search effort |
| No positive within bounded search, without a resolved mechanism | Report uncertainty and the explored region; finite failure does not prove impossibility |

A rule variant is a follow-on experiment, not automatically implemented here. Its protocol must specify one mechanism, conservation/arithmetic bounds, CPU/GPU parity, new rule/config identities and golden pins, compatibility/migration, and matched baseline effort. Ideally cross old/new rules with old/new founder cohorts so retuning founders is not confounded with the rule change; assess both direct transfers and independently searched candidates. Primary review must explain any unavoidable representation incompatibility. Do not grant a richer rule more free resources, controller budget or search effort without declaring it.

Founder changes alone can change neutral distributions and preset identities even without a RULE_VERSION bump. Later M4 thresholds cannot simply be carried over. Preserve old milestones; write any amendment and recalibration separately.

## Resources, scheduling and stop rules

Proposed execution ceiling: eight local GPU-hours, twelve CPU wall-hours for assay/calibration computation, and 20 GiB new output. These are ceilings to adopt at execution, not estimates of what the target sample sizes will cost. Ordinary test/build time and agent usage are separately reported. No paid cloud work, long M4 extension, new confirmation ensemble or recurring automation is included.

| Allocation | GPU ceiling |
|---|---:|
| Observation/parity calibration | 1 hour |
| Current-rule lifecycle/contact/competition probes | 2 hours |
| Founder discovery, including feasibility allowance | 2 hours |
| Independent founder validation | 2.5 hours |
| Technical same-input recovery reserve | 0.5 hour |

Before every phase, benchmark the exact world size, observation overhead and output rate on development seeds. Forecast all arms, retries and storage. A phase that cannot fit stops with a revised proposal; do not consume its holdout set partially and then redesign around its outcomes. Reallocation within the total requires a recorded prospective decision before affected scientific outcomes; increases to the total are outside the bounded goal.

Each invocation has a manifest, time cap, exclusive GPU guard, source hash check, fresh output path and terminal receipt. Check cumulative caps between chunks and during long runs. Source drift, parity/conservation failure, invalid controls or insufficient disk headroom stop the affected work. Preserve partial runs. Technical retries repeat identical inputs, at most two retries, and all attempts count against caps. They never replace unfavorable biology. Resumptions retain nonoverlapping authenticated histories. A cap breach or incomplete sample is not success.

Suggested human review checkpoints: days 1–2 contract and observation specification; days 3–5 calibrated assays and current-rule diagnosis; days 6–9 conditional discovery; days 10–14 validation and decision. These are effort/timebox checkpoints, not promises or scheduled background jobs. Complete sooner when gates resolve; stop after two weeks with the exact deliverable/uncertainty status rather than expanding foundations indefinitely.

## Implementation batches and quality gates

1. **Contract and provenance, CPU only:** primary writes definitions/protocol; Luna builds source/seed inventory; Sol A maps observation seams; Sol B maps reusable search interfaces. G0 before scientific code choices are frozen.
2. **Observation implementation:** Sol A owns new `tools/lib/reset-observation*` and tests. Sol B builds manifest/archive scaffolding in distinct new files. Primary reviews boundary cases and intervention validity; Luna reconciles fixtures. G1 before biological interpretation.
3. **Current-rule probes:** Sol A owns lifecycle/contact modules; Sol B owns competition runner under primary-approved estimands. One GPU worker executes frozen batches. Fresh strong-model review checks identity and causal inference before launch and conclusions afterward. G2 controls search scope.
4. **Conditional discovery:** Sol B owns search and deterministic nomination; Sol A checks lifecycle integration. Luna accounts for proposals and archive completeness. G3 freezes candidates.
5. **Independent validation and synthesis:** Sol implements the reviewed analysis; Luna independently recounts data and hashes; primary plus fresh strong-model reviewer examine effect/uncertainty claims, missingness and alternative explanations. G4 and final decision.

Proposed new filenames are reservations, not implemented files. Prefer thin adapters around `tools/lib/foundation-local-flow.ts`, `foundation-material-flow.ts`, `foundation-copy-ancestry.ts`, serial-v2 receipt/parity/run modules, `packages/search/src/mapelites.ts`, and existing bootstrap/retest tooling. Reuse only after verifying the relevant assumptions; do not reuse the restrictive old separation certificate unchanged or retrofit old results.

Verification is proportional but substantive: pure boundary tests; actual reference-physics controls; CPU/GPU and instrumented/uninstrumented parity; conservation; source-drift, interrupted-run and same-input recovery failures; statistical null/effect/degeneracy checks; one end-to-end development rehearsal; then frozen scientific execution. Run the relevant tests per implementation batch and the complete applicable suite/typecheck at integration, without repeating unchanged broad suites after every small documentation edit. Mock runner tests validate orchestration, not GPU biology.

## Final deliverables and honest closure

- Entity contract and claim-to-rule map, including incompatibilities with prior prose.
- Calibrated observation/ancestry/lifecycle assays, meaningful tests and recorded limitations.
- Current-rule causal comparison report with independent units, effect sizes and uncertainty.
- Full discovery archive and independently validated nominees if the relevant gates permit execution.
- Immutable evidence index, source snapshot, seed/attempt ledger and resource/dispatch accounting. Ignored run artifacts require preservation beyond a jj bookmark; no archival cleanup may discard them.
- Final decision report: retain rules/new founders; targeted mechanism experiment; or precise unresolved bottleneck. Each phase is marked executed, failed, unavailable or not reached.
- Separate next-step implications for M4 amendment/calibration, M5 causal functions, M6 independent/device evidence and M7 collective reproduction. No milestone is silently redefined or claimed complete.

The first actionable batch after execution is requested is Phase 0 and the CPU-only observation specification. It is intentionally small enough to review before committing GPU time or changing the simulator.
