# Bonded shapes validation

Local checks, 26 October 2026, Node 24.2.0. No merge or deployment implied.

- 36 unit tests passed: base particles, recipe selection, shared comparison clock and eleven new bond tests.
- 22 Chrome browser checks passed: four bonds, three oases, two seasons, six picker, two particle page and five public-route/build checks.
- Typecheck, production build and whitespace checks passed.
- The five pre-existing evidence freshness guards pass unchanged. No base model changes or old evidence regeneration.
- New fixed nine-run bond pilot reached 6,000 ticks in every world. No invariant failures; max absolute base ledger residual 3.981e-8. No-bond full snapshots exactly matched a direct ParticleWorld at 61 checkpoints per seed (183 total), with no metadata exclusions.
- Production exclusion smoke applied actual Dockerfile removal patterns to a temporary built-output copy, removing the new entry and bond-model bundle. No Docker image execution claimed.

The base ledger checks biological energy accounting, not conserved spring potential energy. The added impulses are supplied steering. Lifetime and component measurements describe graph connections; they do not establish organisms or group reproduction.

## Commands

```sh
pnpm vitest run apps/lab/test/particles.test.ts apps/lab/test/particle-comparison.test.ts apps/lab/test/particle-comparison-clock.test.ts apps/lab/test/bonded-particles.test.ts
pnpm typecheck
pnpm build
BL_E2E_PORT=5312 pnpm exec playwright test tests/e2e/particle-bonds.spec.ts tests/e2e/particle-oases.spec.ts tests/e2e/particle-seasons.spec.ts tests/e2e/particle-picker.spec.ts tests/e2e/particles.spec.ts tests/e2e/public-routes.spec.ts --project=chrome
node tools/particles/explore-bonds.ts --check
```

Run the build before public-route checks so their build assertion cannot skip. Existing freshness commands remain explore.ts, explore-picker.ts, explore-oases.ts, explore-oases-flocks.ts and explore-seasons.ts with --check under tools/particles/.

Claude Sonnet5.5 High reviewed the plan and implementation. Codex Sol6.1 High found one generated-table delimiter defect; it was fixed and the focused follow-up verified every table row and source hash. Claude’s recipe-copy and test-coverage recommendations were addressed without changing the model. Bounded removal-event copying remains a possible performance improvement, not a correctness blocker.
