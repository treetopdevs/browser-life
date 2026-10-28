I'm wrapping up the review. I did 5 reads and hashed the pinned files. I ran no simulations or tests and made no edits.

**Verdict: not clear. Two small blockers (B1–B2) and a few non-blocking fixes.**

**Checked and fine**
- The model SHA, the 1202 raw SHA, the index SHA, the validator SHA and the runner SHA all match the files on disk.
- The 1202 artifact's kind is `hungry-shapes-split-food-arm`, as the plan says.
- The activity, continuity, seasonal and manual gates match `alternating-food-plan.md`, so "identical gates" holds.
- The new runner is needed. The existing `tools/alternating-food/explore.ts` hard-codes 1203 (its `parseArgs` and `writeEvidence`) and calls the `split-food-replication` wrapper, which the plan correctly rejects for 1202.

**Blockers**
- **B1. The `1379b363…` "data SHA256" pin has no source.** It does not appear in `split-food-index-1202.json`, `split-food-results.md` or `split-food-validation.md`. The plan doesn't say what is hashed. Either state the derivation and have the runner recompute and assert it, or drop the pin and rely on the raw SHA.
- **B2. The order and consequence of the static regression are ambiguous.** The first-seed runner required the regression to pass before the alternating outcome (`explore.ts:396-397`). The plan orders the check-only validator and then the regression, but never says the regression finishes before the alternating arm is simulated. The plan should say three things:
  - The regression runs after reservation and before the alternating arm.
  - A regression failure is an invalid attempt, with no alternating outcome produced or viewed.
  - The failure is logged under the same no-retry rule as other invalid evidence, so a bad 1202 parity can't be quietly re-run.

  This matters more at 1202 than it did at 1203. The 1202 artifact comes from the older `split-food` schema, so parity with the `alternating-food` model's `split-band` mode has never been shown for it.

**Non-blocking (fix in the plan text)**
1. **Interpretation mismatch.** The opening motivation says "large shift followed by trough and recovery". The gates test neither the trough nor the recovery. The plan already says they aren't gates. Add that a pass on 1202 is not evidence that the trough or recovery recurs.
2. **"If both pass" is vague.** Say it means Promising under all four screens, including the manual screen. Also name the mixed case: 1203 Promising and 1202 stops means "did not recur", with no adjudication.
3. **Static 1202 deltas.** These are computable from the existing artifact's samples without any new run. Freeze them in the plan before launch, or state that they are not looked at beforehand. Otherwise the "static also qualifies" caveat could be shaped by the new outcome.
4. **Selection.** Also disclose that 1202 was the original seed of the split-food study. It is not an independent draw from the survivor pool.
5. **Smallest scope.** Four things go beyond the single-seed run and are optional:
   - The 151-frame animation and same-age replay, which hit an encoding-height problem last time.
   - The pair kind and summary.
   - The 600-pulse test for seed 1202, which could be shortened to the one seed-offset difference (`seed%2304`).
   - The paired new decisions section.

   Make the media non-gating and deferrable. The accepted result should be the artifact, receipt and results doc.

I would fix B1 and B2 and apply items 1–3, then proceed.
