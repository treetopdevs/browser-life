# Reset claim-to-code map

Date: 2026-09-29. Paths refer to the foundations workspace. Baseline source bytes are preserved in `runs/foundational-reset/pinned-source-v1`; the final execution snapshot separately pins the observational additions.

| Claim | Implemented mechanism | Inference limit |
|---|---|---|
| Bound material moves | `packages/sim-ref/src/step.ts`, `transport`: integer shares of B, P and E arrive from a nine-site neighborhood, with rounding remainder retained by the source | A destination mixes multiple contributors; a genome tag is not a material tag |
| Genomes spread | Same transport function draws one genome source with probability proportional to incoming B+P; GPU counterpart is `transportShader` in `packages/sim-gpu/src/shaders.ts` | A minority-material source can win. Shared genotype or lineage does not identify a unique physical parent |
| Variation occurs | `mutateInPlace` changes one of NN_BYTES+3 slots; current genome has160 controller bytes plus mu, sigma and motility gain | No duplication, variable genome length, silent modules or genome expansion is implemented here. A proposed parameter delta can clamp |
| Mutation accompanies synthesis | `react` computes `newB` from photo and growth, applies a capped newB×mutRate threshold, emits at most one event per site per step and mints a lineage ID | The configured rate is not an independent mutation trial on every quantum. Effective genotype change, proposal and surviving mutant differ |
| Structure can be synthesized and lost | `react`: A→B via light or energy, B→P via energy, B/P→C through respiration, starvation and decay; C can return to A | Gross synthesis is not retained structure. B/P-only tracking omits recycled parent matter, so it cannot bound total origin tightly |
| Polymer changes local transport conditions | Flow/diffusion code reads local physical channels and configured coefficients | A detected polymer rim alone does not establish a stable organism boundary or collective heredity |
| Births are observed | `packages/metrics/src/census.ts` identifies four-neighbor components at B+P≥48; `tracker.ts` uses overlap, minMass256 and persistent IDs | Threshold crossings, movement and fusion can change identity. Fission is an observer inference, not a simulator reproduction instruction |
| Budding is attributed | `packages/runner/src/observe.ts` assigns a new birth to the nearest previously alive same-lineage individual within24cells | Proximity and lineage are hypotheses to audit, not causal parenthood |
| Historical observer state can resume | `restoreObservers`/`observeCensus`/`serializeObservers` preserve the common tracker, activity, counters and temporal sample | Additional lineageObs bookkeeping is not persisted. Its checkpoint continuation refusal must not be bypassed and called complete auxiliary parity |
| Reset copy descent is physically neutral | `tools/lib/reset-gpu-copy-audit.ts` reads pre/post state and actual displacement; only new assay buffers are written | Parity and exact path tests validate this observation, not reproduction, material origin or fitness |

No observer label, inferred parent, life-cycle score or assay classification enters the physical rules. Positive future founder searches must exercise mechanisms that exist, and report search assistance separately from spontaneous emergence.
