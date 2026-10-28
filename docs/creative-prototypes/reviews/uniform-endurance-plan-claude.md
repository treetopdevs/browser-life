**Verdict:** 1203 to 9000 is minimal and feasible. Normalizing only `maxHistory` 451→301 is enough for an exact 0–6000 prefix, but the plan words it in a way that can't be implemented. There are no hard blockers beyond the wording fixes below. I used about 10 reads and did not run or edit anything.

## Checked and fine
- **Only `maxHistory` can differ.** It is read at one site, `hungry-shapes/model.ts:705`, for observation retention. `hungry-shapes/model.ts` has no imports, so a copy keeps its relative paths. `rules: RULES` is embedded in each snapshot (`:518`), which is why the hash needs normalizing.
- **History capacity is exact.** 9000/20+1 = 451, the same way 301 = 6000/20+1. Extinction at t<9000 adds one off-cadence row but can't push the total past 451. The `droppedHistory===0` check (`explore.ts:215`) fails loudly rather than truncating silently.
- **Lineage is far from its cap.** About 85–98 births per 500 ticks gives roughly 1,700 nodes at 9000, against `maxLineage` of 10,000, so pruning never fires.
- **Size should fit.** The old files are about 9 MiB at 6000 (`uniform-food-validation.md:11`). I estimate 13–16 MiB at 9000, so the 24 MiB cap holds.
- **Fragile seed, no adaptive claims, old-evidence preservation.** The plan states these clearly. Reuse the `PINNED_INPUTS` pattern.

## Fixes needed
1. **Normalization direction.** The plan says to normalize "when computing old state hashes". The old hashes are fixed bytes, and old full states exist only at 0/3000/4000/5000/6000. The 301 old samples and 301 old frames can only be matched by the new run, so it must:
   - hash a copy of its own state with `rules.maxHistory` set to 301, at every sample and frame tick ≤6000;
   - compare that hash to the old values;
   - store the 451-convention hash as the artifact's own value.

   Confirm during implementation that `stateSha256` really hashes the full snapshot including `rules`. If it doesn't, normalization is moot.
2. **Scope of the proof.**
   - Assert that the un-normalized diff between the new prefix and the old record is exactly `rules.maxHistory 301→451` at every embedding, and empty after normalization.
   - The old artifact also carries `maxHistory:301` in its top-level `rules` (`explore.ts:27`, checked at `:482`). Say whether that is excluded from the prefix comparison or covered by the same assertion.
3. **Name the source model.** `development/model.ts` also has `maxHistory: 301`. The runner imports `hungry-shapes/model.ts` (pinned `a33a3312…`). Say so explicitly. Make the byte test: strip the comment, assert exactly one `maxHistory: 451,` token, replace it, and require sha256 == `a33a3312…`.
4. **Hardcodes to re-derive in the adapter.**
   - `MAX_TICK`, `WINDOWS` and `FIXED_SNAPSHOTS`.
   - `OLD_SAMPLE_TICKS`, 151→301, and `PREFIX_SEED`. Note the prefix is now 0–6000 of seed 1203, not 1201 to 3000.
   - History schedule (`:224`) and the gate (`:373–375`, `aliveAt6000`, `windows.slice(1)`).
   - Prefix asserts (`:457–459`).

## Gate clarity
- **Define the terms.** "Alive at 9000" means population>0 at tick 9000. "≥2 families" means at least 2 nonzero `familyCounts` entries. Write down that window births, deaths and cap48 are counter and tick-row deltas over each window's ticks.
- **Fragile-seed asymmetry (design risk).** At 6000, seed 1203 has 2 live families, with 5 bodies in the minority. The "≥2 families" requirement therefore mostly tests whether that minority survives drift. A minority loss at, say, tick 7500 would stop the whole screen even if births, deaths, cap and visuals all pass. That answers "does the world stay interesting?" poorly.
  - Smallest fix: keep the check but record which sub-criteria failed, and word a stop on family loss alone as "fragile-seed stress failed", not "world not interesting".
  - Alternative: drop the family requirement from the earn rule for 1201/1202 and keep it for the final promising call.
- **Visual criterion is soft.** "Concrete change" almost always holds in a world that's still running. Add a one-line example of what counts, such as occupied-tile gaps or body arrangement. This is not a blocker.

## Optional ideas
- Estimate file size at tick 6000, so an oversized run isn't wasted.
- Compare the old 1203 `windows[3]` (5501–6000) stats to the new reference window as a cheap extra prefix check.
