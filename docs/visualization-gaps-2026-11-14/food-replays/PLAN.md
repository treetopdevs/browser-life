# food-replays: make the 18 food replay viewers play

Worktree `/Users/nicholas/develop/browser-life-viz-food-replays`, branch `claude/viz-food-replays` (from `origin/main` 9d91709a). Dev port 5261, Playwright port 5262.

## User-visible outcome

Today each of the 18 food result pages under `docs/creative-prototypes/` loads but cannot play: the replay JSON and the paired video were kept out of git. After this slice, one command restores them and every page plays its recorded run. 13 of the 18 pages are paired (two worlds side by side), with a shared scrubber, jump-to-tick buttons and the recorded clip.

## Verified against the worktree (and corrections to the planning section)

- Confirmed: 18 food pages and 18 matching `tests/e2e` specs. The 21 HTML files are these 18 plus `comparison.html`, `decisions.html` and `hungry-shapes.html`.
- Confirmed: `ARTIFACTS.md` has two tables, 15 rows (no commit column) and 58 rows (with a commit column), 73 in all. None of the 73 paths exists in this worktree. No `.gitignore` rule covers them.
- Confirmed: both source trees under the main checkout's `runs/` mirror repo-relative paths (`runs/<dir>/docs/creative-prototypes/...`). Together they hold all 73 files (the 15 in `creative-prototypes-85-100/`, the 58 in `food-line-101-119/`); each file's presence is re-checked by the script. The planning section's "copy the files to the paths in ARTIFACTS.md" works as written. `creative-prototypes-85-100/` also holds `review/*.md`, which are not restored.
- The planning section says "the 18 pages need food-line-101-119 (290 MB) and 67 MB". The 67 MB group is shared with the older lab pages (ecosystem archive videos, `development-pilot.json`), so restoring "both tables" also un-skips unrelated specs and vitest tests. This is wanted, but the before/after counts must be reported for the whole suite slice, not just food.
- Correction: the first table's fallback commit (`511d76c6`) is not in a table column. It is only in the prose above the table. The script must hard-code it, and a test pins it to the prose so the two cannot drift. The second table's commits (`8c84eed5`, `43c69124`) are per row. All three commits are present in the local object store, so the `git show` fallback works offline.
- Correction: the documented fallback one-liner reads files with a shell loop, which silently truncates on failure and does not check hashes. The script replaces it. It does not edit that one-liner (the tables stay byte-stable), but the new section points at the script first.
- Correction: `git rev-parse --git-path info/exclude` resolves to `/Users/nicholas/develop/browser-life/.git/info/exclude`. That file is shared by every worktree and lives inside the main checkout. Appending to it is what the coordinator asked for, and root-anchored patterns for paths that are untracked in every other checkout are harmless there. But it is an edit outside this worktree, so:
  - The script writes only one clearly marked block (`# >>> restore.sh: out-of-git replay artifacts` ... `# <<<`), rewritten in place, never duplicated. It reports the file it touched.
  - `--exclude-file PATH` overrides the target, and the vitest uses it so tests never touch the real file.
  - The real run reports the resolved path to the coordinator.
- `vitest.config.ts` excludes `tools/test/food-schedule-769.test.ts` while `food-floor-longevity-replication-seed-1202.json` is missing. After the restore, that test runs under `pnpm test`. That is intended and is part of the evidence. The file is not edited.
- `tests/e2e/food-schedule-769.spec.ts` skips whole when its two replays are missing. Two of its tests also skip unless `BL_SCHEDULE_769_ACTUAL=1` or `BL_SCHEDULE_769_MEDIA=1`. The planning gate "pass instead of skip" is therefore not true for those two tests unless the env vars are set. The plan runs them with both set, once, and reports separately.
- The other 17 specs install fixtures through `page.route`. Many may run today without the real files. The before/after table must show which tests actually change state, rather than assume all 18 flip.

## What is built

One new tool, one new test, one doc section. No lab code, no model, no config change.

1. `tools/creative-prototypes/restore.mjs`, run as `node tools/creative-prototypes/restore.mjs [TARGET] [flags]`, plus a three-line `restore.sh` that finds Node 24 and calls it, so the documented command is `tools/creative-prototypes/restore.sh`.
   - Why Node and not pure shell: the work is parsing two markdown tables, streaming SHA-256 over 300 MB, writing to a temp file then renaming, and testing against a fixture. macOS ships bash 3.2 and BSD tools. Node 24 is already the repo's runtime, and vitest can import the module, so the test calls the same functions the CLI calls.
   - The pure logic lives in exported functions: `parseArtifacts(markdown)`, `restore(options)` and `main(argv)`.
2. Behaviour, in order for each of the 73 entries:
   1. Parse both tables. Fail loudly if a row has no 64-hex hash or no integer size, or if the total is not what the fixture or the real document declares. The real document check is in the test, not hard-coded in the tool.
   2. If the target file exists and its hash and size match: report `ok (already present)` and move on.
   3. If it exists and differs: refuse unless `--force`. Without `--force` this is an error and the exit code is non-zero.
   4. Otherwise copy from `SOURCE/<dir>/<path>`, trying `food-line-101-119` then `creative-prototypes-85-100`. If neither has it, fall back to `git show <commit>:<path>` in the target repo.
   5. Write to `<path>.restore-tmp-<pid>` in the same directory, hash and size-check the temp file, then `rename`. On any mismatch delete the temp file and leave the existing target untouched. A wrong file is never in place.
   6. `--check` makes no change. It exits non-zero if any target file is missing or differs. `--dry-run` prints what it would copy, from where, and what it would refuse.
   7. After success, ensure the exclude block lists exactly the 73 paths. In `--check` and `--dry-run` it never writes the exclude file.
   8. Report: one line per file (`ok`, `copied from source`, `copied from git <commit>`, `MISSING`, `HASH MISMATCH`, `REFUSED`), totals, bytes, the resolved exclude file, and the final `RESULT: N/73 verified`. Exit 0 only when all 73 verified.
3. Defaults. `TARGET` is the repo containing the script. `--source` defaults to `/Users/nicholas/develop/browser-life/runs`, with `BL_RUNS_DIR` as an environment override so the path is not hard-coded for other machines. The script reads from the source and never writes there.
4. Idempotent. A second run rewrites nothing and reports every file as already present.
5. `ARTIFACTS.md` gets a short section "Restoring with one command" appended after the last table. The text above the tables and both tables stay byte-identical, and the test checks this by comparing the table and prose bytes before and after against the git blob.

## Exact files

Add:
- `tools/creative-prototypes/restore.mjs`
- `tools/creative-prototypes/restore.sh`
- `tools/test/restore-artifacts.test.ts`
- `docs/visualization-gaps-2026-11-14/food-replays/PLAN.md` (this file), `REVIEW.md`, and `evidence/` (screenshots, before/after test output, the real-run report)

Change:
- `docs/creative-prototypes/ARTIFACTS.md` (one appended section only)

Not changed: `vitest.config.ts`, any `model.ts`, any `explore.ts`, golden pins, the generated prereg, the parent `docs/visualization-gaps-2026-11-14/PLAN.md`.

Local only, never staged: the 73 restored files, plus the block in the shared `info/exclude`.

## Tests

`tools/test/restore-artifacts.test.ts` builds a temp directory with a tiny git repo (target), a fake runs directory (source), and a small `ARTIFACTS.md`-shaped file with 4 entries in both table shapes. Hashes are computed in the test. The tests pass `--exclude-file` so the real exclude file is never touched.

Named cases:
- `restores a file whose source hash matches` (bytes identical, size equal, no temp file left).
- `fails on a source hash mismatch and leaves nothing in place` (non-zero exit, no target file, no `.restore-tmp-*`).
- `does not replace an existing good file when a later source is bad` (existing target kept byte for byte).
- `falls back to git show when the source file is missing` (fixture repo has a commit with the file).
- `fails when the source is missing and git has no such path` (non-zero, nothing written).
- `fails when the git fallback gives bytes with the wrong hash`.
- `refuses to overwrite a differing existing file without --force` (file untouched, non-zero).
- `overwrites a differing file with --force` (and only with a verified replacement).
- `second run is idempotent` (every file reported present, mtimes unchanged).
- `--check writes nothing and exits non-zero when a file is missing` and `exits zero when all verify`.
- `--dry-run writes nothing, including the exclude file`.
- `adds the restored paths to the exclude file once` (marked block, no duplicates after two runs, `git status --porcelain` in the fixture shows no untracked restored paths).
- `leaves unrelated exclude lines intact`.
- `parses both real table shapes` and `real ARTIFACTS.md yields 15 + 58 rows, all 64-hex hashes, all commits resolvable` (reads the real document and checks structure only; needs no large files).
- `hard-coded first-table commit matches the prose in ARTIFACTS.md`.
- `ARTIFACTS.md tables and prose are byte-identical to HEAD` (everything outside the appended section).
- `size mismatch with matching prefix is rejected` (truncated file).

The test follows `tools/test/deno-no-lock.test.ts`'s rule: it starts no deno, and any `spawn` of node uses plain argv.

## Verification in a real browser and process

Steps recorded in `evidence/` (all with `PATH=$HOME/.nvm/versions/node/v24.2.0/bin:$PATH`):
1. Before: `BL_E2E_PORT=5262 npx playwright test tests/e2e/*food*.spec.ts tests/e2e/uniform-endurance.spec.ts --reporter=list` with counts of pass, fail and skip per file. Also `pnpm vitest run tools/test --reporter=dot`, counting skipped tests in the food files.
2. `restore.sh --dry-run`, then `restore.sh`, then `restore.sh --check`, then a second `restore.sh`. Independently confirm with `shasum -a 256` across all 73 paths against the table, and `git status --porcelain` shows none of them.
3. After: the same Playwright and vitest commands, with a before/after table. Specs that fail for reasons unrelated to missing files are reported with their errors and not fixed.
4. Real-replay playback: start `pnpm --filter ... dev` equivalent `node node_modules/vite/bin/vite.js apps/lab --port 5261 --strictPort`, and use a throwaway Playwright script (kept in the scratchpad, not committed) against the real page URLs. It must not use route fixtures, so it exercises the actual restored files. It takes screenshots mid-replay of:
   - paired: `moving-food.html` (or `stationary-food.html`), after pressing play and jumping to a mid tick;
   - single-canvas: `uniform-food.html`;
   - longevity: `food-band-longevity.html`.
   Each is read as an image, not just saved. A pass requires: the video element has `currentTime > 0`, the scrubber value changed, the "evidence unavailable" text is absent, and the population readout equals the recorded census at the jump tick.
5. `food-schedule-769`: run once with `BL_SCHEDULE_769_ACTUAL=1 BL_SCHEDULE_769_MEDIA=1`.
6. Codex review (Sol 6.1, xhigh, read-only), output saved to `REVIEW.md`.

## Acceptance gates (runnable)

```bash
export PATH="$HOME/.nvm/versions/node/v24.2.0/bin:$PATH"
cd /Users/nicholas/develop/browser-life-viz-food-replays
pnpm typecheck
pnpm vitest run tools/test/restore-artifacts.test.ts
tools/creative-prototypes/restore.sh --check          # exit 0, "RESULT: 73/73 verified"
tools/creative-prototypes/restore.sh                  # second run: nothing copied
git status --porcelain | grep -E '\.(json|mp4|gz)$' && echo STAGEABLE-LEAK   # must print nothing
BL_E2E_PORT=5262 npx playwright test tests/e2e/*food*.spec.ts tests/e2e/uniform-endurance.spec.ts
pnpm test                                             # includes tools/test/food-schedule-769.test.ts once restored
```

`pnpm typecheck` has to include the new test; the script itself is `.mjs` and so outside the tsc projects. If the script's own types matter, it carries JSDoc only.

## Non-goals and limits

- No simulation, rendering or model code, and no live food-band page (that is `food-live`).
- The restored files are never committed, never added to git, and not made ignorable by editing `.gitignore` (the exclude is local only). A future decision on LFS or release assets is out of scope.
- No network access. The script never runs `git fetch`; if a commit is missing locally, the fallback fails with a clear message that names the fetch command.
- Only the 73 listed paths are touched. The `review/` folder is not copied.
- The shared `info/exclude` edit affects all worktrees of this repo. It is local, but it is not confined to this checkout.
- Load-sensitive Playwright timeouts are rerun alone and noted, not changed.
- Skipped tests that skip for another reason (env-gated, GPU-gated) stay skipped and are listed.

## How to try it

```bash
export PATH="$HOME/.nvm/versions/node/v24.2.0/bin:$PATH"
cd /Users/nicholas/develop/browser-life-viz-food-replays
tools/creative-prototypes/restore.sh --dry-run    # what would be copied
tools/creative-prototypes/restore.sh              # copy, verify 73 hashes, hide from git
node node_modules/vite/bin/vite.js apps/lab --port 5261 --strictPort
# open http://localhost:5261/docs/creative-prototypes/moving-food.html      (paired)
#      http://localhost:5261/docs/creative-prototypes/uniform-food.html     (single canvas)
#      http://localhost:5261/docs/creative-prototypes/food-band-longevity.html (longevity)
# on another checkout:  tools/creative-prototypes/restore.sh /path/to/checkout
```

Press play, drag the scrubber, use the jump buttons. The clip at the bottom plays the recorded video.
