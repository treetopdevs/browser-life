**No blockers.** Both Codex fixes hold, the completed-arm disclosure is in place, and the runner pin matches the file on disk. I read the files and ran no tests, simulations or diagnostics, so test results are not confirmed. I used about seven targeted greps and reads, one more than your six. The extra one was needed to check the disclosure function and its test.

**Diagnostics receipt keys** (`tools/food-band-longevity-replication-diagnostics.mjs:53-70`)
- The check requires `sameAgeComparisons` ticks to be exactly `[3000,5500,6000]`.
- Each entry must have exactly the keys `{observation, tick}`, and its `observation` must be a non-empty string.
- The `!x` guard handles null entries, and a string entry fails the key comparison.
- The extra-field test (`tools/test/food-band-longevity-replication-diagnostics.test.ts:198`) puts `reviewerNote` on the 3000 entry and expects the "identity or observations mismatch" error.
- That test covers only the extra-field case. A missing `observation`, a non-string `observation` and duplicate or reordered ticks hit the same condition but have no test. This is not a blocker.

**Viewer generation check** (`docs/creative-prototypes/food-band-longevity-replication-viewer.js:727-728`)
- `loadPair` checks the generation immediately after `await response.json()` and before `validateIndex`, the status update and the arm fetches.
- `fetchArm` and `fetchReceipt` also check after the response, after `arrayBuffer()` and after hashing.
- The browser test (`tests/e2e/food-band-longevity-replication.spec.ts:245-257`) holds the seed-1202 index body after its first byte.
  - It switches to 1203, then releases the 1202 body.
  - It asserts the title and status stay on 1203, and that no 1202 arm request was made.
- The "no 1202 arm request" assertion would fail without the fix, because the arm fetches would otherwise go out. The test is meaningful.
- The fixed `waitForTimeout(100)` can only produce a false pass on a slow machine, never a false failure.

**Completed-arm disclosure and runner pin**
- `formatCompletedArmDisclosure` (`tools/food-band-longevity-replication/explore.ts:421`) emits seed, mode, final tick, extinction tick, census, environment, `numericalGate`, `windows` and `dataSha256`.
- It is written at line 702, after `runArm` returns the validated arm and before the next arm starts.
- Stdout goes straight to the attempt log, so the moving-arm outcome is durable before the stationary arm runs.
- The test (`tools/test/food-band-longevity-replication-evidence.test.ts:160-176`) uses synthetic data and checks the gate fields and window summaries.
- It tests the formatter's output only. The write-before-next-arm ordering comes from reading line 702, not from a test.
- The viewer pins `tools/food-band-longevity-replication/explore.ts` at `19f90040…6080` (line 54). `shasum -a 256` on disk gives the same value. Any later edit to `explore.ts` needs a re-pin.

**`runs/food-band-longevity-replication/run-attempt.py`**
- It records the attempt before the run, logs to a file, and stores the exit code and log text afterwards.
- It refuses to rerun a seed that already has an outcome-producing attempt.
- It requires seed 1202 to exit 0 before seed 1203 starts.
- An interrupted run leaves an attempt with no exit code, which blocks a retry until reviewed. That is the conservative outcome.
- It does not check that check-only passed or that the implementation is committed. The parent's manual check-only run and commit have to cover that, as you described.
- It writes the attempts file into `docs/creative-prototypes/` and uses paths relative to the working directory, so run it from the repo root.
- I did not check whether `--write` cares about a dirty tree. The attempts file is outside the pinned source set, so it should not.

**Before the first `--write`:** commit the implementation and review files, then run check-only for 1202 and 1203. Don't edit `explore.ts` after that without re-pinning the viewer.
