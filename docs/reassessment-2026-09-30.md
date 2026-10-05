# Reassessment draft — updated 2026-10-01 (first written 2026-09-30)

Status: **draft, decision open.** It pulls the parallel threads together so the next direction can be chosen once the pending results are in. Nothing here is registered, and it does not re-read M4 or the Variation gate as confirmatory. RULE_VERSION 1 is unchanged everywhere.

The question: what is the best route to evolution-like behaviour — founders, environment, physics, or a different unit of reproduction?

## 1. Where things stand

| Thread | Workspace / owner | State | What it says |
| --- | --- | --- | --- |
| M4 and foundations review | `main` | Closed | M4 fails endpoint 2 (neutral runs grow too). Gate = **Variation**. Founder diagnostic: 11 of 24 genomes count vs 1 of 12 founders. 10⁷ extension repeats the M4 result. Extension time-shift incomplete. |
| Foundational reset + Gate A | `evolution-foundations` (Codex) | Closed, awaiting decision | 135 of 200 sampled parent links fail the copy test, so tracker "parenthood" is not causal evidence. Gate A not passed (segmentation-dependent). Outcome: **measurement limitation**, not a negative result. |
| Ecology-first founder discovery | `main` (818987ff, 46941243) | Exploratory, A/B/C/S5 done | Drifted clouds do not beat point founders (1/12 vs 1/12). Non-producer sets count (S1 3/5; S5 5/5), with a sorting-of-standing-diversity caveat. Waste medium: 14 clusters, 0 obligate. Background medium: 1,476 confirmed, 33 clusters, **209 obligate in 12 clusters**, 144 of them in cluster 3. |
| Founder policy / improvement study | `founder-policy` (Codex) | **Running**, $0 | Randomized comparison stopped at the assay pilot (1/8 controls viable). Replaced by a fixed-founder study: 4 founders × 8 seeds × mutation on/off = 64 histories to 10⁶. ~10 of 64 done at 18:00; forecast ~Oct 3. |
| Scaffold sandbox | `sandbox/scaffold`, now on `main` | **Heredity demonstrated on a fresh design; R3 replicates on fresh histories; pond cycle integrated (row C, step 1)** | Pond-level life cycle (Black, Bourrat & Rainey 2020). Main run and R1–R4 ($4.87 of $20): R1 not demonstrated (0 of 6), R2 shown (6 of 6), R3 decisive at the threshold (swap criterion 4 of 6), R4 negative. R1′ (post hoc, earlier time and trait) 3 of 6. **Fresh pre-registered replication (R1″, 12 new histories, time-to-fixed-mass trait): demonstrated in `scaf` in 6 of 6** (ICC 0.09–0.59, p 0.001–0.036); both control gates passed (positive ICC 0.94 and 0.75; 0 of 4 null worlds significant); independently re-derived. Row 3 is superseded and the heredity-rule-variant recommendation is withdrawn. Caveats: `rand` is demonstrated in 6 of 6 too (ICC 0.26–0.78), so this shows heredity is present, not that the scaffold causes it; without covariates only 3 of 6 pass; in 3 histories the signal rests on a few donor families; the null calibration does not fully cover the evolved regime. **R3 replication (2026-10-01, v1's R3 unchanged on the fresh histories, AWS, $3.94): R3 replicates.** Advantage over `rand`, `cont` and the ancestor at both timings in 6 of 6 histories, swap criterion in 6 of 6 (4 needed); all 12 quenched controls 0; 62 of 62 sets screened clean; independently re-derived. Caveats: the swap criterion again passes only at the threshold (margins 0 to +2.5 fragments; i5 at exact equality) and its six tests share one ancestor fragment draw, so they are not independent; R2 is not replicated on fresh histories. **Integration (2026-10-01):** the pond cycle is now an ordinary preset plus condition in the shared stack, in three steps: I1 schema and runner (6cfd2a1a), I2 lab (b659418b), I3 archipelago (d7b08114), merged to `main` as 2841741e. Design: `docs/scaffold-integration-v1.md`. RULE_VERSION stays 1, the golden pins are unchanged, and the new `WorldConfig` keys (`pondPeriod`, `pondK`, `pondArm`) are absent from `defaultConfig()`. My independent review found no physics or pin problem, one stitching gap and one lab test gap, fixed in dbff0df1, 08501d05, 9d1cf0b9 and 591e379d (see section 5). |
| Planet / sun | `sandbox/planet` | Stage 1 done | Evolution found sun-following once in 3 runs, only because the sun's speed was matchable. Sensing followers track any speed but lose to blind drifters on a steady sun. On a wandering sun, drifters crash and take the world down with them; sensing survives. Single world ends in extinction. |

## 2. What the evidence supports

1. **Founder selection is a bottleneck, but not sufficient.** Broader genome pools count far more often than the chosen founders, and candidates the old gate rejected can work. M4 still failed with the best founders we had.
2. **Founder recipe matters more than founder noise.** Clouds of drifted founders did not help; sets without producers did (S1, S5). Part of that is sorting of standing diversity, so treat it as a lead.
3. **The unit of reproduction is unresolved.** Every role-origination readout uses tracker births. The reset shows those are not reliable evidence of reproducing entities, so founder and role results inherit that doubt.
4. **Simple strategies win in steady worlds.** The sun work shows blind drifting beating sensing until the world becomes unpredictable. Evolution-like behaviour needs structure that punishes the cheap strategy.
5. **Only one line defines its own unit.** The scaffold line imposes the life cycle (ponds, packets, cycles), so it does not depend on the entity measurement.

## 3. Candidate directions

**A. Scaffolding (the lead).** Heredity under the scaffold is demonstrated on a design fixed in advance (R1″ 6 of 6), and R3 replicates on fresh histories (6 of 6 on both criteria; `docs/scaffold-r3-replication-v1.md`). By the protocol's rule this reaches row C of the decision table: integrate the cycle into the runner and lab (done 2026-10-01, see section 1), then draft a registration for a confirmatory ensemble (drafted 2026-10-01 and frozen 2026-10-02 after the user approved it as written: `docs/scaffold-registration-v1.md`, 24 histories per arm; result 2026-10-03: H1 and H2 confirmed). Each is a separate dated decision. The registration draft's pilot found that the swap passes of protocol v1 and of the R3 replication rested mostly on their control's mutants: against a matched control, the genome-only gain is 1–8 fragments of 128, under half the advantage (post hoc note in `docs/scaffold-r3-replication-v1.md`; the recorded R3 result stands). An exploratory transition hunt beside it was approved by the user and frozen on 2026-10-02: `docs/scaffold-transition-hunt-v1.md`.
- For: it is the only line whose unit is defined by design, so it avoids the entity problem; R2 and R3 respond to pond-level selection; `scaf` ends with higher trait and fewer extinct ponds than `rand`.
- Against: `rand` shows heredity as strongly, so the scaffold's causal contribution is not shown; the R3 swap criterion passes only at the threshold on both sets of histories (and the six swap tests share one fragment draw), R2 is not replicated on fresh histories, and R4 is negative (the scaffold does not keep capability); the R1″ result is fragile without covariates; reproduction is imposed rather than inferred, against the project's "never declared" principle; one regime.

**B. Founders and mutation (bounded).** Let the improvement study say whether mutation improves capable starts.
- For: $0, already running, directly tests the founder lever.
- Against: its score rests on a competition assay validated only on four prepared founders; narrower than a founder policy.

**C. Entity measurement.** The contact-versus-sham assay from the reset hand-off.
- For: unblocks every non-scaffold claim; cheap compared with a new ensemble.
- Against: answers a narrower causal question than "is this an individual"; needs design before it can run.

**D. Physics change (RULE_VERSION 2).** Predation is the parked candidate; sun plus refuges is the other.
- For: adds new kinds of interaction and can change the attractor.
- Against: on hold until the entity question is answered; any change re-pins every golden hash.

## 4. Pending inputs and what each would change

| Input | Expected | If it goes one way | If it goes the other |
| --- | --- | --- | --- |
| Scaffold R3 replication (v1's R3 unchanged, on the 12 fresh histories extended to boundary 100, plus 6 fresh `cont` histories and a new ancestor source; AWS g5.xlarge, 101 commands) | **done 2026-10-01: R3 replicates** (101 of 101, 0 failed, $3.94 of the $10 stop) | Taken: row C. Separate dated decisions on integration, then a registration draft for a confirmatory scaffold ensemble | (R3 failing again would have meant imposed heredity only, and weight on D) |
| Improvement study, mutation on vs off | ~Oct 3 | Mutation helps from capable starts → founders are a real lever; widen to direction B | No effect → founders are not the lever; weight D |
| Entity assay (C) | not started | Tracker births pass → role results stand | They fail → founder and role readouts need restating |
| Sun tests: islands with migration, then mutation on | not started | Sensing evolves under refuges → a usable environment for D | No → drop the sun line |

## 4a. Heredity-rule variant ("genome retention in bodies"): resolved

Row 3 had recommended a rule variant as a separate dated decision. I checked first whether the data show genomes being lost across the pond cycle (read-only, from the main run's `ponds.tsv` and `lineages.tsv`; exploratory, not independently re-derived).

| Arm, boundaries | Packets | Packet's dominant lineage still the pond's top lineage one period later | Its share of the pond (mean) |
| --- | ---: | ---: | ---: |
| `scaf` 61–99 | 739 | 97% | 0.65 |
| `scaf` 11–60 | 319 | 95% | 0.61 |
| `rand` 61–99 | 685 | 43% | 0.29 (median 0) |
| `rand` 11–60 | 333 | 54% | 0.34 |

Packets are almost clonal (about 1.1 lineages, dominant share 0.99), and in `scaf` the packet's genome persists and dominates. That pointed to the post hoc saturation reading rather than a retention problem, and the fresh replication has since supported it: with a trait that does not saturate, `scaf` shows heredity in 6 of 6 histories without any rule change. **The variant recommendation is withdrawn (scaffold agent's disposition, 2026-10-01); no rule variant is needed for this result.** Limits of my table: the share is a lower bound (a mutant descendant has a new lineage id), `lineages.tsv` records only some boundaries, and genome loss inside bodies (the B = P = 0 clear) was not measured. The variance-floor point I relayed on the design is moot now that the replication passed.

## 5. Resources and risks

- **Spend so far against the $200 follow-up:** FX $8.02 and FX2 $0.99 (ecology B/C/S5); scaffold main run $4.87 (final, of the $20 stop); scaffold R3 replication $3.94 final (of the $10 stop, so the $1.12 margin and cohort reserve were not touched). The earlier review budgets (extension, tests, tests2) closed at $15.77, $18.21 and $23.12.
- **Mac GPU contention.** The improvement study, the sun tests and any local assay share one GPU. A second Mac (M3 Pro, `180471@192.168.1.19`, Deno and golden verified, about 2× the main Mac's throughput under contention) is set up and unused.
- **Pushed and unpushed.** `origin/main` is at 0e3104b8, which holds the ecology commits, the reassessment doc and the integration merge (2841741e). Local `main` (591e379d) is four commits ahead and unpushed: my review fixes dbff0df1 (stitching checks each recipient once per boundary), 08501d05 (a cached pond export is re-checked against the stitch rules), 9d1cf0b9 (the scaffold report readers refuse duplicated or missing recipients) and 591e379d (the lab e2e test restores and plays across cycles). The Astra review has not been run on the ecology commits.
- **Integration: checked and not checked.** Checked on a clean checkout of `main`: typecheck, the golden-pin test, the full vitest suite (60 files, 1,314 tests after my fixes), `mix test` (113 tests), the lab pond e2e under Chrome, and the coordinator integration script (island and stitch parity for pond runs). Not run by me: `deno run -A tests/deno/gpu_golden.ts` and the rest of the Playwright suite. Known gaps: the report-side recipient guard cannot see a cycle shortened by its last recipient or an absent cycle without the configured pond count; a failed upload midway through an island segment leaves partial objects, which are not served as accepted history (pre-existing, not fixed).
- **Sun sandbox touches physics and golden files.** It must stay a sandbox unless a RULE_VERSION bump is decided.

## 6. Not verified in this draft

- Founder-policy results beyond its protocol, plan entries and the start record.
- The full history of the planet/sun session (only its last ~400 of ~4,000 messages were read).
- The identity of the obligate cluster-3 genomes' roles: roles were not recorded in the background search.
- The scaffold readouts beyond the protocol and plan text, except R3's: I re-ran `scaffold-report.ts r3rep` into a scratch file and it matched the recorded `r3rep.json` (outcome, counts) apart from the protocol-hash field, which changed because the protocol doc was edited after the readout. I did not re-open `r1dprime.json` or the earlier readouts. The R3 numbers in this doc come from the protocol's Results section, not a fresh derivation.

## 7. Decision needed

The scaffold line leads. It has a pre-registered heredity result (R1″, 6 of 6) and now a replicated R3 (6 of 6 on both criteria, fresh histories, $3.94). By the protocol's rule that is row C: **integrate the pond cycle into the runner and lab (done: I1–I3 are on `main`), then draft a registration for a confirmatory scaffold ensemble (frozen 2026-10-02: `docs/scaffold-registration-v1.md`).** Its code and AWS draw followed; it ran on AWS on 2026-10-02/03 ($22.50) and **confirmed H1 and H2** (2026-10-03: `scaf` worlds found ponds better than every control, at withdrawal and 2 × 10⁵ steps later, and the evolved genome alone, on ancestral material, beats the ancestor's in 24 of 24 histories, by a small margin; the size criterion S1 is not confirmed; see `docs/plan.md`). An exploratory transition hunt (`docs/scaffold-transition-hunt-v1.md`) beside it was frozen on 2026-10-02 and passed its Stage 0 on 2026-10-03; its Stage 1 waits on a draw approval. The draft takes up the two points raised earlier: it tests the genome swap with an independent fragment draw per history, more replicates and a matched control (the swap criterion was at the threshold both times), and it replicates R2 on fresh histories as a secondary. Direction D (predation) stays the fallback if the confirmatory ensemble fails. In parallel, the improvement study (founders and mutation, ~Oct 3) and the entity assay remain open. Nothing here needs new paid compute until a confirmatory ensemble is costed.
