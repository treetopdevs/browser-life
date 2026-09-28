# Public site plan

## Decision record

- The public site's `/` is an introduction. The simulation moves from the Vite root to `/lab/` without changing its controls or state format.
- The Vite app is a static, multi-page site. Its pages are `/`, `/lab/`, `/how-it-works/`, `/research/`, `/about/`, `/privacy/`, `/participate/`, and `/status/`. `/selftest.html` remains a diagnostic and `/island.html` remains the volunteer runner.
- A deployment serves this built site at the domain root and forwards `/api/*` to the Phoenix coordinator over the same HTTPS origin. This avoids a baked-in domain or public CORS wildcard. Local development still uses Vite on 5173 and Phoenix on 4000 by default; the Vite proxy honors `PORT`.
- `/api/public/status` is a deliberately small aggregate for the public status page. `/api/status` remains the detailed operations feed and requires administrator authentication in production. The operations dashboard can accept an administrator token in its tab for that feed.
- The island runner never starts from the homepage or the participation page. A visitor must open `/island.html` and press Join. The runner uses the current origin, with `/api/*` forwarded by the local or deployed proxy.
- The research page describes documented results at their actual scope. A passing M3 gate and a frozen calibration threshold do not assert that open-ended evolution has been demonstrated. Unfinished ensemble results are labelled pending.
- Privacy copy describes implemented storage and transmission. No analytics or email collection is added. No Terms page is invented without a legal owner or product terms to state. The diagnostic and runner pages carry `noindex`; informational pages are crawlable.
- Because no domain, hosting target, or deploy credentials are configured in this repository, deployment, DNS, certificates, and live-origin checks are a separate release step. Do not call the local build a live launch.

## Implementation

1. Build a reusable visual language for the informational pages with static semantic HTML, shared CSS, keyboard focus, responsive layouts, and readable no-GPU content.
2. Move the lab to `/lab/`; update Vite's multi-page build, navigation, metadata, and documentation.
3. Publish the methods and research status with links to the rules, pre-registration, and reproducible source, plus privacy and participation explanations.
4. Add a public aggregate status endpoint and restrict detailed status in production. Connect the public status page with explicit loading, offline, and unavailable states.
5. Replace the volunteer runner's public localhost default. Preserve explicit opt-in and stopping behavior.
6. Check static routes and links in dev and preview, run typecheck/build and existing tests, inspect the exact diff, and commit the jj change.

## Release checks after a host is chosen

- Set the site at `/` and forward `/api/*` to Phoenix; verify the lab and island runner work through HTTPS, since WebGPU requires a secure context.
- Configure production secrets, durable coordinator data storage, a trusted proxy, and a narrow CORS allowlist if origins differ. Do not expose `/index.html` as an unauthenticated operations dashboard.
- Test public join load limits and abuse controls against the chosen host before promoting volunteer participation broadly.
- Audit what the public status response exposes, and verify the detailed status endpoint rejects unauthenticated requests from the public network.
- Check every public route, metadata, mobile/keyboard access, missing-GPU behavior, 404s, and the live status API. Add canonical URLs and a sitemap when the actual domain is known.
