Retracted: the newline blocker was false.

- [Line 12](tools/test/moving-food-replication-diagnostics.test.ts:12) contains bytes `125, 92, 110, 96, 59`: exactly one backslash before `n`. The JS template literal correctly appends a newline.
- [accepted-tests.log](runs/moving-food-replication/accepted-tests.log) records **27 tests passed across 2 files**. It does not display the per-suite count of 12 diagnostics tests.

No edits, tests, simulations, or overlap computation performed.
