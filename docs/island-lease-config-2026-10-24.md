# Runtime island task lease — 2026-10-24

## Contract and scope

This closes the explicitly deferred `BL_LEASE_MS` runtime-setting follow-up in
`island-cancel-2026-10-18.md`. The coordinator now reads that environment variable
at startup in development, tests and production, using the existing `env_count`
parser with switching off disabled.

- Unset, empty or whitespace-only leaves application configuration untouched.
  The normal Queue default remains 600,000 milliseconds (ten minutes).
- A positive whole number supplies `config :coordinator, lease_ms: value`.
  Surrounding whitespace is accepted, as with existing numeric runtime settings.
- Zero, negative values, `off`, `none`, fractions and malformed strings stop
  startup with an error naming `BL_LEASE_MS`.

This is the existing normal island run/verify attempt lease: the age of the
last heartbeat used by Queue's existing reclamation paths. It does not add a
release route or a timer, change heartbeat frequency, shorten any default, or
change cancellation/reclamation semantics. `BL_DISCOVERY_LEASE_MS` configures
discovery workers separately and retains its two-minute default.

For an isolated scratch development coordinator, `BL_LEASE_MS=1000 mix phx.server`
from `apps/coordinator` selects a one-second lease. A healthy island must still
heartbeat within that interval to retain its attempt; such short values are
for deliberate expiry tests. No production setting or deployment is changed.

## Implementation and validation

The only runtime code change is the `env_count.("BL_LEASE_MS", false)` binding in
`config/runtime.exs`. `Coordinator.ConfigCheck` already classifies `lease_ms` as
a positive integer, so it needs no new validation rule. Queue's implementation,
its default, and its reclamation code are unchanged.

Release-config tests read the real runtime file with `Config.Reader` for all
three environments, exercise unset/blank/valid and invalid inputs, merge parsed
settings through ConfigCheck, show task/discovery values remain independent,
and verify Queue's actual default and use of the parsed override. Process-wide
environment and application settings are restored after each test. The existing
Queue regression suite additionally exercises expired attempts and reclaimed
artifact ownership.

Validation passed:

- Runtime/config-check/Queue suites: 134 tests, 0 failures.
- `mix precommit`: compilation with warnings as errors, unused-dependency check,
  formatting and all 557 tests passed (14.2 seconds for the tests).
- `git diff --check`: clean.

These are local configuration and Queue regression checks. No real-GPU
cancellation/reclaim experiment or production deployment is claimed.

## Adversarial review

Argon 4 High source review found **NO BLOCKERS**. Its housekeeping findings were
addressed: the linked design note is committed, D48 records completed validation,
ConfigCheck lists the new variable, and the README separates Queue leases from
request-budget settings. No runtime behavior changed after the reviewed packet.
