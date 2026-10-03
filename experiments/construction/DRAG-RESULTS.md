# Polymer-drag pilot: negative

The fixed seed-1 pilot failed its constructed-function question. All six arms have **zero active biomass at both 3,000 and 10,000 steps**. Polymer drag and dissolved retention modestly delay biomass loss, but do not maintain the active chemistry after paying construction costs. No tuning, fresh-seed confirmation, mixed-neighbour experiment or mutation assay under this drag law followed this result. The separate rule-1 stationary mutation assay tests the previously successful witness.

The [prospective protocol](DRAG-PROTOCOL.md) fixed the stationary witness resources and genome, changed only the stated transport settings, and included the full drag × dissolved-gate factorial plus two nonbuilding comparators. All runs executed the complete 10,000 steps on CPU `RefSim`; the later polymer values are measured checkpoints, not extrapolations.

| Arm | Integrated B through 10,000 | Construction B / free E spent | P at 3,000 / 10,000 | First sampled B=0 |
| --- | ---: | ---: | ---: | ---: |
| Builder, drag on, gate on | 293,565 | 100 / 200 | 54 / 10 | 1,400 |
| Builder, drag on, gate off | 251,760 | 89 / 178 | 45 / 9 | 1,100 |
| Builder, drag off, gate on | 278,786 | 93 / 186 | 51 / 11 | 1,200 |
| Builder, drag off, gate off | 243,154 | 87 / 174 | 45 / 10 | 1,100 |
| Matched nonbuilder | 282,340 | 0 / 0 | 0 / 0 | 1,100 |
| Selected simple nonbuilder | 283,904 | 0 / 0 | 0 / 0 | 1,100 |

Integrated B is the sum of post-step world B at every executed step, excluding P. It is already at its final value by step 3,000. Construction expenditure is actual cumulative BUILD conversion and its free-energy charge; normal work and maintenance costs also remain active. The first zero observation is sampled every 100 steps, so it is not an exact extinction time. The selected simple controller is the strongest from the disclosed stationary search, with no optimality claim for this changed ecology.

The fully enabled builder increases integrated B by 4.0% over the matched nonbuilder and 3.4% over the selected comparator. This is a transient benefit, not the persistent function sought. It is also consistent with dilution limiting the mechanism: by step 100 its remaining 784 B occupies 21 sites, 685 B lies outside the original site, and no site contains more than 99 B. The pre-step diagnostic for transport step 99→100 measures 3 B leaving the original site and 0 entering. By step 1,000 only 9 B remains. These observations support an early dilution diagnosis; this pilot does not identify a general impossibility theorem for polymer drag. Persistent P after B extinction is not evidence of life or propagation.

Artifacts are retained in `runs/construction/drag-pilot-v1/`: prospective `manifest.json`, 18 source snapshots, six initial and twelve endpoint checkpoints, all six 100-step traces, `summary.json`, and the independent artifact-audit `verify.ts` / `readout.json`. The audit passed for all **18 checkpoints, 606 trace rows and 18 source hashes**: exact equal initial resources, configuration and genome matches, zero mutation, state-hash agreement, zero matter and energy residuals, endpoint reaction costs, and transport bookkeeping. Source snapshots still matched the working files at verification. Integrated B was calculated every step by the harness; the independent saved-artifact audit checks its monotonicity and endpoint consistency, rather than claiming to reconstruct it from 100-step samples.

The harness passed Deno type checking. Its B-transfer diagnostic was separately checked against observed diffusion-only CPU steps in eight cases spanning drag on/off, two seeds, and centre/wrapped-edge patches; diagnostic calls left state hashes unchanged. B-transfer observations describe the single executed transport step at each census, not cumulative B movement. A/C transfers are integrated exactly around the original site. Spatial peaks are sampled peaks.

Reproduce into a **new** output directory:

```sh
deno run --allow-read --allow-write --config deno.json tools/construction-drag.ts runs/construction/drag-pilot-replay
```

This negative result leaves the earlier successful stationary witness and failed moving confirmations unchanged. The pressure-based transport proposal remains unimplemented and untested; this result does not authorize a further law or parameter sweep.
