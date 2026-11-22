Set-up and observation, the same for every run here: founders grid (spacing 16), 2 copies of each gene seeded per wall tile, census every 50 steps, report row every 2000 steps.

Held and late state (late = the last tenth of the planned run; n/a where a run ended before it)

| setting | K | sites/tile | arm | seeds held | ended early at step | late compartments | late complete share | late parasite share | late copies per compartment |
|---|---|---|---|---|---|---|---|---|---|
| large | 2 | 16 | GATED_CLEAN | 8 of 8 (held) | none | 48.6 to 49.9 | 0.99 to 0.99 | 0.000 to 0.000 | 78.3 to 81.3 |
| large | 2 | 16 | GATED_PAR | 8 of 8 (held) | none | 35.5 to 37.6 | 0.99 to 0.99 | 0.127 to 0.151 | 88.8 to 98.5 |
| large | 2 | 16 | UNGATED_CLEAN | 8 of 8 (held) | none | 48.8 to 50.7 | 0.99 to 0.99 | 0.000 to 0.000 | 67.4 to 73.4 |
| large | 2 | 16 | UNGATED_PAR | 0 of 8 | 2200, 3500, 3700, 4450, 3450, 2700, 3400, 4050 | 0.0 to 0.0 | 0.00 to 0.00 | n/a | n/a |

Heredity of the gene-0 share, daughters read 500 steps after the split. Each control is shown beside the parent correlation over the same daughters: parent r / control r (daughters).

| setting | K | sites/tile | arm | per seed, control = nearest neighbour | margin at least 0.2 | per seed, control = nearest unrelated compartment | delayed reads: read / gone / fused / pending (totals) | variance of gene-0 share among compartments (late) |
|---|---|---|---|---|---|---|---|---|
| large | 2 | 16 | GATED_CLEAN | 0.46/0.01 (10296), 0.46/0.01 (10326), 0.48/0.02 (10309), 0.46/0.03 (10358), 0.48/0.02 (10260), 0.48/0.02 (10290), 0.48/0.01 (10329), 0.46/0.02 (10242) | 8 of 8 | 0.46/-0.01 (10296), 0.46/-0.01 (10326), 0.48/0.00 (10309), 0.46/0.02 (10358), 0.48/0.01 (10260), 0.48/-0.00 (10290), 0.48/-0.01 (10329), 0.46/0.01 (10242) | 82410 / 41994 / 2394 / 272 | 0.083 to 0.095 |
| large | 2 | 16 | GATED_PAR | 0.48/0.05 (10013), 0.48/0.04 (9876), 0.48/0.06 (9777), 0.49/0.06 (9777), 0.49/0.06 (9869), 0.49/0.07 (9861), 0.48/0.06 (9803), 0.49/0.07 (9835) | 8 of 8 | 0.48/0.00 (10006), 0.48/-0.00 (9875), 0.48/-0.00 (9766), 0.49/-0.00 (9775), 0.49/0.02 (9862), 0.49/0.01 (9868), 0.48/0.02 (9807), 0.49/0.00 (9826) | 79000 / 71990 / 3289 / 392 | 0.082 to 0.092 |
| large | 2 | 16 | UNGATED_CLEAN | 0.36/0.03 (9834), 0.37/-0.00 (9749), 0.36/0.00 (9791), 0.35/-0.01 (9830), 0.37/0.02 (9914), 0.37/0.01 (9756), 0.36/0.01 (9830), 0.36/0.03 (9841) | 8 of 8 | 0.36/0.02 (9834), 0.37/-0.01 (9749), 0.36/-0.00 (9791), 0.35/-0.01 (9830), 0.37/0.02 (9914), 0.37/-0.01 (9756), 0.36/0.01 (9830), 0.36/0.04 (9841) | 78545 / 38711 / 2157 / 276 | 0.074 to 0.081 |
| large | 2 | 16 | UNGATED_PAR | 0.27/0.03 (39), 0.13/0.15 (74), 0.25/0.19 (62), 0.47/-0.02 (92), 0.45/-0.03 (56), 0.14/-0.13 (54), 0.33/-0.09 (61), 0.41/0.07 (76) | 6 of 8 | 0.27/0.08 (39), 0.13/0.12 (74), 0.25/-0.24 (62), 0.50/-0.03 (89), 0.45/-0.14 (56), 0.14/-0.19 (54), 0.33/-0.06 (61), 0.41/-0.03 (76) | 517 / 1133 / 52 / 47 | n/a |

Bookkeeping (tracker counts depend on the 50-step census; they are not rates)

| setting | K | sites/tile | arm | fissions | fusions / fissions | deaths | tracking misses / fissions | late share of copies on bare tiles | late share on the soft rim | residual |
|---|---|---|---|---|---|---|---|---|---|---|
| large | 2 | 16 | GATED_CLEAN | 7856 to 8040 | 0.05 to 0.05 | 7461 to 7604 | 0.000 to 0.001 | 0.028 to 0.033 | 0.171 to 0.177 | 0 |
| large | 2 | 16 | GATED_PAR | 9628 to 9763 | 0.05 to 0.05 | 9164 to 9299 | 0.000 to 0.001 | 0.044 to 0.061 | 0.157 to 0.169 | 0 |
| large | 2 | 16 | UNGATED_CLEAN | 7384 to 7562 | 0.05 to 0.05 | 7009 to 7176 | 0.000 to 0.001 | 0.161 to 0.171 | 0.184 to 0.193 | 0 |
| large | 2 | 16 | UNGATED_PAR | 81 to 145 | 0.04 to 0.10 | 92 to 155 | 0.000 to 0.000 | n/a | n/a | 0 |

Largest K held

| setting | sites/tile | arm | largest K held | K tested | not held | fewer than 4 seeds |
|---|---|---|---|---|---|---|
| large | 16 | GATED_CLEAN | 2 | 2 | none | none |
| large | 16 | GATED_PAR | 2 | 2 | none | none |
| large | 16 | UNGATED_CLEAN | 2 | 2 | none | none |
| large | 16 | UNGATED_PAR | none | 2 | 2 | none |

Compartment properties (late = the last tenth of the planned run; ages and turnover depend on the 50-step census and are for comparing settings observed the same way)

| setting | K | sites/tile | arm | seeds held | late compartments | late mean area, tiles | late copies per compartment | median age at death, steps (observed deaths) | turnover time, steps (compartment-steps per death; runs that reached the end) | median age of those alive at the end, steps |
|---|---|---|---|---|---|---|---|---|---|---|
| large | 2 | 16 | GATED_CLEAN | 8 of 8 | 48.6 to 49.9 | 18.3 to 19.1 | 78.3 to 81.3 | 750 to 800 | 1291 to 1337 | 650 to 1450 |
| large | 2 | 16 | GATED_PAR | 8 of 8 | 35.5 to 37.6 | 20.0 to 22.3 | 88.8 to 98.5 | 500 to 500 | 774 to 792 | 300 to 700 |
| large | 2 | 16 | UNGATED_CLEAN | 8 of 8 | 48.8 to 50.7 | 17.6 to 19.2 | 67.4 to 73.4 | 850 to 900 | 1380 to 1428 | 850 to 1400 |
| large | 2 | 16 | UNGATED_PAR | 0 of 8 | 0.0 to 0.0 | n/a | n/a | 350 to 450 | n/a | n/a |

Per seed (late = the last tenth of the planned run; heredity is the gene-0 share, and the parasite share, read 500 steps after the split, parent r / control r (daughters))

| setting | K | sites/tile | arm | seed | held | ended early at step | late compartments | late complete share | late parasite share | late copies per compartment | late mean area, tiles | heredity, control = nearest neighbour | margin | heredity, control = nearest unrelated | parasite-share heredity, control = nearest neighbour | fissions | deaths | residual |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| large | 2 | 16 | GATED_CLEAN | 9 | yes | none | 49.4 | 0.992 | 0.000 | 78.9 | 18.6 | 0.46/0.01 (10296) | 0.45 | 0.46/-0.01 (10296) | n/a/n/a (10296) | 7934 | 7545 | 0 |
| large | 2 | 16 | GATED_CLEAN | 10 | yes | none | 49.7 | 0.993 | 0.000 | 78.9 | 18.5 | 0.46/0.01 (10326) | 0.46 | 0.46/-0.01 (10326) | n/a/n/a (10326) | 7912 | 7524 | 0 |
| large | 2 | 16 | GATED_CLEAN | 11 | yes | none | 48.6 | 0.993 | 0.000 | 80.4 | 19.0 | 0.48/0.02 (10309) | 0.46 | 0.48/0.00 (10309) | n/a/n/a (10309) | 8010 | 7603 | 0 |
| large | 2 | 16 | GATED_CLEAN | 12 | yes | none | 48.9 | 0.992 | 0.000 | 81.3 | 19.1 | 0.46/0.03 (10358) | 0.44 | 0.46/0.02 (10358) | n/a/n/a (10358) | 8040 | 7597 | 0 |
| large | 2 | 16 | GATED_CLEAN | 13 | yes | none | 49.1 | 0.992 | 0.000 | 79.9 | 18.8 | 0.48/0.02 (10260) | 0.45 | 0.48/0.01 (10260) | n/a/n/a (10260) | 7954 | 7568 | 0 |
| large | 2 | 16 | GATED_CLEAN | 14 | yes | none | 49.0 | 0.992 | 0.000 | 78.3 | 18.4 | 0.48/0.02 (10290) | 0.46 | 0.48/-0.00 (10290) | n/a/n/a (10290) | 8005 | 7604 | 0 |
| large | 2 | 16 | GATED_CLEAN | 15 | yes | none | 49.9 | 0.992 | 0.000 | 78.6 | 18.3 | 0.48/0.01 (10329) | 0.48 | 0.48/-0.01 (10329) | n/a/n/a (10329) | 7921 | 7540 | 0 |
| large | 2 | 16 | GATED_CLEAN | 16 | yes | none | 49.6 | 0.992 | 0.000 | 80.2 | 18.9 | 0.46/0.02 (10242) | 0.44 | 0.46/0.01 (10242) | n/a/n/a (10242) | 7856 | 7461 | 0 |
| large | 2 | 16 | GATED_PAR | 9 | yes | none | 35.5 | 0.985 | 0.142 | 98.5 | 22.3 | 0.48/0.05 (10013) | 0.44 | 0.48/0.00 (10006) | 0.10/0.01 (10030) | 9738 | 9261 | 0 |
| large | 2 | 16 | GATED_PAR | 10 | yes | none | 36.1 | 0.986 | 0.129 | 93.9 | 21.4 | 0.48/0.04 (9876) | 0.44 | 0.48/-0.00 (9875) | 0.08/0.01 (9903) | 9628 | 9164 | 0 |
| large | 2 | 16 | GATED_PAR | 11 | yes | none | 35.9 | 0.986 | 0.151 | 95.5 | 21.4 | 0.48/0.06 (9777) | 0.42 | 0.48/-0.00 (9766) | 0.09/0.03 (9802) | 9754 | 9255 | 0 |
| large | 2 | 16 | GATED_PAR | 12 | yes | none | 37.6 | 0.987 | 0.127 | 88.8 | 20.0 | 0.49/0.06 (9777) | 0.43 | 0.49/-0.00 (9775) | 0.10/0.02 (9805) | 9701 | 9182 | 0 |
| large | 2 | 16 | GATED_PAR | 13 | yes | none | 36.7 | 0.986 | 0.140 | 94.5 | 21.4 | 0.49/0.06 (9869) | 0.43 | 0.49/0.02 (9862) | 0.09/0.01 (9886) | 9752 | 9299 | 0 |
| large | 2 | 16 | GATED_PAR | 14 | yes | none | 37.2 | 0.986 | 0.127 | 93.0 | 21.2 | 0.49/0.07 (9861) | 0.41 | 0.49/0.01 (9868) | 0.08/0.01 (9891) | 9696 | 9198 | 0 |
| large | 2 | 16 | GATED_PAR | 15 | yes | none | 37.5 | 0.988 | 0.138 | 94.0 | 21.2 | 0.48/0.06 (9803) | 0.42 | 0.48/0.02 (9807) | 0.06/0.01 (9830) | 9684 | 9181 | 0 |
| large | 2 | 16 | GATED_PAR | 16 | yes | none | 36.7 | 0.988 | 0.141 | 95.8 | 21.8 | 0.49/0.07 (9835) | 0.42 | 0.49/0.00 (9826) | 0.10/0.02 (9853) | 9763 | 9279 | 0 |
| large | 2 | 16 | UNGATED_CLEAN | 9 | yes | none | 49.6 | 0.993 | 0.000 | 70.6 | 18.7 | 0.36/0.03 (9834) | 0.32 | 0.36/0.02 (9834) | n/a/n/a (9834) | 7514 | 7115 | 0 |
| large | 2 | 16 | UNGATED_CLEAN | 10 | yes | none | 49.3 | 0.992 | 0.000 | 73.3 | 19.2 | 0.37/-0.00 (9749) | 0.37 | 0.37/-0.01 (9749) | n/a/n/a (9749) | 7476 | 7081 | 0 |
| large | 2 | 16 | UNGATED_CLEAN | 11 | yes | none | 50.4 | 0.994 | 0.000 | 67.4 | 17.6 | 0.36/0.00 (9791) | 0.36 | 0.36/-0.00 (9791) | n/a/n/a (9791) | 7384 | 7009 | 0 |
| large | 2 | 16 | UNGATED_CLEAN | 12 | yes | none | 48.8 | 0.992 | 0.000 | 72.3 | 19.1 | 0.35/-0.01 (9830) | 0.37 | 0.35/-0.01 (9830) | n/a/n/a (9830) | 7488 | 7123 | 0 |
| large | 2 | 16 | UNGATED_CLEAN | 13 | yes | none | 50.0 | 0.992 | 0.000 | 72.5 | 19.0 | 0.37/0.02 (9914) | 0.35 | 0.37/0.02 (9914) | n/a/n/a (9914) | 7549 | 7176 | 0 |
| large | 2 | 16 | UNGATED_CLEAN | 14 | yes | none | 49.6 | 0.992 | 0.000 | 73.4 | 19.1 | 0.37/0.01 (9756) | 0.36 | 0.37/-0.01 (9756) | n/a/n/a (9756) | 7461 | 7051 | 0 |
| large | 2 | 16 | UNGATED_CLEAN | 15 | yes | none | 49.6 | 0.993 | 0.000 | 71.4 | 18.8 | 0.36/0.01 (9830) | 0.35 | 0.36/0.01 (9830) | n/a/n/a (9830) | 7489 | 7111 | 0 |
| large | 2 | 16 | UNGATED_CLEAN | 16 | yes | none | 50.7 | 0.993 | 0.000 | 70.8 | 18.6 | 0.36/0.03 (9841) | 0.33 | 0.36/0.04 (9841) | n/a/n/a (9841) | 7562 | 7148 | 0 |
| large | 2 | 16 | UNGATED_PAR | 9 | no | 2200 | 0.0 | 0.000 | n/a | n/a | n/a | 0.27/0.03 (39) | 0.24 | 0.27/0.08 (39) | 0.03/0.04 (39) | 81 | 92 | 0 |
| large | 2 | 16 | UNGATED_PAR | 10 | no | 3500 | 0.0 | 0.000 | n/a | n/a | n/a | 0.13/0.15 (74) | -0.02 | 0.13/0.12 (74) | 0.40/0.17 (74) | 127 | 132 | 0 |
| large | 2 | 16 | UNGATED_PAR | 11 | no | 3700 | 0.0 | 0.000 | n/a | n/a | n/a | 0.25/0.19 (62) | 0.06 | 0.25/-0.24 (62) | -0.18/0.10 (62) | 107 | 116 | 0 |
| large | 2 | 16 | UNGATED_PAR | 12 | no | 4450 | 0.0 | 0.000 | n/a | n/a | n/a | 0.47/-0.02 (92) | 0.49 | 0.50/-0.03 (89) | 0.21/0.14 (92) | 145 | 155 | 0 |
| large | 2 | 16 | UNGATED_PAR | 13 | no | 3450 | 0.0 | 0.000 | n/a | n/a | n/a | 0.45/-0.03 (56) | 0.48 | 0.45/-0.14 (56) | 0.24/0.07 (56) | 110 | 118 | 0 |
| large | 2 | 16 | UNGATED_PAR | 14 | no | 2700 | 0.0 | 0.000 | n/a | n/a | n/a | 0.14/-0.13 (54) | 0.27 | 0.14/-0.19 (54) | 0.05/0.03 (54) | 104 | 116 | 0 |
| large | 2 | 16 | UNGATED_PAR | 15 | no | 3400 | 0.0 | 0.000 | n/a | n/a | n/a | 0.33/-0.09 (61) | 0.42 | 0.33/-0.06 (61) | 0.16/0.04 (61) | 113 | 121 | 0 |
| large | 2 | 16 | UNGATED_PAR | 16 | no | 4050 | 0.0 | 0.000 | n/a | n/a | n/a | 0.41/0.07 (76) | 0.34 | 0.41/-0.03 (76) | 0.03/0.14 (79) | 134 | 143 | 0 |
