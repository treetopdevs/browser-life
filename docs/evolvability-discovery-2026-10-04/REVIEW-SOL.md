# Sol review of the document set (raw)

2026-10-04 · `gpt-6.1-sol`, reasoning effort high, read-only sandbox, Codex CLI 0.160.0 · session `01a10695-cce3-7be3-a91f-9300aa65a0c5`

This is the reviewer's final message, unedited. It reviewed the six documents as first synthesized, before the repairs listed in the [council record](COUNCIL.md). Its absolute paths point at the checkout it ran in.

---

PARTIAL — most of the 33 rulings are faithfully applied, but the set is not execution-ready.  
Stage 1 has a precise specification once D2 is resolved; Stage 3 still requires consequential guesses.  
The checked arithmetic agrees with the sources; acceptance gates and several evidence claims need repair.

**P0: None found.**

**P1 — Running the predictive test unlocks use even if the prediction fails.**  
[PRD.md:11](/Users/nicholas/develop/browser-life/.claude/worktrees/codex-astra-critique-b22475/docs/evolvability-discovery-2026-10-04/PRD.md:11), S8 at line 32, and PLAN lines 85 and 181 require respectively “run,” “tested,” or merely “specified, priced and frozen.” None defines a successful predictive-validation outcome. A completed negative or inconclusive test therefore satisfies the written condition for selecting worlds or claiming prediction. This weakens COUNCIL’s predictive-bridge disposition. **Smallest repair:** distinguish permission to conduct the bridge from permission to rely on its result; freeze a pass criterion and explicitly block predictive use after failure, invalidity or inconclusive evidence.

**P1 — Imported renewal artifacts cannot satisfy the blanket discovery replay policy.**  
[PLAN.md:75](/Users/nicholas/develop/browser-life/.claude/worktrees/codex-astra-critique-b22475/docs/evolvability-discovery-2026-10-04/PLAN.md:75) requires importing renewal artifacts without repeating the experiment. DESIGN lines 183, 203 and 236 require matching verification policy and replaying every initial case on another physical host. The authoritative renewal plan instead prescribes CPU/GPU replays of two designated pilot trajectories, plus independent readout auditing of every case (`RENEWAL-PLAN.md:159–161`). Most imported histories lack discovery’s required replay coverage. **Smallest repair:** define a distinct imported-evidence acceptance class carrying the original audit and replay coverage. Preserve full cross-host replay for new discovery cases, and never label imported renewal evidence as fully discovery-replayed.

**P2 — Campaign and case hashing lack an implementable dependency order.**  
[DESIGN.md:165](/Users/nicholas/develop/browser-life/.claude/worktrees/codex-astra-critique-b22475/docs/evolvability-discovery-2026-10-04/DESIGN.md:165) puts `orderedCaseIds` in the manifest; line 169 puts `campaignDigest` inside each case; line 181 hashes that case. If `campaignDigest` hashes the complete manifest, these definitions are circular. Neither its exact input nor the canonical serialization is specified. Stage 3 cannot produce interoperable identities without choosing an unstated convention. **Smallest repair:** define a campaign-core digest excluding derived case IDs, hash cases against that core, then hash the completed manifest; specify canonical byte encoding and shared fixtures.

**P2 — Stage 3’s supposedly fixed acceptance campaign and bounded default are unresolved.**  
[PLAN.md:77](/Users/nicholas/develop/browser-life/.claude/worktrees/codex-astra-critique-b22475/docs/evolvability-discovery-2026-10-04/PLAN.md:77) names a “fixed 12-case engineering campaign” without defining its cases, inputs, schedules or expected outcomes. COUNCIL lines 72 and 79 permit proceeding on D4’s default, but “a bounded local pilot” supplies no numeric runtime or storage limits. PRD O6 and PLAN line 207 require those limits and retry caps. **Smallest repair:** make Stage 0 deliver a reviewed engineering manifest and explicit initial concurrency, runtime, storage and retry caps before Stage 3 execution.

**P2 — Two documents claim the required review is recorded while its record says pending.**  
[README.md:44](/Users/nicholas/develop/browser-life/.claude/worktrees/codex-astra-critique-b22475/docs/evolvability-discovery-2026-10-04/README.md:44) and PLAN line 24 say the Sol review is recorded in COUNCIL. COUNCIL line 86 contains only a pending notice, with no report or dispositions. **Smallest repair:** say “pending” until the actual review artifact, reviewed-input identity and finding dispositions are recorded. This response does not update that record.

**P2 — Stage 5 permits a population-structure change that DESIGN postpones until Stage 8.**  
[DESIGN.md:34](/Users/nicholas/develop/browser-life/.claude/worktrees/codex-astra-critique-b22475/docs/evolvability-discovery-2026-10-04/DESIGN.md:34) says population structure is not varied before Stage 8. PLAN line 136 directs changing habitat size during Stage 5 if sensitivity is inadequate. That also changes the regime in which renewal was demonstrated. **Smallest repair:** explicitly permit a separately frozen Stage 5 size/sensitivity study and require renewal qualification in the changed habitat before competitive inference.

**P2 — The density evidence is reported more conclusively than its control supports.**  
[RESEARCH.md:55](/Users/nicholas/develop/browser-life/.claude/worktrees/codex-astra-critique-b22475/docs/evolvability-discovery-2026-10-04/RESEARCH.md:55) calls the result “a founding-density threshold, not interdependence”; DESIGN line 104 repeats that interpretation. `docs/plan.md:912` explicitly cautions that ×4 biomass also raises seeded energy, so the intervention does not isolate density. One representative also remains unrescued. **Smallest repair:** describe rescue by increased B/E inoculum, retain the exception, and say dependence on another lineage’s products was not established.

**P2 — The scaffold evidence does not establish superiority over rate-constant changes.**  
[RESEARCH.md:54](/Users/nicholas/develop/browser-life/.claude/worktrees/codex-astra-critique-b22475/docs/evolvability-discovery-2026-10-04/RESEARCH.md:54) says population structure changes outcomes “more than any rate constant has.” The cited scaffold results establish differences among life-cycle treatments under one physics (`docs/plan.md:681–690`), not a matched comparison against parameter interventions. **Smallest repair:** retain the demonstrated scaffold effect and remove the unsupported cross-intervention ranking.

**P2 — README retains the categorical search dismissal that Astra rejected.**  
[README.md:34](/Users/nicholas/develop/browser-life/.claude/worktrees/codex-astra-critique-b22475/docs/evolvability-discovery-2026-10-04/README.md:34) says three campaign blocks “cannot separate two search methods.” REVIEW-ASTRA explicitly preserves practical comparison and limits the objection to the three-pair sign test; DESIGN line 140 and PLAN line 159 agree. **Smallest repair:** say three pairs cannot produce a one-sided sign-test result below `p=0.125`, while permitting a bounded descriptive comparison.

**P2 — Energy-route accounting is described as energy-origin attribution.**  
[DESIGN.md:81](/Users/nicholas/develop/browser-life/.claude/worktrees/codex-astra-critique-b22475/docs/evolvability-discovery-2026-10-04/DESIGN.md:81) says the listed measurements show whether synthesis ran on locally harvested light. RESP can release energy from initial or imported B, and DECOMP from initial or imported C (`step.ts:452–472`). E traffic, endpoint inventory and reaction totals do not uniquely attribute that energy’s origin. **Smallest repair:** describe these as dependency measurements and bounds; reserve local-light attribution for additional chemical-inventory/transport accounting or a controlled intervention.

**P3 — A carried-over stage reference points at selection instead of search.**  
[PLAN.md:161](/Users/nicholas/develop/browser-life/.claude/worktrees/codex-astra-critique-b22475/docs/evolvability-discovery-2026-10-04/PLAN.md:161) requires pricing the search shortlist test “before starting Stage 5.” Search is now Stage 6. **Smallest repair:** change that reference to Stage 6.

**P3 — Budget formulas can count replay twice.**  
[PLAN.md:73](/Users/nicholas/develop/browser-life/.claude/worktrees/codex-astra-critique-b22475/docs/evolvability-discovery-2026-10-04/PLAN.md:73) benchmarks complete cases with replay included; DESIGN line 133 uses that definition, but line 135 and PLAN line 205 multiply measured case cost by a replay multiplier again. **Smallest repair:** report primary-execution and replay costs separately, or use the replay-inclusive logical-case cost without another multiplier.

**P3 — Authoritative construction links are broken in this checkout.**  
[PLAN.md:26](/Users/nicholas/develop/browser-life/.claude/worktrees/codex-astra-critique-b22475/docs/evolvability-discovery-2026-10-04/PLAN.md:26), DESIGN line 56 and RESEARCH line 80 use `../../../browser-life-construction/...`. Here those resolve beneath `.claude/worktrees/browser-life-construction/`, which does not exist. **Smallest repair:** use the authoritative absolute workspace paths, or document a worktree-independent resolution convention.

What I did not check:

- Simulations, tests, timings, observer overhead, throughput or storage measurements.
- Independent reconstruction of historical raw scientific trajectories.
- External literature, licensing metadata, live deployments, host availability or current cloud prices.

The transport formula/table, gate expression, witness energy inequality, stated workload arithmetic, override allowlist, `evaluateBatch` mutation setting, preset nutrient values and pond coupling agreed with the inspected sources. No files changed.