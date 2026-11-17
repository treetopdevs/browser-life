# Bounded Stage 0 intervention parity — 2026-10-25

**TECHNICAL-STOP: shared-observation tracker identity disagrees.** No fresh scientific worlds were generated. The engineering result neither passes Stage 0 nor establishes a biological recovery advantage.

The first two prescribed engineering seeds, 2026102401 and 2026102402, and both genotypes were loaded from the original gitignored v1 bundle. The harness authenticated the frozen manifest, pinned case files/digests, checkpoint bytes, configuration, state hashes and conservation. It reselected mass-targeted lesions with the merged selector, preserving the old target, legacy lesion, physics, defaults, rule version and acceptance criteria.

## Empirical checks

For each branch attempted, the harness compared CPU at 25-step cadence with GPU at 25 steps, and an independent GPU trajectory at 50 steps, through 2,000 recovery steps. It checked the immediate intervention against the existing CPU lesion operator, sham identity, exact matter conservation and zero energy residual at every observation. Physical identity includes configuration, step, all persistent state and cumulative ledgers/fluxes. Shared observations include offset 0 and the final state.

- **Engineering pair 1:** parent and mutant × legacy, mass-targeted and sham all passed CPU/GPU and shared-observation component checks. Both GPU cadence schedules of all six branches replayed for exact traces and outcomes.
- **Engineering pair 2:** parent × all three arms and mutant legacy passed. Mutant mass-targeted completed its three physical trajectories, which match at every shared observation, but its trackers disagree. The run stopped before mutant sham.
- **Cadence blocker:** mutant mass-targeted begins with label 0, mass 2,463. At offset 50 both grids retain label 3, mass 2,291. At offset 100 the 25-step grid retains label 2, mass 1,766; the 50-step grid has lost the continuation (`null`, mass 0). Disagreements persist at six shared observations, offsets 100–350. Both are lost by the final observation; matching final failure bits does not remove the earlier identity disagreement.

The saved overlap evidence explains the divergence: the fast tracker follows labels 3 → 2 → 2 through offsets 50 → 75 → 100. The slow tracker has no direct outgoing overlap from its retained label between offsets 50 and 100. This is an observer-cadence failure despite matching physical states; the harness does not replace the lost component or relax the frozen identity gate.

[Independent audit](STAGE0-AUDIT.json) authenticates executed source snapshots, input identities and the retained file inventory, reconstructs continuity from overlap edges, cross-checks trace rows, checks saved boundary states, rechecks pair 1 replays and confirms aggregate accounting. It audits eleven branches and identifies only `2026102402-mutant-sham` as unexecuted. The stopped bundle has `failure.json` and no success result.

## Implementation and verification

`experiments/recovery-severity/stage0.ts` is a bounded engineering-only runner. `parity.ts` contains backend-independent intervention/conservation/cadence checks; `continuity.ts` reconstructs saved tracking evidence. `budget.ts` uses a locked shared ledger, persists charges before publishing success and fails closed on accounting errors. Success artifacts include a SHA-256 inventory of their manifest, source snapshots, traces and checkpoints. Independent readers cover both successful and stopped attempts. Usage is in the [README](../../experiments/recovery-severity/README.md).

Validation: 33 focused tests passed, including synthetic direct destruction, fragmentation, fusion, permanent loss, intermediate-overlap cadence loss, sham identity, return-time arithmetic, contradictory overlap evidence and trace-row disagreement. Native GPU golden cases passed (30); unchanged pinned CPU golden hashes passed (30). Deno checks, repository TypeScript checks, filesystem budget/fail-closed-publication regressions and artifact-tamper regressions passed.

A read-only Sol 6.1 High review first found per-attempt budget reset and incomplete artifact authentication. Attempt `stage0-v1` was stopped and retained. The repaired `stage0-v2` produced the empirical evidence above. Follow-up review found publication-before-accounting and insufficient independent continuity validation; these were repaired in harness v3 and validated on retained evidence and synthetic regressions, without repeating empirical trajectories. Execution-source snapshots preserve the exact v2 code. No v3 empirical attempt was launched.

The final [read-only Sol 6.1 High review](STAGE0-REVIEW.md) found no consequential code defects and independently agreed with all 45 retained traces. A subsequent evidence-only addition persists pair-selection arithmetic before GPU execution and independently rechecks selected lesions against saved post-intervention states.

The shared ledger conservatively charges **989,751 ms (16 minutes 29.751 seconds)** and **94,403,653 bytes**, including retained earlier work and a post-stop verification reservation, below the fixed 20-minute/512-MiB cap; cloud spend is $0. All raw engineering evidence remains local under `runs/recovery-severity/`, with the original v1 inputs untouched in the original checkout.

## Outstanding empirical gate

The prescribed two-pair gate is **not passed**. The cadence disagreement requires an explicitly versioned observer/assay decision under the existing stop rule before another empirical attempt. Pair 2 mutant sham is outstanding. The final harness v3 accounting and continuity repairs have synthetic and saved-evidence validation, but no new end-to-end empirical run. No retry, replacement engineering seed, fresh scientific pair, recovery claim or acceptance-criterion change is authorized by this report.
