**Not clear for freeze.** I found three concrete blockers and four should-fix items. I read 10 files, edited nothing, ran no outcomes and no overlap diagnostics. I did not run the tests or Playwright. This is a Claude review only. The Sol 6.1 High read-only pass is still owed before freeze and commit. Plan SHA `ed1e1a0b…` matches on disk and in the runner, viewer, helper and tests.

## Blockers

**B1. The runner writes where nothing reads it.**
- **Where:** `tools/food-band-longevity/explore.ts:46-47` points `JSON_URL`/`MD_URL` at `docs/food-band-longevity-<mode>-seed-1201.{json,md}`.
- **Who disagrees:** the viewer, the helper, the e2e spec, the HTML footer and the prior runner (`tools/stationary-food-replication/explore.ts:42-43`) all use `docs/creative-prototypes/`.
- **Why it matters most:** `--check` and `--replay-check` read the same wrong path, so they would pass. Moving the files by hand then needs a runner edit, which changes the runner's self-hash and makes the recorded `provenance.sourceSha256` stale. This one can burn the authorized pair.
- **Fix:** repoint both URLs to `docs/creative-prototypes/` and add a test that pins the path.

**B2. The viewer pins a stale runner hash.**
- **Where:** `food-band-longevity-viewer.js:44` pins `tools/food-band-longevity/explore.ts` at `015387b0…`. The file on disk hashes to `43a5efaa…`.
- **Effect:** `validateArm` requires an exact match, so every genuine arm would be rejected. The other 38 pinned paths match the runner's `PINNED_INPUTS`.
- **Why it wasn't caught:** the e2e spec builds `PINNED_SOURCES` from the viewer's own text, so it can't see the drift.
- **Fix:** re-pin last, after the final runner edit, and add a test comparing viewer pins to the runner's `LOADED_SOURCE_SHA256`.
- **Timing:** this is a viewer-side fix and can be done after outcomes without touching the runner.

**B3. The viewer and helper disagree on receipt wording.**
- **Where:** the viewer requires `/historical moving media/` (viewer.js:521). The helper accepts `/historical.*media|media.*historical/` (diagnostics.mjs:62).
- **Proof:** the helper test fixture ("historical media already exist") would pass the helper and be rejected by the viewer.
- **Why it matters:** the receipt must be committed unchanged before diagnostics, so a receipt the helper accepts but the viewer rejects can't be repaired in place.
- **Fix:** use one shared regex (the stricter) and test both consumers on the same text.
- **Timing:** post-outcome fixable, but it costs a receipt commit cycle. Rank it below B1.

## Should fix before freeze

- **S1. Prefix-shape parity is untested.** `same()` is `JSON.stringify` equality with no normalization, so key order in `makeSample`, `makeFrame`, `tickRow` and the snapshot literal must match the old runner byte for byte. The current prefix tests feed historical records to themselves or `structuredClone`s of them, so nothing builds a record the new way and compares it to the old one. If key order drifted, the first `--write` halts at tick 0 and counts as an invalid attempt. I did not confirm this against the old runner's constructors, so it is an untested invariant rather than a found bug. Suggested test: export a tick-0 builder, construct `new HungryWorld(1201, true, mode)` (initialization only, no stepping), and run `validatePrefixInitial` and `validatePrefixSnapshot` on the fresh records.
- **S2. Invalid-attempt disclosure.** `writeEvidence` holds both arms in memory and writes only after both finish. If stationary throws, moving's outcome is discarded and nothing was printed, which conflicts with "disclose every outcome seen in invalid attempts". Print a one-line summary for moving (final tick, extinction tick, `numericalPass`, `dataSha256`) before starting stationary. This is a runner change, so it must land before freeze.
- **S3. Check-only is not enforced before diagnostics.**
  - The helper trusts each arm's own `numericalGate.numericalPass` and never checks `dataSha256` or structure. The parent must run and log `explore.ts --check --seed 1201` first, or the helper should call it.
  - The helper also rejects a decision `title` that the viewer allows, and accepts nothing empty where the viewer accepts an empty summary.
- **S4. e2e port fallback.** The spec falls back to `5419` (line 8), but `playwright.config.ts` defaults to `5174`. A bare `npx playwright test` would fail.
- **Test gap.** No test touches `runArm`, `writeEvidence`, `checkEvidence`, `validateEvidenceStructure`, `validateTickRows`, `expectedSampleTicks` or `expectedSnapshotTicks`. The extinction cases (off-cadence terminal, terminal on a fixed-snapshot tick), no-overwrite and import-without-running are all untested. Synthetic-structure tests would cover these without simulating.

## Checked and fine

- **Horizons:** distinct `BASELINE_MAX_TICK=3000` and `MAX_TICK=6000` constants throughout. Counts are pinned at 151/151/3000/5. Snapshots are 0/500/1500/2500/3000/4500/5500/6000 plus any extinction terminal.
- **Prefix:**
  - Samples, frames, tick rows and snapshots are compared as they are produced, and again whole in `validatePrefixRecord`, with no normalization.
  - The tick-3000 sample and frame are compared, and the snapshot is `terminal:false`.
  - Only horizon-wide fields are excluded: run, final, windows, repeat, gate and provenance.
- **Historical pins:** raw and data hashes, pair-index bindings, decision bindings and plan hash are checked by `baselineData` and the old runner's `--check`.
- **Windows:**
  - Late windows 4501–5000, 5001–5500 and 5501–6000 are complete, partial or not-reached, with `null` rather than zero for unobserved ones.
  - The gate needs a live arm at 6000, at least 2 families, births and deaths above 0 in each window, and at most 99 cap-48 ticks in each.
  - The viewer recomputes all of this and matches the runner.
- **Extinction:** the terminal frame is held and labeled, and no post-extinction data is invented.
- **Repeat and accounting:** the repeat is an independently initialized world, compared every tick and with full state and frame every 20 ticks plus terminal. The 24 MiB cap and the history/lineage drop checks are in place.
- **Safety:** no-overwrite uses `wx` plus an ENOENT guard. A main-guard stops import from running anything. `--check` is read-only, and `--replay-check` is the only simulating validator.
- **Old files:** `git status` shows only untracked new files, so every prior file is preserved. The HTML decision-log append has not happened yet.

## Suggested order

Before freeze, fix B1, S1 and S2, since a mistake in any of them can invalidate the pair. B2, B3, S3 and S4 can follow without a re-run, but B2 must be re-pinned after the last runner edit. Then do the Sol 6.1 High pass, freeze the runner, and commit before any outcome run.

I couldn't write a plan file or call ExitPlanMode in this session because the Write tool is disabled, so the review is in this reply.
