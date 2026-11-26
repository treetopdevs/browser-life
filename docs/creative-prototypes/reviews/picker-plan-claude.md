# Review of `picker-plan.md`: implementation can proceed once the six blockers below are written into the plan

This review is read-only and covers the live tree. I wrote no files, so `reviews/picker-plan-claude.md` is still empty. Someone else is already editing this worktree: `vite.config.ts:168`, `Dockerfile.site:6`, `apps/lab/particles/index.html:17` and `tests/e2e/public-routes.spec.ts:20` already mention the picker, but `apps/lab/particles/picker/` doesn't exist yet. The build entry and the e2e diagnostic check will fail until the page lands, so the page and its entry should land together.

## Blockers (small fixes, decide before coding)

1. **The first slate contradicts the user outcome.** `picker-plan.md:6` promises "three genuinely different recipes", but `:12` makes the first slate a baseline plus two small variants.
   - **Fix:** the first slate is the three presets (flocks, pursuit, colonies), with root IDs like `preset:flocks` and no parent.
   - **Fix:** from then on, each slate is the kept recipe plus two variants.
   - **Fix:** set variant step sizes large enough to show up in a census (a few matrix entries by ±0.25 or more, alignment by ±0.03, renewal by ±0.1).
   - **Why it works:** founders come only from `random` (`model.ts:43-46`), so one seed gives all three worlds identical founders. That is a clean controlled comparison.

2. **Variant derivation needs a stateless RNG.** The plan says only "separate RNG" (`:12`), but an import then has no stream state to resume.
   - **Fix:** derive variants as a pure function of (session breeding seed, kept recipe ID, selection index).
   - **Fix:** use deterministic IDs such as `r<index>-<slot>`, never time or random IDs.
   - **Fix:** quantize recipe values to a 0.001 grid. That removes float drift and `-0` JSON round-trip problems, and it makes "exact kept recipe" and "changes at a bound" testable (reflect the step direction at a bound, and dedupe the two variants against each other and the parent).
   - **Fix:** make import rules concrete (`:14` says only "IDs/relationships"). Each next slate's baseline must deep-equal the chosen recipe, children's `parentId` must equal the chosen ID, IDs must be unique, the chosen ID must be among the candidates, and the next slate must equal its recomputation.

3. **Extinction breaks same-tick display if copied naively.**
   - `step()` stops advancing an empty world (`model.ts:53`), so `world.tick` freezes at extinction.
   - `main.ts:28-29` and `main.ts:137` pause everything when the one world dies.
   - **Fix:** the picker owns a shared clock, separate from `world.tick`.
   - **Fix:** it steps every living world each shared tick, and checks the frame budget between lockstep ticks, never between worlds.
   - **Fix:** it pauses only when all three are extinct, and shows "extinct at tick N" per world.
   - **Fix:** allow keeping an extinct recipe.
   - **Fix:** store a per-candidate outcome in each selection record (alive or extinct, extinction tick, population, births, deaths, mutations). Label it as observed, not verified on import.

4. **Nothing pins default trajectories.** The existing test only compares two fresh runs (`apps/lab/test/particles.test.ts:5-10`), so "defaults unchanged" would be checking the code against itself.
   - **Fix:** before editing `model.ts`, assert that fresh runs match `docs/creative-prototypes/pilot.json`, which has census histories for 3 presets × seeds 1201–1203. Compare the integer census fields exactly.
   - **Fix:** add no draws to `random` or `mutationRandom` in the constructor.
   - **Fix:** pin that an explicit recipe copied from a preset equals the default path.
   - **Fix:** `snapshot()` (`model.ts:117`) reports `preset` and `rules.foodRenewal`, which would misreport a custom recipe. Use `preset: 'custom'` or a recipe ID, report the effective recipe, and keep the existing keys, because `particles.spec.ts:34` reads `settings.preset`.

5. **Provenance has no mechanism.** `explore.ts:13,18` hashes all of `model.ts`, and `explore.ts:19` deep-compares `RULES`. Any `model.ts` edit makes `explore.ts --check` fail.
   - **Fix:** keep recipe bounds and the document format version in new exports, not in `RULES`.
   - **Fix:** don't bump `RULES.version` (`particles.test.ts:67` expects 1).
   - **Fix:** after the edit, regenerate the pilot under the same Node version and require the committed diff to touch only the model hash and runtime fields. That diff is the compatibility proof.
   - **Fix:** put the picker run in its own artifact, with the hashes of the model and picker files, the runtime, the seeds, the tick count and the chooser rule.

6. **The build exclusion still leaks one chunk.** The `particlePicker-*` globs now exist (`Dockerfile.site:6`). But two entries both importing `model.ts` make Rollup emit a shared chunk, probably `assets/model-<hash>.js`, which no glob removes. I expect this from Rollup's behavior and haven't built it.
   - **Fix:** name that chunk with `manualChunks` so it matches `particles-*`, or extend the removal list.
   - **Fix:** assert after `pnpm build` that no file in `dist/assets` contains particle-model text (for example `foodSeekingForce`).
   - `deploy/Caddyfile:9` already covers the nested path.

## Important, smaller

- **Import atomicity.** Check `file.size` before reading. Build recipes from validated numbers only, never by spreading parsed JSON. Construct all three new `ParticleWorld`s before replacing session state, because the constructor can throw. Reset the file input after each import. Cap the reason length and the array sizes.
- **UI test placement.** `vitest.config.ts:19` sets no DOM environment, so the "invalid import atomicity (UI)" unit test can't run there. Split it: a pure `validateSession(text)` function tested in vitest, and the UI behaviour tested in Playwright.
- **Pure model.** Keep the picker model free of DOM code so Node can drive it for the recorded sequence.
- **Recorded sequence.** The plan gives no round count and no chooser, so the sequence could be cherry-picked. State both before running. A rule like "highest mean speed among living candidates" is enough, with extinct worlds reported rather than dropped.
- **Extreme recipes.** Add finite, bounded and energy-ledger checks for corner recipes (all +1, all −1, alignment 0.2, renewal 0.3 and 1). Today only the three presets are tested (`particles.test.ts:11-28`).
- **Manual editing.** State whether recipes can be edited by hand. I'd leave that out of v0, because an edited recipe has no parent. Make "recipe controls" mean "start a new session from a preset".
- **The 30-selection limit.** The 30th Keep records but generates no next slate. "Start new session" should confirm, or offer an export first. A page reload loses in-memory history, so say that on the page.
- **Mutation setting.** Record `organismMutation` in the document, and fix it to on or make it a toggle. The "two processes labelled separately" claim needs it.

## Optional

- Add a plain-language "what changed vs parent" line per candidate, derived from the recipe. This helps the creative outcome and matches the standing preference against bare dropdowns.
- Auto-pause at about tick 3000, which is the span the 300-sample history window covers.
- Disable Keep at shared tick 0.
- Give each candidate canvas a text label of its population, so the comparison isn't color-only.

## Verdict

Proceed once items 1–6 are in the plan. No scientific preregistration or cross-engine replay is needed.
