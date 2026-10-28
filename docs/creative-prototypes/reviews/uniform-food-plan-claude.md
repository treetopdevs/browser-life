I read the plan, `hungry-shapes-plan.md`, the old decision and evidence files, `tools/hungry-shapes/explore.ts` and `apps/lab/src/hungry-shapes/model.ts`. I made no edits and ran no simulations.

Overall, the scope is minimal and feasible with the history caps. The gaps are in how identity and replay integrity are specified, and in how the plan frames itself against the old STOP.

## Ranked issues

**1. Prefix identity is not pinned or fail-closed.** (blocker)
- "Exact agreement with accepted uniform 1201 through 3000" doesn't say which digest, which records, or what a mismatch means.
- The old evidence has two different digests. In `hungry-shapes-decision.json`, `sourceArtifactSha256` is `2cb6…` and `dataSha256` is `0a99…`. The `0a99…` value is the internal hash recorded in the seed-1201 JSON.
- The old `--replay-check` reruns all three modes, so it can't be the validation step. That would contradict "do not rerun original or patches".
- **Fix:**
  - Hard-code both digests as constants in the new runner. Do not read them from `decision.json`, which is itself mutable. Also pin the SHA of the old `.md` and of `decision.json`.
  - Require the old structural check (`explore.ts --check --seed 1201`) to pass first.
  - Compare against the old uniform run:
    - All 151 samples through 3000: `stateHash`, census and environment.
    - Snapshots at 0, 160, 500, 1500, 2500 and 3000. Use full-state equality at 0 and 3000 and hashes elsewhere.
    - The 500 per-tick `lateTicks` rows for 2501–3000, plus `lateSummary`.
  - Require Node 24.2.0 on darwin/arm64 exactly. The old artifact recorded that runtime, and the state embeds `"Node 24.2.0"`. Otherwise a prefix mismatch could be environmental rather than a model fault.
  - Treat a mismatch as a rule-1 stop. Never regenerate the old files.
  - The prefix check applies to seed 1201 only. Record `prefix: {kind}` in the artifact and make the validator require it for 1201, so it can't be silently skipped. Seeds 1202 and 1203 have no prefix.
- State honestly that the prefix check shows cross-invocation determinism, not correctness. The old evidence came from the same code.

**2. The old runner can't be reused as written.** (blocker)
- `explore.ts` hard-codes `MAX_TICK = 3000`. `assertWorld` rejects any tick above it (line 109). It also hard-codes `pilot === 'hungry-shapes-v1'`, the three-mode matrix, `SNAPSHOT_TICKS` and the 2501–3000 window.
- Editing it breaks the old evidence. Its own SHA is in `SOURCE_PATHS` and in the accepted artifact's `sourceSha256`, so the old `--check` would fail.
- **Fix:**
  - Name a new file, for example `tools/hungry-shapes/uniform-longer.ts`.
  - Use a new schema id and a new evidence filename.
  - Include the old `explore.ts` in the new `SOURCE_PATHS` if anything is imported from it.
  - Keep the old evidence test (`tools/test/hungry-shapes-evidence.test.ts`) passing untouched.

**3. Sampled replay integrity is unspecified, and the repeat comparison validates less than claimed.** (blocker)
- Nothing defines the frame schema, encoding, size, or whether frames live in the hashed JSON or a sidecar. "Immutable JSON and Markdown" names no sidecar.
- Only five full states are kept, so `--check` can't verify the ~296 intermediate frames.
- Comparing frames between primary and repeat only proves the extractor is deterministic, not that it is correct.
- **Fix:**
  - Define each frame as:
    - `tick`, and `stateHash` equal to the census sample's hash at that tick.
    - 9216 food bytes.
    - A per-tile family or empty code.
    - A `frameHash`.
    - The ledger terms `dissipated` and `deathLoss`, which census and environment lack.
  - Structural checks:
    - Occupied tiles equal `census.cells`.
    - Distinct bodies equal `population`.
    - `sum(food) + census.totalEnergy == initialEnergy + accepted − dissipated − deathLoss`. This ties each frame to the census arithmetically.
    - Frames at 0, 3000, 4000, 5000 and 6000 are re-derived from the retained full snapshots and must match exactly.
  - Add a `--replay-check` that re-simulates and re-derives all frames. Say in the plan that `--check` is structural only.
  - If frames are a sidecar, bind its SHA inside the JSON.
  - State a size budget. Roughly 301 frames of about 18 KB raw each comes to 5 MB or more before encoding.

**4. The plan is not candid enough about the old STOP, and the new gate is post hoc.** (high)
- The old resolutions in `hungry-shapes-plan.md` say "uniform-only survival → stop at 1201 without revision". They also say not to pool modes, and they define "promising" for patches only.
- This follow-up was chosen after seeing uniform alive at 3000 with `familyCounts [22,17,0]`. The thresholds were set knowing that.
- **Fix:**
  - Add a short "Standing" paragraph saying this is a new authorization, not an earned extension of PR100's gate.
  - Say the gate thresholds are post hoc relative to ticks 0–3000. Seed 1201's 0–3000 data is not fresh evidence.
  - Say `decision.json` and the old docs stay untouched, and the deliverable quotes the old STOP verbatim.
  - Say "uniform longevity promising" is a new, separate claim. It makes no comparison to original or patches, which are not rerun.
  - Note that family 2 is already extinct at 3000. The "at least 2 families at 6000" criterion therefore has zero slack, and losing either surviving family fails the gate.

**5. Gate thresholds and visual criterion are ambiguous.** (medium)
- Rule 2 should define:
  - A founder family is alive when `familyCounts[f] > 0` at tick 6000.
  - "Across 3000/4000/5000/6000" means all three consecutive pairs (3000→4000, 4000→5000, 5000→6000), or the plan picks "any". The current wording allows either.
  - A fail condition for the visual check, for example "unchanged arrangement or only relabeled bodies". Bodies turn over by starvation anyway, so "some change" is nearly always true.
  - The parent writes the verdict from fixed-camera frames before reading overlap numbers.
- "Births and deaths > 0 in each window" is close to vacuous. The reference window had 94 births and 94 deaths. That is harmless, but don't present it as a discriminating test.
- Compute the numeric part of the gate in code, for example a `--gate` output from the validated JSON. Keep the visual verdict as a separate manual field. The decision record should carry the artifact digest. This avoids a hand-tallied gate.
- Define the extinct-window rules: min, max and end population are taken over executed ticks only, and window births, deaths and death causes come from the per-tick rows and lineage.

**6. History caps: feasible, with zero headroom.** (note)
- `maxHistory` is 301 and `recordHistory` drops the oldest sample only when the length exceeds 301 (`model.ts:705`). The 0..6000 schedule is exactly 301 rows, so there are no drops. An extinction sample at a non-multiple tick below 6000 still totals 301 or fewer.
- `maxLineage` is 10,000 and pruning only removes dead non-founders. Seed 1201 had 466 births by tick 3000, so roughly 1,000 by 6000, far below the cap.
- The runner must keep per-tick `assertWorld`, which checks `droppedHistory` and `droppedLineage`. The plan should say that stepping to 6001 or "continuing" breaks the history invariant. Also say the UI must not offer to continue.

**7. Minimality of the deliverable.** (low)
- The evidence slice is minimal.
- The phone, keyboard and axe checks, the packaging work, and a full controls UI before the first-seed gate are front-loaded. The first-seed gate is likely to stop at 1201.
- Don't state "no side effects on the public catalog" without naming the location. If it's a docs-only static HTML with no `apps/lab` route, no Vite input, Dockerfile, Caddy or playground-count changes are needed. If it's a lab route, list those files and the "15 entries" count.

## Optional suggestions
- Record wall-clock runtime and the per-window death causes (age and starvation) in the Markdown.
- Add a negative test that the 1201 validator rejects an artifact lacking the prefix record, and one that rejects a frame whose energy identity fails.
- Show the old patches and original numbers in the companion only as cited, labeled figures from PR100, never as rerun arms.

I didn't call the advisor tool for this review.
