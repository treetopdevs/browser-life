# Agent capabilities prototype

Repository-local Node tooling. It does not change the simulation packages or alias maps.

The trusted launcher owns `Broker.register`, `issue`, `revoke` and `end`. A channel is a closure bound to a validated launcher registration, not a lease-ID bearer API. Agents receive only `execute` and `close`; lease views omit resolver handles. Registration records the JJ change identity and immutable commit/tree digests, supplied by the trusted launcher. They do not authenticate an agent-provided workspace string.

An approved draft request has exact repository, head, expected SHA, base, title/body digest and `draft=true`. No URL, header, arbitrary operation or credential is accepted in agent input. Five-minute leases are bounded by registered provider expiry. Credentials resolve only after authorization and are held by the proxy, never returned. Head validation precedes a final task/expiry/status check. The synchronous durable dispatch append is the revocation/dispatch linearization point. Revocation before it prevents writes; revocation after it cancels locally but may leave a provider write.

`FileAudit` requires an operator-controlled path outside every checkout, private host permissions, and a single writer. Every append is acknowledged only after fsync; creation also fsyncs the parent directory. Its exclusive sidecar lock survives crashes deliberately: an operator must repair/review the journal and clear the stale lock while the old process is stopped. It refuses symlinks, hard-linked, permissive, malformed or truncated journals. This is ordered evidence, not protection from a host administrator. Retain the journal for the task lifetime plus 30 days; do not prune unresolved dispatches. Archive it with the same host access controls. No raw request bodies, provider responses, error text, credentials or handles enter audit records.

Restart invalidates prior in-memory registrations and leases. Every committed attempt blocks further creation for its repository/head/base, including successful and failed requests. Missing completions are recorded as uncertain on replay, even if the process died before the provider call. The prototype deliberately offers no automated replacement/unblock API. An empty recovery read cannot prove an in-flight write never happened.

This is fake-only policy evidence on an unrestricted host. JJ workspaces share storage and are not a security boundary. Live credentials require a pinned reviewed proxy outside agent-writable paths, a separate restricted identity/container, a host credential facility, cleared inherited credentials, constrained network routes and demonstrated process/keychain/helper isolation. Diagnostic capture and core/crash dump controls must be validated before live use. No live resolver or live trial is enabled here, and no memory-zeroization guarantee is made.

Run the dedicated tooling check and tests:

```sh
pnpm exec tsc -p tools/agent-capabilities/tsconfig.json
pnpm exec vitest run tools/test/agent-capabilities
```

## Local launcher harness

Build the reviewed sources into a new private host-state directory. Do not put runtime or journal in a checkout. The harness refuses repository ancestors and symlinked artifact entries; the journal requires an owned private parent directory. Dependencies must already be installed. The following performs no network calls:

```sh
mkdir -p "${XDG_STATE_HOME:-$HOME/.local/state}"
capability_state="$(mktemp -d "${XDG_STATE_HOME:-$HOME/.local/state}/bl-capabilities.XXXXXX")"
pnpm exec tsc -p tools/agent-capabilities/tsconfig.build.json --outDir "$capability_state/runtime"
node "$capability_state/runtime/harness.js" "$capability_state"
```

`alpha` and `beta` are separate staged trees with private inherited pipes. Only alpha has a lease. Both try the same lease twice: alpha succeeds once, beta is denied, and reuse is denied. The trusted supervisor clears inherited agent environment; macOS may add `__CF_USER_TEXT_ENCODING` at process startup. Agent argv contains only the executable and reviewed agent script. Credential handles stay in the supervisor. The harness generates its random synthetic sentinel in memory, verifies it is absent from runtime/staged files, audit and captured stderr, and checks runtime bytes remain unchanged. It persists only safe evidence and agent metadata. It hashes the copied runtime for provenance, but same-user agents can still modify host files: the hash is regression evidence, not an enforced pin or isolation boundary.

The fixed-host GitHub adapter exposes only approved head validation, typed draft creation, and service-only all-state PR pagination. It rejects redirects, oversized/invalid responses and injected provider URLs/errors. The transport contract requires bounded response streaming, zero POST retries and abort handling; only a fake transport is supplied. A live transport and host resolver are intentionally absent until containment/dump controls pass. Definitive authentication/permission/validation rejection consumes a lease as failed; ambiguous transport failures consume it as uncertain. Even failed attempts remain blocked from automatic replacement.

Recovery is a trusted service interface, never an IPC command. A fresh operator approval produces a single-use read-only grant bound to the recorded dispatch, original task and exact repository. It may run after task cancellation/lease expiry. Grant/read/result audit events preserve original request ID, separate approval ID and grant ID. Reads traverse all pages with `state=all`, including closed PRs, and return validated identities only. Paging bounds or invalid/incomplete reads produce uncertainty. Neither an empty read nor a match unblocks replacement or revives a task. No cleanup write or automatic retry capability exists.

IPC frames are capped at 128 KiB (enough for the schema's worst-case escaped payload), with at most eight pending requests. Disconnect and output backpressure close the task and revoke unused authority. Task identity is bound by supervisor-created private pipes, not agent-supplied strings; same-user access to sibling descriptors remains a containment concern.
