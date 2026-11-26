Found **two P2 correctness issues**:

1. **`--check` accepts evidence that contradicts its retained states.** [explore.ts:430](/Users/nicholas/.codex/worktrees/hungry-shapes/browser-life/tools/hungry-shapes/explore.ts:430) checks selected fields but never binds `finalCensus`, `finalLedger`, exported lineage, or final state hash to the terminal snapshot. For example, changing `finalCensus.population` to 49 and recomputing the artifact digest passes these checks. Snapshot schema validation also accepts states missing food, occupancy and organisms—the synthetic acceptance fixture demonstrates this. Validate the copied snapshot schema and cross-check these retained representations. This requires no simulation or new scientific gate.

2. **Source hashes can describe different bytes from the loaded implementation.** [explore.ts:316](/Users/nicholas/.codex/worktrees/hungry-shapes/browser-life/tools/hungry-shapes/explore.ts:316) captures current disk hashes when `buildArtifact` runs, after modules were imported. Importing the runner, editing the model, then calling `buildArtifact` executes the cached model while recording the edited file’s hash; the before/after comparisons both pass. The CLI also awaits file preflight before capturing hashes. Pin startup identity before those waits and reject subsequent source changes before execution.

Other checks:

- Original development model, runner, tests and pilot evidence are unchanged against `068756c1`; both source hashes match the retained pilot.
- The isolated copy preserves the original snapshot schema and biology. Food targeting matches the frozen formula, sorted masks, 972 patch tiles, distinct 768-target pulses, overflow accounting and RNG independence.
- Replay uses separate world instances. Late-window rows use actual executed ticks, post-step cap flags and denominator 500. Maximum-ever generation comes from retained lineage.
- CLI import is guarded; writes use exclusive creation. UI code handles shared versus terminal clocks, hidden-tab pausing, extinction, horizon, observation exports and separate food/mask rendering consistently.
- Noindex, case-insensitive Caddy exclusion and removal patterns cover the existing emitted Hungry shapes files. I did not execute removal.

**Optional coverage:** add negative tests against the copied fixture validator and browser regressions for hiding during playback, extinction and horizon. Current browser tests chiefly exercise startup and tick 1.

No tests, pilots or simulations were run; no files were modified. **Pilot reports do not exist yet, so outcomes and the visual gate remain unreviewed.**