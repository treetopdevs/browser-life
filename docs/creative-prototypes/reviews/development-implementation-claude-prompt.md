Read-only adversarial implementation review, Claude Sonnet High, at `/Users/nicholas/.codex/worktrees/developmental-shapes/browser-life`.

First read `CLAUDE.md`, then `docs/creative-prototypes/development-plan.md` and its complete “Claude plan-review resolutions” section, plus `docs/creative-prototypes/reviews/development-plan-sonnet-review.md`. The final resolutions are authoritative where they refine the initial plan. This is an explicitly engineered creative toy; do not apply the research kernel’s inferred-organism restriction to it.

Review the implementation and evidence against that contract. Scope:

- `apps/lab/src/development/*`, `apps/lab/development/index.html`
- development model, clock and packaging tests, and `tests/e2e/development.spec.ts`
- `tools/development/explore.ts`
- `docs/creative-prototypes/development-pilot.md`, `development.md`, and `development-validation.md` if present
- relevant integration changes in Vite, Docker, Caddy and public-route tests

Inspect source first. The pilot report is available at `docs/creative-prototypes/development-pilot.md`; use it to assess the reported three matched ample-food assays and six retained fixed-batch outcomes. Avoid opening the potentially large `development-pilot.json` wholesale and do not rerun the pilot. If a referenced evidence artifact is absent, report that scope limitation rather than inferring its contents.

Focus on concrete defects against the plan: tick ordering and supply timing; FIFO growth, directions, wrapping and connectedness; immediate pending-child occupancy, ordering and population/cell caps; exact energy accounting, clipped feeding, upkeep failure and death; mutation stream draw order, inheritance, parent links and bounds; validated one-cell fixtures; history/extinction freeze and deduplication; defensive copies; bounded lineage retention and missing-parent markers; assay logic, per-run retention, replay/source freshness; viewer selection/death states, clock behavior, export limits; and Vite/Docker/Caddy privacy. Check that claims distinguish engineered births/variants from adaptation or survival benefit.

Use **Read, Glob and Grep only**. Do not run shell commands, tests, probes, browser actions, subagents or recursive reviews. Do not edit source or evidence, modify Git state, or use network/MCP tools. This is a static code and artifact review only.

Return only actionable findings with severity, exact file and line, the failure scenario, and the smallest corrective action. Rank findings by severity. Distinguish defects from unverified runtime or device claims. If there are no actionable blockers, say so and mention any remaining evidence-scope limitation. Do not praise the implementation or restate the plan.
