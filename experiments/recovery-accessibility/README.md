# Local recovery-accessibility diagnostic

Protocol: [PLAN.md](../../docs/recovery-accessibility-2026-10-24/PLAN.md). This tests the fixed founder-0 / mutant-138 pair; it is not a mutation search or a new evolution run.

From the repository root:

```sh
deno check experiments/recovery-accessibility/run.ts
pnpm vitest run experiments/test/recovery-accessibility.test.ts
deno run -A tests/deno/recovery_observer.ts
# Use a new output directory. These commands do not provision cloud resources.
deno run -A experiments/recovery-accessibility/run.ts prepare runs/recovery-accessibility/v1
deno run -A experiments/recovery-accessibility/run.ts calibrate runs/recovery-accessibility/v1
deno run -A experiments/recovery-accessibility/run.ts first32 runs/recovery-accessibility/v1
# Only if summary-32.json says EXTEND-TO-128; otherwise stop:
deno run -A experiments/recovery-accessibility/run.ts extend runs/recovery-accessibility/v1
deno run -A experiments/recovery-accessibility/run.ts read runs/recovery-accessibility/v1
```

Calibration must pass before the first batch. Repeating calibration never overwrites a settled stop. The extension rechecks all 32 complete pairs; neither a hand-written summary nor partial data earns it. The source digest applies to reads as well as runs. Use the recorded implementation checkout when rereading old campaigns.

Every accepted case has seven physics checkpoints, a compact observer trace, an input/config binding and SHA-256 checksums. Reads independently verify checkpoint configuration, steps, initial genotype/template and conservation; regenerate retained-continuation, fusion and recovery decisions from the compact evidence; and reject partial or mismatched cases. The reader does not claim the spatial trace establishes molecular ancestry.

The runner uses one local GPU lane. A persisted 60-minute execution budget and 2-GiB storage budget cover the campaign. Calibration projects both from actual complete-case measurements before opening science. An interrupted attempt or exhausted budget remains incomplete. Partial attempts are retained and refused rather than silently rerun; any repair/retry must be recorded explicitly within the protocol's one-retry bound. This version implements no automatic retry.

`case.json` is the canonical scientific payload; its digest excludes timing. Identical repeated cases must match both that payload (excluding case identity) and all checkpoint hashes. Native engineering fixtures separately compare default, 25-step and 50-step readbacks, including a partial final interval.
