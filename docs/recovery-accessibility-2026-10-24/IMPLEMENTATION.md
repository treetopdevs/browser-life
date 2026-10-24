# Implementation and execution record

The user authorized implementation, assay validation, 32 local matched trials, and conditional extension to 128 on 2026-10-24. The frozen candidate and scientific thresholds in PLAN.md are unchanged.

Implemented the opt-in evaluator evidence stream, 25/50-step remnant observer and 32/64-threshold sensitivity views, one-mutation reconstruction, phase-bound checkpoints, manifest/source/seed binding, exact paired decision rules, resource caps, replay verification and readout. The offline audit and prior-art documents are preserved.

Read-only reviews used Sol 6.1 at High effort on two axes:

- **Specification:** final review found no launch blockers after fixes for partial recovery horizons, artifact/seed/config binding, observation cadence, seed inventory, storage projection and re-derived legacy/retained-daughter outcomes.
- **Standards:** final review found no consequential violations after the same fixes and safeguards against rereading with changed decision code or rerunning calibration to overwrite a resource stop. Physics, default configuration and golden pins are unchanged.

The fresh-seed inventory inspected 14,156 accessible JSON records under local runs, experiments and worktrees; no collision with the proposed calibration or scientific seeds was found. The exact inventory is captured again at preparation.

Validation before freezing:

- 12 focused recovery tests passed; TypeScript typecheck and Deno check passed.
- Native observer/default comparisons passed at 100 and 125 recovery steps, including all seven boundary hashes and evaluation equality.
- All 27 native GPU golden cases passed.
- Full Vitest suite: 3,626 passed, two timeouts (shape conservation at 120 seconds and breeder replay at 60 seconds). Both files then passed with one worker and unchanged timeouts: 64/64 tests in 341.75 seconds. No assertions or timeouts were changed.
- `git diff --check` passed.

Execution completed locally: calibration passed, 32 matched pairs plus required replays completed, and the gain gate failed (28/32 versus 28/32). Stopped without extension. The independent reader passed. Full counts, limitations and provenance are in [RESULTS.md](RESULTS.md). No earlier paid-compute approval was reused.
