# PRD: Evolvability discovery workbench

Status: proposed, 2026-10-04. Research basis: [RESEARCH.md](/Users/nicholas/develop/browser-life/docs/evolvability-discovery-2026-10-04/RESEARCH.md). Fable/Sol review pending. This is not a frozen scientific protocol.

## Problem and desired outcome

Long runs can fail without distinguishing unsuitable physics, unsuitable initial conditions, inaccessible mutations, or an insensitive measurement. We need experiments that answer those questions separately and a simple way to run them across available computers.

The product delivers a reproducible map of world capabilities, supported by trajectories and interventions. It should let us say, for example: “This region supports source-preserving renewal across these founders and habitats; this neighboring region loses activity through dilution; inherited variation has or has not exploited the difference.” A bounded negative result is a valid product outcome. “Life achieved” is not an acceptance criterion.

## Users and workflow

The researcher selects a registered campaign, sees its question, case count, resource budget, controls, and evidence requirements, and submits it once. A contributor opens a worker page or runs one command, sees the requested compute allowance, and starts or pauses work. The researcher sees completed, interrupted, mismatched, and scientifically negative cases separately, then exports one complete report.

A candidate page shows its resolved physics, starting resources, founder panel, capability results, independent seed blocks, replay status, and representative trajectories. Comparisons show paired resource-matched controls. Visualizations help inspection; they do not award scientific success.

## Scientific requirements

| ID | Requirement | Evidence required |
|---|---|---|
| S1 | Separate physical possibility, evolutionary accessibility, and further opportunity | Separate assay families and statuses; no combined “life score” |
| S2 | Detect active maintenance | Exact synthesis/loss accounting and finite-window persistence; light removal and passive controls |
| S3 | Detect renewal while preserving a source | Sustained activity at source and additional sites, with local synthesis distinguished from imported biomass |
| S4 | Test functional heredity | Controlled common-garden re-expression plus matter-associated transmission evidence; genome differences alone do not pass |
| S5 | Measure viable variation | A frozen local mutant panel reports survival and functional outcomes, including neutral and harmful variants |
| S6 | Test environmental feedback | Resource-matched removal/reconstruction interventions show that one strategy creates an opportunity for another |
| S7 | Test cumulative change and disturbance benefit | Frozen laws; inherited gains in fresh tests; stress-history costs and extinct populations retained |
| S8 | Calibrate all optimization descriptors | Known controls, nulls, and sensitivity analyses; a proxy that fails calibration cannot drive a success claim |
| S9 | Distinguish environment from physics | Cross candidates with fixed habitats and founders; initial resources are not silently optimized with laws |
| S10 | Preserve original experiments | Separate dated protocols; frozen endpoints, hashes, raw runs and completed verdicts remain unchanged |

Initial release implements S1–S3 and the provenance needed for later assays. S4–S7 are explicit gated extensions, not claims that the first release demonstrates evolvability.

## Operational requirements

| ID | Requirement | Acceptance criterion |
|---|---|---|
| O1 | Easy heterogeneous participation | Mac and one other physical host complete the same campaign; one browser route and one CLI route are demonstrated |
| O2 | Useful CPU participation | A CPU-only worker runs small diagnostic cases without requesting a GPU; incapable hosts explain the limitation |
| O3 | Failure tolerance | Kill a worker, expire its lease, restart the coordinator, retry uploads and submit a late duplicate: one accepted result per logical case |
| O4 | Exact identity | Every result binds protocol, case, initial state, source/build, physics, observer and readout versions |
| O5 | Trustworthy aggregation | Missing cases block “complete”; mismatches are quarantined; exact replays match both state and canonical scientific observations |
| O6 | Bounded resources | Workers enforce concurrency and run limits; cloud launches require a configured instance/runtime/cost envelope |
| O7 | Repeatable search | Finite proposal batches and deterministic archive updates produce identical next proposals despite different worker finish order |
| O8 | Simple collection | One campaign export contains manifest, accepted case index, rejected attempts, hashes and a reproducible report |
| O9 | Isolation | Research jobs cannot enter the existing public/registered queue or use its data directory by accident |

Usability target: after normal runtime/network prerequisites, joining requires one browser action or one CLI command and no per-case setup. Benchmark onboarding time during the two-host demonstration; ten minutes is a target, not measured evidence.

## Decisions

Use Phoenix/OTP for coordination and TypeScript for compute. Add a discovery protocol rather than forcing arbitrary worlds through legacy presets. Keep a CPU implementation first for exact small assays; qualify GPU execution when it can produce equivalent observations. An optional WASM backend must earn adoption through measured throughput and equality.

Use a capability vector and a small diversity archive. Keep all outcomes, including failures. Search decisions are engineering decisions outside the simulated ecology. During evolutionary validation, freeze physical laws and turn off the outer optimizer.

The first scientific screen explores existing rule-1 parameters. New chemistry is a later decision, supported by evidence that existing local mechanisms cannot supply a needed capability within the registered domain. Finite failed search is not proof of impossibility.

## Explicit exclusions

The initial work does not add an `Organism` class or a reproduction operation, split one evolving world across computers, replace the CPU/WGSL kernels with JAX, introduce a public arbitrary-code worker service, or require Kubernetes. It does not launch AWS spending, alter ongoing experiments, or migrate the deployed coordinator as part of these documents.

## Completion and decision gates

Engineering completion means the local/remote reference campaign and fault-injection checks pass with a reproducible export. Scientific completion means the registered budget has produced one of: supported capability, unsupported within the tested domain, or invalid/incomplete assay. Open-endedness remains an ongoing research question.

Proceed to diversity search only when at least one relevant capability assay has a real positive witness and valid negative controls. Proceed to intrinsic evolution only when renewal and interpretable transmission/variation tests are available. Proceed to antifragility tests only after population-level selection is demonstrable. Failed gates produce a bottleneck report and a separately reviewed next hypothesis.
