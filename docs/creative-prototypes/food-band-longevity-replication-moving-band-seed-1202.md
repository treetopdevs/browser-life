# Food-band longevity screen

Seed 1202; mode Moving 48-column replenishment band; Node 24.2.0 on darwin/arm64.
Mutation enabled; stopped at tick 6000.
The unchanged moving and stationary 48-column bands are observed to tick 6,000 or actual extinction. The moving band shifts every 50 ticks; the stationary band stays at left edge 0. Food already on a tile remains when the moving band shifts. Offered food is matched while both arms are active, but accepted food can differ. The first 3,000 ticks exactly reproduce this seed’s accepted historical prefix and are regression evidence, not a new outcome.

| Window | Executed | Births | Deaths | Cap 48 | Near cap 47+ | Blocked cap/space | Population min–max | Endpoint pop/cells | Max-ever generation | Food offered/accepted/overflow | Occupied cells in band |
| --- | ---: | ---: | ---: | ---: | ---: | --- | --- | --- | ---: | --- | --- |
| 4501–5000 | 500/500 (complete) | 91 | 105 | 23/500 | 33/500 | 10/0 | 25–48 | 31/533 | 23 | 76800/56373/20427 | 438 (82.2%) |
| 5001–5500 | 500/500 (complete) | 79 | 87 | 34/500 | 39/500 | 38/0 | 23–48 | 23/428 | 25 | 76800/52566/24234 | 404 (94.4%) |
| 5501–6000 | 500/500 (complete) | 102 | 81 | 0/500 | 0/500 | 0/0 | 21–46 | 44/567 | 28 | 76800/50104/26696 | 451 (79.5%) |

Numerical screen: pass; this does not make a visual decision.
Historical 3,000-tick prefix: verified; reference artifact SHA-256 1ba5caec32d22feef2482e13eab9550552bec974a6f9f7791c21714d375e598a.
Frames are saved every 20 actual ticks and at an off-cadence extinction tick when needed. A not-reached window is unavailable, not a simulated zero. Occupied-band share is descriptive and is not a fitness score.
This screen does not establish tracking, adaptation, fitness improvement, or superiority.
