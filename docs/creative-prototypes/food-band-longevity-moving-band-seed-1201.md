# Food-band longevity screen

Seed 1201; mode Moving 48-column replenishment band; Node 24.2.0 on darwin/arm64.
Mutation enabled; stopped at tick 6000.
The unchanged moving and stationary 48-column bands are observed to tick 6,000 or actual extinction. The moving band shifts every 50 ticks; the stationary band stays at left edge 0. Food already on a tile remains when the moving band shifts. Offered food is matched while both arms are active, but accepted food can differ. The first 3,000 ticks exactly reproduce the accepted seed-1201 prefix and are historical regression, not new evidence.

| Window | Executed | Births | Deaths | Cap 48 | Near cap 47+ | Blocked cap/space | Population min–max | Endpoint pop/cells | Max-ever generation | Food offered/accepted/overflow | Occupied cells in band |
| --- | ---: | ---: | ---: | ---: | ---: | --- | --- | --- | ---: | --- | --- |
| 4501–5000 | 500/500 (complete) | 83 | 89 | 12/500 | 26/500 | 19/0 | 24–48 | 35/596 | 22 | 76800/52450/24350 | 484 (81.2%) |
| 5001–5500 | 500/500 (complete) | 91 | 100 | 17/500 | 25/500 | 9/0 | 24–48 | 26/488 | 25 | 76800/50057/26743 | 415 (85.0%) |
| 5501–6000 | 500/500 (complete) | 94 | 72 | 7/500 | 12/500 | 22/0 | 25–48 | 48/757 | 27 | 76800/48991/27809 | 641 (84.7%) |

Numerical screen: pass; this does not make a visual decision.
Historical 3,000-tick prefix: verified; reference artifact SHA-256 570aba2c02c52b7f949c60990b8bf33aa929a5352728c75d01d547666299c294.
Frames are saved every 20 actual ticks and at an off-cadence extinction tick when needed. A not-reached window is unavailable, not a simulated zero. Occupied-band share is descriptive and is not a fitness score.
This screen does not establish tracking, adaptation, fitness improvement, or superiority.
