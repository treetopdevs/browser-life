# Coordinator image gate: hosted evidence (30 October 2026)

PR [#124](https://github.com/treetopdevs/browser-life/pull/124), source `0420c208`. Hosted run [41091103109](https://github.com/treetopdevs/browser-life/actions/runs/41091103109) on `ubuntu-24.04` (amd64).

- **Image:** built from `Dockerfile.coordinator` and tested by ID `sha256:4d270a82e89f20487dc8070081c1c0595bef1ffe37d92ff4c1629f8729e66be0`.
- **Gate:** 27 of 27 tests passed. `verify-image-gate.mjs gate` reported `27 passed, 13 against the started image`, with nothing skipped.
- **Canaries:** both exited 1 and passed `verify-image-gate.mjs canary`.
  - Validator cache removed: only "validator runs from the image's cache" failed.
  - Root user: only "runs as the unprivileged coordinator user" failed (`container user must not be root`).
- **Join-token control** (printed, not asserted): with `BL_DISCOVERY_JOIN_TOKEN` unset, an unauthenticated join from inside the container got 401 via `127.0.0.1` and 200 via `[::1]`. This matches the local arm64 run. The runtime refusal is draft PR [#125](https://github.com/treetopdevs/browser-life/pull/125).
- **Cleanup:** the always-run cleanup step succeeded, and nothing labelled for the run was left behind.
- **Secrets:** the three synthetic secrets were masked (`***`) in the log.

The site-image gate passed on the same head.

**Not covered:** live-host deployment and Traefik topology. Those remain external checks, as for the site image.
