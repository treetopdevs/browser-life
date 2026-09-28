# Cohort preparation: plan and decisions

Base: `7732bdd3`. Isolated jj workspace: `cohort-preparation`.

## Selected opportunity

Deepen the existing run-bundle module. Analysis and calibration currently compose eligibility themselves; calibration replays every loaded lineage history before selecting neutral runs or checking eligibility. An ignored history can therefore abort calibration. This offers immediate correctness and test leverage with less scope than lab execution or search recovery.

## Default decisions

- Keep the existing Deno filesystem adapter and streaming lineage reader. No generalized storage seam.
- One preparation interface owns loading, selection, shared eligibility order, conservation evidence, provenance policy, deterministic calibration ordering, and neutral activity replay.
- Analysis checks metadata and ring independence over all completed runs, retains every loaded seed for reservation checks, excludes failed conservation before registered-preset provenance, and allows legacy provenance for exploratory presets.
- Calibration selects neutral runs before validation, checks provenance over all selected runs (including conservation failures), requires at least two eligible runs, and sorts by seed before replay. Ignored conditions and excluded conservation histories must never trigger lineage replay.
- Retain separate caller outcomes: analysis throws; calibration writes unavailable/provisional reports. Preserve exact pilot freezeability, reserved seeds, threshold identity, endpoint statistics, and preregistration content.
- Keep inference and reporting in their callers. Move only cohort preparation; final analysis replay still uses the chosen threshold.
- Preserve the current low-level helpers where existing tests exercise substantive behavior. Remove the loader reduction callback and optional cached activities field, which enable replay before eligibility.
- Document domain terms in CONTEXT.md. No ADR: this is a reversible concentration of existing policy, not a new scientific decision.

## Execution gates

1. Add real CLI regressions for ignored/excluded malformed histories and metadata/provenance refusal before replay; demonstrate failure on the base.
2. Implement shared preparation and route both CLIs through it.
3. Run calibration and analysis Deno suites, Deno type checks, TypeScript checking, and the repository unit suite when local dependencies are available.
4. Obtain an independent exact-diff review, resolve actionable findings, and rerun affected checks.
5. Record validation and review evidence here, commit only this workspace change, and leave a clean successor change.

## Completion evidence

Completed implementation and independent review.

- Regression-first proof: the base failed six assertions across four CLI scenarios (ignored history, conservation exclusion, metadata refusal, provenance refusal); corrupt eligible history still failed replay as expected.
- `deno run -A tests/deno/calibrate.ts`: 59 assertions passed, including all new CLI regressions and declared-pilot freezeability.
- `deno run -A tests/deno/analyze.ts`: 69 assertions passed, including ring refusal, threshold identities, reserved pilot seeds and exploratory reporting.
- `deno run -A tests/deno/cohort.ts`: 9 assertions passed through the preparation interface, covering distinct provenance policies, excluded seed evidence, incomplete runs, minimum pilot size and stable seed ordering.
- `deno check tools/analyze.ts tools/calibrate.ts tests/deno/analyze.ts tests/deno/calibrate.ts tests/deno/cohort.ts`: passed.
- `node_modules/.bin/tsc -p tsconfig.json`: passed.
- `node_modules/.bin/vitest run`: 29 files, 432 tests passed, including pinned physics hashes and preregistration synchronization.
- Independent exact-diff review found one memory regression: analysis retained both per-run and pooled activity arrays. Fixed with policy-specific results: analysis returns only one pooled array; calibration retains per-run arrays for bootstrap. Re-review found no remaining actionable findings.
- Reused installed dependencies through ignored workspace-local links. The package-manager shortcut stalled before starting its script; stopped it and ran the installed compiler/test runner directly. No dependency or lockfile changes.
- No GPU or coordinator checks required: neither execution path nor physics, checkpoint, coordinator or statistical definitions changed.

The module still streams one census at a time. Preparation does not own threshold choice, exact pilot freezeability, or endpoint inference. It retains all completed-run evidence for those callers rather than silently narrowing their populations.
