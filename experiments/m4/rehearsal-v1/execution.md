# M4 growth development-pipeline rehearsal: execution record

Date: 2026-10-02. Status: **ended incomplete, 2026-10-03.** 2 of 12 histories are complete. Index 2 was stopped by the pilot's external-GPU-worker guard, and the plan's budget gate now refuses every remaining index. See "Outcome" below.

## Authorization and scope

The user, 2026-10-02: "start the 11 rehearsal histories after the run."

This covers indices 1–11 of the frozen 2026-09-29 development pipeline (`docs/m4-growth-pipeline.md`). That is gradient-m3 then spots-m3; treatment, neutral, then no-mutation; development seeds 650000001 and 650000002. The plan is `browser-life-foundations/runs/foundations-next/m4-pipeline-v7-plan.json`, SHA-256 `1dd4777f12269e2639e4a9e26f7576ec128b71f2e875defb8c405fbc16a6e193`. Index 0, the benchmark, completed on 2026-09-29 in 1,141.14 s. A preserved incomplete first attempt took 178.45 s.

These are development histories, never confirmation. They are run with the frozen pilot exactly as planned: one history per invocation, the plan's guards, budget and storage checks, and append-only receipts beside job 0's.

## Checkout

The plan binds 48 sources by hash. In both the foundations workspace and this repo, `packages/sim-gpu/src/gpu-sim.ts` now differs from the plan's bytes. Commit 68be3d1a (2026-09-30) added a read-only `displacement` getter after job 0 ran, and changed no dynamics. The plan's cross-revision rule forbids admitting a changed scientific source, so the plan is not revised.

The rehearsal runs from a dedicated jj workspace instead, `../browser-life-m4-rehearsal` (workspace `m4-rehearsal`, change `wkqyoyxn`). It sits on this repo's commit `482928c6`, with `gpu-sim.ts` restored to the plan-bound bytes (SHA `3186bb49…`, from foundations `68be3d1a-`).
- **Sources.** All 48 plan hashes match, with no unbound required source, and the seed audit verifies.
- **Outputs.** `runs/foundations-next` there is a symlink to the foundations workspace's `runs/foundations-next`, so receipts and bundles land beside job 0's.
- **Environment, matched to job 0.**
  - Deno is 2.9.7, as job 0 used.
  - `deno cache --frozen` succeeds with `deno.lock` unchanged.
  - Production dependencies were installed offline with pnpm, and `fflate@0.8.3` is byte-identical to the foundations copy.
  - `package.json` is unmodified. Without `node_modules`, Deno 2.9.7 rewrites it to add `workspaces`, which is why the install was needed.

## Chain

`runs/m4-rehearsal-chain.sh` (detached, under caffeinate; log `runs/m4-rehearsal-chain.log`):
1. Wait for `discovery_continuation_run.ts supervise` to exit.
2. Require the continuation status to be cleanly complete:
   - every replay and every one of the 1,536 assays present;
   - no recorded mismatch;
   - not stopped;
   - no unresolved reservation.
   
   Otherwise do not start, and leave the GPU for continuation recovery.
3. Run indices 1–11 sequentially with `deno run -A tools/m4-growth-pilot.ts --plan runs/foundations-next/m4-pipeline-v7-plan.json --index <i>`. Stop at the first non-zero exit. Any retry, of which the plan allows three exact-input attempts per job, waits for review.

## Budget risk, stated in advance

The track cap is 14,400 s including every attempt.
- **Remaining.** 13,080.4 s are left, and the plan's affordability gate projects 11 × 1,141.14 = 12,552.5 s.
- **Slack.** That leaves 527.9 s, about 4.6% (52.8 s per history across the ten later checks).
- **If histories run slower.** If the remaining histories average more than ~4.6% slower than the benchmark (other conditions, spots-m3, or CPU contention), the pilot's own gate will refuse a late index. The pipeline then ends incomplete under its rules, a valid outcome of the frozen design.
- **Expected wall time.** About 3.5 hours.

## Outcome, 2026-10-03 UTC

- **02:04:10Z, the chain starts.** The continuation supervisor exited and its status was cleanly complete:
  - 1,536 of 1,536 assays, 8 of 8 replays and 39 of 39 audits;
  - no mismatch, no unresolved reservation, and no stop;
  - 21,624 s charged.
  
  The chain then started index 1.
- **Index 1 (gradient-m3, treatment, seed 650000002): completed on attempt 1.**
  - It took 1,334.32 s, 17% over the 1,141.14 s benchmark (750 steps/s).
  - Conservation held. The final hash is `846672c89bb8d53e` and the bundle manifest SHA-256 is `3b44f9ae…8377`.
- **Index 2 (gradient-m3, neutral, seed 650000001): incomplete on attempt 1.**
  - The pilot's guard stopped it at 1,104.02 s (SIGTERM, exit 143) with the failure "external GPU worker appeared".
  - The worker was pid 29159, `deno run -A tools/run.ts … --preset ponds-small … --steps 3000`, launched from another Claude Code session's scratchpad in the `browser-life` checkout.
  - The chain stopped as designed. Nothing was retried.
- **Contention the guard did not detect.**
  - From about 02:23Z, a `tools/island.ts` worker from the same checkout (pid 9889, attached to the local coordinator) ran on the GPU.
  - The guard's pattern covers `run.ts`, `assay.ts` and the foundation tools, not `island.ts`.
  - It overlapped the last ~3 minutes of index 1 and all of index 2 unflagged. Its effect on their timing is unmeasured.
- **Budget.**
  - 3,757.93 s have been charged: job 0's 178.45 + 1,141.14 s, index 1's 1,334.32 s and index 2's 1,104.02 s. That leaves 10,642.07 s.
  - The affordability gate needs (12 − 2) × 1,141.14 = 11,411.40 s.
  - The pilot therefore refuses every remaining index before creating an attempt directory. Plan v7 ends incomplete at 2 of 12 histories, which is a valid outcome under its rules, and it allows no further attempt.
- **Counterfactual, arithmetic only.** Suppose index 2 had not been interrupted and every later history had taken index 1's 1,334 s. The gate would still have refused index 4. Whether 1,334 s reflects the seed and condition or contention is unknown.
- **Integrity.** No plan-bound file changed, and receipts and bundles are append-only, beside job 0's.

Completing the development rehearsal now needs a reviewed plan revision with a fresh budget. Under the plan's cross-revision rule, that revision must decide whether job 0 and index 1 carry over. It also needs a GPU-exclusivity guard that covers `island.ts`. This is the user's decision.
