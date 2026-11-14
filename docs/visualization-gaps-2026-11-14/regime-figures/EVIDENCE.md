# regime-figures evidence

Commands (PATH prefixed with nvm 24):
- `deno run -A --no-lock experiments/3d-slab/regime-html.ts --synthetic --out=<scratch>/old.html` then `cmp` against the committed docs page before the edit: identical (no flag, output unchanged).
- `deno run -A --no-lock experiments/3d-slab/regime-html.ts --synthetic --stage0-figures` rebuilds docs/3d-regime-meters-map.html; second build with --out then `cmp`: byte-identical.
- `pnpm vitest run experiments/test/regime-stage0-figures.test.ts experiments/test/regime-readout.test.ts`: 2 files, 152 tests passed (10 new + 1 new in readout).
- `pnpm typecheck`: clean.
- `BL_E2E_PORT=5264 npx playwright test tests/e2e/regime-figures.spec.ts --project=chrome`: 1 passed (8 damage panels, 3 calibration panels, 252 data-pt marks, 180 seed-run stripes, 36/180 table rows, no horizontal scroll, no network requests).

Screenshots (read): evidence/regime-{1280,375}-{light,dark}.png in this folder.

Notes: the first spec run found 183px horizontal overflow at 375 (long SHA in the banner and an overlong SVG label); fixed with overflow-wrap and a shorter zero-strip label. The planning text's "36 jobs" is 18 jobs x 2 rungs, and U has only step 30. Direct U labels overlap lines in a few panels (legible, not moved).

## After the source review fixes

Tests now 2 files, 158 passed; typecheck clean; page rebuilt and byte-identical on a second build; Playwright spec passed; screenshots regenerated.

## Files for the coordinator to stage (explicit paths)

- docs/3d-regime-meters-map.html
- experiments/3d-slab/regime-html.ts
- experiments/3d-slab/regime-stage0-figures.ts
- experiments/test/regime-readout.test.ts
- experiments/test/regime-stage0-figures.test.ts
- tests/e2e/regime-figures.spec.ts
- docs/visualization-gaps-2026-11-14/regime-figures/PLAN.md
- docs/visualization-gaps-2026-11-14/regime-figures/REVIEW.md
- docs/visualization-gaps-2026-11-14/regime-figures/EVIDENCE.md
- docs/visualization-gaps-2026-11-14/regime-figures/review-sol-src.txt
- docs/visualization-gaps-2026-11-14/regime-figures/review-sol-fixes.txt
- docs/visualization-gaps-2026-11-14/regime-figures/evidence/regime-1280-light.png
- docs/visualization-gaps-2026-11-14/regime-figures/evidence/regime-1280-dark.png
- docs/visualization-gaps-2026-11-14/regime-figures/evidence/regime-375-light.png
- docs/visualization-gaps-2026-11-14/regime-figures/evidence/regime-375-dark.png

Do not stage anything else in docs/visualization-gaps-2026-11-14/ (the folder-level files belong to another PR). `git status --short` shows no *.mp4, *.tar.gz or creative-prototypes replay JSON among these paths.
