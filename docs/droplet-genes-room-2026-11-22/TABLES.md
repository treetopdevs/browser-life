**Outcome on the coordinator's grid: room found.** Largest K held at the frontier stage with a parasite source present in effect: 6.

**With the added rate `b4096` included: room found.** Largest K held at the frontier stage with a parasite source present in effect: 6.


## Stage 1, clean gate (no parasite source, gated, seeds 1 and 2, 50,000 steps)

Seeds held of 2; a cell goes on only on 2 of 2. In brackets: where each seed that was not held was lost (step the run ended).

| source | physics | sites | K = 2 | K = 3 | K = 4 | K = 6 | K = 8 |
|---|---|---|---|---|---|---|---|
| A | `LARGE` | 16 | 2 of 2, 49.4 to 49.5 comps | 2 of 2, 31.7 to 32.8 comps | 2 of 2, 10.7 to 14.2 comps | 0 of 2 [lost early (1,400); lost early (1,450)] | 0 of 2 [lost at the founders (350); lost at the founders (400)] |
| A | `LARGE` | 64 | 2 of 2, 65.5 to 66.0 comps | 2 of 2, 52.2 to 53.0 comps | 2 of 2, 40.8 to 41.3 comps | 2 of 2, 21.0 to 22.8 comps | 0 of 2 [lost late (23,900); lost late (24,200)] |
| A | fuel only | 16 | 2 of 2, 81.6 to 81.7 comps | 2 of 2, 41.0 to 41.5 comps | 1 of 2, 11.8 comps [lost late (28,350)] | 0 of 2 [lost early (1,900); lost early (1,550)] | 0 of 2 [lost at the founders (650); lost at the founders (550)] |
| A | fuel only | 64 | 2 of 2, 131.2 to 135.5 comps | 2 of 2, 108.4 to 110.0 comps | 2 of 2, 79.4 to 79.7 comps | 2 of 2, 32.1 to 34.9 comps | 0 of 2 [lost early (4,350); lost early (8,650)] |
| B | `LARGE` | 16 | 2 of 2, 48.5 to 49.8 comps | 2 of 2, 31.0 to 33.4 comps | 2 of 2, 11.8 to 13.2 comps | 0 of 2 [lost early (1,350); lost early (1,200)] | 0 of 2 [lost at the founders (500); lost at the founders (350)] |
| B | `LARGE` | 64 | 2 of 2, 65.3 to 66.5 comps | 2 of 2, 51.6 to 54.1 comps | 2 of 2, 40.9 to 42.8 comps | 2 of 2, 22.4 to 23.6 comps | 0 of 2 [lost early (3,800); lost late (11,800)] |
| B | fuel only | 16 | 2 of 2, 76.7 to 82.6 comps | 2 of 2, 36.4 to 38.8 comps | 1 of 2, 13.1 comps [lost late (11,950)] | 0 of 2 [lost early (1,200); lost at the founders (950)] | 0 of 2 [lost at the founders (500); lost at the founders (550)] |
| B | fuel only | 64 | 2 of 2, 130.3 to 132.2 comps | 2 of 2, 108.5 to 109.7 comps | 2 of 2, 80.5 to 82.6 comps | 2 of 2, 31.6 to 32.2 comps | 0 of 2 [lost early (2,950); lost early (8,200)] |

## Stage 2, parasite screen (gated, seeds 1 and 2, 50,000 steps)

Seeds held of 2; a cell is alive on at least 1 of 2. "gate" = did not pass stage 1.

| parasite setting | physics | sites | K = 2 | K = 3 | K = 4 | K = 6 | K = 8 |
|---|---|---|---|---|---|---|---|
| A, mutPar 1e-4 | `LARGE` | 16 | 2 of 2 | 2 of 2 | 0 of 2 [lost early (6,400); lost early (7,950)] | gate | gate |
| A, mutPar 1e-4 | `LARGE` | 64 | 0 of 2 [lost late (11,050); lost late (13,900)] | 0 of 2 [lost early (7,650); lost late (12,250)] | 0 of 2 [lost late (11,650); lost late (14,550)] | 0 of 2 [lost early (3,650); lost early (3,600)] | gate |
| A, mutPar 1e-4 | fuel only | 16 | 2 of 2 | 1 of 2 [lost late (46,200)] | gate | gate | gate |
| A, mutPar 1e-4 | fuel only | 64 | 0 of 2 [lost late (12,450); lost early (7,750)] | 0 of 2 [lost late (18,050); lost late (15,050)] | 0 of 2 [lost early (6,150); lost early (6,150)] | 0 of 2 [lost early (4,100); lost early (5,550)] | gate |
| A, mutPar 1e-5 | `LARGE` | 16 | 2 of 2 | 2 of 2 | 2 of 2 | gate | gate |
| A, mutPar 1e-5 | `LARGE` | 64 | 2 of 2 | 2 of 2 | 2 of 2 | 2 of 2 | gate |
| A, mutPar 1e-5 | fuel only | 16 | 2 of 2 | 2 of 2 | gate | gate | gate |
| A, mutPar 1e-5 | fuel only | 64 | 2 of 2 | 2 of 2 | 2 of 2 | 2 of 2 | gate |
| A, mutPar 1e-6 | `LARGE` | 16 | 2 of 2 | 2 of 2 | 2 of 2 | gate | gate |
| A, mutPar 1e-6 | `LARGE` | 64 | 2 of 2 | 2 of 2 | 2 of 2 | 2 of 2 | gate |
| A, mutPar 1e-6 | fuel only | 16 | 2 of 2 | 2 of 2 | gate | gate | gate |
| A, mutPar 1e-6 | fuel only | 64 | 2 of 2 | 2 of 2 | 2 of 2 | 2 of 2 | gate |
| B, mutLevel 1/64 | `LARGE` | 16 | 0 of 2 [lost early (1,100); lost early (1,650)] | 0 of 2 [lost at the founders (950); lost early (1,500)] | 0 of 2 [lost at the founders (1,000); lost early (1,550)] | gate | gate |
| B, mutLevel 1/64 | `LARGE` | 64 | 0 of 2 [lost early (1,500); lost early (1,600)] | 0 of 2 [lost at the founders (900); lost at the founders (800)] | 0 of 2 [lost at the founders (700); lost at the founders (700)] | 0 of 2 [lost at the founders (650); lost at the founders (600)] | gate |
| B, mutLevel 1/64 | fuel only | 16 | 0 of 2 [lost early (1,350); lost early (1,400)] | 0 of 2 [lost early (1,150); lost at the founders (1,000)] | gate | gate | gate |
| B, mutLevel 1/64 | fuel only | 64 | 0 of 2 [lost early (1,750); lost early (3,150)] | 0 of 2 [lost early (1,100); lost at the founders (900)] | 0 of 2 [lost at the founders (750); lost at the founders (800)] | 0 of 2 [lost at the founders (550); lost at the founders (600)] | gate |
| B, mutLevel 1/256 | `LARGE` | 16 | 0 of 2 [lost early (4,850); lost late (23,050)] | 0 of 2 [lost early (6,950); lost early (5,850)] | 0 of 2 [lost early (2,400); lost early (1,750)] | gate | gate |
| B, mutLevel 1/256 | `LARGE` | 64 | 0 of 2 [lost early (1,500); lost at the founders (1,000)] | 0 of 2 [lost early (1,300); lost early (1,150)] | 0 of 2 [lost at the founders (1,000); lost at the founders (850)] | 0 of 2 [lost at the founders (850); lost at the founders (850)] | gate |
| B, mutLevel 1/256 | fuel only | 16 | 0 of 2 [lost early (2,800); lost early (3,300)] | 0 of 2 [lost early (2,200); lost early (2,100)] | gate | gate | gate |
| B, mutLevel 1/256 | fuel only | 64 | 0 of 2 [lost early (1,200); lost early (1,300)] | 0 of 2 [lost early (1,050); lost early (1,050)] | 0 of 2 [lost at the founders (850); lost at the founders (1,000)] | 0 of 2 [lost at the founders (900); lost at the founders (800)] | gate |
| B, mutLevel 1/4096 | `LARGE` | 16 | 2 of 2 | 2 of 2 | 0 of 2 [lost below the bar at the end; lost early (7,050)] | gate | gate |
| B, mutLevel 1/4096 | `LARGE` | 64 | 2 of 2 | 1 of 2 [lost late (13,650)] | 2 of 2 | 0 of 2 [lost late (14,650); lost late (11,800)] | gate |
| B, mutLevel 1/4096 | fuel only | 16 | 2 of 2 | 2 of 2 | gate | gate | gate |
| B, mutLevel 1/4096 | fuel only | 64 | 0 of 2 [lost late (35,000); lost late (17,500)] | 0 of 2 [lost late (11,600); lost late (11,500)] | 0 of 2 [lost late (11,150); lost late (14,100)] | 0 of 2 [lost late (14,950); lost early (5,400)] | gate |

## Stage 3, the frontier (seeds 1 to 4, 200,000 steps)

| parasite setting | physics | sites | alive after stage 2 | largest K held | largest K held, parasite in effect | cells run (K: seeds held of 4, seeds holding against the parasite, label) | clean gate, K passed at 50,000 |
|---|---|---|---|---|---|---|---|
| A, mutPar 1e-4 | `LARGE` | 16 | 2, 3 | 3 | 3 | K 3: 3 of 4, 3 against, held, parasite in effect; K 4: 0 of 2 (seeds run so far), 0 against, not held | 2, 3, 4 |
| A, mutPar 1e-4 | `LARGE` | 64 | none | none | none | K 2: 0 of 2 (seeds run so far), 0 against, not held | 2, 3, 4, 6 |
| A, mutPar 1e-4 | fuel only | 16 | 2, 3 | 2 | 2 | K 2: 4 of 4, 4 against, held, parasite in effect; K 3: 0 of 4, 0 against, not held; K 4: 0 of 4, 0 against, not held | 2, 3 |
| A, mutPar 1e-4 | fuel only | 64 | none | none | none | K 2: 0 of 2 (seeds run so far), 0 against, not held | 2, 3, 4, 6 |
| A, mutPar 1e-5 | `LARGE` | 16 | 2, 3, 4 | 4 | 4 | K 4: 4 of 4, 4 against, held, parasite in effect; K 6: 0 of 4, 0 against, not held | 2, 3, 4 |
| A, mutPar 1e-5 | `LARGE` | 64 | 2, 3, 4, 6 | 6 | 6 | K 6: 4 of 4, 4 against, held, parasite in effect; K 8: 0 of 4, 0 against, not held | 2, 3, 4, 6 |
| A, mutPar 1e-5 | fuel only | 16 | 2, 3 | 3 | 3 | K 3: 4 of 4, 3 against, held, parasite in effect; K 4: 0 of 4, 0 against, not held | 2, 3 |
| A, mutPar 1e-5 | fuel only | 64 | 2, 3, 4, 6 | 6 | 6 | K 6: 4 of 4, 4 against, held, parasite in effect; K 8: 0 of 4, 0 against, not held | 2, 3, 4, 6 |
| A, mutPar 1e-6 | `LARGE` | 16 | 2, 3, 4 | 4 | not established (a held cell does not count; nothing below it was run) | K 4: 4 of 4, 0 against, held, parasite absent in effect; K 6: 0 of 4, 0 against, not held | 2, 3, 4 |
| A, mutPar 1e-6 | `LARGE` | 64 | 2, 3, 4, 6 | 6 | not established (a held cell does not count; nothing below it was run) | K 6: 4 of 4, 1 against, held, parasite absent in effect; K 8: 0 of 4, 0 against, not held | 2, 3, 4, 6 |
| A, mutPar 1e-6 | fuel only | 16 | 2, 3 | 3 | not established (a held cell does not count; nothing below it was run) | K 3: 4 of 4, 1 against, held, parasite absent in effect; K 4: 1 of 4, 0 against, not held | 2, 3 |
| A, mutPar 1e-6 | fuel only | 64 | 2, 3, 4, 6 | 6 | not established (a held cell does not count; nothing below it was run) | K 6: 4 of 4, 0 against, held, parasite absent in effect; K 8: 0 of 4, 0 against, not held | 2, 3, 4, 6 |
| B, mutLevel 1/64 | `LARGE` | 16 | none | none | none | K 2: 0 of 2 (seeds run so far), 0 against, not held | 2, 3, 4 |
| B, mutLevel 1/64 | `LARGE` | 64 | none | none | none | K 2: 0 of 2 (seeds run so far), 0 against, not held | 2, 3, 4, 6 |
| B, mutLevel 1/64 | fuel only | 16 | none | none | none | K 2: 0 of 2 (seeds run so far), 0 against, not held | 2, 3 |
| B, mutLevel 1/64 | fuel only | 64 | none | none | none | K 2: 0 of 2 (seeds run so far), 0 against, not held | 2, 3, 4, 6 |
| B, mutLevel 1/256 | `LARGE` | 16 | none | none | none | K 2: 0 of 2 (seeds run so far), 0 against, not held | 2, 3, 4 |
| B, mutLevel 1/256 | `LARGE` | 64 | none | none | none | K 2: 0 of 2 (seeds run so far), 0 against, not held | 2, 3, 4, 6 |
| B, mutLevel 1/256 | fuel only | 16 | none | none | none | K 2: 0 of 2 (seeds run so far), 0 against, not held | 2, 3 |
| B, mutLevel 1/256 | fuel only | 64 | none | none | none | K 2: 0 of 2 (seeds run so far), 0 against, not held | 2, 3, 4, 6 |
| B, mutLevel 1/4096 (added) | `LARGE` | 16 | 2, 3 | 3 | 3 | K 3: 4 of 4, 4 against, held, parasite in effect; K 4: 1 of 4, 1 against, not held | 2, 3, 4 |
| B, mutLevel 1/4096 (added) | `LARGE` | 64 | 2, 3, 4 | 3 | 3 | K 3: 3 of 4, 3 against, held, parasite in effect; K 4: 2 of 4, 2 against, not held; K 6: 0 of 2 (seeds run so far), 0 against, not held | 2, 3, 4, 6 |
| B, mutLevel 1/4096 (added) | fuel only | 16 | 2, 3 | 3 | 3 | K 3: 4 of 4, 4 against, held, parasite in effect; K 4: 0 of 4, 0 against, not held | 2, 3 |
| B, mutLevel 1/4096 (added) | fuel only | 64 | none | none | none | K 2: 0 of 2 (seeds run so far), 0 against, not held | 2, 3, 4, 6 |

### Frontier cells, per seed (gated, with the parasite source)

Share: late share of all copies that are the parasite (A) or at the top level (B), arena-wide. Level: late mean level inside compartments (B). Copies per gene: late copies per compartment x (1 - parasite or top-level share) / K.

| parasite setting | physics | sites | K | seed | result | late compartments | complete share | share (floor) | level | copies per compartment | copies per gene | holds against |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| A, mutPar 1e-4 | fuel only | 16 | 2 | 1 | held | 64.7 | 0.957 | 0.0979 (0.0050) | n/a | 76.4 | 34.4 | yes |
| A, mutPar 1e-4 | fuel only | 16 | 2 | 2 | held | 60.8 | 0.961 | 0.1054 (0.0050) | n/a | 82.4 | 36.9 | yes |
| A, mutPar 1e-4 | fuel only | 16 | 2 | 3 | held | 64.8 | 0.961 | 0.1215 (0.0050) | n/a | 77.8 | 34.2 | yes |
| A, mutPar 1e-4 | fuel only | 16 | 2 | 4 | held | 62.8 | 0.959 | 0.1174 (0.0050) | n/a | 80.8 | 35.6 | yes |
| A, mutPar 1e-4 | fuel only | 16 | 3 | 1 | lost late (136,200) | 0.0 | 0.000 | n/a (0.0050) | n/a | n/a | n/a | no |
| A, mutPar 1e-4 | fuel only | 16 | 3 | 2 | lost late (46,200) [carried] | 0.0 | 0.000 | n/a (0.0050) | n/a | n/a | n/a | no |
| A, mutPar 1e-4 | fuel only | 16 | 3 | 3 | lost late (69,700) | 0.0 | 0.000 | n/a (0.0050) | n/a | n/a | n/a | no |
| A, mutPar 1e-4 | fuel only | 16 | 3 | 4 | lost late (68,500) | 0.0 | 0.000 | n/a (0.0050) | n/a | n/a | n/a | no |
| A, mutPar 1e-4 | fuel only | 16 | 4 | 1 | lost early (8,050) | 0.0 | 0.000 | n/a (0.0050) | n/a | n/a | n/a | no |
| A, mutPar 1e-4 | fuel only | 16 | 4 | 2 | lost early (3,550) | 0.0 | 0.000 | n/a (0.0050) | n/a | n/a | n/a | no |
| A, mutPar 1e-4 | fuel only | 16 | 4 | 3 | lost early (3,150) | 0.0 | 0.000 | n/a (0.0050) | n/a | n/a | n/a | no |
| A, mutPar 1e-4 | fuel only | 16 | 4 | 4 | lost early (4,750) | 0.0 | 0.000 | n/a (0.0050) | n/a | n/a | n/a | no |
| A, mutPar 1e-4 | fuel only | 64 | 2 | 1 | lost late (12,450) [carried] | 0.0 | 0.000 | n/a (0.0050) | n/a | n/a | n/a | no |
| A, mutPar 1e-4 | fuel only | 64 | 2 | 2 | lost early (7,750) [carried] | 0.0 | 0.000 | n/a (0.0050) | n/a | n/a | n/a | no |
| A, mutPar 1e-4 | fuel only | 64 | 2 | 3 | not run | | | | | | | |
| A, mutPar 1e-4 | fuel only | 64 | 2 | 4 | not run | | | | | | | |
| A, mutPar 1e-4 | `LARGE` | 16 | 3 | 1 | held | 15.9 | 0.978 | 0.1131 (0.0050) | n/a | 121.4 | 35.9 | yes |
| A, mutPar 1e-4 | `LARGE` | 16 | 3 | 2 | held | 18.0 | 0.976 | 0.1003 (0.0050) | n/a | 115.5 | 34.6 | yes |
| A, mutPar 1e-4 | `LARGE` | 16 | 3 | 3 | lost late (46,850) | 0.0 | 0.000 | n/a (0.0050) | n/a | n/a | n/a | no |
| A, mutPar 1e-4 | `LARGE` | 16 | 3 | 4 | held | 17.2 | 0.978 | 0.1288 (0.0050) | n/a | 115.8 | 33.6 | yes |
| A, mutPar 1e-4 | `LARGE` | 16 | 4 | 1 | lost early (6,400) [carried] | 0.0 | 0.000 | n/a (0.0050) | n/a | n/a | n/a | no |
| A, mutPar 1e-4 | `LARGE` | 16 | 4 | 2 | lost early (7,950) [carried] | 0.0 | 0.000 | n/a (0.0050) | n/a | n/a | n/a | no |
| A, mutPar 1e-4 | `LARGE` | 16 | 4 | 3 | not run | | | | | | | |
| A, mutPar 1e-4 | `LARGE` | 16 | 4 | 4 | not run | | | | | | | |
| A, mutPar 1e-4 | `LARGE` | 64 | 2 | 1 | lost late (11,050) [carried] | 0.0 | 0.000 | n/a (0.0050) | n/a | n/a | n/a | no |
| A, mutPar 1e-4 | `LARGE` | 64 | 2 | 2 | lost late (13,900) [carried] | 0.0 | 0.000 | n/a (0.0050) | n/a | n/a | n/a | no |
| A, mutPar 1e-4 | `LARGE` | 64 | 2 | 3 | not run | | | | | | | |
| A, mutPar 1e-4 | `LARGE` | 64 | 2 | 4 | not run | | | | | | | |
| A, mutPar 1e-5 | fuel only | 16 | 3 | 1 | held | 40.7 | 0.948 | 0.0116 (0.0050) | n/a | 96.2 | 31.7 | yes |
| A, mutPar 1e-5 | fuel only | 16 | 3 | 2 | held | 41.2 | 0.950 | 0.0031 (0.0050) | n/a | 95.1 | 31.6 | no (below the floor) |
| A, mutPar 1e-5 | fuel only | 16 | 3 | 3 | held | 39.2 | 0.949 | 0.0157 (0.0050) | n/a | 97.2 | 31.9 | yes |
| A, mutPar 1e-5 | fuel only | 16 | 3 | 4 | held | 40.2 | 0.953 | 0.0138 (0.0050) | n/a | 96.3 | 31.7 | yes |
| A, mutPar 1e-5 | fuel only | 16 | 4 | 1 | lost late (102,650) | 0.0 | 0.000 | n/a (0.0050) | n/a | n/a | n/a | no |
| A, mutPar 1e-5 | fuel only | 16 | 4 | 2 | lost late (121,850) | 0.0 | 0.000 | n/a (0.0050) | n/a | n/a | n/a | no |
| A, mutPar 1e-5 | fuel only | 16 | 4 | 3 | lost late (113,250) | 0.0 | 0.000 | n/a (0.0050) | n/a | n/a | n/a | no |
| A, mutPar 1e-5 | fuel only | 16 | 4 | 4 | lost late (91,150) | 0.0 | 0.000 | n/a (0.0050) | n/a | n/a | n/a | no |
| A, mutPar 1e-5 | fuel only | 64 | 6 | 1 | held | 26.9 | 0.949 | 0.0301 (0.0050) | n/a | 424.4 | 68.6 | yes |
| A, mutPar 1e-5 | fuel only | 64 | 6 | 2 | held | 32.0 | 0.950 | 0.0147 (0.0050) | n/a | 429.9 | 70.6 | yes |
| A, mutPar 1e-5 | fuel only | 64 | 6 | 3 | held | 27.1 | 0.948 | 0.0380 (0.0050) | n/a | 440.8 | 70.7 | yes |
| A, mutPar 1e-5 | fuel only | 64 | 6 | 4 | held | 29.3 | 0.948 | 0.0179 (0.0050) | n/a | 424.8 | 69.5 | yes |
| A, mutPar 1e-5 | fuel only | 64 | 8 | 1 | lost early (8,250) | 0.0 | 0.000 | n/a (0.0050) | n/a | n/a | n/a | no |
| A, mutPar 1e-5 | fuel only | 64 | 8 | 2 | lost early (7,550) | 0.0 | 0.000 | n/a (0.0050) | n/a | n/a | n/a | no |
| A, mutPar 1e-5 | fuel only | 64 | 8 | 3 | lost early (5,150) | 0.0 | 0.000 | n/a (0.0050) | n/a | n/a | n/a | no |
| A, mutPar 1e-5 | fuel only | 64 | 8 | 4 | lost early (5,500) | 0.0 | 0.000 | n/a (0.0050) | n/a | n/a | n/a | no |
| A, mutPar 1e-5 | `LARGE` | 16 | 4 | 1 | held | 10.6 | 0.979 | 0.0190 (0.0050) | n/a | 136.9 | 33.6 | yes |
| A, mutPar 1e-5 | `LARGE` | 16 | 4 | 2 | held | 13.4 | 0.980 | 0.0055 (0.0050) | n/a | 133.1 | 33.1 | yes |
| A, mutPar 1e-5 | `LARGE` | 16 | 4 | 3 | held | 13.0 | 0.975 | 0.0084 (0.0050) | n/a | 125.5 | 31.1 | yes |
| A, mutPar 1e-5 | `LARGE` | 16 | 4 | 4 | held | 11.2 | 0.979 | 0.0124 (0.0050) | n/a | 125.6 | 31.0 | yes |
| A, mutPar 1e-5 | `LARGE` | 16 | 6 | 1 | lost early (1,700) | 0.0 | 0.000 | n/a (0.0050) | n/a | n/a | n/a | no |
| A, mutPar 1e-5 | `LARGE` | 16 | 6 | 2 | lost early (1,250) | 0.0 | 0.000 | n/a (0.0050) | n/a | n/a | n/a | no |
| A, mutPar 1e-5 | `LARGE` | 16 | 6 | 3 | lost early (1,300) | 0.0 | 0.000 | n/a (0.0050) | n/a | n/a | n/a | no |
| A, mutPar 1e-5 | `LARGE` | 16 | 6 | 4 | lost early (1,500) | 0.0 | 0.000 | n/a (0.0050) | n/a | n/a | n/a | no |
| A, mutPar 1e-5 | `LARGE` | 64 | 6 | 1 | held | 17.8 | 0.978 | 0.0104 (0.0050) | n/a | 471.5 | 77.8 | yes |
| A, mutPar 1e-5 | `LARGE` | 64 | 6 | 2 | held | 20.5 | 0.981 | 0.0232 (0.0050) | n/a | 461.2 | 75.1 | yes |
| A, mutPar 1e-5 | `LARGE` | 64 | 6 | 3 | held | 19.4 | 0.980 | 0.0178 (0.0050) | n/a | 457.8 | 74.9 | yes |
| A, mutPar 1e-5 | `LARGE` | 64 | 6 | 4 | held | 20.1 | 0.979 | 0.0155 (0.0050) | n/a | 493.7 | 81.0 | yes |
| A, mutPar 1e-5 | `LARGE` | 64 | 8 | 1 | lost early (8,250) | 0.0 | 0.000 | n/a (0.0050) | n/a | n/a | n/a | no |
| A, mutPar 1e-5 | `LARGE` | 64 | 8 | 2 | lost early (4,500) | 0.0 | 0.000 | n/a (0.0050) | n/a | n/a | n/a | no |
| A, mutPar 1e-5 | `LARGE` | 64 | 8 | 3 | lost late (10,500) | 0.0 | 0.000 | n/a (0.0050) | n/a | n/a | n/a | no |
| A, mutPar 1e-5 | `LARGE` | 64 | 8 | 4 | lost early (9,850) | 0.0 | 0.000 | n/a (0.0050) | n/a | n/a | n/a | no |
| A, mutPar 1e-6 | fuel only | 16 | 3 | 1 | held | 40.5 | 0.954 | 0.0060 (0.0050) | n/a | 104.5 | 34.6 | yes |
| A, mutPar 1e-6 | fuel only | 16 | 3 | 2 | held | 40.7 | 0.952 | 0.0004 (0.0050) | n/a | 97.2 | 32.4 | no (below the floor) |
| A, mutPar 1e-6 | fuel only | 16 | 3 | 3 | held | 40.3 | 0.954 | 0.0024 (0.0050) | n/a | 99.2 | 33.0 | no (below the floor) |
| A, mutPar 1e-6 | fuel only | 16 | 3 | 4 | held | 40.8 | 0.949 | 0.0029 (0.0050) | n/a | 90.7 | 30.2 | no (below the floor) |
| A, mutPar 1e-6 | fuel only | 16 | 4 | 1 | lost late (46,900) | 0.0 | 0.000 | n/a (0.0050) | n/a | n/a | n/a | no |
| A, mutPar 1e-6 | fuel only | 16 | 4 | 2 | lost late (186,200) | 2.7 | 0.940 | 0.0000 (0.0050) | n/a | 133.7 | 33.4 | no |
| A, mutPar 1e-6 | fuel only | 16 | 4 | 3 | held | 11.4 | 0.942 | 0.0047 (0.0050) | n/a | 130.5 | 32.5 | no (below the floor) |
| A, mutPar 1e-6 | fuel only | 16 | 4 | 4 | lost late (84,900) | 0.0 | 0.000 | n/a (0.0050) | n/a | n/a | n/a | no |
| A, mutPar 1e-6 | fuel only | 64 | 6 | 1 | held | 36.4 | 0.949 | 0.0000 (0.0050) | n/a | 403.3 | 67.2 | no (below the floor) |
| A, mutPar 1e-6 | fuel only | 64 | 6 | 2 | held | 33.9 | 0.949 | 0.0028 (0.0050) | n/a | 427.3 | 71.0 | no (below the floor) |
| A, mutPar 1e-6 | fuel only | 64 | 6 | 3 | held | 31.0 | 0.952 | 0.0023 (0.0050) | n/a | 417.8 | 69.5 | no (below the floor) |
| A, mutPar 1e-6 | fuel only | 64 | 6 | 4 | held | 32.8 | 0.949 | 0.0046 (0.0050) | n/a | 426.9 | 70.8 | no (below the floor) |
| A, mutPar 1e-6 | fuel only | 64 | 8 | 1 | lost late (11,850) | 0.0 | 0.000 | n/a (0.0050) | n/a | n/a | n/a | no |
| A, mutPar 1e-6 | fuel only | 64 | 8 | 2 | lost early (7,800) | 0.0 | 0.000 | n/a (0.0050) | n/a | n/a | n/a | no |
| A, mutPar 1e-6 | fuel only | 64 | 8 | 3 | lost early (2,900) | 0.0 | 0.000 | n/a (0.0050) | n/a | n/a | n/a | no |
| A, mutPar 1e-6 | fuel only | 64 | 8 | 4 | lost late (10,550) | 0.0 | 0.000 | n/a (0.0050) | n/a | n/a | n/a | no |
| A, mutPar 1e-6 | `LARGE` | 16 | 4 | 1 | held | 14.2 | 0.979 | 0.0006 (0.0050) | n/a | 124.7 | 31.2 | no (below the floor) |
| A, mutPar 1e-6 | `LARGE` | 16 | 4 | 2 | held | 14.1 | 0.978 | 0.0000 (0.0050) | n/a | 130.5 | 32.6 | no (below the floor) |
| A, mutPar 1e-6 | `LARGE` | 16 | 4 | 3 | held | 14.1 | 0.978 | 0.0001 (0.0050) | n/a | 123.2 | 30.8 | no (below the floor) |
| A, mutPar 1e-6 | `LARGE` | 16 | 4 | 4 | held | 13.8 | 0.979 | 0.0011 (0.0050) | n/a | 129.3 | 32.3 | no (below the floor) |
| A, mutPar 1e-6 | `LARGE` | 16 | 6 | 1 | lost early (1,400) | 0.0 | 0.000 | n/a (0.0050) | n/a | n/a | n/a | no |
| A, mutPar 1e-6 | `LARGE` | 16 | 6 | 2 | lost early (1,450) | 0.0 | 0.000 | n/a (0.0050) | n/a | n/a | n/a | no |
| A, mutPar 1e-6 | `LARGE` | 16 | 6 | 3 | lost early (1,200) | 0.0 | 0.000 | n/a (0.0050) | n/a | n/a | n/a | no |
| A, mutPar 1e-6 | `LARGE` | 16 | 6 | 4 | lost early (1,600) | 0.0 | 0.000 | n/a (0.0050) | n/a | n/a | n/a | no |
| A, mutPar 1e-6 | `LARGE` | 64 | 6 | 1 | held | 21.6 | 0.983 | 0.0015 (0.0050) | n/a | 471.3 | 78.4 | no (below the floor) |
| A, mutPar 1e-6 | `LARGE` | 64 | 6 | 2 | held | 22.0 | 0.982 | 0.0006 (0.0050) | n/a | 474.0 | 78.9 | no (below the floor) |
| A, mutPar 1e-6 | `LARGE` | 64 | 6 | 3 | held | 20.8 | 0.983 | 0.0053 (0.0050) | n/a | 484.1 | 80.3 | yes |
| A, mutPar 1e-6 | `LARGE` | 64 | 6 | 4 | held | 21.6 | 0.983 | 0.0001 (0.0050) | n/a | 483.6 | 80.6 | no (below the floor) |
| A, mutPar 1e-6 | `LARGE` | 64 | 8 | 1 | lost early (8,100) | 0.0 | 0.000 | n/a (0.0050) | n/a | n/a | n/a | no |
| A, mutPar 1e-6 | `LARGE` | 64 | 8 | 2 | lost late (17,800) | 0.0 | 0.000 | n/a (0.0050) | n/a | n/a | n/a | no |
| A, mutPar 1e-6 | `LARGE` | 64 | 8 | 3 | lost early (6,000) | 0.0 | 0.000 | n/a (0.0050) | n/a | n/a | n/a | no |
| A, mutPar 1e-6 | `LARGE` | 64 | 8 | 4 | lost late (14,250) | 0.0 | 0.000 | n/a (0.0050) | n/a | n/a | n/a | no |
| B, mutLevel 1/64 | fuel only | 16 | 2 | 1 | lost early (1,350) [carried] | 0.0 | 0.000 | n/a (0.0156) | n/a | n/a | n/a | no |
| B, mutLevel 1/64 | fuel only | 16 | 2 | 2 | lost early (1,400) [carried] | 0.0 | 0.000 | n/a (0.0156) | n/a | n/a | n/a | no |
| B, mutLevel 1/64 | fuel only | 16 | 2 | 3 | not run | | | | | | | |
| B, mutLevel 1/64 | fuel only | 16 | 2 | 4 | not run | | | | | | | |
| B, mutLevel 1/64 | fuel only | 64 | 2 | 1 | lost early (1,750) [carried] | 0.0 | 0.000 | n/a (0.0156) | n/a | n/a | n/a | no |
| B, mutLevel 1/64 | fuel only | 64 | 2 | 2 | lost early (3,150) [carried] | 0.0 | 0.000 | n/a (0.0156) | n/a | n/a | n/a | no |
| B, mutLevel 1/64 | fuel only | 64 | 2 | 3 | not run | | | | | | | |
| B, mutLevel 1/64 | fuel only | 64 | 2 | 4 | not run | | | | | | | |
| B, mutLevel 1/64 | `LARGE` | 16 | 2 | 1 | lost early (1,100) [carried] | 0.0 | 0.000 | n/a (0.0156) | n/a | n/a | n/a | no |
| B, mutLevel 1/64 | `LARGE` | 16 | 2 | 2 | lost early (1,650) [carried] | 0.0 | 0.000 | n/a (0.0156) | n/a | n/a | n/a | no |
| B, mutLevel 1/64 | `LARGE` | 16 | 2 | 3 | not run | | | | | | | |
| B, mutLevel 1/64 | `LARGE` | 16 | 2 | 4 | not run | | | | | | | |
| B, mutLevel 1/64 | `LARGE` | 64 | 2 | 1 | lost early (1,500) [carried] | 0.0 | 0.000 | n/a (0.0156) | n/a | n/a | n/a | no |
| B, mutLevel 1/64 | `LARGE` | 64 | 2 | 2 | lost early (1,600) [carried] | 0.0 | 0.000 | n/a (0.0156) | n/a | n/a | n/a | no |
| B, mutLevel 1/64 | `LARGE` | 64 | 2 | 3 | not run | | | | | | | |
| B, mutLevel 1/64 | `LARGE` | 64 | 2 | 4 | not run | | | | | | | |
| B, mutLevel 1/256 | fuel only | 16 | 2 | 1 | lost early (2,800) [carried] | 0.0 | 0.000 | n/a (0.0050) | n/a | n/a | n/a | no |
| B, mutLevel 1/256 | fuel only | 16 | 2 | 2 | lost early (3,300) [carried] | 0.0 | 0.000 | n/a (0.0050) | n/a | n/a | n/a | no |
| B, mutLevel 1/256 | fuel only | 16 | 2 | 3 | not run | | | | | | | |
| B, mutLevel 1/256 | fuel only | 16 | 2 | 4 | not run | | | | | | | |
| B, mutLevel 1/256 | fuel only | 64 | 2 | 1 | lost early (1,200) [carried] | 0.0 | 0.000 | n/a (0.0050) | n/a | n/a | n/a | no |
| B, mutLevel 1/256 | fuel only | 64 | 2 | 2 | lost early (1,300) [carried] | 0.0 | 0.000 | n/a (0.0050) | n/a | n/a | n/a | no |
| B, mutLevel 1/256 | fuel only | 64 | 2 | 3 | not run | | | | | | | |
| B, mutLevel 1/256 | fuel only | 64 | 2 | 4 | not run | | | | | | | |
| B, mutLevel 1/256 | `LARGE` | 16 | 2 | 1 | lost early (4,850) [carried] | 0.0 | 0.000 | n/a (0.0050) | n/a | n/a | n/a | no |
| B, mutLevel 1/256 | `LARGE` | 16 | 2 | 2 | lost late (23,050) [carried] | 0.0 | 0.000 | n/a (0.0050) | n/a | n/a | n/a | no |
| B, mutLevel 1/256 | `LARGE` | 16 | 2 | 3 | not run | | | | | | | |
| B, mutLevel 1/256 | `LARGE` | 16 | 2 | 4 | not run | | | | | | | |
| B, mutLevel 1/256 | `LARGE` | 64 | 2 | 1 | lost early (1,500) [carried] | 0.0 | 0.000 | n/a (0.0050) | n/a | n/a | n/a | no |
| B, mutLevel 1/256 | `LARGE` | 64 | 2 | 2 | lost at the founders (1,000) [carried] | 0.0 | 0.000 | n/a (0.0050) | n/a | n/a | n/a | no |
| B, mutLevel 1/256 | `LARGE` | 64 | 2 | 3 | not run | | | | | | | |
| B, mutLevel 1/256 | `LARGE` | 64 | 2 | 4 | not run | | | | | | | |
| B, mutLevel 1/4096 | fuel only | 16 | 3 | 1 | held | 38.3 | 0.952 | 0.0259 (0.0050) | 0.020 | 100.5 | 32.8 | yes |
| B, mutLevel 1/4096 | fuel only | 16 | 3 | 2 | held | 40.9 | 0.952 | 0.0189 (0.0050) | 0.016 | 92.8 | 30.4 | yes |
| B, mutLevel 1/4096 | fuel only | 16 | 3 | 3 | held | 39.0 | 0.952 | 0.0307 (0.0050) | 0.021 | 99.0 | 32.3 | yes |
| B, mutLevel 1/4096 | fuel only | 16 | 3 | 4 | held | 38.5 | 0.951 | 0.0207 (0.0050) | 0.020 | 99.0 | 32.3 | yes |
| B, mutLevel 1/4096 | fuel only | 16 | 4 | 1 | lost late (11,700) | 0.0 | 0.000 | n/a (0.0050) | n/a | n/a | n/a | no |
| B, mutLevel 1/4096 | fuel only | 16 | 4 | 2 | lost late (30,900) | 0.0 | 0.000 | n/a (0.0050) | n/a | n/a | n/a | no |
| B, mutLevel 1/4096 | fuel only | 16 | 4 | 3 | lost late (17,550) | 0.0 | 0.000 | n/a (0.0050) | n/a | n/a | n/a | no |
| B, mutLevel 1/4096 | fuel only | 16 | 4 | 4 | lost late (85,950) | 0.0 | 0.000 | n/a (0.0050) | n/a | n/a | n/a | no |
| B, mutLevel 1/4096 | fuel only | 64 | 2 | 1 | lost late (35,000) [carried] | 0.0 | 0.000 | n/a (0.0050) | n/a | n/a | n/a | no |
| B, mutLevel 1/4096 | fuel only | 64 | 2 | 2 | lost late (17,500) [carried] | 0.0 | 0.000 | n/a (0.0050) | n/a | n/a | n/a | no |
| B, mutLevel 1/4096 | fuel only | 64 | 2 | 3 | not run | | | | | | | |
| B, mutLevel 1/4096 | fuel only | 64 | 2 | 4 | not run | | | | | | | |
| B, mutLevel 1/4096 | `LARGE` | 16 | 3 | 1 | held | 30.1 | 0.986 | 0.0117 (0.0050) | 0.011 | 102.3 | 33.7 | yes |
| B, mutLevel 1/4096 | `LARGE` | 16 | 3 | 2 | held | 29.5 | 0.987 | 0.0234 (0.0050) | 0.016 | 97.1 | 31.9 | yes |
| B, mutLevel 1/4096 | `LARGE` | 16 | 3 | 3 | held | 32.8 | 0.985 | 0.0113 (0.0050) | 0.012 | 94.3 | 31.1 | yes |
| B, mutLevel 1/4096 | `LARGE` | 16 | 3 | 4 | held | 31.2 | 0.986 | 0.0138 (0.0050) | 0.015 | 97.9 | 32.2 | yes |
| B, mutLevel 1/4096 | `LARGE` | 16 | 4 | 1 | held | 12.0 | 0.979 | 0.0235 (0.0050) | 0.008 | 126.7 | 31.4 | yes |
| B, mutLevel 1/4096 | `LARGE` | 16 | 4 | 2 | lost early (7,050) [carried] | 0.0 | 0.000 | n/a (0.0050) | n/a | n/a | n/a | no |
| B, mutLevel 1/4096 | `LARGE` | 16 | 4 | 3 | lost below the bar at the end | 9.4 | 0.972 | 0.0085 (0.0050) | 0.012 | 141.8 | 35.0 | no |
| B, mutLevel 1/4096 | `LARGE` | 16 | 4 | 4 | lost below the bar at the end | 8.6 | 0.974 | 0.0203 (0.0050) | 0.017 | 144.6 | 35.5 | no |
| B, mutLevel 1/4096 | `LARGE` | 64 | 3 | 1 | lost late (13,650) [carried] | 0.0 | 0.000 | n/a (0.0050) | n/a | n/a | n/a | no |
| B, mutLevel 1/4096 | `LARGE` | 64 | 3 | 2 | held | 37.9 | 0.989 | 0.1260 (0.0050) | 0.114 | 391.5 | 115.6 | yes |
| B, mutLevel 1/4096 | `LARGE` | 64 | 3 | 3 | held | 40.3 | 0.989 | 0.1422 (0.0050) | 0.104 | 376.1 | 112.3 | yes |
| B, mutLevel 1/4096 | `LARGE` | 64 | 3 | 4 | held | 35.5 | 0.986 | 0.1524 (0.0050) | 0.136 | 398.4 | 114.7 | yes |
| B, mutLevel 1/4096 | `LARGE` | 64 | 4 | 1 | held | 25.9 | 0.981 | 0.1483 (0.0050) | 0.108 | 428.1 | 95.4 | yes |
| B, mutLevel 1/4096 | `LARGE` | 64 | 4 | 2 | lost late (115,650) | 0.0 | 0.000 | n/a (0.0050) | n/a | n/a | n/a | no |
| B, mutLevel 1/4096 | `LARGE` | 64 | 4 | 3 | held | 28.2 | 0.983 | 0.1246 (0.0050) | 0.095 | 435.2 | 98.4 | yes |
| B, mutLevel 1/4096 | `LARGE` | 64 | 4 | 4 | lost late (148,650) | 0.0 | 0.000 | n/a (0.0050) | n/a | n/a | n/a | no |
| B, mutLevel 1/4096 | `LARGE` | 64 | 6 | 1 | lost late (14,650) [carried] | 0.0 | 0.000 | n/a (0.0050) | n/a | n/a | n/a | no |
| B, mutLevel 1/4096 | `LARGE` | 64 | 6 | 2 | lost late (11,800) [carried] | 0.0 | 0.000 | n/a (0.0050) | n/a | n/a | n/a | no |
| B, mutLevel 1/4096 | `LARGE` | 64 | 6 | 3 | not run | | | | | | | |
| B, mutLevel 1/4096 | `LARGE` | 64 | 6 | 4 | not run | | | | | | | |

### The same cells without the parasite source (gated; seeds 1 to 4, 200,000 steps)

| source | physics | sites | K | seeds held | per seed | late compartments | copies per compartment | copies per gene |
|---|---|---|---|---|---|---|---|---|
| A, no source | fuel only | 16 | 2 | 4 of 4 | held; held; held; held | 80.9 to 82.4 | 67.7 to 72.2 | 33.9 to 36.1 |
| A, no source | fuel only | 16 | 3 | 4 of 4 | held; held; held; held | 40.9 to 43.4 | 93.6 to 101.3 | 31.2 to 33.8 |
| A, no source | fuel only | 16 | 4 | 0 of 4 | lost late (28,350) [carried]; lost late (59,900); lost late (161,600); lost late (74,500) | n/a | n/a | n/a |
| A, no source | fuel only | 64 | 2 | 0 of 0 (incomplete) | not run; not run; not run; not run | n/a | n/a | n/a |
| A, no source | fuel only | 64 | 6 | 4 of 4 | held; held; held; held | 30.5 to 33.7 | 414.8 to 420.6 | 69.1 to 70.1 |
| A, no source | fuel only | 64 | 8 | 0 of 4 | lost early (4,350) [carried]; lost early (8,650) [carried]; lost early (9,000); lost late (19,100) | n/a | n/a | n/a |
| A, no source | `LARGE` | 16 | 3 | 4 of 4 | held; held; held; held | 32.4 to 32.8 | 96.6 to 99.4 | 32.2 to 33.1 |
| A, no source | `LARGE` | 16 | 4 | 4 of 4 | held; held; held; held | 12.6 to 14.0 | 117.2 to 132.5 | 29.3 to 33.1 |
| A, no source | `LARGE` | 16 | 6 | 0 of 4 | lost early (1,400) [carried]; lost early (1,450) [carried]; lost early (1,150); lost early (1,600) | n/a | n/a | n/a |
| A, no source | `LARGE` | 64 | 2 | 0 of 0 (incomplete) | not run; not run; not run; not run | n/a | n/a | n/a |
| A, no source | `LARGE` | 64 | 6 | 4 of 4 | held; held; held; held | 20.7 to 22.4 | 448.4 to 456.3 | 74.7 to 76.0 |
| A, no source | `LARGE` | 64 | 8 | 0 of 4 | lost late (23,900) [carried]; lost late (24,200) [carried]; lost early (7,500); lost late (10,950) | n/a | n/a | n/a |
| B, no source (mutLevel 0) | fuel only | 16 | 2 | 0 of 0 (incomplete) | not run; not run; not run; not run | n/a | n/a | n/a |
| B, no source (mutLevel 0) | fuel only | 16 | 3 | 4 of 4 | held; held; held; held | 39.1 to 44.3 | 92.1 to 98.5 | 30.7 to 32.8 |
| B, no source (mutLevel 0) | fuel only | 16 | 4 | 1 of 4 | lost late (174,550); lost late (11,950) [carried]; lost late (173,950); held | 11.2 | 151.2 | 37.8 |
| B, no source (mutLevel 0) | fuel only | 64 | 2 | 0 of 0 (incomplete) | not run; not run; not run; not run | n/a | n/a | n/a |
| B, no source (mutLevel 0) | `LARGE` | 16 | 2 | 0 of 0 (incomplete) | not run; not run; not run; not run | n/a | n/a | n/a |
| B, no source (mutLevel 0) | `LARGE` | 16 | 3 | 4 of 4 | held; held; held; held | 30.8 to 32.5 | 94.0 to 98.8 | 31.3 to 32.9 |
| B, no source (mutLevel 0) | `LARGE` | 16 | 4 | 4 of 4 | held; held; held; held | 10.3 to 13.2 | 121.2 to 132.9 | 30.3 to 33.2 |
| B, no source (mutLevel 0) | `LARGE` | 64 | 2 | 0 of 0 (incomplete) | not run; not run; not run; not run | n/a | n/a | n/a |
| B, no source (mutLevel 0) | `LARGE` | 64 | 3 | 4 of 4 | held; held; held; held | 52.1 to 53.3 | 316.7 to 334.7 | 105.6 to 111.6 |
| B, no source (mutLevel 0) | `LARGE` | 64 | 4 | 4 of 4 | held; held; held; held | 41.1 to 42.2 | 364.2 to 373.1 | 91.1 to 93.3 |
| B, no source (mutLevel 0) | `LARGE` | 64 | 6 | 0 of 0 (incomplete) | not run; not run; not run; not run | n/a | n/a | n/a |

### Ungated, with the parasite source, for the held frontier cells

| parasite setting | physics | sites | K | seeds held | per seed | late compartments | late share | reading |
|---|---|---|---|---|---|---|---|---|
| A, mutPar 1e-4 | fuel only | 16 | 2 | 0 of 4 | lost early (2,150); lost early (1,800); lost early (1,900); lost early (2,050) | n/a | n/a | the gate is needed |
| A, mutPar 1e-4 | `LARGE` | 16 | 3 | 0 of 4 | lost early (4,450); lost early (4,750); lost early (5,100); lost early (2,600) | n/a | n/a | the gate is needed |
| A, mutPar 1e-5 | fuel only | 16 | 3 | 0 of 4 | lost early (8,300); lost early (4,850); lost early (8,450); lost early (7,200) | n/a | n/a | the gate is needed |
| A, mutPar 1e-5 | fuel only | 64 | 6 | 0 of 4 | lost early (2,400); lost early (2,050); lost early (2,500); lost early (2,200) | n/a | n/a | the gate is needed |
| A, mutPar 1e-5 | `LARGE` | 16 | 4 | 0 of 4 | lost late (71,600); lost late (110,250); lost early (5,450); lost late (131,450) | n/a | n/a | the gate is needed |
| A, mutPar 1e-5 | `LARGE` | 64 | 6 | 0 of 4 | lost early (8,100); lost early (8,900); lost early (8,350); lost early (5,050) | n/a | n/a | the gate is needed |
| A, mutPar 1e-6 | fuel only | 16 | 3 | 1 of 4 | lost late (31,400); held by the rule, but ended at step 188,050; lost late (30,000); lost late (158,250) | 10.2 | 0.3137 | the gate is needed |
| A, mutPar 1e-6 | fuel only | 64 | 6 | 0 of 4 | lost early (6,250); lost early (5,450); lost early (5,600); lost early (2,500) | n/a | n/a | the gate is needed |
| A, mutPar 1e-6 | `LARGE` | 16 | 4 | 2 of 4 | held; held; lost below the bar at the end; lost below the bar at the end | 10.7 to 11.8 | 0.0000 to 0.0031 | unclear |
| A, mutPar 1e-6 | `LARGE` | 64 | 6 | 0 of 4 | lost late (59,850); lost late (59,750); lost late (22,900); lost late (73,500) | n/a | n/a | the gate is needed |
| B, mutLevel 1/4096 | fuel only | 16 | 3 | 0 of 0 | not run; not run; not run; not run | n/a | n/a | not run in full |
| B, mutLevel 1/4096 | `LARGE` | 16 | 3 | 0 of 0 | not run; not run; not run; not run | n/a | n/a | not run in full |
| B, mutLevel 1/4096 | `LARGE` | 64 | 3 | 0 of 0 | not run; not run; not run; not run | n/a | n/a | not run in full |

## Copies per gene against K (stage 1 and stage 2 runs that were held; seeds 1 and 2, 50,000 steps)

| setting | physics | sites | K = 2: compartments / copies per compartment / copies per gene | K = 3: compartments / copies per compartment / copies per gene | K = 4: compartments / copies per compartment / copies per gene | K = 6: compartments / copies per compartment / copies per gene | K = 8: compartments / copies per compartment / copies per gene |
|---|---|---|---|---|---|---|---|
| A, no source | `LARGE` | 16 | 49.4 to 49.5 / 75.7 to 77.3 / 37.8 to 38.7 | 31.7 to 32.8 / 95.2 to 106.3 / 31.7 to 35.4 | 10.7 to 14.2 / 124.2 to 124.6 / 31.0 to 31.1 | - | - |
| A, no source | `LARGE` | 64 | 65.5 to 66.0 / 282.1 to 289.0 / 141.0 to 144.5 | 52.2 to 53.0 / 316.5 to 338.7 / 105.5 to 112.9 | 40.8 to 41.3 / 370.0 to 370.1 / 92.5 to 92.5 | 21.0 to 22.8 / 471.2 to 471.8 / 78.5 to 78.6 | - |
| A, no source | fuel only | 16 | 81.6 to 81.7 / 66.7 to 73.6 / 33.3 to 36.8 | 41.0 to 41.5 / 91.2 to 96.1 / 30.4 to 32.0 | 11.8 / 149.8 / 37.5 | - | - |
| A, no source | fuel only | 64 | 131.2 to 135.5 / 211.2 to 215.9 / 105.6 to 108.0 | 108.4 to 110.0 / 231.3 to 237.8 / 77.1 to 79.3 | 79.4 to 79.7 / 275.0 to 281.0 / 68.8 to 70.2 | 32.1 to 34.9 / 393.2 to 418.2 / 65.5 to 69.7 | - |
| A, mutPar 1e-4 | `LARGE` | 16 | 35.9 to 37.5 / 92.6 to 95.9 / 39.1 to 40.4 | 12.7 to 16.4 / 125.5 to 133.1 / 33.4 to 36.5 | - | - | - |
| A, mutPar 1e-4 | `LARGE` | 64 | - | - | - | - | - |
| A, mutPar 1e-4 | fuel only | 16 | 56.8 to 63.9 / 75.7 to 79.6 / 32.3 to 34.0 | 17.3 / 141.8 / 39.5 | - | - | - |
| A, mutPar 1e-4 | fuel only | 64 | - | - | - | - | - |
| A, mutPar 1e-5 | `LARGE` | 16 | 47.6 to 47.9 / 80.2 to 82.7 / 39.8 to 39.9 | 29.9 to 30.5 / 95.1 to 98.8 / 31.4 to 32.1 | 10.7 to 12.3 / 116.0 to 119.5 / 28.2 to 29.8 | - | - |
| A, mutPar 1e-5 | `LARGE` | 64 | 62.1 to 63.5 / 281.3 to 298.5 / 138.5 to 143.9 | 51.6 to 52.8 / 319.7 to 323.2 / 104.5 to 104.9 | 37.3 to 41.8 / 358.8 to 361.2 / 88.2 to 89.4 | 15.8 to 17.7 / 449.8 to 484.1 / 73.0 to 79.5 | - |
| A, mutPar 1e-5 | fuel only | 16 | 78.2 to 80.5 / 67.3 to 75.8 / 32.8 to 37.3 | 34.6 to 40.7 / 100.4 to 101.4 / 32.7 to 33.6 | - | - | - |
| A, mutPar 1e-5 | fuel only | 64 | 129.8 to 132.5 / 216.4 to 217.8 / 105.1 to 106.7 | 103.4 to 107.3 / 237.5 to 239.9 / 77.5 to 78.9 | 75.6 to 75.9 / 288.0 to 298.8 / 71.0 to 73.5 | 27.8 to 35.8 / 426.3 to 429.1 / 70.1 to 70.4 | - |
| A, mutPar 1e-6 | `LARGE` | 16 | 49.3 to 50.6 / 76.5 to 78.5 / 38.0 to 39.3 | 31.7 to 33.7 / 96.4 to 109.1 / 32.1 to 36.4 | 13.7 to 14.5 / 111.7 to 117.5 / 27.9 to 29.3 | - | - |
| A, mutPar 1e-6 | `LARGE` | 64 | 65.5 to 65.9 / 287.1 to 292.5 / 143.2 to 145.8 | 51.1 to 52.4 / 325.5 to 337.0 / 107.8 to 112.1 | 40.5 to 42.9 / 352.1 to 356.2 / 88.0 to 89.0 | 23.2 to 23.2 / 422.4 to 436.5 / 70.4 to 72.8 | - |
| A, mutPar 1e-6 | fuel only | 16 | 79.4 to 79.9 / 70.2 to 70.8 / 35.1 to 35.4 | 43.9 to 44.4 / 91.4 to 100.6 / 30.5 to 33.5 | - | - | - |
| A, mutPar 1e-6 | fuel only | 64 | 131.8 to 134.6 / 210.4 to 217.5 / 105.0 to 108.5 | 106.9 to 111.0 / 228.6 to 235.4 / 76.0 to 78.2 | 79.6 to 81.8 / 278.5 to 278.9 / 69.0 to 69.0 | 32.4 to 32.6 / 425.6 to 428.6 / 70.9 to 71.4 | - |
| B, no source (mutLevel 0) | `LARGE` | 16 | 48.5 to 49.8 / 78.1 to 79.0 / 39.0 to 39.5 | 31.0 to 33.4 / 94.7 to 96.7 / 31.6 to 32.2 | 11.8 to 13.2 / 117.2 to 135.7 / 29.3 to 33.9 | - | - |
| B, no source (mutLevel 0) | `LARGE` | 64 | 65.3 to 66.5 / 284.7 to 291.0 / 142.3 to 145.5 | 51.6 to 54.1 / 312.6 to 320.9 / 104.2 to 107.0 | 40.9 to 42.8 / 360.9 to 366.8 / 90.2 to 91.7 | 22.4 to 23.6 / 450.5 to 475.1 / 75.1 to 79.2 | - |
| B, no source (mutLevel 0) | fuel only | 16 | 76.7 to 82.6 / 70.9 to 71.0 / 35.5 to 35.5 | 36.4 to 38.8 / 95.4 to 100.0 / 31.8 to 33.3 | 13.1 / 141.3 / 35.3 | - | - |
| B, no source (mutLevel 0) | fuel only | 64 | 130.3 to 132.2 / 215.4 to 218.3 / 107.7 to 109.1 | 108.5 to 109.7 / 236.3 to 242.0 / 78.8 to 80.7 | 80.5 to 82.6 / 282.0 to 282.8 / 70.5 to 70.7 | 31.6 to 32.2 / 394.7 to 422.5 / 65.8 to 70.4 | - |
| B, mutLevel 1/64 | `LARGE` | 16 | - | - | - | - | - |
| B, mutLevel 1/64 | `LARGE` | 64 | - | - | - | - | - |
| B, mutLevel 1/64 | fuel only | 16 | - | - | - | - | - |
| B, mutLevel 1/64 | fuel only | 64 | - | - | - | - | - |
| B, mutLevel 1/256 | `LARGE` | 16 | - | - | - | - | - |
| B, mutLevel 1/256 | `LARGE` | 64 | - | - | - | - | - |
| B, mutLevel 1/256 | fuel only | 16 | - | - | - | - | - |
| B, mutLevel 1/256 | fuel only | 64 | - | - | - | - | - |
| B, mutLevel 1/4096 | `LARGE` | 16 | 48.0 to 48.1 / 79.3 to 80.4 / 39.1 to 39.7 | 30.1 to 31.5 / 91.0 to 95.2 / 29.9 to 31.1 | - | - | - |
| B, mutLevel 1/4096 | `LARGE` | 64 | 54.8 to 57.0 / 306.5 to 310.2 / 136.9 to 137.4 | 40.7 / 375.3 / 112.9 | 11.7 to 25.8 / 438.6 to 587.7 / 99.5 to 120.2 | - | - |
| B, mutLevel 1/4096 | fuel only | 16 | 77.9 to 79.1 / 69.9 to 71.6 / 34.2 to 35.0 | 33.0 to 38.8 / 99.4 to 107.1 / 32.6 to 34.6 | - | - | - |
| B, mutLevel 1/4096 | fuel only | 64 | - | - | - | - | - |

## Which factor moved the frontier (rungs of the ladder none, 2, 3, 4, 6, 8; groups that differ in that one factor)

| factor | pairs compared | mean change, largest K held | mean absolute change, largest K held | mean absolute change, parasite in effect | per pair (largest K held / in effect) |
|---|---|---|---|---|---|
| dose: 1e-4 to 1e-6 (source A) | 4 of 4 | 2.50 | 2.50 | n/a (0 pairs) | a1e4/large/16 to a1e6/large/16: +1 / n.e.; a1e4/large/64 to a1e6/large/64: +4 / n.e.; a1e4/fuel/16 to a1e6/fuel/16: +1 / n.e.; a1e4/fuel/64 to a1e6/fuel/64: +4 / n.e. |
| dose: 1e-4 to 1e-5 (source A) | 4 of 4 | 2.50 | 2.50 | 2.50 (4 pairs) | a1e4/large/16 to a1e5/large/16: +1 / +1; a1e4/large/64 to a1e5/large/64: +4 / +4; a1e4/fuel/16 to a1e5/fuel/16: +1 / +1; a1e4/fuel/64 to a1e5/fuel/64: +4 / +4 |
| dose: 1e-5 to 1e-6 (source A) | 4 of 4 | 0.00 | 0.00 | n/a (0 pairs) | a1e5/large/16 to a1e6/large/16: +0 / n.e.; a1e5/large/64 to a1e6/large/64: +0 / n.e.; a1e5/fuel/16 to a1e6/fuel/16: +0 / n.e.; a1e5/fuel/64 to a1e6/fuel/64: +0 / n.e. |
| rate: 1/64 to 1/256 (source B) | 4 of 4 | 0.00 | 0.00 | 0.00 (4 pairs) | b64/large/16 to b256/large/16: +0 / +0; b64/large/64 to b256/large/64: +0 / +0; b64/fuel/16 to b256/fuel/16: +0 / +0; b64/fuel/64 to b256/fuel/64: +0 / +0 |
| rate: 1/256 to 1/4096 (source B; added rate) | 4 of 4 | 1.50 | 1.50 | 1.50 (4 pairs) | b256/large/16 to b4096/large/16: +2 / +2; b256/large/64 to b4096/large/64: +2 / +2; b256/fuel/16 to b4096/fuel/16: +2 / +2; b256/fuel/64 to b4096/fuel/64: +0 / +0 |
| rate: 1/64 to 1/4096 (source B; added rate) | 4 of 4 | 1.50 | 1.50 | 1.50 (4 pairs) | b64/large/16 to b4096/large/16: +2 / +2; b64/large/64 to b4096/large/64: +2 / +2; b64/fuel/16 to b4096/fuel/16: +2 / +2; b64/fuel/64 to b4096/fuel/64: +0 / +0 |
| physics: LARGE to fuel only | 10 of 10 | -0.30 | 0.30 | 0.25 (8 pairs) | a1e4/large/16 to a1e4/fuel/16: -1 / -1; a1e4/large/64 to a1e4/fuel/64: +0 / +0; a1e5/large/16 to a1e5/fuel/16: -1 / -1; a1e5/large/64 to a1e5/fuel/64: +0 / +0; a1e6/large/16 to a1e6/fuel/16: -1 / n.e.; a1e6/large/64 to a1e6/fuel/64: +0 / n.e.; b64/large/16 to b64/fuel/16: +0 / +0; b64/large/64 to b64/fuel/64: +0 / +0; b256/large/16 to b256/fuel/16: +0 / +0; b256/large/64 to b256/fuel/64: +0 / +0 |
| sites: 16 to 64 | 10 of 10 | 0.30 | 0.90 | 0.75 (8 pairs) | a1e4/large/16 to a1e4/large/64: -2 / -2; a1e4/fuel/16 to a1e4/fuel/64: -1 / -1; a1e5/large/16 to a1e5/large/64: +1 / +1; a1e5/fuel/16 to a1e5/fuel/64: +2 / +2; a1e6/large/16 to a1e6/large/64: +1 / n.e.; a1e6/fuel/16 to a1e6/fuel/64: +2 / n.e.; b64/large/16 to b64/large/64: +0 / +0; b64/fuel/16 to b64/fuel/64: +0 / +0; b256/large/16 to b256/large/64: +0 / +0; b256/fuel/16 to b256/fuel/64: +0 / +0 |
| physics: LARGE to fuel only (added rate) | 2 of 2 | -1.00 | 1.00 | 1.00 (2 pairs) | b4096/large/16 to b4096/fuel/16: +0 / +0; b4096/large/64 to b4096/fuel/64: -2 / -2 |
| sites: 16 to 64 (added rate) | 2 of 2 | -1.00 | 1.00 | 1.00 (2 pairs) | b4096/large/16 to b4096/large/64: +0 / +0; b4096/fuel/16 to b4096/fuel/64: -2 / -2 |

n.e.: not established in one of the two groups, so the pair is left out of the in-effect figure.

## Regime to confirm, coordinator's grid

A, mutPar 1e-5, fuel only, 64 sites, K = 6 (4 of 4 seeds holding against the parasite, 28.8 late compartments). Candidates at this K: 2.
