# M4 growth candidate: joint-power rationale

Date: 2026-10-02. Status: **planning record for the 2026-09-29 M4 growth contract** (`2026-09-29-m4-growth.md`). It answers that contract's second launch blocker: "a separately frozen joint-power rationale or an explicit unresolved-power limitation". It covers gradient-m3 with a rationale and spots-m3 with a quantified limitation. It is not a registration and authorizes no run.

- Reproduce: `deno run --no-lock -A tools/m4-growth-joint-power.ts <out.json>` (deterministic; planning RNG mulberry32, seed 20261002).
- Recorded output: `experiments/m4/growth-joint-power-v1/report.json`, SHA-256 `d6440f7f886baedcd5c0f04362bb6f784dd2357ecb035b41c9f0ded292190a9f`.
- Script SHA-256: `aede49ebd789ba57287c1acf7741cd5773b2c01f4c601b565359be87db73f5ed`.

## Why the parent's joint figure understated power

The 2026-09-29 validation observed joint endpoint-1 AND endpoint-2 support of only 68/200 (gradient) and 57/200 (spots) under its synthetic mean-3 alternative. That alternative was built to stress endpoint 2. Its endpoint-1 contrast was weak by construction: treatment added 15 episodes on a base of about 1,000. The joint rate therefore measured the generator's endpoint-1 effect, not the ecology's.

## Method

- **Endpoint 1.** Power uses the already-reported 2026-09-28 per-run cumulative new activity, under the frozen thresholds, for treatment, neutral and no-mutation:
  - gradient-m3: 20 runs per condition;
  - spots-m3: 10 runs per condition.
  
  Each replicate draws n runs per condition with replacement and scores them with the production `evaluateEndpoint(PRIMARY_ENDPOINTS[0])`: one-sided Mann–Whitney, tie-corrected normal above 60 observations, Holm α 0.01. Two figures are reported:
  - **Conditional power** treats the observed runs as the population (2,000 replicates).
  - **Assurance** also resamples the observed runs themselves (1,000 outer worlds × 200 replicates), so that the small 2026-09-28 samples' uncertainty enters.
- **Endpoint 2.** Power is the parent validation's one-sided 95% lower bound under its declared alternative: 0.8869 for gradient and 0.8810 for spots. Its real effect size is unknown, and this record does not estimate it. The 2026-09-28 histories are deliberately not used for endpoint 2.
- **Joint.** Endpoints 1 and 2 are evaluated on the same fresh histories, so no independence is assumed. The Fréchet bound P(E1 ∧ E2) ≥ P(E1) + P(E2) − 1 holds regardless of their dependence.
- **Dependence.** Conditions are drawn independently. Within-seed dependence in the 2026-09-28 data is near zero or positive (see the precision-extension protocol). That leaves these figures unchanged or slightly conservative.

## Result

| Preset | Treatment > neutral AUC (2026-09-28) | E1 conditional power, n = 64 | E1 assurance, n = 64 (mean; 5th percentile) | Joint lower bound, n = 64 |
|---|---:|---:|---:|---:|
| gradient-m3 | 1.00 (complete separation, 20 v 20) | 1.00 | 1.00; 1.00 | **0.887** |
| spots-m3 | 0.80 (two low treatment runs, 10 v 10) | 1.00 | 0.898; 0.365 | **0.881** conditional; **0.779** assurance; 0.246 at the 5th percentile |

- **Conditional power at smaller allocations.** For spots-m3 it is 0.81 at n = 20 and 0.95 at n = 32. This is why the withdrawn 2026-10-02 draft, at 20 spots seeds, was underpowered.
- **spots-m3 at n = 128.** Endpoint-1 assurance is 0.942 (5th percentile 0.64).

## Reading

- **gradient-m3: resolved for endpoint 1.** Endpoint 1 is effectively certain at the 2026-09-28 effect size. The joint gate's power at n = 64 is then bounded by endpoint 2's power, at least 0.887 under the declared alternative. The milestone's AND does not materially weaken it.
- **spots-m3: an explicit, quantified limitation.**
  - At the observed effect, joint power is at least 0.88.
  - Ten runs per condition leave real uncertainty about the population effect. Averaging over it gives joint power of at least 0.78. In a pessimistic world (the 5th percentile, where the low-activity treatment runs are more common) it falls to about 0.25.
  - n = 64 is therefore not a validated joint-gate allocation for spots-m3. Raising spots-m3 to 128 pairs would lift endpoint-1 assurance to 0.94. That would cost about 192 more one-million-step histories, roughly 61 GPU-hours at the parent's single-history benchmark.
  - That allocation choice belongs to the launch decision and is not made here.
- **Endpoint 2 in reality.** Endpoint-2 power holds only under the declared synthetic alternative of mean excess 3 per 10⁵ steps. If the real late-window excess is smaller, both endpoint-2 and joint power fall regardless of preset. This limitation stands on both presets.

This record uses only endpoint-1 data that was already reported. It changes no endpoint, threshold, α or decision rule.
