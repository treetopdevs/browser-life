# Source-1 lifecycle traceability calibration

This is a bounded **in-situ observer calibration**, not a heredity estimate. It follows the authenticated original `m4/gradient-m3/treatment/seed-1` checkpoint from step 500,000 to 502,000. The 500k window was chosen after inspecting saved event density; it is not a representative or independently selected source window. The existing source-1 replay cache must have passed full terminal artifact and six observation-file equality checks. Nothing is transplanted or given a fresh seed; the original configuration, source seed and absolute step continue unchanged.

Plan only (the default):

```sh
deno run -A tools/foundation-lifecycle.ts \
  --source /Users/nicholas/develop/browser-life/runs/m4/gradient-m3/treatment/seed-1 \
  --cache runs/foundations/replay-gradient-seed-1 \
  --out runs/foundations/lifecycle-source1-500k-plan-v1.json
```

The separate bounded run requires an explicit flag, a fresh output path and a wall-time cap no greater than 120 seconds:

```sh
deno run -A tools/foundation-lifecycle.ts --execute --max-seconds 120 \
  --source /Users/nicholas/develop/browser-life/runs/m4/gradient-m3/treatment/seed-1 \
  --cache runs/foundations/replay-gradient-seed-1 \
  --out runs/foundations/lifecycle-source1-500k-result-v1.json
```

Both modes reserve a new report before expensive work and refuse an existing path. Execution restores the checkpoint's **full observer state**, including the existing `Tracker`. It reads a coherent cell/genome-head snapshot after each 100 original physical steps and checks the complete ordered `life.jsonl` event list at every census against the source. It independently computes all previous-ID-to-current-component overlaps from adjacent cell-label arrays. This catches crossing splits that the current Tracker can leave without a fusion event when both previous IDs continue in other components. The report retains the original event rows, overlap-mixing rows, all individual census trajectories, per-census label hashes and eligible/tracked counts. It measures the same terminal physics state a second time from the same checkpoint without census readbacks; exact hash equality and conservation are required for completion. Source/cache and selected code hashes are checked again after execution. A time cap, failed control or unavailable source remains an explicit incomplete/failed artifact. An indivisible GPU call can overrun the cap and is reported as such.

The new morphology readout uses actual component labels at each census. For every tracked component it records mass, cells, biomass, polymer fraction, cell-level membrane variation, rim-versus-core membrane difference, the existing `>0.15` compartment criterion, dominant lineage/purity, and member-cell A/C/E/S means. The A/C/E/S values are **internal component covariates**, not a matched external resource environment. Exact member-cell index ranges are retained for hash-selected family and control IDs; all other trajectories remain as numeric features plus their census-label digest. This does not turn the aggregate `morphology()` output into a per-individual measure or infer a compartment from a count alone.

The event graph reports raw parent→child→grandchild ID triples and stricter topology-clean triples separately. A clean link is an emitted fission edge with no logged fusion, independent overlap-mixing mark or death through that edge. Root IDs born at or before the checkpoint are left-truncated and cannot enter an age-matched triple. Unmatched births may be condensation or motion; budding is nearest-lineage observer attribution, so neither is promoted to a fission link. Because the largest-overlap fragment keeps the parent's Tracker ID and birth step, a triple is **three linked observer identities**, not three validated organism generations. Same-census mixing disqualifies a link even if the event log lacks a fusion row.

For every clean triple, the analysis checks whether the grandchild identity remains unmixed and observable at observer age 200, and **separately** whether that identity itself later fissions. Death, logged fusion, overlap mixing, right censoring and missing frames have different outcomes. All clean triples enter these outcome denominators; at most 16 are hash-selected for detailed membership ranges and matched trait records. Parent/child mass, polymer fraction and compartment status are compared at exact observer ages 100 and 200 whenever both frames exist. Missing ages are not replaced with zeros or excluded from event denominators. A detected split and a grandchild observed at age 200 do not prove that the grandchild itself reproduced.

Two descriptive comparison sets are attempted for selected triples. A nonlinked observer-family control must have a different known fission/budding root, the same tile, birth within one 100-step census, the same birth-mass log2 bin and the same coarse member-cell A/C/E/S bins; unavailable controls remain null. A second deterministic matched-parent reassignment chooses from other selected families under the same birth-time, mass and resource bins and excludes the focal known family. It samples with replacement and is **not** a bijective permutation or an inferential null distribution. All source-1 lineages may share historical genetic ancestry beyond the observed graph; “nonlinked” never means genetically unrelated. No p-value, independent-world interval or heritability coefficient is produced.

The source-1 garden pilot's exact shams and substantial intact-packet survival make a later linked common-garden assay plausible, but this in-situ calibration cannot establish transmitted structure or genetic inheritance. Garden extraction can still remove or alter a structure, and the observed packet outcomes are one-world feasibility evidence. A common-garden linked-trace protocol must retain extraction failures and resource accounting and compare known relatives with matched nonlinked material across independently sourced worlds before claiming transmission.
