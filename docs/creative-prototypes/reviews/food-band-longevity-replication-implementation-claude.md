**No blocking defects in the runner, helper or viewer.** Fix the first two items below before the outcome run. I made no edits and ran no simulations. I read the plan, `explore.ts`, the helper, and the viewer except lines 660–694. I only grepped the tests and HTML, so I saw test titles, not bodies.

## Fix before outcomes

1. **A completed moving arm can be lost.** `writeEvidence` (`explore.ts:695-700`) holds both arms in memory and writes nothing until both pass. If stationary throws, the only record of moving is the one stdout line (final tick, families, `numericalPass`, `dataSha256`). That hash points at a file that is never written. The plan requires disclosing completed arm outcomes and listing which windows or criteria failed, and the line has neither. Extend the line with the five gate booleans and each window's status, births, deaths and cap48 count.
2. **The runner, helper, viewer and tests are all untracked.** The viewer pins the runner at `13e8f566…`, which matches the file on disk now. Any fix after the reviews changes the runner hash, so the viewer pin has to move with it. The e2e test at `spec.ts:296` guards this. Commit the reviewed runner before the first `--write`.
3. **The helper is looser than the viewer on the receipt.** The helper (`diagnostics.mjs:66-67`) doesn't require `sameAgeComparisons` entries to have exactly `{tick, observation}`. The viewer does (`viewer.js:530`). A receipt with extra keys would pass the helper and fail the viewer. Add the exact-keys check to the helper.
4. **Test gaps, from titles only.** No test covers the `--write` path: the overwrite refusal, the moving-first disclosure line, or that importing the module never runs it. No viewer test covers an early-extinction hold, extinction at exactly 6,000, or a partial window.

## Parent-enforced, not helper-enforced

- The 1202→1203 order, stopping on an invalid pair, and judging visuals after both numbers are not checked by the helper.
- "Knows both seeds' numerical outcomes" is only a regex on the receipt prose.
- Naming a concrete cluster or gap can't be checked mechanically.
- I wouldn't make the helper require the other seed's arms, because a valid 1202 pair must stay diagnosable when 1203 is invalid.

## Checked and correct

- **Pins:** the plan SHA is `6ae73fea…` in the file, runner, helper and viewer. The model SHA is `7bd5af02…`.
- **Seed references:** these match between the runner and viewer.
  - Artifact and data hashes.
  - Paths.
  - 1202 uses PR #105 (`hungry-shapes-stationary-food-arm`, `…-pair` index).
  - 1203 uses PR #106 (`…-replication-arm`, `…-replication-pair` index).
  - I confirmed the kinds, the index keys and `decision.status === 'both'` against the real index files.
- **Historical check before any run:** `writeEvidence`, `--check` and `--replay-check` all call `checkHistoricalReferences` first. That runs the correct legacy runner (`--check --seed`, which both legacy CLIs accept), then re-validates the artifacts and index.
- **Prefix:** all 151 samples and frames, 3,000 tick rows and 5 snapshots are compared during the run and again in `validatePrefixRecord`. Historical tick-3000 snapshots have `terminal:false` in both lineages, so the full-snapshot comparison holds.
- **Windows and gate:** the windows are 4501–5000, 5001–5500 and 5501–6000. Partial and not-reached windows fail, births and deaths must both be positive, cap48 is at most 99, and at least two families must be alive. The viewer recomputes the same gate. Extinction at exactly 6,000 fails the alive check while keeping a terminal snapshot.
- **Write safety:** output paths are seed-scoped, the preflight refuses overwrite and `wx` backs it up. The module-run guard is correct. `git status` shows no modified tracked files, so no old file changed and the HTML decision log is untouched.
- **Helper order:** committed receipt (`git show HEAD:`), then index, receipt and decision validation, then the runner `--check`, then overlap. There is no simulation in the helper.
- **Viewer:**
  - **Seed guard:** `loadGeneration` is checked after every await, and the seed is read from the picker at load time.
  - **Receipt predicate:** it matches the helper's regexes, status derivation and non-empty checks.
  - **Extinction:** `renderArm` holds the last frame at or before the target. The label reads "holding terminal frame", the jump buttons are 3000, 5500 and 6000, and the extinction note is shown.

I didn't open the CSS, the rest of the HTML or the test bodies.
