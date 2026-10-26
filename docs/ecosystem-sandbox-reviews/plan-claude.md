**Review of `docs/ecosystem-sandbox-plan.md`: no blockers.** The scope is honest, with a CPU-only model, no deploy and no claim of conservation. Findings, most important first:

1. **Determinism and the "reset reproduces the default trajectory" claim.**
   - Specify a counter-based or seeded PRNG, such as the repo's seed/step/cell scheme or a small mulberry/xoshiro. Never use `Math.random`.
   - Use one PRNG stream per concern: update order, mutation, attack rolls and weather. Otherwise toggling mutation changes the update order, and "mutation off" stops being comparable to "mutation on".
   - Floating-point energy and regrowth are deterministic in one engine, but the JSON export should not promise cross-browser bit-identity. Either quantize energy and resources to integers or fixed-point, which is cheap and matches repo idiom, or say "same browser" in the export.
   - Mid-run changes (toggles, manual interventions) must be logged by tick. The export should replay to the same state from `{seed, settings, events}`. Test that replay, not just reset.

2. **Cyclic predation needs a single rule for what the engineered families target.** The protected descendant keeps family 0's target. The counter-predator targets the protected family and is vulnerable to "a founding family". Name which one, and check it doesn't create a second cycle that makes the intervention a rescue. Add a test that the counter-predator cannot attack its own vulnerability source's prey chain in a way that guarantees collapse of family 0.

3. **Upkeep, reproduction and the mutation range need numbers before implementation.** Without them, the "revise if all worlds empty/freeze/monopolize" check has no baseline.
   - State the tunable constants in one table: upkeep per attack and defense point, birth threshold, split fraction, regrowth rate, uptake cap, and attack success as a function of attack minus defense.
   - Mutation is bounded to 0–4, so state whether a strategy with attack and defense both at 4 is affordable. If it is, selection collapses to "max everything". Upkeep must make 4/4 clearly net-negative.
   - Refuge patches "reduce attack success and improve protected-family feeding". The second effect is a family-specific subsidy, which undercuts "protection is relative". Either keep it and label it on the page, or drop it and use only the attack-success reduction.

4. **The tick-300 counter-predator can end the experience.** One seeding, once per reset, on a 96×96 grid can die immediately or erase the protected family, and then nothing varied happens until the next 500-tick drought.
   - Specify the seeding size and placement: a patch near the protected family, not random.
   - Add a visible manual re-stage control, which the plan already allows, plus a prompt in the event log when a seeded lineage goes extinct within N ticks.
   - Run the 3000-tick exploration with and without interventions, so you can tell whether the interesting behavior comes from the ecology or only from the scripted interventions.

5. **Metrics and the exploration report.**
   - "Population diversity" is undefined. Pick Shannon over (family, attack, defense) classes, and report the number of occupied trait cells alongside it.
   - "Turnover" needs a definition too, for example births plus deaths per site-tick.
   - Three seeds is fine for a diagnostic. Report per-seed results rather than averages, and state the pass/fail rules for "empty/freeze/monopolize", such as final population under X%, or one family above Y%, or no change in the trait histogram for Z ticks.

6. **The page needs to fit the repo's multi-page setup.**
   - The repo's multi-page build lists each page explicitly in `apps/lab/vite.config.ts:156`, so add `ecosystem: r("./ecosystem/index.html")` there. Otherwise dev works and the production build silently omits the page.
   - Check whether the 404 plugin or any sitemap or nav list needs the route.
   - Put the model in a package or in `apps/lab/src/ecosystem/` as pure TS with no DOM. That keeps vitest tests, which already cover `apps/lab/test`, free of browser setup.
   - Don't add an `@bl/*` alias unless you really make a package. There are four maps to keep in sync.

7. **Run the simulation loop off the render loop, and keep it responsive.**
   - A 9,216-site grid with random order each tick is cheap, but multiple ticks per frame at high speed should be capped by a time budget.
   - Pause the loop on `visibilitychange`.
   - Reduced-motion starts paused. Make sure Step still works there, and that the canvas has a text alternative (an `aria-live` summary of counts, throttled).

8. **Export bounds.** State the retention windows in the JSON itself, including a field saying how much history was dropped. Include a schema/version field and the model constants, so an old export stays interpretable after the tuning changes.

9. **Validation gaps:**
   - Add a test that newborns don't act in their birth tick.
   - Add a test that energy never goes negative or NaN, and that traits stay in 0–4 across many ticks.
   - "Relevant legacy hash tests" is vague. Since nothing in `sim-ref` should change, the check is `pnpm vitest run packages/sim-ref/test/golden-hashes.test.ts`. Also run `pnpm typecheck` and `pnpm build` under nvm node 24.

10. **Wording.** "Descendant of Candidate 9" could read as a physics lineage. Say on the page that this is a separate toy model inspired by the cyclic result and shares no code or rules with it.
