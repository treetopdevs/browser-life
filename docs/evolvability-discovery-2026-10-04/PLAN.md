# Implementation and experiment plan

Canonical after council, 2026-10-04. No stage has been executed. The user's decisions D1 and D2, taken the same day, are applied here. This plan adds a workbench around capability tests. It does not authorize rerunning or revising closed construction experiments, and it does not touch the frozen transition hunt. See the [design](DESIGN.md) and the [council record](COUNCIL.md).

## Stages at a glance

| Stage | Work | Needs | Gate to pass |
|---:|---|---|---|
| 0 | Ownership, boundaries and records | – | Not one gate: each item below gates only the stage that needs it |
| 1 | Renewal tooling, in the construction workspace | Stage 0's recorded owner and revision | Tests, pins, golden checks and Sol review pass; protocol frozen before any scientific trajectory |
| 2 | The renewal experiment, exactly as frozen | 1 | Independent audit and predetermined replays agree; closed under its own rules |
| 3a | Workbench core and calibration battery | Stage 0's reviewed engineering manifest and caps; the renewal observer needs 1 and the dependency boundary; imports need 2 | Controls behave; complete-case cost measured; imported artifacts validate; two hosts by shards |
| 3b | Workbench plane: the distributed queue and workers | The engineering part of 3a's gate | Every operational criterion in the PRD passes |
| 4a | Bounded diagnostic map of rule-1 parameters | 2 closed, 3a | Frozen protocol with a measured budget; confirmation on fresh blocks and held-out founders |
| 4b | Conditioned-field opportunity test | 3a | Conservation-defined intervention validated; screen, then fresh confirmation |
| 5 | Selection and accessibility | A renewable regime from 2 or 4a | Selection distinguishable from drift and lottery effects |
| 6 | Search comparison (optional) | 4a shows descriptor resolution | Declared estimand; priced fresh-condition validation |
| 8 | Predictive bridge, evolving-world comparisons, disturbance | 4a and 5 | Bridge frozen with a pass criterion, independent histories, assay sensitivity and full cost. Later comparisons rely on the map only if the bridge passed |

Two workstreams run in parallel. The construction workstream does Stages 1 and 2. This workstream builds the workbench, 3a and then 3b, and does not wait for them. The user decided on 2026-10-04 (D1) to build the whole workbench now, the distributed plane included, so that compute fans out for the science. That decision moves no scientific gate. Stage 4a still needs a closed renewal experiment, and nothing later than Stage 3 starts on an estimate: each campaign's budget comes from the Stage 3 benchmark.

Stages 4a and 4b are independent of each other. Campaigns from Stage 4 on are submitted through the plane. A campaign that is ready before 3b's gate passes may run by shards over the same manifest; its case identities do not change.

The plane was Stage 7 in the council's ordering. That number is retired, not reused, so stage references in the reviews and the council record stay readable.

## Stage 0 — Ownership, boundaries and records

The council has happened: the addendum, Astra's review of it and the dispositions are in the [council record](COUNCIL.md), and the Sol 6.1 High review of this document set is recorded there too. What remains is deciding and writing down.

Stage 0 is not one gate, and neither workstream waits for the other's items. Stage 1 needs item 1 to start, and item 3's seed check before its freeze. Stage 3a needs item 5 before it executes anything. Item 2 is needed when the renewal-observer adapter is built, and by the calibration battery and every campaign with an ablation arm.

1. **Record the renewal owner** (decision D2, taken 2026-10-04). One owner in the construction workstream implements and runs the [renewal plan](../../../browser-life-construction/experiments/construction/RENEWAL-PLAN.md), on the reviewed revision that plan names or a documented descendant. The plan itself names no person or session, so the owning session and the exact revision go into the council record when Stage 1 starts. This workstream does not edit that workspace and does not create a competing renewal runner. It hands the owner the three requests listed under Stage 1.
2. **Fix the dependency boundary** (decision D5). The cost-retaining ablation (`polymerTransport: false`) exists only in the unlanded construction workspace, beside experimental rule-2 code. Stages 1 and 2 run inside that workspace and need nothing landed. The workbench is built and demonstrated on the engineering campaign with code already in `main`. The renewal-observer adapter, the calibration battery and every campaign with an ablation arm need either a minimal reviewed extraction into `main`, or execution pinned to a named construction revision. Record the exact revisions and files to reuse. Do not assume rule-2 changes are in `main`.
3. **Record the namespaces.** Construction results, discovery results and registered experiments stay in separate roots with separate seed ranges. Check the proposed seeds against the registry in `docs/plan.md` before any freeze.
4. **Settle the remaining decisions.** D1 and D2 are taken. D3, D4, D6 and D7 keep their defaults in the council record until the user says otherwise. Two come due early: D6, the second physical host and the browser and CLI routes, before Stage 3a's two-host check; and D4, the caps and any cloud allowance, before the plane takes a scientific campaign.
5. **Write the engineering manifest and the initial caps.** The manifest has twelve cases: six fixtures on two engineering-only seeds each, all on artificial states and none in the reservoir witness habitat. The fixtures are passive transport at `spread` 0, 1 and 2, a reacting world with exact ledgers, a world that goes extinct, and a world that exercises every census and checkpoint path. Expected outcomes come from the CPU reference. Proposed initial caps under D4, until the Stage 3 benchmark replaces them: four concurrent cases per host, ten minutes per case, two hours and 2 GB per campaign, and three technical attempts per case per role. Stages 3a and 3b both use this manifest. It and the caps are reviewed before Stage 3 executes anything.

Deliverables: the recorded owner and revision, the assay dependency map, the reviewed engineering manifest and caps, the parameter-domain proposal for Stage 4a, the evidence-status vocabulary (supported, unsupported within the tested domain, invalid or incomplete, unsupported measurement), and the source/license inventory already in [RESEARCH](RESEARCH.md).

Stop if the observer cannot distinguish synthesized biomass from transport, or if a baseline is available only in an unintegrated workspace without an agreed dependency.

## Stage 1 — Renewal tooling, in the construction workspace

The owner implements work packages A to D of the renewal plan as written there: the protocol and case enumeration, the read-only per-step observer, the pure readout and durable runner, and the independent verifier and report. That plan is the specification. This document adds nothing to its protocol.

This plan asks the owner for three additions to the test and fixture list. None changes a threshold, a seed or a decision rule.

- **Transport-band fixtures.** The exact table in RESEARCH for `spread` 0, 1 and 2 (and 4 and 8 for later domains), each checked against a passive reference run on an artificial state.
- **Energy-accounting tests on artificial states.** A founder with B 64 and E 128 at `spread` 1 exports free energy and no biomass. GROW funded by stored E raises B in a step. The integrated inequality in RESEARCH holds on a reacting fixture.
- **Per-site E accounting, if the owner wants the energy-dependence readout in the renewal report.** It must enter the protocol before the freeze.

No scientific trajectory runs in this stage. Initialization tests do not execute the scientific seeds, and dynamics fixtures use artificial states.

Gate: the renewal plan's own gates 1 and 2. Focused tests, `pnpm typecheck`, the Deno checks, the unchanged golden pins, the native GPU golden suite, the full Vitest suite once, and a read-only Sol 6.1 High review. Then the freeze, which initializes states and executes zero steps.

## Stage 2 — The renewal experiment

Run the 16 controls, then the 24 main cases, the predetermined replays and the independent audit; then the confirmation only if a habitat qualifies. Close the study under its original thresholds and its negative-result rules. A technical failure is incomplete, not a biological negative.

The outcome table in the renewal plan governs what may be said. For this plan the outcomes mean:

| Renewal outcome | Effect here |
|---|---|
| Confirmed, construction-specific or not | A renewable regime exists for the tested panel. Stage 4a maps around it and Stage 5 may start |
| Pilot qualifies, confirmation fails; or no habitat qualifies | No renewable regime is established. Stage 4a may still run as a diagnostic, with a protocol that says what it is diagnosing. Stage 5 does not start |
| Invalid or incomplete | Nothing downstream imports it until it is revalidated |

The renewal accounting (local synthesis, reaction balance, imports, reservoir depletion) is also the evidence for choosing Stage 4a's axes.

## Stage 3a — Workbench core and calibration battery

This stage starts now and does not wait for Stage 1. The contracts, the runner, the validator, the reducer and the two-host check are built and proven on the Stage 0 engineering campaign, which needs only code in `main`. Three pieces wait: the adapter to the renewal observer, which needs Stage 1's stable API and the D5 boundary; the benchmark that prices scientific campaigns, which needs that observer; and the calibration imports, which need Stage 2.

Proposed files: `packages/schema/src/discovery.ts`, `packages/runner/src/discovery.ts`, `packages/metrics/src/capabilities.ts`, `tools/discovery.ts`, corresponding focused tests. Reuse schema validation, explicit genome encoding, artifact hashes, the reference simulator, and the reviewed renewal observer. Add a named export only where needed; do not add a package merely for organization.

Implement strict campaign/case/result schemas, immutable initial-state fixtures, a CPU case runner with one observer interface, the acceptance validator, and a pure reducer. Add the `freeze`, `run`, `replay`, `validate` and `reduce` operations of [DESIGN](DESIGN.md) section 5. The engineering fixtures use observers already in `main`; the reviewed renewal observer plugs into the same interface through its stable API when Stage 1 delivers it. Separate canonical scientific payloads from execution metadata. The first output is one complete case bundle and an independently reproduced readout.

Tests must cover real failure modes: typed-array round trips, source-buffer reuse, saturated counters, quantized transport, a passive deposit incorrectly appearing as renewal, a rotating active site, a missing census, duplicate case IDs, shared-seed block counting, and negative outcomes versus crashed runs. Keep physical positive-witness evidence distinct from synthetic reducer fixtures.

Validator tests cover: a missing required file, a wrong observer version, corrupt bytes, an incomplete attempt, and two hosts' results for one case that disagree. The runner must validate an existing result before skipping it.

**Benchmark.** Run at least three representative complete cases with the observer, serialization and validation included. Record median and upper-percentile seconds and bytes per case, separately for a primary execution and for a replay, so that no budget counts replay twice. Every later budget in this plan is recomputed from these numbers. A representative scientific case includes the renewal observer, so this benchmark waits for Stage 1. The engineering campaign gives an earlier figure for the plumbing alone, and that figure prices no scientific campaign.

**Calibration battery.** Import the renewal artifacts by exact identity; do not repeat that experiment or pool changed implementations. They enter as imported evidence (DESIGN section 7), carrying the renewal plan's own coverage: two designated trajectories replayed on CPU and GPU, and every case's readout independently re-derived. They are never labelled as replayed under the discovery policy, which applies to new discovery cases. Add separately registered calibration cases for light dependence and for passive-material false positives, no more than 16 extra logical cases before review. Compute the secondary readouts of DESIGN section 2 from stored records and label them exploratory unless they were frozen with the renewal protocol.

**Two hosts.** Run the 12-case engineering campaign from Stage 0 as two shards on the Mac and on a second physical host (decision D6), and replay all 12 on the other host. Inject an interrupted case, corrupt bytes, a wrong observer version and a duplicate result. Confirm one accepted result per case and an identical reduction whichever host finished first. These are plumbing cases, not evidence about evolution.

The gate has two parts. The engineering part: retained historical hashes; exact conservation and energy accounting on the fixtures; reproducible scientific payloads across the two hosts; bounded output size. Passing it lets Stage 3b start. The calibration part: the benchmark with the renewal observer; null controls behave as specified; imported artifacts validate. It needs Stages 1 and 2, and Stage 4 needs it. Report "local integration complete" when the engineering part passes, and list the operational criteria the plane still has to meet. If only the Mac is available, say that cross-host proof is pending; two processes on one machine do not substitute for it. Run existing golden checks if any shared physics or serialization path changes.

## Stage 3b — Workbench plane

Built now, directly after the core, by the user's decision D1 (2026-10-04). Its purpose is to fan scientific campaigns out across the machines available. It is an instrument for the science and changes no scientific gate. It starts when the engineering part of the 3a gate passes.

Proposed files: discovery queue/controller/validator modules under `apps/coordinator`, discovery worker transport under `packages/runner`, `tools/discovery-worker.ts`, and a minimal browser worker page. Follow the coordinator's own AGENTS.md when implementation begins. Use a separate research namespace and data directory; preserve registered/public job behavior.

Implement capability/build qualification, leases, idempotent result publication, observation-required verification, bounded worker resources and complete-set export. Reuse existing artifact storage and lease mechanisms only after checking their semantics. Make CPU-only operation possible; GPU support follows exact observer qualification.

Demonstrate the Stage 0 engineering campaign, the same 12 cases, on the Mac plus a second physical host. These are plumbing/calibration cases, not independent evidence of evolution. Replay all 12; cap technical attempts at three per case per role. Inject disconnects, late uploads, duplicate completion, a coordinator restart, corrupt bytes and a wrong observer version. Confirm one accepted result per ID and identical final aggregation regardless of arrival order. Export the campaign and compare it with the 3a shard run of the same manifest: the case set, the hashes and the reduction must be identical.

Gate: two distinct physical hosts, a browser and CLI route, successful recovery, all 12 results verified, and one reproducible export. If only the Mac is available, label local integration complete and cross-host proof pending; do not substitute two tabs for it.

The plane wraps the 3a runner, validator and reducer. Case identities do not change.

What the decision leaves alone. The renewal experiment runs in the construction workspace under its own protocol and never through the plane. The cloud allowance stays at zero until the user supplies a launch manifest (D4). Research jobs stay out of the registered and public queue and its data directory, and the deployed coordinator is not migrated.

## Stage 4a — Bounded diagnostic map of rule-1 parameters

Freeze a distinct protocol before running. It states the question the map answers given the renewal outcome, and its budget from the Stage 3 benchmark.

The default domain is the first proposal's. It varies only:

| Axis | Values |
|---|---|
| `kCatHalf` | 64, 128, 256 |
| `diffA` and `diffC`, coupled | 50, 100, 200 |
| `spread` | 0, 1, 2 |

The axes may be revised only before the freeze, and only on the evidence of the renewal accounting. Whether total matter or `kPhoto` should replace the coupled diffusion axis is unresolved (U1 in the council record); matter stays a habitat factor either way.

Hold `gateK=1`, decay/cost rates, energy constants, light, geometry, mutation-off policy and starting B/E fixed. Cross each of the 27 configurations with uniform A4/A16 habitats and the four specified arms: BUILD16 witness, one-byte BUILD0 match, selected nonbuilder, and builder with cost-retaining transport ablation. Resolve exact genome/initial-state hashes before launch. Reuse or integrate the reviewed ablation; do not approximate it by making construction free.

Two independent discovery seed blocks per configuration/habitat, with matched seeds across arms, give **432 logical cases × 10,000 steps = 4.32 million simulation steps**. The spread-zero rows are transport-disabled diagnostics; source-preserving off-site renewal is expected to fail there. A4 and A16 are separate resource regimes, not equal-budget competitors. Historical anchor runs use their original seeds and cannot be counted as fresh independent blocks.

The founder panel is the four arms. It was designed at the anchor point, so the map describes that panel. Confirmation adds at least two held-out founders, drawn from the disclosed comparator family by a rule fixed in the protocol.

Use the fixed renewal readout; display maintenance, losses, transport and threshold sensitivity as secondary information. Freeze at most three candidates for confirmation using, in order: worst-habitat renewal fraction among biological founder arms, worst-habitat source persistence, then candidate hash. Only spread-positive candidates are eligible; require renewal in both discovery blocks for at least one same founder/habitat combination. Admit fewer than three if fewer qualify.

Confirm shortlisted candidates using five new independent blocks and every original arm in both habitats: maximum **120 cases / 1.2 million steps**. A finite renewal capability is confirmed for a specified founder/habitat if it passes at least four of five blocks. Do not use different successful founders in each block to manufacture a pass. Construction-specific benefit additionally requires the matched cost-retaining comparisons; generic renewal need not depend on BUILD.

These are engineering screening gates, not a universal statistical significance claim. Report per-block data and uncertainty. Candidate configurations and matched arms share the two discovery blocks; they are not hundreds of independent evolutionary replicates. After seeing confirmation, do not substitute another candidate from the discovery grid under the same confirmation protocol. Full independent replay makes the Stage 4a maximum 1,104 case executions / 11.04 million steps before technical retries; it does not double the scientific sample.

The 120-case confirmation and the 1,104-execution maximum above are for the four original arms. Two held-out founders raise the confirmation maximum to 180 cases and the stage maximum to 1,224 executions. The protocol fixes the exact numbers.

After the map, report the joint distribution of its descriptors and how many distinct values each takes (U2). That report decides whether Stage 6 is worth running.

Stop the parameter map at its registered limit. If no candidate passes, classify the dominant tested bottleneck using accounting and controls. Return a new hypothesis about density, retention/access tradeoffs, or inheritance; do not infer impossibility across all physics. A broader law family requires a separate reviewed proposal.

## Stage 4b — Conditioned-field opportunity test

A separate protocol, following DESIGN section 2. It needs Stage 3a's runner, validator and ledger checks, and the stationary witness; it does not need a renewable regime. It also needs the ablation dependency resolved under D5. It is not a continuation of the construction study's second-opportunity assay, which was not earned and stays closed.

Freeze before running:

1. The conditioning histories: builder, matched nonbuilder and cost-retaining ablation, from identical starting budgets and offered light, to a fixed step.
2. The intervention: how the receiver's inoculum is reserved or debited, whether the builder remains, and the reconstruction rule for the channel-preserving control.
3. The receiver panel. The 103 disclosed comparators are available; they were selected for a different assay and include M3 founders with BUILD disabled, so the protocol says what the panel can and cannot represent.
4. The inoculum control, the seeds, the readout and the decision rule, including the rule for confirming any hit on fresh seeds.

Validate the intervention on artificial states first: every channel total and every energy term before and after, to the quantum.

Outcomes: a confirmed positive (opportunity exists at the anchor for the named receiver); a bounded negative for this panel and intervention; or invalid. A negative does not choose a new law. The next hypothesis after a negative is a separately reviewed decision.

## Stage 5 — Selection and accessibility

Starts only in a regime where renewal is demonstrated. If there is none, write the bottleneck report and stop here.

Develop separate protocols for functional transmission, viable local mutants, and competitive establishment under frozen laws. Start from multiple fixed founders; report genotype-specific effects and shared random inputs. There must be actual coexisting inherited variation capable of differential success; a single site whose genome gets replaced only establishes mutation accumulation.

Order of work, each with its own protocol:

1. **Sensitivity (S11).** Occupancy, turnover and the genotype-neutral baseline in the chosen regime. If the smallest detectable effect is too large to be useful, the remedy is a separately frozen study of habitat size and sensitivity. Renewal must be shown again in the changed habitat before any competition there is read.
2. **Marked-genotype competition**, as in DESIGN section 2.
3. **A frozen mutant panel** around the founders, and **functional heredity** by common garden with a matched control.

Each protocol with mutation on states its inferential unit and whether mutation draws are paired across arms.

Gate: selection distinguishable from drift and from lottery artifacts; transfer sensitivity demonstrated; no hidden resource change; no inference from an extinction floor.

## Stage 6 — Search comparison (optional)

Run this only if Stage 4a's descriptors show enough distinct, non-collinear values for coverage to mean something. Factorial or seeded random sampling remains the default sampler whether or not this stage runs. The protocol declares its estimand (DESIGN section 3).

The proposed larger rule-1 domain is unchanged:

| Axis | Values |
|---|---|
| `kCatHalf` | 32, 64, 96, 128, 192, 256, 384, 512 |
| coupled `diffA/diffC` | 25, 50, 100, 150, 200, 250 |
| `spread` | 1, 2, 4, 8 |
| `gateK` | 1, 2, 4, 8, 16, 32, 64 |

Validator/observer bounds must approve every candidate before this domain is frozen. Preserve all other settings. Use the archive/proposal algorithm in the design. Each method receives the same eight fixed anchors followed by sixteen proposals: 24 candidate evaluations per campaign block. Use three independent campaign blocks, two methods, and 16 case evaluations per candidate (two habitats × four arms × two within-campaign seed blocks): maximum **2,304 logical case evaluations / 23.04 million steps**, plus verification. Repeated identical inputs can reuse content-addressed results, but still consume the same evaluation allocation in both methods. Report avoided compute explicitly.

Primary comparison: coverage of the frozen capability bins at equal evaluation budget; also report valid-candidate count, confirmation yield, failure rate and accepted throughput. Discovery seeds must be independent across campaign blocks. This small comparison can support a practical method choice, not a strong universal superiority claim.

A search method earns continued use only if its apparent advantage transfers to a separately frozen shortlist test on fresh seeds and withheld founder/habitat conditions. Specify and price that test before starting this stage; cap its first version at 120 cases. If not, keep the simpler map/random method. No unseen-condition result may feed back into that same confirmatory search round.

Enumeration of this domain is 21,504 cases, 43,008 with full replay, which is about 39 hours on eight cores at the bare measured rate and more with the observer. It is allowed only inside a cap the user has set, using the Stage 3 benchmark. Three campaign blocks support a descriptive comparison, not a significance claim. A quarter of the proposed cases are ablation-arm cases, which the archive descriptors exclude; they are causal controls, and the protocol may move them to calibration and shortlist validation.

## Stage 8 — Predictive bridge, evolving-world comparisons and disturbance

**The bridge comes first.** Freeze a prediction from the map together with its pass criterion: worlds of high and of low capability, matched for survival and resources, will differ on a stated evolutionary endpoint. Test it on conditions not used to build the map. Only if it passes may the map choose or rank worlds for evolutionary study. If it fails, is invalid or is inconclusive, the negative is reported, the map stays a capability map, and predictive use stays blocked.

**Before any hardware is chosen**, the protocol defines the candidate, the independent history, the unit that is transferred in an assay, the endpoint and its instrument, the assay's sensitivity, and the full cost of histories plus assays. Many tiles in one GPU world with mutation on is one design option. It needs independent tiles (no pond cycle and no migration), an evaluator that does not fix `mutRate` at 0, and an allowlist change for any new override key. The axes are the habitat, mutation-supply, population-structure and founder factors, each a hypothesis.

The next test is the stronger, later form of the opportunity question; Stage 4b is its feasibility version at the anchor. Once accessibility is demonstrated, test one causal opportunity chain with matched field/strategy removals and reconstructions. Only then conduct the calm/stress × mutation-on/off experiment, including source costs, extinctions and common-garden descendants. These later protocols need their own budgets and power/sensitivity planning; they are not automatically launched by the first positive renewal case.

Gate: inherited cumulative capability gain with predeclared controls. If it fails, preserve the useful world and the negative evolutionary result separately. Revisit mutation/connectivity/interaction mechanisms before extending time horizons.

## Tactical compute rollout

| Order | Action | Proof before the next step |
|---|---|---|
| 1 | Run one frozen engineering campaign on the Mac's CPU | Complete set, validated, reduced; measured seconds and bytes per case |
| 2 | Run the same campaign as shards on a second physical host and replay across hosts | Identical state hashes and canonical observations; identical reduction |
| 3 | Qualify the Mac GPU only where a case needs it | Exact observation parity with the CPU reference and an acceptable measurement cost |
| 4 | Stage 3b: run the private coordinator/site from one pinned release and distinct data volume | Restart and artifact restore tested; registered/public queue untouched |
| 5 | Stage 3b: join a CPU worker by CLI, then the worker page on the work laptop | A real accepted and independently replayed case; no install required beyond the browser route |
| 6 | Stage 3b: export and independently reduce a complete campaign | Same case set, hashes and scientific decisions as local execution |
| 7 | Optionally add one bounded AWS worker, then more | Correct AMI/runtime/device, current regional price, accepted cases/hour, automatic lifetime limit; cost envelope covers replay and transfer |

Existing legacy commands, from a checkout matching the coordinator, are `deno run -A tools/island.ts --coordinator URL --label NAME` and `deno run -A tools/stitch.ts --coordinator URL --experiment NAME --require-observations-verified`. They are evidence of a head start, not commands for the proposed discovery tasks. With the latter flag, every included legacy segment must have matching observation verification; use an appropriately verified campaign.

Networking choice: private Tailscale Serve to a combined site/API when available; otherwise an approved HTTPS endpoint with research admission. The browser page and API should share an origin. Do not deploy the Vite development server as the remote production worker site. Do not expose Erlang distribution ports to workers.

Before any large campaign, benchmark at least three representative cases including observer and upload costs. Estimate `wall time ≈ logical cases × measured median case seconds × replay multiplier / effective concurrent workers`, then account for slower hosts, outages and upper-percentile cases. Measure GPU contention; default to one GPU worker per physical device. Worker-seconds are reported by backend and cannot be equated across heterogeneous machines without measurement.

The default cloud allowance is zero until a concrete launch manifest supplies region, instance/image, count, lifetime and maximum projected spend. No AWS provisioning is performed by this plan. Local cases also have wall-time, storage and retry caps. Reaching a cap yields an incomplete report, not silent downsampling or a changed scientific stopping rule.

## Review and release gates

Run focused tests for each seam, the full relevant suites before release, native/browser golden checks for qualified backends, and the coordinator integration/failure tests. Require Sol 6.1 High read-only review at phase boundaries and before commits, plus the requested Fable scientific/design review. Never mark an unavailable review as passed.

Ship in reviewable increments, each useful if the next hypothesis fails:

1. Renewal tooling and the renewal result, in the construction workspace.
2. The workbench core, proven on the engineering campaign: case contracts, runner, validator, reducer.
3. The workbench plane.
4. The calibration battery.
5. The diagnostic map and the conditioned-field test.
6. The selection study.

Increment 1 belongs to the construction workstream and proceeds in parallel with 2 and 3. Increment 4 joins when Stages 1 and 2 deliver the renewal observer and the artifacts; it does not delay increment 3. The search comparison, cloud provisioning, WASM acceleration, new law families and the evolving-world comparisons stay separate.
