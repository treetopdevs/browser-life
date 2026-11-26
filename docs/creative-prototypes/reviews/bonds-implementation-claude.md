**Reviewer:** Sonnet 5.5 (`claude-sonnet-5-5`), high effort, read-only. I ran no tests, builds or simulations.

## Verdict: no blocking defects found

I found nothing that should stop the PR. The findings below are P2/P3 and optional.

## Findings

**1. P2, fixed during the review: the pilot report table was malformed.**
- When I first read it, `explore-bonds.ts:206` emitted a 14-cell delimiter row under a 15-cell header, so `bonds-pilot.md:6` was not a valid GFM table.
- My last grep shows a 15-cell delimiter in both the runner and the report.
- **Unverified:** the runner source changed, so its recorded source hash may now be stale. Rerun `node tools/particles/explore-bonds.ts --check`. I can't run it.

**2. P3, recommended: the tests never assert "nearest-first" or the ID tie-break.**
- `bonded-particle-tests:50-65` (`apps/lab/test/bonded-particles.test.ts`) only checks invariants: IDs sorted, no duplicates, same family, degree at or under the cap.
- Failure scenario: reversing the sort at `bonded-model.ts:178` to farthest-first still passes.
- The distances in that test are float-distinct, so the tie-break is never exercised.
- Fix: assert the exact edge list for the collinear case in chains and mesh. The chain case should give the four adjacent links, with the 0–2 and 1–3 links blocked by the cap. Add one test with exactly equal distances to cover the ID tie-break.

**3. P3, recommended: the sustained test doesn't check the invariants the runner checks.**
- `bonded-particles.test.ts:147-160` runs mesh only for 200 ticks. It does not check live endpoints, same family, degree cap or duplicates.
- Those checks exist only in the runner's `assertHealthy` (`explore-bonds.ts:43-75`), which vitest never runs.
- Fix: extract or duplicate the edge checks into the test, and run chains as well.

**4. P3: the copy hardcodes "pursuit" while the recipe is selectable.**
- `particles/bonds/index.html:3` says "the same pursuit world" and `:6` says "pursuit movement recipe".
- The e2e test itself switches to Colonies (`particle-bonds.spec.ts:70`).
- Failure scenario: after the user picks Flocks, the intro still claims pursuit.
- Fix: say "the selected movement recipe (pursuit by default)".

**5. P3: no browser check that bonds form and draw on the real page.**
- Test 1 asserts only "Edges 0" and "mean degree" after one tick. Test 2 calls `drawBondOverlay` directly.
- Failure scenario: deleting `config.overlay?.(...)` or mis-wiring the slot-to-mode mapping would pass all three new tests.
- The written visual review covers this by eye, but nothing automated does.
- Fix: step 40–60 ticks and assert the chains and mesh cards show `Edges` above 0 while none stays at 0.

**6. P3, optional: robustness and performance.**
- The `removalEvents` getter (`bonded-model.ts:139`) clones and freezes up to 10,000 events on every access.
- The runner reads it every tick (`explore-bonds.ts:123`), and `shift()` at `bonded-model.ts:216` is O(n) per removal once the buffer is full.
- Exports also embed up to 10,000 events per world.
- This is not a correctness problem. A ring buffer plus a "since count" accessor would remove the cost.

**7. P3, optional: smaller items.**
- `bonds.ts:9-10` hardcodes "degree cap 2/4"; derive it from `BOND_RULES`.
- `explore-bonds.ts:147` hardcodes `6000` instead of `duration`.
- `explore-bonds.ts:151-156` has dead median code for odd counts. The `remaining === frequency - 0.5` branch is unreachable.
- `bonds.css:1` imports `oases.css`, which `environment-page.ts:4` already imports. This is harmless duplication.
- `--check` validates hashes and the 3×3 matrix, not that the `.md` matches the JSON. That gap is how finding 1 got through.
- Suggested wording: say that link lifetime is bounded by endpoint lifespan. Stretch breaks are only 10–32 of roughly 8–19k removals, so "breakable" is rarely exercised.

## Verified from source

- **Graph and construction:**
  - Edge IDs are canonical (`canonicalBond`, sorted getter).
  - Formation is deterministic: sorted by distance then IDs, greedy with the cap rechecked per candidate (`:181`).
  - The same-family and existing-pair filters work.
  - Thresholds are inclusive at formation (≤ .06) and strict at stretch (> .12).
- **Forces and drawing:**
  - Impulses use minimum-image torus deltas, pre-impulse positions and the clamp, and skip zero distance. They are applied before `base.step()`.
  - Seam drawing (9 tile copies under canvas clip) is correct, and the e2e test covers it.
- **Death cleanup, per-tick stepping, none path and snapshot:**
  - Death cleanup runs both before and after the base step. The before-step branch is defensive only.
  - `step(n)` is n single steps, and extinct worlds stay frozen.
  - The none fast path returns before any wrapper state is touched.
  - The runner's direct world is stepped only in none-mode runs.
  - The snapshot nests the base snapshot, `BOND_RULES`, mode, graph and events.
- **Shared page, clock and build:**
  - The comparison clock changed only in its type signature.
  - Export metadata is conditional, so existing page exports are unchanged.
  - The `<p class="extension-summary" hidden>` added to every card is inert. I found no author `display` rule on `p` children of `.world-summary` in `oases.css` or `picker.css`. That check was by grep.
  - Vite chunking and the Dockerfile removal patterns cover the new bundles. The `/particles/bonds/` route is in the public-routes diagnostic list.
- **Runner and docs:**
  - The runner's invariants and the early-collapse criterion match the plan. The early-collapse flag is `false`, all nine runs completed, and the max residual is 3.98e-8.
  - Checked against the JSON, the figures in `bonds.md` match: chains have 36–49 groups with largest 9–15, mesh has 9–11 groups with largest 19–28, and median live-link ages are 69–78.5 and 61–62.
  - `bonds.md` says nearly all removals come from endpoint death.

## Unverified

- I did not run typecheck, vitest, Playwright or `--check`. The 9 core tests and the 3 new and 5 existing browser checks are the parent's reports.
  - `bonds-validation.md` separately claims 34 unit tests and 21 Chrome checks. I did not verify either figure.
- I did not view the screenshots or the video, only confirmed they exist under `runs/bonds/browser/`.
- I read `reviews/bonds-visual-review.md` as evidence, since `bonds.md` cites it. It says the reviewer inspected three approximate-age stills and one exact tick-6000 still, and did not watch the continuous video.
- No one has inspected the recording, so the "continuous 4× playback" statement rests on the capturing agent's report.
- The review notes that two screenshot filenames disagree with the ticks shown in their pixels.
