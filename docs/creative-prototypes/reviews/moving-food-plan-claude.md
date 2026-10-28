**Verdict:** I found no blockers to the scope. I did find five items to fix in the plan text before implementing, and a few smaller notes. I used 8 reads and no edits. I checked the plan against `apps/lab/src/uniform-endurance/model.ts` (`supplyFood` at 564–583, `step` at 473, RULES at 10–16), the endurance results and the Hungry-shapes decision JSON. I could not read the `--check` tooling or the old record's snapshot list within the read budget.

**Fix in the plan text**

1. **Say which tick sets the stripe position.**
   - `step()` increments `_tick` and then calls `supplyFood`. The plan's "left = floor(tick/50)%96" must therefore use the post-increment `_tick`.
   - With that reading, the first pulse is at tick 5 and uses left 0. The pulse at tick 50 is pulse index 9, and it uses left 1.
   - Position 0 therefore gets 9 pulses and every later position gets 10. Write that down and unit-test it with the left edge at ticks 5, 45, 50, 55, 2995 and 3000.

2. **Make the permutation arithmetic explicit.**
   - In the code, uniform runs with `targetCount` 9216, a rotation of `seed % 9216`, and the index `((pulse·768+j)·2053+rot) % targetCount`. That is a bijection because gcd(2053, 9216) = 1.
   - The plan's 4608 is fine too (2053 is odd and not a multiple of 3, so it is coprime to 4608 = 2⁹·9). Seed 1201 gives a rotation of 1201 in both arms.
   - A pulse cycle is 6 pulses (4608 / 768) and the stripe moves every 10, so the cycles never line up with the stripe positions. Per-position coverage is therefore uneven and does not reset when the stripe moves. That is acceptable, but disclose it.
   - Pin the mapping tile = `y·96 + (localx+left) % 96` with `index = y·48 + localx`. The model is row-major (`y*RULES.width + x`).
   - Add a test that each full 6-pulse cycle at a fixed left offers every band tile exactly once. Add a second test that the offered total is 768 per pulse in both arms.

3. **The band mode needs more than a new `foodTargets` list.**
   - `_foodTargets` is built once, in `empty()`. The `environment` getter reports `targetCount` and `foodTargets` returns that list.
   - Band mode must recompute targets per pulse from `_tick`, keep no new mutable state, and report `targetCount` 4608 in `environment`.
   - `FoodMode` and `requireFoodMode` need the new value. Uniform's `environment` JSON, which includes `mode`, must stay byte-identical.

4. **"Literal copy" conflicts with "add a mode".** The new model file will not hash like the old one. Write the claim as "the diff to the old model touches only the food-mode surface", and include a recorded diff or hash of the old and new files. The controls that actually prove unchanged behaviour are:
   - the new-copy uniform's 151 sample, state and frame projections;
   - the 3000 tick rows;
   - the full-state hash;
   - `environment` for the uniform arm.

5. **List which old-record snapshots exist before the comparison.**
   - The plan says "available full snapshot 0", but the old 9000-tick run may also hold snapshots at other ticks, such as 500, 1500 and 2500.
   - If it does, compare all of them, not only snapshot 0. State up front which exist, and that 3000 is sample-hash only, because it was not terminal in the old run.
   - Confirm that no horizon-dependent field, such as total ticks or a terminal flag, enters the hash projection. Otherwise a 3000-tick run cannot match a 9000-tick prefix.

**Smaller ambiguities**

- **Offered versus accepted.** Same offered budget is exact. Accepted will differ, because a band tile gets 1/6 unit per pulse against uniform's 1/12, with `maxFood` at 40. Record the offered, accepted and overflow split per arm and per window. Do not state that matched usable energy is the aim.
- **Extinction before 3000.** The three new-window criteria have no defined value for a window the world never reaches. Define them as "not reached = fail, reported as such", not as zero. Do the same for the 2500→3000 and "2 of 3 late frames" checks.
- **The visual pass is close to automatic.**
  - Mutation makes any two runs diverge from the first food difference. A living world with births and deaths will also change between 2500 and 3000.
  - A pass therefore reads as "different trajectory", not as a response to the band. Phrase the delivery text that way.
  - Define in advance what counts as a "concrete spatial difference" (for example, a named body or gap), and freeze it before the overlap diagnostics are viewed.
- **Occupied-in-band diagnostic.** Say which `left` it uses (the band at the frame's tick) and that it is diagnostic only.
- **Pass condition (wording).** The plan says "stop after first seed even on pass". That is consistent with the rest, so keep the wording.

**Checked and fine**

- Integer ranges: `(600·768)·2053` is about 9.5e8, well under 2⁵³.
- The 151 samples match 0 to 3000 every 20 ticks.
- The uniform path in the new copy is unchanged, as long as only the band branch is added.
- The stop rules are honest: failed criteria are each reported, and nothing is retried or swept.
