**Verdict: no blocker for committing the model and runner. The viewer slice is not clear.** I made no edits and ran no simulations or tests. I used about 10 reads, so some viewer parts are unchecked (listed at the end).

**Verified**
- **Model:** the diff against the frozen stationary model adds only split geometry, a pure `splitBandPulseTargetTile`, the `split-band` mode wiring, and the environment fields `bandColumns` and `bandWidth` (no `bandLeft`). Biology and RNG are unchanged. `stationary-band` keeps `bandLeft:0, bandWidth:48`.
- **Masks and offers:** the masks are columns 0–23 and 48–71, sorted to 4,608 tiles. Stride 2053 ≡ 37 (mod 48) and 768 = 16·48, so every pulse has exactly 768 distinct targets and 384 per band, for any seed or pulse. No RNG is used, and the tests don't change world state.
- **Runner:** it accepts seed 1202 only and is import-safe. It refuses overwrites, re-checks source pins before and after the run, and runs the old stationary `--check` first. Regression compares 151 samples, 151 frames, 3,000 rows and 5 snapshots by exact JSON equality with no normalisation. It writes no baseline artifact. Real extinction fails the gates (partial or missing windows and endpoints); invalid data throws. `--check` does not simulate.
- **Viewer pins:** its hard-coded source hashes match the current model and runner files.

**Fix before the outcome run**
1. `runs/split-food-bands/run-attempt.py` logs intent before launching, but it doesn't require a committed or clean tree. The visible part doesn't record the commit or source hashes, and the file is gitignored under `runs/`. Add a check that the model and runner are committed and record the commit id in the attempt file.
2. The evidence tests never exercise `validateEvidenceStructure`. Nothing covers the extinction path, which needs an off-cadence terminal sample and snapshot and a short `validateTickRows`. Nothing covers rejection of a stale source hash or an existing output file either. Add synthetic-evidence tests for these.

**Fix before the viewer is delivered**
3. There is no browser spec. `tests/e2e` has no `split-food*.spec.ts`, though the stationary slice has one. Paused default, tick hold on extinction, strict `pending|promising|stop` status, rejection of a wrong raw SHA and the mask outlines are untested.
4. The viewer's `SOURCE_PINS` are hard-coded, so any review fix to the model or runner means re-pinning them.
5. Whether the viewer's baseline-arm checks match the historical artifact is unverified. These are the `prefix` provenance key and the `endpoint.genomeCounts` that `renderWindows` reads.
6. In the runner, `legacyCheck` uses `stdio:'pipe'`, so a failure from the old runner shows no error text.

**Not read:** the viewer's keyboard handlers (from about line 658), the CSS, `split-food.html` beyond its element ids, and `split-food-implementation-claude.md`. I only saw the first lines of the attempt script, so its remaining fields are unchecked. `ExitPlanMode` and `Write` weren't available here, so no plan file was written.
