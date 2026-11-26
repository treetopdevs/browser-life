Two issues need clarification before implementation:

1. **[P2] The averaging rule does not enforce “extinction cannot pass.”** At [PLAN.md:19](../../../../experiments/3d-rps/invasion/PLAN.md#L19), immune frequencies `0.04, 0.04, 0` average to `0.0267`. With initial and neutral frequencies of `0.01`, both thresholds pass even though the immigrant is extinct at step 10000. Make final marked-living count `> 0` an explicit additional requirement, and add this counterexample to the endpoint fixtures.

2. **[P2] Setup eligibility does not establish a predation challenge.** [PLAN.md:10](../../../../experiments/3d-rps/invasion/PLAN.md#L10) requires only 100 living type-0 parents. It permits a burned state without type 2. In that case, with mutation disabled, neither arm experiences predation against type 0: the [native rule](../../../../packages/sim-ref/src/step3d.ts#L548) requires an adjacent qualifying predator whose mask targets the victim. The one-step engineering fixture proves protection is possible, but does not establish exposure in the assay. Prespecify predator availability checks and an exposure diagnostic; classify an unchallenged assay separately from an exposed assay showing no advantage, without substituting seeds.

The intervention otherwise matches the [existing prediction](../../../../docs/3d-cyclic-rps-plan-2026-10-23.md#L434): type 3 retains prey type 1 and escapes all founding masks. Relative replacement is appropriate for the stated small positive control; absolute population growth or significance testing is unnecessary.

The **184000-step budget is correct**. Storage needs a fixed retention schedule: each full state is about **56 MiB**, so retaining all eleven census states across sixteen runs would exceed 2 GiB. Reading and hashing them need not.

Static review only; no tests, GPU runs, or file edits.