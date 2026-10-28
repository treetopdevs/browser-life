# Food-band longevity screen

Seed 1203; mode Stationary 48-column replenishment band at column 0; Node 24.2.0 on darwin/arm64.
Mutation enabled; stopped at tick 6000.
The unchanged moving and stationary 48-column bands are observed to tick 6,000 or actual extinction. The moving band shifts every 50 ticks; the stationary band stays at left edge 0. Food already on a tile remains when the moving band shifts. Offered food is matched while both arms are active, but accepted food can differ. The first 3,000 ticks exactly reproduce this seed’s accepted historical prefix and are regression evidence, not a new outcome.

| Window | Executed | Births | Deaths | Cap 48 | Near cap 47+ | Blocked cap/space | Population min–max | Endpoint pop/cells | Max-ever generation | Food offered/accepted/overflow | Occupied cells in band |
| --- | ---: | ---: | ---: | ---: | ---: | --- | --- | --- | ---: | --- | --- |
| 4501–5000 | 500/500 (complete) | 97 | 101 | 5/500 | 17/500 | 4/0 | 26–48 | 35/516 | 26 | 76800/49100/27700 | 502 (97.3%) |
| 5001–5500 | 500/500 (complete) | 85 | 87 | 17/500 | 38/500 | 27/0 | 29–48 | 33/609 | 27 | 76800/49202/27598 | 585 (96.1%) |
| 5501–6000 | 500/500 (complete) | 103 | 88 | 12/500 | 32/500 | 28/0 | 29–48 | 48/609 | 27 | 76800/51198/25602 | 577 (94.7%) |

Numerical screen: pass; this does not make a visual decision.
Historical 3,000-tick prefix: verified; reference artifact SHA-256 234c3c0eb54b5d6875f400e155b95f9afaa20638b511c0a4285305c9aac2ba7c.
Frames are saved every 20 actual ticks and at an off-cadence extinction tick when needed. A not-reached window is unavailable, not a simulated zero. Occupied-band share is descriptive and is not a fitness score.
This screen does not establish tracking, adaptation, fitness improvement, or superiority.
