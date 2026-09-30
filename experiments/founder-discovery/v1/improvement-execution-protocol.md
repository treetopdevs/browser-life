# Fixed-founder improvement experiment — execution protocol

Finalized 2026-09-30 before any study histories. The competition pilot passed and its independent analysis matched byte-for-byte; the runner and fixed engineering workloads are complete. Release still requires the frozen study manifest and reviewed resource envelope. No paid compute is authorized by this protocol.

## Question and fixed experimental units

Under unchanged RULE_VERSION 1, do the four shortlisted founding genomes produce descendants with repeatably better ancestral competitive performance when mutation is enabled than when it is disabled? The result is conditional on these deliberately prepared founders, the gradient environment and the standardized competition assay. It does not establish organism reproduction or unrestricted evolutionary capacity.

Use all four shortlisted founders, in shortlist order, without replacements: discovery-cluster-33, discovery-cluster-4, discovery-cluster-16 and discovery-cluster-139. Run each founder separately on evolution seeds 6410001 through 6410008, in normal and mutation-disabled conditions: 64 histories. This is a fixed-founder adaptation experiment, not the previously proposed randomized founder-policy comparison. Historical founder-policy findings and its failed pilot remain unchanged.

Each evolution world uses the full 256 by 256 `gradient-m3` preset physics. Initialize one radius-12 disc at (128,128), with nutrient 32, biomass 64 and energy 128. Normal and disabled partners share the same seed, genome and physical initialization. The sole condition difference is mutation rate: the preset rate versus zero. Preserve the normal preset rate in the manifest rather than restating an approximate frequency. The initial copy lineage is the only founding ancestry in each history; empty helper-array slots are not biological observations.

Sample exact steps 0, 100,000 and 1,000,000; 1,000,000 is the sole confirmatory endpoint. Intermediate results are descriptive and cannot choose an endpoint or stop a successful-looking run early. Freeze every unit and sampling seed before execution. Allocate sampling seeds 6420001 through 6420384 in fixed founder, evolution-seed, mode (normal then off), time, and draw order. Use two mass-weighted draws with replacement per time; preserve duplicate genomes and repeated draws.

## Exact-state evidence and resumption

Read complete normalized genomes from the exact state. Resolve copy lineages through recorded mutation-parent edges to the sole founder. Report B/P abundance by genome, total retained ancestry mass, unassociated material, unresolved mass and every requested draw. Biological absence, unresolved ancestry, malformed state and missing checkpoint are distinct outcomes. Unknown ancestry must never be converted into extinction or silently replaced by a surviving genome.

Here `absent` means no retained founder-associated **genome** mass. Positive B/P with lineage 0:0 remains separately reported as unassociated material; it supplies no carried genome to sample. A nonzero carried lineage with an unresolved parent graph is a different, technical uncertainty. Neither a genomic absence nor an unassociated-material measurement establishes organism extinction or the loss of founder-derived material.

Drain the existing mutation event ledger every 100 steps, checking the exact step and rejecting dropped events. This is observation of the unchanged simulator, not a new inheritance mechanism. Mutation-disabled histories must retain their supplied genome, with no mutation edges or unresolved carried ancestry. A contradictory state is a technical failure.

Keep immutable physical checkpoints at initialization and every 100,000 steps. Store mutation-parent edge additions per checkpoint interval rather than repeatedly copying the complete accumulated ledger. Each checkpoint receipt binds its unit, manifest, exact step, physical state hash, checkpoint bytes, edge delta, previous receipt and any scheduled sample. Write the complete receipt last. Resume only a contiguous, hash-verified chain, reconstructing all required ancestry and scheduled samples. A partially written artifact must be verified or explicitly diagnosed; never skip it and advance from a nearby checkpoint.

Completed histories may use a verification cache on resume: verify every checkpoint, edge delta and receipt byte hash and the contiguous receipt chain, then reuse the previously computed scheduled samples bound to that chain and frozen manifest. Unfinished histories receive full semantic validation. Final analysis independently recomputes all scheduled samples from the physical checkpoints and ancestry deltas; cached samples cannot substitute for that final check.

Run in bounded local tranches, stopping between checkpoint intervals. Preserve all 64 histories even when an ancestry becomes absent. No favorable-outcome early stopping and no replacement seeds. Resource interruption changes completion status, not the roster or denominator.

## Competition observations

Use the exact geometry, material and attribution implementation validated by the pilot: full gradient chamber, two equal radius-12 discs at (64,128) and (192,128), nutrient 32, biomass 64 and energy 128, mutation disabled, 20,000 steps. Each sampled genome competes against its own original founding genome.

Use assay seeds 6430001 through 6430004 and all four position/lineage-label assignments. Every requested draw retains references to its 16 technical observations. Cache only exact equality of both genomes, full assay configuration, seed, assignment, duration and frozen executable identity. A cached result retains every requesting observation's reference; it does not create independent replication.

Signed score = (descendant-associated B/P minus ancestor-associated B/P) / their total. A one-sided extinction is a win or loss; both extinct is unavailable. Biological absence of a sampled ancestry leaves its draw and assay slots unavailable. Technical missingness must be repaired or the experiment declared incomplete. Never infer an unavailable competitive score from ancestry extinction.

There are 384 requested genome draws and 6,144 requested technical competitions. If mutation-disabled identity is verified, the conservative maximum distinct competition configurations is 2,112: 2,048 for normal-mutation draws at the two nonzero times, plus 64 identical-founder competitions shared across baseline and mutation-disabled observations. If actual cache identities exceed this forecast, stop and diagnose before expanding resources. Missing observations remain explicitly represented in the full requested roster.

## Estimands and decision

For each history and time, average the 16 technical observations within each draw, then the two draws. Preserve equal fixed weights for unavailable slots. Compute paired normal-minus-disabled raw endpoint scores, average the four fixed founders within each matched evolution-seed block, and report all eight blocks. The primary analysis receives raw scores in [-1,1], not individual baseline changes in [-2,2]. Time-zero clone competitions are calibration. Any displayed baseline-adjusted contrast must use identical shared baseline references and weights so that baseline cancels algebraically.

Report conditional available-case estimates with their denominators, and full completion bounds assigning unavailable scores their entire [-1,1] range. Do not present conditional estimates as full-roster effects. Report the mean and bounds, founder-specific effects, ancestry retention, descendant abundance and both-extinct frequency together.

The confirmatory repeatability test certifies a seed block only if its conservative full-completion lower effect bound exceeds 0.10. Require at least seven of all eight fixed seed blocks. Ties and uncertified blocks are nonsuccesses. Under the stated independent identically distributed evolution-seed-block model with success probability at most one half, the exact one-sided tail probability is 9/256. This supports majority/typical seed-block improvement conditional on the fixed founder set and assay seeds, not positive mean improvement or improvement for every founder. Always report the mean and full bounds alongside; a minority of large losses can outweigh typical gains.

Use fixed-seed 6450001, 10,000 whole-seed-block bootstrap resamples for approximate descriptive mean uncertainty. Founders and assay seeds are fixed, not resampled independent biological units. Report retention descriptively; an observed normal-minus-disabled difference no worse than -0.05 is a loss safeguard, not statistical noninferiority. Eight blocks cannot establish a precise five-percentage-point retention guarantee. Negative mean performance or meaningful observed retention loss accompanying a repeatability result is a tradeoff, not an unqualified success.

Failure to meet the repeatability criterion is not proof of no adaptation, practical equivalence, or an adequate-power null. Technical incompleteness prevents a definitive interpretation. The pilot establishes availability and accounting, not a universal sensitivity to genetic advantages. Role counts, regeneration, morphology and intermediate-time descriptions cannot replace the endpoint or select a favorable analysis.

## Release and closeout

The preliminary step-only estimate is 29–42 local GPU hours, before mutation-ledger, readback and storage overhead. Physical checkpoint payloads alone total approximately 9.4 GB at the planned spacing. These are planning figures, not measured whole-study guarantees. Benchmark the actual observation path and assay implementation, account for ancestry metadata and existing free storage, and freeze the complete resource envelope before release. No silent reduction of replication or unbounded partial launch is allowed.

The measured forecast separately counts 64 million evolution steps with ledger drains, 640 nonzero checkpoint GPU readbacks, 704 checkpoint semantic checks and writes, 192 scheduled physical-state samples (384 draws), up to 2,112 distinct competitions, and verification overhead for every planned bounded invocation. Add explicit headroom for GPU initialization, growing ancestry graphs and variability; record the free-storage floor and cumulative execution ceiling. A synthetic completed-chain cache benchmark measures resume overhead without supplying study observations.

Reserve seed 6460001 for two engineering workloads after pilot acceptance: the first fixed shortlisted genome in the standard single disc and in a constructed dense initialization, each for 10,000 normal-mutation steps with the planned 100-step event drains. Record timing, state readback and edge-storage size only for forecasting. These are not study histories, do not choose founders or thresholds, and cannot be included as evolutionary evidence. The separately recorded dense-state CPU sampling benchmark is likewise a constructed workload, not a biological result. The inspected document/manifest reservations contained no earlier use of this engineering seed.

Keep the separate ecology program, frozen capability artifacts and failed historical pilot untouched. Record final completion/missingness, resource use, reviewed interpretation and dated decision. Preserve negative outcomes and limitations, and commit the reviewed work. No rule, mutation-locus, predation, season or body-definition change is part of this experiment.

The launch envelope is local-only: a 72-hour forecast, 96-hour cumulative execution ceiling, 64 GiB estimated storage allowance, and 20 GiB minimum free-space floor. The accompanying resource report derives these values from preserved engineering measurements and explicitly separates measured timings from projected overhead. These limits do not change the fixed roster or stopping/analysis rules.
