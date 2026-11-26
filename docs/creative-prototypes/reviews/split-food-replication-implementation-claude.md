**Verdict: clear. I found no blocker in the files I reviewed.** I made no edits and ran no simulations. I stopped after 8 pertinent reads plus one small follow-up check, and I didn't open the review output file.

Not covered:
- `tests/e2e/split-food-replication.spec.ts`. I ran out of reads before diffing it against `split-food.spec.ts`.
- The parent attempt script, which doesn't exist yet. `tools/split-food-replication/` holds only `explore.ts`, and `split-food` has no tracked attempt script either, only `split-food-attempts.json`. It still needs review before launch. That review should confirm it checks that source is committed, logs intent, HEAD and source hashes before launch, and refuses overwrites.

**What I checked**
- **Plan and model pins:** `split-food-replication-plan.md` hashes to `0858e529…` and `apps/lab/src/split-food/model.ts` to `c6b5c37f…`. Both match what the runner and viewer pin.
- **Source pins:** I ran `shasum -c` over every hash in the runner's `PINNED_INPUTS` and every one matched.
- **Transitive dependencies:** The runner imports only `split-food/model.ts`, and that file imports nothing relative. Everything else is covered by the pins.
- **Old files:** `git status` shows no changes to old files. The new CSS is byte-identical to the counterpart.
- **PR106 wrapper transition:**
  - The historical artifact has kind `hungry-shapes-stationary-food-replication-arm`.
  - Its `provenance` keys, `prefix` block, 151/151/3000 lengths and snapshot ticks `[0,500,1500,2500,3000]` match `validateHistoricalReference`. The last snapshot has `terminal:false`.
  - The index kind is `…-replication-pair` and its decision matches the pins.
  - Every key in the artifact's own source map is pinned in the runner with the same value. My first grep reported two mismatches, but they were false positives because the runner uses symbolic constants for those two pins.
  - The runner no longer references seed 1202 anywhere except two uniform-endurance pin paths.
- **New kind and output route:** The kind is `hungry-shapes-split-food-replication-arm`, and the outputs are `split-food-replication-seed-1203.{json,md}`.
- **Write path:** A refuse-overwrite check runs before the regression, which runs before the new arm. Imports don't execute anything.
- **Check-only:** `--check` runs `legacyCheck`, which calls `stationary-food-replication --check --seed 1203` (reads and validates only), then `baselineData` and evidence validation. It never reaches `runArm` or `HungryWorld`.
- **600-pulse test:** The test asserts the plan formula for all 600 pulses at seed 1203. I recomputed it independently: 4,608 targets, and every pulse gives 768 distinct tiles and 384 per band, with zero bad pulses.
- **Gates:** The numerical, spatial and manual gates, and the extinction/inconclusive handling, are unchanged from the counterpart apart from seed and kind. The diff shows no changes there.
- **Viewer:** The viewer pins the same keys and values as the runner, with the runner hash `5f60e710…` matching the file as it is now. It checks the baseline kind, the PR106 provenance, the moving-reference prefix, the pair kind `…-split-food-replication-pair` and the seed in the receipt. The outcome section is removed from the HTML and the scope note says "Once published".

**Non-blocking**
1. The negative tests cover a wrong index kind but not a PR105 `…-stationary-food-arm` artifact passed to `validateHistoricalReference`. The code rejects it; a test would pin that.
2. The viewer pins the runner's own hash, so any later runner edit, including review fixes, must re-sync the viewer pin before the source commit.
3. I didn't run the vitest or Playwright suites, so I haven't confirmed they pass.
