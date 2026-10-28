# Travelling oases descriptive pilot

Nine fixed runs: pursuit, mutation enabled, seeds 1201–1203, still / slow (0.0001) / faster (0.00025), target 6,000 ticks. No interventions or tuning. Runtime v24.2.0; toy rules version 4.

| Environment | Seed | Completed | Final population | Overall range | Range after 1000 | Mean displacement | Contact-change fraction | Cap ticks | Extinction tick |
|---|---:|---:|---:|---|---|---:|---:|---:|---:|
| still | 1201 | 6000 | 154 | 120–219 | 134–172 | 0.002730 | 0.0106 | 0 | — |
| still | 1202 | 6000 | 162 | 120–220 | 132–177 | 0.002835 | 0.0111 | 0 | — |
| still | 1203 | 6000 | 152 | 120–212 | 131–174 | 0.002948 | 0.0120 | 0 | — |
| slow | 1201 | 6000 | 156 | 120–220 | 133–180 | 0.002832 | 0.0117 | 0 | — |
| slow | 1202 | 6000 | 173 | 120–223 | 129–183 | 0.002403 | 0.0090 | 0 | — |
| slow | 1203 | 6000 | 149 | 120–210 | 131–172 | 0.002933 | 0.0120 | 0 | — |
| faster | 1201 | 6000 | 159 | 120–223 | 128–168 | 0.003005 | 0.0124 | 0 | — |
| faster | 1202 | 6000 | 155 | 120–215 | 133–186 | 0.002484 | 0.0097 | 0 | — |
| faster | 1203 | 6000 | 150 | 120–213 | 131–176 | 0.002784 | 0.0112 | 0 | — |

Displacement is minimum-image distance for IDs surviving each tick, excluding births/deaths; the aggregate weights surviving-ID pairs equally. Contact-change fraction counts first-containing-patch changes among those pairs, including entry/exit and motion of the patches. Neither quantity establishes regrouping or following. Patch occupancy is geometric and double-counts overlaps; inside-any-patch fraction counts their union once. Supplied nearest-patch steering influences motion.

All moving runs extinct before tick 1000: **no**. No speed reduction applied. Maximum absolute energy-accounting residual: 4.153e-8. Population cap pressure is reported, not treated as success.

Full 100-tick censuses, patch stocks/occupancies, 100-tick interval aggregates of every-tick matched-ID displacement and contact counts, contact-transition matrices and exact source hashes are in [oases-pilot.json](oases-pilot.json). The evidence uses its own full history, not the page's rolling 3,000-tick chart. Replay is promised only within one runtime. The [visual inspection](oases-visual-check.md) records screenshot observations and local recording paths; those gitignored recordings are not shipped in this PR.

Reproduce: `node tools/particles/explore-oases.ts`. The [compatibility receipt](oases-still-compatibility.jsonl) is the stdout of `node tools/particles/check-still-compatibility.ts`; it verifies complete preserved v2 outcomes and the still-arm census prefix. Freshness check without simulation/writes: `node tools/particles/explore-oases.ts --check`.
