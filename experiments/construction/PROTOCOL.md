# Constructed resource-retention witness, exploratory v1

This is a designed test of possibility in the existing exact integer physics, not a spontaneous-life or evolution claim. Workspace starts at main `03e5ff646a086e886bf1128f964f07f9b1a49292`. Existing registrations remain frozen.

## First candidate and reason

A stationary patch on a 32×32 torus starts with 1024 biomass and 2048 free energy, zero polymer and zero dissolved matter. Light supplies energy but no matter. Photosynthesis and decomposition outputs are127; respiration is energy-feedback controlled; BUILD is polymer-feedback controlled. The matched nonbuilder differs only in BUILD bias16→0. BUILD converts B+2E into P and pays ordinary work cost; polymer continues to decay. `gateK=1`, biomass decay500/65536 and polymer decay16/65536 establish a habitat where recycling and retention can matter. These are deliberately chosen experimental parameters, not the default ecology. Flow and spreading initially disabled to isolate chemistry; no propagation is expected in this first assay.

Exploratory pilot1 (16×16, nine cells, initial nutrient) showed no net builder benefit: dissolved resources returned cheaply. Pilot2 (32×32, one patch, no initial dissolved nutrient, higher biomass turnover) found a candidate: seed1 build16 retained623 B at3000; nonbuilder B0. Smaller builds retained less B, suggesting accessible partial forms. All pilot scripts/results are preserved under runs/construction/pilot; these observations selected the candidate and are NOT confirmation seeds.

## Controls and recording fixed before fresh seeds

Run seeds101–105 for3000 steps. Record exact per-step A/C diffusion across the founder-site boundary, active B (P excluded), assigned lineage B, catalytic assimilation, ordinary cumulative fluxes, construction expenditure, spatial support, final checkpoints/hashes and conservation residual. Record every100 steps. Every variant starts with exactly the same matter and energy for its placement count; no free initial structure.

1. Builder/nonbuilder × polymer gating on/off. The ablation only skips P in A/C diffusivity: BUILD/P/decay/flow remain. Require positive active-B and integrated-B advantage with gating, removed with ablation. Conservation and zero mutation required.
2. Screen a disclosed family of90 no-building constant/energy-feedback controllers plus generalist and12 M3 founders with BUILD disabled, seeds1–2,3000 steps. Rank finalB then integratedB. Confirm strongest available candidate on101–105 before claiming it was beaten. This is a bounded comparator search, not a proof of a globally optimal competitor.
3. Neighbours: matched nonbuilder at distances1,2,4, reflected placements, mechanism on/off, same seeds. Compare producer assigned biomass and assimilation. Stationarity prevents displacement/invasion; neighbour capture here means dissolved-resource competition only. Then enable small spreading1,2,4 to test that limitation. An inability to survive mixing blocks an ecological-robustness claim.
4. Accessibility: BUILD biases0,1,2,3,4,8,12,15,16,17,20,24 with the same feedback wire. Each adjacent integer is a legal one-byte mutation. Record costs and function: a smaller cost is not automatically a larger fitness payoff. A few hand-selected positive neighbours do not estimate global evolvability.

## Conditional later gates

Mutation-on searches are not justified by a stationary chemical advantage alone. Require the causal effect and return capture under meaningful competition first. Then freeze several founder variants/seeds with mutation and mechanism factorial controls, measure ecology and common-garden transfer. Second-opportunity test must show a distinct phenotype exploiting newly available habitat/resource; improved retention alone is bounded adaptation. Do not relabel survival duration or one-parameter BUILD tuning as the second opportunity.

## Reproduce

`deno run -A tools/construction-search.ts <new-output-dir>`

`deno run -A tools/construction-witness.ts core <new-output-dir>`

Replace core with access, neighbours or spread for those phases. Scientific assays use the CPU reference. The short native WebGPU golden suite subsequently passed all13 cases, including the optional control.


## Amendment — 2026-10-03, bounded stationary mutation assay

The preceding ecological-robustness prerequisite is retained for claims about a reproducing, spatially competing population. It is not a prerequisite for the narrower question of whether mutations can improve the demonstrated stationary retention function. Mobility was an additional requirement introduced in this protocol, not a requirement of the user's constructed-example task. Completed moving experiments and their recorded failures remain unchanged.

After the stationary cost, ablation, neighbour and partial-form assays, the bounded factorial in `EVOLUTION.md` tests mutation accumulation and differential persistence at occupied sites. With no bound transport, a site's genotype is replaced by mutation; offspring patches do not remain to compete. Ecological outcomes and equal-resource transfers must therefore be reported as such, even if heritable functional improvements appear. The fixed assay may return a negative result; it does not authorise repeated tuning until an improvement is found. A second-opportunity assay is conditional on its prospectively defined functional-improvement gate.
