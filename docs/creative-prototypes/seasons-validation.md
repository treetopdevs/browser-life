# Seasonal food patch validation

Local evidence, 26 October 2026, Node v24.2.0. No merge or deployment implied.

- 25 model, selection and shared-clock unit tests passed.
- 18 Chrome browser checks passed: two seasonal, three existing oases, six picker (including both v2 and v3 imports), two particle page, five public-route/build checks. The seasonal boundary check steps the actual UI through ticks600 and601 and checks the displayed phase and row multiplier.
- Typecheck, Vite build and diff whitespace checks passed.
- Production-removal smoke applied the actual Dockerfile patterns to a temporary copy of the build. It removed the new seasons entry and shared comparison renderer as well as existing particle pages and assets. No Docker image execution claimed.
- All five evidence freshness checks passed. Full v3 default/picker/oases/flock artifacts matched regenerated results numerically, excluding only source/version metadata. The still-flock prefix matched all183 census records through tick6000. Existing v2 compatibility also passed.

The [pilot](seasons-pilot.md) retains all nine 10,800-tick runs. All worlds remained populated. Long seasons retained three founding families in all three seeds; constant renewal did so in one seed. Short seasons produced repeated low-count rebounds in one seed, but lost Amber in the other two. Offered budgets are equal; realized renewal differs. These observations do not establish adaptation or a general survival advantage.

Claude Sonnet5.5 High reviewed the plan. Both Claude and Codex Sol6.1 High reviewed the implementation and focused fixes; the final follow-ups found no remaining actionable correctness issues. Reviews are saved in the reviews directory. Visual evidence is recorded separately. Extinction clocks have model/helper coverage; actual screenshots show living worlds, not an extinct-card scenario.

## Reproduce

Use Node24.2.0 for exact saved-data compatibility.

```sh
pnpm vitest run apps/lab/test/particles.test.ts apps/lab/test/particle-comparison.test.ts apps/lab/test/particle-comparison-clock.test.ts
BL_E2E_PORT=5302 pnpm exec playwright test tests/e2e/particle-seasons.spec.ts tests/e2e/particle-oases.spec.ts tests/e2e/particle-picker.spec.ts tests/e2e/particles.spec.ts tests/e2e/public-routes.spec.ts --project=chrome
pnpm typecheck
pnpm build
node tools/particles/explore-seasons.ts --check
node tools/particles/check-seasons-compatibility.ts
node tools/particles/check-still-compatibility.ts
```

Run the build before public-route checks; their built-output check skips if no build exists. The seasons compatibility command writes its hash-bound receipt only after comparisons pass. Legacy freshness commands remain `explore.ts --check`, `explore-picker.ts --check`, `explore-oases.ts --check` and `explore-oases-flocks.ts --check` under `tools/particles/`.
