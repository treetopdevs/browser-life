I read CLAUDE.md, the plan, and the `MatterWorld` constructor and `advance()` in `matter/model.ts`. I didn't read the matter UI or tests. The ordering, conservation and bounds hold up. The gaps are in the rationale and the UI evidence, plus a few decisions the plan leaves open.

**What holds up**
- **Phase order:** the plan inserts the current after rain (step 1) and before relaxation (step 2). `clock` is incremented first, so "tick%4" means the post-increment clock, and the first circulation happens in the step that produces tick 4. That matches "no difference before 4" and "differ at 4". At tick 8 rain and circulation both fire, in the order the plan describes.
- **Conservation and bounds:** a bijective permutation of nutrient preserves the total and the per-pool values. The existing `checkedDelta` bound (`initialTotal`) still covers it. `circulated` is a new counter that is not in the residual, so the ledger identity is untouched.
- **Ring geometry:**
  - Layers run 0–7, and the narrowest ring is 2 wide and 34 tall.
  - Each cell has exactly one successor under the stated corner rules.
  - Top-left goes east and bottom-right goes west, so the "corner priority" wording works but is unclear. Write it as an explicit four-corner table.
- **Other numbers:**
  - Rain exhausts at 32768/64 × 8 = 4096, as stated.
  - History is 121 samples plus one extinction sample, which fits the 122 cap.
  - The six current-off worlds comparing to the original stepper is consistent with the closed and rain modes.

**Contradictions and wrong claims**
1. **"Every nested ring reaches the bottom recycling zone" is false.**
   - Ring layer L spans rows L to 47−L. Only layer 0 contains row 47, where settled detritus piles up once burial is off.
   - All eight initial patches (x=8, 24, 40, 56 at y=12 or 28) have localX=8, so they sit in layer 7, which spans rows 7–40.
   - Deep nutrient therefore reaches the patches only through threshold relaxation between rings, which moves floor(diff/4) per edge. The current mostly refreshes depleted patch tiles from the next cell up their own ring.
   - That is a legitimate engineered effect, but rewrite the rationale to say so. Don't claim direct deep-to-light delivery.
2. **`circulated` is not a delivery measure.** It equals the whole post-rain nutrient stock every 4 ticks. A uniform field moves "units" with zero effect, so the late 5000–6000 delta mainly restates the nutrient stock. Decide how to label it, for example "translation ledger, not delivery". Decide what the report uses to show supply to the growth zone. Growth deltas are the only honest signal, so say that.
3. **Nutrient view and replay may not make delivery visible.**
   - Relaxation keeps the nutrient field close to uniform, and rotating a near-uniform field looks like nothing.
   - Replay frames every 100 ticks are a slideshow, and the 4-tick pulse is invisible in them.
   - Decide on a nutrient-minus-still-sibling channel, which is exact because the paired initial states are identical. Also decide whether to record a short dense window, for example ticks 0–200 every 4, so the current visibly moves.
4. **Frame storage is undecided.** 61 frames × 12 runs × 3 channels × 3072 cells is several MB to tens of MB as JSON. Pick a format, such as packed Uint8/Uint16 with a hash, and decide whether the public route loads it all.
5. **"Retain /matter/ unchanged" vs "Link from /matter/".** Only `model.ts` and `explore.ts` are hashed by the matter evidence, so a link is safe. Reword to "model, runner and evidence unchanged; one link added", and check any UI tests that pin the matter page.
6. **"Physical divergence" is undefined.** Define it as the first tick any field array differs between a pair. Current pairs are expected at 4 and rain pairs at 8. Also state that a 4-tick current difference is nutrient-only until growth or mortality diverges, so the first biomass difference is reported separately.

**Smaller missing decisions**
- The plan says "Node 24.2.0" and `tools/currents/explore.ts`. This matches `tools/matter/explore.ts` (Node), not the Deno tools in CLAUDE.md, so just confirm it deliberately.
- The old pilot stopped at tick 3000. The new batch runs to 6000, and the original-stepper comparison to 6000 is new work. Budget the runtime and say whether it runs under vitest.
- The fixture key set grows to include `current`. State that old-shape fixtures are rejected by the new model, and that compat tests convert them explicitly.
- The closed condition keeps a 32768 reservoir that is never drawn on. That is fine under the ledger, but the UI should say "unused in closed", so it isn't read as a hidden source.

Nothing here needs new research. Items 1–3 are the ones I'd settle before coding. The rest are wording or format decisions.
