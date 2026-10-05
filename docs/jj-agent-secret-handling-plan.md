# JJ agent secret handling: architecture and prototype plan

Date: 2026-10-04. Status: fake-only prototype implemented; host isolation unverified and live trial disabled. No real credentials accessed or external provider operations performed. See `jj-agent-secret-handling-implementation.md` for current evidence.

## Workspace and scope

Planning workspace: `/Users/nicholas/develop/browser-life-agent-secrets`, JJ name `agent-secrets`, based on local `main` at `03e5ff646a086e886bf1128f964f07f9b1a49292`. The default workspace has unrelated changes; existing research workspaces and running services are outside this workstream.

Continue implementation in this side workspace. Use a `codex/agent-secrets` bookmark when preparing a reviewed change for integration. Do not move `main`, push, or start deployment as part of this plan. JJ working-copy snapshots already enter repository history: secret prevention must happen before a write, not merely before an explicit commit. Ignored files are still workspace files and are not acceptable credential storage.

## Decision and first action

Use a **credential-holding proxy**. Agent processes receive operation access, never provider credentials. Ephemeral environment injection is simpler, but gives the recipient the credential and allows its code or descendants to write it to disk or send it elsewhere. That cannot enforce the established requirement. Keep it out of the first prototype.

First secret-bearing operation: **create one draft PR against a pre-existing, reviewed remote branch in a designated test repository**. A public dependency install has no demonstrated credential need in this checkout; preview deployment introduces hosting credentials and resource costs. PR creation gives a small, observable write with a narrow API contract. Branch publication is a separate capability and is excluded from v1; an operator prepares the test branch before the live trial. No PR will be created merely to complete planning or local tests.

The local prototype uses a fake provider and synthetic credentials. A later explicitly authorized live trial should prefer a GitHub App installation token restricted to one repository and required PR permissions. Its actual permission availability and draft support must be checked in the selected repository before the trial. Provider expiry is distinct from the shorter local lease expiry.

## Trust boundary

```text
Trusted launcher / operator -> policy + task registration -> lease broker
Agent in side JJ workspace -> authenticated operation channel -> proxy
Proxy -> credential resolver -> provider API
Broker / proxy -> sanitized audit journal outside all workspaces
```

The broker and proxy can be one small service initially, with separate internal interfaces for policy, credential resolution, audit and provider adaptation. Put it under `tools/agent-capabilities/`, with tests under `tools/test/agent-capabilities/`; avoid adding a simulation package or changing the four package alias maps. Add a dedicated TypeScript check for this Node tooling because the existing `pnpm typecheck` does not include `tools/`.

JJ workspaces separate working copies, but share repository storage and are **not a process security boundary**. Strong isolation requires agents to be unable to inspect proxy memory, its credential store, host keychain or sibling processes, or bypass the proxy using ambient host credentials. A same-user, unrestricted local process proves policy mechanics only. Before a live trial, run the agent in a restricted container/OS identity with only its workspace and operation channel exposed; do not mount the shared JJ store writable into an untrusted container. A trusted host launcher performs JJ operations, while the restricted agent receives a staged working tree. If this mounting model cannot support the intended workflow, stop and revise the isolation design rather than claiming JJ alone isolates secrets.

The proxy runs from a pinned reviewed build outside agent-writable paths; it must never import modules or execute scripts from an agent checkout. Its credential resolver uses a trusted host credential facility (the only permitted persistent secret store), not `.env`, `.npmrc`, Git remote URLs, shell history, CLI arguments or workspace config. Scope requests identify operations rather than supplying URLs, shell commands or authorization headers. Proxy/resolver processes must not persist tokens in caches, temporary files, logs, traces, exception reports or crash/core dumps. Disable diagnostic payload capture and dumps and validate this on the selected runtime; unsupported dump controls block live credentials. In production-mode isolation, clear inherited credentials and limit outbound networking; agents must not have host credential helpers or unrestricted keychain access.

## CapabilityLease contract

All fields below are metadata. No bearer value or credential material is serializable in this record.

| Field | Meaning |
| --- | --- |
| `leaseId`, `schemaVersion` | Unique opaque identity and versioned validated schema. |
| `agentId`, `taskId` | Launcher-issued identities, bound to authenticated channel; agent-supplied strings are not identity proof. |
| `workspaceId`, `sourceRevision` | Registered workspace identity and reviewed source snapshot; record JJ change identity plus immutable commit/tree digest. |
| `operation` | Closed enum; v1 only `github.createDraftPullRequest`. |
| `scope` | Exact provider/repository identity, base branch, prepared head branch and expected head SHA, approved title/body digest, `draft=true`, one dispatch commitment regardless of success, failure or uncertainty. |
| `credentialHandle` | Internal opaque lookup key, usable only by the resolver; never a secret, path or bearer token. Omit it from agent-facing views. |
| `issuedAt`, `expiresAt` | UTC timestamps; propose five minutes maximum initially, bounded by provider credential expiry. Use an injected clock in tests. |
| `status`, `revokedAt`, `revocationReason` | Explicit lifecycle state and sanitized revocation metadata. |
| `policyVersion`, `requestId`, `approvalId` | Policy/audit correlation and operator authorization for the precise operation. |

States: `issued -> dispatching -> succeeded | failed | uncertain`; `issued -> expired | revoked`. Once dispatched, a single-use lease cannot be reused. A lost provider response yields `uncertain`, never an automatic second creation. Reconcile through a narrowly scoped provider read and known repository/head/base; An empty provider read is not proof of no write while an original request may still finish. Read all matching PRs, including closed PRs and every page. Replacement requires positive evidence that submission never happened or a definitive provider rejection with no side effect; otherwise keep the attempt blocked for operator resolution. Disable all transport-level POST retries.

Trusted launcher registers tasks and obtains an authenticated per-task channel. Prefer an inherited IPC channel or supervisor-authenticated connection so lease IDs are not bearer credentials. An agent cannot issue or renew leases, select credential handles, grant permissions or revive revoked tasks. Cancellation/task termination revokes all unused leases and closes the channel. Broker restart invalidates all prior leases; replay the durable audit journal and classify every dispatch commitment without a terminal completion as uncertain, including crashes before submission or after acceptance. Block replacements for these attempts. Journal acknowledgement means an fsync-backed durable write; unreadable, truncated or inconsistent dispatch evidence blocks live operations pending operator repair.

## Operation and revocation semantics

1. Operator approves canonical request metadata for a named task. Broker validates maximum TTL, credential scope and policy before issuance.
2. Proxy authenticates the connection and validates the request against the stored lease, task registration and approved payload digest. Unknown fields, arbitrary URLs, cross-repository heads and unapproved operations are rejected.
3. Serialize revocation and dispatch per lease. Recheck expiry, task liveness, policy and provider credential expiry immediately before committing dispatch. Persist sanitized `dispatch_committed` evidence before any provider write; audit failure denies the operation.
4. Resolve the credential internally and execute only the allowlisted endpoint over TLS, with bounded timeouts, response size and no redirects. API host/path are proxy-controlled. Do not forward raw provider responses, headers or errors to the agent.
5. Return only validated PR identity, URL and a stable result/error code. Record completion; drop credential references after use. No claim of guaranteed memory zeroization in a managed runtime.

Revocation winning before dispatch prevents the request. Once dispatch has committed, revocation stops future uses and attempts cancellation but cannot guarantee undoing an in-flight provider write. Audit identifies this race explicitly; closing an already-created PR would require a separate authorized capability. Validate the remote head SHA immediately before dispatch, but document that concurrent branch mutation still leaves a check/write race; use an operator-controlled branch with writers excluded during the trial.

Internal provider reads are service-only authority, not extra agent operations: head validation permits only `GET /repos/{owner}/{repo}/git/ref/heads/{approvedHead}` within the creation dispatch flow; recovery permits only bounded `GET /repos/{owner}/{repo}/pulls` queries and validated PR identity reads for a recorded dispatch. Recovery requires a fresh operator-authorized, short-lived read-only recovery grant bound to that dispatch and task record. It may outlive the cancelled task but never restores its channel or write lease. Audit recovery grant issuance, read dispatch and result. Require PR read/write plus `Contents: read` for private-repository head validation; no Contents write permission. Arbitrary read endpoints remain forbidden.

## Audit events

Events: `task_registered`, `lease_issued`, `request_denied`, `lease_revoked`, `lease_expired`, `dispatch_committed`, `operation_succeeded`, `operation_failed`, `operation_uncertain`, `task_ended`, `broker_restarted`.

Each event carries schema version, event ID/sequence, time, agent/task/lease/request IDs, operation, canonical scope digest, policy version, safe reason code and optional validated provider object ID. Persist approved request metadata separately from credentials so uncertain writes can be reconciled after restart. Use an append-only journal outside every checkout, with restricted host permissions and a defined retention policy. This gives ordered evidence, not tamper-proof security against a host administrator. Audit never contains raw request/response bodies, arbitrary exception strings, environment dumps, credential values or handles. Fail closed if dispatch evidence cannot be persisted; if completion persistence fails after a provider write, retain the dispatch as uncertain and block retry.

## Implementation sequence and acceptance gates

### Phase 1: contracts and fake provider

Implement validated lease/request schemas, deny-by-default policy, injected clock, task registry, lifecycle transitions, provider/resolver interfaces and a structured audit sink. Document identity authentication and revocation linearization. No network and no real credentials.

Gate: tests prove wrong agent/task/workspace, wrong repo/head/base/payload, unknown operation, duplicate dispatch, expiry at the exact boundary, revoked/cancelled task, audit failure and stale leases after restart all deny dispatch. Concurrent revoke/dispatch tests establish both possible outcomes. Resolve credentials only after authorization passes. Run a Sol 6.1 High read-only phase review and resolve findings before continuing.

### Phase 2: operation proxy and local harness

Implement the one PR adapter, authenticated IPC transport, explicit safe responses and a trusted launcher harness. Start two named fake tasks in distinct side workspaces/staged trees; only one receives a lease. Keep launcher state, journal and proxy runtime outside checkouts. Synthetic sentinel credentials exist only in resolver/proxy memory.

Gate: granted task creates exactly one fake draft PR; other task cannot use its lease; direct credential resolution is inaccessible. Test URL/header injection, redirects, provider errors containing sentinels, excessive response sizes, cancellation, timeout after provider acceptance and restart reconciliation. Inject crashes before submission, after provider acceptance and during completion persistence; prove unmatched commitments are blocked. Test recovery grants after expiry/cancellation, all-state paginated PR matching, and empty reads while a write remains in flight. Scan agent environment/argv/output, generated workspace files, JJ snapshots, proxy/resolver output, host logs, temporary/cache files and failure artifacts for synthetic sentinel leakage, without writing actual credentials into scan arguments or reports. Verify failed audit writes never dispatch. Scans are regression evidence, not proof against arbitrary malicious code.

### Phase 3: host isolation and optional live trial

Implement and verify the separate execution boundary before introducing any live credential. Demonstrate that the agent cannot read the host secret facility, proxy memory/process environment, shared credential helpers or sibling task channels, and cannot bypass allowed network routes. Prove the proxy runs pinned trusted code. If these tests cannot be run, report strong isolation as unverified and retain fake-only scope.

Gate for an authorized live trial: designated test repository, prepared reviewed remote branch, exact approved request digest, minimum provider scope, short local TTL, working audit journal, and independent Sol review. Create one draft PR, verify its identity, attach it to the Codex task using `attach_artifact`, revoke the lease and demonstrate a second operation is denied. Record metadata and limitations only. Cleanup requires its own authorized operation; never treat PR creation as deployment permission.

### Phase 4: integration handoff

Run targeted capability tests and the tooling typecheck; run the repository suite if shared configuration changes. Re-review the final diff with Sol 6.1 High before committing or preparing integration. Preserve the side workspace and reviewed evidence. Document exactly what is proven: fake-policy correctness, host isolation, or live provider behavior. Merge/push is a separate handoff step.

## Open choices resolved at implementation kickoff

- Confirm whether this belongs as reusable standalone agent tooling or repository-local `tools/` code; the proposed first slice is local and does not change research behavior.
- Identify the designated test repository and operator-provided remote branch. If opening a PR is not useful, revisit the first action before adding credentials; dependency or deployment capabilities need their own narrow contracts.
- Select the host credential facility, authenticated IPC mechanism and restricted runtime supported on this machine. No convenience fallback to raw agent environment injection.

## References checked during planning

- [JJ glossary](https://docs.jj-vcs.dev/latest/glossary/): workspaces share commit and operation storage; automatic snapshots matter for the no-secret invariant.
- [GitHub PR API](https://docs.github.com/en/rest/pulls/pulls#create-a-pull-request): PR creation supports installation tokens and requires PR write permission; use a typed draft request and a prepared branch.
- [GitHub installation-token generation](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app): issuance can narrow repositories and permissions; token lifetime does not replace local lease enforcement.

Review status: Sol 6.1 High read-only architecture review completed (session `01a1067f-0fa3-7c02-80c7-7147ab4efb70`). Its five findings were incorporated: unmatched dispatch crash recovery, conservative negative evidence, service read/recovery authorization, host credential persistence controls, and single-dispatch/retry semantics. The revised plan has not had a second independent review; a fresh review remains required at the implementation gate. The fake-only implementation and subsequent reviews are recorded in `jj-agent-secret-handling-implementation.md`. See `jj-agent-secret-handling-review.md` for the original findings.
