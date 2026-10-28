**Acceptance should remain blocked on six validation defects.** These are static findings; I ran no tests, pilots, or simulations and made no edits.

1. **P1 — Energy conservation can pass with unequal totals.** [Snapshot validation](tools/uniform-food/explore.ts:198) and [frame/sample validation](tools/uniform-food/explore.ts:445) check `actual` and `expected` separately without requiring equality. On an intermediate frame, changing `dissipated += 1`, `expected -= 1`, leaving `actual` and `residual: 0`, and resealing hashes passes these checks.
   **Fix:** require `residual === actual - expected === 0` everywhere. Add this rehashed corruption test.

2. **P1 — Intermediate frame identities are not joined to lineage.** [Frame validation](tools/uniform-food/explore.ts:365) checks internal palette/cell consistency; the [census join](tools/uniform-food/explore.ts:443) checks counts. Neither verifies the bodies against complete lineage. Replacing a body ID consistently in an intermediate frame’s cells and palette with an unused bounded ID survives resealing.
   **Fix:** derive the exact living IDs at each frame tick from lineage; require matching IDs, families and genomes. Derive available census generation and mutation counts from that lineage too.

3. **P1 — Snapshot history can contradict retained samples.** [History validation](tools/uniform-food/explore.ts:199) checks schedule, individual rows and the final census, but never joins earlier history rows to `samples`. Changing an earlier terminal-snapshot history row’s `attemptedMutations`, then resealing affected hashes, can pass while its retained census remains unchanged. Snapshot lineages likewise lack reconciliation with final lineage.
   **Fix:** compare every snapshot history row with its corresponding sample, and reconcile each snapshot’s lineage with the final lineage projected to that tick.

4. **P2 — Required nested fields can disappear.** [Lineage validation](tools/uniform-food/explore.ts:124) accepts missing `parentRecordDropped` because `!undefined` passes. Snapshot validation also accepts fractional `growthCursor` values within bounds.
   **Fix:** validate required nested object shapes and explicit boolean/integer types. Add resealed deletion tests for lineage fields and a fractional-cursor rejection test.

5. **P2 — Extinction metadata need not describe extinction.** [Run validation](tools/uniform-food/explore.ts:423) requires an extinction tick to equal the final tick, but never requires zero terminal population. A living tick-6000 artifact can be relabeled extinct, resealed, and retain a passing [numerical gate](tools/uniform-food/explore.ts:344).
   **Fix:** require extinction exactly when population first reaches zero, with no subsequent rows; require living terminal populations when `extinctionTick === null`.

6. **P2 — The viewer accepts incomplete or contradictory recordings.** [Viewer validation](docs/creative-prototypes/uniform-food-viewer.js:82) permits a live run ending before 6000 and checks frame ordering without requiring every cadence frame. Frames `[0, 6000]` can therefore be presented as an exact recording sampled every 20 ticks. Family validation checks only the sum, and loading never verifies artifact/frame digests or binds the displayed decision to an artifact SHA.
   **Fix:** enforce the complete cadence and terminal contract, exact family joins, and checked artifact identity before showing accepted evidence or its decision. Add browser rejection cases for these corruptions.

The reviewed code does implement independent repeat initialization and frame projection, exact retained-prefix comparisons, contiguous tick/population/birth/death joins, the inclusive **99-pass/100-fail** boundary, off-cadence terminal capture, exclusive file creation, and guarded CLI execution. The 301-slot history accommodates ticks 0–6000. Playback contains no model continuation, requests only explicitly listed seeds, and pauses when hidden.

All six pinned historical file hashes match their constants; the old models, runner and Hungry evidence show no changes against `511d76c6`. The required old structural `--check --seed 1201` remains **unverified** in this review.

Optional: protect seed switching against stale concurrent fetches, and verify that returning from a hidden tab stays paused.

**Outcome files and the manual visual decision are absent and remain unreviewed.**
