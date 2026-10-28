# Stationary-food paired screen

Seed 1203; mode Stationary 48-column replenishment band at column 0; Node 24.2.0 on darwin/arm64.
Mutation enabled; stopped at tick 3000.
Both arms replenish the same 48-column band with the same pulse budget. The moving band shifts every 50 ticks; the stationary band stays at left edge 0. Food already on a tile remains when the moving band shifts. Offered food is matched while both arms are active, but accepted food can differ.

| Window | Executed | Births | Deaths | Cap 48 | Near cap 47+ | Blocked cap/space | Population min–max | Endpoint pop/cells | Max-ever generation | Food offered/accepted/overflow | Occupied cells in band |
| --- | ---: | ---: | ---: | ---: | ---: | --- | --- | --- | ---: | --- | --- |
| 1501–2000 | 500/500 (complete) | 109 | 98 | 27/500 | 33/500 | 16/0 | 29–48 | 48/634 | 10 | 76800/45790/31010 | 583 (92.0%) |
| 2001–2500 | 500/500 (complete) | 87 | 95 | 28/500 | 46/500 | 30/0 | 31–48 | 40/617 | 12 | 76800/50984/25816 | 608 (98.5%) |
| 2501–3000 | 500/500 (complete) | 80 | 91 | 0/500 | 0/500 | 0/0 | 21–44 | 29/514 | 15 | 76800/50097/26703 | 466 (90.7%) |

Numerical screen: pass; this does not make a visual decision.
Moving-band historical prefix: not-applicable; reference artifact SHA-256 8ce7be228812002e2d03a2f68a15b9d1107e6fff022006ae9059003bb66e0c9b.
Frames are saved every 20 actual ticks and at an off-cadence extinction tick when needed. A not-reached window is unavailable, not a simulated zero. Occupied-band share is descriptive and is not a fitness score.
This screen does not establish tracking, adaptation, fitness improvement, or superiority.
