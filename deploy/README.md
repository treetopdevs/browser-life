# cadence.garden deployment

The public site is built from `Dockerfile.site` and served by Caddy. Caddy sends `/api/*` to the Phoenix coordinator on the private Compose network. The droplet's existing Dokploy Traefik terminates HTTPS and routes `cadence.garden` to the `site` service on port 80. The coordinator has no public port. The `/healthz` route checks that the coordinator responds.

## Dokploy UI deployment

1. Create a Docker Compose application from this repository. Use `compose.dokploy.yaml` as its Compose path and the repository root as the build context.
2. Set `SECRET_KEY_BASE` to a newly generated value of at least 64 random bytes and `BL_ADMIN_TOKEN` to a separate random value. Keep both in Dokploy's environment settings, never in Git. The coordinator refuses to start without them.
3. Add a domain for service `site`, port `80`, host `cadence.garden`, HTTPS with a managed certificate. Deploy, then confirm both containers respond before changing DNS. Do not use `deploy/compose.traefik.yaml` when Dokploy manages the domain in its UI.
4. In Namecheap Advanced DNS, replace the parking records with `@ A <droplet IPv4>` and `www CNAME cadence.garden` (or redirect `www` to the apex). Preserve any other records that may have been added since this plan was written. The Namecheap API `setHosts` operation replaces the complete host list.

## Host deployment with Dokploy's Traefik

If the Dokploy UI/API is unavailable, the same images can run as a separate Compose project on the droplet using `compose.dokploy.yaml` plus `deploy/compose.traefik.yaml`. The override connects only the site to Dokploy's attachable `dokploy-network` and gives Traefik the same HTTPS and `www` routing labels it uses for existing applications. This project is managed with Docker Compose on the host and will not appear in the Dokploy UI. Keep its source, `.env`, and volume together under `/opt/browser-life`; permissions on `.env` must be owner-only. Set `BL_IMAGE_TAG` to the deployed Git commit and use `docker compose --env-file .env -f compose.dokploy.yaml -f deploy/compose.traefik.yaml up -d --no-build` after loading the matching images.

## Release checks

- `https://cadence.garden/` shows the public homepage and links to About, How it works, Research, Privacy, Participate, Status, and Lab.
- `https://cadence.garden/api/public/status` and `/healthz` return HTTP 200. `/api/status` remains protected by the coordinator's existing access control.
- The Lab joins the coordinator through same-origin `/api` without browser CORS errors. Verify on desktop and a mobile browser before inviting participants.
- Check the HTTPS certificate, redirects, `robots.txt`, and one completed island session.

The named `coordinator_data` volume contains the queue and checkpoints, and `discovery_data` (mounted at `/data-discovery`, set by `BL_DISCOVERY_DATA_DIR`) holds the discovery plane's research state. That directory needs writable, persistent storage separate from `BL_DATA_DIR`: the coordinator refuses to start when it lies inside `BL_DATA_DIR` or cannot be created, and an unwritable one fails at the first write. The image ships no Deno or `tools/` tree, so the deployed plane has no validator and accepts no discovery results, and with `BL_DISCOVERY_JOIN_TOKEN` unset it admits loopback workers only. Back up both volumes before every deployment that changes data formats and include it in the droplet backup policy. For rollback, redeploy the previous Git revision in Dokploy or select the previous image tag in the host Compose project; restore the matching volume snapshot if the data format changed. Do not destroy the volume when recreating the Compose app.
