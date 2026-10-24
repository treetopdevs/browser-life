# Island refusal backoff — 2026-10-24

## Scope and plan

This implements the runner follow-up documented in `deploy/README.md`: an otherwise healthy island should tolerate a short coordinator admission refusal without repeating work whose result is unknown. The branch starts from `origin/main` at `b3fab906`; immediate island leave (PR #74) is a separate change and is not imported here.

1. Mark only coordinator refusals known to precede application, and expose the marker and delay to cross-origin browser clients.
2. Route join, next, predecessor downloads, checkpoint/file uploads, heartbeat, complete, reject and fail through one per-island retry gate.
3. Bound retry attempts and waiting, retain request bytes and leases, and preserve Stop semantics.
4. Make heartbeat scheduling single-flight and task-scoped so a pending retry cannot outlive its task.
5. Verify refused requests, cancellation, exact payload preservation, browser-visible headers and coordinator behavior.

## Wire contract

A response is retryable only when its status is **429 or 503** and its `X-Island-Request-Applied` header is exactly `false`. The coordinator adds this marker only to limiter 429s that halt before the Queue and the declined join-capacity 503. The capacity refusal advertises `Retry-After: 1`; limiter refusals retain their rounded-up delay. Allowed origins receive `Access-Control-Expose-Headers: retry-after, x-island-request-applied`.

An unmarked response, transport exception, response-body failure, 409 or other error does not trigger replay. Older coordinators therefore retain their prior behavior. A proxy-generated 503 is not evidence that an upstream mutation failed to happen. Recovery from ambiguous join, assignment or terminal-decision results requires stronger idempotency/receipt support; this change does not claim it.

## Client policy

Each logical request gets at most **four attempts** and a **120-second monotonic retry-admission budget**, starting before its first wait. `Retry-After` accepts whole nonnegative seconds and all three HTTP-date forms. HTTP dates use UTC; malformed values fall back to the exponential floor, and overflowing seconds mean a wait too long to admit another attempt. The three retry floors are 1, 2 and 4 seconds plus 0–25% positive jitter. The actual delay is at least the advertised delay and the jittered floor. Timers round up, never down. If the next allowed time does not fit the budget, the last refusal is returned as the existing HTTP failure; it is never retried early.

All requests in one island invocation share a cooldown. A refusal extends that cooldown even if that request exhausts its attempt budget. Requests waking from sleep recheck the gate because another operation may have extended it. This conservative gate covers both per-island segment limits and optional per-address limits; it does not coordinate separate tabs/processes.

Bodies are prepared once per logical operation: join and decision JSON, uploaded file strings and encoded checkpoints are reused with the same authorization, URL and lease. A retry never reruns simulation, requests a different task, regenerates an artifact or changes a lease. Earlier refusal bodies are cancelled when no longer needed; a final refusal remains readable by existing error handling. No retry logs expose bodies, tokens or garden credentials.

## Stop, heartbeat and lease boundaries

Join, next, downloads, uploads and heartbeat retain abortable in-flight fetches. Each retry wait is abortable, including waits after a refused complete/reject/fail. A terminal decision already sent retains its existing unabortable fetch: if it succeeds while Stop lands, its accepted result still counts. If it returns a marked refusal, Stop prevents another attempt. Ambiguous errors remain errors.

Heartbeat is a single task-scoped worker, using the same gate. Stop and task teardown abort both its pending wait and abortable fetch, and teardown waits for the worker to settle. It cannot send overlapping retries or leave a timer behind when the task finishes.

The 120-second budget bounds retry admission and waits; it is **not** a hard timeout on an unresolved already-sent terminal request. Imposing that timeout would change the established unknown-outcome cancellation contract.

Lease preservation remains best effort. The task protocol does not expose the configured lease duration, and a cooldown may prevent heartbeat renewal. The client retains its lease and the coordinator checks it; expiry/reassignment produces the existing refusal rather than an invented success. This implementation neither guarantees lease renewal during throttling nor bypasses limits to refresh it.

When PR #74 is integrated, rerun the held complete/reject/fail and heartbeat teardown cases together with immediate leave: no retry may follow leave, and leave must follow the settled sent decision. This branch does not change leave behavior.

## Validation

- `packages/runner/test/island-backoff.test.ts`: delay parsing, jitter, attempt/deadline exhaustion, explicit-marker gating, ambiguous-error non-replay, shared cooldown and cancellation reasons using controlled clocks.
- `packages/runner/test/island-retry-requests.test.ts`: each logical operation retries the same request body/auth/URL/lease; cancellation prevents another attempt; terminal refusal races and heartbeat teardown/single-flight behavior. Simulation is mocked to count invocations; these tests do not claim GPU execution.
- Existing island/cancellation/page suites retain their real reference-simulation cancellation coverage.
- Coordinator agent reported `mix precommit`: **556 tests, 0 failures**; final targeted HTTP suite: **17 tests, 0 failures**, including marker boundaries and allowed-origin exposed headers. Log: `/tmp/island-backoff-precommit.log` (local evidence, not a repository artifact).
- `pnpm exec vitest run packages/runner/test/island-backoff.test.ts packages/runner/test/island-retry-requests.test.ts packages/runner/test/island-cancel.test.ts packages/runner/test/island.test.ts packages/runner/test/island-page.test.ts`: **5 files, 138 tests passed** (31.42 s). All retry-budget tests use controlled clocks, not real 120-second sleeps.
- `pnpm typecheck` and `git diff --check`: passed.
- Browser integration agent reported **3 real cross-origin Chromium/Phoenix checks passed** (21.3 s): actual limiter 429 then successful join after the exposed delay, exactly one join callback/no GPU, Stop during actual cooldown without a retry, and readable capacity-503 marker/delay. The new `tests/e2e/island-backoff-wire.spec.ts` also provides an optional combined-leave mode for later integration. No production deployment or real GPU claim follows from these checks.
