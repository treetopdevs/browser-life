# Foundational reset, trimmed: do entities reproduce, or do genomes spread?

Date: 2026-09-29. Status: authorized for execution; protocol revision incorporates the review corrections below. No scientific reset runs have started. The earlier expanded proposal is preserved as `foundational-reset-expanded-plan-2026-09-29.md`. This replaces the expanded draft with its first three phases and decision table, and incorporates the main line's results. Work in `/Users/nicholas/develop/browser-life-foundations`, jj workspace `evolution-foundations`, bookmark `codex/evolution-foundations`. Do not edit the main checkout (`/Users/nicholas/develop/browser-life`); its `docs/plan.md` is the single decision record, and the main session records this work's outcome there as a dated entry.

## The one question

The foundations review's gate decided **Variation** (main checkout, `docs/plan.md`, "Gate results", 2026-09-29), and its written next move is RULE_VERSION 2 aimed at variation. Before that is built, answer this: **are the tracker's births entities reproducing, genomes spreading through shared material, or a combination?** The answer informs whether and how to change the rules, together with the founder and functional evidence:

- *Entities reproduce*: credible transmission and reconstruction remove one inheritance concern. Preserve the historical Variation verdict, but combine this evidence with the founder diagnostic and functional-variation evidence before choosing a mechanism; this does not automatically justify duplication or modules.
- *Genome takeover is observed*: investigate whether it disrupts entity transmission. Genome spread and entity reproduction can coexist. Evidence of takeover alone does not establish exclusively replicator-level evolution or that organism-level selection cannot use variation. A demonstrated transmission limitation motivates a narrow inheritance comparison; the main plan records any change of target separately.
- *Both processes are resolved*: report their coexistence and test whether mixing disrupts transmission; mixed biology is not itself a detector failure.
- *Unresolved*: identify whether the limitation is observation, coverage or precision; resolve the specific gap before selecting a rule change.

Success means a defensible answer with its uncertainty, not a positive result. Keep the Codex draft's six separate claims (persistence; genome spread; separately viable descendant; reconstructed organisation that repeats; heritable differences changing descendant success; new functions or collectives). This work targets claims 3–5 and measures 1–2.

The north-star commitment stands: no `Organism` class and no `reproduce()`. Assays may observe and may transfer material by intervention, but never feed observer identities or parent labels into the dynamics. A found or constructed reproducer is a feasibility control, not evidence of spontaneous origin.

## Evidence to carry forward

From the main checkout (results in `experiments/foundations/*.json`, working files in `runs/foundations/results/`; definitions in `docs/plan.md`, "Operational definitions"):

- **Test 1 checked genomes, not entities.** A link is a tracker attribution: a fission, or a budding, meaning a birth credited to the nearest same-lineage individual, alive before that census, less than 24 cells away in the same tile (`packages/runner/src/observe.ts`). 148 of the 200 links are clonal, so the parent–offspring slopes (0.85, 0.96 and 0.90) mostly show that identical genomes grown in one garden behave alike. Viable three-generation chains were found in 10 of 10 histories, under the same attribution.
- **Test 5:** the replays' evolved lineages keep survival and light dependence (0.956) but lose regeneration (0.168, against the founders' 0.979).
- **M4 held-out result:** no compartmentalised individual was detected in any treatment run (a few neutral runs show 0.002). Test 6 shows the detector flags hand-built membrane rims (10 of 10) and not rimless discs (0 of 10), so the zeros are not a simple detector failure. It does not show the detector would catch every evolved morphology.
- **Test 4b:** Inconclusive at the gate, but late lineages beat early ones by far more than the margin in the early state in all 10 histories, and mean fitness favours them in both states in all 10. Descriptively, competitive gains accumulate at some level.
- **Tests 2 and 3:** heritable role change is rare (1 founder of 12 in each), in uniform light and in a gradient garden alike.
- **Test 6:** none of the four activity, novelty and role measures passes its null checks. Shadow excess is miscalibrated in opposite directions on the two presets.
- **Still running in the main line, finishing 2026-09-29 and handed over when done:** the founder diagnostic (24 other genomes through test 3's harness; its reading is fixed in `docs/plan.md`), the 10⁷ extension's registered analysis, and the extension time-shift (does test 4b's gain accumulate from 10⁶ to 10⁷ steps?).

From this workspace, per the Codex draft: `docs/foundations-next-results.md` (six mutation nominees; four founder-2/7 nominees that change role shares); the transfer pilot (substantial new bound matter incorporated, transmission unresolved); and the observation that genome-copy ancestry, material transport and tracker identity can disagree. The last is the motivation here.

## Team

The primary Codex agent owns definitions, thresholds, inference and sign-off. It has at most one implementer (`gpt-6-sol`) and a fresh strongest-model adversarial review at gates G1 and G2. Luna-style inventory work is folded into the implementer's brief. Only the primary edits protocol and threshold definitions. There is one GPU worker at a time.

## Phase 0: evidence, seeds and the entity contract (CPU only, about 2 days)

1. Pin inputs: this workspace's prior revision `062bba36758509e50f891c14542bb13726fdeb48`; the main checkout's revision plus exact relevant working-file hashes at the time of starting (a branch ref alone does not pin uncommitted code); and the replay bundles and checkpoints listed below. Record rule, schema, metrics and config identities.
2. Audit seeds before reserving any. Taken:
   - M3: 1,000,001–1,000,210; 2,000,001–2,000,050; 3,000,001+; 5,000,001–5,000,007.
   - M4 and its pilots: 1–20, 1,001–1,020 and 101–105 with 1,101–1,110 for the extension.
   - The foundations review: 4,000,001–4,599,999, all of it.

   Also audit all foundations-workspace ledgers, including the 620/640/650-million namespaces and untouched 700-million confirmation reservation; the list above is not exhaustive. Reserve disjoint development and validation ranges (search is deferred); label the clearance local unless coordinator allocations are checked.
3. Claim-to-code map: transport and the genome lottery, genome copying, mutation (in `react`, at synthesis), synthesis and decay, polymer permeability, controller actions, the tracker's identity, fission and budding rules (`packages/metrics`, `packages/runner/src/observe.ts`).
4. Entity contract: physical support, boundary, identity through motion and contact, birth, death, fusion, viability, developmental age, generation, descendant contribution. State what aggregated material accounting cannot identify.
5. Competing explanations, and which comparisons tell them apart: observer limitation; genome invasion through transport; inheritance and mixing mismatch; ecological incentives against reproduction; founder bias.
6. Literature, one day at most: Griesemer (replicators versus reproducers), Godfrey-Smith (marginal versus paradigm Darwinian populations: bottlenecks, reproductive specialisation, integration), life-cycle bottlenecks (Grosberg and Strathmann), and one or two experimental-evolution papers on life cycles.

**Gate G0:** the primary approves a coherent contract and source map; unresolved definitions become explicit "unavailable" outcomes. No endpoint rests only on tracker IDs, shared genotype, growth or role labels.

## Phase 1: make reproduction observable without programming it (about 2 days)

Keep the Codex draft's Phase 1 in full:
- Detect a birth from continuous causal ancestry and a separation criterion fixed in advance, and only then score survival, reconstruction and further reproduction. Failed offspring stay in the denominator.
- Handle budding, symmetric fission, torus crossing, pre-existing neighbours, temporary contact, fusion, flicker across a mass threshold, unrelated identical genotypes and a genome won with a minority of the material. Ambiguous is a valid class.
- Instrumentation draws no extra physical random numbers and keeps bitwise physical parity; test it against uninstrumented runs, CPU and GPU.
- Three control layers: scripted event records (detector logic only), executed reference-physics worlds (observations track real processes), and natural development versus separately reserved validation worlds.
- Freeze separation duration, observation cadence, minimum viable support and generation horizon on development inputs only.

**Gate G1:** every declared deterministic case passes, parity holds, and ambiguous natural events are kept. Otherwise stop with a measurement diagnosis.

## Phase 2: what do the current rules preserve and select? (about 3 days)

**Probe A, first and cheapest: re-examine test 1's own links.** The 200 links in the main checkout's `runs/foundations/results/t1-pairs.json` come from the treatment replays `runs/replay-m4/gradient-m3/treatment/seed-{1..10}`. Those replays are byte-identical to M4 and checkpointed every 10⁵ steps, so segments rerun exactly. For each link, rerun under the original configuration, including original mutation settings, from an authenticated checkpoint before the event through a fixed post-event window. Verify physical and observer agreement against the original outputs at available checkpoints/censuses; do not claim full-state authentication from summary equality alone. Resolve source-version compatibility before any run.

Record separate dimensions before assigning interpretations:
- **Genome descent:** continuous copy linkage from the attributed parent, including actual mutation transitions and effective versus clamped/no-change proposals.
- **Material continuity:** bounds on material carried by the parent at trace start, material synthesized subsequently along traced paths, material from other existing bound sources, and unresolved attribution.
- **Separation:** supported physical separation, no separation, or ambiguous.
- **Subsequent function:** survival, informative organization reconstruction and further reproduction, each separately available or unavailable.

A checkpoint restores state, not its unrecorded ancestry. Never equate material carried by a parent at trace start with material historically built by that parent. Replay farther back only under a prospectively recorded scope/budget rule; otherwise retain unknown provenance. Aggregated mixed reactions support bounds or an explicitly conventional tracer, not invented exact ownership.

Resource uptake from dissolved environmental matter is not genome invasion. Distinguish takeover of already-existing bound material from new synthesis and transmission. A propagule may later mix or undergo replacement, so propagule/invasion labels need not be exclusive. Freeze any majority threshold and sensitivity range on development controls before inspecting classified historical events.

Report all 200 links, including ambiguity, per history and pooled descriptively, clonal/mutant and fission/budding separately. Quantify uncertainty at the independent-history level (ten histories), not by treating 200 links as independent. The sampled-link audit addresses the existing attribution claim, not the prevalence of all natural reproduction.

Add a small fixed continuous-window audit, selected independently of tracker births before viewing its outcomes, to seek missed events. It is a separate bounded sensitivity check, not a precise estimate of universal detector recall. Before execution, freeze exact window selection, horizon, trace coverage, event criteria, missingness handling and cost in a source-bound manifest.

**Probe B: identity through contact.** Same-genotype labelled controls, and different-genotype contact against sham separation: copy ancestry, support continuity, genome takeover.

**Replay strategy refinement, before any scientific run:** prefer one instrumented pass from step 0 per source history, serving all sampled links and fixed continuous observation windows, if the exact instrumentation benchmark fits the remaining resource caps. This maximizes temporal provenance coverage and avoids repeated overlapping segments. It does not resolve material ownership discarded by mixed reactions, nor does founder-level ancestry alone identify immediate parents. Keep provenance state on-device where feasible and retain compact per-event evidence instead of per-cell/per-step dumps. An uninstrumented throughput estimate is not an instrumented cost estimate; benchmark lane concurrency, memory, readback and storage on the intended device before quoting cloud cost. Authenticated checkpoint segments remain a bounded fallback with explicitly left-censored provenance, never an equivalent full-ancestry claim.

Thresholds are developed on constructed controls and, where needed, separate development histories. Unsampled births from the same ten histories can be used for declared retrospective development, but are not independent holdout events simply because their IDs differ from the 200. Record all such exposure and freeze thresholds before applying them to the fixed links; report the resulting audit as retrospective. A later independent scientific claim needs independent validation histories. Add the main session's SHA-256 manifest and `runs/foundations/results/validate.json` to the pinned evidence, and reconcile the independently generated hashes before scientific execution. Validation of two output files does not establish full historical state equivalence; verify the available physical checkpoint hashes separately.

**Probe C: does a life cycle repeat?** Natural linked births in uninterrupted worlds, and separately a serial-transfer assay whose packet rule, transfer fraction and window are frozen before execution. Transfers are interventions and never satisfy the natural endpoint.

**Probe D: is organisation rebuilt?** At least one informative non-mass trait at a fixed developmental age, in newly built structure rather than carried over.

**Probe E: do inherited differences change success?** Only if probes A and C give interpretable descendants. Use matched focal and competitor genotypes, reciprocal labels and positions, solo controls, and descendant contribution at a fixed horizon, reported separately from genome share and biomass.

Probe A always preserves historical mutation settings. Constructed Probe B controls may start with mutation off; before generalizing those controls, add a frozen mutation-on probe including clamped proposals. Mutation-off replays are explicitly separate counterfactuals, never evidence about the original Test 1 events.

**Gate G2 has two exits.** (a) A repeatable current-rule life cycle and an interpretable fitness assay: the full founder search may be designed next. (b) No positive, but trustworthy measurement: a separately designed capped feasibility search may be proposed next; it is not executed under this trimmed plan. Any future discovered positive must return through Phase 2 and G2(a), including mutation-enabled ancestry and interpretable fitness, before broader search. A demonstrated mechanism limitation yields a rule-comparison proposal, not proof of impossibility. An assay failure never justifies a rule change.

## Deferred until G2

Deferred until G2's exit is known:
- Phase 3, the three-cohort founder search (broad viable, repeated-life-cycle, partner-dependent).
- Phase 4, the validation matrix, whose size gets costed from Phase 2's benchmarks.

The main line's founder diagnostic reading feeds Phase 3's design.

## Decision table (from the Codex draft, unchanged in substance)

| Evidence | Decision |
|---|---|
| Detector fails, ancestry unresolved or trait uninformative | Repair measurement; infer nothing about reproduction; do not search |
| Probe A supports propagules, and life cycles repeat | Retain rules as baseline; combine the founder diagnostic and functional-variation evidence before selecting a targeted change. The historical Variation verdict is preserved, not promoted to proof that genome expansion is necessary |
| Genome spread succeeds while entity transmission fails under resolved contact assays | Propose one narrowly specified inheritance or compartment alternative as RULE_VERSION 2's target (a dated decision in the main plan) |
| Reproduction is feasible but selected against in the target ecology | Test a specific ecological incentive or trade-off before adding genome capacity |
| Reliable transmission, but useful variation poorly accessible | Compare mutation scale, regulation or duplication, with a causal hypothesis and matched search effort |
| No positive within a bounded search, mechanism unresolved | Report uncertainty and the explored region; a finite failure proves nothing impossible |

A rule variant is a separate experiment. It specifies one mechanism, conservation and arithmetic bounds, CPU/GPU parity, new rule and config identities, and golden pins. Where possible, it crosses old and new rules with old and new founders (the main plan budgets a 2×2 for this).

## Resources, timebox and stop rules

- *Local caps.* Eight GPU-hours, twelve assay/calibration CPU wall-hours, and 20 GiB new outputs, including incomplete attempts and retries. Benchmark instrumentation overhead before forecasting. No required matrix is silently shortened after outcomes; insufficient resources yield an explicit incomplete result. Prospective reallocation dated2026-09-29, before scientific outcomes: one GPU-hour calibration/development, six Probe A, half an hour conditional B–E, and half an hour reserve. This replaces the initial2/4/1/1 allocation within the unchanged eight-hour total. Completed common-observer timing projects3.89hours for ten histories, and measured per-step windows add roughly six minutes; final integrated benchmark and independent review must still pass before launch. Charge the first bounded development tranche conservatively at180seconds, including its controls and benchmark invocations; subsequent development and retries are recorded separately. Ordinary test time is reported separately.
- *Implementation memory boundary.* Freeze512MiB for active continuous-window copy-label arrays, separately from GPU buffers and report metadata. Reaching this resource cap stops the affected attempt as technically incomplete, preserving the triggering raw flag and pending descriptors. It is never a candidate-skipping rule or a negative biological outcome.
- *Compute.* Local GPU for development and fixtures. Paid execution is conditional on reconciling the actual remaining allocation and coordination with the main session, rather than assuming a budget note alone establishes availability. AWS allocation comes from the main plan's follow-up budget ($200, dated 2026-09-29): up to $30, drawn from its $120 cohort reserve. The main session records the draw as a dated note before any paid run. Benchmark the exact assay before forecasting. The instances and supervisor pattern are in the main checkout (`runs/foundations/ops/`); coordinate with the main session before using them.
- *Timebox.* G0 by 2026-10-01; G1 by 2026-10-03; G2 and a decision report by 2026-10-07. That leaves the review's time box (2026-10-19) for choosing and specifying RULE_VERSION 2. If a gate slips, stop with the exact status rather than expanding.
- *Stop rules* (from the Codex draft): source drift, parity or conservation failure, invalid controls or low disk stop the affected work. Technical retries repeat identical inputs, at most twice, and never replace unfavourable biology. Partial runs are preserved, and a cap breach or incomplete sample is not success.
- *Reviews.* A fresh strongest-model adversarial review before G1's freeze, and before and after Probe A.

## Deliverables

- The entity contract and claim-to-code map.
- Calibrated observation and ancestry instrumentation, with its tests and recorded limitations.
- Probe A's classification of test 1's 200 links, and the Phase 2 report with independent units, effect sizes and uncertainty.
- An immutable evidence index and seed ledger.
- A one-page decision (which row of the table above, and why) for the main session to record in the main checkout's `docs/plan.md`.

## Execution order and closure

1. Primary freezes this corrected scope, source/input manifest and entity contract; Sol implements only bounded observation/replay tooling in owned new files. Main checkout remains read-only.
2. Calibrate constructed controls and exact parity, benchmark the instrumented replay, and obtain fresh strongest-model review before G1 freeze and Probe A launch. `reset-probe-a-protocol.md` specifies the bounded observational endpoints: numeric local copy attribution, sampled connectivity and descendant-associated support persistence. These do not by themselves certify reproduction; material origin and stronger function claims may remain unavailable. Freeze that specification and its controls before applying it to the 200 links.
3. Execute the frozen 200-link audit and separately fixed missed-event windows if they fit the measured caps. Preserve technical failures and partial results without substituting links. If tracing cannot satisfy the scientific question within the cap, report that limitation rather than classifying links from proxies.
4. Review Probe A before committing to B–E. Execute only a prospectively specified probe that resolves a remaining decision-relevant uncertainty and fits the remaining budget; all unexecuted probes receive an explicit reason. Repeatable reproduction, assisted transfer, organizational reconstruction and heritable fitness remain separate endpoints.
5. Produce source-bound results, evidence/attempt/seed/resource ledgers and a one-page handoff decision. Preserve the original verdict and frozen preregistration. This workflow can finish with a precise gated limitation, but may not describe unexecuted phases as completed experiments.

No rule change, broad founder search, fresh M4 ensemble or automated recurring work is authorized by this trimmed execution. The completion report and decision handoff live in this workspace; the main session owns edits to its decision record. Existing agents are reused with at most one active Sol implementer and a separate strongest-model reviewer at designated gates; no Luna worker is needed.
