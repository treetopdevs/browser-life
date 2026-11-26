**Verdict: implementation can proceed once the three blockers below are folded into the plan. Each is a one-line addition.** I read `plan.md`, `CLAUDE.md`, `apps/lab/vite.config.ts`, `apps/lab/garden/index.html`, `tests/e2e/public-routes.spec.ts` and `Dockerfile.site`. I did not run anything.

## Blockers

**B1. The plan doesn't say how `/particles/` gets built or kept off the public site.**
- Evidence:
  - Each page is a separate Rollup input (`apps/lab/vite.config.ts:156-170`).
  - A page with no canonical link must be `noindex` and unlisted, or the build check fails (`tests/e2e/public-routes.spec.ts:182-188`).
  - `/garden/` is hidden by copying the `noindex` pattern (`apps/lab/garden/index.html:7-8`), removing it from the built site (`Dockerfile.site:6`) and blocking it in Caddy (`deploy/Caddyfile:4-6`).
  - Plan line 7 says "no deployment" but is silent on the build.
- Risk: a new input ships in the next site image, which could be a deploy of a page nobody approved. Alternatively `public-routes` fails on it.
- Remedy: add `apps/lab/particles/{index.html,main.ts,…}` as a hidden route. Give it `noindex`, no canonical link, and an entry in the `DIAGNOSTIC` list (`public-routes.spec.ts:133`). Add it to the vite inputs. Add `rm -rf apps/lab/dist/particles` to `Dockerfile.site:6` and a `/particles` rule in the Caddyfile. Do the last two only if you want it held back at the next deploy; ask the user.

**B2. Determinism is claimed but no PRNG or iteration-order contract is stated.**
- Evidence:
  - Plan line 13 requires "deterministic replay for same seed/settings".
  - The existing kernel uses a counter-based integer PRNG (`CLAUDE.md`, Architecture).
  - `Math.random`, `Date.now` and `performance.now` appear in `apps/lab/src` (11 occurrences). A copy-paste there would break replay silently.
- Remedy: pin three rules in the plan.
  - Use a seeded integer PRNG (e.g. mulberry32 or splitmix32), and give a separate stream per decision type or key it on tick and particle id. A single shared stream lets a mutation toggle shift every later draw.
  - Make iteration order explicit: sort by id, and spatial-hash buckets must be deterministic.
  - Don't mix `Math.fround`/float32 into the hash. Use plain float64 consistently, or fixed-point, and say which. The cross-browser replay claim is only safe if all arithmetic is IEEE `+ - * /`. Avoid `Math.sin`, `Math.exp` and `Math.pow`, whose results differ by engine.
- Add one test: run 3,000 ticks twice and compare a state hash. Run the same test in Node and in Chromium if the export says "replayable".

**B3. The export's "rules version" has no owner, and the replay claim is untied to it.**
- Evidence: plan line 11 asks for "seeded JSON observation download with settings and rules version". `RULE_VERSION` in `packages/schema/src/config.ts` belongs to the research kernel.
- Risk: reusing that constant would suggest the 2D world follows research rules. Having no version makes the export unverifiable.
- Remedy: define a separate `PARTICLE_RULES_VERSION` and put it in the export, along with seed, preset, every setting, the tick, and a final state hash. Label the JSON "observation, not a replay log" unless the file really can reproduce the run. State "engineered rules" in the file.

## Important omissions (small)

**I1. Birth and feeding accounting is under-specified.**
- Evidence: plan line 9 says births "divide parent energy" and food is "renewable".
- Remedy: write the invariant as `Σenergy_after = Σenergy_before + food_eaten − metabolism − births_cost` (no resurrection). The test asserts it each tick, with exact equality if energy is integer and a tolerance if float. Say whether a birth cost is lost or transferred. Spell out the predation transfer rule or drop predation. "Pursuit" presets read as predation, so decide now.

**I2. Newborn and self-interaction rules need a mechanism, not just a test.**
- Evidence: plan line 13 lists "no self interactions or multiple updates of newborns" as an acceptance item.
- Remedy: the step builds new particles into a pending list and appends them after the update loop. Neighbour queries skip `j === i`. Add a test with a forced split on the first tick.

**I3. Bounds need numbers.**
- Evidence: plan line 9 says "bounded speed, population and local interactions" and line 11 says "bounded recent history", with no values.
- Remedy: give a hard population cap (say 600 to 1000), a speed cap, an interaction radius with a spatial grid so each step is not O(n²), and a history ring buffer length. State what happens at the cap: births blocked and counted as "blocked births", never silent. Shows up in the export and the UI.

**I4. The run loop must separate physics from rendering.**
- Evidence: plan line 11 says "rendering speed never changes timestep physics", "hidden pages suspend", and reduced motion starts paused.
- Remedy: fixed `dt` per tick. rAF accumulates a time budget and runs at most N ticks per frame (with a clamp after a long hidden tab, so there is no catch-up burst). `visibilitychange` pauses and stays paused on return. `matchMedia('(prefers-reduced-motion: reduce)')` is read at load. Test the tick function with no DOM, so it can run under vitest.

**I5. Acceptance runs need a defined output.**
- Evidence: plan line 13 asks for 3 seeds × 3,000 ticks per preset and to "record extinctions, turnover and spatial activity".
- Remedy: write this as a vitest or Deno script that prints a table (extinct y/n, tick of extinction, births, deaths, mean displacement per tick). Save the table under `docs/creative-prototypes/`. Define "spatial activity" up front (for example mean displacement per particle per tick, or occupied grid cells). Also say what failure looks like for a watchable preset: every preset extinct or capped on all 3 seeds fails the check. Otherwise "record" can't reject anything.

**I6. Toroidal distance and the family colour label need to be honest.**
- Toroidal: use the minimum-image delta `d - W·round(d/W)` for both the neighbour query and the pursuit direction. Test across the seam.
- Colour: family colour means an inherited lineage root, not similarity. Trails, if drawn, show past positions only. The UI text should say "engineered attraction rules", not "evolved behaviour".

## Optional refinements
- Put the sim in its own module with no DOM (`apps/lab/particles/sim.ts`), so tests run in vitest (`apps/lab/test/*.test.ts` is already the home for lab tests). A Playwright spec can follow `tests/e2e/public-garden.spec.ts`.
- Keyboard and accessibility: add a `public-a11y` check for the new page. The existing spec covers the public pages.
- The `decisions.html` file in plan line 20 is outside the app and should stay out of the vite inputs.
- Don't make `pnpm gen:cards` or the world-card manifest depend on this page (`vite.config.ts:120-124`).

## Already fine
The scope is small, deployment is excluded, the 3D port and preregistration are out, and the plan asks for screenshots and clips of two presets. The plan avoids calling movement "evolution". Nothing here needs a redesign.
