**Verdict:** Clear to implement. I found no hard blockers, but four wording fixes should go in before the plan is committed. I used six reads and edited nothing. This review is from the plan, `stationary-food/model.ts` (target scheduling and the `supplyFood` loop), and the seed-1202 baseline JSON.

**Fix before commit**

1. **"Do not rerun baseline" contradicts "Run this one baseline regression"** (lines 11 and 13).
   - Say that the regression is a replay of the new copy's contiguous mode, compared against the saved baseline's 151 `stateSha256`/`frameSha256` samples, the 3000 `tickRows` and the five snapshots. It produces no new baseline artifact.
   - Say whether the replay covers all 3000 ticks or only a prefix. Line 13 calls the parity check "brief" and the regression a full replay.
   - The contiguous mode must emit the baseline's exact `environment` shape: `bandLeft:0`, `bandWidth:48`, `targetCount:4608`. Split-only fields should appear only in split mode.
2. **The hash is mislabeled.** "rawSHA1c85fd84…" is a 64-hex SHA-256. It does match the file (`1c85fd84…badd39`), but the leading `1` in the plan's string appears to be the "1" from "SHA1". Write "SHA-256 1c85fd84…" and say whether "raw" means file bytes or the in-file `baselineDataSha256`.
3. **"Connectivity" is an undefined stop condition** (line 17). Either define it (for example, the two bands are disjoint, each 24 columns wide, and separated by 24 columns on both sides of the torus) or drop it.
4. **The visual gate has no reference frames.** "Shifted, expanded or cleared cluster or gap" needs a baseline for comparison. State that it is the 2500 body-only frame against the 3000 frame, and optionally against the tick-0 or 1500 snapshot. Also define which tiles count in the spatial gate. I suggest `tile % 96` in 0–23 or 48–71 for the two bands, with gap tiles counting for neither.

**Checked and sound**
- **Feasibility.**
  - Split mode only changes the `_foodTargets` array. Sorted ascending, that is row-major, matching how `stationaryBandGeometry` already orders targets. The formula `((pulse*768+j)*2053 + seed%4608) % 4608` is the existing `supplyFood` code. The plan's `p=floor(tick/5)-1` matches the baseline, which has 600 pulses at tick 3000.
  - Exactly 768 distinct targets per pulse follows because gcd(2053, 4608) = 1 and 768 < 4608.
- **384 offers per band.** Sorted index mod 48 < 24 means the first band. 48 divides 4608, 2053 mod 48 = 37 is coprime to 48, and 768 = 16·48. Each residue is therefore hit exactly 16 times, so 24×16 = 384 per band on every pulse. The plan can cite this derivation and keep the unit test for it.
- **Horizon and evidence.** The baseline (`maxTick` 3000, 151 samples, 5 snapshots at 0/500/1500/2500/3000, 3 windows with `births`, `deaths` and `cap48Ticks`, `familyCounts`) already has the shape the numeric gates and the evidence list need. `maxHistory` 451 and the 24 MiB budget are comfortable for 4.7 MB.
- **Known-baseline distinction.** Seed 1202 is disclosed as informed selection, and the baseline is called known evidence. Passing earns only a proposal for unchanged replication at seeds 1203 and 1204, with no automatic trials.
- **Stops.** Extinction versus invalid data is mostly well separated. One note: "Missing or partial windows fail" (an ecological failure) should say it applies only after a valid early extinction. History truncation or a missing sample is inconclusive (line 17).

**Notes (not blockers)**
- Survival to 3000 is a low bar. The contiguous band already survived to 6000 in PR108, and the 10-tile occupancy gate is weak next to roughly 470 cells. The plan's claim limits already cover this, so I'd keep the "Promising" label modest.
- Because the target rotation is the same but the tiles differ, tile-level food histories diverge from the baseline immediately. That is expected, but the same-age comparison should say so.

**Not verified** (read budget): that founder placement does not depend on band geometry, which the tick-zero parity test should assert; that the old `tools/stationary-food/explore.ts` supports `check-only --seed 1202` as the plan assumes; and the "972-tile patches died at 2,040" history claim.
