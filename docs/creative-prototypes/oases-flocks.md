# Flocks under moving food: descriptive follow-up

Recorded with Node v24.2.0 and toy-model rules version 3. Speeds are world widths per tick.

A single-seed browser recording suggested that flocks responded more strongly than pursuit. We then ran all three seeds (1201–1203), all three environments and 6,000 ticks, with mutation on and no tuning. This is a post-observation exploration, not a preselected improvement claim. Family colors denote founding lineages.

| Seed | Environment speed | Final population | Mint / Amber / Lilac | Family loss (100-tick census precision) |
|---|---|---:|---|---|
| 1201 | still | 126 | 44 / 19 / 63 | none |
| 1201 | 0.0001 | 107 | 11 / 55 / 41 | none |
| 1201 | 0.00025 | 81 | 21 / 33 / 27 | none |
| 1202 | still | 125 | 19 / 0 / 106 | Amber first absent at census 3200 |
| 1202 | 0.0001 | 151 | 68 / 0 / 83 | Amber first absent at census 5800 |
| 1202 | 0.00025 | 65 | 44 / 0 / 21 | Amber first absent at census 5200 |
| 1203 | still | 89 | 18 / 71 / 0 | Lilac first absent at census 5500 |
| 1203 | 0.0001 | 125 | 39 / 62 / 24 | none |
| 1203 | 0.00025 | 140 | 28 / 68 / 44 | none |

Moving food changes the outcome, but does not uniformly help or hurt. Faster oases reduce final population in seeds 1201 and 1202; in seed 1203 they increase it, and both moving environments retain Lilac where the still world loses it. Amber disappears in all three environments for seed 1202. Every world remains populated; this is not a claim that every family survives.

These outcomes make changing opportunities worth exploring, without establishing adaptation or an average survival benefit. The same supplied steering operates in every arm. Population and family survival do not by themselves prove that a group followed a particular patch or regrouped.

[Complete census histories and source hashes](oases-flocks.json). Reproduce with `node tools/particles/explore-oases-flocks.ts`; freshness check: `node tools/particles/explore-oases-flocks.ts --check`. The original pursuit pilot remains unchanged in [oases-pilot.md](oases-pilot.md).
