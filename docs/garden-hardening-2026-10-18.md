# Garden hardening: rules written before the code (2026-10-18)

Slice 15 of the backlog run closes the three garden follow-ups that slice 9 reported
(`docs/garden-local-2026-10-17.md`, "Not covered here" and its amendments). It adds no physics, no
contract key, no golden pin, no route and no change to the public view's JSON. This note was written
before any of the code; a change to the criteria below is a dated amendment at the end, never a
silent edit.

## 1. Islands can show the garden island token

**What is missing.** The coordinator already honours `BL_GARDEN_ISLAND_TOKEN`
(`:garden_island_token`, PR #21): `Queue.join/1` marks an island `garden: true` when its join body
carries `"gardenToken"` equal to it, and `pick_task/4` then offers a garden's days only to such
islands. `runIsland`'s join body has no such field, so with the token set no island can tend a garden.

**Rules.**

- `IslandOptions.gardenToken?: string`. When it is a non-empty string, the `POST /api/islands` body
  carries `"gardenToken"`; otherwise the key is absent (not `null`, not `""`). It is sent in the join
  body only: never in a query string, a header, `/api/next` or any later call, and never logged.
- It matters only at join. A resumed identity (`identity`) makes no join, and needs none: the
  coordinator recorded `garden: true` on that island id when it joined.
- **Headless** (`tools/island.ts`): `--garden-token <t>`, else the environment variable
  `BL_ISLAND_GARDEN_TOKEN`; the flag wins; empty means none. The island's variable is deliberately
  not the coordinator's `BL_GARDEN_ISLAND_TOKEN`: a shell that runs a coordinator with its token set
  must not hand that token to whatever coordinator an island there is pointed at. The flag is visible
  to other local users in `ps`, so the variable is the recommended form. The CLI prints whether a
  token is in use, never the token.
- **Browser** (`/island.html`): a URL fragment, `#garden-token=<t>`. A fragment never reaches a
  server or a `Referer`, so it never lands in a request log. On load the page reads it, removes it
  from the address bar (`history.replaceState`, other fragment keys kept) and holds it in memory only;
  it is never written to `sessionStorage` (the `bl-island` record keeps id and island token only) or
  anywhere else. When a fragment token is present, any remembered identity is forgotten, so the next
  join is a fresh one that shows the token. The token is sent only when the coordinator URL is the
  page's own origin; to another coordinator the page joins without it and says so. No input field:
  `island.html` is not edited (another slice is editing the public pages), and a volunteer who has
  no token sees no change.
- `bin/garden-dev` stays tokenless (it drops every `BL_*` variable before starting anything, and is
  outside this slice); its comment that islands "cannot send a garden token yet" becomes stale and is
  reported, not edited.

**Pass criteria.**

- vitest (`packages/runner/test/island.test.ts`): with `gardenToken: "t"` the join body is exactly
  `{adapter, userAgent, metricsVersion, gardenToken: "t"}`; without it (and with `""`) there is no
  `gardenToken` key; no `/api/next` body and no URL ever contains the token; with `identity` no join is
  made and the token appears in no request.
- vitest: the pure helpers the CLI and page use (`gardenTokenFrom(flag, env)`, and the fragment
  parse/strip and origin rule) behave as stated above, including empty values and other fragment keys.
- `tests/deno/garden_e2e.ts` runs with the token set (amended in the slice-9 note): its coordinator
  gets `BL_GARDEN_ISLAND_TOKEN` (a fixed test value set after the `BL_*` scrub), islands A and B join
  with it, and every slice-9 criterion still holds. A third island C joins without it while day 0 is
  released and unassigned, asks once and is told idle (no task); `tending.islandsToday` stays 2 at
  step 5. That an untokened island still gets ordinary (non-garden) work is pinned by ExUnit
  (`garden_queue_test.exs`, "without one, any island may; an ordinary experiment is never gated")
  and is not re-spent on the GPU.
- ExUnit, over HTTP: `POST /api/islands` with `"gardenToken"` in the body, under a configured token,
  gets an island that is offered day 0; one without it is told idle.
- The coordinator's logs never print a garden token: Phoenix's default parameter filter is
  `["password", "token"]` [wrong: it is `["password"]` alone; see "after review" below], matched case-sensitively, so a `"gardenToken"` key is printed in dev's
  `Parameters:` lines (router dispatch logs at `:debug`; production logs at `:info`, so not there).
  `config/config.exs` adds `"Token"` to `:filter_parameters`, and an ExUnit test asserts the prod
  config filters `%{"gardenToken" => "x"}` to `"[FILTERED]"` (this is the one line outside the
  slice's listed area, asked for in the plan).

## 2. The fork the view names is served at once

**What is wrong.** `LetterLimiter` caches the view and the servable-checkpoint set separately, each
for `garden_cache_ms` (2 s). A day becoming verified invalidates neither. So a checkpoint set cached
before the verification (step 2's 404 in the e2e fills it with nothing) can still be served after a
fresh view names the new fork, and `fork.checkpoint` answers 404 for up to 2 s.

**Rule.** When a garden day becomes verified (`Queue.record_garden_day/3`, `{"verify", "verified"}`),
the Queue calls `LetterLimiter.invalidate(name)` before it replies. `invalidate/1` is ETS work only
(no call back into the Queue), it bumps the garden's generation, and every cache write checks that
generation; Queue calls are serialized. So any view that shows the new fork was computed after the
verification, and any checkpoint set served after that view was computed after it too.

That one transition is enough because the servable set (the verified prefix's digests) only grows:
a verified garden day cannot be rejected, divergence and failure stop the prefix without shrinking
it, and a requeue (of a failed or diverged day only), a letter and a drop already invalidate from the
controller. A day that is only done changes the view (tip, clock) but not what is served; its view
staleness (up to 2 s) is the documented cache behaviour and stays.

Rejected: serving "the checkpoint named by the current view" (it would key a byte route on a cached
JSON body that is itself up to 2 s behind the Queue), and a Queue call on every cache miss of a
digest (an unauthenticated route that reaches the Queue per random digest).

**Pass criteria.**

- ExUnit (`garden_api_test.exs`, cache on at 600 s), shown failing (404) before the fix: day 0 run;
  the view read (fork `null`, cached); day 0's checkpoint read (404, caching the empty set); day 0
  verified; then `LetterLimiter.cached_checkpoints/1` and `cached_view/1` are `:miss`, the view shows
  `fork.day` 0 with day 0's digest, and the very next read of `fork.checkpoint` is 200.
- The existing cache tests still hold (a checkpoint lookup is cached until an invalidation; a crowd
  makes one Queue call).
- e2e, strengthened (amended in the slice-9 note): at step 3, the first read of `fork.checkpoint`
  after the view first shows the fork is 200, with no polling; the same at step 6 after the restart.

## 3. Production refuses a `spots` garden

**Rule.** Pinned by test, not changed: production's `garden_presets` is the big storm only, from
`config/config.exs` plus `config/prod.exs` (never `dev.exs` or `test.exs`), and `runtime.exs` does not
touch it.

**Pass criteria.**

- `release_config_test.exs`: `Config.Reader.read!("config/config.exs", env: :prod)` gives
  `garden_presets == ["wild-storm-large"]` and `garden_island_token == nil`; reading it with
  `env: :dev` includes `"spots"` (so the reader does follow the environment and the check is not
  vacuous); the prod runtime config has no `:garden_presets` key; `BL_GARDEN_ISLAND_TOKEN` set in the
  environment sets `:garden_island_token` in the prod runtime config.
- A ConnCase test sets `:garden_presets` to the value read from the prod config (so the two cannot
  drift), and `POST /api/gardens` with `presetId` `spots` is 422 with an error naming the presets
  allowed; the same body with `wild-storm-large` (its world holds the founding) is 200, so the 422 is
  about the preset.

## Gates

`cd apps/coordinator && mix precommit`; `pnpm typecheck`; `vitest run packages/runner`;
`deno check` on `tools/island.ts`, `packages/runner/src/island.ts` and `tests/deno/garden_e2e.ts`;
`deno run -A tests/deno/garden_e2e.ts` (short GPU). `uptime` is recorded beside each result; a
timed-out run is rerun once alone before it counts as a failure.

## Amendments

### 2026-10-18: while implementing

- **Item 2's ExUnit test was shown red first.** Before the `invalidate` line, the test failed at
  `cached_checkpoints("commons") == :miss` (`{:ok, %{}}`: the empty set cached by the 404 survived
  the verification), and with the cache assertions taken out the view still said `fork: null` (it was
  cached for ten minutes too); a variant reading day 0's digest straight after the verification got
  `404 {"error":"not found"}`. With the line, all three pass.
- **`gardenTokenFrom`: an explicit empty flag is no token**, even with `BL_ISLAND_GARDEN_TOKEN` set
  (the flag wins, and empty means none), so `--garden-token ''` switches a token in the environment
  off. An absent flag falls back to the variable.
- **The fragment parse** treats the fragment as `URLSearchParams`: the last non-empty `garden-token`
  wins, an empty one is no token but is still stripped, and when a token key is stripped the other
  keys are re-serialised in order.
- **The page says when the token is withheld** (a coordinator that is not the page's own origin), and
  says that a token was given on load; it never prints the token.
- **e2e island C** joins and asks exactly once (`runIsland` with `maxTasks` 1 returns on the first
  idle answer); it does not go through the script's `work()`, which keeps asking until its deadline.
  The check also reads the view: day 0 still `waiting` and `releasedStep` still D.
- **`config/config.exs`** gets the `:filter_parameters` line as written above (it is the one hunk
  outside the slice's listed area; it was made with its test so it can be kept or dropped whole).

### 2026-10-18: after review (three review lenses and Codex Sol 6.1 xhigh)

No criterion above is dropped; these tighten item 1 and correct one fact.

- **Phoenix's default filter is `["password"]` alone** (`deps/phoenix/lib/phoenix/logger.ex`), not
  `["password", "token"]`. So the `config.exs` line adds both `"token"` and `"Token"`: every key
  containing either, app-wide and in every environment, is now `[FILTERED]` in `Parameters:` lines
  (an island's own `"token"` too), and so is a map entry's string value containing `token=` or
  `Token=` (Phoenix matches values against each pattern with `=` appended, so a value like
  `"Token secret"` is still printed, and a bare string inside a list is never value-matched;
  corrected after the second and third Codex passes). A ConnCase test now captures an actual join's debug log line
  and finds `"gardenToken" => "[FILTERED]"` and no token, beside the config-value test.
- **The token never reaches the Queue process.** `Queue.join/1` checks it in its caller and passes
  only the result (`{:join, info, garden}`, with `"gardenToken"` taken out of `info`), so the Queue's
  mailbox, and an OTP crash report that prints its last message (a failed persist during a join), never
  holds it. A test suspends the Queue and reads its mailbox during an HTTP join.
- **A join that carries a token follows no redirect** (`redirect: "manual"`): a 307/308 would forward
  the body past the origin rule. The error names the redirect.
- **A refused join with a token does not repeat the response body** (a development coordinator's
  `debug_errors` page prints request parameters unfiltered): only the status is shown, with a fixed
  description for 429 and 503, the two refusals a join meets in normal running. (After the first pass
  a JSON `error` string not containing the token was still shown; the second Codex pass showed an echo
  that escapes the token, e.g. a JSON-encoded `"`, passes that check, so no response text is repeated
  at all now.) Plug's debugger itself is not changed: `debug_errors` is set in
  `dev.exs` only, and production renders `ErrorJSON`, which has no parameters.
- **The fragment parse no longer uses `URLSearchParams`.** It splits on `&` and the first `=`,
  percent-decodes the key and the value with `decodeURIComponent` (a `+` stays a `+`; a value that
  does not decode is taken as written) and keeps every other part byte for byte (`#a/b` stays `#a/b`).
  It returns `found` whenever any key decodes to `garden-token`, and the page strips the fragment on
  `found`, so `#%67arden-token=…` is taken out of the address bar too.
- **The headless island sends the token only over https or to a loopback host** (`localhost`,
  `*.localhost`, `127.*`, `[::1]`; `gardenTokenForCoordinator`), and says so when it withholds it. The
  flag is documented as `--garden-token=<t>`: a space-separated value starting with `-` is read as
  flags, and the CLI says so when the flag came out empty.
- **A fresh rejoin without the token is no longer silent.** The page keeps a flag (not the token) in
  `sessionStorage` once it joined with a token; a later fresh join without one (the coordinator forgot
  the island, or the metrics version changed) says the island is now an ordinary one and how to give
  the token again.
- **Item 2's exact bug is now a test of its own**: only the checkpoint set is cached before the replay
  (the view is not), so the first view after it is fresh and names the fork. With the `invalidate`
  line removed this test gets the 404 (checked by mutation); with it, 200.
- **Item 3**: `release_config_test.exs` also asserts that `runtime.exs` never names
  `garden_presets`, so a new environment variable cannot widen production's presets unnoticed.
- Not done: a Playwright spec for `/island.html`'s load-time handling (outside this slice's area; the
  logic it would test now sits in the unit-tested `gardenTokenFromHash`), a test of a cache refresh in
  flight across this particular `invalidate` call (the generation guard is pinned by `LetterLimiter`'s
  own tests and the call runs inside the serialized Queue handler), and `bin/garden-dev`'s stale
  comment (outside the area; reported above).

### 2026-10-18: after the second Codex pass (Sol 6.1 xhigh)

- **A refused tokened join repeats no response text at all** (bullet above, amended): an `error`
  string that echoes the token escaped (`garden"secret` comes back as `garden\"secret`) passed the
  raw substring check. Now only the status is shown, with a fixed description for 429 and 503. A
  vitest case covers the escaped echo.
- **Opening the island link again in a tab that already shows the page** is a fragment navigation,
  not a reload, so the page also takes the token on `hashchange`: it strips the fragment, forgets a
  remembered identity as on load, and says the next Join (after Stop, if running) is a garden join.
  Checked by typecheck only, like the rest of the page.
- **The filter's value matching** was overstated: Phoenix filters a value only when it contains a
  pattern followed by `=` (`token=`, `Token=`); keys match by plain substring. Corrected in
  `config.exs` and above; `release_config_test.exs` pins both behaviours.

### 2026-10-18: after the third Codex pass (Sol 6.1 xhigh)

- **An accepted tokened join whose answer is not JSON naming an id and a token** is refused with a
  fixed message (`joinAnswer`): `JSON.parse`'s own error quotes the start of the body, which could be
  the token (a 200 answering `garden-secret`). A vitest case covers a bare body and a JSON answer
  without the fields; the untokened path is unchanged.
- **A fragment token that arrives while an attempt can no longer use it** (its join already sent,
  or a resume of a remembered identity) no longer lets that attempt remember its identity again:
  the page counts fragment tokens and remembers an identity only from an attempt that read the
  latest one and is not such a resume. So after that attempt stops or fails, the next Join is the
  fresh garden join the page announced. A fresh join that reads the token after it arrived (one
  still acquiring the GPU, or a probe that ends in a fresh join) sends it and is remembered as
  usual. Checked by typecheck only.
- **A tokened join's accepted answer must be the coordinator's own credentials**
  (`isl-` and 12 base64url characters; a 43-character base64url token) and neither may hold the
  garden token (after the fourth and fifth Codex passes; containment is checked for a garden token
  of 4 characters or more, equality for a shorter one, so a random credential is not refused by
  chance): a reflected id would be logged, remembered and put in
  every URL, and a token with a newline makes a header error that quotes it. Vitest cases cover
  each refusal; the e2e run shows the real coordinator's answer passes.
- **Value filtering applies to map entries only**: a bare string inside a list is never value-matched
  (`Phoenix.Logger.discard_values/3`). The `config.exs` comment and the bullet above say so, and
  `release_config_test.exs` pins it.
