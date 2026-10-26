# Site image gate review — 26 October 2026

Base: `4730417a66cd4d67e40c1b4d88969f61391f57ae` (PR84 merge). Branch: `codex/site-image-gate`. [Plan](site-image-gate-2026-10-26.md) · [HTML decisions](backlog-workflow-2026-10-25.html).

## Model and scope evidence

Direct Claude CLI used `--model claude-sonnet-5-5 --effort high` for the plan, implementation and independent adversarial review. Result metadata confirms Sonnet 5.5; implementation also used a Fable helper. Codex plan/Standards/Spec/repair reviews used Sol 6.1 High, read-only.

- Sonnet plan: `0dcbef99-414d-4096-83ae-e8e2cd8f776f`.
- Implementation: `fa654207-f561-4112-9a71-086b5e8ac811`.
- Independent adversarial/repair: `3f3f66e3-44a0-4d2a-a33e-9f1e7efddd2d`.

Existing private `ci-deploy` content was not copied, pushed or modified. No product/physics/coordinator/scientific behavior or release safeguards changed. This branch adds a secret-free verification workflow, tests and documentation.

## Plan review

Both reviewers identified that mounting a host build into container Caddy verifies the binary, not the packaged artifact. Replaced the wrapper proposal with a dedicated image smoke suite using the default image command, embedded configuration and `/srv`, on a labelled isolated bridge with a synthetic coordinator. Extracted-image Caddy supplies the existing native matrix. No shell wrapper or launcher framework was added.

Other accepted gates: complete HTTP error/cache contracts, owned/bounded cleanup with cancellation fallback, required dependencies/image IDs, default-startup proof and readiness tied to this invocation. The native fixture now checks a unique sentinel and process liveness.

## Implementation findings and dispositions

| Finding | Disposition |
| --- | --- |
| Sol Standards/Spec and Sonnet P2: generic Docker failure treated as absence | Helper requires successful invocation-labelled enumeration; workflow preserves all query/removal/postcheck statuses. Failed verification retains scratch and fails the check. Both Sol repair reviews clear. |
| Failure diagnostics were deleted | Container logs print before cleanup; workflow failure reports print before scratch deletion. |
| Packaged-file canary alone misses HTTP sensitivity | Added a separate image without `/srv/assets`, which must fail its named HTTP-asset assertion. Generic startup or prerequisite errors do not satisfy either canary. |
| Forged chain ended in an address not in the forbidden set | Changed the end to a distinct documentation IP included in the forbidden values. |
| Cleanup overclaimed cancellation/local termination | README documents normal hooks, CI always-run cleanup, forced-termination limits and exact invocation-label manual cleanup. Images remain on the disposable hosted runner for inspection. |
| Base image tags are mutable | Production Dockerfile is unchanged. Tests require the captured immutable built-image ID; base digest logging is best-effort and described as such. |
| Docker prerequisite followed dependency installation | Moved it before installation. |
| Shellcheck status masking/word splitting | Fixed; actionlint passes. |

## Local execution evidence

- Merged baseline:39 tests pass in deployment-config/site-build.
- Final focused three suites:41 pass, 12 actual-image tests skip. No real container proof is inferred from this local run.
- Missing required image and a named tag (`latest`) each exit 1 with the intended image-identity failure. Normal unset-image testing does not contact Docker.
- Exact workflow cleanup script fault injection: confirmed empty lists=>exit 0 and scratch removed; failed Docker enumeration=>exit 1 and scratch retained; survivor=>exit 1 and scratch retained.
- Helper fault injection: startup fails and removal/query calls fail; cleanup failure is observable and scratch retained (exit 1).
- Root `pnpm typecheck`, standalone Node typecheck of both changed tooling tests, and actionlint pass. The site-build suite builds the current lab in a scratch directory.

Implementation-author native-only exploratory image-assertion probes are not actual-image evidence and are not used to clear the hosted gate. The hosted acceptance gate requires the real production image, all 53 declared tests without skips, and both artifact canaries on Linux before readiness; the first run below satisfies it.

## Remaining boundary

The actual-image CI job passed (record below). Traefik/TLS, live-host networks, production deployment and the real coordinator release image remain separate checks. This gate uses a synthetic coordinator, not a Compose deployment or scientific trial.

## Final precommit failure-path repairs

The mandatory read-only Sol CLI review found two more P2s: a canary could include a hook/runtime failure in addition to its intended assertion, and native Caddy teardown could silently continue after its five-second wait.

- Canary CLI status must now be exactly1. JSON still pins the named content assertion; additional JUnit output is required to contain exactly one failure and zero errors. Vitest5 JSON omits unhandled runtime errors and may omit nested-hook failures; the installed JUnit reporter explicitly includes both. No custom reporter/dependency was added. Local reporter probes prove the JUnit validator accepts an assertion-only failure and rejects the same failure plus a nested-hook error or an unhandled rejection (validator statuses 0/1/1, while all three Vitest processes exit 1).
- Native Caddy teardown now escalates TERM to KILL, confirms exit within a second bounded wait, and fails instead of deleting configuration if termination remains unconfirmed. A temporary stand-in that ignores TERM fails startup and is forcibly stopped; the probe confirms its PID no longer exists. The real native five-test suite passes again.

Workflow lint and standalone tooling typecheck remain clear. Sonnet 5.5 High and Sol 6.1 High repair verification both clear these changes with no outstanding source-review blockers. At this precommit phase, actual image/canary proof was pending; the hosted acceptance record below now clears that gate. The pre-existing deployment-config native teardown remains unchanged; the hardened TERM/KILL/confirmed-exit path applies to the modified site-build fixture.

## Hosted acceptance evidence

[PR89](https://github.com/treetopdevs/browser-life/pull/89) publishes source `e25bfc7b8bc3bdafbcfed086b2cd81d41dd4f6a0`. [Linux Actions run 40274844856](https://github.com/treetopdevs/browser-life/actions/runs/40274844856) passed all steps on 26 October, completed05:33:51UTC. Checkout tested GitHub's PR merge tree `b42ce4ace26424318c63d20901a79300c38955cd`, source head above merged into main `4730417a66cd4d67e40c1b4d88969f61391f57ae`.

- Built site image: `sha256:81b44d68930eeaf80bf7964f086050dce2f17d04f2398d1071e6bc0bba4957bf`.
- Extracted Caddy reports2.10.2. Three primary suites: **53 passed, zero skipped; 12 against the started packaged image**.
- Missing-lab canary failed exactly the named packaged-lab assertion; missing-assets canary failed exactly the named HTTP-assets assertion (404 instead of200). Both JUnit checks confirmed exactly one expected assertion failure and no hook/runtime errors.
- Owned-container/network cleanup and final empty-state checks passed. This demonstrates ordinary cleanup, not a forced platform termination test.
- The job logged warnings because named base images were absent from the local Docker image store, so the best-effort RepoDigests calls could not read them. BuildKit's resolved inputs were nevertheless recorded in its actual build log: Node `sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914` and Caddy `sha256:4c6e91c6ed0e2fa03efd5b44747b625fec79bc9cd06ac5235a779726618e530d`.
- `docker cp` warned that the host filesystem ignored the Caddy binary's capability xattr. Native tests bind unprivileged ports and passed; the actual container's port80 startup also passed. No extra host privileges were granted.

All source/repair reviews are clear. The evidence follow-up changes only documentation; implementation/tests remain identical to the tested source head. Current PR readiness and checks are available on PR89. No production deployment occurred; the real coordinator image, populated-allowlist container startup, Traefik/TLS and live-host checks remain outside this gate.

## Hosted review autofix

CodeRabbit reviewed source through `61f7a73f` and posted two minor documentation findings, both verified against the current README and repaired:

- [Forwarded-protocol wording](https://github.com/treetopdevs/browser-life/pull/89#discussion_r4374288590): the probe uses HTTP and asserts `X-Forwarded-Proto: https`; it does not establish TLS transport. README now says so explicitly.
- [Stale hosted-run status](https://github.com/treetopdevs/browser-life/pull/89#discussion_r4374288591): replaced the pending-run claim with the completed53-test/two-canary/cleanup result and a link to the exact review evidence.

The latest completed [run 40275386264](https://github.com/treetopdevs/browser-life/actions/runs/40275386264) at `61f7a73f5d5723a4eb32f3e5eee98caf52cf5b03` independently repeated all 53 passes and both canary validations. These follow-up corrections change documentation only.
