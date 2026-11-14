# regime-figures review

## Source review dispositions

Reviewers: sol (Codex Sol 6.1 xhigh, `review-sol-src.txt`) and claude. All fixes are in `experiments/3d-slab/regime-stage0-figures.ts`, `regime-html.ts` and the two test files.

| Finding | Reviewer | Disposition | Evidence |
|---|---|---|---|
| P2 negative / overflowing numbers accepted (Infinity loops the decade grid) | sol, claude P3 | Fixed: counts must be safe, non-negative integers; decimals finite; `living_fraction` and `livingFrac` in [0,1]; all raise ReaderError | test "rejects negative, nonfinite and out-of-range numbers" (-1, 400 digits, 1.5, -0.1) |
| P2 incomplete calibration grid gets a final outcome; duplicates give 179 stripes | sol | Fixed: `assertCalibrationGrid` refuses unless exactly 5x4x3 settings x seeds 101-103, each once ("not final") | test "calibration grid must be the complete unique 60 x 3 grid" (missing, duplicate, truncated file) |
| P3 off-grid row counted but never drawn | claude | Fixed by the same check (off-grid row refused) | same test, mu 70 case |
| P2 synthetic banner "No run produced it" sits above real pilot data | sol | Fixed: with `--stage0-figures` the banner says the claim covers everything outside the Stage 0 section, which has its own banner. Unflagged output unchanged | readout test now asserts the scoped sentence and that the page minus section, CSS and banner equals the unflagged page; rebuilt page contains "outside the section" |
| P2 outcome paragraph and SVG descs hard-code "none qualifies" | sol | Fixed: descs and outcome derive from `calibrationSummary`; a differing recomputation says so against `m4-pick-output.md` | test "outcome text and panel descriptions follow the data" (one setting made qualifying: "1 of 60 settings qualify", "1 of 20 cells meet the pick rule") |
| P2 refusal test can pass on missing files | sol | Fixed: valid damage and m4 TSV fixtures copied into the temp root; asserts stderr matches `REFUSED: the results carry rule hash` | readout test `--stage0-figures only adds the pilot section` |
| P3/P2 caption "one Apple M3 Pro" | sol, claude | Fixed: derived from data, now "2 machines (Apple M1 Max, 79 runs; Apple M3 Pro, 101 runs)" | test above; rebuilt page has 0 occurrences of "one Apple M3 Pro" |
| P2 SHA-256 0bed3086... pinned to regime-rule-closed.md | claude | Fixed: says Stage 0 run 1 read a draft with that hash and the closed file is that draft plus log items 5 and 6 (file's own header); real file hash not claimed | assertion on the sentence in the same test |
| P3 `--stage0-damage` without the flag, `--stage0-figures=1` silently ignored | claude | Fixed: both are ReaderError, exit 2 | test "flag handling" |
| P3 tests would pass with the feature half-removed | claude | Fixed: boundary cases (0.01, 0.5, 0.85 living; 0.05, 0.8 light), off-grid/duplicate refusal, and a cross-process determinism test (fresh deno process, byte-identical section) | tests "class and pick-rule boundaries", "deterministic across processes" |

No finding deferred.

Checks after fixes: `pnpm typecheck` clean; `vitest run experiments/test/regime-stage0-figures.test.ts experiments/test/regime-readout.test.ts`: 2 files, 158 tests passed; page rebuilt with `regime-html.ts --synthetic --stage0-figures` and a second build is byte-identical; Playwright `regime-figures.spec.ts` (BL_E2E_PORT=5264) 1 passed; screenshots in `evidence/` regenerated and read.

## Follow-up review of the fixes

Sol 6.1 xhigh (`review-sol-fixes.txt`): no P1/P2; three P3, all fixed.

| Finding | Disposition | Evidence |
|---|---|---|
| bare `--stage0-damage` (no value) silently accepted | Fixed: ReaderError | flag-handling test has the bare form |
| page comparison masks an unflagged-banner regression | Fixed: the unflagged page's original banner sentence is pinned and "outside the section" must be absent | readout test |
| finite-decimal guard untested | Fixed: overflowing `lightRatio7to0` and `stepsPerSec` must throw "not finite" | figures test |

Rerun: typecheck clean, 2 files 158 tests passed. The page itself needed no rebuild (only argument parsing changed).
