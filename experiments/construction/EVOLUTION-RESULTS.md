# Bounded stationary mutation assay: result

The prewritten screen is **negative: 0 of 3 founders count**. Five histories have improved ecological persistence and fresh-seed genome reconstitution, but they cluster in only two seed blocks with strongly overlapping mutation events across founder backgrounds. They are not five independent evolutionary discoveries. The result is an accessible but inconsistent finite improvement in the constructed retention habitat, not a demonstrated population of reproducing, adapting individuals.

The [prospective protocol](EVOLUTION.md) and executed runner are preserved unchanged. All 60 source histories completed, followed by 108 unique transfer assays. The [compact results](evolution-v1.json) include every history, including all 30 extinct mechanism-off histories. Full traces, roles, mutation events, exact ledgers, genomes, hashes, checkpoints and launch snapshots are in `runs/construction/evolution-v1/`.

## Main comparison

Source histories ran 3,000 steps with five seeds per founder and mutation/mechanism on/off. These are three nearby designed starting genomes, differing in BUILD bias, not three independent genetic architectures. Source and transfer worlds start with exactly B1024/E2048 and no initial polymer or dissolved matter. Transfer assays reset the physical state and disable mutation; they reconstruct genomes rather than transplant the accumulated polymer or energy.

All mechanism-on source histories survived. All mechanism-off source histories died, with or without mutation. Final active biomass excludes polymer.

| BUILD bias | Mutation-off final B | Mutation-on final B | Mean ecological gain | Mean transfer gain over ancestor, mechanism on | Combined-improvement histories |
|---|---:|---:|---:|---:|---:|
| 1 | 34.6 | 88.6 | +54.0 | +76.9 | 1/5 |
| 4 | 233.6 | 280.4 | +46.8 | +53.3 | 2/5 |
| 8 | 412.0 | 463.0 | +51.0 | −95.9 | 2/5 |

Every mean uses its original five source histories. For a source extinction, the descendant transfer outcome is zero before subtracting the actual ancestor outcome. Three fresh transfer seeds per genome are repeated assays, not extra independent evolutionary histories.

The fixed rule required positive ecological gain, positive mechanism-on transfer gain and no positive mechanism-off transfer gain in at least three of five histories, with positive mean ecological gain, for at least two founders. None reached three of five. The label remains negative; the positive means do not replace that rule.

## Individual improvements and failures

Five distinct terminal genomes, generated in two shared seed blocks, improved persistence both in their source histories and in every one of their three fresh mechanism-on transfer assays:

| Founder / source seed | Source gain in B | Transferred B, seeds 601/602/603 | Ancestor B on the same seeds | Mean transfer gain |
|---|---:|---|---|---:|
| BUILD1 / 505 | +270 | 460 / 465 / 462 | 84 / 17 / 16 | +423.3 |
| BUILD4 / 504 | +51 | 518 / 528 / 494 | 247 / 228 / 218 | +282.3 |
| BUILD4 / 505 | +227 | 548 / 553 / 536 | 247 / 228 / 218 | +314.7 |
| BUILD8 / 504 | +214 | 698 / 694 / 682 | 407 / 404 / 408 | +285.0 |
| BUILD8 / 505 | +152 | 463 / 468 / 468 | 407 / 404 / 408 | +60.0 |

These gains cluster in source seed blocks504 and505. The same source seeds were paired across founder variants and control arms, so the five improving histories are not five independent seed blocks. In this single-site assay, pairing also shares mutation target/delta draws at common event steps; the dated amendment below quantifies the overlap.

The other ten mechanism-on mutation histories remain in the result: five had zero source gain and five declined. BUILD8's positive source mean did not transfer as a positive mean: its three unsuccessful terminal genomes had mean transfer losses of 359.7, 406.0 and 59.0 B. Persistence late in a history therefore does not necessarily mean the terminal genome can reconstruct that performance from a fresh initial state.

All mechanism-off transfer assays ended at B0, including ancestral controls. This satisfies the prewritten “no gain without the mechanism” sign condition but is an extinction floor: it does not precisely separate variant efficiencies in that habitat. The independently established cost-preserving ablation supports the retention mechanism; this factorial alone does not identify which changes in each improved genome caused its gain.

## Mutation exposure and interpretation

The fixed dose was 4,294,967, approximately one mutation opportunity per 1,000 newly synthesised quanta. Mean event counts in mechanism-on histories were 7.0, 10.6 and 15.4 for BUILD1/4/8; mechanism-off histories averaged 1.0 for each founder. There were 180 mutation events altogether and exactly zero in mutation-off histories. The arms therefore had unequal realised mutation exposure because the mechanism changed persistence and synthesis. Their difference is a total effect, not a comparison at equal mutation counts.

At dtQ=0, spread=0 and motility off, biomass never leaves its founding site. Each mutation replaces that site's genome; there is no surviving parent/offspring pair competing for reproduction. The five gains demonstrate genetically transferable variants encountered during mutation accumulation. They do not show that natural selection among reproducing patches discovered or established those variants. No new cell or organism emerged.

## Verification and bounded closure

- All 168 executed assays maintained exactly constant matter and zero energy-ledger residual at every 100-step census; state validation and off-site biomass/role assertions passed. All mutation events were drained without loss.
- Independent CPU replays of the preselected BUILD1/seed501 mutation-on mechanism-on and mechanism-off histories matched every 100-step GPU state hash, ledger, flux, role snapshot and event count, plus final checkpoint and exact mutation edges, through all 3,000 steps.
- An independent readout audit reconstructed all 360 source/transfer pair rows from raw assay files, checked all 60 source histories and extinction handling, and reproduced the negative 0/3 result.
- All 17 copied launch-source snapshots match their manifest hashes. The independent hash check happened after launch because that additional validation request arrived after GPU acquisition; the immutable snapshots and executed files were preserved.

The fixed experiment is complete. It triggers no dose increase, seed extension, founder replacement or new physics search. Its required reproducibility condition failed, so the conditional second-opportunity test remains unearned. The five portable improvements in two shared seed blocks are retained as dependent observations; they are not reclassified as a second ecological opportunity or as open-ended evolution.

## Reporting amendment — 2026-10-04: shared mutation streams

Claude Fable 5 at High identified that the earlier phrase “five individually transferable improvements” understated dependence across founders. An independent audit of the preserved per-assay JSONs confirms the following. No source protocol, executed runner, original data or pass criterion changed.

| Seed block | Founder pair (BUILD) | Event counts | Events at identical steps | Differing terminal-genome bytes |
|---|---|---|---|---|
| 504 | 4 / 8 | 10 / 20 | 10 | 10 |
| 505 | 1 / 4 | 14 / 16 | 14 | 3 |
| 505 | 1 / 8 | 14 / 21 | 14 | 8 |
| 505 | 4 / 8 | 16 / 21 | 16 | 6 |

Every event in these histories occurs at cell528. The PRNG is keyed by seed, step and cell, so events at the same step draw the same mutation target and proposed delta. Realized changes can differ with starting values and clamping. Each shorter event list above is a subset of the longer one. This is shared mutational input, not merely similar environmental exposure.

There are five distinct terminal genomes, not exactly two identified adaptive variants. The causal mutations have not been isolated. The defensible retained observation is five qualifying histories clustered in two seed blocks, with overlapping trajectories yielding improved genomes on multiple founder backgrounds. That does not establish a shared mutation's effect across backgrounds, nor five independent discoveries. Seeds501–503 remain in all original denominators; the negative0/3 classification is unchanged.

The tracked [compact audit](mutation-overlap-audit.json) records all shared event steps, differing byte offsets and SHA-256 hashes of its five raw input files. It compares `events[].childHi` and `terminalGenome` in the preserved `runs/construction/evolution-v1/source-build-{1,4,8}-seed-{504,505}-mut-1-gate-1.json` files for the five qualifying histories. Future studies must treat shared seeds as statistical blocks; they may retain common random numbers for paired comparisons, but cannot count those arms as independent evolutionary discoveries.
