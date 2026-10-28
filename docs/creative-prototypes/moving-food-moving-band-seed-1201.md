# Moving-food paired screen

Seed 1201; mode Moving 48-column replenishment band; Node 24.2.0 on darwin/arm64.
Mutation enabled; stopped at tick 3000.
The moving band changes replenishment destinations only. Food already on a tile remains when the band moves. This is not a matched usable-energy or stationary-band comparison.

| Window | Executed | Births | Deaths | Cap 48 | Near cap 47+ | Blocked cap/space | Population min–max | Endpoint pop/cells | Max-ever generation | Food offered/accepted/overflow | Occupied cells in band |
| --- | ---: | ---: | ---: | ---: | ---: | --- | --- | --- | ---: | --- | --- |
| 1501–2000 | 500/500 (complete) | 97 | 92 | 26/500 | 32/500 | 40/0 | 28–48 | 44/586 | 10 | 76800/41947/34853 | 423 (72.2%) |
| 2001–2500 | 500/500 (complete) | 82 | 84 | 7/500 | 19/500 | 35/0 | 29–48 | 42/756 | 11 | 76800/41141/35659 | 740 (97.9%) |
| 2501–3000 | 500/500 (complete) | 74 | 78 | 20/500 | 24/500 | 61/0 | 31–48 | 38/652 | 13 | 76800/46730/30070 | 582 (89.3%) |

Numerical screen: pass; this does not make a visual decision.
Uniform prefix: not-applicable; artifact data SHA-256 d72aca82bdce496b59fcc8f6e10d1576a3b91b6e3931a209c1af0640c93f61c8.
Frames are saved every 20 actual ticks and at an off-cadence extinction tick when needed. A not-reached window is unavailable, not a simulated zero. Occupied-band share is descriptive and is not a fitness score.
This screen does not establish tracking, adaptation, fitness improvement, or superiority.
