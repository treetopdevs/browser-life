# Evolving ecosystem playground

A separate engineered 2D model inspired by Candidate 9. Open `/ecosystem/` with the lab development server (`pnpm dev`). Nothing has been deployed. The 3D kernel and frozen experiment evidence remain unchanged.

## What to try
Watch seed 1101. Protected descendants arrive at tick 100; their hunter arrives at tick 300. Choose Fast to follow several seasons, then pause and inspect the population lines and inherited-trait table. Replant to restart the seed. Manual planting and drought buttons are explicitly logged. Mutation and seasons can be disabled independently. Reduced motion starts paused.

The model deliberately supplies births, heredity, bounded mutation, food, refuges, special immunity, a counter-predator, and local droughts. Family colors remain stable while attack/defense change. Export saves a bounded observation snapshot, not an exact resumable run. Current counts update with the display; recorded history keeps its fixed 10-tick cadence regardless of pause, stepping or export.

## Decisions and observations — 2026-10-25
- Scope changed from research confirmation to interesting engineered behavior at the user's request. No new preregistration required for this toy model.
- Claude plan review completed before implementation. Review and resolutions are in [the plan](ecosystem-sandbox-plan.md).
- V1 kept the founding ecology alive but lost both staged families in all three seeds. Rejected as an arms-race demo; its six diagnostic readouts are preserved in `ecosystem-sandbox-exploration-v1.json`.
- V2 raised food renewal and trait costs, planted protected cells near food/prey, and explicitly gave defense ≥2 protection from Violet. Hunter bypasses that immunity. Maximum combined traits still cost more than passive uptake. We engineered these advantages deliberately.
- After all review corrections (v4, including mixed random-stream seeds), 2 of 3 staged runs retained all 5 families at tick 3000. Seed 1103 lost Jade and Hunter, retaining 3 families; Protected reached 67% of its population. This is a less balanced outcome, retained honestly rather than tuned away. None of the six staged/un-staged runs was sparse (<5% occupancy), monopolized (>95% one family), or frozen (no births in last 100 ticks). These are creative diagnostics on reused seeds, not independent confirmation.

| Seed | Staged final population | Protected / hunter | Living trait classes | Un-staged final population / classes |
| --- | ---: | ---: | ---: | ---: |
| 1101 | 8145 | 2321 / 767 | 73 | 7488 / 54 |
| 1102 | 8403 | 2716 / 338 | 70 | 7263 / 56 |
| 1103 | 8602 | 5774 / 0 | 32 | 7338 / 54 |

Readouts and 100-tick population histories: `ecosystem-sandbox-exploration.json`. Reproduce with Node 24: `node tools/ecosystem/explore.ts`. Variation is bounded to 25 attack/defense combinations per founding family; this is not open-ended evolution. Population changes do not establish improved ecosystem survival. Visual pursuit/retreat remains an observation to explore, not an automated finding.

## Validation

- Eleven model tests pass: deterministic replay, inheritance/mutation, bounded energy/traits/resources, defense cost and immunity, newborn deferral, movement vulnerability, one-shot introductions/no rescue, drought locality/expiry, and bounded observations (some assertions share a test).
- Legacy physics pins: 38 pass, five large opt-in cases skipped. No kernel source or pinned hash changed.
- Chrome browser test passes: reduced-motion pause, stepping, manual and automatic introductions, drought, reset, mutation controls, parsed observation download, and mobile overflow. Desktop, evolved-world and mobile screenshots inspected locally.
- Typechecking and production build pass. The build contains `/ecosystem/`; no deployment performed.
- Six corrected diagnostic runs (3 seeds × staged/un-staged), 3000 ticks each. V1–v3 observations remain available for comparison; the unsuffixed file is final v4.
- Claude reviewed the Markdown plan before implementation, reviewed the implementation, and then checked the fixes: no remaining correctness blockers. Its two final uncertainties are covered by the HTML seed bounds and the passing nonempty-world test. Review reports are under `ecosystem-sandbox-reviews/`.
- The repository-required Codex review found the mover shield and export-test gap; both were fixed and its focused follow-up reported no blockers. Claude's later fixes and final static review are recorded separately.
- The final Chrome test also reports no WCAG A/AA violations from its axe scan at phone width. This does not claim a full assistive-technology audit or cross-browser equivalence.
