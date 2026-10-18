# Clade measures from the mutation tree, v1 (2026-10-18)

Status: **exploratory, analysis only.** CPU only, read-only on `runs/`. No physics, no golden pin moved, no
model calls, nothing registered. This is the follow-on `plans/README.md` offers after plan 005: measures
read from the genotype tree (`mutations.tsv`) and per-census abundances (`lineages.tsv`), keyed on clades
rather than on single lineage IDs. Code: `tools/lib/clade-measures.ts`, `tools/clade.ts`. Record:
`experiments/foundations/clade-v1.json`.

The section "Fixed before computing" was written before any measure was computed on any bundle. The
readout is added below it afterwards and is recorded against those rules, whatever it says.

## Context

- **Plan 005** (`experiments/foundations/t6-v2.json`) found no test-6 measure eligible. Persistent novelty v2
  flagged 34 of 70 neutral runs because genome μ/σ bins drift under neutral mutation, and lineage-ID
  turnover is confounded by the 10,000–14,000 IDs minted per 10⁵ steps. A clade (a lineage and all its
  descendants) does not change when a mutant is minted inside it, so clade measures do not count mutation
  as change.
- **The founder-policy calibration note.** `../browser-life-founder-policy/docs/m4-growth-calibration-results.md`
  is not at that path: the workspace was archived to `runs-archive/browser-life-founder-policy/` without its
  docs. The note survives in git on `research/archive` (`68be3d1:docs/m4-growth-calibration-results.md`,
  dated 2026-09-29). Its result: the M4 growth candidate's frozen calibration failed narrowly. The spots
  endpoint-1 paired null had 2 of 200 positives, an upper bound of 0.0311 against the declared 0.025, so
  the candidate stayed unregistered. Two things carry over. First, null rates here are read with exact
  binomial upper bounds against a bar fixed in advance. Second, a stratum that fails is not dropped, pooled
  away or resampled until it passes. The measures here are candidates for a future registration's toolbox,
  not a rescue of that candidate.
- **Lineage keys are mutation events.** A lineage id is (birth step + 1, birth cell) and its genome never
  changes. Every mutation event mints a new id with a genome copied from its parent and then mutated. The
  mutation tree is therefore a mutation-lineage tree: each node is one genome, but the same genome can sit
  under several ids, through clamped no-op mutations (about 0.3% of events, `plans/README.md`) and also
  through recurrent or reversing mutations (two children applying the same +1 to the same weight). The
  measures below are clade measures on this tree and do not need genomes to be unique. (Corrected after
  review; the first version called the tree "the genotype tree". See Review amendments.)

## Fixed before computing (2026-10-18)

### Inputs

- `mutations.tsv` (childHi childLo parentHi parentLo; rows ordered by childHi, parentHi < childHi) and
  `lineages.tsv` (step, lineage, cells; every living lineage at every census, 100 steps apart), both
  streamed. No other file is read for the eligibility measures, so the measures work on the M4 originals
  (`runs/m4`, which have no `genomes.tsv` or `profiles.tsv`) as well as on the replays.
- **The tree.** A node is a lineage key `hi:lo`. Its birth step is hi − 1, and founders (hi 0) have birth
  step 0 and are roots. Before census t is processed, every edge with childHi ≤ t is added. Every living key
  at census t must then be a known node, and every edge's parent must be known. A lineage with no living
  cells at a census can never regain cells, so a node is pruned once neither it nor any descendant is alive.
  Retained state is bounded by the living lineages and their ancestor paths, never by file length.
- **Clade share** of node v at census t is the sum of the cells of v and its living descendants, divided by
  the living cells at t.

### Measures (per run)

1. **TMRCA95 (recent common ancestry).** At census t, the MRCA95 is the youngest node whose clade share is
   at least 0.95. It is found by walking down from a root holding at least 0.95 to the child holding at least
   0.95, while such a child exists. TMRCA95_t is t minus the MRCA95's birth step. When no root holds 0.95,
   ancestry predates the run and TMRCA95_t = t (censored at the start). For example, M3 worlds stay
   polyphyletic until one founder clade takes over.
   - *Scalar:* the median of TMRCA95_t over censuses with t > horizon/2.
   - *Flag:* TMRCA95 at the final census < horizon/2, meaning the population's 95% ancestor was born in the
     second half. That ancestor is necessarily a mutant.
   - *Descriptive:* exact TMRCA over all living cells (no 0.95 cut), and the first census at which a single
     root holds 0.95.
2. **Mutant-clade sweeps.** A sweep is a clade rising from below x = 1% to above y = 50% of living cells
   within W = 10⁵ steps. A clade born less than W before t counts as below x at its birth. Clades over 50%
   form one path from a root, so the qualifying node at census t is the youngest node on that path whose
   share was below 1% at some census in [t − W, t), or which was born after t − W.
   - *Counting:* an event is recorded the first time a node qualifies, and the node and its ancestors are
     marked. A later event whose node descends from the previous event's node, within W of it, refines that
     event rather than counting a new one.
   - *Scalar:* the number of events whose node is a mutant (born after step 0).
   - *Flag:* at least one such event.
   - *Descriptive:* founder-clade sweeps, counted the same way.
3. **Gross clade replacement.** Intervals are Δ = 10⁴ steps, t_k = kΔ. For each lineage A alive at t_{k−1},
   p_A is A's share then. q_A is the share at t_k of cells that descend from A. Each cell at t_k descends from
   exactly one lineage alive at t_{k−1}, its youngest ancestor born at or before t_{k−1}, and the code
   asserts this. G_k = 1 − Σ_A min(p_A, q_A) is the share of the population that changed clade within the
   interval, counting extinct clades in full. A mutant minted inside A stays in A's class, so mutation by
   itself adds nothing to G.
   - *Scalar:* the mean of G_k over intervals with t_k > horizon/2. This is a gross rate: changes in successive
     intervals add up and do not cancel.
   - *Flag:* none. G has no natural zero and no a priori scale, and a threshold fitted to the 70 neutral runs
     would be judged on the runs it was fitted to. It is a comparative-only measure (see Eligibility).
   - *Descriptive:* the net clade-level change over the whole second half, with classes taken at horizon/2.

Not built in v1, and why:
- *Genotype-keyed activity.* Lineage ids are genotypes except for about 0.3% clamped no-op mutants, so
  merging ids by genome would reproduce the existing lineage activity almost exactly. It would also need
  `genomes.tsv`, which the M4 originals lack.

Parameters are fixed here: x = 1%, y = 50%, W = 10⁵, Δ = 10⁴, cut 0.95, horizon/2 = 5 × 10⁵.

**Cadence rule.** The pilot reports timings only. Measures are evaluated at every census (100 steps) if the
pilot projects the full set at no more than 8 hours on this machine. Otherwise they are evaluated at every
10th census (1,000 steps), with every line still parsed and every edge still added. W and Δ are multiples
of 1,000 under both cadences, and the cadence used is recorded.

### Corpora

- **Null corpus:** the 70 neutral runs of test 6, unchanged.
  - `runs/replay-calib/{gradient-m3,spots-m3}/neutral`: seeds 1001–1020, 20 + 20.
  - `runs/replay-m4/gradient-m3/neutral`: seeds 1–20.
  - `runs/replay-m4/spots-m3/neutral`: seeds 1–10.
- **Treatment:** the M4 originals, `runs/m4/gradient-m3/treatment` (20) and `runs/m4/spots-m3/treatment` (10).
- **No-mutation:** `runs/m4/{gradient-m3,spots-m3}/no-mutation` (20 + 10). Descriptive only.
- All runs must have 10⁶ steps and census every 100. Any other count or setting stops the run.

**Why the contrast is treatment against neutral.** Test 6's pair was treatment against no-mutation. That pair
is degenerate here. A no-mutation bundle's `mutations.tsv` is header-only: its only clades are the 12
founders, it has no mutant sweeps, and its TMRCA95 is censored unless a founder fixes. Any tree measure
would separate it from treatment by construction. Neutral runs have the same mutation process with
selection removed (every cell expresses the reference phenotype). What these measures claim to detect is
that difference: selection acting on genotypes.

### Expected directions (a > b), written before computing

- TMRCA95 scalar: neutral > treatment (selection makes common ancestry recent).
- Mutant sweeps: treatment > neutral.
- Gross clade replacement: treatment > neutral (fitter clades displace others).

### Eligibility (each measure on its own)

A measure is **eligible** only if all of the following hold.

1. **Complete.** 70 null runs; 20 / 10 treatment runs; 20 / 10 no-mutation runs.
2. **Separation.** The Mann–Whitney effect (`@bl/metrics` `mannWhitney`, U / n₁n₂) in the expected direction
   is at least 0.8, separately in each preset. In gradient-m3, 20 treatment runs are compared with that
   preset's 40 neutral runs, and in spots-m3, 10 with 30. Both presets must pass, because a registration
   would run in both.
3. **Null flags** (TMRCA95 and sweeps only). Over the 70 neutral runs, the one-sided 95% upper bound on the
   flag rate must be below 0.10, i.e. at most 2 of 70 flagged. This is test 6's rule, computed as
   `1 − binomialLowerBound(n − f, n)`, as in `tools/t6v2.ts`.
4. **Neutral splits.** Each preset's 20 replay-calib neutral runs (seeds 1001–1020) are split at random into
   10 and 10, 1,000 times (seed 4,500,101, the shuffle of `tools/t6v2.ts`). The one-sided Mann–Whitney test
   in the expected direction must reject at α = 0.05 in at most 10% of splits, in both presets.
5. **Sanity control** (not a monotone function of population size or mutation count). The covariates per run
   are the mean living cells over censuses with t > horizon/2, and the mutation rows with childHi >
   horizon/2 per 10⁵ steps. Within each preset's neutral runs (40 gradient, 30 spots), |Spearman ρ| between
   the scalar and each covariate must be below 0.9. The treatment-set correlations and each covariate's own
   treatment-vs-neutral effect are reported but are not gating.

For gross clade replacement, rule 3 does not apply. Its neutral check is rule 4. If it is eligible, it is
eligible as a comparative measure only, and a registration using it would need a neutral arm.

Three candidates are judged without a multiplicity correction. A measure that comes out eligible still
needs its own dated registration rule and a fresh pilot before it is used, as in plan 005.

### Clarifications (2026-10-18, written with the code, still before any measure was computed)

- **Present at a census.** A lineage with key hi:lo is present at census t only if hi ≤ t (it was minted during
  the step that produced state hi, so a node with hi = t + 1 is not in census t). In the replacement rule, "its
  youngest ancestor born at or before t_{k−1}" is read as "its youngest ancestor present at t_{k−1}" (hi ≤
  t_{k−1}, founders always). That ancestor was alive at t_{k−1}, because its child on the path was minted from
  its cells no earlier than t_{k−1}; the code asserts it is in the t_{k−1} census. Birth step stays hi − 1 for
  TMRCA and for the sweep rule's "born after t − W".
- **Thresholds.** The majority path holds clades with share strictly above y. The MRCA95 walk uses share ≥ 0.95.
  The exact MRCA walk descends while a child holds every living cell (integer equality).
- **Snapshots** for replacement are taken at every multiple of Δ from the start, so the first second-half
  interval (ending at 5.1 × 10⁵) uses the snapshot at 5 × 10⁵.
- **Final census** is the last non-empty census in `lineages.tsv`. The listing step checked
  `manifest.summary.extinct` before any measure was computed: no run of the 130 is extinct. If a run had died out
  before 10⁶, its final-census values and `netReplacement2` would be null, it would be left out of the flag rate
  with the count shown, and every rule needing that run would read `incomplete`; the run is not replaced.
- **An undefined Spearman ρ** (a scalar constant over a preset's neutral runs, for example every sweep count 0)
  passes rule 5: a constant carries no information about population size or mutation count. It is reported as
  `null`. Separation (rule 2) still has to be met on its own.
- **Rule 4 direction.** In each split the first 10 runs take the treatment role. For TMRCA95 (expected lower
  under treatment) a split rejects when the first 10 are lower (`mannWhitney(B, A).pGreater < 0.05`); for the
  other two, when they are higher (`mannWhitney(A, B).pGreater < 0.05`). One `rng(4_500_101)` per measure draws
  gradient's 1,000 splits and then spots', as in `tools/t6v2.ts`.
- **Cadence** is passed to `all` explicitly (`--cadence 1` or `--cadence 10`), chosen by the pilot's printed rule;
  the record carries it. Sweep `lastLow` values and snapshots are taken only at evaluated censuses; covariates
  (living cells, mutation rows) use every census and every row.

### Running

- `deno run -A tools/clade.ts pilot`: 2 runs (one gradient treatment, one spots neutral), timings and peak
  retained nodes only, no measure values.
- `deno run -A tools/clade.ts all`: the full set, in a fixed order (treatment, then null, then
  no-mutation). It runs in the background with a progress log and `uptime`, resumes from a per-run cache at
  an explicit `--cache` path outside `runs/`, and has a hard cap of 12 hours of wall time.
- If the cap is hit, the record is written with `partial: true`, any measure missing a required run reads
  `incomplete`, and the computed values are reported as such.

**Stop conditions:**
- An unknown living key or parent, or childHi going backwards.
- A corpus count or setting other than those above.
- Retained nodes growing with file length rather than with the living population.
- Any parameter, direction or rule changed after a measure value has been seen.

## Pilot (2026-10-18, timings and retained nodes only; no measure value was printed)

- Corpus check passed: 130 runs, the counts and settings above, none extinct.
- `runs/m4/gradient-m3/treatment/seed-1` (89 MB): 9 s at cadence 1, peak retained 2,901 nodes.
- `runs/replay-m4/spots-m3/neutral/seed-1` (172 MB): 34 s at cadence 1, peak retained 23,880 nodes.
- Projection for all 130 runs (10.1 GB) at cadence 1: 0.46 h at load average about 380. The cadence rule gives
  **cadence 1**.
- **On the stop condition about retained nodes** (a reading of the condition made after the pilot, before any
  measure value was seen; see Review amendments for the evidence now committed).
  In the spots neutral run, retained nodes rose steadily over the
  run (2,553 in the first tenth, 23,880 in the last) while living lineages stayed near 750 and the deepest retained
  node was 11 to 60 mutations from its founder.
  - A separate scratch check found no leak. At censuses 2 × 10⁵, 5 × 10⁵ and 10⁶, the tree's retained count equals
    the size of the union of the living lineages' ancestor paths, computed independently from the full parent map
    (`tools/lib/clade.ts` `parentMap`): 5,011, 12,154 and 23,824, equal each time.
  - The growth is therefore the genealogy itself: without selection, in a patchy world, the living lineages' ancestries
    barely coalesce. It is bounded by living lineages × depth (about 750 × 60), not by the file's 5 × 10⁵ mutation rows.
  - The stop condition was meant to catch state not explained by living lineages and their ancestor paths, and it does
    not apply. No definition, parameter or rule changes. `all` logs the last-tenth/first-tenth ratio for every run.

## Readout (2026-10-18)

`deno run -A tools/clade.ts all --cadence 1 --cache <scratchpad>`: all 130 runs at cadence 1 (10⁴ censuses each).
The run was complete, not partial, and no run was extinct. It took 7 minutes of wall time at load average 305–390.
Record: `experiments/foundations/clade-v1.json`.

**No measure is eligible.** Each fails rule 2 in gradient-m3 (effects 0.34, 0.18 and 0.00, all in the wrong
direction). In spots-m3 rule 2 passes (0.80, 1.00, 1.00); the TMRCA95 spots effect sits exactly at the 0.8 bar,
and it comes entirely from ties at the censoring ceiling (every spots neutral run is censored at 750,050). Each
flagged measure also fails rule 3. Rules 4 and 5 pass for all three, but for the constant spots scalars both
passes are vacuous (see Review amendments).

| Measure | Effect, gradient (bar 0.8) | Effect, spots | Neutral flags (bar ≤ 2 of 70) | Splits gradient / spots | Eligible |
|---|---|---|---|---|---|
| TMRCA95 (neutral > treatment) | 0.34 | 0.80 | 16 of 70, upper 0.33 | 0.050 / 0 | no |
| Mutant sweeps (treatment > neutral) | 0.18 | 1.00 | 40 of 70, upper 0.67 | 0.028 / 0 | no |
| Gross replacement (treatment > neutral) | 0.00 | 1.00 | (no flag) | 0.044 / 0.038 | no |

What the numbers say, read against the rules and not to rescue any measure:

- **In gradient-m3, the neutral runs look more "selective" than treatment on every clade measure.**
  - Neutral gradient worlds have about as many living cells as treatment (second-half median 35,568 against 39,597).
    But they hold far fewer lineages (70–122 at the end, against 185–614) and mint half the mutation rows (median
    24,849 against 48,857 per 10⁵ steps). Drift among those few lineages throws up mutant clades that cross from 1%
    to 50% within 10⁵ steps: a median of 3 sweeps per neutral run against 1 per treatment run. All 40 neutral runs
    have at least one sweep, against 16 of 20 treatment runs.
  - Recent common ancestry follows the same pattern. The median TMRCA95 is 500,500 for neutral against 651,911 for
    treatment, and 16 of the 40 neutral runs had a second-half 95% ancestor at the final census.
  - Gross replacement is 0.40 for neutral against 0.28 for treatment.
  - All three are effects in the wrong direction, with gradient effect sizes of 0.34, 0.18 and 0. This is the same
    lesson as plan 005: removing selection in gradient-m3 changes the population's lineage structure (few lineages,
    fast drift) as well as removing selection.
- **In spots-m3 the expected direction holds strongly, but on a degenerate neutral set.**
  - The 30 neutral spots runs never became monophyletic, so their TMRCA95 is censored throughout (median 750,050,
    constant). No mutant clade swept, and their replacement is low (median 0.016).
  - Treatment spots runs sweep (all 10 have at least one) and replace (median 0.26).
  - Because the spots neutral scalars for TMRCA95 and sweeps are constant, their rule 5 Spearman ρ is undefined and
    passes by the pre-stated clarification. That pass carries no information.
- **The sanity control passed for all three measures:** every defined |ρ| within the neutral runs is below 0.9 (largest
  0.68, replacement in spots). It does not help: the measures fail on separation and the null flag rate, not on
  scale.
- **Descriptive:**
  - No-mutation runs have no mutant sweeps, by construction. Their replacement is near zero (medians 0.0002 and
    0.003). The founder-sweep counts (25 in gradient, 10 in spots) are not sweeps: every one comes from the
    "born less than W before t" clause applied to founders, which start at about 1/12 share (see Review
    amendments).
  - The covariates themselves separate treatment from neutral.
    - Mean living cells: effect 0.75 in gradient and 1.0 in spots, where neutral spots worlds hold a median of 22,453
      cells against 36,460.
    - Mutation rows per 10⁵ steps: effect 1.0 in gradient.

    A clade measure that separated in spots alone could therefore not be told apart from a size difference.

Conclusion for the backlog: a mutant that stays small inside a clade does not move TMRCA95 or the sweep count, and
moves replacement only at a Δ snapshot it holds cells at (see Review amendments, second pass; the unit test checks
1,000 short-lived mutants that hold cells only between snapshots). These measures therefore count mutation as change
far less than lineage-ID turnover did, but not never. The data do not show that the confound is gone. Rule 5 passed, but it had almost no power: gradient neutral runs span about
0.6% in mean living cells (35,454–35,667) and about 1.4% in mutation rows (24,702–25,037 per 10⁵ steps), the spots
scalars for TMRCA95 and sweeps are constant, and a threshold function of population size can pass a within-neutral
Spearman check. Between treatment and neutral the covariates themselves separate (mutation rows: effect 1.0 in
gradient), which is the confound this readout cannot rule out. As in plan 005, the treatment-against-neutral
contrast is not one contrast across presets. Gradient neutral worlds have few lineages and drift faster than
treatment. Spots neutral worlds have fewer cells, 681–808 coexisting lineages at the end and almost no clade change.
By the pre-stated rules, none of the three is a candidate, and no stratum is dropped to make one pass. A future
attempt would need a null matched on population size and lineage structure before any tree measure can mean
selection. That would be a new note with its own rules, not an amendment to this one.

## Review amendments (2026-10-18, written after the readout)

Four reviews (three lenses and Codex Sol 6.1) found no error that changes the readout. The fixes below are code
fixes that leave every recorded value unchanged, and corrections to what the note claims. Nothing in "Fixed before
computing" or its Clarifications was changed. All 130 runs were recomputed after the code fixes (cadence 1, 7
minutes; load average 73 at start and 55 at end, per-run loads up to 107 in the log): every per-run scalar and every
eligibility value is identical to the first computation. The record now also carries a code hash (`code`) and, per
run, `complete`, `livingLast`, `retainedLast`, `depthLast`, `founderSweepsFromLow` and `trailingEdges`.

**Code fixes (no recorded value changed).**
- *The extinction policy is now implemented.* Before, an extinct run would have kept the last non-empty census's
  final values. A run is `complete` only if its last census is 10⁶ and it has all 10⁴ censuses. Otherwise its
  final-census values and `netReplacement2` are null, its flag drops out of the flag rate, and every measure
  reads `incomplete`. `tools/clade.ts` stops when the data's completeness disagrees with `manifest.summary.extinct`,
  so a truncated or gapped `lineages.tsv` is caught. All 130 runs are complete.
- *Sweep events keep scalars only.* Only the last event keeps its node, and only while a refinement (within W) is
  still possible, so recorded events no longer hold pruned ancestor chains in memory.
- *Edges after the last census* are counted (rows, second-half rate) but not added to the tree, so a run that
  ended early cannot throw on a pruned parent. No run has any.
- *`--out` gets the same guard as `--cache`*: neither may resolve under `--base`.
- *Cache keys include a SHA-256* of `tools/clade.ts`, `tools/lib/clade-measures.ts` and the parameters (and, since
  the second pass, `tools/lib/bundle.ts`; since the third, `tools/lib/measures6.ts` and
  `packages/metrics/src/stats.ts`), so a cache entry from other code is never reused. The record carries the hash.
- *Tests* now cover the rule boundaries (exactly W, exactly 1%, born exactly W before, share exactly 0.95 and 0.5,
  TMRCA95 exactly horizon/2), refinement against a disjoint clade and after W, cadence 10, the second-half
  windows, completeness, trailing edges, rules 4 and 5 failing (direction, bar, the mutation covariate, spots),
  constant scalars through eligibility, and line splitting across chunks. The streaming test now checks the exact
  invariant: retained nodes equal the union of the living lineages' ancestor paths, computed independently from
  a plain parent map, and every retained clade's cells match after pruning.

**Limits of the pre-stated definitions (kept for v1; changing them now would change a rule after the readout).**
- *A clade counts as a sweep at most once.* The node and its ancestors stay marked, so a clade that sweeps, falls
  below 1% and sweeps again is not counted again. Sweep counts are lower bounds. For the null flag this is
  conservative: 40 of 70 neutral runs flagged is a lower bound, so the rule 3 failure stands.
- *Founder sweeps at t < W are an artifact.* Founders have birth step 0 and start at about 1/12 share each, so any
  founder clade passing 50% before step 10⁵ counts under the "born less than W before t" clause though it was
  never below 1%. In this corpus every founder sweep (96 over all sets) is of this kind: `founderSweepsFromLow`
  is 0 in every run. Founder sweeps were descriptive only, so no rule is affected. A refinement from a founder
  event to a mutant still yields one mutant event, as it would have without the founder event.
- *Rule 4 is vacuous for a constant scalar.* The spots neutral scalars for TMRCA95 and sweeps are constant, so no
  split can reject: the "0" in the splits column carries no information, like the rule 5 pass.
- *Rule 5 is weak.* A within-neutral Spearman check cannot see a covariate that barely varies within the neutral
  runs, and a step function of population size can pass it (Codex built one that passes every rule: treatment
  above 40,000 cells, neutral near 20,000, one neutral run per preset at 31,000). A future note needs a null
  matched on population size and lineage structure, or a demographic control with overlapping covariates.

**Corrections to claims.**
- *Genotype-keyed activity* was not built because the M4 originals lack `genomes.tsv` and v1 needed no genomes. The
  first version's other reason, that merging ids by genome "would reproduce the existing lineage activity almost
  exactly" since only clamped mutants share a genome, was wrong. Recurrent and reversing mutations also give one
  genome several ids. For example, two lineages of 600 cells each with one genome are below an activity threshold
  of 1,000 apart and above it merged. Genotype merging could change activity.
- *The pilot's stop condition.* The condition "retained nodes growing with file length rather than with the
  living population" was read after the pilot as not met, because the growth matched the living lineages'
  ancestor paths exactly. That reading was made before any measure value was seen, and no definition changed.
  The evidence is now committed: the streaming test asserts the invariant, and the record gives each run's living
  lineages, retained nodes and depth at the final census (spots neutral: 681–808 living, 23,225–25,100 retained,
  depth 51–65; gradient neutral: 70–122 living, 132–213 retained). The pilot's 23,880 was seed-1's peak; its
  final-census value is in the record as `retainedLast`. The scratch check of 5,011 / 12,154 / 23,824
  at three censuses of the pilot run is not in the record.
- *`pnpm typecheck` does not cover `tools/`* (`tsconfig.json` includes only packages, the lab and `tests`), so
  `deno check` is the type gate for this code.

**Second Codex pass (Sol 6.1, xhigh), same day.** It found no P0 or P1 and checked that the readout table and the
record agree (effects, medians, correlations, binomial bounds, all 6,000 seeded splits, completeness fields, corpus
identities, code hash). Its five P2 findings and what was done:
- *A shifted census could pass the completeness check.* A run with all 10⁴ censuses and a last census at 10⁶, but
  one census off the 100-step grid (601 in place of 600), counted as complete and skipped one evaluation. A run is
  now `complete` only if its k-th census is at step 100k. A test covers the shifted census. No run is affected.
- *An incomplete run's sweep flag stayed in the flag rate.* `flaggedSweeps` is now null for an incomplete run, like
  `flaggedTmrca`, so it leaves the denominator as the extinction policy says. A test covers it. No run is affected.
- *The cache compared file sizes only.* An edit that kept a table's size would have reused the cached values. The
  cache now also compares the modification times of `lineages.tsv` and `mutations.tsv`. Contents are not digested
  (about 20 GB per pass), so an edit that keeps both size and modification time is still not caught.
- *The code hash left out the census parser.* It now also covers `tools/lib/bundle.ts`, which supplies
  `lineageCensuses`.
- *The invariance claim was too broad.* The Readout said minting a mutant inside a clade changes no clade measure.
  That holds for TMRCA95 and the sweep count while the mutant stays small, and for replacement only between Δ
  snapshots. A mutant that holds cells at a snapshot is its own class at that snapshot, so if it is gone by the next
  one, G_k counts its cells as replaced: one cell out of 1,000 held at the halfway snapshot adds 0.001 to that
  interval's G_k (in Codex's toy run, gross replacement went from 0 to 0.0005 and net replacement from 0 to 0.001). The unit test avoids snapshots on purpose. The Readout's conclusion is
  narrowed to match.

It also noted that the sweep-memory test checks retained-node counts, which would still pass if finished events
held their nodes again; vitest cannot force garbage collection, so this stays a code-review property. All 130 runs
were recomputed after these fixes (cadence 1, 7 minutes; load average 41 at start, 36 at end): every per-run scalar and
every eligibility value is identical, and the record's `code` hash is the new one (`ddb5d17e17491584`).

**Third Codex pass (Sol 6.1, xhigh), same day.** It checked each second-pass fix and found fixes 1, 2 and 5 correct
and complete, and fix 3 correct within its stated limit (size and modification time, not contents). It found no P0
or P1, no false stop on the real bundles (every census it checked lies on the 100-step grid, including all 300,000
in the 30 no-mutation runs), and the readout table still matches the record. One P2: the code hash still left out
what the eligibility readout uses, the split RNG in `tools/lib/measures6.ts` and the statistics in
`packages/metrics/src/stats.ts` (`mannWhitney`, `binomialLowerBound`), so a change there could alter the split rates
under an unchanged hash. The hash now covers both files (import maps and the rest of `@bl/*` are not hashed). All
130 runs were recomputed under the new hash (cadence 1, 9 minutes; load average 35 at start, 49 at end): every
per-run scalar and every eligibility value is identical, and the record's `code` hash is `137e73aa1ba4f404`. No test
covers the cache's modification-time comparison or the hash's file list; both live in the CLI and were checked by
review.
