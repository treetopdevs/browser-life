# Divergence control for the founder improvement result — protocol

Status: **DRAFT, 2026-10-02. Not frozen and not released.** Nothing in this document authorizes execution. Before freeze it needs the generator, runner and analyzer described under "Before freeze", passing tests, independent review, a measured resource forecast, a frozen manifest and an explicit release.

## Question

The completed improvement study (`improvement-findings.md`) found that evolved descendants beat their founder head-to-head after one million steps, in 8 of 8 seed blocks. Its disabled arm is an identity control, so it cannot separate selection-driven adaptation from "any genome that has changed this much beats its founder". This protocol tests two things under unchanged RULE_VERSION 1:

- **A. Selection over divergence.** Do evolved descendants beat their founder by more than random mutants carrying the same amount of genetic change?
- **B. Reconstruction.** For the two founders with parallel sweeps (post hoc exploration, `improvement-study/exploration-v1/`), does the single swept change, put alone into the founder, confer a competitive advantage?

Question B was chosen after seeing the data. The values it tests come from that data, but every competition it runs is a new observation. Results stay conditional on the four deliberately discovered founders, the gradient environment and the fixed assay seeds.

## Fixed units

**Evolved arm (E): existing evidence, no new runs.** E is the 64 normal-arm descendant draws at 1,000,000 steps (4 founders × 8 evolution seeds × 2 draws) from the frozen study. Each has 16 scored competitions against its founder in `improvement-study/distribution-v1/analysis-v1/report.json` (SHA-256 `085d55cf…`). E scores are taken from that report by observation id and are not re-run.

**Random-mutant arm (M): 64 new genomes, one per E draw.**
- Let C be the slots where the E draw differs from its founder: 11 to 41 of the 163 mutable slots, which are 160 int8 controller weights, mu, sigma and motility gain. Let the per-slot changes be δ_c.
- The mutant is the founder with the multiset {|δ_c|} placed on |C| slots drawn uniformly without replacement, each given a random sign. The mutant thus matches its E draw exactly in the number of changed slots and in change magnitudes, but where and in which direction the changes fall is random.
- A placement that the slot's bounds would clamp takes the other sign. If both signs clamp, the slot is redrawn. The bounds are weights [−127, 127], mu [16, 4095], sigma [2, 1023] and gain [0, 255].
- Draw k, in report observation order, uses Mulberry32 seed 6480000 + k, for k = 1–64.

**Reconstruction arm (R): two founders × 8 seeds.**
- Each genome is the founder with one slot set to the value that evolved in that seed. That value is the mass-weighted median among founder-lineage genomes at 1M carrying an upward change in the slot. Every seed has carriers.

| Founder | Slot | Founder value | Seeds 6410001 … 6410008 |
| --- | --- | ---: | --- |
| cluster-33 | `b2[PHOTO]` (photosynthesis output bias) | 62 | 97, 73, 76, 72, 86, 99, 82, 100 |
| cluster-139 | `mu` (growth-function centre) | 33 | 49, 55, 46, 57, 49, 47, 47, 54 |

cluster-139 has 6 distinct genomes. Seeds with the same value share identical competitions, so they are linked observations, not independent ones.

## Competition observations

Use the frozen study's competition unchanged: gradient chamber, two radius-12 discs at (64,128) and (192,128), nutrient 32, biomass 64, energy 128, mutation disabled, 20,000 steps. Each M or R genome competes against its own founder, under assay seeds **6430001–6430004** (the same as E, deliberately) and all four position/label assignments: 16 competitions per genome.

- Execution must use the study's frozen sources (the 54 hashes in the operation042 approval) and the same cache-key identity, so new results are comparable with E.
- Score and missingness rules are unchanged. Signed score = (descendant − ancestor associated B/P) / their total. Both-extinct is unavailable and counts as [−1, 1] in bounds. Technical missingness must be repaired or the study declared incomplete.
- **Replay check before any new competition:** re-execute 8 E configurations (two per founder, fixed by the generator) and require byte-identical results. A mismatch stops the study for diagnosis.
- **Counts:** M is 64 × 16 = 1,024 configurations. R is 14 distinct genomes × 16 = 224. The total is 1,248 new configurations plus 8 replay configurations. If distinct configurations exceed 1,256, stop and diagnose.

## Estimands and decision

Average the 16 competitions within each genome, then the two draws within each founder × seed unit, with equal fixed weights. Lower and upper bounds use the full [−1, 1] range for unavailable scores, as in the frozen study.

**A (confirmatory).**
- Per unit, contrast = E − M.
- A seed block's effect is the mean contrast over all four founders. Certify the block if its conservative lower bound (E lower − M upper) exceeds 0.10. Require at least 7 of 8 blocks.
- Report each founder's contrast, and M's own score against the founder: are random changes of this size harmful, neutral or helpful?
- A positive contrast where M is harmful and E is neutral is purifying selection, not adaptation. Read A together with E's positive effect in the frozen study.

**B (confirmatory, two separate tests).**
- For cluster-33 and for cluster-139 separately, certify a seed if its R genome's conservative lower bound against the founder exceeds 0.10. Require at least 7 of 8 seeds.
- These are separate founder-level claims, with no pooled claim. Duplicate cluster-139 genomes weaken the independence assumption behind the 9/256 tail.

**Descriptive only:**
- The share of E's advantage recovered by R (mean R / mean E per founder).
- Mean M score per founder.
- A whole-seed-block bootstrap with seed 6480100 and 10,000 resamples.
- Results for cluster-4 and cluster-16 under A individually.

**Interpretation limits.**
- A met means evolved genomes beat equally changed random genomes. That is evidence that selection shaped the change, conditional on these founders and assay seeds; it is not proof for every founder.
- B met for a founder means that one change is sufficient for an advantage. It does not mean the change is necessary, or the only cause of E's advantage.
- Failing either criterion is not proof of no selection or of equivalence. Three confirmatory tests are reported (A, B33, B139); state each separately, without a family-wise claim.

## Before freeze

1. **Generator** (`tools/discovery_divergence_control.ts plan`). Reads the pinned report and writes a roster: E observation references, all M and R genomes with seeds, the replay sample and every cache key. It refuses non-canonical genomes.
   - *Done 2026-10-02:* `tools/lib/discovery-divergence-control.ts`, with 8 passing tests in `tools/test/discovery-divergence-control.deno.ts`. On the pinned report it produces exactly the counts and reconstruction values above, deterministically. The roster is generated at freeze, not committed now.
2. **Runner.** An additive runner over that roster, reusing the frozen competition execution, cache keys and result validation, with bounded invocations and receipts like the distribution study's.
3. **Analyzer.** Implements the estimands above from the report plus new results.
4. **Tests:**
   - Generator determinism.
   - M preserves slot count and magnitude multiset; clamp handling.
   - Each R genome differs from its founder in exactly one slot.
   - Recomputed E cache keys equal those in the report.
   - Roster counts.
   - The decision rule on synthetic data, including missingness.
5. **Independent review** of code and protocol, then a measured resource forecast and a frozen manifest pinning sources, report, roster and seeds.

**Resources (planning figure, not a guarantee).** The frozen study's competitions took about 11–13 s each, so 1,256 configurations take about 4.5 hours on one Mac. The proposal is local-only, on owned hardware at $0, within a separately released envelope, with a 20 GiB free-storage floor. No paid compute.

**Seed reservations.** These were checked against existing records: 6480001–6480064 for mutant generation and 6480100 for the bootstrap. The assay seeds 6430001–6430004 are reused on purpose. Seed 6470001 belongs to the exploration's descriptive null.

## Decisions (adopted 2026-10-02, user accepted each recommendation)

1. **Random-mutant null.** Recommended: magnitude-preserving shuffle (above). The alternative replays the simulator's mutation operator for the same number of mutation events as the E draw's ancestry path. That is more literal, but it needs lineage paths recomputed from checkpoints, and it matches neither the distance nor the magnitudes exactly.
2. **Assay seeds.** Recommended: reuse 6430001–6430004, so E needs no new runs and conditions are identical. Fresh seeds would add about 1,024 configurations to re-assay E.
3. **Founders in A.** Recommended: all four, as frozen, with per-founder reporting. Restricting A to the three improvers would choose units after seeing outcomes.
4. **Mutants per draw.** Recommended: one (64 in total). Two would halve mutant-sampling noise at about +1,024 configurations.
5. **Hosts.** Recommended: local only, at about 4.5 hours, rather than redeploying to the work Mac.
