## Round 1 findings (historical, all fixed)

Codex Sol 6.1 (xhigh) reviewed the first version of the script. The five findings below are kept as written; file and line references are to that first version, not the current source. All five were fixed in the FIX stage: the dispositions and the tests that cover them are in the sections that follow, and nothing here is open.

- **P1 — Existing files can be overwritten without `--force`.** `restore.mjs:49` treats read failures as absence. An unreadable file in a writable directory, or a dangling symlink, reaches the unconditional rename at line 68 and is replaced. A file created between the initial check and rename is also overwritten.

- **P2 — Missing option values swallow safety flags.** `restore.mjs:137`: `--source --dry-run` consumes `--dry-run` as the directory value, then performs actual restoration through git fallback. `--source --check` similarly loses verification-only mode.

- **P2 — Symlinked destination directories allow writes outside TARGET.** `restore.mjs:63` follows parent-directory symlinks without checking containment. Linking an artifact directory into the runs cache lets restoration modify the supposedly read-only source directory.

- **P2 — Exclude updates can destroy existing rules.** `restore.mjs:132` truncates the shared `info/exclude` directly. Disk exhaustion or interruption can leave it incomplete, losing unrelated exclusions and exposing artifacts to staging. No write-failure test covers this.

- **P3 — Git-fallback content assertion skips its key fixture.** `restore-artifacts.test.ts:65` accepts arbitrary content for C through `|| e === C`. C is the second-table git-only fixture; the separate fallback test also checks output rather than restored bytes.

Static review only; no files changed or tests run. (Reviewer's note, round 1.)

## Source review dispositions

Second round: Sol 6.1 (source review, `review-sol-src.txt`) and Claude (reviewer) findings, assessed in the FIX stage. Evidence: `tools/test/restore-artifacts.test.ts` now has 27 tests, all passing; `pnpm typecheck` clean; real restore re-run 73/73 (`evidence/restore-run3.txt`), and one real file deleted and restored through the new code path (copied, hash verified, no temp directory left).

| # | Finding | Reviewer | Disposition | Evidence |
|---|---|---|---|---|
| 1 | P1 temp file can be a pre-planted symlink; exclude writer too | Sol | Fixed. Temp files live in a private `mkdtemp` directory (`.restore-tmp-XXXX`) opened with `O_EXCL\|O_NOFOLLOW`; the exclude temp name has a random suffix and the same flags. | test "with --force replaces a symlink at the destination instead of writing through it" (victim file unchanged) |
| 2 | P1 TOCTOU overwrite without `--force` | Sol | Fixed. Without `--force` the file is published with `link()`, which fails with EEXIST instead of replacing; reported REFUSED. `--force` uses `rename()` by design. | code `placeVerified`; EEXIST branch in `restore` |
| 3 | P2 exclusions written after copying | Sol, Claude (P3 non-git target) | Fixed. The block (paths plus `.restore-tmp-*`) is written before any copy. A target whose exclude file cannot be resolved raises `PreflightError`: exit 1, nothing copied. | tests "writes the exclude block before copying" (unwritable exclude, nothing copied) and "a target that is not a git checkout ... exit 1" |
| 4 | P2 no index preflight | Sol | Fixed. `git ls-files` on the artifact paths; tracked paths are REFUSED in every mode. | test "refuses paths that the checkout tracks" |
| 5 | P2 containment checked after mkdir | Sol | Fixed. `parentProblem()` walks existing ancestors with lstat/realpath before any mkdir and again after; escapes and dangling links are REFUSED. | test "refuses a symlinked parent directory that points outside the target" (outside dir stays empty) |
| 6 | P2 playback probe accepted `ready\|error`, no video or census assertion | Sol | Fixed. Probe now requires `data-kind=ready`, no empty or error state, scrubber advance, population equal to the recorded census at the displayed tick (read from the replay JSON), and for paired pages a real `video.play()` with `currentTime > 0` and no media error. Re-run: 6 passed, e.g. moving-food tick 1520 pop 48 = recorded 48, video 1.50 s. | `evidence/playback-probe.spec.ts.txt`, `evidence/playback.txt` |
| 7 | P3 subprocess status discarded | Sol | Fixed. The HEAD-bytes test asserts `git show` status 0. The `git cat-file` loop was removed and the test renamed to "well-formed commit ids" (it never checked resolution). | `tools/test/restore-artifacts.test.ts` |
| 8 | P3 vitest totals not retained | Sol | Fixed. | `evidence/vitest-summary.txt` |
| 9 | P2 vacuous "does not replace an existing good file" test | Claude | Fixed. Replaced by a test where B differs locally, the source copy is bad, B has no git copy and `--force` is on: exit non-zero, local bytes untouched, no temp left. | test "a bad source never clobbers an existing differing file, even with --force" |
| 10 | P2 symlinked-parent check untested | Claude | Fixed, see 5. | same |
| 11 | P2 default exclude resolution never exercised | Claude | Fixed. A real `git worktree add` target with no `--exclude-file`: the shared `.git/info/exclude` gains the block, `git status --porcelain` in the worktree is empty. | test "default exclude resolution: in a linked worktree ..." |
| 12 | P3 shared exclude edit undocumented, no undo | Claude | Fixed. ARTIFACTS.md section and `--help` say it is the main checkout's shared file; `--unexclude` removes only the marked block (tested, including that status shows the files again). | `docs/creative-prototypes/ARTIFACTS.md` |
| 13 | P3 "every commit resolves locally" test overclaims | Claude | Fixed, see 7. | |
| 14 | P3 exit code 2 on non-git target after copying | Claude | Fixed, see 3. | |
| 15 | P3 six `food-band-foothold-replication` failures newly exposed by the restore | Claude | Not a bug in this slice, documented. The tests pin `package.json` by SHA-256 and fail with "Pinned input changed". `package.json` and `pnpm-lock.yaml` in this worktree are identical to origin/main (`git diff origin/main -- package.json pnpm-lock.yaml` is empty), so the same six tests fail on origin/main with the files restored; they were only hidden because the replays were absent. The same pin causes the two gated e2e failures in `food-schedule-769.spec.ts`. Not fixed here (frozen pin, unrelated code); needs the pin re-baselined or the tests retired by whoever owns them. | `evidence/vitest-summary.txt`, `evidence/e2e-gated.txt` |
| 16 | P3 symlink with matching bytes passes `--check`; stray `*.restore-tmp-*` files stageable | Claude | Fixed. "ok" requires a regular file (lstat); `.restore-tmp-*` is in the exclude block. | tests "a symlink to a file with matching bytes does not pass --check" and the worktree exclude test |

Open after this round: only item 15 (pre-existing pin failures, deferred with the reason above).


## Follow-up review of the fixes (`review-sol-fixes.txt`, Sol 6.1 xhigh)

| Finding | Disposition | Evidence |
|---|---|---|
| P2 internal symlinked parent bypasses index and exclude checks | Fixed. Any symlinked ancestor inside the target is refused, not only ones that escape. | test "refuses a symlinked parent even when it points inside the target" (tracked `shared/a.json` untouched with `--force`) |
| P2 index preflight fails open | Fixed. In a git checkout an unreadable index raises `PreflightError` (exit 1, nothing changed); a non-git target still has no tracked set. | test "fails closed when the git index cannot be read" |
| P2 `--unexclude` overrides `--dry-run`/`--check` | Fixed. The combination is a usage error (exit 2) and the exclude file is untouched. | test "--unexclude refuses to combine ..." |
| P3 exclusion test discards subprocess results | Fixed. Both runs must exit 0 and all four files must hold the right bytes before visibility is checked. | test "adds the restored paths to the exclude file once ..." |

Nothing else open from this round. Final checks: restore-artifacts.test.ts 27 passed, `pnpm typecheck` clean, real `restore.sh --check` 73/73 and a re-run copied 0.

## Final review after commit (`review-sol-final.txt`, Sol 6.1 xhigh)

| Finding | Disposition |
|---|---|
| P2: a `.gitignore` `!` rule can re-include a restored path | Fixed: after writing the exclude block the tool asks git which paths are ignored and stops before copying if any is not; test added |
| P2: non-canonical manifest paths bypass the tracked-file refusal | Fixed: paths with empty, `.` or `..` segments are rejected; test added |
| P2: wrong default source with a separate git directory | Fixed: the main checkout comes from `git worktree list`; a bare main falls back to TARGET/runs |
| P2: `git show` could lazy-fetch in a partial clone, even in `--dry-run` | Fixed: `GIT_NO_LAZY_FETCH=1` |
| P3: `--source -h` swallowed the help flag | Fixed: any value starting with `-` is a usage error; test added |
| P3: the preservation test compared HEAD with itself | Fixed: pinned byte length and SHA-256 of the file as it was on main |
