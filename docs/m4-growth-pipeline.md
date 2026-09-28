# M4 growth development pipeline

Dated 2026-09-29. This is a development rehearsal, never a confirmation ensemble. The candidate endpoint and independent calibration remain defined in `m4-growth-amendment-design.md`.

Freeze twelve one-million-step histories: gradient-m3 then spots-m3; treatment, neutral, no-mutation in that order; seeds 650000001 and 650000002 within each condition. Census every 100 steps and deep observation every 10 censuses retain the registered activity calculation. Shared seeds are intentional paired inputs. No run is a substitute for a future fresh seed.

`tools/m4-growth-pilot.ts --plan <frozen JSON> --index <0..11>` executes one history. The manifest binds this protocol, runner dependencies, the fixed job list and local seed-audit digest. Execution refuses source drift, an existing incomplete attempt without a terminal receipt, changed inputs, reordered jobs or known external GPU workers. It monitors for new external GPU work and terminates only its own child. Each attempt preserves start/terminal receipts, command, logs and raw bundles. Completed receipts must reconcile with the full bundle and its manifest digest before admitting subsequent jobs.

The first history is the throughput benchmark, capped at 3,600 wall seconds. The final receipt checks the attempt cap even when the child finishes between monitoring polls. All attempts, including failed attempts and observation overhead, count against the 14,400-second track budget. Before each later job, remaining history count times benchmark cost must fit the remaining budget. At most three exact-input technical attempts are permitted per job; retries do not become independent replicates. An abrupt wrapper failure without a terminal receipt requires explicit recovery review.

All new foundations outputs share a 10-GiB cap. Two-second monitoring stops at 256 MiB below that cap to leave write headroom; final size is checked even when a child finishes between polls. This is a measured guard, not an operating-system quota. Any observed overrun is retained as an incomplete technical result and reported. Existing approximately 1-GB foundations evidence is outside this new-output directory and remains preserved.

After all twelve histories reconcile, run the real-bundle analysis with its complete expected seed/condition matrix. Missing histories or a failed budget gate leave the pipeline incomplete. The two-seed development estimates cannot establish endpoint power or M4 success. Independent synthetic calibration and the subsequent fresh-ensemble freeze are separate requirements.

## Technical recovery after the first benchmark attempt

Job 0 attempt 1 under execution plan v5 stopped at 178.449405 seconds and census 161700. The guard matched a contemporaneous CPU-only `deno check` command; its old receipt did not preserve the matching PID, so the false-positive diagnosis is supported by the command pattern and timing rather than a captured detector record. Storage was far below its cap. Preserve this incomplete receipt and all partial outputs; they do not enter biological analysis.

The corrected guard requires an actual `deno run` executable and distinguishes planning from `--execute` for plan-first assay commands, including the role-cohort GPU `--smoke` mode. It records future matching PID/command evidence and separate stop reasons. A reviewed successor plan binds the exact old plan and incomplete receipt digests. Cross-revision admission permits only wrapper/guard/protocol changes; scientific source hashes, job inputs, seed audit and resource limits must match. Completed results cannot use this exception. The old attempt remains in cumulative cost and the next attempt repeats job 0 from step zero with the same seed and scientific inputs.
