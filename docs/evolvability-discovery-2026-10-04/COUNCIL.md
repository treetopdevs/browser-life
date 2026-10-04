# Council record

Council held 2026-10-04. This file replaces the unsent council packet of the first proposal, which is preserved in commit `7a96fd7`. It records who reviewed what, how each disagreement was settled, what is still open, and which decisions are the user's. The user took two of those decisions the same day; they are recorded under [Decisions for the user](#decisions-for-the-user).

## Participants and inputs

| Step | Who | Input | Output |
|---|---|---|---|
| Proposal | `gpt-6-astra` (Codex) | Working tree at `5f73fac`, recorded in [BASELINE.json](BASELINE.json) | README, RESEARCH, PRD, DESIGN, PLAN, COUNCIL and BASELINE.json in commit `7a96fd7`. Their SHA-256 values are in the addendum's provenance table |
| Critique | Claude Fable 5.1 (`claude-fable-5-1`), session `c7c46545-1fcd-4a81-9a30-695683f6331c` | Those seven files | [ADDENDUM.md](ADDENDUM.md), SHA-256 `d67a25f7ad3ee8934f5d6572fa6193db541fd55126b320cf49c4e486b1930a19` before its errata section |
| Review of the critique | `gpt-6-astra`, reasoning effort high, read-only sandbox, Codex CLI 0.160.0, session `01a10681-10f2-7dd0-a437-0d98e2899b32` | The addendum at that hash | [REVIEW-ASTRA.md](REVIEW-ASTRA.md), unedited |
| Synthesis | Claude Fable 5.1, same session | All of the above | This document set |
| Phase-boundary review | `gpt-6.1-sol`, reasoning effort high, read-only sandbox | This document set as first synthesized | [REVIEW-SOL.md](REVIEW-SOL.md), session `01a10695-cce3-7be3-a91f-9300aa65a0c5` |
| Follow-up on the repairs | `gpt-6.1-sol`, reasoning effort high, read-only sandbox, session `01a1069f-0e2d-7962-add8-95b8408a3ee3` | The set after the first repairs | [REVIEW-SOL-FOLLOWUP.md](REVIEW-SOL-FOLLOWUP.md) |
| Decisions D1 and D2 | The user | The set after both reviews | The stage order and ownership now in PLAN, applied by Claude Fable 5.1 in the same session |
| Review of the decision edits | `gpt-6.1-sol`, reasoning effort high, read-only sandbox, Codex CLI 0.160.0, session `01a106e7-0e86-7391-b94f-0d261ec08433` | The working tree after those edits, an exact diff of them, and the two repairs the follow-up left unreviewed | [REVIEW-SOL-DECISIONS.md](REVIEW-SOL-DECISIONS.md) |

Two notes on roles. The packet asked for Fable 5; Fable 5.1 answered. Repository policy names Sol 6.1 High for Codex reviews. The Astra review was run because the user asked for it by name and Astra wrote the proposal; the Sol reviews are the ones the policy requires.

## How disagreements were settled

Where Astra's review contested a fact in the addendum, the cited source was checked. Astra was right on every contested fact: the registered presets' 32 nutrient per cell, the free-energy export of the B64 probe, the stored-energy counterexample to the isolated-cell estimate, `mutRate` 0 in the batch evaluator, the coupling of pond tiles, the opposite turnover results in the two wound screens, and the proposal's existing block-counting rule. Those corrections are listed as errata at the end of the addendum.

Where the two sides differed on judgment, the document set follows the evidence each could point to and records the rest as unresolved. Nothing was settled by labelling it consensus.

## Dispositions

"Astra" is the ruling in its review. "Final" is what the document set does.

| Addendum item | Astra | Final | Where |
|---|---|---|---|
| P1-1, renewal behind infrastructure | Accept with change | Adopted. Renewal tooling and the experiment wait for no infrastructure and stay in the construction workspace under one owner. Since D1 the workbench is built in parallel with them. The cost is stated as four work packages, not half an hour | PLAN Stages 1–2 |
| P1-2, small worlds with flow off | Accept with change | Adopted as a limit of the domain. The 40 and 136 figures cap threshold-qualified sites, not population; the drift claim is dropped. A sensitivity analysis replaces the population floor | RESEARCH arithmetic; PRD S11; PLAN Stage 5 |
| P1-3, axes change survival only | Refute | Refuted as stated: rate constants are a legitimate first axis. Kept: factors are separated, and the evolutionary stages draw on factors with prior evidence | DESIGN 1; PLAN Stage 8 |
| P1-4, no predictive validation | Accept with change | Adopted as a prospective predictive bridge. The proposal's withheld validation is acknowledged | PRD S8; DESIGN 3; PLAN Stage 8 |
| P1-5, search cannot answer; enumerate | Accept with change | The search comparison is optional and declares its estimand. Factorial is the default. Enumeration only inside a measured cap | DESIGN 3; PLAN Stage 6 |
| P2-1 part 1, threshold tied to `kCatHalf` | Accept with change | A secondary readout. The primary threshold is unchanged | DESIGN 2 |
| P2-1 part 2, off-source clause | Refute | Refuted. Connected adjacent renewal is admissible and `spread` 0 rows are intended diagnostics. Extent is reported as a secondary readout; descriptor dependence is measured (U2) | DESIGN 2 |
| P2-1 part 3, transport bands | Accept with change | Band fixtures kept. The claim that the B64 probe equals the `spread` 0 probe is withdrawn; no probe is dropped | RESEARCH arithmetic; PLAN Stage 1 |
| P2-1 part 4, imported energy | Accept with change | An energy-dependence readout. Not a false positive for connected renewal | DESIGN 2 |
| P2-2, seed policy | Refute | Refuted: the proposal already counts shared-seed arms as one block. Kept: a mutation-on protocol states its inferential unit and whether mutation draws are paired | DESIGN 4 |
| P2-3, founder fit | Accept with change | Claims limited to the disclosed panel; held-out founders in confirmation | PRD S9; PLAN Stage 4a |
| P2-4, seeds with mutation off | Accept with change | Founder and habitat coverage added. Seeds stay | PLAN Stage 4a |
| P2-5, infrastructure size | Accept with change | The local core first, with the validator and a separate research root. The council left the plane for a later decision; the user's D1 builds it directly after the core. No "one Mac-day" trigger | PRD operational table; DESIGN 5–6; PLAN Stages 3a and 3b |
| P2-6, missing local evidence | Accept with change | Added, with each line's limits | RESEARCH |
| P3, ablation cases in the search budget | Accept with change | They are causal controls. The search protocol may move them to calibration and shortlist validation | PLAN Stage 6 |
| P3, external activity measures | Accept with change | Not imported; the note does not condemn redesigned measures | RESEARCH |
| P3, replay is not independent evidence | Accept | Already in the design; exports label replays | DESIGN 7 |
| P3, baseline and document commits | Accept with change | Both are provenance and both are recorded above | This file |
| Experiment 1, renewal standalone | Accept with change | Stages 1–2 | PLAN |
| Experiment 2, conditioned field | Accept with change | Stage 4b, with conservation-defined controls and an inoculum control. A failed hand design or a negative screen proves no impossibility | DESIGN 2; PLAN Stage 4b |
| Experiment 3, retrodiction gate | Refute | Withdrawn. Historical contrasts are calibration and an applicability audit; "unsupported" is not evidence | DESIGN 3 |
| A different unit of search | Accept with change | A design option for Stage 8, after candidate, replicate, transfer unit, endpoint and cost are defined | PLAN Stage 8 |
| Suggested order | Accept with change | The stage table, as reordered by D1 | PLAN |

The addendum's answers to the packet's ten questions were ruled on individually in Astra's review, part (c). Eight stand with the changes above. Two are unresolved and appear as U1 and U2.

What Astra's review added that neither earlier document had: the two conservation-defined controls for a conditioned field and the rules against smuggling resources; the distinction between fixed-table and across-panel estimands for a search comparison; the integrated energy inequality; the obligate characterisation as a warning that inoculum size can mimic dependence; the real cost structure of time-shift and scaffold assays; and the observation that no document names a renewal owner.

## Unresolved

| ID | Question | What settles it |
|---|---|---|
| U1 | Should total matter or `kPhoto` replace the coupled diffusion axis in the first map? | The renewal accounting, read before the Stage 4a freeze |
| U2 | Do the map's descriptors carry more than one useful dimension, and how many distinct values do they take? | Stage 4a's data |
| U3 | Does renewal exist in the witness family? | Stage 2 |
| U4 | At `spread` ≥ 1, does a source above the export threshold persist only when neighbours send mass back? | Stage 1 fixtures and Stage 2 accounting |
| U5 | What does a complete case cost with the observer, serialization and replay? | The Stage 3 benchmark |
| U6 | Does a capability score predict which worlds evolve useful inherited gains? | The Stage 8 bridge |
| U7 | Can existing queue primitives be reused without coupling discovery state to registered experiments? | Implementation inspection at Stage 3b |
| U8 | Is mutation-accessible functional diversity possible with the fixed reaction menu? | Stage 5; present evidence is insufficient to choose a replacement chemistry |

## Decisions for the user

Each has a default. The user took D1 and D2 on 2026-10-04, in these words: "go with the one owner in the construction workstream and I want the workbench now so we can fan out compute for the science." "The workbench" is read as including the distributed plane, since the plane is what fans compute out. That reading was put to the user, who let it stand and asked for these edits to be committed. The other five proceed on their defaults unless the user says otherwise.

| ID | Decision | Default | Status |
|---|---|---|---|
| D1 | Is the immediate deliverable scientific diagnosis or the distributed contributor product? | Scientific diagnosis first. The plane's acceptance criteria stay in the PRD as pending | **Decided, against the default.** The workbench is built now, the distributed plane included, to fan out compute for the science. The plane moves from Stage 7 to Stage 3b |
| D2 | Who owns the renewal implementation, and which construction revision is authoritative? | One owner in the construction workstream, on the reviewed revision named in the renewal plan or a documented descendant | **Decided: the default.** The owning session and the exact revision are recorded here when Stage 1 starts |
| D3 | Is the later target autonomous local ecology, imposed pond life cycles, or both? | Separate tracks. Pond results are methodological evidence; imposed reproduction is not counted as autonomous | Open |
| D4 | What local runtime, storage and cloud budget is acceptable? | A bounded local pilot first and cloud at zero. Proposed initial caps are in PLAN Stage 0. No enumeration until the cost with the observer is known | Open. Due before the plane takes a scientific campaign; the cloud allowance is zero until then |
| D5 | How is the unlanded ablation dependency integrated? | Pinned construction execution for Stages 1–2. Before Stage 3 needs it in `main`, a minimal reviewed extraction that leaves rule-2 work isolated | Open. Due when the renewal-observer adapter is built |
| D6 | Which second physical host, and which browser and CLI routes, satisfy the PRD? | Choose before Stage 3a's two-host check. Two processes on one machine do not count | Open. Due first: both the shard check and the plane's demonstration need the second host |
| D7 | When may new laws be considered? | After a specific, controlled bottleneck result; not after a failed hand design or a finite negative search | Open |

What D1 changes: the plane is built directly after the workbench core passes its engineering gate, and it is the intended route for scientific campaigns from Stage 4 on. A campaign that is ready before the plane passes its own gate may still run by shards over the same manifest. What it leaves alone: the renewal experiment's place, owner and protocol; every scientific gate; one case identity, validator and reducer on both paths, with shards kept as the reference and the fallback; the isolation of research jobs from the registered and public queue; and a cloud allowance of zero. Building in parallel has one consequence the council's order did not have: the workbench is proven first on the engineering campaign with code in `main`, and the renewal observer, the pricing benchmark and the calibration imports join when Stages 1 and 2 deliver them (PLAN Stage 3a).

## Sol review

`gpt-6.1-sol`, reasoning effort high, read-only, session `01a10695-cce3-7be3-a91f-9300aa65a0c5`, on the six documents as first synthesized. The raw text is in [REVIEW-SOL.md](REVIEW-SOL.md). Its verdict was partial: most rulings were applied faithfully and the arithmetic agreed with the sources, but the set was not ready to execute. It found no P0. The synthesizer gave each finding the repair below; these are author dispositions, and the follow-up, not this table, says which are closed:

| Finding | Repair | Where |
|---|---|---|
| P1: running the predictive test unlocked use of the map even if the prediction failed | The bridge freezes a pass criterion. A failed, invalid or inconclusive test blocks predictive use. Running the bridge needs only that it is specified, priced and frozen | PRD problem statement, S8 and gates; DESIGN 3; PLAN Stage 8; README |
| P1: imported renewal artifacts cannot meet the every-case replay policy | An imported-evidence acceptance class that carries the original audit and replay coverage and is never labelled as discovery-replayed | DESIGN 7; PLAN Stage 3 |
| P2: campaign and case hashing were circular | Campaign-core digest, then case IDs, then the manifest digest; canonical bytes named; shared test vectors | DESIGN 4 |
| P2: the engineering campaign and the default caps were undefined | Stage 0 delivers a reviewed twelve-case manifest and proposed initial caps | PLAN Stage 0; D4 |
| P2: two documents said this review was recorded while it was pending | This section | README; this file |
| P2: Stage 5 allowed a habitat change that the design postponed | A separately frozen size study, with renewal shown again in the changed habitat | PLAN Stage 5; DESIGN 1 |
| P2: the density evidence was stated too strongly | The fourfold inoculum raised energy too, one genome was not rescued, and dependence on another lineage was not established | RESEARCH; DESIGN 2 |
| P2: the scaffold effect was ranked above rate constants without a matched comparison | Ranking removed | RESEARCH |
| P2: README kept a categorical dismissal of the search comparison | Reworded to the sign-test limit | README |
| P2: the energy readout was described as attributing the energy's origin | Described as dependency measurements and bounds | DESIGN 2 |
| P3: a stale stage reference | Fixed | PLAN Stage 6 |
| P3: budgets could count replay twice | Primary and replay costs are benchmarked separately | PLAN Stage 3; DESIGN 3 |
| P3: construction links do not resolve from a nested worktree | Convention documented | README |

Three further inconsistencies found in the synthesizer's own read-through were fixed at the same time: the Stage 4a execution maximum was labelled Stage 4, Stage 4b did not name its dependence on D5, and the two opportunity tests (Stage 4b and Stage 8) were not distinguished.

**Follow-up.** A second Sol session (`01a1069f-0e2d-7962-add8-95b8408a3ee3`, raw text in [REVIEW-SOL-FOLLOWUP.md](REVIEW-SOL-FOLLOWUP.md)) checked those repairs. It found twelve of the thirteen closed and one partly closed, found no new conflict with Astra's rulings or with the renewal plan, and raised one new P2.

| Follow-up item | Repair after the follow-up | Reviewed again? |
|---|---|---|
| Hashing, partly closed: the list of fields excluded from the campaign core was open-ended, and the typed-array encoding was unspecified | The exclusion list is now exactly `orderedCaseIds` and `proposalBatches`; typed arrays are little-endian hex at the declared element width; wide counters are decimal strings; the test vectors must exercise both (DESIGN 4) | Yes, by the third session: closed at the level of the documents |
| New P2: the record attributed a review of the repairs to the first Sol session, and README claimed a follow-up that was not yet recorded | The first session's input is limited to the first synthesis; the follow-up is recorded as its own step; the repairs are labelled author dispositions | Yes, by the third session: closed |

**Review of the decision edits.** A third Sol session (`01a106e7-0e86-7391-b94f-0d261ec08433`, raw text in [REVIEW-SOL-DECISIONS.md](REVIEW-SOL-DECISIONS.md)) reviewed the edits that apply D1 and D2, before the set was committed. Its verdict was ready after repairs: no P0, one P1, two P2. It found the user's answer recorded accurately and nothing decided beyond it, the scientific gates intact, the engineering part of Stage 3a buildable from `main` alone, the shard fallback compatible with the decision, and both repairs in the table above closed. The synthesizer gave its three findings these repairs, which are author dispositions and have not been reviewed again:

| Finding | Repair | Where |
|---|---|---|
| P1: Stage 1 needed all of Stage 0, whose gate now included the engineering manifest and caps, so the renewal work waited on workbench preparation | Stage 0 is not one gate. Stage 1 needs the recorded owner and revision, and the seed check before its freeze; the manifest and caps gate Stage 3a alone | PLAN stage table and Stage 0 |
| P2: the increments list put the calibration battery before the plane, which made the plane wait for the renewal result | The core proven on the engineering campaign is increment 2, the plane 3, and the calibration battery 4, joining when Stages 1 and 2 deliver | PLAN review and release gates |
| P2: this record said the plane comes before the first campaigns and that Stage 4 campaigns are submitted through it, which overstated the commitment | The plane is the intended route from Stage 4 on, and the shard fallback is stated | The paragraph on what D1 changes, above |

So the state of review is: Astra's rulings applied and confirmed by Sol; all thirteen findings of the first Sol review confirmed closed by Sol; the decision edits reviewed by Sol; and the three repairs in the table above unreviewed.
