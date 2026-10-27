# Food-band longevity screen

Seed 1203; mode Moving 48-column replenishment band; Node 24.2.0 on darwin/arm64.
Mutation enabled; stopped at tick 6000.
The unchanged moving and stationary 48-column bands are observed to tick 6,000 or actual extinction. The moving band shifts every 50 ticks; the stationary band stays at left edge 0. Food already on a tile remains when the moving band shifts. Offered food is matched while both arms are active, but accepted food can differ. The first 3,000 ticks exactly reproduce this seed’s accepted historical prefix and are regression evidence, not a new outcome.

| Window | Executed | Births | Deaths | Cap 48 | Near cap 47+ | Blocked cap/space | Population min–max | Endpoint pop/cells | Max-ever generation | Food offered/accepted/overflow | Occupied cells in band |
| --- | ---: | ---: | ---: | ---: | ---: | --- | --- | --- | ---: | --- | --- |
| 4501–5000 | 500/500 (complete) | 90 | 96 | 21/500 | 27/500 | 17/0 | 27–48 | 36/598 | 23 | 76800/52255/24545 | 474 (79.3%) |
| 5001–5500 | 500/500 (complete) | 72 | 79 | 0/500 | 0/500 | 0/0 | 19–45 | 29/540 | 26 | 76800/50072/26728 | 486 (90.0%) |
| 5501–6000 | 500/500 (complete) | 106 | 87 | 4/500 | 5/500 | 8/0 | 23–48 | 48/689 | 28 | 76800/48135/28665 | 642 (93.2%) |

Numerical screen: pass; this does not make a visual decision.
Historical 3,000-tick prefix: verified; reference artifact SHA-256 000e1ce6a3a60ab216707136ba97edf97bdcde826a63af2d3c27bf54e7810e3d.
Frames are saved every 20 actual ticks and at an off-cadence extinction tick when needed. A not-reached window is unavailable, not a simulated zero. Occupied-band share is descriptive and is not a fitness score.
This screen does not establish tracking, adaptation, fitness improvement, or superiority.
