**Two actionable blockers:**

- **Activity gates trust unchecked cap flags.** [alternating-food.js:187](/Users/nicholas/.codex/worktrees/alternating-food-bands/browser-life/docs/creative-prototypes/alternating-food.js:187) validates `cap48` only as a boolean, then counts that flag to derive window passes. Rows with `population: 48, cap48: false` can undercount cap occupancy and falsely pass. Enforce population bounds and derive cap occupancy from population; reject contradictory flags.

- **Snapshot hashes do not establish snapshot/frame agreement.** [alternating-food.js:167](/Users/nicholas/.codex/worktrees/alternating-food-bands/browser-life/docs/creative-prototypes/alternating-food.js:167) checks snapshot hashes and selected metadata, but never compares snapshot bodies, food, or census with the corresponding displayed frame. An inconsistent intermediate snapshot can pass after its hashes are recomputed. The [synthetic fixture:53](/Users/nicholas/.codex/worktrees/alternating-food-bands/browser-life/tests/e2e/alternating-food.spec.ts:53) illustrates this gap by substituting tick-500 state for missing checkpoints. Validate complete snapshot structure and its correspondence with recorded frames before reporting verification.

Historical/new identities, nonnegative per-band accounting, endpoint feeding schedule, pending-result handling, and terminal-hold labeling otherwise look consistent with the frozen plan.

Read-only review; no runner inspection, executions, tests, edits, or raw-artifact reads.