# M4 growth candidate: endpoint-1 stress-null precision extension

Date: 2026-10-02. Status: **protocol, frozen when the manifest is planned** (the manifest binds this file's hash). It adopts the 2026-09-29 M4 growth contract (`2026-09-29-m4-growth.md`, `m4-growth-v1.ts`) unchanged. The user withdrew the separate 2026-10-02 endpoint-2 draft in its favour (`experiments/m4/endpoint-2-amendment-draft.md`, marked WITHDRAWN). `experiments/preregistration.md` is unchanged at its frozen hash. Original M4 remains not met. This is synthetic calibration, not milestone evidence.

## Why this extension exists

The 2026-09-29 frozen validation (manifest `fc22327f…`, report `b74d8f43…`, trials `ee6808f0…`; copies of the manifest and report are in `experiments/m4/growth-precision-v1/`) failed one declared screen. In the spots-m3 paired endpoint-1 stress null, original endpoint 1 falsely passed 2 of 200 trials. The one-sided 95% upper bound was 0.0311, above the 0.025 envelope. The parent documents name the route forward: "a costed precision extension with a valid … fixed-sample decision rule", separately frozen, never a rerun concatenated with the old trials. This is that extension, and the only one under this design.

## Development information disclosed before freezing

These numbers were computed before the manifest was planned and shaped the sample size. They did not shape the decision rule.

- **Simulated true rate.** A development Monte Carlo of the declared stress-null law estimated how often endpoint 1 falsely passes. It is an independent numpy reimplementation of the generator and of the tie-corrected normal Mann–Whitney, run with a numpy RNG, never the production path or any validation stream. Over 200,000 trials of 64 pairs, endpoint 1 falsely passed at a rate of **0.0207** (95% CI 0.0201–0.0214).
  - The generator law is the same on both presets, since every episode sits at threshold + 1, so the same rate applies to each.
  - In the parent trials, one-sided p ≤ 0.05 occurred in 11.5% and p ≤ 0.01 in 3.0%. Both agree with the simulation.
- **What that rate means.** The stress gives each seed's treatment and controls opposite responses to shared noise (rank correlation about −0.64). Under that dependence the unpaired original endpoint 1 is anti-conservative. It runs at about twice its nominal family α of 0.01, and about four times the 0.005 per-comparison level that applies when its two comparisons are identical. That is still inside the declared 0.025 envelope, but by only about 0.004. The parent's failure was therefore a real precision problem: 200 trials cannot resolve a rate this close to the bar.
- **Real dependence (already reported 2026-09-28 data, planning only).** Seeds were shared across conditions in that ensemble. Within-seed correlations of cumulative new activity are:

  | Preset | Comparison | r | n |
  |---|---|---:|---:|
  | gradient-m3 | treatment–neutral | −0.01 | 20 |
  | gradient-m3 | treatment–no-mutation | +0.38 | 20 |
  | spots-m3 | treatment–neutral | +0.05 | 10 |
  | spots-m3 | treatment–no-mutation | +0.02 | 10 |

  The inflation needs strongly negative dependence. Near-zero or positive dependence leaves the unpaired test nominal or conservative. The samples are small, so this is context, not proof.

## Design

- **Strata.** `pairedEndpoint1Null` on both gradient-m3 and spots-m3. Both presets are re-tested, not only the one that failed. Each stratum keeps the parent's 64 pairs per trial, three conditions, generator, production activity construction and production endpoint analysis.
- **Trials.** 20,000 per stratum, fixed in advance. Master seed `650009003`, which was absent from the docs, tools, experiments and runs of all eight local browser-life workspaces on 2026-10-02 (word-bounded scan). The coordinator registry was not reachable, so this is not proof of global freshness. Generator identity is `precision-extension:650009003:<scenario>:<preset>:<trial>`.
- **Decision rule, fixed now.** A stratum passes when all 20,000 trials are complete and the one-sided 95% Clopper–Pearson upper bound on false support is ≤ 0.025 for **both** original endpoint 1 and candidate endpoint 2. This is the parent's null-stratum rule with its acceptance object copied exactly. Unavailable or degenerate trials count as non-support. `precisionPass` requires both strata to pass. At n = 20,000 that means at most 463 endpoint-1 false passes per stratum.
- **Why 20,000.** At the development rate of 0.0207, a stratum passes with probability 0.992 and both pass with probability 0.984. At the 1,000 trials first proposed, both would pass only about 3% of the time. Whatever the trial count, a stratum whose true rate exceeds 0.025 passes with probability at most 0.05. The development estimate changed the power, not the error control.
- **No looks, no top-ups.**
  - The run has four shards, each a contiguous block of the frozen schedule.
  - Progress logs show only trial counts.
  - `report` refuses until every shard has a complete, authenticated terminal receipt, so there are no interim tallies.
  - The trials are never concatenated with the parent's, and there is no second extension of this screen under this design.
  - If it fails, blocker 1 stands. The next step would then be a methods revision for endpoint 1 under paired seeds, which amends the original endpoint 1 and needs its own validation. It would not be more sampling.
- **Same code.**
  - All 48 parent-bound sources are byte-identical here, including `experiments/endpoints.ts` after the withdrawal, and the manifest records this parity.
  - Under Deno, the new driver reproduces the parent's validation rows byte for byte for the same identities (`tools/test/m4-growth-precision.deno.ts`).
  - No parent-bound source is edited.
- **Numerics.** The production `binomialLowerBound` builds the binomial coefficient directly and overflows above n ≈ 1,000. At n = 20,000 it returns a lower bound of 0, so it would report an upper bound of 1 and fail every stratum. The extension uses a log-space Clopper–Pearson instead, tested against the production function at n ≤ 1,000 and against scipy's beta quantiles at n = 20,000.
- **Execution.** CPU only, in four background shards beside the continuation GPU run. At the parent's measured ~0.42 s per trial, each shard should take about 4,200 s uncontended. Each shard is capped at 10,800 s, and the existing resume rules apply to every shard. Outputs go to `runs/m4-growth-precision-v1/` and the frozen manifest to `experiments/m4/growth-precision-v1/manifest.json`. An independent review of the frozen manifest precedes launch.

## What the result can and cannot mean

- **A pass** clears the parent's failed screen. It does not show endpoint 1 is at nominal size under this stress: the development rate is about 0.021.
  - The parent requires the launch decision to judge whether the coarse 0.025 envelope is adequate.
  - This protocol's position: it is adequate only together with the dependence evidence above, and the results record must state the inflation alongside the pass.
- **Endpoint 2** in this stratum is a deep null, since the true mean excess is 0, below the floor of 1. Its tighter bound here is a by-product, not boundary-size evidence.
- **The parent's other nine strata** keep their 2026-09-29 coarse-screen passes.
- **A failure** is a valid negative result and leaves the candidate unregistered.

## Not covered here

- **Joint power** (the parent's second blocker) is argued separately, from already-reported endpoint-1 data, in its own dated document.
- **Unchanged launch requirements:**
  - the eleven remaining development histories (about 3.5 GPU-hours);
  - the exact fresh seed matrix from 700000001–700999999;
  - compatibility and cost checks;
  - the immutable freeze, independent review and dated registration;
  - the user's launch decision, which waits for the founder-discovery continuation study.
