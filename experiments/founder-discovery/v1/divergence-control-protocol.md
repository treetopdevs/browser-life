# Divergence control for the founder improvement result — protocol

Status: **FROZEN 2026-10-02, before any new competition.** The protocol's SHA-256 is pinned by `divergence-control/candidate.json`. Execution is authorized only by `divergence-control/release.json`, which names that candidate's hash. Any later change goes in a dated amendment below; never edit this text in place.

## Question

The completed improvement study (`improvement-findings.md`) found that evolved descendants beat their founder head-to-head after one million steps, in 8 of 8 seed blocks. Its disabled arm is an identity control, so it cannot separate selection from "any genome that has changed this much beats its founder". Under unchanged RULE_VERSION 1, this study tests:

- **A. Selection over divergence, per founder.** Do a founder's evolved descendants beat it by more than random mutants carrying the same amount and kind of genetic change?
- **B. Reconstruction.** For the two founders with parallel sweeps, does the single swept change, put alone into the founder, give a competitive advantage? The sweeps were found in post hoc exploration (`improvement-study/exploration-v1/`).

B's slots and values were chosen after seeing the data, but every competition it runs is new. All results are conditional on the four deliberately discovered founders, the gradient environment and the fixed assay seeds.

## Fixed units

**Evolved arm (E): existing evidence, no new runs.** E is the 64 normal-arm descendant draws at 1,000,000 steps (4 founders × 8 evolution seeds × 2 draws) in the frozen report `improvement-study/distribution-v1/analysis-v1/report.json` (SHA-256 `085d55cf…`).
- Each draw uses its 8 scored competitions at assignments 0 and 1 (4 assay seeds × 2).
- The generator re-derives every E cache key. It also asserts, for every draw and assay seed, that assignments 2 and 3 scored exactly as 0 and 1. That is the identity that justifies the reduced design below.

**Random-mutant arm (M): two type-matched mutants per E draw, 128 genomes.**
- Mutant j = 1–128 uses Mulberry32 seed 6480000 + j. Draw k (report observation order) gets mutants 2k − 1 and 2k.
- `Random.int` uses rejection sampling, so bounded draws are exactly uniform.
- **Weights.** The E draw's weight changes are taken in ascending slot order. Each magnitude goes to a weight slot drawn uniformly from the not-yet-used weights; the slot is drawn first, then a uniform sign. If that sign leaves [−127, 127], the other sign is used. If both do, the slot is excluded for this magnitude and another is drawn.
- **Parameters.** Each changed mu, sigma or gain keeps its own parameter and magnitude, with a uniform sign. The other sign is used if the first leaves bounds: mu [16, 4095], sigma [2, 1023], gain [0, 255]. E's own value proves at least one sign fits.
- Each mutant therefore matches its E draw exactly in which kinds of slot changed and by how much. Only the locations of weight changes and all directions are random.
- Half the cluster-139 mutants will carry an upward mu change by chance. This makes A conservative for that founder.

**Reconstruction arm (R): two founders × 8 seeds, 14 distinct genomes.** Each genome is the founder with one slot set to the value that evolved in that seed. That value is the mass-weighted lower median among founder-lineage genomes at 1M carrying an upward change in the slot: the first value, in ascending order, whose cumulative mass reaches half. Every seed has carriers.

| Founder | Slot | Founder value | Seeds 6410001 … 6410008 |
| --- | --- | ---: | --- |
| cluster-33 | `b2[PHOTO]` (photosynthesis output bias) | 62 | 97, 73, 76, 72, 86, 99, 82, 100 |
| cluster-139 | `mu` (growth-function centre) | 33 | 49, 55, 46, 57, 49, 47, 47, 54 |

Seeds with the same value (cluster-139: 49 twice, 47 twice) share one genome, so their results are linked rather than independent.

**Specificity control for B33 (C), descriptive: 8 genomes.** For each cluster-33 seed, the founder gets a single change of that seed's reconstruction magnitude (|value − 62|).
- The change goes on a uniformly drawn weight slot other than `b2[PHOTO]`, with a uniform sign, using the same clamp and redraw rule as M.
- Seed index i = 1–8 uses Mulberry32 seed 6480200 + i.
- No clean control exists for cluster-139's mu, which has no same-scale counterpart. B139 therefore has no specificity control.

## Competition observations

Use the frozen study's competition unchanged: gradient chamber, two radius-12 discs at (64,128) and (192,128), nutrient 32, biomass 64, energy 128, mutation disabled, 20,000 steps. Each M, R or C genome competes against its own founder under assay seeds **6430001–6430004**, the same as E, at assignments **0 and 1**. That is 8 competitions per genome.

- Assignments 2 and 3 only swap lineage labels relative to 0 and 1, and gave identical outcomes in all 480 frozen groups, so they would add no information.
- Execution uses the frozen study's 54 pinned sources and its frozen `executeAssay`, reached through the exact generated adapter, with the frozen cache-key identity. New results are therefore directly comparable with E.
- **Scoring:** signed score = (descendant − ancestor associated B/P) / their total. Both-extinct is unavailable, not missing.
- **Counts:** M 1,024, R 112 and C 64, for 1,200 new configurations, plus 8 replays. If the generator's counts differ, stop.
- **Replay check before any new competition:** re-execute 8 E configurations, two per founder, fixed by the generator. Every field except the wall-clock `elapsedSeconds` must equal the frozen original.
- **Audit at the end of every invocation that did new work:** re-execute one replay configuration, rotating through the eight, under the same rule.
- Any replay or audit mismatch stops the study for diagnosis.

## Estimands and decision

Average each genome's 8 competitions. Average the two mutants of each E draw, then the two draws of each founder × seed unit, all with equal fixed weights. Unavailable or missing scores take their full [−1, 1] range in lower and upper bounds and stay in every denominator. A "certified" value is one whose conservative lower bound is strictly above 0.10.

**A (confirmatory, four separate tests: one per founder, all four founders).**
- For each unit, the contrast is E − M, with lower bound E lower − M upper.
- A founder meets A if at least 7 of its 8 seeds are certified and the study is technically complete.
- **Reading, fixed now:**
  - *Beyond divergence:* met, the founder-level E lower bound is above 0.10, and the M upper bound is ≤ 0. Evolved genomes beat the founder, random change of the same size does not help, and evolved change beats it.
  - *Partly divergence:* met with E above 0.10 but M upper above 0. Random change of this size may also help, but evolved change beats it.
  - *Purifying selection only:* met but E not above 0.10. Evolved genomes are not clearly better than the founder, but avoid the harm that random change causes.
  - *Not met:* no evidence that evolved change beats random change of the same size. This is not evidence that selection was absent.
- A is evidence against "divergence alone suffices". It is not, by itself, evidence of adaptation over purifying selection; the reading separates the two.

**B (confirmatory, two separate tests: cluster-33 and cluster-139).** A founder meets B if at least 7 of its 8 seed reconstructions are certified against the founder and the study is technically complete. B shows sufficiency only: not necessity, not the only cause of E's advantage, and not slot specificity. For B33, specificity is described by C.

**Six confirmatory tests** (A × 4, B × 2) are reported separately, without a family-wise claim. Under independent seeds and a per-seed success probability of at most ½, each has an exact one-sided tail of 9/256. B139's duplicate genomes weaken that independence; with 6 distinct genomes its false-pass rate can be higher (about 0.03 at a per-genome pass rate of 0.4).

**Technical completeness** requires all 1,200 results, all 8 replays matching, and every audit matching. Otherwise every criterion is reported as not met (technically incomplete).

**Descriptive only:**
- the original pooled block rule (mean contrast over founders per seed) and its whole-block bootstrap, with seed 6480300 and 10,000 resamples, mirroring the frozen study's method;
- founder-level E, M and contrast means;
- the share of E's advantage recovered by R (mean R / mean E);
- for B33, R − C per seed and the number of seeds where R's lower bound exceeds C's upper bound.

**No interim analysis.** The analyzer refuses to report while results are missing, unless the study has been formally stopped with `stop RELEASE REASON`. A stop is permanent.

## Execution, budget and recovery

- **Release gating.** `tools/discovery_divergence_control_run.ts candidate` pins the protocol, the generator's exact roster, the manifest, the frozen report (hash enforced), the resource forecast, the engineering check, all 54 frozen sources, the 7 runner, generator and analyzer sources, and the 8 replay originals. Results, replays and audits are bound to a study identity that excludes the budget. A successor candidate with a larger budget can therefore reuse them, through a dated amendment.
- **Invocations.** Each `run` is one invocation of at most 600 s, matching the frozen runners. It refuses an active lock, an unresolved reservation, an exhausted budget, a stopped study or the storage floor before reserving. It reserves its full time, settles to the actual wall-clock time (sleep is charged), and keeps the full charge on failure.
- **Interruptions.** SIGINT or SIGTERM ends the invocation after the current competition, as failed with the full charge.
- **Supervision.** `supervise` runs invocations in fresh processes. It terminates a child at its reservation plus 120 s and stops on any failure, timeout or lack of progress.
- **Recovery.** After a killed process, `resolve RELEASE REASON` settles that process's reservation as failed and records who resolved it and why. It refuses while the process is alive.
- **Budget:** a 25,000 s cap and 60 invocations, from `divergence-control/resource-forecast.json`. The one-competition engineering check reproduced a frozen result exactly and took 12.5 s, so the projection is about 15,600 s (4.3 hours) for 1,208 competitions plus about 40 audits. Run under `caffeinate -i` so the Mac does not sleep.
- **Placement.** Local-only, owned hardware, $0, with a 20 GiB free-storage floor. Output goes to ignored `runs/founder-discovery-divergence-control-v1/`.

## Implementation and review

- **Tools:**
  - generator: `tools/discovery_divergence_control.ts plan` with `tools/lib/discovery-divergence-control.ts`;
  - runner: `tools/discovery_divergence_control_run.ts`;
  - analyzer: `tools/discovery_divergence_control_analyze.ts analyze RELEASE NEW_REPORT`.
- **Tests:** 25 Deno tests in `tools/test/discovery-divergence-control{,-run,-analyze}.deno.ts`. They cover:
  - the generator's invariants, counts, values and the assignment-pair assertion;
  - every runner guard, replay, audit and recovery path;
  - every decision rule, reading and missingness case;
  - reproduction of the frozen founder effects from E.
- **Independent review (2026-10-02):** CLEAR-WITH-FIXES, no blocking defect. Its design findings were decided by the user:
  - per-founder A, with a reading table;
  - type-matched mutants;
  - assignments 0 and 1, with two mutants per draw;
  - a B33 specificity control.

  Its engineering findings are all addressed:
  - analyzer pinning and report-hash enforcement;
  - 600 s invocations, a watchdog and rotating audits;
  - signal handling, `resolve` and `stop`;
  - the storage check before reserving;
  - re-validated replays, foreign-file checks and study-identity provenance;
  - the specification details above.
- **Seed reservations** were checked against existing records: 6480001–6480128 (mutants), 6480201–6480208 (specificity) and 6480300 (bootstrap). Assay seeds 6430001–6430004 are reused on purpose. Seed 6470001 belongs to the exploration's descriptive null.

## Decisions (user, 2026-10-02)

1. **Mutant null:** magnitude-preserving random change, made type-matched after review.
2. **Assay seeds:** reuse the frozen ones.
3. **Founders in A:** all four, tested per founder after review.
4. **Mutants per draw:** two, funded by dropping duplicate assignments 2 and 3 after review.
5. **Hosts:** local only.
6. **B33 specificity control:** added after review.
