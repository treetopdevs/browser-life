# Adversarial review: `vision-screen-plan.md`

The plan is a real test of targeted local scoring. It has no untargeted control, so it can't show that targeting adds anything. It also lets the judge pick frozen or near-extinct worlds, which conflicts with the "worth watching" framing. I read both files and `apps/lab/src/particles/model.ts`, and ran no simulations. File:line references below are for the model file.

## Blocking: fix before implementation

1. **No control for "does targeting help".**
   - The 4 children of the top 2 are compared with 2 children of flocks and pursuit.
   - Counts differ (4 vs 2).
   - Colonies is omitted without explanation.
   - Parent quality is confounded: the top 2 may simply be better parents.
   - A same-operator control is needed: 4 children from parents chosen without the judge, with a deterministic choice (for example the median or bottom 2 by score, or a fixed seed-91003 draw of 2 parents). Otherwise the comparison can't distinguish "targeting works" from "any mutation of the better parents works".
   - Equally acceptable: state up front that this slice tests only whether the judge ranks real simulation frames sensibly, not whether search adds value.

2. **Calibration doesn't cover the regime it gates.**
   - Fixtures are 120 dots, equal palette counts, 12 clusters against 1 against uniform.
   - Simulation frames have a population that varies from 0 to 240 (`populationMax` 240, `initialPopulation` 120), uneven family counts, torus-wrapped clusters, and only 3 families.
   - Three family colours will mostly form about three clusters, which is neither "12" nor "1".
   - Passing the 9-fixture ordering therefore says little about ranking real frames.
   - Add intermediate fixtures (for example 3 and 6 clusters, plus one wrapped across the torus edge) and a dot-count sweep.
   - Specify a monotone or ordering expectation for them before scoring.

3. **Eligibility is only `population>0` at tick 1000.**
   - A world with 2–5 survivors is eligible.
   - A near-empty frame is exactly the "blank / one dot" diagnostic case, but nothing excludes it from selection.
   - Define a minimum population and say how counts below the calibration dot count are handled.
   - Population changes also change dot density in a 128px frame, which confounds the score.

4. **Frozen or static worlds can win, which contradicts "worlds worth watching".**
   - Motion is measured but never gates anything, and there is no temporal bonus.
   - Static crystals of clusters are the likely top scorers.
   - This is defensible for isolating targeting, but then the title and objective must not say "worth watching" or "life-like".
   - Alternatively, add a pre-declared floor on `meanSpeed` (already in `Census`) as eligibility. That is cheap and consistent with the stated intent.

5. **Single-seed selection with no noise estimate.**
   - Ranking uses only seed 1201, and the follow-up uses 1202 and 1203 on top 3 plus originals.
   - Without a noise estimate (score variance across seeds, or at least within-run frame variance) you can't tell whether margin differences between recipes mean anything.
   - Run the 3 original presets on 1202 and 1203 for the 1000-tick window before selection. That gives a judge-noise floor. Or define "meaningful change" in the report in terms of observed frame-to-frame spread.
   - Report the winner's-curse expectation (late score below early score) as the null.

## Determinism and provenance gaps

6. **Image preprocessing is unspecified.**
   - 128×128 goes to CLIP's 224. The plan doesn't set the interpolation (bicubic as in the CLIP processor, or nearest), the crop, or the dot radius in px at 128.
   - Pixel-art upscaling choices can change scores a lot.
   - Fix them and include them in the hashed provenance.
   - The browser and the scorer share the renderer, but the PNG encoder and the colour-space handling also need pinning.

7. **Recipe IDs and rounding are undefined.**
   - "IDs stable" and "deduplicate by recipe ID" imply a content hash, but no hash is specified.
   - Children draw doubles. Round to a fixed precision before `validateRecipe` and hashing, and say whether the ID is content-based or lineage-based. Both can be recorded, but dedup must name one.
   - Clamping can make a child equal its parent. Define that case (alignment 0 for pursuit clamps the lower half of the uniform draw to 0, and the matrix entry 1 in colonies clamps too). The 11 draws per child are consumed regardless of clamping, and the plan should say so.

8. **Mulberry32 has no shared implementation.**
   - The repo has separate private copies (`matter/model.ts:164`, `development/model.ts:278`, `boundaries/model.ts:221`), and the particle model uses its own `stream()`.
   - Decide which one to use, and pin it by hash with a test vector.
   - The 91002 draw order across the two ranked parents ("children from each") isn't spelled out. State parent order (rank 1 then 2) and child index.

9. **`preset` is a required constructor argument.**
   - In `ParticleWorld` it is only stored as metadata. The behaviour comes from `recipe`.
   - Say how children are labelled (parent preset as a nominal label) so cards don't imply behavioural identity.

10. **Replay claim versus floating point.**
    - The plan itself says replay is same-runtime only, yet it hashes frames and has a `--check` replay.
    - Pin the runtime (Deno or Node version and platform) for the committed artifact. Say that `--check` is only valid on that runtime, and what it does on a mismatch (warn, not fail?).
    - Also state which runtime generates frames (Deno CLI) versus the browser, since the browser plays stored positions and never re-simulates.

## Resource bounds

11. **The workload is undeclared.**
    - Count: 18 candidates × 1000 ticks, then up to 6 recipes × 2 seeds × 3000 ticks, plus 64 CLIP forward passes per scored run.
    - That is roughly 18×64 + 12×64 ≈ 1,900 CPU inferences plus 9 fixtures.
    - State a wall-time or memory cap, batch size, thread count, and what happens on timeout (partial artifact marked stopped).
    - The artifact size is bounded in principle (positions plus family IDs) but has no size target. 64 frames × up to 240 particles × 30 runs is small, but quantisation or rounding of the stored positions isn't specified and affects the render hash.

12. **Provenance of model and package versions in a committed artifact.** Weights are never committed, so the committed score file must be self-describing and fail `--check` clearly when the cache is absent. The plan covers most of this but doesn't say what `--check` does without weights (presumably it verifies hashes and schema only).

## Smaller inconsistencies

- "Prompt-tune until it passes" is forbidden, but the three alternatives are fixed prompts whose second one ("colored dots spread uniformly") may itself be confusable with the target. Say that a calibration failure caused by prompt wording is reported as such.
- The margin is the target minus the max of the two alternatives. A frame can score a high positive margin simply because it is far from the "one cluster" and "uniform" prompts, without matching "many small clusters" (for example, noise-like scatter). Report raw target cosine alongside the margin, and spot-check that top-ranked margins aren't driven by the alternatives dropping.
- Top-3 follow-up "deduplicate original winners" can leave 3 to 6 recipes. The artifact and UI layout should handle a variable count, which the plan only partly states.
- "Top/bottom clips" are inspected afterwards, but no pass or fail criterion is defined. A "judge contradicted by inspection" outcome should be a named result that can mark the whole screen as unsupported.

None of this requires preregistration or a positive outcome. Items 1, 2, 3 and 6 are the ones I'd settle first, because they decide whether a positive or negative result can be interpreted.
