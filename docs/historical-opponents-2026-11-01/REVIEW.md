# I03 review log

## Plan review dispositions

Reviewer: Codex gpt-6.1-sol, xhigh, read-only, 2026-11-01. Prompt: `/tmp/historical-opponents-2026-11-01-plan-review.md`. Raw review: `/tmp/historical-opponents-2026-11-01-plan-review.final.txt` (final message) and `/tmp/historical-opponents-2026-11-01-plan-review.out.txt` (full transcript). Overall verdict was "revise before implementation". PLAN.md is now v2. Every finding is accepted; none rejected.

| # | Sev | Finding | Disposition (PLAN.md section) |
|---|---|---|---|
| 1 | P2 | Reuse omits discovery.ts runner | Accepted in part. Founder specs adopt the `FixtureSpec` shape so contests port later; runner not reused because it needs a shared per-lineage observer and writes heavy per-case artifacts; step-0 spike records incompatibilities in EVIDENCE.md and may flip the decision (3.0, 9). |
| 2 | P1 | Reciprocal averaging makes twin gate tautological; ppm flooring gave 0.4999995 | Fixed. G1 split into exact label invariance (G1a) and pre-averaging position-bias test (G1b); gates use integer counts and float division, ppm is display only (3.2, 3.4, 3.5). |
| 3 | P1 | Rare ratio conflates position and abundance swaps; neutral rare share is not 0.5 | Fixed. Explicit arms: balanced, rare-A, rare-B with positions R1/R2; rare arms measured as change from the measured initial share; never averaged into the payoff; exploratory (3.1, 3.4). |
| 4 | P1 | Vigour residual does not isolate matchup advantage | Fixed by narrowing: solo arenas at identical masks; renamed descriptive monoculture residual with stated confounds; no gate and no separation claim; fixture is arithmetic only (1, 2.1, 3.4). |
| 5 | P1 | nutrient 0 does not force extinction | Fixed. Depletion arena chosen in calibration, G4 requires raw inventories of both labels below the floor, with a pure-classifier fallback that is disclosed (3.5, 3.7). |
| 6 | P1 | No valid inference contract; multiplicity; df after exclusion | Fixed. One confirmatory family (final checkpoint, balanced arm), exact sign-flip tests, S raised to 10 so edges can pass a 10-pair Bonferroni (n >= 9 required); t intervals descriptive with retained df; everything else labelled exploratory (3.4). |
| 7 | P2 | Exclusion breaks reciprocal balance; G3 denominator unspecified | Fixed. Complete-block eligibility, whole-block drop, 80% threshold, per pair/arm G3 at the primary checkpoint; asymmetric-exclusion fixtures (3.4, 3.5, 5). |
| 8 | P2 | Calibration can redefine success | Fixed. Predeclared grid (at most 36 settings), cost-ordered selection, all attempts committed in `calibration.json`, `FLOOR_FRAC` and thresholds frozen now, effect target (payoff <= 0.40) stated (3.7). |
| 9 | P2 | Genetic distance presented as strategy distinctness | Accepted. Renamed "genetically separated founders"; verdict wording narrowed (3.3, 3.5, 7, 8). |
| 10 | P2 | buildWorld does not plant constant inventories; ordering/overlap unfrozen | Fixed. Parameters not inventories, measured step-zero inventories as initial share, fixed full-slot founder array with emptied unused slots, non-overlap assertion, equality tests (3.1, 5). |
| 11 | P2 | `lowbias32(seed, slot)` wrong arity | Fixed. Single-argument salted combination with a test (3.1, 5). |
| 12 | P2 | Workers do not inherit the alias hook | Fixed. Worker bootstrap registers the hook first; Node subprocess test with VITEST unset (4, 5). |
| 13 | P2 | Verdict table incomplete; check trusts stored gates | Fixed. Exhaustive precedence table with `control-invalid`; `--check` recomputes summaries and gates from raw block records; resealed-inconsistent test (3.5, 5). |
| 14 | P2 | Scope cuts do not reduce cost | Fixed. Full job schedule (~750-800 runs), runtime explicitly not assumed met, cut order removes jobs (3.7, 8, 9). |
| 15 | P2 | D12 absent; D10 ordering; D7 rebase | Accepted. D12 text unverifiable in this checkout and noted; no I02 dependency; D7 rebase/revalidation step added (header, 6). |

Open item for the coordinator: the actual text of D12 was not available in the worktree copy of the decision log.

## Source review dispositions

Findings from the Codex Sol 6.1 xhigh source review (`review-sol-src.txt`, reviewer "sol") and a second reviewer ("claude"). All were assessed against the code; every one was real. The saved raw runs are unchanged (the simulator, arena and config were not touched); evidence.json and manifest.json were rebuilt from them with the corrected aggregation, seal `85fe724c...dbdef`. Tests named below are in `packages/metrics/test/opponents.test.ts` (M), `tools/test/opponents-evidence.test.ts` (T) and `apps/lab/test/opponents-render.test.ts` (R).

| # | Sev | Reviewer | Finding | Disposition and evidence |
|---|---|---|---|---|
| 1 | P2 | sol | `cellView`/`expectedShare` orientation: reversed cells used row order for solo masks | Fixed. `expectedShare` derives the prediction in canonical pair order and complements for a reversed cell. R: "the solo expectation is derived in canonical pair order" (A m01 3000/m23 1000: 0.75 for A|B at position 1, 0.25 for B|A; residuals -0.25 and +0.25). |
| 2 | P2 | sol | G3 ignored incomplete rare-arm blocks | Fixed. `evaluateGates` adds every enabled arm whose invasion class is `uninformative` (fewer than ceil(5/6 n) complete blocks) to `uninformativePairs`, so G3 fails. M: two both-floor runs in different rare-A blocks (2 of 12 runs, 4 of 6 blocks) give G3 false, `floorFails` empty, verdict extinction-limited; one such run stays readable. The real evidence still passes G3. |
| 3 | P2 | sol | Impossible raw records pass (`invalid` hard-coded false) | Fixed. `validateRuns` checks tuple shapes, checkpoint count, finite non-negative integers, positive inocula for every occupied label, cells within the tile, cells exist exactly when biomass does, and no second label in solo runs. `buildPayload` throws, `recompute` returns the problems, `evaluateGates` takes an `invalid` flag. M: eleven impossible variants rejected. T: resealed -42 cell count and an extra checkpoint tuple rejected by `checkSaved`. |
| 4 | P2 | sol | `--check` trusts frozen metadata (also claude P3 on recompute) | Fixed. `checkSaved` rebuilds panel (hex, founder indices, distances), constants (checkpoints from `config.arena.steps`, thresholds, plant, rule version) and schedule counts from current sources and compares them with the payload and the manifest; also kind, version, note and limits. Arena and payoff floor constants are asserted equal. T: resealed W genome replaced by G's, schedule count changed, final checkpoint relabelled 30000, floorDiv edited: all rejected. Not covered: `b0` against the genomes would need re-simulation, which `--replay-check` does. |
| 5 | P2 | sol | Prospective calibration freeze missing | Accepted as a provenance gap. Not fixable after the fact. EVIDENCE.md, the page and `LIMITS` now call the result exploratory, say nothing was committed before the evidence was written, and that post-review corrections were made with the earlier outcomes known. A confirmatory claim needs the corrected protocol committed first and fresh seeds. |
| 6 | P2 | sol | Excluded blocks leaked into displayed residuals | Fixed. The expectation averages over exactly the seeds whose balanced block is retained at that checkpoint and position (returns null if a retained seed lacks a solo prediction). R: nine retained blocks with zero residual plus one excluded block that would predict 1.0 now show residual 0 (was -0.05). |
| 7 | P3 | sol | Absence of 3-cycles labelled transitive | Fixed by renaming: `isTransitive` became `hasNoThreeCycle`, the stored field is `noThreeCycle`. M: a four-cycle returns no three-cycle. |
| 8 | P2 | claude | `evaluateGates` untested on failing cases | Fixed. M adds 14 synthetic-run scenarios built from `schedule(cfg)` with hand-written expected gate objects and verdicts: biased twin, twin of mixed sign but too large, label invariance broken, W not losing, W at 0.45, W dead alone, three both-floor blocks, rare-arm incompleteness, rare-arm run fraction, in-world depletion alive / dead / one side alive, failed fixtures and `invalid`. |
| 9 | P2 | claude | Verdict table test re-implemented `decideVerdict` | Fixed. The test now pins hand-derived counts over the 128 combinations (112 control-invalid, 12 biased, 2 insensitive, 1 extinction-limited, 1 sensitive, derivation in the comment) plus hand-written precedence rows. Threshold mutations are caught by the gate scenarios above. |
| 10 | P2 | claude | Invasion stored uncorrected for the arrangement penalty | Fixed. Each pair now stores `interpretable: false`, `baseline: "twin"`, and `adjusted` (raw excess minus the twin's excess for the same arm and seed; null for the twin itself). M: a uniform -0.16 penalty reads raw "fails" and adjusted excess 0 / "unclear"; a real gain beyond the baseline reads "invades". EVIDENCE.md warns that 13 of 20 adjusted arms read "invades" and calls that a sign the correction is imperfect (six-seed baseline, one genome). |
| 11 | P3 | claude | `recompute` did not validate metadata | Covered by #4. |
| 12 | P3 | claude | Result ordering wording loose | Fixed. EVIDENCE.md quotes the means (F1 0.647, G 0.621, F2 0.483, W 0.403, F3 0.346) and says F3 lowest, W second lowest, no confirmed edge between them. |
| 13 | P3 | claude | G1b pass weaker than the prose | Fixed. EVIDENCE.md, the page and `LIMITS` state the gate is low power with a threshold fitted on three other seeds. |
| 14 | P3 | claude | Unbacked "identical across two --write runs" seal claim | Fixed. The claim is dropped. EVIDENCE.md records the new seal and the `--replay-check` outcome (see Commands). |

Page text and `LIMITS` also gained a line on the raw rare-start being unreadable alone.

## Follow-up review of the fixes

Reviewer: Codex gpt-6.1-sol, xhigh, read-only, limited to the fixes. Raw: `review-sol-fixes.txt` (transcript), final message in `/tmp/i03-fixes-final.txt`. Five findings, all accepted and fixed:

| # | Sev | Finding | Disposition and evidence |
|---|---|---|---|
| F1 | P2 | `validateRuns` accepts `[1,1,512,512]` and oversized biomass | Fixed. Biomass must be at least the occupied-cell count per label and total biomass at most MATTER_MAX (2^26); solo runs may not carry energy on a second label. T: resealed variants rejected. |
| F2 | P2 | Step-zero `b0`/`e0` trusted | Fixed. `checkSaved` rebuilds every run's step-zero world from the frozen panel and config (`stepZero` in arena.ts, no simulation step) and compares `b0` and `e0`. T: resealed `b0 = [1,1]` and `e0 = [0,0]` on `c|G|F1|rA|R1|101` rejected. This replaces the "not covered" remark in finding 4 above. |
| F3 | P3 | Gate tests miss a dropped G1b p condition and a raised G2 cutoff | Fixed. M: a consistent +0.01 twin effect fails G1b by p alone; W at exactly 0.40 passes G2 and 0.41 fails. |
| F4 | P3 | Page calls exploratory results confirmatory | Fixed. Caption and time label say "primary analysis" and that every result is exploratory. (Internal code comments keep "confirmatory family" as the name of the planned family.) |
| F5 | P3 | Page G3 text uses one threshold | Fixed. Four fifths for even starts, five sixths for rare starts. |

Seal unchanged (`85fe724c...dbdef`): the fixes touch validation and the check, not the payload. Because `arena.ts` and `evidence.ts` are hashed sources, the manifest was rebuilt from the same runs and `--replay-check` rerun.
