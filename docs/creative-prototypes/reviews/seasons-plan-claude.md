**Reviewer:** Sonnet 5.5 (`claude-sonnet-5-5`), high effort. Read-only. I read the six listed files, plus `tools/particles/explore-oases.ts` and targeted greps of the vite config, Dockerfile, tests and compatibility check. I did not open any JSON or review logs.

**No blocking issues remain in the mechanics.** The phase and renewal arithmetic is sound. The blockers below are plan omissions that would break typecheck, CI or packaging, or leak a diagnostic route. All have small fixes.

Checked and fine:
- The phase formula agrees with the code, since `this.tick++` runs before renewal (`model.ts:96-98`).
- Row `floor(i/3)` matches patch push order (`model.ts:81`).
- The multipliers sum to 3 per three-patch row, so offered renewal is 9·r.
- `extinctionTicks[i] = nextTick` equals `world.tick` for any world that was live (`comparison-clock.ts:10`).
- Boundaries at ticks 600 and 1800 land on the 100-tick census cadence.
- Six short and two long cycles in 10,800 ticks is correct.

## Must-fix

1. **`moveFoodPatches` breaks on a seasonal environment.** `model.ts:20` returns early only for `'still'`. A `'seasonal'` environment reaches `environment.speed`, which fails typecheck. If that were bypassed, `wrap(x + dir * undefined)` would turn every patch `x` into NaN.
   - *Fix:* the plan should require `if (environment.kind !== 'travelling') return;`.
   - Also state that `validateEnvironment` takes exactly the keys `kind,period` with period 600|1800, frozen, and rejects extra keys.

2. **Phase helper and clock source.** The plan says a dead world has "frozen phase" but not which clock drives it. `comparison-clock.ts:8` freezes `world.tick`, while `comparisonTick` keeps running.
   - Phase at tick 0 is also hazardous: `floor(-1/600) % 3` is `-1` in JS.
   - "Current regime" at an exact boundary (tick 600) is ambiguous: end of phase 0, or start of phase 1.
   - The sentence "Row (floor(i/3)−phase+3)%3 receives [1.75,1,0.25]" has two readings, which are opposite rotations.
   - *Fix:* export one pure helper from `model.ts`, e.g. `renewalMultiplier(env, step, patchIndex)` (step ≥ 1), meaning multiplier `M[(floor(i/3) − phase + 3) % 3]`.
   - Use that one helper in `advance()`, the renderer, the export and the evidence script.
   - The UI derives regime and countdown from `world.tick`, never `comparisonTick`. Define the display as the regime of step `world.tick+1` for live worlds (phase 0 at tick 0), and the regime of the last step for an extinct world. Add a unit test at ticks 0, 1, 600, 601, 1800, 1801.
   - Branch the renewal line for seasonal. Don't multiply still/travelling by 1.

3. **Version bump chain.**
   - `comparison.ts:60` accepts only `2` and `RULES.version`. The plan needs `{2,3,4}`, and the rebuild-under-declared-version path must be tested for 3.
   - `apps/lab/test/particle-comparison.test.ts:57` expects `modelVersion` 3 after a 2→3 migration.
   - The same file at lines 63–64 asserts that version 4 is unsupported, so it must be rewritten (use 5 as the unsupported value).
   - The `picker.ts:183` notice says "no moving-environment choices were inferred". Check that it stays truthful, and say what happens to a v3 file that carries no environment.

4. **Packaging and diagnostic exclusion is enumerated, not pattern-based.**
   - `Dockerfile.site:6` removes chunks by name: `particles-*`, `particlePicker-*`, `particleOases-*`.
   - `tests/e2e/public-routes.spec.ts:20` lists the diagnostic routes explicitly.
   - `vite.config.ts:157-158` pins chunk names only for `model.ts` and `comparison-clock.ts`.
   - A new `particleSeasons` input would leak its JS and CSS under `assets/`.
   - Extracting the renderer from `oases.ts` into a shared module creates a hashed shared chunk that none of the globs match.
   - *Fix:* the plan should list four edits:
     - the vite input;
     - the Dockerfile `rm` additions;
     - the `DIAGNOSTIC` entry;
     - a `manualChunks` rule (or a `particles-` name) for the shared renderer.
   - Run the production packaging smoke against the built `dist`, and check `tools/test/*deployment*` for pins of the Dockerfile line.

5. **Evidence freshness and compatibility.**
   - `explore-oases.ts:24` does `deepStrictEqual(saved.rules, RULES)`, and the other pilots check `rulesVersion` and source hashes of `model.ts`. The bump therefore stales the default, picker, oases and flock evidence, not just the new one. The plan should list every artifact to regenerate and every `--check` to rerun.
   - `check-still-compatibility.ts:17` requires the same `process.version` as the baseline, so regenerate on the same Node 24.
   - Lines 21–22 strip only `rules.version` and `modelVersion`. Verify that `sourceHashes` and the other provenance fields are in its `omitted` set. I could not see where `omitted` is defined, so confirm it. Otherwise the "full numerical equality" claim fails trivially, or is weakened.
   - Specify that the v3→v4 comparison covers the oases pilot too, and uses the same exclusion list.

6. **Shared renderer refactor risk.** `oases.ts` is a top-level module that reads DOM ids and imports `oases.css`. Its default preset is `pursuit`, and the export is `kind: 'particle-oases-observation'` with filename `particle-oases-seed-…` (asserted at `tests/e2e/particle-oases.spec.ts:39`).
   - The plan must say the oases page stays byte-for-byte equivalent in behaviour: `oases.ts` becomes a thin caller.
   - Seasons uses its own `kind` (e.g. `particle-seasons-observation`) and filename, defaults to flocks, and its card copy and aria labels name the regime. The existing e2e specs must pass unmodified.

## Evidence and fairness (specify before running)

7. **Define the stop rule.** "All seasonal arms empty before 1800" is ambiguous. State whether it means all 6 seasonal runs (2 arms × 3 seeds) or each seed separately. State what happens if only the long arm fails.

8. **Define metrics up front.** "Low count" and "rebound" thresholds must be fixed in the script before the run, not after. Realized renewal comes from deltas of `ledger.renewed`, not from `world.history`, which has no ledger and is capped at 300 samples (`model.ts:144`). Offered renewal per interval comes from the helper. State that the boundary census at tick k·period closes the ending phase.

9. **Name the confounds.**
   - Seed pairing shares only the initial state. Arms diverge once food differs, so there is no paired variance reduction. Treat the nine runs as descriptive.
   - Realized renewal is below the still arm's whenever rich patches sit at the cap (initial stock 30, cap 35). Report the realized/offered ratio per arm next to population, so a population difference isn't read as a timing effect.
   - Every seed sees the same phase order starting with row 0 rich, and the first phase doesn't start from a "season start" state. Say so.

10. **Energy accounting.** The existing residual check works with fractional multipliers (floating-point only). Report the max residual per arm as in `explore-oases.ts:82`.

## UI honesty (should-fix, all small)

11. Regime shading must not collide with stock shading. Stock already drives fill alpha (`oases.ts:117`). Encode regime with something not colour-only (line style or width, plus a text label per row in the `.stocks` line), and keep it reduced-motion safe.
12. The history chart window is 3,000 ticks (`oases.ts:131`), so a long cycle (5,400) never fits. Note this limit, or add phase bands.
13. Add one honest sentence of copy: food seeking points at the nearest patch regardless of stock (`model.ts:114-117`), so clustering on a starved patch is expected and not a failure to adapt.
14. Frozen extinct card: show "extinct at tick N, season frozen at …", with no live countdown.
15. Do not put regime changes in a live region, since a phase flips about every 20 s.

## Optional

- Export a `seasonal` block per world (period, multipliers, formula, frozen tick), so an observation file is self-describing without the code.
- Add a test that the page's `advanceComparison` path and the evidence script's per-world loop give identical censuses. The worlds are independent, so they should.
- Add a regression test that the still and travelling censuses to 1000 ticks match v3 pins before regenerating anything.

Items 1–6 should be folded into the plan before implementation.
