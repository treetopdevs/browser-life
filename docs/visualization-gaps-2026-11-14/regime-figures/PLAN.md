# regime-figures: put the Stage 0 and calibration pictures on the regime-meters page

Branch `claude/viz-regime-figures` (from local `claude/3d-regime-meters` e9aab367; local only, D8: no push, no PR). Stage: PLAN. Decisions that apply: D5 (the coordinator commits, this slice leaves uncommitted changes), D8 (local branch), D9 (draw from the two committed TSVs because `runs/regime/regime-results.json` is not on this machine).

## What a person can see after this slice

Open `docs/3d-regime-meters-map.html` (rebuilt with one new flag) and find a new section, "Stage 0 run 1 (pilot, candidate closed)", between the gate and the map. Today the page has no figure of the two things the closed candidate actually produced:

1. **Damage spread, eight small panels.** For each of the four Stage 0 worlds (2D spots-m3, 2D gradient-m3, slab mu30/sigma8/k256, slab mu60/sigma8/k1024) and each of the two rungs (P1, P2): damaged blocks (net decider counter) at 30, 100 and 1,000 steps after the kick, one thin line per job for the S twin and for the frozen F pair, and the U twin as single markers at step 30. Log-log axes, direct series labels, light and dark. The point of the picture: F (the "frozen, should stay ordered" control) still spreads to hundreds of blocks in P1, which is why the rule's frozen-control check failed.
2. **Calibration heat grid.** From the rung 1b M4 run: living fraction at 50,000 steps for all 60 settings (mu 20..60 by sigma 8..20, three panels for lightK 256/1024/4096), each setting split into its three seeds, in classes (extinct, under 1%, **1 to 50% = the pick rule's living band**, 50 to 85%, carpet 85% and over). Caption states "0 of 60 settings qualify: none qualifies".
3. Under each figure, the numbers as a table in a collapsed `<details>` with a visible summary line (all 36 and all 180 rows, every column), so nothing is only in colour.

Every figure sits under a banner: "Pilot numbers on development seeds 9001-9003, not results. Candidate 8 closed at Stage 0 (STAGE0-CLOSED, 2026-10-24); the rule was never frozen." Nothing is called a result, a finding or a measurement of the slab's regime.

## Verified against the worktree (and where the planning section is wrong)

Checked by reading the files:

- `regime-stage0-run1-damage.tsv` has **36 rows = 18 jobs x 2 rungs (P1, P2)**, not "36 jobs". Columns: `job rung living_fraction liveblk_T S_30 S_100 S_1000 F_30 F_100 F_1000 U_30` (11 columns, every row has 11). Header comment (line 1) says development seeds 9001-9003, "pilot numbers, not results", counter = n_blk, index = step.
- **The U twin has only step 30.** The planning text's "three series at three steps" is wrong for U: there are 7 recorded values per row (S x3, F x3, U x1), so 252 values in all. The figure draws U as a single marker and says why (no U_100 or U_1000 were recorded). Nothing is interpolated.
- Some values are **0** (U_30 and F_1000 in several rows). A log axis cannot place 0, so zeros are drawn on a labelled "0" strip under the axis. They are still counted as points.
- Job groups (rows): 12 `dev-2d-spots-m3` and 12 `dev-2d-gradient-m3` (6 jobs each: seeds 9001-9003 x t50000/t100000, 2 rungs), 6 `dev-slab-mu30-s8-k256` and 6 `dev-slab-mu60-s8-k1024` (3 jobs each, 2 rungs). So 2D panels hold 6 job lines per series, slab panels 3.
- `m4-results.tsv` has **180 rows = 60 settings x seeds 101-103**, 15 columns including `livingFrac` (at 50,000 steps), `extinctAt` (blank or step; 28 rows extinct) and `lightRatio7to0`. Grid: mu {20,30,40,50,60} x sigma {8,12,16,20} x lightK {256,1024,4096}.
- **The "qualifying threshold" is not in the rule file.** It is the rung 1b M4 pick rule in the headers of `m4-calibrate.ts` and `m4-pick.ts`: a setting qualifies iff all 3 seeds end with 1% <= living <= 50% **and** 5% <= light(layer 7)/light(layer 0) <= 80%. `m4-pick-output.md` ends `PICK: none qualifies`. By recomputation, 10 of 180 seed runs are inside the living band and 0 of them also meet the light condition (so 0 settings qualify). The figure marks the 1 to 50% band and states the light condition in words and in the table column (it is a second condition the heat colours do not show).
- `readM4Tsv` in `regime-html.ts` keeps only `extinctAt, living, livingFrac, trace` keyed by setting and drops `lightRatio7to0`, so the new code parses the TSV itself and leaves `readM4Tsv` untouched.
- `docs/3d-regime-meters-map.html` is the **SYNTHETIC** page (title "Regime meters map (synthetic)"). It is built by `htmlMain --synthetic`, takes about 26 s, and a rebuild here is byte-identical to the committed file (checked with `cmp`). So the real-data path cannot be "rebuild from results"; the new section is an add-on and the synthetic page is the host. This matters for labelling: the new section carries its own banner so a reader cannot take the synthetic banner's wording as covering it, nor the pilot data as covered by "synthetic".
- Labelling code: `pageLabel()` (synthetic / draft / result, refusals with exit 2) is untouched. The new flag is applied after the label is computed and cannot change it.
- `pnpm typecheck` does not include `experiments/` (include is `packages/*/src`, `apps/lab/src`, `apps/lab/test`, `tests`); `experiments/test/*.test.ts` run under vitest. The new Playwright spec lives under `tests/e2e` and so is typechecked. The regime builder is Deno-run but imports with `.ts` extensions and node builtins, and the vitest suite already imports it, so the new module follows the same style.

## What is built

**`experiments/3d-slab/regime-stage0-figures.ts` (new, pure, no I/O except two small file readers).**
- `parseDamageTsv(text)`: strict. Header line starting `#` is kept as the provenance note; column line must equal the 11 names exactly; every row 11 fields; integers (and `living_fraction` decimal); rung in {P1,P2}. Any deviation throws `ReaderError` (exit 2).
- `parseCalibrationTsv(text)`: strict on the 15 columns; needs mu, sigma, lightK, seed, livingFrac, extinctAt, lightRatio7to0.
- `calibrationSummary(rows)`: groups to settings, applies the M4 pick rule as written in `m4-pick.ts` (not new logic, same thresholds) and returns qualifying count, seed runs in band, extinct count.
- `damageFigureHtml(rows)`: 8 inline SVG panels (grouped by world prefix and rung), `data-pt="S|F|U"` on every drawn value (also zero-strip ones), `<title>`/`<desc>`, `role="img"`, direct end labels "S", "F" and "U (step 30 only)", axis titles ("steps after the kick, log scale", "damaged blocks, log scale"), tick labels 30/100/1,000 and 1/10/100/1,000.
- `calibrationFigureHtml(rows)`: 3 SVG panels (one per lightK); a cell is a 5 (mu) x 4 (sigma) grid position split into 3 seed stripes with a class fill, an extinct stripe hatched and a band stripe outlined (shape plus colour, not colour alone), `data-seed-run` on each of the 180 stripes, a legend, and the stated outcome "none qualifies" computed from the data.
- `stage0SectionHtml(damageText, m4Text)` composes the section: banner, the two figures, the two `<details>` tables, a sources paragraph naming the two TSVs and `regime-rule-closed.md` (rule draft SHA-256 0bed3086..., never frozen), a plain "How to read this" per figure (what an axis is, what a series is, what is not shown).
- `STAGE0_CSS`: tokens for the three series and the five classes defined on `:root` with `prefers-color-scheme: dark` guarded by `:root:not([data-theme="light"])` and again under `:root[data-theme="dark"]`, matching the page's existing theme mechanism (its Night button keeps working). Series are told apart by shape and dash as well as colour. Layout: panel grid `repeat(auto-fit, minmax(260px, 1fr))`, SVGs `width:100%` from a viewBox, no horizontal page scroll at 375 px.

**`experiments/3d-slab/regime-html.ts` (small edit).**
- `PageInput` gets optional `stage0?: string` (the section html); `buildPage` inserts it after `gateHtml(r)` and adds `STAGE0_CSS` to the `<style>` only when present. With it absent, output is byte-identical to today (gate below).
- `htmlMain` accepts `--stage0-figures` (flag; reads `experiments/3d-slab/regime-stage0-run1-damage.tsv` and `m4-results.tsv` under `--root`, overridable with `--stage0-damage=FILE`, `--m4=FILE`). It works with either `--synthetic` or `--results=`; with `--results` the existing refusal rules run first, unchanged. Missing or malformed TSV gives exit 2 and no page written.
- Usage text and header comment gain the flag and one sentence on the labelling.

**`docs/3d-regime-meters-map.html` (rebuilt)** with `--synthetic --stage0-figures`.

**`tests/e2e/regime-figures.spec.ts` (new).** Serves the built page through `page.route` / `route.fulfill` on a fake origin (Playwright blocks file://), records every request to prove no network, checks both figures and tables, then takes the four screenshots.

**Evidence (committed with the slice):** `docs/visualization-gaps-2026-11-14/regime-figures/evidence/regime-{1280,375}-{light,dark}.png` and `REVIEW.md` (Codex notes, filled in later stages).

## Tests (named cases)

In a new `experiments/test/regime-stage0-figures.test.ts` (sibling, so the 1,674-line existing file stays as is), plus one case added to the existing page describe in `regime-readout.test.ts`:

1. `parses the committed damage TSV: 36 rows, 18 jobs, 2 rungs, 11 columns, U has only step 30`.
2. `parses the committed calibration TSV: 180 rows, 60 settings, 28 extinct`.
3. `damage figure: one point per recorded value (252 data-pt marks = 36 rows x 7), 8 panels, per-series counts S 108 / F 108 / U 36, zero values drawn on the zero strip and counted`.
4. `damage figure: no interpolation, each series line has exactly its recorded vertices (3 for S and F, none for U)`.
5. `damage figure: labels present (axis titles, "log scale", S/F/U labels, pilot banner text, "not results", "STAGE0-CLOSED", seeds 9001-9003) and no word "result" used as a label (no "RESULT" chip)`.
6. `calibration figure: 180 seed-run stripes = row count, 3 panels, class legend, the pick-rule band 1 to 50% named, outcome sentence "none qualifies" present and derived (summary says 0 of 60 settings qualify, 10 seed runs in band, 0 with the light condition)`.
7. `calibration summary agrees with m4-pick-output.md (the PICK: none qualifies line) and with an independent recomputation of the pick rule from the rows`.
8. `accessibility: every svg has role=img and a title; both tables carry every row (36 and 180 data rows) and every column`.
9. `deterministic: two builds of the section are identical; two full page builds with the flag are byte-identical`.
10. `malformed inputs are refused: wrong header, short row, non-numeric, unknown rung give ReaderError / htmlMain exit 2 and write no file`.
11. In `regime-readout.test.ts`: `buildPage without stage0 is unchanged and with it only adds the section`: the synthetic page built without the flag is byte-identical to the committed docs page; with the flag the old page is a prefix/suffix-preserving superset (removing the inserted section and CSS gives the old bytes); `pageLabel` refusals (frozen-hash cases already tested) still return exit 2 with the flag present, and no page is written.
12. `htmlMain --synthetic --quick --stage0-figures` writes a page whose label is still "synthetic" and whose title still says so.

## Acceptance gates (runnable)

```bash
export PATH=~/.nvm/versions/node/v24.2.0/bin:$PATH
cd /Users/nicholas/develop/browser-life-viz-regime-figures
pnpm vitest run experiments/test/regime-stage0-figures.test.ts experiments/test/regime-readout.test.ts   # rerun alone or --maxWorkers=2 if load makes the long reader tests time out
pnpm typecheck
deno run -A --no-lock experiments/3d-slab/regime-html.ts --synthetic --out=<scratch>/old.html && cmp <scratch>/old.html <committed copy before the edit>   # no-flag output unchanged
deno run -A --no-lock experiments/3d-slab/regime-html.ts --synthetic --stage0-figures      # rebuilds docs/3d-regime-meters-map.html
deno run -A --no-lock experiments/3d-slab/regime-html.ts --synthetic --stage0-figures --out=<scratch>/b.html && cmp <scratch>/b.html docs/3d-regime-meters-map.html   # byte-identical rebuild
BL_E2E_PORT=5264 npx playwright test tests/e2e/regime-figures.spec.ts --project=chrome        # screenshots; then READ the four PNGs
git status --short   # only the files listed below changed; golden pins, RULE_VERSION, model.ts copies untouched
```

Done means: the four PNGs were read and the panels, labels, zero strip, band marker and banner are legible in light and dark at 1280 and 375; the page makes no network request; the existing tests are green.

## Files

Add: `experiments/3d-slab/regime-stage0-figures.ts`, `experiments/test/regime-stage0-figures.test.ts`, `tests/e2e/regime-figures.spec.ts`, `docs/visualization-gaps-2026-11-14/regime-figures/{PLAN.md,REVIEW.md,evidence/*.png}`.
Change: `experiments/3d-slab/regime-html.ts` (optional section, flag, usage), `experiments/test/regime-readout.test.ts` (cases 11 and 12), `docs/3d-regime-meters-map.html` (rebuilt).
Untouched: `packages/*`, golden pins, `RULE_VERSION`, `apps/lab/src/*/model.ts`, the damage and M4 TSVs, `regime-rule-closed.md`, `regime-readout.ts`, `docs/visualization-gaps-2026-11-14/PLAN.md`.

## Non-goals and limits

- No new data, no rerun, no smoothing, curve fitting, trend lines or interpolation between the three recorded steps. No claim that the slab is ordered, critical or chaotic.
- No world picture (no capture images exist; that is `slab-viewer`).
- No change to the rule, the reader, the meters, `pageLabel` or any refusal. The page is still the synthetic page; replacing it with a real-results page needs `regime-results.json`, which does not exist here.
- The heat grid shows the living-fraction condition only; the light-ratio condition is in the table and the caption, not the colours. Seeds are shown, not averaged.
- The damage series are n_blk counts of the net decider at 3 steps only; P2 rows for 2D worlds are as recorded in the TSV (job-level living fraction is per job, repeated on both rung rows, and is shown once per job in the table).
- Only the 18 dev jobs exist; no confidence intervals are drawn because three seeds are not enough to state any.
- Local branch only; nothing pushed, no CI.

## How to try it

```bash
export PATH=~/.nvm/versions/node/v24.2.0/bin:$PATH
cd /Users/nicholas/develop/browser-life-viz-regime-figures
deno run -A --no-lock experiments/3d-slab/regime-html.ts --synthetic --stage0-figures   # about 30 s
python3 -m http.server 5263 -d docs
# open http://localhost:5263/3d-regime-meters-map.html and scroll to "Stage 0 run 1 (pilot, candidate closed)"
# the Night button flips light and dark; narrow the window to about 375 px to see the one-column layout
```
