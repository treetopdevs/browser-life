# Checked GPU repeats — issue #129, 2026-11-14

Continuation of [the evidence audit](../issue-129-2026-11-14/README.md), in the
same isolated worktree `/Users/nicholas/develop/browser-life-soup-129`.
Historical producing revision and dirty state remain unknown. These runs test
candidate-source repeatability on this machine, not independent implementation
or laboratory replication. Original artifacts and failed earlier repeats remain
untouched.

## Integrity changes

Ported the pair-completion counter, bounded batch retry and cooperating-process
lock from `c30ba828c39e2d66e41c062bd00bb74ea43b5680`. Every shader invocation
increments the completion counter after its pair's output writes. The experiment
CLI accepts a batch only when its total equals epochs × population/2. Incomplete
batches restore the prior bytes, epoch and run counter; rejected instruction
counts are discarded. Maximum batch: 64 epochs; maximum attempts: 20. Exhaustion
fails without a completion receipt. `gpu-retries.jsonl` preserves rejected batch
counts and epochs; completion receipts record accepted batch/epoch/pair totals.

Local hardening additionally bounds the u32 completion count, rejects invalid
batch/retry values and pending unchecked work, excludes overlapping operations,
cleans staging buffers on failure, and makes GPU-error instances unusable.
Checked submissions/readbacks and rollback uploads also use validation,
out-of-memory and internal WebGPU error scopes; a non-throwing rollback error
cannot be accepted as a successful retry. Destruction is refused while busy.
The per-user lock excludes cooperating Deno processes; browser/desktop/other-user
GPU work is not excluded. Failed device initialization without a successful or
pending GPU caller releases the lock for CPU fallback. The browser-compatible
unchecked API remains available; the island's existing stepping is not converted
to checked execution in this change (its device acquisition shares the lock).

A matching completion count detects missing pair completions. It does not prove
every shader calculation or memory write was correct, and cannot rule out all
hardware faults. CPU/GPU parity is separately tested, not inferred from counts.

## Validation

- CPU/GPU bytes and instruction totals match for noheads, heads and grid cases
  (4096 programs, 40 epochs each).
- Three injected short counts require rollback/retry and still match CPU bytes,
  epoch, run count and accepted instruction total across 100 epochs.
- Retry exhaustion restores both CPU and GPU checkpoints; invalid batch/count
  values and overlapping/unchecked operations are rejected.
- Destroyed-device test restores CPU checkpoint and makes the instance unusable.
- Injected non-throwing validation error during rollback is captured; no retry
  result is accepted and the instance becomes unusable.
- The historical 131072-program seed-2 snapshot at 12609 matches CPU after one
  checked epoch: 120548221 instructions. Original snapshot is read-only.
- Lock test checks a contender stays blocked while its holder lives, release on
  holder exit, and release after failed GPU initialization while CPU fallback lives.
- TypeScript and Deno checks, existing soup/evidence tests, Deno lock guard, and
  comparison tests are recorded with the run artifacts. The opt-in upstream
  golden is not part of this validation.

Logs and review receipts: `runs/issue-129-checked-2026-11-14/` in this worktree.

## Run protocol

`tools/soup-repeat.py` prepares and runs seeds **2, 1, 3, 4 sequentially**, from
initialization, with the original candidate inputs (131072 noheads programs,
mutation 262144/2^30, census every 64, H+ threshold 1, after 1024, cap 16384,
save 4096). It uses a frozen lockfile and the new evidence mode in fresh folders.
Baseline metadata/checkpoints are extracted only after verifying the preserved
67-file archive and each member hash. Source fingerprints are checked before
and after each run. A mismatch is retained and does not suppress later seeds. The runner exits 1
for execution/evidence failures, 2 for historical mismatches alone, and 0 for
matching available history.
CSV comparison streams in epoch order, excludes only elapsed seconds, and
reports all sampled differences and missing rows. Seed 1's missing historical
16384 CSV row remains missing, despite its archived final snapshot.

## Completed results

All four child processes exited **0**, in order 2 → 1 → 3 → 4, with no overlap.
All source fingerprints stayed unchanged. Initial hashes matched the earlier
initialization receipts; final files matched their completion receipts; encoder
fingerprints and runtime were consistent across runs. Aggregate accepted work:
**61,761 epochs, 981 batches, 4,047,568,896 pair completions**. The supervisor
returned **2** for historical mismatches, not an execution failure.

| Seed | Final epoch | Historical checkpoint matches | Matching sampled rows* | First differing census | Rejected batches |
|---|---:|---:|---:|---:|---:|
| 2 | 12609 | 3 / 5 | 185 / 198 | 11841 | 1 |
| 1 | 16384 | 1 / 4 | 71 / 256 | 4545 | 0 |
| 3 | 16384 | 4 / 4 | 257 / 257 | none | 0 |
| 4 | 16384 | 4 / 4 | 257 / 257 | none | 0 |

*All sampled CSV columns except elapsed seconds. Seed 2 is compared only through
12609: **507 later historical rows**, from its continuation toward 45056, are
outside the denominator and were not rerun. They are not missing within this run. Seed 1 has a new final census
at 16384, but its historical log ends at 16321; the unmatched endpoint is listed
separately, not fabricated or counted as a matching historical row.

**The live completion counter reported fewer pairs than expected.** Seed 2's first attempt
at the 64-epoch batch starting at 12353 reported 4,128,768 pair completions,
versus 4,194,304 expected: a deficit of 65,536. That deficit equals one epoch's
pair count, but does not locate the missing work to a particular epoch. The
batch was rolled back, and its retry passed the completion check. A counter or
readback fault cannot be distinguished from omitted work by this event alone. Its event remains in
`ensemble/seed-2/gpu-retries.jsonl`; completion totals exclude rejected work.

Seed 2 reproduced the sampled H+ crossing at **11585**, with the exact historical
snapshot hash `c54b2b62aa3a30744ec9a479f15a303df844897b98ec928c69575531488c0b1a`.
The preceding sampled state at **11521** was retained directly from the run:
`b1c42110e3c590d6997530fc23384169bc57cd5c7614b6618dd7c391d10daa9b`.
The crossing's top program has copying-assay score **0**; the final 12609 top
program scores **64**. Those are distinct observations. Direct measurement
receipts, snapshot hashes and receipt hashes are indexed in
[scope-and-assay-receipts.json](scope-and-assay-receipts.json), including the
final score 0 for seeds 1, 3 and 4. These are measurements by the ported assay,
not an independent interpreter or a population-wide copying measurement.

Seed 2's final hash is
`3f21d457212eebbbc08b80435b34a1e2e25ba7655654b891ce8c08226d3c50be`,
not the original historical `d150da8b297eecb0da1e10432c420c4e9e890dc8e5cb395b563c20cc99ed43be`.
It exactly matches the earlier 2026-11-01 repeat: all five common snapshots and
all 198 sampled rows match that prior attempt. The original historical mismatches
at 12288 and 12609, and the 13 differing rows, remain recorded. The observed
incomplete batch in this run occurred **after** the first historical divergence;
it does not explain that divergence.

Seed 1 matches at 4096, then differs at 8192, 12288 and 16384. Its final hash is
`b05f6da38519bd741cff63bccf280c89fe0d7c5dd3741fc7fb94422427ed977c`.
Seeds 3 and 4 exactly reproduce their historical endpoints and full sampled
series. None of seeds 1, 3, 4 had a sampled H+ crossing through 16384; their final
top-program copying assays score 0. That is not evidence that no transient
copiers ever occurred between samples.

## Evidence and remaining limits

[run-summary.json](run-summary.json) records full hashes, comparison counts,
retry events, runtime, compressor, adapter, source fingerprints and receipt
identities. Raw logs, per-snapshot measurements, complete differing rows and
invocations are under:

`/Users/nicholas/develop/browser-life-soup-129/runs/issue-129-checked-2026-11-14/ensemble/`

All 67 original files were rehashed after the four runs and still match the prior
archive inventory. Source copies and patches preserve the exact uncommitted
candidate implementation. At the time these runs were archived, no commit,
push, issue comment or external publication had been performed. Subsequent PR
preparation does not change the frozen source copies or run receipts. The scoped Sol 6.1 High launch review found no blockers after its
findings were fixed. Runtime regressions and the live rejected batch provide
separate empirical evidence; static review alone is not GPU validation.

**Still unproven or incomplete:** the historical seed-2 continuation from 12609
to 45056 was not repeated; exact producing revision/dirty state of the original runs;
the cause of the historical seed-1 and seed-2 divergence; exhaustive GPU semantic
correctness or independent upstream/other-hardware execution; population-wide
copying prevalence and family-frequency trajectories; takeover, persistence,
adaptation or open-ended evolution. Completion counters address missing pair
completions, not every possible hardware/software error. The browser/island
unchecked stepping paths are not covered by this CLI result. Grid still requires
its own independent upstream fixture. Immutable remote publication remains open.

## Checksummed result archive

The 156-file result archive preserves the four completed runs, full differences,
per-snapshot receipts, source copies, the supervisor, validation tests/logs and
launch-review receipts. Every member and source was rehashed after packaging.
The archive and verification sidecars are read-only; publication remains local.

`/Users/nicholas/develop/browser-life-soup-129/runs/issue-129-checked-2026-11-14/result-archive/originals.zip`

SHA-256: `72d448b2fd6ddb8e8dde8f088f8000523824eb181801f5aaa123ce20235d06e6`.

See [archive-manifest.json](archive-manifest.json) and
[archive-receipt.json](archive-receipt.json). The original 67-file archive remains
separate and is identified by SHA-256
`f69d4c6084931ef7c37ed0deeee85238f45ceb51ece268926bbdd34b200e3603`.

The final read-only evidence review confirmed the table, sequential exit-0
completion, retry deficit and accepted-work totals. Its scope omission was
addressed by explicitly excluding seed 2's later 507 historical rows. Its request
for assay corroboration is addressed by the direct receipt index above; no
independent assay implementation is claimed. Review receipt:
`runs/issue-129-checked-2026-11-14/result-review.txt`.


## Post-run adversarial review and fixes

Claude Opus 5.5 reviewed the implementation and evidence read-only; the CLI also
reported Fable 5.2 usage. It found no blocker in the frozen results and identified
robustness/provenance improvements. The required Sol 6.1 High review independently
rehashed both archives, all 223 inventoried sources, and the six indexed assay
receipts; its supervisor and resume findings were addressed after the full runs.
See [review-and-validation.md](review-and-validation.md) for dispositions.

The frozen four-run code is identified by `run-summary.json` and the archived
source copies. Subsequent code adds checked resume uploads, shared-device
exclusion, rollback readback verification, per-seed error/timeout handling,
protocol completeness checks and source-bound encoder receipts. Those changes
have focused regression validation; the four long runs were **not rerun** with
the amended implementation. Future independent seeds 1/3/4 use `--after 16384`
to reach their cap even if they cross early; the frozen commands used 1024 and
all three nevertheless reached 16384.

[summary-derivation.json](summary-derivation.json) identifies the raw receipts
behind summary assertions and a fresh rehash of all 67 original sources. The
original assay helper is recoverable from revision e53bb283, but its per-receipt
compressor fingerprint was not recorded at the time. Later receipt tooling
cannot retroactively supply that missing provenance. Source copies are the
authoritative run-source record; a Git patch alone omits untracked files.

Absolute source paths in frozen manifests identify the original acquisition
locations. They are intentionally preserved, not presented as download links.
ZIP members are located by each manifest's `member` field. Remote publication
of the archives is still outstanding.
