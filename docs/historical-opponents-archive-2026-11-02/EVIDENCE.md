# I03c archive tournament: evidence log

Freeze commit: 2a012b9fb29641351e7ead0c83fb05f316858fc8 (pushed to `origin/claude/i03-archive-tournament` before any scoring seed). Everything below is written after the freeze; nothing in the frozen inventory is edited after it (PLAN.md included). Notes, deviations and discovered bugs live here only.

## Pre-registered before scoring (written before `--write`, 2026-11-02)

- Starved arena margin: on test seeds 7001 and 7002 the 300-step starved probe of `m3:0` vs `m3:1` ended with label ratios 0.045 to 0.053 against the floor 0.0625 (1/16), a thin margin. If any of the 20 scoring runs stays above the floor, `starvedOk` is false, every source is recorded `control-invalid`, and a different depletion pair or override is a next-rung item, not a block-B amendment in this slice.
- If a library bug surfaces during or after `--write`, it is recorded here and not fixed in the frozen files; the outcome stands as written, or the slice goes to block B (seeds 2001..2010) with the old result marked exploratory-superseded.
- Test files are outside the freeze inventory by construction (the review's finding 1 listed them; PLAN, calibration, stats, schema and sim-ref were added, tests were not). Any post-freeze test edit is listed below as a dated amendment.
- Cost so far: chain calibration about 910 CPU-s (7 trials, screen seeds only), viability screen 68 CPU-s, tests run before the freeze about 1000 CPU-s (two evidence-test passes, a mini triplet). Disclosure from REVIEW.md: an early mini and arena test ran 60-step worlds with scoring seeds 1001 and 1002 before the test-only seeds were introduced; outputs were not read as outcomes.
- Replay budget: `--replay-check --sample 25` (about 25% of jobs, deterministic FNV sample) plus full saved-evidence verification, unless the machine is quiet enough for a full replay; the choice is recorded below.

## Result (frozen rules applied as written; seal d3d1b27f6ba1d258f3f14103490a597b867e3146a14e0d5e16aad8c06f81757b)

`--write` (1360 jobs, `--jobs 6`, 2347 CPU-s, 7:55 wall): labels per source, never pooled: `bootstrap-m3` insensitive-or-biased, `bootstrap-200` insensitive-or-biased, `bootstrap-div` ordered-not-temporal. Counts: 2 insensitive-or-biased, 1 ordered-not-temporal.

Global controls: runs valid; identical-genome swap exact in all three sources; calibrated weakened copy G vs W detected (mean W share 0.325, 10 of 10 blocks below 0.5, alive alone); starved arena `m3:0` vs `m3:1` both labels below the floor in all 20 runs (max ratio 0.054 against 0.0625, the pre-registered thin margin held), status uninformative; all five pure fixtures and the planted chain (six in all) passed (`assayOk` true).

How to read it:
- `m3` and `b200` are masked by the twin position control only: mean place effect 0.092 and 0.093 against the first rung's target 0.075 (a magnitude failure), sign-flip p 0.63 and 0.35 (no systematic direction); `div` passed it (0.057, p 0.082). The target was calibrated on the generalist; the latest archive genomes show a larger place effect in this arena. A genome-specific target or position-adjusted payoff is a next-rung item, not an amendment. No `positionAdvantage` entry is null.
- `b200` numbers are masked, not a label, and descriptive only: D = 0.196, r_dir 0.033 (floor 0.008), residual rank 0.15, naive later-wins 90%, 8 confirmed edges, acyclic. Not "improved": the frozen table fires row 2 and computes no body label. This is the case where the naive metric reads 90% and the control strip stops the claim. The largest pair offset (`b200:1` vs `b200:4`, mean 0.085, offset 0.415) offset 0.415 exceeds the mean twin place effect 0.093, but the rule is a gate, not an adjustment.
- `m3`: D -0.026, r_dir 0.69, naive 30%, 3 edges, acyclic (masked too). `div`: D -0.004, r_dir 0.55, residual rank 0.30, 4 confirmed edges, acyclic: a strength order exists and does not follow search time.
- No cycle in any source: none detected at this resolution.
- Weakened copies of each source's latest snapshot did not lose (mean share 0.50, 0.52, 0.48): the plan review's finding 9 realised, the photosynthesis-weight edit is generalist-specific. Descriptive only; the calibrated G/W pair carried the gate.
- No fixture or control reaches `directional-rank` (strength-aligned and planted chain are `directional-vigour-only`); the top label is unvalidated.
- Answer to the question: nothing shows directional improvement against the past under the frozen rules; the only strong later-beats-earlier pattern (b200) is blocked by a failed position control, one source shows a strength order unrelated to time, and no cycles were found.

## Commands and results

- `pnpm install --frozen-lockfile` ok. `pnpm typecheck` exit 0 (after evidence.json existed).
- `node tools/opponents/archive.ts --select --jobs 8` 68 CPU-s, 13 genomes screened (all viable), three sources kept, five viable bins each; shared genome `m3:2` = `b200:0` = `div:2`.
- `--freeze-check` ok (39 files, commit 2a012b9f). `--check` ok with RUNS (source hashes verified). First rung `tools/opponents/assay.ts --check` ok. `git diff --stat origin/main -- packages/sim-ref packages/sim-gpu packages/schema experiments docs/historical-opponents-2026-11-01` empty.
- Focused vitest (`--maxWorkers=2`): opponents-archive 21, evidence 14, packaging 3, render 4, first-rung opponents and evidence tests: 96 of 97 passed in the first run; the one failure was the mini test hitting its 120 s timeout under load average 70. Post-freeze test edit (dated 2026-11-02): that timeout raised to 900 s in `tools/test/opponents-archive-evidence.test.ts`; rerun with `-t "mini payload"` passed. The test file is outside the freeze inventory by construction.
- `--replay-check --sample 25 --jobs 6`: 322 of 1360 jobs replayed byte-equal, plus full saved-evidence and freeze verification, 580 CPU-s. Full replay was not run: cumulative CPU (about 910 chain calibration, 68 screen, about 1000 pre-freeze tests, 2347 write, 580 replay, further test runs) is near the 7200 CPU-s target.
- Page: `BL_E2E_PORT=5331 npx playwright test tests/e2e/opponents-archive.spec.ts --project=chrome` 1 passed; screenshots `archive-1280.png` and `archive-375.png` read: tables scroll inside their regions at 375 px, no horizontal page overflow, the histogram marks the observed bin. (Post-write page.ts edits: per-source "which control failed" line, threshold shown as 0.075; spec `__dirname` replaced by `import.meta.url`.)
- Post-review (final Codex xhigh, 4 findings, no P1): page text now says the residual rank 'did not meet the cutoff' instead of 'explained by vigour'; the descriptive weakened-copy row shows 'n/a (descriptive)' with a 'caught' column instead of a pass mark; the b200 offset and fixture count above were corrected. Raw: /tmp/i03-final-review.out.
- Known flaky: `tools/test/hunt1-ops.test.ts` supervise.sh rsync-bound test timed out under load average 60 to 80 in `pnpm test --maxWorkers=2` (4747 passed, 1 failed, unrelated to this slice; not re-limited).
- Amendments after the freeze: none to frozen files. Test and page files are unfrozen and uncommitted.

## Deviations and left undone

- strength-not-time in-world rerun cut (PLAN section 8 cut order); the pure-matrix fixture is the gate.
- Replay sampled at 25%, not full.
- Planted chain gate amended pre-freeze (see PLAN v3 amendment).
- Evidence, manifest, page, tests and screenshots are uncommitted; no PR opened.
