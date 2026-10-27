**Blocker: the required launch/attempt guard is missing from the reviewable implementation.**

[`writeEvidence()`](/Users/nicholas/.codex/worktrees/split-food-replication/browser-life/tools/split-food-replication/explore.ts:695) permits execution without verifying committed source and prints intent only to stdout. No parent attempt script was found or provided to enforce that guard and durably record intent, HEAD, source pins, failures, and inconclusive attempts. That wrapper needs review before launch.

No additional blocker found in the inspected runner, tests, and viewer. Plan/model hashes match; baseline comparison precedes split execution; check-only avoids simulation by static inspection. Producer/viewer pin parity has test coverage but was not executed.

Eight reads total. No tests, simulations, outcomes, or edits.