**Verdict: no blockers. I'd make four edits to the plan before committing it, and none of them change the science.**

I made no edits and ran no simulations. `stationary-food-plan/results` doesn't exist, so I used `stationary-food-plan.md`, `stationary-food-results.md` and `stationary-food-attempts.json`. I also compared the 1201, 1203 and stationary-1202 moving-arm artifacts and `stationary-food-visual-receipt-1202.json`. I did not read the untracked `stationary-food-replication-plan-claude.md`, and I did not re-hash `model.ts`.

**Checked and consistent**
- **Payload schema:** the 1201, 1203 and stationary-1202 artifacts share the same top-level keys. Their sample, tick-row and frame keys match, and each has 151 samples and frames, 3000 tick rows and snapshots at 0/500/1500/2500/3000. Exact payload comparison is feasible.
- **Offered food:** 768 units per pulse over 600 pulses gives 460,800, which matches the 1202 results.
- **Band position:** `bandLeft` is 40, 50 and 60 at ticks 2000, 2500 and 3000, which matches `floor(tick/50)%96`.
- **Gate rules:** these are copied unchanged from the accepted 1202 plan.
- **Branch base:** the plan's base, d27b7fc3, is the current HEAD.

**Edits to make before committing**
1. **Historical comparison (1201 vs 1203).** The two moving artifacts differ only in provenance. 1201 has no `planSha256`. Their `baselineArtifactSha256`/`baselineDataSha256` differ (1201 points at uniform-endurance 1201). Their `sourceSha256` maps have different members. Both record `prefix.status: "not-applicable"`, while the new arms will record "verified". The plan says to "report exact compared fields" but doesn't fix them in advance, so freeze them now.
   - **Compare:** `run`, `rules`, `samples`, `tickRows`, `frames`, `snapshots`, `windows`, `final`, `repeat` and `numericalGate`.
   - **Exclude by design:** `kind`, `runtime`, `provenance` and `dataSha256`.
   - **Hash check first:** verify each historical file's raw SHA against its recorded index hash before reading it, and stop on a mismatch.
2. **Pair order and retries.** Say the moving arm runs and passes its regression check before the stationary result counts, and that a regression failure voids the whole pair. Also say a retry reruns the whole pair with the failed attempt kept in the log. Finally, say that an unresolved invalid 1201 means 1203 is never run in this slice. Today "run the second seed even on biological failure" and "stop on correctness failure" are not explicitly reconciled.
3. **Aggregate wording.** "0 = initial stationary result did not repeat" currently includes a fail from "unclear or missing endpoints". Report each failure by criterion. An unclear visual call or an assay problem should not count as a biological non-repeat. Add a sentence that "screen repeated" does not mean "minority diversity persisted". The question is about fragile minority families, but the gate only requires at least two nonzero families. Keep the 3000-tick family counts descriptive.
4. **Moving-arm rejudgment and gate leniency.**
   - **Moving gate:** the moving arms' numerical gates are already determined by the frozen historical windows. 1201 has cap48 counts of 26/7/20, and families at 3000 of [2,14,22]. 1203 has 15/17/11 and [0,33,7]. Only their visual judgments are open.
   - **Prior viewing:** earlier media for both seeds exist (`moving-food-media/seed-1201-*`, `moving-food-replication-media/seed-1203-*`), so the judgments are not blind. The receipt should say so.
   - **Visual gate:** with about 90 births and deaths per 500 ticks, a "shifted, expanded or cleared cluster" is very likely in any live arm. A pass therefore says little, and the plan's no-superiority wording should stay as strong as it is.

**Minor**
- **Filenames:** pin the new viewer, receipt and manifest names as `stationary-food-replication-*`. This avoids colliding with the existing `stationary-food-viewer.*`.
- **Seed 1203 margin:** the moving seed-1203 arm has zero mint-family bodies from tick 2000 on, so its two-family pass at 3000 (33 and 7) is thin. That is only a pre-registered numeric fact, not a plan error.
