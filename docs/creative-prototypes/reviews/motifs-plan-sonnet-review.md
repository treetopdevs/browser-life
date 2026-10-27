# Review of `docs/creative-prototypes/motifs-plan.md`

I read only the plan, `model.ts`, `comparison-clock.ts`, `vite.config.ts` and `Dockerfile.site`. I didn't open `Caddyfile`, `social-meta.ts` or `index.html`, so those claims are unchecked. Nothing was run.

**Verdict:** The plan is feasible. Matched initialization, the equivalence controls, equal offered renewal, direct `p.x` perturbation and production exclusion all check out against the code. Items 1–11 below are gaps or contradictions to fix before implementation.

## Confirmed against the code
- **Matched init (L9):** positions, velocities, ages and lifespans come only from `random(seed)` (`model.ts:105-109`). Food is a fixed 3×3 grid. Only `traits` depend on the recipe, so the claim holds at tick 0.
- **Equal offered renewal (L9):** the seasonal multipliers `[1.75,1,.25]` average 1 across the three patch groups every tick (`model.ts:40-41`). Capacity clipping at `model.ts:126` is correctly called out.
- **Equivalence controls (L29):** `recipeForPreset('pursuit')` is `{pursuit rows, 0, RULES.foodRenewal}`, and flocks alignment is .12.
- **Observer noninterference:** `census()` and `snapshot()` consume no RNG. The RNG closures are private, so the test is paired worlds (observed vs unobserved) compared at the end, not RNG inspection.
- **Perturbation:** `particles` is public and mutable (`model.ts:85`), and `ParticleWorld` caches nothing, so no new API is needed.
- **Production exclusion:** `Dockerfile.site:6` already removes `dist/particles` (the HTML) and `assets/particles-*`. A `particleMotifs` entry produces `assets/particleMotifs-*`, which no current glob matches, so the globs and `manualChunks` names must be added together. New module chunks named `particles-motifs…` are already covered.

## Must-fix

1. **Where the version lives (L7 vs L11).**
   - L7 says a sentence has exactly `{interaction, coordination, habitat}`, yet the compiler rejects "unsupported versions" and the observation carries "grammar/version".
   - Pick one. For example, `compileMotif(sentence, version = 1)` plus a `GRAMMAR_VERSION` constant, with version recorded only in the observation and export.

2. **"Inherited or exotic objects" is untestable as written (L7).**
   - Define the check: prototype is `Object.prototype`, `Reflect.ownKeys` is exactly the three string keys, each is an enumerable data property (no accessors), and values come from the allowed sets.
   - Say that Proxy detection isn't available in browsers and is out of scope.
   - Note that the existing `validateRecipe` uses `Object.keys` and doesn't check any of this. The compiler must do it itself, not delegate.

3. **`MotifWorld.step(n)` can't delegate to `base.step(n)` (L11).**
   - `ParticleWorld.step` loops silently through sample boundaries (`model.ts:115-118`).
   - Specify one tick at a time, sampling when `tick % 100 === 0` or the population is empty after the tick. Extinction on a multiple of 100 gives one sample.
   - The CLI claim "stores all scheduled samples" (L15) conflicts with the wrapper's 61-sample window (L11). Either assert `dropped === 0` for runs of 3000 ticks or fewer, or say the CLI uses a separate collector.

4. **Measurement definitions (L15, L17).**
   - **Normalization:** "normalized by population" must mean total population across all 432 cells, so the sum is 1 and TV stays in [0,1]. Per-family normalization breaks that bound.
   - **Empty histogram:** with the all-zero convention, TV at an extinction sample is exactly 0.5 whatever the dynamics. Make TV `null` when either histogram is empty, or flag it as an artifact.
   - **"Occupied-bin count":** say whether it counts the 144 spatial bins (families collapsed) or the 432 family cells.
   - **Compression byte order:** "row-major family order" is ambiguous. Give the index formula, for example `family*144 + by*12 + bx`.
   - **Determinism:** store sparse integer counts plus population rather than float probabilities. That keeps hand-computed tests exact and the JSON small. Fix a summation order for TV so the UI and CLI helpers agree.

5. **`node:zlib` must stay out of the browser-bundled module (L17).**
   - `motif-observers.ts` is imported by the page, and Vite would externalize `node:zlib` and fail at runtime.
   - Put the gzip proxy in a Node-only module or the CLI, and say so.
   - Pin `process.versions.zlib` as well as the Node version in the evidence record, since gzip bytes depend on the zlib build.
   - Say what the freshness test does on a different runtime. `Dockerfile.site` builds on Node 22, so "fails with a clear message, compression fields skipped" is a reasonable choice.

6. **Perturbation timing and controls (L19).**
   - **Sample ordering:** both worlds sample at 1500 before the move, so TV(1500) is 0 by construction. L11 forbids a duplicate timestamp, so the first divergence reading is at 1600. Write that down.
   - **Control scope:** the self-replay control must show zero divergence through 3000, not only before 1500. A nonzero control after 1500 means nondeterminism. "Proving" overclaims: it shows determinism within this runtime.
   - **Clone-free setup:** with no clone API, the perturbed world is a fresh replay to 1500. Say that, and compare snapshot hashes at 1500 before the move.
   - **Smallest living ID:** use `Math.min` over ids, not `particles[0]`.
   - **Local `wrap`:** the displacement needs a local `((x+1/12)%1+1)%1`, because `wrap` and `clamp` aren't exported (`model.ts:76,78`) and L7 forbids editing the file. `torusDelta` is exported.

7. **Honest reading of post-perturbation divergence (L19).**
   - RNG is sequence-based (`this.random()` and `mutationRandom()` per birth). After the first birth-count difference every later draw shifts, so late divergence is largely RNG desynchronization, not dynamical sensitivity.
   - "Mutation RNG stays matched until paths differ" is true but understates this. State it explicitly.
   - TV = 0 doesn't mean identical state. Also record a full-state hash match at each sample.

8. **Clock ownership is left undecided (L23).**
   - `advanceComparison` writes its own `extinctionTicks` array and caps at 10M, while `MotifWorld` owns `extinctionTick` and the page needs a 6000 cap.
   - Decide now. I recommend adapting `MotifWorld` to `ComparisonWorld`: a `particles` getter delegating to `base`, and `step()` calling `this.step(1)`. Then assert the two extinction records agree, and have the page enforce 6000 and stop before overshooting at 2 ticks/frame.

9. **Bounded export is not bounded yet (L25).**
   - 12 worlds × 61 samples × 432 floats is about 316k numbers, several MB as JSON.
   - Set a byte cap. Ship scalars plus sparse integer counts for all 12, and full histograms only for the favorites, or omit histograms and keep hashes.
   - The same applies to `motifs-pilot.json`: 36 runs × 31 samples × 432 values.
   - Define what happens to favorites on reset (cleared or kept by ID) and what the 4th favorite does.

10. **Seed input and the energy invariant need exact definitions (L23, L29).**
    - **Seed parse:** specify a decimal-only pattern such as `/^(0|[1-9]\d*)$/` with a ≤ 0xFFFFFFFF check. Reject `1e3`, `0x10`, whitespace and negatives.
    - **Ledger residual:** give the formula: `initial + renewed − dissipated − deathLoss − (particleEnergy + foodEnergy)`. `consumed` cancels.

11. **The sentence badge claims more than the physics keeps (L25).**
    - Mutation clamps trait rows to [-1,1] and can flip their sign (`model.ts:167`). A "chase" world's actual attraction rows drift away from the sentence.
    - Label badges "initial composition". Optionally show mean trait row per family (`traitSpread` is already in the census).
    - Also note that `settings.preset` reads `'flocks'` for gather-independent even though alignment is 0.

## Optional
- **UI vs CLI results:** `Math.hypot` isn't correctly rounded, and the model header promises replay within one runtime only. UI runs in other engines may not match the Node pilot bit for bit. Say the UI "record at ~1500 then 3000" bundles (L31) are separate, runtime-stamped observations.
- **Export timing:** state that extinct worlds export their own frozen tick.
- **`observation()` cost:** it clones the full snapshot (up to 240 particles plus 300 censuses). The UI should read `census()` per frame.
- **Compression proxy:** 432 bytes plus about 18 bytes of gzip overhead, mostly zeros, so it largely tracks occupied-cell count. The cap at 255 never binds because population is at most 240. Report it alongside occupied-cell count and call it coarse. Optionally use `deflateSync` with explicit `windowBits`/`memLevel`.
- **Frame budget:** 12 worlds at 240 particles and 2 ticks/frame is roughly 1.4M pair iterations per frame. That is probably fine on desktop, so call phone performance untested rather than asserting it. Skipping draws for offscreen cards is optional.
- **`manualChunks` match:** `/src/particles/motifs.ts` doesn't collide with the existing `model.ts` substring tests.
- **Page head:** I didn't read `social-meta.ts`. Confirm that `withSocialMeta` (applied to every page) doesn't inject canonical or OG tags that contradict "noindex / no canonical". Mirror an existing particles page head.
- **Server deny:** confirm the existing Caddy rule covers `/particles/motifs/`.
- **Equivalence controls:** they validate the compile table, not new dynamics. State that, and reference `RULES.foodRenewal` rather than a literal .65.

## Review coordination notes

The external review completed successfully using Sonnet High with Read/Glob/Grep and an empty MCP configuration. No implementation was performed during this review.

Practical resolutions discussed while the review ran: define histogram distance as zero when both worlds are empty, one when exactly one is empty, and conventional normalized-histogram TV otherwise; retain gzip in the Node-only CLI; record the tick-1500 post-displacement comparison separately from the ordinary pre-displacement census/replay checkpoint. These resolve the empty-distribution and perturbation-timing ambiguities without modifying the model's unique-timestamp history.

Sparse histogram storage, a fixed byte cap, decimal-only seed syntax, per-sample state hashes, and a second clock-owned extinction record are optional design choices rather than necessary correctness fixes. A separate thin clock using wrapper-owned extinction is simpler than duplicating extinction ownership. The creative prototype does not require statistical registration or an invented success score.
