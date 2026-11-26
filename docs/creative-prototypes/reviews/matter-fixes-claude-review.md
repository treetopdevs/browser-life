**This review is static only.** This session has no shell tool. I ran no `--check`, `--replay-check`, vitest, typecheck, Playwright, build or hashing. Everything below comes from reading the code and tracing it by hand. I did not open the large JSON beyond a few targeted greps.

**Verdict:** I found no model, UI or packaging blockers. One item needs your decision before the final regeneration (item 1). The rest are non-blocking gaps.

## Needs your decision

1. **The artifact tests now only pass under Node 24.2.0.**
   - `explore.ts:527-528` compares the stored tick-0 state with `plainSnapshot(new MatterWorld(seed, mode).snapshot())`.
   - `snapshot()` embeds `runtime: runtimeLabel()` (`model.ts:428,436-438`), which is `"Node <version>"`. The stored state says `Node 24.2.0`, and the fresh one uses whatever Node is running.
   - `--check` pins 24.2.0, but both vitest files call `validateEvidenceStructure` with no pin, and I found no `.nvmrc` or `engines` entry.
   - Under any other Node, the artifact tests hit `tick-zero snapshot differs from the seeded constructor`. The "validates it when present" test in `matter-evidence.test.ts` fails outright. The tampering tests would fail on that same error instead of the one they expect.
   - This is new with the seeded-initial check. Compare with `runtime` stripped from both sides. Don't use `skipIf`, since that silently drops the validation.
   - Because it changes `explore.ts`, it changes the runner hash. Land it before the final regeneration, or defer it on purpose.

## Non-blocking gaps

2. **The 4096 source exhaustion is not pinned by any test.**
   - `matter.spec.ts:116` only checks reservoir `[32768,0,32768,0]` at tick 6000. No model test covers it either.
   - The exported history at 6000 has rows at 4050 and 4100. Asserting reservoir greater than 0 at 4050 and equal to 0 at 4100 would pin the tick.
   - Alternatively, add a model test with `reservoir: 32768` in rain mode, stepped to 4096.
3. **Fixture samples are checked less than batch samples.**
   - Ticks 1 to final−1 get only `validateCensus`, mode truth and extinction checks.
   - `validateSnapshot`'s sample-versus-history check at `:328-331` is skipped for fixtures, because `meta` has no `samples`.
   - `spread`, `relaxed`, `settled` and `colonizedTiles` are only range-checked, and `firstCounterIncrease` reads them.
   - Fixture samples also never check `census.tick === i`, which batch samples do at `:515`. For the closed growth fixture nothing else catches a wrong tick.
   - Cheap fixes: check `census.tick === i`, check counter monotonicity, and tie the empty fixture's sample at tick 50 to its history row.
4. **Interval activity values are only range-checked.** `meanAbsBChange` and `maskFlipFraction` are checked as finite and within bounds, and the late summary is recomputed from them. They are not tied to physics. An exact check is available: when both endpoint biomass totals are 0, both values must be 0. That is the whole pilot late window. `meanAbsBChange × 3072` is also at least `|ΔB total|`. Only `--replay-check` catches these today.
5. **Physical hashes between milestones attest only themselves.**
   - Only ticks 0, 1000, 2000 and 3000 are tied to retained state (`:548-551`).
   - The 8 and 32 markers are therefore authoritative only through `--replay-check`. That meets the "link to milestone snapshots" requirement, so I count it as a known limit, not a defect.
   - By hand, 32 is consistent with the rules. The first detritus from the tick-10 decay is recycled at tick 24, before it reaches y≥40. The tick-20 batch settles to y=41 by tick 32, and burial runs at tick 32.
6. **Model tests have thin spots.**
   - Nothing asserts that relaxation at y=0 does not leak to y=47. The varied-pattern test compares two identical worlds, so it checks determinism, not an oracle.
   - The donor budget is covered only indirectly, through `checkedDelta` throwing on a negative stock.
   - The light-edge test hand-traces correctly. Light centre is 1 at tick 10, so x=25 is lit at distance 24 and grows 4→5→4. x=26 is dark at distance 25 and goes 4→3→collapses. That gives growth 1, routine 2, threshold 3 and mortality 5.
7. **`matter-validation.md` is deliberately provisional.** It still says "remain in progress", "pending" and "being improved". Its counts do match the files: 16 model tests and 5 e2e tests. Update it after your final hash check.
   - `decisions.html` no longer contains "Implementation is in progress", so the earlier docs-lag item is closed.
   - `matter.md` matches the pilot table for the 790/1000/790 extinctions, the 534/964/548 sediment totals and the 8 and 32 divergence ticks.
   - I did not verify the sampled peaks 792/927/834 or the claim that biomass series match across modes. Both are in the JSON.

Nit: the fixture-failure branch of the Markdown emits four newlines (`:613`).

## Verified by static trace

- **Late summary.**
  - `:545` compares `run.lateActivity` with `lateActivity(run.finalHistory)`.
  - `finalHistory` must equal the final snapshot's history (`:539`).
  - `validateHistory` checks endpoints, activity ranges, interval counter deltas and monotonicity before that.
  - The window must span exactly 1000 ticks with endpoints at 2000 and 3000.
- **Fixtures.**
  - `validateFixtureEvidence` checks every sample's ledger, mode truth and extinction marker.
  - It checks the recipe at tick 0 and `finalCensus` against the final snapshot.
  - It checks history against the final snapshot, and recomputes `actual` and `passed`.
  - Fixture samples at tick 0 and at the end are tied to the snapshots.
- **Immutable phases and initial stocks.** `:450` and `:531-536` cover them.
- **Extinction.**
  - `assertExtinctionAt` runs on samples, history and snapshots, plus the final marker check at `:530`.
  - An off-cadence extinction tick needs its own sample row, so a tampered tick fails the row count. An on-cadence tick fails against the previous sample's biomass.
- **Mode truth on every observation.** Disabled exchange is zero. The rain import equals `min(32768, 64·⌊t/8⌋)`. The 24000/8768 endpoint holds.
- **Seeded initial state.** `:526-528` check it, apart from the Node coupling in item 1. Initial hashes and `physicalHashes[0]` are equal across the four modes of a seed.
- **`physicalHashes`.**
  - Each run has 3001 hex entries, and ticks 0/1000/2000/3000 are checked against `physicalHashFromState`. The hash covers N, B, D, reservoir and sediment only.
  - Markers are compared by strict equality with a recomputation (`:558-564`). A null on an applicable row is rejected, and a non-null on the closed row is rejected.
  - The artifact has 12 `physicalHashes` arrays. Its marker pattern matches the table: rain 8, burial 32, rain-burial 8 with burial/control 32, closed and rain null.
- **Markdown.**
  - Headers have no `|` (`:601`), and `table()` asserts the layout.
  - The table is followed by `\n\n` and then the paragraph (`:613-614`).
  - `n/a` is used where a comparison doesn't apply (`:591-593`). The artifact test expects 9, and the saved `matter-pilot.md` shows 9.
  - Markdown is built before either write (`:618-624`).
- **UI.**
  - It uses one reused 64×48 `ImageData` on an offscreen canvas, drawn with `imageSmoothingEnabled=false`. CSS also sets `image-rendering:pixelated`.
  - Two history strips per card use `niceCeiling` over all four cards' census and history. The scale labels read "· shared" and the heading says "shared axes across all four tanks".
  - The initial ceilings of 200 and 10 match what e2e test 1 asserts.
  - The frame budget computes `ticks` as an integer once. The cap of 4 is reachable: `(4·d+1e-7)/d` floors to 4, and the accumulator returns to 0.
  - I traced e2e test 2 through the frame loop: frame 68 gives 4 ticks and frame 135 gives 8.
  - Bar labels read "Reservoir · not connected" on cards 1 and 3 (`index.html:61,85`), and "Rain remaining" on cards 2 and 4.
- **E2E.**
  - Test 3 drives the real loop from the extinction at 790 to 6000, using 4 ticks per frame, which is about 1500 of the 2300 allowed frames. Play and Step end up disabled, every extinction banner shows 790, and snapshots are frozen after an extra frame.
  - The export asserts `runtime: 'browser'`.
  - `/favicon.svg` exists in `apps/lab/public`. Test 1 fails on any console error, so a favicon 404 would be caught.
- **Source hashes.** The JSON's `model.ts` hash is `e4d0ef43…8bea`, the frozen value. The runner hash in the JSON is `e2383ad6…b2ec`. I can't hash the current bytes, so your independent source-freshness check is still the authority.
