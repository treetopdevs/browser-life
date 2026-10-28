No blockers. The physics, energy accounting, newborn scheduling, cap, replay, export and packaging checks hold up. I read everything and ran nothing.

## Checked and fine
- **Energy:** the ledger identity is exact: births halve a parent's energy, and feeding only moves energy from patches to particles. The pilot's maximum residual is 6.8e-9.
- **Newborns:** `model.ts:83-103` appends them after the adult loop, so they never move or eat in their birth tick. IDs stay ascending, so the order is stable.
- **Cap:** `old.length + newborns.length >= populationMax` can't overshoot.
- **Randomness and torus:** the mutation stream is separate, so toggling mutation doesn't shift the birth draws. `wrap` and `torusDelta` are correct, and the seam test discriminates.
- **Self-interaction:** `i===j` is skipped.
- **Export:** it says "observation only", so it makes no resumable-checkpoint claim.
- **Production exclusion:** the Vite input, `noindex`, the `DIAGNOSTIC` entry, `rm dist/particles` in `Dockerfile.site:6`, and the Caddy 404 are all in place. The Caddy regex also covers `/Particles`.

## Should fix (small, but worth doing)
1. **Screen-reader chatter** (`main.ts:33`, called every 10 ticks via `showCensus` → `showStatus` at `:67`). `#run-status` has `role="status"`, and `textContent` is rewritten even when the text hasn't changed. Replacing the text node can make screen readers re-announce "Running" about 3 times a second. Fix: only assign when the text differs.
2. **The pilot's "no motion" check can't fail** (`tools/particles/explore.ts:42`). Its threshold is `< 1e-8`, but real speeds are about 4e-4.
   - Flocks move at 4.7% of `speedMax` and colonies at 7.5%. They end in 10–24 occupied bins out of 100.
   - So the "flocks" preset parks on the food patches rather than flocking. `decisions.html` already treats pursuit as the lead.
   - Fix: report a "settled" flag, for example mean speed under 10% of `speedMax` or at most 15 occupied bins.
   - If watchable flocks matter, adjust that preset (more alignment or less food pull) and rerun the pilot, recording the reason as the plan requires.
3. **The food pull isn't disclosed in the page copy** (`model.ts:73-77`, `index.html:16`/`:37`). Every particle is steered toward the nearest food patch, but the page says "Unscripted motion" and describes only attraction and repulsion rules. Fix: add one sentence about the gentle pull toward food, and drop "Unscripted".
4. **The pilot evidence can go stale.** `pilot.md` pins the SHA-256 of `model.ts`, so any model fix makes it stale. Fix: add a small vitest that checks `pilot.json.sourceSha256` against `model.ts`. After any model edit, rerun the pilot and refresh `decisions.html`; its "Reviews are pending" and "reviews running" lines are stale now.
5. **Reset after extinction stays paused** (`main.ts:29`, `:100`). `showStatus` sets `paused = true` for good, and `reset()` keeps it, so the new world sits static with "Paused". It's rare, since 0 of 9 pilot runs went extinct. Fix: in `reset()`, clear `paused` unless reduced motion or a hidden tab applies.

## Testing gaps (optional)
- Nothing checks that a mutated child differs from its parent by exactly one trait, by ±`mutationSize` or a clamp. The tests only assert `mutations > 0`.
- No partial-cap case, such as 239 particles with several eligible parents.
- Nothing tests the hidden-tab pause, the 4× pace, or extinction followed by reset in the UI.
- Nothing guards the packaging: no test checks `Dockerfile.site` or the Caddyfile for particles. The garden has no such test either, so this matches current policy.

## Polish
- `style.css` `#history`: the canvas is 540×150 but CSS sets width 100% and height 95px, so the chart stretches or squashes. Use `aspect-ratio: 540/150; height: auto`.
- 10px text on `.stats dt`, `.chart-note` and `.speed-label` is hard to read.
- `#control-note` isn't a live region, so "Observation downloaded" isn't announced.
- When extinction disables Play or Step, a focused button loses focus.
- `seed.reportValidity()` (`main.ts:95`) pulls focus from the preset select when the seed is invalid.
- The startup message "Paused · press Play to begin" (`main.ts:25`) is overwritten by `reset()` at `:100`.
- "Blocked births" counts repeated attempts. It is documented, but the number gets large at the cap.
- Hashed `assets/particles-*.js` and `.css` stay in `dist` after `rm dist/particles`. That is the same as the garden.
- `deploy/README.md` documents the garden exclusion but not particles.
- `RULES.version` is bumped by hand, so edits to physics code alone won't change it.
