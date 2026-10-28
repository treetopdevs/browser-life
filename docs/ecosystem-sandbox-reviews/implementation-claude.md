# Review: ecosystem sandbox (static read; no tests, typecheck or build run)

I had only read tools, so none of the checks have run. The review file `docs/ecosystem-sandbox-reviews/implementation-claude.md` is empty. I couldn't write to it, so these findings are only in this reply.

`docs/ecosystem-sandbox-exploration.json` read as empty for a moment mid-review and then had content again. Something is regenerating it, so wait for that to finish before you commit it. In the populated version, seed 1101 staged matches the doc table (8421 population, 72 classes). I did not check the other five rows.

No blockers for a playable toy. Findings 1–5 change behavior or claims, so fix them and rerun the exploration before you commit the table.

## Medium

1. **Movers become unattackable for the rest of the tick.** `model.ts:148` sets `c.born = this.tick` when a cell moves, and `model.ts:149` skips any `other.born === this.tick`.
   - A wandering cell gains a free shield. Exported `born` also stops meaning birth tick.
   - Fix: add a separate per-tick "acted" marker (e.g. a `Uint32Array`) and shield only true newborns and introduced cells. Add a test.

2. **"Step once" and export distort the recorded history.** `main.ts:50` calls `sim.sample()` after every step, and pause and export (`main.ts:49`, `main.ts:62`) call it too.
   - `sample()` has side effects: it pushes history, fires notices and updates peaks (`model.ts:156-174`).
   - About 300 manual steps evict the whole 3000-tick window.
   - The chart x-axis is index-based (`main.ts:41`), so uneven samples are drawn as evenly spaced.
   - Census notices fire off-cadence, so the exported record depends on how the user clicked. Physical state is unaffected, because `sample()` draws no RNG.
   - Fix: split pure census from recording, or sample only on `tick % 10`, and make the chart x-axis tick-based.

3. **Mean attack/defense blends family composition with real drift.** `main.ts:33`
   - In the 1101 staged run the final means are attack 0.73 and defense 1.37. The unstaged run ends at 1.76 and 0.98.
   - Protected cells are about 35% of the population (2932 of 8421) and start at attack 1, defense 3. That composition shift likely explains much of the gap.
   - The page labels this "Inherited strategies". Show per-family means, or relabel the number.
   - Mean attack was still falling at tick 3000, from about 2.65 at tick 200 down to 0.73. I haven't run it, but a 20k-tick run is worth doing to see whether traits collapse toward a=0.

4. **A replant can print a false "recovered" notice.** `introduce()` clears `depleted` (`model.ts:111`) but keeps `peaks`.
   - The next `sample()` re-flags the family as depleted (`model.ts:166`), because 24 cells is under 20% of the old peak. It later prints "recovered…" (`model.ts:167`) after the user's own replant.
   - This contradicts the page's "No family is secretly revived" claim. Reset `peaks[family]` on introduction and add a test.

5. **Streams from `seed ^ k` overlap across the exploration seeds.** `model.ts:56-57`
   - 1101's schedule stream is `rng(1100)`, which is also 1103's combat stream.
   - 1101's birth stream is `rng(1103)`, which is also 1102's schedule stream.
   - Trajectories still differ, but "3 fixed seeds" is weaker than it reads. Mix the seed before deriving the streams.
   - Doing so invalidates the exploration JSON and the table in `docs/ecosystem-sandbox.md:17`.

6. **Manual interventions are logged lossily.** Plan line 11 says "Changes mid-run are recorded".
   - The only record is `notices`, capped at 100 (`model.ts:76`). The export's `settings` (`model.ts:177`) shows only the current toggle values.
   - Long runs drop the very interventions that explain a trajectory.
   - Add a small separate `interventions: [{tick, kind, args}]` list. Manual droughts and plantings also consume the weather and introduction streams.

7. **`/ecosystem/` ships on the next site deploy.** `vite.config.ts:167` adds it to the build inputs, which conflicts with "No deployment".
   - If you intend a hidden route like `/garden/`, add it to `ROUTES` in `tests/e2e/public-a11y.spec.ts`.
   - Otherwise drop it from `rollupOptions.input`, since the dev server serves it either way.

## Low

8. **Firefox form restore can make the controls lie.** On reload, Firefox restores checkbox and seed values. `main.ts` never syncs them to the new `Ecosystem()`, so an unchecked Mutation box can sit over a mutating sim.

9. **The `summary` live region announces constantly.** `index.html:12` and `main.ts:29-31` update it every 1.5 s with changing counts, which is screen-reader spam.

10. **Chart scale hides the hunter arc.** The fixed 0–9216 scale (`main.ts:41`) flattens Protected and Hunter (about 500–900 cells) into a thin strip. Autoscale or use a log scale. There are also no intervention markers.

11. **The "frozen" gate counts predation births.** Predation calls `offspring()` with no `birthThreshold` check (`model.ts:150-151`), so `births` includes kills. `tools/ecosystem/explore.ts:9` can pass while empty-site reproduction has stalled.
    - The lattice is also about 80–91% full, which sits oddly with the caption "room to grow" (`index.html:11`).
    - Say on the page that kills spawn offspring regardless of energy and add +3 energy from nowhere.

12. **Seasonal drought overwrites an active manual drought.** `model.ts:131`, with no "Rain returns" notice.

13. **Reset logs "(manual)" option notices at tick 0.** `main.ts:55`, for carried-over unchecked boxes. A manual introduction before tick 100 also silently suppresses the staged one (`model.ts:91`).

14. **"Fast" (120 ticks/s) may be unreachable.** The 10 ms per-frame cap and `debt ≤ 12` (`main.ts:66-71`) limit it. Show achieved ticks per second or soften the label. Check that the e2e 20 s wait for tick 300 has margin on your machine.

15. **Hunters always spawn at the first protected cell by index.** `model.ts:99` uses `findIndex`, so it is deterministic but biased toward the top-left. Pick a random protected cell with the `introduction` stream.

16. **Trig results may differ across browser engines.** `Math.sin`, `Math.cos` and `Math.hypot` feed fertility and drought (`model.ts:63`, `model.ts:72`). The "same browser" wording is honest, but the docs' Node-24 reproduction line (`ecosystem-sandbox.md:23`) only holds for V8.

17. **Refuge geometry is duplicated.** The 0.28/0.35/0.73/0.68/0.13 constants are hard-coded in `main.ts:18` and `model.ts:64` and can drift apart. Export them from the model.

18. **Minor cleanup.**
    - The ternary in `dry()` is always true (`model.ts:87`).
    - `tools/` is outside the typecheck `include` (`tsconfig.json:26`), so `explore.ts` isn't typechecked. Note this in its header.
    - The plan's baseline numbers (plan line 35) are v1 and superseded by the v2 section. Mark them stale.

## Test and validation gaps
- **Vacuous assertion:** `ecosystem.test.ts:15` uses `.every` on cells and passes on an extinct lattice. Assert population > 0.
- **Missing tests:**
  - immunity applied inside `step()`, not only in `attackChance`
  - refuge effect in a step
  - introduction target selection
  - mutation reflection at 0 and 4
  - `sample()` leaving the trajectory unchanged
  - constructor seed and size validation
  - mover and newborn shielding (finding 1)
- **No drift pin:** nothing pins seed 1101 at size 96 for about 500 ticks, so a `RULES` change silently stales the JSON and table.
- **E2E gaps:** it never checks the exported JSON content, seed-validation errors, the non-reduced-motion autoplay path, or hidden-tab suspension.
- **Missing ablations:** the exploration has none (mutation off, immunity off, seasons off), so it can't show that mutation or the special immunity cause the interesting behavior.

## Checked and correct
- The `canAttack` table matches the page prose and the plan.
- The immunity rule, upkeep inequality (4/4 costs 2.85, above uptake 2.4), refuge ×0.25 and newborn deferral all match.
- Mutation trait draws are consumed whether mutation is on or off, so toggling it doesn't shift the RNG streams.
- The page has `noindex` and no canonical link, so `withSocialMeta` leaves it alone.

## Verify yourself
`pnpm typecheck`, `pnpm vitest run apps/lab/test/ecosystem.test.ts`, and `npx playwright test tests/e2e/ecosystem.spec.ts`. Also run a Vite build of `apps/lab` to confirm the new rollup input still builds.
