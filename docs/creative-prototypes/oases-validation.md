# Travelling oases validation

Local validation on 26 October 2026, Node 24.2.0. No deployment or merge is implied.

- 22 model, selection, and comparison-clock tests passed (`particles.test.ts`, `particle-comparison.test.ts`, `particle-comparison-clock.test.ts`).
- 15 Chrome browser checks passed: three oases, five picker, two existing particle page, five public-route/build checks. The oases checks were repeated after the final chart changes.
- Typecheck, Vite production build and `git diff --check` passed.
- All four evidence freshness checks passed: default presets, picker, pursuit oases and descriptive flock follow-up.
- Historical compatibility checker passed: full version2 default/picker artifacts remain numerically identical after excluding explicitly named provenance/version metadata. The still oases prefix matches 93 prior pursuit censuses. Artifact hashes are in `oases-still-compatibility.jsonl`.
- Production exclusion smoke applied the Dockerfile removal patterns to a temporary copy of the built output. Particle pages, entries, shared model and clock bundles were removed. This is a packaging check, not execution of a Docker image.

The [pursuit pilot](oases-pilot.md) and [flock follow-up](oases-flocks.md) cover 18 worlds at 6,000 ticks. All remained populated. [Visual inspection](oases-visual-check.md) records what the actual screenshots support, with local recording paths and limitations.

Relevant commands (from the repository root):

```sh
pnpm vitest run apps/lab/test/particles.test.ts apps/lab/test/particle-comparison.test.ts apps/lab/test/particle-comparison-clock.test.ts
BL_E2E_PORT=5292 pnpm exec playwright test tests/e2e/particle-oases.spec.ts tests/e2e/particle-picker.spec.ts tests/e2e/particles.spec.ts tests/e2e/public-routes.spec.ts --project=chrome
pnpm typecheck
pnpm build
node tools/particles/explore.ts --check
node tools/particles/explore-picker.ts --check
node tools/particles/explore-oases.ts --check
node tools/particles/explore-oases-flocks.ts --check
node tools/particles/check-still-compatibility.ts
```

Review closure: Claude and Codex focused follow-ups found no actionable correctness issues. Claude’s conditional chart concern is ruled out by `model.ts`, which samples the exact extinction tick. Speed units and flock runtime/version wording were clarified after review.
