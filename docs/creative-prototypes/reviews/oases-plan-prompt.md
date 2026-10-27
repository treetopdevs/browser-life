Perform an adversarial, read-only implementation-plan review for Travelling oases Candidate 3. You are Claude Sonnet 5.5 at high effort. Do not edit any files, run tests, invoke shell, or read large JSON/historical reviews. The objective is interesting engineered lifelike environments with honest labels, not proof of open-ended evolution or scientific purity. No deployment.

Exact checkout: /Users/nicholas/.codex/worktrees/travelling-oases/browser-life; branch codex/travelling-oases; base f122e23.
Read only these bounded sources:
- CLAUDE.md
- docs/creative-prototypes/oases-plan.md
- apps/lab/src/particles/model.ts
- apps/lab/src/particles/comparison.ts
- apps/lab/src/particles/comparison-clock.ts
- tools/particles/explore.ts
- tools/particles/explore-picker.ts
Optional focused reference: apps/lab/src/particles/picker.ts import and clock handlers; apps/lab/test/particle-comparison.test.ts.

Review whether the plan is implementable without accidental default dynamics changes, corrupt model2 migration, misleading evidence metrics, inconsistent extinct/comparison clocks, or resetting food during toroidal motion. Identify concrete omissions that could cause wrong behavior or misleading claims; avoid requesting unrelated infrastructure or scope expansion. Consider determinism, environment ownership/validation/freezing, step ordering, metadata-only version changes versus numerical comparisons, historical pilot preservation and reproducible checks, moving-patch occupancy versus true particle displacement, and observation exports for extinct runs. Give severity and exact plan/source pointers, short consequence and smallest repair. Separate blockers from useful clarifications. Finish with a concise verdict. Do not claim runtime verification.
