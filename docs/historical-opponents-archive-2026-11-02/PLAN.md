# I03c Archive tournament (historical-opponents, second rung). Slice plan v2 (after Codex plan review, see REVIEW.md)

Status: PLAN stage, revised 2026-11-02 after the Sol 6.1 xhigh plan review (13 findings, dispositions in REVIEW.md). v2 is a DESCRIPTIVE tournament of related surviving elites; it makes no confirmatory historical-improvement claim. Branch `claude/i03-archive-tournament` from `origin/main` 0bdd7a70. Source: "I03" in `docs/simulation-research-2026-11-01/report.md`; first rung in `docs/historical-opponents-2026-11-01/` (PR #139, merged here). Coordinator decisions D1, D3. CPU only (sim-ref), no GPU evidence, not the M3 environment, no paid calls, no deploy.

## 1. Bounded question

Take genomes from an archive sampled at fixed times from existing search histories, and play each later snapshot against each earlier snapshot in the first rung's CPU pairwise arena (balanced start, reciprocal positions, mutation off, genome-only standard inoculum). Does the archive show (a) directional improvement against the past, (b) cycling (a confirmed A>B>C>A), (c) a strength ordering that is not aligned with time, or (d) nothing beyond the nulls?

Caveat stated everywhere: the archive "time" is the bootstrap search's **batch index** (`born` in `runs/*/archive.json` is the batch number passed to `Archive.offer` in `tools/bootstrap.ts`; observed ranges 8-79, 5-297, 5-79), not ecological time and not an evaluation count. Archives are the FINAL surviving elites (one per MAP-Elites cell, chosen by replacement), not snapshots captured at fixed historical times, and later elites are bred from earlier members, so snapshots are neither independent nor exchangeable. The sources are related histories (all three record search seed 1; byte-identical elite records recur across them), not independent replications. Every statistic below is therefore descriptive: it ranks how selected survivors relate in this arena. There is no confirmatory test, no multiplicity-corrected claim, and no inference to open-ended evolution. The search optimised survival, recovery and light dependence, not arena competition, so "later beats earlier" here is a statement about that search under this arena, not about open-ended evolution. A negative result is a valid, shippable result. The arena is also not an M3 environment; payoffs are biomass share at step 300 on a 32x32 tile.

## 2. What is built (one PR)

1. **Frozen archive fixture** `tools/opponents/archive-config.json` + `docs/historical-opponents-archive-2026-11-02/archive.json`. Selection is a pure function of committed inputs: for each source `runs/<name>/archive.json` (read-only from the main checkout via `RUNS`), horizon `H = max(born) + 1` batches (recorded in the fixture), `K = 5` bins of equal width over `[0, H)`; snapshot of a bin = the elite with the highest `quality` whose `born` lies in the bin and whose genome passes the viability screen (solo biomass at step 300 above the floor on **screen seeds 901..903**, disjoint from search seeds 1..300, the first rung's calibration 1..3 and confirmation 101..110, and the scoring seeds), ties by `cell` then `born`. A bin with no viable elite is recorded `empty`; a source with fewer than 4 viable bins is dropped (`dropped` is a recorded outcome, not an error). The archive is the final survivor set, so late bins may be sparse; empty bins are expected and reported. Byte-identical genomes shared across sources are flagged `shared-genome`, and a source whose snapshots are all shared with an earlier source is dropped. Sources in frozen order: `bootstrap-m3`, `bootstrap-200`, `bootstrap-div`. Compatibility is a decidable gate, not a log read: each genome must decode and pass `validateConfig`/`validateState` inside the arena config (word length, layout, bounds), and the differences between the source search config (uniform light, amplitude 160, default mu/sigma 60/20) and the arena (gradient light, amplitude 200, 154/24) are recorded in the fixture as transfer conditions. `bootstrap-200` records a legacy resume with `exact:false`; recorded as a caveat. Each snapshot is stored as genome hex (the first rung's format) with source name, source file SHA-256, cell, born, quality. No pooling of payoffs across sources and no pooled p.
2. **Evidence fixtures with negative cases that fool the naive metric** (pure-function plus in-world), in `packages/metrics/src/archive-tournament/index.ts`:
   - Naive metric = fraction of (later, earlier) snapshot pairs where the later one has payoff > 0.5.
   - `cycle-fools-naive`: a 3-snapshot synthetic matrix A<B<C<A (times 1,2,3). Naive: 2 of 3 pairs "later wins" (0.67, reads as improvement). Sealed rule: the cycle flag is raised (the K=3 permutation floor is 1/6, so this fixture validates the cycle flag and the descriptive-rank rule, not significance rejection). A second 5-snapshot synthetic `long-cycle-fools-naive` has no triangle (edges A>B>C>D at .9, D>A at .56, E beating all at .8, chronological order D,C,B,A,E, raw rank 1/120) and must raise the cycle flag through the general directed-cycle detector, because the first rung's `findCycles` is triangles only.
   - `vigour-only` (synthetic): five snapshots with solo strengths 1..5 and every payoff `V_i/(V_i+V_j)`, aligned with time. Raw rank is 1/120 and the vigour residual is zero everywhere, so the sealed label must be `directional-vigour-only`, never `directional-rank`.
   - `strength-not-time` (planted; exact genomes and time assignments frozen in `archive-config.json` before scoring): the first rung's panel genomes with their committed pairwise matrix, once in strength order and once in a frozen scrambled order. Before freeze the implementer computes the exact rank of every candidate order from the committed first-rung matrix and freezes a scrambled order with rank above 0.20 (the review showed `W,F3,F2,G,F1` gives 2/120 and must not be used). The sealed rule must call the scrambled one `ordered-not-temporal` and the aligned one `directional-rank` (or `directional-vigour-only` when its residual is not also aligned). The pure-matrix version is the gate; any in-world rerun is descriptive. This is the time-shuffled null the naive metric passes.
   - `planted-chain` (in-world positive control): the first rung's calibrated G and W instrument genomes and graded mixtures calibrated and frozen in `archive-config.json` with solo viability recorded; times in order. Must be `directional-rank`. Weakening of arbitrary archive genomes is descriptive only: the edit scales one generalist-specific weight toward zero and can leave a negative-weight genome less impaired (the review found this for `bootstrap-200` cell [4,1]).
   - `rps-synthetic` and a transitive matrix reuse the first rung's `findCycles` fixtures. The cycle graph for archive verdicts is built from `PairSummary.edge` (first rung's full confirmation rule: every retained block on one side, at least 9 retained blocks, corrected significance, effect threshold), not `edgesFromPayoffs` mean offsets, and cycles are found by a general directed-cycle detector (new, in the archive library) that agrees with `findCycles` on triangles.
3. **Controls inherited from the first rung, re-run on this archive's arena config** (same `tile 32, radius 3, steps 300`, same floor rule): identical-genome swap (a snapshot against itself under two labels: exact label invariance by integer identity, position effect below the first rung's effect target, sign-flip p > 0.05), weakened-copy (the first rung's calibrated G vs weakened-G instrument control is re-run once as the gate; the 50%-weakened copy of each source's latest snapshot is a descriptive extra with its solo viability reported, not a verdict gate), starved arena (the first rung's depletion override on one archive pair: both labels below the floor, class `both-floor`, never read as a tie).
4. **Small CPU path.** Library `packages/metrics/src/archive-tournament/index.ts` (placed outside `packages/metrics/src/opponents/` because `tools/opponents/assay.ts` enumerates every file in that directory and `--check` rejects additions absent from the frozen first-rung manifest; about 350 lines: snapshot selection and viability screen, schedule, directional statistic, exact permutation null, tournament summary, verdict table). It imports `runJob`, `buildContestWorld`, `contestConfig` from `arena.ts`, and `blockPayoff`, `summarizePair`, `signFlipP`, `tInterval`, `findCycles`, `edgesFromPayoffs`, `classify` from `payoff.ts`; it does not copy them. The first rung's sources (`opponents/*`, `boot.ts`, `worker.ts`, `calibrate.ts`, `config.json`, schema, sim-ref) stay byte-identical, so its `--check` still passes. The new library, CLI and config get their own manifest source list. CLI `tools/opponents/archive.ts` reuses `boot.ts` and `worker.ts` (jobs already carry `hexA/hexB`, so the worker needs no change). Same `--write`, `--check`, `--replay-check`, `--jobs N`, `--freeze-check` contract as `assay.ts`.
5. **Manifest and machine-readable evidence**: `evidence.json` (sealed canonical JSON, no timestamps or platform strings) and `manifest.json` (source hashes, archive file SHA-256, config, seeds, schedule, freeze commit).
6. **Local private page** `apps/lab/opponents/archive/index.html` with `apps/lab/src/opponents/archive/{page.ts,render.ts,style.css}`: per-source time-by-time payoff matrix (rows later snapshots, columns earlier, with interval and excluded counts), the directional statistic against its permutation null (histogram of the 720 permuted values with the observed one marked), the control strip (pass/fail per control, with the weakened-copy and starved-arena cells shown), and the naive metric next to the sealed one for every fixture, so a visitor sees where the naive reading is fooled. Link from `/opponents/` back and forth. Page reads `evidence.json` only and imports nothing from sim-ref. Private: covered by the first rung's Caddy rule `^/opponents(?:/|$)` and the `Dockerfile.site` `dist/opponents` removal; the new Vite chunk is named `opponents-archive` so the existing `assets/opponents-*` removal patterns catch it.

## 3. Design

### 3.1 Schedule and seeds (frozen before any outcome)
- Evidence seeds 1001..1010 (disjoint from search seeds 1..300 recorded in the sources, screen 901..903, first rung 101..110 and calibration 1..3). Reserve block B, seeds 2001..2010, used only if an analysis-affecting amendment follows the freeze. Balanced arm only (rare starts are known biased against the rare side, even for identical genomes, so they are not run).
- Per source with K snapshots: `K(K-1)/2 = 10` ordered pairs x 10 seeds x 2 positions = 200 contests; solo vigour per snapshot x 2 masks x 10 seeds = 100 runs; controls: twin 20, weakened copy 20, starved 20. About 360 runs per source; three sources plus planted-chain (6 pairs, 120 contests) and strength-not-time (reuses the first rung's panel genomes, 10 pairs, 200 contests) is about 1500 runs. The first rung cost about 1.8 CPU-seconds per run (724 runs, 1290 CPU-s); expect about 2700 CPU-s, 6 to 12 minutes at 8 workers on a quiet machine. The 90-minute wall limit does not bound CPU (8 workers allows about 12 CPU-hours), so the budget is cumulative CPU: viability screen (about 450 s), write (about 2500 s), replay (about 2500 s), mini and regeneration tests, EVIDENCE bookkeeping; the CLI counts CPU-seconds per command and aborts past 3 CPU-hours for any one command and the slice records the total in `EVIDENCE.md` (target under 2 CPU-hours total). `uptime` is checked first and `--jobs` reduced when load > 40; replay-check may replay a frozen deterministic 25% sample of jobs plus full hash verification if the full replay would exceed the budget (recorded). Cut order if over budget: third source first, in-world strength-not-time rerun, then residual statistic.

### 3.2 Statistics
- Per ordered pair: block payoff, interval, sign-flip p, status `informative`/`uninformative`, exactly as the first rung (`summarizePair`, complete blocks only). Everything below is DESCRIPTIVE/exploratory. The only confirmatory gates are the instrument controls (twin, calibrated weakened copy, starved arena, planted chain, strength-not-time and cycle fixtures); there is no per-source significance test and no multiplicity claim, so the earlier Bonferroni problem (a 4-snapshot source cannot reach p below .05/3 since its minimum is 1/24) does not arise.
- Directional statistic `D` = mean over (later i, earlier j) pairs of `(payoff_ij - 0.5)`, informative pairs only, count reported. Descriptive rank `r_dir = #{D_perm >= D_obs} / K!` over every permutation of the K time labels over the snapshots (K! = 120 for K = 5, 24 for a 4-snapshot source; the identity counts itself, so the minimum is 1/K!). The permutation moves each snapshot together with its whole eligibility mask and pair outcomes, so informative-pair exclusion does not change the support. It is a rank against relabelled times, not a p-value: the selected, genealogically related archive is not exchangeable, so it is reported as `r_dir` and never called significant. The reverse tail `r_rev` is reported the same way. Sub-labels use thresholds frozen in config: `r_dir <= 0.05` is `directional-rank`.
- Edges for cycles use only `PairSummary.edge` confirmed edges (the first rung's full rule: every retained block on one side, at least nine retained blocks, corrected significance, effect threshold) and a general directed-cycle detector (any length), reported as a flag independent of the temporal label.
- Vigour residual (descriptive): solo-growth-predicted share vs observed, as in the first rung, so a "win" that is just general vigour is flagged; the directional statistic is also reported on the residual.

### 3.3 Verdict table (frozen, precedence in order; two separate outputs per source)
Temporal label (one per source, first match wins):
1. Any instrument control invalid (label invariance not exact, a run invalid, starved arena not `both-floor`) -> `control-invalid`.
2. Twin position effect fails or the calibrated weakened-copy control is not detected (all retained blocks below 0.5, mean <= 0.40, as in the first rung's thresholds, read from its `config.json`/evidence rather than restated) -> `insensitive-or-biased`.
3. Planted-chain not `directional-rank`, or `strength-not-time` scrambled not `ordered-not-temporal`, or `vigour-only` not `directional-vigour-only` (global, run once) -> `assay-failed`, no source label.
4. Any scheduled pair `uninformative` (denominator is all scheduled pairs, as the first rung's gate rejects any uninformative pair) -> `partial-tournament`, with the informative count; labels 5-7 are then computed on the informative pairs and flagged partial.
5. `r_dir <= 0.05`: if the vigour-residual `r_dir` is also <= 0.05 -> `directional-rank`; else `directional-vigour-only`.
6. A strength ordering exists (>= 3 `PairSummary.edge` edges forming a transitive order) but `r_dir > 0.05` -> `ordered-not-temporal`.
7. Otherwise -> `nothing-beyond-null`, stated as "none detected at this resolution", never "none exists".
Graph flag (independent): `cycle` when the confirmed-edge digraph has a directed cycle of any length, else `acyclic`; stated alongside the temporal label, never instead of it (a source can be `directional-rank` and `cycle`; the page says so).
Across sources: counts per label, no pooled rank. Related histories do not replicate one another; two sources agreeing is described as "similar in related searches", nothing stronger.

### 3.4 Freeze-before-run (D3 and the stage contract)
Files committed and pushed to the branch before any scoring, nothing from `evidence.json`/`manifest.json` in that commit: this PLAN, `archive-config.json` (sources, bin rule, K, seeds, floor, thresholds, verdict table version), `archive.json` snapshot fixture (selected hexes and hashes), the library and CLI code that defines the schedule and rules, and their tests on the fixtures. The viability screen uses screen seeds 901..903 only (not a scoring, calibration or search seed) and its outputs are inside the frozen `archive.json`. The freeze commit holds the PLAN, config, archive fixture, library, CLI and tests; the manifest records the freeze commit SHA and a frozen inventory (path -> SHA-256) of every scientific file (library, CLI, config, archive.json, and the first-rung files it depends on). `--freeze-check` verifies the commit is an ancestor of HEAD, that every inventoried file is byte-identical to that commit, and that no outcome files were in it; a test mutates one library line after a temp-repo freeze and the check fails. Any analysis-affecting amendment after outcomes exist requires fresh scoring seeds (block B) and marks the old result exploratory-superseded. Own Codex review (Sol 6.1, xhigh, read-only) of the freeze files happens before the freeze commit. Anything changed after the freeze is a dated amendment in `EVIDENCE.md`.

## 4. Files

Add:
- `packages/metrics/src/archive-tournament/index.ts` (not re-exported from `packages/metrics/src/index.ts`, like the first rung).
- `tools/opponents/archive.ts`, `tools/opponents/archive-config.json`.
- `docs/historical-opponents-archive-2026-11-02/{PLAN.md,REVIEW.md,EVIDENCE.md,archive.json,evidence.json,manifest.json}`.
- `apps/lab/opponents/archive/index.html`, `apps/lab/src/opponents/archive/{page.ts,render.ts,style.css}`.
- Tests (section 5).

Change (small): `apps/lab/vite.config.ts` input `opponentsArchive: r("./opponents/archive/index.html")` with the chunk named `opponents-archive`; one link each way between `apps/lab/opponents/index.html` and the new page; `tools/test/deno-no-lock.test.ts` untouched. `Dockerfile.site` and `deploy/Caddyfile` need no edit if the packaging test shows the existing patterns cover the new paths; otherwise add the one missing pattern.

Not touched: `packages/sim-ref`, `sim-gpu`, `schema`, `RULE_VERSION`, `golden-hashes.test.ts`, `defaultConfig()`, `experiments/*`, the first rung's evidence/manifest/config (read only; the first rung's `--check` must still pass), coordinator, I01, gene-v2.

## 5. Tests (vitest, named cases)

`packages/metrics/test/opponents-archive.test.ts`
- `snapshot selection is deterministic and respects bins`: fixed mini archive JSON, ties and empty bins.
- `source dropped when fewer than 4 bins viable`.
- `naive metric is fooled by the 3-cycle`: naive 0.67, cycle flag raised. `long-cycle` fixture flags a cycle that `findCycles` misses. `vigour-only` is `directional-vigour-only`. `strength-not-time` scrambled order has rank above 0.20.
- `time-shuffled null: all K! permutations enumerated, identity counted once, min rank = 1/K!, eligibility mask moves with the snapshot`.
- `directional statistic is 1.0-aligned on a constructed transitive matrix and unaligned after scrambling`.
- `strength-not-time classifies aligned directional and scrambled ordered-not-temporal` (pure matrix).
- `verdict table precedence is exhaustive` (every control/planted/eligibility/cycle combination).
- `uninformative pairs are excluded and counted, never read as 0.5`.
- `no pooled rank or p across sources`; `shared genomes across sources are flagged`; `born binning uses batch index (regression on the real archive ranges)`.
- `first rung --check still passes with the new library present` (assay.ts source enumeration unaffected).
- `seeds are disjoint from search 1..300, screen, first-rung and calibration seeds`.
- `schedule counts match config` (200 contests per source, solo, controls).
- `planted-chain in-world mini (T=60, 2 seeds) orders by weakening` and `twin snapshot swap is exact` (small real arena runs, reusing `runJob`).

`tools/test/opponents-archive-evidence.test.ts`
- `evidence seal and manifest verify` (`--check` returns no problems; no timestamps/platform strings; statements include "CPU only", "no GPU evidence", "not the M3 environment", "archive time is search time").
- `tampered payload, manifest, archive fixture or source is rejected`; `resealed but inconsistent payload is rejected`.
- `verdict in evidence equals the verdict recomputed from stored gates`.
- `freeze-check passes on the real branch and fails when an outcome file is in the freeze commit or an inventoried code file changes` (temp git repo fixture).
- `worker count does not change output` (mini config at `--jobs 1` and `3`, byte equal); `mini regeneration equals itself`.
- `archive fixture hexes decode and match source file SHA-256 when RUNS is present` (skipped with a stated reason when `runs/` is absent, since CI has no runs/).

`apps/lab/test/opponents-archive-packaging.test.ts`: Vite input present, Caddy private route matches `/opponents/archive/` and `/OPPONENTS/archive/index.html`, Dockerfile removal covers the dist path, page text carries "CPU only", "no GPU evidence", "noindex", a captioned table. `apps/lab/test/opponents-archive-render.test.ts`: matrix numbers equal the table; `uninformative` is its own state; naive and sealed metrics both shown per fixture; permutation histogram observed marker matches evidence; text says synthetic for the cycle fixture. `tests/e2e/opponents-archive.spec.ts` (Playwright, `BL_E2E_PORT=5331`): page loads from the committed evidence, no console errors, no horizontal overflow at 375 px, screenshots at 1280 and 375 saved to `docs/historical-opponents-archive-2026-11-02/` and read.

## 6. Acceptance gates (runnable)

```bash
export PATH=~/.nvm/versions/node/v24.2.0/bin:$PATH
cd /Users/nicholas/develop/browser-life-i03-archive-tournament && pnpm install && pnpm typecheck
pnpm vitest run packages/metrics/test/opponents-archive.test.ts tools/test/opponents-archive-evidence.test.ts apps/lab/test/opponents-archive-packaging.test.ts apps/lab/test/opponents-archive-render.test.ts
pnpm vitest run packages/metrics/test/opponents.test.ts tools/test/opponents-evidence.test.ts   # first rung unchanged
node tools/opponents/assay.ts --check                       # first rung still verifies
node tools/opponents/archive.ts --freeze-check              # freeze commit is an ancestor, fixtures unchanged, no outcomes in it
RUNS=/Users/nicholas/develop/browser-life/runs node tools/opponents/archive.ts --check   # source-hash check skipped with a stated reason when RUNS is absent
time node tools/opponents/archive.ts --replay-check --jobs 8   # byte-equal regeneration, bounded as 3.1
pnpm vitest run packages/sim-ref/test/golden-hashes.test.ts experiments/test/prereg-sync.test.ts
BL_E2E_PORT=5331 npx playwright test tests/e2e/opponents-archive.spec.ts --project=chrome
pnpm test
git diff --stat origin/main -- packages/sim-ref packages/sim-gpu packages/schema experiments docs/historical-opponents-2026-11-01   # must be empty
```
Plus: freeze commit pushed before `--write`; `evidence.json` verdicts recorded whatever they are; Codex Sol 6.1 xhigh read-only reviews of the freeze files and of the final source.

## 7. How to try it

```bash
export PATH=~/.nvm/versions/node/v24.2.0/bin:$PATH
cd /Users/nicholas/develop/browser-life-i03-archive-tournament
pnpm install
pnpm dev -- --port 5321 --strictPort
# open http://localhost:5321/opponents/archive/   (linked from /opponents/); private, noindex, local only
node tools/opponents/archive.ts --check              # verify saved evidence, no simulation
RUNS=/Users/nicholas/develop/browser-life/runs node tools/opponents/archive.ts --replay-check --jobs 8   # regenerate and compare, minutes
```
On the page: pick a source to see its later-versus-earlier matrix; read the directional statistic against its permutation null; open the control strip (identical swap, weakened copy, starved arena); open "where a naive metric is fooled" to see the cycle and strength-not-time fixtures with both numbers side by side.

## 8. Non-goals and limits

- No evolving against an archive, no recent-only/fixed-panel/mixture comparison, no withheld-opponent generality, no whole-patch or ecological-context transfer, no predation or reproduction claim, no open-endedness claim.
- Archive time is search evaluation index; archives are surviving elites, not a full history; sources are three search runs, so intervals are wide and "nothing" means none detected at this resolution.
- Biomass share at step 300 in a small CPU arena with a single chemistry; balanced arm only; no GPU or physical-hardware evidence.
- No physics, schema, preset, `RULE_VERSION` or `defaultConfig()` change; no new `WorldConfig` keys; no paid calls, AWS, deploy; the plan stage commits nothing.
- If scope must shrink, cut in this order: third source, `strength-not-time` in-world version (keep the pure matrix), the Playwright spec (keep render tests), residual-based statistic.

## 9. Order of work

1. Library with pure functions and tests (selection, permutation null, verdict, fixtures). 2. Snapshot selection and viability screen from `RUNS` into `archive.json` and `archive-config.json`. 3. CLI (`--freeze-check`, mini config). 4. Codex review of freeze files, fix, commit only freeze files, `git push -u origin claude/i03-archive-tournament`. 5. `--write` the evidence, `--replay-check`. 6. Page, packaging edits, render and e2e tests, screenshots. 7. `EVIDENCE.md` (result, deviations, cost), full gates, Codex source review.

## v3 pre-freeze amendment (2026-11-02, IMPLEMENT stage, before any scoring seed was run)

Made after chain calibration on screen seeds 901..903 only (`chain-calibration.json`, 7 trials) and before the freeze commit. No scoring seed (1001..1010) had been run.

1. **Planted-chain gate (section 2.2 and verdict row 3).** v2 required the planted chain to be `directional-rank`. Six of seven calibration trials reached `r_dir` at the K=4 floor (1/24; the seventh, `[70,45,20,0]`, was 2/24 and `nothing-beyond-null`) and none had an aligned vigour residual (residual ranks 0.29 to 0.67), because the planted manipulation (a weakened photosynthesis weight) is a vigour manipulation by construction. The gate is now: planted chain is `directional-rank` or `directional-vigour-only` (it must be directional; the vigour split is gated by the `vigour-only` fixture). Selected chain: weakening percents `[80,60,40,0]`, time in ascending strength.
2. **Stated consequence.** No fixture or control reaches `directional-rank` (strength-aligned on the first rung's panel is also `directional-vigour-only`, residual rank 0.092). The top label has no positive control; a real `directional-rank` verdict would be unvalidated and is recorded as a limit in the evidence.
3. **strength-not-time in-world rerun is cut** (allowed by section 8's cut order); the pure-matrix fixture on the first rung's committed matrix is the gate. Scrambled order frozen in `archive-config.json`: `F3,F2,G,F1,W` (rank 0.25, naive later-wins fraction 0.7, ordered-not-temporal).
4. **Vigour residual directional statistic** uses centre 0 (later minus earlier residual), not 0.5; implemented in `permutationRank(m, centre)`.
5. **Selection outcome** (screen seeds 901..903, 13 genomes screened, all passed): all three sources kept with five viable bins each (`bootstrap-m3` horizon 80, `bootstrap-200` horizon 298, `bootstrap-div` horizon 80). The first-ranked elite of bin 2 of `bootstrap-m3` is byte-identical to bin 0 of `bootstrap-200` and bin 2 of `bootstrap-div` (flagged `shared-genome`; none of the three sources is wholly shared, so none is dropped). Elite `quality` is saturated near 1.0 for most elites, so ties (broken by cell then born) decide many bins.
6. **Ordering of "ordered" strength**: `ordered` means no directed cycle among confirmed edges and at least 3 confirmed edges (a topological strength order exists).
7. **Review-driven changes before freeze (Sol xhigh freeze review, 8 findings)**: the freeze inventory now includes `stats.ts`, all schema and sim-ref sources, PLAN.md and chain-calibration.json; `--check` verifies freeze provenance (ancestor, inventory, manifest commit); `--replay-check` runs the full saved-evidence and freeze verification before any simulation and refuses without evidence; the planted-chain gate requires every scheduled chain pair informative; viability flags in `archive.json` are recomputed from the recorded counts; test-only seeds 7001, 7002 replace the reserved scoring seeds in pre-freeze tests.
