# Independent-seed mutation validation

Validation fixes its genomes **before** drawing any validation outcome. It consumes the saved 7,200-proposal screen plan and one or more completed or bounded partial screen reports. Every report must name the same exact plan SHA-256 and screen code identity; batch indices, proposal positions and genotype keys are checked, and overlapping batches are rejected. Partial coverage is explicit. A missing class in screened rows is unavailable evidence about that class, not evidence of absence among all 7,200 proposals.

Nomination is diagnostic and deterministic. For each of the 12 founders, the protocol considers at most one **distinct resulting genotype** in each priority class:

1. `role-shift-preserved`: parent and mutant each show survival, recovery, regeneration and light dependence in the screen assay, with at least one paired fixed-role share change.
2. `changed-preserved`: the same four screen outcomes hold, with any saved Evaluation or trace-summary change.
3. `observed-loss`: the parent survives or regenerates and the mutant fails that same screen outcome.
4. `observed-unresponsive`: the genotype changed, but saved Evaluations and trace summaries match exactly and no paired fixed-role frame change was observed.

All four classes require an effective genotype change. Each class ranks eligible **genotypes**, after grouping duplicate proposal outcomes, by SHA-256 of `foundation-mutation-validation-v1`, founder index, class, and exact genome key. The first ranked genotype not already selected in a higher-priority class is nominated. The plan distinguishes every originating proposal ID in the full frozen 7,200-proposal plan from the subset actually screened, and retains the class-eligible screened subset. It records eligible proposal and unique-genotype denominators by founder and class, including cases where all eligible genotypes were already selected. This screen-conditioned set is biased toward its diagnostic criteria; its class counts do not estimate a mutation-population frequency.

Plan creation is read-only apart from a new output manifest and requests no GPU:

```sh
deno run -A tools/foundation-validation.ts \
  --screen-plan runs/foundations/screen-plan-7200-v1.json \
  --screen-report runs/foundations/screen-batch-0-v1.json \
  --screen-report runs/foundations/screen-batches-1-8-v1.json \
  --out runs/foundations/validation-plan-v1.json
```

The plan freezes candidate order, exact encoded genomes, source proposal/report hashes and code identity, plus the 32 fresh seeds `620050001..620050032`. No new mutation draw occurs in validation. At most 48 nominees plus 12 unchanged founder identity controls occupy at most 60 of the evaluator's 64 tile slots. The existing `SCREEN_EVAL` geometry, durations and one replicate per seed are retained.

Execution uses only the saved plan, a new report path, a seed offset, and both seed and wall-time caps:

```sh
deno run -A tools/foundation-validation.ts --execute \
  --plan runs/foundations/validation-plan-v1.json \
  --seed-start-offset 0 --max-seeds 8 --max-seconds 600 \
  --out runs/foundations/validation-seeds-0-7.json
```

Run four disjoint chunks with offsets 0, 8, 16 and 24 to cover all 32 seeds; the command never launches them automatically. It rechecks the screen inputs and source hashes before GPU acquisition and after execution, and reserves the new report before requesting a device. Parent and mutant occupy identical candidate indices and tile coordinates, with the same seed, config and resources in separate evaluation calls. All 12 parent-versus-itself controls must match the full Evaluation **and every full growth-trace sample** on every seed. The first seed in each bounded invocation also repeats the entire parent arm and requires exact Evaluation and full-trace equality. Each saved row includes absolute Evaluations, trace summaries, paired fixed-role changes, and pointwise growth-census differences for bound mass, membrane fraction and observed movement, with nulls preserved where measurements are unavailable. Completed seeds persist even if a later call fails or exceeds the cap; an indivisible evaluator call that overruns is marked incomplete.

Once all chunks exist, aggregate them without GPU use:

```sh
deno run -A tools/foundation-validation.ts --analyze \
  --plan runs/foundations/validation-plan-v1.json \
  --result runs/foundations/validation-seeds-0-7.json \
  --result runs/foundations/validation-seeds-8-15.json \
  --result runs/foundations/validation-seeds-16-23.json \
  --result runs/foundations/validation-seeds-24-31.json \
  --out runs/foundations/validation-analysis-v1.json
```

The analysis rejects duplicate or foreign seeds, malformed one-replicate gate counts, candidate identities, trace digests and 30-frame schedules. Inferential fields remain `null` until all 32 prespecified distinct seeds are present. On a complete set it applies the repository's existing one-sided 95% binomial lower-bound probability gate at 0.8 to **both** parent and mutant survival, regeneration and light dependence. It counts paired harmful outcomes separately for survival, regeneration and light dependence: for each endpoint, `H` is the number of seeds where the parent passes and the mutant fails that endpoint. Only if all six absolute gates pass does it report the conservative 95% upper bound `1 - binomialLowerBound(32-H, 32)` for each endpoint. The `<=0.10` viability-loss prioritization check uses the **survival-specific** bound. A separate, explicitly labelled joint three-trait contrast is descriptive; it cannot substitute for survival harm, because a parent failing another trait can still survive when its mutant dies. These are prioritization rules for nominated fixed genotypes, not M4 endpoints or natural mutation-rate claims. Evaluation effects, role-frame changes and pointwise mass/membrane/movement differences remain descriptive with finite-frame denominators; a fixed role-class change does not establish a novel function or inherited life cycle.

The 95% bounds apply separately to each nominated genotype and endpoint. They are not simultaneous family-wide confidence guarantees across nominees or traits. With 32 paired seeds, even zero observed harmful survival outcomes gives an upper bound of about 8.94%; this is a coarse prioritization screen, not a precise estimate of a small harm rate. Any later confirmatory claim about the selected family needs its own multiplicity and precision policy fixed before fresh outcomes.
