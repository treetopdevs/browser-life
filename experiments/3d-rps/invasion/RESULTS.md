# Amendment 4 result — 2026-10-25

**SELECTION-LEAD: 4/4 independent seeds passed under both marker IDs.** All sixteen arms finished the fixed 10000-step horizon. No stop rule triggered; no extension or mutation campaign was run.

Protocol and source were committed as `3168c86` before execution. Frozen manifest SHA-256: `36b0892bf1eb379f5f316d0ebfb0e4b7c70d289b9a6e7adbd4c8f340c91310e0`. Kernel base: `c62032dc`. The seed and treatment choices were fixed before data. This is a small positive-control screen, not a significance claim.

## Observations

Starting parent-group frequency was about 0.9994–0.9996% in every arm. The primary endpoint is the mean at post-introduction steps 8000,9000,10000, not the final snapshot. Both marker IDs produced identical census histories in each seed/arm; they are robustness repeats, not eight independent seeds.

| Seed | Immune final-window share | Neutral final-window share | Final marked cells, immune / neutral | Immune final global share | Final marked B+P, immune / neutral |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1101 | 5.680% | 0.000% | 8,720 / 0 | 3.414% | 239,939 / 0 |
| 1102 | 32.099% | 0.000% | 32,967 / 0 | 12.871% | 907,207 / 0 |
| 1103 | 20.691% | 0.212% | 22,589 / 108 | 8.814% | 625,563 / 3,976 |
| 1104 | 6.942% | 0.000% | 8,446 / 0 | 3.306% | 232,257 / 0 |

All three founding types remained present at the final census in every arm. Final total living-cell counts were 255395, 256128, 256277, 255508 in the immune arms and 257747, 257073, 252054, 254199 in the matched neutral arms. There is no demonstrated ecosystem survival advantage: both treatments retained their founding ecology over this short horizon. Full type counts, denominators, exposure proxies and marked biomass histories are in `results/s*-m*-*.json`.

## Validation and provenance

- Direct CPU/GPU protection, inheritance beyond introduced sites, predation-off equivalence and neutral replay passed before execution (`ENGINEERING.json`).
- Four assay unit tests and 31 companion tests passed. RPS typechecking passed.
- Every census passed state/conservation/event checks: exact matter and energy accounting, zero mutation events or dropped events.
- Post-run `audit.ts` decoded all 20 checkpoints, verified their recorded SHA-256 and final state/census data, checked all 244 frozen source entries, and recomputed the decision (`results/AUDIT.json`).
- Runtime: 798.335 seconds (13.31 minutes). Output: 1,174,608,827 bytes, below 2 GiB. All 184000 scheduled simulation steps completed.
- Full checkpoints remain locally at `runs/rps/invasion-a4-v1/`; their digests are committed in the audit. Small readouts, sites, progress hashes and provenance are retained in `results/`. The auditor was written after execution began and is not part of the frozen simulation manifest.

## Meaning and next decision

A deliberately introduced heritable predator-escape variant can spread relative to its unchanged ancestor. This clears the positive-control obstacle; it does not show that mutation can discover the variant, indefinite evolution, or improved ecosystem survival. Heritable competitive advantage and long-lived ecological diversity are separate goals.

The next justified step is a separately frozen fresh-seed confirmation, followed only if confirmed by a minimal type-only mutation test with mutation-off controls and ancestry evidence. Do not tune this successful assay or broaden to multiple genome knobs. Survival improvement needs its own later matched challenge and endpoint; it is not inferred from these frequency gains. No further campaign, merge, or deployment is authorized by this result record.
