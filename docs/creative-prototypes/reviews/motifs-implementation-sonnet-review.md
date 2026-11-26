**Verdict:** I found no physics or grammar blockers. The pilot evidence artifacts need regenerating before you trust them.

I read the sources and tests, `motifs.md`, and the new pilot Markdown. I did not read the pilot JSON or run anything.

`tools/particles/explore-motifs.ts` changed at least four times while I reviewed. The last revision I read has `nextPairedEvidenceTick`, `heldScalarSample`, `baselineLateSummary`, and a table header built from a `columns` array. Line numbers below are from that read, so match them against the hash recorded in the JSON.

## Blockers for the pilot artifacts

1. **The pilot Markdown doesn't match the current tool, so `--check` should fail.**
   - `motifs-pilot.md:20` has a 9-column separator under an 11-column header and rows.
   - The current `buildMarkdown` (`explore-motifs.ts:343-345`) derives an 11-column separator from `columns`.
   - The generating process therefore loaded an earlier revision.

2. **The recorded source hash can't be trusted.**
   - `sourceSha256` is computed at `explore-motifs.ts:410`, after all 36 runs finish.
   - It hashes whatever is on disk at that moment, not the code the process loaded. That is why the Markdown above can pair with a hash of the later, fixed file.
   - Capture the hashes at the start of `generateArtifact`. Optionally re-hash at the end and fail if they differ.

   After the fix, regenerate with `--write`, then run `--check`. Don't hand-patch the Markdown.

## Latent bug in the extinct path

- `explore-motifs.ts:289-290` asserts exactly 11 baseline samples with tick ≥ 2000.
- A world that goes extinct at a non-multiple-of-100 tick in 2001–2999 has its extinction sample plus the held samples, which makes 12, and the invariant aborts the whole batch.
- This did not fire in the pilot: all 36 runs stayed alive, so the exact-extinction path (`explore-motifs.ts:219-231`) and `heldScalarSample` were never exercised.
- Fix: count only `tick % SAMPLE_EVERY === 0`.
- That path has no unit test I could find.

## Page and library defects (`motif-page.ts` unless noted)

- **Pause blanks the status.** `:353` sets `pauseReason = ''`, and `updateStatus` (`:242`) prints `pauseReason` while paused. After a user clicks Pause, the `role=status` region is empty. Set it to something like `'Paused'`.
- **Pause leaves numbers stale.** Metrics refresh only when `comparisonTick % 5 === 0` (`:381`), and the Pause handler doesn't call `updateAll(true)`.
  - After a pause, the population and other figures can lag the shown tick by several ticks.
  - The export can also miss the newest scheduled sample in `recentHistory` (`:305`) while its `current` census (`:283`) is live.
  - Call `updateAll(true)` when pausing.
- **`MotifWorld` constructor input (`motifs.ts:158`).**
  - `'version' in motif` throws a raw `TypeError` for null or a primitive instead of the grammar error.
  - An object with `version`, `recipe` and `sentence` keys is silently recompiled from `.sentence`, discarding its own `recipe` and `environment`. That is a silent repair.
  - Compile the input and reject it if the supplied fields don't match the compiled result.
- **Mixed freshness (`:211`).** "Occupied bins" comes from the last scheduled sample, up to 99 ticks old, next to live population, and only the focus details show the sample tick.

## Minor

- The tool asserts `wrapperDroppedSamples === 0` nowhere (`:307`), though the plan asked for it.
- The Markdown says "255 cap applied", but `gzipCountBytes` asserts ≤ 255 and doesn't clamp.
- `scalarSample`'s `allowFrozen` parameter (`:98-100`) is dead.
- `parseSeed` accepts `0x10`, `0b1` and `0o7` through `Number()`. The plan allows this, but the error copy says "whole number".
- `motif-observers.ts:40` parses as `(… + particle.family) as Family`. It is harmless but misleading.
- The earlier unused `compileMotif` import and `snapshot()` helper were gone by my last read. `apps/lab/test/particle-motif-evidence.test.ts` imports the tool, so `tsc` with `noUnusedLocals` now covers it. Please confirm with `pnpm typecheck`.

## Pilot sanity check

- The post-move TV at 1500 equals 1/population, which is what moving one particle across bins should give. For example, 1/158 = 0.006329.
- I found no wording that claims evolution.

## Held up on read

- Strict grammar and the 12-ID order.
- Frozen copies of the sentence and recipe.
- Histogram indexing and the empty-population TV convention.
- Sample cadence and the single extinction sample.
- Clock cap with no overshoot.
- Known-preset snapshot equality.
- Before/after ordering at tick 1500.
- Favorites and the 8 MiB export refusal.
- Hidden-tab pause and the phone layout CSS.
- The Dockerfile globs removing the motifs chunk and CSS.
- `/particles/motifs/` is noindex with no canonical.

I did not run the tests, Playwright, axe, or the build.

## Coordinator check after completion

The external review completed with exit status zero. Source files changed during its run; findings must be assessed against the final revision rather than treated as immutable-current claims.

A subsequent bounded read confirmed that the UI already sets `Paused by you`, forces `updateAll(true)` on user pause, and synchronizes scalar history before export. Those findings are resolved in the current page source. At that check, source hashes were still captured at artifact construction after generation, late baseline observations still included unscheduled extinction samples, and the constructor still silently recompiled compiled-looking inputs. These were returned to the parent for repair. The final pilot must be regenerated from settled source and freshness-checked; this reviewer did not perform those operations.
