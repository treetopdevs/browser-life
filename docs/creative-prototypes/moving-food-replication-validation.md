# Replication validation and delivery

Plan frozen in 22e60fce after independent Claude Sonnet 5.5 High and Codex Sol 6.1 High reviews and resolution reviews. Runner committed in 7781c563 after both implementation reviews found no core runner blockers. Companion and diagnostic findings were handled separately before delivery. Model, original runner and first-seed evidence remain byte-identical to PR 103.

Only seed 1202 and 1203 were run, one logged write attempt per seed. Each attempt computes uniform and moving-band plus independently initialized repeats. Both attempts exited successfully; no failed biological result was dropped, no rescue/tuning occurred, and no new 1201 simulation ran. Historical check-only regression validates 1201 without constructing a world. A review's statement that --check re-runs simulation is incorrect: --check reads and validates saved evidence; --replay-check is the separate replay action, which was not used here.

Runtime: Node 24.2.0 darwin/arm64. New runnerSHA a8403864210d575baaa0acfae4a1a8ab684909bf0e8df541a1103394d2e11969. Frozen modelSHA b7aa0a3f1a0183d574e152e16b7f12c24fc0c9a201e7ddfae6d576915f10d8b0. Plan SHA 72f651acc7f221991b0ce89f7264eed9dd47df54e955d3d164406b4d0a17cc47.

All four arms stop at 3,000, retain 151 sampled frames and samples plus 3,000 tick rows, and pass independent repeat, safety, connectivity, accounting and source checks. Each uniform arm exactly matches its own pinned 9,000-tick historical baseline through 3,000: 151 sample/state/frame payload projections, 3,000 rows and full snapshot 0. No unavailable historical checkpoint comparison is claimed. Each new JSON is below 24 MiB.

Parent inspected body-only comparison images before computing cross-frame overlap diagnostics. These judgments are unblinded; endpoint food/window figures are descriptive, not visual gate measurements. Separate visual receipts are committed unchanged before the helper permits overlap calculations. The helper binds the selected pair manifest, plan, raw arm hashes and canonical receipt digest. The source of visual judgment is the parent, not the overlap score.

Review repairs: canonical receipt and manifest binding plus temporary-Git ordering tests; viewer frozen source pins; numerical gate recomputation; exactly two of three visual passes accepted rather than requiring all three. Both prior review findings and closure records are retained, including a Codex escaped-newline false positive adjudicated from source bytes and passing fixtures.

Validation commands and final totals are recorded below after delivery checks. No merge or deployment; hosted CI is separate from local proof.

## Completed local checks

- Focused Vitest: four files, 46 tests pass (`tools/test/moving-food-replication-evidence.test.ts`, `tools/test/moving-food-replication-diagnostics.test.ts`, `tools/test/moving-food-evidence.test.ts`, `apps/lab/test/moving-food-model.test.ts`). Includes full validation of all four new artifacts, resealed plan/baseline/prefix/generation mutations, and committed-receipt ordering fixtures.
- `pnpm typecheck`, strict standalone runner TypeScript check, and `pnpm build` pass.
- New runner `--check --seed 1202` and `--check --seed 1203` pass; frozen first-seed runner `--check --seed 1201` passes. These are saved-evidence checks, not additional trials.
- [Attempt log](moving-food-replication-attempts.json) records both successful outcome-producing attempts. The accepted artifacts include independent-repeat and source evidence.
- Git comparison against PR103 confirms no change to any historical model, runner, first-seed receipt, replay or media bytes.

Visual receipts and artifacts were committed in 5cd6094a before running the diagnostic helper. [Seed1202 diagnostics](moving-food-replication-diagnostics-1202.json) and [seed1203 diagnostics](moving-food-replication-diagnostics-1203.json) bind the exact receipt digests. These overlap numbers do not decide whether the behavior is interesting.

- Browser checks: `BL_E2E_PORT=5421 pnpm exec playwright test tests/e2e/moving-food-replication.spec.ts --project=chrome --workers=1` passes 26/26. Uses actual accepted records for positive decisions and synthetic/resealed negatives for tamper cases. Desktop and 390px accessibility and horizontal overflow checks pass; seed switching, keyboard, play/pause, hidden-page pause, wrong-seed/source/receipt failures, exact-frame availability and two-of-three visual criteria are covered.
- Final Claude and Codex reviews and fixture closures are clear. Both identified missing-frame handling and a contradictory test expectation; the viewer and test were corrected without altering any simulation or saved outcome. The 26-test suite passed after the corrections.

Two paired MP4s contain151 exact saved frames each, at10fps for15.1seconds,1304×1108 pixels. `ffprobe` confirms frame count, rate and duration. Metadata binds raw arms, internal data, plan, model, runner, viewer JavaScript/CSS, pair manifest and visual receipt, plus each video digest. Parent independently recomputed metadata hashes and checked real browser playback. No simulation or interpolation was used for media. Comparison PNGs bind source artifacts and image hashes separately.

Delivery: [PR #104](https://github.com/treetopdevs/browser-life/pull/104), based on PR #103. Initial hosted status query returned no commit statuses; local checks above are not a claim of hosted CI success.
