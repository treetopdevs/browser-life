# Bonded particle shapes pilot

Nine fixed runs: pursuit, mutation enabled, still food, seeds 1201–1203 × none/chains/mesh, target 6,000 ticks. No interventions or tuning. Runtime v24.2.0; base rules version 4; bond wrapper version 1.

| Mode | Seed | Completed | Extinction tick | Population range | Live edges | Linked components final (range) | Largest component ever | Live-edge fraction | Isolated fraction | Mean degree | Median live-edge age | Formed/stretch/death removed | Median lifetime stretch/death | Max abs ledger residual |
|---|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| none | 1201 | 6000 | — | 120–219 | 0 | 0 (0–0) | 0 | 0.000 | 1.000 | 0.000 | — | 0/0/0 | —/— | 3.90e-8 |
| none | 1202 | 6000 | — | 120–220 | 0 | 0 (0–0) | 0 | 0.000 | 1.000 | 0.000 | — | 0/0/0 | —/— | 3.98e-8 |
| none | 1203 | 6000 | — | 120–212 | 0 | 0 (0–0) | 0 | 0.000 | 1.000 | 0.000 | — | 0/0/0 | —/— | 3.93e-8 |
| chains | 1201 | 6000 | — | 114–220 | 169 | 49 (0–55) | 30 | 0.983 | 0.017 | 1.899 | 76.0 | 8410/16/8225 | 88.0/98.0 | 3.53e-8 |
| chains | 1202 | 6000 | — | 120–215 | 130 | 36 (0–54) | 32 | 0.897 | 0.103 | 1.667 | 78.5 | 8401/10/8261 | 90.0/98.0 | 3.50e-8 |
| chains | 1203 | 6000 | — | 120–211 | 142 | 37 (0–55) | 30 | 0.949 | 0.051 | 1.821 | 69.0 | 8948/11/8795 | 69.0/98.0 | 3.63e-8 |
| mesh | 1201 | 6000 | — | 118–211 | 248 | 9 (0–37) | 44 | 0.977 | 0.023 | 3.729 | 62.0 | 18808/23/18537 | 62.0/95.0 | 3.00e-8 |
| mesh | 1202 | 6000 | — | 95–216 | 254 | 11 (0–39) | 32 | 0.971 | 0.029 | 3.735 | 62.0 | 16866/30/16582 | 83.0/94.0 | 2.81e-8 |
| mesh | 1203 | 6000 | — | 98–209 | 252 | 10 (0–37) | 37 | 0.993 | 0.007 | 3.626 | 61.0 | 17420/32/17136 | 89.5/91.0 | 2.96e-8 |

All six bonded runs extinct before tick 1000: **no**. All nine outcomes are retained. No rescue, retuning, or parameter search was performed. If all six bonded runs cross the early-collapse stop, interpret the bonded arm as an early collapse and do not continue by changing parameters.

Edge labels use a fixed 100-tick reference, one census interval: median live-edge age ≥100 ticks is called persistent at this descriptive scale; median completed lifetime <100 among removed edges is rapid churn. The table reports actual medians rather than replacing them with labels. “Live-edge fraction” is the share of living particles incident to at least one live edge; “isolated fraction” is its unlinked counterpart; “mean degree” is 2E/N. Component counts include only connected groups of at least two particles; largest component is zero without edges. Population ranges and component-count ranges are retained per run to show whether populations emptied and graph groups grew, shrank, or stayed stable; components are not organisms. Null metrics mean the denominator or edge set is empty.

Lifetime records distinguish stretch breaks and dead-end cleanup before a step from endpoint death cleanup after a base step. A pre-step removal counts completed ticks through the prior state; a post-death removal includes the just-completed tick. Edge age is current tick − born tick + 1. The cumulative impulse counter sums each living particle’s net added velocity-impulse magnitude per tick. It is supplied steering, not work or energy, and is excluded from the base ledger.

Within each seed only, all three modes share an exactly equal initial base snapshot. None mode was compared as a full base snapshot against a directly stepped ParticleWorld at tick 0 and every 100 ticks plus extinction/final; comparison counts are in the JSON. Every living tick checks particle/food bounds, finite state, population and degree caps, edge validity, and ledger residual ≤1e-6. Maximum residual across all runs: 3.981e-8.

The full artifact contains sampled base censuses and graph summaries, every-tick invariant checks that abort on the first failure, cumulative formation/break/death and steering totals, removed-edge lifetime summaries by cause and removal stage, 100-tick deltas, ledgers, runtime/rules/source hashes, and the complete 3×3 matrix: [bonds-pilot.json](bonds-pilot.json). These are descriptive engineered-world outcomes; supplied bonds are not emergent organisms. Visual comparison is documented separately after the fixed-age browser captures are inspected.

Reproduce with node tools/particles/explore-bonds.ts. Freshness validation without simulation or writes: node tools/particles/explore-bonds.ts --check.
