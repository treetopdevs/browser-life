# Island backoff: real browser wire smoke — 2026-10-24

The opt-in `tests/e2e/island-backoff-wire.spec.ts` uses a real scratch Phoenix coordinator on `127.0.0.1:5273` and Chrome at a separate Vite origin (`localhost:5272`). Only the inert starting HTML document is fulfilled locally; coordinator API requests, preflights and response headers use the network. Chrome's local-network permission is granted for that scratch origin; CORS is not disabled.

```sh
# First install dependencies in the checkout, including mix deps.get in apps/coordinator.
BL_ISLAND_BACKOFF_WIRE=1 BL_E2E_PORT=5272 pnpm exec playwright test tests/e2e/island-backoff-wire.spec.ts --project=chrome --workers=1
```

`BL_ISLAND_WIRE_PORT` can override the coordinator port. Each test starts its own tracked child with a temporary data directory and test-only settings, reaps it on completion/failure (SIGTERM with a three-second SIGKILL fallback), and removes its data. Neither production settings nor persistent user data are used. Credentials, request bodies and state are not printed.

Results on the backoff branch before integration with island leave: **3 passed (21.3 seconds)**; typecheck passed. The coordinator port had no listener after completion.

1. A real join-budget refusal is seeded immediately after a three-second window begins. The actual browser `runIsland` reads `X-Island-Request-Applied: false` and `Retry-After` from the real 429, waits at least the advertised delay, retries exactly once, joins once, and receives idle. The coordinator has exactly one registration, no assigned segments, and requests never overlap. An inert GPU proxy throws on any access, so no GPU/scientific run occurs.
2. Stop fires during the real 429 cooldown. `runIsland` resolves zero tasks in under one second, sends no retry, invokes no registration callback, and leaves no registrations.
3. An independently started coordinator at its one-island capacity returns a real 503. Cross-origin browser JavaScript reads both the unapplied marker and `Retry-After`; the existing one-island state remains unchanged.

Fixture corrections during development: an ordinary 404 page was replaced by inert HTML to avoid unrelated page lifecycle; Chrome's default local-network denial was resolved through the normal per-origin permission; an empty queue's sparse `counts` map is treated as zero assigned work. These were test setup corrections, not product failures.

## Separate leave integration

The original standalone branch did not implement DELETE island leave. The successful idle test therefore expects its one known registration to remain until normal pruning; this is explicitly not proof of immediate cleanup. The branch now incorporates PR74 as its dependency. The combined local integration passed all three checks using `BL_EXPECT_ISLAND_LEAVE=1`. That mode instead requires exactly one DELETE and zero active registration rows after successful idle exit. The cancellation-before-join test always requires zero rows.

This smoke does not create work assignments or exercise heartbeats during a GPU run. It proves real registration backoff, browser-visible refusal headers, cancellation while waiting, single in-flight request behavior for that lifecycle, capacity refusal state preservation, and scratch-process cleanup. Lease ownership and concurrent heartbeat behavior belong to the focused client/server suites.
