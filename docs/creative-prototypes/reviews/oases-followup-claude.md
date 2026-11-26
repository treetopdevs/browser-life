**Static review only.** I executed nothing, read none of the pilot, observation or history JSON, and did not view the WebM files. I read only the nine listed sources.

## Actionable findings, all low severity

1. **`apps/lab/src/particles/oases.ts:12-13`: the speed labels have no unit.**
   - They read `travelling at 0.0001 per tick`, while `oases.md:5` says "world widths per tick".
   - Repair: change both labels to `travelling at 0.0001 world widths per tick` and `travelling at 0.00025 world widths per tick`.
   - `oases-pilot.md:3` and the speed column of `oases-flocks.md` also give bare numbers. If the parent is pinning the unit, one clause there covers them.

2. **`oases-flocks.md` states no runtime or rules version.** `oases-pilot.md:3` says "Runtime v24.2.0; toy rules version 3", and replay is same-runtime only. The JSON records both. Add the same clause to `oases-flocks.md` line 3 or 21.

3. **The stated trigger differs between the report and the runner.**
   - `oases-flocks.md:3` says flocks "responded more strongly than pursuit".
   - `explore-oases-flocks.ts:32` (`reason`) says "lower flock populations under moving food".
   - Both are consistent with the visual check, but a reader of the two artifacts gets different motivations. Make the runner's `reason` the neutral version.
   - Changing it alters the JSON on the next run, so only do it if the parent reruns anyway. Otherwise leave the report as is.

4. **"Six-run" does not match the runner.** You described it as a six-run followup. The runner and report are nine runs (3 seeds × 3 environments), so keep "six-run" out of commit messages and docs.

5. **Conditional: a world that goes extinct inside the visible window may chart as a slope.** This is `oases.ts:136-140`.
   - For `rangeStart < e ≤ rangeEnd`, nothing inserts a zero sample at `e`. Line 140 only adds a zero at `rangeEnd`.
   - If `world.history` has no sample at the extinction tick, the line slopes from the last pre-extinction sample down to `rangeEnd`. That is up to about 3,000 ticks of apparent gradual decline instead of a step at `e`.
   - Whether this is real depends on `model.ts`'s `history.push` condition. It is outside your bounded list, so I did not check it.
   - Repair, if it is real: when `extinctionTicks[index]` is `e` with `rangeStart < e ≤ rangeEnd` and no sample has `tick === e`, insert `{...world.census(), tick: e}` before the line-140 push.

## Checked and found correct (static)

- **Chart left boundary (`oases.ts:136-138`).**
  - When extinction is at or before `rangeStart`, the filtered samples are empty. The `unshift` at `rangeStart` plus the push at `rangeEnd` give a flat zero line across the whole window.
  - The `some(tick === rangeStart)` guard avoids a duplicate when `e == rangeStart`.
  - With `span === 0`, `x` is `width`, so a lone point strokes nothing. That is harmless.
- **Chart aspect ratio.**
  - `aspect-ratio:3.6` in the CSS, the 540×150 canvas attributes and `height = round(width/3.6)` at `oases.ts:50` agree.
  - CSS governs the layout size, so writing the canvas attributes should not re-trigger the `ResizeObserver`.
  - I did not verify this in a browser. The "verified by desktop and phone browser checks" claim in `oases-visual-check.md:17` is the parent's, not mine.
  - I also did not read `picker.css`, so a competing `.world canvas` rule is unchecked. `.world .world-history` has specificity (0,2,0), so it should win.
- **Flocks runner and report.**
  - The runner is well defined: seeds 1201-1203, the three environments, 6,000 ticks, a census every 100, mutation on, and an extra census at extinction.
  - `--check` compares the hashes of `model.ts` and the runner plus the rules version, and neither simulates nor writes.
  - The report's scope is honest: post-observation, not a preselected improvement claim, no adaptation claim, and the steering disclosure is present.
  - All nine rows' family counts sum to the stated final population.
  - The prose matches the table:
    - The faster arm ends lower in seeds 1201 and 1202 and higher in 1203.
    - Both moving arms keep Lilac in 1203, where the still world loses it.
    - Amber is lost in all three arms of 1202.
  - The table's 6,000-tick populations agree with the visual check's 6,001-tick counters (126/106/80 against 126/107/81) to within a tick.
  - I did not cross-check the "first absent at census N" column against the JSON.
- **Receipt binding.**
  - The checker records SHA-256 of the raw bytes of each pair before it deletes anything from the parsed copies.
  - Line 3 reuses the same v2 historical SHA as line 1, so source and target are bound.
  - It requires both artifacts to record the executing runtime, and it deep-compares everything except the listed exclusions.
  - The 93 compared censuses equal 31 censuses (ticks 0 to 3000) × 3 seeds, with `exactMatch: true` and runtime v24.2.0.
  - `oases-pilot.md:23` describes the receipt as the script's stdout, and the three lines match the three `console.log` calls.
  - Not verified: that the recorded `currentSha256` values match the on-disk files. `pilot.json` and `picker-pilot.json` show as modified in git status, so the receipt should be regenerated after their last edit.
- **Recording paths and provenance.**
  - `oases-visual-check.md:19-26` lists the PNGs, WebMs and observation JSON under gitignored `runs/oases/`.
  - `oases-pilot.md:21` states the recordings are not shipped in the PR. That resolves the prior missing-link item.
  - The visual check says the screenshots were inspected as PNG pairs, not as continuous playback. Treat it only as screenshot evidence.

## Verdict

There are no correctness or security findings. Items 1-4 are wording and labelling polish. Item 5 is the only behavioural one, and it holds only if `model.ts` doesn't record a sample at the extinction tick.
