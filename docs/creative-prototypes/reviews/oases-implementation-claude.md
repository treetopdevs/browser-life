**Verdict: ready for the Codex/commit path.** I found no correctness or security blocker. One honesty item should be fixed before commit (R1), and the rest is polish. I read the saved final contents and ran no simulations or tests.

## Fix before commit

**R1 · Low · The pilot report points to recordings I couldn't find.**
- `docs/creative-prototypes/oases-pilot.md:21` says "Visual recordings provide separate illustrative observations", and the plan says "Show two recordings".
- No media files exist under `docs/creative-prototypes/**`.
- `oases.md` links none.
- The oases section of `decisions.html` links only `oases-plan.md` and `oases.md`. The only "recordings and screenshots" sentence I found there is about Pursuit.
- Repair: add the artifact paths, or drop the sentence and say plainly that no recordings are included.

## What I checked and found correct

- **Default still model.**
  - `model.ts:20` returns before any coordinate write, so recorded default trajectories can't change.
  - Patches move before renewal, steering and feeding (`:97-98`), and no extra RNG draw is added.
  - Row directions are right: `floor(i/3)%2` gives east, west, east.
  - Empty worlds stay frozen through the `step()` guard at `:92`.
  - The test at `particles.test.ts:84-103` places a particle just outside the old patch edge and checks it feeds only at the moved position. That proves the ordering.
- **Clocks.**
  - `advanceComparison` (`comparison-clock.ts:7-12`) steps living worlds on the shared tick and records `extinctionTicks[i] = nextTick`. That equals `world.tick` at death.
  - `oases.ts:87` shows the comparison tick for living worlds and the extinction tick for dead ones.
  - The export carries both `comparisonTick` and `extinctionTicks`. An extinct world's `current.tick` lags by design, so the two reconcile.
  - The synthetic zero sample at `drawHistory:138` is truthful.
- **Hidden and resume.**
  - `install` always pauses.
  - Hiding pauses, and becoming visible leaves it paused (`:173`).
  - Reduced motion and an initially hidden page both start paused (`:29`).
  - The `frame` loop re-checks `document.hidden`.
- **Reset and export.** Restart and export both use the active `settings`, not unsubmitted form fields. `install` builds all three worlds before swapping (`:96`), so a failure leaves the old comparison in place.
- **Migration.**
  - `comparison.ts:62-72` rebuilds the full graph under the claimed source version and compares it canonically.
  - The returned session is the rebuilt object, not the hostile input. A `-0` value, a `__proto__` key or extra fields can't leak through.
  - Nesting and size are bounded.
  - The picker's `install` is reached only after the parse succeeds (`picker.ts:179-180`), and the notice names the source version.
  - The tests cover tampering, version 4 and the round trip.
- **Evidence arithmetic.**
  - Interval closing at multiples of 100 and at extinction is correct.
  - The 10×10 transition matrix is indexed with `+1`, so its sum equals the matched pairs.
  - The first-containing patch matches the feeding `break` order.
  - The after-1000 range is strictly greater than 1000.
  - The energy residual is computed per tick.
  - The report values (nine runs reach 6000, no cap ticks, residual 4.2e-8) agree with the code's definitions.
- **Still compatibility.** The jsonl records 93 censuses, which is 3 seeds × 31 ticks (0 to 3000 in steps of 100). The script throws if the runtime isn't Node 24.2.0, which is the right strictness.
- **Build and routes.**
  - No site code imports the particle model.
  - The Dockerfile globs match the default `[name]-[hash]` naming: `particles-*` covers the `particles-model` and `particles-clock` manual chunks, and `particleOases-*` and `particlePicker-*` cover the entries.
  - Caddy's `^/particles(/|$)` block covers the nested route.
  - `DIAGNOSTIC` in `public-routes.spec.ts:20` includes the route for the noindex, no-canonical and not-in-sitemap checks.
- **Labels.** Steering and food movement are disclosed as supplied. The panel states that the contact measure doesn't show feeding and that population change doesn't establish adaptation.

## Optional polish (not blockers)

- **O1 · `model.ts:12-14`.** `validateEnvironment` reads `value.speed` more than once. An accessor-based object could return different values on each read. Nothing in this slice feeds it JSON, so it's theoretical. Fix: `const speed = value.speed` once.
- **O2 · `explore-oases.ts:15-16`.** The hash list adds a non-existent `environment.ts` if it ever appears, which silently changes the `--check` semantics. Remove it.
- **O3 · `oases-still-compatibility.jsonl` line 3.** Unlike lines 1–2, it carries no SHA of `oases-pilot.json`, so the receipt isn't bound to that artifact. Add `currentSha256` for it (`check-still-compatibility.ts:43`).
- **O4 · `oases-pilot.md:23`.** It doesn't say that the jsonl receipt is the stdout of `check-still-compatibility.ts`. One line fixes that.
- **O5 · Wording.**
  - `oases.ts:12-13` says "0.0001 per tick" with no unit (world widths).
  - `oases.md:3` says "same number of simulation ticks", which isn't true once a world goes extinct.
  - The `h1` "Can a group keep up with an oasis?" is a question the evidence doesn't test. The page text disclaims it, so I'd leave it.
- **O6.** Restart discards unsubmitted form edits, the same as the picker.

## Unverified runtime behavior

- No test asserts the contents of `dist` after the Dockerfile `rm`. The globs are correct by reading, but I didn't build. Verify that once locally and don't add infrastructure for it.
- I didn't check actual rendering, chart appearance or axe results.
- Recording claims can't be checked until R1 is resolved.

I wrote nothing, and I'm not calling this ready for merge or deploy. Only the code path is clear.
