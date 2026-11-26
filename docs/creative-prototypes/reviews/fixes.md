# Review dispositions — particle playground

Claude Sonnet 5.5 High implementation review found no blockers. Decisions below address its small recommendations without expanding the creative prototype into a research experiment.

- **Status announcements:** implemented by the UI owner; only update the status live-region text when its value changes.
- **Engineered food seeking:** implemented by the UI owner; disclose the weak steering toward food and replace the misleading “Unscripted motion” heading.
- **Pilot interpretation:** report flocks as a lower-motion, concentrated comparison to pursuit, using the recorded table. Do not invent a scientific “settled” threshold or reinterpret nonzero movement as evolution. No model tuning is required for this comparison prototype.
- **Evidence freshness:** `node tools/particles/explore.ts --check` verifies the recorded model SHA-256 and complete rules object. It fails on stale evidence and neither runs the simulation nor overwrites artifacts. Full generation remains a separate command.
- **Reset after extinction:** intentionally preserve the paused state. The user can inspect the new world and press Play; reduced-motion and hidden-tab pauses must not be unexpectedly undone. This is a product choice rather than a defect requiring automatic resume.
- **Optional coverage:** exact single-coordinate mutation-delta, partial-cap and additional UI scenarios are deferred unless the separate Codex review identifies a concrete defect. Existing seeded replay, ledger, turnover, cap and browser interaction checks remain the acceptance evidence.
- **Documentation status:** parent workflow owns the decision log, final review status and any remaining polish. The UI owner confirmed the final changes and both focused browser tests pass; the parent owns final consolidated validation.

The repository-required Codex High review also found no blockers, with two P3 findings: refresh census counters when the page becomes hidden, and align production-exclusion claims with retained generated assets. The UI owner updated census on visibility/manual pause and added a pause/export exact-tick regression check. The parent has added removal of `assets/particles-*.js` and `assets/particles-*.css` to Dockerfile.site, matching the production-exclusion promise. Focused follow-up review checks these dispositions; no model or pilot-dynamics change is needed.

Focused Claude Sonnet 5.5 High follow-up found no blockers. Its optional regeneration-copy nit is addressed by deriving the comparison from the results: maximum flocks mean speed must be below minimum pursuit mean speed, and maximum flocks final occupied bins must be below minimum pursuit final occupied bins. Otherwise the report says the comparison changed and asks the reader to inspect the table. Current pilot prose is unchanged.
