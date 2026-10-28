**Verdict:** I found no physics defect. The model matches the plan: z is real state, all neighbour/food/placement deltas use `torusDelta` on all three axes, speed uses the 3D norm, the energy ledger balances, and the constants match 2D v4 apart from the declared changes. Render is independent of the model, and the production-exclusion changes (`Dockerfile.site`, `Caddyfile`, `public-routes`, Vite) look right. I read everything and ran nothing. The defects are in the page and the evidence tool.

**Defects, most severe first**

1. **The 6000-tick cap is not enforced.** `page.ts:145` calls `world.step(wholeTicks)` with up to 16 ticks and never clamps to `6000 - world.tick`. A frame that starts at tick 5995 can finish at 6003. The page then shows "6,003 / 6,000", and the export says `tick: 6003, complete: true`. The plan's "cap interactive horizon 6000" is violated.

2. **The status line goes blank after a manual pause.** The Play click sets `pauseReason = ''` (`page.ts:110`), and `updateStatus` shows `paused ? pauseReason : 'Running'`. Play then Pause leaves the `role=status` text empty. No e2e test covers it.

3. **The history chart invents a data point.** `page.ts:58`: after tick 3000 the 300-sample history starts at `tick-2990`, which is later than `rangeStart`. The code then unshifts the current census stamped at `rangeStart`. The left edge of the "recent 3,000 ticks" chart therefore shows today's counts, not recorded ones.

4. **Late births/deaths deltas are off by one step (`explore.ts:116`).**
   - The baseline is taken after step 5001, so step 5001's births and deaths are dropped.
   - The extinction step falls into the non-living branch, so its deaths are excluded as well.
   - The plan says "delta over the actually executed window".
   - The baseline should be the counters at tick 5000, and the end value should be the final executed step.

5. **The validator does not enforce census cadence completeness (`explore.ts:166`).** It only requires strictly increasing ticks that are multiples of 100 or the final tick. A file with samples `[0,100,6000]` passes. The test named "exact census cadence" only mutates a tick to 201.

6. **Evidence summaries are thinner than the plan, and the report text overclaims.**
   - Not summarised anywhere:
     - an early-window occupancy/motion summary (only raw 100-tick samples);
     - family extinctions;
     - a flag for "depth-band occupancy stays 1 or z motion is 0".
   - Present in the JSON but missing from the Markdown table: late `meanAbsVz`, the z/horizontal ratio, cap fraction, population range, and the births/deaths deltas.
   - The Markdown says "Early and late spatial occupancy are observations", but no early figure is reported.

7. **A wrong Node version invalidates good evidence.** The Node 24 assert sits inside `runPilot`, which runs inside the failure-writing `try` (`explore.ts:131`). Running it on the wrong runtime writes `spatial-pilot.failure.json`, and `--check` then rejects a valid batch. The runtime check should happen before the `try`.

8. **Displayed numbers lag the canvas by up to 9 ticks.** `updateMetrics` only fires every 10 ticks or more (`page.ts:148`), while `draw()` runs every stepping frame. The Tick, population and births labels trail the picture, and "displayed" can exceed "living". The plan says the tick label is authoritative.

9. **Smaller plan deviations.**
   - Changing preset, seed or mutation does nothing until "Start new world" is submitted. The plan says these toggles reset the world.
   - The export's `complete` is true for an extinct world, with no separate `extinct` field. The plan wanted stopped tick and requested horizon distinguished.

**Test gaps**
- Slice filtering inside `drawSpatialWorld` is never tested, only the `isInDepthSlice` helper. The e2e only checks that `#displayed` matches `/\d+/`, so it would pass even if the slice did nothing.
- The chunking replay test uses `mutation=false` only, and runs just 240 ticks.
- No browser test covers playback pacing, play/pause status, reset, or the horizon completion state. Defects 1 and 2 slip through for that reason.
