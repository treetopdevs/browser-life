# PRD: Evolvability discovery workbench

Status: canonical after council, 2026-10-04, with the user's decisions D1 and D2 of the same day applied. Research basis: [RESEARCH.md](RESEARCH.md). Reviews and rulings: [COUNCIL.md](COUNCIL.md). This is a product and research contract. It is not a frozen scientific protocol; each experiment freezes its own.

## Problem and desired outcome

Long runs can fail without distinguishing unsuitable physics, unsuitable initial conditions, inaccessible mutations, or an insensitive measurement. We need experiments that answer those questions separately and a simple way to run them across available computers.

The product delivers a reproducible map of world capabilities, supported by trajectories and interventions. It should let us say, for example: "This region supports source-preserving renewal across these founders and habitats; this neighboring region loses activity through dilution; inherited variation has or has not exploited the difference." A bounded negative result is a valid product outcome. "Life achieved" is not an acceptance criterion.

A capability map is a bounded result in its own right. It is not evidence of evolvability. It may not be used to choose worlds for evolutionary study, or be described as predicting evolution, unless the prospective test in S8 has been run and has met the pass criterion frozen with it. A failed, invalid or inconclusive test leaves the map a capability map and nothing more.

## Users and workflow

**First, on local machines.** The researcher freezes a campaign manifest and sees its question, case count, measured budget, controls and evidence requirements. They run it as shards on one or more machines and collect the result directories. The reducer reports complete, incomplete, quarantined and scientifically negative cases separately, and exports one report.

**Then, on the distributed plane.** It is built directly after the local core, so that scientific campaigns fan out across the machines available. The researcher submits a registered campaign once. A contributor opens a worker page or runs one command, sees the requested compute allowance, and starts or pauses work. The same case identities and the same acceptance rules apply.

A candidate page shows its resolved physics, starting resources, founder panel, capability results, independent seed blocks, replay status, and representative trajectories. Comparisons show paired resource-matched controls. Visualizations help inspection; they do not award scientific success.

## Scientific requirements

| ID | Requirement | Evidence required |
|---|---|---|
| S1 | Separate physical possibility, evolutionary accessibility, and further opportunity | Separate assay families and statuses; no combined "life score" |
| S2 | Detect active maintenance | Exact synthesis/loss accounting and finite-window persistence; light removal and passive controls |
| S3 | Detect renewal while preserving a source | Sustained activity at source and additional sites, with local synthesis distinguished from imported biomass. Connected expansion is admissible. Secondary readouts report threshold sensitivity, spatial extent and dependence on imported free energy; they never replace the primary endpoint |
| S4 | Test functional heredity | Controlled common-garden re-expression plus matter-associated transmission evidence; genome differences alone do not pass. Existing instruments are reused only within their demonstrated interpretation |
| S5 | Measure viable variation | A frozen local mutant panel reports survival and functional outcomes, including neutral and harmful variants |
| S6 | Test environmental feedback | Resource-matched removal/reconstruction interventions, with exact ledgers and an inoculum control, show that one strategy creates an opportunity for another |
| S7 | Test cumulative change and disturbance benefit | Frozen laws; inherited gains in fresh tests; stress-history costs and extinct populations retained |
| S8 | Calibrate every descriptor, and test what it predicts before relying on it | Known controls, nulls, and sensitivity analyses; a proxy that fails calibration cannot drive a success claim. A descriptor may select worlds for evolutionary study only after a frozen prospective prediction, high against low capability with survival and resources matched, has been tested on new conditions and has met its frozen pass criterion. A failed, invalid or inconclusive test blocks that use |
| S9 | Distinguish environment from physics, within the tested panel | Cross candidates with fixed habitats and founders; claims limited to the disclosed panel; held-out founders in confirmation; initial resources are not silently optimized with laws |
| S10 | Preserve original experiments | Separate dated protocols; frozen endpoints, hashes, raw runs and completed verdicts remain unchanged |
| S11 | Show that selection is detectable before claiming it | Measured occupancy, turnover and a genotype-neutral baseline give the smallest detectable effect in the regime; no selection claim is made below it |

The initial release implements S1–S3 and the provenance needed for later assays. S4–S7 are explicit gated extensions, not claims that the first release demonstrates evolvability. S11 gates the selection study. The prospective clause of S8 gates any use of the map to choose or rank worlds. The bridge test itself may run once it is specified, priced and frozen.

### Initial-release status (2026-10-04)

**The initial release (S1–S3 with O1–O9) is met, with the limits stated here. The PRD as a whole is not complete:** S4–S11 are gated extensions and none has started. Evidence: PLAN's Implementation status; the campaigns `renewal-benchmark-v1` and `renewal-calibration-v1` and the import `renewal-v1-imported` under `runs/discovery/`.

| ID | Status | What supports it, and its limits |
|---|---|---|
| S1 | Met | Assay families are separate and each carries its own evidence status: engineering fixtures, maintenance (`renewal-positive`, `renewal-null`), the renewal primary endpoint (`renewal-main`) and imported evidence, which is its own class. No combined score exists. Only the physical-possibility family has scientific assays; the accessibility and opportunity families are gated extensions (S4–S7) |
| S2 | Met, with a measured sensitivity limit | Exact per-site synthesis and loss accounting from the construction workstream's reviewed observer, run pinned to its frozen revision (D5) and reconciled to the global flux at every step; finite-window persistence over steps 9,000–10,000. Calibration campaign, 16 cases, every case replayed on a second physical host: all 12 null controls read no maintained site (light removal, two founder sizes, two seeds; stable, decaying and spreading bound biomass without a genome; polymer alone). Positive controls were detected in 3 of 4: a stationary builder at steady state failed the frozen reaction-balance rule (R ≥ 0) in one of two seeds with R = −23 over the window. So the null side is clean and the positive side has limited sensitivity at steady state |
| S3 | Met as a bounded negative | The renewal endpoint (source and a fixed site outside it maintained, local synthesis distinguished from imported biomass by Q, R and bound-B imports; connected expansion admissible) is the renewal plan's own, imported by exact identity as imported evidence (the frozen source tree, protocol, plan, initial states, results, censuses, checkpoints and the four designated CPU and GPU replay artifacts all rehashed): 40 audited histories, never counted as discovery-replayed. Outcome: no habitat qualified (RENEW false in all 24 main pilot cases). Secondary readouts, exploratory and decisive of nothing: spatial extent (in every readout); threshold sensitivity (no main case renews at V = 128 for any Qmin in 32–512 and Rmin in {0, −64}; only V ≤ 64 together with Rmin −64 counts the A16/spread-1 thin film); free-energy dependence (in the late window PHOTO accounts for all synthesis in the witness-family arms, and GROW appears only in the selected arm (spread 0), at about 15% of its synthesis, and that site imported no bound free energy, while the spread-1 cases were net exporters of it; the measured terms bound the free energy available to GROW but do not attribute the origin of the chemical energy behind respiration or decomposition, which stays untested). Limits: one pilot seed per habitat, and the S2 sensitivity limit means a steady-state renewal could be missed |

Operational criteria O1–O9 stand as recorded in PLAN. Renewal campaigns run pinned (`cpu-ref-renewal-pin-v1`) on the shard path on both physical hosts; the plane and the browser page serve `cpu-ref-v1` campaigns only and refuse pinned ones with that reason.

Factors are kept apart throughout: law (rule constants and rule version), habitat (size, starting matter and energy, light), founders, mutation supply, and population structure (tiles, migration, pond cycle). A claim about one holds the others fixed.

## Operational requirements

Each requirement is met first on local machines where that is possible, in Stage 3a. The rest are met when the plane is built, in Stage 3b. "Local complete" and "distributed complete" are reported separately, and the PRD is never called complete on local evidence alone.

| ID | Requirement | Acceptance criterion | Met when |
|---|---|---|---|
| O1 | Easy heterogeneous participation | Mac and one other physical host complete the same campaign; one browser route and one CLI route are demonstrated | Local: two hosts by shards with cross-replay, CLI only. Browser route: plane |
| O2 | Useful CPU participation | A CPU-only worker runs small diagnostic cases without requesting a GPU; incapable hosts explain the limitation | Local |
| O3 | Failure tolerance | Kill a worker, expire its lease, restart the coordinator, retry uploads and submit a late duplicate: one accepted result per logical case | Local: an interrupted case leaves a retained partial attempt, and a rerun yields one accepted result. Leases, restart and late uploads: plane |
| O4 | Exact identity | Every result binds protocol, case, initial state, source/build, physics, observer and readout versions | Local |
| O5 | Trustworthy aggregation | Missing cases block "complete"; mismatches are quarantined; exact replays match both state and canonical scientific observations. A result is validated for completeness, identity and digests before it is accepted or reused; a directory's existence is not acceptance | Local |
| O6 | Bounded resources | Workers enforce concurrency and run limits; every campaign has wall-time and storage caps set from a measured benchmark; cloud launches require a configured instance/runtime/cost envelope | Local; cloud part with the plane |
| O7 | Repeatable search | Finite proposal batches and deterministic archive updates produce identical next proposals despite different finish order | When a search exists |
| O8 | Simple collection | One campaign export contains manifest, accepted case index, rejected attempts, hashes and a reproducible report | Local |
| O9 | Isolation | Research jobs cannot enter the existing public/registered queue or use its data directory by accident | Local: a separate research root and no coordinator involvement. Plane: a separate queue and data volume |

Usability target for the plane: after normal runtime/network prerequisites, joining requires one browser action or one CLI command and no per-case setup. Benchmark onboarding time during the two-host demonstration; ten minutes is a target, not measured evidence.

## Decisions

- **The workbench is built now, to fan out compute for the science.** The user decided this on 2026-10-04 (D1 in the council record). The renewal experiment runs in parallel in the construction workspace and waits for no infrastructure. The plane is an instrument for the science and relaxes no scientific gate.
- **Core first, then the plane.** The core is a frozen manifest, a sharded CPU runner, an acceptance validator and a reducer. The plane wraps them. The case and result contracts are the same on both paths, so nothing is re-identified, and the shard path stays as the reference and the fallback.
- **Phoenix/OTP for coordination and TypeScript for compute** when the plane is built. Add a discovery protocol; do not force arbitrary worlds through legacy presets and do not widen the legacy path.
- **CPU first** for exact small assays. Qualify GPU execution when it can produce equivalent observations. An optional WASM backend must earn adoption through measured throughput and equality.
- **One renewal implementation.** One owner in the construction workstream owns the renewal observer, runner and verifier (D2, decided 2026-10-04). The workbench consumes its stable API or its exact artifacts and builds no second one.
- **A capability vector and factorial sampling by default.** Keep all outcomes, including failures. Adaptive search and a diversity archive come only after the descriptors show resolution and complete-case costs are measured.
- **Search stays outside the ecology.** Search decisions are engineering decisions. During evolutionary validation, freeze physical laws and turn off the outer optimizer.
- **Existing rule-1 parameters first.** New chemistry is a later decision, taken after a specific, controlled bottleneck result. A finite failed search is not proof of impossibility, and neither is a failed hand design.

## Explicit exclusions

The initial work does not add an `Organism` class or a reproduction operation, split one evolving world across computers, replace the CPU/WGSL kernels with JAX, introduce a public arbitrary-code worker service, or require Kubernetes. It does not launch AWS spending, alter ongoing experiments, or migrate the deployed coordinator. It does not re-implement or re-run the construction workspace's renewal experiment, and it does not touch the frozen transition hunt.

## Completion and decision gates

Engineering completion has two levels. Local completion means the reference campaign runs as shards on two physical hosts, survives the local fault checks, and exports reproducibly. Distributed completion means the same campaign passes every operational criterion above through the plane. Stage 3a delivers the first and Stage 3b the second.

Scientific completion means the registered budget has produced one of: supported capability, unsupported within the tested domain, or invalid/incomplete assay. Open-endedness remains an ongoing research question.

Gates between kinds of work:

- A bounded diagnostic map needs a closed renewal experiment, whatever its outcome, and a protocol that says what question the map answers given that outcome.
- Adaptive search needs at least one capability assay with a real positive witness and valid negative controls, descriptors with shown resolution, and a measured budget.
- A selection study needs a demonstrated renewable regime and the sensitivity analysis in S11.
- The bridge test may run once it is specified, priced and frozen with a pass criterion. Choosing worlds from the map, or any later comparison of evolving worlds that relies on it, needs that test to have passed.
- Disturbance tests come only after population-level selection is demonstrable.

A failed gate produces a bottleneck report and a separately reviewed next hypothesis.
