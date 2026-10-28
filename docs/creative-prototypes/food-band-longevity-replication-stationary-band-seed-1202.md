# Food-band longevity screen

Seed 1202; mode Stationary 48-column replenishment band at column 0; Node 24.2.0 on darwin/arm64.
Mutation enabled; stopped at tick 6000.
The unchanged moving and stationary 48-column bands are observed to tick 6,000 or actual extinction. The moving band shifts every 50 ticks; the stationary band stays at left edge 0. Food already on a tile remains when the moving band shifts. Offered food is matched while both arms are active, but accepted food can differ. The first 3,000 ticks exactly reproduce this seed’s accepted historical prefix and are regression evidence, not a new outcome.

| Window | Executed | Births | Deaths | Cap 48 | Near cap 47+ | Blocked cap/space | Population min–max | Endpoint pop/cells | Max-ever generation | Food offered/accepted/overflow | Occupied cells in band |
| --- | ---: | ---: | ---: | ---: | ---: | --- | --- | --- | ---: | --- | --- |
| 4501–5000 | 500/500 (complete) | 90 | 84 | 19/500 | 39/500 | 25/0 | 29–48 | 42/742 | 23 | 76800/48662/28138 | 735 (99.1%) |
| 5001–5500 | 500/500 (complete) | 80 | 88 | 27/500 | 53/500 | 46/0 | 31–48 | 34/677 | 25 | 76800/50000/26800 | 631 (93.2%) |
| 5501–6000 | 500/500 (complete) | 109 | 98 | 1/500 | 6/500 | 5/0 | 24–48 | 45/591 | 28 | 76800/51122/25678 | 576 (97.5%) |

Numerical screen: pass; this does not make a visual decision.
Historical 3,000-tick prefix: verified; reference artifact SHA-256 1c85fd8477644da9fb2bd54df0f5c1a463103db6ac49022e2caa2b0611badd39.
Frames are saved every 20 actual ticks and at an off-cadence extinction tick when needed. A not-reached window is unavailable, not a simulated zero. Occupied-band share is descriptive and is not a fitness score.
This screen does not establish tracking, adaptation, fitness improvement, or superiority.
