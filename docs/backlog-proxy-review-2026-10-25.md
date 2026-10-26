# Proxy readiness review — 25 October 2026

Base: `904a05a14aed83fb8c28f22014641dc8a8b902bb`. Branch: `codex/backlog-proxy-readiness`.
Scope and running decisions: [HTML workflow](backlog-workflow-2026-10-25.html).

## Requested model evidence

Direct Claude CLI used `--model claude-sonnet-5-5 --effort high` for planning, implementation and independent adversarial review. Result metadata confirmed `claude-sonnet-5-5`; planning also used a Fable helper internally. agy listed the requested model but returned RESOURCE_EXHAUSTED; Cursor required authentication. No alternative model was labelled as the requested adversarial reviewer.

- Plan session: `e0c7b27e-027e-48bb-aee9-2ad659e2bd3c`.
- Implementation: `c4d3f723-5541-4c4e-8fce-2b6e59588e0b` (four configuration/docs/test-fixture files; orchestrator owned other tests and HTML).
- Adversarial: `eaa6d939-2c6f-4969-8722-3f68a0c41e2d`.
- Sol 6.1 High read-only plan review and independent Standards/Spec reviews completed. Standards: no actionable findings; Spec: no findings, with final evidence record still to update.

## Plan findings and dispositions

| Finding | Resolution |
| --- | --- |
| No published port does not prove isolation | README states the trust assumptions, same-network/NET_RAW risks and separate Dokploy/host attachment checks; no live topology claim. |
| Installed Caddy 2.11 alone is insufficient | Downloaded official 2.10.2 binary and ran validation, synthetic forwarding and actual Phoenix checks with it. Alpine image remains a separate external gate. |
| A new global block breaks old fixtures | Both site-build and browser-not-found fixtures inject test options into the one existing block. |
| Headers alone do not prove visitor budgets | Added real Caddy → Phoenix/Queue/limiter release script; eight cases passed. |
| Short lease can reclaim healthy workers | Documented milliseconds, ten-minute default, 60-second heartbeat and 120-second retry headroom. |

## Sonnet adversarial findings and dispositions

Verdict: **no blockers**. Reviewer read source and relied on supplied execution results; it did not independently execute tests.

| Finding | Disposition |
| --- | --- |
| Medium: malformed proxy CIDRs stop the whole site | Fixed guidance: space-separated, not comma-separated; actual-file/image preflight command; explicit outage consequence. Validation test requires rejection. |
| Low/medium: tooling tests skip by default without dependencies | Explicit limitation. Release command uses `BL_REQUIRE_DEPLOY_TOOLS=1`; both tools present during recorded checks. |
| Low: alternate header test could imply stripping | Echo/assert their unchanged values; clarify only XFF selects the address. Phoenix currently ignores alternate headers; no speculative stripping added. |
| Low: odd-chain/duplicate coverage | Real Phoenix smoke already tests duplicate XFF fields. Expanded Caddy suite covers configured-but-untrusted peer and multi-CIDR parsing. Additional odd-chain probes considered during repair verification. |
| Low: static Compose cannot see Dokploy network injections | Explicit external runbook check; no local proof claimed. |
| Low: Deno cleanup may hang awaiting child output | Added a five-second force-kill timer per child after SIGTERM and scratch removal in an outer finally; real proxy smoke passed again. |
| Informational: forced HTTPS upstream header | Pre-existing behavior; unchanged. |

## Full-suite autofix

The first full run and isolated rerun reproduced two stale runner tests: expected only `/api/islands`, `/api/next`, but graceful leave also sends `/api/islands/isl`. Updated both mocks/assertions to require method/path, island query and bearer on DELETE, keeping all state fetch/execute paths forbidden. All 92 tests in the two files passed. The repository lockfile-protection test found that the earlier `tests/deno/island_leave.ts` started its coordinator without the shared Deno shim; added it without changing production code. Final smoke/review evidence follows below.

## Remaining external checks

No Docker daemon/image build or live host validation is claimed. Verify the actual Traefik chain, two real visitors, injected/duplicate headers, IPv6/NAT and container reachability before enabling a positive per-address join budget. Public garden release safeguards remain in force.

## Repair review

Sonnet and Sol independently caught assertions inside the new leave fetch stubs being swallowed by production cleanup. Moved query/bearer capture into the stub and the assertions after the rejected run, outside its catch. The 92-test rerun passed. Sonnet also requested pinning comma-separated CIDR rejection and explicit daemon/export requirements for the preflight; both added. Further final review checks the assertions are observable.

## Final review closure

Sonnet's final repair verdict: all three repair findings closed, no further findings. Sol's final inspection independently confirms the swallowed-assertion P2 resolved and no new findings. The new tooling test also passes a standalone Node TypeScript check (tools are outside the root typecheck); both Deno smoke scripts pass `deno check --no-lock`.

Checks continued after midnight on 26 October. `mix precommit` passed 575 tests plus compile/format, the real leave smoke passed, 35 deployment tests passed with required tools, and all ten Chrome route checks passed. The initial full unit run completed with 3779 passes, three stale leave checks and two CPU-heavy timeouts; the conservation suite passes separately. The final full rerun uses two workers to limit contention. No production or physics source changed to address these failures.
