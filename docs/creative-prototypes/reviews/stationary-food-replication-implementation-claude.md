**Verdict:** I found one blocker before outcomes can run, plus a few should-fix items and nits. I edited nothing and ran nothing: no simulation, no tests, no overlap computation. I used 9 reads and searches and one `shasum` on `explore.ts`. I did not read the viewer HTML/CSS, `tools/test/stationary-food-replication-diagnostics.test.ts` or the e2e spec. This is a Claude review only; the Sol 6.1 High read-only pass the repo requires before commit is still outstanding.

## Blocker

**B1. Nothing checks that the runner's computed output equals the historical moving payload before an outcome run is spent.**
- `validatePrefixRecord` (`explore.ts:553`) compares `run, rules, samples, tickRows, frames, snapshots, windows, final, repeat, numericalGate`. That matches the frozen list exactly, and the comparison is order-sensitive (`JSON.stringify`).
- The only test of it (`tools/test/stationary-food-replication-evidence.test.ts:80-103`) builds its "new" record by cloning the historical `prior`. It never exercises the runner's own `summarizeWindow`, `evaluateGate`, or the `final` and `repeat` construction in `runArm`.
- A mismatch would only surface after a full 3000-tick run, as a whole-pair assay failure. Under the plan that burns a logged attempt and needs a reviewed repair.
- Both historical artifacts do carry the window fields the runner emits (`requestedTick`, `maxEverGeneration`, `occupiedBandShare`, `nearCap47Ticks`, `deathsByCause`), so I expect it to pass. Key order and values are unverified.
- **Fix:** add a no-simulation test per seed. Export `summarizeWindow` (and `maxEverGenerationAt`, `deathsByCause` logic). Recompute `windows`, `numericalGate` and the derived parts of `final` from the reference's own `tickRows`, `samples`, `frames` and `final.lineage`, then assert `same(...)` against `prior`.

## Should fix (not blocking)

1. **The viewer is looser than the diagnostics on receipts.** Diagnostics reject a receipt unless its observations say the rejudgment is "not blind" and mention "historical moving media" (`diagnostics.mjs:62`). The viewer's `fetchReceipt` (`viewer.js:508-535`) has no such check, so it would display a receipt the diagnostics refuse. The plan says to fail closed on receipt inconsistency, so mirror the check.
2. **A browser can restore the seed select while the viewer loads seed 1201.** `viewer.js:816` hard-codes `loadPair(1201)`, and `selectedSeed` starts at 1201. If the browser restores the `<select>` to 1203 after a reload, the picker and the loaded pair disagree. Initialise from `seedPicker.value` (clamped to 1201 or 1203). I did not read the HTML, so this depends on the markup.
3. **A failed stationary run discards the finished moving run.** `writeEvidence` (`explore.ts:662-665`) writes nothing until both arms pass. That fits "a retry reruns the whole pair", but the failed attempt exists only as the decision-log entry. Make sure that entry records the error text.
4. **Two plan rules are process-only.** "Log before starting" and "unresolved invalid 1201 prevents 1203" are not enforced by the tool. That is fine if the parent enforces them. Say so in the pre-outcome commit message or log.

## Checked and fine

- **Dispatch:** `parseArgs` requires an explicit `--seed`, rejects 1202 and 1204 and any extra argument, and needs exactly one action. Output paths are seed-specific under the `stationary-food-replication-` prefix.
- **Per-seed legacy binding:**
  - The index key sets are correct. 1201 has `schemaVersion, kind, seed, arms, decision`; 1203 adds `planSha256`. I confirmed the real index files have these keys; I did not check the `kind` string values.
  - The arm URL, arm `rawSha256` and `decision.movingBandArtifactSha256` are all bound.
  - Raw and data SHAs are pinned.
  - 1201 must have no plan pin; 1203 must carry the PR104 plan pin.
  - Every historical source path must be in `PINNED_INPUTS` with the same digest.
- **Order and failure handling:**
  - Moving runs first. Prefix checks run per tick, per sample and per frame, so a regression throws mid-run, before the stationary arm starts.
  - The final `validatePrefixRecord` compares the full payload.
  - Stationary is marked `not-applicable` with zero compared counts.
  - Extinction is handled: off-cadence terminal sample, terminal snapshot, and partial or not-reached windows.
- **Check-only and overwrite:** `checkEvidence` only reads and validates, with no `HungryWorld`. The legacy `--check` subprocesses are also check-only. `--write` pre-checks all four target files, then writes with `wx`.
- **Historical files unchanged:** the git status snapshot shows only untracked new files and no modified tracked ones. Source pins cover the stationary model, the earlier models and runners, the moving and uniform artifacts, and the plan. I did not check the old stationary-food 1202 artifacts and media.
- **Viewer pin is current:** the viewer's self-pin for `explore.ts` (`18d9c74d…`) matches the file now. Any fix to `explore.ts` needs a viewer pin update.
- **Gates:** `evaluateGate` matches the plan: alive at 3000, at least two living families, births and deaths positive in each window, cap48 at most 99 per window, and missing windows fail. The viewer recomputes the same gate independently. The diagnostics enforce the 2500–3000 visual pass, mark `pass` with missing frames as invalid, require the receipt to be committed at `HEAD` unchanged, and refuse a `pending` decision.
- **Seed switching in the viewer:**
  - `loadGeneration` discards stale fetches.
  - A 404 index shows "no manifest yet".
  - The index, both arms and the receipt are bound by SHA, each with a size cap.
  - The scrubber is shared and starts paused, and the terminal frame holds.
  - The decision status is cross-checked against the numeric gates plus the receipt.

## Nits

- `checkHistoricalReferences` runs both seeds' legacy checks regardless of the requested seed. That is stricter than per-seed, and acceptable.
- The diagnostics trust each arm's `numericalGate` flag, bound only by the index SHA. The viewer recomputes it. Either recompute in the diagnostics or require a passing `explore.ts --check` first.
- In the diagnostics, `validateReceipt` throws a `TypeError` instead of a clean error if a `sameAgeComparisons` entry is `null`. A missing receipt file also fails with a raw `ENOENT` before the clearer "pending" message.
- The evidence test has gaps:
  - A cross-seed swap (`validateHistoricalReference(1203, <1201 data>, …)`) is untested.
  - A `decision.movingBandArtifactSha256` mismatch is untested.
  - The 1203 index `planSha256` mismatch is untested.
  - Neither no-overwrite nor moving-before-stationary ordering is tested, because `writeEvidence` and `checkEvidence` aren't exported.
- When a seed with no manifest follows one with extinction, the viewer leaves the `extinction-note` text stale. It is hidden with `replay`, so this is probably harmless.
