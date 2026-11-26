I found no gate-arithmetic, renderer or packaging-presence defects. The issues are test gaps, UI wording and a few provenance holes. I did not run tests, a browser or a build, and I read only the artifact's first 120 lines plus targeted greps.

## What holds up
- **Gate arithmetic:** there are 27 targets (groups 6, 12 and seam6, across 9 count/layout cells) times 4 negatives, which gives 108 comparisons. Each uses strict `>`, and the repeat limit of 1e-6 is part of the pass condition (`report-calibration.ts:33-40`).
- **Failure table:** `check.ts` recomputes the whole matrix from the fixtures and the shared renderer. The 41 rows in `vision-calibration.md` add up (12 + 2 + 12 + 15). The status is `stopped-calibration` with `searchRuns: []`, and the page has no play control.
- **Renderer:** centers, layout offsets, seam6, `id % 3` palette and the radius-1 overwrite match the plan's final resolutions. Page, e2e and scorer all use the same `rasterFrame`.
- **Scorer:** the pinned asset hashes, `weights_only` and projected `pooler_output` are real. I confirmed in the venv that transformers 5.20.2 honors `weights_only` and that `get_text_features` and `get_image_features` return the projected embeddings. Cosines are therefore on the right vectors.
- **Recipes:** the Mulberry32 in `core.ts:123` is the same algorithm as `particles/model.ts:79`, each child consumes exactly 11 draws, and the clamp bounds match `validateRecipe`.
- **Tests:** the counts match the validation doc (8 TypeScript tests, 10 Python tests). Both are labeled as not real inference.
- **Packaging presence:** the Vite entry and chunk, Dockerfile removals and Caddy 404 are all in place. The calibration JSON ends up only in the `vision-screen-core` chunk, so the Docker removal covers it.

## Defects, most important first

1. **No packaging test.** `matter-packaging.test.ts`, `boundaries-packaging.test.ts` and `development-packaging.test.ts` each pin the Vite entry, the chunk rule, the Dockerfile removals and the Caddy regex. Nothing does that for `vision-screen`. `public-routes.spec.ts` covers only noindex and the sitemap. Add `vision-screen-packaging.test.ts` mirroring the matter one, including that `/vision-screen-other` is not matched.

2. **The verdict is hardcoded, not read from the artifact.** `index.html:23-24` ("67 of 108 … 41 failed"), `index.html:34`, `page.ts:90` and `page.ts:144` ("56") are literals. `page.ts` never looks at `data.status`. The e2e test hardcodes the same strings, so a regenerated passing artifact would still render "Judge failed". Derive the counts and the headline from `data.status` and `data.comparisons`, and throw on an unknown status.

3. **The freshness guard runs only by hand.** `check.ts` and `test_score.py` are not wired into `pnpm test` or `pnpm typecheck`, and `tools/` is outside the tsconfig `include`; I found no wiring anywhere. Any later edit to `core.ts`, `score.py`, `calibrate.ts` or `report-calibration.ts` silently invalidates `sourceSha256`. `check.ts` also does not do three things:
   - compare `provenance.scorerSourceSha256` with `sourceSha256[score.py]`;
   - compare model revision, asset hashes or processor settings with the `score.py` constants;
   - compare `vision-calibration.md` with the JSON, although the Markdown is generated separately.

   A small vitest wrapper over these checks closes this.

4. **Mislabeled column.** The selected-panel table header at `index.html:46` says "Target minus strongest alternative". The value at `page.ts:132` is `row.difference`, the target fixture's margin minus the comparison image's margin. Those are different quantities. Relabel it, for example "Margin difference (target fixture − compared image)".

5. **The verdict hides where the failures are.** From the committed comparisons:
   - 41 failures = 12 against the matched one-cluster fixture, 2 against matched uniform, 12 against blank and 15 against the one-dot control.
   - 27 of the 41 involve the degenerate controls.
   - All nine 12-cluster fixtures fail against blank and against the one-dot control.

   The page shows only "67/108". Add a per-negative-type pass breakdown computed from `data.comparisons`. That keeps the negative result, doesn't change the gate, and stops readers inferring that CLIP can't tell clusters from uniform.

6. **Keyboard and reduced-motion problems.**
   - `showFixture` calls `renderGallery()` (`page.ts:136`), which rebuilds every card, so keyboard focus drops to `body` after activating a tile.
   - `scrollIntoView({ behavior: 'smooth' })` at `page.ts:135` ignores `prefers-reduced-motion`, which the plan requires. `style.css` has no reduced-motion rule.
   - Fix by updating `aria-pressed` in place (or restoring focus) and using `behavior: 'auto'` when reduced motion is set.

7. **Misleading "no failures" on three-cluster cards.** Group 3 is never part of a required comparison. Its card still says "No failed linked checks" (`page.ts:105`), which reads as a pass. Its detail panel calls it a "diagnostic control". Say "No required checks (diagnostic)" instead.

8. **Provenance gaps against the plan.**
   - `score.py:304-309` adds batch size and thread counts to `settings` and then discards it. The artifact records `batchSize` only under `limits`. It has no torch threads (4 and 1) and no CPU model, only `arm64`. The artifact is frozen, so record these as known gaps in `vision-runtime.md` and the validation doc rather than implying they were captured.
   - The repeat/freeze control covers one fixture (`cal-120-layout0-12`), where the plan says "representative target fixtures". The validation doc should say so.

9. **Smaller items.**
   - The footer links point at `blob/codex/vision-world-screen/…` (`index.html:48`). The research page uses `blob/main`, so these break once the branch goes away.
   - The `/matter/` link to the vision gallery (`matter/index.html:20`) has no context in an aquarium intro.
   - `core.ts` imports `particles/model.ts`, so the static gallery preloads `particles-bonded-model` (`dist/vision-screen/index.html:12`), even though it only rasterizes dots. `dist` may be stale; I did not rebuild.

Not verified: the PR94 link and deferral wording in `decisions.html` (its lines are too long for my tools). I also could not check the "no tuning after observing results" claim from the repo.
