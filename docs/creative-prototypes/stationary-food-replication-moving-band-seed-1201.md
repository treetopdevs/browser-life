# Stationary-food paired screen

Seed 1201; mode Moving 48-column replenishment band; Node 24.2.0 on darwin/arm64.
Mutation enabled; stopped at tick 3000.
Both arms replenish the same 48-column band with the same pulse budget. The moving band shifts every 50 ticks; the stationary band stays at left edge 0. Food already on a tile remains when the moving band shifts. Offered food is matched while both arms are active, but accepted food can differ.

| Window | Executed | Births | Deaths | Cap 48 | Near cap 47+ | Blocked cap/space | Population min–max | Endpoint pop/cells | Max-ever generation | Food offered/accepted/overflow | Occupied cells in band |
| --- | ---: | ---: | ---: | ---: | ---: | --- | --- | --- | ---: | --- | --- |
| 1501–2000 | 500/500 (complete) | 97 | 92 | 26/500 | 32/500 | 40/0 | 28–48 | 44/586 | 10 | 76800/41947/34853 | 423 (72.2%) |
| 2001–2500 | 500/500 (complete) | 82 | 84 | 7/500 | 19/500 | 35/0 | 29–48 | 42/756 | 11 | 76800/41141/35659 | 740 (97.9%) |
| 2501–3000 | 500/500 (complete) | 74 | 78 | 20/500 | 24/500 | 61/0 | 31–48 | 38/652 | 13 | 76800/46730/30070 | 582 (89.3%) |

Numerical screen: pass; this does not make a visual decision.
Moving-band historical prefix: verified; reference artifact SHA-256 46017d1db1eaf1ff85b8cc51d92533d928aeac18b3e7cf261a82bb9d0d0816bf.
Frames are saved every 20 actual ticks and at an off-cadence extinction tick when needed. A not-reached window is unavailable, not a simulated zero. Occupied-band share is descriptive and is not a fitness score.
This screen does not establish tracking, adaptation, fitness improvement, or superiority.
