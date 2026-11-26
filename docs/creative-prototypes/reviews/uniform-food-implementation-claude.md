**No blocker found.** I read the four files and ran nothing. The parent's 59 tests, 13 browser fixtures, typecheck and build are the only dynamic evidence, and I did not re-run them. I used 6 reads and searches, none outside the four files.

**The six fixes, checked by reading**
1. **Energy.** `actual === expected` is enforced every tick (`explore.ts:129-131`), in snapshots (`:222-223`) and in frames (`:401-402`). The frame/census identity includes stored energy: food + `census.totalEnergy === ledger.actual` (`:506-507`). Tests at `uniform-food-evidence.test.ts:147-170`.
2. **Frame bodies.** `validateFrameLineage` (`:408-418`, called at `:503`) joins each frame's living IDs, families and genomes to the final lineage. Test `:95-101`.
3. **Snapshot joins.** History-to-sample is at `:518`. Lineage-as-of projection is at `:419-427`, `:495`, `:519`. Terminal history-to-sample is at `:522-524`. Tests `:103-113`.
4. **Required fields.** `exactKeys` is applied to lineage, mutation, organism, cell, attempt, counters, ledger, census and sample. Growth cursors must be integers (`:115-116`, `:204-206`). Tests `:115-122`, `:129-132`.
5. **First zero and extinction.** Population cannot reach zero before the terminal tick (`:440`). Row coverage must equal the extinction tick (`:448`). The final census must be 0 when extinct and above 0 when live (`:478-481`). The terminal snapshot label is checked (`:513`). The viewer mirrors this (`:149-151`, `:165-167`).
6. **Viewer.** It checks the raw-file SHA (`:320`), the internal digest (`:90`), each frame hash (`:148`) and the full 20-tick cadence plus terminal frame (`:154-160`). Decisions are bound per seed to the artifact SHA (`:294-302`), and a manifest-level overall decision is rejected (`:353-355`).

**Risks, all fail-closed (a failure wastes the run, it can't produce a wrong artifact)**
1. **Real-model assumptions the fixtures don't exercise.** The only fixture is one tick, seed 1202, deaths only, with the state round-tripped through JSON. These assumptions are untested:
   - The founder count is hard-coded as 12 (`:434`).
   - Births carry the post-step tick as `birthTick` (`:433`, `:442`, `:406`).
   - World objects are stored by reference (`:244-246`, `:254-255`, `:279`, `:317`). If `world.ledger`, `world.environment` or `organism.genome` return live objects, stored frames would change as the run continues. `validateFrame` would then fail at the end.
   - Frame organisms must already be in id order (`:410`).

   A 25–40 tick smoke on the real `HungryWorld` through `validateTickRows` and `validateFrameLineage` would settle all four without being a pilot. Or the parent can check the model's getters and `birthTick` directly.
2. **Seed 1201 prefix against the real prior artifact.** Tests only cover the missing-proof and altered-identity cases. The `old.lateSummary.*` field names (`:462-467`) are only compared in `validateEvidenceStructure`, after all 6000 ticks. The in-loop checks at tick 0 and the late ticks (`:327-350`) fail early, but this one doesn't. Confirm those key names against the pinned prior file, or check that summary at tick 3000.
3. **The 15 MiB cap is checked only at the end** (`:323`). Frames alone are roughly 6–7 MB (301 frames, about 12 KB of food each plus cells), and the lineage is stored twice (final plus snapshots). I can't size the lineage from these four files. An early size estimate would avoid a wasted run.
4. **Viewer, minor.** `selectedRun` is set (`:326`) before `renderWindows` runs (`:340`). An exception there shows the error but leaves the run live for keyboard and resize handlers. Manifest decisions for seeds with no run entry are silently ignored (`:369-375`). Both are low risk because the file is digest-bound.
5. **Cosmetic.** Lines 298–299 are no-op blocks. Removing them changes the self-hash, which is fine since nothing has run yet.

I did not look at the scientific criteria, the CSS or any raw artifact JSON, as you asked.
