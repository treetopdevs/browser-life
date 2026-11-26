Status: I've finished reading the final text of `picker.ts` and `comparison.ts`, and nothing changed since I first read them. I made no edits and ran no commands. I also didn't write the empty `reviews/picker-implementation-claude.md` or the plan file. The review is below for you to save.

## Verdict: no blockers

I found no defect in recipe validation, variant generation, canonical history rebuild, import atomicity, lockstep stepping, or production exclusion. The items below are polish and evidence gaps.

## Findings (prioritized)

**P2-1. Variation copy mislabels weaker attraction as repulsion** (`picker.ts:83`)
- **Trigger:** a variant lowers a positive coefficient, such as Flocks 0.75→0.60, Pursuit 0.95→0.80, or 0.15→0.00.
- **Impact:** the card says "Mint → Mint more repulsion", but the coefficient is still attractive and just weaker. This is the sentence a visitor uses to explain their choice. The reason is then saved in history and in the export.
- **Fix:** label by direction of the number: `> baseline ? 'more attraction' : 'less attraction'`. If you want repulsion wording, branch on the sign of the new value.
- **Related, minor:** after the first Keep, the `<h2>` becomes "Your favorite"/"Variation n" (`picker.ts:93`), but the canvas `aria-label` and section name still say "World n" (`picker.ts:38`).

**P2-2. The extinct-world lockstep path has no test**
- **Where:** `picker.ts:122-126` (`advance`), `:55-60` (`status`), `:181` (all-extinct stop), `:72` (extinct text).
- **Why untested:** all 27 pilot candidates survived (`picker-pilot.md:19`), and neither the unit nor the e2e tests empty a world. The plan listed extinct worlds explicitly.
- **Static read:** the logic is correct. A living world steps, a dead one is skipped, `extinctionTicks[i]` is recorded once, and only an all-extinct session auto-pauses.
- **Fix:** move the three-world step and extinction bookkeeping into a pure function in `comparison.ts`. Unit-test it by emptying one world, as `particles.test.ts:43` already does with `world.particles=[]`. Otherwise record it as untested in `picker-visual-check.md`.

**P2-3. Picker-pilot evidence has no freshness check, and the `.md` is hand-copied**
- **Where:** `explore-picker.ts` has no `--check`. The model hash is `b30a8b83…` in `picker-pilot.json:6` and `picker-pilot.md:29`; the comparison hash is `fb697e02…`. `picker-pilot.md:32` points at `explore.ts --check`, which only covers `pilot.json` and `model.ts`. The table in the `.md` is hand-written.
- **I verified:** the model hash matches `pilot.json`, and the table rows match the stated pick pattern. For example, round-1 slot 1 (174, 0.000348) equals round-2 slot 0 for seed 1201.
- **Not verified:** whether `comparison.ts` still hashes to `fb697e02…` after the late edits.
- **Fix:** before committing, recompute both hashes. Add a `--check` mode to `explore-picker.ts` that compares both hashes, or soften the doc.

**P3-1. Deeply nested extra field gives a poor import message** (`comparison.ts:47-50`, `:67`)
- **Trigger:** a valid-looking header plus an extra key such as `"x":[[[…]]]` that nests about 100k levels deep within 128 KiB. V8's `JSON.parse` copes, then recursive `canonical(data)` overflows the stack.
- **Impact:** atomicity holds, but the user sees "Import refused: Maximum call stack size exceeded."
- **Fix:** reject any key set other than the ten top-level keys before calling `canonical`, or map `RangeError` to a generic message.

**P3-2. Keep handler has no try/catch** (`picker.ts:42-47`)
- `keepFavorite` can throw, for example on a reason over 240 characters. `maxlength` normally prevents that, but a throw would give no UI feedback.
- **Fix:** catch and write the message to `#keep-help`.

**P3-3. The keyboard and visibility claims outrun the tests**
- `picker-visual-check.md:7` says "keyboard access" is covered. The e2e test only presses Enter once on One tick (`particle-picker.spec.ts:86-87`).
- Both e2e tests run with `reducedMotion: 'reduce'`. Hidden-tab pause (`picker.ts:174`) and auto-run are never exercised by a spec.
- Reduced motion is read once at load (`picker.ts:24`), which is fine for the plan.
- **Fix:** tone the doc down, or add a `visibilitychange` spec.

**P3-4. The Docker exclusion is not tested** (`Dockerfile.site:6`)
- It relies on filename globs, and a non-matching glob fails silently. The residual risk is low: `dist/particles` is removed, Caddy returns 404 for `/particles`, and nothing links to orphan assets.
- **Fix:** add a tiny test or CI grep that no `*particle*` file or string remains after the `rm`.

## Checked and fine (not findings)

- **Exclusion:**
  - The `particles-*.js` and `particles-*.css` globs cover `particles-model-*.js`. Together with the `particlePicker-*` globs, that covers all five particle assets in the current `dist/assets`.
  - A case-insensitive grep of `dist` finds the string "particle" only in those five assets plus the two particle HTML pages.
  - `dist/particles/picker/` goes with the directory removal. Caddy's `^/particles(?:/|$)` 404 also covers the nested route, `DIAGNOSTIC` lists the picker, and no sourcemaps are emitted.
- **Recipe validation:** the key set, 3×3 shape, finite bounds, and holes are all rejected. The result is copied and frozen, and the constructor re-validates.
- **Default compatibility:** `recipeForPreset` reproduces the old defaults, with food renewal 0.65. Together with the pinned 300-tick hashes and the 279-census pilot equality you reported, that is credible.
- **Variants:**
  - They are pure in seed, parent, round, and slot. Each differs from the parent in one coordinate, and the second also differs from the first.
  - The reflect/dedupe loop handles the colonies alignment 0.015 case, where reflection lands back on itself (`comparison.ts:27-30`), by trying the next attempt.
  - All 11 coordinates in both directions are tried, so it can't fail.
- **Import:**
  - Rebuilding by replaying the choices and comparing canonically rejects extra fields, `__proto__` keys, missing optional fields (`reason`, `mutation`), non-integer seeds, and inconsistent ancestry or ids.
  - The size is checked before reading and again in bytes after. Worlds are built before the swap in `install`.
  - A stale read is dropped. A user action during the read bumps `revision`, which is a clear refusal. A superseded import exits silently.
- **Export size:** worst-case content (30 reasons of 240 control or surrogate characters at 6 bytes each, plus 63 pretty-printed nodes) is about 85 KB, so any export fits under 128 KiB.
- **Selection limit:** the 30th selection produces a usable final slate, and further selections stop with an explicit message.
- **Lockstep:** the shared clock is used for all worlds. Counters share one tick, and Keep is only enabled when paused, so `evaluationTick` equals what is displayed. While running, the canvases lead the numbers by up to 9 ticks (`picker.ts:184-185`), which is display cadence only.
- **XSS and docs:** only fixed strings go through `innerHTML`, and imported text uses `textContent`. The doc claims I could check hold: 9 + 7 = 16 unit tests, 2 picker e2e tests, and 9×31 = 279 censuses.

## Limits of this static review

- I did not run tests, a build, or a browser, and I didn't diff against base `86d3a6e`. I can't confirm the `dist` assets were built from the final sources.
- I couldn't recompute the SHA-256 values, and the "seven route checks" claim in `decisions.html` is unchecked.
- Playwright and axe results, the visual and recording claims, the 27 pilot numbers, the full-artifact equality with v1, and cross-runtime stability of the pinned hashes (Node 24.2) are all taken from the docs.
- I read `decisions.html` only by keyword because it is a single very long line.
