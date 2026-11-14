# food-replays evidence

All with PATH=$HOME/.nvm/versions/node/v24.2.0/bin:$PATH. Raw outputs and PNGs are in `evidence/`. Scratch dir: /private/tmp/claude-501/-Users-nicholas-develop-browser-life/e28381b7-b46a-475c-85b9-2de9973e0770/scratchpad/food-replays

## Restore (real run, this worktree)
- `restore.sh --check` before: exit 1, 0/73 verified (evidence/check-before.txt).
- `restore.sh --dry-run`: exit 0, would copy 73, exclude file not touched.
- `restore.sh`: exit 0, copied 73 (373,843,903 bytes: 58 from source food-line-101-119 and 15 from creative-prototypes-85-100 as listed in restore-run.txt), RESULT 73/73 verified.
- `restore.sh --check`: exit 0, 73/73. Second `restore.sh`: exit 0, "copied 0, already ok 73".
- Independent `shasum -a 256 -c` over all 73 table rows: 0 failures.
- `git status --porcelain` shows no .json/.mp4/.gz path (restored files hidden via the marked block in /Users/nicholas/develop/browser-life/.git/info/exclude, the shared exclude file; 77 root-anchored lines there now).

## Tests
- `pnpm vitest run tools/test/restore-artifacts.test.ts`: 27 passed (after the FIX stage and its follow-up review; was 17).
- `pnpm typecheck`: clean.
- `pnpm vitest run tools/test` (json reporter, after restore; summary kept in evidence/vitest-summary.txt): 2768 passed, 6 failed, 39 skipped, 2813 total. The 6 pin failures are pre-existing: package.json/pnpm-lock.yaml are identical to origin/main, so they fail there too once the replays exist. All 6 failures are in tools/test/food-band-foothold-replication.test.ts: "Pinned input changed: package.json". food-schedule-769.test.ts (now un-excluded): 20 passed. A first full run had 7 failed in 2 files; the second file passed on rerun alone/second run (load-sensitive), not identified.

## E2E (BL_E2E_PORT=5262, tests/e2e/*food*.spec.ts + uniform-endurance.spec.ts, 278 tests)
- Before restore: 116 passed, 0 failed, 162 skipped (e2e-before.txt).
- After restore: 264 passed, 0 failed, 14 skipped (e2e-after.txt). The 14 remaining skips are the BL_*_ACTUAL / BL_*_MEDIA gated tests.
- Those 14 rerun with all gates set (e2e-gated.txt): 12 passed, 2 failed. Failures: food-schedule-769.spec.ts "actual saved outcome" and "actual animation plays", both "Source mismatch: package.json".

## Real playback (no fixtures; throwaway probe evidence/playback-probe.spec.ts.txt serving the restored files)
Pages: moving-food (paired), uniform-food (single canvas), food-band-longevity (longevity); 1280 and 375 widths; 6 passed (playback.txt). Re-run in the FIX stage with real assertions: source status must be `ready`, scrubber advances, population equals the recorded census at the displayed tick, and for paired pages `video.play()` gives currentTime > 0 with no media error.
- moving-food: "Both seed 1,201 arms verified", scrub 0 -> 76, tick 1520 population 48 = recorded 48, video currentTime 1.50.
- uniform-food: "Seed 1,201 verified · 301 exact saved frames", scrub 0 -> 151, tick 3020 population 37 = recorded 37 (no video on this page).
- food-band-longevity: verified with SHA-matched visual receipt, scrub 0 -> 276, tick 5520 population 39 = recorded 39, video readyState 4, duration 30.1 s, currentTime 1.50 after play, no error.
- moving-food video has preload=none so readyState 0 until played (no media error).
- Screenshots read: evidence/moving-food-1280.png, uniform-food-375.png, food-band-longevity-1280.png (also -375 / uniform 1280 / moving 375): both worlds drawn with bodies and the outlined band, scrubber mid-run, jump buttons, population readout.

## Codex review
Round 1, Sol 6.1 xhigh, read-only: REVIEW.md (top). Round 2 source review plus Claude findings, dispositions in REVIEW.md "Source review dispositions". All P1/P2 fixed, including the create-after-check race (link() publish). Follow-up review of the fixes: review-sol-fixes.txt.

## FIX-stage re-runs
- restore-artifacts.test.ts 27 passed; `pnpm typecheck` clean.
- Real: `restore.sh --check` 73/73, `restore.sh` 73/73 (copied 0), no `.restore-tmp-*` anywhere under docs/ or apps/ (evidence/restore-run3.txt). The delete-and-restore through the copy path is recorded separately in evidence/restore-run4.txt (re-run after review: one file removed, `--check` reports 72/73 and exits 1, the restore copies 1 and verifies 73/73). The exclude block now also holds `.restore-tmp-*`.
- Playback probe 6 passed (evidence/playback.txt). After review the probe also asserts that the scrubber advances from play alone, before any manual jump; re-run: 6 passed. The throwaway spec was copied to tests/e2e/zz-tmp-playback.spec.ts for the run and removed.

## Files for the coordinator to stage (explicit paths, no globs over docs/creative-prototypes)
```
git add docs/creative-prototypes/ARTIFACTS.md \
  tools/creative-prototypes/restore.mjs \
  tools/creative-prototypes/restore.sh \
  tools/test/restore-artifacts.test.ts \
  docs/visualization-gaps-2026-11-14/food-replays
```
`git status --short` lists only: ` M docs/creative-prototypes/ARTIFACTS.md`, `?? docs/visualization-gaps-2026-11-14/`, `?? tools/creative-prototypes/`, `?? tools/test/restore-artifacts.test.ts`. None of the 73 restored .json/.mp4/.gz files appears (hidden by the exclude block). The slice folder holds only small text and PNG evidence (no replay JSON/MP4); the parent `docs/visualization-gaps-2026-11-14/PLAN.md` is not touched. Check before committing: `git diff --cached --name-only | grep -E '\.(mp4|gz)$|creative-prototypes/.*\.json$'` must print nothing.
