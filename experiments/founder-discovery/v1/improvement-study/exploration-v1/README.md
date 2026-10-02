# Exploratory follow-up to the improvement study — 2026-10-02

Status: **exploratory, post hoc, not confirmatory.** It was run after the frozen analysis (see `../../improvement-findings.md`) to design a divergence control. It uses existing evidence only: no simulation, assay or new randomness enters any biological result. The questions and statistics below were chosen after seeing the confirmatory result, and the slots they highlight were found in the same data. Treat every p-value here as descriptive, and test any claim prospectively.

## Questions

1. What changed genetically in the evolved descendants, and is it the same change across independent seeds?
2. Why did cluster-16 not improve?
3. Was the gain still rising at one million steps?

## Method

- `explore.py` reads the committed operation042 report (hash-checked). That report holds every genome and its mass at 0, 100k and 1M for all 64 histories.
- `trajectory.ts` adds the 8 intermediate checkpoints (200k–900k) per history. It uses the study's own checkpoint decoder and ancestry code, after checking each checkpoint and edge delta against its receipt. Its 0/100k/1M values reproduce the report's frozen samples exactly for all 64 histories.
- Distance is counted in the mutation operator's own units: the number of the 163 mutable slots (160 controller weights, mu, sigma, motility gain) that differ from the founder.
- Parallelism uses each seed's highest-mass genome at 1M, and asks whether the same slot moved in the same direction in more seeds than chance. The null keeps each seed's number of changed slots, draws slots uniformly over 163 and directions at even odds (2,000 draws, seed 6460001). The real mutation operator is uniform over slots, with a slight +1 bias (25/49 upward) and value clamps.
- Compute: about 270 CPU seconds locally, $0. This is outside the study's frozen operation ledger.

## Findings

**Parallel sweeps in the two strongly improving founders, none in cluster-16.**

| Founder | 1M effect | Most shared change across the 8 seeds | Seeds | Null p | Founder → evolved value |
| --- | ---: | --- | ---: | ---: | --- |
| cluster-33 | 0.991 | `b2[PHOTO]` up (photosynthesis output bias) | 8/8 | < 1/2000 | 62 → 72–119 |
| cluster-139 | 0.559 | `mu` up (growth-function centre) | 7/8 | < 1/2000 | 33 → 46–55 |
| cluster-4 | 0.565 | `mu` up; `b2[RESP]` down | 4/8 each | 0.10 | 68 → 78–88; 14 → −8 to −1 |
| cluster-16 | −0.003 | `w2[h0→DECOMP]` up | 4/8 | 0.28 | 59 → 71–81 |

Both sweeps were essentially complete. By 1M, 100% of cluster-33's founder-lineage mass carried the raised `b2[PHOTO]` in 7 of 8 seeds (median 1.00). In cluster-139, a median 95% carried the raised `mu`, at least 76% in every seed.

**Timing (medians over 8 seeds, normal arm):**

| Founder | Sweep share 100k → 200k → 300k → 600k → 1M | Founder-lineage mass 100k → 300k → 1M | Genomes 100k → 1M |
| --- | --- | --- | --- |
| cluster-33 | 0.03 → 0.92 → 1.00 → 1.00 → 1.00 | 0.66M → 0.72M → 0.75M | 47 → 68 |
| cluster-139 | 0.03 → 0.56 → 0.74 → 0.93 → 0.95 | 1.70M → 2.04M → 2.06M | 40 → 450 |
| cluster-4 | 0.01 → 0.02 → 0.02 → 0.13 → 0.21 (`mu`) | 0.94M → 0.97M → 1.09M | 222 → 209 |
| cluster-16 | 0.01 → 0.02 → 0.03 → 0.07 → 0.13 | 2.04M → 2.03M → 2.04M | 401 → 386 |

- **cluster-33:** one early sweep between 100k and 200k. Its 100k competition effect (0.309) caught the sweep starting; by 1M its descendants nearly exclude the founder (0.991).
- **cluster-139:** a slower sweep from 100k to about 600k. Founder-lineage mass rose to about 2.05M by 300k and then stopped rising, while genome count grew to about 450.
- **cluster-4:** no single sweep. Abundance kept rising slowly through 1M. This fits several different routes to improvement and its bimodal competition results, including the one large loss.
- **cluster-16:** abundance stayed flat at about 2.03–2.04M from 100k onward. It diverged the fastest of the four (32 slots by 1M, against 17–25 for the others), but its shared changes are gradual rather than sweeps.

**cluster-16 sits at an apparent abundance ceiling.** Its unmutated founder already holds about 2.02–2.05M founder-lineage mass. That is where cluster-139 ends only after its `mu` sweep, and no founder exceeds about 2.06M. Once a lineage is at this level, abundance stops changing and genome diversity rises to about 400–450, as expected if selection on abundance has run out of room. This is a hypothesis about cluster-16, not a demonstration. Abundance in a monoculture is not competitive ability, the cause of the ceiling (matter, light or space) was not identified, and selection could still act on traits this assay does not measure.

**Divergence alone does not predict winning.**
- At 1M, a drawn descendant's distance from its founder is unrelated or negatively related to its score within founders (Spearman −0.38 to +0.12).
- cluster-16's descendants are the most diverged and gain nothing.
- At 100k the relationship is positive (up to +0.83 for cluster-33), when the drawn genomes that had changed were mostly carriers of the sweep.

**Was the gain still rising at 1M?** Competitive scores exist only at 100k and 1M, so this can't be answered for competition. By the abundance proxy, cluster-33 and cluster-139 had plateaued well before 1M, and cluster-16 never moved. Only cluster-4 was still rising. Genetic divergence kept accumulating roughly linearly in all four, so evolution continued while abundance mostly did not. cluster-33's competition score is already at its ceiling (0.99), so it cannot show further gain in this assay.

## What this suggests for the divergence control (option 1)

- **Reconstruction arm.** Put only the sweep allele into the founder: cluster-33 with `b2[PHOTO]` raised to an evolved value, and cluster-139 with `mu` raised. Compete each against the unchanged founder. If one slot change reproduces most of the advantage, that is direct evidence that a selected change, not divergence, caused it.
- **Random-mutant arm.** Use the same mutation operator for the same number of slot changes as the evolved draws: about 2–3 slots at 100k and 17–32 at 1M, per founder. cluster-16 suggests this will not produce wins, but that is one founder and not a controlled test.
- **Optional timing arm.** Competition at 200k, just after cluster-33's sweep, would test whether its competitive gain coincides with the sweep.
- Fix the choice of reconstruction values and the random-mutant seeds before running, in a new frozen protocol. The slots named here came from this data, so the reconstruction arm tests a specific hypothesis rather than searching for one.

## Files and provenance

- `explore.py` writes `results.json` (SHA-256 `293d0b8ca78a100754322d2690f4c5fb83768f366ae1c6f657a3761ea6687430`). It reads `../distribution-v1/analysis-v1/report.json` (`085d55cf…`) and, if present, the trajectory.
- `trajectory.ts` writes `runs/founder-discovery-improvement-exploration-v1/trajectory.jsonl` (ignored, about 30 MB, SHA-256 `eca81f31f0810300bcf45a4b66e77c8cf93a9202edf0cd4508792b7ab15f3924`), with 704 rows: 64 histories × 11 checkpoints.
- Re-run with:
  - `deno run --no-lock -A experiments/founder-discovery/v1/improvement-study/exploration-v1/trajectory.ts runs/founder-discovery-improvement-consolidated-v1/histories <new.jsonl>`
  - `PYTHONDONTWRITEBYTECODE=1 python3 experiments/founder-discovery/v1/improvement-study/exploration-v1/explore.py`
