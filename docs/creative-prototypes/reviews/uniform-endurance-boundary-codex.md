No concrete remaining blocker before the first pilot. Both prior implementation blockers are closed.

- **Prefix boundary:** `validatePrefixTick` returns only for `tick > 6000`; tick 6000 still compares its row and full checkpoint. The boundary test requires that checkpoint and passes null inputs at 6001, exercising the early return. [Runner:378](tools/uniform-endurance/explore.ts:378), [test:56](tools/test/uniform-endurance-evidence.test.ts:56).
- **Export:** `validatePrefixRecord` is exported, so the wrong-seed test reaches the intended validation. [Runner:503](tools/uniform-endurance/explore.ts:503).
- **Gate tests:** separate zero-birth and zero-death cases exercise the required turnover flag; cap 99 versus 100 remains covered. [Tests:125](tools/test/uniform-endurance-evidence.test.ts:125).
- **Off-cadence:** tick 37 is retained in sample/snapshot schedules. This is helper-level coverage; runner capture also retains the terminal frame. [Tests:139](tools/test/uniform-endurance-evidence.test.ts:139).

Static closure only; no tests, simulations, or edits performed.
