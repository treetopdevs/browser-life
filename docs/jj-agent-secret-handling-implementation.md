# Agent secret handling implementation evidence

Date: 2026-10-04. Implementation workspace: `/Users/nicholas/develop/browser-life-agent-secrets`, JJ workspace `agent-secrets`, parent `03e5ff646a086e886bf1128f964f07f9b1a49292`.

The repository-local fake prototype is implemented under `tools/agent-capabilities/`, with dedicated tests and Node tooling typechecks. The original architecture plan and architecture-review findings remain preserved. No real credentials were accessed, provider calls made, remote branches published, live PRs created, deployments started, main moved or changes pushed.

## What is proven

- Validated exact operation/task/request metadata, deny-by-default authorization, provider scope and expiry, task-bound inherited operation channels, single dispatch, expiry at boundary, cancellation and both revocation/dispatch outcomes.
- Private fsync-backed single-writer audit outside checkouts; safe metadata with separate authorization/recovery correlation; malformed, truncated, orphan and inconsistent replay evidence rejected. Restart invalidates old leases and records unmatched dispatches as uncertain.
- Fixed-host draft PR adapter exercised through fake HTTP. URL/header/operation injection denied, redirects and oversized/invalid responses rejected, sentinel-bearing provider errors sanitized, no POST retries. Provider credentials resolve only after channel/request authorization.
- Two subprocesses in distinct staged trees: alpha creates exactly one fake draft, beta cannot use alpha's lease, and repeat dispatch is denied. Maximum escaped payload travels over actual inherited pipes. Inherited credential environment is cleared; argv carries no credential. Generated runtime/staged files, journal and captured outputs contain no random sentinel; copied runtime digest is recorded and checked unchanged.
- Fresh single-use service-only recovery grants survive original task cancellation/expiry, preserve approval/grant/request correlation, traverse all-state pagination including closed PRs, and never revive write authority. Empty reads while a write remains in flight do not unblock replacement.
- Real child-process crash injection before submission, after acceptance and during completion persistence; unmatched durable commitments block replacements in all three cases. Temporary fixture locks are cleared only after the child is confirmed terminated, simulating explicit operator repair.

Phase 1 and Phase 2 Sol 6.1 High read-only review gates passed after repairs. Phase 1 repaired unused-lease expiry, denial attribution, revocation-race evidence and replay consistency. Phase 2 repaired disconnect handling, bounded response backpressure, distinct recovery correlation and maximum-payload framing. A final review covers subsequent crash/rejection/path tests and the complete handoff.

Initial full repository verification: 77 files, 1,879 tests passed. Dedicated tooling and root typechecks passed. Targeted verification at this revision: 59 tests passed. Final verification results are recorded below after review.

A persisted local harness run lives outside checkouts at `/Users/nicholas/.local/state/browser-life-agent-capabilities/prototype-20261004-final/`; those files are synthetic metadata, not credential storage. See the tooling README for repeatable build/harness commands. The fixture task source revision is explicitly synthetic; no claim is made that its staged trees are actual JJ workspaces or production agents.

## Gates that remain blocked

Strong host isolation is unverified. The Docker CLI exists but its daemon socket is absent; no daemon was started. The macOS `sandbox-exec` Node probe exited 134 and did not demonstrate usable containment. No live host resolver or HTTP transport is supplied. The current processes share an unrestricted OS identity: process memory, host keychain/helpers, sibling channels, outbound-route restrictions, diagnostic/core/crash-dump controls and enforced immutable runtime pinning have not been independently proven. These are required before live credentials. This is the plan's explicit stop condition, not a claim that JJ or green fake tests establish isolation.

Leakage checks cover the owned synthetic fixture/runtime/journal/output surfaces. They do not scan the entire host's unified logs, shared caches, historical JJ objects or unrelated temporary files, and cannot prove safety against arbitrary malicious code. No random credential material is written to a workspace or scan argument; failure checks compare booleans rather than printing sentinels.

A live trial remains separately authorized work: select one test repository and prepared operator-controlled reviewed branch, validate actual GitHub App scope/draft support, implement and verify the restricted runtime and dump controls, provide a trusted host credential facility and bounded live transport, re-review, then approve one exact draft request. Only a live PR created under that authorization would be attached to the Codex task. No automatic cleanup, deployment or branch-publication capability exists.

## Final local verification

The final dedicated capability run passed 59 tests across six files. Tooling and root TypeScript checks passed. The last broad Vitest run passed 1,886 tests and failed one unchanged wall-clock test at `tools/test/hunt1-ops.test.ts:730`: it tests a deadline only one second ahead while invoking real subprocesses; the test took about 13 seconds during that run. Its isolated rerun passed (one test, 160 skipped). That source file was not modified. The earlier full run passed all 1,879 tests. Two late audit/runtime regression tests were added after the broad run began and passed in the final targeted run. The broad failure is reported rather than represented as a clean final full-suite pass.

The final copied-runtime harness produced one fake PR, denied the other task and reuse, found no random sentinel in owned artifacts/outputs, and verified the path/content runtime digest unchanged. Evidence: `/Users/nicholas/.local/state/browser-life-agent-capabilities/prototype-20261004-final/evidence.json`. The temporary dependency symlink used to reuse installed public dependencies has been removed from the working tree and JJ diff.

Final Sol 6.1 High read-only review passed for the fake-only integration handoff: no outstanding actionable findings, 24 scoped files, dependency symlink excluded, unchanged hunt test, and broad-suite limitations accurately recorded. Integration is prepared on local JJ bookmark `codex/agent-secrets`; main remains at `03e5ff646a086e886bf1128f964f07f9b1a49292`. Merge/push and the live trial remain separate steps.
