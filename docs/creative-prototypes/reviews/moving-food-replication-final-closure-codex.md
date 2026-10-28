**One blocker remains:** the new acceptance test sets `lateWithinMoving.pass = false` but still expects “Promising” ([spec:579](/Users/nicholas/.codex/worktrees/moving-food-replication/browser-life/tests/e2e/moving-food-replication.spec.ts:579)). The viewer correctly rejects that combination ([viewer:688](/Users/nicholas/.codex/worktrees/moving-food-replication/browser-life/docs/creative-prototypes/moving-food-replication-viewer.js:688)). Keep the late comparison true when testing acceptance with two passing comparisons.

Both prior findings are closed: exact saved frames are required in both arms and at the late moving endpoints; the default extinct fixture now records its two terminal deaths correctly.

Read-only inspection; no tests or simulations run.
