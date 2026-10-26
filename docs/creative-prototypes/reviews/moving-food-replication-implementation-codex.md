No core runner or diagnostics blockers found against frozen `22e60fce`: seed/baseline bindings, pins, history, repeat checks, stop behavior, and committed visual-receipt ordering look correct.

Two viewer acceptance blockers remain:

- **Source mismatches pass validation.** [moving-food-replication-viewer.js:149](/Users/nicholas/.codex/worktrees/moving-food-replication/browser-life/docs/creative-prototypes/moving-food-replication-viewer.js:149) checks digest format/presence, without enforcing frozen source values or agreement between arms. A changed source digest with recomputed enclosing hashes still passes. Validate frozen dependency pins and matching runner identities; add a resealed source-mismatch case.

- **“Promising” trusts an unchecked numerical flag.** [moving-food-replication-viewer.js:634](/Users/nicholas/.codex/worktrees/moving-food-replication/browser-life/docs/creative-prototypes/moving-food-replication-viewer.js:634) accepts `numericalPass: true` without recomputing it from the saved endpoint/windows. The accepted test fixture itself has zero births/deaths while setting this flag true. Recompute the frozen numerical gate and reject contradictory decisions.

These affect companion acceptance, not execution of the scheduled runs. Missing outcome artifacts are expected. Review stayed within 10 read commands; no simulations, tests, or edits.