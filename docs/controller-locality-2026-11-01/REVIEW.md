# I05 controller locality: review log

## Plan review dispositions

Codex Sol 6.1 xhigh, read-only, 2026-11-01. Prompt `/tmp/controller-locality-2026-11-01-plan-review.md`; final message `/tmp/controller-locality-2026-11-01-plan-review-final.txt`; raw transcript `/tmp/controller-locality-2026-11-01-plan-review-raw.txt`. Codex's verdict: reuse APIs exist, no layering cycle, founder sparsity claims hold, hidden-permutation is function-preserving; needed revision for the decision rule and the physical measurements. All findings accepted; PLAN.md revised.

| # | Sev | Finding | Disposition |
|---|-----|---------|-------------|
| 1 | P1 | Entanglement gate vs structural reach unreachable (structural reach is an upper bound) | Fixed. Gate compares breadth with a degree-matched null (same genome, nonzero W1/W2 magnitudes at shuffled positions); structural reach kept as an upper-bound sanity check only (sections 2.3, 7). |
| 2 | P1 | Collateral condition passes with zero improvements (0 >= 0) | Fixed. Minimum A >= 5 improving edits per genome, else "underpowered"; collateral and clean shares are conditional on A; test added (section 7). |
| 3 | P2 | Sensor shuffle has no breadth invariant (axes differ) | Fixed. Invariant removed; fixture-specific pinned tables; attribution relabelling tested separately (2.1, 5). |
| 4 | P2 | Grid is 26,244 points, not 8,748 | Fixed. Count derived from `PROBE_AXES`, test added; I confirmed 3^8 x 2^2 myself. |
| 5 | P2 | Sigma scaling misclassified as clamping | Fixed. Three deltas recorded (operator, expected slot, applied); `boundary-clamped` only for bound hits; undo uses the negated operator delta (2.2, 5). |
| 6 | P2 | `expressionOf` returns fractions, not integer permille; CIs conflict with integer payload | Fixed. Own integer counts from `Probe.outs`; no fractional probe summaries; CIs dropped for counts and denominators (2.3, 2.5, 9). |
| 7 | P2 | 12x12 invalid | Fixed. 16x16 only; schema untouched. |
| 8 | P2 | Three biomass endpoints are not independent capabilities | Fixed. Renamed "environmental biomass responses"; initial/final B/P/E and fluxes recorded; sensitivity check (zero `w2 h1->photo`) required before any bottleneck recommendation (2.4). |
| 9 | P2 | Seed shift is sensitivity, not a noise floor | Fixed. Paired baseline/mutant on two frozen seeds; neutral controls must be exactly 0; per-endpoint tau from baseline/generalist only; explicit failure criterion (2.4). |
| 10 | P2 | Qualification/substitution/failure branches conflict | Fixed. Complete branch logic in section 3; parameters frozen from the generalist before applying to M3 genomes; failed candidates retained; single-genome verdict capped at inconclusive/measurement-limited. |
| 11 | P2 | Physical estimand and sampling denominator missing | Fixed. Selection frozen before outcomes, stratified allocation, fixtures excluded from rates, assayed-subset rates plus inverse-probability-weighted estimates (2.2, 2.4). |
| 12 | P2 | Clopper-Pearson coverage claim unsupported | Fixed. Intervals removed; finite-panel counts; plan states 0/40 cannot support "under 2%". |
| 13 | P2 | Matched magnitude and "not worse" undefined | Fixed. Requested and realised magnitude recorded; frozen allocations; statistic defined (multi-locus clean share no more than 5 points below single-locus on shared strata). |
| 14 | P2 | Generalist positive control votes | Fixed. Generalist is qualification/positive control only; verdict from two M3 genomes, disagreement is inconclusive. |
| 15 | P2 | No aggregate runtime budget | Fixed. Budget computed (24 edits x 3 scenarios x 2 seeds x H 80 x 19 ms, about 9 min serial, about 3 min on 4 workers) with a pre-stated reduction ladder, and a measurement-limited fallback. Worker pool kept but optional and deterministic; to be cut at build if calibration shows serial is enough. |
| 16 | P2 | Seal ownership contradictory; atlas is Node-only | Fixed. Payload builder browser-safe and pure; digest and seal live in the CLI. |
| 17 | P3 | Protected-file gate does not fail; omits docs/rules.md | Fixed. `git diff --exit-code` against b43db3be incl. `docs/rules.md`. |
| 18 | P3 | D10 not in the backlog log | Fixed. Citation corrected; slice scope vs recorded decisions distinguished. |

No findings rejected. Residual risk noted for the build stage: the sensitivity check and the viability floor are calibrated on the generalist only, so an M3 genome may legitimately fail qualification; the plan handles that as a recorded outcome.


## Source review dispositions

Review of the built source (`review-sol-src.txt` and a Claude pass), FIX stage 2026-11-01. All six accepted.

| Finding | Reviewer | Disposition | Evidence |
|---------|----------|-------------|----------|
| P2 `outcomeText` calls boundary-clamped unassayed rows "neutral by construction" | claude | Fixed. Only `cls === 'unchanged'` gets that label; clamped rows read "partly clipped, not assayed". | `apps/lab/src/controller-locality/render.ts`; new render test covers all three classes. |
| P2 `--check` recomputes only the verdict, so a resealed edit to readouts, fixtures, sensitivity or row fields passes | claude | Fixed. `recomputeProblems` recomputes slot and row classes, `k`, requestedL1/realisedL1, the assayed flag, fixture `passes`, `neutralControlsOk`, `sensitivity.passes` and tau, qualification of genomes and candidates, and every readout from the saved rows. | `tools/locality/matrix.ts`; test "a tampered payload that is resealed is still caught by recomputation" reseals seven different tampers. Saved evidence still passes (`--check ok`) and regenerates byte-identical. |
| P3 manifest hashes all of schema and sim-ref, so unrelated upstream edits break `--check` (D7 rebase) | claude | Fixed. Schema and sim-ref dropped from the manifest hashes; dynamics changes are caught by `--replay-check`. Stated in EVIDENCE.md. Manifest regenerated (`--write --force`; evidence.json unchanged byte for byte). | `tools/locality/matrix.ts` `SOURCE_DIRS`; EVIDENCE.md "Checking the artifacts". |
| P3 permille shading and page text hard-code 26244 | claude | Fixed. `matrixRows` and `matrixHead` take `p.grid.points`; the caption is built from it in `page.ts`; `index.html` no longer states the figure. | `render.ts`, `page.ts`, `index.html`. |
| P3 EVIDENCE.md claims the gate was fixed before data, contradicting the calibration it describes | claude | Fixed. EVIDENCE.md and the page now say the horizon, floor and margin were calibrated with M3 baselines visible, that this departs from PLAN.md section 3, and that cluster 16 fails both the floor and the margin. Only the decision-rule thresholds are described as written before outcomes. PLAN.md left as the historical plan. | `EVIDENCE.md`, `index.html`. |
| P3 measurement functions have no direct tests | claude | Fixed. Hand-built-input tests: `outcomeOf` strict at tau both sides and viability floor, `qualify` at floor and margin (worst seed decides), `tally` class separation, `ipwPermille` against a hand value (333) with a dropped stratum and an excluded clamped row, `readoutFor` genome isolation, and the assay draw excluding duplicates, unchanged and clamped edits with `dupOf` bookkeeping. | `packages/lineage/test/locality.test.ts` "measurement rules on hand-built inputs". |

### Follow-up review of the fixes (`review-sol-fixes.txt`, Codex Sol 6.1 xhigh)

| Finding | Reviewer | Disposition | Evidence |
|---------|----------|-------------|----------|
| P2 resealed-tamper protection still incomplete (strata, null medians, tau, assay dev, descriptors, candidate selection, protocol trusted) | codex | Fixed. `recomputeProblems` now derives stratum counts from rows, null medians from values, tau from baselines, assay dev from sums, breadth/participation/sensorReach/withinStructural from saved components, candidate selection and `votes` from the selection rule, and the protocol from the code constants (`protocolRecord`). EVIDENCE.md says which raw measurements remain trusted (only `--replay-check` tests them). | `tools/locality/matrix.ts`; seven more resealed tampers in `tools/test/locality-evidence.test.ts`. |
| P3 IPW test cannot tell weighting from averaging | codex | Fixed. Unequal-weight case (populations 10 and 30) expecting 250. | `locality.test.ts`. |
| P3 worst-seed margin untested | codex | Fixed. lg [1500,1500], dp [1251,1000] must fail with minimum gap 249. | `locality.test.ts`. |
| P3 floor said to have "decided" cluster 16's exclusion | codex | Fixed. Cluster 16 fails both criteria (924 vs 1000; gap -19 vs 250); wording changed in EVIDENCE.md, the page and this file. | `EVIDENCE.md`, `index.html`. |
