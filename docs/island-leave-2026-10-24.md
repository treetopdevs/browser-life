# Explicit island leave — 2026-10-24

## Plan and contract

Close the coordinator follow-up in `docs/island-cancel-2026-10-18.md`: Stop should remove a known island immediately and make unfinished work available without waiting for the lease timeout.

- `DELETE /api/islands/:id?island=:id`, with the existing `Authorization: Bearer <join token>`, returns empty HTTP 204 after the queue has persisted the leave.
- The path id must equal the credential's island parameter (403 otherwise). An existing island requires its own bearer token (401 otherwise). The join token authorizes leaving even while idle; a segment lease is not identity authority.
- A missing island with a supplied bearer and matching id is an idempotent 204 no-op. This deliberately does not authenticate a historical identity: it cannot mutate anything. No credential tombstones are retained. Subsequent ordinary calls using the removed identity receive 401.
- The existing per-address request ceiling applies to every leave; the per-island segment budget applies only to authenticated live identities. Missing identities allocate no island limiter buckets; an invalid credential for an existing island does not consume its segment budget. Rate-limited requests return the usual 429 with Retry-After. DELETE is included in allowed CORS methods.

## Atomic state transition

One Queue call rechecks the token, abandons every pending attempt owned by the island and removes its row, then persists before replying. Pending run attempts become `abandoned` and their segments return to `pending`; pending verify attempts become `abandoned` while their segments stay `done`. Completed attempts, accepted results and uploaded artifact history remain unchanged. A separate optional persisted `historical_islands` map keeps only adapter names for departed islands referenced by retained attempts, preserving producer/verifier and garden device provenance across restart. It contains no tokens, capability or activity data; idle join/leave creates no historical entry. Its size is bounded by distinct ids in retained attempts. Active status and authentication use only the live island table. Another island may immediately claim released work with a new lease.

Completion and leave are serialized by the Queue. If completion wins, its accepted result remains. If leave wins, completion and uploads under the abandoned lease fail. A previously authenticated `/next` arriving after leave is idle under the existing missing-island guard, so it cannot recreate the row or strand new work. Missing-id leave retries do not write state.

## Cancellation amendment

This supersedes the earlier cancellation slice's accepted lease-timeout-only cleanup for known identities. After stopping, the runner makes a best-effort leave request under an independent two-second timeout. This is the sole cleanup exception to the rule against new requests after abort. Any already-sent complete/reject/fail must settle first, so cleanup cannot overtake an accepted decision. Failed, rate-limited, unavailable or unsupported leave falls back to existing lease expiry; it does not claim successful removal. Unknown identities from a join whose response was lost cannot be explicitly removed.

## Verification

Queue tests cover active run release, active verify release, unchanged completed run and verify results, stale completion and heartbeat rejection, reassignment, persisted removal, wrong-owner token, duplicate leave, missing-island next, and concurrent completion/leave. HTTP tests cover idle leave, missing/wrong credentials, mismatched identity, duplicate 204, revoked identity, segment budget and coarse address ceiling. Completed check results are recorded below.

Results (2026-10-24):

- Focused Queue, garden Queue and HTTP limits suite: 176 tests, 0 failures (before the final CORS regression addition).
- Pre-limiter-fix `mix precommit`: warnings-as-errors compilation, dependency unlock check, formatting and 562 tests, 0 failures. Tracked dependency lock unchanged.
- `git diff --check`: clean.
- Provenance tests include producer/verifier after leave and restart, garden verification/device counts after restart, no idle archive, and removal of archive entries once their attempts are reset away. Stale uploads are rejected as well as completions and heartbeats.
- No public coordinator was launched; these are local automated checks. Dependency fetch reported existing advisory notices for pinned packages; no dependency upgrade was made in this slice.

Rate-limit review amendment: a missing identity now bypasses the per-island budget entirely (including a duplicate after a successful leave), preventing arbitrary unauthenticated ids from filling the shared limiter table. It still passes the coarse address limiter and Queue's serialized credential recheck. Targeted HTTP/limiter suite after this amendment: 19 tests, 0 failures, including 100 unknown ids allocating zero limiter rows and a live identity exhausting/consuming its segment budget.

## Coordinator validation after limiter hardening

The final `mix precommit` run passed 563 tests with zero failures; the combined client/page suites passed 100 tests and TypeScript typecheck. Live loopback HTTP against scratch state confirmed authenticated leave, wrong-token rejection, duplicate204, immediate reassignment under a new lease, and empty active rows. Its initial fixture omitted current metricsVersion and correctly received idle; the corrected fixture uses current metrics. No public server or production state was used.

Portable wire test: `deno run --no-lock -A tests/deno/island_leave.ts` passed, as did its Deno check. It uses actual runIsland cleanup and real loopback HTTP, imports current metricsVersion, and fails if a GPU is accessed. Scratch state and its owned server are cleaned up after the test.

Argon 4 High adversarial source-packet review is running; no verdict is claimed until it completes. The initial packet precedes the unknown-id limiter hardening and portable smoke addition, which are documented with their targeted evidence above.
