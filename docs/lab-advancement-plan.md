# Lab world advancement: plan and decisions

Base: `b7fd4c16` (committed main). Isolated jj workspace: `lab-advancement`.
Candidate 2 from the architecture review. The cohort preparation change remains on its separate bookmark.

## Default decisions

- A lab-local execution module owns census cadence, observer restoration and integrity, step traversal, checkpoint settlement, and replay traversal. The worker retains device and renderer lifetime, generation identity, message serialization, controls, presentation, and OPFS.
- Frame advancement consumes at most the next census interval. Checkpoints settle to a complete census, including migration. Replay uses the same traversal with a physics-only twin.
- Preserve migration-disabled relative census cadence and migration-enabled absolute realignment after an off-grid import. Preserve dropped-ledger notices and mutation counts; do not change headless-runner policy.
- Any destructive observation or migration failure permanently blocks advancement and checkpoints for that world. Presentation failures after commitment do not invalidate history. Stale asynchronous work must not publish results or continue stepping after replacement.
- Keep shared observeCensus and migrateAtBoundary implementations. Narrow the migration helper's simulation parameter to the operations it uses, with no behavior change. A CPU-state adapter justifies the testing seam: it executes actual observation and migration and permits deterministic readback failures.
- Replace the worker's duplicated lifecycle helpers instead of exposing their flags and ordering through another interface. No new generic runner framework or changes to physics, checkpoint encoding, scientific thresholds, or preregistration.
- Record domain terms in CONTEXT.md. No ADR is needed for this reversible concentration of existing behavior.

## Gates

1. Add interface-level behavior tests before implementation and confirm the missing implementation fails.
2. Implement and wire playback, save/export and replay through the execution module.
3. Run focused behavior tests, TypeScript checking, full unit tests, and a lab production build. Exercise the actual worker on WebGPU if available; distinguish GPU proof from deterministic adapter proof.
4. Independently review the exact diff against the base, resolve findings, and rerun affected checks.
5. Record evidence and limitations, commit the scoped change, and leave a clean successor.

## Completion evidence

Completed implementation and independent review.

- Test-first gate: the new execution test suite initially failed because the module did not exist. This is a new test surface for an architectural refactor, not evidence of a pre-existing behavior regression.
- Final focused suite: `node_modules/.bin/vitest run apps/lab/test/execution.test.ts` passed 19 tests. Coverage includes frame partition/restoration parity, non-vacuous pre-migration observation versus post-migration physics, absolute/relative imported cadence, ledger drops, destructive observer/readback/migration failures, GPU completion failure, stale readbacks, replay equality, and twin cleanup.
- Full suite: `node_modules/.bin/vitest run` passed 31 files / 487 tests, including the then-current 17 execution tests, pinned physics hashes and preregistration synchronization. Two additional failure tests and a stronger observation-order assertion were subsequently verified in the final focused run; production code did not change after the full run.
- `node_modules/.bin/tsc -p tsconfig.json`: passed, including the new lab tests and worker browser test.
- Lab production build (`../../node_modules/.bin/vite build` from apps/lab): passed.
- Real Chrome worker test (`tests/e2e/lab-execution.spec.ts`): passed on `apple metal-3`. Verified a queued save/export at step 200, migration replay to step 600, imported checkpoint continuation with identical physics and observer history, pending-step reset on world adoption, and save/export after active playback with matching settled observer state.
- Browser validation used the installed Playwright and Chrome against this workspace's Vite server on port 5187. A temporary config selected that server to avoid another package-manager/server startup. No dependencies or lockfiles changed.
- Standards review: no actionable findings. Plan/behavior review: no actionable findings. Both were independent, read-only reviews against base `b7fd4c167767372250d780e5b106cdbe2f9d93a2`.
- The worker's exclusive queue now waits for the entire frame advancement and draw operation. Pending requests added during a readback remain for the next frame. Execution uses the worker's identity predicate rather than a second generation counter.
- In addition to observation/migration failures, failed simulation submissions or GPU completion now conservatively invalidate advancement history; a partially completed batch cannot safely be retried. This is the documented failure-integrity default.
- Replacement construction initializes execution before adopting the new world, so failed construction preserves the current world. Execution checks the world's identity after the migration state readback, before the shared helper can upload migration results.

Validation logs live outside the repository under `/private/tmp/lab-*`. Installed dependencies were reused through ignored workspace-local links. Physics kernels, checkpoint encoding, scientific definitions and coordinator code were not changed.

The scoped change is ready to commit under `codex/lab-advancement`, leaving an empty successor change. No merge or push is part of this task.
