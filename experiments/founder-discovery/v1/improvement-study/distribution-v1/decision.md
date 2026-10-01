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

## Completed-history import release — 2026-09-30

The CPU-only importer passed independent code review and a synthetic full-chain integration fixture. A review identified destination-symlink tests that had been claimed but were not saved; the missing cases were explicitly added and passed before production use. The final importer and test hashes are pinned in `importer-release.json`. It validates all 11 checkpoints with the original semantic loader, checks the exact 33 canonical files, preserves receipt bytes, rejects conflicts and unsafe paths, and publishes into a separate consolidation directory. It cannot start simulations or competitions.

Reserve 3,600 seconds for bounded inventory, transfer and import operations from the previously unallocated envelope, leaving 86,520.05390912498 seconds unallocated. The aggregate 96-hour ceiling is unchanged. Operations reserve at most 600 seconds each before execution and record their settled time; unresolved operations retain their reservation. These records must be included when calculating the remaining competition budget.

The first remote history, `discovery-cluster-33-6410007-normal`, has been inventoried on the work Mac, copied into staging, and semantically validated into `runs/founder-discovery-improvement-consolidated-v1`. All 33 file hashes match. `first-import-provenance.json` and `importer-operations/` preserve the successful execution evidence. This establishes the transfer path, not study completion or evolutionary improvement. Both active production queues and their original files remain separate and unchanged. Full 64-history reconciliation and competition release are still pending.

Four completed local histories (the first two seeds of founder cluster 33, both mutation conditions) subsequently passed the same import path. The consolidation now contains five histories, with both original inventory files retained by content hash. The six bounded auxiliary operations charge 170.6577273737639 seconds in total; active simulation charges remain separate.

The global CPU reconciliation command is prepared and independently reviewed (`reconciliation-review.json`; four focused tests passed). It requires every one of the 64 fixed histories, full uncached checkpoint validation, and exact complete agreement between source inventories and import provenance. It preserves unavailable biological observations and duplicate requests in the original 384-draw/6,144-request roster. Any missing, invalid, unexpected or conflicting evidence prevents roster publication. Output creation is atomic and refuses replacement of existing artifacts. Production reconciliation has not run, and no competition has been launched. Its eventual CPU execution must fit within the existing auxiliary reserve; no new budget is released.

## Further consolidation — 2026-09-30

The next ten completed local histories passed the bounded inventory, staging and full-chain import operation. Independent review checked all 330 canonical file hashes against both the original histories and consolidated copies, and verified the inventory, provenance and release identities. The consolidated collection now holds 15 histories. Operation 007 charged 288.81351270899177 seconds; the seven auxiliary operations total 459.4712400827557 seconds within the existing 3,600-second reserve. Both production queues remain separate and active. This is transfer and validation evidence only: full 64-history reconciliation, competition execution and scientific interpretation remain pending.

## Distributed competition preparation — 2026-09-30

The additive competition runner and bounded supervisor passed independent review, four focused TypeScript tests and two fake-parent tests. All 54 frozen scientific source hashes remain unchanged. The runner uses the original competition execution and result validation, preserves every requested observation and assigns unique cache keys disjointly between the two hosts. It relies on the reviewed, hash-pinned complete reconciliation report for physical history evidence and separately validates the complete emitted request roster. It does not invent biological samples absent from that report.

`assay-preparation-review.json` records the reviewed source hashes. A PREPARED candidate is not execution authorization; no candidate, release or competition has been generated or run. The candidate defaults of 43,000 seconds and 75 invocations per host would fit the original aggregate envelope while reserving both history caps in full. Actual complete 64-history reconciliation, a frozen global roster and an explicit root-reviewed budget release remain required before competition execution. No scientific threshold or stopping rule changes.

## Remote transfer recovery — 2026-09-30

Operation 008 lost its SSH connection during transfer after the remote inventory completed. The local transfer process exited with rsync status 255. A subsequent SSH check confirmed the existing remote worker and supervisor were still live; no simulation was restarted. The original partial staging directory and full 600-second reservation are preserved. `import-recovery-008.json` records the explicit recovery decision.

Operation 009 rechecked the remote inventory bytes and transferred into a separate staging directory before full-chain import. Independent review verified all 99 canonical file hashes against that pinned inventory in both staging and consolidation, with matching provenance and accounting. Three additional remote histories are now consolidated, bringing the collection to 18. Recovery charged 94.0253683750052 seconds; auxiliary charges including the unreclaimed failed reservation total 1,153.496608457761 seconds, leaving 2,446.503391542239 seconds in the existing reserve. Both history queues remain active. Full reconciliation and competition release remain pending; this incident and recovery imply no biological result.

Operation 010 subsequently consolidated the two completed local histories for founder cluster 4, seed 6410002, normal and disabled mutation. Independent review matched all 66 canonical file hashes across the original histories, staging and consolidation, and verified provenance and accounting. The collection now holds 20 histories. This operation charged 70.25445416697767 seconds; total auxiliary charges are 1,223.7510626247386 seconds including the preserved failed-transfer reservation. Full-study reconciliation and competition execution remain pending.

## Slow-transfer interruption — 2026-09-30

Operation 011 inventoried four completed work-Mac histories but its transfer exceeded the fixed deadline. Operation 012 was an explicitly recorded recovery into separate staging, reusing only hash-matching files and enabling transport compression supported by both machines. That recovery also terminated on an SSH timeout and rsync exit 255. Both full 600-second reservations remain charged. No simulation was restarted. Subsequent OS process checks confirmed both existing workers and supervisors live; this is a transfer problem, not evidence of lost histories or biological failure.

Independent review found 39 matching canonical files in the original partial staging and 74 in recovery staging, with no incorrect canonical files. Missing files remain missing. None of the four histories or their import provenance was published to consolidation, which remains at 20 histories. All input and recovery identities and budget sums reconcile. Auxiliary charges total 2,423.7510626247386 seconds, leaving 1,176.2489373752614 seconds in the existing reserve. Both partial directories and the original inventory are preserved. Further transfer retries are deferred pending connection and remaining-budget review; full reconciliation and competition release remain gated.

Operation 013 consolidated four further completed local histories without network transfer: founder cluster 4 seed 6410003 and founder cluster 16 seed 6410001, each normal and disabled mutation. Independent review verified all 132 canonical hashes across originals, staging and consolidation, with matching provenance and accounting. The bounded 300-second reservation settled at 144.48220470908564 seconds. Consolidation now contains 24 histories; total auxiliary charges are 2,568.233267333824 seconds, leaving 1,031.7667326661758 seconds in the existing reserve. Remote bulk transfers remain deferred; simulation workers continue separately, and no competition release or scientific inference follows from these imports.

## Competition result collection preparation — 2026-09-30

The additive CPU-only result collector passed the focused synthetic suite (two tests, eight seconds) and independent code review. Review required preserving original host closure attestations and ledger/log evidence, validating every host identity, rejecting unexplained closure files, and preflighting receipt conflicts before publication. These repairs and regressions are included; `assay-import-preparation-review.json` pins the accepted sources. All 54 frozen scientific sources remain unchanged.

Collection preserves canonical competition results unchanged and retains both-extinct results. Global completion requires the full released key roster and both verified host commit markers; partial copies remain incomplete and may resume only with identical evidence. Original host closure evidence is kept separately from historical provenance. The existing history-readiness report remains pinned rather than rerunning the histories-only reconciler against an enriched directory. Root assertions about absent operating-system processes are explicitly distinguished from mechanically verified inventories, settled ledgers and terminal logs.

This is prepared implementation only: no production competition import, competition release, or analysis has run. It allocates no further runtime. The local history worker remains active; the most recent remote SSH checks were refused, so current remote progress is unverified and its assignments remain reserved. Full history reconciliation, budget release and competition execution remain required.

## Local history queue closure — 2026-10-01 UTC

All 30 assigned local histories reached one million steps. The final supervisor log reports completion; the supervisor and final worker are absent from the operating-system process table, and their locks are absent. Independent review verified all 35 settled parent receipts and the terminal log against preserved original bytes in `history-closure-local/`. The settled local charge is 22,942.16142741812 seconds across 35 invocations, leaving 77,057.83857258188 seconds of its original allocation unspent. This records unused allocation; it does not yet reallocate it or authorize competitions.

SSH access to the work Mac was restored and its existing queue continued without restart. The latest observed remote state has 26 completed histories, so 56 of 64 histories have terminal receipts. Consolidation still contains 24 histories; remaining collection, full semantic reconciliation and competitive assays are required. No scientific improvement conclusion follows from queue completion. Paid compute remains zero.

## Closed local allocation and CPU evidence recovery — 2026-10-01 UTC

Operation 014 exceeded its fixed deadline after publishing eight of ten requested history directories. Its full 600-second reservation remains charged; the 14-operation CPU prefix totals 3,168.233267333824 seconds. The temporary directory and stale import lock are preserved pending explicit recovery. There are 32 published history directories, but the interrupted batch lacks its completion provenance and is not declared complete. Raw simulation histories remain unchanged.

Following independent review of the closed local accounting and the successor-budget implementation, `budget-successor-v1/ledger.json` pins the immutable 14-operation prefix and the reviewed local closure. Local history launch authority is administratively retired at 22,942.16142741812 seconds and 35 invocations. The old frozen launcher does not mechanically enforce this retirement and must not be invoked locally. The remote reservation is unchanged. Of 77,057.83857258188 unused local seconds, 10,000 are transferred to the CPU evidence allowance, raising it from 3,600 to 13,600 seconds and leaving 10,431.766732666176 seconds after preserved charges. Each CPU operation remains bounded by 600 seconds; failures retain that full charge.

The global 345,600-second / 576-invocation ceiling is unchanged. Competition preparation remains limited to 43,000 seconds and 75 invocations per host; no competition execution is released here. Including the full unchanged remote reservation, engineering reserve, CPU reserve, settled local use and contemplated 86,000-second competition allocation leaves approximately 67,577.8925 seconds unallocated. The recovered 135 local invocation slots remain unallocated. This changes accounting only, not rules, genomes, controls, outcomes or scientific thresholds.

The Mac is network-reachable, but Codex authentication currently fails at the local signing agent. No remote worker was restarted or reassigned on that basis. Collection and full reconciliation remain incomplete; no adaptation inference is made. Paid compute remains zero.

## Local import recovery completed — 2026-10-01 UTC

The reviewed recovery preserved the stale import lock and partial temporary directory, then validated the ten affected histories in five exact two-history batches through the unchanged full-checkpoint importer. All five batches completed, charging 476.1889399581123 seconds in total. Operation 014 retains its full 600-second failed charge. Cumulative CPU evidence charges are 3,644.4222072919365 seconds, leaving 9,955.577792708063 seconds in the reviewed 13,600-second allowance.

Independent review verified all 330 canonical file hashes across original histories, prior staging, recovered batches and consolidation (990 distinct physical files), all five subset inventories and provenance records, the preserved temporary files and stale lock, and all archival pins. The recovery processes are absent and the active import lock is gone. Consolidation contains exactly all 30 assigned local histories and four assigned remote histories, with no temporary history directories. `local-final10-recovery/` preserves the reviewed helper, inventories, provenance, recovery evidence, results and independent review.

This completes local evidence collection only. The remaining 30 remote histories still require collection and verification; full 64-history reconciliation and competitive assays remain gated. SSH authentication from Codex remains unavailable despite network reachability, so remote work is neither restarted nor reassigned. No scientific improvement conclusion is drawn. Paid compute remains zero.

## Work-Mac history queue closure — 2026-10-01 UTC

SSH access was restored. All 34 remote histories have terminal one-million-step receipts, exactly matching their assigned roster. Root observed no worker/supervisor locks or matching running simulation processes; the terminal supervisor log reports completion. All 50 parent receipts are settled. Independent review verified the preserved 51-file evidence set, identities, roster, terminal log and accounting: 31,704.214947501012 seconds charged. Its 98,295.78505249899 unused seconds remain reserved rather than reallocated. Process absence is explicitly root-observed evidence; the reviewer checked the preserved record.

All 64 simulation histories have reached their terminal checkpoints. Only 34 histories are consolidated locally so far: all 30 local plus four remote. Remaining remote checkpoint transfer, full semantic reconciliation and competitive assays remain required. This closure does not establish evolutionary improvement. No simulation was restarted; paid compute remains zero.

## Compressed remote collection throughput gate — 2026-10-01 UTC

Operation 020 collected and semantically verified the normal/off pair for founder cluster 4, seed 6410004, in 60.800258875009604 seconds. Compression reduced this pair's transfer archive to approximately 9.3 MB. Independent review checked all 66 canonical file hashes in staging and consolidation, exact inventory/provenance/plan agreement, the compressed archive pin, completion receipt and accounting. Consolidation now has 36 histories; cumulative CPU evidence charges are 3,705.222466166946 seconds, leaving 9,894.777533833054 seconds.

The first-batch helper intentionally stops after this gate. Its successful throughput supports preparing the remaining 14 two-history batches under the same 600-second per-operation limit and unchanged semantic importer. Their continuation helper requires review before execution. All simulation outputs and scientific decisions remain unchanged; assays are still gated on complete reconciliation.

## All history evidence collected — 2026-10-01 UTC

All 15 remote collection batches completed under the reviewed bounds, adding 30 histories to the existing collection. Independent review verified all 990 canonical files across staging and consolidation, all exact inventories/provenance/completion/plan/operation identities, and all 54 archival pins. The collection contains exactly the 64 assigned histories, with no active import lock; the collector exited successfully.

Remote collection charged 1,560.5255814171396 seconds. Total CPU evidence charges through operation 034 are 5,204.947788709076 seconds, including preserved failed reservations. Original full-checkpoint reconciliation began as bounded operation 035 after the collection completed. It must finish and produce a complete roster before any assay release. No scientific improvement conclusion follows from collection completeness. Paid compute remains zero.
