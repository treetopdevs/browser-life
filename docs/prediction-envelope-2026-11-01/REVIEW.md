# I02 review log

## Plan review dispositions

Reviewer: Codex gpt-6.1-sol, reasoning effort xhigh, read-only, 2026-11-01. Prompt: `/tmp/prediction-envelope-2026-11-01-plan-review.md`.
Raw output: `/tmp/prediction-envelope-2026-11-01-plan-review-raw.txt` (full session log); final message
`/tmp/prediction-envelope-2026-11-01-plan-review-final.txt`. 15 findings (7 P1, 8 P2, 0 P3). All accepted; PLAN.md revised (revision 2).

| # | Sev | Finding | Disposition |
|---|-----|---------|-------------|
| 1 | P1 | Brier on stated-direction probability is not a proper 3-class score | Fixed. Schema now carries `probs {up,down,none}` per-mille summing to 1000; multiclass Brier formula defined; direction derived by argmax with fixed tie order; no 0.5 floor; tests for uniform/perfect/confidently-wrong. |
| 2 | P1 | Proposer can pick an easier question / always-sham wins | Fixed. One frozen task tuple per case in the envelope; validator rejects any other intervention/readout/subject/time; exactly one prediction per case (file-level duplicate/missing check); abstain/invalid imputed with dev prior for headline Brier; accuracy at matched coverage. Experiment selection deferred. |
| 3 | P1 | Sham mapping contradicts runner (r=0 lesion hits centre; zero feed invalid; none not a ScheduledIntervention) | Fixed. Sham = no scheduled operation, explicit validator branch; radius-0/zero-feed excluded from menu; sham replay must equal control hash. |
| 4 | P1 | CPU intervention path/accounting unspecified | Fixed. Tool-local `CpuInterventionAdapter` mirroring the runner's private one; exact order, logs, deep clones per arm; matter and energy invariants checked separately; intervention at `C+delta`, delta>=1 per `propose.ts` strictly-after rule; fork-time counters carried, not re-baselined. |
| 5 | P1 | Readouts/mechanisms undefined; census lacks the fields; saturated-feed has no clamp | Fixed. Single world-level primary readout `livingCells` plus diagnostic `freeNutrient`, defined from state in `readouts.v1`, cross-checked against `census()`; `minEffect` per unit from dev seeds; births/regions deferred; saturated-feed fixture dropped; fixture labels are measured, mismatches reported. |
| 6 | P1 | Shuffled evidence can donate the same history's future | Fixed. Donors assigned by derangement of family ids within each split, frozen before exclusions/scoring; test that a later window of the same history is rejected. |
| 7 | P1 | Dropping cases by seed-flip uses outcomes; freeze order weak | Fixed. Qualification, `minEffect`, tuning and timing on reserved dev `qualify` subset only; everything frozen and hashed before test outcomes are generated; `--stage confirm` refuses on hash mismatch; no test case dropped, unstable ones kept as `measurementLimited` in the unfiltered denominator; amendments need fresh families. |
| 8 | P2 | Negative fixture/baseline assertions unprincipled; no positive control; majority baseline not necessarily bad | Fixed. Thresholds (>=0.8/<=0.34) removed; hand-derived confound truth table and a distinct naive `alwaysRising` predictor; added `priorMajority`, `alwaysNone`, and a dev-only `mechanismRule` positive control; stated that a calibrated majority is legitimately strong; diagnostics, not gates. |
| 9 | P2 | "Cost per useful experiment" is a yield | Fixed. Renamed `validNonNullYield`; `costPerUseful` = total cell-steps (nulls and failures included) / non-null cases; null on zero denominator. |
| 10 | P2 | Seed agreement mislabelled counterfactual agreement/ceiling | Fixed. Renamed cross-seed effect stability; two complete treated/control pairs; "ceiling" dropped; seed variants share family and split. |
| 11 | P2 | Intervals lack independent unit | Fixed. Family is the unit; whole-family bootstrap with stated count/seed; paired differences; intervals only if >=10 test families, else descriptive; bin/class denominators stated. |
| 12 | P2 | Twin equality does not prove observer neutrality | Fixed. Instrumented vs plain runs with independent clones, full-state hash equality through C+H; envelope construction mutation/alias tests. |
| 13 | P2 | Claims extension but builds a separate workflow; discovery format omitted | Fixed. Named integration points: additive `propose.ts` exports (hash-identity test), `fromRulesProposal` making the v0 rule proposer a scored baseline, discovery canonical-vs-metadata result convention; discovery runner explicitly not used and why. Scope cut to one endpoint. |
| 14 | P2 | Byte-reproducibility gate contradicts artifacts; inputs not captured | Fixed. Canonical set (envelopes, protocol snapshot, recipes, predictions, outcomes, comparison, report, `canonical.sha256`) separated from `meta.json`; diff excludes meta only; source-closure hash; size-overflow retention rule. |
| 15 | P2 | Gates do not typecheck tools or enforce runtime | Fixed. Added `tools/tsconfig.prediction.json` tsc run, `deno check`, spawned `--no-lock` CLI smoke test, explicit per-test timeouts, caps frozen after dev timing; wall time excluded from reproducibility checks. |

Residual risks noted: the 12-family count may give descriptive-only output (stated up front); fixture qualification may
drop whole mechanism types on dev (decided before freeze, reported).

## Source review dispositions

Stage FIX, 2026-11-01. Findings from the Sol 6.1 xhigh source review (`review-sol-src.txt`, reviewer "sol") and the Claude source
review (reviewer "claude"). All were assessed against the code; every one was a real defect or a worthwhile P3 and was fixed or
documented. Evidence column names the test or output that now pins the behaviour. Amendment 1 in PLAN.md records the spec
changes. The delivered run was regenerated (protocol re-frozen after the qualify-only change, `minEffect` 25) and is stamped
EXPLORATORY; nothing is committed.

| # | Sev | Finding | By | Disposition | Evidence |
|---|-----|---------|----|-------------|----------|
| 1 | P1 | Confirm does not require a committed freeze | sol | Fixed. `confirmRefusal` = `freezeRefusal` + `committedRefusal`: both files must exist in HEAD (`git show HEAD:`) and equal the working files, else refuse. `--exploratory yes` bypasses only the commit gate and stamps `status: EXPLORATORY` with a reason; already-inspected test families make the delivered run exploratory. | `prediction-cli.test.ts` gate test (uncommitted, not-in-HEAD, differs, ok); live run: `refusing to confirm: protocol.json is not committed`; `meta.json` status. |
| 2 | P2 | Empty predictions file passes validation | sol | Fixed. `validate` checks an empty submission as group `(empty file)` against all envelopes, so every case is missing and exit is 1. Exit also counts duplicates, not-object lines and unsound envelopes. | `prediction-cli.test.ts` "validate fails on an empty predictions file". |
| 3 | P2 | `Object.create(good)` / inherited probs validate but serialize empty | sol | Fixed. Plain-record check (Object.prototype or null prototype) on prediction, task and probs; required fields must be own; canonical round-trip stability check (rejects `toJSON`, undefined values). | `prediction-validate.test.ts` "serialization stability" (inherited object, inherited probs/task, toJSON, undefined reason, round trip). |
| 4 | P2 | Scoring discards file-level invalid/extra diagnostics | sol | Fixed. `Comparison.fileDiagnostics` per proposer (lines, invalid, missing, extra, duplicates, not-object, unsound envelopes), in `comparison.json`, `comparison.md` and the validate CLI. | `prediction-report.test.ts` (diagnostics reach the comparison; extra + duplicate counted). |
| 5 | P2 | Primary endpoint bodyMass vs PLAN livingCells; dangling EVIDENCE.md | sol, claude | Fixed by amendment: EVIDENCE.md written with the dev probe (livingCells feed effect 0 in 8 of 12 families), PLAN amendment 1, readouts.ts header now points at real text. | `EVIDENCE.md` Deviation 1; `PLAN.md` Amendment 1. |
| 6 | P2 | Qualification used all 12 dev families | sol, claude | Fixed. `qualificationReport` tallies and stability use the `qualify` subset only; `devEffects` (all dev) feeds the dev prior alone. Earlier all-dev tuning (picked 50) disclosed; rule re-applied to qualify data gives 25, frozen. | `qualification.json` (`qualifyFamilies`, `devEffects`); EVIDENCE.md Deviation 2. |
| 7 | P2 | Dev-only oracle ran on test cases and was shown | sol, claude | Fixed. `runProposers` takes an eligibility predicate (`devOnlyOracle`); the oracle is run on, serialized for and rendered for dev cases only; validate CLI validates it against dev envelopes. Test table already excluded it. | `prediction-report.test.ts` "dev-only oracle"; `fileDiagnostics.mechanismRule`: 72 lines. |
| 8 | P2 | Neutrality checked to C only, not through C+H | sol | Fixed. `twinCheck`: an independent instrumented, chunked continuation per arm (control and every treated arm) with the same schedule and observers on, final full-state hash must equal the plain arm. Cell-step accounting includes the twins. | `prediction-fixtures.test.ts` "observer neutrality bites". |
| 9 | P2 | Source-closure hash omitted executable dependencies | sol | Fixed. `closure.ts` computes the transitive local import closure (71 files from `predict.ts` and the model seam: schema, sim-ref, metrics, runner, report helper); `meta.json` hashes all of it. | `prediction-closure.test.ts`. |
| 10 | P2 | Cell-step budget checked after running; variants bypass | sol | Fixed. `assertFixtureBounds` and `plannedCellSteps` run first (in `generate` and `runFamily`); over-cap refuses before any simulation; runFamily asserts simulated == planned. | `prediction-fixtures.test.ts` "bounds and budget". |
| 11 | P2 | `report` always exits 1 | sol | Fixed. Implemented: `rerender` rebuilds `comparison.md`, `report.html`, `canonical.sha256` from the data files and refreshes the meta source hash. Markdown iterates sorted keys so a rebuild from canonical JSON is byte-identical. | `prediction-cli.test.ts` report test; `prediction-report.test.ts` rerender test. |
| 12 | P3 | Stored report.html / canonical.sha256 / meta stale | sol | Fixed by regeneration from final source (the confirm run in this pass). | `canonical.sha256` check; /tmp/pe2 second run diff. |
| 13 | P3 | Proposal-hash regression test never computes a hash | sol, claude | Fixed. Pins `bodySha256`, `proposalId`, `specHash` of a representative body/spec to values computed from the HEAD copy of `propose.ts` (identical to the modified file). | `prediction-proposers.test.ts` "hashes of existing v0 helpers". |
| 14 | P2 | numericTrend and shuffledEvidence degenerate (all "down") | claude | Fixed as a reported limit plus a test. `comparison.md` now computes and prints a degenerate-rows note and the per-proposer predicted-class table; EVIDENCE.md "Limits" states the run does not show the control separation. Test proves the two rules differ on an opposite-trend pair. The fixtures themselves were not changed (all worlds decline in mass; making them rise would be a new fixture design, deferred). | `prediction-proposers.test.ts` "opposite trends"; `comparison.md` notes. |
| 15 | P2 | Dangling EVIDENCE.md reference; no minEffect rationale | claude | Fixed with finding 5/6: rationale and the 21/24 vs 23/24 stability figures are in EVIDENCE.md. | EVIDENCE.md. |
| 16 | P2 | "instrumented equals plain" asserted only a counter; hash compare untested | claude | Fixed. Negative tests inject a perturbing observer (history and continuation endpoint) and a stub residual; both throw. Checked by mutation in a scratch edit: with the endpoint hash comparison disabled the continuation test fails (and `>` for `>=` fails the boundary test; matched-coverage over all proposers fails the abstainAll test); sources restored. | `prediction-fixtures.test.ts` "observer neutrality bites". |
| 17 | P2 | `labelOf` boundary untested/undeclared | claude | Fixed. Inclusive convention stated in code, PLAN amendment and EVIDENCE; tested at +/-minEffect and just inside. | `prediction-fixtures.test.ts` "labelOf boundary". |
| 18 | P3 | Zero-coverage exclusion from matched set untested | claude | Fixed. Test runs `tableFor` with `abstainAll` present and asserts matched-coverage accuracy is non-null for answering proposers. | `prediction-report.test.ts` "tableFor keeps the matched-coverage set non-empty". |
| 19 | P3 | validate never calls validateEnvelope | claude | Fixed. `validatePredictionFile` runs `validateEnvelope` once per envelope, counts `badEnvelopes`, scores their cases invalid; the CLI exits 1. | `prediction-validate.test.ts`; `prediction-cli.test.ts` tampered-envelope test. |
| 20 | P3 | `report` stub; unconditional "below 10 families" note | claude | Fixed: report implemented (finding 11); note now conditional per split on the family count. | `comparison.md` notes (no such line at 12 families). |
| 21 | P3 | Qualify subset deviation undocumented; PLAN gate cannot pass as written | claude | Fixed: deviation documented; PLAN gate corrected to exclude `dev` and `.gitignore`, run where the gitignored files exist. | PLAN Amendment 1; EVIDENCE.md Reproduction. |
| 22 | P3 | Two tests do not exercise their named code; confound absent from data | claude | Fixed. `compare().trendConfound` logic extracted as `trendConfoundOf` and tested on a synthetic rising set; propose.ts pin (finding 13); EVIDENCE.md and `comparison.md` state that the real fixtures never rise (0/144), so they cannot show the confound. | `prediction-fixtures.test.ts` "trendConfoundOf"; comparison.md notes. |

## Follow-up review of the fixes

Reviewer: Codex gpt-6.1-sol, xhigh, read-only, 2026-11-01. Prompt `/tmp/pe-fixes-review-prompt.md`; session log `review-sol-fixes.txt`,
final message `review-sol-fixes-final.txt`. Verdict on the 22 rows: 18 CLOSED, 4 PARTIAL (rows 3, 9, 14, 22) and three new P2s.
Rows 14 and 22 are PARTIAL by design (the delivered fixtures never rise, so the real data cannot separate numericTrend from its
shuffled control or show the before/after confound; both are disclosed limits, with synthetic tests, not fixture redesign).

| # | Sev | Finding | Disposition | Evidence |
|---|-----|---------|-------------|----------|
| F1 | P2 | Non-enumerable own required fields (and hidden probs) validate but disappear in JSON | Fixed (also closes row 3). `plainData` requires every property, recursively, to be an own enumerable data property (no getters, symbols, hidden fields); the prediction is then judged on its JSON snapshot, not live objects. | `prediction-validate.test.ts` "own but hidden from JSON (non-enumerable), and getters". |
| F2 | P2 | Closure hash ignored Deno's resolution config and npm pins (also row 9) | Fixed. The hash now includes `deno.json`, `package.json`, `tsconfig.json` and the sorted external-specifier list (`fflate`, `node:*`), alongside the 73 closure files. Full dependency-graph resolution through Deno itself was not built: the import-map text and the `npm:fflate@0.8.3` pin are hashed, which is what decides resolution. | `prediction-closure.test.ts` "sourceClosureHash". |
| F3 | P2 | `report` overwrote the generation provenance hash | Fixed. `meta.sourceClosureSha256` is preserved; the renderer's hash goes to `meta.reportRenderedFromCanonicalData.sourceClosureSha256`. | `prediction-cli.test.ts` "report keeps the generation source hash". |

After these edits the delivered run was regenerated from the final source (`confirm --exploratory yes`, twice, `v0` and `/tmp/pe3`):
all eight `canonical.sha256` digests verify, `diff -r --exclude=meta.json --exclude=dev --exclude=.gitignore` is empty, the two
source hashes are equal, and `validate` on `predictions.jsonl` exits 0 (`mechanismRule` 72 lines, 0 missing). No second
follow-up review was run for these three small fixes; each has its own test.

## Second follow-up review (F1-F3 and the rising cohort)

Reviewer: Codex gpt-6.1-sol, xhigh, read-only, 2026-11-01, on `30abb614`. Prompt `/tmp/pe-r2-prompt.md`; session log `review-sol-cohort.txt`.
An earlier pass of the same review was cut off by a tool kill before its final message; it had already found the duplicate-ID
and stale-count items below, which were fixed in `30abb614`. The restarted review (finished) gave: F1 CLOSED, F2 CLOSED, F3 CLOSED, no P1, one P2, two P3.

| # | Sev | Finding | Disposition |
|---|-----|---------|-------------|
| G1 | P2 | `splitPlanOf` per-cohort splitting let a family id repeated across cohorts escape the global uniqueness check (rename f24 to f00) (first pass) | Fixed in `30abb614`: duplicate ids across all families are refused; test "a family id repeated across cohorts is refused". |
| G2 | P3 | Two stale counts in EVIDENCE.md (12 test families; 8 of 144 measurement-limited) (first pass) | Fixed in `30abb614`. |
| G3 | P2 | `numericTrendUpWherePairedNone` did not require the before/after rule to say up, so it was not the documented three-way conjunction | Fixed: the counter now requires all three; test "numericTrendOnNull counts the three-way conjunction only" (sham with before 200, treated = control 100 gives 0). The delivered 14 cases satisfy all three (reviewer verified); v0 regenerated. |
| G4 | P3 | "64 null-effect cases" overstated: two low-dose cases (f10, f22) measure up | Fixed: wording is "intended-null" with 62 of 64 measured none, in output.ts and EVIDENCE.md. |
| G5 | P3 | Reproduction steps checked a v0 directory lacking the gitignored files | Fixed: generate into a scratch dir, verify and diff the digests there. |

CodeRabbit threads on 07d7b4a8 (seven, all Minor) were fixed in `30abb614`: bounds kind/where pairing, step-0 sampling filter,
rerender keeps proposers with no lines, serialization stability compares the original input, gitDirty covers resolver config,
heaviest/emptiest test asserts the properties, and the reproduction steps start from the frozen protocol.
