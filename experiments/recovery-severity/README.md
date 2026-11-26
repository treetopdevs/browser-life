# Recovery severity prototype

Implements the **zero-step feasibility gate** in [the plan](../../docs/recovery-severity-2026-10-24/PLAN.md). It does not implement or authorize the later eight-pair recovery campaign.

From this checkout, using the retained v1 campaign as a read-only input:

```sh
deno check experiments/recovery-severity/feasibility.ts
pnpm vitest run experiments/test/recovery-severity-selector.test.ts
deno run -A experiments/recovery-severity/feasibility.ts /path/to/runs/recovery-accessibility/v1 runs/recovery-severity/new-feasibility
```

The source is the exact v1 campaign pinned by its manifest digest and the 64 case-file hashes in the plan's audit. It must include case records, case digests, and grown checkpoints. It is not bundled into Git; missing evidence is an error, not permission to simulate replacement cases.

The CLI checks case and checkpoint identity, actual state validity and exact conservation, and then applies candidate lesions only to CPU state copies without advancing time. It enumerates all prescribed circles, uses exact fractional gates and deterministic joint selection, and writes one record per pair plus a result digest and source manifest. Original input files are untouched. A used output directory is refused.

`FEASIBILITY-PASS-ENGINEERING-PENDING` requires at least30/32 feasible pairs. `DOSE-CONTROL-NOT-READY` stops this protocol with exit code 3. The result digest is written first and result.json is published last by atomic rename. Readers must require both, verify the digest, and reject any failure.json or leftover .tmp file. Exceptions leave incomplete evidence or `TECHNICAL-STOP`, never an accepted pass. Neither status says anything about subsequent recovery or genotype advantage. A new result directory is required after source changes; retain prior attempts.

Next work is native CPU/GPU intervention equality and observer/endpoint validation, then the planned three-arm runner. Only those gates can admit fresh scientific seeds. Physics, rule version, golden hashes and v1 stop rules remain unchanged.

## Bounded Stage 0 intervention parity

```sh
deno check experiments/recovery-severity/stage0.ts
pnpm vitest run experiments/test/recovery-severity-parity.test.ts experiments/test/recovery-severity-selector.test.ts experiments/test/recovery-accessibility.test.ts
deno run -A experiments/recovery-severity/stage0.ts /absolute/path/to/v1 runs/recovery-severity/stage0-new-attempt /absolute/path/to/shared-engineering-budget.json
```

This entry point accepts only the frozen v1 bundle. It authenticates the manifest, pinned case records, digests, grown checkpoints, target and configuration for seeds **2026102401 and 2026102402**. It reselects the joint mass-matched prescription using the merged selector. No growth or fresh scientific seeds are generated, and no v1 artifacts are modified.

For each genotype and each legacy, mass-targeted and sham branch, it checks upload identity, immediate CPU/GPU intervention identity, zero matter/energy residual at every observation, and 2,000 recovery steps against CPU at 25-step cadence. Independently restarted GPU runs at 25 and 50 steps must have identical physical state hashes and retained component labels/masses at every shared observation, including initialization and the final state. Both GPU observation schedules of all six branches in pair 1 are replayed for exact trace and outcome equality. Different time grids need not produce identical return times. Lost/fused remnants and cadence disagreement cannot qualify for clean sustained return; missing observations are errors.

The synthetic tests isolate direct destruction, fragmentation, retained-daughter continuity, incoming fusion, permanent tracking loss, sham identity, cadence mismatch and sustained-return arithmetic. They complement the existing real CPU/GPU golden suite (`deno run -A tests/deno/gpu_golden.ts`); synthetic scheduling is not native GPU evidence.

The runner requires a shared budget JSON containing `maxMs: 1200000`, `maxBytes: 536870912`, nonnegative `spentMs`/`spentBytes` accounting for all prior engineering work, and an `attempts` array. Initialize this once with measured or conservative prior charges; do not reset it between attempts. An exclusive lock prevents concurrent use. Each attempt receives only the remaining allowance, checks the deadline between observation batches, reserves space for a failure marker, and debits elapsed time and retained bytes plus conservative settlement/failure overhead before publishing success. A failed debit retains the lock and blocks further use until accounting is repaired with prior charges preserved. Retain the ledger, stopped attempts and evidence. Use one GPU lane. It saves grown/post/final checkpoints and CPU/GPU/replay traces. A successful report requires `result.json`, its verified canonical SHA-256 in `result-digest.json`, no `failure.json` and no leftover `.tmp` files. `STAGE0-PARITY-PASS` describes only these bounded checks; it does not approve fresh science, certify the entire Stage 0 or establish a recovery advantage.

Read the completed artifact independently with `deno run -A experiments/recovery-severity/read-stage0.ts OUT SHARED_BUDGET_JSON`. This verifies the result digest and every inventoried source snapshot, manifest, input record, trace and checkpoint; failure markers, temporary files and damaged artifacts are rejected. Run filesystem budget regressions with `deno run -A tests/deno/recovery_severity_budget.ts`.

The bounded engineering execution stopped on a genuine 25/50-step tracker disagreement; see [Stage 0 evidence](../../docs/recovery-severity-2026-10-24/STAGE0.md). Audit a retained stopped bundle without resuming it using `deno run -A experiments/recovery-severity/audit-attempt.ts OUT V1_DIR SHARED_BUDGET_JSON`. Full successful bundles can additionally be checked with `deno run -A experiments/recovery-severity/audit-stage0.ts OUT SHARED_BUDGET_JSON V1_DIR`, which reconstructs continuity and verifies the budget debit. Neither audit starts a simulation.

### Pair 2 cadence investigation

[Diagnosis and proposed v4 repair](../../docs/recovery-severity-2026-10-24/TRACKER-REPAIR-v4-PROPOSAL.md) explain the saved overlap-chain disagreement. Reproduce it without a GPU or simulation with `deno run -A experiments/recovery-severity/diagnose-cadence.ts OUT V1_DIR`; add `--assert-concordant` for exit 3 on the recorded disagreement. The diagnostic authenticates saved evidence, reconstructs continuity and preserves the frozen failure disposition. The v4 harness changes remain proposed; the existing observer and Stage 0 stop are unchanged.

## Implemented v4 reporting repair

See [v4 implementation and verification](../../docs/recovery-severity-2026-10-24/V4-IMPLEMENTATION.md). The runtime now publishes and independently rereads a branch diagnostic before stopping on cadence disagreement. It preserves the frozen `T=2025`, failed clean recovery and Stage 0 stop. It does not change the tracker or independent observation schedules.

Portable offline regressions:

```sh
pnpm vitest run experiments/test/recovery-severity-v4.test.ts experiments/test/recovery-severity-parity.test.ts experiments/test/recovery-severity-selector.test.ts experiments/test/recovery-accessibility.test.ts
```

Read a failed v4 branch without promoting it to a successful attempt:

```sh
deno run -A experiments/recovery-severity/read-stage0.ts OUT --branch 2026102402-mutant-mass-targeted-diagnostic.json
```

For saved-data verification only, `reanalyse-stage0-v4.ts OLD_ATTEMPT V1_DIR NEW_OUT SHARED_BUDGET_JSON` creates a new checksummed, budgeted projection of the authenticated old pair 2 evidence. It cannot start a GPU simulation or scientific world. The output is explicitly `saved-evidence-only`, retains TECHNICAL-STOP and is rejected by the ordinary successful-attempt reader. The original input directory is untouched and output reuse is refused. No native v4 execution is authorized by this documentation.

Global v4 acceptance additionally requires an independently verified shared-budget debit and exact first-pair replays. The global reader now takes `OUT SHARED_BUDGET_JSON`; the branch form above remains diagnostic-only and cannot report a global pass.
