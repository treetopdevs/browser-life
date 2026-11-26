**Verdict: no blockers for the accepted artifact.** Every enumerated fix is present and matches the finding it answers. One latent bug in the new strict validator needs fixing before it meets the "fails closed on valid evidence too" standard. It is not triggered by the current evidence.

Everything below is a static conclusion from reading the source, tests and docs. I had no shell tool, so I ran no tests, `--check`, `--replay-check` or probes. The only executed checks were two bounded greps of `development-pilot.json`. They show six `"outcome":"alive-at-3000"` rows and `"batchStatus":"complete"`. I could not run `git diff`, so I read `model.ts`, `page.ts` and `explore.ts` in their current state instead of as diffs against `cb2a04ab`.

## Fixes confirmed (static)

- **Buffer fixture food:** `model.ts:474-477` validates, then copies with `new Uint8Array(spec.food)`, which allocates fresh storage, so `_food` is always a base `Uint8Array`. The `food` getter slices it. The test at `development-model.test.ts:89-99` covers input mutation, `Buffer.isBuffer(readback) === false` and readback mutation.
- **`lastMutation` in `empty()`:** `model.ts:364` sets it. Object.create skips every field initializer, so I checked all of them (`:306-321`, `:558`) against `empty()` (`:349-364`). All are assigned, and `lastMutation` was the only miss.
- **`lastMutation` in `reproduce`:** it resets before each reproduction (`:545`), and the old `childGenome === parent.genome` test is gone (`:554`).
- **Browser runtime:** `model.ts:452-453` now emits `'browser'` alone when there is no `process.versions.node`.
- **Lineage refresh on deaths:** `page.ts:107` refreshes on `births` or `deaths` changes. The e2e test at `development.spec.ts:81` asserts the "died at tick 600" message.
- **Current body and occupancy before drawing:** `drawWorld` calls `refreshPhysical` first (`page.ts:151`), so bodies and click-selection occupancy are current on every draw.
- **Elapsed metric cadence:** `comparisonTick - lastMetricTick >= 5 || paused` (`page.ts:377`). `lastMetricTick` resets to -1, then `updateAll(true)` sets it.
- **Reduced-motion initial reason:** `initial &&` (`page.ts:75`), with `createWorlds(1201, true)` at `:385` and the e2e check at `development.spec.ts:12`.
- **Mutation-off checks:** the runner asserts per tick on both worlds (`explore.ts:266-271`, `:533-536`). Recorded snapshots are also checked (`:367-371`). Tests cover counters and a non-founder genome.
- **Report demographic columns:** the table now has cap-blocked births, living variants, age deaths and starvation deaths, derived from each run's final lineage (`explore.ts:597-605`, `:664`).
- **`--check` strictness:** each of these rejections is traced in the code and has a test in `development-evidence.test.ts`:
  - Duplicate or missing seed/condition rows fail on the ordered matrix check (`:445-453`).
  - Missing census schedule rows fail (`:463`).
  - Missing or `undefined` milestone state fails (`:487`).
  - A bad snapshot hash fails (`:489`).
  - Final census, ledger, history, lineage and births each fail when they disagree with the hash-covered final snapshot (`:500-511`).
  - No simulation is substituted anywhere.
- **Prose figures:** the earlier finding about `development.md:17` is now backed by the age and starvation columns. The validation record gives 190–192 age deaths against 2–7 starvation deaths per run, so "almost every death from the age limit" is supported. I did not check those figures against the retained data.

## Findings (ranked)

1. **Medium, latent: valid evidence from an extinct run is rejected.**
   - `assertRecordedSnapshot` requires `state.extinctionTick === expected.extinctionTick` (`explore.ts:319`). The caller passes `run.extinctionTick` for every milestone (`:488`).
   - For a run that goes extinct at tick `e`, a milestone before `e` is a snapshot with `extinctionTick: null`, so it is rejected as a "snapshot identity/tick mismatch".
   - `buildArtifact` calls this validator (`:627`), so `--write` would also abort on any batch containing an extinction. The method prose says extinction is possible.
   - It is not triggered today, because all six runs are alive at 3000. No test uses an extinct run.
   - **Fix:** pass `run.extinctionTick` only when `scheduledTick >= run.extinctionTick`, otherwise `null`. Add a regression that builds a short synthetic extinct run.
   - `development-validation.md:27` already says the parent found this edge case and a correction is in progress. The current source (`explore.ts:488`) does not yet contain it.
   - A source edit changes `sourceSha256`, so root should confirm the final write and the final source hashes match.

2. **Low: sample census contents are not checked.**
   - Non-milestone `samples[i].census` rows are checked only for `tick` and `ledgerResidual === 0` (`explore.ts:473`).
   - A census with every other field altered or missing would pass `--check`.
   - `RULES.historyEvery` is 20, equal to `SAMPLE_EVERY`, and `run.history` is already tied to the hash-covered final snapshot (`:505`).
   - Each sample census could therefore be compared with the `finalSnapshot.history` entry at its `actualTick`, with no simulation. Post-extinction samples would compare against the extinction entry.

3. **Low: snapshot-internal consistency is not cross-checked.**
   - `counters.births` and `counters.deaths` are never compared with the lineage. The lineage is complete because `droppedLineage` must be 0.
   - Living organism IDs are not matched to lineage nodes with `deathTick === null`, and organism genomes are not matched to their lineage genomes.
   - Organism genomes in snapshots are not bounds-checked. Only `maxCells` is used, and a missing genome would throw rather than fail cleanly.
   - Tampering with a snapshot would also require recomputing its hash. This mainly guards against a generator bug.

4. **Low: test and harness nits.**
   - `development-evidence.test.ts:99-102` uses `toContain(String(n))`, which small integers satisfy trivially. Asserting the cells of the rendered row would be sharper.
   - The test file reads the live pilot JSON at import (`:5`). Running it during `--write` regeneration can fail spuriously.
   - No test covers the `'browser'` runtime string or the 5-tick cadence.
   - `checkEvidence` does not check `schemaVersion`, `pilot` or extra top-level keys.
   - `explore.ts:59-68` has redundant `requireSource`/`readSource` wrappers, and the comment about a "static import below" is stale.
   - `page.ts:362` resets any resume after "Paused while away" to "Paused · ready". That is harmless and arguably correct.

## Scope limits

- `docs/creative-prototypes/reviews/development-fixes-claude-review.md` was empty when I read it. I did not write to it.
- I did not read the full JSON, run the pilot, or inspect `decisions.html`.
- Whether the tick-144 assay footprints have equal cell counts, which the "failed distinct-shape gate" test depends on, is unverified.
- The validation record's test counts (38 passing, plus one added) and the Chrome, typecheck, build and removal-smoke results are the parent's claims. I did not reproduce them.
- `development-validation.md` still says "Follow-up review pending" and "in progress". Root will need to update it once this review and finding 1 are settled.
