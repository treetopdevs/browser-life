# Stage 0 v4 harness repair — 2026-10-25

Implemented the [v4 proposal](TRACKER-REPAIR-v4-PROPOSAL.md). This is an evidence/reporting repair. Physics, the existing tracker, independent 25/50-step updates, lesion selector, original targets, default configuration, rule version, golden pins, frozen criteria and original results are unchanged. No simulation was rerun and no fresh world was generated.

## Behavior

`branch-diagnostic.ts` separates physical-state parity, observer parity at the same cadence, and retained-component agreement across cadences. Complete grids, initial remnant evidence, overlap-derived continuity and row/history consistency are prerequisites to scoring. Missing or contradictory evidence is a technical error; physical or same-cadence observer mismatch produces an unscored technical failure (`T=null`). The same census label having two masses in the same physical snapshot is also a technical inconsistency.

A complete, physically matching but cadence-discordant branch records all shared disagreement offsets, initial retained identities/masses, per-grid split/merge/loss history, `CADENCE-DISAGREEMENT`, `T=2025`, `cleanRecovery=false`, and **Stage0=TECHNICAL-STOP**. No lost ID is reacquired. Matching final nulls or final failure bits do not erase an earlier disagreement. Sham remains a separate uninjured endpoint, not a clean-lesion success.

The native entry point now identifies itself as `recovery-severity-stage0-v4`. Before stopping, `finishBranch` writes the checksummed branch record, independently rereads it, and only then raises the stop. This occurs before a replay or subsequent arm can execute. The ordinary failure marker points to that record. Partial publication or independent-reader rejection also prevents progress. The shared budget and final-publication accounting safeguards remain in force.

## Independent reading

`branch-record.ts` authenticates the original case against the frozen engineering inventory, its bindings to the input evidence and grown state, source snapshots, selected prescription, three traces and grown/post/final checkpoints. It measures immediate injury from the saved grown/post states. Its separate reduction derives the endpoint and Stage 0 verdict from ordered evidence; it does not call the runtime diagnostic builder or runtime return-time helper. Initial retained mass is measured from the saved post checkpoint, and every retained history row must meet the existing 128 eligibility threshold (null labels must have zero mass). The overlap validator also verifies split flags, in addition to retained labels, loss, fusion and final outcome summaries.

`read-stage0.ts OUT --branch BRANCH-diagnostic.json` reads failed branch evidence without requiring a successful attempt and always reports `globalStage0Pass=false`. Ordinary successful-attempt reading rejects failure markers, unsupported manifest versions, saved-only reanalysis, missing/duplicate branches, inconsistent branch/root bindings and a branch diagnostic that does not independently pass. Global acceptance independently rechecks exact first-pair replays and unique settled budget accounting, including final result bytes. Primary trace and replay paths cannot alias, and initial retained mass is bound to checkpoint contents. The audit reuses the reader's resolved debit so equivalent relative and absolute output paths have identical meaning. Existing v1 recovery results are not routed through or rewritten by this reader.

## Offline verification

A portable, lossless compressed fixture contains the original authenticated pair 2 mutant mass-targeted traces, case and checkpoints, plus their origin inventory. Tests can run without the gitignored source bundle, a GPU or a simulation backend. They exercise the real runtime publication seam and the independent reader.

The saved record retains:

- Physical agreement at all 41 shared observations and CPU25/GPU25 observer agreement.
- First cadence disagreement at offset 100; all disagreements at 100, 150, 200, 250, 300 and 350.
- Fast-view split at 150, incoming overlap at 250 and loss at 400; slow-view loss at 100.
- `T=2025`, no clean recovery and **TECHNICAL-STOP**.

Additional regressions cover clean agreement; individually recovered split daughters; transient disagreement despite matching final labels; one/both tracks lost; missing, duplicate or reordered observations; physical and same-cadence observer mismatch; contradictory split/merge flags and trace rows; forged verdicts with recomputed outer digests; altered inputs, provenance, versions or original cases; and partial publication. Existing filesystem regressions continue to cover failed budget debits and damaged artifacts.

The separate `reanalyse-stage0-v4.ts` utility copies and authenticates old saved evidence into a new, budgeted **saved-evidence-only** bundle. It never imports the GPU implementation, requests a device, advances a simulation, resumes an arm or chooses new interventions. Origin hashes and the saved prescription are independently checked against the old audit. Such a projection is a reporting verification, not a v4 engineering execution or Stage 0 pass. The old attempt remains untouched.

## Scope still blocked

The cadence disagreement remains a failed engineering gate. Pair 2 mutant sham remains unexecuted. No native end-to-end v4 execution is claimed. These repairs do not authorize an empirical retry, replace a seed, relax the shared-identity rule, enlarge the cap or launch fresh scientific pairs.

## Recorded validation

- **52 focused regressions passed**, including the portable saved pair, negative integrity/continuity/publication cases and independent replay/budget gates.
- All **45 retained v2 histories** were reread offline and agree with continuity reconstruction.
- Deno and repository TypeScript checks passed. Filesystem budget/publication, artifact-tamper and v4 reader regressions passed.
- [Saved-only v4 verification](V4-SAVED-VERIFICATION.json) independently reports TECHNICAL-STOP, first disagreement 100, T=2025, clean=false and globalStage0Pass=false.
- Reusing the projection output directory was refused without another budget debit.

The retained projection is `runs/recovery-severity/stage0-v4-saved-reanalysis`. Its manifest and branch record identify it as **saved-trace-reanalysis**, not native execution. Creation charged 78 ms and 3,053,136 actual retained bytes; with existing settlement reserves, the shared ledger now charges **990,829 ms and 97,460,885 bytes**, still below the unchanged caps. No cap was reset or enlarged. No original trace or case was rewritten.

Read-only Sol 6.1 High review identified independent-reader replay/accounting, trusted-origin, eligible-history, replay-alias, initial-mass binding and canonical-path issues. Each received a focused regression and a repair. The [final targeted read-only Sol 6.1 High review](V4-REVIEW.md) found no consequential defects in the fixes and confirmed that the saved case retains its frozen stop. Review was static; no native v4 execution is claimed.

## Landing notes (2026-11-17)

Ported unchanged onto main `b1d463f0` from the unlanded Stage 0 checkout; no experiment, GPU run or recorded result was touched. A final pre-landing review added: the independent branch reader now replays the prescribed lesion (mass-targeted selection or legacy target lesion) on the saved grown state and requires the saved post state to match (one added regression, so the focused count is now 53 where 52 are cited above); `audit-attempt.ts` now fails on partially retained branch evidence instead of calling it unexecuted, and fails when the ledger debit is below the retained bytes. The retained v2 bundle's 26,246,213 bytes equal its recorded debit; the amended audit was not re-executed here because it needs the original gitignored source paths. `tests/deno/recovery_severity_v4_reader.ts` needs the local `runs/` bundle and was not run in this landing. `deno check` of the Stage 0 entry points currently fails on pre-existing type narrowing in `experiments/recovery-accessibility/observer.ts` under the current Deno (also affects `feasibility.ts`); repository `tsc` passes.

A second review (2026-11-17) fixed three reader/audit defects, validated on synthetic inputs only; no experiment was rerun and the recorded TECHNICAL-STOP is unchanged. (1) `audit-attempt.ts` now takes each trace's cadence from its file role (cpu25 25, gpu25 25, gpu50 50, in `audit-traces.ts`) instead of the trace's own `cadence` field, so copies of one gpu50 trace in the 25-step files can no longer validate and hide cadence disagreements. (2) The branch reader binds the saved final checkpoint only to the GPU25 trace that wrote it; a CPU25 or GPU50 mismatch at offset 2000 stays parity evidence, so a published TECHNICAL-FAILURE diagnostic is rereadable instead of rejected. (3) `read-stage0.ts` now briefly creates and removes `<budget>.lock` with the same exclusive open as `budget.ts`, holding it from the settlement-temp check through debit verification, and refuses (without removing it) a lock it did not create. The reader therefore needs write access to the budget directory, and a reader killed mid-verification leaves `<budget>.lock`, blocking attempts and readers until it is removed by hand. Focused vitest count is now 55 (two tests added, run on the pair-2 fixture and synthetic traces); `recovery_severity_budget.ts` gained the lock regression.
