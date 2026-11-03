# S1 review record

## Plan review dispositions

Reviewer: Codex gpt-6.1-sol, xhigh, read-only, against PLAN.md at 0bdd7a70. Prompt `/tmp/prototypes-2026-11-02-plan-review.md`;
raw output (transcript, 696 KB, not committed) `/tmp/prototypes-2026-11-02-plan-review.out`; final message `/tmp/s1-plan-review-final.txt`.
Verdict: request changes. 2 P1, 12 P2, no P3. All accepted; PLAN.md revised.

| # | Sev | Finding | Disposition |
|---|-----|---------|-------------|
| 1 | P1 | `pnpm dev -- --port` ignores the flags (Vite stays on 5173) | Fixed: `pnpm dev --port 5301 --strictPort`, verified by curl on 5301. |
| 2 | P1 | Inventory undercounted (15 playground pages, extra vite inputs, privacy, island.html) | Fixed: frozen inventory from vite.config.ts and playground/page.ts is the first walk act; every row needs a verdict. |
| 3 | P2 | Port contract: LAB_PORT=5302, overlapping owners, default ports in published commands | Fixed: sequential ownership with teardown check, 5302 removed, page prints port-qualified commands run and marks default-port forms as read-only translations. |
| 4 | P2 | Garden command lacks GARDEN_FOOD=1 at founding | Fixed: on the founding invocation, public setting verified, three states recorded separately. |
| 5 | P2 | Archipelago walk not isolated or bounded; `done` is not verified | Fixed: scratch data dir, unique experiment, curl body recorded, island bounded by max tasks and timeout, verification-by-second-island stated. |
| 6 | P2 | run/lineage/notebook commands placeholders; lineage needs `--dir`; notebook needs corpus | Fixed: full commands from file headers pinned before the walk, never bare run.ts, corpus-absent recorded as needs data with the committed example as labelled fallback. |
| 7 | P2 | Pond gate names the wrong specs | Fixed: specs chosen by variant (v1 pressure, v2 tree, v3 weather, naturalist-actions). |
| 8 | P2 | Evidence tests pass with zero shots or fake verdicts; selftest renders failures as text | Fixed: min 8 shots, verdict rows need assertion plus existing evidence, negative fixtures, selftest rule (non-empty, all passed, no `__golden.error`), 404 expects 404. |
| 9 | P2 | 16-shot cap vs coverage; filename not proof of width | Fixed: capture matrix (representative shots, log evidence for the rest), PNG header width check, shots.json manifest. |
| 10 | P2 | HTML twin test only compares headings and fenced commands | Fixed: full normalized comparison incl. verdicts and links, non-empty extraction, fragment anchors. |
| 11 | P2 | Historical-page test skips in CI, ignores HTML | Fixed: pinned sha256 of both original blobs, one pointer line, no skip. |
| 12 | P2 | `git diff --stat` guard always exits 0, path list incomplete | Fixed: `--exit-code`, protected paths include tools/opponents, tools/niche, prereg, lockfiles, plus untracked check. |
| 13 | P2 | bin/garden-dev starts Deno without `--no-lock` | Fixed: PATH shim or post-run check that package.json, pnpm-lock.yaml, deno.lock are unchanged. |
| 14 | P2 | Status vocabulary conflates unbuilt with unverified; PRs #85/#101 closed unmerged | Fixed: four status axes; cite #120/#121 instead; `gh pr view` merged check by hand, drafts named as drafts. |

## Source review dispositions

Fix stage, 2 November 2026. All nine findings were real and were fixed; none is deferred.

| Finding | Reviewer | Disposition | Evidence |
|---|---|---|---|
| P2 `/tmp/s1` never created, lineage fails with ENOENT | sol | Fixed: `mkdir -p /tmp/s1` added as the first line of the research command block and a row in the command table, in both twins | md and html fences; the "every fenced command is in the table" test passes |
| P2 Soup works verdict had no action | sol | Fixed by running the actions: One step (0 to 1), Play (to 45 at 1280, 49 at 375), click-inspect, Plant ("planted 25 copiers"), 0 console errors; W32 now cites the record | evidence/soup-walk.txt; walkthrough W32; public-a11y soup 5 of 5 rerun |
| P3 test counts misattributed | sol | Fixed: the six pond and naturalist files passed 11 checks; 31 passed and 10 skipped is the whole run; not-found was 1 passed and 9 skipped by build and Caddy guards | md, html, walkthrough W09 and W49; 11 `pond-keeper` or `naturalist` passes counted in evidence/playwright-lab-specs.txt |
| P3 twin test ignored prose | sol | Fixed: the test now compares normalized paragraph and list-item text between the twins | a mutation of the HTML ("rang 0 times, as it should" to "rang 99 times, as it failed") fails the test; restored |
| P3 verdicts could lose evidence | sol | Fixed: each surface row must cite at least one walkthrough row that exists and two screenshots; new test validates sweep.json shape (null or malformed rows fail), requires a row per plain route at both widths, and checks works rows against status, scroll and console errors | tools/test/prototypes-status.test.ts (12 tests pass, including negative cases) |
| P2 garden "days 0 to 4 verified" unsupported | claude | Fixed: the page and walkthrough say four days done, tip at day 5, day 1 checked verified; garden-walk.txt corrected to say only day 1 had a recorded status | garden-walk.txt; md line in Shared garden and the verdict table; html twin |
| P2 W08 and Public site works despite a recorded 502 | claude | Fixed: W08 is partly (works with the coordinator up, logs the bare-dev proxy 502, F3) and the Public site surface verdict is partly in the verdict table, the surface summary table and the walkthrough | walkthrough W08 and surface table; md and html |
| P2 Lab verdict covers only part of the surface; no cross-check | claude | Fixed both ways: the Lab and Shared garden verdicts state their scope, the Lab summary cell says five library pages are partly, and a test now requires that a surface is works only if every row it cites is works | surface-table test, which expands "W10 to W15" style ranges |
| P3 island-1-run.log had an empty URL | claude | Fixed: the timing line now carries `http://localhost:6301` (re-typed, noted here; the run itself used that URL as archipelago-walk.txt shows) | evidence/island-1-run.log |

Checks rerun: `pnpm vitest run tools/test/prototypes-status.test.ts` (12 passed), `pnpm typecheck`, the soup action script at 1280 and 375, `public-a11y.spec.ts -g soup` (5 passed). No physics, RULE_VERSION or golden pin was touched.

### Follow-up review of the fixes (review-sol-fixes.txt)

| Finding | Disposition |
|---|---|
| P2 sweep validation accepted 404 on any works route and ignored errors at that status | Fixed: the not-found route must be 404 (one console line allowed), every other works route 200 with no console error; negative cases for both directions added |
| P3 duplicate sweep captures hid failures | Fixed: exactly one capture per route and width; negative case added |
| P3 all ten skips attributed to the not-found spec | Fixed: nine not-found guards plus one public-routes build check, in md, html and W49 |

12 tests pass after the fixes; `pnpm typecheck` clean.
