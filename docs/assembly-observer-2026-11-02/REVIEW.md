
## Plan review dispositions

Reviewer: Codex gpt-6.1-sol, xhigh, read-only. Raw review: `docs/assembly-observer-2026-11-02/plan-review-sol.txt` (prompt: `plan-review-prompt.md`; also /tmp/asm/plan-review-raw.txt). Verdict was "request changes". All 14 findings were accepted and PLAN.md was revised.

| # | Sev | Finding | Disposition |
|---|---|---|---|
| 1 | P1 | `random-dup` rejection `a=n-1` unattainable (a<=8 at n=10) | Fixed (3.5): K=256 capped deterministic candidates, keep highest exact `a`, floor `a>=7`; test documents a=9 unattainable. |
| 2 | P1 | Plus-pentomino is 4, not 3 | Fixed (3.3): expectation changed to 4 with lower-bound argument. |
| 3 | P1 | Hierarchy vs dup confounded by size/count/multiplicity | Fixed (3.5, 3.6): new primary matched pair `hier-12` vs `random-dup-12`; only it may carry `separates`; old `hierarchy` secondary; trivial descriptors added to baselines. |
| 4 | P1 | Ordering direction wrong for cost readouts | Fixed (3.6): direction frozen per quantity; sharedBound/reuseRatio lower is better; non-directional readouts cannot separate. |
| 5 | P1 | Sensitivity verdict vacuous | Fixed (3.7): `seam-touch` segmentation-sensitive control inside the calibration set; per-clip descriptive outcomes with a frozen factor-2 rule; static verdicts `n/a` for sampling. |
| 6 | P1 | Freeze check does not establish the freeze | Fixed (5, 7): test requires both freeze docs at the freeze SHA matching current bytes, amendments marked `outcomeExposed`; complete recipes and budgets frozen; step 0 dev benchmark precedes the freeze. |
| 7 | P2 | Beam partial paths are not upper bounds | Fixed (3.4): completed-DAG certificate rule with independent validator, monomer fallback, precise `sharedBound` definition. |
| 8 | P2 | "Copy-weighted" metric has no copy weight | Fixed (3.8, 5): `sum a*(copies-1)`, algebra test; fooling outcome is an evidence result, not a unit assertion. |
| 9 | P2 | Undefined readouts (0/0, empty sets, `large`) | Fixed (3.6): exclusion, `null` -> `measurement-limited`, `large` scored by bound and counted. |
| 10 | P2 | Torus shape identity unspecified | Fixed (3.6): BFS lifting, winding -> `spans`, seam-translation tests. |
| 11 | P2 | Persistence expectations wrong (glider 1/2 at lag 1 under 4-conn) | Fixed (5): exact rationals asserted; lag vs stride distinguished; no "near zero" gate. |
| 12 | P2 | Streaming contract conflicts with I14 retaining movies | Fixed (3.9): lazy RefSim iterator, incremental hash, ring of last max-dt class sets, own `retainedFrames()` counter. |
| 13 | P2 | Runtime budget not executable | Fixed (7 step 0): benchmark first, numeric budgets frozen, caching, whole-run node limit. Numeric values still to be set at implementation. |
| 14 | P2 | `git diff` gate misses untracked files / protected paths | Fixed (6): broader protected path set plus `git ls-files --others` check. |

Residual: findings 7 and 13 are verified only once code exists; the reviewer confirmed the other toy values (monomer 0, domino 1, I-tromino 2, 2x2 2, I-tetromino 2, 1x8 3, 2x4 3, L-tromino 2) and `ceil(log2 n)`, and that the cited PRNG, RefSim, compression and Vite/Docker/Caddy conventions exist.

## Freeze review dispositions (Sol gpt-6.1-sol xhigh, `freeze-review-sol.txt`)

| # | Sev | Finding | Disposition |
|---|---|---|---|
| 1 | P2 | exact cost ignores free pool in its lower bound | fixed in exact.ts (cost loop starts at 1 with a free pool) |
| 2 | P2 | primary-only dup veto manufactures segmentation-dominated | fixed: global disclosed veto, identical predicate in all grid cells, branch precedence frozen |
| 3 | P2 | clip factor rule lacks aggregation | fixed: pooled whole-run definitions, zero convention, class eligibility |
| 4 | P2 | shape-only caching ignores connectivity | cache keyed by (conn, T, shape), free-pool solves uncached; stated |
| 5 | P2 | freeze does not pin computation | beam details, RNG tags, shuffle/scatter recipes, solve order written out; sha256 of the seven algorithm files pinned in PROTOCOL.md and tested; crystal offset never crosses a seam (doc corrected) |
| 6 | P2 | motif selection may fall back to a bound, floor unchecked | fixed: 10-cell candidates must be exact, floor enforced, abort policy frozen |
| 7 | P3 | deviations not consolidated | PROTOCOL.md section 8 |

A second review pass on the amended freeze files was not run. The source and evidence Sol review is still to do (see EVIDENCE.md for what to look at first).

## Source review dispositions (FIX stage; Sol = Codex gpt-6.1-sol xhigh, `review-sol-src.txt`; Claude = in-session review)

All findings were real and were fixed or corrected in text. Details and the changed files: `amendment-2-source-review.md`. The regenerated evidence (seal eb7e741c...) has identical verdicts, accuracies, grid cells and node count; nothing was tuned.

| # | Sev | Reviewer | Finding | Disposition and evidence |
|---|---|---|---|---|
| 1 | P2 | Sol | Empty negatives give a vacuous "separates"; a resealed artifact passes `checkSaved()` | Fixed. `isOne` needs den > 0; `validateCalibration` rejects missing classes, wrong replicate counts and numbering; `deriveVerdicts` throws; `--check` validates structure (13 classes in protocol order, replicate count, fixture and clip lists, protocol equality) before deriving. Tests: `assembly-fixes.test.ts` (0/0, removed and emptied classes), `assembly-evidence.test.ts` (resealed forgeries with `random-dup-12` emptied or removed are rejected). |
| 2 | P2 | Sol | Driver retains whole movies (`baseFixtures()`, `movieBytes()`) | Fixed. New `lazy.ts` generators (byte-equal to the I14 movies, tested for all nine) and incremental hashing; the driver no longer imports `baseFixtures` or `movieBytes` (source guard). Streaming test rebuilt: every frame is a copy detached after use, so any retained reference reads back empty and the result would change; ring length asserted bounded; the driver function `observeVariants` is run on detaching frames and equals the plain run. |
| 3 | P2 | Sol | Movie scores silently include fallback bounds | Fixed. `finish()` counts only `exact` objects in `reuseRatio`; others go to the new `inexactObjects`. Test: a zero allowance gives `reuseRatio: null`, `inexactObjects: 1`; saved evidence has 0 inexact objects (nothing changed). |
| 4 | P2 | Sol | Beam exceeds its child budget | Fixed in `bound.ts`: cap checked before each child (`>=`), chain fallback on exhaustion. Test covers caps 1 to 7 and the reviewer's `[0, 1, 1024, 1025]` probe; verified to fail without the fix (cap 2 gave 5 nodes). |
| 5 | P2 | Sol | Global node allowance not enforced | Fixed in `construct.ts`: `>=` semantics, each solve gets `min(budget, remaining)`, recheck before the bounded fallback; counter clamped to the budget. Test: allowance 0 returns `limited` with 0 nodes; allowance 5 never exceeds 5 nodes and is not `exact`. Saved run used 2,768,830 of 100,000,000 nodes, so stored verdicts were unaffected (`solverNodes` identical after regeneration). |
| 6 | P2 | Sol | Invalid freeze provenance passes | Fixed. `checkFreeze` (called by `--check` and the test): 40-hex and not all zero; commit must exist, be an ancestor of HEAD, hold exactly `GRAMMAR.md` and `PROTOCOL.md` with current bytes, and no outcome file. Skipped only with no repository or a shallow clone. Tests: zero, short, nonexistent and unrelated (base) SHAs fail. |
| 7 | P3 | Sol | D4-on-8 diagnostic sometimes uses 4-connectivity | Fixed (`readouts.ts`). Test on the reviewer's cells (3,3),(4,3),(5,4): `classesD4on8` 1 and spread 0 at conn 8. No stored value changed (the conn-8 rows only keep scalars). |
| 8 | P3 | Sol | Missing SubtleCrypto blanks twelve canvases | Fixed. Page draws every patch from saved cells; the hash check is optional and the status text says when it is unavailable. |
| 9 | P2 | Claude | Statement "no score here selected anything" is false | Fixed by amendment 2: statement reworded in evidence, page and docs ("no score selected which worlds or clips were shown; negative-class motifs are selected by construction-length score (best of 256 candidates)"). Frozen `PROTOCOL.md` text left as is, superseded by the amendment. Test asserts the new text and the absence of the old. |
| 10 | P2 | Claude | Page and verdict sentences hide the bound-selection inflation | Fixed. The `sharedBound` and `reuseRatio` verdict sentences carry the caveat; the page shows beam-versus-exact numbers (read from `amendment-1-exact12.json`) under the verdict table and states that the ordering survives but the gap size does not. Verdict branches unchanged. |
| 11 | P3 | Claude | Streaming test checks only its own counters | Fixed together with #2 (detached buffers, ring bound, driver coverage). |
| 12 | P3 | Claude | "Segmentation-dominated" not attributable to segmentation | Fixed as measurement, not wording alone: swing is split into `connAtFixedTau` and `tauAtFixedConn`. Result: both fire in all three clips, so the claim stands, but EVIDENCE.md now says "segmentation- and threshold-dominated" and notes that the quantised clips' threshold part is an occupancy change. The frozen factor-2 flag is unchanged. |
| 13 | P3 | Claude | "All four grid cells" and "exposes duplication" overstate | Fixed in EVIDENCE.md and on the page: one of four cells is independent; `sharedBound` is per-class cost and equal at 2 and 4 copies. |
| 14 | P3 | Claude | Freeze pins 7 of 13 files | Partly fixable only. The freeze is pushed and cannot be extended. Amendment 2 records the gap and pins all `assembly/*.ts` hashes post hoc (`amendment-2-source-review.json`, checked by `--check`); amendment files are now in the manifest. A freeze-time review of the decision-path files is not retroactively possible. |
| 15 | P3 | Claude | Page regenerates on the main thread; no persistence or clip section | Fixed. No regeneration on the page (patches drawn from stored replicate-0 cells, then hash-checked, one yield per card); new "Movies and clips" table with persistence at lags 1, 2, 4, the stride-4 sample, reuse ratio and the swing source. Regeneration from the generator stays covered by `--replay-check`. |

### Follow-up review of the fixes (Sol xhigh, `review-sol-fixes.txt`)

Sol confirmed `--check` and the full `--replay-check`, the nine lazy fixtures byte-equal to I14, inexact-score exclusion, the D4 diagnostic and drawing without SubtleCrypto. Four findings, all fixed; the regenerated evidence has the same seal (eb7e741c...).

| Sev | Finding | Disposition |
|---|---|---|
| P2 | Readout rationals with `den: 0` pass validation after a consistent reseal | Fixed: `validateCalibration` walks every stored `primary` and `conn8` value and rejects any `{num, den}` with a non-positive denominator or a negative or non-integer part. Test with `den: 0` in `random-dup`. |
| P2 | Shallow history skips all freeze checks when ancestry fails | Fixed: in a shallow clone only the ancestry test is skipped; existence, changed files, document bytes and the outcome-file check still run. A non-shallow repository still fails on a non-ancestor. |
| P3 | Exact search overshoots the allowance by one node, hidden by clamping | Fixed: the exact budget is `min(budget, remaining - 1)` (the search visits at most budget + 1 nodes) and the counter is no longer clamped. Test: limits 1, 2, 3, 5, 9 never exceeded. |
| P3 | Movie caption names the wrong column | Fixed: the caption names the column "Persistence lag 1, every 4th frame". |
