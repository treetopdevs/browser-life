# Operator refusal and pruning counters — 2026-10-24

## Scope and contract

This implements the previously deferred refusal/pruning observations from
`ops-dashboard-2026-10-18.md`. Only the authenticated administrator's
`GET /api/status` adds `operatorEvents`:

```json
{
  "since": "2026-10-24T12:00:00.000000Z",
  "rateRefusals": {"join": 0, "next": 0, "segment": 0, "requests": 0},
  "capacityRefusals": 0,
  "prunedIslands": 0
}
```

`since` is the UTC start of the counter owner's current in-memory epoch, not
server uptime, the first refusal, a rate-window boundary, or data retention.
Restarting the owner (including application restart) resets all six counters.
Queue and limiter restarts alone preserve them. During the owner's restart gap
`operatorEvents` is `null`; it must be displayed as unavailable, never zero.

The counters have these deliberately narrow meanings:

- `rateRefusals`: decisions to return HTTP 429 from the existing island budget
  plugs, by their fixed kind. A coarse `requests` refusal halts the route before
  its specific budget, so one response does not increment two kinds. Successful
  charges and direct limiter calls do not count. Garden letter/hand and discovery
  budgets are outside this counter set.
- `capacityRefusals`: Queue join operations refused because no island can be
  removed at the configured bound. Includes direct Queue callers and maps to
  the island join's capacity 503; it does not represent all HTTP 503 responses.
- `prunedIslands`: number of existing island records actually removed by a
  successful joining mutation, after persistence returns. It counts islands,
  not pruning scans, candidates, expired leases, or rejected join attempts.

## Implementation and limits

`Coordinator.OperatorEvents` owns one fixed-size ETS row with six integer
counters and the epoch timestamp. ETS counter updates are atomic, and a snapshot
reads the complete row atomically. Cardinality is constant: no island IDs,
tokens, addresses, arbitrary labels, or request payloads are retained. Counts
are cumulative integers, not a bounded retention history.

The owner is an unconditional child of the application supervisor, separate
from both Queue and IslandLimiter. Recording does not enqueue work in Queue or
a counter mailbox. Missing-owner updates are best effort no-ops so observation
cannot turn a refusal or successful join into an availability failure. These
are volatile operational observations, not durable or exactly-once audit
records across crashes. Queue persistence and counter increments are not a
transaction; an owner crash or a process crash between mutation and recording
can lose an observation. No export, durable telemetry, alerts, client behavior,
scheduling, scoring, physics, capacity policy, or new rate limits are introduced.

## Validation

New HTTP tests cover the exact zero shape and ISO timestamp, administrator-only
access and absence from public status, concurrent refusals without lost updates,
coarse-budget precedence without double counting, next/segment refusal kinds,
unauthorized requests, unchanged islands after capacity refusal, exact multi-island
pruning on successful joins, and zero extra pruning below capacity. Restart tests
cover counter resets, survival across limiter/Queue restarts, unavailable snapshots,
and continued joining while the owner is stopped. The existing public-status
cold-cache 503 test now verifies it does not increment these counters.

Backend validation passed:

- `mix precommit`: compile with warnings as errors, unused dependency check,
  formatting, and all 559 tests passed.
- After adding the final Queue-restart and unrelated-503 assertions,
  `mix format` and the three affected HTTP suites passed: 28 tests, 0 failures.

Browser validation passed: the complete operator dashboard suite passed 30 tests;
the final counter-specific suite passed 11 tests, including invalid calendar dates,
missing/malformed counts, epoch replacement and hostile values. Desktop (1280 px)
and mobile (375 px) screenshots were inspected with no clipped large integers or
horizontal page overflow. Argon 4 High adversarial review completed with no blockers; follow-ups are recorded below.

## Adversarial review follow-up

Argon 4 High reviewed a self-contained source packet in plan/sandbox mode and found no blockers. The packet preceded the test-only and wording follow-ups below. Its backend coverage and hygiene
suggestions were accepted without changing counter semantics:

- The owner-down test now exercises admin HTTP status serialization as `null`,
  a real island-budget 429, and a real capacity 503, alongside a successful join.
- Conditional file download tests verify island refusals increment `segment`,
  while administrator and unauthorized downloads leave counters unchanged.
  Unauthorized segment requests are also explicitly checked.
- A deterministic persistence failure (a directory at `state.bin.tmp`) crashes
  the joining Queue before persistence returns and proves candidate pruning
  does not increment the counters. The last successfully persisted state is
  left intact; the test uses its temporary data directory only.
- Cleanup is registered before global child mutations and restarts either
  stopped counter/limiter owner, including after assertion failures.
- `OpsStatus.extend/1` documentation now lists `operatorEvents`.

The expanded focused suite passes all seven tests. The final `mix precommit`
also passes: 561 tests, 0 failures, with compilation, dependency check, and
formatting successful. `git diff --check` passes.

The operator-page explanation now explicitly limits HTTP 429 counts to island budgets, matching the backend contract.
