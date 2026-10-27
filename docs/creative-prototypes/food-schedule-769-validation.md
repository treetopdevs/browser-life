# Food schedule 769 validation

## Before biological outcomes

Reviewed plan committed in bcaaeccc. New mode is an isolated copy of the frozen foothold model; existing modes and biology remain unchanged. The new mode changes target pulse advance768→769 and declares its new metadata. No biological stepping occurred in preflight tests.

- 20 focused pure tests pass on Node24.2.0. They enumerate all1,200 pulse allocations, ranks, uniqueness and coverage; compare initialization of all old modes; check both gate horizons; reject stale/missing/false manual receipts; exercise the actual live wait helper with synthetic I/O; verify no fixture continuation before a committed receipt; reject repeated authorization; check committed-input bytes in a temporary Git repository; and verify sticky attempt starts.
- 16 synthetic Chrome checks pass; two actual/media checks are correctly skipped until evidence exists. An earlier synthetic check observed source hashes while the assay source was changing; the final stable-source suite passes. Review also fixed a viewer claim that could label a 3,000 gate pass Promising; only a final 6,000 pass may use that label.
- Full TypeScript typecheck passes.
- Parent reports lab build passes (190 modules).
- Launcher shell syntax and Git diff checks pass.
- Historical PR116 runner check-only passes. This reads saved evidence and does not run biology.
- Independent Codex Sol 6.1 High implementation review cleared the assay and viewer after repairs; final pre-commit closure is recorded in the review report. Initial findings repaired: a source-map key incorrectly overwrote the old-model pin; package/lock/test hashes now remain bound through the live wait; final validation recomputes the full immutable gate artifact; actual barrier/committed-input fixture coverage added.

An initial pure test invoked the default Node26 runtime and was correctly rejected by the Node24 snapshot metadata requirement; it passed under the required Node24.2.0 runtime. Typecheck caught a now-unused model URL after the source-map repair; it was removed and typecheck passed. Neither event was a biological attempt or retry.

No attempt has been reserved, no historical full regression has run, and no new outcome exists at this point. Actual replay/media checks remain pending evidence.
