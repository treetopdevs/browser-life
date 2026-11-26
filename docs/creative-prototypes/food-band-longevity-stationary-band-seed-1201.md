# Food-band longevity screen

Seed 1201; mode Stationary 48-column replenishment band at column 0; Node 24.2.0 on darwin/arm64.
Mutation enabled; stopped at tick 6000.
The unchanged moving and stationary 48-column bands are observed to tick 6,000 or actual extinction. The moving band shifts every 50 ticks; the stationary band stays at left edge 0. Food already on a tile remains when the moving band shifts. Offered food is matched while both arms are active, but accepted food can differ. The first 3,000 ticks exactly reproduce the accepted seed-1201 prefix and are historical regression, not new evidence.

| Window | Executed | Births | Deaths | Cap 48 | Near cap 47+ | Blocked cap/space | Population min–max | Endpoint pop/cells | Max-ever generation | Food offered/accepted/overflow | Occupied cells in band |
| --- | ---: | ---: | ---: | ---: | ---: | --- | --- | --- | ---: | --- | --- |
| 4501–5000 | 500/500 (complete) | 61 | 76 | 0/500 | 0/500 | 0/0 | 17–36 | 21/325 | 24 | 76800/45409/31391 | 325 (100.0%) |
| 5001–5500 | 500/500 (complete) | 87 | 72 | 14/500 | 33/500 | 22/0 | 21–48 | 36/705 | 27 | 76800/42237/34563 | 678 (96.2%) |
| 5501–6000 | 500/500 (complete) | 98 | 98 | 26/500 | 32/500 | 23/0 | 23–48 | 36/487 | 29 | 76800/44491/32309 | 483 (99.2%) |

Numerical screen: pass; this does not make a visual decision.
Historical 3,000-tick prefix: verified; reference artifact SHA-256 65e160a97cd829b6e740db757eaee7364228c4890116a8cb2422f56795675d2b.
Frames are saved every 20 actual ticks and at an off-cadence extinction tick when needed. A not-reached window is unavailable, not a simulated zero. Occupied-band share is descriptive and is not a fitness score.
This screen does not establish tracking, adaptation, fitness improvement, or superiority.
