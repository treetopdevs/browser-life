# Review: Travelling oases, Candidate 3 (`oases-plan.md`)

This is a static read of the plan and the listed sources, plus two greps in `apps/lab/src/particles` and `apps/lab/test`. I ran nothing, so nothing here is runtime-verified. I did not open `pilot.json`.

## Blockers

**B1. Still worlds must not touch patch coordinates at all.**
- Plan: "Default still must preserve all recorded default numerical trajectories" (line 9). Source: `wrap` at `model.ts:34`.
- `wrap` is `((n%1)+1)%1`. For a start position like 1/6 (`(0+.5)/3`), adding 1 and taking `%1` generally changes the low bits.
- A "uniform" implementation that calls `wrap(x + 0)` for still would shift every patch by about 1e-16 and change trajectories. That would silently invalidate every pin.
- Repair: add to the contract that `still` takes a branch that skips the move code and neither reads nor writes `food[i].x` or `.y`. Add a test that default-constructed and explicit-`still` worlds produce `JSON.stringify`-identical `food`, `particles` and `history` after N ticks.

**B2. The migration cannot be done as written in `parseExploration`.**
- Plan lines 14–15. Source: `comparison.ts:58–68`.
- Today the version check is `data.modelVersion !== RULES.version`. `createExploration` also stamps `RULES.version` into the rebuilt graph.
- Once `RULES.version` is 3, a v2 file's `canonical(data)` can never equal `canonical(rebuilt)`. The `modelVersion` field differs, and `rebuilt` is deep-frozen, so it can't be patched in place.
- The version whitelist must be exactly `{2, 3}`, checked with strict `===` on a number. If it's checked after `modelVersion` is copied into the comparison object, a hostile value passes.
- Repair, in this order:
  1. Reject unless `data.modelVersion === 2 || === 3`.
  2. Rebuild, then compare `canonical(data)` against `canonical({...rebuilt, modelVersion: data.modelVersion})`.
  3. Only after that passes, return a new object with `modelVersion: 3`.
- Add negative tests for `"2"`, `2.5`, `4`, a missing field, and v2 combined with each existing tamper case. Add a positive test that v2 parses and re-serializes as exactly the v3 bytes, with idempotent round trip.
- The `Exploration` type and `formatVersion` must gain no `environment` field. `canonical` would reject such a file anyway, which is correct. Say so explicitly.

**B3. The import notice has no way to reach the UI.**
- Plan line 15 ("Record an import notice"). Source: `picker.ts:179`, which consumes `parseExploration(text)` as a bare `Exploration`.
- A migrated and a native v3 file are indistinguishable after parse.
- Repair: keep `parseExploration` unchanged in signature and add `parseExplorationWithNotice(text): {session, migratedFrom: 2 | null}`, which the picker calls. Don't change the return type of the existing function.

**B4. The "regrouping vs rigid carry" stop rule has no metric (plan lines 20–21).**
- Per-tick mean minimum-image displacement is essentially `|v|` for survivors. A particle moves at most 0.008 per tick, so the minimum image never wraps. It is near-redundant with the existing `meanSpeed` in `census()`.
- It is measured in the world frame, so it can't distinguish "riding a patch" from "wandering fast". It also isn't signed.
- Without a defined measure, "little regrouping" and "following" are not falsifiable, and the next-step decision (queue seasonal renewal) rests on eyeballing.
- Repair: pick one patch-frame quantity and define it in the plan. Options:
  - ID-based retention across 100 ticks: of particles inside patch *k* at *t*, the fraction still inside patch *k* at *t+100*.
  - Mean distance to the nearest patch.
  - Net displacement projected on the nearest patch's direction.
- Keep the world-frame displacement only as a secondary column. Name it "particle speed (survivors)", not "displacement".

**B5. "Each patch occupancy" and "food-contact fraction" are ambiguous under overlapping patches.**
- Plan lines 17 and 20. Source: `model.ts:104–106`, `:94`.
- Patch spacing is 1/3 and radius is 0.18, so adjacent patches overlap, both in a row and between rows.
- Feeding takes the first patch in array order that contains the particle (`break`). Steering uses the nearest centre. The two rules disagree in overlaps.
- Row 0 has priority over rows 1 and 2 where they overlap, and that overlap changes as rows move in opposite directions.
- "Fraction in any patch" is the union, which is fine. Per-patch occupancy and the UI "food-contact" label can mean geometric containment, feed-assigned, or ate-something.
- Repair: define three things:
  - Occupancy is geometric (`d² <= r²`, the same inequality as feeding), counted per patch with overlaps double-counted, plus a separate "in any".
  - Label the UI metric "inside a patch", not "feeding".
  - Note that overlap resolution is first-index and unchanged.

**B6. The bump to version 3 and the `--check` guards.**
- Plan lines 9 and 22. Sources: `explore.ts:13,18–19`; `explore-picker.ts:11,15–17`; `particles.test.ts:68` (pins `rules.version` to 2).
- Any edit to `model.ts` changes `sourceSha256`, so `explore.ts --check` fails until regeneration. The picker pilot also hashes `comparison.ts`, so it is stale as soon as B2 lands.
- The plan's "or deliberately version scopes" is not an actionable instruction.
- Repair, as ordered steps:
  1. Copy the current `pilot.json`, `pilot.md` and `picker-pilot.json` to a preserved location (for example `pilot-v2.*`) before regenerating.
  2. Add a numeric-equivalence check. It compares fresh default-world results against the preserved v2 `results` and `runs` by JSON round-trip equality. It excludes only `rules.version`, `sourceSha256`/`sourceHashes`, `runtime`, `rulesVersion` and the embedded `modelVersion`. It must fail on any other difference.
  3. Regenerate and rerun `--check`.
  4. Update the test at `particles.test.ts:68`.
  5. State that the comparison is valid only if run on the same Node version as the recorded `runtime`. Otherwise report "unverified" rather than "equal".
- Also enumerate every consumer of `RULES.version` with a grep before editing. I found `comparison.ts`, `explore-picker.ts` and that one test.

## Should fix (could cause wrong behavior or misleading claims, but not stop-work)

**C1. Specify the move's exact placement and form.**
- Sources: `model.ts:76–77`, `:70–73`.
- Do it inside `advance()`, after `this.tick++`, before renewal and the force pass. Renewal is position-independent, so ordering only matters for the written contract.
- Because `step()` only calls `advance()` while particles exist, an empty world stays frozen. A last-survivor death on tick *t* still leaves patches moved for *t*. Both are correct, and the plan should say so.
- Don't add fields to `FoodPatch` (that would change `snapshot().food`). Derive direction from the index: row `= floor(i/3)`, east for rows 0 and 2, west for row 1. Rows are y-rows, because the construction loop is y-outer.
- "Exactly speed" is not literally true in float64 after a wrap. Tests should use tolerance for position and exact equality only for same-runtime replay. Use a conditional subtract/add for the seam rather than the `+1 %1` form, to avoid per-tick rounding.
- State that census at tick *t* reports patch positions as used in feeding on tick *t*.

**C2. Environment validation.**
- Validate in the style of `validateRecipe` (`model.ts:15–26`): exact key set per `kind`.
- `still` must reject a `speed` key. `travelling` requires a speed in the exact two-value allowlist. Reject `NaN`, `-0`, strings and `null`; accept only `undefined` as the default.
- Copy then freeze, so the caller's object is not retained.
- The stop-rule's "one speed reduction" (line 21) conflicts with "no other values accepted". Say it requires a version 4, not a patch.

**C3. Extinct-world handling in evidence, UI and export.**
- Source: `comparison-clock.ts:4–12`; `explore.ts:41`.
- The comparison tick keeps running while an extinct world's `world.tick` and patches stay frozen at extinction. The export must record `comparisonTick`, per-world `tick`, and `extinctionTicks`.
- Divide-by-zero metrics (in-patch fraction, mean displacement at the final tick) must be `null` or "—". They must not be 0 or NaN, which `JSON.stringify` turns into `null` silently.
- Charts should end at extinction, not extend a zero line.
- The oases evidence tool should also stop at extinction (as `explore.ts` does). Record the final patch positions, and the ragged arrays are fine.
- The page's play, step, and auto-advance paths must all go through `advanceComparison`, as `picker.ts:137` does. Reset must reconstruct all three worlds and null `extinctionTicks`.

**C4. Cross-check the still arm against history.**
- The still-environment run at ticks ≤3000 for pursuit seeds 1201–1203 should equal the corresponding `pilot.json` pursuit census prefix exactly. This is a cheap, reproducible way to meet "compare saved default numeric outcomes". It should be a named check, not just prose.
- Same for the unmodified-call path used by `explore-picker.ts` (four arguments).

**C5. Label "following" as supplied.**
- The food-seeking force is 3.5e-5 with drag 0.92, so steady-state seeking speed is about 4.4e-4. That is above both patch speeds.
- Tracking is therefore guaranteed by the supplied steering. The labels and the report should say "tracks because of the supplied nearest-patch steering", not suggest emergent following.
- Three seeds with chaotic divergence from tick 1 support only descriptive comparison. No tests or "better/worse" wording.

**C6. Stop rule vs the still baseline.**
- "Every moving run empties before 1000" is only informative if the still arm outlives 1000. If still also empties, record "uninformative". Also say what happens if only the faster arm empties.

**C7. History truncation.**
- Source: `model.ts:123`.
- `historyMax` is 300 samples at 10-tick spacing, so the page and export show only the last 3000 ticks of a 6000-tick run. Label it, or the 6000-tick evidence file must come from the tool's own 100-tick census rather than `snapshot().history`.

**C8. Snapshot and observation shape.**
- The existing `particle-playground-observation` snapshot gains `environment` and `rules.version: 3`. Check the old `/particles` page and tests for deep-equality use.
- The three-world export needs its own `kind`. It must not parse as `particle-recipe-selections` and must say it is not resumable.
- Keep the "same-runtime only" wording. Browser recordings and Node evidence won't be bit-identical because `Math.hypot` and `sqrt` are not guaranteed to agree across engines. Tie each recording to a seed and tick range as illustrative.

**C9. Build and route exclusion.**
- Line 17 says to "verify" exclusion from the image build. Make it a concrete check: the new HTML entry must be registered in the Vite inputs for local dev, and the deploy artifact must contain no `particles/oases` output. I did not inspect the Vite config or the Dockerfile, so I can't say whether the existing block covers nested paths.
- Hidden-page and reduced-motion handling should reuse the picker's logic (`picker.ts:25,186`), not be re-implemented.

## Smaller notes

- The displacement metric needs a pre-step snapshot of `id → (x,y)`, since the model doesn't expose it. Do that in the tool, not in the model.
- Cap detection: reuse `explore.ts:37`'s end-of-tick population equals `populationMax`.
- Row-1 patches and row-0 patches overlap in different ways at different times, so apparent encounters depend on the fixed first-index feeding rule. Mention this in the page copy.
- Reset recreates food from scratch by design. The "no reset" rule applies only to motion.

## Verdict

Not ready to implement as written: B1–B6 need a line or two each in the plan. After those, the design is sound and small. The migration and numerical-compat steps are the likeliest places for silent breakage.
