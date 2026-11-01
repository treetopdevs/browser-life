# I01 behaviour atlas, slice 1: review record

**1 November 2026.** Reviewer: Codex `gpt-6.1-sol`, `model_reasoning_effort=high`, read-only, over
the uncommitted change on `claude/behaviour-atlas` (base `4c5c4500`). Two passes.

## Pass 1: four P2, one P3, no P1

| # | Sev | Finding | Resolution |
|---|---|---|---|
| 1 | P2 | `assertSeparated` compared literal read strings; a test reading `screen:perRep` could rebuild `regenerated / reps`, which mass-speed selects on | `canonicalRead`: `perRep.<f>` is `<f>`, a bare `perRep` reads every field of its assay; tests |
| 2 | P2 | A short final growth census (`growSteps` not a multiple of `censusEvery`) made the observer throw | `atlasObserver` skips off-cadence censuses; test with censuses at 100, 200, 250 |
| 3 | P2 | `genomeKey` omits `Genome.genes`, so gene-distinct genomes were merged as duplicates and lost from selections | `atlasGenomeKey` adds the gene byte; used for the ledger, duplicates and selections; test |
| 4 | P2 | Census cadence was not part of the descriptor identity, so archives could mix cadences | `PhysicalDescriptors.interval` and `AtlasSpec.interval`; an offer at another interval is refused; test |
| 5 | P3 | The GPU twin's "plain" run already had an observer | Twin now also compares a run with no observer; claim narrowed |

## Pass 2: two P2, no P1

| # | Sev | Finding | Resolution |
|---|---|---|---|
| 6 | P2 | `perRep.alive` mapped to `alive`, but its aggregate is `survived` | Alias `alive → survived`; test against every implemented arm |
| 7 | P2 | The cadence check ran after the duplicate index was updated, so a refused offer left a stale entry (later offers pointed `duplicateOf` at themselves) | Validate before any state change; test retries the refused genome |

Pass 2 confirmed fixes 2–5 by static inspection and found nothing else. A third, narrow pass over
fixes 6 and 7 and their tests found nothing remaining.

## Remaining limits (not defects)

- `assertSeparated` trusts each test's `reads` declaration; it cannot see what `passes` reads.
- Descriptor ranges and bins are provisional until a GPU calibration.
- No held-out capability panel is registered; selections cannot yet be scored.

## Verification run

- `pnpm typecheck`: clean.
- `pnpm vitest run packages/search`: 7 files, all pass (atlas: 19 tests).
- `deno run -A tests/deno/atlas_twin.ts` (native WebGPU, this Mac): PASS. Evaluations are identical
  with no observer, a hash observer and the atlas observer; the 7 phase hashes are identical with
  and without the atlas observer.
- `deno run -A tests/deno/recovery_observer.ts` (existing observer twin): PASS at horizons 100 and 125.
- Full `pnpm vitest run` under load average ~150 on a shared machine: 192 files pass, 20 fail
  (45 of 4,445 tests). 24 failures are the 60 s `testTimeout`, including the four golden-hash
  cases that failed. The rest are in files that do not import `@bl/search` (ops shell scripts,
  calibration statistics, CLI error paths). The run started before fixes 6–7, so it saw an
  inconsistent atlas file pair; its two atlas failures are those in-flight tests.
- After the run, `pnpm vitest run packages/sim-ref/test/golden-hashes.test.ts packages/search
  --testTimeout=900000` passed: 8 files, 111 tests, every golden pin unchanged. No file under
  `packages/sim-ref`, `packages/schema` or `packages/sim-gpu` changed.
