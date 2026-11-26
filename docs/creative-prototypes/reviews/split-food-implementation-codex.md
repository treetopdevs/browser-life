**Blocked by browser-test defects in the final inspected version.**

- **Undefined hash helper:** [split-food.spec.ts:130](/Users/nicholas/.codex/worktrees/split-food-bands/browser-life/tests/e2e/split-food.spec.ts:130) calls `hash(...)`, but only `sha(...)` exists. Fixture construction throws before viewer assertions.
- **Incorrect fixture geometry:** [line 54](/Users/nicholas/.codex/worktrees/split-food-bands/browser-life/tests/e2e/split-food.spec.ts:54) uses `48*96+i`, placing cells in row 48, columns 0–9. Both groups occupy band one: **20/0**, contradicting the hardcoded **10/10** checkpoints. The extinction fixture also reports minimum population 12 despite its terminal zero population ([line 102](/Users/nicholas/.codex/worktrees/split-food-bands/browser-life/tests/e2e/split-food.spec.ts:102)).
- **Source-pin assertion always fails:** [line 274](/Users/nicholas/.codex/worktrees/split-food-bands/browser-life/tests/e2e/split-food.spec.ts:274) extracts only quoted digest literals. It omits the viewer’s `split-food-plan.md: PLAN_SHA256` entry, then compares against the complete runner map.
- **Keyboard test expects absent behavior:** [line 259](/Users/nicholas/.codex/worktrees/split-food-bands/browser-life/tests/e2e/split-food.spec.ts:259) presses ArrowRight on the body; the viewer’s document handler implements only Space. Focus the scrubber or implement the intended shortcut.

Static inspection otherwise supports the frozen model and runner contract: exact sorted mask, 768 distinct offers with 384 per band, no scheduling RNG, unchanged biology, old check before regression, exact predetermined baseline comparisons before independent split repeats, strict missing-data rejection, and simulation-free check-only routing. Producer pins match current source bytes. The concurrent viewer correction now handles endpoints unreached through valid extinction.

The parent launcher’s durable pre-launch logging was unavailable for inspection; source remains uncommitted, so commit-before-outcomes remains a prerequisite.

Read-only, within 10 pertinent reads. No tests, simulations, outcomes, or replay checks executed; no files written.