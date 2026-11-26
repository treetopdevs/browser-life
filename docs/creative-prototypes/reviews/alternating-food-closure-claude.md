**Verdict: one actionable blocker (A), and one pre-launch step (B).** Everything else I checked is clear. I made no edits and ran no tests or simulations. I did run read-only `ls`, `shasum` and `git check-ignore`. I read 8 files and made 2 small bounded greps.

**A. The runner depends on a gitignored file at import, so it breaks in any other checkout.**
- `tools/alternating-food/explore.ts:51` lists `runs/alternating-food/run-attempt.sh` in `PINNED_INPUTS`. `sourceHashes()` reads every pinned file when the module loads (`:240`).
- `runs/` is gitignored (`.gitignore:6`) and nothing under it is tracked. Importing `explore.ts` therefore throws ENOENT in a fresh clone, a PR checkout, or the main checkout after merge. `tools/test/alternating-food.test.ts` and `--check` both fail there.
- The historical split-food runner has no `runs/` dependency, so this is new fragility.
- Decide it now. Once the run happens, `validateEvidenceStructure:569` requires the recorded source hashes to equal the current `explore.ts`, so a later edit breaks `--check` on the accepted artifact.
- Fix before the commit and run, either way:
  - Track the launcher at `tools/alternating-food/` and pin that path.
  - Or keep the launcher hash only in `intent.json`, and have `sourceHashes()` skip the file when it is absent.
- Either fix changes the runner, so update `PINNED_INPUTS` and the launcher hash together.
- Minor, same edit: `intent.json` records the Node version but no platform or arch. The launcher enforces darwin/arm64 and the evidence records it, but the intent doesn't.

**B. Run the historical check once before launch.**
- `legacyCheck()` (`explore.ts:676`) runs after the reservation and runner-start files exist. If it fails for a non-biological reason, the single attempt is burned as invalid.
- First run `node --experimental-strip-types tools/split-food-replication/explore.ts --check --seed 1203` standalone on the final tree.

**Reported blockers: all closed**
- **Atomic one-attempt intent (Codex P1).**
  - `--write` requires `--attempt-dir` (`parseArgs`).
  - `verifyAttemptReservation` binds lock, reservation, intent, git HEAD, source, package and lock, historical pins, the launcher hash, Node version and the exact command.
  - `claimAttemptStart` does a `wx` create of `runner-start.json` and requires empty logs.
  - The launcher refuses any non-empty `attempts/`. The directory is empty now, and the launcher hash matches the runner's pin (`d1581e52…`).
- **Failure and capacity evidence (Codex P1).**
  - `AttemptRecorder` fsyncs observations and `failures.jsonl`, and `candidate-evidence.json` is saved before validation.
  - Capacity messages (24 MiB, dropped/capped observations) classify inconclusive and everything else invalid.
  - `result.json` records the exit status and classification.
  - Baseline artifact is 4.8 MB, so 7 snapshots should sit well under the 24 MiB cap.
- **Negative band ledger (Codex P2).** `validateBandAccounting` and `validateEnvironment` require nonnegative safe integers and bounds. Tests cover `[-1,100]` and the overflow bound.
- **Viewer cap flags.** `alternating-food.js:241-249` derives `cap48` and `nearCap47` from population and recomputes the window counts from the rows.
- **Viewer snapshot and frame agreement.** `validateSnapshotFrame` compares occupancy, cells, organisms, food, ledger, census and history against the recorded frame.
- **Synthetic fixtures.** They now build lineage projections and histories correctly (`spec:25-65`), with rehash tests for the cap-flag and food mismatches. I did not re-run the browser tests and rely on your reported pass.
- **Claude's earlier should-fix items.**
  - The launcher intent is complete.
  - The stepped 200-tick old/new split parity test exists.
  - The gate-boundary tests exist: cap 99 versus 100, zero births and deaths, a single family, extinction, spatial 9 versus 10, a missing endpoint, and an unreached window.
  - Malformed frame, snapshot and tick-row rejection is tested, as is `assertPinnedInputs`.

**Residual risks (not blockers)**
- **Validators untested on a real artifact.** The 3,000-tick evidence validators have never run on a real alternating artifact. A bug there would produce an invalid attempt, which can be retried after a reviewed repair, not an unrecoverable loss.
- **Stepped test stops at tick 505.** It never reaches 1000/1005. The per-tick `assertWorld` check covers those boundaries at runtime. A cheap 1,005-tick stepped test would settle it earlier.
- **Harmless nits.** Failures are double-recorded, but both entries classify the same. `:430`'s message would classify invalid, but `assertWorld` fires first.
