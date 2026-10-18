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

### 18 October 2026: criterion 5 added, stated before running

The row "mobile and keyboard access and missing-GPU behaviour" was left wholly to the live host. Its local half is
now a criterion of its own, written before any code changes (slice 13, branch `claude/slice13-public-a11y`). The
real-device half stays with the live host.

#### 5. Accessibility and resilience, on this machine

- **Routes.** Every `<loc>` in `apps/lab/public/sitemap.xml` (nine) plus `/garden/` (hidden, not listed). `/status/`
  is read against a mocked `/api/public/status` with aggregates, `/garden/` against
  `apps/coordinator/priv/static/garden-contract.example.json`, so neither is checked only in its "unavailable"
  state. `/worlds/` is checked after its cards are built, `/lab/` after its GPU chip has settled. Two in-page
  not-found states are checked too: `/worlds/?world=no-such-world` and `/garden/` when the garden answers 404.
- **Automated check.** axe through `@axe-core/playwright` 4.13.0 (the newest release at least two weeks old on
  18 October; 4.14.0 is three days old), rule tags `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa`;
  `best-practice` is off. Each route at 1280×900 and 375×812, in day colours and then in night colours (switched
  with the page's own Night button, pressed from the keyboard). A run fails on any violation of impact `serious` or
  `critical` not on the spec's exclusion list. Each exclusion names its route, rule, element and reason, and fails
  the run when it no longer matches anything. Minor and moderate violations and axe's `incomplete` results are
  attached to the test report and counted under Results; a colour-contrast `incomplete` on text is checked by hand
  against the tokens and the result written down.
- **The lab route.** `apps/lab/lab/index.html`, `apps/lab/src/style.css` and `apps/lab/src/main.ts` are held by an
  open pull request (#31, Pond keeper v2). A serious or critical finding in lab-only markup is excluded with that
  reason and listed as a follow-up, not fixed here. *(Withdrawn by the slice 23 amendment below, once #31 landed.)*
- **Keyboard,** with real Tab presses in Chrome so `:focus-visible` applies, on every route at both widths:
  - the first Tab focuses the skip link, wholly inside the viewport; Enter on it, then Tab, lands on an element at
    or after the start of `<main>`, never in the header; after the jump the first heading in `<main>` is not under
    the sticky header;
  - Tab from the top until focus comes round again reaches every visible, enabled `a[href]`, `button`, `input`,
    `select`, `textarea`, `summary` and `[tabindex]` of 0 or more, and nothing else; Shift+Tab does the same
    backwards;
  - every element so focused has a solid outline at least 2px wide, and the element itself is what is drawn at its
    centre (not the sticky header or anything else over it), going forwards and backwards;
  - the Day/Night button works with Enter and with Space, changes its own label and `data-theme`, and keeps focus;
  - the lab's Browse all worlds dialog, opened from the keyboard, takes focus; twice as many Tab and Shift+Tab
    presses as it has controls never focus anything outside it (amended after review: and reach every control in
    it, each with a visible ring; amended after the third review: in every family, each shown from the keyboard);
    its Close button, pressed from the keyboard, hands
    focus back to Browse all worlds. (Escape and its focus return are already in `tests/e2e/lab-worlds.spec.ts`.)
    The public pages have no other menus or dialogs (read on 18 October).
- **Reduced motion.** With `prefers-reduced-motion: reduce`, on every route: `html` has `scroll-behavior: auto`, and
  no element has an animation of non-zero duration or a transition longer than 0 s. Without the setting, `html` has
  `scroll-behavior: smooth`, so the check is seen to bite. Scripted scrolling on the public pages does not ask for
  smooth scrolling (read).
- **Without WebGPU.** Chrome started with `--disable-gpu`. A probe on 18 October found that this is the switch that
  leaves `requestAdapter()` answering `null` on this Mac; with no switch, `--disable-features=WebGPU` or
  `--disable-blink-features=WebGPU` the adapter is still there. The run first checks that the adapter is `null`.
  Then: the lab shows its alert (`role="alert"`), "The lab could not start", with help that names WebGPU, the chip
  "No GPU adapter" and the heading "No world yet", and passes the axe check under the lab-route rule; every other
  route shows its `<h1>` with no uncaught page error; and the home page's way into the lab and Join in's first step
  say plainly what happens without WebGPU. Wording is added where it is missing, without changing what the existing
  copy says. The case where `navigator.gpu` is missing altogether (the worker throws a different message into the
  same alert) cannot be produced with a Chrome switch; it is read, not run.
- **404.** The dev server answers an unknown path with the home page and 200 (Vite's fallback), so 404s are not
  tested there. A one-off local Caddy file server over a fresh build records what the production rules
  (`try_files`, then `file_server`) answer. A styled 404 page needs a build input and a `handle_errors` block in
  `deploy/Caddyfile`, both outside this slice; the 404 row stays **Needs the live host**, with what was seen.
- **Fixes** go only in the public pages (their HTML, page TypeScript and CSS), `apps/lab/src/site.css` and
  `apps/lab/src/theme.ts`. `tokens.css` is shared with the lab and is not changed. Copy keeps its meaning and
  British spelling.
- **Not claimed:** real phones and tablets, screen readers, engines other than Chrome, 200% zoom and 320 px reflow.

#### Amendments to criterion 5, after running (18 October 2026)

- **The first Tab and the skip-link jump.** Criterion 5 said the first Tab focuses the skip link and that Enter on
  it, then Tab, lands in `<main>`. On `/lab/` the first Tab from a fresh page lands on the view buttons
  ("Lineages"): the lab moves the focus starting point while it plants. *(Fixed in slice 23: see "5, continued"
  under Results.)* That is lab code held by PR #31, so it is an
  explicit exclusion and a follow-up. To keep the rest of the lab checked, the walk starts from the skip link,
  focused directly when the first Tab went elsewhere, and the jump is made from the skip link focused again after
  both walks. On every other route the first Tab is the skip link, and the test still checks that.
- **A ring on a close wrapper counts.** Criterion 5 said every focused element has a solid outline at least 2px
  wide. The lab's world canvas draws its ring on its wrapper (`.canvas-wrap.keyboard-focus`), so on `/lab/` the
  check accepts a ring on the element, its parent or its grandparent. On every other route a control must ring
  itself, and the run checks that.
- **Scrolling settles between presses.** Criterion 5 said the focused element is what is drawn at its centre. With
  the site's smooth scrolling, a key pressed while the last focus's scroll is still moving can make Chrome drop the
  next scroll and leave that element off screen (seen on the worlds page while probing). The check now waits for the
  scroll to come to rest at each stop, as a person reading the page would, and only then looks at the centre. This
  is noted under Results, not fixed: the fix would be to give up smooth scrolling. (Superseded below: keyboard
  focus now jumps, and the walk no longer waits.)
- **The garden's 404.** The garden view answering 404 shows "No garden is planted here yet." (the page's own words
  for that answer), which is what the in-page not-found check reads.

#### Amendments to criterion 5, after review (18 October 2026)

Three review lenses and a Codex (Sol 6.1) pass read the first run. What they found that was real is fixed, and the
checks were tightened so each finding would now fail the run:

- **Focus rings contrast, in both colours.** In night colours the ring on the sun-coloured invitation panels (home,
  worlds, Join in) was pale on yellow, about 1.3:1. The ring there is now ink (`--accent-ink`) in both colours. The
  check now reads each ring's colour against what is drawn behind it (colours resolved by painting them on a
  canvas) and requires 3:1, requires `:focus-visible` to match, and fails a control that wears a ring when it is
  not focused. The day walk checks every stop; after it the page switches to night colours with its own button and
  each control is focused again by script (`:focus-visible` still applies after a key press) and checked the same
  way. The amendment above about wrappers is narrowed: only the lab's world canvas may wear its ring on its wrapper.
- **Keyboard focus no longer scrolls smoothly.** The amendment above left fast Tab presses losing focus off screen.
  A probe on `/worlds/` at 1280 (bursts of seven presses) left focus off screen after 8 of 49 bursts with smooth
  scrolling and after none with `html:has(:focus-visible) { scroll-behavior: auto; }`, which `site.css` now sets:
  keyboard focus jumps, links followed with a pointer still scroll smoothly. The walk no longer waits for scrolls to
  settle, a new test presses Tab and Shift+Tab in bursts on `/worlds/` at both widths, and after five stops that are
  not drawn the walk stops waiting for them, so a regression reports its controls rather than timing out.
- **Header order.** At 1000px and below the Day/Night button was drawn beside the name but reached after the nav.
  `theme.ts` now places it before the nav at those widths and after it above them (no visual change), keeping focus
  if the layout changes under it. A test walks the header at 1280, 1000, 768 and 375 and fails when a control is
  reached before one drawn ahead of it. Its border is now `--control-line` (made for 3:1 on controls) instead of
  `--line` (about 1.6:1).
- **Every native control counts.** A button, link or field with `tabindex="-1"` is now counted as a control (and
  reported as missed), so taking one out of the tab order cannot pass.
- **Undecided axe results fail.** A serious or critical `incomplete` now fails the run unless it is listed with its
  reason, like a violation.
- **More states and pages.** The two in-page not-found states run at both widths in both colours, and so do `/status/`
  with the coordinator down and `/garden/` after a refused stone (the server's 422 answer, then a radius the page
  refuses, with its why line and an invalid field). `/island.html`, where Join in sends people, gets the axe,
  keyboard and reduced-motion checks (no skip link: its `<main>` is the first thing on the page). Every `<details>`
  is opened before checking, so the worlds cards' "For researchers" text is scanned. Each page is checked to be the
  page asked for (its canonical URL, or a title that is not the home page's), since the dev server answers a
  mistyped path with the home page.
- **The dialog.** The Browse all worlds check now requires the dialog to be modal, requires focus to stay inside it
  after every press (or, after its last control, to be in the browser's own controls, which a modal dialog lets a
  keyboard reach), scans it with axe while open, and checks that a backdrop click hands focus back too.
- **Deep links at 375.** A test loads `/#next` and a worlds family link directly at 375 and checks the heading lands
  near the top, clear of the header.
- **Reduced motion** also fails on anything `document.getAnimations()` reports running, which catches script-made
  motion.
- **Without WebGPU.** The `--disable-gpu` test skips, saying why, when the switch does not give a null adapter or
  Chrome cannot be started, rather than failing. It now also runs an island remembered from earlier in the tab: the
  page asks the coordinator about it (`GET /api/islands/me`), and whether the coordinator knows it (200) or not
  (401), the run stops at the GPU and the log says why. A new test runs the common case, no `navigator.gpu` at all,
  in the normal Chrome project: the main thread loses it before any script, the lab's worker at the top of its
  module. Join in's sentence was reworded, because "Without it" read as "without the self-test" and "stops at
  once" was not true for a remembered island: "Without WebGPU nothing runs: Join stops before taking any work, and
  the island page says why in its log." The home page's "every other page here works without it" now reads "the
  other pages on this site still read without it", since the island page reads but cannot run.
- **404** is a `test.fixme` in the spec, naming what it needs, so it shows in every run as not done.
- **Engines.** The spec skips itself outside Chromium with its reason (`BL_ALL_ENGINES=1` adds Firefox and WebKit,
  whose Tab and storage behave differently); lab tests skip when there is no WebGPU adapter.
- **A second Codex (Sol 6.1) pass** found three ways the keyboard checks could still pass a barrier, all in the
  spec; no product change was needed. (a) The island page has no Day/Night button, so it is reloaded into night
  colours, which dropped the controls tagged by day and left the night pass checking none. The controls are now
  counted again in night colours and must be as many as by day. (b) The night pass did not look for rings on
  controls that are not focused. It now fails a control that wears a ring at rest in night colours, one that keeps
  its ring when focus moves on, and any that wear one once focus has left them all. (c) The Browse all worlds check
  counted only controls with a tabindex of 0 or more and did not say which it reached. It now counts the dialog's
  native controls whatever their tabindex, requires Tab and Shift+Tab each to reach every one, and checks each
  stop's ring and `:focus-visible` as the page walks do. Each was broken on purpose and seen to fail (see Results).
- **A third Codex (Sol 6.1) pass** checked those fixes and found three more ways through, again all in the spec.
  (a) A control given `tabindex="-1"` only in night colours would still be counted, and still take script focus, so
  the night pass passed it. The night inventory must now match the day one control for control: the same element
  (tag, id and classes), in the same order, with the same tabindex, and still shown and not inert. (A fourth pass
  showed that this alone misses a script that swallows Tab in night colours; see the next amendment.) (b) The checks for a ring at rest, a ring kept after focus
  moves on and a ring left once focus has gone looked only at the control, but the lab's canvas wears its ring on
  its wrapper. They now count the wrapper's ring as the canvas's. (c) The dialog check covered only the family shown
  when it opens, and choosing a family replaces the cards. Each other family is now shown from the keyboard (Enter
  on its button, focus on its heading), its controls counted afresh, and Tab and Shift+Tab each go once round it
  with the same reach and ring checks. The axe scan of the open dialog still runs on the family it opens on. Each
  was broken on purpose from the spec, without touching product files, and seen to fail (see Results).
- **A fourth Codex (Sol 6.1) pass** found the wrapper and dialog fixes sound, and one gap left in (a): a control
  whose keydown handler swallows Tab only in night colours keeps the inventory identical and still takes script
  focus, so the keyboard could be stuck on it at night with every check passing. Tab and Shift+Tab now each go round
  the page again in night colours, from the skip link (the island page: its first control), and must reach every
  control counted in night colours and nothing else. Broken on purpose from the spec and seen to fail (see Results).

### 18 October 2026, slice 23: the lab-route rule lifted, stated before fixing

PR #31 (Pond keeper v2) has landed on main, so the lab-route rule of criterion 5 ("a serious or critical finding in
lab-only markup is excluded with that reason and listed as a follow-up") is withdrawn. Written before any product
change (branch `claude/slice23-lab-a11y`, from f862bc2), after a read-only probe of main as it stands.

- **Every `LAB_HELD` entry goes.** Each lab exclusion in `tests/e2e/public-a11y.spec.ts` is either fixed in the lab
  and deleted (the spec already fails on an exclusion that no longer matches anything), or kept only as reviewed by
  hand with a reason that names what was checked and the contrast read from the tokens, as the home page's arrow is.
  The constant `LAB_HELD` is deleted; nothing may cite PR #31 any more.
- **What the probe found, and the fix stated for each:**
  - the first Tab on a fresh `/lab/` lands on "Lineages": `setMode()` in `main.ts` calls `scrollIntoView` on the lit
    view button at start-up, and in Chrome that moves the sequential focus starting point to it (with
    `scrollIntoView` stubbed out, the first Tab is the skip link). Fix: keep the lit view in sight by setting
    `#views`' own `scrollLeft`, which moves no focus point and never scrolls the page;
  - `#pools`, an `aria-label` on a plain `div` (a violation with no GPU, undecided with a world): `role="img"`, with
    the label rebuilt from the same numbers as the bars' tooltips at each stats message ("What the matter is right
    now: nutrient 41.2%, biomass …") and the plain label while there is no world;
  - `aria-valid-attr-value` undecided on `#btn-worlds` and `#btn-card`: axe cannot decide `aria-controls` beside
    `aria-haspopup` by rule. `aria-controls` is removed from those two (each opens a modal dialog that takes focus,
    so the reference adds nothing); `aria-haspopup="dialog"` stays. Other `aria-controls` (on toggles with
    `aria-expanded`) stay;
  - `.worlds-nav button small` at 4.14:1 by day (`opacity: .78` over `--muted`): the opacity goes; at rest the line
    takes `--soft` (held at 4.5:1 on `--surface` by DESIGN.md), pressed it inherits the sun ink, hovered it inherits
    `--text`. The open dialog is also scanned in night colours;
  - the header at 375 reaches Day/Night after the nav that is drawn below it (also true from 501 to 760 px, where
    the header status sits beside the name): `main.ts` places `.header-status` before `.site-nav` at 760 px and
    below and after it above, keeping focus, as `theme.ts` does on the public pages. The grid already places both
    explicitly at those widths, so nothing moves on screen. A lab twin of the "every width and across a resize"
    test walks the header at 1280, 1000, 760, 600 and 375;
  - the full-screen exit fade ignores reduced motion: `.fs-exit` joins the lab's `prefers-reduced-motion` block;
  - at 375 axe cannot decide the colours of the three view buttons the picker's sideways scroll clips. The picker
    keeps its scroll (DESIGN.md: view modes stay horizontally reachable without page overflow). These stay as
    reviewed by hand: the same `.seg button` colours as the five buttons beside them, which axe passes at the same
    width, read from the tokens for both colours.
- **Pond keeper v2 is scanned too.** Two lab states are added, each scanned in day and night colours: the breeder
  (`/lab/?world=breeder&seed=1`) stepped by hundreds to t=500, with the family tree, its log, Next up, the log of
  firsts and every `<details>` open, at 1280 and 375, axe and the full keyboard walk; and the Session card open
  over it, axe at 1280 and 375 and a modal walk like the Browse all worlds one (focus stays in it, every control
  reached both ways with a ring of 3:1, Close and a backdrop click hand focus back to Session card). The probe found
  in the card: `scrollable-region-focusable` on `#card-body` (a scrolling body with nothing focusable in it), fixed
  with `tabindex="0"`, `role="region"` and the card's heading as its name, and a ring for it in `style.css`; and
  undecided contrast on the card's hint lines (axe cannot see the backdrop under a modal dialog), fixed if a plain
  background on the line's box settles it, otherwise reviewed by hand against the tokens. Rows that a short history
  does not reach (an extinct or gone-to-film family, Show extinct, Show all in the tree's log) are read, not run.
- **Scans settle first.** Six night-colour contrast failures in the probe were the 160 ms colour fade caught half
  way (a scan with no settle); the spec's own `toNight()` settles, and every new scan goes through it.
- **Fixes** go only in `apps/lab/lab/index.html`, `apps/lab/src/main.ts`, `apps/lab/src/style.css`, the lab's
  panel modules and `worlds-ui.ts` (markup, ARIA and focus only). `tokens.css`, `theme.ts`, `site.css`, the worker,
  `execution.ts`, `protocol.ts` and every package stay untouched; nothing changes the simulation or a golden pin.
  The lab specs `lab-worlds`, `lab-fullscreen`, `lab-pond-keeper` (v0), `lab-pond-keeper-v1`, `lab-pond-keeper-v2`
  and `lab-execution` stay green. Screenshots of what looks different go in the pull request body.

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

### 5. Accessibility and resilience

Run on 18 October 2026 in the slice worktree (branch `claude/slice13-public-a11y`, from c673b76), Chrome only, on
the dev server through a copy of `playwright.config.ts` on port 5194 (other worktrees' runs use 5174), except
`public-garden.spec.ts`, which names port 5174 in its own URLs and was run on the repository's config. Nothing was
committed, deployed or pushed. The first run is kept below the final one for the record; the final runs come after
the review fixes (see the amendments after review).

| Gate | Result | `uptime` load (1/5/15 min) |
| --- | --- | --- |
| `pnpm typecheck`, after the third Codex pass's spec fixes | exit 0 | 49.9 / 50.4 / 67.6 |
| `pnpm vitest run apps/lab/test/social-meta.test.ts apps/lab/test/worlds.test.ts` | 42 passed | 89.4 / 80.9 / 100.7 |
| `npx playwright test tests/e2e/public-a11y.spec.ts --project=chrome`, after the review fixes | 71 passed, 1 skipped (the 404 `test.fixme`), 1.5 min, three workers | 89.4 / 80.9 / 100.7 before, 143.1 / 102.0 / 106.9 after |
| the same spec's 28 keyboard tests (`-g "keyboard: "`), after the last edit (the night pass fails a control that will not take focus) | 28 passed, 36 s | 84.8 / 90.5 / 100.4 before, 108.3 / 96.0 / 102.0 after |
| `BL_ALL_ENGINES=1 npx playwright test tests/e2e/public-a11y.spec.ts --project=webkit --project=firefox -g "Day/Night\|axe: /about/ at 375"` | 4 skipped (the file skips itself outside Chromium) | 106.3 / 96.0 / 101.9 |
| `npx playwright test tests/e2e/public-site.spec.ts tests/e2e/public-routes.spec.ts tests/e2e/lab-worlds.spec.ts --project=chrome`, after the review fixes | 18 passed; the build test in `public-routes.spec.ts` skipped (no `apps/lab/dist`) | 143.1 / 102.0 / 106.9 before, 134.5 / 102.6 / 107.0 after |
| `npx playwright test tests/e2e/public-garden.spec.ts --project=chrome` (port 5174), after the review fixes | 13 passed, 1 skipped (screenshots) | 134.5 / 102.6 / 107.0 before, 132.9 / 104.9 / 107.7 after |
| The new checks against the code they guard, broken on purpose and then restored: no ink ring on the sun, smooth keyboard scrolling back, the Day/Night button after the nav at every width, `tabindex="-1"` on Send the stone | each fails: the night ring on Join in → is 1.34:1; the header order at 375 and in the header test; Send the stone "never reached"; focus off screen after 10 bursts on `/worlds/` at 1280 and 38 at 375 (of up to 60 each) | 95.8 / 81.6 / 101.3 |
| `npx playwright test tests/e2e/public-a11y.spec.ts --project=chrome`, after the second Codex pass's fixes | 71 passed, 1 skipped (the 404 `test.fixme`), 1.1 min, three workers | 59.6 / 67.0 / 84.7 before, 157.9 / 96.8 / 94.7 after |
| `npx playwright test tests/e2e/public-site.spec.ts --project=chrome`, after the second Codex pass's fixes | 8 passed | 65.1 / 82.2 / 89.4 |
| The second Codex pass's checks broken on purpose and then restored: night-only `outline: none` on the island's Join, a night-only ring on every `.worlds-jump a`, `tabindex="-1"` on the dialog's family buttons | each fails: Join "has outline none 3px in night colours"; each jump link "wears a ring while not focused in night colours"; each family button "never reached by Tab" and by Shift+Tab | 106.4 / 90.9 / 92.7 before, 96.0 / 89.2 / 92.0 after |
| `npx playwright test tests/e2e/public-a11y.spec.ts --project=chrome`, after the third Codex pass's fixes | 71 passed, 1 skipped (the 404 `test.fixme`), 1.1 min, three workers | 50.6 / 50.5 / 67.6 before, 155.7 / 82.8 / 78.4 after |
| `npx playwright test tests/e2e/public-site.spec.ts --project=chrome`, after the third Codex pass's fixes | 8 passed | 223.7 / 112.9 / 89.8 before, 200.0 / 119.6 / 93.2 after |
| The third Codex pass's checks broken on purpose from a copy of the spec, then the spec restored: a night-only `tabindex="-1"` on the first link in `/about/`'s main, the canvas wrapper keeping its ring when the canvas loses focus, the last family's buttons out of the tab order when it is shown | each fails: "control 10 is a tabindex 0 by day, a tabindex -1 in night colours"; the canvas "wears a ring while not focused", "keeps its ring after focus moves on" and "wears a ring after focus has left it" in night colours; Choose this world "never reached by Tab (family wild)" and by Shift+Tab | 150.9 / 84.2 / 79.0 before, 223.7 / 111.0 / 89.0 after |
| `pnpm typecheck`, after the fourth Codex pass's fix (night Tab and Shift+Tab walks) | exit 0 | 101.1 / 101.2 / 92.8 |
| `npx playwright test tests/e2e/public-a11y.spec.ts --project=chrome`, after the fourth Codex pass's fix | 71 passed, 1 skipped (the 404 `test.fixme`), 1.1 min, three workers | 101.1 / 101.2 / 92.8 before, 173.6 / 123.3 / 101.8 after |
| `npx playwright test tests/e2e/public-site.spec.ts --project=chrome`, after the fourth Codex pass's fix | 8 passed | 130.1 / 117.2 / 100.2 before, 122.6 / 116.0 / 100.0 after |
| The third Codex pass's three breakages again, against the spec after the fourth pass's fix | each still fails as above; the night-only `tabindex="-1"` link is now also "never reached by Tab" and by Shift+Tab "in night colours" | 59.7 / 97.4 / 94.3 before, 61.8 / 96.6 / 94.1 after |
| The fourth Codex pass's check broken on purpose from a copy of the spec, then the spec restored: in night colours the first link in `/about/`'s main swallows Tab | fails: the controls after it "never reached by Tab in night colours", and the rest "never reached by Shift+Tab in night colours" | 165.7 / 122.5 / 101.6 before, 155.1 / 121.0 / 101.2 after |
| First run, before review: the same spec (54 tests then) | 54 passed, 4.0 min | 99.5 / 171.9 / 266.5 before, 106.0 / 135.6 / 227.2 after |
| First run, before review: the keyboard checks against the old `site.css` | `/about/` at 375 and `/worlds/` at 1280 fail: heading under the header after the jump, summary ring `auto 1px`, links under the header | 274.4 / 339.7 / 360.9 |

No test timed out in the gate runs. Two failures were each seen once in the first round and not again: `axe: /lab/ at
1280` stopped with "Execution context was destroyed" inside the wait after the Night button, a page load during the
test that was not explained (the lab did not navigate when probed alone, and the test passed in every later run);
and `keyboard: /status/ at 375` timed out its wait for the heading to clear the header after the skip-link jump.
The keyboard walks are faster now that keyboard focus no longer scrolls smoothly (about 5 s for the worlds page at
either width, against about 3 minutes before).

- **Automated check:** **Done.** `tests/e2e/public-a11y.spec.ts` runs axe (`@axe-core/playwright` 4.13.0, pinned
  exactly) over the ten routes and `/island.html` at 1280×900 and 375×812, in day colours and then in night colours
  switched with the page's own button from the keyboard (the island page has none; it is reloaded as a return
  visitor who chose night), with every `<details>` open: 44 scans. Four states at both widths in both colours add
  16: `/worlds/?world=no-such-world` (no card ringed), `/garden/` with the view answering 404 ("No garden is planted
  here yet."), `/status/` with the coordinator answering 503 ("Live status is unavailable right now."), and `/garden/`
  after a refused stone. The lab without a GPU and the lab with Browse all worlds open add two: 62 in all. A
  serious or critical violation, or a serious or critical result axe cannot decide, fails unless it is listed with
  its reason. Public pages: no violations of any impact. One undecided result, reviewed by hand and listed: the
  arrow inside Open the lab on the home page (`color-contrast`), `aria-hidden` decoration in the same ink on the same
  sun fill as the button's label, which axe passes. *(The lab findings below were fixed or reviewed by hand in
  slice 23: see "5, continued".)* Lab, listed with the reason "PR #31" and left to its follow-up:
  `aria-prohibited-attr` on `#pools` (a violation with no GPU, undecided with a world); `aria-valid-attr-value` on
  `#btn-worlds` and `#btn-card` (undecided); at 375 `color-contrast` on three view buttons (undecided); and one real
  violation found by scanning the open dialog, the family list's small lines (`.worlds-nav button small`, muted at
  78% opacity, 11px) at 4.14:1 by day, under 4.5:1. Inside the open dialog the page behind is inert, so the lab's
  other findings do not appear there.
- **Keyboard:** **Done**, with real Tab and Shift+Tab presses on every route and the island page at both widths.
  The first Tab focuses the skip link, wholly on screen (not on the lab, and the island page has none). Tab and
  Shift+Tab each reach every visible, enabled control and nothing else, native controls counted whatever their
  tabindex. Every stop matches `:focus-visible`, has a solid ring of at least 2px on itself (the lab's canvas on its
  wrapper) at 3:1 or more against what is behind it, and is itself drawn on screen; no control wears a ring when it
  is not focused (the canvas's wrapper counted as the canvas). In night colours the controls are counted again and
  must be the same as by day, in the same order, with the same tabindex; Tab and Shift+Tab each go round again and
  reach every one and nothing else; every one is checked again for the ring and its contrast; and none wears a ring
  when it is not focused or after focus has left it. Header controls are
  reached in the order they are drawn (on every page at both widths, and on `/about/` at 1280, 1000, 768 and 375,
  with the Day/Night button keeping focus across a resize). Bursts of seven Tab or Shift+Tab presses on `/worlds/`
  at both widths always leave focus on screen. After Enter on the skip link the first heading in `<main>` is clear
  of the sticky header and the next Tab lands in `<main>`; `/#next` and a worlds family link loaded directly at 375
  put their heading near the top, clear of the header. The Day/Night button works with Enter and with Space and
  keeps focus. The lab's Browse all worlds dialog is modal; opened from the keyboard it takes focus, and twice as
  many Tab and Shift+Tab presses as it has controls never leave it for the page and reach each of its controls
  (native ones counted whatever their tabindex), every stop with a visible ring at 3:1; so does one round each way
  in every other family, each shown from the keyboard; its Close button and a backdrop
  click each hand focus back to Browse all worlds. Found and fixed:
  - the sticky header covered the target of the skip link and of anchors, and controls reached going up the page
    (worst at 375, where the nav wraps and the header is about 150px tall). `site.css` now sets
    `scroll-padding-top` from the header's measured height (`--site-header-height`, written by `theme.ts`, which
    every public page loads, with a `ResizeObserver` as the nav wraps); the home page's and the worlds page's own
    scroll margins are reduced to the air they add, and the worlds page's linked card no longer adds the header's
    height itself;
  - the worlds page's "For researchers" `<summary>` elements had the browser's thin ring (`auto 1px`): the site's
    ring rule now covers `input`, `select`, `textarea`, `summary` and `[tabindex]` as well as links and buttons;
  - in night colours the ring on the invitation panels' buttons (home, worlds, Join in) was 1.34:1 against the sun:
    it is now ink in both colours;
  - Tab pressed faster than a smooth scroll could leave focus off screen: keyboard focus now jumps
    (`html:has(:focus-visible)`), and links followed with a pointer still scroll smoothly;
  - at 1000px and below the Day/Night button was reached after the nav but drawn before it: `theme.ts` now places
    it before the nav at those widths (no visual change). Its border is now `--control-line`.
  Lab-only, exclusions and follow-ups for PR #31 *(both fixed in slice 23)*: the first Tab lands on "Lineages"; at 375 the lab header draws its
  Day/Night button ahead of tabs it follows in the markup.
- **Reduced motion:** **Done.** On every route and the island page, with `prefers-reduced-motion: reduce`, `html`
  scrolls without animation, no element or pseudo-element has an animation or a transition longer than 0 s, and
  `document.getAnimations()` reports nothing running; without the setting the public pages scroll smoothly and the
  lab has transitions, so the check bites. The public pages have no animations (two pages update text on a timer,
  which is not motion). Lab-only, an exclusion and a follow-up for PR #31 *(fixed in slice 23)*: the full-screen exit button's fade
  (`.fs-exit`) is not in the lab's reduced-motion block.
- **Without WebGPU:** **Done**, two ways. Chrome started with `--disable-gpu` (the test first checks that
  `requestAdapter()` answers `null`, and skips with its reason when the switch does something else): the lab shows
  its alert (`role="alert"`) "The lab could not start" with help naming WebGPU, the chip "No GPU adapter" and the
  heading "No world yet", and passes axe with the exclusions above; every other page shows its heading with no
  uncaught error and no API mocked; the island page, Join pressed, logs "error: WebGPU: no adapter", stays Join and
  makes no `/api` request; and with an island remembered from earlier in the tab it asks the coordinator about that
  island once (`GET /api/islands/me`), then, whether the coordinator knows it (200) or not (401), logs the same
  error and runs nothing. And in the normal Chrome project with `navigator.gpu` removed (main thread and the lab's
  worker): the lab's alert says "WebGPU is not available", with the same chip, and the island page logs "error:
  WebGPU is not available in this browser." with no `/api` request. Wording added, nothing else in the copy
  changed: the home page's small print says "Without it the lab opens but cannot plant a world, and says why; the
  other pages on this site still read without it.", and Join in's first step says "Without WebGPU nothing runs:
  Join stops before taking any work, and the island page says why in its log." Not run: a remembered island when the
  coordinator cannot be reached at all; the page then says it could not reach the coordinator (not WebGPU), and
  still runs nothing.
- **404:** **Gap: there is no 404 page.** The dev server answers an unknown path with the home page and 200 (Vite's
  fallback), so the spec cannot pin it there; it carries a `test.fixme` naming what it needs. A fresh build served by
  Caddy 2 with the production file rules (`try_files {path} {path}/index.html`, then `file_server`; scratch config,
  port 8089) answers `/no-such-page/`, `/no-such-page`, `/lab/world/nope/` and `/assets/nope.js` with 404 and an
  empty body: a visitor sees a blank page. A 404 page needs an `apps/lab/404.html` build input and a `handle_errors`
  block in `deploy/Caddyfile`, both outside this slice: a follow-up. That the live host behaves the same still needs
  the live host.
- **Screenshots** of the pages that look different, at 1280 and 375: the home page and Join in in day and night
  colours (new wording; the Day/Night button's border, on every public page), the home page's invitation button
  focused in night colours (the ink ring), and `/about/` at 375 after the skip-link jump. They are in this session's
  scratchpad (`slice13-shots/`), not in the repository; the pull request body lists them.
- **Not claimed:** real phones and tablets, screen readers, engines other than Chrome, 200% zoom and 320 px reflow.

### 5, continued. Slice 23: the lab

Run on 18 October 2026 in the slice worktree (branch `claude/slice23-lab-a11y`, from f862bc2), Chrome only, on the
dev server through a copy of `playwright.config.ts` on port 5237 (other worktrees' runs use 5174). Nothing was
committed, deployed or pushed. The rules are the ones stated before fixing (the slice 23 amendment above). This
supersedes the lab-only exclusions and follow-ups listed under criterion 5: none is left that cites PR #31.

| Gate | Result | `uptime` load (1/5/15 min) |
| --- | --- | --- |
| `pnpm typecheck` | exit 0 (and again after the Codex fix) | 46.99 / 43.44 / 42.25 before, 45.63 / 43.22 / 42.18 after |
| `pnpm vitest run apps/lab/test` | 11 files, 266 passed, 220 s | 45.63 / 43.22 / 42.18 before, 94.04 / 53.17 / 45.56 after |
| `npx playwright test tests/e2e/public-a11y.spec.ts --project=chrome --workers=2`, after the Codex fix | 78 passed, 1 skipped (the 404 `test.fixme`), 1.9 min | 109.27 / 86.12 / 64.59 before, 89.47 / 87.86 / 68.10 after |
| `npx playwright test tests/e2e/lab-worlds.spec.ts tests/e2e/lab-fullscreen.spec.ts tests/e2e/lab-pond-keeper.spec.ts tests/e2e/lab-pond-keeper-v1.spec.ts tests/e2e/lab-pond-keeper-v2.spec.ts tests/e2e/lab-execution.spec.ts --project=chrome --workers=1` | 11 passed, 60 s | 88.22 / 73.61 / 55.46 before, 59.06 / 67.72 / 54.56 after |
| The lab's tests in that spec (`-g "/lab/\|lab header\|lab's"`), after two last edits (the header status moved only when it must; the Pond keeper state waits for the log of firsts), with `pnpm typecheck` exit 0 | 13 passed, 30 s | 62.33 / 78.10 / 67.35 before, 99.95 / 85.75 / 70.56 after |
| Every fix undone at once from a scratch script, the guarding tests run, the files restored (diff checksum identical after) | 9 of 9 fail, each on its own fix: `#pools` `aria-prohibited-attr` (undecided with a world, a violation with no GPU); `aria-valid-attr-value` on `#btn-worlds`; the first Tab on "Lineages" (`/lab/` at both widths and the Pond keeper); the Day/Night button drawn before "Journal" (`/lab/` at 375; the header test at 760); the family list's small lines at 4.14:1; "transition on button#btn-fs-exit.fs-exit"; `#card-body` missing from the Session card's controls; the Keep buttons "never reached" and "not counted" | 102.45 / 80.22 / 61.39 before, 119.10 / 87.19 / 64.71 after |
| Codex (Sol 6.1, high, read-only) on the diff, first pass | one P2: the Session card's keyboard walk ran only at 1280 by day; fixed (it now runs at both widths in both colours, with axe at each), no other findings | not recorded |
| Codex (Sol 6.1, **xhigh**, read-only) on the diff, the review stage | four P2s, no P0 or P1, verdict "fix first": the modal walk accepted focus stops that are not drawn; the lab header check could pass with the nav unreachable; the family log and its two toggles were never scanned; the review row above records high, not xhigh. All four fixed below. Final message in this session's scratchpad (`codex-review-1-final.txt`, prompt `codex-review-1-prompt.md`) | not recorded |

No test timed out. Scans: 15 axe passes over the lab now (`/lab/` and the Pond keeper at both widths in both colours,
Browse all worlds open at 1280 in both colours, the Session card open at both widths in both colours, the lab with
no GPU), against six before.

- **Fixed in the lab** (`apps/lab/lab/index.html`, `apps/lab/src/main.ts`, `apps/lab/src/style.css`):
  - the first Tab on a fresh lab is the skip link: `setMode()` keeps the lit view in sight with `#views`' own
    `scrollLeft` instead of `scrollIntoView`, which had made the view button Chrome's starting point for Tab;
  - `#pools` is `role="img"`, named "What the matter is right now: nutrient 41.2%, biomass …" from the same numbers
    as the bars' tooltips at each stats message, and "What the matter is right now: not counted yet" until one
    has come (on load, and again whenever a world is replaced);
  - `aria-controls` is gone from Browse all worlds and Session card (each keeps `aria-haspopup="dialog"`, and each
    dialog takes focus as it opens);
  - the family list's small lines are `--soft` at rest (5.5:1 by day, 5.3:1 at night on `--surface`), the name's
    ink when pressed or hovered, with no opacity;
  - at 760 px and below the nav is placed after the header status (and its Day/Night button) in the markup, before
    it above, keeping focus across the change; nothing moves on screen. The nav is what moves, not the status: the
    status line is a live region, and a moved live region may be read out again (review finding);
  - the full-screen exit button's fade is off under reduced motion;
  - the Session card's scrolling body takes focus (`tabindex="0"`, `role="region"`), with a ring drawn inside its
    edge. It is named "Session card contents", not by the card's heading as stated before fixing: named by the
    heading, a screen reader says "Session card" twice, for the dialog and then the region (review finding);
  - found by the new Pond keeper walk, not by the probe: a paused world is counted for display every 600 ms, and
    each count rebuilt Biggest lineages, so a Keep button with keyboard focus was replaced, and focused again, every
    600 ms. The rows are now rebuilt only when what they show changes (whether they offer Keep, and each lineage's
    key, share and colour); the signature is cleared with the rest of the evidence when a world is replaced. A
    comment beside it says that anything a row comes to show must join the signature.
- **Reviewed by hand, kept as listed exclusions with their reasons:**
  - at 375, the three view buttons the picker's sideways scroll clips (Signal, Pull, Light), on `/lab/` and on the
    Pond keeper: axe cannot see behind them; they wear the `.seg button` colours of the five beside them, which axe
    passes (`--muted` on `--bg`, 6.3:1 by day, 7.4:1 at night);
  - the Session card's wrapping hint lines (`#card-file-note` at both widths, the head's hint at 375): axe's model of
    what is stacked under each line runs on into the inert page behind the modal card, and differs line by line
    (seen with `axe.commons.dom.getTextElementStack`), so it cannot decide. Each line sits on the card bar's opaque
    `--surface`: `--muted` on `--surface`, 7.1:1 by day and 7.0:1 at night. An opaque background on the line itself
    was tried and did not settle it, so it was taken out again.
- **Pond keeper and the Session card:** the breeder (seed 1) stepped by hundreds to t=500 (steps clicked by event so
  no button takes focus), with the family tree (16 families), Next up (3 rungs) and the log of firsts (6 entries)
  shown, every `<details>` open: axe and the full keyboard walk at 1280 and 375 in both colours, with nothing else
  found. The tree's own log ("What the tree has seen") is still empty and hidden at t=500, so it is not scanned. The Session card is modal; opened from
  the keyboard its heading takes focus; two rounds of Tab and of Shift+Tab never leave it and reach every control,
  its body included, each with a ring of 3:1, in both colours at both widths; Close (and at 1280 a backdrop click)
  hands focus back to Session card. An extinct or gone-to-film family, Show extinct, Show all and the tree's log,
  which a history this short does not reach, were read only at first; the review stage below scans and walks them.
- **Screenshots** (this session's scratchpad, `slice23-shots/`, not in the repository): Browse all worlds at 1280 by
  day and at night, before and after (the small lines); the lab header at 375 and 600, before and after (375
  identical to the pixel; at 600 only the status dot's colour differs, the world's state when shot); the Session card
  at 1280 and 375 with its body focused (the new ring).

#### Slice 23, after review (18 October 2026)

Three review lenses and Codex (Sol 6.1, xhigh) read the uncommitted diff. No P0 or P1. What was found, and what
was done:

- **Fixed, P2:**
  - *The final tree had not been through every gate* (the last two `main.ts` edits were checked with a subset). The
    gates below are on the final tree.
  - *The modal walk accepted focus stops that are not drawn* (Codex). Each stop inside a dialog must now be what is
    drawn at its centre, on screen, within 2 s, as on the page. Broken on purpose (Download session file moved
    3,000 px off screen): fails on that button, both ways, both colours.
  - *The lab header check could pass with the nav unreachable* (Codex). At each width the header's Tab stops must
    equal every control the header shows, in the order drawn (rows top to bottom, along a row left to right), read
    from the page; widths 800 and 761 are added beside 760, so the breakpoint `main.ts` shares with `style.css` is
    tried on both sides. Broken on purpose (`tabindex="-1"` on Worlds): fails at 1280.
  - *The family log and its toggles were never scanned* (Codex and the coverage lens). A fixture tree in the
    worker's own message shape (FamiliesMsg) is posted from inside the lab's worker once the breeder stands at
    t=500 (a paused world posts no tree of its own until it steps): nine families, nested to depth 2, three living,
    one gone to film, five extinct (one more than the panel shows unfolded), and eleven log events (three more than
    it shows at first), so Show extinct and Show all both appear. The Pond keeper axe tests scan it with both
    toggles opened from the keyboard, in both colours at both widths; the Pond keeper keyboard walk runs over it
    folded, then checks that the opened toggles reach each other by Tab and Shift+Tab, drawn and ringed. Broken on
    purpose (`tabindex="-1"` on Show all): "never reached" both ways. The first scan found the log's heading and
    first row undecided at 1280: focus on Show all had scrolled the evidence column and cut them at its edge, so the
    scan now starts with every scroller back at the top, as the page's first scan does.
  - *`#pools` and the Keep buttons had no direct assertion.* The Pond keeper axe tests assert the pools' name carries
    four shares once counted, and the no-`navigator.gpu` test that it says "not counted yet". They also hold the
    first Keep button and require the same node, connected, after three more counts have reached the page; and the
    Pond keeper's set-up waits for the count for t=500 itself, since on a loaded machine it lands seconds after the
    step and rebuilds the rows once (which is what had failed the first rerun, at load 296), then requires Biggest
    lineages to stay unrebuilt through three more counts. The counts are heard by a listener the test adds to the
    page's `Worker` before the lab's script runs, so a check cannot pass on time alone with no count delivered (the
    second Codex pass, below: the first version waited 2 s and 4 s of quiet, which a slow worker could satisfy with no
    count at all). Broken on purpose: without the `onStats` label, the pools assertion fails; without the dedupe, the
    set-up fails on "is not rebuilt by counts of a paused world".
  - *The view picker's new scroll code had no test.* At 375, keys 8, 7, 1 and 8 must each leave the lit view inside
    `#views`' box without scrolling the page; the picker is checked to overflow first. Broken on purpose (the scroll
    code off): fails on Light and Pull.
  - *The review row recorded high, not xhigh* (Codex): the table above records both reviews.
- **Fixed, P3:** the reviewed contrast exclusions now measure themselves: for each node axe leaves undecided and the
  list lets through, `scan()` reads the text colour against the layers drawn under it and fails under 4.5:1
  (broken on purpose, Light at `--line`: 1.44:1 by day, 1.69:1 at night, fails); the clipped view buttons'
  exclusion covers the fixture state too. Reduced motion is also checked on the Pond keeper with the full tree
  shown and with the Session card open, `::backdrop` included. `#pools` names an empty picture as such; the card
  body's name; the live region no longer moves; the comment on the row signature; the older criterion 5 passages
  that cite PR #31 are marked as fixed or withdrawn in slice 23.
- **Not changed, with the reason:**
  - lab coverage skips without a GPU adapter, so a host with none passes with the lab unchecked. Every lab spec in
    the repository skips the same way, the two no-GPU tests cover that host, and the run's skipped count shows it;
  - `aria-controls` stays off Browse all worlds and Session card (stated before fixing: each opens a modal dialog
    that takes focus);
  - the card body is a Tab stop even when it does not scroll: a stop that comes and goes with the content's height,
    and with the window's, is harder to predict than one that is always there;
  - whether a screen reader re-announces anything as the header reorders is not verified (no screen reader here);
    the status line, the live region, no longer moves.

| Gate, on the final tree | Result | `uptime` load (1/5/15 min) |
| --- | --- | --- |
| `pnpm typecheck` | exit 0 | 46.67 / 150.50 / 146.33 before, 44.61 / 148.35 / 145.60 after |
| `pnpm vitest run apps/lab/test` | 11 files, 266 passed, 209 s | 44.61 / 148.35 / 145.60 before, 19.63 / 84.11 / 118.49 after |
| `npx playwright test tests/e2e/public-a11y.spec.ts --project=chrome --workers=2` | 79 passed, 1 skipped (the 404 `test.fixme`), 2.9 min | 19.63 / 84.11 / 118.49 before, 213.12 / 133.85 / 131.52 after |
| `npx playwright test` over `lab-worlds`, `lab-fullscreen`, `lab-pond-keeper`, `lab-pond-keeper-v1`, `lab-pond-keeper-v2`, `lab-execution` (`--project=chrome --workers=1`) | 11 passed, 47 s | 213.12 / 133.85 / 131.52 before, 106.07 / 116.90 / 125.38 after |
| The seven guards above broken on purpose from a scratch copy, run, and the files restored (diff checksum identical after) | each fails on its own break, as listed above | 274.49 / 241.40 / 167.77 to 51.20 / 154.89 / 147.81 across the four runs |

No test timed out or was retried. Before the final gates, the Pond keeper tests failed once at load 296 on the
count that lands after t=500 (the set-up now waits for it, above); the reruns after that fix passed.

#### Slice 23, second Codex pass (18 October 2026)

Codex (Sol 6.1, xhigh, read-only) read the diff and the fix log above, aimed at what the first pass would miss. No
P0 or P1, and no defect in the product fixes; it computed the family list's small lines at 5.51:1 by day and 5.33:1
at night at rest, over 9:1 hovered or pressed, and found no scope violation. Two findings, both in the spec, both
fixed:

- **P2, the Keep check could pass with no count delivered.** The 4 s of quiet in the set-up and the 2 s wait in the
  axe test needed no census to arrive, so on a slow worker both could pass before the count for t=500, which could
  then rebuild the rows during the keyboard walk. The test now hears every census the worker posts (a listener added
  to the page's `Worker` before the lab's script runs, test side only), waits for the one for t=500, and requires
  three more, each of t=500, both for the rows to stay unrebuilt in the set-up and for the first Keep button to stay
  the same node. Broken on purpose (the dedupe off): the set-up fails with 3 rebuilds in each Pond keeper and Session
  card test.
- **P3, the reviewed contrast measurement ignored opacity.** `__textContrast` now mixes the text toward its backdrop
  by the product of the opacities on the element and its ancestors. Broken on purpose (`opacity: .5` on the Light
  view button): at 375 the reviewed exclusion now fails at 2.21:1 by day and 2.7:1 at night (it measured 6.34:1
  before); at 1280 axe itself fails it.

| Gate, after the second Codex pass | Result | `uptime` load (1/5/15 min) |
| --- | --- | --- |
| Codex (Sol 6.1, xhigh, read-only), second pass | one P2, one P3, both fixed as above (final message `s23-codex-review-2-final.txt`, prompt `s23-codex-review-2-prompt.md`, full run `codex-review-2.txt`, all in this session's scratchpad) | 142.40 / 119.56 / 125.19 before, 38.40 / 99.92 / 117.78 after |
| `pnpm typecheck` | exit 0 | 65.01 / 97.34 / 108.18 |
| `npx playwright test tests/e2e/public-a11y.spec.ts --project=chrome --workers=2` | 79 passed, 1 skipped (the 404 `test.fixme`), 2.2 min. A first run failed the six Pond keeper and Session card tests on a wrong selector in the new set-up (`#top-lin li`; the rows are `div`s), fixed before this run | 112.37 / 112.56 / 114.41 before, 100.24 / 108.01 / 112.37 after |
| Both guards broken on purpose at once (`-g "axe: /lab/ "`), the files restored (diff checksum identical after) | 6 of 6 fail, as listed above | 82.60 / 103.73 / 110.76 before, 72.40 / 99.82 / 109.17 after |

The lab specs and `vitest run apps/lab/test` were not run again: since their final-tree runs above, only
`tests/e2e/public-a11y.spec.ts` and this document have changed.

#### Slice 23, third Codex pass (18 October 2026)

Codex (Sol 6.1, xhigh, read-only) checked the second pass's two fixes and what they might have brought in: the
census listener on the page's `Worker`, the waits for counts, the observer on Biggest lineages, the opacity in the
contrast measurement, and this document. No P0, P1 or P2, and no scope violation. One finding:

- **P3, opacity still faded only the text.** The second pass's measurement mixed the text toward the backgrounds
  under it but left those backgrounds as they were, so a faded element's own background, or a faded ancestor's, was
  measured at full strength. White text on black inside `opacity: .5` over white measured about 5.3:1; drawn, it is
  white on grey, about 4.0:1. Fixed: `__textContrast` now draws one pixel of the element twice, with its text and
  without, the way the browser does: each element from the page down is a layer of its own (its background, then
  what is inside it) laid on what is behind it at its own opacity. On a scratch page that case now measures 4.06:1;
  white on black, white text at `opacity: .5` on black, and `#767676` on white measure 21, 5.32 and 4.54:1, as
  they should. Broken on purpose again (`opacity: .5` on the Light view button): 375 fails at 2.22:1 by day and
  2.7:1 at night (2.21:1 by day before: the button's own background, `--raised`, is close to what is behind it, so fading it
  moves the result only within rounding), and
  1280 fails on axe itself.
- **Not changed, with the reason:** the focus-ring contrast check (`__ring`) still reads the backgrounds behind a
  ring without opacity. Codex did not raise it; a ring is drawn on its parent's backdrop rather than on the
  element's, so it needs its own compositing path, not a one-line change.

| Gate, after the third Codex pass | Result | `uptime` load (1/5/15 min) |
| --- | --- | --- |
| Codex (Sol 6.1, xhigh, read-only), third pass | one P3, fixed as above (final message `s23-codex-review-3-final.txt`, prompt `s23-codex-review-3-prompt.md`, full run `s23-codex-review-3.txt`, all in this session's scratchpad) | 35.03 / 79.29 / 100.14 before, 16.66 / 49.99 / 83.37 after |
| `pnpm typecheck` | exit 0 | 25.72 / 43.44 / 77.09 |
| `npx playwright test tests/e2e/public-a11y.spec.ts --project=chrome --workers=2` | 79 passed, 1 skipped (the 404 `test.fixme`), 1.8 min | 27.73 / 43.08 / 76.38 before, 36.83 / 42.16 / 72.03 after |
| The opacity guard broken on purpose (`-g "axe: /lab/ at"`), `style.css` restored (diff checksum identical after) | 2 of 2 fail, as listed above | 54.67 / 45.79 / 72.63 before, 100.73 / 57.89 / 75.94 after |

Only `tests/e2e/public-a11y.spec.ts` and this document changed in this pass, so the lab specs and
`vitest run apps/lab/test` stand on their final-tree runs above.

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
coarse ceiling); join limits through the real proxy; 404s over HTTP (locally the production rules answer an empty
404, see criterion 5); canonical URLs and the sitemap at the live domain. The local half of mobile and keyboard
access and missing-GPU behaviour is done (criterion 5: 375 px emulated, Chrome's keyboard, Chrome with
`--disable-gpu`); real phones and tablets, screen readers and other engines remain.
