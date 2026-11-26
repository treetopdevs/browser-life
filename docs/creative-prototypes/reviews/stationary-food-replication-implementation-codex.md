**Verdict: two blockers before committing the implementation.**

1. **P1 — Viewer rejects valid runner outputs for both seeds.** [Viewer baseline constants](/Users/nicholas/.codex/worktrees/stationary-food-replication/browser-life/docs/creative-prototypes/stationary-food-replication-viewer.js:7) contain uniform-endurance hashes, while the [runner emits accepted moving-reference hashes](/Users/nicholas/.codex/worktrees/stationary-food-replication/browser-life/tools/stationary-food-replication/explore.ts:436). Validation therefore fails at viewer line 209. [E2E fixtures](/Users/nicholas/.codex/worktrees/stationary-food-replication/browser-life/tests/e2e/stationary-food-replication.spec.ts:12) repeat the incorrect constants, masking the incompatibility. Correct both and cover the producer’s identities.

2. **P2 — Browser accepts receipts that diagnostics rejects.** [Browser receipt validation](/Users/nicholas/.codex/worktrees/stationary-food-replication/browser-life/docs/creative-prototypes/stationary-food-replication-viewer.js:521) omits the required disclosure that rejudgments are not blind because historical moving media exist. The [diagnostic helper enforces it](/Users/nicholas/.codex/worktrees/stationary-food-replication/browser-life/tools/stationary-food-replication-diagnostics.mjs:58). Align validation and add a negative receipt case.

**Operational nit:** `--write --seed1203` has no 1201 prerequisite. The frozen seed order and stop-after-invalid-1201 rule remain operator-enforced.

Other inspected contracts match: explicit seed-specific legacy/reference/index binding; all ten frozen comparison fields; moving regression before stationary; check-only without simulation; import guard and exclusive writes; unchanged numerical and own-2500–3000 visual gates; seed switching, stale-load protection, paused replay and terminal hold.

The plan/model hashes match their pins, and historical tracked files remain unchanged from PR105. Missing unpublished indexes display pending status; listed-but-unavailable evidence fails closed. Live endpoint availability was not exercised.

Sol6.1 High review completed within ten pertinent reads/searches. No edits, tests, simulations, overlap computations or raw artifact dumps.