# Particle playground pilot

Three presets × seeds 1201, 1202, 1203 × up to 3,000 ticks. Mutation enabled; no interventions or tuning during this sweep. Same runtime: v24.2.0. Toy rules version 3; model SHA-256: `79fc847668a5f6337bd6b38d2e6831055516ddef98ded413e4a9488e1c28a8a9`.

| Preset | Seed | Final population | Births / deaths | Mutated births | Living max generation | Occupied bins / 100 | Mean speed | Ticks at cap | Extinction tick |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| flocks | 1201 | 144 | 2625 / 2601 | 454 | 5 | 10 | 0.000374 | 74 | — |
| flocks | 1202 | 121 | 2693 / 2692 | 490 | 6 | 14 | 0.000379 | 59 | — |
| flocks | 1203 | 150 | 2512 / 2482 | 458 | 5 | 12 | 0.000364 | 38 | — |
| pursuit | 1201 | 147 | 2041 / 2014 | 337 | 7 | 59 | 0.002954 | 0 | — |
| pursuit | 1202 | 141 | 2119 / 2098 | 386 | 7 | 66 | 0.002646 | 0 | — |
| pursuit | 1203 | 151 | 2075 / 2044 | 374 | 7 | 63 | 0.002803 | 0 | — |
| colonies | 1201 | 179 | 2933 / 2874 | 425 | 5 | 24 | 0.000599 | 44 | — |
| colonies | 1202 | 184 | 2934 / 2870 | 432 | 6 | 22 | 0.000605 | 49 | — |
| colonies | 1203 | 182 | 2931 / 2869 | 460 | 6 | 23 | 0.000593 | 52 | — |

## Interpretation and limits

- Presets extinct on all three seeds: none. Presets with no motion on all three seeds: none.
- These totals describe turnover, inheritance and motion under engineered rules. They do not establish adaptation, open-ended evolution, or long-term persistence. Visual watchability needs the separately recorded browser inspection.
- In this recorded pilot, flocks are a lower-motion, concentrated comparison to pursuit: the table shows slower average speed and fewer occupied bins. This is a descriptive comparison, not a settled-state score or new success threshold.
- Saturation is reported, not treated as success. The hard cap can influence competition; blocked birth attempts are retained in the JSON.
- Speed is averaged over every completed tick. Occupancy is a spatial summary at each 100-tick census, not a count of organisms or colonies. Trait spread includes founding-family differences.
- Maximum absolute energy-accounting residual across all runs: 6.819e-9 (floating-point arithmetic).

Full census histories and ledger totals: [pilot.json](pilot.json). Check evidence freshness without simulation or writes: `node tools/particles/explore.ts --check`. Reproduce with Node 24: `node tools/particles/explore.ts`.
