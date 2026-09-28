# Exploratory mutation screen

With one founder lineage per tile and mutation disabled, the existing lineage-based effective role diversity is one whenever measurable. This assay can reveal role identity or switching over time, but it cannot measure complementary roles coexisting within a tile. Ecological coexistence requires a separate community assay.

Interpret the inherited evaluator labels narrowly. `survived` means positive bound mass plus a detected component over the evaluator's mass cutoff after growth. `reproduction` counts inferred fissions and unmatched component births; condensation or fast movement can create the latter. Neither field proves a completed life cycle. Role observations use only the final step of each 100-step sampling interval, so unchanged observations do not exclude brief intervening activity. The classifier's `mixed` label can include inactive lineages; consult the separate zero-flux counts. Within-lineage functional differentiation is not measured by this role classifier.

This tool prepares a deterministic, reviewable screen of one-step proposals from the 12 fixed M3 founders. It does not run a screen by default. A normal plan uses 200 raw proposals per founder at each mutation scale 1, 4 and 24: 7,200 proposals in all. They remain nested observations of the 12 founders, not 7,200 independent evolutionary histories. The conditional mutation draws do not estimate the natural frequency of mutation events.

These are rule-faithful changes to `mutStep`, not a symmetric amplitude-only experiment. The implemented operator replaces a zero proposal with +1: at scale 1, two of three possible delta residues produce +1 and one produces −1. Sigma's signed right-shift rounding adds another discretization effect, and clamping depends on the parent's locus value. A difference between scales may therefore involve directional bias, effective step size, or boundary effects. The saved raw and effective proposals keep those distinctions available; the current experiment does not change the underlying operator.

The saved `screen-plan-7200-v1.json` makes that asymmetry visible before outcomes: scales 1/4/24 respectively contain 1,620/1,329/1,239 effective increases, 771/1,064/1,152 decreases, and 9/7/9 unchanged proposals, out of 2,400 each. Distinct loci per founder range from 108–120, 107–123 and 105–121 out of 163. These are exact properties of this proposal manifest, not measured natural mutation frequencies or exhaustive neighborhood coverage. Each non-weight locus receives only 9–17 proposals across all 12 founders in a given scale; this screen cannot support fine comparisons among those parameter classes.

```sh
deno run -A tools/foundation-screen.ts \
  --out runs/foundations/screen-plan-200.json --samples 200
```

The plan records every raw draw, resulting genome, no-change and duplicate outcome, plus drawn/effective/duplicate counts and distinct observed loci for each founder × scale. It orders proposals by sample number, then founder, then scale. A partial execution therefore starts across all 36 strata rather than exhausting one founder. Each batch gets a fixed seed starting at `620001001`; `620050001..620090000` is reserved for later independent validation and is unused here. The assay uses `DEFAULT_EVAL` durations and geometry with **one replicate per genotype**. One replicate cannot support the 32-replicate probability gate.

Execution requires that saved plan, a new report path, and both a batch and wall-time cap:

```sh
deno run -A tools/foundation-screen.ts --execute \
  --plan runs/foundations/screen-plan-200.json \
  --out runs/foundations/screen-chunk-0.json \
  --batch-start 0 --max-batches 1 --max-seconds 120
```

The caps permit at most eight batches and 600 seconds per invocation. A call already inside `evaluateBatch` cannot be interrupted safely at an arbitrary simulation step; the tool checks time before each evaluator call and reports any overrun as `over-budget-incomplete`. A stopped chunk is `bounded-incomplete`, not a completed screen. New plan and report paths refuse existing files. The report is reserved before GPU acquisition, keeps completed batches and an incomplete-stage marker, and records failures including GPU acquisition failure. Each run hashes its source plan and selected code files; the executor recomputes the plan from its recorded draw seed and refuses source or code drift. Source hashes are a selected-file record, not a complete dependency closure.

Within a batch, parent genomes and proposed mutants occupy the same candidate indices and replicate tile coordinates in separate worlds with the same seed, resources and evaluator config. Mutation is off during assays. The first parent batch of **each bounded invocation**, including a chunk starting after batch zero, runs twice as an exact Evaluation and trace repeatability control. Cache reuse requires the exact genotype, seed, tile slots, config and trace mode. No-change proposals and duplicate genomes remain separate rows. The evaluator may skip a mutant call only when every mutant result is already cached at its exact slot. Each proposal reports the raw mutation, absolute parent and mutant Evaluation, quality difference, cache use, and a compact growth-trace summary with frame, living-cell, role and tracked-movement denominators. The execution report also records Deno and GPU adapter information when available; an unavailable adapter description is recorded explicitly.

The role summary is the existing fixed four-class, last-step catalytic observer. It retains all four mean role shares and reports mutant-minus-parent differences over matched step/tile frames where both arms have role evidence, with available-frame and living-cell denominators for each arm. It also counts frames with a fixed-role share difference and records the largest share distance, so opposite transient shifts cannot disappear when their means cancel. A phototroph-to-chemotroph shift remains visible even when effective role diversity is unchanged. If no paired frame has role evidence, differences are `null`; zero-flux cells are also `null` when no role buffer was measured, alongside observed/missing frame counts. A changed fixed role label or effective role diversity does not establish a new function or organization. Screening can nominate candidates for independently seeded validation after controls and effect criteria are fixed. It cannot update the frozen M4 result or substitute for the planned source-history, life-cycle, and reciprocal time-shift work.
