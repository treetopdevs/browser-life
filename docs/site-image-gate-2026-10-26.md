# Site image verification gate — 26 October 2026

Base: `4730417a66cd4d67e40c1b4d88969f61391f57ae`, the merge of PR84. New worktree: `site-image-gate`; branch `codex/site-image-gate`.

## Problem and chosen slice

PR84's production-line native Caddy checks passed, but the actual Alpine image was not built/run and no hosted test workflow existed. Close that explicit backlog gap with a repeatable Linux image verification command and a GitHub Actions job, without deploying or changing scientific/product behavior.

## Initial proposal (superseded by the revised design below)

1. Review this plan with Claude Sonnet 5.5 High and read-only Codex Sol 6.1 High.
2. Add a narrowly scoped Linux script that builds Dockerfile.site with a unique local image ID (no registry push), verifies that the image embeds the exact Caddyfile, has public/lab assets and omits garden files, then runs the existing deployment-config and site-build tests with that image's Caddy. A small generated wrapper exposes caddy-compatible argv/stdin to the existing tests. Linux host networking lets container Caddy reach the tests' loopback synthetic upstreams. Bind-mount only a dedicated scratch root read-only; pass only the synthetic proxy trust setting. Track container IDs and clean up only this invocation's containers and scratch files, preserving the caller's exit status.
3. Add a GitHub Actions workflow on pull_request, main pushes and workflow_dispatch. Use read-only contents permission, persist-credentials false, immutable checkout/setup-node action commits, Node22 and pnpm10.14.0 to match Dockerfile.site, explicit job timeout and concurrency cancellation. No secret/deployment permissions or image publishing. Require tools so unavailable Docker/Compose/Caddy cannot produce a skipped green gate.
4. Add meaningful launcher behavior tests with fake Docker/pnpm to prove fail-closed prerequisites, image selection, argv/stdin/environment forwarding, failure propagation and cleanup scope. These prove launcher mechanics, not a real container. Reuse actual native-Caddy tests locally. Use GitHub's Linux runner for real Docker-image evidence: publish a draft PR, inspect the job and autofix failures before marking ready.
5. Update deploy/README.md and the existing HTML decision log (continue IDs after D8); record PR84 merge evidence and the new plan, reviews, exact checks and remaining live-host boundary. Keep previous evidence historical.

## Scope and gates

No changes to simulation, physics/hash pins, preregistration, coordinator logic, public opening or live deployment. The actual-image gate is not evidence of Traefik topology or a production release. Actions is enabled for this repository (checked via API). This macOS host's Docker daemon is unavailable; do not run Docker info/ps commands that hang. CI-only code calls for focused launcher/config/site tests and type/build checks, not another unchanged 3,791-test physics run. Native prior evidence and new hosted evidence remain distinct.

## Phase review and revised design

Both Sonnet and Sol identified the same P1: mounting a host build into container Caddy proves the binary, not the packaged site. Adopt the smaller design: build the image once with --iidfile, extract its Caddy binary for existing native forwarding fixtures, and add a dedicated actual-image Vitest smoke suite. Run the real site with its default entrypoint/config/content and a synthetic coordinator on a labelled isolated Docker bridge; publish only an ephemeral loopback port. Verify packaged public/lab pages and linked assets, redirects, full uncached 404 semantics (including conditional/range requests), garden privacy, health rewrite and API status preservation. Native binary tests retain the spoofing matrix. No generated Docker wrapper or launcher script is needed.

Track containers/network by invocation ID/labels before startup, with bounded cleanup and a final workflow cleanup step on cancellation; remove only owned resources. Enforce immutable image IDs, required-image and required-Caddy/Compose flags, and log base-image identities. Local no-daemon checks prove code/config and native fixtures only. Hosted actual-image execution is the acceptance gate; a disposable image with a deliberately broken packaged asset must fail to establish the gate is sensitive to the artifact.

Use current official action releases verified via GitHub API (26 October): checkout v7.0.1 at 3d3c42e5aac5ba805825da76410c181273ba90b1; setup-node v7.1.0 at 949feb2413d6458794dcd2491c4babbbce0c15c1. Both action runtimes use Node24, while the build/test Node remains22, matching Dockerfile.site.

The existing local ci-deploy bookmark stays untouched and unpublished. This public workflow contains only the described verification job; it neither copies nor alters deployment workflows, credentials or unpublished research artifacts. The user authorizes continuing the commit/PR workflow for this slice.

## Implementation and local verification

The revised design is implemented in `.github/workflows/site-image.yml`, `tools/test/site-image.test.ts` and the existing site-build fixture. README and the running HTML log describe the new gate. Two canaries are now required: missing packaged lab page and missing served assets, each with a named failure rather than a generic crash.

Independent source reviews found one cleanup P2 shared by the test helper and workflow: a failed Docker inspection/listing could masquerade as absence. Both now require successful enumeration, preserve query/removal failures, and retain scratch data if cleanup is unverified. Docker logs are printed before container removal; failure JSON reports print before scratch cleanup. A distinct documentation IP closes the end-of-chain spoof assertion gap. Forced local termination and platform cancellation limits are documented rather than described as guaranteed cleanup.

Local gates: 41 tests pass and 12 actual-image cases skip because no image/daemon is available; this is native/configuration proof only. Required-image refusal tests reject unset image IDs and tags. Exact workflow-script fault probes return0 only for confirmed empty state, return1 for daemon failure or survivors, and retain scratch on uncertainty. A fake-Docker module startup/cleanup-failure probe confirms the helper failure remains observable. Root/tooling typechecks and actionlint pass. Actual-image and canary execution are the hosted acceptance gate; the first job passed all53 tests without skips and both expected failures.

Final Codex CLI review added two failure-path requirements: exact expected canary exit status with JUnit rejecting extra hook/runtime errors, and forced native process termination with confirmed exit. Both are implemented and fault-probed. Plan status: source and final repair reviews clear; local checks complete. Complete and published as [PR89](https://github.com/treetopdevs/browser-life/pull/89). The [first Linux job](https://github.com/treetopdevs/browser-life/actions/runs/40274844856) passed the actual-image/default-startup tests and both canaries; exact source/image IDs and warnings are in the [review record](site-image-gate-review-2026-10-26.md). The revised design supersedes the initial wrapper/launcher proposal.
