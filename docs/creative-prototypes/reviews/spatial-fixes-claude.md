**Verdict:** the ten items you listed are closed in the current tree. I found one low-severity defect and two non-blocking gaps. This is a static review. The only thing I ran was `vitest run tools/test/spatial-evidence.test.ts apps/lab/test/spatial-render.test.ts`, which passed 9/9 and runs no pilot. I did not read or `--check` the pilot output, even though `spatial-pilot.json` and `.md` now exist, untracked.

**Closure**
- **CLI import guard:** closed. `explore.ts:341` runs the CLI only when it is the main module. The usage check and the Node 24 check both come before the `try`, so a wrong runtime or bad flag no longer writes a failure record.
- **Replay repeat shape:** closed. The replay compares the primary against the stored outcome without `repeat` (`:333`). It compares `repeatRecord(repeated)` against `expected.repeat` (`:335`), so the two sides now have the same fields.
- **Late boundary and extinction accounting:** closed.
  - Baselines are the counters at tick 5000 (and 0 for early), taken before the step (`:122-123`).
  - `accumulateWindow` records births, deaths and population range on every executed step, including the extinction step. Only the motion and occupancy means skip non-living steps.
  - `validateWindow` expects 51 executed steps for extinction at 5051, and the fixture uses 51/50.
- **Exact census and full-snapshot validation:** closed. The census tick list must equal 0, every 100, and the final tick (`:225-228`). Snapshots must be full observations: particle inventory, food, ledger, rules and settings, with census, energy, occupancy and motion recomputed from the particles. The census-only case now fails with "particle inventory missing". I traced the fixtures by hand and they pass.
- **Invalid runtime:** closed, as above.
- **Real history and actual labels:** closed. The chart range starts at `max(requestedStart, history[0].tick)`. The only synthetic point is the current census, which is correctly stamped at the current tick. The label shows the true range.
- **Manual pause:** closed. Play then Pause reads "Paused by you", and the e2e test checks it.
- **6000 cap:** closed. `page.ts:148-150` clips each batch to `6000 - tick`. The Step button is guarded, and an e2e test covers stopping at 6,000.
- **Export:** closed. It records `requestedHorizon`, `stoppedTick`, `extinct` and `horizonReached`.
- **Slice filter:** closed at the e2e level only (see the second note below).
- **Displayed-number lag:** also closed. Metrics and draw now update together on every stepping frame.

**Remaining defect (low)**
- `explore.ts:309` calls `HORIZON.toLocaleString()` and `LATE_FROM/LATE_TO.toLocaleString()` with no locale. `--check` and `--replay-check` compare the Markdown byte for byte (`:315`, `:328`). A pilot written under one locale would be rejected under another, for example "6,000" vs "6.000". Pass `'en-US'`, as `page.ts` already does.

**Non-blocking gaps**
- `validateWindow` does not tie `birthsDelta`, `deathsDelta`, `finalPopulation` or the population range to the retained census samples. A wrong late-window count would pass `--check`, and only `--replay-check` would catch it.
- No unit test covers the slice filter inside `drawSpatialWorld`. The e2e (`spatial.spec.ts:40`) only asserts `displayed < population`. That would still pass if the filter selected the outside of the slice or got the seam wrong.
