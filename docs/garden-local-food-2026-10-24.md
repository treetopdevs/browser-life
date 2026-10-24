# Collective food in the local launcher — 24 October 2026

## Scope

`bin/garden-dev` can now opt a newly founded local garden into the already-built collective food rule:

```sh
GARDEN_FOOD=1 bin/garden-dev
```

Unset or `GARDEN_FOOD=0` keeps food off. Only the exact strings `0` and `1` are accepted; empty strings, words, spaces and leading zeros are rejected before any directory helper, environment scrub, server, island, network probe or data-directory creation runs. The script reports the choice after successful founding.

The founding payload adds the boolean `food`; all existing preset, seed, pacing and founding-feed fields are unchanged. This enables future collective requests, not an extra immediate feed. The existing one-time founding feed stays exactly as before.

The threshold is unchanged: coordinator defaults require **five distinct networks in one dawn period**, with at most one collective food landing per **seven garden days**. No threshold, cooldown, amount, or radius override is sent. Repeated requests from the same local machine do not count as five networks. This option makes the existing public-view/form behavior available locally; it deliberately does not make a single-machine collective landing convenient by weakening the rule.

When `GARDEN_DATA_DIR` points to an existing garden, its founding rule remains authoritative. The launcher says that GARDEN_FOOD is a founding-only choice and the existing food rule is unchanged; it does not claim the requested setting was applied to that garden.

Only `bin/garden-dev` changes. The public founding script, deployment settings, coordinator rules and public garden opening are unchanged. No public garden was founded or deployed.

## Validation

A Vitest harness copies the actual launcher into a disposable repository layout and supplies stub coordinator/network commands. It executes the script's real payload generation and lifecycle with lab/islands disabled; no real GPU or coordinator is launched.

- Default, explicit off and explicit on produce boolean `false`, `false` and `true` in the captured founding JSON.
- Each retains the exact original founding feed and sends no `foodAsks`/`foodEveryDays` override.
- Output describes enabled/off state and the unchanged collective threshold.
- Eight invalid forms fail before any stubbed subprocess runs and before a data directory exists.
- All five focused tests pass; typecheck, shell syntax and diff checks pass. This proves launcher behavior with stubbed services, not a real collective food landing. Argon4 High source review found no runtime blockers.

The reuse fixture verifies that a requested opt-in is not reported as applied to an existing garden. The harness clears inherited garden/port overrides so developer shell settings cannot alter its default-payload assertions.

Review follow-ups are complete: the reuse case and inherited-environment isolation were already added after the packet; the harness now publishes its PID atomically, waits for a nonempty PID, and has an explicit 15-second test timeout beyond its 10-second shutdown timer. The final five tests, typecheck and diff check pass. No product behavior changed after the reviewed packet.
