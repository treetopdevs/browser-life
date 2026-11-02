# I07 evidence log (2026-11-02, IMPLEMENT stage)

Freeze commit (GRAMMAR.md, PROTOCOL.md only, pushed, never rebased): `89215592` on `origin/claude/i07-assembly`. Its own Sol xhigh review: `freeze-review-sol.txt` (6 P2, 1 P3 findings, all addressed before the commit, see REVIEW.md). Evidence was written only after it.

## Results (evidence.json seal eb7e741c..., rewritten after the source-review fixes, amendment 2)

The first sealed file (seal 90144b81...) was replaced deliberately (`--write --force`) after the fixes in `amendment-2-source-review.md`. Every verdict, pair accuracy, grid cell and `solverNodes` (2,768,830) is identical to the first file; the new file adds stored replicate-0 cells, `inexactObjects` (0 everywhere), the split clip swing, the caveat in two verdict sentences and the corrected statement. Nothing was tuned.

Regeneration `node tools/assembly/observer.ts --write`: 57 s wall on an idle-ish run; `--replay-check` took 440 s wall at load average ~49 (59 s CPU).

Matched pair `hier-12` vs `random-dup-12`, 16 x 16 pairs, verdicts by the frozen rule:

| readout | direction | verdict |
|---|---|---|
| sharedBound | lower | separates, adds value over simple baselines (all four grid cells, of which one is independent evidence; best baseline deflate, 469/512). It measures the cost of the distinct shapes, not copy structure: it is equal at 2 and at 4 copies |
| reuseRatio | lower | separates, adds value over simple baselines (all four grid cells, of which one is independent evidence) |
| copyWeightedConstruction (naive) | higher | **fails to separate**: duplicated random motifs score higher than hier-12 in every pair (accuracy 0); no life-detection claim |
| meanA | none | not directional |
| maxCopies | none | not directional (20 against 20, tied) |

Declared expectation held: the naive copies x cost metric is fooled by duplicated random motifs. Clips (`spots`, `gradient`, `seasons`) are all flagged `segmentation-dominated` by the frozen factor-2 rule (object count and class count move by a factor of 2 or more across the `{4,8} x tau` grid). The split added in amendment 2 shows both parts move it in every clip: 4-versus-8 connectivity at one fixed threshold, and the occupancy threshold at fixed connectivity (`swing.*.connAtFixedTau`, `tauAtFixedConn`). For the quantised `gradient` and `seasons` clips the threshold part is an occupancy change on 4-bit values, so the honest word for the whole finding is segmentation- and threshold-dominated. Descriptive only.

## Limitations found (not tuned)

- The `random-dup-12` motifs are chosen by the beam bound (12 cells is above exactMaxN), which selects shapes the bound handles worst: bound 10 to 11 against exact 6 to 7 (`amendment-1-exact12.md`, outcomeExposed). The ordering against hier-12 (4) survives with exact values; the gap size does not.
- `spaced-8` is identical to `spaced-4` by construction (verified by object counts). `seam-4` uses the same 12-cell objects as `spaced-4` with different placement, so only `seam-8` (merged 24-cell objects) is a new test: one of the four grid cells is independent segmentation evidence.
- `sharedBound` does not depend on copy count (equal at 2 and at 4 copies in the calibration test); it separates the pair on per-class cost alone, so it does not "expose duplication".
- The sealed statement "no score here selected anything" was false (negative-class motifs are picked by score); corrected in amendment 2.
- The freeze pinned seven of thirteen algorithm files; the decision path was pinned only after the fact (amendment 2).
- The hand-built hierarchy is a fixture of our own; the result shows the readout tracks that construction.

## Commands and results

- `pnpm vitest run --maxWorkers=2 packages/metrics/test/assembly-grammar.test.ts` 19 passed; `assembly-stream.test.ts` 4 passed; `assembly-calibration.test.ts` 11 passed; `tools/test/assembly-evidence.test.ts` 9 passed (alone); `apps/lab/test/assembly-render.test.ts` 4 passed; `assembly-packaging.test.ts` run inside the full suite.
- `node tools/assembly/observer.ts --check` ok; `--replay-check` ok.
- `pnpm typecheck` clean. `pnpm build` ok, `apps/lab/dist/assembly/index.html` exists.
- Protected-path `git diff --exit-code c5098735` clean, no untracked files in protected paths.
- `pnpm test -- --maxWorkers=2` at load average ~49: 14 failed tests in 9 files, all `Test timed out`/`Hook timed out` in untouched suites (genes, predictability atlas replay, ecology clip). Rerun of `predictability.test.ts` and `predictability-evidence.test.ts` alone also timed out at that load. These are known load-sensitive tests; limits not changed.
- Browser (playwright, vite dev on 5391): `/assembly/` at 1280 px and 375 px, 13 cards, all canvases drawn, status line says the regenerated patches match the saved evidence, no page-level horizontal overflow, both tables scroll inside their own regions.
