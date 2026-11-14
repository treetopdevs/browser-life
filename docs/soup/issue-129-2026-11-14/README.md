# Issue #129 continuation — 2026-11-14

Issue: https://github.com/treetopdevs/browser-life/issues/129

Work is isolated in `/Users/nicholas/develop/browser-life-soup-129`, branch
`codex/soup-129-reproducibility`, based on `e53bb283f6314c86d53b314237b01da4f1da5b8e`.
The original checkout and earlier soup evidence worktrees were not edited.
No simulation rule, interpreter, pairing, mutation or shader change is included.

## Recovered evidence and provenance

The prior repeat manifest at
`/Users/nicholas/develop/browser-life-soup-repeat/runs/independent-2026-11-01/manifest.json`
records candidate revision `7e7fc4537168bf8bcb561f2682f6690c95a9fa24`, Deno 2.9.8,
C brotli 1.2.1, source hashes and the seed-2 command. The repeat exited normally
at 12609, but its supervisor stopped the queue on checkpoint mismatch.
Seeds 1, 3 and 4 were **not run** by that queue.

Recomputed comparison of every repeat CSV row, excluding only `seconds`:
185 of 198 rows match. All sampled columns match through 11777; the first
mismatch is 11841. See `prior-repeat-series.json` for all 13 differing rows.
The original CSV contains 705 rows, including the resumed segment;
rows after the repeat endpoint are not claimed to have been repeated.

| Seed-2 epoch | Prior repeat versus historical |
|---|---|
| 4096 | SHA-256 match |
| 8192 | SHA-256 match |
| 11585 | SHA-256 match |
| 12288 | SHA-256 mismatch |
| 12609 | SHA-256 mismatch |

Full identities are retained in the archived repeat manifest and snapshots.
Historical seed-2 params record a resume from `soup-12609.bin`, cap 45056,
`after=10000000`, `save=512`, census every 64. Original stdout ends at
12609; resumed stdout begins at 12673. This supports the recorded segment
boundary, but does not recover the original shell command or all intervening
activity. Original params were overwritten. Seeds 1, 3 and 4 retain fresh-run
params: 131072 noheads programs, mutation 262144, cap 16384, every 64,
threshold 1, after 1024, save 4096. Seed 1's CSV ends at 16321 although its
16384 snapshot exists; do not invent a historical endpoint row.

**Still unknown for the historical producers:** exact source revision, dirty
patch, runtime version, GPU/driver, compressor executable/version, complete
invocation/resume history. The audit's Deno/brotli versions describe the audit,
not the producing runs. File dates and today's worktree HEAD cannot establish
producing provenance. Seed-2 initial save cadence 4096 is a candidate based on
retained checkpoints and the prior repeat, not a recovered invocation.

Separate local commit `c30ba828c39e2d66e41c062bd00bb74ea43b5680` documents
silent GPU work loss on this Mac, sometimes even with one process, and introduces
completion counters/retries plus a process lock. Its
`docs/soup-evolution-2026-10-31.md` amendment says its long soups ran unchecked.
These checks are absent from this base and the old repeat. This is an integrity
risk and possible explanation, **not a diagnosis** of the 11841 divergence.
Integrating and independently validating those changes is a separate prerequisite
for trustworthy long GPU runs; short GPU tests do not resolve it. CPU replay
around the divergence could further localize the issue.

## Preservation

Existing historical-evidence.zip verified against its sidecar:
`9863fb195d5a6afa9437262e84ac68dda9bc319341f2fd2fb8cd90015aaf1140`;
ZIP CRC validation also passed.

New archive (67 entries):
`/Users/nicholas/develop/browser-life-soup-129/runs/issue-129-2026-11-14/complete-archive/originals.zip`

SHA-256: `f69d4c6084931ef7c37ed0deeee85238f45ceb51ece268926bbdd34b200e3603`.

`archive-manifest.json` maps each member to its original path, size and SHA-256.
It includes selected historical snapshots (including all intermediate checkpoints
for seeds 1, 3, 4), metadata, original stdout, prior
receipts and the failed repeat's snapshots, logs and supervisor. Every archived
member and original was rehashed after packaging. Originals were not modified.
The archive and sidecars are read-only and tamper-evident, **not published or
immutable remote storage**. Stable release/DOI publication remains open.
No upload or issue comment was made.

Reusable command (requires a new destination and existing parent):

```sh
python3 tools/soup-archive.py docs/soup/issue-129-2026-11-14/archive-manifest.json runs/new-evidence-archive
```

The finalized `VERIFIED.json` is published atomically after validation and file
permission changes. A failed package has no marker; its partial ZIP is not complete.
Hashing streams the archive and members. The earlier 58-entry archive is retained
locally as a superseded intermediate; the 67-entry package above is authoritative.

## Prepared runs and evidence mode

`repeat-plan.json` has exact argument arrays for seed order 2, 1, 3, 4, each from
initialization in a new directory, and explicit blockers. The commands use a
frozen lockfile; the CLI parser import is pinned to 1.0.32. These are candidate
source repeats; exact historical-source reproduction cannot be asserted while
that source remains unknown. Create `runs/issue-129-full` first. Do not use old
evidence directories as outputs. Compare every common checkpoint and every
sampled CSV column except elapsed time; report missing historical rows and retain
discrepancies. Negative seeds must reach 16384; a different seed-2 crossing or
endpoint is a discrepancy, not permission to retune. Run seeds sequentially;
a seed-2 discrepancy is not evidence about seeds 1, 3 or 4. No full run was
started in this continuation.

`tools/soup.ts --evidence` requires a new output directory, even when loading a
snapshot. It records source copies/hashes, relevant Git status/patch, revision,
arguments, runtime, available adapter identity, compressor path/version/hash,
parameters and starting-state hash in create-only files. A separate completion
record contains terminal hash, threshold epoch and stopping reason. It distinguishes a crossing observed in this segment from an inherited stopping
boundary (including unverified filename-based boundaries). Missing
completion means failed/interrupted, not success. Copies include untracked
source files, which a Git patch alone omits. Plain invocations also refuse an
evidence directory, and a process lock prevents concurrent writers. Keep segment directories separately:
resumed runs do not overwrite prior params/logs.

Before the first crossing it retains one census in memory; on crossing it writes
`soup-<previous census>-pre-transition.bin`. This is the preceding sampled state
in that invocation, not a later replay. First-census crossings and resumes that
already crossed cannot supply a preceding census; no missing state is fabricated.
The pre-transition file can be loaded for replay; its name does not mark a crossing.
A resume into a fresh directory from an ordinary checkpoint does not inherit the
old transition record or stopping window; pass an explicit endpoint. Loading a
transition-tagged checkpoint restores that boundary, as before.
Use a stationary checkout, without concurrent source edits during a run.
GPU driver version remains explicitly unknown. Evidence mode pins the resolved
compressor executable for the run; hashes of it and resolved Homebrew encoder
libraries are checked at each measurement and completion. System/unresolved
libraries are explicitly listed as unhashed. The available process command line
is recorded separately from script arguments.

## Verification and remaining empirical work

- CPU CLI integration passes: final bytes unchanged by evidence mode,
  pre-crossing bytes equal CPU replay, existing output refused without mutation,
  source copies preserved, resumed bytes match continuous execution.
- Archive tests pass: duplicate filenames preserved, destination reuse refused,
  changed source and finalization failure rejected without a verification marker.
- Deno typecheck passes for soup CLI, receipt tool and new CLI integration test.
- Existing Vitest soup suite plus Deno lock guard: 20 passed, one opt-in upstream golden skipped
  (`BL_SOUP_GOLDEN` was not enabled).
- Existing GPU comparison passes three 4096-program, 40-epoch cases.
- CPU/GPU evidence smoke (512 programs, seed 2, 20 epochs) matches hash
  `c67f95e2379acfbba37d50b76c528037af8e3c72a926ba3738729b28b49c29a6`.
  Runtime, Apple M1 Max adapter, compressor, raw receipt paths, exact dirty source
  hashes and launcher commands are in `validation.json` (fresh frozen-lock smokes
  after the review fixes).

Outstanding: trustworthy full seed-2 reproduction and historical-scale
pre-crossing capture; independent seeds 1, 3, 4 through 16384; population copying
prevalence and family trajectories; immutable publication; independent upstream
grid fixture. This change supplies no new full-scale empirical result.

The 11585 snapshot is a **sampled H+ threshold crossing** whose top program
scores 0. The historical 12609 top program scores 64 in the finite copying assay.
Neither the crossing nor a single top-program score establishes population
replication, takeover, persistence, or open-ended evolution. Grid remains a
separate experiment.

Sol 6.1 High read-only reviews are linked in `validation.json`. Their findings
were addressed, including output-reservation races, library-link drift and
inherited-boundary labeling. The final recommendation (lstat with NotFound-only
handling) was implemented and covered by a dangling-symlink refusal test; it was
not followed by another review. No commits or remote writes were made.

Later continuation: [checked GPU full runs](../issue-129-checked-2026-11-14/README.md)
completed the four fresh attempts after integrity checks were implemented. This
initial audit's prepared/not-started status is historical, not the latest status.
