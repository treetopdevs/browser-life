**No blockers.** All five fixes hold up in the final files. I found one low-severity nit, which is not worth blocking on. This was a static read only. I ran nothing, so the SHA-256 match is taken from the pilot.md header and Codex's recheck.

**Checked and fine**
- **Live-region updates:** `apps/lab/src/particles/main.ts:33-34` writes `#run-status` only when the text differs. Both the 10-tick census path and the pause/play paths go through that guard. The `#control-note` writes at `:101` and `:120` are not in a live region.
- **Food steering disclosure:**
  - `apps/lab/particles/index.html:37` says "A weak built-in food-seeking pull draws every particle toward its nearest patch." That matches `model.ts:73-77`, which steers toward the nearest patch with `foodSeekingForce` 3.5e-5.
  - The page heading is now "Built ingredients. Changing patterns.", and the badge and meta description say "Engineered".
  - "Unscripted" appears nowhere in the live source. The only hits are the review docs quoting it.
  - `index.html:37` also states that motion alone is not evidence of adaptation.
- **Pause and hidden census:**
  - The `visibilitychange` handler (`main.ts:122-125`) runs `showCensus()` on every change, after clearing the timing state. That closes the Codex P3 about counters lagging up to nine ticks.
  - Manual Play and Pause also call `showCensus()` (`:112`).
  - The frame loop forces a census when `paused` is true (`:141`).
  - The e2e test compares the displayed tick and population against a paused download (`tests/e2e/particles.spec.ts:43-51`). That covers manual pause, not the hidden-tab path, which was deferred.
- **`--check`:** `tools/particles/explore.ts:16-22` compares the saved `sourceSha256` and does a `deepStrictEqual` of the full `RULES` object. It exits before the simulation loop and before either `writeFileSync`, so it runs no simulation and writes nothing. `RULES` holds only finite numbers, so the JSON round trip can't cause a false mismatch. The usage guard rejects any other argument.
- **Lower-motion comparison:** `pilot.md:21` calls it "a descriptive comparison, not a settled-state score or new success threshold." The recorded table supports it: flocks run 10–14 occupied bins and 3.6–3.8e-4 speed, against 59–66 bins and 2.6–3.0e-3 for pursuit. The old `1e-8` "no motion" sanity check is still there, with no new threshold added.
- **Production exclusion:**
  - `Dockerfile.site:6` now removes the `dist/particles` directory and `assets/particles-*.js` and `assets/particles-*.css`.
  - Vite names the bundles `particles-<hash>` from the entry key (`apps/lab/vite.config.ts:167`). The build log (`runs/creative-prototypes/build.log:21,31`) shows `assets/particles-kyRQjNKe.css` and `assets/particles-B8HriQ7P.js`, so the glob matches.
  - `deploy/Caddyfile:9-10` still returns 404 for `/particles`, and `README.md:131` is now accurate.
  - `/particles/` is in the `DIAGNOSTIC` list in `tests/e2e/public-routes.spec.ts:20`.

**Remaining nit (optional)**
- `tools/particles/explore.ts:53` hard-codes the sentence "the table shows slower average speed and fewer occupied bins" for flocks against pursuit. A regeneration after a model change would print it even if the new numbers contradicted it. It's true for the current table, and `--check` fails whenever the model hash changes, so it can't go stale unnoticed. If you want it tightened, derive the sentence from the results or add a one-line "verify on regeneration" comment.
