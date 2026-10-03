# Implementation and experiment plan

Proposed 2026-10-04. No stages executed. This plan adds a workbench around capability tests; it does not authorize rerunning or revising closed construction experiments. See [design](/Users/nicholas/develop/browser-life/docs/evolvability-discovery-2026-10-04/DESIGN.md) and [council packet](/Users/nicholas/develop/browser-life/docs/evolvability-discovery-2026-10-04/COUNCIL.md).

## Stage 0 — Resolve the research contract and integration boundary

Read the construction workspace's current renewal plan and establish its reviewed implementation status. Record the exact revisions/files to reuse; do not assume rule-2 changes are in main. Agree on one owner for that assay implementation. The workbench consumes a stable case/observer API; it does not create a competing renewal runner.

Conduct the requested Fable 5 High council on these documents, then Sol 6.1 High review under the repository policy. Both must occur in a context where reviewers are allowed. Record model, effort, input digests, findings and dispositions. Revise the documents before protocol freezing. Review is not a scientific result.

Deliverables: frozen engineering acceptance cases, assay dependency map, parameter-domain proposal, evidence-status vocabulary, source/license inventory. Stop if the observer cannot distinguish synthesized biomass from transport, or if a baseline is available only in an unintegrated workspace without an agreed dependency.

## Stage 1 — One local, exact discovery case

Proposed files: `packages/schema/src/discovery.ts`, `packages/runner/src/discovery.ts`, `packages/metrics/src/capabilities.ts`, `tools/discovery.ts`, corresponding focused tests. Reuse schema validation, explicit genome encoding, artifact hashes, the reference simulator, and the reviewed renewal observer. Add a named export only where needed; do not add a package merely for organization.

Implement strict campaign/case/result schemas, immutable initial-state fixtures, a CPU case runner, per-step accounting and a pure reducer. Separate canonical scientific payloads from execution metadata. The first output is one complete case bundle and an independently reproduced readout.

Tests must cover real failure modes: typed-array round trips, source-buffer reuse, saturated counters, quantized transport, a passive deposit incorrectly appearing as renewal, a rotating active site, a missing census, duplicate case IDs, shared-seed block counting, and negative outcomes versus crashed runs. Keep physical positive-witness evidence distinct from synthetic reducer fixtures.

Gate: retained historical hashes, exact conservation/energy accounting, reproducible scientific payloads across two runs, and bounded output size. No broad search before this gate. Run focused TypeScript/Deno checks; run existing golden checks if any shared physics/serialization path changes.

## Stage 2 — Fan out and collect on two machines

Proposed files: discovery queue/controller/validator modules under `apps/coordinator`, discovery worker transport under `packages/runner`, `tools/discovery-worker.ts`, and a minimal browser worker page. Follow the coordinator's own AGENTS.md when implementation begins. Use a separate research namespace and data directory; preserve registered/public job behavior.

Implement capability/build qualification, leases, idempotent result publication, observation-required verification, bounded worker resources and complete-set export. Reuse existing artifact storage and lease mechanisms only after checking their semantics. Make CPU-only operation possible; GPU support follows exact observer qualification.

Demonstrate a fixed 12-case engineering campaign on the Mac plus a second physical host. These are plumbing/calibration cases, not independent evidence of evolution. Replay all 12; cap technical attempts at three per case per role. Inject disconnects, late uploads, duplicate completion, a coordinator restart, corrupt bytes and a wrong observer version. Confirm one accepted result per ID and identical final aggregation regardless of arrival order.

Gate: two distinct physical hosts, a browser and CLI route, successful recovery, all 12 results verified, and one reproducible export. If only the Mac is available, label local integration complete and cross-host proof pending; do not substitute two tabs for it.

## Stage 3 — Calibrate the capability battery

Run the separately reviewed and frozen nutrient/renewal experiment through the workbench adapter, preserving its exact cases, seeds, thresholds, source accounting and conditional confirmation rule. Its current proposal has 40 initial scientific histories and up to 20 conditional confirmations. Import valid existing artifacts by exact identity if that experiment has already run; do not repeat it casually or pool changed implementations.

Add separately registered calibration cases for light dependence and passive-material false positives. Proposal: no more than 16 extra logical cases before review. Technical replay does not enlarge the scientific sample. Source and observer compatibility are required before imported results are admitted.

Gate: causal retention evidence reproduced, null controls behave as specified, and measurement precision is established. If no renewal witness exists, report a renewal floor and advance only to the bounded diagnostic parameter map below. Do not start a renewal-optimizing adaptive search yet.

## Stage 4 — Bounded map of existing physics

Freeze a distinct protocol before running. Proposed map uses the witness's rule-1 settings, varying only:

| Axis | Values |
|---|---|
| `kCatHalf` | 64, 128, 256 |
| `diffA` and `diffC`, coupled | 50, 100, 200 |
| `spread` | 0, 1, 2 |

Hold `gateK=1`, decay/cost rates, energy constants, light, geometry, mutation-off policy and starting B/E fixed. Cross each of the 27 configurations with uniform A4/A16 habitats and the four specified arms: BUILD16 witness, one-byte BUILD0 match, selected nonbuilder, and builder with cost-retaining transport ablation. Resolve exact genome/initial-state hashes before launch. Reuse or integrate the reviewed ablation; do not approximate it by making construction free.

Two independent discovery seed blocks per configuration/habitat, with matched seeds across arms, give **432 logical cases × 10,000 steps = 4.32 million simulation steps**. The spread-zero rows are transport-disabled diagnostics; source-preserving off-site renewal is expected to fail there. A4 and A16 are separate resource regimes, not equal-budget competitors. Historical anchor runs use their original seeds and cannot be counted as fresh independent blocks.

Use the fixed renewal readout; display maintenance, losses, transport and threshold sensitivity as secondary information. Freeze at most three candidates for confirmation using, in order: worst-habitat renewal fraction among biological founder arms, worst-habitat source persistence, then candidate hash. Only spread-positive candidates are eligible; require renewal in both discovery blocks for at least one same founder/habitat combination. Admit fewer than three if fewer qualify.

Confirm shortlisted candidates using five new independent blocks and every original arm in both habitats: maximum **120 cases / 1.2 million steps**. A finite renewal capability is confirmed for a specified founder/habitat if it passes at least four of five blocks. Do not use different successful founders in each block to manufacture a pass. Construction-specific benefit additionally requires the matched cost-retaining comparisons; generic renewal need not depend on BUILD.

These are engineering screening gates, not a universal statistical significance claim. Report per-block data and uncertainty. Candidate configurations and matched arms share the two discovery blocks; they are not hundreds of independent evolutionary replicates. After seeing confirmation, do not substitute another candidate from the discovery grid under the same confirmation protocol. Full independent replay makes the Stage 4 maximum 1,104 case executions / 11.04 million steps before technical retries; it does not double the scientific sample.

Stop the parameter map at its registered limit. If no candidate passes, classify the dominant tested bottleneck using accounting and controls. Return a new hypothesis about density, retention/access tradeoffs, or inheritance; do not infer impossibility across all physics. A broader law family requires a separate reviewed proposal.

## Stage 5 — Test whether diversity search earns its complexity

Only if calibrated capability variation exists, compare an IMGEP-style archive with random sampling. Proposed larger rule-1 domain:

| Axis | Values |
|---|---|
| `kCatHalf` | 32, 64, 96, 128, 192, 256, 384, 512 |
| coupled `diffA/diffC` | 25, 50, 100, 150, 200, 250 |
| `spread` | 1, 2, 4, 8 |
| `gateK` | 1, 2, 4, 8, 16, 32, 64 |

Validator/observer bounds must approve every candidate before this domain is frozen. Preserve all other settings. Use the archive/proposal algorithm in the design. Each method receives the same eight fixed anchors followed by sixteen proposals: 24 candidate evaluations per campaign block. Use three independent campaign blocks, two methods, and 16 case evaluations per candidate (two habitats × four arms × two within-campaign seed blocks): maximum **2,304 logical case evaluations / 23.04 million steps**, plus verification. Repeated identical inputs can reuse content-addressed results, but still consume the same evaluation allocation in both methods. Report avoided compute explicitly.

Primary comparison: coverage of the frozen capability bins at equal evaluation budget; also report valid-candidate count, confirmation yield, failure rate and accepted throughput. Discovery seeds must be independent across campaign blocks. This small comparison can support a practical method choice, not a strong universal superiority claim.

A search method earns continued use only if its apparent advantage transfers to a separately frozen shortlist test on fresh seeds and withheld founder/habitat conditions. Specify and price that test before starting Stage 5; cap its first version at 120 cases. If not, keep the simpler map/random method. No unseen-condition result may feed back into that same confirmatory search round.

## Stage 6 — Evolutionary accessibility, opportunity and disturbance

Develop separate protocols for functional transmission, viable local mutants, and competitive establishment under frozen laws. Start from multiple fixed founders; report genotype-specific effects and shared random inputs. There must be actual coexisting inherited variation capable of differential success; a single site whose genome gets replaced only establishes mutation accumulation.

Once accessibility is demonstrated, test one causal opportunity chain with matched field/strategy removals and reconstructions. Only then conduct the calm/stress × mutation-on/off experiment, including source costs, extinctions and common-garden descendants. These later protocols need their own budgets and power/sensitivity planning; they are not automatically launched by the first positive renewal case.

Gate: inherited cumulative capability gain with predeclared controls. If it fails, preserve the useful world and the negative evolutionary result separately. Revisit mutation/connectivity/interaction mechanisms before extending time horizons.

## Tactical compute rollout

| Order | Action | Proof before the next step |
|---|---|---|
| 1 | Run the private coordinator/site from one pinned release and distinct data volume | Restart and artifact restore tested; registered/public queue untouched |
| 2 | Join Mac CPU worker, then qualify Mac GPU where useful | Identical reference state and observations; throughput/storage measurements |
| 3 | Open the worker page on the work laptop; use CPU mode if GPU unavailable | A real accepted and independently replayed case; no install required beyond the browser route |
| 4 | Add desktop by browser or the same Deno CLI | Disconnect/rejoin works; resource controls are usable |
| 5 | Export and independently reduce a complete campaign | Same case set, hashes and scientific decisions as local execution |
| 6 | Optionally add one bounded AWS worker | Correct AMI/runtime/device, current regional price, accepted cases/hour, and automatic lifetime limit |
| 7 | Add more AWS workers or an AWS Batch launcher | Queue can feed them; store/network are not bottlenecks; cost envelope covers replay and transfer |

Existing legacy commands, from a checkout matching the coordinator, are `deno run -A tools/island.ts --coordinator URL --label NAME` and `deno run -A tools/stitch.ts --coordinator URL --experiment NAME --require-observations-verified`. They are evidence of a head start, not commands for the proposed discovery tasks. With the latter flag, every included legacy segment must have matching observation verification; use an appropriately verified campaign.

Networking choice: private Tailscale Serve to a combined site/API when available; otherwise an approved HTTPS endpoint with research admission. The browser page and API should share an origin. Do not deploy the Vite development server as the remote production worker site. Do not expose Erlang distribution ports to workers.

Before any large campaign, benchmark at least three representative cases including observer and upload costs. Estimate `wall time ≈ logical cases × measured median case seconds × replay multiplier / effective concurrent workers`, then account for slower hosts, outages and upper-percentile cases. Measure GPU contention; default to one GPU worker per physical device. Worker-seconds are reported by backend and cannot be equated across heterogeneous machines without measurement.

The default cloud allowance is zero until a concrete launch manifest supplies region, instance/image, count, lifetime and maximum projected spend. No AWS provisioning is performed by this plan. Local cases also have wall-time, storage and retry caps. Reaching a cap yields an incomplete report, not silent downsampling or a changed scientific stopping rule.

## Review and release gates

Run focused tests for each seam, the full relevant suites before release, native/browser golden checks for qualified backends, and the coordinator integration/failure tests. Require Sol 6.1 High read-only review at phase boundaries and before commits, plus the requested Fable scientific/design review. Never mark an unavailable review as passed.

Ship in four reviewable increments: (1) local case contracts and exact observer, (2) discovery queue/worker/export, (3) calibrated capability map, (4) optional diversity search. Cloud provisioning, WASM acceleration, new law families and later evolutionary assays stay separate. This makes each increment useful even if the next scientific hypothesis fails.
