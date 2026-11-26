# I06 niche construction, first causal rung: result

Exploratory, CPU only (sim-ref), mutation off, no physics change. Evidence: `evidence.json` (sealed), `manifest.json`, `calibration.json` (dev only), `protocol.lock.json` (written before the amended fresh run). Page: `apps/lab/niche/` (local only; 404 on the deployed site).

## Result

**No verdict: the assay is measurement-limited (`unsupported-measurement`) for all three builder candidates** (M3 founder clusters 0, 4, 9 with the BUILD gene, receiver cluster 12; 8 fresh blocks each, T1 = 60 conditioning steps, T2 = 80 assay steps, 24x24 lattice with recurring injury and polymer shell). This is not a usable "no causal benefit detected".

Why: PLAN 5.3 calls a candidate adequately measured only when the builder left more polymer than the dev replicate noise floor delta. The builders leave a median polymer of 103.5, 98 and 84.5 against deltas of 341, 291 and 404, so none qualifies. The hand-built wall that shows the assay can see a polymer structure needed 1200 polymer (about 10x what builders leave) and was not detected at builder scale (120; W1 4/8, W2 3/8 positive on dev). The first pass of this slice reported "no causal benefit detected"; that headline applied a fixed polymer floor of 10 instead of the PLAN rule and is withdrawn (REVIEW.md).

For the record, the fresh-block contrasts (blocks positive out of 8, exact one-sided sign test; the gate needs all four, a median above delta, and Holm):

| candidate | builder vs nonbuilder | builder vs ablation | builder vs scramble | builder vs matched inoculum |
|---|---|---|---|---|
| cluster 0 | 4 (p 163/256) | 2 (247/256) | 1 (255/256) | 1 (255/256) |
| cluster 4 | 3 (219/256) | 2 (247/256) | 2 (247/256) | 0 (1) |
| cluster 9 | 4 (163/256) | 3 (219/256) | 6 (37/256) | 0 (1) |

Even read as plain contrasts none is near the gate. The receiver usually does better when handed the matter or energy the field held than in the conditioned field (matched-inoculum contrast negative in 23 of 24 blocks; medians -28, -24.5, -20). Receiver survival (receiver-labelled biomass above zero at the end of the assay), per arm, in the 8 fresh blocks of each candidate: 8 of 8 in every arm (a, b, c, cP, cNP, nb, ab, d0, d1E, d1B) for clusters 0, 4 and 9 (per-arm counts are in `fresh.candidates[].survivedByArm`). Growth (synthesis at least half the gain) was attributed in 0 of 8 builder-removed blocks for every candidate, so receiver-biomass differences are inventory, not growth.

## What this does and does not say

- The assay did not see a benefit, and it did not detect the hand-built walls at builder-scale polymer (120) on dev, so it is not shown able to see a benefit at the polymer scale these builders leave. A null at builder scale is weak evidence of absence, and the PLAN labels it measurement-limited, not negative.
- The dev positive control (W2, polymer floor under the receiver, 7 of 8 blocks, p 9/256) shows structure can be detected. It places polymer under the receiver, which the real placement rule forbids, and tests only the structure-versus-scramble contrast. The same wall run through all arms and all four gating contrasts (fixture `hand-wall-gate-W2`) returns `supported` (every contrast positive in 8 of 8 fixture blocks), so the gate is able to say supported; that does not show a builder's field can pass it.
- Receiver-alone comparators (d0, d1E, d1B) now carry the conditioning stage's net energy dissipation as named analytic heat, so total energy matches the conditioned field. Free energy E does not: the Sol review (post-fix) found free E at the start of the assay is higher in d0/d1E than in the builder-removed arm (cluster 0, seed 8600501: 9,917 vs 22,169, both totals 26,969), in all 24 fresh blocks. This is a known residual confound of the frozen protocol, not corrected (the protocol and evidence are frozen); negative inoculum contrasts cannot be attributed to extra inoculum alone. The inoculum-matched contrast is still negative in most blocks, because those controls hand matter to the receiver as living inoculum, which a modest spatial benefit may not beat (the strong hand wall does, by +33 to +270 in every fixture block). They screen resource totals; they do not prove no spatial resource effect.
- The biomass-matched control d1B matches bound biomass B only (amended from B + P): with B + P, a pure polymer wall lost to the control by about 800 and the gate could never certify a structure.
- Co-culture (arm a) flux attribution is unavailable: producing-cell ownership is not observed before injury clears a lineage. Attribution in the other arms was complete (no counter saturated).
- Builder cost is reported from census totals; `kGene` maintenance is `unavailable` (not separable in the reference step).
- Negative fixtures: energy-gift worlds (uniform, inside the footprint, in the halo annulus) are fooled by the naive metric (8/8 blocks positive) and caught by the scramble or the matched inoculum (the contrasts that fail are recorded per fixture as `caughtBy`); takeover-only raises receiver-labelled inventory (7/8 naive positive) with zero synthesis; the null field gives exact zeros; the four guard fixtures (overwrite, pool cap, underfunded reserve, exhausted reserve on disjoint empty cells) refuse as designed.
- Exploratory, one receiver genome, one field per candidate; not part of the frozen preregistration; not a statement that a second link is impossible.

## Pre-stated rules and amendments

Decision rules are PLAN 5. Amendments after the first pass had been observed (dev-calibrated or PLAN-text corrections, listed in `evidence.json` `amendments`): polymer adequacy follows PLAN 5.3 (replicate floor, not 10); d0 carries the net dissipation; d1B matches B only; co-culture attribution unavailable; medians reported as twice-the-median integers; full before/after inventories for every arm. The first fresh pass (seeds 8600101-8600108) was observed under the earlier rules and is superseded; the amended protocol was frozen and run once on new fresh seeds 8600501-8600508. Calibration (dev seeds) was re-run; the deltas did not change.

## Commands and results (this worktree, Node 24.2, machine under load)

```
pnpm typecheck                                  pass
node tools/niche/niche.ts --calibrate          dev only; deltas 341/291/404; W2 passes (7/8), W1 fails
node tools/niche/niche.ts --freeze --force     lock rewritten before the amended fresh run
node tools/niche/niche.ts --write --force      89 s (target 300 s)
node tools/niche/niche.ts --check              ok (no simulation)
node tools/niche/niche.ts --replay-check       see REVIEW.md "Source review dispositions"
```
Projected step budget including fixtures: 60,320 steps (`stepProjection`). The browser check of the page at 1280 px and 375 px from the first pass was not repeated after the page was rebuilt from pure section functions; the render tests cover stopped, invalid and normal payloads.

## Sealed inputs

`seed-registry.json` is hashed whole into `protocolHash`: an unrelated edit of the shared registry makes `--check` fail until artifacts are re-sealed. This coupling is intended (it is the cheapest way to bind the reservation); foreign collisions are checked separately by `seedCollisions`, which now also covers the fixture seeds.
