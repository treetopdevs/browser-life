**Verdict: no model, UI or packaging blockers found. There are two evidence-runner items to settle before commit.** This is a static review only. Bash is disabled, so I ran no vitest, typecheck, `--check`, `--replay-check`, Playwright or build, and I could not compute any SHA-256. "Verified" below means hand-traced from source. The review prompt/Claude review file was empty (0 bytes), so I did not use it.

## Needs your attention before commit

1. **`tools/matter/explore.ts` changed while I was reviewing it.** My first read had the run-table header `'Late mean |ΔB| /tile/tick'`. Its two literal `|` characters would trip the `table()` layout assertion and make `buildMarkdown` throw for any complete batch. The current file (530 lines) has `'Late absolute B change/tile/tick'`, matching `matter-pilot.md:26`. `writeEvidence` now also builds the Markdown before writing either file (`:499`). Someone is editing the hash-tracked runner concurrently. The JSON records `explore.ts` as `f12dddfb…ace4f` and `model.ts` as `e4d0ef43…8bea`. I can't tell whether the current bytes still match. Run `--check` and `--replay-check` after the file stops changing. If the hash differs, regenerate and confirm that `runs` and `prebatchFixtures` are unchanged from the current artifact.

2. **Markdown glue bug still present (`explore.ts:492-493`, `matter-pilot.md:39`).** There is no `\n\n` after `runTable`, so "First physical divergence compares…" sits on the last table row. Any fix changes the runner hash, so it goes through the same regeneration.

## Non-blocking, actionable

3. **`--check` does not recompute late activity.** `validateEvidenceStructure` (`:436-438`) only checks the window shape. Altered `meanAbsBChangePerTilePerTick` or `counterDeltas` would pass `--check`, and `--replay-check` is the only thing that catches it. Adding `sameJSON(run.lateActivity, lateActivity(run.finalHistory))` closes it.
4. **`--check` is weaker than it looks in four places.**
   - `run.extinctionTick` isn't tied to `finalCensus.extinctionTick` or to sample biomass. An on-cadence value like 1500→1550 passes.
   - Mode truth is checked only by `assertWorld` at generation: disabled exchange equals zero, and rain imported equals the schedule at every sample. `--check` checks only the 24000/8768 endpoint.
   - Fixture samples get no `validateCensus`. Fixture `actual` and the final snapshot aren't cross-checked.
   - Initial state isn't compared against `new MatterWorld(seed, mode)`.
   - The divergence fields are only range-checked.
   
   All are cheap to add.
5. **Divergence columns say "none" for rows where the comparison doesn't apply.** This affects closed vs closed, and the burial/control column for the closed and rain rows. The text "Null means exact equality persisted" misreads those rows, so label them `n/a`.
6. **History chart is effectively blank.** `page.ts:60-61` scales biomass to 69,760 and active cells to 3,072. Pilot peak biomass is 792, about 1% of chart height, so both lines hug the baseline. Use a disclosed smaller or running ceiling.
7. **Per-pixel rendering cost (`page.ts:80-108`).** `drawWorld` fills an ImageData at device resolution (about 1.4M px per card at DPR 2). Single-channel views also allocate a `.map()` array per pixel. Render 64×48 once and scale with smoothing off. I couldn't measure the cost.
8. **The 4-ticks/frame cap is really 3 at saturation.** `duration*4` minus `duration` repeated lands just below `duration` by float rounding, which I worked through in integer ULPs. So `e2e` test 2 expecting tick `6` (`matter.spec.ts:49`) pins a rounding artifact. The ≤4 bound holds, but the number is not the cap.
9. **Missing regressions from the plan.**
   - No browser test of the 6000-tick cap.
   - No threshold collapse at a light edge.
   - No vertical-boundary component case (`(0,47)` vs `(0,0)`).
   - No randomized relaxation donor-budget test.
   - The tick-60 collision numbers (B42, spread 20, colonized 5) were not hand-verified.
10. **Reservoir bar labels.** Cards 1 and 3 say only "Reservoir" on the bar; "not connected" appears only in the stat label.
11. **Docs lag.** `matter.md` and `decisions.html#matter-next` ("Implementation is in progress") don't yet record the pilot result below.

## Pilot result to record plainly (not a defect, no tuning)

All 12 outcomes end extinct: 790 / 1000 / 790 for seeds 1201 / 1202 / 1203, every mode within a seed. In the 40 biomass values I sampled, the biomass series match across the four modes, peaking at 792. Late biomass activity is zero. Closed has relaxed:0 for 1201, while rain rows show relaxed in the tens of thousands; physical continuation after extinction is visible in the data. Burial is not inert: 6 of 12 outcomes buried 534 to 964 units, first divergence at tick 32. The stop rule (all rain+burial extinct before 500) is not triggered, since those extinctions are at 790 to 1000.

## Verified by static trace

- **Tick phases:** the order matches the plan. Mortality (routine, then threshold) runs before extension, and extension reads post-mortality B synchronously. A newborn target can't move in its own phase.
- **Relaxation:** signed Int32 deltas per undirected edge once, including the seam, with no clamp. Each donor's outgoing total is ≤ old N.
- **Rules and zones:**
  - Halfwidth is 24 and recycling is every 24 ticks.
  - The dark zone is y≥36.
  - Burial (y≥40) runs after settling from old D.
- **Fixtures:** both hand-reproduce. The growth gate gives B57, growth 36, mortality 3, spread 8, colonized 2 at (8,12), (8,13), (7,12). The continuation gate gives imported 4, recycled 2, buried 14, N6, with first import at tick 8 and first burial at tick 4.
- **Rain schedule:** 24000 imported and 8768 left at tick 3000, with exhaustion at 4096 stated as not observed.
- **History:** sampling at tick 0 and every 50, plus an exact-extinction sample with dedup, capacity 122, and interval fields from the previous sample. The extinction dedup and capacity test numbers (450 / 10 dropped) check out.
- **Extinction doesn't freeze anything:** the model has no early exit, the clock steps every world (`comparison-clock.ts:16-17`), and the runner asserts the shared tick each step (`explore.ts:233`). The UI banner says "material updates continue."
- **Late-window arithmetic:** intervals cover exactly 1000 ticks and sum `meanAbsBChange` and `maskFlipFraction` over 1000. Raw counter deltas are given separately, but they are unlabelled units over 1000 ticks, not per tile per tick.
- **Runner and artifact gates:**
  - Source hashes are checked before the fixtures, after the fixtures, after the batch and before persistence.
  - A fixture mismatch gives `stopped-after-fixture-failure` with empty runs.
  - The matrix is 12 ordered rows with a repeat compared every 50 ticks.
  - Per-tick checks cover bounds, ledger identities, mode truth, monotonic sediment and counters, and no resurrection.
- **Packaging:**
  - The Vite `matter` entry and `matter-model` chunk are present.
  - Docker removes `dist/matter` and `assets/matter-*.js` / `.css`.
  - Caddy's case-insensitive `^/matter(?:/|$)` deny sits before public handling.
  - `/matter/` is in the public-routes diagnostic list.
  - Navigation links exist from the particles, motifs and development pages.
- **UI:**
  - The scales are N32, B64 and D16 on a square-root mapping.
  - Canvases are 4:3.
  - Fields and the light band are drawn from the current world tick every draw.
  - The cap disables play and step.
  - Hidden pause persists.
  - Exports over 12 MiB are refused rather than truncated, and I expect a normal export to be about 1 to 2 MB.
  - Hex and exponent seeds are accepted, and invalid seeds keep a persistent error.

## Not executed

I did not run `--check` or `--replay-check`, vitest, typecheck, the build, the Playwright specs, Chrome pointer tests or video review, and I did not confirm the evidence file hashes.
