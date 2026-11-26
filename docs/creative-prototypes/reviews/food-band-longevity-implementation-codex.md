**Blocked—four concrete issues.**

- **P1: Output paths disagree.** The [runner](/Users/nicholas/.codex/worktrees/food-band-longevity/browser-life/tools/food-band-longevity/explore.ts:46) writes under `docs/`; the viewer and [diagnostics](/Users/nicholas/.codex/worktrees/food-band-longevity/browser-life/tools/food-band-longevity-diagnostics.mjs:140) require `docs/creative-prototypes/`. Newly produced evidence cannot load through the intended pipeline.

- **P2: Browser fixtures omit a required source pin.** The [fixture extractor](/Users/nicholas/.codex/worktrees/food-band-longevity/browser-life/tests/e2e/food-band-longevity.spec.ts:17) captures only literal hashes, omitting the plan entry whose value is `PLAN_SHA256`. The viewer requires exact source-map keys, so nominally valid fixtures fail before exercising replay, extinction or receipt behavior.

- **P2: Diagnostics bypass successful check-only validation.** The [helper](/Users/nicholas/.codex/worktrees/food-band-longevity/browser-life/tools/food-band-longevity-diagnostics.mjs:149) proceeds from committed-receipt and shallow identity checks to overlap calculations without invoking the runner checker or requiring bound validation evidence. Invalid accounting/source evidence can reach diagnostics, contrary to plan line 29.

- **P2: Receipt acceptance differs between consumers.** Diagnostics accepts “Not blind: historical media already exist,” including its own fixture. The [viewer](/Users/nicholas/.codex/worktrees/food-band-longevity/browser-life/docs/creative-prototypes/food-band-longevity-viewer.js:521) specifically requires “historical moving media,” rejecting that otherwise accepted receipt.

Static inspection supports distinct horizons, exact BOTH-mode prefixes including tick 3000, late-window calculations, independent repeats, truthful terminal capture, exclusive writes and simulation-free `--check`.

Ten pertinent reads used; no edits, tests, outcomes or overlap computations. Plan SHA matched. Current runner-to-viewer hash equality remains unverified because the final hash check was sandbox-blocked.