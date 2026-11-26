# Public-site follow-ups — 24 October 2026

## Scope and contract

Close two explicit follow-ups from the 18 October prototype snapshot: count missing pages under `/404`, and replace stale sitemap dates with evidenced page modification dates. No deployment or new analytics collection is introduced.

The rendered 404 document carries `data-analytics-page="404"` on its root. The existing analytics transform replaces only the event URL's pathname with `/404` when that marker is present. It retains the existing source-query allowlist, removes fragments and all other query keys, and leaves ordinary page paths unchanged. Referrers retain their existing query/fragment scrubbing; this is not a new referrer-policy change. The marker works for arbitrary missing URLs and direct `/404.html`, without guessing from the browser address or treating an ordinary route as missing.

The installed `@plausible-analytics/tracker` 0.4.6 declarations and implementation were read locally. `transformRequest` receives the event payload and can replace `u` or return null to drop it. Its pageview path saves the transformed URL for later engagement events. Automatic pageviews remain enabled and the default localhost/automation suppression remains unchanged. Unit tests capture the actual initialization callback; browser tests run the real tracker at a synthetic non-local origin, opt the test browser into its existing automation verifier flag, and intercept all requests. No analytics event is sent to the external service by those tests.

## Sitemap evidence

Dates are the calendar dates in the recorded Git committer timestamps (with their recorded offsets), not the date this maintenance is performed. Evidence was read at main `b3fab906`. Dynamic catalogue content is included for Worlds; this table records the source basis rather than pretending every page changed together.

| Route | lastmod | Source evidence |
| --- | --- | --- |
| `/` | 2026-10-18 | `4e83ae8f`, `apps/lab/index.html`, public accessibility changes |
| `/lab/` | 2026-10-22 | `3f656045`, `apps/lab/lab/index.html` and `src/main.ts`, Pond keeper v3 |
| `/worlds/` | 2026-10-22 | `3f656045`, `apps/lab/src/worlds.ts`, new weather worlds |
| `/how-it-works/` | 2026-10-16 | `4874b095`, page HTML, brand/content review |
| `/research/` | 2026-10-18 | `0d643be7`, page HTML, journal entries after the previous update |
| `/about/` | 2026-10-16 | `4874b095`, page HTML, brand/content review |
| `/participate/` | 2026-10-18 | `4e83ae8f`, page HTML, accessibility changes |
| `/status/` | 2026-10-16 | `4874b095`, page HTML, brand/content review |
| `/privacy/` | 2026-10-17 | `ec4f9e49`, page HTML, shared garden privacy disclosures |

These are source modification dates, not assertions about when changes reached production. No 404 URL is added to the sitemap and the missing page remains noindex.

## Validation

- Two focused analytics tests pass: missing-page identity, unchanged ordinary paths, attribution retention, private-query/fragment removal, invalid URL/referrer handling, and non-mutation of provider input.
- Typecheck and production build pass.
- All 8 Chrome analytics and public route/build checks pass on port 5197 with `BL_REQUIRE_BUILD_CHECK=1`: real tracker payloads for arbitrary missing paths, direct `/404.html` and normal `/worlds/`, plus sitemap/robots/canonical/noindex checks against dev and build artifacts. The direct `/404.html` test initially expected 200; corrected to the existing server contract of 404, without changing the app.
- `git diff --check` passes. Independent review remains pending; no public deployment.

## Adversarial review

Argon4 High source review found **NO BLOCKERS**. It confirmed the fixed404 event identity, unchanged ordinary-route/referrer behavior, intercepted test traffic and source-date claims. Its nonblocking note reiterates the existing scope: a later navigation from a missing page can retain that path as a same-origin referrer. This change does not alter referrer policy or claim otherwise.
