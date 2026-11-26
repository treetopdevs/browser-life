# Stationary-food paired screen

Seed 1202; mode Stationary 48-column replenishment band at column 0; Node 24.2.0 on darwin/arm64.
Mutation enabled; stopped at tick 3000.
Both arms replenish the same 48-column band with the same pulse budget. The moving band shifts every 50 ticks; the stationary band stays at left edge 0. Food already on a tile remains when the moving band shifts. Offered food is matched while both arms are active, but accepted food can differ.

| Window | Executed | Births | Deaths | Cap 48 | Near cap 47+ | Blocked cap/space | Population min–max | Endpoint pop/cells | Max-ever generation | Food offered/accepted/overflow | Occupied cells in band |
| --- | ---: | ---: | ---: | ---: | ---: | --- | --- | --- | ---: | --- | --- |
| 1501–2000 | 500/500 (complete) | 97 | 86 | 11/500 | 42/500 | 40/0 | 30–48 | 48/713 | 9 | 76800/45764/31036 | 711 (99.7%) |
| 2001–2500 | 500/500 (complete) | 78 | 95 | 25/500 | 43/500 | 24/0 | 25–48 | 31/409 | 12 | 76800/50957/25843 | 368 (90.0%) |
| 2501–3000 | 500/500 (complete) | 70 | 73 | 0/500 | 0/500 | 0/0 | 19–37 | 28/470 | 14 | 76800/46468/30332 | 451 (96.0%) |

Numerical screen: pass; this does not make a visual decision.
Moving-band historical prefix: not-applicable; reference artifact SHA-256 183d90f551dcaf6c29ab4f397bba52d93365c22ad3315787423a49926a792a83.
Frames are saved every 20 actual ticks and at an off-cadence extinction tick when needed. A not-reached window is unavailable, not a simulated zero. Occupied-band share is descriptive and is not a fitness score.
This screen does not establish tracking, adaptation, fitness improvement, or superiority.
