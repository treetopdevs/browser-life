**Yes—1203 first, extending to 9,000, is a small, feasible screen for “stays interesting longer.” No fundamental plan blocker found.**

**Normalizing only `snapshot.rules.maxHistory: 451→301` is sufficient for the retained 0–6,000 prefix**, provided the model-copy equivalence check passes. History retention does not affect dynamics or RNG, and neither capacity drops samples before 6,000. Recompute normalized sample state hashes and frame hash envelopes; keep new evidence’s own hashes based on its unmodified 451-slot states.

Two details should be explicit before implementation:

- **Prefix checkpoints versus retained snapshots:** [lines 11–13](</Users/nicholas/.codex/worktrees/uniform-food-endurance/browser-life/docs/creative-prototypes/uniform-endurance-plan.md:11>) require comparisons at 3,000/4,000/5,000 but omit them from new retained snapshots. Compare those states transiently during execution and record their normalized hashes and successful comparisons in the prefix proof. Structural `--check` must describe this as recorded execution evidence.
- **Replace inherited runner assumptions:** explicitly require every seed’s prefix, 301 compared samples/frames, 6,000 rows, and the five historical checkpoints. The current runner hard-codes seed 1201, a 3,000-tick prefix, old windows, and old snapshot coverage. Define the new schema’s exact fields and bounds rather than merely renaming it.

Capacity is sound: **451 slots cover initialization, every 20 ticks through 9,000, and any earlier off-cadence extinction**. Lineage capacity also suffices: at most 48 bodies × 9,000 organism-ticks, with reproduction every 80 age ticks, bounds births by 5,400—below 10,000 including founders. The 24 MiB limit remains a fail-closed acceptance bound; static inspection cannot guarantee serialized size.

The gate is clear and frozen. Evidence preservation, deliberate fragile-seed selection, stopping rules, and exclusions of adaptation claims are appropriately explicit. Keep “promising” conditional on this selected screen; failure need not mean visually uninteresting. Moving food can remain deferred.

Read-only review; no simulations, tests, edits, or raw artifact dumps.
