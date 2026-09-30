# Owned-Mac distribution amendment — 2026-09-30

The user authorized distributing this running study to a second owned Mac. This is an execution amendment only. The frozen 64-history manifest, RULE_VERSION 1, genomes, seeds, mutation conditions, checkpoint times, sampling, competition assay, analysis and stopping criteria remain unchanged. The existing remote `~/bl` main checkout is not this study's source and remains untouched; the study has a separate `~/bl-founder-discovery` copy.

## Handoff and allocation

The previous supervisor was suspended while its current worker completed normally. The worker produced a successful `time-limit` invocation receipt and removed its run lock. Only then was the supervisor terminated. `handoff-start.json` and `handoff-complete.json` preserve this sequence. Its original supervision record is preserved, including its now-stale `running` status; the explicit handoff record supersedes that liveness claim.

At handoff, 11 histories were complete and the twelfth had reached 900,000 steps. All existing history evidence stays on the original Mac. `routing.json` fixes 30 histories here and 34 on the work Mac. The first founder's first six matched seeds remain local; each other founder's first three matched seeds remain local. The complement goes to the work Mac. Each mutation pair stays together, and each founder is represented on both machines. Allocation does not select histories by evolutionary outcomes.

## Verification and accounting

The remote copy must verify the exact frozen source and input hashes, using explicit path relocation rather than changing the manifest's scientific identity. A matching main-branch golden test is useful background but does not replace matching this study's state and mutation-edge records across machines. The additive runner and its tests receive independent review before execution. It must refuse foreign unit assignments, overlapping writers, source drift and conflicting imported evidence. Generated access to private runner helpers must preserve their bodies exactly and be pinned separately.

This remains owned hardware with zero paid compute. The original 345,600-second aggregate execution cap is shared, not granted independently to both machines. The 29 prior invocation receipts charge 24,479.946090875 seconds, including the earlier conservative interruption charge. Proposed history allocations are 100,000 seconds locally and 130,000 seconds remotely, with a 1,000-second engineering reserve and 90,120.05390912498 seconds left unallocated. History invocation allocations are 170 and 220; after the 29 prior invocations and two reserved engineering probes, 155 of the original 576 invocations remain unallocated. Failed or interrupted reservations remain charged until explicitly reconciled. Each machine must retain at least 20 GiB free storage.

## Completion boundary

The distributed history runners must stop after their assigned histories. They do not start competition assays. Completed remote history directories must be copied into staging, hash verified and validated using the frozen checkpoint-chain semantics before collision-refusing import. Original receipts remain unchanged, with host and transfer provenance kept separately. All 64 histories must reconcile before constructing the global assay roster and releasing any further execution from the remaining budget.

Unavailable histories stay unavailable. Execution on a second machine supplies no new biological evidence by itself and does not change the criterion for repeatable genome-level improvement. Organism reproduction remains unresolved.

The additive runner passed three TypeScript tests and two supervisor tests. Independent review additionally exercised nonzero exits, unresolved reservations, insufficient budget, legacy locks and SIGTERM child cleanup. Both machines verified the mapped frozen source/input/pilot closure. Their 10,000-step normal/off engineering reports were byte-identical, including checkpoint hashes and mutation-ledger hashes (140 normal events, zero off events). These finite replay controls support the execution handoff; they are not evidence of evolutionary improvement or a proof of every possible hardware trajectory.

Decision: release the assigned history queues under `allocation.json`. The reviewed implementation hashes and control evidence are pinned in `release-review.json`. The original scientific manifest is unchanged. Import and competition execution remain gated as described above.
