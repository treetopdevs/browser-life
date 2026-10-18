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
  reason and listed as a follow-up, not fixed here.
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
- **404 (as found; closed locally by criterion 6).** The dev server answered an unknown path with the home page and 200 (Vite's fallback), so 404s are not
  tested there. A one-off local Caddy file server over a fresh build records what the production rules
  (`try_files`, then `file_server`) answer. A styled 404 page needs a build input and a `handle_errors` block in
  `deploy/Caddyfile`, both outside this slice; the 404 row stays **Needs the live host**, with what was seen.
  (18 October 2026: superseded by criterion 6, which builds the page and checks it locally; the live host's answer
  is still a live-host row.)
- **Fixes** go only in the public pages (their HTML, page TypeScript and CSS), `apps/lab/src/site.css` and
  `apps/lab/src/theme.ts`. `tokens.css` is shared with the lab and is not changed. Copy keeps its meaning and
  British spelling.
- **Not claimed:** real phones and tablets, screen readers, engines other than Chrome, 200% zoom and 320 px reflow.

#### Amendments to criterion 5, after running (18 October 2026)

- **The first Tab and the skip-link jump.** Criterion 5 said the first Tab focuses the skip link and that Enter on
  it, then Tab, lands in `<main>`. On `/lab/` the first Tab from a fresh page lands on the view buttons
  ("Lineages"): the lab moves the focus starting point while it plants. That is lab code held by PR #31, so it is an
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
- **404** is a `test.fixme` in the spec, naming what it needs, so it shows in every run as not done. (18 October
  2026: superseded by criterion 6; the fixme is now a real test.)
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

### 18 October 2026: criterion 6 added, stated before building

Criterion 5 found the gap "there is no 404 page" and left it as a follow-up (a `test.fixme`). Its local half is now
a criterion of its own, written before any code changes (slice 19, branch `claude/slice19-not-found`, from
`275796c`). What the live host answers stays a live-host row. Nothing is deployed.

#### 6. A page of its own for an unknown path, on this machine

- **The page.** `apps/lab/404.html`, a build input, in the public pages' shell: skip link, the site header and
  Primary nav, `main#main`, the footer, `/src/site.css` and `/src/theme.ts` (so the Day/Night button and the page-view
  counter work as on every page). No new CSS: only classes `site.css` already has. Title `Page not found · Cadence
  Garden`; `<meta name="robots" content="noindex">`; no canonical link, so the social-meta plugin adds no Open Graph
  tags and the sitemap does not change. One `main h1`, a short kind line in the site's voice and British spelling,
  and links inside `main` to Home `/`, Worlds `/worlds/`, Lab `/lab/` and Journal `/research/`. The requested path is
  not written into the page. Every URL in the built page is absolute (`/assets/…`, `/favicon.svg`), since it is
  served at any depth.
- **Production rules.** `deploy/Caddyfile` gains a `handle_errors` block that, for an error whose status is 404 on a
  path outside `/api/*` and `/healthz`, serves `/404.html` with status 404 and `Cache-Control: no-store`, in place
  of the `Cache-Control` the `/assets/*` and `/fonts/*` header lines set before the miss (seen on a scratch config: a
  missing asset's 404 would otherwise carry `immutable` for a year), and without 404.html's own `ETag` and
  `Last-Modified`. The request's conditional and range headers (`If-None-Match`, `If-Modified-Since`, `If-Match`,
  `If-Unmodified-Since`, `If-Range`, `Range`) are dropped before the page is served. (Changed after review, 18
  October 2026: the block first only dropped `Cache-Control`. Then a miss still carried 404.html's validators, so a
  cache could keep it heuristically after the page it stood for was deployed, and a request with `If-None-Match: *`
  or the miss's own ETag got a 404 with an empty body, the blank page this criterion removes.) A bare `/api` is not
  a path Phoenix answers (`@api` is `/api/*`), so it is a site path and gets the page. Other error statuses (a 502 when the coordinator is down) keep today's
  empty answer. `/404.html` asked for directly answers 404 too (an `error` line), so the page never answers 200. The
  block matches with `expression {err.status_code} == 404` rather than `handle_errors 404`, because production
  runs `caddy:2.10-alpine` (`Dockerfile.site`), and whether 2.10 takes `handle_errors 404` was not confirmed here
  (nothing was downloaded); the expression form does not depend on that. (Corrected after review, 18 October 2026:
  this line first said the expression form is older than the status-list form, which was not checked.)
- **Checked against a local Caddy.** The installed `/opt/homebrew/bin/caddy` (v2.11.7, not the production 2.10)
  runs a copy of `deploy/Caddyfile` made at test time by substitution, changed only in its listen address, upstream
  address and root, with `admin off` and `persist_config off` added, over a fresh `pnpm build`, with a stub upstream
  on a scratch port. It passes if: `/no-such-page/`, `/no-such-page`, `/a/b/c.html`, `/lab/no-such-page/`,
  `/assets/no-such.js`, `/fonts/no-such.woff2`, a bare `/api` and `/healthz/` answer 404 with the page (its title and
  noindex), `Cache-Control: no-store` and no `ETag` or `Last-Modified`; the page asked for by name answers 404 with
  the page under every spelling sent as written (`/404.html`, `/404%2ehtml`, `//404.html`, `/./404.html`,
  `/%2e/404.html`, `/x/../404.html`, `/404.HTML`, `/404.HtMl`), and `/404.html/` 308 to `/404.html`; `/no-such-page/` asked for with
  `If-None-Match: *`, a future `If-Modified-Since`, `If-Match`, a past `If-Unmodified-Since`, `Range` or `Range` with
  `If-Range` still answers 404 with the whole page and no `Content-Range`; HEAD on `/no-such-page/` answers 404; every sitemap route, `/garden/`, `/island.html`, `/selftest.html`,
  `/robots.txt`, `/sitemap.xml`, `/site.webmanifest`, `/favicon.svg` and one built `/assets/*` file answer 200;
  `/lab/?world=<id>` and `/worlds/?world=<id>` for a world in `public/og/worlds/manifest.json` answer 200 with that
  world's copy (its `og:url` names the world), `/lab/?world=no-such-world` the plain lab page; `/lab` answers 308 to
  `/lab/` and `/lab/world/<id>/` 308 to `/lab/?world=<id>`; `/api/public/status` reaches the stub and returns its
  body, `/api/no-such` returns the stub's own 404 JSON (not the page), `/API/public/status` reaches the stub too
  (Caddy's path matcher ignores case), `/healthz` reaches the stub as
  `/api/public/status`; with the stub stopped, `/api/public/status` answers 502 without the page. A page served at
  `/a/b/no-such/` in Chrome has its stylesheet applied. The curl results are pasted under Results.
- **Dev and preview.** Vite's dev server and `vite preview` answer an unknown path asked for as HTML (an `Accept`
  that includes `text/html` or `*/*`, or none) with the page and 404, through `appType: "mpa"` and a small plugin in
  `apps/lab/vite.config.ts`; a directory with an `index.html` asked for without its slash answers 308 to the slash
  with its query, which is what Caddy's `redir` lines do for the eight top-level pages. The plugin reads the path
  decoded and normalised, so `//404.html`, `/./404.html` or `/x/../404.html` are the page by name too (they answered
  200 from `vite preview`'s static server before review, 18 October 2026), no existence check looks outside the
  root, and only a path already in normal form is redirected (`//example.com` and `/%2e%2e/apps` get the page, no
  `Location`). The name is matched without regard to case, as Caddy's path matcher does, since macOS's disk would
  otherwise serve `/404.HTML` with 200 in dev; and in dev a Vite module request for the page (`/404.html?raw`,
  `?url`, `?import` and the like) goes on to Vite's transforms, which answer it as JavaScript (both after the third
  review, 18 October 2026). Only a request Vite would transform counts as a module request: a module query from a
  fetch that is not a document's, which is a script fetch or carries `import` or `html-proxy`; a navigation or plain
  fetch with the same query (`/404.HTML?raw`) gets the page (after the fourth review, 18 October 2026). Only a miss whose `Accept` names neither (a `fetch` asking for JSON) keeps Vite's
  empty 404; a missing script, image or `/favicon.ico`, whose `Accept` includes `*/*`, gets the page with 404 too, as
  under Caddy. (Corrected while building, 18 October 2026: this line first said a module or an image kept Vite's
  plain 404, which copying Vite's own `Accept` test does not do.) Known differences, not closed: Vite's mpa fallback
  also serves `/<name>` as `/<name>.html` when that file exists (`/selftest`), which Caddy does not; dev has no
  `/<page>/world/<id>/` copies (seen in review: `/worlds/world/ponds/` is 404 in dev, 200 in `vite preview`, 308 under Caddy); dev
  and preview send any directory with an `index.html` to its slash, where Caddy redirects only the eight `redir`
  pages and serves `/garden` at 200 without one (dev-only directories such as `/dist` and `/discovery` redirect
  too); and a path that does not decode (`/%`, `/%zz`) gets the page with 404 in dev and preview, where Caddy
  answers its own plain-text 400 before `handle_errors`. (Listed after review, 18 October 2026: the dev comment
  first said the redirect was "as Caddy's `redir` lines do".) On macOS's case-blind disk a real page asked for in
  another case is found: `/ABOUT/` answers 200 in dev and preview and `/Lab/index.HTML` 200 in dev, where
  production's Linux disk answers 404, and `/About` is sent to `/About/` where Caddy's case-blind `redir` sends it
  to `/about/`; only the not-found page's own name is matched without case (listed after the fourth review, 18
  October 2026; not pinned by a test, since the answer depends on the disk the checks run on). The e2e specs' blank same-origin pages
  (`/lab-worker-test` and the like) are fulfilled by `page.route` before they reach the server, so the switch from
  the spa fallback does not touch them.
- **Tests.** The 404 `test.fixme` in `tests/e2e/public-a11y.spec.ts` becomes a real test against the dev server
  (status, title, noindex, no canonical or `og:url`, the four links, a real page and the slashless redirect beside
  it), and `/no-such-page/` joins the spec's pages, expected to answer 404: axe at both widths in both colours,
  the keyboard walk, reduced motion and the no-GPU walk. The Caddy table above is a spec of its own that skips with
  its reason when Caddy or `apps/lab/dist` is missing, and fails instead under `BL_REQUIRE_BUILD_CHECK=1`; a
  `dist/404.html` older than `apps/lab/404.html` counts as missing (added after review, 18 October 2026; after the
  third review, older than `apps/lab/vite.config.ts` too, which lists the page as an input and holds the plugin; other
  build sources are not tracked, so `pnpm build` first stays the rule). The same
  spec checks the plugin's rules with request targets sent as written (`node:http`, since Playwright's request API
  resolves `/./` and `/x/../` first) under `vite preview` (skips without a current build) and the dev server (never
  skips): unknown paths and the page by name answer 404 with the page, `//example.com` and `/%2e%2e/apps` get no
  `Location`, `/lab?x=1` 308s, real pages answer 200, HEAD gets the status alone and JSON and POST keep Vite's empty
  404. A plain `npx playwright test` without Caddy or a build still skips the Caddy half: the `handle_errors` block
  is then untested, as the console line says.
- **Gates.** `pnpm typecheck`; `pnpm build`; `public-a11y.spec.ts`, `public-site.spec.ts`, `public-routes.spec.ts`
  (build check required) and the Caddy spec in Chrome; `uptime` beside each.
- **Not claimed:** what `cadence.garden` answers (the live host and Caddy 2.10 itself), engines other than Chrome.
  A visit to the page is counted like any page view, with its path and without its query (`analytics.ts`), which
  the privacy page already describes. (Review, 18 October 2026: that path is whatever the visitor mistyped or pasted,
  and scanners that run scripts will show up in the counter's top pages. Counting the page as a fixed `/404` needs a
  change to `apps/lab/src/analytics.ts`, shared by every page and outside this slice, so it is a follow-up, as is a
  sentence on `/privacy/` saying a mistyped address is recorded as the page.)

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
  sun fill as the button's label, which axe passes. Lab, listed with the reason "PR #31" and left to its follow-up:
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
  Lab-only, exclusions and follow-ups for PR #31: the first Tab lands on "Lineages"; at 375 the lab header draws its
  Day/Night button ahead of tabs it follows in the markup.
- **Reduced motion:** **Done.** On every route and the island page, with `prefers-reduced-motion: reduce`, `html`
  scrolls without animation, no element or pseudo-element has an animation or a transition longer than 0 s, and
  `document.getAnimations()` reports nothing running; without the setting the public pages scroll smoothly and the
  lab has transitions, so the check bites. The public pages have no animations (two pages update text on a timer,
  which is not motion). Lab-only, an exclusion and a follow-up for PR #31: the full-screen exit button's fade
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
- **404:** **Gap as found, closed locally by criterion 6: there was no 404 page.** The dev server answers an unknown path with the home page and 200 (Vite's
  fallback), so the spec cannot pin it there; it carries a `test.fixme` naming what it needs. A fresh build served by
  Caddy 2 with the production file rules (`try_files {path} {path}/index.html`, then `file_server`; scratch config,
  port 8089) answers `/no-such-page/`, `/no-such-page`, `/lab/world/nope/` and `/assets/nope.js` with 404 and an
  empty body: a visitor sees a blank page. A 404 page needs an `apps/lab/404.html` build input and a `handle_errors`
  block in `deploy/Caddyfile`, both outside this slice: a follow-up. That the live host behaves the same still needs
  the live host. (18 October 2026: superseded by criterion 6 below, which adds the page and the `handle_errors`
  block and checks them against a local Caddy.)
- **Screenshots** of the pages that look different, at 1280 and 375: the home page and Join in in day and night
  colours (new wording; the Day/Night button's border, on every public page), the home page's invitation button
  focused in night colours (the ink ring), and `/about/` at 375 after the skip-link jump. They are in this session's
  scratchpad (`slice13-shots/`), not in the repository; the pull request body lists them.
- **Not claimed:** real phones and tablets, screen readers, engines other than Chrome, 200% zoom and 320 px reflow.

### 6. A page of its own for an unknown path

Run on 18 October 2026 in the slice worktree (branch `claude/slice19-not-found`, from `275796c`), Chrome only.
Nothing was committed, deployed or pushed. Port 5174 was held by another worktree's dev server, so the Playwright
runs used a copy of `playwright.config.ts` on port 5219 (not committed). Caddy is the installed v2.11.7, not
production's 2.10. No test timed out.

| Gate | Result | `uptime` load (1/5/15 min) |
| --- | --- | --- |
| `pnpm typecheck` | exit 0 | 86.7 / 54.3 / 59.5 |
| `pnpm vitest run apps/lab/test` | 10 files, 209 passed | 86.7 / 54.3 / 59.5 before, 178.0 / 85.5 / 69.5 after |
| `pnpm build` | exit 0; `dist/404.html` written | 181.0 / 89.2 / 70.9 |
| `BL_REQUIRE_BUILD_CHECK=1 npx playwright test tests/e2e/public-routes.spec.ts tests/e2e/public-not-found.spec.ts --project=chrome` | 10 passed, 29 s | 178.4 / 94.7 / 73.3 before, 154.7 / 97.3 / 75.1 after |
| `npx playwright test tests/e2e/public-a11y.spec.ts --project=chrome --workers=3` | 77 passed, none skipped (was 71 and the 404 `test.fixme`), 1.9 min | 146.7 / 96.6 / 74.9 before, 142.1 / 113.4 / 84.4 after |
| `npx playwright test tests/e2e/public-site.spec.ts --project=chrome` | 8 passed | 142.1 / 113.4 / 84.4 before, 129.4 / 111.6 / 84.1 after |
| `pnpm typecheck` and `pnpm build`, after the review fix | exit 0 each | 37.7 / 77.8 / 74.7 |
| `BL_REQUIRE_BUILD_CHECK=1 npx playwright test tests/e2e/public-routes.spec.ts tests/e2e/public-not-found.spec.ts --project=chrome`, after the review fix | 10 passed | 36.0 / 75.4 / 73.9 before, 37.5 / 75.1 / 73.8 after |
| `npx playwright test tests/e2e/public-a11y.spec.ts --project=chrome --workers=3`, after the review fix | 77 passed, 1.3 min | 37.5 / 75.1 / 73.8 before, 64.7 / 76.5 / 74.5 after |
| `npx playwright test tests/e2e/public-site.spec.ts --project=chrome`, after the review fix | 8 passed | 64.7 / 76.5 / 74.5 before, 63.1 / 75.7 / 74.3 after |
| `public-not-found.spec.ts` with `apps/lab/dist/404.html` moved aside, then restored | without `BL_REQUIRE_BUILD_CHECK`: 5 skipped and the console line "Caddy check SKIPPED"; with `BL_REQUIRE_BUILD_CHECK=1`: fails ("run pnpm build first") | 34.8 / 62.4 / 69.3 |
| The dev half broken on purpose (`appType: "mpa"` commented out), then restored: `public-a11y.spec.ts -g "404:"` | fails: expected 404, received 200 (the spa fallback's home page) | 34.0 / 61.8 / 69.0 |
| `public-not-found.spec.ts` against the old `deploy/Caddyfile` (from `275796c`), then the new one restored | fails: the unknown-path test (no page) and the render test (`ERR_HTTP_RESPONSE_CODE_FAILURE`, an empty 404); the 200 and `/api` tests pass | about 23.7 / 33.4 / 54.5 |

The local Caddy table, by hand with `curl` against the same substituted `deploy/Caddyfile` the spec writes
(listen `127.0.0.1:18189`, a stub upstream on `127.0.0.1:18190`, root the fresh `apps/lab/dist`), each request
sent with `Accept: text/html`:

| Request | Status | Content-Type | Cache-Control | Location | Title or body |
| --- | --- | --- | --- | --- | --- |
| GET `/no-such-page/` | 404 | text/html | none | none | Page not found · Cadence Garden |
| GET `/no-such-page` | 404 | text/html | none | none | Page not found · Cadence Garden |
| GET `/a/b/c.html` | 404 | text/html | none | none | Page not found · Cadence Garden |
| GET `/lab/no-such-page/` | 404 | text/html | none | none | Page not found · Cadence Garden |
| GET `/assets/no-such.js` | 404 | text/html | none | none | Page not found · Cadence Garden |
| GET `/fonts/no-such.woff2` | 404 | text/html | none | none | Page not found · Cadence Garden |
| GET `/404.html` | 404 | text/html | none | none | Page not found · Cadence Garden |
| HEAD `/no-such-page/` | 404 | text/html | none | none | (no body) |
| GET `/`, `/lab/`, `/worlds/`, `/about/`, `/garden/` | 200 each | text/html | none | none | each page's own title |
| GET `/island.html`, `/selftest.html` | 200 each | text/html | none | none | Island; GPU self-test |
| GET `/robots.txt` | 200 | text/plain | none | none | `User-agent: *` … |
| GET `/sitemap.xml` | 200 | application/xml | none | none | `<?xml` … |
| GET `/site.webmanifest` | 200 | application/manifest+json | none | none | `{ "name": "Cadence Garden"` … |
| GET `/favicon.svg` | 200 | image/svg+xml | none | none | `<svg` … |
| GET `/assets/theme-BxevhG5A.js` | 200 | text/javascript | public, max-age=31536000, immutable | none | the script |
| GET `/lab/?world=spots` | 200 | text/html | none | none | Even light · Cadence Garden (`og:url` `https://cadence.garden/lab/?world=spots`) |
| GET `/worlds/?world=spots` | 200 | text/html | none | none | Even light · The worlds · Cadence Garden |
| GET `/lab/?world=no-such-world` | 200 | text/html | none | none | The lab: grow an artificial-life world · Cadence Garden |
| GET `/lab` | 308 | none | none | `/lab/` | (empty) |
| GET `/lab/world/spots/` | 308 | none | none | `/lab/?world=spots` | (empty) |
| GET `/api/public/status` | 200 | application/json | none | none | `{"stub":"/api/public/status"}` |
| GET `/api/no-such` | 404 | application/json | none | none | `{"error":"stub: not found"}` (the stub's own) |
| GET `/healthz` | 200 | application/json | none | none | `{"stub":"/api/public/status"}` |
| GET `/api/public/status`, stub stopped | 502 | none | none | none | (empty) |
| GET `/healthz`, stub stopped | 502 | none | none | none | (empty) |

Dev and preview, by hand with `curl` (`Accept: text/html` unless named): `vite preview` answers `/no-such-page/`,
`/a/b/c.html`, `/404.html` and `/assets/no-such.js` with 404 and the page, HEAD `/no-such-page/` with 404, `/lab`
and `/lab?x=1` with 308 to `/lab/` and `/lab/?x=1`, `/`, `/about/`, `/island.html` and `/robots.txt` with 200, and
`/no-such` asked for as JSON with an empty 404. The dev server answers the same way, and also: `/404.html` 404 with
the page, `/discovery` 308 to `/discovery/` (a page in `apps/lab` that is not in the build), `//lab` 404 with the
page (no redirect to another host), `/src/theme.ts` 200, `/lab/world/spots/` 404 (dev has no world copies),
`/favicon.ico` 404 with the page, `/selftest` 200 (Vite's own `.html` fallback), and a POST 404 without the page.

**Review.** A read-only Codex review (`gpt-6.1-sol`, high effort) found nothing serious and one low finding: in
`vite preview`, `/404.html/` and `/404%2ehtml` slipped past the check for the page asked for by name and the static
server answered them 200. Fixed: dev and preview both take the page asked for by name, in any of those spellings and
with any `Accept`, before their static servers, and answer 404. Caddy already never answers 200 for them:
`/404%2ehtml` answers 404 with the page, and `/404.html/` answers 308 to `/404.html` (`file_server` drops a file's
trailing slash), which answers 404. Both specs now ask for these spellings. The gate runs above were repeated after
the fix (see the rows marked "after the review fix").

**Second review** (18 October 2026: three review lenses and Codex `gpt-6.1-sol` at xhigh, read-only; no P0 or P1).
Fixed:

- A miss carried 404.html's `ETag` and `Last-Modified` and no `Cache-Control`, so a cache could keep it
  heuristically after the page it stood for was deployed, and `If-None-Match: *` (or the miss's own ETag) got a 404
  with an empty body. The `handle_errors` page now sends `Cache-Control: no-store`, drops both validators, and drops
  the request's conditional and range headers before serving the page. The spec asserts `no-store`, no validators,
  and the whole page under six conditional or range requests; against the earlier block those checks fail.
- `vite preview` answered `//404.html`, `/./404.html`, `/%2e/404.html` and `/x/../404.html` with 200 (its static
  server normalises them). The plugin now reads every path decoded and normalised, so they answer 404 with the page,
  no existence check looks outside the root, and only a path in normal form is redirected. With normalising undone,
  the preview and dev checks fail (`//404.html`: expected 404, received 200).
- The Vite redirect comment and the dev-differences list were wrong or short; corrected above, with `/garden`,
  dev-only directories and undecodable paths added.
- The not-found line "Everything else is where you left it." sat beside "the page may have moved"; it now reads
  "The rest of the garden is a link away."
- The spec skipped silently on a build older than the page; a stale `dist/404.html` now counts as no build. `vite
  preview` and the dev server are now checked in the same spec, with request targets sent as written.
- The two "Gap: there is no 404 page" headlines above now say the gap was closed locally by criterion 6.

Not changed, with reasons: a bare `/api` gets the page rather than being excluded, since it is not a path Phoenix
answers (`@api` is `/api/*`) and the page is the kinder answer; the Caddyfile comment now says so and the spec pins
it. The page view at the mistyped path is a follow-up outside this slice (see Not claimed in criterion 6). Caddy
2.10 itself stays unchecked: running `caddy:2.10-alpine` needs an image download, not done here. A plain `npx
playwright test` without Caddy or a build still skips the Caddy half, as `public-routes.spec.ts` does; the console
line says so.

| Gate, after the second review's fixes | Result | `uptime` load (1/5/15 min) |
| --- | --- | --- |
| `pnpm typecheck`, on the final tree (after the mutation run was restored) | exit 0 | 55.4 / 76.1 / 77.3 before, 54.3 / 75.6 / 77.1 after |
| `pnpm build` | exit 0; `dist/404.html` has the new line | 200.5 / 124.3 / 82.2 before, 198.5 / 125.1 / 82.8 after |
| `BL_REQUIRE_BUILD_CHECK=1 npx playwright test tests/e2e/public-not-found.spec.ts tests/e2e/public-routes.spec.ts tests/e2e/public-site.spec.ts --project=chrome` | 22 passed, 33 s (not-found 9: Caddy 7, `vite preview` 1, dev 1) | 173.5 / 125.1 / 84.0 before, 140.5 / 122.4 / 84.7 after |
| The same not-found spec with the earlier `handle_errors` block (only `header -Cache-Control`) and the plugin's normalising undone, then both restored | 4 failed (the never-stored test, the conditional test, preview, dev), 5 passed | 122.5 / 120.4 / 85.9 after |
| `npx playwright test tests/e2e/public-a11y.spec.ts --project=chrome --workers=3` | 77 passed, 1.7 min | 68.9 / 106.2 / 82.8 before, 112.2 / 112.4 / 88.0 after |
| `pnpm vitest run tools/test/site-build.test.ts apps/lab/test/social-meta.test.ts` | 29 passed | 102.1 / 110.2 / 87.5 |

Port 5174 was again held by another worktree's dev server, so the Playwright runs used an uncommitted copy of
`playwright.config.ts` on port 5291. No test timed out.

The local Caddy (v2.11.7) by hand with `curl`, after the fixes, against the same substituted `deploy/Caddyfile`
(listen `127.0.0.1:18419`, a stub upstream on `127.0.0.1:18420`, root the fresh `apps/lab/dist`), each request with
`Accept: text/html`; "validators" means `ETag` and `Last-Modified`. Taken between the a11y run and the final
typecheck (load 102.1 / 110.2 / 87.5 just before, 55.4 / 76.1 / 77.3 a few minutes after):

| Request | Status | Cache-Control | Validators | Location | Body |
| --- | --- | --- | --- | --- | --- |
| GET `/no-such-page/`, `/assets/no-such.js`, `/fonts/no-such.woff2`, `/api`, `/healthz/` | 404 each | no-store | none | none | the page (2691 B) |
| GET `//404.html`, `/x/../404.html` (sent as written) | 404 each | no-store | none | none | the page |
| GET `/404.html/` | 308 | no-store | none | `/404.html` | (redirect) |
| GET `/no-such-page/` with `If-None-Match: *` | 404 | no-store | none | none | the whole page |
| GET `/no-such-page/` with `If-Modified-Since` in 2100 | 404 | no-store | none | none | the whole page |
| GET `/no-such-page/` with `Range: bytes=0-10` | 404 | no-store | none | none | the whole page, no `Content-Range` |
| GET `/about/`, `/garden`, `/robots.txt`, `/sitemap.xml`, `/lab/?world=spots` | 200 each | none | both | none | each file (`/lab/?world=spots`: Even light · Cadence Garden) |
| GET `/lab`; `/lab/world/spots/` | 308; 308 | none | none | `/lab/`; `/lab/?world=spots` | (empty) |
| GET `/api/public/status`; `/API/public/status` | 200; 200 | none | none | none | the stub's JSON |
| GET `/api/no-such` | 404 | none | none | none | `{"error":"stub: not found"}` (the stub's own) |
| GET `/healthz` | 200 | none | none | none | `{"stub":"/api/public/status"}` |
| GET `/%zz` | 400 | none | none | none | Caddy's own `400 Bad Request` |
| GET `/api/public/status`, stub stopped | 502 | none | none | none | (empty) |

**Third review** (18 October 2026: Codex `gpt-6.1-sol` at xhigh, read-only, on the fixes above; no P0, P1 or P3;
it could not bind sockets, so it worked from source and in-memory probes). Three P2s, all fixed:

- The dev server answered `/404.HTML` and `/404.HtMl` with 200: the name check was case-sensitive and macOS's disk is
  not. The check now ignores case, and both spellings join the by-name list the Caddy, preview and dev checks send.
  (Caddy already answered them 404 with the page. With the case-blind check undone, `vite preview` still answered
  404 and only dev answered 200; Codex reported preview open too, which this run did not reproduce.) With the fix undone, the dev check fails (`/404.HTML`: expected 404, received 200).
- The early by-name handler took Vite's own module requests for the page (`/404.html?raw&import`,
  `/404.html?url&import`) and answered them with the page, where Vite answers JavaScript. In dev those queries now go
  on to Vite (narrowed in the fourth review: only a request Vite would transform); preview, which has no transforms, still takes every request for the page. The dev check asks for both
  and expects 200 JavaScript; with the fix undone it fails (expected 200, received 404).
- The stale-build guard looked only at `apps/lab/404.html`, so a build made before the page's input was removed from
  `vite.config.ts` would still pass. A `dist/404.html` older than `apps/lab/vite.config.ts` now counts as no build
  too. Checked by touching `vite.config.ts`: with `BL_REQUIRE_BUILD_CHECK=1` the Caddy and preview groups fail
  ("older than apps/lab/404.html or apps/lab/vite.config.ts"); without it they skip with that line. Other build
  sources are still not tracked.

Things it tried and could not break: header deferral and validator removal in Caddy 2.10.2's source (a delete makes
the `header` block deferred) and request-header removal before `file_server`; Phoenix's 404s passing through
`reverse_proxy` as ordinary responses; the error route running once; the redirect guards; the page's markup and its
place in the a11y walks; scope.

| Gate, after the third review's fixes | Result | `uptime` load (1/5/15 min) |
| --- | --- | --- |
| `pnpm typecheck` | exit 0 | 23.5 / 38.5 / 55.4 |
| `pnpm build` | exit 0; `dist/404.html` written | 23.5 / 38.5 / 55.4 |
| `BL_REQUIRE_BUILD_CHECK=1 npx playwright test tests/e2e/public-not-found.spec.ts tests/e2e/public-routes.spec.ts tests/e2e/public-site.spec.ts --project=chrome` (the real `playwright.config.ts`, port 5174 free this time) | 22 passed, 8.8 s | 23.5 / 38.5 / 55.4 before, 27.3 / 38.8 / 55.3 after |
| Each fix undone on its own, then restored: the case-blind name check; the module-request pass-through; `vite.config.ts` touched after the build | the dev check fails (`/404.HTML`: expected 404, received 200); the dev check fails (`/404.html?raw&import`: expected 200, received 404); with `BL_REQUIRE_BUILD_CHECK=1` the Caddy and preview groups fail, without it they skip with the reason | 30.6 / 42.2 / 57.6 to 27.6 / 40.8 / 56.7 |
| `npx playwright test tests/e2e/public-a11y.spec.ts --project=chrome --workers=3` | 77 passed, 1.4 min | 26.8 / 38.5 / 55.1 before, 74.1 / 53.4 / 59.3 after |
| `pnpm vitest run tools/test/site-build.test.ts apps/lab/test/social-meta.test.ts` | 29 passed | 71.3 / 53.2 / 59.2 |
| Local Caddy v2.11.7 by hand with `curl` (the substituted `deploy/Caddyfile`, listen `127.0.0.1:18431`, stub `127.0.0.1:18432`, `Accept: text/html`) | `/404.HTML`, `/404.HtMl`, `/404.html?raw&import`, `/404.html`, `/no-such-page/`: 404, `no-store`, no validators, the page (2691 B); `/about/` 200 with both validators; `/api/public/status` 200 and `/api/no-such` 404, each the stub's JSON | 57.7 / 51.5 / 58.4 after |

No test timed out. The `pnpm build` above came after both mutations were restored and after `vite.config.ts` was touched for the stale-build check, so the build the runs used is newer than both tracked sources.

**Fourth review** (18 October 2026: Codex `gpt-6.1-sol` at xhigh, read-only, on the third review's fixes; no P0 or
P1; again no sockets, so source and in-memory probes against the installed Vite 8.3.1). One P2, fixed, and one P3,
documented:

- P2: the module pass-through reopened the case bypass in dev. It let any request whose query named a Vite loader
  (`?raw`, `?url=x`, `?direct`) go on to Vite, but Vite transforms an `.html` file only for a script fetch or an
  `import` or `html-proxy` query, and never for a document fetch; so `GET /404.HTML?raw` as a navigation fell through
  to Vite's static files, which serve upper-case `.HTML`, and answered 200 with the page's HTML. The pass-through now
  makes Vite's own tests (not a document fetch, a loader query, and a script fetch or `import` or `html-proxy`), so
  only a real module request goes on. The by-name list gains `/404.HTML?raw`, `/404.html?raw`, `/404.html?url=x`,
  `/404.html?direct` and `/x/../404.HTML?raw` (sent by the Caddy, preview and dev checks), and the dev check sends
  every by-name spelling plus `/404.html?raw&import`, `/404.HTML?url&import` and `/404.html?html-proxy&index=0.js`
  again as a navigation (`Sec-Fetch-Dest: document`), expecting the page with 404. Before the fix the dev check
  failed (`/404.HTML?raw`: expected 404, received 200); after it, it passes, and the two script-fetch module requests
  still answer 200 JavaScript.
- P3: the listed dev and preview differences left out case-blind lookup of real pages on macOS (`/ABOUT/` 200 in dev
  and preview, `/Lab/index.HTML` 200 in dev, `/About` sent to `/About/` rather than `/about/`). Now listed in
  criterion 6 and in the plugin's comment; not pinned by a test, since the answer depends on the disk the checks run
  on, and not changed, since production serves from Linux.

Things it tried and could not break: plain case variants and normalised aliases in both handlers; the loader-query
boundaries (`?important`, `?urlx` do not match); Vite's raw loader answering this page as JavaScript; the stale-build
guard's direction and precision (a missing source throws rather than passes; a checkout touching a source after the
build makes a skip, or a failure under `BL_REQUIRE_BUILD_CHECK=1`, never a pass); deferred validator removal and
request-header removal before `file_server`; the doc's test counts; scope.

| Gate, after the fourth review's fix | Result | `uptime` load (1/5/15 min) |
| --- | --- | --- |
| The dev check with the new navigation requests, before the fix | fails (`/404.HTML?raw`: expected 404, received 200) | 25.99 / 37.71 / 45.28 |
| The same check after the fix | 1 passed | 21.48 / 35.75 / 44.35 |
| `pnpm typecheck` | exit 0 | 22.42 / 34.82 / 43.77 |
| `pnpm build` | exit 0; `dist/404.html` newer than both tracked sources | 22.14 / 34.56 / 43.62 after |
| `BL_REQUIRE_BUILD_CHECK=1 npx playwright test tests/e2e/public-not-found.spec.ts tests/e2e/public-routes.spec.ts tests/e2e/public-site.spec.ts --project=chrome` | 22 passed, 8.4 s | 21.89 / 34.30 / 43.48 before, 25.82 / 34.91 / 43.64 after |
| `npx playwright test tests/e2e/public-a11y.spec.ts --project=chrome --workers=3` | 77 passed, 1.1 min | 24.35 / 34.30 / 43.32 before, 63.24 / 44.67 / 46.57 after |
| Local Caddy v2.11.7 by hand with `curl` (as above, `Accept: text/html`) | `/404.HTML`, `/404.HTML?raw`, `/404.html?url=x`, `/404.html?direct`, `/x/../404.HTML?raw`, `/404.html?raw&import`, `/no-such-page/`: 404, `no-store`, no validators, the page (2691 B); `/about/`, `/assets/garden-BGHvg63C.js` (immutable year), `/robots.txt`, `/sitemap.xml`, `/worlds/?world=archipelago` and `/lab/?world=archipelago` (each "Four islands") 200 with both validators; `/worlds/world/archipelago/` 308 to `/worlds/?world=archipelago`; `/api/public/status` 200 and `/api/no-such` 404, each the stub's JSON | 47.23 / 38.90 / 44.77 |

No test timed out. `deploy/Caddyfile` did not change in this round.

- **Not claimed:** the live host and production's Caddy 2.10 itself; engines other than Chrome; that the page
  reads well to a screen reader (axe and the keyboard walk pass, nothing more).

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
404, see criterion 5; 18 October 2026: locally they now answer the site's own page with 404, criterion 6, and the
live host's answer still needs the live host); canonical URLs and the sitemap at the live domain. The local half of mobile and keyboard
access and missing-GPU behaviour is done (criterion 5: 375 px emulated, Chrome's keyboard, Chrome with
`--disable-gpu`); real phones and tablets, screen readers and other engines remain.
