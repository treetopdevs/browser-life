**Verdict: not cleared. There is one blocker, and the fix is test-only.** I ran nothing, as instructed. I used 12 reads and searches. I did not read `moving-food-validation.md`, the CSS, the e2e spec, or viewer lines 1–326 (grep only). `moving-food-implementation-claude.md` is empty (0 lines), so there is no review file yet.

**Blocker: the plan-required geometry and pulse tests are incomplete.** The model code reads correct, but the resolutions require a unit test for wrap, the fixed-left coverage, per-pulse 768 offered and conservation. `apps/lab/test/moving-food-model.test.ts` covers only part of that.
- **Tile-column wrap is never tested.** The geometry test uses ticks 0, 50 and 4800, which give left edges 0, 1 and 0, so `(localX+left)%96` never exceeds 95. Add the tick 2995 case (left 59, `tiles[47]===10`) and the tick 3000 case (left 60).
- **The tick-50 handoff is never tested through a world.** The only world test checks that pulse 1 at tick 5 sums to 768. `supplyFood` runs after `_tick++` (`model.ts:518-519`), so the tick-50 pulse should use left 1, and I confirmed that by reading. Nothing would catch an off-by-one there, because replay-check only compares the runner against itself.
- **The model path is never tied to the helper.** Per-pulse conservation is tested for one pulse only.

Add these four tests without editing `model.ts`, so the pinned hash `b7aa0a3f…` stays valid:
1. Step a food-0 fixture to tick 45. Every increment must be in columns 0–47, and `bandLeft` must be 0.
2. Step to tick 50. Every increment of that pulse must be in columns 1–48, with at least one in column 48, which is impossible if left were 0. Offered must be 768 and `ledger.residual` must be 0.
3. For pulses 0–11, the per-tile increments must equal the multiset from `movingBandPulseTargetTile`.
4. `offered === 768*pulses` and `accepted + overflow === offered` after those pulses.

**Checked against the plan, no regression found**
- **Model diff:** `diff` against `uniform-endurance/model.ts` shows only the food-mode surface plus provenance comments. That covers the `FoodMode` type, the optional `bandLeft`/`bandWidth`, the helpers, the target list, the environment and `foodTargets` getters, and the one tile expression in `supplyFood`.
- **No RNG, no new cursor:** the destination is computed from `(pulse, slot, seed, tick)`. The index formula matches the uniform formula, and 2053 is coprime to 4608.
- **Uniform path:** the uniform environment key order is unchanged, so old JSON and hashes should be byte-identical.
- **Runner:** `parseArgs` accepts only `--write`, `--check` or `--replay-check` with `--seed 1201`. Import does not run it. Overwrite is refused up front and written with `wx`.
- **Prefix check:** the uniform prefix compares all 151 samples (census, state, environment), frame projections and 3000 tick rows. It also compares full snapshot 0, with no normalization.
- **Sources and baseline:** inputs are pinned, source hashes are re-checked before and after, and the old endurance `--check` runs before the write. The baseline run is read from the pinned 9000-tick record, while the new schema uses 3000.
- **Mode, schema and joins:** moving-band keys are strict and uniform keys stay exact. Environment mode, band position and food accounting are checked in every sample and snapshot. Frame, census, history, lineage and energy joins are present. Dropped history or lineage fails.
- **Early extinction and windows:** the terminal sample and snapshot are forced, `expectedSampleTicks`/`expectedSnapshotTicks` handle off-cadence extinction, and there are no post-extinction ticks. Windows with no executed ticks are all-null and fail the gate. A partial window uses its actual endpoint, and `occupiedBandCells` uses `floor(endpoint/50)%96` in both arms.
- **Repeat and size:** an independent repeat world is compared per tick (census, environment, row), and full state and frame at every sample. The 24 MiB cap fails closed.
- **Viewer:** it shows actual ticks and labels the terminal hold. The band is drawn as an outline only. The pair index and decision must match the raw SHA-256 of both arms, otherwise it shows an error. Pending is the default.

**Non-blocking**
- **No pair index writer:** nothing generates the pair index or receipt. It is hand-made after the run, and the viewer validates it. `moving-food-validation.md` should say how it is made.
- **Decision status not cross-checked:** the viewer does not check `decision.status` against the arm gates. That is fine, since the visual call is the parent's.
- **Accepted-food display unconfirmed:** I confirmed the offered, overflow and remaining displays but did not confirm the accepted one.
- **Unverified:** I saw no `vitest`, typecheck, `assertPinnedInputs` or e2e results. The `assertPinnedInputs` test and the pinned model hash are therefore unverified.

After the four tests are added and `pnpm vitest run apps/lab/test/moving-food-model.test.ts tools/test/moving-food-evidence.test.ts` and typecheck pass, I'd clear the first-seed pilot.
