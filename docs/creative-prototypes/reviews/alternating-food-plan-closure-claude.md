**Blocker (one line to fix): the validation-source hash is missing.**

The Pre-freeze clarifications pin five hashes: raw, data, pair index, copy-source model and historical runner. They omit `split-food-replication-validation.md`, which Claude's table gave as `22800cadbd42548600909444065853854fd68062a8a636201f2bc415a43a9461`. Line 27 says to pin "historical validation sources", and line 35 says "these identities are checked before launch". Without the value in the plan, that source has no frozen identity. Add the hash to line 35 and the plan is clear.

The other Claude concerns are resolved:
- **Node runtime:** Node 24.2.0 on darwin/arm64 is stated.
- **"Promising":** it now means growth and retreat without local clearance, and the 10-tile continuity gate is kept.
- **Static baseline deltas:** all of them are reported, with a non-discrimination caveat that never changes the new world's status.
- **Manual qualifying block:** it must be one that passed the numerical screen.
- **Unreached blocks:** they fail without extrapolation, and assay-caused missing evidence is invalid.
- **Band names:** band 0 is columns 0–23 and band 1 is columns 48–71.
- **New-mode environment:**
  - `targetCount` is 2304.
  - `foodTargets` returns the last-supplied band only.
  - `activeBand` is `pulses==0?0:floor((pulses-1)/100)%2`.
  - `bandOffered`, `bandAccepted` and `bandOverflow` appear in the new mode only, and the static shape is unchanged.
  - The values at ticks 500/505 and 1000/1005 work out correctly.
- **Snapshot schedules:** baseline and outcome use separate schedules.
- **Historical file edits:** the `decisions.html` append is carved out, but the plan doesn't name an index or README link carve-out. That is not a blocker.
- **Contiguous wrapper:** the ban is scoped to the new regression target.
- **Offered versus accepted food:** the plan says accepted food can differ because of the 2× local intensity and tile-cap overflow.
- **Seed selection:** the plan says seed 1203 was picked from surviving static runs, so it is not an unbiased sample.

I checked this only against the two files, and I did not recompute any hashes.
