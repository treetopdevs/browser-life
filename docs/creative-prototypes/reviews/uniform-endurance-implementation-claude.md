The plan-file write failed because Write is disabled here, so the review is below. I read the code but ran and edited nothing.

## Review: one blocker, otherwise clear

**Blocker: the wrong-seed test can't pass as written.** `tools/test/uniform-endurance-evidence.test.ts:6-7` imports `validatePrefixRecord`, but `tools/uniform-endurance/explore.ts:504` declares it as a plain `function`, not an export. The wrong-seed test (lines 46-53) then calls `undefined` and fails with a TypeError instead of matching `/wrong-seed or incomplete pinned prefix/`.
- **Fix:** write `export function validatePrefixRecord`. This changes the `explore.ts` self-hash, but that file isn't in `PINNED_INPUTS`, so nothing else needs re-pinning.

**Non-blocking gaps:**
- **Missing negative tests:** the plan requires tests for a missing prefix proof, extra normalized fields, and changed biology with recomputed digests. All three need a full artifact, so add them after the 1203 output exists.
- **Missing fixture and boundary tests:** no fixture covers an off-cadence terminal sample or frame. The gate test covers cap 99 vs 100 but not births or deaths equal to 0.
- **Stale comment:** `explore.ts:114` says "horizon bound is 6000", but the code uses `MAX_TICK` 9000.
- **Old `--check` timing:** `--replay-check` doesn't rerun the old same-seed `--check`. That matches the plan, since `--write` does it (`explore.ts:606`).

**Checked and clear:**
- **Model copy:** `maxHistory` 451 is the only code change, plus the provenance comment. `assertPinnedInputs` (`explore.ts:253-257`) requires exactly one comment and one `maxHistory: 451,` token. It restores them and compares the result to the hungry-shapes model bytes. `maxHistory` is used only in `recordHistory`, and 301 rows through tick 6000 and 451 through 9000 never exceed the cap, so nothing is dropped.
- **Prefix proof, per seed:** `prefixData` pins the prior artifact bytes, Markdown bytes and internal digest. The run compares 301 samples, 301 frames and 6000 tick rows, plus checkpoints 0/3000/4000/5000/6000. The 3000/4000/5000 states are compared transiently; 0 and 6000 are retained.
- **Normalization:** it sets only `rules.maxHistory` 451→301, on a copy of the new state. The rules check at line 521 allows nothing else. The normalized frame digest key order matches the old `makeFrame` base, and the new runner's own hashes use the unnormalized states.
- **Reference window and old paths:** window 5501–6000 is compared to the old window index 3, which is also 5501–6000. The 3000 appears only as an old checkpoint tick. Seeds 1201–1203 are the intended range.
- **Joins:** frame, body, lineage, history and energy joins are all inherited and run to 9000. That includes tick-row deltas against lineage events and sample against terminal retained history.
- **Gates, extinction and cadence:** the gates are 9000, ≥2 nonzero families, births and deaths > 0 per new window, and cap48 ≤ 99. Extinct-window ranges use executed ticks only and are null when none ran. The cadence includes an off-cadence extinction tick.
- **24 MiB guard:** it fails rather than decimates, in `runUniform`, in `--write`, and in `validateEvidenceStructure`.
- **Viewer:** it hashes the raw file bytes against the manifest `sha256` before showing anything, and decisions are bound by `artifactSha256`. It also checks `kind`, `maxTick` 9000, `maxHistory` 451, the prefix counts 301/301/6000/5, the checkpoint ticks, and the windows. The manifest `uniform-endurance-index.json` doesn't exist yet, so it comes with the first seed.

After the one-word export fix, `pnpm vitest run tools/test/uniform-endurance-evidence.test.ts` should pass. Then the pilot can run.
