# Public site plan

## Decision record

- The public site's `/` is an introduction. The simulation moves from the Vite root to `/lab/` without changing its controls or state format.
- The Vite app is a static, multi-page site. Its pages are `/`, `/lab/`, `/how-it-works/`, `/research/`, `/about/`, `/privacy/`, `/participate/`, and `/status/`. `/selftest.html` remains a diagnostic and `/island.html` remains the volunteer runner.
- A deployment serves this built site at the domain root and forwards `/api/*` to the Phoenix coordinator over the same HTTPS origin. This avoids a baked-in domain or public CORS wildcard. Local development still uses Vite on 5173 and Phoenix on 4000 by default; the Vite proxy honors `PORT`.
- `/api/public/status` is a deliberately small aggregate for the public status page. `/api/status` remains the detailed operations feed and requires administrator authentication in production. The operations dashboard can accept an administrator token in its tab for that feed.
- The island runner never starts from the homepage or the participation page. A visitor must open `/island.html` and press Join. The runner uses the current origin, with `/api/*` forwarded by the local or deployed proxy.
- The research page describes documented results at their actual scope. A passing M3 gate and a frozen calibration threshold do not assert that open-ended evolution has been demonstrated. Unfinished ensemble results are labelled pending.
- Privacy copy describes implemented storage and transmission. The only analytics is the project's self-hosted Plausible Community Edition, installed from npm so it ships in the site's own files (no third-party script, no cookies; pageviews with time on page and scroll depth, plus lab events for planting, play and pause, saving, downloading, restoring and opening a world, tagged only with the starting world's catalogue id or "imported"; links are sent without their query beyond source keys); no email collection is added. No Terms page is invented without a legal owner or product terms to state. The diagnostic and runner pages carry `noindex`; informational pages are crawlable.
- `cadence.garden` is the public origin. The existing DigitalOcean droplet hosts Dokploy's Traefik; `compose.dokploy.yaml` and `deploy/compose.traefik.yaml` describe the two-service deployment and HTTPS routing. Credentials remain outside this repository. See `deploy/README.md` for release and rollback steps.

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
- Check every public route, metadata, mobile/keyboard access, missing-GPU behavior, 404s, and the live status API. Confirm the canonical URLs and sitemap resolve at the live domain.

### Release checks progress — 17 October 2026

Worked through locally without deploying; each check and how it was verified is in
`docs/release-checks-2026-10-18.md`, and the proxy and CORS notes are in `deploy/README.md`.
`[x]` is done; `[~]` is done locally with a part that **needs the live host**; `[ ]` is open.

- [~] Site at `/`, `/api/*` to Phoenix: already so in `deploy/Caddyfile` (read, not changed). HTTPS and the island runner over HTTPS: **needs the live host**.
- [x] Production secrets: `BL_ADMIN_TOKEN` and `SECRET_KEY_BASE` required at boot (each tested by reading `runtime.exs` as a release does). Durable storage: named volumes, unchanged.
- [x] Narrow CORS: production allows no cross-origin caller by default and refuses anything but whole https origins (tested). Same-origin in production, so `BL_CORS_ORIGINS` stays unset.
- [ ] Trusted proxy: **needs the live host and a Caddy change**. Through Traefik → Caddy every visitor is expected to count as one address; the fix is written up in `deploy/README.md`, and the join budget per address stays off in production until it lands.
- [~] `/index.html` is not an unauthenticated dashboard: the coordinator's operations page holds no data and asks for the admin token; Caddy does not forward it. Confirming `https://cadence.garden/index.html` is the homepage: **needs the live host**.
- [~] Join load limits and abuse controls, locally (tested): per-island budgets on `next` and the segment routes, at most 4 pending assignments per island, 16 KB JSON-only join/next bodies, a bounded island table that forgets idle islands first, a coalesced public status cache. The join budget per address is built and tested but off in production until the trusted-proxy row. Against the chosen host: **needs the live host**.
- [~] Public status audit: only `counts`, `activeIslands`, `deviceTypes`, `updatedAt`, with no island id, adapter, user agent or experiment name; the detailed status, experiment and discovery status routes answer 401 without the admin token, including from loopback (tested; the gating already existed, the slice adds the test). From the public network: **needs the live host**.
- [~] Public routes, canonical links, `og:url`, robots.txt and sitemap: checked against the dev server and a fresh production build (`tests/e2e/public-routes.spec.ts`). Keyboard access, 375 px layout and missing-GPU behaviour are checked locally in Chrome (`tests/e2e/public-a11y.spec.ts`, PR #36). An unknown path answers 404 with the site's own page (`apps/lab/404.html` and a `handle_errors` block in `deploy/Caddyfile`), checked on the dev server, under `vite preview` and against a local Caddy (v2.11.7, not production's 2.10) running a copy of the real Caddyfile with only its listen address, upstream and root changed (`tests/e2e/public-not-found.spec.ts`, slice 19; not deployed). Caddy 2.10 itself is unchecked. The live 404, the live status API, the canonical URLs and sitemap at the live domain, and real phones and tablets: **need the live host** (refreshed 18 October 2026).

## Creative direction refresh — 4 October 2026

The public site now leads with an open artificial-life playground: surprising bodies and behaviors,
bolder combinations of environmental levers, breeding toward visible traits, and the longer-term
possibility of games and persistent shared worlds. The tenfold trait increase is a search ambition,
not a measured outcome. Field notes retain the earlier results and distinguish observations from tests.

Checked jj in the primary repository: `sandbox/wild` at `a3c35639` describes storm presets and the
breeder in a separate, unlanded development workspace. The site changes here are based on main
`03e5ff6` in the isolated Git worktree; they do not import that sandbox's simulation code. Storm and
breeder copy is labelled sandbox; AI naturalist, visitor selection and shared-garden copy is aspirational.
The homepage image remains the existing real simulation capture, not an illustration of those features.

The shared visual style uses warmer field-notebook typography, ink chrome, life green for living things, amber annotations, an uncropped
simulation image and numbered experiment directions. All informational pages retain theme switching,
keyboard navigation and static content without WebGPU. Participation now offers exploration and
observation sharing before explaining the existing explicit-opt-in compute runner.

## Sandbox features in the lab — 5 October 2026

This branch merges the sandbox stack, so the storm and breeder presets ship in the lab as sandbox presets
(not registered), and visitors can pick a cycle's donor ponds by hand. The homepage, about and field-notes
copy now says so; the AI naturalist and the shared garden remain aspirational.
