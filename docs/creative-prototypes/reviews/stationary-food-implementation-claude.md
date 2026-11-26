**No blockers found in the core runner (model, `explore.ts`, pins). One pre-run process item and a few companion gaps are below.** I made no edits and ran no simulations or tests. I read the sources, diffs and test bodies, plus test titles for the two diagnostics/evidence suites, and checked hashes with `shasum`.

## Core runner: clear

- **Model diff** (`stationary-food/model.ts` vs `moving-food/model.ts`): +21/−8, all of it additive.
  - It adds the `'stationary-band'` mode, `stationaryBandGeometry()`, `isStationaryBandTile()` and the validator branch.
  - It sets `foodTargetTiles('stationary-band')` to `movingBandTargetTile(i, 0)`.
  - It sets the environment to `bandLeft: 0`, `bandWidth: 48`.
  - The `supplyFood` body is unchanged, so the stride 2053, seed rotation and pulse index are the same as moving. `targetIndex` is the same formula and no RNG calls were added.
  - The `foodTargets` getter falls through to the frozen copy, which is correct.
- **Provenance:** all four pins match what is on disk.
  - The moving model SHA is `b7aa0a3f…`.
  - The replication `explore.ts` SHA is `a8403864…`.
  - The baseline JSON is `183d90f5…`.
  - The plan SHA is `ba835f94…` and equals the blob at `690d8d3f`.
- **Existing files:** the only tracked change is `decisions.html`, one line, which the plan expects. Nothing historical was touched.
- **Runner vs the moving replication runner:** the only changes are the stationary mode and renames.
  - `parseArgs` and `writeEvidence` reject any seed except 1202.
  - Evidence kind is `hungry-shapes-stationary-food-arm`.
  - Mode-specific band checks apply to the environment and `bandLeft`.
  - The prefix is `not-applicable` for stationary and `verified` for moving.
  - `legacyCheck` runs the old runner's `--check` on 1202.
  - There is a no-overwrite `wx` write, a 24 MiB cap, and a check that the loaded sources haven't changed.
- **Moving regression:** the moving arm compares 151 samples, 151 frames and 3000 tick rows live. It compares all 5 snapshots (0/500/1500/2500/3000) in `validateEvidenceStructure`, which `runArm` calls before returning. There is no normalization. The check uses `same()` on the full state, so it is exact.
- **Repeat and gates:**
  - The repeat arm is initialized independently and compared at each capture, which is every 20 ticks plus the terminal tick.
  - The gate matches the plan: alive at 3000, at least 2 nonzero families, births and deaths positive in each of the windows 1501–2000, 2001–2500 and 2501–3000, and at most 99 cap-48 ticks per window.
  - The diagnostic counts occupied tiles in each arm's own band.
- **Model tests:** they cover target creation, the getter, the environment and supply.
  - They check equal snapshots, food bytes and environment (minus the mode label) for ticks 1–49, with 9 pulses at tick 45.
  - Tick 50 is the first divergence.
  - They also check the left edge at the wrap (4799/4800).

## Needs action before the first outcome run (process, not code)

1. **Attempt logging.**
   - `writeEvidence` holds both arms in memory and writes only after both finish. The runner has no attempts file; the predecessor had `moving-food-replication-attempts.json`.
   - A moving-prefix mismatch or any invariant failure throws and leaves nothing on disk. The plan requires every attempt to be logged and failed attempts preserved.
   - Capture stdout/stderr and record an attempts entry before any retry, or add a tiny append-only log. The moving arm runs first, so a regression mismatch halts before any stationary result exists, which is the correct order.
2. **Commit order.** The runner, model and tests are untracked. The plan says to commit the reviewed runner before outcomes, so commit these first. `explore.ts` hashes itself at load, but nothing pins the committed SHA.
3. **Run the checks I didn't run.** Use nvm Node 24.2 for `pnpm vitest run tools/test/stationary-food-*.test.ts` and `pnpm typecheck`. The model test steps about 50 ticks, which is not an outcome run. `explore.ts --check` should fail only on the missing pilot files.

## Minor, non-blocking

- Add one supply assertion past tick 50: for a stationary world at about tick 120, food in columns 48 and up never exceeds the initial 20. Today the supply-after-50 path is covered only by "food differs from moving".
- `comparableEnvironment(mode, …)` in `stationary-food-model.test.ts` has an unused `mode` parameter.

## Companion (can finish while this runs)

- `stationary-food-index-1202.json`, the pair manifest, and `stationary-food-visual-receipt-1202.json` don't exist yet, which is expected. The diagnostics helper already requires the receipt to be committed first and rejects one modified after commit. It also rejects a pending decision, and it checks that the receipt and manifest agree on seed, plan, mode, path and hash. I read these only from the test titles and the helper's file paths.
- I did not read the viewer, `stationary-food.html` or the e2e spec. Their fixtures need the same fail-closed checks, and the visual-pass flags need both saved endpoints. The predecessor viewer had that requirement, and its e2e once contradicted the viewer.
- I did not check the `index.json` producer or the schema of the pair manifest and receipt. The diagnostics helper expects `kind: 'hungry-shapes-stationary-food-pair'`.
