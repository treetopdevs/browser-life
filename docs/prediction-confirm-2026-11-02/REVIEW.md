
## Plan review dispositions

Reviewer: Codex gpt-6.1-sol, xhigh, read-only, 2026-11-02. Prompt: `review-sol-plan-prompt.md`; raw output: `review-sol-plan.txt` (also /tmp/prediction-confirm-plan-review-final.txt). PLAN.md revised; section numbers refer to the revised plan.

| # | Sev | Finding | Disposition |
|---|-----|---------|-------------|
| 1 | P1 | Existing gate cannot enforce the amendment freeze; confirm ignores `--protocol`, hard-coded FREEZE | Accepted. Section 4.2: gate also requires committed amendment, clean tools/packages/experiments closure, empty out dir, and every read routed through `--protocol/--freeze`; unit and CLI tests (section 7). |
| 2 | P1 | Pre-freeze smoke/timing/disjointness test could consume the held-out families | Accepted. Section 3: size fixed from v0 meta.json timings; no generate/smoke/dev on the new families before the freeze; disjointness by identity without simulation. |
| 3 | P1 | POSITIVE possible from rules that never read evidence (v0Rules, fixedRule) | Accepted. Section 5.3: `numericTrend` is the only primary rule; others descriptive. |
| 4 | P1 | No multiplicity rule across candidate rules | Accepted via a single nominated primary rule with a conjunction of two comparisons (5.3). |
| 5 | P2 | Shuffled-control differences are donor-coupled, not independent families | Accepted as a stated limitation (5.3); POSITIVE additionally needs the prior comparison, which is uncoupled. Bootstrap code unchanged by scope. |
| 6 | P2 | Degenerate override ambiguous and contradicts negative fixture | Accepted. 5.4a defines per-rule scope, comparator exemptions, zero-answered and precedence; test fixtures reconciled (section 7). |
| 7 | P2 | NEGATIVE from a noisy nonnegative point estimate; null intervals undefined | Accepted. NEGATIVE needs an interval wholly above 0; null/non-finite/incomplete pairing force UNINFORMATIVE; test added. |
| 8 | P2 | "Identity fields only" exempts recipe changes; mix shifts to 37.5% rising | Accepted. Recipe tuples checked against v0 cycle from committed file; mix set to 15+5 (25% rising); transfer of devPrior/minEffect and weights registered in the amendment (section 2). |
| 9 | P2 | History-disjointness test names a nonexistent field; ids embed family id | Accepted. Disjointness by (seed, light, nutrient, founders) and variant seeds against protocol.json and recipes.jsonl (section 3). |
| 10 | P2 | Artifacts cannot reproduce or seal the reading | Accepted. Committed `ledger.jsonl` plus `confirm.sha256` over decision and ledger; output.ts/rerender plumbing listed (section 6). |
| 11 | P2 | Gates cannot run in order; omit analysis, tools typecheck, base-protocol diff | Accepted. Split into 8a pre-run and 8b post-delivery; `deno check`, `confirm-analysis`, base protocol diff added. |
| 12 | P2 | Attempt/replay policy permits overwrite and reuse of seen families | Accepted. First run is the attempt of record, no overwrite, replays to /tmp, rerun on changed code needs new amendment and new disjoint families (section 4). |

No findings were rejected. Unresolved by design: the donor-coupled dependence of comparison (A) is disclosed, not corrected.

## Source review dispositions

Stage FIX, 2026-11-02. Sources: `sol` = Codex gpt-6.1-sol xhigh read-only (`review-sol-src.txt`), `claude` = the author's own pass. Nothing of the fresh families had been simulated at the time of the fixes, so the amendment text (not yet committed) was extended in place with the provenance paragraph in section 4. Code lives in `tools/lib/prediction/confirm.ts`, `tools/predict.ts`, `tools/lib/prediction/report-html.ts`; tests in `tools/test/prediction-confirm.test.ts`.

| # | Sev | Reviewer | Finding | Disposition | Evidence |
|---|-----|----------|---------|-------------|----------|
| 1 | P1 | sol | Missing families silently disappear from the ledger | Fixed. `expectedCases(p)` derives the case inventory from the protocol; `coverageProblems` compares envelopes, outcome rows and test rows to it; `buildLedger` throws. `confirm-analysis` also verifies `canonical.sha256` for the six data files (`digestProblems`) before analysis. | Tests "case inventory ... buildLedger rejects a run with a family removed" and "canonical.sha256 is checked" |
| 2 | P1 | sol | `confirm-analysis` trusts `meta.status`; a default v0 confirm run reads CONFIRM | Fixed. `provenanceProblems` requires a confirm-stage CONFIRM run with amendment provenance, clean start, snapshot equal to the reserved recipe, and HEAD copies of amendment, protocol and freeze matching the hashes. Failure sets document status `UNVERIFIED` (override, `provenanceProblems` field in `confirmation.json`); the banner claim appears only for CONFIRM. | Tests "CONFIRM status needs amended-run provenance", "buildConfirmation withholds CONFIRM ..." |
| 3 | P1 | sol | smoke with the confirm protocol bypasses all gates | Fixed. Any run that is not the amended confirm run refuses a protocol with the reserved salt or a reserved seed (or a seed that is a variant of one), so renamed snapshots are refused too. | CLI test "smoke, dev and an unamended confirm refuse the reserved confirmation identities" |
| 4 | P2 | sol | Banner CSS changes v0 `report.html` bytes | Fixed. CSS emitted only with a confirmation. | Notebook test compares the plain stylesheet to the committed `v0/report.html` |
| 5 | P2 | sol | `gitDirty` sampled after output write | Fixed. Status, HEAD and closure hash are captured before generation and before any write. | `dirtyAtStart` in `predict.ts` (the amended gate and meta use the same sample) |
| 6 | P2 | claude | smoke on the confirm protocol | Same fix as 3, covered by the same test. | as 3 |
| 7 | P3 | claude | Test titled "uncommitted amendment" never exercised it | Fixed. Added a real file with no HEAD copy; asserts "amendment is not committed". The temp-git-repo test of `committedText` itself is deferred: the CLI case covers its null path, and a positive-path check needs a commit in a scratch repo for little extra assurance. | CLI test "real but uncommitted amendment" |
| 8 | P3 | claude | "each override fires" did not isolate the non-finite override | Fixed. NaN probabilities with 12 families: every override that fires is the null-or-not-finite one. | Reading test |
| 9 | P3 | claude | Notebook ordering by failures untested; sort counted all proposers | Fixed. In confirmation mode cases sort by `numericTrend` failure first (the cases the section lists), then all-proposer failures. Test checks every failed numericTrend test case precedes every correct one. | Notebook test |
| 10 | P3 | claude | Dev baseline line and dev table could read as evidence | Fixed. Confirmation mode drops the "strongest baseline on dev" line and labels the dev table "split machinery only; no role in any decision". | Notebook test |

Follow-up review of the fixes (`review-sol-fixes.txt`, Codex gpt-6.1-sol xhigh):

| # | Sev | Finding | Disposition | Evidence |
|---|-----|---------|-------------|----------|
| F1 | P1 | The reserved-seed guard checked `seed - offset`, but qualification variants are generated at `seed + offset` | Fixed. The guard now checks seed, seed + offset and seed - offset against every reserved seed. | Regression in the smoke CLI test: base 5999 with offset 1, and 5001 with offset 1000 |
| F2 | P3 | CLI test title claimed dev and unamended-confirm coverage | Fixed by retitling. Dev and the unamended confirm read only v0's fixed protocol file (dev rejects `--protocol` outright, tested earlier), so smoke is the only stage that can be handed a reserved protocol; no guard injection point exists to test. | Test title |

## Result review (2026-11-02)

Codex gpt-6.1-sol xhigh read-only (`review-sol-result.txt`). No P1/P2 and no flaw in the run; ledger scores, both intervals, digests and the source closure at the freeze commit reproduce, and NEGATIVE follows from rule 4b. Two P3 reporting findings, both fixed in `RESULT.md` only (outcome files and reading untouched): the full list of 73 failures is now in RESULT.md; the "operation kind alone" wording is limited to `v0Rules` and `fixedRule`. Unprovable from artifacts alone: that no other attempt occurred (attested; none was made).

## Implementation review findings 2 and 3 (dispositions added 2026-11-02, after the run, in answer to PR review)

These are findings 2 and 3 of `review-sol-impl.txt` (not the numbered source-review table above). They were not dispositioned before the freeze; stated here without changing any outcome file.

- Impl 2 (P2, a clean HEAD does not bind execution to the freeze commit's code): accepted limitation, not enforced by the gate. The gate checks the three frozen documents, a clean closure and an empty output directory, so changed code committed later would still pass it. What bounds this run: `meta.json` records `gitSha` 1a69e9e8 (the freeze commit), `gitDirty: false` and `sourceClosureSha256` 7dc7f9b9...; the post-run Codex review (`review-sol-result.txt`) recomputed that closure over 74 source files and found it equal to the freeze commit. Binding by a frozen closure digest would have needed a new amendment and was not done.
- Impl 3 (P2, untracked or ignored executable files can escape the gate): `closureStatus` inherited `status.showUntrackedFiles`. Fixed after the run by passing `--untracked-files=all` (tools/predict.ts); this is a gate-hardening change only and touches no scoring, outcome or reading. For the run itself the same Codex closure recomputation found no divergence from the freeze commit. Ignored files inside the closure are still not checked; accepted limitation.
