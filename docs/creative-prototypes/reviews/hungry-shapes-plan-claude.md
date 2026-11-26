Review of `docs/creative-prototypes/hungry-shapes-plan.md` against CLAUDE.md, `apps/lab/src/development/model.ts` and `comparison.md`. Nothing was edited or simulated. The zero-byte `reviews/hungry-shapes-plan-claude.md` is still untouched, so this reply is the review.

The budget arithmetic checks out. The preservation rules are mostly sound. The weak spots are the gates and the feasibility of the food design.

## Blockers: fix before freezing

**1. The generation-2 trigger doesn't match the comparison.md stop rule.**
- comparison.md says "empty out before a second generation". In the model, founders are generation 0 and the first children are generation 1, which is the natural meaning of "second generation".
- The plan says "before any organism reaches generation 2". That fires revision on a different, broader event.
- The first birth is at tick 160, since the earliest reproduction check is at age 160 with at least 18 cells. Generation 2 needs another 160 ticks, so tick 320 or later.
- Pick one reading, say so explicitly, and state that it is a deliberate tightening of the comparison.md rule if you keep the plan's version.

**2. The decision table isn't exhaustive.**
- Only two cases trigger v2: both scarce worlds die before generation 2, or both are capped with no visible difference. Only patches can earn extension.
- Several outcomes are unhandled:
  - one world extinct and the other capped;
  - patches alive with no late births;
  - patches alive with births but no visible difference;
  - uniform alive while patches is dead.
- The plan says "stops inconclusive" for these, but v2 can then never fire in the likeliest failure, a slow die-off after generation 2.
- Write an explicit outcome table with one row per case.
- State what happens after v2. comparison.md says to stop and revisit 3D moving food if v2 also fails. The plan omits that.
- State whether v2 is run in this task or the task stops and reports.

**3. Uniform is never used in a gate, so an allocation effect can't be claimed.**
- The slice's stated question is uniform versus patches at equal offered budget.
- The extension rule and the "promising" rule compare patches only against original, which offers 9,216 units per pulse against 768. Any visible difference is mostly the 12× scarcity, not the allocation.
- Require the documented difference to be patches versus uniform as well. Otherwise word the outcome as "scarcity effect", not "allocation effect".

**4. "Cap48" is undefined, and the original world defeats `== 48`.**
- The retained original runs end at 47–48 bodies, with 47 in some. Deaths in a tick free a slot before the birth check, so end-of-tick population hovers at 47 or 48.
- A literal "population == 48" can score a ceiling-bound world under 20%.
- Define it exactly, for example end-of-tick population >= 47, or use cap-blocked attempts per late tick.
- Also report `blockedSpaceBirths`. The plan's UI lists only cap-blocked attempts. In patches, space blocking may dominate.

**5. The visual gate has no pre-registered rubric.**
- "Visible growth/empty-space difference documented by parent" is the deciding criterion for both extension and retention.
- The same problem was raised in the comparison review, where no rubric was fixed before the inspection.
- Fix before the run:
  - the checklist: occupied-tile share, share of occupied tiles inside the target mask, clustering and gaps;
  - the frames to look at (ticks 500, 1500, 3000) and whether the labels are hidden.
- Supporting numbers (inside-mask occupancy fraction, occupied-tile count) are fine as context. They just can't replace the visual call.

**6. The gates allow degenerate survivors.**
- "Living bodies at 3000" and "more than 0 births in 2501..3000" can be met by one body and one birth.
- The original produces about 38 births per 500 ticks.
- Add a minimum population (for example >= 12) and a minimum late birth count, set before the run.

## Feasibility: check the arithmetic before committing

**7. Uniform is almost certain to go extinct early.**
- Each tile gets +1 per 12 pulses, which is 1/60 per tick, and cells never move. Upkeep is 1/8 per cell per tick, so supply per cell is about 7.5× short.
- Rough budget for a founder:
  - its tiles hold about 480 units, and its own store about 24;
  - growth moves about 92 units into structure;
  - it needs about 225 for upkeep until it reaches 24 cells, then 3 per tick.
- Net, it runs out around tick 220–350. That is plausibly before any generation-2 birth.
- So uniform is a floor, not a usable control. Say so in the plan. Consider whether a budget closer to demand would give a meaningful uniform arm.
- The 768 is exactly 9216/12, but the plan doesn't say why that value was chosen.

**8. The patch geometry conflicts with birth placement.**
- Patches have radius 4 (9×9). Newborns land uniformly in a 17×17 window around the parent's root. Only 81 of 289 tiles, about 28%, are inside the parent's patch, and fewer once occupied tiles are excluded.
- Bodies also extend past the patch. Straight growth can run more than 4 tiles out.
- About 72% of newborns therefore land on unreplenished tiles with a store of 12.
- Supply per patch tile is 768/972 per pulse = 0.158 per tick, against 0.125 upkeep per cell. That is marginal even for a fully in-patch body.
- Patches may well be an early die-off too.
- Record this expectation now, so the pilot isn't read as a surprise. If the outcome is ambiguous, it would also help to state a pre-run expected range.

**9. The pulse-to-tick mapping and the extinction-tick rule are implicit.**
- Pulse p=0 is the supply at tick 5, so p = tick/5 − 1. The plan doesn't say so.
- Supply runs before feeding, so a pulse at the extinction tick counts as executed.
- Write both down. The budget test (offered == 768 × executed pulses) depends on them.

## Preservation and provenance

**10. Pin down what "isolated copy" means.**
- "Keep original exports usable for fixtures" is ambiguous. If the copy re-exports or imports `RULES`, `validateGenome`, `GENOME_PRESETS` and `wrappedNeighbor` from the original, it isn't isolated. If it duplicates them, it can drift.
- State which. Also state that the copy's `RULES` stays identical, with new constants elsewhere, because the snapshot embeds `rules`. Any added field changes original-mode snapshot parity.
- The path `src/hungry-shapes/model.ts` should read `apps/lab/src/hungry-shapes/model.ts`.

**11. The parity test is too thin.**
- The plan has one seed at "representative milestones".
- Cheap and stronger: run original mode in lockstep with unchanged `DevelopmentWorld`, comparing every census tick and a food-hash plus full snapshot at the milestones, for 1201 with mutation on.
- Also compare against the retained `development-pilot.json` snapshots. It holds 0/1000/2000/3000, so 1000 and 2000 add checks that the new milestone set (0/160/500/1500/2500/3000) lacks.
- Run the lockstep comparison again for 1202 and 1203 if the extension happens.

**12. "Mutation enabled for accepted pilot runs" is ambiguous.** Say mutation-on only, and that no mutation-off runs exist or count.

## Accounting

**13. Original mode needs offered and overflow tracking too.**
- The legacy supply loop only counts accepted. Original-mode offered (9,216 per pulse) and overflow (a large share once tiles sit at 40) must come from the new accessor without touching the original snapshot fields.
- Add a test that original-mode accepted equals `ledger.supplied`.

**14. Death records and per-tick counts.**
- Starvation and age counts come from lineage `deathCause`. Also assert `droppedLineage == 0` and `droppedHistory == 0`. Both are safe at 3,000 ticks, but the plan only asserts "no records dropped" in prose.
- Per-tick births and deaths need the runner stepping one tick at a time. History is every 20 ticks only.
- Add the runner's own per-tick cap sampling to the immutable JSON so the late-window numbers can be recomputed.

**15. Late-window and extinction handling is mostly fine; make the wording tighter.**
- Zeros after extinction are used only for the 500-tick cap denominator. That is good.
- Add a one-line rule that a world extinct before tick 2501 scores late births = 0 and cap = 0%, but fails the "alive at 3000" requirement anyway.

## Packaging and interface

**16. The playground count is wrong.**
- `apps/lab/src/playground/page.ts` has 14 entries today. A grep for `href:` reports 15 only because it also matches the `Entry` type line. Adding this one makes 15.
- Check for tests that assert the count.

**17. Production exclusion needs concrete patterns.**
- `Dockerfile.site` removes private routes by explicit globs, for example `apps/lab/dist/development` and `assets/development-*.js`. `deploy/Caddyfile` blocks each route with a case-insensitive regexp.
- The plan only says "all uniquely hungryShapes/hungry-shapes assets". Name the exact:
  - Vite input key (`hungryShapes`);
  - `manualChunks` name;
  - Docker globs;
  - Caddy `@private_hungry` regexp.
- Make sure no chunk name collides with an existing glob. Also add a packaging test mirroring `development-packaging.test.ts`.
- If the copy imports from `development/model.ts`, `manualChunks` will share that chunk. Confirm the shared chunk is removed with `development-*`, or avoid the sharing.

**18. The UI is missing a few things.**
- It lists the engineered ingredients but not space-blocked births (see issue 4).
- It doesn't say how an extinct card shows its final tick against the shared 3,000 horizon.
- "Export observations" should say it carries the hungry source hash, so it can't be mistaken for a resumable checkpoint.

## Process

**19. Opening a dependent PR is outward-facing.** Confirm it is covered by your instruction. CLAUDE.md-level rules treat push and PR as needing an explicit yes. The plan says "no merge/deployment" but opens a PR on `codex/prototype-comparison`.

**20. Record the Node runtime.** `Node 24.2.0` is fine, but homebrew node 26 is broken on this machine. Say "nvm 24.2.0 on PATH" in the runner usage so reruns match.

## What checks out
- The pulse formula: 2053 is prime and coprime with both 9,216 (2¹⁰·9) and 972 (2²·3⁵). The 768 targets are distinct per pulse, and uniform covers every tile once per 12 pulses.
- Patch geometry: the twelve 9×9 squares are disjoint, 972 tiles, and the toroidal wrap never triggers on this grid.
- Ledger identity: overflow is outside `supplied`, so the residual stays zero.
- Seed rotation: `seed % targetCount` uses no RNG.
