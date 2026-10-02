# M4 growth candidate: precision-extension result

Date: 2026-10-02. Status: **complete; the declared screen passes on both presets.** Original M4 remains not met. This is synthetic calibration of the 2026-09-29 M4 growth contract's endpoint-1 size under a deliberately adversarial dependence, not milestone evidence. Protocol: `experiments/amendments/2026-10-02-m4-growth-precision.md`. Records: `experiments/m4/growth-precision-v1/`.

## What ran

- **Design.** One frozen, fixed-N extension of the screen that failed on 2026-09-29: the paired endpoint-1 stress null, on both presets.
  - 20,000 trials per preset, 64 seed pairs per trial.
  - Fresh master seed 650009003.
  - The same production activity path and analysis, byte-identical to the parent's 48 sources.
  - The parent's acceptance rule: a one-sided 95% upper bound ≤ 0.025 for endpoint 1 and for endpoint 2.
- **Review.** The independent pre-launch review was CLEAR-WITH-FIXES. Its one prerequisite, a seed-ledger record, was applied without re-freezing.
- **Execution.**
  - Four CPU shards launched at 21:21:07Z beside the continuation GPU run.
  - Each completed on its first attempt with no failure, in 3,595–3,959 s against a 10,800 s cap.
  - Outcomes were computed once, by `report`, after every shard had a complete terminal receipt.
  - The results are not concatenated with the parent's 400 trials.

## Result

| Preset | Endpoint 1 false support | Rate | One-sided 95% upper | Two-sided 95% CI | Endpoint 2 false support | Endpoint-2 upper | Stratum |
|---|---:|---:|---:|---|---:|---:|---|
| gradient-m3 | 428 / 20,000 | 0.0214 | 0.0232 | 0.0194–0.0235 | 3 / 20,000 | 0.00039 | **Pass** |
| spots-m3 | 382 / 20,000 | 0.0191 | 0.0208 | 0.0172–0.0211 | 3 / 20,000 | 0.00039 | **Pass** |

`precisionPass: true`. Report SHA-256 `6b0f5c2b6619afa3052ae7672e6844c2851fc7cdbbe8a4b31d80be9e562ce047`. Per-shard log, receipt and runtime hashes are in `experiments/m4/growth-precision-v1/evidence-sha256.txt`. There were no unavailable or degenerate trials.

## Reading

- **Blocker 1 is cleared under the contract's own rule.** On both presets, original endpoint 1's false-support rate under the paired stress null is shown to be at most 0.025 with 95% confidence. The 2026-09-29 failure stays on record. It was a precision failure: 200 trials could not resolve a rate this close to the bar.
- **Endpoint 1 is inflated under this stress, as predicted before launch.**
  - The development estimate was 0.0207. The observed rates are 0.0214 and 0.0191.
  - That is about twice endpoint 1's nominal family α of 0.01. It is about four times the 0.005 per-comparison level that applies here, because the two comparisons are identical.
  - The cause is the stress itself: each seed's treatment and controls respond oppositely to shared noise. The unpaired rank test does not model that dependence.
  - The two presets run the same generator law, so their difference (0.0214 vs 0.0191; Fisher p = 0.11) is the kind of gap chance produces. They are reported separately, as the parent requires, and not pooled for the decision. Pooled for description only, the rate is 0.0203: 2.0× the family α and 4.05× the 0.005 level. The 0.005 level is the one that applies, because the two comparisons were identical in all 40,000 trials.

## Independent verification

`experiments/m4/growth-precision-v1/verification.json`: **CONFIRMED-WITH-QUALIFICATIONS**.
- **Integrity.**
  - The shard manifests, receipts and log hashes all match.
  - All 52 bound sources are unchanged, and no locks remain.
  - The schedule partition is exact, with no duplicates or gaps.
- **Tally.** An independent Python/scipy recount matches the report to below 1e-15.
- **Determinism.** 124 of 124 seeded-random trials re-ran byte-identically under Deno 2.9.7. They included 58 endpoint-1 positives, all 6 endpoint-2 positives and every shard boundary.
- **Timeline.**
  - All shards started at the launch time.
  - Each ran once.
  - The report was written 18 s after the last receipt.
  - No interim tallies can be shown to be absent from artifacts alone.
- **Independent rate check.** A reimplementation of the law over 1M trials gives 0.0210 (95% CI 0.0207–0.0213).
- **Qualifications adopted above.**
  - The stress is one dependence strength, not a bound.
  - Envelope adequacy is a launch judgment, not a finding.
- **Is the coarse 0.025 envelope adequate?** The parent requires this judgment before launch. It is the user's launch judgment, not a result of this extension. The evidence:
  - **This is one dependence strength, not a worst case.** The stress has a treatment–control rank correlation of about −0.62, and its rate is 0.019–0.021. Stronger negative dependence pushes the rate higher. The post-run verifier's sweep of the same law gave 0.029 at about −0.88 and 0.033 at about −0.97, with the 0.025 bar crossed near −0.73 by interpolation.
  - **The real ecology's dependence is only weakly known.** In the 2026-09-28 ensemble, where seeds were shared, within-seed correlations of cumulative new activity have point estimates near zero or positive (−0.01 to +0.38). Under such dependence the unpaired test is nominal or conservative. But they come from only 10–20 seeds: the spots-m3 95% intervals reach about −0.6, so they cannot rule out dependence as strong as this stress.
  - **What the confirmation report should do.** Measure the within-seed treatment–control correlation on its 64 fresh pairs. It should report that correlation beside endpoint 1's result, together with this stress result, as a stated limitation. Doing so changes no decision rule.
- **Endpoint 2's 3/20,000** in this stratum is a deep null, since the true mean excess is 0, below the floor of 1. It is not evidence about endpoint 2's size at the boundary. The parent's boundary screens (0/200 each) remain the coarse screens they were.

## Where the 2026-09-29 contract now stands

| Launch requirement | Status |
|---|---|
| Endpoint-2 null and power screens (2026-09-29 validation) | Passed then; unchanged |
| Endpoint-1 size under paired stress (blocker 1) | **Cleared** by this extension, with the inflation stated |
| Joint power (blocker 2) | `experiments/amendments/2026-10-02-m4-growth-joint-power.md`: resolved for gradient-m3 (joint ≥ 0.887); quantified limitation for spots-m3 (endpoint-1 assurance 0.90 at 64 pairs, 0.94 at 128) |
| Development pipeline rehearsal | Open: 11 histories remain (about 3.5 GPU-hours) |
| Exact fresh seed matrix, compatibility and cost checks, freeze, review, registration | Open |
| Launch decision | The user's, after the founder-discovery continuation study reports; includes the spots-m3 allocation (64 or 128 pairs) |
