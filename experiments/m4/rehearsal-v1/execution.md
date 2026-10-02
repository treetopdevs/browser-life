# M4 growth development-pipeline rehearsal: execution record

Date: 2026-10-02. Status: **armed, not started.** The run begins automatically when the founder-discovery continuation run exits cleanly complete.

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
