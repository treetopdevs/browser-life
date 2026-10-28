# Stationary-food paired screen

Seed 1203; mode Moving 48-column replenishment band; Node 24.2.0 on darwin/arm64.
Mutation enabled; stopped at tick 3000.
Both arms replenish the same 48-column band with the same pulse budget. The moving band shifts every 50 ticks; the stationary band stays at left edge 0. Food already on a tile remains when the moving band shifts. Offered food is matched while both arms are active, but accepted food can differ.

| Window | Executed | Births | Deaths | Cap 48 | Near cap 47+ | Blocked cap/space | Population min–max | Endpoint pop/cells | Max-ever generation | Food offered/accepted/overflow | Occupied cells in band |
| --- | ---: | ---: | ---: | ---: | ---: | --- | --- | --- | ---: | --- | --- |
| 1501–2000 | 500/500 (complete) | 99 | 86 | 15/500 | 25/500 | 33/0 | 29–48 | 48/697 | 9 | 76800/42619/34181 | 654 (93.8%) |
| 2001–2500 | 500/500 (complete) | 77 | 83 | 17/500 | 46/500 | 50/0 | 31–48 | 42/634 | 11 | 76800/45743/31057 | 556 (87.7%) |
| 2501–3000 | 500/500 (complete) | 89 | 91 | 11/500 | 40/500 | 18/0 | 28–48 | 40/678 | 13 | 76800/48147/28653 | 601 (88.6%) |

Numerical screen: pass; this does not make a visual decision.
Moving-band historical prefix: verified; reference artifact SHA-256 8ce7be228812002e2d03a2f68a15b9d1107e6fff022006ae9059003bb66e0c9b.
Frames are saved every 20 actual ticks and at an off-cadence extinction tick when needed. A not-reached window is unavailable, not a simulated zero. Occupied-band share is descriptive and is not a fitness score.
This screen does not establish tracking, adaptation, fitness improvement, or superiority.
