**Closure: no concrete blocker before the first pilot.** Both earlier blockers are fixed in the current code. I read the files but ran no tests, so this is from reading only.

- **Codex P1 (tick 6001) is fixed.** `validatePrefixTick` returns at `explore.ts:379` when `tick>PREFIX_END`. Tick 6000 is still compared, including the tick-row diff and the full-snapshot check at the checkpoint. The test at `evidence.test.ts:56-69` runs 6000 against the real seed-1203 prior and checks the checkpoint it records. It then calls 6001 with all-null arguments and expects no throw, so any access past the prefix would fail it.
- **Claude blocker (`validatePrefixRecord` export) is fixed.** It is now `export function` at `explore.ts:503`. The wrong-seed test (lines 47-54) passes the earlier checks and reaches the `/wrong-seed or incomplete pinned prefix/` check at line 507, because the prior's seed is 1202 and the evidence's is 1201.
- **Zero births/deaths and the cap boundary** are tested through `evaluateGate` (`evidence.test.ts:125-137`):
  - Births 0 in window 2 and deaths 0 in window 3 each fail `eachNewWindowHasBirthsAndDeaths`.
  - `cap48Ticks` of 99 passes and 100 fails.
- **Off-cadence extinction** is tested (lines 139-142):
  - `expectedSampleTicks(37,37)` gives `[0,20,37]`.
  - `expectedSnapshotTicks(37,37)` gives `[0,37]`.
  - `validateEvidenceStructure` applies the sample cadence to frames too (`explore.ts:548-549`).
- **Stale comment** at the old line 114 now says "9,000-tick endurance horizon".

**Non-blocking gaps, to handle after the seed-1203 artifact exists:**
- The 6000 test has no negative case, such as a perturbed tick row that must throw.
- The off-cadence test covers only the cadence helpers, not an actual extinction run.
- The negative tests for a missing prefix proof, extra normalized fields, and changed biology with recomputed digests still need a full artifact.

I did not read `explore.ts` lines 553–623 (the rest of the evidence validation, `--write`, `--check` and `--replay-check`) or the viewer. I also did not run the test suite. `pnpm vitest run tools/test/uniform-endurance-evidence.test.ts` is the cheap check to run before starting the pilot.
