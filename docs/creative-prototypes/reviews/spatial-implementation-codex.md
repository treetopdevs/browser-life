Found six concrete issues:

1. **P1 — Importing the runner executes its CLI.** The evidence tests import `explore.ts`, whose unguarded entry point either rejects test-runner arguments or calls `runPilot()`, potentially launching simulations and writing artifacts during test collection. Add a direct-execution guard. [explore.ts:257](/Users/nicholas/.codex/worktrees/spatial-particle-worlds/browser-life/tools/spatial/explore.ts:257)

2. **P2 — Replay verification cannot pass.** `executeOne()` returns `preset`, `seed`, `mutation`, and `requestedTicks`; stored `expected.repeat` omits those fields. Comparing their complete canonical objects always differs, even for identical trajectories. [explore.ts:252](/Users/nicholas/.codex/worktrees/spatial-particle-worlds/browser-life/tools/spatial/explore.ts:252)

3. **P2 — Late-window turnover omits boundary events.** Counters start after tick 5001, excluding that tick’s births/deaths. An extinction tick only increments executed coverage, excluding its deaths and leaving final/minimum population at the previous living value. Capture turnover across every executed step; restrict only motion averages to living steps. [explore.ts:109](/Users/nicholas/.codex/worktrees/spatial-particle-worlds/browser-life/tools/spatial/explore.ts:109)

4. **P2 — Playback can exceed the 6,000-tick horizon.** The frame batch allows up to 16 ticks without clipping to `6000 - world.tick`; completion is checked afterward. Playback can therefore stop and export beyond the declared horizon. [page.ts:144](/Users/nicholas/.codex/worktrees/spatial-particle-worlds/browser-life/apps/lab/src/spatial/page.ts:144)

5. **P2 — Evidence validation accepts incomplete records.** Census validation permits skipped 100-tick samples. “Full snapshot” validation requires only `state.current.tick` and a matching hash, so census-only objects without particles, food, settings, or ledger pass—as the positive fixture demonstrates. This undermines `--check`’s coverage claims. [explore.ts:163](/Users/nicholas/.codex/worktrees/spatial-particle-worlds/browser-life/tools/spatial/explore.ts:163), [spatial-evidence.test.ts:19](/Users/nicholas/.codex/worktrees/spatial-particle-worlds/browser-life/tools/test/spatial-evidence.test.ts:19)

6. **P2 — The extinction acceptance test contradicts its validator.** It changes extinction to tick 5051 but retains 1,000 executed late steps. The validator requires 51, so the asserted `not.toThrow()` necessarily fails once the import problem is fixed. [spatial-evidence.test.ts:75](/Users/nicholas/.codex/worktrees/spatial-particle-worlds/browser-life/tools/test/spatial-evidence.test.ts:75)

Static review only; no edits, tests, or simulations. Pending pilot output was not treated as a finding.