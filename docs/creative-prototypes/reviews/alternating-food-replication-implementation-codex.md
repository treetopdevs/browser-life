**Verdict: blockers.**

- **P2 — Core validation accepts rehashed disconnected frames.** [explore.ts:462](/Users/nicholas/.codex/worktrees/alternating-food-replication/browser-life/tools/alternating-food-replication/explore.ts:462) checks tile bounds, ordering, and palette membership, but omits per-body connectivity and cell caps. Rearranging a non-snapshot frame’s tiles and updating its hashes can pass `--check` while failing the browser validator. Apply those body checks to every frame.

- **P2 — The actual-evidence test has an unconditional text mismatch.** [spec.ts:394](/Users/nicholas/.codex/worktrees/alternating-food-replication/browser-life/tests/e2e/alternating-food-replication.spec.ts:394) expects “do not meet the frozen growth/retreat threshold”; the loaded page replaces that text with “No static block meets this screen.” The actual test will fail even for valid evidence.

- **P2 — Actual-evidence testing assumes survival through every late endpoint.** [spec.ts:398](/Users/nicholas/.codex/worktrees/alternating-food-replication/browser-life/tests/e2e/alternating-food-replication.spec.ts:398) indexes the timeline by `tick / 20` and dereferences alternating samples at all four late ages. A valid early-extinction Stop lacks those samples; an off-cadence terminal frame also shifts timeline indices. Assert the saved terminal hold and actual age instead.

The inspected hashes agree, and launch requires committed inputs. No tests, simulations, outcomes, or edits were performed.