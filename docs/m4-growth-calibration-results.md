# M4 growth candidate: independent calibration result

Date: 2026-09-29. Status: **complete calibration, candidate not ready for confirmation**. Original M4 remains not met. This is a synthetic analysis investigation, not evidence that the physical ecology failed a new biological test.

The frozen validation completed all 2,000 trials: 200 in each of five scenarios and two presets, with 64 seed pairs per trial. It used the actual frozen-threshold activity construction and the production analysis for original endpoint 1 plus candidate endpoint 2. No validation outcome changed the design during execution. Runtime was 4,833.580 seconds (80.56 CPU wall minutes), with no technical failure or resume. Exit code 0 means successful execution; the report's separate `calibrationPass` is **false**.

## Declared gate and observed result

The coarse null screen required each relevant one-sided 95% upper binomial bound to be at most 0.025. The spots-m3 paired endpoint-1 null produced two endpoint-1 positives in 200 trials, giving an upper bound of **0.0311426**. This fails the declared envelope. The point estimate is 0.01; this does **not** demonstrate that the true false-positive rate exceeds 0.025. It means the completed calibration does not establish the required upper bound. Do not remove the stratum, pool it with gradient, or keep sampling new sets until it passes.

| Scenario | Preset | New growth endpoint supported / 200 | Original endpoint 1 supported / 200 | Frozen stratum acceptance |
|---|---|---:|---:|---|
| Paired endpoint-1 null | gradient | 0 | 1 | Pass; endpoint-1 upper bound 0.0234985 |
| Paired endpoint-1 null | spots | 0 | 2 | **Fail**; endpoint-1 upper bound 0.0311426 |
| Rare-negative mean boundary | gradient | 0 | 15 | Pass; endpoint 1 is an alternative diagnostic here |
| Rare-negative mean boundary | spots | 0 | 17 | Pass; endpoint 1 is an alternative diagnostic here |
| Extinction mean boundary | gradient | 0 | 0 | Pass |
| Extinction mean boundary | spots | 0 | 0 | Pass |
| Mean-3 bounded alternative | gradient | 185 | 68 | Pass for declared endpoint-2 power and precision |
| Mean-3 bounded alternative | spots | 184 | 57 | Pass for declared endpoint-2 power and precision |
| Periodic turnover | gradient | 0 | 0 | Pass |
| Periodic turnover | spots | 0 | 0 | Pass |

The rare-negative strata include eight gradient and four spots trials with zero estimated variance. Inference is unavailable for those trials; they remain in the unconditional denominator as non-support. Their zero-support result must not be described as 200 available estimates. Each 0/200 null upper bound is 0.0148670, so even a passing stratum provides only the declared coarse screen, not proof of a nominal 0.005 growth-test size.

For the bounded alternative, endpoint-2 one-sided 95% power lower bounds are 0.886862 and 0.881028; mean confidence margins are 1.32618 and 1.31400 activity episodes per 100,000 steps. Both satisfy the frozen endpoint-2 criteria. However, the observed **joint** endpoint-1 AND endpoint-2 support is only 68/200 (34%) and 57/200 (28.5%). These joint counts are descriptive, not a newly invented acceptance criterion. They show why the candidate allocation cannot be called a validated, well-powered allocation for the full milestone. Results are conditional on the declared synthetic distributions and do not estimate power in the actual ecology.

## Decision and remaining scope

Keep this dated candidate unregistered. Preserve all validation inputs and results. No confirmation seed was consumed. Any redesigned method, dependence structure, allocation or calibration distribution must treat these results as development information and have a separately frozen validation design; no change is justified merely because it increases a favorable rate.

The first full-length development history completed and was independently authenticated. Its 1,141.140-second benchmark projects the provisional 384-history confirmation to roughly 121.72 GPU-hours and 55.91 GiB, before retries or device verification and without validating other conditions' costs. Under the plan's permitted negative-calibration exit, the remaining eleven development histories and complete real-bundle analysis are **not performed**. The development pipeline is **incomplete/unrehearsed**, not passed. This stopping interpretation was recorded before terminal validation results were opened.

Before reconsidering confirmation, resolve the null uncertainty and joint-gate design together. Options for a new design include a costed precision extension with a valid sequential/fixed-sample decision rule, or a prospectively justified sampling/inference revision preserving the intended estimand and original gate requirements. More observations cannot be assumed to fix a dependence problem; changing the test cannot silently change a mean-growth claim into a rank or sign claim. No such revision or extra experiment was executed here.

## Immutable evidence

- Manifest: `runs/foundations-next/m4-calibration-validation-v4-manifest.json`, SHA-256 `fc22327f851a782c43c5ecf0a6d794737f363df40473d3f0870b9d9a586ea321`.
- Terminal report: `runs/foundations-next/m4-calibration-validation-v4/report.json`, SHA-256 `b74d8f439edc96c24fbafba05f27b3dfff30c8ea1c0ddc8bffbdbe670f609932`.
- All 2,000 trial rows: `runs/foundations-next/m4-calibration-validation-v4/trials.jsonl`, SHA-256 `ee6808f0d41859fee46247fedffab160c3f27fe539af1b3054eb82e27b23683d`.

Late engineering tests added during validation are identified separately: four curve-shape tests and four full-path integration tests, plus the earlier physical census/activity controls. They did not change frozen sources and are not additional independent calibration trials.

Independent reconciliation: `runs/foundations-next/m4-calibration-validation-audit-v3.json`, SHA-256 `f0dc1ba1c7134cf095aada2d4d31798394caf8ebf7bcb0f264bea96c7869da30`. It verifies all scheduled identities, 48 frozen source hashes, raw-row recounts and exact binomial bounds. Earlier audit revisions are preserved; v3 is the final reconciled record.
