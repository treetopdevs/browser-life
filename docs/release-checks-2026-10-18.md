# Release checks — local pass

Criteria written 17 October 2026 before the work; results, amendments and the review-fix pass dated below
(the file name carries the date of the slice run, 18 October).

This note works through `docs/public-site-plan.md`, section "Release checks after a host is chosen", as far as
it can be done and tested on this machine. Production is `cadence.garden` (Traefik on the droplet → Caddy in the
`site` container → Phoenix `coordinator:4000`, see `deploy/README.md`). Nothing here deploys, connects to the
droplet or pushes `ci-deploy`. Each row ends as **Done** (with how it was verified) or **Needs the live host**.

## Criteria, stated before running

These are fixed before any code changes. A row passes only if its criterion holds as written; a changed criterion
gets a dated amendment below, not an edit here.

### 1. What an unauthenticated client can read

- `GET /api/public/status` answers 200 with exactly the keys `counts`, `activeIslands`, `deviceTypes`,
  `updatedAt`, and `Cache-Control: no-store`. `counts` has only segment-status names as keys and integers as values.
  No island id, adapter, user agent, experiment name or spec appears anywhere in the body.
- With an admin token configured and `allow_local_admin` off, each of `GET /api/status`, `GET /api/experiments/<name>`
  and `GET /api/discovery/status` answers 401 with no `Authorization` header, with a wrong bearer token, and from a
  loopback peer without a token. With the right token each answers 200.
- The public status page (`apps/lab/status/`) needs no change: the field set does not move.
- The coordinator's `priv/static/index.html` holds no data (it fetches `/api/status` with the token typed into it).
  In production it is not reachable at all, because Caddy forwards only `/api/*` and `/healthz` to the coordinator:
  that last part is a live-host row.

### 2. Join, next and segment abuse controls

- Addresses are budgeted the way the garden's letter limiter does it (`Coordinator.LetterLimiter`): the key is
  `sha256(boot_salt <> term_to_binary(network))` with a fixed window, an IPv6 address counted as its /64 and an
  IPv4-mapped address as its IPv4 address, the salt drawn at boot and never persisted or logged, old windows swept,
  and the table capped (past the cap a new address is refused, a known one keeps counting). The address is the peer,
  or the right-most `X-Forwarded-For` entry only when `trust_forwarded_for` is on (the same key the garden reads).
- `POST /api/islands`: at most **20 joins per address per hour**. The 21st answers 429 with a `Retry-After` header
  (whole seconds, rounded up) and `{"error": ..., "retryAfterMs": n}`, and the Queue is not called (the island count
  does not change). A different address keeps its own budget.
- `POST /api/next`: at most **120 calls per island per minute**, counted after the island authenticates, keyed on
  the island id. Over it: 429 in the same shape. A request that fails authentication (401) charges nothing.
- A coarse per-address ceiling across all island routes exists in config (`island_requests_per_address`) and is
  **off by default**; it is meant to be switched on only after the live-host proxy row below passes, because until
  then every visitor shares one address.
- Bodies: `POST /api/islands` and `POST /api/next` are parsed with a **4096-byte** limit (413 past it) and JSON only
  (415 for any other content type), ahead of the endpoint's 8 MB parser.
- The island table is bounded at **20,000** islands. At the bound a join first forgets islands that never ran or
  verified anything, were last seen more than a day ago and hold no current assignment; if none can be forgotten the
  join answers 503 and nothing is persisted.
- `GET /api/public/status` is served from a **2 s** cache outside the Queue process, so a flood of status reads
  costs the Queue about one call per two seconds.
- No existing coordinator test changes its expectations, and `tests/deno/coordinator_integration.ts`'s three joins
  stay well inside the join budget.

### 3. CORS and trusted proxy

- Production config allows no cross-origin caller unless `BL_CORS_ORIGINS` names one; in production a `*` or any
  origin that is not `https://` makes the coordinator refuse to start. Verified by reading the config files the way a
  release does (`Config.Reader`) in a test.
- An allowed origin is echoed with `Vary: origin`; any other origin gets no `Access-Control-Allow-Origin`.
- Documented in `deploy/README.md`: what Phoenix sees as the peer and as `X-Forwarded-For` through Traefik → Caddy,
  and what must be true before `BL_TRUST_FORWARDED_FOR=1` is set. Changing `deploy/Caddyfile` is a deploy change and
  is not made here.

### 4. Canonical URLs and sitemap

- Every page listed in `apps/lab/public/sitemap.xml` exists, answers 200 on the dev server, and carries
  `<link rel="canonical">` and `og:url` equal to its `<loc>`; no listed page is `noindex`.
- The production build (`vite build`) ships `robots.txt` (allowing crawling and naming
  `https://cadence.garden/sitemap.xml`) and `sitemap.xml`; for every `<loc>` the built `index.html` exists with that
  canonical and `og:url`; every built page that has a canonical names a URL in the sitemap; the diagnostic pages
  (`/selftest.html`, `/island.html`) are `noindex` and not listed.

### Rows that need the live host

HTTPS and the certificate (WebGPU needs a secure context); `www` redirect; `/healthz`; that `/index.html` on
`cadence.garden` is the public homepage, not the operations page; what peer and `X-Forwarded-For` the coordinator
actually receives; join load limits against the real proxy; the 404 response for an unknown path; mobile and
keyboard access and missing-GPU behaviour on real devices; canonical URLs and sitemap resolving at the live domain.

## Amendments

- **17 October 2026, body limit 4096 → 16 KB.** Criterion 2 said join and next bodies are limited to 4096 bytes. An
  existing test (`garden_api_test.exs`, "a letter body over 1 KB is a 413 before it is parsed") posts a 5,000-byte
  join body and expects 200, and the same criterion says no existing test changes its expectations. The limit is
  16,384 bytes instead: still JSON only, still far below the 8 MB general parser, and a long adapter string is
  clipped by the Queue rather than refused.
- **17 October 2026, integration joins.** Criterion 2 said `tests/deno/coordinator_integration.ts` makes three
  joins. It makes three direct joins plus one per `runIsland` call (about fourteen in all), and it runs the server
  with `MIX_ENV=dev`, whose join budget is 1,000 per hour (`config/dev.exs`). It stays well inside the budget, as
  the criterion requires. Not run here, because it needs a GPU and a `mix phx.server`; the claim rests on counting.
- **17 October 2026 (review fixes), join budget off in production.** Criterion 2 said 20 joins per address per hour.
  Through Traefik → Caddy every visitor is expected to be one address, so in production that is one global cap a
  single script can spend for every volunteer (all four reviews). The budget is built and tested as stated, but
  `config/prod.exs` sets it to `nil` until the trusted-proxy row lands; `BL_ISLAND_JOINS_PER_ADDRESS` turns it on
  (`20`) or off (`off`), a blank value leaves the config alone, and anything else stops the boot by name.
- **17 October 2026 (review fixes), segment controls.** Criterion 2's heading named segment abuse controls but listed
  none, and the segment routes were open to an authenticated island at any rate (each heartbeat rewrites
  `state.bin`), and `next` let one island hold any number of leases. Added: at most **600 segment requests per
  island per minute** (heartbeat, complete, reject, fail, checkpoint and file uploads, checkpoint downloads), counted
  after authentication like `next`; and at most **4 pending assignments per island** (`next` answers idle past it).
  Coalescing the Queue's persistence of heartbeats was not done: it changes what survives a restart, and the budget
  already bounds the rate.
- **17 October 2026 (review fixes), the island bound.** Criterion 2 said a join at the bound forgets zero-work islands
  last seen more than a day ago, else 503. That locked out every new joiner for a day after 20,000 throwaway joins,
  and a vanished island's expired lease protected it forever (reclamation only ran on `next`). Now a join at the
  bound reclaims expired leases first, forgets zero-work islands holding nothing that are more than a day old, else
  the least recently seen of them (a twentieth of the bound), and answers 503 only if every island did work or holds
  an attempt. The bound is settable with `BL_MAX_ISLANDS`.
- **17 October 2026 (review fixes), status cache.** Criterion 2 said a flood of status reads costs the Queue about one
  call per two seconds. A cold cache under concurrent requests called the Queue once per request (Codex's probe: 12
  of 12). Misses are now coalesced as the garden's views are, the TTL counts from when the computation finished, and
  a cold cache's waiters compute themselves after 2 s rather than answer an error (`/healthz` reads this; amended by
  Codex pass 3 below: they now answer 503 instead of calling the Queue).
- **17 October 2026 (Codex pass 2).** Four gaps in the fixes above, now closed. (a) At the island bound, the
  fallback evicted the least recently seen zero-work island even if it had joined a second ago, so a join could cost
  an honest new volunteer (or a gardener waiting for work) its credentials; now only islands not seen for ten
  minutes (`island_prune_grace_ms`) are eligible, and otherwise the join is a 503. (b) An island's file downloads
  (`GET /api/segments/:id/files/:name`, up to 64 MB each) were outside every budget; they are now charged to the
  island's segment budget, and the administrator's exports still are not. (c) A join or next body sent with no
  content type was left unread by the parsers and drained afterwards by the server with its own larger allowance;
  it is now read up to 16 KB and dropped, 413 past it. (d) Island-id counters bypassed the table cap on the
  assumption that `max_islands` bounds them, but an island forgotten at the bound leaves its counters until the
  sweep; the cap now applies to every key. Also, a limiter restart between two table reads could raise an
  `ArithmeticError` (a 500) instead of failing open; that is handled.
- **17 October 2026 (Codex pass 3).** Two P2s, no P0 or P1. (a) The status cache's cold-cache waiters still called
  the Queue themselves after the 2 s wait, so a slow Queue just after a restart got one call per reader again, and a
  Queue call that exited was a 500. Now only the reader holding the refresh marker computes; the others answer 503
  with `Retry-After: 1` after the wait, and a computation that exits serves the expired entry if there is one, else
  the same 503. The earlier promise that `/healthz` never answers an error is withdrawn: a cold cache behind a slow
  Queue is a short 503, which nothing in the deploy probes automatically. (b) The CORS check took origins a browser
  never sends: `https://[2001:db8:0:0:0:0:0:1]` (browsers send `[2001:db8::1]`), embedded IPv4 in IPv6, numeric
  names such as `127.1`, non-ASCII names (browsers send punycode) and ports outside 1..65535. It now refuses all of
  those by name at boot.
- **17 October 2026 (review fixes), CORS.** Criterion 3 said production refuses `*` or a non-https origin. It also
  accepted `https://*`, `https://` and `https://cadence.garden/` (which never matches a browser's `Origin`). It now
  refuses anything but a whole origin exactly as a browser sends it.
- **17 October 2026 (review fixes), build check.** Criterion 4's build check skipped when `apps/lab/dist` was missing
  and passed against a stale build. It now fails when the built `robots.txt` or `sitemap.xml` differs from
  `apps/lab/public`. A missing build skips the test with a message saying to run `pnpm build` (amended after Codex
  pass 3, so a plain `npx playwright test` in a clean checkout stays green); with `BL_REQUIRE_BUILD_CHECK=1` a missing
  build fails, which is how the release check runs it: `pnpm build && BL_REQUIRE_BUILD_CHECK=1 npx playwright test
  tests/e2e/public-routes.spec.ts --project=chrome`. When a build exists the test still checks every listed route.

## Results

Run on 17 October 2026 in the slice worktree (branch `claude/slice7-release-checks`, from d683ad9). Nothing was
deployed, nothing connected to the droplet, nothing pushed. Load averages from `uptime` are given beside each run;
the machine was heavily loaded throughout, and no test timed out.

| Gate | Result | `uptime` load (1/5/15 min) |
| --- | --- | --- |
| Targeted coordinator tests (limiter, limits, queue, release config, api controller, checkpoint) | 125 tests, 0 failures | 108.8 / 112.7 / 105.0 |
| `mix precommit` (warnings as errors, format, full suite), final run | 326 tests, 0 failures | 93.1 / 100.1 / 101.4 before, 92.2 / 99.6 / 101.2 after |
| `pnpm typecheck` | exit 0 | 101.3 / 107.1 / 103.6 |
| `pnpm vitest run apps/lab/test/social-meta.test.ts packages/runner/test/coordinator-presets.test.ts` | 29 passed | 101.3 / 107.1 / 103.6 |
| `pnpm build` | exit 0; `dist` has `robots.txt`, `sitemap.xml`, every listed page and the per-world copies | 103.3 / 107.4 / 103.7 |
| `npx playwright test tests/e2e/public-routes.spec.ts --project=chrome` | 4 passed (the build test ran, not skipped) | 104.5 / 107.6 / 103.8 |
| `npx playwright test tests/e2e/public-site.spec.ts --project=chrome -g "public status"` | 3 passed (status page unchanged) | 99.7 / 106.2 / 103.4 |

Review-fix pass, 17 October 2026, same worktree (the first table's figures are from before the fixes):

| Gate | Result | `uptime` load (1/5/15 min) |
| --- | --- | --- |
| Targeted coordinator tests (queue, limiter, limits, release config) | 76, 12, 13 and 7 tests, 0 failures | 282.8 / 235.9 / 189.9 at the start |
| `mix precommit` (warnings as errors, format, full suite), final run after the last test edit | 342 tests, 0 failures | 387.5 / 368.4 / 284.0 before, 410.0 / 375.8 / 290.1 after |
| `pnpm typecheck` | exit 0 | 413.7 / 339.9 / 248.4 |
| `pnpm vitest run apps/lab/test/social-meta.test.ts packages/runner/test/coordinator-presets.test.ts` | 29 passed | 410.2 / 341.6 / 250.1 |
| `pnpm build` | exit 0; `dist` has `robots.txt` and `sitemap.xml` | 410.2 / 341.6 / 250.1 |
| `npx playwright test tests/e2e/public-routes.spec.ts --project=chrome` | 4 passed; with `dist` moved aside the build test fails, and skips with `BL_SKIP_BUILD_CHECK=1` (that flag was later replaced: see the build-check amendment) | 405.9 / 341.9 / 250.7 |
| `npx playwright test tests/e2e/public-site.spec.ts --project=chrome -g "public status"` | 3 passed | 401.9 / 342.1 / 251.3 |

Codex pass 2 fixes, 17 October 2026 (coordinator code, tests and docs only; no TypeScript, HTML or public file
changed, so typecheck, vitest, the build and the e2e specs above still stand):

| Gate | Result | `uptime` load (1/5/15 min) |
| --- | --- | --- |
| Limiter, limits, queue, release config, checkpoint and controller tests | 145 tests, 0 failures (the untyped-body test fails with the fix removed) | 499.4 / 463.2 / 378.9 |
| `mix precommit` (warnings as errors, format, full suite) | 345 tests, 0 failures | 490.3 / 472.3 / 392.3 before, 477.7 / 470.7 / 393.6 after |

Codex pass 3 and CodeRabbit fixes, 17 October 2026, after merging origin/main (0a1179b):

| Gate | Result | `uptime` load (1/5/15 min) |
| --- | --- | --- |
| Limiter, release config, limits, controller and checkpoint tests | 71 tests, 0 failures | 319.7 / 355.7 / 377.9 |
| `mix precommit` (warnings as errors, format, full suite) | 348 tests, 0 failures | 330.2 / 351.2 / 374.3 before, 343.3 / 353.1 / 374.6 after |
| `pnpm typecheck` | exit 0 | 318.0 / 353.5 / 376.7 |
| `pnpm build` | exit 0 | 390.6 / 429.2 / 395.5 |
| `BL_REQUIRE_BUILD_CHECK=1 npx playwright test tests/e2e/public-routes.spec.ts --project=chrome` | 5 passed (the build test ran) | 332.6 / 352.8 / 375.3 |
| the same without the variable, with a build | 5 passed | 332.6 / 352.8 / 375.3 |
| the same with `dist` moved aside | 4 passed, the build test skipped with its message; with `BL_REQUIRE_BUILD_CHECK=1` it fails | 330.1 / 351.6 / 374.6 |

The e2e runs used a copy of `playwright.config.ts` on port 5194, because another worktree's run held 5174.

### 1. What an unauthenticated client can read

- Public status keys and `no-store`: **Done.** `api_controller_test.exs`, "public status exposes only aggregates…"
  (existing) and "operator views need the admin token, and the public status names no island, adapter or
  experiment" (new). The new test checks every `counts` key is a segment status with an integer value, and that the
  raw body contains no island id, token, adapter, user agent, experiment name, preset or condition.
- Operator routes refuse without the token: **Done.** The same new test covers `/api/status`,
  `/api/experiments/api` and `/api/discovery/status`. Each answers 401 with no header (from the test's loopback
  peer), with a wrong bearer, and with the token plus a trailing space. The right token gets 200. With a token
  configured this holds even with `allow_local_admin` on (with no token configured and `allow_local_admin` on, a
  loopback peer is an administrator; production never has `allow_local_admin` on). With no token configured and
  `allow_local_admin` off, all three answer 401 to a loopback peer. The gating already existed before this slice; the
  slice adds the test, and checks that each 401 body names no island id, token, adapter, user agent, admin token or
  experiment.
- The other public reads: **Done** (read). `/api/public/garden`, `/api/public/gardens/:name` and their checkpoint
  route carry counts, distinct-value counts and digests only (`Coordinator.Garden`'s view never echoes an island id,
  adapter or user agent); `/healthz` is Caddy's rewrite to `/api/public/status`. Over HTTP, "public status over HTTP
  is served from the cache within its ttl" checks the cached body and its four keys.
- Public status page unchanged: **Done.** No field moved. `updatedAt` now means when the cached numbers were
  computed (at most 2 s old). The page shows it as "Last checked". `public-site.spec.ts`'s three status tests pass.
- Operations page holds no data: **Done** (read `priv/static/index.html`, which fetches `/api/status` with a typed
  token). Not reachable through Caddy: **Needs the live host.**

### 2. Join, next and segment abuse controls

- Hashed, salted, network-bucketed, swept, capped address budget with the garden's address rule: **Done.**
  `island_limiter_test.exs` checks the table holds no IP tuple, that one IPv6 /64 shares a budget, that an
  IPv4-mapped address is its IPv4 address, that a full table refuses a new address and keeps counting a known one,
  and that sweep drops ended windows. `island_limits_test.exs` checks the right-most `X-Forwarded-For` rule: a
  client-written left entry does not escape, an unparsable right-most entry falls back to the peer, and the header
  is ignored when trust is off.
- 20 joins per address per hour, 429 shape, Queue not called: **Done**, and **off in production** (amendment).
  "join past the budget answers 429…" checks the island count is unchanged and that `Retry-After` is `retryAfterMs`
  rounded up to whole seconds. "another address keeps its own join budget" passes. `release_config_test.exs` checks
  production's `nil` and every branch of `BL_ISLAND_JOINS_PER_ADDRESS` (a number, padded, `off`, `0`, blank, and four
  bad values that stop the boot by name). "concurrent charges against one key allow exactly the limit" runs 200
  concurrent charges against a limit of 20 and gets exactly 20. Windows are fixed, so up to twice a budget fits
  across a window boundary (as with the letter budget). The budget table's cap refuses a new address when full, so a
  flood of distinct addresses (rotating IPv6 /64s) can lock out new joiners until its window ends (inherited from the
  letter budget); the cap is soft under simultaneous first-seen addresses.
- 120 next calls per island per minute, after authentication: **Done.** "next past the per-island budget…" also
  checks that five 401s first leave the budget whole and that another island is unaffected. 120 a minute is a hard
  cap; the runner asks every 5–10 s while idle.
- Segment routes, 600 per island per minute, after authentication: **Done** (amendment). "segment routes past the
  per-island budget answer 429…" checks heartbeat and complete, that 401s charge nothing and that another island is
  unaffected; the limiter test checks the kind is apart from `next`, and that island-id keys count toward the table
  cap (a new one is refused past it, a known one keeps working; Codex pass 2). "an island's file downloads are
  charged to its segment budget; the administrator's are not" covers downloads, including that the budget is
  shared with heartbeats and that a 401 charges nothing.
- At most 4 pending assignments per island: **Done** (amendment). `queue_test.exs`, "pending cap": an island at the
  cap is idle until it gives work back while another island still gets work, and `nil` is no cap.
- Coarse per-address ceiling off by default: **Done.** "the coarse per-address ceiling is off by default and
  applies when set", and "the coarse ceiling covers every island route but file downloads", which sends each of the
  ten covered routes twice under a ceiling of one and checks file downloads never charge. It charges before
  authentication.
- Body limits: **Done, amended to 16 KB** (see Amendments). A 17,000-byte body is a 413 on `/api/islands`,
  `/api/isl%61nds` and `/api/next`, and so is one with no content type at all (Codex pass 2; checked to fail
  without the fix). A form or `text/plain` body is a 415. A small JSON body, a small untyped body, or no body,
  still works. This is a behaviour change for hand-made calls: `curl -d '{...}'` sends a form content type and now gets
  415 (the coordinator README says so); the runner and the Deno island send JSON.
- Island table bound: **Done** (amended). `queue_test.exs`, "max islands", eight tests: a stale zero-work island is
  forgotten; a stale island that did work is kept, and so is one holding a current lease; a holder whose lease
  expired is reclaimed by the join itself, so a replacement can join; a fresh zero-work island is kept while a
  staler one goes; with none older than a day the least recently seen zero-work island past the grace goes and one
  asking for work stays; an island seen within the grace is never evicted, the join is refused instead and
  `state.bin` is unchanged, and after the grace the least recently seen goes; when every island did work or holds an attempt the join returns `{:error, :full}` and `state.bin` is
  byte-identical; an island forgotten between authenticating and asking for work is answered idle and then fails
  authentication. Over HTTP, "a join when every island did work or holds an attempt answers 503…" checks the status,
  body and island count, and "me answers 401, not a crash, for an island forgotten after it authenticated" covers
  `me/2`'s missing-island branch.
- 2 s public status cache outside the Queue: **Done** (amended). "public status cache: served within the ttl,
  recomputed after it, off at 0"; "concurrent misses on a cold cache compute once" (12 concurrent callers, one
  computation); "while one caller refreshes an expired entry, the others are served it"; "the ttl counts from when
  the computation finished".
- No existing test changed its expectations: **Done** (with the amendment). `config/test.exs` sets the island
  budgets out of the way and the status cache to 0. The full suite passes.
- Join limits against the real proxy: **Needs the live host.** Until Caddy passes on the client address, every
  visitor is expected to share one address, so the join budget is off in production. Turning it on needs the Caddy
  change, `BL_TRUST_FORWARDED_FOR=1`, `BL_ISLAND_JOINS_PER_ADDRESS=20`, and both variables added to the coordinator's
  `environment:` in `compose.dokploy.yaml` (which today does not pass them through; `deploy/README.md`).

### 3. CORS and trusted proxy

- Production allows no cross-origin caller by default and refuses anything but whole https origins: **Done**
  (amended). `release_config_test.exs` reads `config/config.exs` and `config/runtime.exs` with `Config.Reader` for
  `:prod`, and refuses `*`, `http://`, `https://`, `https://*`, `https://*.example`, a trailing slash, a path, a
  query, a fragment, user info, an explicit `:443` and upper case, while taking `https://a.example:8443`. It also
  checks that production requires `SECRET_KEY_BASE` and `BL_ADMIN_TOKEN`, keeps `allow_local_admin` and
  `trust_forwarded_for` off, and leaves the coarse ceiling and the join budget off.
- Allowed origin echoed with `Vary: origin`, others nothing: **Done.** `island_limits_test.exs`, the preflight test
  on `/api/islands` (204, echo, `vary`; no echo for `null`, a trailing slash, prefix and suffix spoofs, another scheme
  or port, upper case, and with `cors_origins: []` for anyone), plus the existing garden CORS test.
- Documented: **Done.** `deploy/README.md`, "Client addresses, abuse limits and CORS". Caddy's default
  `X-Forwarded-For` handling was checked against Caddy's docs (via context7): incoming `X-Forwarded-*` from an
  untrusted peer are ignored. The proposed `trusted_proxies` / `trusted_proxies_strict` / `{client_ip}` change is
  written there, not made. What the coordinator actually receives: **Needs the live host.**

### 4. Canonical URLs and sitemap

- Dev server: **Done.** `public-routes.spec.ts` checks every `<loc>` answers 200 with exactly one canonical link and
  one `og:url` equal to it, and no `noindex`. `robots.txt` lets every crawler fetch `/` and every listed route
  (its `User-agent: *` rules, longest match first as RFC 9309 reads them; the checker has its own test) and names
  exactly one sitemap, `https://cadence.garden/sitemap.xml`, compared literally (CodeRabbit's review). `/selftest.html`
  and `/island.html` are `noindex`, have no canonical link and are not listed.
- Production build: **Done** (amended). The same spec reads `apps/lab/dist`; with no build it skips, or fails under
  `BL_REQUIRE_BUILD_CHECK=1` (the release check sets it). It fails if
  its `robots.txt` or `sitemap.xml` differs from `apps/lab/public`. It checks `robots.txt` and `sitemap.xml` ship,
  that every `<loc>` has a built page with a matching canonical and `og:url`, and that every built page with a
  canonical names a sitemap URL. Pages without one are `noindex`. Each per-world copy keeps its page's canonical
  and previews as `/<page>/?world=<id>`. `discovery/index.html` is not part of the site build: it is built into
  the coordinator, and Caddy never serves it.
- At the live domain: **Needs the live host.**
- Not checked: the sitemap's `<lastmod>` values (all still `2026-10-07`, hand-maintained), and that every sitemap
  route has its trailing-slash redirect and per-world rewrites in `deploy/Caddyfile` (live host).

### Known gaps left open by this slice

- The island runner (`packages/runner/src/island.ts`, outside this slice) stops on any 429 or 503 and does not honour
  `Retry-After`; a failed heartbeat is only logged. No test covers a client backing off.
- `CoordinatorWeb.ClientAddress` repeats the address rule of `CoordinatorWeb.GardenController`'s private `address/1`
  (the garden modules are read-only for this slice); nothing keeps the two in step.
- The garden's letter budget has the same one-address problem behind the proxy and is unchanged.
- Each heartbeat still rewrites `state.bin`; the segment budget bounds the rate, nothing coalesces it.
- With the join budget off, joins in production are bounded only by the island table, the body limit and Caddy.
- The status page is checked against mocked responses and the controller's field set separately; nothing connects
  the page to a running Phoenix. `tests/deno/coordinator_integration.ts` was not run (GPU).

### Still needs the live host

HTTPS and the certificate; the `www` redirect; `/healthz`; that `https://cadence.garden/index.html` is the homepage;
what peer and `X-Forwarded-For` the coordinator receives (then the Caddy change, `BL_TRUST_FORWARDED_FOR=1`, and the
coarse ceiling); join limits through the real proxy; 404s; mobile and keyboard access and missing-GPU behaviour on
real devices; canonical URLs and the sitemap at the live domain.
