**Verdict: clear. No remaining blocker.** The appended "Review clarifications frozen before implementation" section resolves all four suggestions and the filename note. It doesn't touch the frozen dynamics or gates.

I read only the plan and the Claude plan review, so that's 2 of 3 reads. I made no edits and ran no simulations. I did not re-check the review's claims about the artifacts, and I did not re-hash `model.ts`.

| Suggestion | Resolved? | Where in the plan |
|---|---|---|
| 1. Freeze the historical comparison | Yes | The compared fields are `run`, `rules`, `samples`, `tickRows`, `frames`, `snapshots`, `windows`, `final`, `repeat` and `numericalGate`. Only `kind`, `runtime`, `provenance` and `dataSha256` are excluded as wrapper metadata. Raw hashes are checked against the accepted index bindings first, and the state is not normalized. This matches the review's field list exactly. |
| 2. Pair order and retries | Yes | Moving runs first and must pass historical regression before the stationary arm runs. A regression failure invalidates the whole pair. A reviewed assay retry reruns the whole pair and keeps the failed attempt. An unresolved invalid 1201 blocks 1203. A valid biological or visual failure does not block 1203. This reconciles "run the second seed anyway" with "stop on correctness failure". |
| 3. Aggregate wording | Yes | Every failure criterion is reported. An unclear visual judgment is not called extinction or proof of lost variety. Missing data from an assay error is invalid, while missing late endpoints from actual extinction fail the screen. Zero passes now reads "the screen did not repeat". Repetition does not establish persistent minority diversity, and final family sizes are reported descriptively. |
| 4. Moving rejudgment and gate leniency | Yes | Moving numeric outcomes are stated as predetermined. The visual rejudgments are stated as not blind, and the receipt observations must say so. The visual gate is called permissive and cannot support superiority. |
| Minor: filenames | Yes | All new outputs use the `stationary-food-replication` prefix and preserve every old file. |

An unclear visual call still counts as a screen fail in the aggregate, because the line 13 gate is unchanged. The clarification only changes how that fail is labelled: "screen did not repeat", not "biological non-repeat". That fits your constraint not to change gates.

**Non-blocking nits, for the runner rather than the plan:**
- "Accepted historical index bindings" doesn't name the index files. The runner should name them explicitly and stop if a hash is missing from the index.
- The plan and the three review files are still untracked, so "commit plan" is still to do.
