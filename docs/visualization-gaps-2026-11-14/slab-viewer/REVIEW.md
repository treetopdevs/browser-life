# slab-viewer: review record

## Plan review dispositions

Reviewer: Codex gpt-6.1-sol, xhigh, read-only. Raw output: `plan-review-raw.txt` (this folder; originals in the session scratchpad `slab-viewer/plan-review-final.txt` and `plan-review.log`). Verdict: revise before implementation. I checked findings 2, 13 and parts of 8, 11 against the files before accepting; all held. PLAN.md was revised in place.

| # | Sev | Finding | Disposition |
|---|---|---|---|
| 1 | P1 | Test 9 cannot build its CPU state: RPS PARAM1 bytes fail `validateState` | Accepted. Test 9 now pins a valid stock-ecology fixture through `RefSim3`; RPS mapping is covered by hand-built label tests and a real-GPU comparison (new test 20b). |
| 2 | P1 | Test 23 expects 0.5426 at step 5,000; TSV columns are steps 5,000, 10,000, ... (0.0419, 0.5426, 1.0) | Accepted and verified (`m4-calibrate.ts` traces every 5,000). Test 23 now checks 0.0419 at 5,000 and 0.5426 at 10,000 using `readStats().living` over 524,288; operating-point text and the "checks the 50,000-step picture" claim corrected. |
| 3 | P1 | Import path `../../../experiments` resolves to `apps/experiments` | Accepted. Path is `../../../../experiments/...` from `apps/lab/src/slab/`; the packaging test builds the real module. |
| 4 | P2 | Generation counter does not serialise overlapping creates; device ownership undefined | Accepted. One serial queue for create/advance/read/destroy, superseded creations destroyed, one device per page load reused; new test 24b (rapid changes). |
| 5 | P2 | Test 24 can pass with a wrong hand-over; batching can straddle step 6,000 | Accepted. Advancement split exactly at 6,000; state read before and after the rebuild must match; labels compared with a direct spike run in the page; straddling cases added. |
| 6 | P2 | No independent oracle for pictures and census | Accepted. Test 20b: debug-only raw snapshot hook, at least 200 sampled coordinates compared across layers after the layers have diverged (step 0 founding is identical per layer so cannot detect a reversal), per-layer counts from the raw snapshot, not the projection. |
| 7 | P2 | `lineagePixel` lacks nutrient `A`; JS `*` differs from u32 multiply | Accepted. Reuse `lineageRGB` from `@bl/metrics`, add `A`, test against `renderRGBA(..., "lineage")` including ids above 2^16 and varying `A`. |
| 8 | P2 | Removing `dist/slab` leaves slab bundles in `/assets/` | Accepted. Slab input added to the Vite build only under `BL_BUILD_SLAB=1`; default production build emits nothing for it; packaging test builds both ways; the `rm` stays as a backstop. |
| 9 | P2 | G3b may skip without a fresh build | Accepted. G3b runs `pnpm build` first with `BL_REQUIRE_BUILD_CHECK=1` and requests the private bundle URLs. |
| 10 | P2 | G4 compares against HEAD and does not assert hash equality | Accepted. Fixed base `7bb61be2...`, assertions that fail, and an allowed-file diff listing. |
| 11 | P2 | 128 option promises Amendment 1 ids but test 11 and limits disagree | Accepted. Provenance by full tuple; test 11 includes Amendment 1 and checks fields; "not recorded" otherwise. |
| 12 | P2 | `pnpm test` gate dropped without baseline | Accepted in modified form. The gate is kept; failures are listed, rerun alone and classified (pre-existing only if untouched file, no slab import, environment or data cause); recorded in EVIDENCE.md. A true baseline run is not possible without touching the tree (no stash or checkout allowed). |
| 13 | P2 | "Most life 0.998" and "empty only at mu 20" are false | Accepted and verified (removal/control rows reach 1; mu30 settings go extinct). Default justified by recorded two-seed coexistence; ecology outcomes described per full setting and seed. Also corrected the control row: 256 x 256 x 4 seeds were CHURN, 128 x 128 x 4 were LOSS, LOSS, CHURN. |
| 14 | P3 | String-length copy check, axe and overflow do not cover keyboard use or colour-vision claims | Accepted. Test 27 gains a keyboard-only pass at 375, `aria-describedby` association, and colour-vision simulations; test 14 notes that the real copy check is reading the page. |

No finding was rejected.

## Source review dispositions

Reviewers: `sol` = Codex gpt-6.1-sol, xhigh, read-only (`review-sol-src.txt`); `claude` = the in-session code review. All findings below were assessed against the code; each real one is fixed. Fixes are in `apps/lab/src/slab/{page,settings}.ts`, `tests/e2e/slab.spec.ts` and `tools/test/slab-packaging.test.ts`; no pinned file was touched.

| # | Sev | Reviewer | Finding | Disposition and evidence |
|---|---|---|---|---|
| 1 | P2 | sol | Stale readback painted after a restart (`sim.frame()` awaited without rechecking generation or simulator) | Fixed. `showFrame` and `advanceAndShow` capture the generation and the simulator before each await and drop the result if either changed (`current()`); errors from a superseded world are dropped by `queued()`. New e2e "a world switched mid-read is never painted under the new controls" reads a debug draw log: it fails with the guard disabled (a cyclic frame drawn under the ecology) and passes with it. |
| 2 | P2 | sol | Radio inputs replaced on change, losing keyboard focus and arrow navigation | Fixed. `radios()` remembers the focused option's value in its group and refocuses the rebuilt input. New e2e "arrow keys move through a radio group..." arrows the world group down and up and the kill group down, checking the focused, checked element each time. |
| 3 | P2 | sol | Layer oracle passes with duplicated or reversed layers; ecology oracle reads the frame it renders | Fixed. Samples now use the same (x, y) at every depth, and every pair of layers must differ both in the raw frame and in the pixels. Independent oracles added: cyclic labels at step 600 equal the spike's own harness path (`reference(600)`; the hook now also supports steps below the burn-in), and the ecology frame at step 400 equals a fresh stock simulator read with the raw readers, array by array (`ecoCompare`: B, P, A, hi, lo all `-1`, no differing cell). |
| 4 | P2 | sol | Ordinary e2e runs overwrite the recorded evidence PNGs | Fixed. The screenshot test writes to the Playwright output folder; `BL_RECORD_EVIDENCE=1` is needed to replace `shots/`. The ten recorded PNGs were not regenerated by this fix. |
| 5 | P3 | sol, claude | `#layer-out` stale after the depth clamp | Fixed. One `setLayer()` sets state, slider and readout together; used by the slider, the tile rebuild and the control rebuild. New e2e: ecology layer 7, then cyclic shows 3 in readout and slider. |
| 6 | P3 | sol | Ecology guidance promises a full carpet at about 15,000 steps for every setting | Fixed. The note now says this is the default setting on seed 101 and that other settings and seeds do something else, some staying nearly empty. |
| 7 | P3 | claude | "Half living" text says other seeds go extinct; `m4-results.tsv` shows mu30-s8-k256 at 0.4396, 0.4487, 0.5123 on seeds 101 to 103, none extinct | Fixed and checked against the table. Text now says 44 to 51 % living on all three seeds, no extinction. |
| 8 | P3 | claude | Empty seed field becomes seed 0; a fractional entry stays in the box | Fixed. Empty, fractional, negative and out-of-range entries are rejected and the box returns to the running seed. New e2e covers empty and 1.5. |
| 9 | P3 | claude | "Pictures match the raw GPU snapshot" compares with the page's own frame; every world is square | Fixed in part. The test is renamed to say what it checks and now adds the independent oracles of #3. No non-square world is offered (the recorded settings are all square), so an x/y swap on the real GPU path is caught by the independent reference comparison (different code path, same index convention) and, for the renderer, by the pinned CPU test on an 8 by 6 by 4 state in `slab-render.test.ts`. |
| 10 | P3 | claude | Caddy test's `/x/../slab/` is normalised by fetch, so it only duplicates `/slab/` | Fixed. Dot-segment, doubled-slash, escaped and mixed-case spellings are sent through a raw socket (`//slab/`, `/%73lab/`, `/./slab/`, `/slab/../slab/`, `/x/../slab/`, `/Slab/`); all answer 404. |
| 11 | P3 | claude | EVIDENCE check: pinned files untouched, three focused test files pass (105 tests), cited rows match the UI text | Confirmed clean; no change needed. Counts are re-run below. |

Known limit kept: a failed rerun of the recording screenshots (with `BL_RECORD_EVIDENCE=1`) can still leave mixed captures; the flag exists so that is a deliberate act.

## Follow-up review of the fixes (Codex gpt-6.1-sol, xhigh, read-only; `review-sol-fixes.txt`)

No P1. Four findings, all accepted and fixed; the stale-frame fixes were each mutation-checked (guard removed, test fails; guard restored, test passes).

| # | Sev | Finding | Disposition and evidence |
|---|---|---|---|
| F1 | P2 | Changing View or Layer after a world switch but before the queued rebuild redraws the cached superseded frame (`draw(last)`) | Fixed. `restart()` clears `last` at once, so the redraw handlers have nothing stale to draw. The mid-read test now also clicks "One layer" and moves the slider while the read is held; removing the `last = null` line makes it fail. |
| F2 | P2 | The `runTo` debug hook keeps advancing the old simulator and then calls `showFrame()`, which captures the new generation with the old simulator | Fixed. `runTo` captures generation and simulator at the start, stops advancing once superseded and paints only if still current. New e2e "a run-to in flight when the world is switched..." (crosses the 6,000-step hand-over); fails with the guards removed. |
| F3 | P2 | The mid-read test depended on a 40 ms timer, so it could pass with the guards disabled | Fixed. Debug-only `holdReads`/`releaseReads`/`held` hold a read open after its readback finishes; the test waits until `held() === 1` before switching world, so supersession is always exercised. Fails with `current()` forced true. |
| F4 | P3 | `reference()` ignored "Kill on from step 0" (always used burn-in settings) | Fixed. With the burn-in off the reference uses the run settings throughout. New e2e "kill on from step 0..." compares 300 steps of live labels with the reference. |
