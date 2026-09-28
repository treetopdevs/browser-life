# M3 three-outcome role cohort, diagnostic protocol v1

This protocol follows the completed 7,200-proposal screen and the separately frozen original validation. It does not revise that validation, draw new mutations, or estimate a mutation-population frequency. The new cohort asks whether screen-observed changes among four **fixed role labels** recur on fresh assay seeds while both arms satisfy the three intended M3 outcomes: survival, individual regeneration, and light dependence. Fixed-centre population recovery is measured and reported separately, not used in nomination or the six M3 gates.

## Frozen inputs and nomination

The plan-only command requires the original screen plan, all nonoverlapping completed chunk reports, and a seed audit. It verifies all 113 batches and all 7,200 rows against proposal, seed, tile, configuration and screen source identities. Eligibility requires an effective genotype change, at least one paired frame with different fixed role shares, and single-replicate parent and mutant survival, individual regeneration and light dependence in the screen. The observed eligible inventory is 866 raw assays representing 728 distinct founder–genotype pairs across founders 0, 2, 3, 7, 8, 9 and 10. Failure to reproduce this inventory stops planning.

Group by founder and exact mutant genome. The rank is SHA-256 over the UTF-8 salt `foundation-m3-role-cohort-v1`, a newline, the founder index, a newline, and the lineage-zero genome words serialized as little-endian 32-bit unsigned integers. Select the first two ranked unique genomes per founder where available. Founder 0 has one; the other six eligible founders each contribute two, for 13 nominees. Retain every source proposal ID and mutation scale for each selected genome. The earliest eligible proposal in the frozen plan is its representative source row; neither rank nor representative uses the old fresh-validation outcomes. Append all 12 unchanged founder identity controls.

The 25 logical entries appear at two fixed tile positions: logical index `i` at slots `i` and `i+25`. With `SCREEN_EVAL` (`side:8`, `reps:1`), 50 of 64 independent tile tori are occupied. The plan freezes this mapping, the 32 audited fresh seeds `620060001–620060032`, the full evaluation configuration, input and selected code hashes, and the seed-audit hash. The seed audit covers accessible local JSON artifacts and records that the coordinator registry was unavailable; it is not proof of global seed uniqueness.

## Execution and controls

For every seed, evaluate all 50 unchanged parents, then the 50 corresponding mutants with the same seed, slot, resources, grow/lesion/dark/light schedule, and behavior readbacks. The first seed of **each bounded invocation** repeats the complete parent batch exactly before the mutant call. All 24 identity-control comparisons per seed must match the full Evaluation and all 30 growth census frames; the parent repeat must match every Evaluation and frame. Control failure stops that seed and is saved as a failed report; no candidate or seed is replaced because of an unfavorable outcome. The new output path is reserved before GPU acquisition. Code and source evidence are rechecked after the chunk. One worker runs GPU calls serially.

First run the explicit full-schedule engineering smoke on reserved seed `620069001`, with all 50 slots, a parent repeat and 24 identity controls. Its report retains technical checks but no biological outcomes. Its seed and report format are rejected by the scientific 32-seed analyzer. Four clean scientific chunks of eight seeds then need 64 parent/mutant calls and four parent repeats, or 68 full evaluator calls; an interrupted/retried invocation can require another repeat and counts against the cumulative budget. Each invocation takes at most eight seeds and a declared cap no greater than 600 seconds, checked before calls and after each seed. An indivisible evaluator call can overrun the cap; the report records the overrun and incomplete status rather than claiming a strict runtime guarantee.

## Analysis and interpretation

Analysis requires 32 distinct, prespecified fresh seeds with valid 50-slot rows. Each nominee **at each position** has its own 32-seed parent and mutant survival, regeneration, and light-dependence gates, using the existing one-sided binomial lower 95% bound strictly greater than 0.8. At least 30/32 successes are required. Counts of paired harm and gain are endpoint-specific. When all six absolute gates pass in that position, report the conservative 95% upper bound on each harmful-pair proportion; the `≤10` percentage-point prioritization applies to survival harm alone. A failed parent gate is a baseline limitation, not automatically mutation-caused harm.

The two position panels share seeds. Never pool their 64 outcomes as independent Bernoulli trials or replace a candidate's same-slot parent with an identity control elsewhere. Report agreement or disagreement descriptively. The 30-frame role-share trajectories use only paired frames where both arms have available role evidence, with explicit available and missing counts. Record seeds with any role-share difference, changed/paired frames, recovered counts, mass, membrane and movement pointwise differences and their denominators. Role-change repeatability has no newly invented primary probability gate. Neither a passing nominee nor a changed fixed role establishes a new ecological function, lineage reconstruction or a family-wide confidence claim.

## Files and commands

Implementation is isolated in `tools/lib/foundation-role-cohort.ts`, `tools/foundation-role-cohort.ts` and its focused test. The old screen, validation, evaluator, physics and M4 endpoint files remain untouched. Use the CLI's `--screen-report` option once per completed screen chunk; its default is plan-only. Planning and execution refuse an existing output path. An example after the seed audit is:

```sh
deno run -A tools/foundation-role-cohort.ts \
  --screen-plan runs/foundations/screen-plan-7200-v1.json \
  --seed-audit runs/foundations-next/seed-audit.json \
  --screen-report runs/foundations/screen-batch-0-v1.json \
  --screen-report runs/foundations/screen-batches-1-8-v1.json \
  --screen-report runs/foundations/screen-batches-9-16-v1.json \
  --screen-report runs/foundations/screen-batches-17-24-v1.json \
  --screen-report runs/foundations/screen-batches-25-32-v1.json \
  --screen-report runs/foundations/screen-batches-33-40-v1.json \
  --screen-report runs/foundations/screen-batches-41-48-v1.json \
  --screen-report runs/foundations/screen-batches-49-56-v1.json \
  --screen-report runs/foundations/screen-batches-57-64-v1.json \
  --screen-report runs/foundations/screen-batches-65-72-v1.json \
  --screen-report runs/foundations/screen-batches-73-80-v1.json \
  --screen-report runs/foundations/screen-batches-81-88-v1.json \
  --screen-report runs/foundations/screen-batches-89-96-v1.json \
  --screen-report runs/foundations/screen-batches-97-104-v1.json \
  --screen-report runs/foundations/screen-batches-105-112-v1.json \
  --out runs/foundations-next/role-cohort-plan-v5.json
```

The separate smoke is:

```sh
deno run -A tools/foundation-role-cohort.ts --smoke \
  --plan runs/foundations-next/role-cohort-plan-v5.json \
  --max-seconds 120 \
  --out runs/foundations-next/role-cohort-smoke-v1.json
```

Execution and analysis commands are in the CLI header and should use fresh output names for each chunk and report.
